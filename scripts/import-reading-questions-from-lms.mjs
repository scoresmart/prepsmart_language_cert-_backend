#!/usr/bin/env node
/**
 * Imports reading questions from LMS format into reading_part_questions table.
 *
 * Background:
 *   The LMS stored reading questions inside writing_task_questions with
 *   task_type values like 'reading_part_1a', 'reading_part_1b', etc.
 *   The language cert backend uses a dedicated reading_part_questions table.
 *   Both projects share the same Supabase instance, so this is an in-DB migration.
 *
 * Usage:
 *   node scripts/import-reading-questions-from-lms.mjs [--dry-run]
 *
 * Requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in .env
 */

import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
config({ path: join(ROOT, '.env') });

const DRY_RUN = process.argv.includes('--dry-run');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Maps LMS task_type → reading_part_questions.part_type
const PART_TYPE_MAP = {
  reading_part_1a: 'part1a',
  reading_part_1b: 'part1b',
  reading_part_2: 'part2',
  reading_part_3: 'part3',
  reading_part_4: 'part4',
};

async function main() {
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN (no writes)' : 'LIVE'}\n`);

  // ── 1. Fetch all reading questions from LMS table ──────────────────────────
  console.log('Fetching reading questions from writing_task_questions...');
  const { data: lmsQuestions, error: fetchErr } = await supabase
    .from('writing_task_questions')
    .select('*')
    .like('task_type', 'reading_part_%')
    .order('created_at', { ascending: true });

  if (fetchErr) {
    console.error('Error fetching LMS questions:', fetchErr.message);
    process.exit(1);
  }

  console.log(`Found ${lmsQuestions.length} reading question sets in LMS.\n`);

  if (lmsQuestions.length === 0) {
    console.log('Nothing to import.');
    return;
  }

  // ── 2. Transform ──────────────────────────────────────────────────────────
  const transformed = lmsQuestions.map((q) => {
    let questions = [];
    if (q.image_path) {
      try {
        questions = JSON.parse(q.image_path);
      } catch {
        console.warn(`  Warning: could not parse image_path JSON for ${q.id} (${q.task_type})`);
      }
    }

    return {
      id: q.id,
      part_type: PART_TYPE_MAP[q.task_type],
      title: q.question_text || '',
      passage: q.question_text || '',
      questions,
      word_bank: null,
      is_active: true,
      created_by: q.created_by,
      created_at: q.created_at,
      updated_at: q.updated_at,
    };
  });

  // Print summary
  const byPart = {};
  for (const q of transformed) {
    byPart[q.part_type] = (byPart[q.part_type] || 0) + 1;
  }
  console.log('Questions to import by part:');
  for (const [part, count] of Object.entries(byPart)) {
    console.log(`  ${part}: ${count}`);
  }
  console.log();

  if (DRY_RUN) {
    console.log('DRY RUN — no data written. Remove --dry-run to import.');
    return;
  }

  // ── 3. Check if reading_part_questions table exists ────────────────────────
  const { error: tableCheckErr } = await supabase
    .from('reading_part_questions')
    .select('id')
    .limit(1);

  if (tableCheckErr && tableCheckErr.code === '42P01') {
    console.error(
      'Table reading_part_questions does not exist.\n' +
      'Run the Supabase migration first:\n' +
      '  npx supabase db push\n' +
      'or apply supabase/migrations/20260623000000_reading_part_questions_from_lms.sql manually.'
    );
    process.exit(1);
  }

  // ── 4. Check for already-imported questions ────────────────────────────────
  const { data: existing } = await supabase
    .from('reading_part_questions')
    .select('id');

  const existingIds = new Set((existing || []).map((r) => r.id));
  const toInsert = transformed.filter((q) => !existingIds.has(q.id));

  if (toInsert.length === 0) {
    console.log('All questions already imported. Nothing to do.');
    return;
  }

  console.log(`Inserting ${toInsert.length} new question sets (${existingIds.size} already exist)...`);

  // ── 5. Upsert in batches of 50 ─────────────────────────────────────────────
  const BATCH = 50;
  let imported = 0;

  for (let i = 0; i < toInsert.length; i += BATCH) {
    const batch = toInsert.slice(i, i + BATCH);
    const { error: insertErr } = await supabase
      .from('reading_part_questions')
      .upsert(batch, { onConflict: 'id', ignoreDuplicates: true });

    if (insertErr) {
      console.error(`Error inserting batch starting at ${i}:`, insertErr.message);
      process.exit(1);
    }
    imported += batch.length;
    process.stdout.write(`  Imported ${imported}/${toInsert.length}\r`);
  }

  console.log(`\nDone! Imported ${imported} reading question sets.`);
  console.log('\nExisting language_cert_mock_tests references are preserved');
  console.log('because the same UUIDs were used for reading_part_questions rows.');
}

main().catch((err) => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
