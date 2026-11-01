// Independent Project B: "Prism Transit".
//
// A second deterministic synthetic project with substantially different
// properties from Signal Garden, used to prove the production engine is
// project-independent: 50 seconds instead of 60, 5/4 meter with explicit tempo
// changes instead of 4/4 at a constant 120 BPM, nonuniform section and shot
// durations, a 4:3 output instead of 16:9, a different visual concept, a
// different renderer distribution, different requirement ids and different
// media filenames.
//
// Nothing about this project is known to the production engine. It is created
// through the generic `mv-project.mjs init` path and produced through the
// generic `produce-mv.mjs` command.
//
// Usage:
//   node factory/scripts/seed-mv-project-b.mjs --root <external-workspace>
//
// The seed writes project data and media into the workspace only. It does not
// approve assets: the acceptance script attaches and reviews them explicitly.

import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {writeAlphaPng, writeMovingClip, writePlatePng} from './support/synthetic-media.mjs';
import {SCORE_B_SECTIONS, SCORE_B_TEMPO_CHANGES, writeScoreB} from './support/synthetic-score-b.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : fallback;
};

const workspaceRoot = arg('root', arg('workspace', process.env.MV_WORKSPACE_ROOT));
if (!workspaceRoot) {
  console.error('--root or MV_WORKSPACE_ROOT is required');
  process.exit(2);
}

const PROJECT_ID = 'prism-transit-demo';
const FPS = 24;
const WIDTH = 960;
const HEIGHT = 720;
const DURATION_SECONDS = 50;
const DURATION_FRAMES = DURATION_SECONDS * FPS; // 1200

// Nonuniform shot plan. Lengths in frames: 120, 96, 120, 120, 60, 120, 120,
// 48, 120, 120, 60, 96 — never a constant, and never 96 throughout.
const SHOTS = [
  {id: 'SHOT-001', startFrame: 0, endFrame: 120, renderer: 'layered-canvas', section: 'PT-SEC-01'},
  {id: 'SHOT-002', startFrame: 120, endFrame: 216, renderer: 'pixel-canvas', section: 'PT-SEC-01'},
  {id: 'SHOT-003', startFrame: 216, endFrame: 336, renderer: 'video', section: 'PT-SEC-02'},
  {id: 'SHOT-004', startFrame: 336, endFrame: 456, renderer: 'hybrid', section: 'PT-SEC-02'},
  {id: 'SHOT-005', startFrame: 456, endFrame: 516, renderer: 'project:prism-beam', section: 'PT-SEC-02'},
  {id: 'SHOT-006', startFrame: 516, endFrame: 636, renderer: 'video', section: 'PT-SEC-03'},
  {id: 'SHOT-007', startFrame: 636, endFrame: 756, renderer: 'layered-canvas', section: 'PT-SEC-03'},
  {id: 'SHOT-008', startFrame: 756, endFrame: 804, renderer: 'hybrid', section: 'PT-SEC-03'},
  {id: 'SHOT-009', startFrame: 804, endFrame: 924, renderer: 'project:prism-beam', section: 'PT-SEC-04'},
  {id: 'SHOT-010', startFrame: 924, endFrame: 1044, renderer: 'video', section: 'PT-SEC-04'},
  {id: 'SHOT-011', startFrame: 1044, endFrame: 1104, renderer: 'pixel-canvas', section: 'PT-SEC-04'},
  {id: 'SHOT-012', startFrame: 1104, endFrame: 1200, renderer: 'layered-canvas', section: 'PT-SEC-05'},
];

const LAYER_PLAN = {
  'SHOT-004': [{slot: 'facet', kind: 'facet', color: [219, 88, 231]}],
  'SHOT-008': [
    {slot: 'facet', kind: 'facet', color: [88, 219, 231]},
    {slot: 'beam', kind: 'beam', color: [255, 214, 102]},
  ],
};

