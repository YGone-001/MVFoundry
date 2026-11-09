// Seeds the P1-G-C character-performance prototype.
//
// It writes only inside an external workspace project. The artwork must already
// exist: run generate-art-plates.mjs --set cinematic and --set actor first.
// The score is an original deterministic synthetic audio bed; no song, no
// recording and no third-party media is involved.

import {createHash} from 'node:crypto';
import {readFileSync, readdirSync, writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : fallback;
};

const workspaceRoot = arg('workspace', process.env.MV_WORKSPACE_ROOT);
const projectId = arg('project', 'cinematic-2p5d-tram-stop-c');
if (!workspaceRoot) {
  console.error('--workspace or MV_WORKSPACE_ROOT is required');
  process.exit(2);
}

const {resolveProjectDir} = require('../dist/src/workspace/guard.js');
const {assertSafePath, createWriteBoundary, ensureSafeDirectory} = require(
  '../dist/src/workspace/writeBoundary.js',
);

const projectDir = resolveProjectDir({workspaceRoot, projectId, engineRoot: repoRoot});
const boundary = createWriteBoundary({projectDir, engineRoot: repoRoot});
const platesDir = path.join(projectDir, 'assets', 'plates');
const audioDir = ensureSafeDirectory(boundary, path.join(projectDir, 'source', 'audio'), 'project');

const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
const existing = new Set(readdirSync(platesDir).filter((name) => name.endsWith('.png')));

const platePath = (name) => {
  const file = `${name}.png`;
  if (!existing.has(file)) {
    console.error(`Missing art plate ${file}; run generate-art-plates.mjs first`);
    process.exit(2);
  }
  return `assets/plates/${file}`;
};
const plateSha = (name) => sha256(path.join(platesDir, `${name}.png`));
const assetId = (name) => name.replace(/^actor-/, 'actor-').toUpperCase().replace(/[^A-Z0-9]+/g, '-');

const ASSET_SOURCE = 'Original procedural artwork generated offline by MVFoundry; no third-party media, no real actors';
const RIGHTS = 'Original MVFoundry artwork; no third-party rights, no real actor likeness';

/* -------------------------------------------------------------------------- */
/* Original synthetic score                                                   */
/* -------------------------------------------------------------------------- */

const SAMPLE_RATE = 48000;
const DURATION_SECONDS = 15;

const writeScore = (file) => {
  const samples = SAMPLE_RATE * DURATION_SECONDS;
  const buffer = Buffer.alloc(44 + samples * 2 * 2);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + samples * 4, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(2, 22);
  buffer.writeUInt32LE(SAMPLE_RATE, 24);
  buffer.writeUInt32LE(SAMPLE_RATE * 4, 28);
  buffer.writeUInt16LE(4, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(samples * 4, 40);

  const noise = (index) => {
    const value = Math.sin(index * 12.9898) * 43758.5453;
    return (value - Math.floor(value)) * 2 - 1;
  };
  for (let index = 0; index < samples; index += 1) {
    const t = index / SAMPLE_RATE;
    const beat = t % 0.5;
    const bar = Math.floor(t / 2) % 4;
    const kick = Math.exp(-beat * 14) * Math.sin(2 * Math.PI * 54 * beat) * 0.5;
    const hat = Math.exp(-(beat % 0.25) * 60) * noise(index * 3.1) * 0.06;
    const bassNote = [55, 65.4, 49, 58.3][bar];
    const bass = Math.sin(2 * Math.PI * bassNote * t) * 0.16 * (0.7 + 0.3 * Math.sin(t * 0.7));
    const pad =
      Math.sin(2 * Math.PI * 220 * t) * 0.05 +
      Math.sin(2 * Math.PI * 277.2 * t) * 0.045 +
      Math.sin(2 * Math.PI * 329.6 * t) * 0.04;
    const swell = Math.min(1, t / 1.5) * Math.min(1, (DURATION_SECONDS - t) / 2);
    const left = (kick + hat + bass + pad) * swell;
    const right = (kick + hat * 0.8 + bass + pad * 1.05) * swell;
    const offset = 44 + index * 4;
    buffer.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(left * 26000))), offset);
    buffer.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(right * 26000))), offset + 2);
  }
  writeFileSync(file, buffer);
};

const audioPath = path.join(audioDir, 'score-15s.wav');
writeScore(audioPath);
const audioSha = sha256(audioPath);

/* -------------------------------------------------------------------------- */
/* Character performance design                                               */
/* -------------------------------------------------------------------------- */

