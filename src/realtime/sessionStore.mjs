/**
 * Auto-save for realtime speaking sessions.
 *
 * Every session is written to disk as it progresses (not only at the end), so a
 * crashed tab, a dropped connection, or a browser refresh never loses the
 * candidate's answers.
 *
 * On Railway the container filesystem is ephemeral, so these files survive only
 * until the next restart or deploy. They are a debugging aid, not the system of
 * record — the scored attempt is saved through the practice API by the browser
 * when the test finishes. Point REALTIME_SESSION_DIR at a mounted volume to
 * keep them, or set REALTIME_SESSION_DIR=off to skip disk entirely.
 */

import fs from "node:fs/promises";
import path from "node:path";

const CONFIGURED_DIR = (process.env.REALTIME_SESSION_DIR ?? "").trim();

/** `off`/`none`/`false`/`0` disables disk writes; anything else is a directory. */
const DISK_DISABLED = ["off", "none", "false", "0"].includes(CONFIGURED_DIR.toLowerCase());

const ROOT = path.resolve(process.cwd(), CONFIGURED_DIR || ".realtime-sessions");

/** One warning per process — a read-only FS must not spam the log on every turn. */
let diskWarned = false;

/** Debounced writer so a chatty transcript doesn't hammer the disk. */
export class SessionRecord {
  constructor(sessionId, meta) {
    this.sessionId = sessionId;
    this.data = {
      sessionId,
      startedAt: new Date().toISOString(),
      endedAt: null,
      status: "in_progress",
      endReason: null,
      meta,
      questions: [],
      turns: [],
      durationMs: 0,
      audioBytesIn: 0,
      audioBytesOut: 0,
      /** What the candidate told the examiner about themselves. */
      profile: {},
    };
    this._timer = null;
    this._writing = false;
    this._dirty = false;
  }

  setQuestions(questions) {
    this.data.questions = questions.map((q, i) => ({
      index: i,
      text: q.text,
      seconds: q.seconds ?? null,
      kind: q.kind ?? null,
      part: q.part ?? null,
      status: "pending",
      askedAt: null,
      answeredAt: null,
      nudges: 0,
    }));
    this.save();
  }

  markQuestion(index, patch) {
    const q = this.data.questions[index];
    if (!q) return;
    Object.assign(q, patch);
    this.save();
  }

  /** Candidate details the examiner is holding on to (name, home town, …). */
  setProfile(profile) {
    this.data.profile = { ...profile };
    this.save();
  }

  addTurn(role, text, extra = {}) {
    const trimmed = (text ?? "").trim();
    if (!trimmed) return;
    this.data.turns.push({
      role,
      text: trimmed,
      at: new Date().toISOString(),
      ...extra,
    });
    this.save();
  }

  countAudio(bytesIn = 0, bytesOut = 0) {
    this.data.audioBytesIn += bytesIn;
    this.data.audioBytesOut += bytesOut;
  }

  async finish(status, endReason, durationMs) {
    this.data.status = status;
    this.data.endReason = endReason;
    this.data.endedAt = new Date().toISOString();
    this.data.durationMs = durationMs;
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
    await this._write();
    return this.filePath();
  }

  filePath() {
    return DISK_DISABLED ? null : path.join(ROOT, `${this.sessionId}.json`);
  }

  /** Debounced auto-save. */
  save() {
    this._dirty = true;
    if (this._timer) return;
    this._timer = setTimeout(() => {
      this._timer = null;
      void this._write();
    }, 750);
  }

  async _write() {
    if (this._writing) {
      this.save();
      return;
    }
    this._writing = true;
    this._dirty = false;
    try {
      if (DISK_DISABLED) return;
      await fs.mkdir(ROOT, { recursive: true });
      const target = this.filePath();
      const tmp = `${target}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(this.data, null, 2), "utf8");
      await fs.rename(tmp, target);
    } catch (err) {
      // A transcript that cannot be written must never take the exam down with
      // it — the candidate is mid-answer and the live session still works.
      if (!diskWarned) {
        diskWarned = true;
        console.error(
          `[store] transcripts are not being written (${err.message}). ` +
            "Set REALTIME_SESSION_DIR to a writable path, or =off to silence this.",
        );
      }
    } finally {
      this._writing = false;
      if (this._dirty) this.save();
    }
  }
}

export function transcriptSummary(record) {
  const qs = record.data.questions;
  // "delivered" marks lines the examiner simply read out, so they must not be
  // counted as questions the candidate failed to answer.
  const spoken = qs.filter((q) => q.status !== "delivered");
  return {
    sessionId: record.sessionId,
    turns: record.data.turns.length,
    questionsAsked: spoken.filter((q) => q.status !== "pending").length,
    questionsAnswered: spoken.filter((q) => q.status === "answered").length,
    questionsSkipped: spoken.filter((q) => q.status === "skipped").length,
    partsReached: [...new Set(qs.filter((q) => q.status !== "pending" && q.part).map((q) => q.part))],
    durationMs: record.data.durationMs,
    transcript: record.data.turns.map(({ role, text }) => ({ role, text })),
  };
}
