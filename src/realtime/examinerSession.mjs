/**
 * One live speaking exam: browser <-> this bridge <-> OpenAI Realtime.
 *
 * The bridge is a generic segment runner. The client sends an ordered list of
 * segments (built in src/lib/speakingExamSegments.ts) and the bridge walks them,
 * deciding when the examiner may move on. The model never advances the script by
 * itself — it will happily invent a candidate answer during dead air and try to
 * continue, so only genuinely transcribed speech counts as an answer.
 */

import WebSocket from "ws";

import {
  askDirective,
  buildExaminerInstructions,
  clarifyDirective,
  closingDirective,
  correctionAckDirective,
  correctionCue,
  converseContinueDirective,
  converseDirective,
  generatedDirective,
  firstName,
  followupDirective,
  memoryBlock,
  nameCue,
  nudgeDirective,
  prepareDirective,
  sayDirective,
  speakDirective,
  timeUpDirective,
} from "./examinerPrompt.mjs";
import { SessionRecord, transcriptSummary } from "./sessionStore.mjs";

const num = (name, fallback) => {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
};

export const CONFIG = {
  MODEL: process.env.REALTIME_MODEL || "gpt-realtime",
  VOICE: process.env.REALTIME_VOICE || "cedar",
  TRANSCRIBE_MODEL: process.env.REALTIME_TRANSCRIBE_MODEL || "gpt-4o-mini-transcribe",

  /** Silence before each "are you there?" check. */
  NUDGE_MS: num("REALTIME_NUDGE_MS", 8_000),
  /** How many times the examiner checks before the test is abandoned. */
  MAX_NUDGES: num("REALTIME_MAX_NUDGES", 3),
  /** Grace after the final check before the test actually ends. */
  FINAL_GRACE_MS: num("REALTIME_FINAL_GRACE_MS", 8_000),
  /** Extra time on top of a segment's own allowance. */
  ANSWER_SLACK_MS: num("REALTIME_ANSWER_SLACK_MS", 10_000),
  /** The model acknowledged but forgot to signal — advance for it. */
  STALL_MS: num("REALTIME_STALL_MS", 3_500),

  MAX_EXAM_MS: num("REALTIME_MAX_EXAM_MS", 20 * 60_000),
  HARD_KILL_MS: num("REALTIME_HARD_KILL_MS", 22 * 60_000),

  /**
   * How long a candidate may pause mid-answer before VAD calls the turn over.
   * Real speakers stop to think, especially at B1 — a short window here is what
   * makes an examiner talk over its candidate.
   */
  VAD_SILENCE_MS: num("REALTIME_VAD_SILENCE_MS", 1_100),
  /**
   * Mic sensitivity. Left at the API default: the gate already keeps the room
   * out while the examiner talks, and a high bar here does the opposite damage
   * — a quiet or distant candidate is simply never heard.
   */
  VAD_THRESHOLD: Number(process.env.REALTIME_VAD_THRESHOLD) || 0.5,

  /**
   * Grace after a transcript lands before the examiner is allowed to reply.
   * If the candidate starts talking again inside it they were only drawing
   * breath, and their next sentence joins the same answer.
   */
  ANSWER_SETTLE_MS: num("REALTIME_ANSWER_SETTLE_MS", 1_400),
  /** Mic stays shut this long after the examiner's audio stops, to miss the echo tail. */
  MIC_REOPEN_MS: num("REALTIME_MIC_REOPEN_MS", 250),
  /** Answers with fewer real words than this are asked to be developed. */
  MIN_ANSWER_WORDS: num("REALTIME_MIN_ANSWER_WORDS", 3),
  /** How many times the examiner asks for more before accepting what it got. */
  MAX_CLARIFY: num("REALTIME_MAX_CLARIFY", 2),
  /** Unscripted Part 1 follow-ups per test, so the interview is a conversation. */
  MAX_FOLLOWUPS: num("REALTIME_MAX_FOLLOWUPS", 2),
  /** Chance that a good Part 1 answer earns a follow-up (while any are left). */
  FOLLOWUP_CHANCE: Number(process.env.REALTIME_FOLLOWUP_CHANCE) || 0.55,
};

const PROFILE_KEYS = new Set(["name", "city", "country", "job", "study", "family", "interest", "home", "other"]);

/** Details from earlier tests, as the browser loaded them from the database. */
function seedProfile(raw) {
  const out = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [key, value] of Object.entries(raw)) {
    if (!PROFILE_KEYS.has(key)) continue;
    const v = String(value ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
    if (v) out[key] = v;
  }
  return out;
}

