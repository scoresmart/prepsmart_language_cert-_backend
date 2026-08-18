/**
 * Headless smoke test for the realtime speaking bridge — no browser, no mic.
 *
 *   node server/test-client.mjs --mode silent    # dead air: nudges, skip, abandon
 *   node server/test-client.mjs --mode answer    # synthesised candidate answers
 *
 * `answer` mode speaks real audio (OpenAI TTS -> PCM16 24 kHz) into the bridge,
 * so the full path is exercised: transcription, script advance, and auto-save.
 */

import fs from "node:fs";
import WebSocket from "ws";

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
};

const PORT = arg("port", process.env.PORT || 5000);

// The examiner now shares the API server's port, so the default target is the
// local backend. Pass --url to point at Railway:
//   node scripts/test-realtime-client.mjs --url wss://<service>.up.railway.app/realtime/speaking
const TARGET = arg("url", `ws://localhost:${PORT}/realtime/speaking`);
const RUN_SECONDS = Number(arg("seconds", 120));
const MODE = arg("mode", "silent");

/** A miniature four-part exam: enough to exercise every segment kind. */
const SEGMENTS = [
  { id: "s1", kind: "say", part: 0, text: "Hi there, I'm your LanguageCert examiner. Welcome, and thank you for coming today. This is the LanguageCert Academic Speaking practice test, and it has four parts which together take about fifteen minutes. In Part One I will ask you some questions about yourself. In Part Two I will read you two situations and we will act them out together. In Part Three you will describe a picture, and in Part Four you will speak about a topic on your own. Please answer naturally, in full sentences, and take your time. Let's begin with Part One.", seconds: 0, label: "Introduction" },
  { id: "s2", kind: "ask", part: 1, text: "What is your full name?", seconds: 20, label: "Part 1 · Opening question 1" },
  { id: "s3", kind: "ask", part: 1, text: "Where are you from?", seconds: 20, label: "Part 1 · Opening question 2" },
  { id: "s4", kind: "say", part: 1, text: "Thank you. Now I'm going to ask you some questions about yourself.", seconds: 0, label: "Part 1 · Transition" },
  { id: "s5", kind: "ask", part: 1, text: "Do you work or study at the moment?", seconds: 18, label: "Part 1 · Question 1 of 1" },
  { id: "s6", kind: "say", part: 1, text: "Thank you. That is the end of Part 1.", seconds: 0, label: "Part 1 · Closing" },
  { id: "s7", kind: "say", part: 2, text: "Now we will begin Part 2. I will read a situation for you, and I want you to start your answer.", seconds: 0, label: "Part 2 · Introduction" },
  { id: "s8", kind: "converse", part: 2, text: "I am your teacher. You could not submit your assignment on time. Explain why and ask me for an extension. You may start now.", seconds: 25, label: "Part 2 · Situation 1 of 1", context: "The examiner is the teacher; the candidate needs an extension." },
  { id: "s9", kind: "say", part: 3, text: "Now we will move to Part 3. You will see a picture on your screen.", seconds: 0, label: "Part 3 · Introduction" },
  { id: "s10", kind: "prepare", part: 3, text: "Look at the picture and prepare. Your preparation time starts now.", seconds: 12, label: "Part 3 · Preparation" },
  { id: "s11", kind: "speak", part: 3, text: "Your preparation time is over. Please describe the picture in as much detail as you can.", seconds: 20, label: "Part 3 · Describe the picture", context: "Picture title: A busy railway station\nWhat the picture shows: Commuters waiting on a crowded platform in the early morning." },
  { id: "s12", kind: "generated", part: 3, text: "", seconds: 20, label: "Part 3 · Question 1 of 1", context: "Picture title: A busy railway station\nWhat the picture shows: Commuters waiting on a crowded platform in the early morning.", generatedIndex: 1, generatedTotal: 1 },
  { id: "s13", kind: "say", part: 4, text: "In Part Four you are going to talk about something for half a minute.", seconds: 0, label: "Part 4 · Introduction" },
  { id: "s14", kind: "prepare", part: 4, text: "Your topic is: a skill you would like to learn. You have fifteen seconds to prepare. Your preparation time starts now.", seconds: 15, label: "Part 4 · Preparation", context: "A skill you would like to learn" },
  { id: "s15", kind: "speak", part: 4, text: "Your preparation time is over. Please start speaking now about a skill you would like to learn.", seconds: 20, label: "Part 4 · Talk on the topic", context: "A skill you would like to learn" },
  { id: "s16", kind: "generated", part: 4, text: "", seconds: 20, label: "Part 4 · Follow-up 1 of 1", context: "A skill you would like to learn", generatedIndex: 1, generatedTotal: 1 },
  { id: "s17", kind: "say", part: 0, text: "Thank you very much. That is the end of the speaking test. Goodbye.", seconds: 0, label: "End of test" },
];

