import {readFileSync} from 'node:fs';
import {MediaError} from '../errors';

export type WavMetadata = {
  durationSeconds: number;
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  audioFormat: number;
  dataSize: number;
};

/** Minimal PCM WAV reader for local synthetic/fixture audio. */
export const readWavMetadata = (file: string): WavMetadata => {
  const buffer = readFileSync(file);
  if (buffer.length < 44 || buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') {
    throw new MediaError(`Not a RIFF/WAVE file: ${file}`);
  }

  let offset = 12;
  let fmt:
    | {
        audioFormat: number;
        channels: number;
        sampleRate: number;
        byteRate: number;
        bitsPerSample: number;
      }
    | undefined;
  let dataSize: number | undefined;

  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.toString('ascii', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (body + size > buffer.length + 1) {
      throw new MediaError(`Corrupt WAV chunk ${chunkId} in ${file}`);
    }
    if (chunkId === 'fmt ') {
      if (size < 16) throw new MediaError(`Invalid fmt chunk in ${file}`);
      fmt = {
        audioFormat: buffer.readUInt16LE(body),
        channels: buffer.readUInt16LE(body + 2),
        sampleRate: buffer.readUInt32LE(body + 4),
        byteRate: buffer.readUInt32LE(body + 8),
        bitsPerSample: buffer.readUInt16LE(body + 14),
      };
    } else if (chunkId === 'data') {
      dataSize = size;
    }
    offset = body + size + (size % 2);
  }

  if (!fmt || dataSize === undefined) {
    throw new MediaError(`WAV is missing fmt or data chunk: ${file}`);
  }
  if (fmt.audioFormat !== 1 || fmt.bitsPerSample !== 16) {
    throw new MediaError('P0 supports 16-bit PCM WAV only');
  }
  if (fmt.byteRate <= 0) {
    throw new MediaError(`Invalid WAV byte rate in ${file}`);
  }

  return {
    durationSeconds: dataSize / fmt.byteRate,
    sampleRate: fmt.sampleRate,
    channels: fmt.channels,
    bitsPerSample: fmt.bitsPerSample,
    audioFormat: fmt.audioFormat,
    dataSize,
  };
};