const pose = (name, fromFrame, toFrame, transition, fadeFrames, extra = {}) => ({
  assetId: assetId(name),
  fromFrame,
  toFrame,
  transition,
  fadeFrames,
  offsetX: extra.offsetX ?? 0,
  offsetY: extra.offsetY ?? 0,
  scale: extra.scale ?? 1,
  opacity: extra.opacity ?? 1,
});

const character = (characterId, order, extras, poses) => ({
  characterId,
  role: 'subject',
  parallax: extras.parallax,
  order,
  anchorX: extras.anchorX,
  anchorY: extras.anchorY,
  pivotX: 0.5,
  pivotY: extras.pivotY,
  height: extras.height,
  breathe: {amplitude: 0.0035, periodFrames: 56},
  sway: {amplitude: 0.0015, periodFrames: 84},
  poses,
});

const shot = (id, startFrame, endFrame, media) => ({
  id,
  startFrame,
  endFrame,
  renderer: 'parallax-2p5d',
  params: {background: '#03070d'},
  media: {kind: 'parallax-2p5d', ...media},
});

const camera = (kind, from, to, easing = 'easeInOut') => ({
  kind,
  fromX: from.x,
  fromY: from.y,
  fromZoom: from.zoom,
  toX: to.x,
  toY: to.y,
  toZoom: to.zoom,
  easing,
});

const layer = (name, role, order, parallax, extra = {}) => ({
  assetId: assetId(name),
  role,
  order,
  parallax,
  opacity: extra.opacity ?? 1,
  fit: extra.fit ?? 'cover',
  ...(extra.positionX === undefined ? {} : {positionX: extra.positionX}),
  ...(extra.positionY === undefined ? {} : {positionY: extra.positionY}),
  ...(extra.scale === undefined ? {} : {scale: extra.scale}),
  visibleFromFrame: 0,
  visibleToFrame: extra.toFrame,
  ...(extra.blur === undefined ? {} : {blur: extra.blur}),
  ...(extra.motion === undefined ? {} : {motion: extra.motion}),
});

const image = (name, parallax, extra = {}) => ({
  kind: 'image',
  assetId: assetId(name),
  opacity: 1,
  fit: 'cover',
  positionX: 0,
  positionY: 0,
  scale: 1,
  parallax,
  ...(extra.blur === undefined ? {} : {blur: extra.blur}),
});

