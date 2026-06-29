-- LanguageCert Academic Speaking: align format and seed practice questions
-- Part 1 Questions | Part 2 Role Play | Part 3 Read Aloud | Part 4 Presentation

UPDATE public.speaking_part_questions SET
  title = 'Morning or Evening Study?',
  level = 'B1',
  content = E'【Examiner question】\nDo you prefer studying in the morning or in the evening?\n\n【How to answer】\nDo not give one-word answers. Use 2–3 sentences: direct answer + reason or example.\n\n【Model answer】\nI prefer studying in the morning because my mind is fresh at that time. I can focus better and complete difficult tasks more easily.\n\n【Topics to practise】\nEducation, hometown, technology, travel, food, work, hobbies, environment, friends, daily routine.',
  max_score = 50,
  is_published = true,
  updated_at = now()
WHERE task_type = 'speaking_part_1_task_1';

UPDATE public.speaking_part_questions SET
  title = 'Your Hometown',
  level = 'B1',
  content = E'【Examiner question】\nTell me about your hometown. Where is it and what do you like about living there?\n\n【How to answer】\nUse 2–3 sentences. Mention location, one positive feature, and a short example.\n\n【Model answer】\nI come from Chandigarh in northern India. I like it because it is clean and well planned. There are good parks and libraries where students can study peacefully.',
  max_score = 50,
  is_published = true,
  updated_at = now()
WHERE task_type = 'speaking_part_1_task_2';

UPDATE public.speaking_part_questions SET
  title = 'Missed Lecture — Ask a Classmate',
  level = 'B1',
  content = E'【Role play situation】\nYou missed a lecture because you were unwell. Speak to your classmate to get notes and find out about the next assignment.\n\n【How to respond】\nGreeting + explain problem + polite request + ask a follow-up question (initiate interaction).\n\n【Useful language】\nExcuse me… / Could you please…? / I would really appreciate it. / What should I do next?\n\n【Model opening】\nHi, I missed yesterday''s lecture because I was unwell. Could you please share your notes with me? I would really appreciate it. Also, did the teacher mention anything important about the next assignment?',
  max_score = 50,
  is_published = true,
  updated_at = now()
WHERE task_type = 'speaking_part_2_task_1';

UPDATE public.speaking_part_questions SET
  title = 'Assignment Deadline Extension',
  level = 'B2',
  content = E'【Role play situation】\nYou need more time to finish a university assignment. Speak to your teacher and ask politely for an extension.\n\n【How to respond】\nGreet the teacher, explain your situation clearly, make a specific request, and respond politely to possible questions.\n\n【Useful language】\nIs it possible to extend the deadline? / I have completed most of the work… / Thank you, that would be very helpful.\n\n【Model opening】\nGood morning. I''m working on the research essay, but I had a family emergency last week. Is it possible to extend the deadline by two days? I have already finished the outline and most of the first draft.',
  max_score = 50,
  is_published = true,
  updated_at = now()
WHERE task_type = 'speaking_part_2_task_2';

UPDATE public.speaking_part_questions SET
  title = 'Online Learning — Read Aloud',
  level = 'B2',
  content = E'【Read aloud text】\nOnline learning has become popular among university students because it provides flexibility and easy access to study materials.\n\n【Examiner follow-up】\nDo you think online learning is useful?\n\n【Reading tips】\nPrepare for 30 seconds: check difficult words and punctuation. Read clearly — pause at commas and full stops. Do not rush.\n\n【Follow-up structure】\nOpinion + reason + example.\n\n【Model follow-up】\nYes, I think online learning is useful because students can study from anywhere. For example, working students can attend classes after their job, which makes education more flexible.',
  max_score = 50,
  is_published = true,
  updated_at = now()
WHERE task_type = 'speaking_part_3_task_1';

UPDATE public.speaking_part_questions SET
  title = 'Renewable Energy — Read Aloud',
  level = 'B2',
  content = E'【Read aloud text】\nMany universities are investing in renewable energy projects to reduce their carbon footprint and promote sustainable campus life.\n\n【Examiner follow-up】\nShould all universities use more renewable energy?\n\n【Reading tips】\nMark pauses: Many universities / are investing in renewable energy projects / to reduce their carbon footprint / and promote sustainable campus life.\n\n【Follow-up structure】\nOpinion + reason + example.\n\n【Model follow-up】\nYes, I believe they should, because universities consume a lot of electricity. For example, installing solar panels could lower costs and set a positive example for students.',
  max_score = 50,
  is_published = true,
  updated_at = now()
WHERE task_type = 'speaking_part_3_task_2';

UPDATE public.speaking_part_questions SET
  title = 'Benefits of Studying Abroad',
  level = 'B2',
  content = E'【Presentation topic】\nThe benefits of studying abroad for university students.\n\n【Structure — use all parts】\n1. Introduction (state your topic)\n2. Point 1 + example\n3. Point 2 + example\n4. Short conclusion\n\n【Prepare 1 minute · Speak up to 2 minutes】\n\n【Model outline】\nIntroduction: Today I will talk about why studying abroad is valuable for students.\nPoint 1: It improves language skills — e.g. daily communication in English.\nPoint 2: It builds independence — e.g. managing accommodation and finances.\nConclusion: Overall, studying abroad helps personal and academic growth.\n\n【Follow-up】\nThe examiner may ask: Would you like to study abroad? Why or why not?',
  max_score = 50,
  is_published = true,
  updated_at = now()
WHERE task_type = 'speaking_part_4_task_1';

