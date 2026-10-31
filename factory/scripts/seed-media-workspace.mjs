// Generates the synthetic local video/hybrid fixtures and project manifests.
// The generated MP4/PNG/WAV files stay in the selected external workspace.
//
// Usage:
//   npm run media:seed
//   node factory/scripts/seed-media-workspace.mjs --root <external-workspace>
//
// Requires FFmpeg on PATH for MP4 generation and factory/dist for workspace
// guard helpers (the npm script builds first).

import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import {createRequire} from 'node:module';
import path from 'node:path';
import {deflateSync} from 'node:zlib';
import {fileURLToPath} from 'node:url';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const templatesRoot = path.resolve(here, '..', 'examples', 'media-projects');
const {isInside} = require('../dist/src/workspace/guard.js');

const args = process.argv.slice(2);
const rootArg = args.includes('--root') ? args[args.indexOf('--root') + 1] : undefined;
const rawRoot = rootArg ?? process.env.MV_WORKSPACE_ROOT;
if (!rawRoot) {
  console.error('MV_WORKSPACE_ROOT or --root is required');
  process.exit(2);
}

const engineRoot = realpathSync(repoRoot);
let ancestor = path.resolve(rawRoot);
while (!existsSync(ancestor)) {
  const parent = path.dirname(ancestor);
  if (parent === ancestor) break;
  ancestor = parent;
}
const ancestorReal = realpathSync(ancestor);
if (isInside(engineRoot, ancestorReal) || isInside(ancestorReal, engineRoot)) {
  throw new Error('Media workspace must be outside and must not contain the engine repository');
}
mkdirSync(rawRoot, {recursive: true});
const workspaceRoot = realpathSync(rawRoot);
if (isInside(engineRoot, workspaceRoot) || isInside(workspaceRoot, engineRoot)) {
  throw new Error('Media workspace must be outside and must not contain the engine repository');
}

const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
const ensureParent = (file) => mkdirSync(path.dirname(file), {recursive: true});

const FIXTURES = {
  'synthetic-video-demo': {
    video: {
      file: 'assets/video/source-30fps.mp4',
      width: 1280,
      height: 720,
      fps: 30,
      seconds: 3,
      colors: ['red', 'lime', 'blue', 'yellow', 'magenta', 'cyan'],
    },
    audio: {file: 'source/audio/tone-2s.wav', seconds: 2, frequency: 440},
  },
  'synthetic-hybrid-demo': {
    video: {
      file: 'assets/video/source-24fps.mp4',
      width: 720,
      height: 1280,
      fps: 24,
      seconds: 3,
      colors: ['red', 'lime', 'blue', 'yellow', 'magenta', 'cyan'],
    },
    audio: {file: 'source/audio/tone-1.5s.wav', seconds: 1.5, frequency: 330},
    layer: {file: 'assets/layers/ring.png', width: 1080, height: 1920},
  },
};

const writeWav = (file, seconds, frequency) => {
  const sampleRate = 48000;
  const channels = 1;
  const bits = 16;
  const samples = Math.round(seconds * sampleRate);
  const dataSize = samples * channels * (bits / 8);
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * channels * (bits / 8), 28);
  buffer.writeUInt16LE(channels * (bits / 8), 32);
  buffer.writeUInt16LE(bits, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);
  const fadeSamples = Math.round(sampleRate * 0.02);
  for (let index = 0; index < samples; index++) {
    const fadeIn = Math.min(1, index / fadeSamples);
    const fadeOut = Math.min(1, (samples - 1 - index) / fadeSamples);
    const value =
      Math.sin((2 * Math.PI * frequency * index) / sampleRate) * 0.2 * fadeIn * fadeOut;
    buffer.writeInt16LE(Math.round(value * 32767), 44 + index * 2);
  }
  writeFileSync(file, buffer);
};

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();
const crc32 = (buffer) => {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
};
const pngChunk = (type, data) => {
  const name = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([name, data])), 0);
  return Buffer.concat([length, name, data, crc]);
};

const writeRingPng = (file, width, height) => {
  const rowSize = width * 4 + 1;
  const raw = Buffer.alloc(rowSize * height);
  const centerX = width / 2;
  const centerY = height / 2;
  const radius = Math.min(width, height) * 0.3;
  for (let y = 0; y < height; y++) {
    const row = y * rowSize;
    raw[row] = 0;
    for (let x = 0; x < width; x++) {
      const index = row + 1 + x * 4;
      const dx = x - centerX;
      const dy = y - centerY;
      const distance = Math.sqrt(dx * dx + dy * dy);
      let alpha = 0;
      if (distance >= radius - 48 && distance <= radius + 16) alpha = 225;
      else if (distance < 54) alpha = 85;
      raw[index] = 255;
      raw[index + 1] = 196;
      raw[index + 2] = 80;
      raw[index + 3] = alpha;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  writeFileSync(
    file,
    Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      pngChunk('IHDR', header),
      pngChunk('IDAT', deflateSync(raw, {level: 9})),
      pngChunk('IEND', Buffer.alloc(0)),
    ]),
  );
};

