// Seeds 15-second, four-shot starter prototypes for the three styles whose art
// packs were added in P1: ink-watercolor and editorial-motion-graphics use the
// asset-backed 2.5D route; stylized-3d-diorama uses its declared Canvas route
// because the catalog deliberately declares no parallax media route for it.
//
// Everything is synthetic and local: an original score, repository-generated
// plates and a project-local module. No song, recording, provider call or
// third-party media is involved.
//
// Usage:
//   node factory/scripts/seed-style-starter.mjs --workspace <root> --set ink|editorial|diorama
//   node factory/scripts/seed-style-starter.mjs --workspace <root> --set ink --project my-ink
// Requires: npm run build and a local Chrome/Chromium for the ink/editorial plate pass.

import {createHash} from 'node:crypto';
import {existsSync, mkdirSync, readFileSync, statSync, writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {encodeWav, renderScore} from './support/synthetic-score.mjs';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : fallback;
};

const {getWorkspaceRoot, isInside} = require('../dist/src/workspace/guard.js');
const {assertSafePath, createWriteBoundary, ensureSafeDirectory} = require(
  '../dist/src/workspace/writeBoundary.js',
);

const rawRoot = arg('workspace', process.env.MV_WORKSPACE_ROOT);
const set = arg('set');
if (!rawRoot) {
  console.error('MV_WORKSPACE_ROOT (or --workspace) is required');
  process.exit(2);
}
if (!['ink', 'editorial', 'diorama'].includes(set)) {
  console.error('--set must be ink, editorial or diorama');
  process.exit(2);
}

const workspaceRoot = getWorkspaceRoot({explicitRoot: rawRoot, engineRoot: repoRoot});
const projectId = arg('project', `synthetic-starter-${set}`);
if (!/^[a-z0-9][a-z0-9-]{2,62}[a-z0-9]$/.test(projectId)) {
  console.error(`invalid project id ${projectId}`);
  process.exit(2);
}
const projectDir = path.resolve(workspaceRoot, projectId);
if (!isInside(workspaceRoot, projectDir)) {
  console.error('project target escapes the workspace');
  process.exit(2);
}
if (existsSync(projectDir)) {
  console.error(`project ${projectId} already exists; remove it manually to reseed`);
  process.exit(2);
}

const FPS = 24;
const DURATION_SECONDS = 15;
const DURATION_FRAMES = FPS * DURATION_SECONDS;
const WIDTH = 640;
const HEIGHT = 360;
const SHOT_LENGTH = 90;

const STYLES = {
  ink: {
    styleId: 'ink-watercolor',
    label: 'Ink and watercolour starter prototype',
    bg: 'ink-bg-paper',
    mg: 'ink-mg-strokes',
    fg: 'ink-fg-figure',
    atmosphere: {kind: 'mist', intensity: 0.42, windX: 0.04},
    grade: {saturation: 0.94, contrast: 0.98, brightness: 1.1, tint: '#d6c9b4', tintOpacity: 0.1, vignette: 0.12, grain: 0.14},
  },
  editorial: {
    styleId: 'editorial-motion-graphics',
    label: 'Editorial motion graphics starter prototype',
    bg: 'editorial-bg-grid',
    mg: 'editorial-mg-cutout',
    fg: 'editorial-fg-graphics',
    atmosphere: {kind: 'none', intensity: 0, windX: 0},
    grade: {saturation: 1.12, contrast: 1.16, brightness: 1.05, tint: '#f3efe6', tintOpacity: 0.06, vignette: 0.08, grain: 0.02},
  },
  diorama: {
    styleId: 'stylized-3d-diorama',
    label: 'Stylised 3D diorama starter prototype',
    // The catalog intentionally declares no parallax route for this style.
    // It is seeded as a Canvas isometric module prototype instead.
    moduleOnly: true,
  },
};

const style = STYLES[set];
const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');
const writeJson = (file, value) => writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);

mkdirSync(projectDir, {recursive: false});
for (const relative of ['cache', 'renders', 'scenes', 'source/audio', 'assets/plates', 'reports']) {
  mkdirSync(path.join(projectDir, relative), {recursive: true});
}

// A placeholder manifest lets the plate generator resolve the project folder.
const boundary = createWriteBoundary({projectDir, engineRoot: repoRoot});
const projectFile = assertSafePath(boundary, path.join(projectDir, 'project.json'), {
  expect: 'file',
  subtree: 'project',
});
writeJson(projectFile, {projectId});