const VIDEO_PLAN = {
  'SHOT-003': {from: [12, 18, 48], to: [90, 40, 140], audioTone: 880, bandSpeed: 1.4},
  'SHOT-004': {from: [48, 12, 60], to: [220, 120, 230], audioTone: null, bandSpeed: 0.8},
  'SHOT-006': {from: [30, 30, 60], to: [230, 90, 200], audioTone: null, bandSpeed: 1.1},
  'SHOT-008': {from: [16, 40, 52], to: [80, 210, 220], audioTone: 660, bandSpeed: 0.9},
  'SHOT-010': {from: [60, 16, 40], to: [240, 180, 90], audioTone: null, bandSpeed: 1.6},
};

const PALETTE = ['#12071F', '#DB58E7', '#58DBE7'];

const sectionFrames = SCORE_B_SECTIONS.map((section) => ({
  ...section,
  startFrame: Math.round(section.startSeconds * FPS),
  endFrame: Math.round(section.endSeconds * FPS),
}));

const cutFrames = SHOTS.slice(1).map((shot) => shot.startFrame);

const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
const writeJson = (file, value) => {
  mkdirSync(path.dirname(file), {recursive: true});
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
};

const workspaceAbsolute = path.resolve(workspaceRoot);
const projectDir = path.join(workspaceAbsolute, PROJECT_ID);

// ---------------------------------------------------------------------------
// 1. Generate the score outside the project, then import it generically
// ---------------------------------------------------------------------------

const scoreDir = path.join(workspaceAbsolute, '_sources');
mkdirSync(scoreDir, {recursive: true});
const scorePath = path.join(scoreDir, 'prism-transit-score.wav');
const scoreMetadata = writeScoreB(scorePath);
console.error(`[pt] score written: ${scorePath} (${scoreMetadata.durationSeconds}s, ${scoreMetadata.sections.length} sections)`);

const initOutput = execFileSync(
  process.execPath,
  [
    path.join(repoRoot, 'factory', 'scripts', 'mv-project.mjs'), 'init',
    '--project', PROJECT_ID,
    '--workspace', workspaceAbsolute,
    '--width', String(WIDTH), '--height', String(HEIGHT), '--fps', String(FPS),
    '--audio', scorePath,
    '--source', 'Deterministic synthesis by factory/scripts/support/synthetic-score-b.mjs (oscillators and seeded noise; nothing sampled)',
    '--rights', 'Original synthetic audio generated for this project; no third-party rights',
    '--title', 'Prism Transit (synthetic)',
    '--artist', 'MVFoundry Synthetic Score',
    '--style', 'angular prism refraction with a travelling focal beam',
  ],
  {encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, windowsHide: true},
);
const initReport = JSON.parse(initOutput.slice(initOutput.indexOf('{')));
console.error(`[pt] project initialized: ${initReport.audio.decodedDurationSeconds}s -> ${initReport.audio.frameCount} frames`);

// ---------------------------------------------------------------------------
// 2. Media: clips, transparent layers, a reference plate
// ---------------------------------------------------------------------------

const media = {};
for (const [shotId, plan] of Object.entries(VIDEO_PLAN)) {
  const file = path.join(projectDir, 'assets', 'video', `${shotId.toLowerCase()}-plate.mp4`);
  writeMovingClip(file, {
    width: 640,
    height: 480,
    seconds: 8,
    fps: FPS,
    from: plan.from,
    to: plan.to,
    audioTone: plan.audioTone,
    bandSpeed: plan.bandSpeed,
  });
  media[shotId] = {path: path.relative(projectDir, file).split(path.sep).join('/'), sha256: sha256(file)};
}
for (const [shotId, layers] of Object.entries(LAYER_PLAN)) {
  for (const layer of layers) {
    const file = path.join(projectDir, 'assets', 'layers', `${shotId.toLowerCase()}-${layer.slot}.png`);
    writeAlphaPng(file, 640, 480, (x, y, width, height) => {
      const cx = width / 2;
      const cy = height / 2;
      const dx = x - cx;
      const dy = y - cy;
      const distance = Math.sqrt(dx * dx + dy * dy);
      if (layer.kind === 'facet') {
        // Angular prism facets: diagonal bands with hard edges.
        const band = ((x + y * 1.4) % 140) / 140;
        const on = band > 0.42 && band < 0.58 && distance < width * 0.42;
        return on ? [layer.color[0], layer.color[1], layer.color[2], 200] : [0, 0, 0, 0];
      }
      // A thin travelling beam.
      const beam = Math.abs(dy - dx * 0.35) < 10 && distance < width * 0.48;
      return beam ? [layer.color[0], layer.color[1], layer.color[2], 190] : [0, 0, 0, 0];
    });
    media[`${shotId}:${layer.slot}`] = {path: path.relative(projectDir, file).split(path.sep).join('/'), sha256: sha256(file)};
  }
}

