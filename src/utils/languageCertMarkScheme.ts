/**
 * Official LanguageCert International ESOL (IESOL) Mark Schemes
 * Extracted from the official "Assessing Writing/Speaking Performance" PDFs.
 *
 * Writing: 4 criteria × 0–3 marks = 12 marks per task
 * Speaking: 4 criteria × 0–3 marks = 12 marks → scaled to 50
 * Reading/Listening: 1 mark per correct answer (objective)
 */

export type CEFRLevel = 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2';

export interface BandDescriptor {
  band: 0 | 1 | 2 | 3;
  taskFulfilment: string;
  grammar: string;
  vocabulary: string;
  organisation: string;
}

export interface WritingMarkScheme {
  level: CEFRLevel;
  marksPerTask: 12;
  criteria: ['Task Fulfilment', 'Accuracy & Range of Grammar', 'Accuracy & Range of Vocabulary', 'Organisation'];
  bands: BandDescriptor[];
  notes: string;
}

// ─── Writing Mark Schemes ─────────────────────────────────────────────────────

export const WRITING_MARK_SCHEMES: Record<CEFRLevel, WritingMarkScheme> = {
  A1: {
    level: 'A1',
    marksPerTask: 12,
    criteria: ['Task Fulfilment', 'Accuracy & Range of Grammar', 'Accuracy & Range of Vocabulary', 'Organisation'],
    bands: [
      {
        band: 3,
        taskFulfilment:
          'Task 1: Four complete sentences on topic. Task 2: Both content points covered and clearly communicated.',
        grammar:
          'Mostly accurate use of A1 grammar (simple present tense expected); when language above level is attempted, errors occur.',
        vocabulary:
          'Adequate range of very basic vocabulary to transmit meaning; when above-level vocabulary attempted, errors occur.',
        organisation:
          'Text organisation appropriate (in sentences); appropriate punctuation (capital letters and full stops). Task 2: With salutation and close.',
      },
      {
        band: 2,
        taskFulfilment:
          'Task 1: Three complete sentences on topic, or three/four points in extended text. Task 2: Both content points covered and communicated, but with some difficulty.',
        grammar:
          'A1 grammar used, but some serious errors occur; meaning is still usually clear.',
        vocabulary:
          'Meaning usually clear, despite limited range; some serious errors with A1 vocabulary usage and spelling.',
        organisation:
          'Text organisation mostly appropriate (mostly in sentences); some accurate punctuation.',
      },
      {
        band: 1,
        taskFulfilment:
          'Task 1: Two separate sentences/points on topic. Task 2: Mentions one content point, or both points with unsuccessful communication.',
        grammar:
          'Many serious errors; difficult to understand meaning.',
        vocabulary:
          'Range too limited, difficult to understand meaning; many serious errors with A1 vocabulary and spelling.',
        organisation:
          'A series of phrases, not sentences; little correct punctuation.',
      },
      {
        band: 0,
        taskFulfilment: 'One or zero sentences/points on topic; or off topic.',
        grammar: 'Very little or no coherent usage.',
        vocabulary: 'Vocabulary usage or spelling so poor that it is impossible to follow.',
        organisation: 'No structure; no punctuation.',
      },
    ],
    notes:
      'Word count: Task 1 ≈30 words, Task 2 20–30 words. Under-length taken into account for Task Fulfilment. American or British spelling accepted.',
  },

  A2: {
    level: 'A2',
    marksPerTask: 12,
    criteria: ['Task Fulfilment', 'Accuracy & Range of Grammar', 'Accuracy & Range of Vocabulary', 'Organisation'],
    bands: [
      {
        band: 3,
        taskFulfilment:
          'Covers all 3 content points and message is clear for recipient.',
        grammar:
          'Mostly accurate use of A2 grammar; when language above level is attempted, errors occur.',
        vocabulary:
          'Adequate range of A2 vocabulary and spelling to clearly transmit meaning; when above-level vocabulary attempted, errors occur.',
        organisation:
          'Text organisation appropriate (in sentences); coherent text; accurate basic punctuation.',
      },
      {
        band: 2,
        taskFulfilment:
          'Covers 3 content points (message mainly clear) OR covers 2 content points clearly communicated.',
        grammar:
          'A2 grammar used but with some serious errors; meaning still usually clear despite errors.',
        vocabulary:
          'Meaning usually clear despite limited range of vocabulary and/or spelling; some serious errors with A2 vocabulary and spelling.',
        organisation:
          'Text organisation mostly appropriate (mainly uses sentences correctly); mostly coherent; mostly accurate punctuation.',
      },
      {
        band: 1,
        taskFulfilment:
          'Covers 2 content points (message mainly clear for recipient) OR covers 1 content point.',
        grammar:
          'Many serious errors; often difficult to understand meaning.',
        vocabulary:
          'Range and/or spelling so limited that it is often difficult to understand meaning; many serious errors with A2 vocabulary and spelling.',
        organisation:
          'A series of phrases, not sentences; mostly incoherent; little correct punctuation.',
      },
      {
        band: 0,
        taskFulfilment: "Doesn't communicate OR off topic.",
        grammar: 'Grammar so poor that message cannot be understood.',
        vocabulary: 'Vocabulary usage and/or spelling so poor that message cannot be understood.',
        organisation: 'No organisation or coherence.',
      },
    ],
    notes:
      'Word count: Task 1 30–50 words, Task 2 30–50 words. American or British spelling accepted.',
  },

  B1: {
    level: 'B1',
    marksPerTask: 12,
    criteria: ['Task Fulfilment', 'Accuracy & Range of Grammar', 'Accuracy & Range of Vocabulary', 'Organisation'],
    bands: [
      {
        band: 3,
        taskFulfilment:
          'Communication of both content points is fully achieved.',
        grammar:
          'Mostly accurate use of B1 grammar; when language above level is attempted, errors occur.',
        vocabulary:
          'Adequate range of vocabulary to transmit meaning; when above-level vocabulary attempted, errors occur.',
        organisation:
          'Text is generally well-organised and coherent, using a variety of linkers and cohesive devices; very few punctuation errors.',
      },
      {
        band: 2,
        taskFulfilment:
          'Covers both content points and communication is mainly achieved.',
        grammar:
          'Some errors with B1 grammar, but generally good control; meaning is usually clear despite errors.',
        vocabulary:
          'Meaning usually clear despite a more limited range of vocabulary and/or spelling errors.',
        organisation:
          'Text is mainly coherent, using basic linkers and some cohesive devices; some punctuation errors that don\'t impede communication.',
      },
      {
        band: 1,
        taskFulfilment:
          'Covers both content points, but communication often breaks down OR communication of only one content point.',
        grammar:
          'Many serious errors with B1 grammar; message often difficult to understand; range of grammar below that expected at B1.',
        vocabulary:
          'Range and/or spelling too limited for B1 so that message is often difficult to understand; many serious errors.',
        organisation:
          'Mostly incoherent, with little use of cohesive devices; organisation and punctuation errors make text difficult to follow.',
      },
      {
        band: 0,
        taskFulfilment: 'Communication fails OR off topic.',
        grammar: 'Errors so serious that communication fails.',
        vocabulary: 'Vocabulary usage and/or spelling so poor that message cannot be understood.',
        organisation: 'No organisation or coherence.',
      },
    ],
    notes:
      'Word count: Task 1 70–100 words, Task 2 100–120 words. American or British spelling accepted.',
  },

  B2: {
    level: 'B2',
    marksPerTask: 12,
    criteria: ['Task Fulfilment', 'Accuracy & Range of Grammar', 'Accuracy & Range of Vocabulary', 'Organisation'],
    bands: [
      {
        band: 3,
        taskFulfilment:
          'Task 1: Fully addresses and confidently communicates all 3 content points; genre and tone appropriate. Task 2: Fully addresses and communicates both content points; genre and tone appropriate.',
        grammar:
          'Uses a range of simple and complex forms with control and flexibility; errors do not impede communication.',
        vocabulary:
          'Uses a range of vocabulary, including less common items, appropriately; errors do not impede communication.',
        organisation:
          'Text is well-organised and coherent, using a variety of cohesive devices; organisation fully appropriate to text type; few, if any, punctuation errors.',
      },
      {
        band: 2,
        taskFulfilment:
          'Task 1: Covers at least 2 content points with some expansion, mainly achieved; genre and tone mostly appropriate. Task 2: Covers both content points with some expansion, mainly achieved; genre and tone mostly appropriate.',
        grammar:
          'Uses simple and some complex forms with a good degree of control; errors do not impede meaning, but may cause re-reading.',
        vocabulary:
          'Uses a range of everyday vocabulary accurately, with occasional misuse of less common items; errors do not impede meaning, but may cause re-reading.',
        organisation:
          'Text is generally well-organised and coherent using a variety of linking words and cohesive devices; organisation mainly appropriate to text type; some punctuation errors that don\'t impede communication.',
      },
      {
        band: 1,
        taskFulfilment:
          'Task 1: Communication of 2/3 content points minimally achieved OR communication of only one. Task 2: Communication minimally achieved OR only one content point.',
        grammar:
          'Uses limited range of simple forms with control; some serious basic errors which may impede meaning.',
        vocabulary:
          'Uses everyday vocabulary generally appropriately, while overusing certain common items; some serious basic errors with vocabulary and/or spelling which may impede meaning.',
        organisation:
          'Text connected using basic linking words and a limited range of cohesive devices; organisation and/or paragraphing inappropriate; punctuation errors.',
      },
      {
        band: 0,
        taskFulfilment: 'Communication fails OR off topic.',
        grammar: 'Errors so serious that communication fails.',
        vocabulary: 'Vocabulary usage and/or spelling so poor that communication fails.',
        organisation: 'Little, or no, organisation or coherence.',
      },
    ],
    notes:
      'Word count: Task 1 100–150 words, Task 2 150–200 words. American or British spelling accepted.',
  },

  C1: {
    level: 'C1',
    marksPerTask: 12,
    criteria: ['Task Fulfilment', 'Accuracy & Range of Grammar', 'Accuracy & Range of Vocabulary', 'Organisation'],
    bands: [
      {
        band: 3,
        taskFulfilment:
          'Fully & appropriately satisfies task; target reader wholly informed; genre/tone totally appropriate.',
        grammar:
          'Wide range of simple & complex forms, full control & flexibility; errors are slips only.',
        vocabulary:
          'Effectively & precisely uses range including less common items; errors only with less common items.',
        organisation:
          'Well-organised, fully coherent, wide variety of cohesive devices with flexibility; fully appropriate to text type.',
      },
      {
        band: 2,
        taskFulfilment:
          'Mainly satisfies task; reader on the whole informed; genre/tone mostly appropriate.',
        grammar:
          'Range of simple & complex forms with control; occasional errors don\'t impede meaning.',
        vocabulary:
          'Range including less common items appropriately; occasional errors don\'t impede meaning.',
        organisation:
          'Well-organised & coherent using variety of cohesive devices; organisation mainly appropriate.',
      },
      {
        band: 1,
        taskFulfilment:
          'Partially satisfies task; reader partially informed; genre/tone mostly appropriate.',
        grammar:
          'Range of simple & some complex with good degree of control; errors occasionally impede.',
        vocabulary:
          'Everyday vocabulary appropriately used; occasional inappropriate less common items; errors occasionally impede.',
        organisation:
          'Generally well-organised; basic linking words; some inappropriate paragraphing or punctuation.',
      },
      {
        band: 0,
        taskFulfilment: 'Does not satisfy task / off-topic.',
        grammar: 'Basic grammar repertoire; errors noticeably impede.',
        vocabulary: 'Basic vocabulary; errors noticeably impede.',
        organisation: 'Little or no organisation or coherence.',
      },
    ],
    notes:
      'Word count: Task 1 150–200 words, Task 2 200–250 words. American or British spelling accepted.',
  },

  C2: {
    level: 'C2',
    marksPerTask: 12,
    criteria: ['Task Fulfilment', 'Accuracy & Range of Grammar', 'Accuracy & Range of Vocabulary', 'Organisation'],
    bands: [
      {
        band: 3,
        taskFulfilment:
          'Fully & appropriately satisfies task; target reader wholly informed; genre/tone totally appropriate.',
        grammar:
          'Fully controlled, sophisticated & assured; very few errors, only slips.',
        vocabulary:
          'Wide range including less common items, with fluency & sophistication to give style; very few errors.',
        organisation:
          'Organised impressively, fully coherent, wide range of cohesive devices with flexibility; fully appropriate to text type.',
      },
      {
        band: 2,
        taskFulfilment:
          'Mainly satisfies task; reader on the whole informed; genre/tone almost always appropriate.',
        grammar:
          'Wide range of simple & complex with full control & flexibility; few errors don\'t impede.',
        vocabulary:
          'Range including less common items, effectively & precisely; few errors don\'t impede.',
        organisation:
          'Well-organised & coherent, variety of cohesive devices with flexibility; mostly appropriate.',
      },
      {
        band: 1,
        taskFulfilment:
          'Partially satisfies task; reader partially informed; genre/tone mostly appropriate.',
        grammar:
          'Range of simple & complex with control; occasional errors very rarely impede.',
        vocabulary:
          'Range including less common, appropriately; occasional errors very rarely impede.',
        organisation:
          'Well-organised & coherent; range of cohesive devices; some inappropriate paragraphing or punctuation.',
      },
      {
        band: 0,
        taskFulfilment: 'Does not satisfy task / off-topic.',
        grammar: 'Basic repertoire; errors impede communication.',
        vocabulary: 'Basic repertoire; errors impede communication.',
        organisation: 'Little or no organisation or coherence.',
      },
    ],
    notes:
      'Word count: Task 1 200–250 words, Task 2 250–300 words. American or British spelling accepted.',
  },
};

