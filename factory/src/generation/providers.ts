import {execFileSync} from 'node:child_process';
import {mkdirSync, statSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {deflateSync} from 'node:zlib';
import type {
  CapabilityViolation,
  GenerationOperation,
  GenerationOutputKind,
  GenerationOutputSpec,
  GenerationProvider,
  GenerationProviderId,
  HttpRequest,
  HttpResponse,
  HttpTransport,
  ModelCapability,
  ProviderCapabilities,
  ProviderOutput,
  ProviderRequest,
  ProviderStatusResult,
  ProviderSubmitResult,
} from './types';
import {RUNWAY_API_VERSION} from './types';

const RATIO_TOLERANCE = 0.02;

const parseRatio = (value: string): {width: number; height: number} | null => {
  const match = value.match(/^(\d+):(\d+)$/);
  if (!match) return null;
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!(width > 0) || !(height > 0)) return null;
  return {width, height};
};

const ratioOf = (value: {width: number; height: number}): number => value.width / value.height;

const matchesAspect = (candidate: string, requested: string): boolean => {
  const left = parseRatio(candidate);
  const right = parseRatio(requested);
  if (!left || !right) return false;
  return Math.abs(ratioOf(left) - ratioOf(right)) <= RATIO_TOLERANCE;
};

/**
 * Capability manifests are declarative. They encode the documented provider
 * contract; they do not prove a live service behaves that way.
 */
export const OFFLINE_CAPABILITIES: ProviderCapabilities = {
  provider: 'offline-fixture',
  apiVersion: null,
  operations: ['text-to-image', 'image-to-video', 'text-to-video'],
  outputKinds: ['image', 'video', 'transparent-layer'],
  models: [
    {
      id: 'offline-fixture-v1',
      operations: ['text-to-image', 'image-to-video', 'text-to-video'],
      outputKinds: ['image', 'video', 'transparent-layer'],
      aspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4'],
      durationsSeconds: [],
      resolutions: [],
      maxReferences: 4,
      supportsSeed: true,
      supportsAlpha: true,
      generatesAudio: false,
      formats: ['png', 'mp4'],
    },
  ],
  maxReferenceUploads: 0,
  liveRequests: 'not-implemented',
  notes: [
    'Deterministic local fixture provider. Outputs are synthetic-offline-test-output, never AI-generated media.',
    'Accepts any positive duration so shot lengths are not artificially constrained.',
    'Never reaches the network.',
  ],
};

/**
 * Runway contract pinned at X-Runway-Version 2024-11-06. Model identifiers and
 * capabilities are configurable through this manifest and validated before any
 * submission. This adapter is not executed live in this phase.
 */
export const RUNWAY_CAPABILITIES: ProviderCapabilities = {
  provider: 'runway',
  apiVersion: RUNWAY_API_VERSION,
  operations: ['text-to-image', 'image-to-video'],
  outputKinds: ['image', 'video'],
  models: [
    {
      id: 'gen4_image',
      operations: ['text-to-image'],
      outputKinds: ['image'],
      aspectRatios: ['1920:1080', '1080:1920', '1024:1024', '1360:768', '1080:1080', '1168:880', '1440:1080', '1080:1440', '1808:768', '768:1808', '2112:912', '912:2112'],
      durationsSeconds: [],
      resolutions: [],
      maxReferences: 0,
      supportsSeed: true,
      supportsAlpha: false,
      generatesAudio: false,
      formats: ['png', 'jpeg'],
    },
    {
      id: 'gen4_turbo',
      operations: ['image-to-video'],
      outputKinds: ['video'],
      aspectRatios: ['1280:720', '720:1280', '1104:832', '832:1104', '960:960', '1584:672'],
      durationsSeconds: [5, 10],
      resolutions: [],
      maxReferences: 1,
      supportsSeed: true,
      supportsAlpha: false,
      generatesAudio: false,
      formats: ['mp4'],
    },
  ],
  maxReferenceUploads: 1,
  liveRequests: 'supported',
  notes: [
    `Contract: POST /v1/text_to_image, POST /v1/image_to_video, GET /v1/tasks/{id}, header X-Runway-Version: ${RUNWAY_API_VERSION}.`,
    'Durations are limited to the documented set; a shot longer than the largest supported clip must be split or reduced.',
    'Alpha output is not advertised by these models; a transparent layer requirement cannot be satisfied by this provider.',
    'No live request was made while implementing or testing this adapter.',
  ],
};