const refPath = path.join(projectDir, 'assets', 'images', 'prism-ref.png');
writePlatePng(refPath, 480, 480, [219, 88, 231]);
const refRelative = path.relative(projectDir, refPath).split(path.sep).join('/');

// ---------------------------------------------------------------------------
// 3. Project-local scene module (different id and drawing from Signal Garden)
// ---------------------------------------------------------------------------

const moduleSource = `// Project-local scene module for Prism Transit.
// Draws refraction facets and a travelling focal beam, deterministic per frame.
const clamp01 = (value: number): number => (value < 0 ? 0 : value > 1 ? 1 : value);

type ModuleContext = {
  canvas: {width: number; height: number};
  frame: {localFrame: number; animationTick: number};
  shot: {startFrame: number; endFrame: number};
  params: Record<string, string | number | undefined>;
  moduleParams: Record<string, string | number | undefined>;
};

const sceneModule = {
  id: 'prism-beam',
  contractVersion: 1,
  moduleType: 'canvas2d' as const,
  label: 'Prism beam',
  description: 'Angular refraction facets crossed by a travelling focal beam.',
  params: [
    {key: 'speed', type: 'number' as const, required: false},
  ],
  render: (ctx: CanvasRenderingContext2D, context: ModuleContext): void => {
    const width = context.canvas.width;
    const height = context.canvas.height;
    const background = context.params.background ?? '#12071F';
    const accent = context.params.accent ?? '#DB58E7';
    const secondary = context.params.secondary ?? '#58DBE7';
    const speed = Number(context.moduleParams.speed ?? 1);
    const span = Math.max(1, context.shot.endFrame - context.shot.startFrame);
    const progress = clamp01(context.frame.localFrame / span);

    ctx.fillStyle = background;
    ctx.fillRect(0, 0, width, height);

    // Refraction facets: diagonal bands sweeping slowly.
    const facetCount = 7;
    for (let index = 0; index < facetCount; index++) {
      const phase = (index / facetCount) * Math.PI * 2;
      const offset = Math.sin(progress * Math.PI * 2 * speed + phase) * width * 0.12;
      const x0 = (index / facetCount) * width * 1.6 - width * 0.3 + offset;
      ctx.beginPath();
      ctx.moveTo(x0, 0);
      ctx.lineTo(x0 + width * 0.16, 0);
      ctx.lineTo(x0 + width * 0.16 - height * 0.55, height);
      ctx.lineTo(x0 - height * 0.55, height);
      ctx.closePath();
      ctx.fillStyle = index % 2 === 0 ? accent + '2E' : secondary + '22';
      ctx.fill();
    }

    // Travelling focal beam.
    const beamY = height * (0.22 + progress * 0.56);
    const gradient = ctx.createLinearGradient(0, beamY - height * 0.06, 0, beamY + height * 0.06);
    gradient.addColorStop(0, 'rgba(255,214,102,0)');
    gradient.addColorStop(0.5, 'rgba(255,214,102,0.72)');
    gradient.addColorStop(1, 'rgba(255,214,102,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, beamY - height * 0.06, width, height * 0.12);

    // The focal core: the recurring subject of this project.
    const coreX = width * (0.2 + progress * 0.6);
    const coreRadius = Math.max(9, width * 0.016);
    const halo = ctx.createRadialGradient(coreX, beamY, coreRadius * 0.3, coreX, beamY, coreRadius * 7);
    halo.addColorStop(0, 'rgba(255,236,180,0.92)');
    halo.addColorStop(0.4, 'rgba(255,214,102,0.3)');
    halo.addColorStop(1, 'rgba(255,214,102,0)');
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(coreX, beamY, coreRadius * 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#FFF4D2';
    ctx.beginPath();
    ctx.arc(coreX, beamY, coreRadius, 0, Math.PI * 2);
    ctx.fill();
  },
};

export default sceneModule;
`;
const modulePath = path.join(projectDir, 'scenes', 'prism-beam.ts');
mkdirSync(path.dirname(modulePath), {recursive: true});
writeFileSync(modulePath, moduleSource);
const moduleSha = sha256(modulePath);
const moduleRelative = path.relative(projectDir, modulePath).split(path.sep).join('/');

