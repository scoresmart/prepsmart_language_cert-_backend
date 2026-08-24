/**
 * The four-part speaking exam the admin authors today (structure `version: 3`).
 *
 * This is a different model from the v2 set in ./speakingSetStructure. A v2 set
 * is a list of pre-recorded prompts with audio attached. A v3 exam is a script
 * the live examiner performs: the admin supplies content only — five Part 1
 * questions, two Part 2 situations, a Part 3 picture with its title and idea,
 * and a Part 4 topic — and the examiner's wording, the timings and the
 * follow-up questions are generated at run time.
 *
 * A v3 payload must round-trip untouched. Running it through the v2 normalizer
 * rewrites it into the read-aloud shape, which throws away the picture, the
 * topic and the situations, and then rejects the save with a message about a
 * "Part 3 read aloud text" the admin was never asked for.
 *
 * The validator below mirrors validateSpeakingExamStructure in the frontend's
 * src/lib/speakingExamStructure.ts message for message. The two must agree —
 * a server rule the editor cannot show is a save the admin cannot fix.
 */

export const SPEAKING_EXAM_VERSION = 3 as const;

export const PART1_QUESTION_COUNT = 5;
export const PART2_SITUATION_COUNT = 2;

/**
 * Recognises a v3 exam script. `version: 3` is what the editor always writes;
 * the structural checks are a fallback for a row saved directly to Supabase by
 * the admin UI's offline path, which may predate the version stamp.
 */
export function isSpeakingExamStructure(raw: unknown): boolean {
  if (!raw || typeof raw !== 'object') return false;
  const s = raw as Record<string, any>;

  if (Number(s.version) === SPEAKING_EXAM_VERSION) return true;

  // Only the script model gives the examiner its own opening lines.
  if (Array.isArray(s.part1?.opening_questions)) return true;
  // The script keeps Part 1 questions as plain strings; v2 uses
  // { text, audio_url, timer_seconds } objects.
  if (
    Array.isArray(s.part1?.questions) &&
    s.part1.questions.length > 0 &&
    s.part1.questions.every((q: unknown) => typeof q === 'string')
  ) {
    return true;
  }
  // Part 3 is "describe the picture" in the script model, "read aloud" in v2.
  if (s.part3 && ('image_url' in s.part3 || 'image_idea' in s.part3 || 'question_count' in s.part3)) {
    return true;
  }
  if (typeof s.part4?.topic === 'string') return true;

  return false;
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/**
 * Part 1 questions as the editor stores them — plain strings, padded to the
 * fixed slot count. Mirrors `fixedList` in the frontend, including its
 * tolerance for the { text } objects v1/v2 used, so a set migrated from the
 * old model validates the same on both sides.
 */
function examQuestions(raw: unknown): string[] {
  const arr = Array.isArray(raw) ? raw : [];
  return Array.from({ length: PART1_QUESTION_COUNT }, (_, i) => {
    const item = arr[i];
    if (typeof item === 'string') return item;
    if (item && typeof item === 'object' && 'text' in item) return str((item as { text?: unknown }).text);
    return '';
  });
}

function examSituations(raw: unknown): string[] {
  const arr = Array.isArray(raw) ? raw : [];
  return Array.from({ length: PART2_SITUATION_COUNT }, (_, i) => str(arr[i]?.text));
}

/** Returns the first problem that would stop a set being published, or null. */
export function validateSpeakingExamStructure(raw: unknown): string | null {
  const s = (raw ?? {}) as Record<string, any>;

  for (const [i, q] of examQuestions(s.part1?.questions).entries()) {
    if (!q.trim()) return `Part 1: question ${i + 1} of ${PART1_QUESTION_COUNT} is empty.`;
  }
  for (const [i, text] of examSituations(s.part2?.situations).entries()) {
    if (!text.trim()) return `Part 2: situation ${i + 1} is empty.`;
  }

  // The examiner never sees the picture — it works from the title and the idea
  // to ask its follow-up questions, so publishing without them guarantees a
  // blank screen and irrelevant questions mid-test.
  if (!str(s.part3?.image_url).trim()) return 'Part 3: upload a picture for the candidate to describe.';
  if (!str(s.part3?.image_title).trim()) return 'Part 3: give the picture a title.';
  if (!str(s.part3?.image_idea).trim()) {
    return 'Part 3: describe the idea of the picture — the examiner needs it to ask relevant questions.';
  }

  if (!str(s.part4?.topic).trim()) return 'Part 4: enter the topic the candidate should talk about.';

  return null;
}
