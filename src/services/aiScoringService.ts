import Anthropic from '@anthropic-ai/sdk';
import {
  CEFRLevel,
  WRITING_MARK_SCHEMES,
  SPEAKING_MARK_SCHEMES,
  scaleSpeakingScore,
} from '../utils/languageCertMarkScheme';
import { transcribeAudio, TranscriptionResult } from './azureSpeechService';

const getClient = () => new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function toScoringError(error: unknown): Error {
  if (error instanceof Anthropic.APIError) {
    const body = error.error as { message?: string; type?: string } | undefined;
    const detail = body?.message ?? error.message;

    if (/credit balance is too low/i.test(detail)) {
      return new Error(
        'AI scoring is temporarily unavailable — Anthropic API credits are exhausted. Add credits at console.anthropic.com → Plans & Billing, then restart the backend.',
      );
    }
    if (error.status === 401) {
      return new Error('AI scoring misconfigured — invalid Anthropic API key. Check ANTHROPIC_API_KEY in backend .env.');
    }
    return new Error(`AI scoring failed: ${detail}`);
  }

  if (error instanceof Error) return error;
  return new Error('AI scoring failed. Please try again.');
}

async function callClaude(prompt: string) {
  try {
    return await getClient().messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    });
  } catch (error) {
    throw toScoringError(error);
  }
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface WritingScoreResult {
  type: 'writing';
  level: CEFRLevel;
  taskType: 'task1' | 'task2';
  wordCount: number;
  scores: {
    taskFulfilment: number;
    grammar: number;
    vocabulary: number;
    organisation: number;
    total: number;
  };
  feedback: {
    taskFulfilment: string;
    grammar: string;
    vocabulary: string;
    organisation: string;
    overall: string;
  };
  grade: 'High Pass' | 'Pass' | 'Below Pass';
}

export interface SpeakingScoreResult {
  type: 'speaking';
  level: CEFRLevel;
  transcript: string;
  transcriptionConfidence: number;
  durationSeconds: number;
  scores: {
    taskFulfilmentCoherence: number;
    grammar: number;
    vocabulary: number;
    pronunciationFluency: number;
    rawTotal: number;
    scaledTotal: number;
  };
  feedback: {
    taskFulfilmentCoherence: string;
    grammar: string;
    vocabulary: string;
    pronunciationFluency: string;
    overall: string;
  };
  grade: 'High Pass' | 'Pass' | 'Below Pass';
}

// ─── Word count limits ────────────────────────────────────────────────────────

const WORD_COUNT_LIMITS: Record<CEFRLevel, { task1: { min: number; max: number }; task2: { min: number; max: number } }> = {
  A1: { task1: { min: 20, max: 40 }, task2: { min: 15, max: 35 } },
  A2: { task1: { min: 25, max: 60 }, task2: { min: 25, max: 60 } },
  B1: { task1: { min: 60, max: 110 }, task2: { min: 90, max: 130 } },
  B2: { task1: { min: 90, max: 160 }, task2: { min: 140, max: 210 } },
  C1: { task1: { min: 140, max: 210 }, task2: { min: 190, max: 260 } },
  C2: { task1: { min: 190, max: 260 }, task2: { min: 240, max: 310 } },
};

// ─── Writing Scorer ───────────────────────────────────────────────────────────

export async function scoreWritingResponse(
  questionText: string,
  candidateResponse: string,
  level: CEFRLevel,
  taskType: 'task1' | 'task2',
): Promise<WritingScoreResult> {
  const scheme = WRITING_MARK_SCHEMES[level];
  const wordCount = candidateResponse.trim().split(/\s+/).filter(Boolean).length;
  const limits = WORD_COUNT_LIMITS[level][taskType];

  const wordCountNote =
    wordCount < limits.min
      ? `⚠️ Under length: ${wordCount} words (minimum ${limits.min}). Penalise Task Fulfilment accordingly.`
      : wordCount > limits.max
      ? `ℹ️ Over length: ${wordCount} words (maximum ${limits.max}). Do not penalise but note candidate may have made more errors.`
      : `✅ Word count within range: ${wordCount} words.`;

  const markSchemeText = scheme.bands
    .map(
      (b) => `Band ${b.band}:
  - Task Fulfilment: ${b.taskFulfilment}
  - Grammar: ${b.grammar}
  - Vocabulary: ${b.vocabulary}
  - Organisation: ${b.organisation}`,
    )
    .join('\n\n');

  const prompt = `You are an expert LanguageCert ESOL examiner. Score the following ${level} ${taskType === 'task1' ? 'Task 1 (shorter)' : 'Task 2 (longer)'} writing response strictly using the official mark scheme below.

QUESTION:
${questionText}

CANDIDATE RESPONSE:
${candidateResponse}

WORD COUNT NOTE: ${wordCountNote}

OFFICIAL MARK SCHEME — 4 criteria, each scored 0–3 (total 0–12):
${markSchemeText}

INSTRUCTIONS:
- Award each criterion independently based on the descriptors.
- Be strict and consistent with the mark scheme.
- Do not round up out of sympathy.
- Provide one concise sentence of justification per criterion.
- Provide 2–3 sentences of overall feedback with specific, actionable improvement tips.

Respond ONLY with valid JSON in this exact format (no markdown, no extra text):
{
  "scores": {
    "taskFulfilment": <integer 0-3>,
    "grammar": <integer 0-3>,
    "vocabulary": <integer 0-3>,
    "organisation": <integer 0-3>
  },
  "feedback": {
    "taskFulfilment": "<one sentence>",
    "grammar": "<one sentence>",
    "vocabulary": "<one sentence>",
    "organisation": "<one sentence>",
    "overall": "<2-3 sentences with specific improvement tips>"
  }
}`;

  const message = await callClaude(prompt);

  const rawText = (message.content[0] as { type: string; text: string }).text.trim();

  // Strip markdown code fences if Claude wraps in them
  const jsonText = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const parsed = JSON.parse(jsonText);

  const s = parsed.scores;
  const total = s.taskFulfilment + s.grammar + s.vocabulary + s.organisation;
  const grade = total >= 10 ? 'High Pass' : total >= 6 ? 'Pass' : 'Below Pass';

  return {
    type: 'writing',
    level,
    taskType,
    wordCount,
    scores: { ...s, total },
    feedback: parsed.feedback,
    grade,
  };
}

