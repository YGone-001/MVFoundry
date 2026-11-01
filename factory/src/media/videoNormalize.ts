import {execFileSync, spawnSync} from 'node:child_process';
import {existsSync, mkdirSync, statSync} from 'node:fs';
import path from 'node:path';
import {MediaError} from '../errors';
import type {NormalizationRecord, VideoFrameTiming, VideoInspection} from '../generation/types';
import {NORMALIZATION_VERSION} from '../generation/types';

const MAX_SOURCE_WIDTH = 3840;
const MAX_SOURCE_HEIGHT = 2160;
const MIN_SOURCE_WIDTH = 16;
const MIN_SOURCE_HEIGHT = 16;
const MAX_SOURCE_DURATION_SECONDS = 120;
const MAX_FRAME_RATE = 240;
const FRAME_SAMPLE_COUNT = 90;
const VFR_RELATIVE_TOLERANCE = 0.05;
const VFR_ABSOLUTE_TOLERANCE = 1e-4;

type FfprobeStream = {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  pix_fmt?: string;
  time_base?: string;
  r_frame_rate?: string;
  avg_frame_rate?: string;
  nb_frames?: string;
  duration?: string;
  tags?: Record<string, string>;
  side_data_list?: Array<Record<string, unknown>>;
};

type FfprobeResult = {
  streams?: FfprobeStream[];
  format?: {format_name?: string; duration?: string};
};

const fail = (message: string): never => {
  throw new MediaError(message);
};

const parseRate = (value: string | undefined, label: string): number => {
  if (typeof value !== 'string' || !/^\d+\/\d+$/.test(value)) {
    fail(`${label} is not a valid rational frame rate`);
  }
  const [numerator, denominator] = value.split('/').map(Number);
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0 || numerator <= 0) {
    fail(`${label} is not a usable frame rate`);
  }
  return numerator / denominator;
};

const readRotation = (stream: FfprobeStream): number => {
  const sideData = Array.isArray(stream.side_data_list) ? stream.side_data_list : [];
  const entry = sideData.find((candidate) => candidate.rotation !== undefined);
  const raw = entry?.rotation ?? stream.tags?.rotate;
  if (raw === undefined) return 0;
  const rotation = Number(raw);
  if (!Number.isFinite(rotation)) fail('Video rotation metadata is invalid');
  return rotation;
};

const runFfprobe = (args: string[], label: string): string => {
  const result = spawnSync('ffprobe', args, {
    encoding: 'utf8',
    timeout: 60_000,
    maxBuffer: 32 * 1024 * 1024,
    windowsHide: true,
  });
  if (result.error) {
    const code = (result.error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') fail('ffprobe is required to inspect video but was not found on PATH');
    fail(`${label}: ffprobe failed (${result.error.message})`);
  }
  if (result.status !== 0) {
    fail(`${label}: ffprobe exited with ${result.status ?? 'unknown'}`);
  }
  return result.stdout ?? '';
};

const median = (values: number[]): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
};

const sampleFrameTiming = (file: string, label: string): VideoFrameTiming => {
  const output = runFfprobe(
    [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'frame=pts_time',
      '-of', 'csv=p=0',
      '-read_intervals', `%+#${FRAME_SAMPLE_COUNT}`,
      file,
    ],
    label,
  );
  const timestamps = output
    .split(/\r?\n/)
    .map((line) => line.split(',')[0].trim())
    .filter((line) => line !== '' && line !== 'N/A')
    .map((line) => Number(line))
    .filter((value) => Number.isFinite(value));
  if (timestamps.length < 2) {
    return {sampleCount: timestamps.length, medianDeltaSeconds: 0, maxDeviationSeconds: 0, variableFrameRate: false};
  }
  const deltas: number[] = [];
  for (let index = 1; index < timestamps.length; index++) {
    deltas.push(timestamps[index] - timestamps[index - 1]);
  }
  const center = median(deltas);
  const deviation = deltas.reduce((max, delta) => Math.max(max, Math.abs(delta - center)), 0);
  const threshold = Math.max(VFR_ABSOLUTE_TOLERANCE, center * VFR_RELATIVE_TOLERANCE);
  return {
    sampleCount: timestamps.length,
    medianDeltaSeconds: Number(center.toFixed(6)),
    maxDeviationSeconds: Number(deviation.toFixed(6)),
    variableFrameRate: deviation > threshold,
  };
};