const modelFor = (capabilities: ProviderCapabilities, model: string): ModelCapability | null =>
  capabilities.models.find((entry) => entry.id === model) ?? null;

export const supportedDurations = (model: ModelCapability): number[] => model.durationsSeconds;

/** Smallest supported duration that covers the need, or null when impossible. */
export const resolveProviderDuration = (model: ModelCapability, neededSeconds: number): number | null => {
  if (model.durationsSeconds.length === 0) return Math.max(1, Math.ceil(neededSeconds));
  const sorted = [...model.durationsSeconds].sort((left, right) => left - right);
  return sorted.find((duration) => duration + 1e-9 >= neededSeconds) ?? null;
};

export const validateProviderRequest = (
  capabilities: ProviderCapabilities,
  request: ProviderRequest,
  options: {allowReferenceUpload: boolean},
): CapabilityViolation[] => {
  const violations: CapabilityViolation[] = [];
  const model = modelFor(capabilities, request.model);
  if (!capabilities.operations.includes(request.operation)) {
    violations.push({
      code: 'unsupported-operation',
      message: `${capabilities.provider} does not implement ${request.operation}`,
    });
  }
  if (!model) {
    violations.push({
      code: 'unsupported-model',
      message: `${capabilities.provider} has no documented model ${request.model}`,
    });
    return violations;
  }
  if (!model.operations.includes(request.operation)) {
    violations.push({
      code: 'unsupported-operation',
      message: `model ${model.id} does not support ${request.operation}`,
    });
  }
  if (!model.outputKinds.includes(request.output.kind)) {
    violations.push({
      code: 'unsupported-output-kind',
      message: `model ${model.id} cannot produce ${request.output.kind}`,
    });
  }
  if (request.output.kind === 'transparent-layer' && !model.supportsAlpha) {
    violations.push({
      code: 'alpha-not-supported',
      message: `model ${model.id} does not advertise an alpha channel; a transparent layer cannot be requested`,
    });
  }
  const ratioOk = model.aspectRatios.some((ratio) => matchesAspect(ratio, request.output.aspectRatio));
  if (!ratioOk) {
    violations.push({
      code: 'unsupported-aspect-ratio',
      message: `model ${model.id} does not support aspect ratio ${request.output.aspectRatio}`,
    });
  }
  if (request.output.kind === 'video') {
    const neededSeconds =
      request.output.durationFrames !== null
        ? request.output.durationFrames / Math.max(1, request.output.fps)
        : 0;
    if (resolveProviderDuration(model, neededSeconds) === null) {
      violations.push({
        code: 'unsupported-duration',
        message: `model ${model.id} supports ${model.durationsSeconds.join('/')}s clips but the shot needs ${neededSeconds.toFixed(3)}s`,
      });
    }
  }
  if (model.supportsSeed === false && request.seed !== null) {
    violations.push({
      code: 'seed-not-supported',
      message: `model ${model.id} does not accept a seed`,
    });
  }
  const referenceCount = request.references.length;
  if (referenceCount > 0 && model.maxReferences === 0) {
    violations.push({
      code: 'references-not-supported',
      message: `model ${model.id} accepts no reference images`,
    });
  }
  if (referenceCount > model.maxReferences) {
    violations.push({
      code: 'too-many-references',
      message: `model ${model.id} accepts at most ${model.maxReferences} reference images, received ${referenceCount}`,
    });
  }
  if (referenceCount > 0 && !options.allowReferenceUpload) {
    violations.push({
      code: 'reference-upload-not-authorized',
      message: 'private reference upload is not authorized for this job',
    });
  }
  return violations;
};

// ---------------------------------------------------------------------------
// Offline fixture provider: real bytes, deterministic, no network.
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();
const crc32 = (buffer: Buffer): number => {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
};
const pngChunk = (type: string, data: Buffer): Buffer => {
  const name = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([name, data])), 0);
  return Buffer.concat([length, name, data, crc]);
};

