// Creator-onboarding acceptance: fresh project -> analysis -> planning ->
// ordinary RGB image intake -> transparent layer -> browser preflight ->
// preview -> revision -> complete MP4 -> decoded inspection.
//
// Everything is synthetic and local. No real song, creator image or provider is
// involved, and nothing is written into the engine repository.
//
// Usage: node factory/scripts/verify-mv-onboarding.mjs [--root <workspace>] [--skip-render]
//
// A fresh workspace is required; the verifier never reuses an existing project.

import {execFileSync, spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {writeOnboardingInputs} from './support/onboarding-fixture.mjs';
import {sha256} from './support/synthetic-media.mjs';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const {isInside} = require('../dist/src/workspace/guard.js');

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : fallback;
};
const hasFlag = (name) => args.includes(`--${name}`);

const rawRoot = arg('root', arg('workspace', process.env.MV_WORKSPACE_ROOT));
if (!rawRoot) {
  console.error('--root or MV_WORKSPACE_ROOT is required');
  process.exit(2);
}
const workspaceRoot = path.resolve(rawRoot);
if (isInside(repoRoot, workspaceRoot) || isInside(workspaceRoot, repoRoot)) {
  throw new Error('The onboarding workspace must be outside and must not contain the engine repository');
}

const PROJECT_ID = 'synthetic-onboarding-demo';
const projectDir = path.join(workspaceRoot, PROJECT_ID);
const rendersDir = path.join(projectDir, 'renders');
const checks = [];
const notes = [];

const record = (id, ok, detail) => {
  checks.push({id, status: ok ? 'PASS' : 'FAIL', detail});
  if (!ok) throw new Error(`${id} failed: ${detail}`);
};

const script = (name) => path.join(repoRoot, 'factory/scripts', name);
const run = (name, argv, extraEnv = {}) =>
  spawnSync(process.execPath, [script(name), ...argv], {
    cwd: repoRoot,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 256 * 1024 * 1024,
    timeout: 45 * 60 * 1000,
    env: {...process.env, MV_WORKSPACE_ROOT: workspaceRoot, ...extraEnv},
  });
const ok = (label, result) => {
  if (result.status !== 0) {
    throw new Error(`${label} exited ${result.status}\n${result.stderr}\n${result.stdout}`.slice(0, 6000));
  }
  return result.stdout;
};
const refused = (label, result, pattern) => {
  const text = `${result.stderr}\n${result.stdout}`;
  if (result.status === 0) throw new Error(`${label} unexpectedly succeeded\n${text}`);
  if (pattern && !pattern.test(text)) throw new Error(`${label} refused for the wrong reason\n${text}`);
  return text;
};
const json = (file) => JSON.parse(readFileSync(file, 'utf8'));
// Producers print progress lines (and some statuses go to stderr) before their
// final JSON document, which starts with an unindented "{" line.
const tailJson = (text) => {
  const lines = String(text ?? '').split(/\r?\n/);
  const start = lines.findLastIndex((line) => line === '{');
  if (start < 0) throw new Error(`No JSON document found in output: ${String(text).slice(-500)}`);
  return JSON.parse(lines.slice(start).join('\n'));
};
const hash = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');

const ffprobe = (file, argv) =>
  execFileSync('ffprobe', ['-v', 'error', ...argv, '-of', 'json', file], {
    encoding: 'utf8',
    windowsHide: true,
  });
const ffmpeg = (argv, options = {}) =>
  execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', ...argv], {
    encoding: 'buffer',
    windowsHide: true,
    maxBuffer: 256 * 1024 * 1024,
    ...options,
  });

// signalstats metadata is written to a file because the print filter logs at
// info level, which an error-level run suppresses.
let seriesCounter = 0;
const yavgSeries = (file, prefilter, key = 'YAVG') => {
  const name = `series-${seriesCounter++}.txt`;
  ffmpeg(
    [
      '-y',
      '-i',
      file,
      '-vf',
      `${prefilter},signalstats,metadata=print:key=lavfi.signalstats.${key}:file=${name}`,
      '-f',
      'null',
      'NUL',
    ],
    {cwd: workspaceRoot},
  );
  const text = readFileSync(path.join(workspaceRoot, name), 'utf8');
  const pattern = new RegExp(`${key}=([0-9.]+)`, 'g');
  return [...text.matchAll(pattern)].map((match) => Number(match[1]));
};

