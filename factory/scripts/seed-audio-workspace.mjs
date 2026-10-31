// Generates deterministic synthetic audio fixtures and project manifests in an
// external workspace. No generated audio/video is written inside the engine.
//
// Usage:
//   npm run audio:seed
//   node factory/scripts/seed-audio-workspace.mjs --root <external-workspace>
//
// Requires FFmpeg on PATH for MP3/FLAC/M4A/MP4 generation and factory/dist for
// workspace guard helpers (the npm script builds first).

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
const templatesRoot = path.resolve(here, '..', 'examples', 'audio-projects');
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
  throw new Error('Audio workspace must be outside and must not contain the engine repository');
}
mkdirSync(rawRoot, {recursive: true});
const workspaceRoot = realpathSync(rawRoot);
if (isInside(engineRoot, workspaceRoot) || isInside(workspaceRoot, engineRoot)) {
  throw new Error('Audio workspace must be outside and must not contain the engine repository');
}

const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
const ensureParent = (file) => mkdirSync(path.dirname(file), {recursive: true});
const clamp = (value) => Math.max(-1, Math.min(1, value));

const writeWavStereo = (file, sampleRate, seconds, generator) => {
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
  for (let index = 0; index < frames; index++) {
    const value = clamp(generator(index / sampleRate, index));
    const sample = Math.round(value * 32767);
    buffer.writeInt16LE(sample, 44 + index * 4);
    buffer.writeInt16LE(sample, 46 + index * 4);
  }
  ensureParent(file);
  writeFileSync(file, buffer);
  return {frames, sampleRate, seconds: frames / sampleRate};
};

const sine = (time, frequency, amplitude, fadeSeconds = 0) => {
  let envelope = 1;
  if (fadeSeconds > 0) {
    envelope = Math.min(1, time / fadeSeconds);
  }
  return Math.sin(2 * Math.PI * frequency * time) * amplitude * envelope;
};

const burst = (time, start, frequency, amplitude, duration, fadeSeconds = 0.005) => {
  if (time < start || time >= start + duration) return 0;
  const local = time - start;
  const fade = Math.min(1, local / fadeSeconds, (duration - local) / fadeSeconds);
  return Math.sin(2 * Math.PI * frequency * local) * amplitude * Math.max(0, fade);
};

