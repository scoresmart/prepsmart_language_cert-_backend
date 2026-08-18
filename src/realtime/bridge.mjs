/**
 * Realtime speaking-examiner bridge, mounted on the main API server.
 *
 *   browser  <-- wss://<api-host>/realtime/speaking -->  bridge  <-->  OpenAI Realtime
 *
 * There is no second port and no second service. Railway gives the container a
 * single PORT, so the WebSocket shares the Express server's listener through
 * its `upgrade` event: plain HTTP keeps going to Express, and only
 * `/realtime/speaking` is handed to the examiner.
 *
 * OPENAI_API_KEY lives here and only here. The browser is given a `ws://` URL
 * and nothing else, so the key can never be lifted out of the frontend bundle.
 */

import { WebSocketServer } from "ws";

import { CONFIG, ExaminerSession } from "./examinerSession.mjs";

export const REALTIME_PATH = "/realtime/speaking";

const MAX_CONCURRENT = Number(process.env.REALTIME_MAX_CONCURRENT) || 4;

/** How long a connected client may sit there without starting an exam. */
const START_GRACE_MS = Number(process.env.REALTIME_START_GRACE_MS) || 30_000;

const HEARTBEAT_MS = 15_000;

// ---------------------------------------------------------------- origins
//
// Same policy as the REST API (src/config/cors.ts), read from the same env
// vars, so an origin that may call the API may also open an exam. Browsers do
// not apply CORS to WebSockets, so this check is the only thing standing
// between a random page and a billed session.

const LOCALHOST_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i;
const VERCEL_ORIGIN = /^https:\/\/[a-z0-9-]+([.][a-z0-9-]+)*\.vercel\.app$/i;
const RAILWAY_ORIGIN = /^https:\/\/[a-z0-9-]+([.][a-z0-9-]+)*\.up\.railway\.app$/i;

