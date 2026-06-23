#!/usr/bin/env node
/**
 * Ensures one published speaking question exists for Azure STT + scoring API testing.
 *
 * Usage: node scripts/ensure-speaking-test-question.mjs
 */

import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
config({ path: join(ROOT, '.env') });

const TASK_TYPE = 'speaking_part_1_azure_test';

const TEST_QUESTION = {
  part_number: 1,
  task_type: TASK_TYPE,
  title: 'Azure API Test — Introduce Yourself',
  level: 'B1',
  content:
    'Listen to the examiner, then introduce yourself. Say your name, where you are from, and one hobby you enjoy. Speak clearly for at least 10 seconds so Azure can transcribe your answer.',
  audio_url: 'https://samplelib.com/lib/preview/mp3/sample-6s.mp3',
  image_url: null,
  max_score: 50,
  is_published: true,
  created_at: '2020-01-01T00:00:00.000Z',
};
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(1);
}

const supabase = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function main() {
  const { data: existing, error: findError } = await supabase
    .from('speaking_part_questions')
    .select('id, title, is_published')
    .eq('task_type', TASK_TYPE)
    .maybeSingle();

  if (findError) throw findError;

  if (existing) {
    const { error: updateError } = await supabase
      .from('speaking_part_questions')
      .update({ ...TEST_QUESTION, updated_at: new Date().toISOString() })
      .eq('id', existing.id);

    if (updateError) throw updateError;

    console.log('Updated existing Azure test speaking question.');
    console.log('ID:', existing.id);
    console.log('Title:', TEST_QUESTION.title);
    console.log('Practice URL: http://localhost:5174/workspace/speaking/part-1/question/1');
    return;
  }

  const { data: inserted, error: insertError } = await supabase
    .from('speaking_part_questions')
    .insert(TEST_QUESTION)
    .select('id')
    .single();

  if (insertError) throw insertError;

  console.log('Created Azure test speaking question.');
  console.log('ID:', inserted.id);
  console.log('Title:', TEST_QUESTION.title);
  console.log('Practice URL: http://localhost:5174/workspace/speaking/part-1/question/1');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
