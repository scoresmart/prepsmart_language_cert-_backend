// Certification types
export type CertificationType = 'PTE' | 'IELTS' | 'TOEFL' | 'DUOLINGO';

// Skill sections
export type SkillSection = 'SPEAKING' | 'WRITING' | 'READING' | 'LISTENING';

// Question types per certification
export type QuestionType =
  // PTE Speaking
  | 'READ_ALOUD'
  | 'REPEAT_SENTENCE'
  | 'DESCRIBE_IMAGE'
  | 'RETELL_LECTURE'
  | 'ANSWER_SHORT_QUESTION'
  // PTE Writing
  | 'SUMMARIZE_WRITTEN_TEXT'
  | 'WRITE_ESSAY'
  // PTE Reading
  | 'MULTIPLE_CHOICE_SINGLE'
  | 'MULTIPLE_CHOICE_MULTIPLE'
  | 'REORDER_PARAGRAPHS'
  | 'FILL_IN_THE_BLANKS_READING'
  | 'FILL_IN_THE_BLANKS_READING_WRITING'
  // PTE Listening
  | 'SUMMARIZE_SPOKEN_TEXT'
  | 'MULTIPLE_CHOICE_SINGLE_LISTENING'
  | 'FILL_IN_THE_BLANKS_LISTENING'
  | 'HIGHLIGHT_CORRECT_SUMMARY'
  | 'SELECT_MISSING_WORD'
  | 'HIGHLIGHT_INCORRECT_WORDS'
  | 'WRITE_FROM_DICTATION'
  // IELTS / TOEFL / Generic
  | 'TASK1_ACADEMIC'
  | 'TASK2_GENERAL'
  | 'INTEGRATED_WRITING'
  | 'INDEPENDENT_WRITING';

export type DifficultyLevel = 'EASY' | 'MEDIUM' | 'HARD';

export type UserRole = 'STUDENT' | 'TEACHER' | 'ADMIN';

export type TestStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED' | 'ABANDONED';

export interface JwtPayload {
  userId: string;
  email: string;
  role: UserRole;
  iat?: number;
  exp?: number;
}

export interface PaginationQuery {
  page?: number;
  limit?: number;
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  message?: string;
  errors?: string[];
}

export interface McpQuestionFilter {
  certification: CertificationType;
  section?: SkillSection;
  questionType?: QuestionType;
  difficulty?: DifficultyLevel;
  limit?: number;
  tags?: string[];
}
