#!/usr/bin/env node
/**
 * Ensures the speaking-audio Supabase Storage bucket exists (via Storage API).
 * Run: node scripts/ensure-speaking-audio-bucket.mjs
 */
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

const BUCKET = 'speaking-audio';
const MIME_TYPES = [
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/wave',
  'audio/x-wav',
  'audio/webm',
  'audio/ogg',
  'audio/mp4',
  'audio/x-m4a',
];

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(1);
}

const supabase = createClient(url, key, { auth: { persistSession: false } });

const { data: buckets, error: listError } = await supabase.storage.listBuckets();
if (listError) {
  console.error('listBuckets failed:', listError.message);
  process.exit(1);
}

const exists = buckets?.some((b) => b.id === BUCKET || b.name === BUCKET);
if (exists) {
  console.log(`Bucket "${BUCKET}" already exists.`);
  process.exit(0);
}

const { error: createError } = await supabase.storage.createBucket(BUCKET, {
  public: true,
  fileSizeLimit: 26214400,
  allowedMimeTypes: MIME_TYPES,
});

if (createError) {
  console.error('createBucket failed:', createError.message);
  process.exit(1);
}

console.log(`Created public bucket "${BUCKET}" (max 25 MB, audio MIME types).`);
