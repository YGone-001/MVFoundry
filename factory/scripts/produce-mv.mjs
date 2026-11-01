// Complete-music-video production orchestration.
//
// Composes the accepted services rather than reimplementing them: it validates
// the project, checks that every requirement already has a reviewed approved
// asset, compiles the approved storyboard, renders the full duration through
// the existing render CLI, then inspects the real output before calling
// anything complete.
//
// This command is project-independent. It knows nothing about a project's id,
// shot identities, requirement ids or media filenames, and it never approves
// an asset, asserts rights, substitutes a file or generates anything.
//
// Usage:
//   npm run mv:produce -- --project my-song
//   node factory/scripts/produce-mv.mjs --project <id> --workspace <root> \
//     [--profile master|ci] [--rerender] [--retry N] [--out <name>]
//
// Synthetic fixture staging is NOT part of the production path. The Signal
// Garden rehearsal passes --stage-fixture-assets explicitly; a normal project
// supplies its assets through the handoff workflow and a human review.
//
// Nothing here contacts a provider, spends credits or writes project.json.

import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync, readFileSync, statSync, writeFileSync} from 'node:fs';
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
const hasFlag = (name) => args.includes(`--${name}`);
const projectId = arg('project');
const workspaceRoot = arg('workspace', process.env.MV_WORKSPACE_ROOT);
const profile = arg('profile', 'master');
const retries = Number(arg('retry', '1'));
if (!projectId) {
  console.error('--project is required');
  process.exit(2);
}
if (!workspaceRoot) {
  console.error('MV_WORKSPACE_ROOT or --workspace is required');
  process.exit(2);
}
if (!['master', 'ci'].includes(profile)) {
  console.error('--profile must be master or ci');
  process.exit(2);
}

const {loadProject} = require('../dist/src/project/loadProject.js');
const {sha256File} = require('../dist/src/media/hash.js');
const {createProjectWriteBoundary, ensureSafeDirectory, assertSafePath} = require('../dist/src/workspace/writeBoundary.js');
const {PREPRODUCTION_PATHS, readOptionalProjectJson, writeProjectJson} = require('../dist/src/preproduction/store.js');

const log = (message) => console.error(`[mv] ${message}`);
const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
const sha = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');

const project = loadProject(projectId, {workspaceRoot, engineRoot: repoRoot});
const boundary = createProjectWriteBoundary(project, {engineRoot: repoRoot});
const startedAt = new Date().toISOString();

// ---------------------------------------------------------------------------
// 1. Validate the approved audio and duration
// ---------------------------------------------------------------------------

const audioAbsolute = project.audioPath;
const audioSha = sha256File(audioAbsolute);
if (audioSha !== project.config.audio.sha256) {
  throw new Error(`Audio hash mismatch: project.json declares ${project.config.audio.sha256}, file is ${audioSha}`);
}
if (Math.abs(project.audioMetadata.decodedDurationSeconds - project.config.audio.durationSeconds) > 0.02) {
  throw new Error(
    `Decoded audio duration ${project.audioMetadata.decodedDurationSeconds}s does not match the declared ${project.config.audio.durationSeconds}s`,
  );
}
log(`audio ok: ${project.config.audio.durationSeconds}s ${audioSha.slice(0, 12)}`);

// ---------------------------------------------------------------------------
// 2. Optional synthetic fixture staging (explicit opt-in only)
// ---------------------------------------------------------------------------
//
// The Signal Garden acceptance script calls this. A normal production run
// never does: the default path only reads the project's real state and refuses
// when something is missing or awaiting review.

let assetResult = null;
if (hasFlag('stage-fixture-assets')) {
  const {stageAssets} = await import('./support/mv-assets.mjs');
  log('fixture asset staging requested explicitly (synthetic acceptance only)');
  assetResult = stageAssets({
    engineRoot: repoRoot,
    workspaceRoot,
    projectDir: project.projectDir,
    projectId,
    log,
  });
  log(`fixture assets staged: ${assetResult.requirements} requirements, ${assetResult.rejected.length} rejected`);
}

// ---------------------------------------------------------------------------
// 3. Validate the approved storyboard and every bound asset
// ---------------------------------------------------------------------------