const frameCount = (file) => {
  const out = execFileSync(
    'ffmpeg',
    ['-hide_banner', '-v', 'error', '-i', file, '-map', '0:v', '-f', 'null', '-progress', '-', '-nostats', 'NUL'],
    {encoding: 'utf8', windowsHide: true},
  );
  const matches = [...String(out).matchAll(/frame=(\d+)/g)];
  return Number(matches[matches.length - 1]?.[1] ?? 0);
};

const grayPatch = (file, {frame = null, size = [64, 36]} = {}) => {
  const filters = [];
  if (frame !== null) filters.push(`select='eq(n\\,${frame})'`);
  filters.push(`scale=${size[0]}:${size[1]}`, 'format=gray');
  const argv = ['-i', file, '-vf', filters.join(','), '-frames:v', '1', '-f', 'rawvideo', '-'];
  return [...ffmpeg(argv)];
};

const meanRgb = (file, {frame = null, crop = null} = {}) => {
  const filters = [];
  if (frame !== null) filters.push(`select='eq(n\\,${frame})'`);
  if (crop) filters.push(`crop=${crop.w}:${crop.h}:${crop.x}:${crop.y}`);
  filters.push('scale=1:1', 'format=rgb24');
  return [...ffmpeg(['-i', file, '-vf', filters.join(','), '-frames:v', '1', '-f', 'rawvideo', '-'])];
};

const lumaStats = (file) => {
  const values = yavgSeries(file, 'null');
  return {min: Math.min(...values), max: Math.max(...values), mean: values.reduce((a, b) => a + b, 0) / values.length, count: values.length};
};

const frameDifferences = (file) => yavgSeries(file, 'scale=320:180,tblend=all_mode=difference');

const correlation = (a, b) => {
  let len = Math.min(a.length, b.length);
  let sumAB = 0;
  let sumAA = 0;
  let sumBB = 0;
  for (let index = 0; index < len; index++) {
    sumAB += a[index] * b[index];
    sumAA += a[index] * a[index];
    sumBB += b[index] * b[index];
  }
  return sumAB / Math.sqrt((sumAA || 1) * (sumBB || 1));
};

const pearson = (a, b) => {
  const len = Math.min(a.length, b.length);
  let sa = 0;
  let sb = 0;
  let saa = 0;
  let sbb = 0;
  let sab = 0;
  for (let index = 0; index < len; index++) {
    sa += a[index];
    sb += b[index];
    saa += a[index] * a[index];
    sbb += b[index] * b[index];
    sab += a[index] * b[index];
  }
  const numerator = sab - (sa * sb) / len;
  const denominator = Math.sqrt((saa - (sa * sa) / len) * (sbb - (sb * sb) / len));
  return numerator / (denominator || 1);
};

const decodeAudio = (file, target, extra = []) => {
  ffmpeg(['-y', '-i', file, ...extra, '-f', 's16le', '-acodec', 'pcm_s16le', '-ar', '48000', '-ac', '2', target]);
  const buffer = readFileSync(target);
  return new Int16Array(buffer.buffer, buffer.byteOffset, Math.floor(buffer.length / 2));
};

// ---------------------------------------------------------------------------

if (existsSync(projectDir)) {
  throw new Error(`Workspace ${workspaceRoot} already contains ${PROJECT_ID}; use a new disposable root`);
}
mkdirSync(workspaceRoot, {recursive: true});

// Inputs may already exist because `onboarding:seed` runs first in CI. They are
// deterministic, so the verifier regenerates the expected bytes into scratch
// space and refuses if a seeded file differs by a single byte.
const inputsDir = path.join(workspaceRoot, 'onboarding-inputs');
const scratchDir = path.join(workspaceRoot, '.onboarding-expected');
rmSync(scratchDir, {recursive: true, force: true});
const expected = writeOnboardingInputs(scratchDir);
const relativeOf = (file) => path.relative(scratchDir, file).split(path.sep).join('/');
const expectedFiles = [
  expected.score,
  expected.layer,
  expected.clip,
  expected.metadata,
  ...expected.plates.map((plate) => plate.file),
];
if (existsSync(inputsDir)) {
  for (const file of expectedFiles) {
    const relative = relativeOf(file);
    const seeded = path.join(inputsDir, relative);
    if (!existsSync(seeded) || sha256(seeded) !== sha256(file)) {
      throw new Error(`Seeded onboarding input ${relative} does not match the deterministic fixture`);
    }
  }
} else {
  cpSync(scratchDir, inputsDir, {recursive: true});
}
rmSync(scratchDir, {recursive: true, force: true});