// Register the module and the reference plate in project.json without touching
// anything else the initializer wrote. The chapter shell uses the default
// renderer; the actual per-shot renderer comes from the brief's
// rendererDirectives when the director plan is generated.
const projectFile = path.join(projectDir, 'project.json');
const project = JSON.parse(readFileSync(projectFile, 'utf8'));
project.sceneModules = [
  {
    id: 'prism-beam',
    path: moduleRelative,
    moduleType: 'canvas2d',
    contractVersion: 1,
    sha256: moduleSha,
    trust: 'user-authored-approved',
    canvas: {mode: 'output'},
    samplingFps: 'output',
    pixelated: false,
    label: 'Prism beam',
    description: 'Angular refraction facets crossed by a travelling focal beam.',
  },
];
project.assets.push({
  id: 'REF-PRISM',
  kind: 'image',
  path: refRelative,
  sha256: sha256(refPath),
  source: 'Procedural reference plate generated by factory/scripts/seed-mv-project-b.mjs',
  rights: 'Original synthetic image generated for this project; no third-party rights',
  approval: 'approved',
});
project.chapters = sectionFrames.map((section, index) => ({
  id: `PT-CH-${String(index + 1).padStart(2, '0')}`,
  title: section.label,
  startFrame: section.startFrame,
  endFrame: section.endFrame,
  shots: SHOTS.filter((shot) => shot.section === section.id).map((shot) => ({
    id: shot.id,
    startFrame: shot.startFrame,
    endFrame: shot.endFrame,
    renderer: 'layered-canvas',
    params: {background: PALETTE[0], accent: PALETTE[1], secondary: PALETTE[2]},
  })),
}));
project.cues = sectionFrames.map((section, index) => ({
  id: `PT-CUE-${String(index + 1).padStart(2, '0')}`,
  frame: section.startFrame,
  timeSeconds: section.startSeconds,
  source: 'synthetic',
  label: `${section.label} section start`,
}));
writeJson(projectFile, project);

// ---------------------------------------------------------------------------
// 4. Annotations: five sections, explicit tempo regions, nonuniform cuts
// ---------------------------------------------------------------------------

writeJson(path.join(projectDir, 'preproduction', 'annotations.json'), {
  schemaVersion: 1,
  projectId: PROJECT_ID,
  bpm: {
    value: 100,
    source: 'user',
    approval: 'approved',
    notes:
      '5/4 meter with explicit tempo regions: 100 BPM for threshold/fracture/settle, 120 BPM for ascent/surge. ' +
      'Tempo changes at 9.0s (100->120), 21.5s (120->100) and 33.5s (100->120) are part of the composition, not an analysis error. ' +
      'The single value 100 is the initial tempo; the regions and changes are recorded in the score metadata and the plan manifest.',
  },
  beatAnchors: sectionFrames.map((section, index) => ({
    id: `PT-ANCHOR-${String(index + 1).padStart(2, '0')}`,
    frame: section.startFrame,
    timeSeconds: section.startSeconds,
    source: 'user',
    approval: 'approved',
    notes: `${section.label} section start (${section.bpm} BPM, ${section.meter}/4)`,
  })),
  cutCues: cutFrames.map((frame, index) => ({
    id: `PT-CUT-${String(index + 1).padStart(2, '0')}`,
    frame,
    timeSeconds: frame / FPS,
    label: `cut into ${SHOTS[index + 1].id}`,
    source: 'user',
    approval: 'approved',
    notes: `Nonuniform shot boundary at frame ${frame}; deliberately not on a constant grid.`,
  })),
  sections: sectionFrames.map((section) => ({
    id: section.id,
    label: section.label,
    startFrame: section.startFrame,
    endFrame: section.endFrame,
    source: 'user',
    approval: 'approved',
  })),
});

