-- Normalize speaking questions to part-only task types (no sub-tasks)
UPDATE public.speaking_part_questions
SET
  task_type = 'speaking_part_' || part_number::text,
  updated_at = now()
WHERE task_type ~ '^speaking_part_[0-9]+(_task_|_)';

UPDATE public.speaking_part_questions
SET
  task_type = 'speaking_part_' || part_number::text,
  updated_at = now()
WHERE task_type LIKE 'speaking_part_%'
  AND task_type <> ('speaking_part_' || part_number::text);