const score = renderScore({seed: 20261201});
const samples = Math.round(DURATION_SECONDS * score.sampleRate);
const sliced = {
  left: score.left.slice(0, samples),
  right: score.right.slice(0, samples),
  sampleRate: score.sampleRate,
};
const audioPath = assertSafePath(boundary, path.join(projectDir, 'source', 'audio', 'starter-score-15s.wav'), {
  expect: 'file',
  subtree: 'project',
});
const audioBytes = encodeWav(sliced);
writeFileSync(audioPath, audioBytes);
const audioSha = sha256(audioBytes);

if (!style.moduleOnly) {
  const plateResult = spawnSync(
    process.execPath,
    [path.join(here, 'generate-art-plates.mjs'), '--workspace', workspaceRoot, '--project', projectId, '--set', set],
    {cwd: repoRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, windowsHide: true},
  );
  if (plateResult.status !== 0) {
    console.error(plateResult.stderr || plateResult.stdout);
    process.exit(1);
  }
}

const platesManifestPath = path.join(projectDir, 'assets', 'plates', 'plates.json');
let assets = [];
if (!style.moduleOnly) {
  if (!existsSync(platesManifestPath)) {
    console.error('plate manifest missing after style:art; refusing to invent assets');
    process.exit(2);
  }
  const manifest = JSON.parse(readFileSync(platesManifestPath, 'utf8'));
  const byName = new Map(manifest.plates.map((plate) => [plate.name, plate]));
  const asset = (id, name, kind) => {
    const plate = byName.get(name);
    if (!plate) throw new Error(`plate ${name} missing from manifest`);
    const file = path.join(projectDir, plate.path);
    if (!existsSync(file)) throw new Error(`plate file missing: ${plate.path}`);
    const hash = sha256(readFileSync(file));
    if (hash !== plate.sha256) throw new Error(`plate hash changed: ${name}`);
    return {
      id,
      kind,
      path: plate.path,
      sha256: hash,
      source: `Original procedural artwork generated offline by MVFoundry (${style.label})`,
      rights: 'Original MVFoundry artwork; no third-party rights, no real actors',
      approval: 'approved',
    };
  };
  assets = [
    asset('BG', style.bg, 'image'),
    asset('MG', style.mg, 'layer'),
    asset('FG', style.fg, 'layer'),
  ];
}

const cameras = [
  {kind: 'push-in', fromX: 0, fromY: 0, fromZoom: 1, toX: 0, toY: 0, toZoom: 1.06, easing: 'easeInOut'},
  {kind: 'pan', fromX: -0.03, fromY: 0.01, fromZoom: 1.02, toX: 0.03, toY: 0.01, toZoom: 1.02, easing: 'easeInOut'},
  {kind: 'pull-back', fromX: 0, fromY: -0.02, fromZoom: 1.08, toX: 0, toY: 0, toZoom: 1, easing: 'easeInOut'},
  {kind: 'pan', fromX: 0.04, fromY: 0.01, fromZoom: 1.01, toX: -0.04, toY: 0.01, toZoom: 1.01, easing: 'easeInOut'},
];

const mediaForShot = (camera) => ({
  kind: 'parallax-2p5d',
  background: {kind: 'image', assetId: 'BG', opacity: 1, fit: 'cover', positionX: 0, positionY: 0, scale: 1, parallax: 0.04, blur: 1.4},
  layers: [
    {
      assetId: 'MG',
      role: 'midground',
      order: 10,
      parallax: 0.3,
      opacity: 1,
      fit: 'cover',
      positionX: 0,
      positionY: 0,
      scale: 1,
      blur: 0.7,
      visibleFromFrame: 0,
      visibleToFrame: SHOT_LENGTH,
    },
    {
      assetId: 'FG',
      role: 'foreground',
      order: 20,
      parallax: 0.9,
      opacity: 1,
      fit: 'cover',
      positionX: 0,
      positionY: 0,
      scale: 1,
      blur: 2.2,
      visibleFromFrame: 0,
      visibleToFrame: SHOT_LENGTH,
    },
  ],
  camera,
  atmosphere: style.atmosphere,
  light: {amplitude: 0.08, frequency: 0.4, phase: 0.1},
  grade: style.grade,
});