const ANSWERS = [
  "My name is Daniel Okafor.",
  "I'm from Lagos in Nigeria, but I have been living in Manchester for about two years now.",
  "I'm studying at the moment. I'm doing a master's degree in civil engineering.",
  "I'm really sorry, I was unwell last week and I couldn't finish it. Could I possibly have a few more days to submit it?",
  "The picture shows a very busy railway station. There are a lot of commuters standing on the platform, and it looks like it is early in the morning.",
  "Yes, I think public transport is very important in big cities because it reduces traffic and pollution.",
  "I would really like to learn how to play the piano, because I have always enjoyed listening to classical music.",
  "I think it would take a few years of regular practice, but I would enjoy the process a lot.",
];

const KEY = (() => {
  try {
    return fs.readFileSync(".env", "utf8").match(/^OPENAI_API_KEY=(.*)$/m)?.[1].trim() ?? "";
  } catch {
    return "";
  }
})();

/** Text -> raw PCM16 24 kHz mono, the exact format the bridge forwards upstream. */
async function synthesise(text) {
  const res = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-4o-mini-tts",
      voice: "ash",
      input: text,
      response_format: "pcm",
      speed: 1.0,
    }),
  });
  if (!res.ok) throw new Error(`TTS failed (${res.status}): ${await res.text()}`);
  return Buffer.from(await res.arrayBuffer());
}

const ws = new WebSocket(TARGET);

const CHUNK = 2 * 480; // 20 ms of PCM16 @ 24 kHz
const SILENCE = Buffer.alloc(CHUNK);

