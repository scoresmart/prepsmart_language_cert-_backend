-- Align speaking max_score with LanguageCert IESOL scale (0–50)
UPDATE public.speaking_part_questions
SET max_score = 50
WHERE max_score = 90;

ALTER TABLE public.speaking_part_questions
  ALTER COLUMN max_score SET DEFAULT 50;
