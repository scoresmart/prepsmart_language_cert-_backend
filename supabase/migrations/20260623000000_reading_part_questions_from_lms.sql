-- Migration: Create reading_part_questions table and import data from LMS
-- The LMS stored reading questions inside writing_task_questions with task_type like 'reading_part_1a'.
-- This migration creates a proper reading_part_questions table and migrates that data across.

-- ── 1. Create table ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.reading_part_questions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  part_type   TEXT NOT NULL CHECK (part_type IN ('part1a', 'part1b', 'part2', 'part3', 'part4')),
  title       TEXT NOT NULL DEFAULT '',
  passage     TEXT,
  image_path  TEXT,
  questions   JSONB,
  word_bank   JSONB,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_by  UUID REFERENCES public.profiles(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS reading_part_questions_part_type_idx
  ON public.reading_part_questions (part_type, is_active);

-- ── 2. RLS ─────────────────────────────────────────────────────────────────────

ALTER TABLE public.reading_part_questions ENABLE ROW LEVEL SECURITY;

-- Authenticated users can view active questions
CREATE POLICY "Authenticated users can view reading questions"
  ON public.reading_part_questions FOR SELECT
  TO authenticated
  USING (is_active = true);

-- Admins and tutors can view all (including inactive)
CREATE POLICY "Admins and tutors can view all reading questions"
  ON public.reading_part_questions FOR SELECT
  TO authenticated
  USING (
    (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('admin', 'tutor')
  );

-- Admins and tutors can insert
CREATE POLICY "Admins and tutors can insert reading questions"
  ON public.reading_part_questions FOR INSERT
  TO authenticated
  WITH CHECK (
    (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('admin', 'tutor')
  );

-- Admins and tutors can update
CREATE POLICY "Admins and tutors can update reading questions"
  ON public.reading_part_questions FOR UPDATE
  TO authenticated
  USING (
    (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('admin', 'tutor')
  );

-- Only admins can delete
CREATE POLICY "Admins can delete reading questions"
  ON public.reading_part_questions FOR DELETE
  TO authenticated
  USING (
    (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin'
  );

-- ── 3. Migrate reading data from LMS writing_task_questions ───────────────────
-- LMS stored reading parts in writing_task_questions with task_type values:
--   reading_part_1a → part1a
--   reading_part_1b → part1b
--   reading_part_2  → part2
--   reading_part_3  → part3
--   reading_part_4  → part4
--
-- question_text  → title (instruction / passage title / passage text)
-- image_path     → questions (JSON string of question objects, stored in image_path column)

INSERT INTO public.reading_part_questions (
  id,
  part_type,
  title,
  passage,
  questions,
  created_by,
  created_at,
  updated_at,
  is_active
)
SELECT
  id,
  REPLACE(task_type, 'reading_part_', 'part') AS part_type,
  question_text                                AS title,
  question_text                                AS passage,
  CASE
    WHEN image_path IS NOT NULL AND image_path <> ''
    THEN image_path::jsonb
    ELSE '[]'::jsonb
  END                                          AS questions,
  created_by,
  created_at,
  updated_at,
  true                                         AS is_active
FROM public.writing_task_questions
WHERE task_type LIKE 'reading_part_%'
ON CONFLICT (id) DO NOTHING;
