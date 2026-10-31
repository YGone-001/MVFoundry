import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {MediaError} from '../errors';
import {encodePcm16Wav} from './wav';

export type NormalizedAudio = {
  samples: Float32Array;
  sampleRate: number;
  channels: number;
  frameCount: number;
  durationSeconds: number;
  wavBytes: Buffer;
  normalizedSha256: string;
};

/**
 * Decodes any supported local source to the project's authoritative mix format:
 * signed 16-bit PCM WAV, stereo, at the configured sample rate. FFmpeg performs
 * channel and sample-rate conversion; mixing itself is deterministic Node code.
 */
export const decodeAudioToNormalizedPcm = (
  file: string,
  sampleRate: number,
  assetId: string,
): NormalizedAudio => {
  if (!Number.isInteger(sampleRate) || (sampleRate !== 44100 && sampleRate !== 48000)) {
    throw new MediaError(`Unsupported mix sample rate ${sampleRate}`);
  }
  let raw: Buffer;
  try {
    raw = execFileSync(
      'ffmpeg',
      [
        '-v',
        'error',
        '-i',
        file,
        '-vn',
        '-ac',
        '2',
        '-ar',
        String(sampleRate),
        '-c:a',
        'pcm_s16le',
        '-f',
        's16le',
        'pipe:1',
      ],
      {encoding: null, maxBuffer: 256 * 1024 * 1024, timeout: 180000, windowsHide: true},
    ) as unknown as Buffer;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new MediaError('FFmpeg is required to normalize audio but was not found on PATH');
    }
    throw new MediaError(`Unable to decode audio asset ${assetId}: ${message}`);
  }
  if (raw.length === 0 || raw.length % 4 !== 0) {
    throw new MediaError(
      `Audio normalization for ${assetId} produced ${raw.length} bytes, which is not stereo s16le`,
    );
  }
  const frameCount = raw.length / 4;
  const samples = new Float32Array(frameCount * 2);
  for (let index = 0; index < samples.length; index++) {
    const value = raw.readInt16LE(index * 2);
    samples[index] = value < 0 ? value / 32768 : value / 32767;
  }
  const wavBytes = encodePcm16Wav(samples, sampleRate, 2);
  return {
    samples,
    sampleRate,
    channels: 2,
    frameCount,
    durationSeconds: frameCount / sampleRate,
    wavBytes,
    normalizedSha256: createHash('sha256').update(wavBytes).digest('hex'),
  };
};