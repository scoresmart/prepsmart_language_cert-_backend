-- Dedicated speaking question for Azure STT + Claude scoring API testing.
INSERT INTO public.speaking_part_questions
  (part_number, task_type, title, level, content, audio_url, image_url, max_score, is_published, created_at)
VALUES (
  1,
  'speaking_part_1_azure_test',
  'Azure API Test — Introduce Yourself',
  'B1',
  'Listen to the examiner, then introduce yourself. Say your name, where you are from, and one hobby you enjoy. Speak clearly for at least 10 seconds so Azure can transcribe your answer.',
  'https://samplelib.com/lib/preview/mp3/sample-6s.mp3',
  NULL,
  90,
  true,
  '2020-01-01T00:00:00Z'::timestamptz
)
ON CONFLICT DO NOTHING;

-- Keep Azure test first in Speaking Part 1 list (ordered by created_at).
UPDATE public.speaking_part_questions
SET
  title = 'Azure API Test — Introduce Yourself',
  level = 'B1',
  content = 'Listen to the examiner, then introduce yourself. Say your name, where you are from, and one hobby you enjoy. Speak clearly for at least 10 seconds so Azure can transcribe your answer.',
  audio_url = 'https://samplelib.com/lib/preview/mp3/sample-6s.mp3',
  max_score = 90,
  is_published = true,
  created_at = '2020-01-01T00:00:00Z'::timestamptz,
  updated_at = now()
WHERE task_type = 'speaking_part_1_azure_test';
