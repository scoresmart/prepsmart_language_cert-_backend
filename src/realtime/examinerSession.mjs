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
  closingDirective,
  converseContinueDirective,
  converseDirective,
  generatedDirective,
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

  VAD_SILENCE_MS: num("REALTIME_VAD_SILENCE_MS", 700),
  VAD_THRESHOLD: Number(process.env.REALTIME_VAD_THRESHOLD) || 0.5,
};

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
    name: "end_exam",
    description: "Call this only after you have delivered the final closing of the test.",
    parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
  },
];

/** Segment kinds where the candidate is expected to speak. */
const EXPECTS_ANSWER = new Set(["ask", "converse", "speak", "generated"]);

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
      "speechTail",
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
              interrupt_response: true,
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

  /** Mic audio from the browser. Dropped during preparation time. */
  pushAudio(buf) {
    if (this.ended || this.preparing) return;
    if (this.upstream?.readyState !== WebSocket.OPEN) return;
    this.record?.countAudio(buf.length, 0);
    this.up({ type: "input_audio_buffer.append", audio: buf.toString("base64") });
  }

  // ----------------------------------------------------- response plumbing

  speak(directive, tag) {
    if (this.ended) return;
    if (this.responseActive) {
      this.pendingDirective = { directive, tag };
      return;
    }
    this.responseActive = true;
    this.up({
      type: "conversation.item.create",
      item: { type: "message", role: "system", content: [{ type: "input_text", text: directive }] },
    });
    this.up({ type: "response.create" });
    if (tag) console.log(`[${this.sessionId}] -> ${tag}`);
  }

  flushPending() {
    const next = this.pendingDirective;
    this.pendingDirective = null;
    if (next) this.speak(next.directive, next.tag);
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

    this.index = next;
    this.answered = false;
    this.heardSpeech = false;
    this.pendingAdvance = false;
    this.windowStarted = false;
    this.windowStartedAt = 0;
    this.nudges = 0;
    this.preparing = false;

    this.runSegment(reason);
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
        this.speak(sayDirective(seg.text), `say: ${seg.label}`);
        break;

      case "ask": {
        this.emitState("asking");
        const prev = this.segments[this.index - 1];
        const acknowledge = Boolean(prev && EXPECTS_ANSWER.has(prev.kind));
        this.speak(askDirective(seg.text, acknowledge), `ask: ${seg.label}`);
        break;
      }

      case "converse":
        this.emitState("asking");
        this.speak(converseDirective(seg.text, seg.seconds), `converse: ${seg.label}`);
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
      if (!this.answered) this.armSilenceLadder();
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
    if (this.ended || this.closingSent || this.answered || this.preparing) return;
    const seg = this.current;
    if (!seg) return;

    this.nudges += 1;
    this.record.markQuestion(this.index, { nudges: this.nudges });
    this.send({ t: "nudge", level: this.nudges, max: CONFIG.MAX_NUDGES, index: this.index });
    this.emitState(this.nudges >= CONFIG.MAX_NUDGES ? "no_response" : "nudging");

    const questionText = seg.kind === "ask" ? seg.text : "";
    this.speak(nudgeDirective(this.nudges, questionText), `nudge ${this.nudges}/${CONFIG.MAX_NUDGES}`);

    // Fallback in case that response never completes and re-arms the ladder.
    this.setTimer("silence", CONFIG.NUDGE_MS * 2 + 15_000, () => this.onSilence());
  }

  /** Records how the segment in progress ended, exactly once. */
  finalizeCurrent() {
    const seg = this.current;
    if (!seg || seg._done || !this.record) return;
    seg._done = true;
    this.record.markQuestion(this.index, {
      status: EXPECTS_ANSWER.has(seg.kind) ? (this.answered ? "answered" : "skipped") : "delivered",
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
    this.speak(closingDirective(reason, ending), `closing (${reason})`);
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
        this.advance("start");
        break;
      }

      case "error": {
        const msg = ev.error?.message ?? "Realtime API error";
        console.error(`[${this.sessionId}] upstream error:`, msg);
        if (/active response/i.test(msg)) this.responseActive = false;
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
          this.record?.addTurn("examiner", text, { segmentIndex: this.index });
          this.send({ t: "transcript", role: "examiner", text, segmentIndex: this.index });
        }
        break;
      }

      case "input_audio_buffer.speech_started": {
        if (this.preparing) break; // thinking aloud during prep is not an answer
        this.candidateSpokeEver = true;
        this.heardSpeech = true;
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
            this.speak(timeUpDirective(), `time up: ${seg.label}`);
            this.setTimer("stall", CONFIG.STALL_MS + 4_000, () => this.advance("answer_cap"));
          });
        }
        break;
      }

      case "input_audio_buffer.speech_stopped": {
        this.send({ t: "candidate.speaking", speaking: false });
        if (this.preparing || this.answered) break;
        // Speech was heard, so an answer was attempted. If transcription never
        // returns anything usable, still treat it as an attempt rather than
        // leaving the candidate in silence.
        this.setTimer("transcriptWait", 6_000, () => {
          if (this.ended || this.closingSent || this.answered) return;
          const seg = this.current;
          if (!seg || seg.kind === "converse") return;
          console.log(`[${this.sessionId}] speech heard but nothing transcribed — moving on`);
          this.answered = true;
          this.advance("speech_without_transcript");
        });
        break;
      }

      case "conversation.item.input_audio_transcription.completed": {
        const text = (ev.transcript ?? "").trim();
        if (text && !this.preparing) {
          this.answered = true;
          this.nudges = 0;
          this.clearTimer("silence");
          this.clearTimer("finalGrace");
          this.record?.addTurn("candidate", text, { segmentIndex: this.index });
          this.send({ t: "transcript", role: "candidate", text, segmentIndex: this.index });

          this.pendingAdvance = false;
          this.clearTimer("awaitTranscript");
          this.clearTimer("transcriptWait");

          // Nothing speaks unless this bridge says so, which makes the answer
          // itself the trigger for what happens next.
          const seg = this.current;
          if (!seg) break;

          if (seg.kind === "converse") {
            // Keep the role play alive until its window closes; the examiner's
            // reply and the next question are one turn.
            const elapsed = this.windowStartedAt ? Date.now() - this.windowStartedAt : 0;
            const left = Math.max(0, Math.round((seg.seconds * 1000 - elapsed) / 1000));
            if (left > 4) {
              this.speak(converseContinueDirective(seg.text, left), `role play reply (${left}s left)`);
            }
            break;
          }

          this.advance("answered");
        }
        break;
      }

      case "response.done": {
        this.responseActive = false;
        this.send({ t: "examiner.speaking", speaking: false });

        const calls = (ev.response?.output ?? []).filter((o) => o.type === "function_call");
        for (const call of calls) {
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

          // The model routinely signals a second or two before transcription
          // lands, so "no transcript yet" is not proof of a hallucination.
          // Whether VAD actually heard audio is. If it did, hold the script and
          // advance the moment the transcript confirms it.
          if (this.heardSpeech) {
            this.pendingAdvance = true;
            this.setTimer("awaitTranscript", 5_000, () => {
              if (this.ended || this.closingSent || this.answered) return;
              // Real speech, but nothing transcribable came back (too quiet, or
              // not English). Still an attempt — move on rather than nudge.
              this.pendingAdvance = false;
              this.answered = true;
              this.advance("speech_without_transcript");
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