// ─── Speaking Mark Schemes ────────────────────────────────────────────────────

export interface SpeakingBandDescriptor {
  band: 0 | 1 | 2 | 3;
  taskFulfilmentCoherence: string;
  grammar: string;
  vocabulary: string;
  pronunciationFluency: string;
}

export interface SpeakingMarkScheme {
  level: CEFRLevel;
  rawMarks: 12;
  scaledTo: 50;
  criteria: ['Task Fulfilment & Coherence', 'Accuracy & Range of Grammar', 'Accuracy & Range of Vocabulary', 'Pronunciation, Intonation & Fluency'];
  bands: SpeakingBandDescriptor[];
}

export const SPEAKING_MARK_SCHEMES: Record<CEFRLevel, SpeakingMarkScheme> = {
  A1: {
    level: 'A1',
    rawMarks: 12,
    scaledTo: 50,
    criteria: ['Task Fulfilment & Coherence', 'Accuracy & Range of Grammar', 'Accuracy & Range of Vocabulary', 'Pronunciation, Intonation & Fluency'],
    bands: [
      {
        band: 3,
        taskFulfilmentCoherence: 'Candidate consistently completes A1 tasks; links utterances using basic connectors.',
        grammar: 'Uses a range of A1 level grammar with control; errors do not impede communication.',
        vocabulary: 'Uses a range of A1 level vocabulary appropriately to complete tasks.',
        pronunciationFluency: 'Generally intelligible despite first-language features; speaks with some hesitation.',
      },
      {
        band: 2,
        taskFulfilmentCoherence: 'Candidate completes most A1 tasks; some breakdown in coherence.',
        grammar: 'A1 grammar is used but with some serious errors; meaning generally clear.',
        vocabulary: 'A1 vocabulary is used, with occasional difficulties finding words.',
        pronunciationFluency: 'Intelligible to a sympathetic listener; noticeable L1 features; hesitation may impede communication.',
      },
      {
        band: 1,
        taskFulfilmentCoherence: 'Candidate partially completes A1 tasks; limited coherence.',
        grammar: 'Very limited control of A1 grammar; errors frequently impede communication.',
        vocabulary: 'Very limited A1 vocabulary; frequent searching for words impedes communication.',
        pronunciationFluency: 'Difficult to understand; heavy L1 accent; frequent long pauses.',
      },
      {
        band: 0,
        taskFulfilmentCoherence: 'Cannot complete tasks; no meaningful communication.',
        grammar: 'No control of grammar; cannot communicate.',
        vocabulary: 'Insufficient vocabulary; cannot communicate.',
        pronunciationFluency: 'Not intelligible.',
      },
    ],
  },

  A2: {
    level: 'A2',
    rawMarks: 12,
    scaledTo: 50,
    criteria: ['Task Fulfilment & Coherence', 'Accuracy & Range of Grammar', 'Accuracy & Range of Vocabulary', 'Pronunciation, Intonation & Fluency'],
    bands: [
      {
        band: 3,
        taskFulfilmentCoherence: 'Candidate consistently completes A2 tasks; links utterances using basic connectors with good coherence.',
        grammar: 'Uses a range of A2 level grammar with control; errors do not impede communication.',
        vocabulary: 'Uses a range of A2 level vocabulary accurately to complete tasks.',
        pronunciationFluency: 'Generally intelligible despite L1 features; speaks with manageable hesitation.',
      },
      {
        band: 2,
        taskFulfilmentCoherence: 'Candidate completes most A2 tasks; some coherence breakdown.',
        grammar: 'A2 grammar used with some errors; meaning usually clear.',
        vocabulary: 'A2 vocabulary used, with occasional word-finding difficulties.',
        pronunciationFluency: 'Intelligible to sympathetic listener despite L1 features; some hesitation.',
      },
      {
        band: 1,
        taskFulfilmentCoherence: 'Candidate partially completes A2 tasks; limited coherence.',
        grammar: 'Limited control; errors impede communication.',
        vocabulary: 'Limited A2 vocabulary; frequent search for words.',
        pronunciationFluency: 'Difficult to understand; heavy L1 features; significant pauses.',
      },
      {
        band: 0,
        taskFulfilmentCoherence: 'Cannot complete tasks.',
        grammar: 'No control.',
        vocabulary: 'Insufficient vocabulary.',
        pronunciationFluency: 'Not intelligible.',
      },
    ],
  },

  B1: {
    level: 'B1',
    rawMarks: 12,
    scaledTo: 50,
    criteria: ['Task Fulfilment & Coherence', 'Accuracy & Range of Grammar', 'Accuracy & Range of Vocabulary', 'Pronunciation, Intonation & Fluency'],
    bands: [
      {
        band: 3,
        taskFulfilmentCoherence: 'Candidate consistently completes B1 tasks; communicates ideas coherently; uses a range of B1 level cohesive devices.',
        grammar: 'Uses a relatively good range of B1 level grammar with control; errors do not impede communication.',
        vocabulary: 'Uses a range of B1 level vocabulary to deal with the tasks; errors do not impede meaning.',
        pronunciationFluency: 'Generally intelligible; some L1 features present but do not impede; speaks with some fluency.',
      },
      {
        band: 2,
        taskFulfilmentCoherence: 'Candidate completes most B1 level tasks; generally coherent with use of B1 level cohesive devices.',
        grammar: 'A range of B1 level grammar with some errors; meaning usually clear.',
        vocabulary: 'A range of B1 level vocabulary; some errors do not impede meaning.',
        pronunciationFluency: 'Intelligible; some L1 features; some hesitation but does not impede.',
      },
      {
        band: 1,
        taskFulfilmentCoherence: 'Candidate partially completes B1 level tasks; limited coherence.',
        grammar: 'Limited B1 grammar; errors impede communication.',
        vocabulary: 'Limited B1 vocabulary; word-finding difficulties impede.',
        pronunciationFluency: 'Difficult to understand at times; heavy L1 features; frequent hesitation.',
      },
      {
        band: 0,
        taskFulfilmentCoherence: 'Cannot complete tasks; production of B1 level language absent.',
        grammar: 'No control; communication fails.',
        vocabulary: 'Insufficient vocabulary.',
        pronunciationFluency: 'Not intelligible.',
      },
    ],
  },

  B2: {
    level: 'B2',
    rawMarks: 12,
    scaledTo: 50,
    criteria: ['Task Fulfilment & Coherence', 'Accuracy & Range of Grammar', 'Accuracy & Range of Vocabulary', 'Pronunciation, Intonation & Fluency'],
    bands: [
      {
        band: 3,
        taskFulfilmentCoherence: 'Candidate consistently completes B2 tasks; uses B2 level cohesive devices; creates clear, coherent discourse.',
        grammar: 'Uses a range of B2 level structures with a relatively good degree of control; errors do not impede communication.',
        vocabulary: 'Uses a range of vocabulary at B2 level to deal with the tasks; wide range appropriately used.',
        pronunciationFluency: 'Clear pronunciation and intonation; mostly fluent; L1 features present but do not impede; little strain on listener.',
      },
      {
        band: 2,
        taskFulfilmentCoherence: 'Candidate completes most B2 level tasks; generally coherent with use of B2 level cohesive devices.',
        grammar: 'A good range of B2 level grammar; some errors do not impede meaning.',
        vocabulary: 'A good range of B2 vocabulary; some errors do not impede meaning.',
        pronunciationFluency: 'Clear; generally fluent; some hesitation; some L1 features.',
      },
      {
        band: 1,
        taskFulfilmentCoherence: 'Candidate partially completes B2 level tasks; limited coherence.',
        grammar: 'Limited B2 grammar range; errors sometimes impede communication.',
        vocabulary: 'Limited B2 vocabulary range; errors sometimes impede.',
        pronunciationFluency: 'Sometimes difficult to understand; L1 features impede; hesitation impedes.',
      },
      {
        band: 0,
        taskFulfilmentCoherence: 'Cannot complete tasks.',
        grammar: 'No control at B2 level.',
        vocabulary: 'Insufficient vocabulary at B2 level.',
        pronunciationFluency: 'Not intelligible.',
      },
    ],
  },

  C1: {
    level: 'C1',
    rawMarks: 12,
    scaledTo: 50,
    criteria: ['Task Fulfilment & Coherence', 'Accuracy & Range of Grammar', 'Accuracy & Range of Vocabulary', 'Pronunciation, Intonation & Fluency'],
    bands: [
      {
        band: 3,
        taskFulfilmentCoherence: 'Engages in complex discussion with independence; expresses & defends views on abstract topics; fully coherent.',
        grammar: 'Wide range of complex structures with good control; errors rare and don\'t impede.',
        vocabulary: 'Precise use of wide vocabulary including idiomatic expressions; errors rare.',
        pronunciationFluency: 'Speaks fluently with only occasional searching for expressions; no strain on listener; clear intonation.',
      },
      {
        band: 2,
        taskFulfilmentCoherence: 'Mostly completes C1 tasks; generally coherent with minor breakdowns.',
        grammar: 'Range of complex structures; occasional errors don\'t impede.',
        vocabulary: 'Wide vocabulary including some idiomatic use; occasional errors.',
        pronunciationFluency: 'Mostly fluent; mostly clear; occasional hesitation.',
      },
      {
        band: 1,
        taskFulfilmentCoherence: 'Partially completes C1 tasks; some incoherence.',
        grammar: 'Some complex structures with limited control; errors occasionally impede.',
        vocabulary: 'Some complex vocabulary; errors occasionally impede.',
        pronunciationFluency: 'Some difficulty; L1 features; hesitation impedes at times.',
      },
      {
        band: 0,
        taskFulfilmentCoherence: 'Cannot complete C1 tasks.',
        grammar: 'Insufficient control at C1 level.',
        vocabulary: 'Insufficient vocabulary at C1 level.',
        pronunciationFluency: 'Not intelligible at C1 standard.',
      },
    ],
  },

  C2: {
    level: 'C2',
    rawMarks: 12,
    scaledTo: 50,
    criteria: ['Task Fulfilment & Coherence', 'Accuracy & Range of Grammar', 'Accuracy & Range of Vocabulary', 'Pronunciation, Intonation & Fluency'],
    bands: [
      {
        band: 3,
        taskFulfilmentCoherence: 'Conveys precise meaning in complex topics; fully nuanced interaction; restructures with no impact on communication.',
        grammar: 'Full control and sophistication; errors are rare slips only.',
        vocabulary: 'Fluent, natural, sophisticated vocabulary with style; very few errors; no impact on communication.',
        pronunciationFluency: 'Speaks with natural fluency; clear articulation and intonation; no strain on listener.',
      },
      {
        band: 2,
        taskFulfilmentCoherence: 'Mostly conveys precise meaning; mostly coherent.',
        grammar: 'Full control with very few errors.',
        vocabulary: 'Wide sophisticated vocabulary; very few errors.',
        pronunciationFluency: 'Very fluent; very clear; negligible L1 features.',
      },
      {
        band: 1,
        taskFulfilmentCoherence: 'Partially achieves C2 tasks; limited nuance.',
        grammar: 'Wide range but occasional errors.',
        vocabulary: 'Wide range but occasional errors.',
        pronunciationFluency: 'Generally clear; occasional L1 features.',
      },
      {
        band: 0,
        taskFulfilmentCoherence: 'Cannot complete C2 tasks.',
        grammar: 'Insufficient control at C2 level.',
        vocabulary: 'Insufficient vocabulary at C2 level.',
        pronunciationFluency: 'Not intelligible at C2 standard.',
      },
    ],
  },
};

// ─── Grading Thresholds ───────────────────────────────────────────────────────

export const GRADING_THRESHOLDS = {
  writtenExam: {
    // Listening + Reading + Writing combined (out of 150)
    pass: { min: 75, max: 100 },
    highPass: { min: 101, max: 150 },
  },
  speaking: {
    // Out of 50
    pass: { min: 25, max: 37 },
    highPass: { min: 38, max: 50 },
  },
};

// ─── Helper: scale speaking score ────────────────────────────────────────────

/** Scale raw speaking score (0–12) to LanguageCert's 0–50 band */
export function scaleSpeakingScore(rawScore: number): number {
  return Math.round((rawScore / 12) * 50);
}

/** Return grade label for a writing task score (0–12) */
export function writingGradeLabel(score: number): string {
  if (score >= 10) return 'High Pass';
  if (score >= 6) return 'Pass';
  return 'Below Pass';
}
