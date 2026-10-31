import {execFileSync} from 'node:child_process';
import {closeSync, openSync, readSync, statSync} from 'node:fs';
import {MediaError} from '../errors';
import type {AudioAssetMetadata, AudioFormat} from '../config/types';
import {readWavMetadata} from './wav';

type FfprobeStream = {
  codec_type?: string;
  codec_name?: string;
  sample_rate?: string;
  channels?: number;
  channel_layout?: string;
  duration?: string;
  start_time?: string;
  initial_padding?: number;
  trailing_padding?: number;
};

type FfprobeResult = {
  streams?: FfprobeStream[];
  format?: {
    format_name?: string;
    duration?: string;
    start_time?: string;
  };
};

function fail(message: string): never {
  throw new MediaError(message);
}

const isWav = (file: string): boolean => {
  const fd = openSync(file, 'r');
  try {
    const header = Buffer.alloc(12);
    const read = readSync(fd, header, 0, 12, 0);
    return (
      read === 12 &&
      header.toString('ascii', 0, 4) === 'RIFF' &&
      header.toString('ascii', 8, 12) === 'WAVE'
    );
  } finally {
    closeSync(fd);
  }
};

const formatFor = (formatName: string, codec: string, assetId: string): AudioFormat => {
  const names = formatName.split(',');
  if (names.includes('mp3') && codec === 'mp3') return 'mp3';
  if (names.includes('flac') && codec === 'flac') return 'flac';
  if (names.includes('mp4') && codec === 'aac') return 'm4a-aac';
  return fail(
    `Audio asset ${assetId} has unsupported container/codec ${formatName || 'unknown'}/${codec || 'unknown'}`,
  );
};

const decodedDuration = (file: string, assetId: string): number => {
  let output: string;
  try {
    output = execFileSync(
      'ffmpeg',
      ['-v', 'error', '-nostats', '-progress', 'pipe:1', '-i', file, '-vn', '-f', 'null', '-'],
      {encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, timeout: 120000, windowsHide: true},
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      fail('FFmpeg is required to decode non-WAV audio but was not found on PATH');
    }
    fail(`Unable to decode audio asset ${assetId}: ${message}`);
  }
  const matches = [...output.matchAll(/^out_time_(?:us|ms)=(\d+)$/gm)];
  const last = matches.length > 0 ? Number(matches[matches.length - 1][1]) : NaN;
  if (!Number.isFinite(last) || last <= 0) {
    fail(`Decoded duration could not be established for audio asset ${assetId}`);
  }
  return last / 1_000_000;
};

/**
 * Probes an approved audio source. WAV uses the existing pure PCM metadata path;
 * other supported formats use FFprobe for metadata and FFmpeg for an actual
 * decode-duration check (including gapless trimming for MP3/AAC).
 */
export const probeAudio = (
  file: string,
  assetId: string,
  expectedFormat?: AudioFormat,
): AudioAssetMetadata => {
  let wavContainer: boolean;
  try {
    wavContainer = isWav(file);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    fail(
      code === 'ENOENT'
        ? `Audio asset ${assetId} does not exist: ${file}`
        : `Unable to read audio asset ${assetId}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (wavContainer) {
    const wav = readWavMetadata(file);
    if (expectedFormat && expectedFormat !== 'wav-pcm') {
      fail(`Audio asset ${assetId} is WAV but the manifest declares ${expectedFormat}`);
    }
    return {
      format: 'wav-pcm',
      container: 'wav',
      codec: 'pcm_s16le',
      sampleRate: wav.sampleRate,
      channels: wav.channels,
      channelLayout: wav.channels === 1 ? 'mono' : 'stereo',
      probeDurationSeconds: wav.durationSeconds,
      decodedDurationSeconds: wav.durationSeconds,
      startTimeSeconds: 0,
      encoderDelaySamples: null,
      paddingSamples: null,
      hasUnexpectedStreams: false,
      fileSizeBytes: statSync(file).size,
    };
  }

  let raw: string;
  try {
    raw = execFileSync(
      'ffprobe',
      ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', file],
      {encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 30000, windowsHide: true},
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      fail('FFprobe is required to validate non-WAV audio but was not found on PATH');
    }
    fail(`Unable to probe audio asset ${assetId}: ${message}`);
  }
  let parsed: FfprobeResult;
  try {
    parsed = JSON.parse(raw) as FfprobeResult;
  } catch (error) {
    fail(`Audio probe returned invalid JSON for ${assetId}: ${error instanceof Error ? error.message : String(error)}`);
  }
  const streams = Array.isArray(parsed.streams) ? parsed.streams : [];
  const audio = streams.filter((stream) => stream.codec_type === 'audio');
  const other = streams.filter((stream) => stream.codec_type !== 'audio');
  if (audio.length !== 1 || other.length > 0) {
    fail(
      `Audio asset ${assetId} must contain exactly one audio stream and no video/other streams`,
    );
  }
  const stream = audio[0];
  const formatName = parsed.format?.format_name ?? '';
  const format = formatFor(formatName, stream.codec_name ?? '', assetId);
  if (expectedFormat && expectedFormat !== format) {
    fail(`Audio asset ${assetId} is ${format} but the manifest declares ${expectedFormat}`);
  }
  const sampleRate = Number(stream.sample_rate);
  const channels = Number(stream.channels);
  if (!Number.isInteger(sampleRate) || sampleRate <= 0) {
    fail(`Audio asset ${assetId} has an invalid sample rate`);
  }
  if (!Number.isInteger(channels) || channels <= 0 || channels > 2) {
    fail(`Audio asset ${assetId} has ${channels} channels; mono or stereo is supported`);
  }
  const probeDuration = Number(parsed.format?.duration ?? stream.duration);
  if (!Number.isFinite(probeDuration) || probeDuration <= 0) {
    fail(`Audio asset ${assetId} has no readable positive duration`);
  }
  const startTime = Number(parsed.format?.start_time ?? stream.start_time ?? 0);
  const decoded = decodedDuration(file, assetId);
  return {
    format,
    container: formatName,
    codec: stream.codec_name ?? '',
    sampleRate,
    channels,
    channelLayout: stream.channel_layout ?? null,
    probeDurationSeconds: probeDuration,
    decodedDurationSeconds: decoded,
    startTimeSeconds: Number.isFinite(startTime) ? startTime : 0,
    encoderDelaySamples:
      typeof stream.initial_padding === 'number' ? stream.initial_padding : null,
    paddingSamples:
      typeof stream.trailing_padding === 'number' ? stream.trailing_padding : null,
    hasUnexpectedStreams: false,
    fileSizeBytes: statSync(file).size,
  };
};