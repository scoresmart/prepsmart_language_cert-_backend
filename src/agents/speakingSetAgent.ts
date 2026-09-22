import { randomUUID } from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import * as z from 'zod/v4';
import { getSupabase } from '../config/database';
import {
  PART1_QUESTION_COUNT,
  PART2_SITUATION_COUNT,
  SPEAKING_EXAM_VERSION,
  validateSpeakingExamStructure,
} from '../utils/speakingExamStructure';

/**
 * Writes complete v3 speaking sets end to end.
 *
 * Claude authors the content an admin would otherwise type into the editor —
 * Part 1 questions, the two Part 2 role plays, the Part 3 picture brief and the
 * Part 4 topic — plus scripted follow-up questions for Parts 3 and 4. OpenAI
 * draws the Part 3 picture from that brief. The set is stored exactly as the
 * admin editor would store it, so the portal and the live examiner run it with
 * no further changes.
 *
 * Every set already in the table is passed to Claude as material to avoid, and
 * each set generated in the same run is added to that list before the next one
 * is written, so a batch never repeats itself.
 */

export const SPEAKING_IMAGE_BUCKET = 'writing-task-images';
export const PART3_QUESTION_COUNT = 2;
export const PART4_FOLLOWUP_COUNT = 3;
export const MAX_SETS_PER_RUN = 10;

const TEXT_MODEL = process.env.SPEAKING_AGENT_MODEL || 'claude-opus-5';
const IMAGE_MODEL = process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1';

/** Fixed examiner wording and timings — identical to the admin editor's defaults. */
const EXAM_DEFAULTS = {
  examName: 'LanguageCert Academic Speaking',
  disclaimer: 'Original Practice Content – Not Official Exam Questions',
  greeting: "Hi there, I'm your LanguageCert examiner.",
  part1Openers: ['What is your full name?', 'Where are you from?'],
  part1Transition: "Thank you. Now I'm going to ask you some questions about yourself.",
  part1Closing: 'Thank you. That is the end of Part 1.',
  part2Intro:
    'Now we will begin Part 2. I will read a situation for you, and I want you to start your answer. So, here is the first situation.',
  part2Closing: 'Thank you. That is the end of Part 2.',
  part3Intro:
    'Now we will move to Part 3. You will see a picture on your screen. You have twenty seconds to look at it and prepare.',
  part3Closing: 'Thank you. That is the end of Part 3.',
  part4Intro:
    'In Part Four you are going to talk about something for half a minute. You have thirty seconds to prepare.',
  ending: 'Thank you very much. That is the end of the speaking test. Your responses have been recorded. Goodbye.',
} as const;

const SetContentSchema = z.object({
  theme: z.string().describe('Two to four words naming the set, e.g. "Health and fitness".'),
  part1_questions: z
    .array(z.string())
    .describe(`Exactly ${PART1_QUESTION_COUNT} short personal questions about the candidate.`),
  part2_situations: z
    .array(z.string())
    .describe(`Exactly ${PART2_SITUATION_COUNT} role-play situations read aloud by the examiner.`),
  part3_picture: z.object({
    title: z.string().describe('A short title for the picture, e.g. "A busy farmers market".'),
    idea: z
      .string()
      .describe('Three to five sentences describing exactly what the picture shows and the themes it raises.'),
    image_prompt: z
      .string()
      .describe('A detailed prompt for an image model that will produce this picture.'),
  }),
  part3_questions: z
    .array(z.string())
    .describe(`Exactly ${PART3_QUESTION_COUNT} follow-up questions about the picture and its themes.`),
  part4_topic: z.string().describe('The topic the candidate talks about.'),
  part4_followups: z
    .array(z.string())
    .describe(`Exactly ${PART4_FOLLOWUP_COUNT} follow-up questions that extend the Part 4 topic.`),
});

export type SpeakingSetContent = z.infer<typeof SetContentSchema>;

export type GenerateSpeakingSetsOptions = {
  count: number;
  level?: string;
  publish?: boolean;
  createdBy?: string | null;
  log?: (message: string) => void;
};

export type GeneratedSpeakingSet = {
  id: string;
  title: string;
  level: string;
  is_published: boolean;
  theme: string;
  image_url: string;
};

type UsedContent = {
  questions: string[];
  situations: string[];
  pictures: string[];
  topics: string[];
};

