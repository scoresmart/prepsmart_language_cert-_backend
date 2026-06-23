import { resolveSpeakingAudioUrl } from './speakingTestAudio';

/** LanguageCert speaking is scored 0–50 (12 raw marks scaled). */
export const SPEAKING_DEFAULT_MAX_SCORE = 50;
export const SPEAKING_DEFAULT_LEVEL = 'B1';

export const SPEAKING_DEFAULT_PROMPT =
  'Listen to the examiner audio carefully, then record your spoken response when prompted.';

type SpeakingRow = {
  title?: string | null;
  level?: string | null;
  content?: string | null;
  max_score?: number | null;
  audio_url?: string | null;
  part_number?: number;
};

export function normalizeSpeakingQuestion<T extends SpeakingRow>(
  question: T,
  questionIndex = 1,
): T & {
  title: string;
  level: string;
  content: string;
  max_score: number;
  audio_url: string;
} {
  return {
    ...question,
    title: question.title?.trim() || `Speaking Question ${questionIndex}`,
    level: question.level?.trim() || SPEAKING_DEFAULT_LEVEL,
    content: question.content?.trim() || SPEAKING_DEFAULT_PROMPT,
    max_score: question.max_score || SPEAKING_DEFAULT_MAX_SCORE,
    audio_url: resolveSpeakingAudioUrl(question.audio_url, question.part_number ?? questionIndex),
  };
}

export function withNormalizedSpeakingQuestions<T extends SpeakingRow>(rows: T[]): ReturnType<typeof normalizeSpeakingQuestion<T>>[] {
  return rows.map((row, index) => normalizeSpeakingQuestion(row, index + 1));
}