// ---------------------------------------------------------------------------
// 5. Creative brief with one directive per shot
// ---------------------------------------------------------------------------

const mediaFor = (shot) => {
  const plan = VIDEO_PLAN[shot.id];
  if (shot.renderer === 'video') {
    return {
      kind: 'video',
      backgroundSlot: 'bg',
      sourceStartFrames: 0,
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
      opacity: 0.88,
      fit: 'contain',
      positionX: 0,
      positionY: 0,
      scale: 1,
      visibleFromFrame: 0,
      visibleToFrame: shot.endFrame - shot.startFrame,
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
      overlay: {kind: 'orbits', intensity: 0.3, color: '#58DBE7'},
    };
  }
  void plan;
  return null;
};

const continuityFor = (shot) => {
  switch (shot.id) {
    case 'SHOT-001': return ['PT-CONT-CORE'];
    case 'SHOT-002': return ['PT-CONT-FACET'];
    case 'SHOT-003': return ['PT-CONT-CORE', 'PT-CONT-FACET'];
    case 'SHOT-004': return ['PT-CONT-FACET'];
    case 'SHOT-005': return ['PT-CONT-CORE', 'PT-CONT-BEAM'];
    case 'SHOT-006': return ['PT-CONT-BEAM'];
    case 'SHOT-007': return ['PT-CONT-CORE'];
    case 'SHOT-008': return ['PT-CONT-FACET', 'PT-CONT-BEAM'];
    case 'SHOT-009': return ['PT-CONT-CORE', 'PT-CONT-BEAM'];
    case 'SHOT-010': return ['PT-CONT-FACET'];
    case 'SHOT-011': return ['PT-CONT-BEAM'];
    case 'SHOT-012': return ['PT-CONT-CORE'];
    default: return [];
  }
};

writeJson(path.join(projectDir, 'preproduction', 'creative-brief.json'), {
  schemaVersion: 1,
  projectId: PROJECT_ID,
  source: 'user',
  approval: 'approved',
  concept:
    'Prism Transit: a warm focal beam travels through angular glass prisms, refracting into bands that shift with the tempo. ' +
    'The beam is the recurring subject; the prisms and their facets are the location. The piece accelerates and decelerates with the score.',
  narrativeMode: 'narrative',
  moodProgression: ['suspended', 'ascending', 'fractured', 'surging', 'resolved'],
  visualStyle: 'angular prism refraction with a travelling focal beam on deep violet ground',
  aspectRatio: '4:3',
  palette: PALETTE,
  characters: [],
  setting: 'an abstract interior of angular glass prisms on deep violet ground',
  continuityRules: [
    'The focal core stays the same warm cream hue in every shot it appears.',
    'Prism facets always run diagonally; no horizontal banding.',
    'Magenta is reserved for facet edges and cyan for refracted air.',
  ],
  pacing: {preferredShotFrames: 120, minShotFrames: 48, maxShotFrames: 150, allowBeatCuts: false},
  cameraLanguage: ['locked wide', 'slow lateral drift', 'gentle push in', 'hard locked frame'],
  transitions: ['hard cut on the annotated cue'],
  approvedReferences: ['REF-PRISM'],
  excludedElements: ['faces', 'text overlays', 'real locations', 'third-party footage'],
  productionConstraints: [
    'Every asset is synthetic and produced for this project; no third-party media is used.',
    'A technical PASS is never an artistic approval.',
    'No provider request is authorized; media is authored locally.',
  ],
  preferredRenderers: ['layered-canvas', 'pixel-canvas', 'video', 'hybrid', 'project:prism-beam'],
  rendererDirectives: SHOTS.map((shot, index) => ({
    id: `PT-DIR-${String(index + 1).padStart(2, '0')}`,
    renderer: shot.renderer,
    continuityIds: continuityFor(shot),
    media: mediaFor(shot),
  })),
  requiredAssets: [],
  assumptions: [
    'The score is generated, so its section boundaries and tempo changes are exact timing evidence.',
    'Continuity is declared and visually inspectable, not recognized by a model.',
  ],
});

// ---------------------------------------------------------------------------
// 6. Continuity registry
// ---------------------------------------------------------------------------