const checkDecode = (file: string, label: string): {ok: boolean; errors: string[]} => {
  const result = spawnSync(
    'ffmpeg',
    ['-hide_banner', '-v', 'error', '-xerror', '-nostdin', '-i', file, '-map', '0:v:0', '-f', 'null', '-'],
    {encoding: 'utf8', timeout: 120_000, maxBuffer: 16 * 1024 * 1024, windowsHide: true},
  );
  const errors = `${result.stderr ?? ''}`
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '');
  return {ok: result.status === 0 && errors.length === 0, errors: errors.slice(0, 8)};
};

/**
 * Deep inspection used before normalization. It never trusts a filename
 * extension: container, codec, pixel format, timing and decode validity all come
 * from FFprobe and an actual decode pass.
 */
export const inspectVideoDeep = (file: string, label: string): VideoInspection => {
  if (!existsSync(file)) fail(`${label} does not exist`);
  if (!statSync(file).isFile()) fail(`${label} is not a regular file`);
  let parsed: FfprobeResult;
  try {
    parsed = JSON.parse(
      runFfprobe(
        ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', file],
        label,
      ),
    ) as FfprobeResult;
  } catch (error) {
    if (error instanceof MediaError) throw error;
    fail(`${label}: FFprobe returned malformed JSON`);
  }
  const streams = Array.isArray(parsed.streams) ? parsed.streams : [];
  const video = streams.find((stream) => stream.codec_type === 'video');
  if (!video) fail(`${label} has no video stream`);
  const width = Number(video.width);
  const height = Number(video.height);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    fail(`${label} reports invalid dimensions`);
  }
  const nominalFrameRate = parseRate(video.r_frame_rate, `${label} nominal frame rate`);
  const averageRaw = video.avg_frame_rate;
  const averageFrameRate =
    typeof averageRaw === 'string' && averageRaw !== '0/0'
      ? parseRate(averageRaw, `${label} average frame rate`)
      : nominalFrameRate;
  const durationRaw = Number(parsed.format?.duration ?? video.duration);
  if (!Number.isFinite(durationRaw) || durationRaw <= 0) {
    fail(`${label} has no readable positive duration`);
  }
  const decode = checkDecode(file, label);
  return {
    container: parsed.format?.format_name ?? 'unknown',
    codec: video.codec_name ?? 'unknown',
    pixelFormat: video.pix_fmt ?? 'unknown',
    width,
    height,
    timeBase: video.time_base ?? 'unknown',
    nominalFrameRate,
    averageFrameRate,
    frameCount: typeof video.nb_frames === 'string' && /^\d+$/.test(video.nb_frames) ? Number(video.nb_frames) : null,
    durationSeconds: durationRaw,
    rotation: readRotation(video),
    decodesCleanly: decode.ok,
    decodeErrors: decode.errors,
    audioStreamCount: streams.filter((stream) => stream.codec_type === 'audio').length,
    timing: sampleFrameTiming(file, label),
  };
};

export type NormalizationProfile = {
  version: typeof NORMALIZATION_VERSION;
  container: 'mp4';
  videoCodec: 'libx264';
  pixelFormat: 'yuv420p';
  preset: string;
  crf: number;
  gopDivisor: number;
  colorSpace: 'bt709';
  audioPolicy: 'strip';
  scaling: 'fit-pad';
  maxWidth: number;
  maxHeight: number;
  maxDurationSeconds: number;
};

/**
 * One reviewed profile. Project configuration cannot supply FFmpeg arguments,
 * filtergraphs or shell strings; only the numeric targets below are variable.
 */
export const NORMALIZATION_PROFILE: NormalizationProfile = {
  version: NORMALIZATION_VERSION,
  container: 'mp4',
  videoCodec: 'libx264',
  pixelFormat: 'yuv420p',
  preset: 'veryfast',
  crf: 20,
  gopDivisor: 2,
  colorSpace: 'bt709',
  audioPolicy: 'strip',
  scaling: 'fit-pad',
  maxWidth: MAX_SOURCE_WIDTH,
  maxHeight: MAX_SOURCE_HEIGHT,
  maxDurationSeconds: MAX_SOURCE_DURATION_SECONDS,
};

const normalizeRotation = (rotation: number): 0 | 90 | 180 | 270 => {
  const normalized = ((Math.round(rotation) % 360) + 360) % 360;
  if (normalized === 0 || normalized === 90 || normalized === 180 || normalized === 270) {
    return normalized;
  }
  return fail(`Video rotation ${rotation} degrees cannot be corrected deterministically`);
};