const SYSTEM_PROMPT = `You write original practice content for the LanguageCert Academic Speaking test. Candidates are adults preparing for university study or work abroad. Everything you write is read aloud by a live AI examiner, so it must sound natural when spoken.

The test has four parts:
- Part 1: short personal questions about the candidate's life, study, work, habits, preferences and plans. Each is a single clear question of 6–14 words that a candidate can answer in two or three sentences. Never ask the candidate's name or where they are from — the examiner always asks those first.
- Part 2: two role plays. The examiner reads the situation, then plays the role and converses for one minute. Each situation starts with "I am your <role>." It gives the candidate a concrete reason to speak and two or three things to do (explain, apologise, ask, suggest, request, complain politely, make arrangements), and ends with "You may start now." Use two different relationships per set — for example one formal (tutor, manager, landlord, receptionist, librarian) and one informal (friend, flatmate, neighbour, classmate).
- Part 3: the candidate describes a picture, then answers two follow-up questions. The picture is an ordinary, realistic, photographable scene with people doing something — lots of visible detail to describe and a clear theme to discuss. The idea describes what is actually visible, then the themes. The follow-up questions move from the picture to the candidate's own opinion or experience of the theme (e.g. "Do you think people spend less time outdoors than in the past? Why?").
- Part 4: the candidate talks about a topic, then answers three follow-up questions. The topic is personal and concrete enough to talk about without special knowledge ("A skill you would like to learn, and why it interests you."). The follow-ups start personal and become broader and more abstract, ending with a question about society or the future.

Rules:
- Write at the requested CEFR level: vocabulary and grammar a candidate at that level understands on first hearing.
- British English spelling.
- Every question is one question only — no "and why?" chains beyond a single short "Why?".
- Keep each set coherent: all four parts share the set's theme loosely, but Part 1 stays everyday and personal.
- Nothing culturally narrow, religious, political, medical-diagnostic, violent or upsetting. No brands, celebrities or real named people.
- The image prompt must describe a photorealistic scene: setting, people (varied ages and backgrounds), what they are doing, lighting and camera framing. It must say there is no text, lettering, signage words or logos anywhere in the image.
- Never reuse or closely paraphrase any question, situation, picture or topic listed as already used.`;

function formatUsed(used: UsedContent): string {
  const block = (label: string, items: string[]) =>
    items.length ? `${label}:\n${items.map((x) => `- ${x}`).join('\n')}` : `${label}: none yet`;
  return [
    block('Part 1 questions already used', used.questions),
    block('Part 2 situations already used', used.situations),
    block('Part 3 pictures already used', used.pictures),
    block('Part 4 topics already used', used.topics),
  ].join('\n\n');
}

function problemsWith(content: SpeakingSetContent): string[] {
  const problems: string[] = [];
  const nonEmpty = (xs: string[]) => xs.filter((x) => x.trim()).length;

  if (nonEmpty(content.part1_questions) !== PART1_QUESTION_COUNT) {
    problems.push(`part1_questions must contain exactly ${PART1_QUESTION_COUNT} questions`);
  }
  if (nonEmpty(content.part2_situations) !== PART2_SITUATION_COUNT) {
    problems.push(`part2_situations must contain exactly ${PART2_SITUATION_COUNT} situations`);
  }
  for (const [i, s] of content.part2_situations.entries()) {
    if (!/^I am your /i.test(s.trim())) problems.push(`situation ${i + 1} must start with "I am your"`);
    if (!/You may start now\.?$/i.test(s.trim())) problems.push(`situation ${i + 1} must end with "You may start now."`);
  }
  if (nonEmpty(content.part3_questions) !== PART3_QUESTION_COUNT) {
    problems.push(`part3_questions must contain exactly ${PART3_QUESTION_COUNT} questions`);
  }
  if (nonEmpty(content.part4_followups) !== PART4_FOLLOWUP_COUNT) {
    problems.push(`part4_followups must contain exactly ${PART4_FOLLOWUP_COUNT} questions`);
  }
  const p = content.part3_picture;
  if (!p.title.trim() || !p.idea.trim() || !p.image_prompt.trim()) problems.push('part3_picture fields must not be empty');
  if (!content.part4_topic.trim()) problems.push('part4_topic must not be empty');
  return problems;
}

