// Generates deterministic synthetic preproduction projects in an external workspace.
// No generated audio/plans are written inside the engine repository.
//
// Usage: npm run preproduction:seed
//        node factory/scripts/seed-preproduction-workspace.mjs --root <external-root>

import {createHash} from 'node:crypto';
import {existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const templatesRoot = path.resolve(here, '..', 'examples', 'preproduction-projects');
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
  throw new Error('Preproduction workspace must be outside and must not contain the engine repository');
}
mkdirSync(rawRoot, {recursive: true});
const workspaceRoot = realpathSync(rawRoot);
if (isInside(engineRoot, workspaceRoot) || isInside(workspaceRoot, engineRoot)) {
  throw new Error('Preproduction workspace must be outside and must not contain the engine repository');
}

const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
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
  writeFileSync(file, buffer);
};

const sine = (time, frequency, amplitude, fadeSeconds = 0) => {
  if (time < 0) return 0;
  const envelope = fadeSeconds > 0 ? Math.min(1, time / fadeSeconds) : 1;
  return Math.sin(2 * Math.PI * frequency * time) * amplitude * envelope;
};

const pulse = (time, start, frequency, amplitude, duration, fadeSeconds = 0.004) => {
  const local = time - start;
  if (local < 0 || local >= duration) return 0;
  const envelope = Math.min(1, local / fadeSeconds, (duration - local) / fadeSeconds);
  return Math.sin(2 * Math.PI * frequency * local) * amplitude * Math.max(0, envelope);
};

const generated = [];
for (const templateId of readdirSync(templatesRoot, {withFileTypes: true})
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort()) {
  const templateDir = path.join(templatesRoot, templateId);
  const projectTemplate = path.join(templateDir, 'project.template.json');
  if (!existsSync(projectTemplate)) continue;
  const target = path.join(workspaceRoot, templateId);
  if (existsSync(target)) throw new Error(`Preproduction project already exists: ${target}; use a fresh workspace`);
  mkdirSync(target, {recursive: true});
  for (const directory of ['source/audio', 'preproduction', 'cache', 'renders', 'reports']) {
    mkdirSync(path.join(target, directory), {recursive: true});
  }

  const config = JSON.parse(readFileSync(projectTemplate, 'utf8'));
  config.projectId = templateId;
  const audioFile = path.join(target, config.audio.path);
  if (templateId === 'synthetic-beat-demo') {
    writeWavStereo(audioFile, 48000, 4, (time) => {
      let value = sine(time, 110, 0.025, 0.05);
      for (let start = 0; start < 4; start += 0.5) {
        value += pulse(time, start, 60, 0.8, 0.09, 0.006);
        value += pulse(time, start + 0.25, 2000, 0.22, 0.018, 0.003);
      }
      return value;
    });
  } else if (templateId === 'synthetic-beat-grid-demo') {
    writeWavStereo(audioFile, 48000, 4, (time) => {
      let value = sine(time, 96, 0.022, 0.05);
      for (let start = 0; start < 4; start += 60 / 90) {
        value += pulse(time, start, 64, 0.8, 0.09, 0.006);
        value += pulse(time, start + 30 / 90, 1800, 0.2, 0.018, 0.003);
      }
      return value;
    });
  } else if (templateId === 'synthetic-uncertain-demo') {
    writeWavStereo(audioFile, 48000, 4, (time) => {
      let value = sine(time, 90, 0.02, 0.1);
      for (const start of [0.3, 1.1, 2.4, 3.7]) {
        value += pulse(time, start, 700, 0.35, 0.06, 0.005);
      }
      return value;
    });
  } else if (templateId === 'synthetic-lyrics-demo') {
    writeWavStereo(audioFile, 48000, 4, (time) => {
      let value = sine(time, 70, 0.018, 0.1);
      for (let start = 0; start < 4; start += 60 / 96) {
        value += pulse(time, start, 300, 0.22, 0.07, 0.005);
      }
      return value;
    });
  } else {
    throw new Error(`No preproduction fixture definition for ${templateId}`);
  }

  config.audio.sha256 = sha256(audioFile);
  config.audio.durationSeconds = 4;
  for (const asset of config.assets) {
    asset.path = config.audio.path;
    asset.sha256 = config.audio.sha256;
  }
  writeFileSync(path.join(target, 'project.json'), JSON.stringify(config, null, 2));

  for (const [source, targetName] of [
    ['annotations.template.json', 'annotations.json'],
    ['creative-brief.template.json', 'creative-brief.json'],
  ]) {
    const sourceFile = path.join(templateDir, source);
    if (!existsSync(sourceFile)) throw new Error(`Missing ${source} for ${templateId}`);
    const value = JSON.parse(readFileSync(sourceFile, 'utf8'));
    value.projectId = templateId;
    writeFileSync(path.join(target, 'preproduction', targetName), JSON.stringify(value, null, 2));
  }
  const lyricsTemplate = path.join(templateDir, 'lyrics.template.json');
  if (existsSync(lyricsTemplate)) {
    const value = JSON.parse(readFileSync(lyricsTemplate, 'utf8'));
    writeFileSync(path.join(target, 'preproduction', 'lyrics.json'), JSON.stringify(value, null, 2));
  }

  generated.push({
    projectId: templateId,
    projectDir: target,
    audio: {path: config.audio.path, sha256: config.audio.sha256, durationSeconds: 4, format: config.audio.format},
    hasLyrics: existsSync(path.join(target, 'preproduction', 'lyrics.json')),
  });
}

console.log(JSON.stringify({workspaceRoot, projects: generated}, null, 2));