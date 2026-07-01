#!/usr/bin/env node
/**
 * Copies Listening Part 4 audio from materials/listening/ → listening-audio/listening/
 * (DB audio_path already points at listening/listening-part4-*.mp3)
 *
 * Usage: node scripts/migrate-listening-part4-audio.mjs [--dry-run]
 */

import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
config({ path: join(ROOT, '.env') });

const dryRun = process.argv.includes('--dry-run');
const SOURCE_BUCKET = 'materials';
const TARGET_BUCKET = 'listening-audio';
const SOURCE_PREFIX = 'listening/';

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(1);
}

const sb = createClient(url, serviceKey, { auth: { persistSession: false } });

async function existsInBucket(bucket, path) {
  const { error } = await sb.storage.from(bucket).download(path);
  return !error;
}

async function main() {
  const { data: rows, error } = await sb
    .from('listening_part_questions')
    .select('id, audio_path')
    .eq('part_number', 4)
    .not('audio_path', 'is', null);

  if (error) throw error;

  console.log(`Part 4 question sets with audio_path: ${rows.length}`);
  let copied = 0;
  let skipped = 0;
  let failed = 0;

  for (const row of rows) {
    const targetPath = row.audio_path;
    if (!targetPath) continue;

    const sourcePath = targetPath.startsWith(SOURCE_PREFIX)
      ? targetPath
      : `${SOURCE_PREFIX}${targetPath.replace(/^listening\//, '')}`;

    const already = await existsInBucket(TARGET_BUCKET, targetPath);
    if (already) {
      console.log(`✓ skip (exists): ${targetPath}`);
      skipped++;
      continue;
    }

    const sourceOk = await existsInBucket(SOURCE_BUCKET, sourcePath);
    if (!sourceOk) {
      console.error(`✗ missing source: ${SOURCE_BUCKET}/${sourcePath}`);
      failed++;
      continue;
    }

    if (dryRun) {
      console.log(`[dry-run] would copy ${SOURCE_BUCKET}/${sourcePath} → ${TARGET_BUCKET}/${targetPath}`);
      copied++;
      continue;
    }

    const { data: blob, error: dlError } = await sb.storage.from(SOURCE_BUCKET).download(sourcePath);
    if (dlError || !blob) {
      console.error(`✗ download failed: ${sourcePath}`, dlError?.message);
      failed++;
      continue;
    }

    const { error: upError } = await sb.storage.from(TARGET_BUCKET).upload(targetPath, blob, {
      contentType: 'audio/mpeg',
      upsert: true,
    });

    if (upError) {
      console.error(`✗ upload failed: ${targetPath}`, upError.message);
      failed++;
      continue;
    }

    const publicUrl = `${url}/storage/v1/object/public/${TARGET_BUCKET}/${targetPath}`;
    const check = await fetch(publicUrl);
    console.log(`✓ copied ${targetPath} (${blob.size} bytes) HTTP ${check.status}`);
    copied++;
  }

  console.log('\nDone.', { copied, skipped, failed, dryRun });
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
