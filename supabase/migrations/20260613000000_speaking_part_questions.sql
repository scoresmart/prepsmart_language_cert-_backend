-- Speaking practice questions (LanguageCert SELT)
CREATE TABLE IF NOT EXISTS public.speaking_part_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  part_number integer NOT NULL CHECK (part_number BETWEEN 1 AND 4),
  task_type text NOT NULL,
  title text NOT NULL DEFAULT '',
  level text NOT NULL DEFAULT 'B1',
  content text,
  audio_url text,
  image_url text,
  max_score integer NOT NULL DEFAULT 90,
  is_published boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS speaking_part_questions_part_idx
  ON public.speaking_part_questions (part_number, is_published);

ALTER TABLE public.speaking_part_questions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Students can view published speaking questions" ON public.speaking_part_questions;
CREATE POLICY "Students can view published speaking questions"
  ON public.speaking_part_questions FOR SELECT
  USING (is_published = true OR auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Admins can manage speaking questions" ON public.speaking_part_questions;
CREATE POLICY "Admins can manage speaking questions"
  ON public.speaking_part_questions FOR ALL
  USING (
    (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin'::app_role
  );
