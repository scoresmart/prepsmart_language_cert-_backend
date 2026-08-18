# Live speaking examiner

A real-time voice examiner for the LanguageCert speaking test. The candidate
talks to an AI examiner over a WebSocket; the examiner reads the questions the
admin authored in the Speaking Set editor, listens, acknowledges, and moves the
test along on its own.

```
browser ──wss://<api-host>/realtime/speaking──► this service ──wss://api.openai.com/v1/realtime──► OpenAI
   mic PCM16 24k up                            (holds OPENAI_API_KEY)
   examiner PCM16 24k down
```

## It shares the API's port

Railway gives a service exactly one port, so the examiner does **not** run a
server of its own. `src/server.ts` wraps Express in an `http.Server` and
`attachRealtime()` claims the `upgrade` event for `/realtime/speaking`. Plain
HTTP keeps going to Express; only that one path becomes a WebSocket.

There is nothing extra to deploy: same service, same domain, same build.

| File | What it does |
| --- | --- |
| `index.ts` | Loads the ESM modules below from CommonJS and mounts them |
| `bridge.mjs` | Upgrade handling, origin checks, capacity, heartbeat, message routing |
| `examinerSession.mjs` | One exam: the segment runner and the OpenAI Realtime connection |
| `examinerPrompt.mjs` | Examiner persona and the per-turn directives |
| `sessionStore.mjs` | Debounced transcript auto-save |

`bridge.mjs` and below are plain ESM because they are shared verbatim with the
frontend repo, where they were written and are still smoke-tested. `index.ts`
exists to bridge the module systems: this backend compiles to CommonJS, and
`tsc` would rewrite a normal `import()` into `require()`, which throws
`ERR_REQUIRE_ESM` on a `.mjs` file.

Because `tsc` only emits what it compiles, `npm run build` runs
`scripts/copy-realtime.mjs` afterwards to copy the `.mjs` files into
`dist/realtime/`. **Skip that step and the build looks clean but the examiner
throws `MODULE_NOT_FOUND` on the first exam.**

## Switching it on

Set one variable on the Railway service:

```
OPENAI_API_KEY=sk-proj-...
```

Server-side only. Never give it a `VITE_` prefix — Vite inlines every `VITE_*`
variable into the browser bundle, which would publish the key to every visitor.
The browser only ever receives the `wss://` URL.

Without the key the API boots exactly as before and logs that the examiner is
disabled. A missing key is a misconfiguration, not a reason to take the whole
backend down.

Then point the frontend at this service (Vercel env var):

```
VITE_REALTIME_EXAM_WS_URL=wss://<your-service>.up.railway.app/realtime/speaking
```

Check it over plain HTTP — no WebSocket client needed:

```
GET https://<your-service>.up.railway.app/realtime/health
```

## Who may connect

Browsers do not apply CORS to WebSockets, so the origin check on the upgrade is
the only thing standing between a random page and a billed session. It reads the
same `CORS_ORIGIN` / `CORS_ALLOW_VERCEL` / `CORS_ALLOW_RAILWAY` /
`CORS_ALLOW_LOCALHOST` variables as the REST API, so an origin that may call the
API may also open an exam. `REALTIME_ALLOWED_ORIGINS` overrides that list for
the WebSocket alone.

On top of that, the socket requires a **valid Supabase session**, on by
default. The origin check only proves the request came from our own page; it
says nothing about who sent it, and an exam costs real money to run.

The browser cannot set headers on a WebSocket, so the frontend appends the
access token as `?token=…` (safe over `wss://`, where the URL travels inside
the encrypted tunnel). The backend verifies it with the same
`supabase.auth.getUser()` call the REST middleware uses — so a token the API
accepts is a token the examiner accepts, and it keeps working when Supabase
rotates its signing keys. `REALTIME_REQUIRE_AUTH=false` disables the check.

A refused socket is **not** an HTTP 401. A browser whose upgrade fails sees only
close code 1006 with no reason, so an expired login would reach the candidate as
"could not reach the examiner". Instead the handshake completes and the socket
is immediately closed with **4401** and a reason the page can read — no
`ExaminerSession` is created, so nothing is billed. The client turns that into
*"Your session has expired. Please sign in again."*

## How a test runs

1. Browser opens the mic **once** and keeps it open for the whole test. It is
   never cycled between questions.