const shotsFor = (id) => SHOTS.filter((shot) => continuityFor(shot).includes(id)).map((shot) => shot.id);

writeJson(path.join(projectDir, 'preproduction', 'continuity.json'), {
  schemaVersion: 1,
  projectId: PROJECT_ID,
  revision: 1,
  entries: [
    {
      id: 'PT-CONT-CORE',
      identity: 'focal core',
      kind: 'prop',
      description: 'A warm cream focal core with a soft halo, the only saturated warm object in frame.',
      shotIds: shotsFor('PT-CONT-CORE'),
      referenceAssetId: 'REF-PRISM',
      attributes: {hue: 'warm cream', halo: 'soft', size: 'small'},
      constraints: ['Core hue stays warm cream', 'Halo never becomes magenta'],
      exclusions: ['Faces', 'Text'],
      approval: 'approved',
      revision: 1,
      supersedes: null,
    },
    {
      id: 'PT-CONT-FACET',
      identity: 'prism facet',
      kind: 'appearance',
      description: 'Angular translucent facets running diagonally across the frame.',
      shotIds: shotsFor('PT-CONT-FACET'),
      referenceAssetId: null,
      attributes: {orientation: 'diagonal', opacity: 'translucent', palette: 'magenta edges'},
      constraints: ['Facets run diagonally', 'No horizontal banding'],
      exclusions: ['Curved glass'],
      approval: 'approved',
      revision: 1,
      supersedes: null,
    },
    {
      id: 'PT-CONT-BEAM',
      identity: 'focal beam',
      kind: 'appearance',
      description: 'A horizontal travelling beam of warm light crossing the prism interior.',
      shotIds: shotsFor('PT-CONT-BEAM'),
      referenceAssetId: null,
      attributes: {orientation: 'horizontal', warmth: 'amber', motion: 'travelling'},
      constraints: ['Beam stays horizontal', 'Beam carries the core'],
      exclusions: ['Vertical beams'],
      approval: 'approved',
      revision: 1,
      supersedes: null,
    },
  ],
});

// ---------------------------------------------------------------------------
// 7. Plan manifest for the acceptance harness (not used by the engine)
// ---------------------------------------------------------------------------

writeJson(path.join(projectDir, 'production', 'plan.json'), {
  schemaVersion: 1,
  projectId: PROJECT_ID,
  generatedBy: 'factory/scripts/seed-mv-project-b.mjs',
  profile: {width: WIDTH, height: HEIGHT, fps: FPS, durationInFrames: DURATION_FRAMES, aspectRatio: `${WIDTH}:${HEIGHT}`},
  score: {
    path: path.relative(projectDir, scorePath).split(path.sep).join('/'),
    durationSeconds: scoreMetadata.durationSeconds,
    sections: scoreMetadata.sections,
    tempoChanges: scoreMetadata.tempoChanges,
  },
  shots: SHOTS.map((shot) => ({
    ...shot,
    lengthFrames: shot.endFrame - shot.startFrame,
    continuityIds: continuityFor(shot),
    media: VIDEO_PLAN[shot.id] ?? null,
    layers: LAYER_PLAN[shot.id] ?? [],
  })),
  media,
  module: {id: 'prism-beam', path: moduleRelative, sha256: moduleSha},
  reference: {id: 'REF-PRISM', path: refRelative},
});

console.log(JSON.stringify({
  status: 'seeded',
  projectId: PROJECT_ID,
  projectDir: path.relative(workspaceAbsolute, projectDir).split(path.sep).join('/'),
  score: {durationSeconds: scoreMetadata.durationSeconds, sections: scoreMetadata.sections.length, tempoChanges: scoreMetadata.tempoChanges.length},
  shots: SHOTS.length,
  shotLengths: SHOTS.map((shot) => shot.endFrame - shot.startFrame),
  renderers: [...new Set(SHOTS.map((shot) => shot.renderer))],
  output: {width: WIDTH, height: HEIGHT, fps: FPS, durationInFrames: DURATION_FRAMES},
  mediaFiles: Object.keys(media).length,
  note: 'Assets are NOT attached or approved. The acceptance script does that explicitly through the handoff workflow.',
}, null, 2));