const inputs = {
  ...expected,
  root: inputsDir,
  score: path.join(inputsDir, relativeOf(expected.score)),
  layer: path.join(inputsDir, relativeOf(expected.layer)),
  clip: path.join(inputsDir, relativeOf(expected.clip)),
  metadata: path.join(inputsDir, relativeOf(expected.metadata)),
  plates: expected.plates.map((plate) => ({...plate, file: path.join(inputsDir, relativeOf(plate.file))})),
};
notes.push(`inputs: ${inputsDir}`);

// 1. Fresh init with Unicode metadata supplied through the file path.
const initOut = ok(
  'init',
  run('mv-project.mjs', [
    'init',
    '--project', PROJECT_ID,
    '--width', '640',
    '--height', '360',
    '--fps', String(inputs.fps),
    '--audio', inputs.score,
    '--metadata-file', inputs.metadata,
  ]),
);
const init = JSON.parse(initOut);
record('INIT_OK', init.status === 'initialized' && init.output.durationInFrames === inputs.durationFrames, `${init.status} frames=${init.output?.durationInFrames}`);

const projectJsonPath = path.join(projectDir, 'project.json');
const projectJson = json(projectJsonPath);
const metadata = json(inputs.metadata);
record(
  'UNICODE_METADATA',
  projectJson.song.title === metadata.title &&
    projectJson.song.artist === metadata.artist &&
    projectJson.assets[0].source === metadata.source &&
    projectJson.assets[0].rights === metadata.rights &&
    projectJson.visual.styleProfile === metadata.styleProfile,
  `title=${JSON.stringify(projectJson.song.title)}`,
);
record('FRESH_NO_TIMELINE', Array.isArray(projectJson.chapters) && projectJson.chapters.length === 0, `chapters=${projectJson.chapters.length}`);
record(
  'AUDIO_INTEGRITY',
  projectJson.audio.sha256 === inputs.hashes.score && projectJson.audio.durationSeconds === 30,
  `${projectJson.audio.sha256.slice(0, 12)} ${projectJson.audio.durationSeconds}s`,
);
record(
  'P0_DEFAULT_DENY',
  projectJson.permissions.externalGeneration === false &&
    projectJson.permissions.localOnly === true &&
    projectJson.permissions.allowNetwork === false,
  JSON.stringify(projectJson.permissions),
);

// 2. A project without a timeline must not render.
refused(
  'render without a timeline',
  run('render-project.mjs', ['--project', PROJECT_ID, '--mode', 'video', '--frames', '0-1']),
  /chapters must not be empty/,
);
record('RENDER_REQUIRES_TIMELINE', true, 'render-project refused the empty timeline');
record('NO_OUTPUT_ON_REFUSAL', !existsSync(path.join(rendersDir, 'synthetic-onboarding-demo.mp4')), 'no output produced');

// 3. Analysis runs immediately, with no hand-edited project.json.
ok('analyze-beats', run('preproduction.mjs', ['analyze-beats', '--project', PROJECT_ID]));
const beatGrid = json(path.join(projectDir, 'preproduction', 'beat-grid.json'));
record(
  'IMMEDIATE_ANALYSIS',
  beatGrid.approval === 'unapproved' && beatGrid.beatEvents.length > 0 && beatGrid.estimatedTempo.bpm > 0,
  `bpm=${beatGrid.estimatedTempo.bpm} beats=${beatGrid.beatEvents.length} approval=${beatGrid.approval}`,
);

// 4. Manual timing, brief and plan.
const annotations = {
  schemaVersion: 1,
  projectId: PROJECT_ID,
  beatAnchors: [],
  cutCues: inputs.cutCues.map((cue, index) => ({
    id: `CUT-00${index + 1}`,
    frame: cue.frame,
    timeSeconds: Number((cue.frame / inputs.fps).toFixed(4)),
    label: `synthetic transient at ${cue.seconds}s`,
    source: 'user',
    approval: 'approved',
    notes: 'Placed on a generated pulse, so the cue is on a real transient of the fixture score.',
  })),
  sections: inputs.sections.map((section) => ({
    id: section.id,
    label: section.label,
    startFrame: section.startFrame,
    endFrame: section.endFrame,
    source: 'user',
    approval: 'approved',
    notes: `Synthetic section with a ${section.pulse}s pulse period.`,
  })),
};
writeFileSync(path.join(projectDir, 'preproduction', 'annotations.json'), `${JSON.stringify(annotations, null, 2)}\n`, 'utf8');

