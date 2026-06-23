/**
 * Azure Speech Services — REST API transcription
 * Converts candidate audio recordings to text for AI scoring.
 */

const SUPPORTED_AUDIO_TYPES: Record<string, string> = {
  'audio/wav': 'audio/wav; codecs=audio/pcm; samplerate=16000',
  'audio/wave': 'audio/wav; codecs=audio/pcm; samplerate=16000',
  'audio/mpeg': 'audio/mpeg',
  'audio/mp3': 'audio/mpeg',
  'audio/ogg': 'audio/ogg; codecs=opus',
  'audio/webm': 'audio/webm; codecs=opus',
  'audio/mp4': 'audio/mp4',
};

export interface TranscriptionResult {
  transcript: string;
  confidence: number;
  durationSeconds: number;
}

/**
 * Transcribes an audio buffer using Azure Cognitive Services Speech-to-Text REST API.
 * @param audioBuffer  Raw audio bytes
 * @param mimeType     MIME type of the audio file (default: audio/wav)
 * @param language     BCP-47 language tag (default: en-GB for LanguageCert)
 */
export async function transcribeAudio(
  audioBuffer: Buffer,
  mimeType: string = 'audio/wav',
  language: string = 'en-GB',
): Promise<TranscriptionResult> {
  const region = process.env.AZURE_SPEECH_REGION;
  const key = process.env.AZURE_SPEECH_KEY;

  if (!region || !key) {
    throw new Error('AZURE_SPEECH_REGION and AZURE_SPEECH_KEY must be set in environment variables');
  }

  const contentType = SUPPORTED_AUDIO_TYPES[mimeType] ?? SUPPORTED_AUDIO_TYPES['audio/wav'];

  // Use custom endpoint if provided, otherwise use the standard Speech STT endpoint
  const baseEndpoint = process.env.AZURE_SPEECH_ENDPOINT?.trim()
    ? process.env.AZURE_SPEECH_ENDPOINT.replace(/\/$/, '')
    : `https://${region}.stt.speech.microsoft.com`;

  const url = `${baseEndpoint}/speech/recognition/conversation/cognitiveservices/v1?language=${language}&format=detailed`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Ocp-Apim-Subscription-Key': key,
      'Content-Type': contentType,
      'Accept': 'application/json',
    },
    body: audioBuffer,
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Azure Speech transcription failed (${response.status}): ${errText}`);
  }

  const result = await response.json() as {
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
  // Azure Duration is in 100-nanosecond units
  const durationSeconds = result.Duration ? result.Duration / 10_000_000 : 0;

  return { transcript, confidence, durationSeconds };
}
