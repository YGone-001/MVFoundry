// Seeds the complete synthetic music-video production rehearsal:
// "Signal Garden" — a 60-second original score with a 15-shot, four-renderer
// timeline. Everything is generated procedurally into a disposable external
// workspace; nothing is copied from a real song, image or production.
//
// Usage: npm run mv:seed
//        node factory/scripts/seed-mv-production.mjs --root <external-root>
// Requires FFmpeg (synthetic clips and audio) and factory/dist.

import {existsSync, mkdirSync, realpathSync, writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {SCORE_BPM, SCORE_BEATS_PER_BAR, encodeWav, renderScore} from './support/synthetic-score.mjs';
import {sha256, writeAlphaPng, writeJson, writeMovingClip, writePlatePng} from './support/synthetic-media.mjs';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
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
if (isInside(engineRoot, realpathSync(ancestor)) || isInside(realpathSync(ancestor), engineRoot)) {
  throw new Error('The music-video workspace must be outside and must not contain the engine repository');
}
mkdirSync(rawRoot, {recursive: true});
const workspaceRoot = realpathSync(rawRoot);
if (isInside(engineRoot, workspaceRoot) || isInside(workspaceRoot, engineRoot)) {
  throw new Error('The music-video workspace must be outside and must not contain the engine repository');
}

const PROJECT_ID = 'synthetic-mv-signal-garden';
const FPS = 24;
const WIDTH = 1280;
const HEIGHT = 720;
const DURATION_FRAMES = 1440;
const DURATION_SECONDS = DURATION_FRAMES / FPS;
const SHOT_FRAMES = 96;

const target = path.join(workspaceRoot, PROJECT_ID);
if (existsSync(target)) throw new Error(`Project already exists: ${target}; use a fresh workspace`);
for (const directory of [
  'source/audio',
  'assets/images',
  'assets/video',
  'assets/layers',
  'assets/rejected',
  'scenes',
  'preproduction',
  'production',
  'cache',
  'renders',
  'reports',
  'generation/fixtures',
  'generation/outputs',
  'intake',
]) {
  mkdirSync(path.join(target, directory), {recursive: true});
}

// ---------------------------------------------------------------------------
// Score
// ---------------------------------------------------------------------------

const score = renderScore({seed: 20261101});
if (score.seconds !== DURATION_SECONDS) {
  throw new Error(`Score is ${score.seconds}s but the project expects ${DURATION_SECONDS}s`);
}
const audioRelative = 'source/audio/signal-garden-master.wav';
const audioAbsolute = path.join(target, audioRelative);
writeFileSync(audioAbsolute, encodeWav(score));
const audioSha = sha256(audioAbsolute);

writeJson(path.join(target, 'source', 'audio', 'signal-garden-score.json'), {
  schemaVersion: 1,
  projectId: PROJECT_ID,
  generator: 'factory/scripts/support/synthetic-score.mjs',
  generatorSeed: 20261101,
  bpm: score.bpm,
  beatsPerBar: SCORE_BEATS_PER_BAR,
  sampleRate: score.sampleRate,
  durationSeconds: score.seconds,
  samples: score.samples,
  sections: score.sections,
  markers: {
    kicks: score.markers.kicks,
    snares: score.markers.snares,
  },
  note: 'Original deterministic synthesis. No sample, recording or third-party track is used.',
});

// ---------------------------------------------------------------------------
// Shot plan: 15 shots across six musical sections
// ---------------------------------------------------------------------------

const SECTION_PLAN = [
  {id: 'SEC-01', label: 'intro', startFrame: 0, endFrame: 96, shots: ['layered-canvas']},
  {id: 'SEC-02', label: 'pulse', startFrame: 96, endFrame: 288, shots: ['pixel-canvas', 'video']},
  {id: 'SEC-03', label: 'drive', startFrame: 288, endFrame: 576, shots: ['hybrid', 'project:garden-light', 'video']},
  {id: 'SEC-04', label: 'drift', startFrame: 576, endFrame: 960, shots: ['layered-canvas', 'hybrid', 'project:garden-light', 'video']},
  {id: 'SEC-05', label: 'bloom', startFrame: 960, endFrame: 1248, shots: ['hybrid', 'video', 'project:garden-light']},
  {id: 'SEC-06', label: 'resolve', startFrame: 1248, endFrame: 1440, shots: ['layered-canvas', 'layered-canvas']},
];

/** Per-shot identity: renderer, palette, purpose, media slots and continuity. */
const SHOT_STYLE = {
  'layered-canvas': [
    {background: '#050B14', accent: '#F2A33C', secondary: '#2EC4B6'},
    {background: '#0A1220', accent: '#2EC4B6', secondary: '#F2A33C'},
    {background: '#071019', accent: '#F2A33C', secondary: '#8AD7CE'},
    {background: '#04070D', accent: '#F7C877', secondary: '#2EC4B6'},
  ],
  'pixel-canvas': [{background: '#0A1220', accent: '#2EC4B6', secondary: '#F2A33C', bars: 9}],
  'project:garden-light': [{background: '#050B14', accent: '#F2A33C', secondary: '#2EC4B6'}],
};

const VIDEO_PLAN = {
  'SHOT-003': {from: [10, 40, 60], to: [30, 120, 140], audioTone: 1000},
  'SHOT-006': {from: [60, 20, 70], to: [190, 70, 150], audioTone: null},
  'SHOT-010': {from: [10, 40, 60], to: [30, 120, 140], audioTone: null},
  'SHOT-012': {from: [40, 10, 70], to: [150, 60, 190], audioTone: null},
  'SHOT-004': {from: [25, 18, 8], to: [220, 150, 50], audioTone: 1000},
  'SHOT-008': {from: [8, 40, 45], to: [60, 160, 170], audioTone: null},
  'SHOT-011': {from: [30, 12, 40], to: [230, 120, 90], audioTone: null},
};

const LAYER_PLAN = {
  'SHOT-004': [{slot: 'fx', kind: 'ring', color: [242, 163, 60]}],
  'SHOT-008': [{slot: 'glyph', kind: 'glyph', color: [46, 196, 182]}],
  'SHOT-011': [
    {slot: 'ring', kind: 'ring', color: [242, 163, 60]},
    {slot: 'glyph', kind: 'glyph', color: [247, 200, 119]},
  ],
};

const shots = [];
let shotNumber = 0;
for (const section of SECTION_PLAN) {
  let cursor = section.startFrame;
  for (const renderer of section.shots) {
    shotNumber += 1;
    const id = `SHOT-${String(shotNumber).padStart(3, '0')}`;
    shots.push({id, renderer, section: section.id, sectionLabel: section.label, startFrame: cursor, endFrame: cursor + SHOT_FRAMES});
    cursor += SHOT_FRAMES;
  }
  if (cursor !== section.endFrame) {
    throw new Error(`Section ${section.id} shot plan ends at ${cursor}, expected ${section.endFrame}`);
  }
}
if (shots.length !== 15 || shots[shots.length - 1].endFrame !== DURATION_FRAMES) {
  throw new Error(`Shot plan produced ${shots.length} shots ending at ${shots[shots.length - 1]?.endFrame}`);
}

const styleCursor = new Map();
const styleFor = (shot) => {
  const list = SHOT_STYLE[shot.renderer] ?? SHOT_STYLE['layered-canvas'];
  const index = styleCursor.get(shot.renderer) ?? 0;
  styleCursor.set(shot.renderer, index + 1);
  return list[index % list.length];
};

const continuityFor = (shot) => {
  switch (shot.id) {
    case 'SHOT-001': return ['CONT-SEED'];
    case 'SHOT-002': return ['CONT-GARDEN'];
    case 'SHOT-003': return ['CONT-SEED', 'CONT-GARDEN'];
    case 'SHOT-004': return ['CONT-COLUMN'];
    case 'SHOT-005': return ['CONT-COLUMN', 'CONT-GARDEN'];
    case 'SHOT-006': return ['CONT-SEED'];
    case 'SHOT-007': return ['CONT-SEED', 'CONT-GARDEN'];
    case 'SHOT-008': return ['CONT-SEED'];
    case 'SHOT-009': return ['CONT-COLUMN'];
    case 'SHOT-010': return ['CONT-GARDEN'];
    case 'SHOT-011': return ['CONT-SEED', 'CONT-COLUMN'];
    case 'SHOT-012': return ['CONT-SEED'];
    case 'SHOT-013': return ['CONT-COLUMN', 'CONT-GARDEN'];
    case 'SHOT-014': return ['CONT-SEED'];
    case 'SHOT-015': return ['CONT-SEED', 'CONT-GARDEN'];
    default: return [];
  }
};

const purposeFor = (shot, index) => {
  if (index === 0) return 'Establish the dark garden and the drifting amber seed';
  if (shot.id === 'SHOT-015') return 'Resolve: the seed settles and the garden holds one steady glow';
  if (shot.id === 'SHOT-014') return 'Close the arc as the planted seed brightens';
  if (shot.sectionLabel === 'pulse') return 'Introduce the pulse motif as the seed wakes';
  if (shot.sectionLabel === 'drive') return 'Develop the garden as light columns rise';
  if (shot.sectionLabel === 'drift') return 'Contrast: hold wide, cool and slow before the bloom';
  return 'Bloom: the strongest visual statement of the piece';
};

const chapters = SECTION_PLAN.map((section, index) => {
  const sectionShots = shots.filter((shot) => shot.section === section.id);
  return {
    id: `CH-${String(index + 1).padStart(2, '0')}`,
    title: section.label,
    startFrame: section.startFrame,
    endFrame: section.endFrame,
    shots: sectionShots.map((shot) => {
      const style = styleFor(shot);
      // The seed project is a valid local project on its own: every shot starts
      // as a Canvas scene. The approved storyboard compiler replaces the
      // renderers with the planned Video/Hybrid/module shots once the media is
      // bound and approved, which is the accepted P1-C/P1-D flow.
      return {
        id: shot.id,
        startFrame: shot.startFrame,
        endFrame: shot.endFrame,
        renderer: 'layered-canvas',
        params: {...style},
      };
    }),
  };
});

// ---------------------------------------------------------------------------
// Scene module
// ---------------------------------------------------------------------------

const moduleSource = `type ModuleContext = {
  frame: {outputFrame: number; localFrame: number; animationTick: number; samplingFps: number};
  canvas: {width: number; height: number};
  output: {width: number; height: number};
  shot: {id: string; startFrame: number; endFrame: number};
  params: {background?: string; accent?: string; secondary?: string};
  moduleParams: Record<string, string | number | boolean>;
};

const clamp01 = (value: number): number => (value < 0 ? 0 : value > 1 ? 1 : value);

/** Blend the requested background toward the near-black garden ground. */
const darken = (hexColor: string): string => {
  const match = /^#([0-9a-f]{6})$/i.exec(hexColor);
  const ground = [5, 11, 20];
  if (!match) return '#050B14';
  const value = match[1];
  const channels = [0, 2, 4].map((offset) => parseInt(value.slice(offset, offset + 2), 16));
  return '#' + channels
    .map((channel, index) => Math.round(channel * 0.25 + ground[index] * 0.75).toString(16).padStart(2, '0'))
    .join('');
};

const sceneModule = {
  id: 'garden-light',
  contractVersion: 1,
  moduleType: 'canvas2d' as const,
  label: 'Garden light column',
  description: 'A light column grows behind a rising amber seed; deterministic per local frame.',
  params: [
    {key: 'growth', type: 'number' as const, required: false},
    {key: 'phase', type: 'number' as const, required: false},
  ],
  render: (ctx: CanvasRenderingContext2D, context: ModuleContext): void => {
    const width = context.canvas.width;
    const height = context.canvas.height;
    const background = darken(context.params.background ?? '#050B14');
    // The seed motif is a continuity identity: the module pins the amber core
    // instead of inheriting whatever palette slot the shot happened to receive.
    const accent = context.params.accent ?? '#2EC4B6';
    const secondary = context.params.secondary ?? '#2EC4B6';
    const growthParam = Number(context.moduleParams.growth ?? 1);
    const phase = Number(context.moduleParams.phase ?? 0);
    const span = Math.max(1, context.shot.endFrame - context.shot.startFrame);
    const progress = clamp01(context.frame.localFrame / span);

    ctx.fillStyle = background;
    ctx.fillRect(0, 0, width, height);

    // Backdrop haze: two soft vertical gradients that never repeat exactly.
    const haze = ctx.createLinearGradient(0, height, width, 0);
    haze.addColorStop(0, 'rgba(46,196,182,0.10)');
    haze.addColorStop(0.55, 'rgba(0,0,0,0)');
    haze.addColorStop(1, 'rgba(242,163,60,0.12)');
    ctx.fillStyle = haze;
    ctx.fillRect(0, 0, width, height);

    const columns = 5;
    for (let index = 0; index < columns; index++) {
      const seed = Math.sin((index + 1) * 12.9898 + phase) * 43758.5453;
      const jitter = seed - Math.floor(seed);
      const x = Math.round(((index + 0.5) / columns) * width + (jitter - 0.5) * width * 0.08);
      const grow = clamp01(progress * (0.6 + growthParam * 0.6) - index * 0.06);
      const columnHeight = Math.round(height * (0.18 + grow * 0.62));
      const columnWidth = Math.max(10, Math.round(width * (0.018 + jitter * 0.012)));
      const top = height - columnHeight;
      const glow = ctx.createLinearGradient(0, top, 0, height);
      glow.addColorStop(0, 'rgba(242,163,60,0.0)');
      glow.addColorStop(0.35, 'rgba(242,163,60,0.62)');
      glow.addColorStop(1, 'rgba(46,196,182,0.18)');
      ctx.fillStyle = glow;
      ctx.fillRect(x - columnWidth / 2, top, columnWidth, columnHeight);
      ctx.strokeStyle = 'rgba(247,200,119,0.55)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x + 0.5, top);
      ctx.lineTo(x + 0.5, height - 4);
      ctx.stroke();
    }

    // The seed: a rising amber orb with a deterministic bob.
    const orbX = width * (0.18 + progress * 0.64);
    const orbY = height * (0.64 - progress * 0.34) + Math.sin(progress * Math.PI * 6 + phase) * height * 0.015;
    const radius = Math.max(8, width * (0.012 + progress * 0.006));
    const halo = ctx.createRadialGradient(orbX, orbY, radius * 0.2, orbX, orbY, radius * 6);
    halo.addColorStop(0, 'rgba(247,200,119,0.85)');
    halo.addColorStop(0.45, 'rgba(242,163,60,0.28)');
    halo.addColorStop(1, 'rgba(242,163,60,0)');
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(orbX, orbY, radius * 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#FFF3D6';
    ctx.beginPath();
    ctx.arc(orbX, orbY, radius, 0, Math.PI * 2);
    ctx.fill();

    // Ground line with sparse deterministic specks.
    ctx.fillStyle = 'rgba(46,196,182,0.35)';
    ctx.fillRect(0, height - 4, width, 4);
    for (let index = 0; index < 40; index++) {
      const noise = Math.sin(index * 78.233 + Math.floor(context.frame.animationTick / 3) * 0.31) * 43758.5453;
      const value = noise - Math.floor(noise);
      const sparkX = Math.round(value * width);
      const sparkY = Math.round(height - 6 - value * height * 0.22);
      ctx.globalAlpha = 0.12 + value * 0.3;
      ctx.fillStyle = secondary;
      ctx.fillRect(sparkX, sparkY, 2, 2);
    }
    ctx.globalAlpha = 1;
  },
};

export default sceneModule;
`;
const modulePath = path.join(target, 'scenes', 'garden-light.ts');
writeFileSync(modulePath, moduleSource);
const moduleSha = sha256(modulePath);

// ---------------------------------------------------------------------------
// Declared reference asset (continuity) + project.json
// ---------------------------------------------------------------------------

const refRelative = 'assets/images/ref-seed.png';
writePlatePng(path.join(target, refRelative), 640, 640, [242, 163, 60]);

const project = {
  schemaVersion: 1,
  projectId: PROJECT_ID,
  song: {title: 'Signal Garden (synthetic rehearsal)', artist: 'MVFoundry Synthetic Score'},
  audio: {
    path: audioRelative,
    sha256: audioSha,
    durationSeconds: DURATION_SECONDS,
    durationPolicy: 'round',
    format: 'wav-pcm',
    assetId: 'AUDIO-MASTER',
    mixSampleRate: 48000,
  },
  lyrics: {language: 'none', path: null},
  narrative: {mode: 'narrative'},
  visual: {
    styleProfile: 'synthetic luminous garden',
    defaultRenderer: 'layered-canvas',
    pixel: {internalWidth: 320, internalHeight: 180, samplingFps: 12},
  },
  output: {width: WIDTH, height: HEIGHT, fps: FPS, durationInFrames: DURATION_FRAMES},
  cues: SECTION_PLAN.map((section, index) => ({
    id: `CUE-${String(index + 1).padStart(2, '0')}`,
    frame: section.startFrame,
    timeSeconds: section.startFrame / FPS,
    source: 'synthetic',
    label: `${section.label} section start`,
  })),
  chapters,
  sceneModules: [
    {
      id: 'garden-light',
      path: 'scenes/garden-light.ts',
      moduleType: 'canvas2d',
      contractVersion: 1,
      sha256: moduleSha,
      trust: 'user-authored-approved',
      canvas: {mode: 'output'},
      samplingFps: 'output',
      pixelated: false,
      label: 'Garden light column',
      description: 'Deterministic growing light columns behind a rising seed.',
    },
  ],
  audioTracks: [],
  assets: [
    {
      id: 'AUDIO-MASTER',
      kind: 'audio-reference',
      path: audioRelative,
      sha256: audioSha,
      source: 'Deterministic synthesis by factory/scripts/support/synthetic-score.mjs',
      rights: 'Original synthetic audio generated for this rehearsal; no third-party rights',
      approval: 'approved',
    },
    {
      id: 'REF-SEED',
      kind: 'image',
      path: refRelative,
      sha256: sha256(path.join(target, refRelative)),
      source: 'Procedural reference plate generated by factory/scripts/seed-mv-production.mjs',
      rights: 'Original synthetic image generated for this rehearsal; no third-party rights',
      approval: 'approved',
    },
  ],
  permissions: {externalGeneration: false, localOnly: true, allowNetwork: false},
  render: {codec: 'h264', pixelFormat: 'yuv420p', colorSpace: 'bt709', imageFormat: 'png'},
};
writeJson(path.join(target, 'project.json'), project);

// ---------------------------------------------------------------------------
// Annotations: BPM, section anchors, bar-aligned cut cues
// ---------------------------------------------------------------------------

const beatFrames = (60 / SCORE_BPM) * FPS; // 12 frames per beat
const barFrames = beatFrames * SCORE_BEATS_PER_BAR; // 48 frames per bar

const annotations = {
  schemaVersion: 1,
  projectId: PROJECT_ID,
  bpm: {value: SCORE_BPM, source: 'user', approval: 'approved', notes: 'Synthetic score is generated at exactly 120 BPM.'},
  beatAnchors: SECTION_PLAN.map((section, index) => ({
    id: `ANCHOR-${String(index + 1).padStart(2, '0')}`,
    frame: section.startFrame,
    timeSeconds: section.startFrame / FPS,
    source: 'user',
    approval: 'approved',
    notes: `${section.label} section start`,
  })),
  cutCues: shots.slice(1).map((shot, index) => ({
    id: `CUT-${String(index + 1).padStart(2, '0')}`,
    frame: shot.startFrame,
    timeSeconds: shot.startFrame / FPS,
    label: `${shot.sectionLabel} cut on bar line`,
    source: 'user',
    approval: 'approved',
    notes: `Cut lands on bar ${Math.round(shot.startFrame / barFrames)} of the 120 BPM score.`,
  })),
  sections: SECTION_PLAN.map((section) => ({
    id: section.id,
    label: section.label,
    startFrame: section.startFrame,
    endFrame: section.endFrame,
    source: 'user',
    approval: 'approved',
  })),
};
writeJson(path.join(target, 'preproduction', 'annotations.json'), annotations);

// ---------------------------------------------------------------------------
// Creative brief with one directive per shot
// ---------------------------------------------------------------------------

const mediaFor = (shot) => {
  if (shot.renderer === 'video') {
    return {
      kind: 'video',
      backgroundSlot: 'bg',
      sourceStartFrames: shot.id === 'SHOT-010' ? 24 : 0,
      fit: 'cover',
      positionX: 0,
      positionY: 0,
      scale: 1,
    };
  }
  if (shot.renderer === 'hybrid') {
    const layers = (LAYER_PLAN[shot.id] ?? []).map((layer, index) => ({
      slot: layer.slot,
      order: index + 1,
      opacity: 0.9,
      fit: 'contain',
      positionX: 0,
      positionY: 0,
      scale: 1,
      visibleFromFrame: 0,
      visibleToFrame: SHOT_FRAMES,
    }));
    return {
      kind: 'hybrid',
      backgroundSlot: 'bg',
      sourceStartFrames: 0,
      fit: 'cover',
      positionX: 0,
      positionY: 0,
      scale: 1,
      layers,
      overlay: {kind: 'orbits', intensity: 0.35, color: '#2EC4B6'},
    };
  }
  return null;
};

const brief = {
  schemaVersion: 1,
  projectId: PROJECT_ID,
  source: 'user',
  approval: 'approved',
  concept:
    'Signal Garden: a single amber seed drifts through a dark synthetic garden, wakes a field of light columns as the music builds, rests during a cool wide passage, and finally plants itself while the garden blooms and settles.',
  narrativeMode: 'narrative',
  moodProgression: ['hushed', 'waking', 'driving', 'suspended', 'radiant', 'settled'],
  visualStyle: 'luminous synthetic garden of vertical light columns on near-black ground',
  aspectRatio: '16:9',
  palette: ['#050B14', '#F2A33C', '#2EC4B6'],
  characters: [],
  setting: 'an abstract dark garden of glowing vertical light columns',
  continuityRules: [
    'The amber seed stays the same warm hue in every shot it appears.',
    'Light columns always rise from the ground line, never hang from the top.',
    'Cyan is reserved for background air and the cool drift passage.',
  ],
  pacing: {preferredShotFrames: SHOT_FRAMES, minShotFrames: 24, maxShotFrames: SHOT_FRAMES, allowBeatCuts: false},
  cameraLanguage: ['locked wide', 'slow lateral drift', 'gentle push in'],
  transitions: ['hard cut on the bar line'],
  approvedReferences: ['REF-SEED'],
  excludedElements: ['faces', 'text overlays', 'real locations', 'third-party footage'],
  productionConstraints: [
    'Every asset is synthetic and produced for this rehearsal; no third-party media is used.',
    'A technical PASS is never an artistic approval.',
    'No provider request is authorized; media is authored locally.',
  ],
  preferredRenderers: ['layered-canvas', 'pixel-canvas', 'video', 'hybrid', 'project:garden-light'],
  rendererDirectives: shots.map((shot, index) => ({
    id: `DIR-${String(index + 1).padStart(2, '0')}`,
    renderer: shot.renderer,
    continuityIds: continuityFor(shot),
    media: mediaFor(shot),
  })),
  requiredAssets: [],
  assumptions: [
    'The score is generated, so its section boundaries are exact and can be used as timing evidence.',
    'Continuity is declared and visually inspectable, not recognized by a model.',
  ],
};
writeJson(path.join(target, 'preproduction', 'creative-brief.json'), brief);

// ---------------------------------------------------------------------------
// Continuity registry
// ---------------------------------------------------------------------------

const continuityShots = (entryId) => shots.filter((shot) => continuityFor(shot).includes(entryId)).map((shot) => shot.id);

const continuity = {
  schemaVersion: 1,
  projectId: PROJECT_ID,
  revision: 1,
  entries: [
    {
      id: 'CONT-SEED',
      identity: 'amber seed',
      kind: 'prop',
      description: 'A small warm amber orb with a soft halo, the only saturated warm object in frame.',
      shotIds: continuityShots('CONT-SEED'),
      referenceAssetId: 'REF-SEED',
      attributes: {hue: 'amber', halo: 'soft', size: 'small'},
      constraints: ['Seed hue stays amber', 'Halo never becomes magenta'],
      exclusions: ['Faces', 'Text'],
      approval: 'approved',
      revision: 1,
      supersedes: null,
    },
    {
      id: 'CONT-GARDEN',
      identity: 'signal garden',
      kind: 'location',
      description: 'Near-black ground with vertical light columns and cool cyan air.',
      shotIds: continuityShots('CONT-GARDEN'),
      referenceAssetId: null,
      attributes: {ground: 'near-black', air: 'cyan haze', columns: 'vertical'},
      constraints: ['Ground line stays horizontal', 'No daylight sky'],
      exclusions: ['Horizon sunsets', 'Crowds'],
      approval: 'approved',
      revision: 1,
      supersedes: null,
    },
    {
      id: 'CONT-COLUMN',
      identity: 'light column',
      kind: 'appearance',
      description: 'A vertical gradient column rising from the ground line, amber core with a cyan base.',
      shotIds: continuityShots('CONT-COLUMN'),
      referenceAssetId: null,
      attributes: {direction: 'upward', core: 'amber'},
      constraints: ['Columns grow from the ground up'],
      exclusions: ['Hanging light fixtures'],
      approval: 'approved',
      revision: 1,
      supersedes: null,
    },
  ],
};
writeJson(path.join(target, 'preproduction', 'continuity.json'), continuity);

// ---------------------------------------------------------------------------
// Synthetic source assets (attached through the accepted handoff workflow)
// ---------------------------------------------------------------------------

const clipFor = (shotId) => {
  const plan = VIDEO_PLAN[shotId];
  const file = path.join(target, 'assets', 'video', `${shotId.toLowerCase()}-source.mp4`);
  writeMovingClip(file, {
    width: WIDTH,
    height: HEIGHT,
    seconds: 6,
    fps: FPS,
    from: plan.from,
    to: plan.to,
    audioTone: plan.audioTone,
    bandSpeed: shotId === 'SHOT-012' ? 1.6 : 1,
  });
  return file;
};

for (const shotId of Object.keys(VIDEO_PLAN)) clipFor(shotId);

const layerFiles = {
  'SHOT-004:fx': {file: 'assets/layers/ring-a.png', kind: 'ring', color: [242, 163, 60]},
  'SHOT-008:glyph': {file: 'assets/layers/glyph-a.png', kind: 'glyph', color: [46, 196, 182]},
  'SHOT-011:ring': {file: 'assets/layers/ring-b.png', kind: 'ring', color: [247, 200, 119]},
  'SHOT-011:glyph': {file: 'assets/layers/glyph-b.png', kind: 'glyph', color: [242, 163, 60]},
};

for (const entry of Object.values(layerFiles)) {
  writeAlphaPng(path.join(target, entry.file), WIDTH, HEIGHT, (x, y, width, height) => {
    const cx = width * 0.5;
    const cy = height * 0.5;
    const dx = x - cx;
    const dy = y - cy;
    const distance = Math.sqrt(dx * dx + dy * dy);
    if (entry.kind === 'ring') {
      const outer = Math.min(width, height) * 0.34;
      const inner = outer - Math.max(6, width * 0.012);
      if (distance <= outer && distance >= inner) return [...entry.color, 236];
      const core = Math.min(width, height) * 0.03;
      if (distance <= core) return [...entry.color, 180];
      return [0, 0, 0, 0];
    }
    // Glyph: a deterministic lattice of thin bars.
    const inColumn = x % Math.round(width / 14) < 3 && y > height * 0.28 && y < height * 0.72;
    const inRow = y % Math.round(height / 7) < 3 && x > width * 0.3 && x < width * 0.7;
    return inColumn || inRow ? [...entry.color, 220] : [0, 0, 0, 0];
  });
}

// A deliberately unsuitable (but technically valid) replacement candidate.
writeMovingClip(path.join(target, 'assets', 'rejected', 'flat-grey.mp4'), {
  width: WIDTH,
  height: HEIGHT,
  seconds: 6,
  fps: FPS,
  from: [128, 128, 128],
  to: [140, 140, 140],
  audioTone: null,
  bandSpeed: 0.02,
});

// ---------------------------------------------------------------------------
// Intended production plan (project-local, for the rehearsal harness)
// ---------------------------------------------------------------------------

writeJson(path.join(target, 'production', 'plan.json'), {
  schemaVersion: 1,
  projectId: PROJECT_ID,
  durationFrames: DURATION_FRAMES,
  fps: FPS,
  width: WIDTH,
  height: HEIGHT,
  shotFrames: SHOT_FRAMES,
  score: {bpm: SCORE_BPM, sections: score.sections, markers: score.markers},
  shots: shots.map((shot, index) => ({
    id: shot.id,
    index,
    renderer: shot.renderer,
    family: shot.renderer === 'project:garden-light' ? 'module' : shot.renderer,
    startFrame: shot.startFrame,
    endFrame: shot.endFrame,
    section: shot.section,
    sectionLabel: shot.sectionLabel,
    purpose: purposeFor(shot, index),
    continuityIds: continuityFor(shot),
    videoShotId: VIDEO_PLAN[shot.id] ? shot.id : null,
    layers: LAYER_PLAN[shot.id] ?? [],
  })),
  note: 'Intent only. Renderer availability, media binding and approval are decided by the accepted compiler.',
});

console.log(JSON.stringify({
  workspaceRoot,
  projectId: PROJECT_ID,
  projectDir: target,
  audio: {path: audioRelative, sha256: audioSha, durationSeconds: DURATION_SECONDS},
  score: {bpm: SCORE_BPM, sections: score.sections.length, kicks: score.markers.kicks.length, snares: score.markers.snares.length},
  shots: shots.length,
  families: shots.reduce((summary, shot) => {
    const family = shot.renderer === 'project:garden-light' ? 'module' : shot.renderer;
    summary[family] = (summary[family] ?? 0) + 1;
    return summary;
  }, {}),
  module: {path: 'scenes/garden-light.ts', sha256: moduleSha},
  note: 'All media is synthetic and generated locally. No provider request is authorized.',
}, null, 2));
