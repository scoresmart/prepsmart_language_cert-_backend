-- Normalize all speaking questions to the same structure (content, level, max_score, audio).
UPDATE public.speaking_part_questions
SET content = 'Listen to the examiner audio carefully, then record your spoken response when prompted.'
WHERE content IS NULL OR trim(content) = '';

UPDATE public.speaking_part_questions
SET level = 'B1'
WHERE level IS NULL OR trim(level) = '';

UPDATE public.speaking_part_questions
SET max_score = 90
WHERE max_score IS NULL OR max_score < 1;

UPDATE public.speaking_part_questions
SET audio_url = 'https://samplelib.com/lib/preview/mp3/sample-6s.mp3'
WHERE audio_url IS NULL OR trim(audio_url) = '';