const encode = (input, output, args) => {
  ensureParent(output);
  try {
    execFileSync(
      'ffmpeg',
      ['-y', '-hide_banner', '-loglevel', 'error', '-i', input, ...args, '-map_metadata', '-1', output],
      {encoding: 'utf8', windowsHide: true},
    );
  } catch (error) {
    const stderr = error && typeof error.stderr === 'string' ? error.stderr.trim() : '';
    throw new Error(`FFmpeg encode failed for ${path.basename(output)}${stderr ? `: ${stderr}` : ''}`);
  }
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
      const distance = Math.sqrt((x - centerX) ** 2 + (y - centerY) ** 2);
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

const buildFixtures = (templateId, target) => {
  const files = {};
  const add = (key, relativePath) => {
    files[key] = {path: relativePath, absolute: path.join(target, relativePath)};
    return files[key].absolute;
  };

  if (templateId === 'synthetic-audio-mp3-demo') {
    const reference = add('reference', 'references/reference-pcm.wav');
    writeWavStereo(reference, 48000, 2, (time) => {
      return (
        sine(time, 440, 0.08, 0.02) +
        burst(time, 0.5, 1000, 0.5, 0.1) +
        burst(time, 1.5, 1000, 0.5, 0.1)
      );
    });
    const master = add('master', 'source/audio/master.mp3');
    encode(reference, master, ['-vn', '-ac', '2', '-ar', '44100', '-c:a', 'libmp3lame', '-b:a', '192k']);
    return {files, expected: {burstsSeconds: [0.5, 1.5], bedFrequency: 440, burstFrequency: 1000}};
  }

  if (templateId === 'synthetic-audio-multitrack-demo') {
    const musicWav = add('music-wav', 'references/music-220hz.wav');
    writeWavStereo(musicWav, 48000, 2, (time) => sine(time, 220, 0.2, 0.02));
    const music = add('music', 'source/audio/music.flac');
    encode(musicWav, music, ['-vn', '-ac', '2', '-ar', '48000', '-c:a', 'flac', '-compression_level', '8']);

    const sfx = add('sfx', 'source/audio/sfx-1200hz.wav');
    writeWavStereo(sfx, 48000, 0.6, (time) => sine(time, 1200, 0.5, 0.005));
    const voice = add('voice', 'source/audio/voice-440hz.wav');
    writeWavStereo(voice, 48000, 0.6, (time) => sine(time, 440, 0.4, 0.005));
    const ambienceWav = add('ambience-wav', 'references/ambience-110hz.wav');
    writeWavStereo(ambienceWav, 48000, 2, (time) => sine(time, 110, 0.15, 0.02));
    const ambience = add('ambience', 'source/audio/ambience-110hz.m4a');
    encode(ambienceWav, ambience, ['-vn', '-ac', '2', '-ar', '48000', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart']);

    const video = add('video', 'assets/video/background-24fps.mp4');
    generateVideo(video, {
      width: 720,
      height: 1280,
      fps: 24,
      seconds: 3,
      colors: ['red', 'lime', 'blue', 'yellow', 'magenta', 'cyan'],
    });
    const layer = add('layer', 'assets/layers/ring.png');
    writeRingPng(layer, 1080, 1920);

    return {
      files,
      expected: {
        frequencies: {music: 220, sfx: 1200, voice: 440, ambience: 110, embeddedVideo: 950},
        duckingDb: -8,
      },
    };
  }

  if (templateId === 'synthetic-audio-boundaries-demo') {
    const clicks = add('master', 'source/audio/clicks-44k1.wav');
    const clickFrames = [6, 25, 36];
    const clickTimes = clickFrames.map((frame) => frame / 24);
    writeWavStereo(clicks, 44100, 2, (time) => {
      let value = 0;
      for (const start of clickTimes) value += burst(time, start, 2000, 0.7, 0.012, 0.002);
      return value;
    });
    return {files, expected: {clickFrames, clickTimes, sampleRate: 44100, outputFps: 24}};
  }

  throw new Error(`No audio fixture definition for ${templateId}`);
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
  const target = path.join(workspaceRoot, templateId);
  if (existsSync(target)) {
    throw new Error(`Audio project already exists: ${target}; use a fresh workspace`);
  }
  mkdirSync(target, {recursive: true});
  for (const directory of [
    'assets',
    'assets/video',
    'assets/layers',
    'source',
    'source/audio',
    'references',
    'cache',
    'renders',
    'reports',
    'scenes',
  ]) {
    mkdirSync(path.join(target, directory), {recursive: true});
  }

  const fixture = buildFixtures(templateId, target);
  const config = JSON.parse(readFileSync(templateFile, 'utf8'));
  config.projectId = templateId;
  const masterFile = path.join(target, config.audio.path);
  if (!existsSync(masterFile)) throw new Error(`Missing master audio for ${templateId}`);
  config.audio.sha256 = sha256(masterFile);

  const assetSummary = [];
  for (const asset of config.assets) {
    const absolute = path.join(target, asset.path);
    if (!existsSync(absolute)) throw new Error(`Missing asset ${asset.id} for ${templateId}`);
    asset.sha256 = sha256(absolute);
    assetSummary.push({id: asset.id, kind: asset.kind, path: asset.path, sha256: asset.sha256});
  }

  writeFileSync(path.join(target, 'project.json'), JSON.stringify(config, null, 2));
  generated.push({
    projectId: templateId,
    projectDir: target,
    audio: {path: config.audio.path, format: config.audio.format, sha256: config.audio.sha256},
    fixtures: Object.fromEntries(
      Object.entries(fixture.files).map(([key, file]) => [
        key,
        {path: file.path, sha256: sha256(file.absolute)},
      ]),
    ),
    assets: assetSummary,
    expected: fixture.expected,
  });
}

console.log(JSON.stringify({workspaceRoot, projects: generated}, null, 2));