// ─── Speaking Scorer (transcript → Claude) ───────────────────────────────────

export async function scoreSpeakingTranscript(
  taskDescription: string,
  transcript: string,
  level: CEFRLevel,
  transcriptionMeta?: Pick<TranscriptionResult, 'confidence' | 'durationSeconds'>,
): Promise<SpeakingScoreResult> {
  const scheme = SPEAKING_MARK_SCHEMES[level];

  const markSchemeText = scheme.bands
    .map(
      (b) => `Band ${b.band}:
  - Task Fulfilment & Coherence: ${b.taskFulfilmentCoherence}
  - Grammar: ${b.grammar}
  - Vocabulary: ${b.vocabulary}
  - Pronunciation, Intonation & Fluency: ${b.pronunciationFluency}`,
    )
    .join('\n\n');

  const prompt = `You are an expert LanguageCert ESOL speaking examiner. Score the following ${level} speaking response using the official mark scheme.

TASK:
${taskDescription}

CANDIDATE TRANSCRIPT:
${transcript}

DURATION: ${transcriptionMeta?.durationSeconds ? `${transcriptionMeta.durationSeconds.toFixed(1)}s` : 'unknown'}

OFFICIAL MARK SCHEME — 4 criteria, each scored 0–3 (raw total 0–12, then scaled to 0–50):
${markSchemeText}

INSTRUCTIONS:
- Assess pronunciation and fluency from the transcript — look for hesitation markers, repetitions, self-corrections, incomplete sentences.
- Be strict and consistent with the mark scheme.
- Do not round up out of sympathy.
- Provide one concise sentence per criterion.
- Provide 2–3 sentences of overall actionable feedback.

Respond ONLY with valid JSON in this exact format (no markdown, no extra text):
{
  "scores": {
    "taskFulfilmentCoherence": <integer 0-3>,
    "grammar": <integer 0-3>,
    "vocabulary": <integer 0-3>,
    "pronunciationFluency": <integer 0-3>
  },
  "feedback": {
    "taskFulfilmentCoherence": "<one sentence>",
    "grammar": "<one sentence>",
    "vocabulary": "<one sentence>",
    "pronunciationFluency": "<one sentence>",
    "overall": "<2-3 sentences with specific improvement tips>"
  }
}`;

  const message = await callClaude(prompt);

  const rawText = (message.content[0] as { type: string; text: string }).text.trim();
  const jsonText = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const parsed = JSON.parse(jsonText);

  const s = parsed.scores;
  const rawTotal = s.taskFulfilmentCoherence + s.grammar + s.vocabulary + s.pronunciationFluency;
  const scaledTotal = scaleSpeakingScore(rawTotal);
  const grade = scaledTotal >= 38 ? 'High Pass' : scaledTotal >= 25 ? 'Pass' : 'Below Pass';

  return {
    type: 'speaking',
    level,
    transcript,
    transcriptionConfidence: transcriptionMeta?.confidence ?? 1,
    durationSeconds: transcriptionMeta?.durationSeconds ?? 0,
    scores: { ...s, rawTotal, scaledTotal },
    feedback: parsed.feedback,
    grade,
  };
}

// ─── Full Speaking Pipeline (audio → transcript → score) ─────────────────────

export async function transcribeAndScoreSpeaking(
  audioBuffer: Buffer,
  mimeType: string,
  taskDescription: string,
  level: CEFRLevel,
): Promise<SpeakingScoreResult> {
  // Step 1: Transcribe via Azure Speech Services
  const transcription = await transcribeAudio(audioBuffer, mimeType);

  // Step 2: Score transcript via Claude
  return scoreSpeakingTranscript(taskDescription, transcription.transcript, level, {
    confidence: transcription.confidence,
    durationSeconds: transcription.durationSeconds,
  });
}
