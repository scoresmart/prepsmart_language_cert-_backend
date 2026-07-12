import { resolveSpeakingAudioUrl } from './speakingTestAudio';

export const SPEAKING_SET_EXAM_NAME = 'LanguageCert Academic Speaking';

export const SPEAKING_SET_DEFAULTS = {
  disclaimer: 'Original Practice Content – Not Official Exam Questions',
  generalIntroText:
    'Hello. This is your LanguageCert Academic Speaking practice test. The speaking test has four parts. Please speak clearly, give full answers, and try to speak naturally. We will now begin.',
  part1StudentInstruction:
    'No preparation time is required. Answer each question naturally in 2–3 sentences.',
  part1ExaminerInstruction:
    'Now we will start Part 1. I am going to ask you some questions about yourself and your studies. Please answer in full sentences.',
  part2StudentInstruction:
    'You will complete two role plays. Speak naturally, ask questions, respond politely, and continue the conversation.',
  part2ExaminerInstruction:
    'Now we will move to Part 2. I will give you two situations. Please speak naturally, ask questions, respond politely, and continue the conversation.',
  part3StudentInstruction:
    'You will see a short academic text. You will get 30 seconds to prepare. After that, read the text aloud clearly.',
  part3ExaminerInstruction:
    'Now we will move to Part 3. You will see a short academic text. You have 30 seconds to prepare. After that, please read the text aloud clearly.',
  part3ReadAloudStart: 'Your preparation time is over. Please read the text aloud now.',
  part4StudentInstruction:
    'You will get one minute to prepare. After that, speak for up to two minutes on the topic.',
  part4ExaminerInstruction:
    'Now we will move to Part 4. You will give a short presentation on a topic. You have one minute to prepare. After that, you should speak for up to two minutes.',
  part4PreparationStart: 'Your preparation time starts now.',
  part4PresentationStart: 'Your preparation time is over. Please start your presentation now.',
  endingText: 'Thank you. This is the end of this speaking practice set.',
  timers: {
    part1Answer: 30,
    part2RolePlay: 60,
    part3Prep: 30,
    part3Reading: 60,
    part3FollowUp: 45,
    part4Prep: 60,
    part4Speaking: 120,
    part4FollowUp: 45,
  },
} as const;

export type SpeakingTextAudio = {
  text: string;
  audio_url?: string | null;
};

export type SpeakingTimedPrompt = {
  text: string;
  audio_url?: string | null;
  timer_seconds: number;
};

export type SpeakingSetPart1 = {
  student_instruction: string;
  examiner_instruction: SpeakingTextAudio;
  questions: SpeakingTimedPrompt[];
};

export type SpeakingSetPart2 = {
  student_instruction: string;
  examiner_instruction: SpeakingTextAudio;
  role_plays: SpeakingTimedPrompt[];
};

export type SpeakingSetPart3 = {
  student_instruction: string;
  examiner_instruction: SpeakingTextAudio;
  read_aloud_text: string;
  preparation_timer: number;
  read_aloud_start: SpeakingTextAudio;
  reading_timer: number;
  follow_up: SpeakingTimedPrompt;
};

export type SpeakingSetPart4 = {
  student_instruction: string;
  examiner_instruction: SpeakingTextAudio;
  presentation_topic: SpeakingTextAudio;
  preparation_start: SpeakingTextAudio;
  preparation_timer: number;
  presentation_start: SpeakingTextAudio;
  speaking_timer: number;
  follow_ups: SpeakingTimedPrompt[];
  ending: SpeakingTextAudio;
};

export type SpeakingSetStructure = {
  version: 2;
  exam_name: string;
  disclaimer: string;
  general_intro: SpeakingTextAudio;
  part1: SpeakingSetPart1;
  part2: SpeakingSetPart2;
  part3: SpeakingSetPart3;
  part4: SpeakingSetPart4;
};

function textAudio(text: string, audio_url: string | null = null): SpeakingTextAudio {
  return { text, audio_url };
}

function timedPrompt(text = '', timer_seconds: number, audio_url: string | null = null): SpeakingTimedPrompt {
  return { text, audio_url, timer_seconds };
}