const imageNeeds = inputs.plates.map((plate, index) => ({
  kind: 'image',
  description: `Ordinary RGB plate ${index + 1} for the onboarding acceptance project`,
  visualStyle: 'flat synthetic colour field with one bright band',
  continuityReferences: ['synthetic onboarding plate'],
}));
const canvasDirective = (id) => ({id, renderer: 'layered-canvas', continuityIds: [], media: null});
const brief = {
  schemaVersion: 1,
  projectId: PROJECT_ID,
  source: 'user',
  approval: 'approved',
  concept: 'A synthetic onboarding fixture: eight shots, six ordinary RGB plates and one transparent layer over a generated clip.',
  narrativeMode: 'abstract',
  moodProgression: ['first light', 'the street', 'crossing', 'after'],
  visualStyle: 'flat synthetic colour fields with procedural light overlay',
  aspectRatio: '16:9',
  palette: ['#0A1020', '#3FC1C9', '#F05E7E', '#F2C14E', '#E9E3D2'],
  characters: [],
  setting: 'an abstract synthetic street of colour fields',
  continuityRules: ['Every image-backed shot keeps its own plate.', 'Overlay motion never replaces the plate.'],
  pacing: {preferredShotFrames: 130, minShotFrames: 90, maxShotFrames: 160, allowBeatCuts: false},
  cameraLanguage: ['static frame', 'slow lateral drift', 'slow push in'],
  transitions: ['hard cut on the edited cue'],
  approvedReferences: [],
  excludedElements: ['real footage', 'real songs', 'burned-in text'],
  productionConstraints: ['Synthetic media only.', 'No provider generation.'],
  preferredRenderers: ['layered-canvas'],
  rendererDirectives: [
    {
      id: 'DIR-01',
      renderer: 'hybrid',
      continuityIds: [],
      media: {
        kind: 'hybrid',
        backgroundSlot: 'BG-CLIP',
        sourceStartFrames: 0,
        fit: 'cover',
        positionX: 0.5,
        positionY: 0.5,
        scale: 1,
        layers: [
          {
            slot: 'LAYER-GLOW',
            order: 0,
            opacity: 0.9,
            fit: 'contain',
            positionX: 0.5,
            positionY: 0.5,
            scale: 1,
            visibleFromFrame: 0,
            visibleToFrame: 90,
          },
        ],
        overlay: {kind: 'orbits', intensity: 0.3, color: '#8AF0E4'},
      },
    },
    ...Array.from({length: 7}, (_, index) => canvasDirective(`DIR-0${index + 2}`)),
  ],
  requiredAssets: imageNeeds,
  assumptions: ['Synthetic fixture; no artistic approval is implied anywhere in this run.'],
};
writeFileSync(path.join(projectDir, 'preproduction', 'creative-brief.json'), `${JSON.stringify(brief, null, 2)}\n`, 'utf8');

ok('preproduction validate', run('preproduction.mjs', ['validate', '--project', PROJECT_ID]));
ok('plan', run('preproduction.mjs', ['plan', '--project', PROJECT_ID]));
const plan = json(path.join(projectDir, 'preproduction', 'director-plan.json'));
record('PLAN_SHOTS', plan.chapters.flatMap((chapter) => chapter.shots).length === 8, `shots=${plan.chapters.flatMap((chapter) => chapter.shots).length}`);
const planShots = plan.chapters.flatMap((chapter) => chapter.shots);
record('PLAN_HYBRID', planShots.filter((shot) => shot.renderer === 'hybrid').length === 1, planShots.map((shot) => `${shot.id}:${shot.renderer}`).join(' '));
ok('approve-plan', run('preproduction.mjs', ['approve-plan', '--project', PROJECT_ID, '--revision', '1']));
const storyboardOut = JSON.parse(ok('storyboard', run('preproduction.mjs', ['storyboard', '--project', PROJECT_ID])));
record('STORYBOARD_BLOCKED', storyboardOut.renderReady === false && storyboardOut.missingAssetRequirements.length > 0, `${storyboardOut.missingAssetRequirements?.length} missing`);
refused('compile while requirements are missing', run('preproduction.mjs', ['compile', '--project', PROJECT_ID]));