const hashSeed = (value: string): number => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

const paletteFor = (seed: number): Array<[number, number, number]> => {
  const base = seed % 360;
  const hue = (offset: number): [number, number, number] => {
    const h = ((base + offset) % 360) / 60;
    const sector = Math.floor(h);
    const f = h - sector;
    const table: Array<[number, number, number]> = [
      [255, 60, 60], [255, 200, 60], [120, 230, 90], [60, 220, 230], [70, 120, 255], [220, 90, 240],
    ];
    const a = table[sector % 6];
    const b = table[(sector + 1) % 6];
    return [
      Math.round(a[0] + (b[0] - a[0]) * f),
      Math.round(a[1] + (b[1] - a[1]) * f),
      Math.round(a[2] + (b[2] - a[2]) * f),
    ];
  };
  return [hue(0), hue(120), hue(240)];
};

const writePng = (
  file: string,
  width: number,
  height: number,
  kind: GenerationOutputKind,
  seed: number,
): void => {
  const [primary, secondary] = paletteFor(seed);
  const rowSize = width * 4 + 1;
  const raw = Buffer.alloc(rowSize * height);
  const centerX = width / 2;
  const centerY = height / 2;
  const radius = Math.min(width, height) * 0.28;
  for (let y = 0; y < height; y++) {
    const row = y * rowSize;
    raw[row] = 0;
    for (let x = 0; x < width; x++) {
      const index = row + 1 + x * 4;
      const dx = x - centerX;
      const dy = y - centerY;
      const distance = Math.sqrt(dx * dx + dy * dy);
      if (kind === 'transparent-layer') {
        const inRing = distance >= radius - Math.max(8, width * 0.02) && distance <= radius + Math.max(4, width * 0.01);
        const inCore = distance < Math.max(12, width * 0.03);
        if (inRing) {
          raw[index] = primary[0];
          raw[index + 1] = primary[1];
          raw[index + 2] = primary[2];
          raw[index + 3] = 235;
        } else if (inCore) {
          raw[index] = secondary[0];
          raw[index + 1] = secondary[1];
          raw[index + 2] = secondary[2];
          raw[index + 3] = 150;
        } else {
          raw[index] = 0;
          raw[index + 1] = 0;
          raw[index + 2] = 0;
          raw[index + 3] = 0;
        }
        continue;
      }
      const band = Math.floor((x / width) * 4) % 2 === Math.floor((y / height) * 3) % 2;
      const tone = distance < radius ? secondary : primary;
      raw[index] = band ? primary[0] : tone[0];
      raw[index + 1] = band ? primary[1] : tone[1];
      raw[index + 2] = band ? primary[2] : tone[2];
      raw[index + 3] = 255;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  mkdirSync(path.dirname(file), {recursive: true});
  writeFileSync(
    file,
    Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      pngChunk('IHDR', header),
      pngChunk('IDAT', deflateSync(raw, {level: 6})),
      pngChunk('IEND', Buffer.alloc(0)),
    ]),
  );
};

const toHexColor = (rgb: [number, number, number]): string =>
  `#${rgb.map((value) => value.toString(16).padStart(2, '0')).join('')}`;

const writeVideo = (
  file: string,
  width: number,
  height: number,
  fps: number,
  frameCount: number,
  seed: number,
): void => {
  const palette = paletteFor(seed).map(toHexColor);
  const seconds = frameCount / fps;
  const segmentSeconds = seconds / palette.length;
  const inputArgs: string[] = [];
  for (const color of palette) {
    inputArgs.push(
      '-f', 'lavfi', '-i',
      `color=c=${color}:s=${width}x${height}:r=${fps}:d=${segmentSeconds.toFixed(6)}`,
    );
  }
  const filter = `${palette.map((_, index) => `[${index}:v]`).join('')}concat=n=${palette.length}:v=1:a=0,format=yuv420p[v]`;
  mkdirSync(path.dirname(file), {recursive: true});
  execFileSync(
    'ffmpeg',
    [
      '-y', '-hide_banner', '-loglevel', 'error',
      ...inputArgs,
      '-filter_complex', filter,
      '-map', '[v]',
      '-t', seconds.toFixed(6),
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
      '-g', String(Math.max(1, Math.round(fps / 2))),
      '-pix_fmt', 'yuv420p',
      '-colorspace', 'bt709', '-color_trc', 'bt709', '-color_primaries', 'bt709',
      '-movflags', '+faststart',
      '-f', 'mp4', file,
    ],
    {stdio: 'pipe', windowsHide: true},
  );
};

