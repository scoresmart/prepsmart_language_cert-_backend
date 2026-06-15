-- Seed speaking practice questions with test audio (same structure for every row).
-- Fields: part_number, task_type, title, level, content, audio_url, image_url, max_score, is_published

UPDATE public.speaking_part_questions
SET audio_url = 'https://samplelib.com/lib/preview/mp3/sample-6s.mp3'
WHERE audio_url IS NULL OR trim(audio_url) = '';

INSERT INTO public.speaking_part_questions
  (part_number, task_type, title, level, content, audio_url, image_url, max_score, is_published)
SELECT *
FROM (VALUES
  (
    1,
    'speaking_part_1_task_1',
    'Visit to Canada',
    'B1',
    'Listen to the examiner, then talk about a visit to Canada. Mention where you went, what you did, and what you enjoyed most.',
    'https://samplelib.com/lib/preview/mp3/sample-6s.mp3',
    NULL::text,
    90,
    true
  ),
  (
    1,
    'speaking_part_1_task_2',
    'Your Daily Routine',
    'B1',
    'Listen to the examiner, then describe your typical daily routine from morning to evening.',
    'https://samplelib.com/lib/preview/mp3/sample-3s.mp3',
    NULL::text,
    90,
    true
  ),
  (
    2,
    'speaking_part_2_task_1',
    'Describe Your Hometown',
    'B1',
    'Listen to the examiner, then describe your hometown. Talk about location, people, and places of interest.',
    'https://samplelib.com/lib/preview/mp3/sample-9s.mp3',
    NULL::text,
    90,
    true
  ),
  (
    2,
    'speaking_part_2_task_2',
    'A Memorable Trip',
    'B2',
    'Listen to the examiner, then describe a memorable trip you have taken and explain why it was special.',
    'https://samplelib.com/lib/preview/mp3/sample-12s.mp3',
    NULL::text,
    90,
    true
  ),
  (
    3,
    'speaking_part_3_task_1',
    'At the Hotel Reception',
    'B1',
    'Listen to the situation, then respond naturally as if you are speaking to the hotel receptionist.',
    'https://samplelib.com/lib/preview/mp3/sample-6s.mp3',
    NULL::text,
    90,
    true
  ),
  (
    3,
    'speaking_part_3_task_2',
    'Booking a Restaurant Table',
    'B2',
    'Listen to the situation, then respond as a customer calling to book a table at a restaurant.',
    'https://samplelib.com/lib/preview/mp3/sample-9s.mp3',
    NULL::text,
    90,
    true
  ),
  (
    4,
    'speaking_part_4_task_1',
    'Technology in Education',
    'B2',
    'Listen to the examiner, then give your opinion on how technology has changed education.',
    'https://samplelib.com/lib/preview/mp3/sample-12s.mp3',
    NULL::text,
    90,
    true
  ),
  (
    4,
    'speaking_part_4_task_2',
    'Working From Home',
    'B2',
    'Listen to the examiner, then discuss the advantages and disadvantages of working from home.',
    'https://samplelib.com/lib/preview/mp3/sample-3s.mp3',
    NULL::text,
    90,
    true
  )
) AS seed(part_number, task_type, title, level, content, audio_url, image_url, max_score, is_published)
WHERE NOT EXISTS (
  SELECT 1
  FROM public.speaking_part_questions existing
  WHERE existing.part_number = seed.part_number
    AND existing.task_type = seed.task_type
);