async function writeSetContent(client: Anthropic, level: string, used: UsedContent): Promise<SpeakingSetContent> {
  const request = `Write one new speaking practice set at CEFR level ${level}.

${formatUsed(used)}`;

  let feedback = '';
  for (let attempt = 1; attempt <= 2; attempt++) {
    const response = await client.beta.messages.parse({
      model: TEXT_MODEL,
      max_tokens: 16000,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'medium', format: betaZodOutputFormat(SetContentSchema) },
      betas: ['server-side-fallback-2026-06-01'],
      fallbacks: [{ model: 'claude-opus-4-8' }],
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: request + feedback }],
    });

    if (response.stop_reason === 'refusal') {
      throw new Error('Claude declined to write this set.');
    }
    if (response.stop_reason === 'max_tokens') {
      throw new Error('Claude ran out of output tokens while writing the set.');
    }
    const content = response.parsed_output;
    if (!content) throw new Error('Claude returned a set that did not match the schema.');

    const problems = problemsWith(content);
    if (!problems.length) {
      return {
        ...content,
        part1_questions: content.part1_questions.map((x) => x.trim()).filter(Boolean),
        part2_situations: content.part2_situations.map((x) => x.trim()).filter(Boolean),
        part3_questions: content.part3_questions.map((x) => x.trim()).filter(Boolean),
        part4_followups: content.part4_followups.map((x) => x.trim()).filter(Boolean),
      };
    }
    feedback = `\n\nYour previous attempt had these problems — fix all of them:\n${problems.map((x) => `- ${x}`).join('\n')}`;
  }
  throw new Error('Claude could not produce a valid set after two attempts.');
}

async function drawPicture(prompt: string): Promise<Buffer> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is not set.');

  const res = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: IMAGE_MODEL,
      prompt: `${prompt}\n\nPhotorealistic, natural colours, clear detail for a language exam picture-description task. Absolutely no text, words, letters, numbers, signs or logos anywhere in the image.`,
      size: '1536x1024',
      quality: 'medium',
      n: 1,
    }),
    signal: AbortSignal.timeout(180_000),
  });

  const body = (await res.json().catch(() => null)) as
    | { data?: Array<{ b64_json?: string }>; error?: { message?: string } }
    | null;
  if (!res.ok) {
    throw new Error(`OpenAI image generation failed (${res.status}): ${body?.error?.message ?? res.statusText}`);
  }
  const b64 = body?.data?.[0]?.b64_json;
  if (!b64) throw new Error('OpenAI returned no image data.');
  return Buffer.from(b64, 'base64');
}

export function buildSpeakingSetStructure(content: SpeakingSetContent, imagePath: string) {
  return {
    version: SPEAKING_EXAM_VERSION,
    exam_name: EXAM_DEFAULTS.examName,
    disclaimer: EXAM_DEFAULTS.disclaimer,
    greeting: EXAM_DEFAULTS.greeting,
    part1: {
      opening_questions: [...EXAM_DEFAULTS.part1Openers],
      transition: EXAM_DEFAULTS.part1Transition,
      questions: content.part1_questions,
      closing: EXAM_DEFAULTS.part1Closing,
    },
    part2: {
      intro: EXAM_DEFAULTS.part2Intro,
      situations: content.part2_situations.map((text) => ({ text, seconds: 60 })),
      closing: EXAM_DEFAULTS.part2Closing,
    },
    part3: {
      intro: EXAM_DEFAULTS.part3Intro,
      image_url: imagePath,
      image_title: content.part3_picture.title.trim(),
      image_idea: content.part3_picture.idea.trim(),
      prepare_seconds: 20,
      describe_seconds: 30,
      question_count: PART3_QUESTION_COUNT,
      question_seconds: 30,
      questions: content.part3_questions,
      closing: EXAM_DEFAULTS.part3Closing,
    },
    part4: {
      intro: EXAM_DEFAULTS.part4Intro,
      topic: content.part4_topic.trim(),
      prepare_seconds: 30,
      present_seconds: 30,
      followup_count: PART4_FOLLOWUP_COUNT,
      followup_seconds: 30,
      followups: content.part4_followups,
    },
    ending: EXAM_DEFAULTS.ending,
  };
}