const requirements = json(path.join(projectDir, 'preproduction', 'storyboard.json')).assetRequirements;
const byKind = (kind) => requirements.filter((requirement) => requirement.kind === kind);
record('REQUIREMENT_MIX', byKind('image').length === 6 && byKind('video').length === 1 && byKind('layer').length === 1, requirements.map((requirement) => `${requirement.id}:${requirement.kind}`).join(' '));

// 5. Asset intake: ordinary RGB plates, one transparent layer, one clip.
const intakeDir = path.join(projectDir, 'intake');
mkdirSync(intakeDir, {recursive: true});
for (const [index, plate] of inputs.plates.entries()) {
  copyFileSync(plate.file, path.join(intakeDir, `plate-0${index + 1}.png`));
}
copyFileSync(inputs.layer, path.join(intakeDir, 'layer-01.png'));
copyFileSync(inputs.clip, path.join(intakeDir, 'clip-01.mp4'));
writeFileSync(path.join(intakeDir, 'not-an-image.txt'), 'this is not a PNG\n', 'utf8');

const attach = (requirement, assetId, relative, provenance) =>
  run('preproduction.mjs', [
    'attach-asset',
    '--project', PROJECT_ID,
    '--requirement', requirement,
    '--asset-id', assetId,
    '--path', relative,
    '--provenance', provenance,
    '--rights', 'Synthetic fixture; no third-party rights.',
  ]);

const imageRequirements = byKind('image');
for (const [index, requirement] of imageRequirements.entries()) {
  const out = JSON.parse(
    ok(`attach ${requirement.id}`, attach(requirement.id, `PLATE-0${index + 1}`, `intake/plate-0${index + 1}.png`, 'Deterministic synthetic RGB PNG generated by onboarding-fixture.mjs')),
  );
  record(
    `RGB_IMAGE_ATTACH_${index + 1}`,
    out.review === 'pending' && out.technical.hasAlpha === false && out.technical.probed === 'image',
    `${out.assetId} ${out.technical.probed} alpha=${out.technical.hasAlpha}`,
  );
}
const videoRequirement = byKind('video')[0];
ok('attach clip', attach(videoRequirement.id, 'CLIP-01', 'intake/clip-01.mp4', 'Deterministic synthetic clip with an embedded tone, generated by onboarding-fixture.mjs'));
const layerRequirement = byKind('layer')[0];
ok('attach layer', attach(layerRequirement.id, 'LAYER-01', 'intake/layer-01.png', 'Deterministic synthetic transparent PNG generated by onboarding-fixture.mjs'));

const rgbAsLayer = refused(
  'RGB PNG as transparent layer',
  attach(layerRequirement.id, 'LAYER-RGB', 'intake/plate-01.png', 'negative control'),
  /alpha PNG/,
);
record('RGB_REJECTED_AS_LAYER', true, rgbAsLayer.split(/\r?\n/).find((line) => line.includes('alpha PNG')) ?? 'alpha PNG refused');
refused(
  'non-PNG as image',
  attach(imageRequirements[0].id, 'BAD-IMAGE', 'intake/not-an-image.txt', 'negative control'),
  /not a PNG/,
);
record('NON_PNG_REJECTED', true, 'text file refused as an image');

const beforeReview = run('preproduction.mjs', ['report-assets', '--project', PROJECT_ID]);
record('INTAKE_PENDING', beforeReview.status === 2, `report-assets exit=${beforeReview.status} while pending`);
const pendingIntake = json(path.join(projectDir, 'preproduction', 'asset-intake.json'));
record('INTAKE_NOT_AUTO_APPROVED', pendingIntake.records.every((entry) => entry.review === 'pending'), `reviews=${pendingIntake.records.map((entry) => entry.review).join(',')}`);

for (const requirement of requirements) {
  ok(`review ${requirement.id}`, run('preproduction.mjs', ['review-asset', '--project', PROJECT_ID, '--requirement', requirement.id, '--decision', 'approve', '--notes', 'Synthetic fixture asset reviewed for the onboarding acceptance run.']));
}
const reviewedIntake = json(path.join(projectDir, 'preproduction', 'asset-intake.json'));
record(
  'INTAKE_APPROVED',
  reviewedIntake.records.length === 8 && reviewedIntake.records.every((entry) => entry.review === 'approved'),
  `records=${reviewedIntake.records.length} reviews=${[...new Set(reviewedIntake.records.map((entry) => entry.review))].join(',')}`,
);