export type OfflineProviderOptions = {
  outputRoot: string;
  jobId: string;
};

/**
 * Deterministic local provider. It writes real PNG/MP4 bytes for the requested
 * output and marks them as offline test output, never as AI generation.
 */
export const createOfflineProvider = (options: OfflineProviderOptions): GenerationProvider => {
  const jobDir = path.join(options.outputRoot, options.jobId);
  let lastRequest: ProviderRequest | null = null;
  let lastOutput: ProviderOutput | null = null;
  const taskId = `offline-${options.jobId}`;
  return {
    capabilities: OFFLINE_CAPABILITIES,
    validate: (request) => validateProviderRequest(OFFLINE_CAPABILITIES, request, {allowReferenceUpload: true}),
    submit: async (request: ProviderRequest): Promise<ProviderSubmitResult> => {
      lastRequest = request;
      const seed = request.seed ?? hashSeed(`${request.jobId}|${request.promptText}`);
      const files: ProviderOutput['files'] = [];
      const width = request.output.width ?? 640;
      const height = request.output.height ?? 360;
      if (request.output.kind === 'video') {
        const frameCount = request.output.frameCount ?? Math.max(1, Math.round((request.output.durationFrames ?? request.output.fps) ));
        const target = path.join(jobDir, 'clip.mp4');
        writeVideo(target, width, height, request.output.fps, frameCount, seed);
        files.push({kind: 'video', source: 'local', location: target, bytes: statSync(target).size});
      } else {
        const target = path.join(jobDir, request.output.kind === 'transparent-layer' ? 'layer.png' : 'image.png');
        writePng(target, width, height, request.output.kind, seed);
        files.push({kind: request.output.kind, source: 'local', location: target, bytes: statSync(target).size});
      }
      lastOutput = {
        files,
        providerTaskId: taskId,
        notes: ['synthetic-offline-test-output'],
      };
      return {taskId, state: 'succeeded'};
    },
    status: async (): Promise<ProviderStatusResult> => ({
      state: lastOutput ? 'succeeded' : 'failed',
      progress: lastOutput ? 1 : 0,
      failure: lastOutput ? null : 'no offline submission recorded',
      outputUrl: null,
    }),
    retrieve: async (): Promise<ProviderOutput> => {
      if (!lastOutput) throw new Error('offline provider has no completed submission to retrieve');
      return lastOutput;
    },
    cancel: null,
  };
};

// ---------------------------------------------------------------------------
// Runway adapter: never executed live in this phase.
// ---------------------------------------------------------------------------

export type RunwayAdapterOptions = {
  transport: HttpTransport;
  apiKey: string | null;
  baseUrl: string;
};

const RUNWAY_RATIO_PIXELS = (model: ModelCapability, requested: string): string => {
  const match = model.aspectRatios.find((ratio) => matchesAspect(ratio, requested));
  return match ?? requested;
};

const redactUrl = (url: string): string => {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return '<invalid-url>';
  }
};

/**
 * Adapter for the documented Runway HTTP contract. It requires an explicit
 * transport, so nothing here can reach the network on its own; the default
 * implementation refuses every request.
 */
