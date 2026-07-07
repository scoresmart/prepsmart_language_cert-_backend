import { resolveSpeakingAudioUrl } from './speakingTestAudio';

export type SpeakingSetPrompt = {
  title: string;
  content?: string;
  audio_url?: string | null;
  read_text?: string;
  topic?: string;
  image_url?: string | null;
};

export type SpeakingSetPart3 = {
  readAloud: SpeakingSetPrompt & { read_text: string };
  followUps: SpeakingSetPrompt[];
};

export type SpeakingSetPart4 = {
  presentation: SpeakingSetPrompt;
  followUps: SpeakingSetPrompt[];
};

export type SpeakingSetStructure = {
  part1: SpeakingSetPrompt[];
  part2: SpeakingSetPrompt[];
  part3: SpeakingSetPart3;
  part4: SpeakingSetPart4;
};

export type SpeakingPromptKind = 'question' | 'role_play' | 'read_aloud' | 'follow_up' | 'presentation';

export type FlatSpeakingPrompt = SpeakingSetPrompt & {
  kind: SpeakingPromptKind;
  promptIndex: number;
  promptLabel: string;
};

export function emptySpeakingSetStructure(): SpeakingSetStructure {
  return {
    part1: Array.from({ length: 5 }, (_, i) => ({
      title: `Question ${i + 1}`,
      content: '',
      audio_url: null,
    })),
    part2: Array.from({ length: 2 }, (_, i) => ({
      title: `Role play ${i + 1}`,
      content: '',
      audio_url: null,
    })),
    part3: {
      readAloud: {
        title: 'Read aloud',
        read_text: '',
        content: '',
        audio_url: null,
      },
      followUps: [{ title: 'Follow-up 1', content: '', audio_url: null }],
    },
    part4: {
      presentation: {
        title: 'Presentation',
        topic: '',
        content: '',
        audio_url: null,
      },
      followUps: [
        { title: 'Follow-up 1', content: '', audio_url: null },
        { title: 'Follow-up 2', content: '', audio_url: null },
      ],
    },
  };
}

export function validateSpeakingSetStructure(structure: SpeakingSetStructure): string | null {
  if (!structure.part1 || structure.part1.length !== 5) {
    return 'Part 1 must have exactly 5 questions.';
  }
  if (!structure.part2 || structure.part2.length !== 2) {
    return 'Part 2 must have exactly 2 role plays.';
  }
  if (!structure.part3?.readAloud?.read_text?.trim()) {
    return 'Part 3 read-aloud text is required.';
  }
  if (!structure.part3.followUps?.length) {
    return 'Part 3 needs at least one follow-up question.';
  }
  if (!structure.part4?.presentation?.title?.trim()) {
    return 'Part 4 presentation title is required.';
  }
  if (!structure.part4.followUps || structure.part4.followUps.length !== 2) {
    return 'Part 4 must have exactly 2 follow-up questions.';
  }
  for (const [i, p] of structure.part3.followUps.entries()) {
    if (!p.content?.trim() && !p.title?.trim()) {
      return `Part 3 follow-up ${i + 1} needs a question.`;
    }
  }
  for (const [i, p] of structure.part4.followUps.entries()) {
    if (!p.content?.trim() && !p.title?.trim()) {
      return `Part 4 follow-up ${i + 1} needs a question.`;
    }
  }
  return null;
}

export function flattenPartPrompts(part: string | number, structure: SpeakingSetStructure): FlatSpeakingPrompt[] {
  const partNum = typeof part === 'number' ? part : parseInt(part, 10) || 1;

  if (partNum === 1) {
    return structure.part1.map((p, i) => ({
      ...p,
      kind: 'question' as const,
      promptIndex: i,
      promptLabel: `Question ${i + 1} of 5`,
    }));
  }

  if (partNum === 2) {
    return structure.part2.map((p, i) => ({
      ...p,
      kind: 'role_play' as const,
      promptIndex: i,
      promptLabel: `Role play ${i + 1} of 2`,
    }));
  }

  if (partNum === 3) {
    const items: FlatSpeakingPrompt[] = [
      {
        ...structure.part3.readAloud,
        kind: 'read_aloud',
        promptIndex: 0,
        promptLabel: 'Read aloud',
      },
      ...structure.part3.followUps.map((p, i) => ({
        ...p,
        kind: 'follow_up' as const,
        promptIndex: i + 1,
        promptLabel: `Follow-up ${i + 1}`,
      })),
    ];
    return items;
  }

  const items: FlatSpeakingPrompt[] = [
    {
      ...structure.part4.presentation,
      kind: 'presentation',
      promptIndex: 0,
      promptLabel: 'Presentation',
    },
    ...structure.part4.followUps.map((p, i) => ({
      ...p,
      kind: 'follow_up' as const,
      promptIndex: i + 1,
      promptLabel: `Follow-up ${i + 1} of 2`,
    })),
  ];
  return items;
}

function resolvePromptAudio(audioUrl: string | null | undefined, seed: number): string | null {
  if (!audioUrl?.trim()) return null;
  return resolveSpeakingAudioUrl(audioUrl, seed);
}

export function resolveSetStructureAudio(structure: SpeakingSetStructure): SpeakingSetStructure {
  const resolve = (p: SpeakingSetPrompt, seed: number): SpeakingSetPrompt => ({
    ...p,
    audio_url: p.audio_url?.trim()
      ? resolvePromptAudio(p.audio_url, seed) ?? p.audio_url
      : null,
  });

  return {
    part1: structure.part1.map((p, i) => resolve(p, i + 1)),
    part2: structure.part2.map((p, i) => resolve(p, i + 10)),
    part3: {
      readAloud: {
        ...resolve(structure.part3.readAloud, 30),
        read_text: structure.part3.readAloud.read_text,
      },
      followUps: structure.part3.followUps.map((p, i) => resolve(p, 31 + i)),
    },
    part4: {
      presentation: resolve(structure.part4.presentation, 40),
      followUps: structure.part4.followUps.map((p, i) => resolve(p, 41 + i)),
    },
  };
}