const rebuilt = JSON.parse(ok('storyboard revision 2', run('preproduction.mjs', ['storyboard', '--project', PROJECT_ID, '--new-revision'])));
record('STORYBOARD_READY', rebuilt.renderReady === true && rebuilt.revision === 2, `revision=${rebuilt.revision} ready=${rebuilt.renderReady}`);
ok('approve-storyboard', run('preproduction.mjs', ['approve-storyboard', '--project', PROJECT_ID, '--revision', '2']));
const compileOut = JSON.parse(ok('compile', run('preproduction.mjs', ['compile', '--project', PROJECT_ID])));
record('COMPILE_READY', compileOut.status === 'ready', `status=${compileOut.status}`);

// 6. Browser preflight refuses before any expensive work.
const invalidBrowser = run('render-project.mjs', ['--project', PROJECT_ID, '--config', compileOut.candidatePath, '--mode', 'video', '--frames', '0-1', '--out', 'browser-refusal.mp4'], {
  REMOTION_BROWSER_EXECUTABLE: path.join(workspaceRoot, 'missing-browser', 'chrome.exe'),
});
refused('invalid browser', invalidBrowser, /BROWSER_EXECUTABLE_INVALID/);
record('BROWSER_REFUSED_EARLY', invalidBrowser.status === 3, `exit=${invalidBrowser.status}`);
record('NO_OUTPUT_ON_BROWSER_REFUSAL', !existsSync(path.join(rendersDir, 'browser-refusal.mp4')), 'no file written');

// 7. Shot preview, one targeted revision, comparison.
const previewOne = JSON.parse(ok('preview first look', run('mv-workflow.mjs', ['preview-shot', '--project', PROJECT_ID, '--shot', 'SHOT-003', '--id', 'first-look', '--profile', 'master'])));
record('PREVIEW_RENDERED', previewOne.qc.video.frames > 30 && previewOne.qc.audio.streams === 1, `${previewOne.qc.video.frames} frames`);
const motionBefore = frameDifferences(path.join(projectDir, previewOne.output.path)).reduce((a, b) => a + b, 0);

const patchFile = path.join(projectDir, 'preproduction', 'overlay-change.json');
writeFileSync(
  patchFile,
  `${JSON.stringify(
    {
      rendererParams: {background: '#0A1020', accent: '#F05E7E', secondary: '#3FC1C9', motion: 3.2, washTop: 0.04, washBottom: 0.12},
      purpose: 'Keep more of the ordinary RGB plate visible while the overlay keeps moving',
    },
    null,
    2,
  )}\n`,
  'utf8',
);
ok('edit-shot', run('mv-workflow.mjs', ['edit-shot', '--project', PROJECT_ID, '--shot', 'SHOT-003', '--revision', '2', '--new-revision', '3', '--patch', 'preproduction/overlay-change.json']));
const previewTwo = JSON.parse(ok('preview corrected', run('mv-workflow.mjs', ['preview-shot', '--project', PROJECT_ID, '--revision', '3', '--draft', '--shot', 'SHOT-003', '--id', 'corrected', '--profile', 'master'])));
const motionAfter = frameDifferences(path.join(projectDir, previewTwo.output.path)).reduce((a, b) => a + b, 0);
record('REVISION_PREVIEW', previewTwo.qc.decodedFrameDigest !== previewOne.qc.decodedFrameDigest, `${previewOne.qc.decodedFrameDigest.slice(0, 8)} -> ${previewTwo.qc.decodedFrameDigest.slice(0, 8)}`);
const comparison = JSON.parse(ok('compare', run('mv-workflow.mjs', ['compare', '--project', PROJECT_ID, '--from', 'first-look', '--to', 'corrected'])));
record('COMPARE_DISTINCT', comparison.sameOutput === false, `sameOutput=${comparison.sameOutput}`);

