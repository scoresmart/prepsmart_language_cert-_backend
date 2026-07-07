#!/usr/bin/env node
/**
 * Sync speaking examiner audio into the speaking-audio bucket and verify playability.
 *
 * 1. Copies from materials/speaking/ → speaking-audio/ when DB paths point at missing files
 * 2. Reports zero-byte files (broken admin uploads before the disk-read fix)
 *
 * Usage:
 *   node scripts/sync-speaking-audio.mjs [--dry-run]
 *   node scripts/sync-speaking-audio.mjs --repair-from ./local-mp3-folder
 */

import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { readdir, readFile } from 'node:fs/promises';
import { basename, dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
config({ path: join(ROOT, '.env') });

const dryRun = process.argv.includes('--dry-run');
const repairFromIdx = process.argv.indexOf('--repair-from');
const repairFromDir = repairFromIdx >= 0 ? process.argv[repairFromIdx + 1] : null;

const SOURCE_BUCKET = 'materials';
const TARGET_BUCKET = 'speaking-audio';
const SOURCE_PREFIX = 'speaking/';

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(1);
}

const sb = createClient(url, serviceKey, { auth: { persistSession: false } });

async function download(bucket, path) {
  const { data, error } = await sb.storage.from(bucket).download(path);
  if (error || !data) return null;
  const buf = Buffer.from(await data.arrayBuffer());
  return buf;
}

async function upload(path, buffer, contentType = 'audio/mpeg') {
  const { error } = await sb.storage.from(TARGET_BUCKET).upload(path, buffer, {
    contentType,
    upsert: true,
  });
  return error;
}

function guessContentType(filePath) {
  const ext = extname(filePath).toLowerCase();
  if (ext === '.wav') return 'audio/wav';
  if (ext === '.ogg') return 'audio/ogg';
  if (ext === '.webm') return 'audio/webm';
  if (ext === '.m4a' || ext === '.mp4') return 'audio/mp4';
  return 'audio/mpeg';
}

async function loadLocalAudioFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!/\.(mp3|wav|m4a|ogg|webm)$/i.test(entry.name)) continue;
    const full = join(dir, entry.name);
    const buffer = await readFile(full);
    files.push({ name: entry.name, base: basename(entry.name, extname(entry.name)), buffer });
  }
  return files;
}

function matchLocalFile(localFiles, question) {
  const titleSlug = question.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return (
    localFiles.find((f) => f.name === basename(question.audio_url)) ||
    localFiles.find((f) => question.audio_url?.endsWith(f.name)) ||
    localFiles.find((f) => f.base.toLowerCase() === titleSlug) ||
    localFiles.find((f) => f.name.toLowerCase().includes(titleSlug.slice(0, 20)))
  );
}

async function main() {
  const { data: rows, error } = await sb
    .from('speaking_part_questions')
    .select('id, title, part_number, audio_url, is_published')
    .not('audio_url', 'is', null)
    .order('part_number')
    .order('created_at');

  if (error) throw error;

  console.log(`Speaking questions with audio_url: ${rows.length}`);
  let synced = 0;
  let skipped = 0;
  let repaired = 0;
  let failed = 0;

  const localFiles = repairFromDir ? await loadLocalAudioFiles(repairFromDir) : [];
  if (repairFromDir) {
    console.log(`Local repair folder: ${repairFromDir} (${localFiles.length} audio files)`);
  }

  for (const row of rows) {
    const targetPath = row.audio_url?.trim();
    if (!targetPath || targetPath.startsWith('http')) {
      skipped++;
      continue;
    }

    const existing = await download(TARGET_BUCKET, targetPath);
    const existingSize = existing?.length ?? 0;

    if (existingSize > 0) {
      console.log(`✓ ok (${existingSize} bytes): ${row.title} → ${targetPath}`);
      skipped++;
      continue;
    }

    if (existingSize === 0 && existing) {
      console.warn(`⚠ zero-byte file: ${targetPath} (${row.title})`);
    }

    // Try materials bucket copy
    const sourcePath = targetPath.startsWith(SOURCE_PREFIX)
      ? targetPath
      : `${SOURCE_PREFIX}${targetPath.replace(/^speaking\//, '')}`;

    const sourceBuf = await download(SOURCE_BUCKET, sourcePath);
    if (sourceBuf && sourceBuf.length > 0) {
      if (dryRun) {
        console.log(`[dry-run] would copy materials/${sourcePath} → ${targetPath}`);
        synced++;
        continue;
      }
      const upErr = await upload(targetPath, sourceBuf);
      if (upErr) {
        console.error(`✗ upload failed: ${targetPath}`, upErr.message);
        failed++;
        continue;
      }
      console.log(`✓ synced from materials: ${row.title} → ${targetPath} (${sourceBuf.length} bytes)`);
      synced++;
      continue;
    }

    // Try local folder repair
    const local = localFiles.length ? matchLocalFile(localFiles, row) : null;
    if (local) {
      if (dryRun) {
        console.log(`[dry-run] would repair from local ${local.name} → ${targetPath}`);
        repaired++;
        continue;
      }
      const upErr = await upload(targetPath, local.buffer, guessContentType(local.name));
      if (upErr) {
        console.error(`✗ local repair failed: ${targetPath}`, upErr.message);
        failed++;
        continue;
      }
      console.log(`✓ repaired from local: ${local.name} → ${targetPath} (${local.buffer.length} bytes)`);
      repaired++;
      continue;
    }

    console.error(`✗ missing audio for "${row.title}" (${targetPath}) — re-upload in Admin → Speaking`);
    failed++;
  }

  console.log('\nDone.', { synced, repaired, skipped, failed, dryRun });
  if (failed > 0 && !repairFromDir) {
    console.log('\nTip: place MP3 files in a folder and run:');
    console.log('  node scripts/sync-speaking-audio.mjs --repair-from ./your-audio-folder');
  }
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
