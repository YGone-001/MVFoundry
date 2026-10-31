import {execFileSync} from 'node:child_process';
import {MediaError} from '../errors';
import type {VideoAssetMetadata} from '../config/types';

type FfprobeStream = {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  pix_fmt?: string;
  r_frame_rate?: string;
  avg_frame_rate?: string;
  duration?: string;
  tags?: Record<string, string>;
  side_data_list?: Array<Record<string, unknown>>;
};

type FfprobeResult = {
  streams?: FfprobeStream[];
  format?: {
    format_name?: string;
    duration?: string;
  };
};

const MAX_WIDTH = 7680;
const MAX_HEIGHT = 4320;

function fail(message: string): never {
  throw new MediaError(message);
}

const parseRate = (value: unknown, field: string): number => {
  if (typeof value !== 'string' || !/^\d+\/\d+$/.test(value)) {
    fail(`${field} is not a valid rational frame rate`);
  }
  const [numerator, denominator] = value.split('/').map(Number);
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) {
    fail(`${field} is not a valid rational frame rate`);
  }
  const rate = numerator / denominator;
  if (!Number.isFinite(rate) || rate <= 0 || rate > 240) {
    fail(`${field} is outside the supported frame-rate range`);
  }
  return rate;
};

const readRotation = (stream: FfprobeStream): number => {
  const sideData = Array.isArray(stream.side_data_list) ? stream.side_data_list : [];
  const rotationEntry = sideData.find((entry) => entry.rotation !== undefined);
  const raw = rotationEntry?.rotation ?? stream.tags?.rotate;
  if (raw === undefined) return 0;
  const rotation = Number(raw);
  if (!Number.isFinite(rotation)) fail('Video rotation metadata is invalid');
  return rotation;
};

/**
 * Probe a local approved video with FFprobe before any render work.
 * This verifies container, codec, dimensions, constant frame rate and duration.
 */
export const probeVideo = (file: string, assetId: string): VideoAssetMetadata => {
  let raw: string;
  try {
    raw = execFileSync(
      'ffprobe',
      ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', file],
      {encoding: 'utf8', timeout: 30000, maxBuffer: 10 * 1024 * 1024, windowsHide: true},
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      fail('ffprobe is required to validate local video assets but was not found on PATH');
    }
    fail(`Unable to probe video asset ${assetId}: ${message}`);
  }

  let parsed: FfprobeResult;
  try {
    parsed = JSON.parse(raw) as FfprobeResult;
  } catch (error) {
    fail(
      `Video probe returned invalid JSON for ${assetId}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const streams = Array.isArray(parsed.streams) ? parsed.streams : [];
  const video = streams.find((stream) => stream.codec_type === 'video');
  if (!video) fail(`Video asset ${assetId} has no video stream`);

  const formatName = parsed.format?.format_name ?? '';
  if (!formatName.split(',').includes('mp4')) {
    fail(`Video asset ${assetId} is not an MP4 container (format: ${formatName || 'unknown'})`);
  }
  if (video.codec_name !== 'h264') {
    fail(`Video asset ${assetId} codec ${video.codec_name ?? 'unknown'} is unsupported; H.264 is required`);
  }

  const width = Number(video.width);
  const height = Number(video.height);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    fail(`Video asset ${assetId} has invalid dimensions`);
  }
  if (width > MAX_WIDTH || height > MAX_HEIGHT) {
    fail(`Video asset ${assetId} dimensions ${width}x${height} exceed ${MAX_WIDTH}x${MAX_HEIGHT}`);
  }

  const rRate = parseRate(video.r_frame_rate, `Video asset ${assetId} r_frame_rate`);
  const avgRaw = video.avg_frame_rate;
  const avgRate =
    typeof avgRaw === 'string' && avgRaw !== '0/0'
      ? parseRate(avgRaw, `Video asset ${assetId} avg_frame_rate`)
      : rRate;
  if (Math.abs(rRate - avgRate) > 1e-6) {
    fail(
      `Video asset ${assetId} appears to use a variable frame rate (${rRate} vs ${avgRate}); preprocessing to constant frame rate is required`,
    );
  }

  const duration = Number(parsed.format?.duration ?? video.duration);
  if (!Number.isFinite(duration) || duration <= 0) {
    fail(`Video asset ${assetId} has no readable positive duration`);
  }

  const rotation = readRotation(video);
  if (Math.abs(rotation) > 0.01) {
    fail(
      `Video asset ${assetId} has rotation metadata (${rotation} degrees); preprocess it to upright zero-rotation media`,
    );
  }

  return {
    assetId,
    container: 'mp4',
    codec: 'h264',
    width,
    height,
    fps: avgRate,
    durationSeconds: duration,
    hasAudio: streams.some((stream) => stream.codec_type === 'audio'),
    pixelFormat: video.pix_fmt ?? null,
    rotation,
  };
};