const shots = [
  // Shot A: wide establishing two-shot. Both characters perform an attention shift.
  shot('SHOT-A', 0, 96, {
    background: image('cinematic-bg-street', 0.04, {blur: 1.4}),
    layers: [
      layer('cinematic-mg-platform', 'midground', 10, 0.3, {toFrame: 96, blur: 0.8}),
      layer('cinematic-fg-rail', 'foreground', 30, 0.95, {toFrame: 96, opacity: 0.94, blur: 3.2}),
    ],
    characters: [
      character(
        'woman',
        20,
        {parallax: 0.62, anchorX: 0.4, anchorY: 0.965, height: 0.86, pivotY: 0.985},
        [
          pose('actor-woman-full-neutral', 0, 20, 'cut', 0),
          pose('actor-woman-full-look-man', 20, 56, 'crossfade', 4),
          pose('actor-woman-full-concerned', 56, 96, 'crossfade', 4),
        ],
      ),
      character(
        'man',
        22,
        {parallax: 0.64, anchorX: 0.66, anchorY: 0.96, height: 0.9, pivotY: 0.985},
        [
          pose('actor-man-full-neutral', 0, 36, 'cut', 0),
          pose('actor-man-full-look-her', 36, 96, 'crossfade', 4),
        ],
      ),
    ],
    camera: camera('pan', {x: -0.03, y: 0, zoom: 1.02}, {x: 0.03, y: -0.004, zoom: 1.02}),
    atmosphere: {kind: 'rain-mist', intensity: 0.55, windX: -0.07},
    light: {amplitude: 0.1, frequency: 0.5, phase: 0.2},
  }),

  // Shot B: the performance shot. Four authored beats on the bust framing.
  shot('SHOT-B', 96, 192, {
    background: image('cinematic-bg-closeup', 0.04, {blur: 3.4}),
    layers: [
      layer('cinematic-mg-bokeh', 'midground', 10, 0.26, {toFrame: 96, blur: 0.6}),
      layer('cinematic-fg-rail', 'foreground', 30, 0.95, {toFrame: 96, opacity: 0.9, blur: 4.4}),
    ],
    characters: [
      character(
        'woman',
        20,
        {parallax: 0.7, anchorX: 0.5, anchorY: 1.0, height: 1.08, pivotY: 1},
        [
          // Beat 1 awareness, beat 2 recognition, beat 3 withdrawal, beat 4 hold.
          pose('actor-woman-bust-neutral', 0, 14, 'cut', 0),
          pose('actor-woman-bust-look-man', 14, 32, 'crossfade', 3),
          pose('actor-woman-bust-concerned', 32, 52, 'crossfade', 4),
          pose('actor-woman-bust-turn-early', 52, 70, 'crossfade', 4, {offsetX: 0.012}),
          pose('actor-woman-bust-eyes-down', 70, 96, 'crossfade', 4, {offsetX: 0.02, offsetY: 0.004}),
        ],
      ),
    ],
    camera: camera('push-in', {x: 0, y: 0, zoom: 1}, {x: 0, y: 0, zoom: 1.08}),
    atmosphere: {kind: 'rain-mist', intensity: 0.45, windX: -0.05},
    light: {amplitude: 0.08, frequency: 0.4, phase: 0.3},
  }),

  // Shot C: the tram crosses in front. Character blocking is independent of it.
  shot('SHOT-C', 192, 288, {
    background: image('cinematic-bg-street', 0.04, {blur: 1.2}),
    layers: [
      layer('cinematic-mg-platform', 'midground', 10, 0.3, {toFrame: 96, blur: 0.9}),
      layer('cinematic-tram', 'subject', 25, 0.86, {
        toFrame: 96,
        fit: 'contain',
        scale: 0.66,
        positionY: 128,
        motion: {
          translateXFrom: -0.68,
          translateXTo: 0.68,
          translateYFrom: 0,
          translateYTo: 0,
          fromFrame: 6,
          toFrame: 84,
          easing: 'linear',
        },
      }),
      layer('cinematic-fg-rail', 'foreground', 30, 0.95, {toFrame: 96, opacity: 0.94, blur: 3.4}),
    ],
    characters: [
      character(
        'woman',
        20,
        {parallax: 0.6, anchorX: 0.38, anchorY: 0.965, height: 0.84, pivotY: 0.985},
        [
          pose('actor-woman-full-neutral', 0, 18, 'cut', 0),
          pose('actor-woman-full-turn-early', 18, 34, 'cut', 0, {offsetX: -0.02}),
          pose('actor-woman-full-turned-away', 34, 96, 'crossfade', 4, {offsetX: -0.07}),
        ],
      ),
      character(
        'man',
        21,
        {parallax: 0.63, anchorX: 0.68, anchorY: 0.96, height: 0.9, pivotY: 0.985},
        [
          pose('actor-man-full-neutral', 0, 24, 'cut', 0),
          pose('actor-man-full-notice', 24, 44, 'crossfade', 4),
          pose('actor-man-full-reach', 44, 70, 'crossfade', 4, {offsetX: -0.015}),
          pose('actor-man-full-look-away', 70, 96, 'crossfade', 4),
        ],
      ),
    ],
    camera: camera('hold', {x: 0, y: 0, zoom: 1.01}, {x: 0, y: 0, zoom: 1.01}),
    atmosphere: {kind: 'rain', intensity: 0.6, windX: -0.08},
    light: {amplitude: 0.06, frequency: 0.3, phase: 0.1},
  }),

  // Shot D: the aftermath. She holds the withdrawn pose; he looks away too late.
  shot('SHOT-D', 288, 360, {
    background: image('cinematic-bg-closeup', 0.04, {blur: 3.8}),
    layers: [
      layer('cinematic-mg-bokeh', 'midground', 10, 0.26, {toFrame: 72, blur: 0.8}),
      layer('cinematic-fg-rail', 'foreground', 30, 0.95, {toFrame: 72, opacity: 0.92, blur: 4.8}),
    ],
    characters: [
      character(
        'woman',
        20,
        {parallax: 0.7, anchorX: 0.48, anchorY: 1.0, height: 1.1, pivotY: 1},
        [
          pose('actor-woman-bust-turned-away', 0, 20, 'cut', 0, {offsetX: -0.03}),
          pose('actor-woman-bust-eyes-down', 20, 72, 'crossfade', 4, {offsetX: -0.01}),
        ],
      ),
    ],
    camera: camera('pull-back', {x: 0.02, y: 0.01, zoom: 1.06}, {x: 0.04, y: 0.02, zoom: 1.01}),
    atmosphere: {kind: 'rain-mist', intensity: 0.4, windX: -0.05},
    light: {amplitude: 0.05, frequency: 0.35, phase: 0.4},
  }),
];

