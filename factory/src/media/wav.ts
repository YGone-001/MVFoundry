import {readFileSync, writeFileSync} from 'node:fs';
import {MediaError} from '../errors';

export type WavMetadata = {
  durationSeconds: number;
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  audioFormat: number;
  dataSize: number;
};

export type PcmWavData = {
  sampleRate: number;
  channels: number;
  samples: Float32Array;
  frameCount: number;
  durationSeconds: number;
};

const locatePcmData = (buffer: Buffer, label: string): {
  sampleRate: number;
  channels: number;
  data: Buffer;
} => {
  if (buffer.length < 44 || buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') {
    throw new MediaError(`Not a RIFF/WAVE file: ${label}`);
  }
  let offset = 12;
  let format:
    | {
        audioFormat: number;
        channels: number;
        sampleRate: number;
        byteRate: number;
        bitsPerSample: number;
      }
    | undefined;
  let data: Buffer | undefined;
  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.toString('ascii', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (body + size > buffer.length) {
      throw new MediaError(`Corrupt WAV chunk ${chunkId} in ${label}`);
    }
    if (chunkId === 'fmt ') {
      if (size < 16) throw new MediaError(`Invalid fmt chunk in ${label}`);
      format = {
        audioFormat: buffer.readUInt16LE(body),
        channels: buffer.readUInt16LE(body + 2),
        sampleRate: buffer.readUInt32LE(body + 4),
        byteRate: buffer.readUInt32LE(body + 8),
        bitsPerSample: buffer.readUInt16LE(body + 14),
      };
    } else if (chunkId === 'data') {
      data = buffer.subarray(body, body + size);
    }
    offset = body + size + (size % 2);
  }
  if (!format || !data) throw new MediaError(`WAV is missing fmt or data chunk: ${label}`);
  if (format.audioFormat !== 1 || format.bitsPerSample !== 16) {
    throw new MediaError('Only 16-bit PCM WAV is supported');
  }
  if (format.channels < 1 || format.channels > 2) {
    throw new MediaError(`WAV channel count ${format.channels} is unsupported; mono or stereo is required`);
  }
  if (format.sampleRate <= 0) throw new MediaError(`Invalid WAV sample rate in ${label}`);
  if (format.byteRate <= 0) throw new MediaError(`Invalid WAV byte rate in ${label}`);
  return {sampleRate: format.sampleRate, channels: format.channels, data};
};

export const parsePcm16WavBuffer = (buffer: Buffer, label: string): PcmWavData => {
  const {sampleRate, channels, data} = locatePcmData(buffer, label);
  const frameCount = Math.floor(data.length / (channels * 2));
  const samples = new Float32Array(frameCount * channels);
  for (let index = 0; index < samples.length; index++) {
    const value = data.readInt16LE(index * 2);
    samples[index] = value < 0 ? value / 32768 : value / 32767;
  }
  return {
    sampleRate,
    channels,
    samples,
    frameCount,
    durationSeconds: frameCount / sampleRate,
  };
};

export const readPcmWav = (file: string): PcmWavData =>
  parsePcm16WavBuffer(readFileSync(file), file);

export const encodePcm16Wav = (
  samples: Float32Array,
  sampleRate: number,
  channels: number,
): Buffer => {
  if (!Number.isInteger(sampleRate) || sampleRate <= 0) {
    throw new MediaError('WAV sample rate must be a positive integer');
  }
  if (channels !== 1 && channels !== 2) throw new MediaError('WAV channels must be 1 or 2');
  if (samples.length % channels !== 0) throw new MediaError('WAV sample count must align to channels');
  const dataSize = samples.length * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * channels * 2, 28);
  buffer.writeUInt16LE(channels * 2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);
  for (let index = 0; index < samples.length; index++) {
    const clamped = Math.max(-1, Math.min(1, samples[index]));
    const value = clamped < 0 ? Math.round(clamped * 32768) : Math.round(clamped * 32767);
    buffer.writeInt16LE(Math.max(-32768, Math.min(32767, value)), 44 + index * 2);
  }
  return buffer;
};

export const writePcm16Wav = (
  file: string,
  samples: Float32Array,
  sampleRate: number,
  channels: number,
): void => {
  writeFileSync(file, encodePcm16Wav(samples, sampleRate, channels));
};

/** Minimal PCM WAV reader for local synthetic/fixture audio. */
export const readWavMetadata = (file: string): WavMetadata => {
  const buffer = readFileSync(file);
  const {sampleRate, channels, data} = locatePcmData(buffer, file);
  return {
    durationSeconds: data.length / (sampleRate * channels * 2),
    sampleRate,
    channels,
    bitsPerSample: 16,
    audioFormat: 1,
    dataSize: data.length,
  };
};
