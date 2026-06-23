#!/usr/bin/env node
/** Ensures sample writing questions exist for practice. Usage: npm run ensure-writing */

import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
config({ path: join(ROOT, '.env') });

const SAMPLES = [
  {
    task_type: 'task1',
    question_text:
      'You recently attended a community event. Write a short report for your college newsletter describing the event, who attended, and what you learned from it. Write between 100 and 150 words.',
  },
  {
    task_type: 'task1',
    question_text:
      'Your English teacher has asked you to write about a skill you would like to learn. Explain what the skill is, why you want to learn it, and how you plan to practise. Write between 100 and 150 words.',
  },
  {
    task_type: 'task2',
    question_text:
      'Many young people prefer to shop online rather than in physical stores. Write an essay discussing the advantages and disadvantages of online shopping. Write about 150–200 words.',
  },
];

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function main() {
  const { count } = await supabase
    .from('writing_task_questions')
    .select('id', { count: 'exact', head: true });
  if ((count ?? 0) > 0) {
    console.log(`Writing questions already exist (${count}). Skipping seed.`);
    return;
  }

  const { data, error } = await supabase.from('writing_task_questions').insert(SAMPLES).select('id, task_type');
  if (error) throw error;
  console.log(`Seeded ${data.length} writing questions.`);
  console.log('Practice: http://localhost:5174/workspace/writing/part-1/question/1');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