// The explicit low-wash revision must let more of the ordinary RGB plate through.
const previewOneFile = path.join(projectDir, previewOne.output.path);
const previewTwoFile = path.join(projectDir, previewTwo.output.path);
const shotPlate = inputs.plates[0].file;
const plateBefore = pearson(grayPatch(previewOneFile, {frame: 75}), grayPatch(shotPlate));
const plateAfter = pearson(grayPatch(previewTwoFile, {frame: 75}), grayPatch(shotPlate));
const meanOf = (values) => values.reduce((a, b) => a + b, 0) / values.length;
const satBefore = meanOf(yavgSeries(previewOneFile, 'null', 'SATAVG'));
const satAfter = meanOf(yavgSeries(previewTwoFile, 'null', 'SATAVG'));
record(
  'LOW_WASH_PRESERVES_PLATE',
  plateAfter > plateBefore && satAfter > satBefore,
  `plate correlation ${plateBefore.toFixed(2)} -> ${plateAfter.toFixed(2)}, mean saturation ${satBefore.toFixed(1)} -> ${satAfter.toFixed(1)}`,
);
ok('approve revision 3', run('mv-workflow.mjs', ['approve-revision', '--project', PROJECT_ID, '--revision', '3', '--notes', 'Technical promotion only; the low-wash overlay keeps more of the RGB plate and the audio slice is unchanged.']));

// 8. Complete render.
const produced = tailJson(ok('produce', run('produce-mv.mjs', ['--project', PROJECT_ID, '--profile', 'master', '--out', 'onboarding-master.mp4'])));
const master = path.join(rendersDir, 'onboarding-master.mp4');
record('MASTER_EXISTS', existsSync(master), `${statSync(master).size} bytes`);
const firstSha = hash(master);
const rerunResult = run('produce-mv.mjs', ['--project', PROJECT_ID, '--profile', 'master', '--out', 'onboarding-master.mp4']);
const rerun = tailJson(`${rerunResult.stdout ?? ''}\n${rerunResult.stderr ?? ''}`);
record(
  'RERENDER_IDEMPOTENT',
  rerunResult.status === 0 && rerun.status === 'ALREADY_COMPLETE' && hash(master) === firstSha,
  `status=${rerun.status} sha=${hash(master) === firstSha ? 'unchanged' : 'changed'}`,
);

// 9. Decoded inspection.
const probe = JSON.parse(ffprobe(master, ['-show_format', '-show_streams']));
const video = probe.streams.find((stream) => stream.codec_type === 'video');
const audio = probe.streams.filter((stream) => stream.codec_type === 'audio');
record('CODEC', video.codec_name === 'h264' && video.pix_fmt === 'yuv420p', `${video.codec_name}/${video.pix_fmt}`);
record('DIMENSIONS', video.width === 640 && video.height === 360, `${video.width}x${video.height}`);
record('FRAME_RATE', video.r_frame_rate === '30/1' && video.avg_frame_rate === '30/1', `${video.r_frame_rate}/${video.avg_frame_rate}`);
record('FRAME_COUNT', (video.nb_frames === undefined || Number(video.nb_frames) === 900) && frameCount(master) === 900, `nb_frames=${video.nb_frames} decoded=${frameCount(master)}`);
record('DURATION', Math.abs(Number(probe.format.duration) - 30) < 0.05, `${probe.format.duration}s`);
record('SINGLE_AUDIO', audio.length === 1 && audio[0].codec_name === 'aac' && Math.abs(Number(audio[0].duration) - 30) < 0.1, `${audio.length} stream(s) ${audio[0]?.codec_name}`);

const mixPath = path.join(projectDir, 'cache', 'audio-mix', `${PROJECT_ID}-mix.wav`);
const masterAudio = decodeAudio(master, path.join(workspaceRoot, 'master-audio.raw'));
const mixAudio = decodeAudio(mixPath, path.join(workspaceRoot, 'mix-audio.raw'));
const corr = correlation(masterAudio, mixAudio);
record('AUDIO_SYNC', corr > 0.99, `correlation=${corr.toFixed(6)} vs the project PCM mix`);

const luma = lumaStats(master);
record('NO_BLACK_GAPS', luma.min > 8 && luma.count === 900, `min=${luma.min.toFixed(1)} frames=${luma.count}`);