/* -------------------------------------------------------------------------- */
/* Manifest                                                                   */
/* -------------------------------------------------------------------------- */

const usedPlates = new Set();
const collect = (media) => {
  usedPlates.add(media.background.assetId);
  for (const entry of media.layers) usedPlates.add(entry.assetId);
  for (const entry of media.characters ?? []) {
    for (const poseEntry of entry.poses) usedPlates.add(poseEntry.assetId);
  }
};
for (const entry of shots) collect(entry.media);

const plateByAsset = new Map();
for (const name of existing) {
  const base = name.replace(/\.png$/, '');
  plateByAsset.set(assetId(base), {name: base, path: platePath(base)});
}

const assets = [];
for (const id of usedPlates) {
  const record = plateByAsset.get(id);
  if (!record) {
    console.error(`No generated plate for asset ${id}`);
    process.exit(2);
  }
  const isImage = record.name === 'cinematic-bg-street' || record.name === 'cinematic-bg-closeup';
  assets.push({
    id,
    kind: isImage ? 'image' : 'layer',
    path: record.path,
    sha256: plateSha(record.name),
    source: ASSET_SOURCE,
    rights: RIGHTS,
    approval: 'approved',
  });
}

const config = {
  schemaVersion: 1,
  projectId,
  song: {title: 'Tram Stop (Synthetic Character Study)', artist: 'MVFoundry Synthetic Fixture'},
  audio: {
    path: 'source/audio/score-15s.wav',
    sha256: audioSha,
    durationSeconds: DURATION_SECONDS,
    durationPolicy: 'round',
    format: 'wav-pcm',
    mixSampleRate: 48000,
    gainDb: 0,
    fadeInFrames: 0,
    fadeOutFrames: 0,
    gainAutomation: [],
  },
  lyrics: {language: 'none', path: null},
  narrative: {mode: 'narrative'},
  visual: {
    styleProfile: 'cinematic-illustration-2p5d',
    defaultRenderer: 'parallax-2p5d',
    style: {
      id: 'cinematic-illustration-2p5d',
      note: 'P1-G-C synthetic character-performance prototype; artistic verdict pending human review',
    },
  },
  output: {width: 1280, height: 720, fps: 24},
  cues: [],
  chapters: [{id: 'CH-01', title: 'Tram stop', startFrame: 0, endFrame: 360, shots}],
  assets,
  permissions: {externalGeneration: false, localOnly: true, allowNetwork: false},
  render: {codec: 'h264', pixelFormat: 'yuv420p', colorSpace: 'bt709', imageFormat: 'png'},
};

const target = assertSafePath(boundary, path.join(projectDir, 'project.json'), {
  expect: 'file',
  subtree: 'project',
});
writeFileSync(target, `${JSON.stringify(config, null, 2)}\n`);

const reportsDir = ensureSafeDirectory(boundary, path.join(projectDir, 'reports'), 'project');
writeFileSync(
  path.join(reportsDir, 'character-assets.json'),
  `${JSON.stringify(
    {
      schemaVersion: 1,
      projectId,
      generatedBy: 'factory/scripts/seed-style-prototype-c.mjs',
      note: 'Every asset below is original procedural artwork produced offline by this repository.',
      characters: [
        {id: 'woman', framing: 'full', poses: ['neutral', 'look-man', 'look-away', 'concerned', 'eyes-down', 'turn-early', 'turned-away']},
        {id: 'woman', framing: 'bust', poses: ['neutral', 'look-man', 'look-away', 'concerned', 'eyes-down', 'turn-early', 'turned-away']},
        {id: 'man', framing: 'full', poses: ['neutral', 'look-her', 'notice', 'reach', 'look-away']},
      ],
      assets: assets.map((entry) => ({id: entry.id, kind: entry.kind, path: entry.path, sha256: entry.sha256})),
    },
    null,
    2,
  )}\n`,
);

console.log(
  JSON.stringify(
    {
      projectId,
      shots: shots.length,
      characters: shots.reduce((sum, entry) => sum + (entry.media.characters?.length ?? 0), 0),
      poseStates: shots.reduce(
        (sum, entry) =>
          sum + (entry.media.characters ?? []).reduce((inner, item) => inner + item.poses.length, 0),
        0,
      ),
      assets: assets.length,
      audioSha256: audioSha,
    },
    null,
    2,
  ),
);