const generateVideo = (file, spec) => {
  const segmentSeconds = spec.seconds / spec.colors.length;
  const inputArgs = [];
  for (const color of spec.colors) {
    inputArgs.push(
      '-f',
      'lavfi',
      '-i',
      `color=c=${color}:s=${spec.width}x${spec.height}:r=${spec.fps}:d=${segmentSeconds}`,
    );
  }
  inputArgs.push(
    '-f',
    'lavfi',
    '-i',
    `sine=frequency=950:sample_rate=48000:duration=${spec.seconds}`,
  );
  const filter = `${spec.colors.map((_, index) => `[${index}:v]`).join('')}concat=n=${
    spec.colors.length
  }:v=1:a=0,format=yuv420p[v]`;
  const ffmpegArgs = [
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    ...inputArgs,
    '-filter_complex',
    filter,
    '-map',
    '[v]',
    '-map',
    `${spec.colors.length}:a`,
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '18',
    '-g',
    String(Math.max(1, Math.round(spec.fps / 2))),
    '-pix_fmt',
    'yuv420p',
    '-r',
    String(spec.fps),
    '-c:a',
    'aac',
    '-b:a',
    '96k',
    '-shortest',
    '-movflags',
    '+faststart',
    '-map_metadata',
    '-1',
    file,
  ];
  try {
    execFileSync('ffmpeg', ffmpegArgs, {encoding: 'utf8', windowsHide: true});
  } catch (error) {
    const stderr = error && typeof error.stderr === 'string' ? error.stderr.trim() : '';
    throw new Error(`FFmpeg video generation failed${stderr ? `: ${stderr}` : ''}`);
  }
};

const templateDirs = existsSync(templatesRoot)
  ? readdirSync(templatesRoot, {withFileTypes: true})
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
  : [];

const generated = [];
for (const templateId of templateDirs) {
  const templateFile = path.join(templatesRoot, templateId, 'project.template.json');
  if (!existsSync(templateFile)) continue;
  const fixture = FIXTURES[templateId];
  if (!fixture) throw new Error(`No media fixture definition for ${templateId}`);
  const target = path.join(workspaceRoot, templateId);
  if (existsSync(target)) {
    throw new Error(`Media project already exists: ${target}; use a fresh workspace`);
  }
  mkdirSync(target, {recursive: true});
  mkdirSync(path.join(target, 'assets', 'video'), {recursive: true});
  mkdirSync(path.join(target, 'assets', 'layers'), {recursive: true});
  mkdirSync(path.join(target, 'source', 'audio'), {recursive: true});
  mkdirSync(path.join(target, 'cache'), {recursive: true});
  mkdirSync(path.join(target, 'renders'), {recursive: true});
  mkdirSync(path.join(target, 'reports'), {recursive: true});
  mkdirSync(path.join(target, 'scenes'), {recursive: true});

  const config = JSON.parse(readFileSync(templateFile, 'utf8'));
  config.projectId = templateId;
  config.audio.path = fixture.audio.file;
  config.audio.durationSeconds = fixture.audio.seconds;
  const audioFile = path.join(target, fixture.audio.file);
  ensureParent(audioFile);
  writeWav(audioFile, fixture.audio.seconds, fixture.audio.frequency);
  config.audio.sha256 = sha256(audioFile);

  const videoFile = path.join(target, fixture.video.file);
  ensureParent(videoFile);
  generateVideo(videoFile, fixture.video);

  let layerFile = null;
  if (fixture.layer) {
    layerFile = path.join(target, fixture.layer.file);
    ensureParent(layerFile);
    writeRingPng(layerFile, fixture.layer.width, fixture.layer.height);
  }

  for (const asset of config.assets) {
    if (asset.kind === 'video') {
      asset.path = fixture.video.file;
      asset.sha256 = sha256(videoFile);
    } else if (asset.kind === 'layer') {
      if (!layerFile) throw new Error(`No layer fixture for ${asset.id}`);
      asset.path = fixture.layer.file;
      asset.sha256 = sha256(layerFile);
    }
  }
  writeFileSync(path.join(target, 'project.json'), JSON.stringify(config, null, 2));
  generated.push({
    projectId: templateId,
    projectDir: target,
    audio: {path: fixture.audio.file, sha256: config.audio.sha256},
    video: {path: fixture.video.file, sha256: sha256(videoFile)},
    layer: layerFile ? {path: fixture.layer.file, sha256: sha256(layerFile)} : null,
  });
}

console.log(JSON.stringify({workspaceRoot, projects: generated}, null, 2));