export type NormalizeVideoInput = {
  sourcePath: string;
  destinationPath: string;
  label: string;
  targetFps: number;
  targetWidth: number;
  targetHeight: number;
  requiredDurationSeconds: number;
};

export type NormalizeVideoResult = {
  source: VideoInspection;
  derived: VideoInspection;
  /** Exact argument vector, with the local paths replaced by placeholders. */
  arguments: string[];
  profile: NormalizationRecord['profile'];
  rotationCorrection: number;
};

const assertTarget = (input: NormalizeVideoInput): void => {
  if (!Number.isFinite(input.targetFps) || input.targetFps <= 0 || input.targetFps > 120) {
    fail(`Normalization target frame rate ${input.targetFps} is outside 0-120`);
  }
  for (const [label, value, max] of [
    ['width', input.targetWidth, NORMALIZATION_PROFILE.maxWidth],
    ['height', input.targetHeight, NORMALIZATION_PROFILE.maxHeight],
  ] as const) {
    if (!Number.isInteger(value) || value < MIN_SOURCE_WIDTH || value > max) {
      fail(`Normalization target ${label} ${value} is outside ${MIN_SOURCE_WIDTH}-${max}`);
    }
    if (value % 2 !== 0) fail(`Normalization target ${label} ${value} must be even for yuv420p`);
  }
  if (!Number.isFinite(input.requiredDurationSeconds) || input.requiredDurationSeconds <= 0) {
    fail('Normalization requires a positive target duration');
  }
};

const assertSourceUsable = (inspection: VideoInspection, label: string): void => {
  if (!inspection.decodesCleanly) {
    fail(`${label} does not decode cleanly: ${inspection.decodeErrors[0] ?? 'decoder error'}`);
  }
  if (inspection.width < MIN_SOURCE_WIDTH || inspection.height < MIN_SOURCE_WIDTH) {
    fail(`${label} is ${inspection.width}x${inspection.height}; that is too small to normalize`);
  }
  if (inspection.width > NORMALIZATION_PROFILE.maxWidth || inspection.height > NORMALIZATION_PROFILE.maxHeight) {
    fail(
      `${label} is ${inspection.width}x${inspection.height}; the reviewed profile accepts at most ${NORMALIZATION_PROFILE.maxWidth}x${NORMALIZATION_PROFILE.maxHeight}`,
    );
  }
  if (inspection.durationSeconds > NORMALIZATION_PROFILE.maxDurationSeconds) {
    fail(
      `${label} runs ${inspection.durationSeconds.toFixed(3)}s; the reviewed profile accepts at most ${NORMALIZATION_PROFILE.maxDurationSeconds}s`,
    );
  }
  if (!(inspection.nominalFrameRate > 0) || inspection.nominalFrameRate > MAX_FRAME_RATE) {
    fail(`${label} reports an unusable frame rate ${inspection.nominalFrameRate}`);
  }
  if (inspection.timing.sampleCount < 2) {
    fail(`${label} produced fewer than two frame timestamps; timing is ambiguous`);
  }
  normalizeRotation(inspection.rotation);
};

/**
 * Deterministic compatibility pass: one reviewed profile, structured arguments,
 * explicit CFR selection, explicit rotation correction and explicit fit-pad
 * scaling. The source file is never modified.
 */