export function emptySpeakingSetStructure(): SpeakingSetStructure {
  const t = SPEAKING_SET_DEFAULTS.timers;
  return {
    version: 2,
    exam_name: SPEAKING_SET_EXAM_NAME,
    disclaimer: SPEAKING_SET_DEFAULTS.disclaimer,
    general_intro: textAudio(SPEAKING_SET_DEFAULTS.generalIntroText),
    part1: {
      student_instruction: SPEAKING_SET_DEFAULTS.part1StudentInstruction,
      examiner_instruction: textAudio(SPEAKING_SET_DEFAULTS.part1ExaminerInstruction),
      questions: Array.from({ length: 5 }, () => timedPrompt('', t.part1Answer)),
    },
    part2: {
      student_instruction: SPEAKING_SET_DEFAULTS.part2StudentInstruction,
      examiner_instruction: textAudio(SPEAKING_SET_DEFAULTS.part2ExaminerInstruction),
      role_plays: Array.from({ length: 2 }, () => timedPrompt('', t.part2RolePlay)),
    },
    part3: {
      student_instruction: SPEAKING_SET_DEFAULTS.part3StudentInstruction,
      examiner_instruction: textAudio(SPEAKING_SET_DEFAULTS.part3ExaminerInstruction),
      read_aloud_text: '',
      preparation_timer: t.part3Prep,
      read_aloud_start: textAudio(SPEAKING_SET_DEFAULTS.part3ReadAloudStart),
      reading_timer: t.part3Reading,
      follow_up: timedPrompt('', t.part3FollowUp),
    },
    part4: {
      student_instruction: SPEAKING_SET_DEFAULTS.part4StudentInstruction,
      examiner_instruction: textAudio(SPEAKING_SET_DEFAULTS.part4ExaminerInstruction),
      presentation_topic: textAudio(''),
      preparation_start: textAudio(SPEAKING_SET_DEFAULTS.part4PreparationStart),
      preparation_timer: t.part4Prep,
      presentation_start: textAudio(SPEAKING_SET_DEFAULTS.part4PresentationStart),
      speaking_timer: t.part4Speaking,
      follow_ups: [timedPrompt('', t.part4FollowUp), timedPrompt('', t.part4FollowUp)],
      ending: textAudio(SPEAKING_SET_DEFAULTS.endingText),
    },
  };
}