/** Collects what existing sets already use, and the next free "Set N" number. */
async function loadExistingSets(): Promise<{ used: UsedContent; nextNumber: number; nextSortOrder: number }> {
  const { data, error } = await getSupabase().from('speaking_sets').select('title, sort_order, structure');
  if (error) throw error;

  const used: UsedContent = { questions: [], situations: [], pictures: [], topics: [] };
  let highest = 0;
  let maxSort = 0;

  for (const row of data ?? []) {
    const match = /^Set\s+(\d+)\b/i.exec(String(row.title ?? ''));
    if (match) highest = Math.max(highest, Number(match[1]));
    maxSort = Math.max(maxSort, Number(row.sort_order) || 0);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const s = (row.structure ?? {}) as Record<string, any>;
    for (const q of Array.isArray(s.part1?.questions) ? s.part1.questions : []) {
      const text = typeof q === 'string' ? q : q?.text;
      if (typeof text === 'string' && text.trim()) used.questions.push(text.trim());
    }
    for (const sit of Array.isArray(s.part2?.situations) ? s.part2.situations : []) {
      if (typeof sit?.text === 'string' && sit.text.trim()) used.situations.push(sit.text.trim());
    }
    if (typeof s.part3?.image_title === 'string' && s.part3.image_title.trim()) {
      used.pictures.push(s.part3.image_title.trim());
    }
    if (typeof s.part4?.topic === 'string' && s.part4.topic.trim()) used.topics.push(s.part4.topic.trim());
  }

  return { used, nextNumber: Math.max(highest, (data ?? []).length) + 1, nextSortOrder: maxSort + 1 };
}

export async function generateSpeakingSets(options: GenerateSpeakingSetsOptions): Promise<GeneratedSpeakingSet[]> {
  const count = Math.floor(options.count);
  if (!Number.isFinite(count) || count < 1 || count > MAX_SETS_PER_RUN) {
    throw new Error(`count must be between 1 and ${MAX_SETS_PER_RUN}.`);
  }
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set.');
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not set.');

  const level = options.level?.trim() || 'B1';
  const publish = options.publish ?? false;
  const log = options.log ?? ((message: string) => console.log(`[speaking-set-agent] ${message}`));

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const supabase = getSupabase();
  const { used, nextNumber, nextSortOrder } = await loadExistingSets();
  const created: GeneratedSpeakingSet[] = [];

  for (let i = 0; i < count; i++) {
    const title = `Set ${nextNumber + i}`;
    log(`${title}: writing questions with ${TEXT_MODEL}…`);
    const content = await writeSetContent(client, level, used);

    log(`${title}: "${content.theme}" — drawing "${content.part3_picture.title}" with ${IMAGE_MODEL}…`);
    const image = await drawPicture(content.part3_picture.image_prompt);

    const imagePath = `speaking-part3/${randomUUID()}.png`;
    const { error: uploadError } = await supabase.storage
      .from(SPEAKING_IMAGE_BUCKET)
      .upload(imagePath, image, { contentType: 'image/png', cacheControl: '3600', upsert: false });
    if (uploadError) throw new Error(`Picture upload failed: ${uploadError.message}`);

    const structure = buildSpeakingSetStructure(content, imagePath);
    const validationError = validateSpeakingExamStructure(structure);
    if (validationError) {
      await supabase.storage.from(SPEAKING_IMAGE_BUCKET).remove([imagePath]);
      throw new Error(`${title} failed validation: ${validationError}`);
    }

    const { data, error } = await supabase
      .from('speaking_sets')
      .insert({
        title,
        level,
        sort_order: nextSortOrder + i,
        is_published: publish,
        structure,
        created_by: options.createdBy ?? null,
      })
      .select('id, title, level, is_published')
      .single();
    if (error || !data) {
      await supabase.storage.from(SPEAKING_IMAGE_BUCKET).remove([imagePath]);
      throw new Error(`Saving ${title} failed: ${error?.message ?? 'no row returned'}`);
    }

    created.push({ ...data, theme: content.theme, image_url: imagePath });
    used.questions.push(...content.part1_questions);
    used.situations.push(...content.part2_situations);
    used.pictures.push(content.part3_picture.title);
    used.topics.push(content.part4_topic);
    log(`${title}: saved (${publish ? 'published' : 'draft'}) as ${data.id}`);
  }

  return created;
}