export const normalizeVideo = (input: NormalizeVideoInput): NormalizeVideoResult => {
  assertTarget(input);
  const source = inspectVideoDeep(input.sourcePath, input.label);
  assertSourceUsable(source, input.label);
  const rotation = normalizeRotation(source.rotation);
  const targetDuration = Math.min(source.durationSeconds, NORMALIZATION_PROFILE.maxDurationSeconds);
  const gop = Math.max(1, Math.round(input.targetFps / NORMALIZATION_PROFILE.gopDivisor));

  const filters = [
    `fps=${input.targetFps}`,
    `scale=${input.targetWidth}:${input.targetHeight}:force_original_aspect_ratio=decrease:flags=bicubic`,
    `pad=${input.targetWidth}:${input.targetHeight}:(ow-iw)/2:(oh-ih)/2:color=black`,
    'setsar=1',
    `format=${NORMALIZATION_PROFILE.pixelFormat}`,
  ];

  const args = [
    '-y',
    '-hide_banner',
    '-loglevel', 'error',
    '-nostdin',
    // Rotation correction is delegated to FFmpeg's documented display-matrix
    // application, which also clears the matrix on the encoded output. A
    // hand-written transpose would leave the matrix in place and the renderer
    // would still see rotation metadata.
    '-autorotate',
    '-i', input.sourcePath,
    '-vf', filters.join(','),
    '-an',
    '-sn',
    '-dn',
    '-c:v', NORMALIZATION_PROFILE.videoCodec,
    '-preset', NORMALIZATION_PROFILE.preset,
    '-crf', String(NORMALIZATION_PROFILE.crf),
    '-g', String(gop),
    '-keyint_min', String(gop),
    '-sc_threshold', '0',
    '-pix_fmt', NORMALIZATION_PROFILE.pixelFormat,
    '-colorspace', NORMALIZATION_PROFILE.colorSpace,
    '-color_trc', NORMALIZATION_PROFILE.colorSpace,
    '-color_primaries', NORMALIZATION_PROFILE.colorSpace,
    '-movflags', '+faststart',
    '-t', targetDuration.toFixed(6),
    '-f', NORMALIZATION_PROFILE.container,
    input.destinationPath,
  ];

  const recordedArgs = args.map((value) => {
    if (value === input.sourcePath) return '<source>';
    if (value === input.destinationPath) return '<derived>';
    return value;
  });

  mkdirSync(path.dirname(input.destinationPath), {recursive: true});
  try {
    execFileSync('ffmpeg', args, {
      stdio: 'pipe',
      timeout: 300_000,
      maxBuffer: 32 * 1024 * 1024,
      windowsHide: true,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    fail(`Normalization of ${input.label} failed: ${message.split(/\r?\n/)[0]}`);
  }

  const derived = inspectVideoDeep(input.destinationPath, `${input.label} (normalized)`);
  if (!derived.container.split(',').includes('mp4')) {
    fail(`Normalized ${input.label} is not an MP4 container (${derived.container})`);
  }
  if (derived.codec !== 'h264') fail(`Normalized ${input.label} codec is ${derived.codec}, expected h264`);
  if (derived.pixelFormat !== NORMALIZATION_PROFILE.pixelFormat) {
    fail(`Normalized ${input.label} pixel format is ${derived.pixelFormat}`);
  }
  if (derived.width !== input.targetWidth || derived.height !== input.targetHeight) {
    fail(
      `Normalized ${input.label} is ${derived.width}x${derived.height}, expected ${input.targetWidth}x${input.targetHeight}`,
    );
  }
  if (Math.abs(derived.averageFrameRate - input.targetFps) > 1e-3) {
    fail(`Normalized ${input.label} frame rate is ${derived.averageFrameRate}, expected ${input.targetFps}`);
  }
  if (Math.abs(derived.rotation) > 0.01) fail(`Normalized ${input.label} still carries rotation metadata`);
  if (!derived.decodesCleanly) fail(`Normalized ${input.label} does not decode cleanly`);
  if (derived.audioStreamCount !== 0) fail(`Normalized ${input.label} still carries an audio stream`);
  if (derived.durationSeconds + 1e-3 < input.requiredDurationSeconds) {
    fail(
      `Normalized ${input.label} covers ${derived.durationSeconds.toFixed(3)}s but ${input.requiredDurationSeconds.toFixed(3)}s is required`,
    );
  }

  return {
    source,
    derived,
    arguments: recordedArgs,
    profile: {
      container: 'mp4',
      videoCodec: 'libx264',
      pixelFormat: 'yuv420p',
      preset: NORMALIZATION_PROFILE.preset,
      crf: NORMALIZATION_PROFILE.crf,
      gopFrames: gop,
      colorSpace: 'bt709',
      audioPolicy: 'strip',
      scaling: 'fit-pad',
      targetWidth: input.targetWidth,
      targetHeight: input.targetHeight,
      targetFps: input.targetFps,
      targetDurationSeconds: Number(targetDuration.toFixed(6)),
    },
    rotationCorrection: rotation,
  };
};

export const frameTimingPolicy = (result: NormalizeVideoResult): {
  frameDuplicationPolicy: string;
  frameDropPolicy: string;
} => ({
  frameDuplicationPolicy:
    result.source.averageFrameRate < result.profile.targetFps
      ? 'source frames below target rate are duplicated by the explicit fps filter'
      : 'no duplication required; source rate is not below the target rate',
  frameDropPolicy:
    result.source.averageFrameRate > result.profile.targetFps
      ? 'surplus source frames are dropped by the explicit fps filter'
      : 'no drop required; source rate is not above the target rate',
});