const TOOLS = [
  {
    type: "function",
    name: "answer_received",
    description:
      "Call this the moment the candidate has genuinely finished speaking their answer to the current question. Never call it during silence.",
    parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
  },
  {
    type: "function",
    name: "remember_candidate_detail",
    description:
      "Record something the candidate has just told you about themselves so you still know it later in the test — their name, where they are from, their job or studies, their family, an interest. Only for things they actually said out loud. When the candidate tells you that you have a detail wrong (for example 'my name is not Robby, it's Ravi'), call this with the corrected value and correction set to true.",
    parameters: {
      type: "object",
      properties: {
        detail: {
          type: "string",
          enum: ["name", "city", "country", "job", "study", "family", "interest", "home", "other"],
          description: "Which kind of detail this is.",
        },
        value: {
          type: "string",
          description: "The detail exactly as the candidate gave it, e.g. 'Maria' or 'Lahore'.",
        },
        correction: {
          type: "boolean",
          description:
            "True when the candidate is correcting a detail you had wrong. The new value replaces the old one.",
        },
      },
      required: ["detail", "value"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "end_exam",
    description: "Call this only after you have delivered the final closing of the test.",
    parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
  },
];

/** Segment kinds where the candidate is expected to speak. */
const EXPECTS_ANSWER = new Set(["ask", "converse", "speak", "generated"]);

/**
 * Sounds a transcriber returns for a cough, a chair, or a filler noise. On their
 * own they are not an answer — accepting them is what makes the examiner move
 * on from a candidate who has not actually said anything.
 */
const FILLER_WORDS = new Set([
  "a", "ah", "aha", "ahem", "eh", "em", "er", "erm", "hm", "hmm", "huh", "mhm", "mm", "mmm",
  "oh", "uh", "uhm", "um", "umm", "the", "you", "know", "like", "so", "well", "okay", "ok",
  "yeah", "yes", "no", "nope", "yep", "hello", "hi", "hey", "sorry", "what", "pardon", "thanks",
  "thank",
]);

/** Words that are only noise once punctuation and case are stripped. */
function meaningfulWords(text) {
  return (text ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9'\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !FILLER_WORDS.has(w));
}

/**
 * How usable an answer is.
 *
 * `empty`/`filler` — nothing to assess, the candidate has effectively not
 * answered. `thin` — real words, but nowhere near what the question asked for.
 * `ok` — take it and move on.
 */
export function answerQuality(text, seg) {
  const words = meaningfulWords(text);
  if (!words.length) return (text ?? "").trim() ? "filler" : "empty";
  // Short scripted openers ("What's your name?") genuinely take two words to
  // answer; only the longer windows expect a developed response.
  const floor = (seg?.seconds ?? 0) >= 20 ? CONFIG.MIN_ANSWER_WORDS : 1;
  return words.length < floor ? "thin" : "ok";
}

const clean = (v) =>
  String(v ?? "")
    .replace(/["“”]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);

/**
 * Pull the candidate's name and home town out of their own words.
 *
 * The model is asked to record these itself, but it forgets under load and the
 * first two questions of every LanguageCert test are exactly these two — so the
 * bridge reads them off the transcript as well and keeps whichever arrives.
 */
export function extractProfile(question, answer) {
  const q = (question ?? "").toLowerCase();
  const a = (answer ?? "").trim();
  if (!a) return {};
  const found = {};

  // "What is your full name?" is the default opener — "your name" alone misses it.
  const asksName = /\byour (?:(?:full|first|given|whole) )?name\b|\bcall you\b|\bwho am i speaking\b/.test(q);
  const asksPlace = /where (are|do) you (from|live|come)|which (city|town|country)|whereabouts/.test(q);

  const NAME_LIKE = "([A-Za-z][A-Za-z'’-]{1,20}(?:\\s+[A-Za-z][A-Za-z'’-]{1,20})?)";
  // "My name is Ravi" says so outright. "I'm …" only means a name when the
  // question asked for one — otherwise it is "I'm from Lahore" or "I'm fine".
  const stated = a.match(
    new RegExp(
      `\\b(?:my (?:(?:full|first|whole) )?name(?:'s| is)|they call me|you can call me|call me|this is)\\s+${NAME_LIKE}`,
      "i",
    ),
  );
  const implied = a.match(new RegExp(`\\b(?:i am|i'm|im)\\s+${NAME_LIKE}`, "i"));
  const notAName = /^(?:from|in|at|a|an|the|not|very|really|fine|good|great|well|okay|sorry|here|ready|going|doing|working|living|studying|nervous|happy|glad)\b/i;

  // Transcription capitalises proper nouns, so a lower-case word after "my name
  // is" is the sentence running on ("my name is silly to pronounce"), not a name.
  const isName = (m) => m && /^[A-Z]/.test(m[1]) && !notAName.test(m[1]);

  if (isName(stated)) found.name = clean(stated[1]);
  else if (asksName && isName(implied)) found.name = clean(implied[1]);
  else if (asksName) {
    const words = a
      .replace(/^\s*(?:it's|it is|its|sure|okay|ok|yes|so|um|uh|er)[,.\s]+/i, "")
      .replace(/^\s*(?:it's|it is|its)\s+/i, "")
      .replace(/[^A-Za-z'’\s-]/g, " ")
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    // "Ravi" / "Ravi Kumar" — a bare name is the usual answer here.
    if (words.length && words.length <= 3) found.name = clean(words.slice(0, 3).join(" "));
  }

  const placed = a.match(
    /\b(?:i(?:'m| am)? (?:from|based in)|i live in|i'm living in|i come from|originally from|from)\s+([A-Za-z][A-Za-z'’.\s-]{1,30}?)(?:[,.!?]|\s+(?:and|but|which|it|that|i|we|so)\b|$)/i,
  );
  if (placed) found.city = clean(placed[1]);
  else if (asksPlace) {
    const words = a.replace(/[^A-Za-z'’\s-]/g, " ").trim().split(/\s+/).filter(Boolean);
    if (words.length && words.length <= 3) found.city = clean(words.slice(0, 2).join(" "));
  }

  // A name that is plainly a sentence fragment is worse than no name at all.
  if (found.name && /^(?:fine|good|well|okay|sorry|yes|no)$/i.test(found.name)) delete found.name;
  return found;
}

/** Words that say "you got that wrong". */
const CORRECTION_MARKERS =
  /\b(?:no|nope|not|isn't|isnt|wasn't|wrong|incorrect|actually|mistake|misheard|misunderstood|correct|sorry)\b/i;
const NOT_A_NAME_WORD =
  /^(?:from|in|at|a|an|the|not|no|very|really|fine|good|great|well|okay|ok|sorry|here|ready|going|doing|working|living|studying|nervous|happy|glad|wrong|correct|right|actually|just|called|my|name|it|is|and|but)$/i;

/** "Ravi Kumar and I" -> "Ravi Kumar": leading capitalised words only, as transcription writes names. */
function nameFrom(raw) {
  const words = String(raw ?? "")
    .replace(/[^A-Za-z'’\s-]/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const kept = [];
  for (const w of words) {
    if (!/^[A-Z]/.test(w) || NOT_A_NAME_WORD.test(w)) break;
    kept.push(w);
    if (kept.length === 3) break;
  }
  return kept.length ? clean(kept.join(" ")) : null;
}

function lastCapture(text, re) {
  let found = null;
  for (const m of text.matchAll(re)) found = m[1];
  return found;
}

const firstWord = (s) => String(s ?? "").trim().split(/\s+/)[0]?.toLowerCase() ?? "";
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The candidate telling the examiner it got their name or home town wrong.
 *
 * Speech recognition mishears names, and a candidate who is called the wrong
 * name for the rest of the test — and in every test after it — has no way to
 * fix it unless the examiner listens for exactly this. Only fires when the new
 * value really differs from what is stored.
 *
 * @param {string} text           what the candidate just said
 * @param {Record<string,string>} profile  what the examiner currently believes
 * @param {string} examinerLast   the examiner's previous line, for "No, it's Ravi"
 */
export function detectCorrection(text, profile, examinerLast = "") {
  const t = String(text ?? "").trim();
  const out = {};
  if (!t || !profile) return out;
  const marked = CORRECTION_MARKERS.test(t);

  if (profile.name) {
    const stored = firstWord(profile.name);
    const storedRe = new RegExp(`\\b${escapeRe(stored)}\\b`, "i");
    // "My name is Ravi" / "call me Ravi" state it outright, marker or not.
    const stated =
      lastCapture(t, /\b[Mm]y (?:(?:full|first|real|actual|correct) )?name(?:'s| is)\s+(?:actually\s+)?([A-Za-z][^,.!?]{0,40})/g) ??
      lastCapture(t, /\b(?:[Yy]ou can call me|[Cc]all me|[Ii]t's pronounced|[Ii]t is pronounced)\s+([A-Za-z][^,.!?]{0,40})/g);
    // "No, it's Ravi" / "not Robby, Ravi" only count when it is clearly about
    // the name: the word "name", the wrong name itself, or a short reply
    // straight after the examiner used it. "No, I'm Pakistani" is none of those.
    const mentionsName = /\bname\b/i.test(t);
    const shortReplyToName =
      Boolean(examinerLast && storedRe.test(examinerLast)) &&
      t.split(/\s+/).length <= 6 &&
      /^\W*(?:no|nope|sorry|actually|not)\b/i.test(t);
    const aboutName = mentionsName || storedRe.test(t) || shortReplyToName;
    const verb = mentionsName ? "[Ii]t's|[Ii]t is|[Ii]ts|[Ii]'m|[Ii] am|is" : "[Ii]t's|[Ii]t is|[Ii]ts|[Ii]'m|[Ii] am";
    const implied =
      marked && aboutName
        ? (lastCapture(t, /\bnot\s+[A-Za-z'’-]+,?\s+(?:but\s+|it's\s+|it is\s+)?([A-Z][A-Za-z'’-]+(?:\s+[A-Z][A-Za-z'’-]+)?)/g) ??
          lastCapture(t, new RegExp(`\\b(?:${verb})\\s+([A-Z][A-Za-z'’-]+(?:\\s+[A-Z][A-Za-z'’-]+)?)`, "g")))
        : null;
    const candidate = nameFrom(stated) ?? nameFrom(implied);
    if (candidate && firstWord(candidate) !== stored) out.name = candidate;
  }

  const place = profile.city || profile.country;
  if (place && marked) {
    const aboutPlace =
      /\b(?:live|living|from|city|town|country|based)\b/i.test(t) || t.toLowerCase().includes(place.toLowerCase());
    const said = aboutPlace
      ? lastCapture(
          t,
          /\b(?:[Ll]ive in|[Ll]iving in|[Ff]rom|[Bb]ased in|[Ii]t's|[Ii]t is)\s+([A-Z][A-Za-z'’.-]+(?:\s+[A-Z][A-Za-z'’.-]+)?)/g,
        )
      : null;
    const city = said ? clean(said.replace(/[.\s]+$/, "")) : null;
    if (city && city.toLowerCase() !== place.toLowerCase() && !NOT_A_NAME_WORD.test(city)) out.city = city;
  }

  return out;
}

let counter = 0;
const newSessionId = () =>
  `rt-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}-${(++counter).toString().padStart(3, "0")}`;

export class ExaminerSession {
  constructor(clientWs, apiKey) {
    this.client = clientWs;
    this.apiKey = apiKey;
    this.sessionId = newSessionId();

    this.upstream = null;
    this.record = null;
    this.exam = null;
    this.segments = [];

    this.index = -1;
    this.phase = "idle";
    this.startedAt = 0;
    this.ended = false;
    this.endReason = null;
    this.closingSent = false;

    this.responseActive = false;
    this.pendingDirective = null;

    /** True only once real speech has been transcribed for this segment. */
    this.answered = false;
    /** VAD heard actual audio for this segment — transcript may still be in flight. */
    this.heardSpeech = false;
    /** Model signalled an answer while its transcript was still arriving. */
    this.pendingAdvance = false;
    this.windowStarted = false;
    this.windowStartedAt = 0;
    this.nudges = 0;
    /** Set during preparation time: no nudges, no upstream audio. */
    this.preparing = false;
    this.candidateSpokeEver = false;
    /** VAD currently has an open turn — the candidate is mid-sentence. */
    this.candidateSpeaking = false;
    /**
     * Mic gate. Closed whenever the examiner is speaking or its audio is still
     * playing in the browser, so speaker echo and room noise cannot open a turn
     * and cut the question in half.
     */
    this.micOpen = false;
    /** Pieces of the current answer, joined once the candidate really stops. */
    this.answerParts = [];
    /** How many times we have asked for more on this segment. */
    this.clarifies = 0;
    /** Speech that came back untranscribable on this segment. */
    this.unclears = 0;
    /** Everything the candidate has told us about themselves, for continuity. */
    this.profile = {};
    /** The candidate was known from an earlier test — welcome back, never re-ask. */
    this.returning = false;
    /** Unscripted Part 1 follow-ups asked so far this test. */
    this.followups = 0;
    /** The current segment already had its follow-up; the next answer moves on. */
    this.followupAsked = false;
    /** A detail the candidate just corrected, still to be acknowledged aloud. */
    this.correctionCue = null;
    /** The candidate corrected something during the segment in progress. */
    this.correctedThisSegment = false;
    /** The examiner's last line, so "No, it's Ravi" can be read against it. */
    this.lastExaminerText = "";
    /** The examiner has addressed the candidate by name at least once. */
    this.nameSaid = false;
    /** Examiner turns since it last said the candidate's name. */
    this.turnsSinceName = Infinity;
    /** Their last answer, restated to the model so it can react to it. */
    this.lastAnswer = "";
    /** Mic chunks received since the gate last opened — 0 means nothing is arriving. */
    this.audioSinceOpen = 0;
    /** When the candidate's pause is long enough to count as the end of a turn. */
    this.settleDeadline = 0;

    this.examinerBuf = "";
    /**
     * When the browser's playback queue will run dry, tracked the same way the
     * browser schedules it. Audio queues across responses, so a short question
     * generated behind a long introduction is not heard until the intro ends.
     */
    this.playbackEndsAt = 0;
    /** Set while waiting for the browser to finish playing the examiner. */
    this.awaitingPlayback = false;
    this.timers = new Map();
  }

  // ---------------------------------------------------------------- timers

  setTimer(name, ms, fn) {
    this.clearTimer(name);
    this.timers.set(
      name,
      setTimeout(() => {
        this.timers.delete(name);
        if (!this.ended) fn();
      }, ms),
    );
  }

  clearTimer(name) {
    const t = this.timers.get(name);
    if (t) {
      clearTimeout(t);
      this.timers.delete(name);
    }
  }

  clearSegmentTimers() {
    for (const n of [
      "silence",
      "finalGrace",
      "answerCap",
      "stall",
      "prepare",
      "window",
      "postAnswer",
      "awaitTranscript",
      "transcriptWait",
      "answerSettle",
      "speechTail",
      "micOpen",
      "micGuard",
    ]) {
      this.clearTimer(n);
    }
    this.awaitingPlayback = false;
  }

  clearAllTimers() {
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
  }

  // ------------------------------------------------------------ client i/o

  send(obj) {
    if (this.client.readyState === WebSocket.OPEN) this.client.send(JSON.stringify(obj));
  }

  sendAudio(buf) {
    if (this.client.readyState === WebSocket.OPEN) this.client.send(buf, { binary: true });
  }

  get current() {
    return this.segments[this.index] ?? null;
  }

  /** Progress counts only segments the candidate actually speaks for. */
  progressPercent() {
    const spoken = this.segments.filter((s) => s.kind !== "say");
    if (!spoken.length) return 0;
    const doneCount = spoken.filter((s) => s._done).length;
    return Math.round((doneCount / spoken.length) * 100);
  }

  emitState(phase) {
    if (phase) this.phase = phase;
    const seg = this.current;
    const elapsedMs = this.startedAt ? Date.now() - this.startedAt : 0;
    this.send({
      t: "state",
      phase: this.phase,
      segmentIndex: this.index,
      segmentTotal: this.segments.length,
      progress: this.progressPercent(),
      part: seg?.part ?? 0,
      label: seg?.label ?? "",
      kind: seg?.kind ?? null,
      imageUrl: seg?.imageUrl ?? null,
      elapsedMs,
      remainingMs: Math.max(0, CONFIG.MAX_EXAM_MS - elapsedMs),
    });
  }

  fail(message) {
    console.error(`[${this.sessionId}] ${message}`);
    this.send({ t: "error", message });
  }

  // ---------------------------------------------------------------- start

  async start(exam) {
    if (this.upstream) return;

    this.exam = exam;
    this.segments = (exam.segments ?? []).map((s) => ({
      id: String(s.id ?? ""),
      kind: String(s.kind ?? "say"),
      part: Number(s.part) || 0,
      text: String(s.text ?? ""),
      seconds: Number(s.seconds) || 0,
      label: String(s.label ?? ""),
      context: s.context ? String(s.context) : "",
      imageUrl: s.imageUrl ?? null,
      generatedIndex: Number(s.generatedIndex) || 0,
      generatedTotal: Number(s.generatedTotal) || 0,
      _done: false,
    }));

    if (!this.segments.length) {
      this.fail("This speaking set has no content yet. Add the questions in the admin Speaking section first.");
      this.closeClient(1011, "empty exam");
      return;
    }

    this.record = new SessionRecord(this.sessionId, {
      setId: exam.setId ?? null,
      setTitle: exam.setTitle ?? null,
      level: exam.level ?? null,
      attemptId: exam.attemptId ?? null,
      userId: exam.userId ?? null,
      model: CONFIG.MODEL,
      voice: CONFIG.VOICE,
    });
    this.record.setQuestions(
      this.segments.map((s) => ({ text: s.text || s.label, seconds: s.seconds, kind: s.kind, part: s.part })),
    );

    // What earlier tests taught us. The examiner starts this one already
    // knowing it, so it greets them back and never asks for it again.
    this.profile = seedProfile(exam.candidateProfile);
    this.returning = Boolean(this.profile.name);
    if (Object.keys(this.profile).length) {
      this.record.setProfile?.(this.profile);
      this.send({ t: "profile", profile: { ...this.profile } });
      console.log(`[${this.sessionId}] returning candidate:`, this.profile);
    }

    this.startedAt = Date.now();
    this.emitState("connecting");

    const url = `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(CONFIG.MODEL)}`;
    this.upstream = new WebSocket(url, { headers: { Authorization: `Bearer ${this.apiKey}` } });

    this.upstream.on("open", () => this.configureSession());
    this.upstream.on("message", (raw) => this.onUpstream(raw));
    this.upstream.on("error", (err) => {
      this.fail(`Realtime connection error: ${err.message}`);
      void this.end("upstream_error");
    });
    this.upstream.on("close", (code) => {
      if (!this.ended) {
        this.fail(`Realtime connection closed (${code}).`);
        void this.end("upstream_closed");
      }
    });

    this.setTimer("maxExam", CONFIG.MAX_EXAM_MS, () => {
      console.log(`[${this.sessionId}] exam time limit reached`);
      this.beginClosing("time_limit");
    });
    this.setTimer("hardKill", CONFIG.HARD_KILL_MS, () => {
      console.warn(`[${this.sessionId}] hard kill`);
      void this.end("hard_kill");
    });
  }

  configureSession() {
    const totalSeconds = this.segments.reduce((sum, s) => sum + s.seconds, 0);
    this.up({
      type: "session.update",
      session: {
        type: "realtime",
        output_modalities: ["audio"],
        instructions: buildExaminerInstructions({
          examName: this.exam.examName,
          level: this.exam.level,
          totalMinutes: Math.round((totalSeconds + this.segments.length * 7) / 60),
        }),
        tools: TOOLS,
        tool_choice: "auto",
        audio: {
          input: {
            format: { type: "audio/pcm", rate: 24000 },
            transcription: { model: CONFIG.TRANSCRIBE_MODEL, language: "en" },
            noise_reduction: { type: "near_field" },
            turn_detection: {
              type: "server_vad",
              threshold: CONFIG.VAD_THRESHOLD,
              prefix_padding_ms: 300,
              silence_duration_ms: CONFIG.VAD_SILENCE_MS,
              // Silence policy lives in this bridge so the nudge wording and the
              // three-strike rule stay under our control.
              idle_timeout_ms: null,
              // The examiner speaks only when the bridge tells it to. Letting VAD
              // auto-create responses makes the model invent unscripted questions
              // the moment the candidate stops talking.
              create_response: false,
              // Never let detected audio cancel the examiner mid-question. The
              // mic is shut while the examiner talks, so anything VAD picks up
              // then is echo or room noise — and cutting the question off is
              // exactly what the candidate experiences as "it keeps stopping".
              interrupt_response: false,
            },
          },
          output: { format: { type: "audio/pcm", rate: 24000 }, voice: CONFIG.VOICE, speed: 1.0 },
        },
      },
    });
  }

  up(obj) {
    if (this.upstream?.readyState === WebSocket.OPEN) this.upstream.send(JSON.stringify(obj));
  }

  /**
   * Mic audio from the browser.
   *
   * Dropped whenever it is not genuinely the candidate's turn — while the
   * examiner is speaking, while its audio is still playing out of the speakers,
   * and during silent preparation time. The browser mutes at the same moments;
   * this is the half that cannot be bypassed by a stale message.
   */
  pushAudio(buf) {
    if (this.ended || this.preparing || !this.micOpen) return;
    if (this.upstream?.readyState !== WebSocket.OPEN) return;
    this.audioSinceOpen += 1;
    this.record?.countAudio(buf.length, 0);
    this.up({ type: "input_audio_buffer.append", audio: buf.toString("base64") });
  }

  /**
   * Open or close the candidate's microphone.
   *
   * Closing tells the browser to stop capturing at source. Opening first throws
   * away whatever the upstream buffer collected while the gate was shut, so a
   * scrap of the examiner's own voice can never be transcribed as an answer.
   */
  setMicOpen(open, why = "") {
    // Belt and braces: a lost "playback drained" must never leave a candidate
    // talking into a dead microphone for the rest of the test. Re-armed on
    // every close, including the ones that change nothing.
    if (!open) this.armMicGuard();
    if (this.micOpen === open) return;
    this.micOpen = open;

    if (open) {
      this.clearTimer("micGuard");
      this.audioSinceOpen = 0;
      this.up({ type: "input_audio_buffer.clear" });
    } else {
      this.candidateSpeaking = false;
    }

    this.send({ t: "mic", open });
    if (process.env.REALTIME_DEBUG) {
      console.log(`[${this.sessionId}] mic ${open ? "open" : "closed"}${why ? ` (${why})` : ""}`);
    }
  }

  armMicGuard() {
    this.setTimer("micGuard", 60_000, () => {
      if (this.ended || this.preparing || this.responseActive || this.micOpen) return;
      console.warn(`[${this.sessionId}] mic gate stuck shut — reopening`);
      this.setMicOpen(true, "guard");
    });
  }

  // ----------------------------------------------------- response plumbing

  /**
   * How the candidate's name should be used on a turn of this kind.
   * `moment`: part_start | question | check | closing | roleplay | other.
   */
  nameMode(moment) {
    if (!this.profile.name || moment === "roleplay") return null;
    if (!this.nameSaid) return this.returning ? "returning" : "first";
    if (this.turnsSinceName < 2) return moment === "closing" ? "must" : "avoid";
    if (moment === "part_start" || moment === "check" || moment === "closing") return "must";
    if (moment === "question" && this.turnsSinceName >= 5) return "must";
    return "optional";
  }

  /** Facts about this candidate, restated so a long call cannot lose them. */
  withMemory(directive, moment = "other") {
    const block = memoryBlock(this.profile, this.lastAnswer);

    // A fresh correction outranks every other name cue: apologise once, use
    // the right value, and do not also run the usual greeting.
    const fix = this.correctionCue;
    if (fix) {
      this.correctionCue = null;
      if (fix.key === "name") {
        this.nameSaid = true;
        this.turnsSinceName = 0;
      }
      return [block, directive, correctionCue(fix)].filter(Boolean).join("\n\n");
    }

    const mode = this.nameMode(moment);
    // One chance at the "nice to meet you": if the transcript spells the name
    // differently, the examiner must not greet them again on every turn.
    if (mode === "first" || mode === "returning") this.nameSaid = true;
    // The cue goes last so it is the freshest thing the model reads.
    const cue = mode ? nameCue(this.profile.name, mode) : "";
    return [block, directive, cue].filter(Boolean).join("\n\n");
  }

  /** Track whether the examiner actually said the name, so it is not overused. */
  noteExaminerTurn(text) {
    const first = firstName(this.profile.name);
    if (!first) return;
    const escaped = first.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`\\b${escaped}\\b`, "i").test(text)) {
      this.nameSaid = true;
      this.turnsSinceName = 0;
    } else if (this.nameSaid) {
      this.turnsSinceName = Number.isFinite(this.turnsSinceName) ? this.turnsSinceName + 1 : 1;
    }
  }

  /**
   * @param {string} directive
   * @param {string} [tag]
   * @param {{ urgent?: boolean, moment?: string }} [opts] `urgent` speaks over
   *   the candidate — only for the deliberate interruptions (time up, closing
   *   the test). `moment` decides whether the candidate's name is used.
   */
  speak(directive, tag, opts = {}) {
    if (this.ended) return;
    // Never talk over an answer in progress. The examiner waits for the
    // candidate to finish, exactly as a real one would.
    if (this.responseActive || (this.candidateSpeaking && !opts.urgent)) {
      this.pendingDirective = { directive, tag, opts };
      return;
    }
    this.responseActive = true;
    this.setMicOpen(false, "examiner speaking");
    this.up({
      type: "conversation.item.create",
      item: {
        type: "message",
        role: "system",
        content: [{ type: "input_text", text: this.withMemory(directive, opts.moment) }],
      },
    });
    this.up({ type: "response.create" });
    if (tag) console.log(`[${this.sessionId}] -> ${tag}`);
  }

  flushPending() {
    const next = this.pendingDirective;
    this.pendingDirective = null;
    if (next) this.speak(next.directive, next.tag, next.opts ?? {});
    return Boolean(next);
  }

  // -------------------------------------------------------- script control

  advance(reason = "auto") {
    if (this.ended || this.closingSent) return;
    this.clearSegmentTimers();

    const prev = this.current;
    if (prev) {
      prev._done = true;
      if (EXPECTS_ANSWER.has(prev.kind)) {
        this.record.markQuestion(this.index, {
          status: this.answered ? "answered" : "skipped",
          answeredAt: new Date().toISOString(),
          nudges: this.nudges,
        });
      } else {
        this.record.markQuestion(this.index, { status: "delivered" });
      }
    }

    const next = this.index + 1;
    if (next >= this.segments.length) {
      this.beginClosing("completed");
      return;
    }

    // Any directive queued for the segment that just ended is stale now.
    this.advanceTo(next, reason);
  }

  runSegment(reason) {
    const seg = this.current;
    if (!seg) return;

    if (process.env.REALTIME_DEBUG) {
      console.log(`[${this.sessionId}] segment ${this.index + 1}/${this.segments.length} ${seg.kind} (${reason})`);
    }

    this.record.markQuestion(this.index, { status: "asked", askedAt: new Date().toISOString() });
    this.send({
      t: "segment",
      index: this.index,
      total: this.segments.length,
      kind: seg.kind,
      part: seg.part,
      label: seg.label,
      text: seg.text,
      seconds: seg.seconds,
      imageUrl: seg.imageUrl ?? null,
      progress: this.progressPercent(),
    });

    switch (seg.kind) {
      case "say":
        this.emitState("examiner");
        this.speak(sayDirective(seg.text), `say: ${seg.label}`, {
          // A new part is where a real examiner turns to the candidate by name.
          moment: seg.part > 0 && /introduction|transition|next situation/i.test(seg.label) ? "part_start" : "other",
        });
        break;

      case "ask": {
        this.emitState("asking");
        const prev = this.segments[this.index - 1];
        const acknowledge = Boolean(prev && EXPECTS_ANSWER.has(prev.kind));
        this.speak(askDirective(seg.text, acknowledge), `ask: ${seg.label}`, { moment: "question" });
        break;
      }

      case "converse":
        this.emitState("asking");
        this.speak(converseDirective(seg.text, seg.seconds), `converse: ${seg.label}`, { moment: "roleplay" });
        break;

      case "prepare":
        this.preparing = true;
        this.emitState("preparing");
        this.speak(prepareDirective(seg.text, seg.seconds), `prepare ${seg.seconds}s: ${seg.label}`);
        break;

      case "speak":
        this.emitState("asking");
        this.speak(speakDirective(seg.text, seg.seconds, seg.context), `speak: ${seg.label}`);
        break;

      case "generated":
        this.emitState("asking");
        this.speak(
          generatedDirective(seg.context, seg.generatedIndex, seg.generatedTotal, seg.part),
          `generated q${seg.generatedIndex}/${seg.generatedTotal}: ${seg.label}`,
          { moment: "question" },
        );
        break;

      default:
        this.advance("unknown_kind");
        break;
    }
  }

  /**
   * Milliseconds of examiner audio the browser has probably not played yet.
   *
   * `response.done` fires when the model finishes GENERATING, which is several
   * seconds before the candidate finishes HEARING the question — generation
   * runs faster than real time. Starting the silence countdown there makes the
   * examiner interrupt its own question with "Are you there?".
   */
  playbackRemainingMs() {
    if (!this.playbackEndsAt) return 0;
    return Math.max(0, this.playbackEndsAt + 400 - Date.now()); // + client jitter buffer
  }

  /**
   * The examiner has stopped generating. Wait until the candidate has actually
   * heard it before doing anything that assumes it is their turn.
   */
  onExaminerFinishedSpeaking() {
    if (this.ended || this.closingSent) return;
    const seg = this.current;
    if (!seg) return;

    // A line with no answer expected can move straight on; the browser queues
    // the audio in order, so nothing overlaps.
    if (seg.kind === "say") {
      this.advance("said");
      return;
    }

    const remaining = this.playbackRemainingMs();
    if (remaining > 0) {
      this.awaitingPlayback = true;
      this.emitState("examiner");
      // The browser confirms when its queue drains; this is the backstop.
      this.setTimer("speechTail", remaining + 1_500, () => this.onExaminerAudioHeard());
      return;
    }
    this.onExaminerAudioHeard();
  }

  /** The browser's playback queue drained — authoritative end of examiner speech. */
  onPlaybackDrained() {
    if (!this.awaitingPlayback) return;
    if (this.responseActive) return; // more audio is already on its way
    this.onExaminerAudioHeard();
  }

  /** The candidate has now heard the whole question. Their turn really starts. */
  onExaminerAudioHeard() {
    this.awaitingPlayback = false;
    this.clearTimer("speechTail");
    if (this.ended || this.closingSent) return;
    const seg = this.current;
    if (!seg || seg.kind === "say") return;

    // The examiner has finished and the speakers are quiet. Give the room a
    // moment to settle, then hand the microphone back.
    if (seg.kind !== "prepare" && !this.responseActive) {
      this.setTimer("micOpen", CONFIG.MIC_REOPEN_MS, () => {
        if (this.ended || this.preparing || this.responseActive) return;
        this.setMicOpen(true, "candidate's turn");
      });
    }

    if (seg.kind === "prepare") {
      // Silent thinking time. No nudges, no upstream audio, no interruptions —
      // the candidate is not supposed to be speaking yet.
      this.emitState("preparing");
      this.send({ t: "prepare", seconds: seg.seconds, label: seg.label, imageUrl: seg.imageUrl ?? null });
      this.setTimer("prepare", seg.seconds * 1000, () => {
        this.preparing = false;
        // Drop anything the mic captured while they were thinking.
        this.up({ type: "input_audio_buffer.clear" });
        this.advance("prepare_over");
      });
      return;
    }

    this.emitState("listening");

    // A role play is a conversation, not a single answer: let the examiner and
    // the candidate go back and forth for the whole window.
    if (seg.kind === "converse") {
      if (!this.windowStarted) {
        this.windowStarted = true;
        this.windowStartedAt = Date.now();
        this.setTimer("window", seg.seconds * 1000, () => this.advance("window_over"));
      }
      // Silence in a role play gets the same "please answer" as anywhere else;
      // the final-grace check refuses to end a test the candidate has been
      // talking in, so this can only prompt, never abandon them.
      this.armSilenceLadder();
      return;
    }

    if (this.answered) {
      // Candidate already answered and the examiner just acknowledged. If it
      // forgets to signal, move the script on ourselves.
      this.setTimer("stall", CONFIG.STALL_MS, () => this.advance("stall"));
      return;
    }

    this.armSilenceLadder();
  }

  armSilenceLadder() {
    if (this.nudges >= CONFIG.MAX_NUDGES) {
      this.setTimer("finalGrace", CONFIG.FINAL_GRACE_MS, () => {
        if (this.answered) return;
        console.log(`[${this.sessionId}] no response after ${CONFIG.MAX_NUDGES} checks — ending test`);
        this.beginClosing("no_response");
      });
      return;
    }
    this.setTimer("silence", CONFIG.NUDGE_MS, () => this.onSilence());
  }

  onSilence() {
    if (this.ended || this.closingSent || this.preparing) return;
    const seg = this.current;
    if (!seg) return;
    // A role play stays open after an answer, so silence inside it still needs
    // prompting; anywhere else an answered segment is simply waiting to move on.
    if (this.answered && seg.kind !== "converse") return;

    // They did answer, it was just brief, and the examiner has already asked
    // for more. Silence now means that is all they have — take it and move on.
    // Nudging on towards "no response" would end a test they are sitting.
    if (this.answerParts.length) {
      console.log(`[${this.sessionId}] short answer, nothing added — accepting it`);
      this.answered = true;
      this.advance("short_answer_accepted");
      return;
    }

    // Silence with no audio arriving at all is not a quiet candidate: the
    // browser is not sending, so no amount of talking will ever be heard. Say
    // so plainly in the log and on screen rather than blaming the candidate.
    const micSilent = this.audioSinceOpen === 0;
    if (micSilent) {
      console.warn(
        `[${this.sessionId}] no microphone audio has reached the bridge since the gate opened — ` +
          `check the browser tab's mic permission, and that this bridge is the one the page is talking to`,
      );
    }

    this.nudges += 1;
    this.record.markQuestion(this.index, { nudges: this.nudges });
    this.send({ t: "nudge", level: this.nudges, max: CONFIG.MAX_NUDGES, index: this.index, micSilent });
    this.emitState(this.nudges >= CONFIG.MAX_NUDGES ? "no_response" : "nudging");

    const questionText = seg.kind === "ask" ? seg.text : "";
    this.speak(nudgeDirective(this.nudges, questionText), `nudge ${this.nudges}/${CONFIG.MAX_NUDGES}`, {
      moment: "check",
    });

    // Fallback in case that response never completes and re-arms the ladder.
    this.setTimer("silence", CONFIG.NUDGE_MS * 2 + 15_000, () => this.onSilence());
  }

  /**
   * The candidate has genuinely finished this answer.
   *
   * Only reached once they have stopped speaking long enough that the pause is
   * not a thinking pause, so nothing here can talk over them.
   */
  onAnswerComplete() {
    if (this.ended || this.closingSent) return;
    if (this.candidateSpeaking) return; // still going; the next transcript re-arms this
    const seg = this.current;
    if (!seg) return;

    // The pause outlasted the settle window but the transcript is still in
    // flight. Nothing can be judged yet — the transcript handler calls back the
    // moment it lands, and `transcriptWait` covers one that never does.
    if (!this.answerParts.length && this.heardSpeech && this.timers.has("transcriptWait")) return;

    // A role play is a conversation: reply in character every time they speak
    // and keep it going until the window closes, rather than treating the first
    // turn as the answer and falling silent.
    if (seg.kind === "converse") {
      this.answered = true;
      this.answerParts = [];
      const elapsed = this.windowStartedAt ? Date.now() - this.windowStartedAt : 0;
      const left = Math.max(0, Math.round((seg.seconds * 1000 - elapsed) / 1000));
      if (left > 4) {
        this.speak(converseContinueDirective(seg.text, left), `role play reply (${left}s left)`, {
          moment: "roleplay",
        });
      }
      return;
    }

    if (this.answered) return;

    const text = this.answerParts.join(" ").trim();
    const quality = answerQuality(text, seg);

    // They spent this turn putting us right ("No, my name is Ravi, not
    // Robby"). That is not an answer to the question — unless the question was
    // the one asking for that detail. Apologise, then ask it again.
    if (this.correctedThisSegment) {
      this.correctedThisSegment = false;
      const askedForIt = /\byour (?:full |first )?name\b|where (?:are|do) you (?:from|live|come)|which (?:city|town|country)/i.test(
        seg.text,
      );
      const alsoAnswered = meaningfulWords(text).length >= 14;
      if (!askedForIt && !alsoAnswered && (seg.kind === "ask" || seg.kind === "generated")) {
        this.answerParts = [];
        this.clearTimer("answerCap");
        this.emitState("asking");
        this.speak(correctionAckDirective(seg.kind === "ask" ? seg.text : ""), "acknowledge correction", {
          moment: "question",
        });
        return;
      }
      if (askedForIt) {
        this.answered = true;
        this.advance("answered_with_correction");
        return;
      }
    }

    if (quality === "ok" && this.shouldFollowUp(seg)) {
      // A real examiner picks up on what they hear. One short question drawn
      // from this answer; whatever comes back joins the same answer, and the
      // next pause moves the test on.
      this.followups += 1;
      this.followupAsked = true;
      this.clearTimer("answerCap");
      console.log(`[${this.sessionId}] follow-up ${this.followups}/${CONFIG.MAX_FOLLOWUPS} on ${seg.label}`);
      this.emitState("asking");
      this.speak(followupDirective(this.lastAnswer), `follow-up ${this.followups}`, { moment: "question" });
      return;
    }

    if (quality === "ok" || this.clarifies >= CONFIG.MAX_CLARIFY) {
      this.answered = true;
      this.advance(quality === "ok" ? "answered" : "answered_short");
      return;
    }

    // Too short or nothing but a filler sound. A real examiner asks for more
    // instead of quietly moving on, so that is what happens here — the segment
    // stays open and whatever they add joins the same answer.
    this.clarifies += 1;
    console.log(`[${this.sessionId}] answer too thin (${quality}) — asking for more ${this.clarifies}/${CONFIG.MAX_CLARIFY}`);
    this.send({ t: "clarify", reason: quality, level: this.clarifies, max: CONFIG.MAX_CLARIFY, index: this.index });
    this.emitState("nudging");
    this.speak(
      clarifyDirective("thin", seg.kind === "ask" ? seg.text : "", this.clarifies),
      `ask for more ${this.clarifies}/${CONFIG.MAX_CLARIFY}`,
    );
  }

  /** Whether this Part 1 answer gets an unscripted follow-up question. */
  shouldFollowUp(seg) {
    if (seg.part !== 1 || (seg.kind !== "ask" && seg.kind !== "generated")) return false;
    if (this.followupAsked || this.followups >= CONFIG.MAX_FOLLOWUPS) return false;
    // Name and home town are facts, not conversation starters.
    if (/\byour (?:full |first )?name\b|where (?:are|do) you (?:from|live|come)/i.test(seg.text)) return false;
    // Never at the cost of the later parts.
    const elapsed = this.startedAt ? Date.now() - this.startedAt : 0;
    if (elapsed > CONFIG.MAX_EXAM_MS * 0.35) return false;
    return Math.random() < CONFIG.FOLLOWUP_CHANCE;
  }

  /**
   * The candidate asked to skip the rest of this part. Everything left in it is
   * marked skipped and the examiner goes straight to the next part — or closes
   * the test when this was the last one.
   */
  skipPart() {
    if (this.ended || this.closingSent || !this.segments.length) return;
    const cur = this.current;
    // The introduction (part 0) belongs to Part 1.
    const part = Math.max(1, cur?.part ?? 1);
    let next = this.segments.findIndex((s, i) => i > this.index && s.part > part);
    // The final goodbye is part 0 — it is the closing, not a part to jump to.
    if (next >= 0 && this.segments[next].part === 0) next = -1;

    console.log(`[${this.sessionId}] candidate skipped part ${part}`);

    // Stop the examiner mid-sentence; the browser has already dropped its queue.
    if (this.responseActive) this.up({ type: "response.cancel" });
    this.send({ t: "audio.clear" });
    this.playbackEndsAt = 0;
    this.candidateSpeaking = false;
    this.pendingDirective = null;
    this.preparing = false;

    if (next < 0) {
      this.beginClosing("candidate_stopped");
      return;
    }

    // Close the segment in progress, then mark everything between as skipped.
    this.clearSegmentTimers();
    this.finalizeCurrent();
    for (let i = this.index + 1; i < next; i++) {
      const s = this.segments[i];
      s._done = true;
      this.record.markQuestion(i, { status: EXPECTS_ANSWER.has(s.kind) ? "skipped" : "delivered" });
    }
    this.advanceTo(next, "skipped_part");
  }

  /** Run segment `next` with fresh per-segment state. */
  advanceTo(next, reason) {
    this.index = next;
    this.answered = false;
    this.heardSpeech = false;
    this.pendingAdvance = false;
    this.windowStarted = false;
    this.windowStartedAt = 0;
    this.nudges = 0;
    this.preparing = false;
    this.answerParts = [];
    this.clarifies = 0;
    this.unclears = 0;
    this.settleDeadline = 0;
    this.followupAsked = false;
    this.correctedThisSegment = false;
    this.pendingDirective = null;
    this.runSegment(reason);
  }

  /** Real speech, but nothing came back that can be assessed. */
  onUnintelligible() {
    if (this.ended || this.closingSent || this.answered) return;
    const seg = this.current;
    if (!seg) return;

    this.heardSpeech = false;
    this.answerParts = [];

    if (this.unclears >= CONFIG.MAX_CLARIFY) {
      this.answered = true;
      this.advance("speech_without_transcript");
      return;
    }

    this.unclears += 1;
    this.send({ t: "clarify", reason: "unclear", level: this.unclears, max: CONFIG.MAX_CLARIFY, index: this.index });
    this.emitState("nudging");
    this.speak(
      clarifyDirective("unclear", seg.kind === "ask" ? seg.text : "", this.unclears),
      `could not hear ${this.unclears}/${CONFIG.MAX_CLARIFY}`,
    );
  }

  // ------------------------------------------------------ candidate memory

  /** Read the standard opening answers off the transcript ourselves. */
  rememberFromAnswer(text) {
    this.remember(extractProfile(this.current?.text ?? "", text), "heard");
    const fixes = detectCorrection(text, this.profile, this.lastExaminerText);
    if (Object.keys(fixes).length) this.correct(fixes, "heard");
  }

  /**
   * The candidate says we have something wrong. Unlike `remember`, this
   * replaces identity details too — and the browser saves the new value, so
   * the next question uses it as well.
   */
  correct(details, source) {
    let changed = false;
    for (const [key, raw] of Object.entries(details ?? {})) {
      const value = clean(raw);
      if (!value || this.profile[key] === value) continue;
      const old = this.profile[key] ?? "";
      this.profile[key] = value;
      // The examiner acknowledges the most recent correction.
      this.correctionCue = { key, old, value };
      changed = true;
    }
    if (!changed) return;
    this.correctedThisSegment = true;
    console.log(`[${this.sessionId}] corrected (${source}):`, this.profile);
    this.record?.setProfile?.(this.profile);
    this.send({ t: "profile", profile: { ...this.profile }, corrected: Object.keys(details) });
  }

  /**
   * Keep what the candidate told us. First answer wins for the identity
   * details — once they have said their name, nothing later may quietly
   * rename them.
   */
  remember(details, source) {
    const sticky = new Set(["name", "city", "country"]);
    let changed = false;

    for (const [key, raw] of Object.entries(details ?? {})) {
      const value = clean(raw);
      if (!value) continue;
      if (this.profile[key] === value) continue;
      if (this.profile[key] && sticky.has(key)) continue;
      this.profile[key] = value;
      changed = true;
    }

    if (!changed) return;
    console.log(`[${this.sessionId}] remembered (${source}):`, this.profile);
    this.record?.setProfile?.(this.profile);
    this.send({ t: "profile", profile: { ...this.profile } });
  }

  /** Records how the segment in progress ended, exactly once. */
  finalizeCurrent() {
    const seg = this.current;
    if (!seg || seg._done || !this.record) return;
    seg._done = true;
    this.record.markQuestion(this.index, {
      // Words already heard count, even when the part was cut short mid-answer.
      status: EXPECTS_ANSWER.has(seg.kind)
        ? this.answered || this.answerParts.length
          ? "answered"
          : "skipped"
        : "delivered",
      answeredAt: new Date().toISOString(),
      nudges: this.nudges,
    });
  }

  beginClosing(reason) {
    if (this.closingSent) return;
    this.closingSent = true;
    this.endReason = reason;
    this.clearSegmentTimers();
    this.preparing = false;

    this.finalizeCurrent();
    this.emitState("closing");

    const ending = this.segments[this.segments.length - 1]?.text ?? "Thank you. This is the end of the test.";
    this.speak(closingDirective(reason, ending), `closing (${reason})`, { urgent: true, moment: "closing" });
    this.setTimer("closeGuard", 25_000, () => void this.end(reason));
  }

  // ------------------------------------------------------- upstream events

  onUpstream(raw) {
    let ev;
    try {
      ev = JSON.parse(raw.toString());
    } catch {
      return;
    }

    switch (ev.type) {
      case "session.updated": {
        this.send({ t: "ready", sessionId: this.sessionId, total: this.segments.length });
        // Tell the browser straight away that this bridge drives the mic gate.
        // Without a first frame it cannot tell a bridge that keeps the gate shut
        // from an older one that never sends frames at all, and it would rather
        // listen to the room than leave the candidate muted all test.
        this.send({ t: "mic", open: false });
        this.advance("start");
        break;
      }

      case "error": {
        const msg = ev.error?.message ?? "Realtime API error";
        console.error(`[${this.sessionId}] upstream error:`, msg);
        if (/active response/i.test(msg)) this.responseActive = false;
        // Clearing an input buffer that is already empty is routine here — the
        // gate clears on every reopen — and is no reason to alarm the candidate.
        else if (/buffer/i.test(msg) && /empty|already|clear/i.test(msg)) break;
        else this.fail(msg);
        break;
      }

      case "response.created":
        this.responseActive = true;
        // The examiner is reacting after all — let the normal path decide.
        this.clearTimer("postAnswer");
        this.send({ t: "examiner.speaking", speaking: true });
        break;

      case "response.output_audio.delta": {
        const buf = Buffer.from(ev.delta, "base64");
        // Mirror the browser's scheduler: each chunk plays after whatever is
        // already queued, not from the moment it arrives.
        const now = Date.now();
        this.playbackEndsAt = Math.max(this.playbackEndsAt, now) + (buf.length / 48000) * 1000;
        this.record?.countAudio(0, buf.length);
        this.sendAudio(buf);
        break;
      }

      case "response.output_audio_transcript.delta":
        this.examinerBuf += ev.delta ?? "";
        break;

      case "response.output_audio_transcript.done": {
        const text = (ev.transcript ?? this.examinerBuf).trim();
        this.examinerBuf = "";
        if (text) {
          this.lastExaminerText = text;
          this.record?.addTurn("examiner", text, { segmentIndex: this.index });
          this.noteExaminerTurn(text);
          this.send({ t: "transcript", role: "examiner", text, segmentIndex: this.index });
        }
        break;
      }

      case "input_audio_buffer.speech_started": {
        if (this.preparing) break; // thinking aloud during prep is not an answer
        // The gate is shut: this is speaker echo or room noise, not an answer.
        if (!this.micOpen) break;
        this.candidateSpokeEver = true;
        this.heardSpeech = true;
        this.candidateSpeaking = true;
        // They are answering, so anything queued for their silence is stale.
        this.pendingDirective = null;
        // Still talking — an answer we thought had ended has not.
        this.clearTimer("answerSettle");
        this.clearTimer("transcriptWait");
        this.settleDeadline = 0;
        // Barge-in: they answered over the tail of the question, so their turn
        // has plainly started — stop waiting for playback to drain.
        this.awaitingPlayback = false;
        this.clearTimer("speechTail");
        // The browser drops its queue on barge-in, so nothing is pending.
        this.playbackEndsAt = 0;
        this.clearTimer("silence");
        this.clearTimer("finalGrace");
        this.clearTimer("stall");
        this.send({ t: "audio.clear" });
        this.send({ t: "candidate.speaking", speaking: true });
        this.emitState("answering");

        const seg = this.current;
        if (seg && !this.timers.has("answerCap") && EXPECTS_ANSWER.has(seg.kind)) {
          this.setTimer("answerCap", seg.seconds * 1000 + CONFIG.ANSWER_SLACK_MS, () => {
            if (this.ended || this.closingSent) return;
            this.answered = true;
            this.clearTimer("answerSettle");
            // The one time an examiner is allowed to speak over the candidate:
            // the part is out of time and the test has to move.
            this.speak(timeUpDirective(), `time up: ${seg.label}`, { urgent: true });
            this.setTimer("stall", CONFIG.STALL_MS + 4_000, () => this.advance("answer_cap"));
          });
        }
        break;
      }

      case "input_audio_buffer.speech_stopped": {
        this.candidateSpeaking = false;
        this.send({ t: "candidate.speaking", speaking: false });
        if (this.preparing || this.answered) break;

        // Start counting the pause here, not when the transcript lands.
        // Transcription takes a few seconds, and waiting the settle window on
        // top of it adds a silence the candidate reads as the examiner being
        // slow. If they resume inside it, speech_started cancels this.
        this.settleDeadline = Date.now() + CONFIG.ANSWER_SETTLE_MS;
        this.setTimer("answerSettle", CONFIG.ANSWER_SETTLE_MS, () => this.onAnswerComplete());

        // Speech was heard, so an answer was attempted. If transcription never
        // returns anything usable the candidate still spoke — ask them to say it
        // again rather than silently crediting an answer nobody can assess.
        this.setTimer("transcriptWait", 6_000, () => {
          if (this.ended || this.closingSent || this.answered) return;
          const seg = this.current;
          if (!seg || seg.kind === "converse") return;
          console.log(`[${this.sessionId}] speech heard but nothing transcribed`);
          this.onUnintelligible();
        });
        break;
      }

      case "conversation.item.input_audio_transcription.completed": {
        const text = (ev.transcript ?? "").trim();
        // The gate was shut when this audio was captured, so it is the
        // examiner's own voice coming back through the speakers.
        if (!text || this.preparing || !this.heardSpeech) break;

        this.nudges = 0;
        this.clearTimer("silence");
        this.clearTimer("finalGrace");
        this.clearTimer("awaitTranscript");
        this.clearTimer("transcriptWait");
        this.pendingAdvance = false;

        this.record?.addTurn("candidate", text, { segmentIndex: this.index });
        this.send({ t: "transcript", role: "candidate", text, segmentIndex: this.index });
        this.answerParts.push(text);
        this.lastAnswer = this.answerParts.join(" ").slice(-400);
        this.rememberFromAnswer(text);

        // VAD ends a turn on a pause, and candidates at this level pause to
        // think mid-answer. The pause has to outlast the settle window before
        // the examiner may reply; that clock started when they stopped talking,
        // so by the time a transcript arrives it has usually already run out.
        const waited = this.settleDeadline ? this.settleDeadline - Date.now() : CONFIG.ANSWER_SETTLE_MS;
        if (waited <= 0 && !this.candidateSpeaking) {
          this.clearTimer("answerSettle");
          this.onAnswerComplete();
        } else {
          this.setTimer("answerSettle", Math.max(waited, 0) || CONFIG.ANSWER_SETTLE_MS, () =>
            this.onAnswerComplete(),
          );
        }
        break;
      }

      case "response.done": {
        this.responseActive = false;
        this.send({ t: "examiner.speaking", speaking: false });

        const calls = (ev.response?.output ?? []).filter((o) => o.type === "function_call");
        for (const call of calls) {
          if (call.name === "remember_candidate_detail") {
            try {
              const args = JSON.parse(call.arguments ?? "{}");
              // Only for things actually said: with no candidate speech at all
              // this is the model filling in a candidate it imagined.
              if (this.candidateSpokeEver && args.detail && args.value) {
                if (args.correction) this.correct({ [args.detail]: args.value }, "model");
                else this.remember({ [args.detail]: args.value }, "model");
              }
            } catch {
              /* malformed arguments — nothing worth remembering */
            }
          }
          this.up({
            type: "conversation.item.create",
            item: { type: "function_call_output", call_id: call.call_id, output: JSON.stringify({ ok: true }) },
          });
        }

        const names = calls.map((c) => c.name);
        if (names.includes("end_exam")) {
          // The examiner sometimes closes on the final nudge without waiting for
          // the grace timer, so derive the reason from state rather than
          // assuming the test ran to completion.
          const reason =
            this.endReason ??
            (this.nudges >= CONFIG.MAX_NUDGES
              ? "no_response"
              : this.index >= this.segments.length - 1
                ? "completed"
                : "ended_early");
          void this.end(reason);
          return;
        }

        if (names.includes("answer_received")) {
          if (this.answered) {
            this.advance("model");
            return;
          }

          // The transcript is already in and waiting out its settle window. The
          // bridge decides when that answer is finished — not the model, which
          // cannot tell a thinking pause from the end of a turn.
          if (this.answerParts.length || this.timers.has("answerSettle")) {
            this.onExaminerFinishedSpeaking();
            return;
          }

          // The model routinely signals a second or two before transcription
          // lands, so "no transcript yet" is not proof of a hallucination.
          // Whether VAD actually heard audio is. If it did, hold the script and
          // advance the moment the transcript confirms it.
          if (this.heardSpeech) {
            this.pendingAdvance = true;
            this.setTimer("awaitTranscript", 5_000, () => {
              if (this.ended || this.closingSent || this.answered) return;
              // Real speech, but nothing transcribable came back (too quiet, or
              // lost in noise). Ask them to say it again rather than crediting
              // an answer nobody can assess.
              this.pendingAdvance = false;
              this.onUnintelligible();
            });
            return;
          }

          // No audio at all: the model imagined the answer. Hold the script.
          if (process.env.REALTIME_DEBUG) {
            console.log(`[${this.sessionId}] ignoring answer_received — no speech was heard`);
          }
          this.onExaminerFinishedSpeaking();
          return;
        }

        if (this.flushPending()) return;

        if (ev.response?.status === "failed") {
          this.fail(ev.response?.status_details?.error?.message ?? "The examiner response failed.");
          return;
        }
        if (ev.response?.status === "cancelled") return;

        if (this.closingSent) {
          this.setTimer("closeGuard", 2_500, () => void this.end(this.endReason ?? "completed"));
          return;
        }

        this.onExaminerFinishedSpeaking();
        break;
      }

      default:
        break;
    }
  }

  // ------------------------------------------------------------------ end

  async end(reason) {
    if (this.ended) return;
    this.ended = true;
    this.clearAllTimers();
    this.finalizeCurrent();

    const durationMs = this.startedAt ? Date.now() - this.startedAt : 0;
    let savedPath = null;
    if (this.record) {
      savedPath = await this.record.finish(
        reason === "completed" ? "completed" : "ended_early",
        reason,
        durationMs,
      );
      this.send({ t: "saved", path: savedPath, summary: transcriptSummary(this.record) });
    }

    this.send({
      t: "done",
      reason,
      durationMs,
      progress: this.progressPercent(),
      summary: this.record ? transcriptSummary(this.record) : null,
    });

    try {
      this.upstream?.close();
    } catch {
      /* already gone */
    }
    this.upstream = null;

    console.log(
      `[${this.sessionId}] ended (${reason}) after ${Math.round(durationMs / 1000)}s — saved ${savedPath ?? "nothing"}`,
    );
    setTimeout(() => this.closeClient(1000, reason), 250);
  }

  closeClient(code, reason) {
    try {
      if (this.client.readyState === WebSocket.OPEN) this.client.close(code, reason);
    } catch {
      /* already gone */
    }
  }

  /** Browser went away — never leave a billed upstream session running. */
  abandon() {
    if (this.ended) {
      this.clearAllTimers();
      return;
    }
    console.log(`[${this.sessionId}] client disconnected — tearing down upstream`);
    void this.end("client_disconnected");
  }
}