export function normalizeSpeakingSetStructure(raw: unknown): SpeakingSetStructure {
  const base = emptySpeakingSetStructure();
  if (!raw || typeof raw !== 'object') return base;
  const s = raw as Record<string, unknown>;

  if (s.version === 2 || (s.part1 && typeof s.part1 === 'object' && 'questions' in (s.part1 as object))) {
    const p1 = (s.part1 ?? {}) as Partial<SpeakingSetPart1>;
    const p2 = (s.part2 ?? {}) as Partial<SpeakingSetPart2>;
    const p3 = (s.part3 ?? {}) as Partial<SpeakingSetPart3>;
    const p4 = (s.part4 ?? {}) as Partial<SpeakingSetPart4>;
    const general = (s.general_intro ?? {}) as Partial<SpeakingTextAudio>;

    return {
      version: 2,
      exam_name: typeof s.exam_name === 'string' && s.exam_name.trim() ? s.exam_name : base.exam_name,
      disclaimer: typeof s.disclaimer === 'string' && s.disclaimer.trim() ? s.disclaimer : base.disclaimer,
      general_intro: {
        text: general.text?.trim() || base.general_intro.text,
        audio_url: general.audio_url ?? null,
      },
      part1: {
        student_instruction: p1.student_instruction?.trim() || base.part1.student_instruction,
        examiner_instruction: {
          text: p1.examiner_instruction?.text?.trim() || base.part1.examiner_instruction.text,
          audio_url: p1.examiner_instruction?.audio_url ?? null,
        },
        questions:
          Array.isArray(p1.questions) && p1.questions.length === 5
            ? p1.questions.map((q, i) => ({
                text: q?.text ?? '',
                audio_url: q?.audio_url ?? null,
                timer_seconds: Number(q?.timer_seconds) > 0 ? Number(q.timer_seconds) : base.part1.questions[i].timer_seconds,
              }))
            : base.part1.questions,
      },
      part2: {
        student_instruction: p2.student_instruction?.trim() || base.part2.student_instruction,
        examiner_instruction: {
          text: p2.examiner_instruction?.text?.trim() || base.part2.examiner_instruction.text,
          audio_url: p2.examiner_instruction?.audio_url ?? null,
        },
        role_plays:
          Array.isArray(p2.role_plays) && p2.role_plays.length === 2
            ? p2.role_plays.map((q, i) => ({
                text: q?.text ?? '',
                audio_url: q?.audio_url ?? null,
                timer_seconds: Number(q?.timer_seconds) > 0 ? Number(q.timer_seconds) : base.part2.role_plays[i].timer_seconds,
              }))
            : base.part2.role_plays,
      },
      part3: {
        student_instruction: p3.student_instruction?.trim() || base.part3.student_instruction,
        examiner_instruction: {
          text: p3.examiner_instruction?.text?.trim() || base.part3.examiner_instruction.text,
          audio_url: p3.examiner_instruction?.audio_url ?? null,
        },
        read_aloud_text: p3.read_aloud_text ?? '',
        preparation_timer: Number(p3.preparation_timer) > 0 ? Number(p3.preparation_timer) : base.part3.preparation_timer,
        read_aloud_start: {
          text: p3.read_aloud_start?.text?.trim() || base.part3.read_aloud_start.text,
          audio_url: p3.read_aloud_start?.audio_url ?? null,
        },
        reading_timer: Number(p3.reading_timer) > 0 ? Number(p3.reading_timer) : base.part3.reading_timer,
        follow_up: {
          text: p3.follow_up?.text ?? '',
          audio_url: p3.follow_up?.audio_url ?? null,
          timer_seconds:
            Number(p3.follow_up?.timer_seconds) > 0
              ? Number(p3.follow_up?.timer_seconds)
              : base.part3.follow_up.timer_seconds,
        },
      },
      part4: {
        student_instruction: p4.student_instruction?.trim() || base.part4.student_instruction,
        examiner_instruction: {
          text: p4.examiner_instruction?.text?.trim() || base.part4.examiner_instruction.text,
          audio_url: p4.examiner_instruction?.audio_url ?? null,
        },
        presentation_topic: {
          text: p4.presentation_topic?.text ?? '',
          audio_url: p4.presentation_topic?.audio_url ?? null,
        },
        preparation_start: {
          text: p4.preparation_start?.text?.trim() || base.part4.preparation_start.text,
          audio_url: p4.preparation_start?.audio_url ?? null,
        },
        preparation_timer: Number(p4.preparation_timer) > 0 ? Number(p4.preparation_timer) : base.part4.preparation_timer,
        presentation_start: {
          text: p4.presentation_start?.text?.trim() || base.part4.presentation_start.text,
          audio_url: p4.presentation_start?.audio_url ?? null,
        },
        speaking_timer: Number(p4.speaking_timer) > 0 ? Number(p4.speaking_timer) : base.part4.speaking_timer,
        follow_ups:
          Array.isArray(p4.follow_ups) && p4.follow_ups.length === 2
            ? p4.follow_ups.map((q, i) => ({
                text: q?.text ?? '',
                audio_url: q?.audio_url ?? null,
                timer_seconds:
                  Number(q?.timer_seconds) > 0 ? Number(q.timer_seconds) : base.part4.follow_ups[i].timer_seconds,
              }))
            : base.part4.follow_ups,
        ending: {
          text: p4.ending?.text?.trim() || base.part4.ending.text,
          audio_url: p4.ending?.audio_url ?? null,
        },
      },
    };
  }

  const legacy = s as {
    part1?: Array<{ title?: string; content?: string; audio_url?: string | null }>;
    part2?: Array<{ title?: string; content?: string; audio_url?: string | null }>;
    part3?: {
      readAloud?: { title?: string; content?: string; read_text?: string; audio_url?: string | null };
      followUps?: Array<{ title?: string; content?: string; audio_url?: string | null }>;
    };
    part4?: {
      presentation?: { title?: string; content?: string; topic?: string; audio_url?: string | null };
      followUps?: Array<{ title?: string; content?: string; audio_url?: string | null }>;
    };
  };

  if (Array.isArray(legacy.part1) && legacy.part1.length === 5) {
    base.part1.questions = legacy.part1.map((q) =>
      timedPrompt(q.content?.trim() || q.title || '', SPEAKING_SET_DEFAULTS.timers.part1Answer, q.audio_url ?? null),
    );
  }
  if (Array.isArray(legacy.part2) && legacy.part2.length === 2) {
    base.part2.role_plays = legacy.part2.map((q) =>
      timedPrompt(q.content?.trim() || q.title || '', SPEAKING_SET_DEFAULTS.timers.part2RolePlay, q.audio_url ?? null),
    );
  }
  if (legacy.part3?.readAloud) {
    base.part3.read_aloud_text = legacy.part3.readAloud.read_text ?? '';
    if (legacy.part3.readAloud.content) base.part3.examiner_instruction.text = legacy.part3.readAloud.content;
    base.part3.examiner_instruction.audio_url = legacy.part3.readAloud.audio_url ?? null;
  }
  if (legacy.part3?.followUps?.length) {
    const f = legacy.part3.followUps[0];
    base.part3.follow_up = timedPrompt(
      f.content?.trim() || f.title || '',
      SPEAKING_SET_DEFAULTS.timers.part3FollowUp,
      f.audio_url ?? null,
    );
  }
  if (legacy.part4?.presentation) {
    base.part4.presentation_topic = {
      text: legacy.part4.presentation.topic?.trim() || legacy.part4.presentation.title || '',
      audio_url: legacy.part4.presentation.audio_url ?? null,
    };
  }
  if (legacy.part4?.followUps?.length === 2) {
    base.part4.follow_ups = legacy.part4.followUps.map((f) =>
      timedPrompt(f.content?.trim() || f.title || '', SPEAKING_SET_DEFAULTS.timers.part4FollowUp, f.audio_url ?? null),
    );
  }

  return base;
}

