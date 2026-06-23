/**
 * Migration: Add scoring columns
 * Run with: npx ts-node src/config/migrations/scoring_columns.ts
 *
 * Adds:
 *   - practice_attempts.scoring_status
 *   - reading_part_questions.answer_key
 *   - listening_part_questions.answer_key
 */

import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

const migrations = [
  {
    name: 'Add scoring_status to practice_attempts',
    sql: `
      ALTER TABLE practice_attempts
        ADD COLUMN IF NOT EXISTS scoring_status TEXT
          NOT NULL DEFAULT 'completed'
          CHECK (scoring_status IN ('pending','scoring','completed','failed'));
    `,
  },
  {
    name: 'Add answer_key to reading_part_questions',
    sql: `
      ALTER TABLE reading_part_questions
        ADD COLUMN IF NOT EXISTS answer_key JSONB DEFAULT '[]'::jsonb;
    `,
  },
  {
    name: 'Add answer_key to listening_part_questions',
    sql: `
      ALTER TABLE listening_part_questions
        ADD COLUMN IF NOT EXISTS answer_key JSONB DEFAULT '[]'::jsonb;
    `,
  },
  {
    name: 'Create index on practice_attempts scoring_status',
    sql: `
      CREATE INDEX IF NOT EXISTS idx_practice_attempts_scoring_status
        ON practice_attempts (scoring_status);
    `,
  },
];

async function runMigrations() {
  console.log('Running scoring column migrations...\n');

  for (const migration of migrations) {
    process.stdout.write(`  → ${migration.name} ... `);
    const { error } = await supabase.rpc('exec_sql', { sql: migration.sql }).single();

    if (error) {
      // Try direct REST approach for DDL
      const response = await fetch(
        `${process.env.SUPABASE_URL}/rest/v1/rpc/exec_sql`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY!,
            'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY!}`,
          },
          body: JSON.stringify({ sql: migration.sql }),
        },
      );

      if (!response.ok) {
        console.error(`FAILED\n    ${error.message}`);
        console.error('\n--- Run this SQL manually in Supabase SQL editor ---');
        console.error(migration.sql);
        console.error('----------------------------------------------------\n');
        continue;
      }
    }

    console.log('OK');
  }

  console.log('\nMigration complete.');
  process.exit(0);
}

runMigrations().catch((err) => {
  console.error('Migration error:', err);
  process.exit(1);
});