UPDATE public.speaking_part_questions SET
  title = 'Social Media and Students',
  level = 'B2',
  content = E'【Presentation topic】\nHow social media affects university students.\n\n【Structure】\nIntroduction → Point 1 + example → Point 2 + example → Conclusion\n\n【Prepare 1 minute · Speak up to 2 minutes】\n\n【Model outline】\nIntroduction: Social media plays a major role in students'' lives today.\nPoint 1: Positive — students share study resources and join academic groups online.\nPoint 2: Negative — it can distract from revision and reduce sleep.\nConclusion: Students should use social media carefully and set limits.\n\n【Follow-up】\nThe examiner may ask: Do you think social media helps or harms learning?',
  max_score = 50,
  is_published = true,
  updated_at = now()
WHERE task_type = 'speaking_part_4_task_2';

-- New Academic practice questions
INSERT INTO public.speaking_part_questions
  (part_number, task_type, title, level, content, audio_url, image_url, max_score, is_published)
SELECT * FROM (VALUES
  (
    1, 'speaking_part_1_task_3', 'Technology in Daily Life', 'B1',
    E'【Examiner question】\nHow has technology changed the way you study?\n\n【How to answer】\n2–3 sentences: direct answer + reason + brief example.\n\n【Model answer】\nTechnology has made studying much easier because I can access online lectures and digital notes anywhere. For example, I use my laptop to review slides on the bus before exams.',
    'https://samplelib.com/lib/preview/mp3/sample-9s.mp3', NULL::text, 50, true
  ),
  (
    1, 'speaking_part_1_task_4', 'Food and Health', 'B1',
    E'【Examiner question】\nDo you think students should eat healthy food while studying? Why?\n\n【How to answer】\nState your opinion, give a reason, and add a short example.\n\n【Model answer】\nYes, I think students should eat healthy food because it helps them concentrate for longer. For example, eating fruit and vegetables gives more energy than fast food.',
    'https://samplelib.com/lib/preview/mp3/sample-12s.mp3', NULL::text, 50, true
  ),
  (
    1, 'speaking_part_1_task_5', 'Friends and Free Time', 'B2',
    E'【Examiner question】\nWhat do you usually do with friends in your free time?\n\n【How to answer】\nMention one or two activities and explain why you enjoy them.\n\n【Model answer】\nI usually meet friends at a café or go for a walk in the park. We talk about university and relax, which helps me reduce stress after a busy week.',
    'https://samplelib.com/lib/preview/mp3/sample-6s.mp3', NULL::text, 50, true
  ),
  (
    2, 'speaking_part_2_task_3', 'Library — Book Not Available', 'B1',
    E'【Role play situation】\nThe book you need for your assignment is not on the shelf. Speak to the librarian and ask for help.\n\n【Useful language】\nCould you please check if it is available? / Is it possible to reserve it? / When will it be returned?\n\n【Model opening】\nExcuse me, I am looking for Introduction to Economics, but I cannot find it on the shelf. Could you please check if it is available or tell me when it will be returned?',
    'https://samplelib.com/lib/preview/mp3/sample-3s.mp3', NULL::text, 50, true
  ),
  (
    2, 'speaking_part_2_task_4', 'Accommodation Problem', 'B2',
    E'【Role play situation】\nThere is a problem with heating in your student accommodation. Speak to the accommodation manager and explain the issue.\n\n【Model opening】\nHello, I am calling about my room in Block B. The heating has not been working for two days, and it is very cold. Could you please send someone to repair it as soon as possible?',
    'https://samplelib.com/lib/preview/mp3/sample-9s.mp3', NULL::text, 50, true
  ),
  (
    2, 'speaking_part_2_task_5', 'Course Registration', 'B2',
    E'【Role play situation】\nYou want to register for an optional module but the online system shows an error. Speak to a university officer.\n\n【Model opening】\nGood afternoon. I am trying to register for the Business Ethics module, but the system says the course is full. Is there a waiting list, or can you suggest another group I could join?',
    'https://samplelib.com/lib/preview/mp3/sample-12s.mp3', NULL::text, 50, true
  ),
  (
    3, 'speaking_part_3_task_3', 'Group Study — Read Aloud', 'B1',
    E'【Read aloud text】\nGroup study helps students explain ideas to each other and identify gaps in their understanding before exams.\n\n【Examiner follow-up】\nDo you prefer studying alone or in a group?\n\n【Model follow-up】\nI prefer group study for difficult subjects because classmates can explain topics in a simple way. However, I study alone when I need quiet time to memorise vocabulary.',
    'https://samplelib.com/lib/preview/mp3/sample-6s.mp3', NULL::text, 50, true
  ),
  (
    4, 'speaking_part_4_task_3', 'Importance of Group Study', 'B1',
    E'【Presentation topic】\nWhy group study is important for university students.\n\n【Structure】\nIntroduction → Point 1 + example → Point 2 + example → Conclusion\n\n【Model outline】\nIntroduction: Group study is a useful strategy for many students.\nPoint 1: It improves understanding — classmates explain concepts differently.\nPoint 2: It increases motivation — working together reduces procrastination.\nConclusion: Used wisely, group study supports better exam results.',
    'https://samplelib.com/lib/preview/mp3/sample-3s.mp3', NULL::text, 50, true
  )
) AS seed(part_number, task_type, title, level, content, audio_url, image_url, max_score, is_published)
WHERE NOT EXISTS (
  SELECT 1 FROM public.speaking_part_questions existing WHERE existing.task_type = seed.task_type
);
