/**
 * Azure Speech Services — REST API transcription
 * Converts candidate audio recordings to text for AI scoring.
 */

import { parseWav, splitWav, wavDurationSeconds } from '../utils/wavAudio';

const SUPPORTED_AUDIO_TYPES: Record<string, string> = {
  'audio/wav': 'audio/wav; codecs=audio/pcm; samplerate=16000',
  'audio/wave': 'audio/wav; codecs=audio/pcm; samplerate=16000',
  'audio/x-wav': 'audio/wav; codecs=audio/pcm; samplerate=16000',
  'audio/mpeg': 'audio/mpeg',
  'audio/mp3': 'audio/mpeg',
  'audio/ogg': 'audio/ogg; codecs=opus',
  'audio/webm': 'audio/webm; codecs=opus',
  'audio/mp4': 'audio/mp4',
  'application/octet-stream': 'audio/wav; codecs=audio/pcm; samplerate=16000',
};

/** Azure sync REST API works reliably up to ~60 s per request. */
const AZURE_CHUNK_SECONDS = 50;

export interface TranscriptionResult {
  transcript: string;
  confidence: number;
  durationSeconds: number;
}

function extensionForMime(mimeType: string): string {
  if (mimeType.includes('webm')) return 'webm';
  if (mimeType.includes('ogg')) return 'ogg';
  if (mimeType.includes('mpeg') || mimeType.includes('mp3')) return 'mp3';
  if (mimeType.includes('mp4')) return 'mp4';
  if (mimeType.includes('wav')) return 'wav';
  return 'webm';
}

async function transcribeWithWhisper(
  audioBuffer: Buffer,
  mimeType: string,
): Promise<TranscriptionResult> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    throw new Error('OpenAI API key is not configured for Whisper fallback transcription');
  }

  const ext = extensionForMime(mimeType);
  const formData = new FormData();
  formData.append('file', new Blob([new Uint8Array(audioBuffer)], { type: mimeType || 'audio/webm' }), `recording.${ext}`);
  formData.append('model', 'whisper-1');
  formData.append('language', 'en');

  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}` },
    body: formData,
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Whisper transcription failed (${response.status}): ${errText}`);
  }

  const result = (await response.json()) as { text?: string };
  const transcript = result.text?.trim() ?? '';
  if (!transcript) {
    throw new Error('Whisper returned an empty transcript. Please speak clearly and try again.');
  }

  return { transcript, confidence: 1, durationSeconds: 0 };
}

async function transcribeWithAzure(
  audioBuffer: Buffer,
  mimeType: string,
  language: string,
): Promise<TranscriptionResult> {
  const region = process.env.AZURE_SPEECH_REGION;
  const key = process.env.AZURE_SPEECH_KEY;

  if (!region || !key) {
    throw new Error('AZURE_SPEECH_REGION and AZURE_SPEECH_KEY must be set in environment variables');
  }

  const contentType = SUPPORTED_AUDIO_TYPES[mimeType] ?? SUPPORTED_AUDIO_TYPES['audio/wav'];

  const baseEndpoint = process.env.AZURE_SPEECH_ENDPOINT?.trim()
    ? process.env.AZURE_SPEECH_ENDPOINT.replace(/\/$/, '')
    : `https://${region}.stt.speech.microsoft.com`;

  const url = `${baseEndpoint}/speech/recognition/conversation/cognitiveservices/v1?language=${language}&format=detailed`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Ocp-Apim-Subscription-Key': key,
      'Content-Type': contentType,
      Accept: 'application/json',
    },
    body: audioBuffer,
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Azure Speech transcription failed (${response.status}): ${errText}`);
  }

  const result = (await response.json()) as {
    RecognitionStatus: string;
    DisplayText?: string;
    NBest?: Array<{ Confidence: number; Display: string }>;
    Duration?: number;
  };

  if (result.RecognitionStatus !== 'Success') {
    throw new Error(`Azure Speech returned status: ${result.RecognitionStatus}`);
  }

  const best = result.NBest?.[0];
  const transcript = best?.Display ?? result.DisplayText ?? '';
  const confidence = best?.Confidence ?? 1;
  const durationSeconds = result.Duration ? result.Duration / 10_000_000 : 0;

  if (!transcript.trim()) {
    throw new Error('Azure Speech returned an empty transcript. Please speak clearly and try again.');
  }

  return { transcript: transcript.trim(), confidence, durationSeconds };
}

async function transcribeWavWithAzureChunking(
  audioBuffer: Buffer,
  language: string,
): Promise<TranscriptionResult> {
  const info = parseWav(audioBuffer);
  const duration = wavDurationSeconds(info);
  const chunks = duration > AZURE_CHUNK_SECONDS ? splitWav(audioBuffer, AZURE_CHUNK_SECONDS) : [audioBuffer];

  console.log(
    `[Azure Speech] Transcribing WAV (${duration.toFixed(1)}s) in ${chunks.length} chunk(s)`,
  );

  const parts: string[] = [];
  let totalConfidence = 0;

  for (let i = 0; i < chunks.length; i++) {
    const result = await transcribeWithAzure(chunks[i], 'audio/wav', language);
    parts.push(result.transcript);
    totalConfidence += result.confidence;
  }

  return {
    transcript: parts.join(' '),
    confidence: totalConfidence / chunks.length,
    durationSeconds: duration,
  };
}

/**
 * Transcribes an audio buffer using Azure Speech (WAV chunked for long clips), with Whisper fallback.
 */
export async function transcribeAudio(
  audioBuffer: Buffer,
  mimeType: string = 'audio/wav',
  language: string = 'en-GB',
): Promise<TranscriptionResult> {
  const normalizedMime = mimeType?.trim() || 'audio/wav';
  const isWav =
    normalizedMime.includes('wav') ||
    normalizedMime === 'application/octet-stream' ||
    (audioBuffer.length > 4 && audioBuffer.toString('ascii', 0, 4) === 'RIFF');

  if (isWav) {
    try {
      return await transcribeWavWithAzureChunking(audioBuffer, language);
    } catch (azureError) {
      console.warn('[Azure Speech] WAV transcription failed, trying Whisper fallback:', azureError);
      if (process.env.OPENAI_API_KEY) {
        return transcribeWithWhisper(audioBuffer, 'audio/wav');
      }
      if (azureError instanceof Error) throw azureError;
      throw new Error('Speech transcription failed');
    }
  }

  try {
    return await transcribeWithAzure(audioBuffer, normalizedMime, language);
  } catch (azureError) {
    console.warn('[Azure Speech] Primary transcription failed, trying Whisper fallback:', azureError);
    if (process.env.OPENAI_API_KEY) {
      return transcribeWithWhisper(audioBuffer, normalizedMime);
    }
    if (azureError instanceof Error) throw azureError;
    throw new Error('Speech transcription failed');
  }
}