export const createRunwayProvider = (options: RunwayAdapterOptions): GenerationProvider & {
  lastRequestRecord: HttpRequest | null;
} => {
  const baseUrl = options.baseUrl;
  let lastRequestRecord: HttpRequest | null = null;
  const send = async (request: HttpRequest): Promise<HttpResponse> => {
    lastRequestRecord = {...request, headers: {...request.headers, Authorization: 'Bearer <redacted>'}};
    if (!options.apiKey) {
      throw new Error('Runway credentials are missing; no request was sent');
    }
    return options.transport(request);
  };
  const headers = (): Record<string, string> => ({
    Authorization: `Bearer ${options.apiKey ?? ''}`,
    'Content-Type': 'application/json',
    'X-Runway-Version': RUNWAY_API_VERSION,
  });
  const parse = (response: HttpResponse, label: string): Record<string, unknown> => {
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`Runway ${label} failed with HTTP ${response.status}`);
    }
    try {
      return JSON.parse(response.body) as Record<string, unknown>;
    } catch {
      throw new Error(`Runway ${label} returned a non-JSON body`);
    }
  };
  const provider = {
    capabilities: RUNWAY_CAPABILITIES,
    get lastRequestRecord() {
      return lastRequestRecord;
    },
    validate: (request: ProviderRequest) =>
      validateProviderRequest(RUNWAY_CAPABILITIES, request, {allowReferenceUpload: options.apiKey !== null}),
    submit: async (request: ProviderRequest): Promise<ProviderSubmitResult> => {
      const model = modelFor(RUNWAY_CAPABILITIES, request.model);
      if (!model) throw new Error(`Unsupported Runway model ${request.model}`);
      const isImage = request.operation === 'text-to-image';
      const body: Record<string, unknown> = isImage
        ? {
            model: request.model,
            ratio: RUNWAY_RATIO_PIXELS(model, request.output.aspectRatio),
            promptText: request.promptText,
          }
        : {
            model: request.model,
            ratio: RUNWAY_RATIO_PIXELS(model, request.output.aspectRatio),
            promptText: request.promptText,
            duration: resolveProviderDuration(
              model,
              (request.output.durationFrames ?? 0) / Math.max(1, request.output.fps),
            ),
            promptImage: request.references[0]?.path ?? null,
          };
      if (request.seed !== null && model.supportsSeed) body.seed = request.seed;
      const response = await send({
        method: 'POST',
        url: `${baseUrl}/v1/${isImage ? 'text_to_image' : 'image_to_video'}`,
        headers: headers(),
        body: JSON.stringify(body),
      });
      const parsed = parse(response, 'submission');
      const taskId = typeof parsed.id === 'string' ? parsed.id : null;
      if (!taskId) throw new Error('Runway submission returned no task id');
      return {taskId, state: 'submitted'};
    },
    status: async (taskId: string): Promise<ProviderStatusResult> => {
      const response = await send({
        method: 'GET',
        url: `${baseUrl}/v1/tasks/${encodeURIComponent(taskId)}`,
        headers: headers(),
        body: null,
      });
      const parsed = parse(response, 'task status');
      const raw = String(parsed.status ?? '').toUpperCase();
      const map: Record<string, ProviderStatusResult['state']> = {
        PENDING: 'queued',
        THROTTLED: 'queued',
        RUNNING: 'running',
        SUCCEEDED: 'succeeded',
        FAILED: 'failed',
        CANCELLED: 'canceled',
      };
      const state = map[raw];
      if (!state) throw new Error(`Runway returned an unrecognized task status`);
      const failure =
        state === 'failed'
          ? String((parsed.failure as string | undefined) ?? 'provider reported failure')
          : null;
      const output = Array.isArray(parsed.output) ? parsed.output.filter((value): value is string => typeof value === 'string') : [];
      return {
        state,
        progress: typeof parsed.progress === 'number' ? parsed.progress : null,
        failure,
        outputUrl: output[0] ?? null,
      };
    },
    retrieve: async (taskId: string): Promise<ProviderOutput> => {
      const status = await provider.status(taskId);
      if (status.state !== 'succeeded' || !status.outputUrl) {
        throw new Error(`Runway task ${taskId} is ${status.state}; no output is available`);
      }
      return {
        files: [{kind: 'video', source: 'https', location: status.outputUrl, bytes: null}],
        providerTaskId: taskId,
        notes: [`output url ${redactUrl(status.outputUrl)}`],
      };
    },
    cancel: null,
  };
  return provider;
};

export const createDenyingTransport = (): HttpTransport => async (request) => {
  throw new Error(`live provider activity is not authorized (${request.method} ${redactUrl(request.url)})`);
};