export function validateSpeakingSetStructure(structure: SpeakingSetStructure): string | null {
  const s = normalizeSpeakingSetStructure(structure);

  for (const [i, q] of s.part1.questions.entries()) {
    if (!q.text.trim()) return `Part 1 Question ${i + 1} text is required.`;
  }
  for (const [i, q] of s.part2.role_plays.entries()) {
    if (!q.text.trim()) return `Part 2 Role Play ${i + 1} situation text is required.`;
  }
  if (!s.part3.read_aloud_text.trim()) return 'Part 3 read aloud text is required.';
  if (!s.part3.follow_up.text.trim()) return 'Part 3 follow-up question is required.';
  if (!s.part4.presentation_topic.text.trim()) return 'Part 4 presentation topic is required.';
  for (const [i, q] of s.part4.follow_ups.entries()) {
    if (!q.text.trim()) return `Part 4 Follow-up ${i + 1} text is required.`;
  }
  return null;
}

function resolvePromptAudio(audioUrl: string | null | undefined, seed: number): string | null {
  if (!audioUrl?.trim()) return null;
  return resolveSpeakingAudioUrl(audioUrl, seed);
}

export function resolveSetStructureAudio(structure: SpeakingSetStructure): SpeakingSetStructure {
  const s = normalizeSpeakingSetStructure(structure);
  const resolveTA = (ta: SpeakingTextAudio, seed: number): SpeakingTextAudio => ({
    ...ta,
    audio_url: ta.audio_url?.trim() ? resolvePromptAudio(ta.audio_url, seed) ?? ta.audio_url : null,
  });
  const resolveTP = (tp: SpeakingTimedPrompt, seed: number): SpeakingTimedPrompt => ({
    ...tp,
    audio_url: tp.audio_url?.trim() ? resolvePromptAudio(tp.audio_url, seed) ?? tp.audio_url : null,
  });

  return {
    ...s,
    general_intro: resolveTA(s.general_intro, 1),
    part1: {
      ...s.part1,
      examiner_instruction: resolveTA(s.part1.examiner_instruction, 10),
      questions: s.part1.questions.map((q, i) => resolveTP(q, 11 + i)),
    },
    part2: {
      ...s.part2,
      examiner_instruction: resolveTA(s.part2.examiner_instruction, 20),
      role_plays: s.part2.role_plays.map((q, i) => resolveTP(q, 21 + i)),
    },
    part3: {
      ...s.part3,
      examiner_instruction: resolveTA(s.part3.examiner_instruction, 30),
      read_aloud_start: resolveTA(s.part3.read_aloud_start, 31),
      follow_up: resolveTP(s.part3.follow_up, 32),
    },
    part4: {
      ...s.part4,
      examiner_instruction: resolveTA(s.part4.examiner_instruction, 40),
      presentation_topic: resolveTA(s.part4.presentation_topic, 41),
      preparation_start: resolveTA(s.part4.preparation_start, 42),
      presentation_start: resolveTA(s.part4.presentation_start, 43),
      follow_ups: s.part4.follow_ups.map((q, i) => resolveTP(q, 44 + i)),
      ending: resolveTA(s.part4.ending, 50),
    },
  };
}
