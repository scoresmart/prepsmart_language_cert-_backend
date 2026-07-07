#!/usr/bin/env node
/**
 * Ensures speaking_sets table exists. Run once after deploy:
 *   node scripts/apply-speaking-sets-migration.mjs
 */
import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
config({ path: join(ROOT, '.env') });

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const sb = createClient(url, key, { auth: { persistSession: false } });

const { error: probeError } = await sb.from('speaking_sets').select('id').limit(1);
if (!probeError) {
  console.log('speaking_sets table already exists.');
  process.exit(0);
}

console.log(`
speaking_sets table is missing (${probeError.message}).

Run this SQL in Supabase Dashboard → SQL Editor:

${readFileSync(join(ROOT, 'supabase/migrations/20260708000000_speaking_sets.sql'), 'utf8')}
`);
process.exit(1);
