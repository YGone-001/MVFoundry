// Generates the synthetic media-handoff projects in an external workspace.
// Audio, MP4 and transparent PNG fixtures stay outside the engine repository
// and are deliberately NOT declared in project.json: they are the local files a
// reviewer later attaches to planned media slots.
//
// Usage: npm run handoff:seed
//        node factory/scripts/seed-media-handoff-workspace.mjs --root <external-root>
// Requires FFmpeg on PATH for MP4 generation.

import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import path from 'node:path';
import {deflateSync} from 'node:zlib';
import {fileURLToPath} from 'node:url';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const templatesRoot = path.resolve(here, '..', 'examples', 'media-handoff-projects');
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
  throw new Error('Media-handoff workspace must be outside and must not contain the engine repository');
}
mkdirSync(rawRoot, {recursive: true});
const workspaceRoot = realpathSync(rawRoot);
if (isInside(engineRoot, workspaceRoot) || isInside(workspaceRoot, engineRoot)) {
  throw new Error('Media-handoff workspace must be outside and must not contain the engine repository');
}

const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
const ensureParent = (file) => mkdirSync(path.dirname(file), {recursive: true});

// kind: 'ring' keeps a transparent surround, 'grid' keeps transparent gaps.
const LAYERS = {
  ring: (x, y, width, height) => {
    const dx = x - width / 2;
    const dy = y - height / 2;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const radius = Math.min(width, height) * 0.3;
    if (distance >= radius - 26 && distance <= radius + 10) return [255, 212, 121, 235];
    if (distance < 34) return [123, 223, 242, 120];
    return [0, 0, 0, 0];
  },
  grid: (x, y, width) => {
    if (x % 48 < 6 || y % 48 < 6) return [233, 227, 210, 90];
    return [0, 0, 0, 0];
  },
  sigil: (x, y, width, height) => {
    const dx = x - width / 2;
    const dy = y - height / 2;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const radius = Math.min(width, height) * 0.26;
    if (Math.abs(distance - radius) < 14) return [138, 166, 161, 225];
    if (distance < 22) return [245, 214, 186, 200];
    return [0, 0, 0, 0];
  },
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

const writeAlphaPng = (file, width, height, kind) => {
  const paint = LAYERS[kind];
  if (!paint) throw new Error(`No layer pattern ${kind}`);
  const rowSize = width * 4 + 1;
  const raw = Buffer.alloc(rowSize * height);
  for (let y = 0; y < height; y++) {
    const row = y * rowSize;
    raw[row] = 0;
    for (let x = 0; x < width; x++) {
      const index = row + 1 + x * 4;
      const [red, green, blue, alpha] = paint(x, y, width, height);
      raw[index] = red;
      raw[index + 1] = green;
      raw[index + 2] = blue;
      raw[index + 3] = alpha;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  ensureParent(file);
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

const writeWavStereo = (file, sampleRate, seconds, frequency) => {
  const channels = 2;
  const bits = 16;
  const frames = Math.round(seconds * sampleRate);
  const dataSize = frames * channels * (bits / 8);
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
  const fade = Math.round(sampleRate * 0.02);
  const clamp = (value) => Math.max(-1, Math.min(1, value));
  for (let index = 0; index < frames; index++) {
    const envelope = Math.min(1, index / fade, (frames - index) / fade);
    const beat = index % Math.round(sampleRate / 2) < Math.round(sampleRate / 12) ? 0.5 : 0;
    const value = clamp(
      Math.sin((2 * Math.PI * frequency * index) / sampleRate) * 0.18 * envelope + beat * envelope,
    );
    const sample = Math.round(value * 32767);
    buffer.writeInt16LE(sample, 44 + index * 4);
    buffer.writeInt16LE(sample, 46 + index * 4);
  }
  ensureParent(file);
  writeFileSync(file, buffer);
};

const generateVideo = (file, spec) => {
  const segmentSeconds = spec.seconds / spec.colors.length;
  const inputArgs = [];
  for (const color of spec.colors) {
    inputArgs.push(
      '-f', 'lavfi', '-i',
      `color=c=${color}:s=${spec.width}x${spec.height}:r=${spec.fps}:d=${segmentSeconds}`,
    );
  }
  inputArgs.push('-f', 'lavfi', '-i', `sine=frequency=950:sample_rate=48000:duration=${spec.seconds}`);
  const filter = `${spec.colors.map((_, index) => `[${index}:v]`).join('')}concat=n=${
    spec.colors.length}:v=1:a=0,format=yuv420p[v]`;
  ensureParent(file);
  execFileSync(
    'ffmpeg',
    [
      '-y', '-hide_banner', '-loglevel', 'error', ...inputArgs,
      '-filter_complex', filter, '-map', '[v]', '-map', `${spec.colors.length}:a`,
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
      '-g', String(Math.max(1, Math.round(spec.fps / 2))), '-pix_fmt', 'yuv420p',
      '-colorspace', 'bt709', '-color_trc', 'bt709', '-color_primaries', 'bt709',
      '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart',
      '-f', 'mp4', file,
    ],
    {stdio: 'inherit', windowsHide: true},
  );
};

const FIXTURES = {
  'synthetic-mixed-timeline-demo': {
    audio: {file: 'source/audio/mixed-tone-4s.wav', seconds: 4, frequency: 440},
    video: {
      file: 'intake/video/harbour-30fps.mp4', width: 1280, height: 720, fps: 30, seconds: 3.5,
      colors: ['red', 'lime', 'blue', 'yellow', 'magenta'],
      assetId: 'VID-HARBOUR',
    },
    layers: [],
  },
  'synthetic-hybrid-continuity-demo': {
    audio: {file: 'source/audio/hybrid-tone-4s.wav', seconds: 4, frequency: 330},
    video: {
      file: 'intake/video/stairwell-24fps.mp4', width: 540, height: 960, fps: 24, seconds: 4,
      colors: ['red', 'lime', 'blue', 'yellow', 'magenta', 'cyan'],
      assetId: 'VID-STAIRWELL',
    },
    layers: [
      {file: 'intake/layers/lantern.png', width: 540, height: 960, pattern: 'ring', assetId: 'LYR-LANTERN'},
      {file: 'intake/layers/grid.png', width: 540, height: 960, pattern: 'grid', assetId: 'LYR-GRID'},
    ],
  },
  'synthetic-unresolved-media-demo': {
    audio: {file: 'source/audio/unresolved-tone-3s.wav', seconds: 3, frequency: 262},
    video: {
      file: 'intake/video/water-25fps.mp4', width: 800, height: 800, fps: 25, seconds: 3.2,
      colors: ['red', 'lime', 'blue', 'magenta'],
      assetId: 'VID-WATER',
    },
    layers: [
      {file: 'intake/layers/sigil.png', width: 800, height: 800, pattern: 'sigil', assetId: 'LYR-SIGIL'},
    ],
  },
};

const generated = [];
for (const templateId of readdirSync(templatesRoot, {withFileTypes: true})
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort()) {
  const templateDir = path.join(templatesRoot, templateId);
  if (!existsSync(path.join(templateDir, 'project.template.json'))) continue;
  const spec = FIXTURES[templateId];
  if (!spec) throw new Error(`No media-handoff fixture definition for ${templateId}`);
  const target = path.join(workspaceRoot, templateId);
  if (existsSync(target)) throw new Error(`Project already exists: ${target}; use a fresh workspace`);
  mkdirSync(target, {recursive: true});
  for (const directory of ['source/audio', 'preproduction', 'cache', 'renders', 'reports']) {
    mkdirSync(path.join(target, directory), {recursive: true});
  }

  const audioFile = path.join(target, spec.audio.file);
  writeWavStereo(audioFile, 48000, spec.audio.seconds, spec.audio.frequency);
  generateVideo(path.join(target, spec.video.file), spec.video);
  for (const layer of spec.layers) {
    writeAlphaPng(path.join(target, layer.file), layer.width, layer.height, layer.pattern);
  }

  const config = JSON.parse(readFileSync(path.join(templateDir, 'project.template.json'), 'utf8'));
  config.projectId = templateId;
  config.audio.path = spec.audio.file;
  config.audio.sha256 = sha256(audioFile);
  config.audio.durationSeconds = spec.audio.seconds;
  for (const asset of config.assets) {
    if (asset.kind !== 'audio-reference') continue;
    asset.path = spec.audio.file;
    asset.sha256 = config.audio.sha256;
  }
  writeFileSync(path.join(target, 'project.json'), `${JSON.stringify(config, null, 2)}\n`);

  for (const [source, targetName] of [
    ['annotations.template.json', 'annotations.json'],
    ['creative-brief.template.json', 'creative-brief.json'],
    ['continuity.template.json', 'continuity.json'],
  ]) {
    const sourceFile = path.join(templateDir, source);
    if (!existsSync(sourceFile)) throw new Error(`Missing ${source} for ${templateId}`);
    const value = JSON.parse(readFileSync(sourceFile, 'utf8'));
    value.projectId = templateId;
    writeFileSync(
      path.join(target, 'preproduction', targetName),
      `${JSON.stringify(value, null, 2)}\n`,
    );
  }

  generated.push({
    projectId: templateId,
    projectDir: target,
    audio: {path: config.audio.path, sha256: config.audio.sha256},
    intake: [spec.video, ...spec.layers].map((asset) => ({
      assetId: asset.assetId,
      kind: asset.assetId === 'VID-STAIRWELL' || asset.file.endsWith('.mp4') ? 'video' : 'layer',
      path: asset.file,
      sha256: sha256(path.join(target, asset.file)),
    })),
  });
}

console.log(JSON.stringify({workspaceRoot, projects: generated}, null, 2));
