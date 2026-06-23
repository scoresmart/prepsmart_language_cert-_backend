ALTER TABLE practice_attempts
  ADD COLUMN IF NOT EXISTS scoring_status TEXT
    NOT NULL DEFAULT 'completed'
    CHECK (scoring_status IN ('pending','scoring','completed','failed'));

ALTER TABLE reading_part_questions
  ADD COLUMN IF NOT EXISTS answer_key JSONB DEFAULT '[]'::jsonb;

ALTER TABLE listening_part_questions
  ADD COLUMN IF NOT EXISTS answer_key JSONB DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS idx_practice_attempts_scoring_status
  ON practice_attempts (scoring_status);
