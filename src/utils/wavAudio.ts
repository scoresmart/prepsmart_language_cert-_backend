export interface WavInfo {
  sampleRate: number;
  numChannels: number;
  bitsPerSample: number;
  dataOffset: number;
  dataLength: number;
}

export function parseWav(buffer: Buffer): WavInfo {
  if (buffer.length < 44 || buffer.toString('ascii', 0, 4) !== 'RIFF') {
    throw new Error('Invalid WAV file');
  }

  const numChannels = buffer.readUInt16LE(22);
  const sampleRate = buffer.readUInt32LE(24);
  const bitsPerSample = buffer.readUInt16LE(34);

  let offset = 12;
  let dataOffset = 44;
  let dataLength = buffer.length - 44;

  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.toString('ascii', offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    if (chunkId === 'data') {
      dataOffset = offset + 8;
      dataLength = Math.min(chunkSize, buffer.length - dataOffset);
      break;
    }
    offset += 8 + chunkSize + (chunkSize % 2);
  }

  return { sampleRate, numChannels, bitsPerSample, dataOffset, dataLength };
}

export function wavDurationSeconds(info: WavInfo): number {
  const bytesPerSample = info.bitsPerSample / 8;
  return info.dataLength / (info.sampleRate * info.numChannels * bytesPerSample);
}

export function buildWavFromPcm(
  pcm: Buffer,
  sampleRate: number,
  numChannels: number,
  bitsPerSample: number,
): Buffer {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * numChannels * (bitsPerSample / 8), 28);
  header.writeUInt16LE(numChannels * (bitsPerSample / 8), 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

/** Split a WAV buffer into chunks of at most maxSeconds each (for Azure short-audio API). */
export function splitWav(buffer: Buffer, maxSeconds: number): Buffer[] {
  const info = parseWav(buffer);
  const bytesPerSecond = info.sampleRate * info.numChannels * (info.bitsPerSample / 8);
  const maxBytes = Math.floor(bytesPerSecond * maxSeconds);
  const pcm = buffer.subarray(info.dataOffset, info.dataOffset + info.dataLength);

  if (pcm.length <= maxBytes) return [buffer];

  const chunks: Buffer[] = [];
  for (let i = 0; i < pcm.length; i += maxBytes) {
    const slice = pcm.subarray(i, Math.min(i + maxBytes, pcm.length));
    chunks.push(buildWavFromPcm(slice, info.sampleRate, info.numChannels, info.bitsPerSample));
  }
  return chunks;
}