const blocked = (stage, blockers) => {
  console.error(JSON.stringify({
    status: 'BLOCKED',
    projectId,
    stage,
    blockers,
    note: 'Production refuses to proceed. Resolve every blocker explicitly; nothing is substituted automatically.',
  }, null, 2));
  process.exit(3);
};

const storyboardPath = path.join(project.projectDir, PREPRODUCTION_PATHS.storyboard);
if (!existsSync(storyboardPath)) {
  blocked('storyboard', ['no storyboard exists for this project; run the preproduction planning chain first']);
}
const storyboard = readJson(storyboardPath);
if (storyboard.status !== 'approved') {
  blocked('storyboard', [`storyboard revision ${storyboard.revision} is ${storyboard.status}; an approved storyboard is required`]);
}
const requirements = storyboard.assetRequirements ?? [];
const intake = readOptionalProjectJson(project.projectDir, PREPRODUCTION_PATHS.assetIntake);
const intakeRecords = intake?.records ?? [];
const assetChecks = [];
const blockers = [];
for (const requirement of requirements) {
  const record = intakeRecords.find((entry) => entry.requirementId === requirement.id);
  if (!record) {
    blockers.push(`requirement ${requirement.id} (${requirement.kind}) has no intake record: supply an asset and review it`);
    continue;
  }
  if (record.review !== 'approved') {
    blockers.push(`requirement ${requirement.id} intake is ${record.review}; only reviewed approved assets may render`);
    continue;
  }
  if (record.fingerprint !== requirement.fingerprint) {
    blockers.push(`requirement ${requirement.id} is stale: its fingerprint changed after intake`);
    continue;
  }
  const absolutePath = path.join(project.projectDir, record.path);
  if (!existsSync(absolutePath)) {
    blockers.push(`bound asset for ${requirement.id} is missing: ${record.path}`);
    continue;
  }
  const current = sha256File(absolutePath);
  if (current !== record.sha256) {
    blockers.push(`bound asset for ${requirement.id} changed on disk: expected ${record.sha256}, found ${current}`);
    continue;
  }
  assetChecks.push({
    requirementId: requirement.id,
    shotId: requirement.shotIds[0],
    kind: requirement.kind,
    assetId: record.assetId,
    path: record.path,
    sha256: record.sha256,
    review: record.review,
    rights: record.rights,
    provenance: record.provenance,
  });
}
if (blockers.length > 0) {
  blocked('assets', blockers);
}
log(`storyboard r${storyboard.revision} approved with ${requirements.length} verified assets`);

// ---------------------------------------------------------------------------
// 4. Compile the render-ready candidate
// ---------------------------------------------------------------------------

const compile = execFileSync(
  process.execPath,
  [path.join(repoRoot, 'factory', 'scripts', 'preproduction.mjs'), 'compile', '--project', projectId, '--workspace', workspaceRoot],
  {encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, windowsHide: true},
);
const compileReport = JSON.parse(compile.slice(compile.indexOf('{')));
if (compileReport.status !== 'ready') {
  throw new Error(`Compile is ${compileReport.status}; the project is not render-ready`);
}
let candidatePath = compileReport.candidatePath;
log(`compiled candidate: ${candidatePath}`);

// ---------------------------------------------------------------------------
// 5. Select the output profile
// ---------------------------------------------------------------------------

const masterWidth = project.config.output.width;
const masterHeight = project.config.output.height;
let renderWidth = masterWidth;
let renderHeight = masterHeight;
let outputName = arg('out', `${projectId}-master.mp4`);

if (profile === 'ci' && masterWidth > 640) {
  // Documented CI profile: identical storyboard, fps and frame count at half
  // resolution. Only the resolution changes, and it is recorded in the evidence.
  const candidate = readJson(path.join(project.projectDir, candidatePath));
  const scale = 0.5;
  candidate.output.width = Math.round(masterWidth * scale / 2) * 2;
  candidate.output.height = Math.round(masterHeight * scale / 2) * 2;
  if (candidate.visual?.pixel) {
    candidate.visual.pixel.internalWidth = Math.max(8, Math.round(candidate.visual.pixel.internalWidth * scale));
    candidate.visual.pixel.internalHeight = Math.max(8, Math.round(candidate.visual.pixel.internalHeight * scale));
  }
  const ciRelative = 'preproduction/project-candidate-ci.json';
  writeProjectJson(boundary, ciRelative, candidate);
  candidatePath = ciRelative;
  renderWidth = candidate.output.width;
  renderHeight = candidate.output.height;
  outputName = arg('out', `${projectId}-ci-master.mp4`);
}
log(`profile ${profile}: ${renderWidth}x${renderHeight} @ ${project.config.output.fps}fps, ${project.durationInFrames} frames`);