const shots = [];
for (let index = 0; index < 4; index += 1) {
  const startFrame = index * SHOT_LENGTH;
  const endFrame = startFrame + SHOT_LENGTH;
  shots.push({
    id: `SHOT-${String.fromCharCode(65 + index)}`,
    startFrame,
    endFrame,
    renderer: style.moduleOnly ? 'project:style-gallery' : 'parallax-2p5d',
    params: {},
    ...(style.moduleOnly ? {moduleParams: {phase: index * 24}} : {media: mediaForShot(cameras[index])}),
  });
}

let sceneModules = [];
if (style.moduleOnly) {
  const template = readFileSync(path.join(here, 'support', 'style-gallery-module.ts'), 'utf8');
  const source = `// Starter Canvas prototype for ${style.styleId}. Review before production use.\n\n${template}`;
  const modulePath = assertSafePath(boundary, path.join(projectDir, 'scenes', 'style-gallery.ts'), {
    expect: 'file',
    subtree: 'project',
  });
  writeFileSync(modulePath, source);
  sceneModules = [
    {
      id: 'style-gallery',
      path: 'scenes/style-gallery.ts',
      moduleType: 'canvas2d',
      contractVersion: 1,
      sha256: sha256(readFileSync(modulePath)),
      trust: 'user-authored-approved',
      canvas: {mode: 'output'},
      samplingFps: 'output',
      pixelated: false,
      label: `${style.label} module`,
      description: 'Synthetic starter prototype; the diorama style has no parallax media route.',
      styleIds: [style.styleId],
    },
  ];
}

const config = {
  schemaVersion: 1,
  projectId,
  song: {title: style.label, artist: 'MVFoundry Original Synthetic Score'},
  audio: {
    path: 'source/audio/starter-score-15s.wav',
    sha256: audioSha,
    durationSeconds: DURATION_SECONDS,
    durationPolicy: 'round',
    format: 'wav-pcm',
    mixSampleRate: score.sampleRate,
    gainDb: 0,
    fadeInFrames: 0,
    fadeOutFrames: 0,
    gainAutomation: [],
  },
  lyrics: {language: 'none', path: null},
  narrative: {mode: 'abstract'},
  visual: {
    styleProfile: style.styleId,
    defaultRenderer: style.moduleOnly ? 'project:style-gallery' : 'parallax-2p5d',
    style: {id: style.styleId, note: 'Synthetic starter prototype; artistic verdict pending human review'},
  },
  output: {width: WIDTH, height: HEIGHT, fps: FPS},
  cues: [0, 90, 180, 270].map((frame, index) => ({
    id: `CUE-${String.fromCharCode(65 + index)}`,
    frame,
    timeSeconds: frame / FPS,
    source: 'synthetic',
    label: ['establishing', 'development', 'shift', 'release'][index],
  })),
  chapters: [{id: 'CH-01', title: style.label, startFrame: 0, endFrame: DURATION_FRAMES, shots}],
  sceneModules,
  assets,
  audioTracks: [],
  permissions: {externalGeneration: false, localOnly: true, allowNetwork: false},
  render: {codec: 'h264', pixelFormat: 'yuv420p', colorSpace: 'bt709', imageFormat: 'png'},
};

writeJson(projectFile, config);

const reportsDir = ensureSafeDirectory(boundary, path.join(projectDir, 'reports'), 'project');
writeJson(path.join(reportsDir, 'starter-prototype.json'), {
  schemaVersion: 1,
  projectId,
  set,
  styleId: style.styleId,
  route: style.moduleOnly ? 'canvas2d-module' : 'parallax-2p5d',
  durationSeconds: DURATION_SECONDS,
  shots: shots.map((shot) => ({id: shot.id, startFrame: shot.startFrame, endFrame: shot.endFrame, renderer: shot.renderer})),
  assets: assets.map((entry) => ({id: entry.id, kind: entry.kind, path: entry.path, sha256: entry.sha256})),
  note: style.moduleOnly
    ? 'The diorama style declares no parallax route; this is a Canvas isometric starter, not 2.5D cutout composition.'
    : 'Starter 2.5D prototype. Technical rendering is not an artistic approval.',
});

console.log(JSON.stringify({
  status: 'seeded',
  projectId,
  projectDir: path.relative(workspaceRoot, projectDir).split(path.sep).join('/'),
  set,
  styleId: style.styleId,
  route: style.moduleOnly ? 'canvas2d-module' : 'parallax-2p5d',
  shots: shots.length,
  durationSeconds: DURATION_SECONDS,
  output: {width: WIDTH, height: HEIGHT, fps: FPS},
  note: 'Render with: npm run render:project -- --project <id> --mode video --frames 0-359',
}, null, 2));