const splitList = (raw) =>
  (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

/** `REALTIME_ALLOWED_ORIGINS`, when set, replaces the API's list entirely. */
const EXPLICIT_ORIGINS = splitList(
  process.env.REALTIME_ALLOWED_ORIGINS || process.env.CORS_ORIGIN,
);

const ALLOW_VERCEL = process.env.CORS_ALLOW_VERCEL !== "false";
const ALLOW_RAILWAY = process.env.CORS_ALLOW_RAILWAY !== "false";
const ALLOW_LOCALHOST =
  process.env.NODE_ENV !== "production" || process.env.CORS_ALLOW_LOCALHOST === "true";

function matchesPattern(origin, pattern) {
  if (!pattern.includes("*")) return origin === pattern;
  const re = new RegExp(
    `^${pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`,
    "i",
  );
  return re.test(origin);
}

function isAllowedOrigin(origin) {
  // Non-browser clients (server/test-client.mjs, curl, uptime checks) send no
  // Origin at all. There is nothing to spoof, so there is nothing to block.
  if (!origin) return true;
  if (EXPLICIT_ORIGINS.some((entry) => matchesPattern(origin, entry))) return true;
  if (ALLOW_VERCEL && VERCEL_ORIGIN.test(origin)) return true;
  if (ALLOW_RAILWAY && RAILWAY_ORIGIN.test(origin)) return true;
  if (ALLOW_LOCALHOST && LOCALHOST_ORIGIN.test(origin)) return true;
  return false;
}

// ---------------------------------------------------------------- auth
//
// On by default. An exam costs real money to run, so the socket is closed to
// anyone without a valid Supabase session — the origin check alone only proves
// the request came from our own page, not that a signed-in student sent it.
//
// The verifier is injected by index.ts rather than implemented here: it calls
// the same `supabase.auth.getUser()` the REST middleware uses, so a token the
// API accepts is a token the examiner accepts. This module stays free of
// backend imports because it is shared verbatim with the frontend repo.

const REQUIRE_AUTH = process.env.REALTIME_REQUIRE_AUTH !== "false";

/** WebSocket close code for "you are not signed in" — surfaced to the browser. */
const CLOSE_UNAUTHORIZED = 4401;

/** Set by attachRealtimeBridge(). Returns a user object, or null to refuse. */
let verifyToken = async () => null;

function readToken(url, req) {
  // Browsers cannot set headers on a WebSocket, so the token rides in the
  // query string. Non-browser clients may use the header instead.
  return (
    url.searchParams.get("token") ||
    (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "") ||
    ""
  );
}

// ---------------------------------------------------------------- mount

const sessions = new Set();

function readApiKey() {
  return (process.env.OPENAI_API_KEY || process.env.REALTIME_OPENAI_API_KEY || "").trim();
}

/** Live counts for the /realtime/health route. */
export function realtimeStatus() {
  return {
    enabled: Boolean(readApiKey()),
    path: REALTIME_PATH,
    model: CONFIG.MODEL,
    voice: CONFIG.VOICE,
    activeSessions: sessions.size,
    maxConcurrent: MAX_CONCURRENT,
    maxExamMinutes: Math.round(CONFIG.MAX_EXAM_MS / 60_000),
    requiresAuth: REQUIRE_AUTH,
  };
}

function reject(socket, statusLine, why) {
  console.warn(`[realtime] ${why}`);
  try {
    socket.write(`HTTP/1.1 ${statusLine}\r\nConnection: close\r\n\r\n`);
  } catch {
    /* peer already gone */
  }
  socket.destroy();
}

/**
 * Attach the examiner to an existing http.Server.
 *
 * Returns false (and logs why) when no OpenAI key is configured, leaving the
 * REST API to boot exactly as before. A missing key is a misconfiguration, not
 * a reason to take the whole backend down.
 */
export function attachRealtimeBridge(server, options = {}) {
  const apiKey = readApiKey();

  if (typeof options.verifyToken === "function") {
    verifyToken = options.verifyToken;
  } else if (REQUIRE_AUTH) {
    // Refusing everything is the safe failure here: a bridge that silently let
    // every socket through because its verifier went missing is worse than one
    // that is plainly broken.
    console.error(
      "[realtime] auth is required but no verifier was supplied — every exam will be refused.",
    );
  }

  if (!apiKey) {
    console.warn(
      "[realtime] OPENAI_API_KEY is not set — the live speaking examiner is disabled. " +
        "Set it in the Railway service variables (no VITE_ prefix) to enable it.",
    );
    return false;
  }
  if (!apiKey.startsWith("sk-")) {
    console.warn("[realtime] OPENAI_API_KEY does not look like an OpenAI key — examiner disabled.");
    return false;
  }

  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req, socket, head) => {
    let url;
    try {
      url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    } catch {
      socket.destroy();
      return;
    }

    // Node stops auto-closing unhandled upgrades as soon as an `upgrade`
    // listener exists, so an unknown path would sit open until it timed out.
    // This is the only WebSocket endpoint on the service, so anything else is
    // closed here — add a path check before this line if a second one appears.
    if (url.pathname !== REALTIME_PATH) {
      socket.destroy();
      return;
    }

    const origin = req.headers.origin;
    if (!isAllowedOrigin(origin)) {
      reject(socket, "403 Forbidden", `rejected origin ${origin}`);
      return;
    }

    if (sessions.size >= MAX_CONCURRENT) {
      reject(socket, "503 Service Unavailable", `at capacity (${MAX_CONCURRENT}) — rejecting`);
      return;
    }

    const finish = (user) =>
      wss.handleUpgrade(req, socket, head, (ws) => {
        ws.user = user;
        wss.emit("connection", ws, req);
      });

    if (!REQUIRE_AUTH) {
      finish(null);
      return;
    }

    void verifyToken(readToken(url, req)).then((user) => {
      if (user) {
        finish(user);
        return;
      }

      // Deliberately NOT an HTTP 401. A browser whose upgrade is refused sees
      // only a generic failure with close code 1006 and no reason, so the
      // candidate would be told "could not reach the examiner" when the real
      // problem is an expired login. Completing the handshake and closing with
      // a code the page can read turns that into an accurate message. No
      // ExaminerSession is created, so nothing is billed.
      console.warn("[realtime] refused a socket with no valid session");
      wss.handleUpgrade(req, socket, head, (ws) => {
        ws.close(CLOSE_UNAUTHORIZED, "sign in again to start the exam");
      });
    });
  });

  wss.on("connection", (ws) => {
    const session = new ExaminerSession(ws, apiKey);
    sessions.add(session);
    const who = ws.user?.email ?? ws.user?.sub ?? "anonymous";
    console.log(
      `[realtime] client connected — session ${session.sessionId} for ${who} (${sessions.size} active)`,
    );

    // A client that connects and never starts an exam still holds a slot.
    const startGuard = setTimeout(() => {
      if (!session.upstream) {
        console.log(`[${session.sessionId}] no start within ${START_GRACE_MS / 1000}s — dropping`);
        session.closeClient(1008, "no exam.start");
      }
    }, START_GRACE_MS);

    // Railway's edge proxy drops an idle socket. The ping keeps it open and,
    // more usefully, notices a candidate whose laptop slept mid-answer.
    let alive = true;
    ws.on("pong", () => {
      alive = true;
    });
    const heartbeat = setInterval(() => {
      if (!alive) {
        console.log(`[${session.sessionId}] heartbeat lost — terminating`);
        ws.terminate();
        return;
      }
      alive = false;
      try {
        ws.ping();
      } catch {
        /* socket already closing */
      }
    }, HEARTBEAT_MS);

    ws.on("message", (data, isBinary) => {
      if (isBinary) {
        session.pushAudio(Buffer.isBuffer(data) ? data : Buffer.from(data));
        return;
      }

      let msg;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return;
      }

      switch (msg.t) {
        case "start":
          clearTimeout(startGuard);
          void session.start(msg.exam ?? {});
          break;
        case "playback.done":
          // The browser has finished playing the examiner's audio, so the
          // candidate's turn starts now rather than when generation ended.
          session.onPlaybackDrained();
          break;
        case "stop":
          session.beginClosing("candidate_stopped");
          break;
        case "abort":
          void session.end("candidate_aborted");
          break;
        case "ping":
          session.send({ t: "pong" });
          break;
        default:
          break;
      }
    });

    ws.on("close", () => {
      clearTimeout(startGuard);
      clearInterval(heartbeat);
      session.abandon();
      sessions.delete(session);
      console.log(`[realtime] client gone — ${sessions.size} active`);
    });

    ws.on("error", (err) => {
      console.error(`[${session.sessionId}] client socket error:`, err.message);
    });
  });

  console.log(`[realtime] speaking examiner mounted on ${REALTIME_PATH}`);
  console.log(`[realtime]   model    : ${CONFIG.MODEL} (voice: ${CONFIG.VOICE})`);
  console.log(
    `[realtime]   exam cap : ${Math.round(CONFIG.MAX_EXAM_MS / 60_000)} min, ${MAX_CONCURRENT} concurrent`,
  );
  console.log(
    `[realtime]   auth     : ${REQUIRE_AUTH ? "supabase jwt required" : "origin check only"}`,
  );
  console.log(`[realtime]   key      : ${apiKey.slice(0, 7)}…${apiKey.slice(-4)} (server-side only)`);

  return true;
}

/** Close every live exam — called on SIGTERM so Railway redeploys cleanly. */
export async function shutdownRealtimeBridge(reason = "server_shutdown") {
  if (!sessions.size) return;
  console.log(`[realtime] closing ${sessions.size} active session(s)`);
  await Promise.allSettled([...sessions].map((s) => s.end(reason)));
}