// ---------------------------------------------------------------------------
// 5b. Production idempotency: never silently overwrite an accepted output
// ---------------------------------------------------------------------------

const outputAbsolute = path.join(project.projectDir, 'renders', outputName);
const evidenceNameFor = profile === 'ci' ? 'production-evidence-ci.json' : 'production-evidence.json';
const existingEvidencePath = path.join(project.projectDir, 'reports', evidenceNameFor);
if (existsSync(outputAbsolute) && existsSync(existingEvidencePath) && !hasFlag('rerender')) {
  const previous = readJson(existingEvidencePath);
  const sameRevision = previous.storyboard?.revision === storyboard.revision;
  const previousHashes = (previous.assets ?? []).map((entry) => `${entry.requirementId}:${entry.sha256}`).sort();
  const currentHashes = assetChecks.map((entry) => `${entry.requirementId}:${entry.sha256}`).sort();
  const sameAssets = JSON.stringify(previousHashes) === JSON.stringify(currentHashes);
  if (sameRevision && sameAssets) {
    console.error(JSON.stringify({
      status: 'ALREADY_COMPLETE',
      projectId,
      output: previous.output,
      storyboardRevision: previous.storyboard?.revision,
      note: 'An accepted output already exists for this storyboard revision and these exact asset hashes. Pass --rerender to replace it, or a new storyboard revision to change it.',
      provenance: {evidence: `reports/${evidenceNameFor}`, sha256: previous.output?.sha256 ?? null},
    }, null, 2));
    process.exit(0);
  }
  log('existing output is stale (storyboard or asset hashes changed); a fresh render will replace it');
}

// ---------------------------------------------------------------------------
// 6. Render the full duration through the accepted render CLI
// ---------------------------------------------------------------------------

const renderArgs = [
  path.join(repoRoot, 'factory', 'scripts', 'render-project.mjs'),
  '--project', projectId,
  '--workspace', workspaceRoot,
  '--config', candidatePath,
  '--mode', 'video',
  '--frames', `0-${project.durationInFrames - 1}`,
  '--out', outputName,
];

let renderExit = 0;
let renderError = null;
let attempt = 0;
for (attempt = 1; attempt <= Math.max(1, retries); attempt++) {
  try {
    log(`render attempt ${attempt}/${Math.max(1, retries)}`);
    execFileSync(process.execPath, renderArgs, {stdio: 'inherit', windowsHide: true, timeout: 3 * 60 * 60 * 1000});
    renderExit = 0;
    renderError = null;
    break;
  } catch (error) {
    renderExit = error.status ?? 1;
    renderError = `${error.message}`;
    log(`render attempt ${attempt} failed with exit ${renderExit}`);
  }
}
if (renderExit !== 0) {
  throw new Error(`Full render failed after ${attempt} attempt(s): ${renderError}`);
}

// ---------------------------------------------------------------------------
// 7. Inspect the actual output — an exit code is not acceptance
// ---------------------------------------------------------------------------

if (!existsSync(outputAbsolute)) throw new Error(`Render reported success but ${outputName} is missing`);
const probe = JSON.parse(
  execFileSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', outputAbsolute], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true,
  }),
);
const video = (probe.streams ?? []).find((stream) => stream.codec_type === 'video');
const audioStreams = (probe.streams ?? []).filter((stream) => stream.codec_type === 'audio');
const audio = audioStreams[0];
const expectedFrames = project.durationInFrames;
const expectedSeconds = expectedFrames / project.config.output.fps;
const problems = [];
if (!video) problems.push('no video stream');
if (video && video.codec_name !== 'h264') problems.push(`video codec is ${video.codec_name}`);
if (video && video.pix_fmt !== 'yuv420p') problems.push(`pixel format is ${video.pix_fmt}`);
if (video && (video.width !== renderWidth || video.height !== renderHeight)) {
  problems.push(`dimensions ${video.width}x${video.height} do not match ${renderWidth}x${renderHeight}`);
}
if (video && video.r_frame_rate !== `${project.config.output.fps}/1`) {
  problems.push(`frame rate is ${video.r_frame_rate}`);
}
if (video && Number(video.nb_frames) !== expectedFrames) {
  problems.push(`frame count is ${video.nb_frames}, expected ${expectedFrames}`);
}
if (audioStreams.length !== 1) problems.push(`${audioStreams.length} audio streams, expected exactly 1`);
if (audio && audio.codec_name !== 'aac') problems.push(`audio codec is ${audio.codec_name}`);
const declaredDuration = Number(probe.format?.duration ?? 0);
if (Math.abs(declaredDuration - expectedSeconds) > 0.15) {
  problems.push(`container duration ${declaredDuration}s is not ${expectedSeconds}s`);
}
const outputBytes = statSync(outputAbsolute).size;
if (outputBytes < 100_000) problems.push(`output is only ${outputBytes} bytes`);

