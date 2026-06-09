// ─── Enums matching Supabase DB ───────────────────────────────────────────────

/** Matches app_role enum in Supabase */
export type AppRole = 'admin' | 'tutor' | 'student';

/** Matches subject_type enum in Supabase */
export type SubjectType = 'PTE' | 'NAATI' | 'IELTS' | 'Language Cert';

export type ApprovalStatus = 'pending' | 'approved' | 'rejected';

// ─── Supabase table row types ─────────────────────────────────────────────────

export interface Profile {
  id: string;
  role: AppRole;
  name: string;
  phone: string | null;
  email: string | null;
  username: string | null;
  subject_preferences: SubjectType[] | null;
  first_login_completed: boolean;
  approval_status: ApprovalStatus;
  previous_score: string | null;
  target_score: string | null;
  exam_deadline: string | null;
  has_seen_onboarding: boolean | null;
  timezone: string | null;
  signup_metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

/** writing_task_questions table */
export interface WritingTaskQuestion {
  id: string;
  task_type: 'task1' | 'task2';
  question_text: string;
  image_path: string | null;
  created_by: string | null;
  created_at: string | null;
  updated_at: string | null;
}

/** listening_part_questions table — questions is a JSONB array of question objects */
export interface ListeningQuestion {
  id: string;
  part_number: number;
  audio_path: string | null;
  questions: ListeningSubQuestion[];
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ListeningSubQuestion {
  id?: string;
  text: string;
  options?: string[];
  answer?: string;
  type?: string;
}

/** language_cert_mock_tests table */
export interface LanguageCertMockTest {
  id: string;
  title: string;
  description: string | null;
  listening_part1_id: string | null;
  listening_part2_id: string | null;
  listening_part3_id: string | null;
  listening_part4_id: string | null;
  reading_part1a_id: string | null;
  reading_part1b_id: string | null;
  reading_part2_id: string | null;
  reading_part3_id: string | null;
  reading_part4_id: string | null;
  writing_task1_id: string | null;
  writing_task2_id: string | null;
  is_active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/** language_cert_templates table */
export interface LanguageCertTemplate {
  id: string;
  section: string;
  title: string;
  content: string;
  order_index: number;
  is_active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/** practice_attempts table */
export interface PracticeAttempt {
  id: string;
  student_id: string;
  question_type: string;
  question_set_id: string;
  score: number;
  total: number;
  score_details: Record<string, unknown> | null;
  created_at: string;
}

/** student_access table */
export interface StudentAccess {
  id: string;
  student_id: string;
  subject: SubjectType;
  allow_master: boolean;
  allow_quad: boolean;
  allow_one_to_one: boolean;
  expiry_date: string | null;
  one_to_one_quota: number;
  one_to_one_used: number;
  mock_tests_count: number;
  mock_tests_scores: unknown[] | null;
  status: 'active' | 'paused' | 'expired' | null;
  course_expiry_at: string | null;
  target_score: string | null;
  previous_score: string | null;
  exam_date: string | null;
  created_at: string;
  updated_at: string;
}

// ─── API helpers ──────────────────────────────────────────────────────────────

export interface JwtPayload {
  sub: string;          // Supabase user id
  email?: string;
  role?: AppRole;
  iat?: number;
  exp?: number;
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  message?: string;
  errors?: string[];
}

export interface PaginationQuery {
  page?: number;
  limit?: number;
}
