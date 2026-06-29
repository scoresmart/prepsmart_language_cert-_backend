/** Public sample audio for speaking practice testing (short clips, CORS-friendly). */
export const SPEAKING_TEST_AUDIO_URLS = [
  'https://samplelib.com/lib/preview/mp3/sample-3s.mp3',
  'https://samplelib.com/lib/preview/mp3/sample-6s.mp3',
  'https://samplelib.com/lib/preview/mp3/sample-9s.mp3',
  'https://samplelib.com/lib/preview/mp3/sample-12s.mp3',
] as const;

export function pickSpeakingTestAudio(seed = 0): string {
  const index = Math.abs(seed) % SPEAKING_TEST_AUDIO_URLS.length;
  return SPEAKING_TEST_AUDIO_URLS[index];
}

export function resolveSpeakingAudioUrl(
  audioUrl: string | null | undefined,
  seed = 0,
  storageBase = 'https://sepzceaicoldqhyxxzff.supabase.co/storage/v1/object/public/speaking-audio',
  legacyStorageBase = 'https://sepzceaicoldqhyxxzff.supabase.co/storage/v1/object/public/listening-audio',
): string {
  if (audioUrl?.trim()) {
    const trimmed = audioUrl.trim();
    if (trimmed.startsWith('http')) return trimmed;
    if (trimmed.startsWith('listening/') || trimmed.startsWith('legacy-listening/')) {
      return `${legacyStorageBase}/${trimmed.replace(/^legacy-listening\//, '')}`;
    }
    return `${storageBase}/${trimmed}`;
  }
  return pickSpeakingTestAudio(seed);
}

export function withSpeakingTestAudio<T extends { audio_url?: string | null; part_number?: number }>(
  rows: T[],
): T[] {
  return rows.map((row, index) => ({
    ...row,
    audio_url: resolveSpeakingAudioUrl(row.audio_url, row.part_number ?? index),
  }));
}