if (problems.length > 0) {
  throw new Error(`Rendered output failed inspection: ${problems.join('; ')}`);
}

// ---------------------------------------------------------------------------
// 8. Record project-local production evidence
// ---------------------------------------------------------------------------

const shotTable = (readJson(path.join(project.projectDir, candidatePath)).chapters ?? []).flatMap((chapter) =>
  (chapter.shots ?? []).map((shot) => ({
    id: shot.id,
    chapterId: chapter.id,
    startFrame: shot.startFrame,
    endFrame: shot.endFrame,
    renderer: shot.renderer,
    mediaKind: shot.media?.kind ?? null,
    assetId: shot.media?.assetId ?? null,
    muted: shot.media?.muted ?? null,
  })),
);

const evidence = {
  schemaVersion: 1,
  projectId,
  profile,
  startedAt,
  finishedAt: new Date().toISOString(),
  audio: {
    path: project.config.audio.path,
    sha256: audioSha,
    declaredDurationSeconds: project.config.audio.durationSeconds,
    decodedDurationSeconds: project.audioMetadata.decodedDurationSeconds,
    sampleRate: project.audioMetadata.sampleRate,
  },
  storyboard: {revision: storyboard.revision, status: storyboard.status, shots: shotTable.length, requirements: requirements.length},
  candidate: candidatePath,
  assets: assetChecks,
  assetRejections: assetResult?.rejected ?? [],
  shotTable,
  output: {
    path: `renders/${outputName}`,
    bytes: outputBytes,
    sha256: sha(outputAbsolute),
    video: video
      ? {codec: video.codec_name, pixelFormat: video.pix_fmt, width: video.width, height: video.height, frameRate: video.r_frame_rate, frames: Number(video.nb_frames)}
      : null,
    audio: audio ? {codec: audio.codec_name, sampleRate: Number(audio.sample_rate), channels: audio.channels, streams: audioStreams.length} : null,
    containerDurationSeconds: declaredDuration,
  },
  expectations: {
    frames: expectedFrames,
    seconds: expectedSeconds,
    width: renderWidth,
    height: renderHeight,
    fps: project.config.output.fps,
    masterWidth,
    masterHeight,
    profileNote:
      profile === 'ci'
        ? 'Documented CI profile: identical approved storyboard, fps and frame count at half resolution.'
        : 'Master profile: project.json output dimensions.',
  },
  providerActivity: {
    liveProviderExecution: 'NOT_GRANTED',
    providerRequests: 0,
    pilotAdmissionsConsumed: 0,
    note: 'Assets were produced by the deterministic offline provider or generated locally. No network request was made.',
  },
  inspectedBy: 'factory/scripts/produce-mv.mjs',
  verdict: 'TECHNICAL ACCEPTANCE ONLY',
};

const reportsDir = ensureSafeDirectory(boundary, path.join(boundary.projectRoot, 'reports'), 'project');
const evidencePath = assertSafePath(boundary, path.join(reportsDir, evidenceNameFor), {expect: 'file', subtree: 'project'});
writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);

console.log(JSON.stringify({
  projectId,
  profile,
  output: evidence.output,
  storyboardRevision: evidence.storyboard.revision,
  shots: shotTable.length,
  assets: assetChecks.length,
  rejectedAssets: evidence.assetRejections.length,
  evidence: path.relative(project.projectDir, evidencePath).split(path.sep).join('/'),
  verdict: evidence.verdict,
  note: 'Technical acceptance only. Artistic quality is a separate human decision.',
}, null, 2));
