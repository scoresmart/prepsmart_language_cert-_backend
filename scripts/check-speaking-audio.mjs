#!/usr/bin/env node
import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
config({ path: join(ROOT, '.env') });

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const { data, error } = await sb
  .from('speaking_part_questions')
  .select('id, title, part_number, audio_url, is_published')
  .order('part_number')
  .order('created_at');

if (error) {
  console.error(error);
  process.exit(1);
}

console.log('Questions:', data.length);
for (const q of data) {
  const audio = q.audio_url || '(none)';
  console.log(`P${q.part_number} pub=${q.is_published} | ${(q.title || '').slice(0, 45)} | ${audio.slice(0, 100)}`);
}

async function listBucket(prefix = '') {
  const { data: files, error: listErr } = await sb.storage.from('speaking-audio').list(prefix, { limit: 100 });
  if (listErr) {
    console.error('list error', prefix, listErr.message);
    return;
  }
  for (const f of files ?? []) {
    const path = prefix ? `${prefix}/${f.name}` : f.name;
    if (f.id === null) {
      await listBucket(path);
    } else {
      console.log('  file:', path, f.metadata?.size ?? '?', 'bytes');
    }
  }
}

console.log('\nspeaking-audio bucket:');
await listBucket();