2. The bridge configures the session: examiner persona + the admin's script +
   server-side VAD, then tells the examiner to greet and ask question 1.
3. Examiner says *"Hi there, I'm your LanguageCert examiner…"*, introduces the
   test, asks question 1, and stops.
4. Candidate answers. VAD detects speech, the answer is transcribed, and the
   examiner acknowledges and moves on.
5. Repeat to the end of the script, then the examiner closes the test.

### Who decides what

The **model** owns the conversation — wording, acknowledgements, one optional
follow-up, the timing of its own speech. The **bridge** owns the exam: which
segment is current, when a question is abandoned, and when the test ends.

That split matters. The model will happily invent a candidate's answer during
silence and then try to advance off it. The bridge only advances when real
speech was actually transcribed, so an imagined answer can never move the
script (`ignoring premature next_question` in the log).

### Silence handling

| Elapsed silence | What happens |
| --- | --- |
| `REALTIME_NUDGE_MS` (8s) | *"Are you there? Take your time, there's no rush."* + repeats the question |
| each further 8s | another check, up to `REALTIME_MAX_NUDGES` (3) |
| `REALTIME_FINAL_GRACE_MS` (8s) after the last | Segment marked `skipped`, examiner moves on |

### Resource guards

Nothing here keeps a billed session alive longer than it is useful:

- Browser disconnects → upstream OpenAI socket closed immediately.
- 20-minute exam ceiling, 22-minute hard kill.
- Per-answer cap of the admin's timer plus 10s slack.
- Max 4 concurrent exams per instance; a client that connects without starting
  one is dropped after 30s.
- A 15s ping/pong notices a candidate whose laptop slept mid-answer, and keeps
  Railway's edge proxy from dropping an idle socket.
- `SIGTERM` (every Railway redeploy) closes live exams before the container
  goes away, so candidates get a proper end frame rather than a dead socket.

## Transcripts

The bridge writes `<REALTIME_SESSION_DIR>/<sessionId>.json` continuously —
debounced on every turn, with per-segment status (`answered` / `skipped` /
`pending`) and nudge counts — so a dropped connection still leaves a complete
partial record.

**Railway's filesystem is ephemeral**, so these survive only until the next
restart or deploy. They are a debugging aid, not the system of record: the
scored attempt is saved through `POST /api/v1/practice/attempts` by the browser
when the test finishes. Point `REALTIME_SESSION_DIR` at a mounted volume to keep
them, or set it to `off` to skip disk writes entirely.

## Smoke test (no browser, no mic)

```bash
# the socket needs a real session — copy a students access token from the
# browser (Application > Local Storage > sb-*-auth-token)
npm run realtime:test -- --token eyJhbGci... --mode answer   # synthesised answers
npm run realtime:test -- --token eyJhbGci... --mode silent   # dead air -> nudge -> skip

# against the deployed service
npm run realtime:test -- --url wss://<your-service>.up.railway.app/realtime/speaking
```

## Tuning

All optional; defaults live in `examinerSession.mjs`.

| Variable | Default | Meaning |
| --- | --- | --- |
| `REALTIME_MODEL` | `gpt-realtime` | Realtime model |
| `REALTIME_VOICE` | `cedar` | Examiner voice |
| `REALTIME_VAD_SILENCE_MS` | `700` | Pause before the examiner takes its turn |
| `REALTIME_VAD_THRESHOLD` | `0.5` | Mic sensitivity — raise in a noisy room |
| `REALTIME_NUDGE_MS` | `8000` | Silence before *"are you there?"* |
| `REALTIME_MAX_NUDGES` | `3` | Checks before the test is abandoned |
| `REALTIME_MAX_EXAM_MS` | `1200000` | 20-minute ceiling |
| `REALTIME_MAX_CONCURRENT` | `4` | Concurrent exams on this instance |
| `REALTIME_SESSION_DIR` | `.realtime-sessions` | Transcript directory, or `off` |
| `REALTIME_REQUIRE_AUTH` | on | Require a valid Supabase session on the socket |
| `REALTIME_DEBUG` | off | Log every script decision |

## Still worth doing

- Write transcripts to Supabase instead of the container filesystem.
- Per-user rate limiting and a daily spend cap — a signed-in student can still
  open exams up to the concurrency limit.