const diffs = frameDifferences(master);
const boundaries = [90, 180, 330, 480, 600, 720, 810];
const boundaryDiffs = boundaries.map((frame) => diffs[frame - 1]);
const sorted = [...diffs.map((value, index) => ({value, frame: index + 1}))].sort((a, b) => b.value - a.value);
const topFrames = sorted.slice(0, boundaries.length).map((entry) => entry.frame).sort((a, b) => a - b);
record('SHOT_BOUNDARIES', boundaries.every((frame) => diffs[frame - 1] !== undefined) && boundaryDiffs.every((value) => value > 4), `boundary diffs ${boundaryDiffs.map((value) => value.toFixed(1)).join(',')}`);
const nonBoundaryMax = Math.max(...diffs.map((value, index) => (boundaries.includes(index + 1) ? 0 : value)));
record('IN_SHOT_MOTION', nonBoundaryMax < Math.min(...boundaryDiffs), `max off-boundary ${nonBoundaryMax.toFixed(2)} vs min boundary ${Math.min(...boundaryDiffs).toFixed(2)}`);
notes.push(`top frame-difference peaks: ${topFrames.join(',')}`);

// Ordinary RGB plate contribution: each image shot's midpoint vs its own plate.
const shotMidpoints = [
  {shot: 'SHOT-003', frame: 255, plate: inputs.plates[0].file},
  {shot: 'SHOT-004', frame: 405, plate: inputs.plates[1].file},
  {shot: 'SHOT-005', frame: 540, plate: inputs.plates[2].file},
  {shot: 'SHOT-006', frame: 660, plate: inputs.plates[3].file},
  {shot: 'SHOT-007', frame: 765, plate: inputs.plates[4].file},
  {shot: 'SHOT-008', frame: 855, plate: inputs.plates[5].file},
];
const plateCorrelations = shotMidpoints.map((entry) => ({
  shot: entry.shot,
  r: pearson(grayPatch(master, {frame: entry.frame}), grayPatch(entry.plate)),
}));
const weakest = plateCorrelations.reduce((a, b) => (a.r < b.r ? a : b));
record('RGB_PLATE_VISIBLE', plateCorrelations.every((entry) => entry.r > 0.3), plateCorrelations.map((entry) => `${entry.shot}:${entry.r.toFixed(2)}`).join(' '));
notes.push(`plate correlation: ${plateCorrelations.map((entry) => `${entry.shot}=${entry.r.toFixed(2)}`).join(' ')} (weakest ${weakest.shot})`);

// Transparent layer contribution inside the hybrid shot.
const clipFrame = path.join(workspaceRoot, 'clip-frame.png');
ffmpeg(['-y', '-i', inputs.clip, '-vf', "select='eq(n\\,45)'", '-frames:v', '1', clipFrame]);
const centre = {x: 260, y: 140, w: 120, h: 80};
const masterCentre = meanRgb(master, {frame: 45, crop: centre});
const clipCentre = meanRgb(clipFrame, {crop: centre});
const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const layerColour = [40, 240, 220];
record(
  'LAYER_CONTRIBUTION',
  distance(masterCentre, layerColour) < distance(clipCentre, layerColour),
  `master centre rgb=${masterCentre.join(',')} clip centre rgb=${clipCentre.join(',')}; distance to layer colour ${distance(masterCentre, layerColour).toFixed(0)} vs ${distance(clipCentre, layerColour).toFixed(0)}`,
);

// Original sources are untouched.
const unchanged =
  hash(inputs.score) === inputs.hashes.score &&
  hash(inputs.layer) === inputs.hashes.layer &&
  hash(inputs.clip) === inputs.hashes.clip &&
  inputs.plates.every((plate) => hash(plate.file) === plate.sha256) &&
  hash(inputs.metadata) === inputs.hashes.metadata;
record('SOURCE_IMMUTABLE', unchanged, 'all generated inputs keep their original hash');

const providerText = readFileSync(path.join(projectDir, 'project.json'), 'utf8');
record('NO_PROVIDER', /"externalGeneration":\s*false/.test(providerText) && /"allowNetwork":\s*false/.test(providerText), 'project permissions unchanged');

const report = {
  status: 'PASS',
  projectId: PROJECT_ID,
  workspaceRoot,
  master: path.relative(workspaceRoot, master).split(path.sep).join('/'),
  masterSha256: hash(master),
  masterBytes: statSync(master).size,
  frames: frameCount(master),
  durationSeconds: Number(probe.format.duration),
  audioCorrelation: corr,
  luma,
  boundaries,
  plateCorrelations,
  layer: {masterCentre, clipCentre},
  motion: {before: motionBefore, after: motionAfter},
  checks,
  notes,
  verdict: 'Synthetic onboarding acceptance only. Technical evidence, not artistic approval.',
};
writeFileSync(path.join(workspaceRoot, 'onboarding-acceptance.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(report, null, 2));