let outbound = Buffer.alloc(0); // candidate audio waiting to be streamed
let playbackEndsAt = 0;          // when the examiner audio we received finishes
let playbackTimer = null;
let audioBytes = 0;
let examinerSpeaking = false;
let currentSegment = -1;
let currentKind = null;
let spokenFor = -1;
let answerCursor = 0;
let violations = 0;
const t0 = Date.now();
const stamp = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`.padStart(6);

const SPEAKING_KINDS = new Set(["ask", "converse", "speak", "generated"]);

function enqueueAnswer(index) {
  if (MODE !== "answer" || spokenFor === index) return;
  if (!SPEAKING_KINDS.has(currentKind)) return; // never speak over prep time
  spokenFor = index;
  const text = ANSWERS[answerCursor++ % ANSWERS.length];
  console.log(`${stamp()}  (synthesising answer for segment ${index + 1})`);
  synthesise(text)
    .then((pcm) => {
      outbound = Buffer.concat([outbound, pcm]);
      console.log(`${stamp()}  CANDIDATE (speaking ${(pcm.length / 48000).toFixed(1)}s): ${text}`);
    })
    .catch((e) => console.log(`${stamp()}  TTS error: ${e.message}`));
}

ws.on("open", () => {
  console.log(`${stamp()}  connected (mode=${MODE})`);
  ws.send(
    JSON.stringify({
      t: "start",
      exam: {
        setId: "smoke-test",
        setTitle: "Smoke Test Set",
        level: "B1",
        examName: "LanguageCert Academic Speaking",
        segments: SEGMENTS,
      },
    }),
  );

  // A steady 20 ms mic stream: candidate audio when we have it, silence otherwise.
  const mic = setInterval(() => {
    if (ws.readyState !== WebSocket.OPEN) {
      clearInterval(mic);
      return;
    }
    if (outbound.length >= CHUNK) {
      ws.send(outbound.subarray(0, CHUNK), { binary: true });
      outbound = outbound.subarray(CHUNK);
    } else {
      ws.send(SILENCE, { binary: true });
    }
  }, 20);
});

ws.on("message", (data, isBinary) => {
  if (isBinary) {
    audioBytes += data.length;
    // PCM16 mono @ 24 kHz = 48000 bytes/sec. Mirror the browser: tell the
    // bridge when this audio would actually finish being heard.
    const now = Date.now();
    playbackEndsAt = Math.max(playbackEndsAt, now) + (data.length / 48000) * 1000;
    if (playbackTimer) clearTimeout(playbackTimer);
    playbackTimer = setTimeout(() => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: "playback.done" }));
    }, Math.max(0, playbackEndsAt - now));
    return;
  }
  const ev = JSON.parse(data.toString());
  switch (ev.t) {
    case "ready":
      console.log(`${stamp()}  ready — ${ev.total} segments, session ${ev.sessionId}`);
      break;
    case "segment":
      currentSegment = ev.index;
      currentKind = ev.kind;
      console.log(
        `${stamp()}  [${String(ev.progress).padStart(3)}%] SEG ${ev.index + 1}/${ev.total} ${ev.kind.toUpperCase()} — ${ev.label}` +
          (ev.text ? `: ${ev.text.slice(0, 70)}` : ""),
      );
      break;
    case "prepare":
      console.log(`${stamp()}  *** PREPARE ${ev.seconds}s — examiner must stay silent, no nudges`);
      break;
    case "examiner.speaking":
      if (!ev.speaking && examinerSpeaking) {
        const secs = Math.max(0, (playbackEndsAt - Date.now()) / 1000);
        console.log(`${stamp()}  (examiner audio still playing for ${secs.toFixed(1)}s)`);
      }
      examinerSpeaking = ev.speaking;
      // Answer as soon as the examiner stops talking, like a real candidate.
      if (!examinerSpeaking && currentSegment >= 0) setTimeout(() => enqueueAnswer(currentSegment), 700);
      break;
    case "transcript":
      console.log(`${stamp()}  ${ev.role === "examiner" ? "EXAMINER" : "CANDIDATE(heard)"}: ${ev.text}`);
      break;
    case "nudge": {
      const overlapMs = playbackEndsAt - Date.now();
      if (overlapMs > 250) {
        violations += 1;
        console.log(
          `${stamp()}  !!! VIOLATION: nudge ${ev.level}/${ev.max} fired while examiner audio still had ${(overlapMs / 1000).toFixed(1)}s left`,
        );
      } else {
        console.log(
          `${stamp()}  *** NUDGE ${ev.level}/${ev.max} on segment ${ev.index + 1} (audio finished ${(-overlapMs / 1000).toFixed(1)}s ago) OK`,
        );
      }
      break;
    }
    case "saved":
      console.log(`${stamp()}  SAVED -> ${ev.path}`);
      break;
    case "done":
      console.log(
        `${stamp()}  DONE (${ev.reason}) after ${Math.round(ev.durationMs / 1000)}s — ` +
          `asked ${ev.summary?.questionsAsked}, answered ${ev.summary?.questionsAnswered}, skipped ${ev.summary?.questionsSkipped}`,
      );
      break;
    case "error":
      console.log(`${stamp()}  ERROR: ${ev.message}`);
      break;
    default:
      break;
  }
});

ws.on("close", (code) => {
  console.log(`${stamp()}  closed (${code}) — received ${(audioBytes / 1024).toFixed(0)} KB examiner audio`);
  console.log(violations === 0 ? "RESULT: no nudge interrupted the examiner" : `RESULT: ${violations} VIOLATION(S)`);
  process.exit(0);
});
ws.on("error", (e) => {
  console.log(`${stamp()}  socket error: ${e.message}`);
  process.exit(1);
});

setTimeout(() => {
  console.log(`${stamp()}  test window elapsed — closing`);
  try {
    ws.close();
  } catch {
    /* already closed */
  }
  setTimeout(() => process.exit(0), 1000);
}, RUN_SECONDS * 1000);
