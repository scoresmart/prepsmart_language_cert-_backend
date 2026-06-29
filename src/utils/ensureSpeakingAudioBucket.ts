import { getSupabase } from '../config/database';

export const SPEAKING_AUDIO_BUCKET = 'speaking-audio';

const SPEAKING_AUDIO_MIME_TYPES = [
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

/** Register bucket with Supabase Storage API (SQL-only bucket rows are not enough). */
export async function ensureSpeakingAudioBucket(): Promise<void> {
  const supabase = getSupabase();
  const { data: buckets, error: listError } = await supabase.storage.listBuckets();
  if (listError) {
    console.warn('[Storage] Could not list buckets:', listError.message);
    return;
  }

  const exists = buckets?.some((b) => b.id === SPEAKING_AUDIO_BUCKET || b.name === SPEAKING_AUDIO_BUCKET);
  if (exists) {
    console.log(`[Storage] ${SPEAKING_AUDIO_BUCKET} bucket ready.`);
    return;
  }

  const { error: createError } = await supabase.storage.createBucket(SPEAKING_AUDIO_BUCKET, {
    public: true,
    fileSizeLimit: 26214400,
    allowedMimeTypes: SPEAKING_AUDIO_MIME_TYPES,
  });

  if (createError) {
    console.warn(`[Storage] Could not create ${SPEAKING_AUDIO_BUCKET} bucket:`, createError.message);
    return;
  }

  console.log(`[Storage] Created ${SPEAKING_AUDIO_BUCKET} bucket.`);
}

export function speakingAudioPublicUrl(path: string): string {
  const base = process.env.SUPABASE_URL?.replace(/\/$/, '') || '';
  return `${base}/storage/v1/object/public/${SPEAKING_AUDIO_BUCKET}/${path}`;
}
