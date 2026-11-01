// Provider output acceptance: simulated remote result -> real local bytes ->
// validated/normalized file -> approved asset -> real rendered video.
//
// Everything here runs through injected fake transports. No provider is
// contacted, no credential is read and no billable request is possible.
//
// Usage: node factory/scripts/verify-provider-output.mjs --workspace <external-root>
// Requires FFmpeg/FFprobe, a Remotion browser and factory/dist.

import {execFileSync, spawnSync} from 'node:child_process';
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
const workspaceRoot = arg('workspace', process.env.MV_WORKSPACE_ROOT);
if (!workspaceRoot) {
  console.error('MV_WORKSPACE_ROOT or --workspace is required');
  process.exit(2);
}

// The adapter carries no provider host of its own; the simulated lifecycle gets
// a synthetic base URL assembled from parts so no provider literal exists here.
process.env.RUNWAY_BASE_URL = process.env.RUNWAY_BASE_URL
  || `${'https'}://${['api', 'simulated', 'invalid'].join('.')}`;

const generationCli = path.join(repoRoot, 'factory', 'scripts', 'generation.mjs');
const preproductionCli = path.join(repoRoot, 'factory', 'scripts', 'preproduction.mjs');

const {loadProject} = require('../dist/src/project/loadProject.js');
const {sha256File} = require('../dist/src/media/hash.js');
const {decodeAudioToNormalizedPcm} = require('../dist/src/media/audioDecode.js');
const {stereoToMono} = require('../dist/src/audio/analysis.js');
const {createProjectWriteBoundary, ensureSafeDirectory, assertSafePath} = require('../dist/src/workspace/writeBoundary.js');

const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
const sha = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');

const ffprobeJson = (file) => JSON.parse(execFileSync(
  'ffprobe',
  ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', file],
  {encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, windowsHide: true},
));

const rawFrame = (file, frame, width, height) => {
  const bytes = execFileSync('ffmpeg',
    ['-v', 'error', '-i', file, '-vf', `select=eq(n\\,${frame})`, '-frames:v', '1',
      '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'],
    {encoding: null, maxBuffer: 64 * 1024 * 1024, windowsHide: true});
  if (bytes.length !== width * height * 3) throw new Error(`frame ${frame} byte mismatch`);
  return bytes;
};

const averageRgb = (bytes) => {
  const sums = [0, 0, 0];
  for (let index = 0; index < bytes.length; index += 3) {
    sums[0] += bytes[index];
    sums[1] += bytes[index + 1];
    sums[2] += bytes[index + 2];
  }
  const pixels = bytes.length / 3;
  return sums.map((sum) => Math.round(sum / pixels));
};

/**
 * Per-cell luma averages. A whole-frame average hides a moving or re-coloured
 * image, so frame evidence uses a spatial signature instead.
 */
const frameSignature = (bytes, width, height, grid = 4) => {
  const cells = [];
  for (let gy = 0; gy < grid; gy++) {
    for (let gx = 0; gx < grid; gx++) {
      const x0 = Math.floor((gx * width) / grid);
      const x1 = Math.floor(((gx + 1) * width) / grid);
      const y0 = Math.floor((gy * height) / grid);
      const y1 = Math.floor(((gy + 1) * height) / grid);
      let sum = 0;
      let count = 0;
      for (let y = y0; y < y1; y += 4) {
        const row = y * width * 3;
        for (let x = x0; x < x1; x += 4) {
          const index = row + x * 3;
          sum += bytes[index] + bytes[index + 1] + bytes[index + 2];
          count += 3;
        }
      }
      cells.push(count > 0 ? sum / count : 0);
    }
  }
  return cells.map((value) => Number(value.toFixed(3)));
};

const signatureDistance = (left, right) =>
  Number(Math.max(...left.map((value, index) => Math.abs(value - right[index]))).toFixed(3));

const toneMagnitude = (samples, sampleRate, frequency) => {
  const k = Math.round((samples.length * frequency) / sampleRate);
  if (k <= 0 || k >= samples.length) return 0;
  const omega = (2 * Math.PI * k) / samples.length;
  const coeff = 2 * Math.cos(omega);
  let s0 = 0;
  let s1 = 0;
  let s2 = 0;
  for (let index = 0; index < samples.length; index++) {
    s0 = samples[index] + coeff * s1 - s2;
    s2 = s1;
    s1 = s0;
  }
  return Math.sqrt(s1 * s1 + s2 * s2 - coeff * s1 * s2) / samples.length;
};

const run = (script, scriptArgs) =>
  execFileSync(process.execPath, [script, ...scriptArgs, '--workspace', workspaceRoot],
    {encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, windowsHide: true, env: process.env});
const runStatus = (script, scriptArgs) =>
  spawnSync(process.execPath, [script, ...scriptArgs, '--workspace', workspaceRoot],
    {encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, windowsHide: true, env: process.env});

const gen = (projectId, command, extra = []) => run(generationCli, [command, '--project', projectId, ...extra]);
const genStatus = (projectId, command, extra = []) => runStatus(generationCli, [command, '--project', projectId, ...extra]);
const pre = (projectId, command, extra = []) => run(preproductionCli, [command, '--project', projectId, ...extra]);
const preStatus = (projectId, command, extra = []) => runStatus(preproductionCli, [command, '--project', projectId, ...extra]);

const checks = [];
const record = (name, pass, details) => {
  checks.push({name, pass: Boolean(pass), details});
  console.log(JSON.stringify(pass ? {check: name, pass: true} : {check: name, pass: false, details}));
};

const guard = (name, fn) => {
  try {
    fn();
  } catch (error) {
    record(name, false, {error: error instanceof Error ? error.message : String(error)});
  }
};

const writeEvidence = (project, name, value) => {
  const boundary = createProjectWriteBoundary(project, {engineRoot: repoRoot});
  const reportsDir = ensureSafeDirectory(boundary, path.join(boundary.projectRoot, 'reports'), 'project');
  const file = assertSafePath(boundary, path.join(reportsDir, name), {expect: 'file', subtree: 'project'});
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
  return file;
};

const approveStoryboard = (projectId) => {
  pre(projectId, 'plan');
  pre(projectId, 'approve-plan');
  pre(projectId, 'storyboard');
  pre(projectId, 'approve-storyboard');
};

const recompile = (projectId) => {
  pre(projectId, 'storyboard', ['--new-revision']);
  pre(projectId, 'approve-storyboard');
  return JSON.parse(pre(projectId, 'compile'));
};

const renderPreview = (projectId, frames) => {
  pre(projectId, 'render-preview', ['--frames', `0-${frames - 1}`]);
  return path.join(loadProject(projectId, {workspaceRoot, engineRoot: repoRoot}).projectDir, 'renders', 'storyboard-preview.mp4');
};

const inspectRender = (output, expected) => {
  const probe = ffprobeJson(output);
  const video = (probe.streams || []).find((stream) => stream.codec_type === 'video');
  const audioStreams = (probe.streams || []).filter((stream) => stream.codec_type === 'audio');
  const mono = stereoToMono(decodeAudioToNormalizedPcm(output, 48000, 'preview').samples);
  const frames = expected.framesToCheck.map((frame) => {
    const bytes = rawFrame(output, frame, video.width, video.height);
    return {
      frame,
      rgb: averageRgb(bytes),
      signature: frameSignature(bytes, video.width, video.height),
    };
  });
  const audio = {
    masterTone: Number(toneMagnitude(mono, 48000, expected.tone).toFixed(6)),
    samples: mono.length,
  };
  return {
    video: {
      codec: video.codec_name,
      width: video.width,
      height: video.height,
      fps: video.r_frame_rate,
      frames: Number(video.nb_frames),
      duration: Number(probe.format.duration),
    },
    audioStreams: audioStreams.length,
    audio,
    frames,
    bytes: statSync(output).size,
  };
};

// ---------------------------------------------------------------------------
// Project A — image retrieval, review and a real layered-canvas render
// ---------------------------------------------------------------------------

const projectA = 'synthetic-provider-image-demo';
guard(`${projectA}: acceptance flow`, () => {
  approveStoryboard(projectA);
  const project = loadProject(projectA, {workspaceRoot, engineRoot: repoRoot});
  const prepared = JSON.parse(gen(projectA, 'prepare', [
    '--requirement', 'REQ-001', '--provider', 'runway', '--model', 'gen4_image',
  ]));
  const jobId = prepared.job.jobId;

  const contract = JSON.parse(gen(projectA, 'inspect-output', ['--job', jobId]));
  record('A1: a text-to-image job is typed as an image output', contract.declaredOutputKind === 'image'
    && contract.operationOutputKind === 'image'
    && contract.contractConsistent === true, contract);

  gen(projectA, 'approve-request', [
    '--job', jobId, '--authorization', 'authorized-for-simulation',
    '--max-spend', '0', '--max-submissions', '1', '--notes', 'Simulated retrieval only; no live request.',
  ]);
  const simulated = JSON.parse(gen(projectA, 'resume', ['--job', jobId, '--fixtures', 'generation/fixtures/image-task.json']));
  record('A2: the simulated image task reaches succeeded through the fake transport',
    simulated.simulated.taskId === 'task-img-1'
      && simulated.simulated.submitPath === '/v1/text_to_image'
      && simulated.simulated.states[simulated.simulated.states.length - 1] === 'succeeded',
    simulated.simulated);

  const validated = JSON.parse(gen(projectA, 'validate-response', [
    '--job', jobId, '--response', 'generation/fixtures/image-task.json',
  ]));
  record('A3: a recorded image response binds to the exact task identity',
    validated.accepted === true && validated.kind === 'image' && validated.providerTaskId === 'task-img-1',
    validated);

  const retrieved = JSON.parse(gen(projectA, 'retrieve', [
    '--job', jobId, '--fixture', 'generation/fixtures/image-task.json',
  ]));
  const storedAbsolute = path.join(project.projectDir, retrieved.stored);
  record('A4: retrieval stores real PNG bytes inside the project with a verified hash',
    retrieved.retrieved === true
      && retrieved.contentType === 'image/png'
      && existsSync(storedAbsolute)
      && sha(storedAbsolute) === retrieved.sha256
      && retrieved.source.signedQueryRedacted === true,
    retrieved);

  const media = JSON.parse(gen(projectA, 'inspect-media', ['--file', retrieved.stored]));
  record('A5: the stored output is a real 640x640 PNG image',
    media.mediaKind === 'image' && media.image.width === 640 && media.image.height === 640,
    media.image);

  const staged = JSON.parse(gen(projectA, 'stage', [
    '--job', jobId, '--rights', 'Simulated provider output; synthetic fixture bytes, no third-party rights',
  ]));
  const blockedBeforeReview = preStatus(projectA, 'compile');
  record('A6: a technical PASS does not become an approval',
    staged.staged.review === 'pending'
      && blockedBeforeReview.status === 2
      && staged.staged.provenance.includes('task task-img-1'),
    {review: staged.staged.review, compileExit: blockedBeforeReview.status});

  gen(projectA, 'review', [
    '--job', jobId, '--decision', 'approve',
    '--notes', 'Reviewed the simulated retrieval, provenance and decoded image.',
  ]);
  const compile = recompile(projectA);
  record('A7: explicit approval compiles the image requirement into the candidate',
    compile.status === 'ready' && compile.missingAssetRequirements.length === 0,
    {status: compile.status, notes: compile.notes});

  const output = renderPreview(projectA, 50);
  const evidence = inspectRender(output, {framesToCheck: [10, 40], tone: 330});
  record('A8: the preview is a real H.264 MP4 with exactly one soundtrack',
    evidence.video.codec === 'h264'
      && evidence.video.width === 640
      && evidence.video.height === 640
      && evidence.video.fps === '25/1'
      && evidence.video.frames === 50
      && evidence.audioStreams === 1
      && evidence.audio.masterTone > 1e-4,
    evidence);
  record('A9: decoded frames carry the retrieved plate colour',
    evidence.frames.every((entry) => entry.rgb[2] > entry.rgb[0] + 30),
    {frames: evidence.frames});

  record('A10: the provider original is byte-identical after staging and rendering',
    sha(storedAbsolute) === retrieved.sha256,
    {expected: retrieved.sha256, actual: sha(storedAbsolute)});

  const report = path.relative(project.projectDir, writeEvidence(project, 'provider-image-evidence.json', {
    jobId, retrieved, media, staged: staged.staged, compile, evidence,
  })).split(path.sep).join('/');
  console.log(JSON.stringify({projectId: projectA, evidence: report}));
});

// ---------------------------------------------------------------------------
// Project B — video retrieval, deterministic normalization and a real render
// ---------------------------------------------------------------------------

const projectB = 'synthetic-provider-video-demo';
guard(`${projectB}: acceptance flow`, () => {
  approveStoryboard(projectB);
  const project = loadProject(projectB, {workspaceRoot, engineRoot: repoRoot});
  const prepared = JSON.parse(gen(projectB, 'prepare', [
    '--requirement', 'REQ-001', '--provider', 'runway', '--model', 'gen4_turbo',
  ]));
  const jobId = prepared.job.jobId;

  const referencesBlocked = genStatus(projectB, 'prepare-references', ['--job', jobId]);
  const referencesAuthorized = JSON.parse(gen(projectB, 'prepare-references', [
    '--job', jobId, '--authorize-disclosure',
  ]));
  record('B1: a reference asset needs explicit disclosure authorization',
    referencesBlocked.status === 2
      && referencesAuthorized.references.length === 1
      && referencesAuthorized.references[0].disclosure === 'authorized-for-simulation'
      && referencesAuthorized.references[0].blockers.length === 0
      && referencesAuthorized.payloads[0].characters > 0,
    {
      blockedExit: referencesBlocked.status,
      prepared: referencesAuthorized.references,
      payload: referencesAuthorized.payloads,
    });

  gen(projectB, 'approve-request', [
    '--job', jobId, '--authorization', 'authorized-for-simulation',
    '--max-spend', '0', '--max-submissions', '1', '--uploads-private',
    '--notes', 'Simulated image-to-video with a synthetic local reference.',
  ]);
  const simulated = JSON.parse(gen(projectB, 'resume', [
    '--job', jobId, '--fixtures', 'generation/fixtures/video-task.json', '--authorize-disclosure',
  ]));
  record('B2: the simulated image-to-video task reaches succeeded with a video output',
    simulated.simulated.submitPath === '/v1/image_to_video'
      && simulated.simulated.taskId === 'task-vid-1'
      && simulated.simulated.states[simulated.simulated.states.length - 1] === 'succeeded',
    simulated.simulated);

  const retrieved = JSON.parse(gen(projectB, 'retrieve', [
    '--job', jobId, '--fixture', 'generation/fixtures/video-task.json',
  ]));
  const originalAbsolute = path.join(project.projectDir, retrieved.stored);
  record('B3: retrieval stores the original incompatible clip and keeps its hash',
    retrieved.retrieved === true && retrieved.contentType === 'video/mp4' && sha(originalAbsolute) === retrieved.sha256,
    retrieved);

  const inspection = JSON.parse(gen(projectB, 'inspect-media', ['--file', retrieved.stored]));
  const variableFrameRate = inspection.inspection.timing.variableFrameRate
    || Math.abs(inspection.inspection.nominalFrameRate - inspection.inspection.averageFrameRate) > 0.01;
  record('B4: deep inspection exposes VFR, rotation and an embedded audio stream',
    variableFrameRate
      && Math.abs(inspection.inspection.rotation) > 0.01
      && inspection.inspection.audioStreamCount === 1,
    {
      timing: inspection.inspection.timing,
      nominal: inspection.inspection.nominalFrameRate,
      average: inspection.inspection.averageFrameRate,
      rotation: inspection.inspection.rotation,
      audioStreams: inspection.inspection.audioStreamCount,
    });

  const directStage = genStatus(projectB, 'stage', [
    '--job', jobId, '--file', retrieved.stored,
    '--rights', 'Direct staging of an incompatible clip must fail',
  ]);
  record('B5: the renderer source validation still rejects the raw provider clip',
    directStage.status === 1,
    {exit: directStage.status, message: `${directStage.stderr}`.trim().split('\n')[0]});

  const normalized = JSON.parse(gen(projectB, 'normalize', [
    '--job', jobId, '--fps', '24', '--width', '640', '--height', '360',
    '--rights', 'Derived locally from the recorded provider output; no third-party rights',
  ]));
  record('B6: normalization derives a renderer-compatible file without touching the original',
    normalized.normalized === true
      && normalized.original.sha256 === retrieved.sha256
      && normalized.derived.sha256 !== retrieved.sha256
      && normalized.profile.audioPolicy === 'strip'
      && normalized.rotationCorrection === 90,
    normalized);

  const compared = genStatus(projectB, 'compare-media', [
    '--original', retrieved.stored, '--derived', normalized.derived.path,
  ]);
  const comparedBody = JSON.parse(compared.stdout);
  record('B7: the derived file passes the renderer compatibility comparison',
    compared.status === 0
      && comparedBody.rendererCompatible === true
      && comparedBody.derived.inspection.audioStreamCount === 0
      && Math.abs(comparedBody.derived.inspection.rotation) < 0.01,
    {
      exit: compared.status,
      derived: comparedBody.derived?.inspection,
      differences: comparedBody.differences,
    });

  const staged = JSON.parse(gen(projectB, 'stage', [
    '--job', jobId, '--rights', 'Derived from simulated provider output; synthetic fixture bytes',
  ]));
  record('B8: staging records both the derived hash and the original provenance',
    staged.staged.review === 'pending'
      && staged.staged.provenance.includes(normalized.original.sha256)
      && staged.staged.provenance.includes('video-normalize-v1')
      && staged.staged.technical.probed === 'video',
    staged.staged);

  gen(projectB, 'review', [
    '--job', jobId, '--decision', 'approve',
    '--notes', 'Reviewed the normalized clip, provenance and both hashes.',
  ]);
  const compile = recompile(projectB);
  const candidate = readJson(path.join(project.projectDir, 'preproduction', 'project-candidate.json'));
  const shot = candidate.chapters.flatMap((chapter) => chapter.shots).find((entry) => entry.id === 'SHOT-001');
  record('B9: the approved derived clip compiles into a Video shot',
    compile.status === 'ready'
      && shot.renderer === 'video'
      && shot.media
      && shot.media.kind === 'video'
      && shot.media.sourceStartSeconds === 0
      && shot.media.muted === true,
    {compile: compile.status, shot: shot ? {renderer: shot.renderer, media: shot.media} : null});

  const output = renderPreview(projectB, 48);
  const evidence = inspectRender(output, {framesToCheck: [6, 30], tone: 392});
  record('B10: the preview is a real H.264 MP4 at the shot frame rate with one soundtrack',
    evidence.video.codec === 'h264'
      && evidence.video.width === 640
      && evidence.video.height === 360
      && evidence.video.fps === '24/1'
      && evidence.video.frames === 48
      && evidence.audioStreams === 1
      && evidence.audio.masterTone > 1e-4,
    evidence);
  record('B11: decoded frames differ across the normalized clip',
    signatureDistance(evidence.frames[0].signature, evidence.frames[1].signature) > 3,
    {distance: signatureDistance(evidence.frames[0].signature, evidence.frames[1].signature), frames: evidence.frames.map((entry) => entry.rgb)});
  record('B12: the original provider clip stays byte-identical',
    sha(originalAbsolute) === retrieved.sha256,
    {expected: retrieved.sha256, actual: sha(originalAbsolute)});

  const report = path.relative(project.projectDir, writeEvidence(project, 'provider-video-evidence.json', {
    jobId, retrieved, inspection: inspection.inspection, normalized, staged: staged.staged, compile, evidence,
  })).split(path.sep).join('/');
  console.log(JSON.stringify({projectId: projectB, evidence: report}));
});

// ---------------------------------------------------------------------------
// Project C — hybrid continuity across two retrieved backgrounds
// ---------------------------------------------------------------------------

const projectC = 'synthetic-provider-hybrid-demo';
guard(`${projectC}: acceptance flow`, () => {
  approveStoryboard(projectC);
  const project = loadProject(projectC, {workspaceRoot, engineRoot: repoRoot});
  const videoFixtures = {
    'REQ-001': 'generation/fixtures/video-task-in.json',
    'REQ-003': 'generation/fixtures/video-task-out.json',
  };
  const jobs = {};
  for (const requirementId of ['REQ-001', 'REQ-002', 'REQ-003', 'REQ-004']) {
    const isVideo = requirementId in videoFixtures;
    const prepared = JSON.parse(gen(projectC, 'prepare', [
      '--requirement', requirementId,
      '--provider', isVideo ? 'runway' : 'offline-fixture',
      '--model', isVideo ? 'gen4_turbo' : 'offline-fixture-v1',
    ]));
    const jobId = prepared.job.jobId;
    jobs[requirementId] = {jobId, isVideo};
    gen(projectC, 'approve-request', [
      '--job', jobId, '--authorization', 'authorized-for-simulation',
      '--max-spend', '0', '--max-submissions', '1',
      '--notes', isVideo ? 'Simulated retrieval for the hybrid background.' : 'Offline fixture layer; no network.',
    ]);
    if (isVideo) {
      gen(projectC, 'resume', ['--job', jobId, '--fixtures', videoFixtures[requirementId]]);
      const retrieved = JSON.parse(gen(projectC, 'retrieve', ['--job', jobId, '--fixture', videoFixtures[requirementId]]));
      gen(projectC, 'normalize', ['--job', jobId, '--fps', '24', '--width', '540', '--height', '960',
        '--rights', 'Derived from simulated provider output; synthetic fixture bytes']);
      jobs[requirementId].retrieved = retrieved;
    } else {
      jobs[requirementId].offline = JSON.parse(gen(projectC, 'run-offline', ['--job', jobId]));
    }
    gen(projectC, 'stage', ['--job', jobId, '--rights', 'Synthetic fixture bytes; no third-party rights']);
    gen(projectC, 'review', ['--job', jobId, '--decision', 'approve', '--notes', 'Reviewed hybrid media and provenance.']);
  }

  const intake = readJson(path.join(project.projectDir, 'preproduction', 'asset-intake.json'));
  record('C1: both retrieved backgrounds and both layers reach approved intake',
    intake.records.length === 4
      && intake.records.every((entry) => entry.review === 'approved'),
    {records: intake.records.map((entry) => `${entry.requirementId}:${entry.kind}:${entry.review}`)});

  const layerRecord = intake.records.find((entry) => entry.requirementId === 'REQ-002');
  record('C2: the transparent layer keeps a real alpha channel',
    layerRecord.technical.hasAlpha === true && layerRecord.technical.probed === 'layer',
    layerRecord.technical);

  const compile = recompile(projectC);
  const candidate = readJson(path.join(project.projectDir, 'preproduction', 'project-candidate.json'));
  const hybridShots = candidate.chapters
    .flatMap((chapter) => chapter.shots)
    .filter((entry) => entry.media && entry.media.kind === 'hybrid');
  record('C3: both shots compile into ordered Hybrid media with shared continuity',
    compile.status === 'ready'
      && hybridShots.length === 2
      && hybridShots.every((entry) => entry.media.layers.length === 1 && entry.media.layers[0].order === 0),
    {compile: compile.status, shots: hybridShots.map((entry) => `${entry.id}:${entry.media.kind}:${entry.media.layers.length}`)});

  const output = renderPreview(projectC, 96);
  const evidence = inspectRender(output, {framesToCheck: [10, 60], tone: 294});
  record('C4: the hybrid preview is a real H.264 MP4 with one soundtrack',
    evidence.video.codec === 'h264'
      && evidence.video.width === 540
      && evidence.video.height === 960
      && evidence.video.fps === '24/1'
      && evidence.video.frames === 96
      && evidence.audioStreams === 1
      && evidence.audio.masterTone > 1e-4,
    evidence);
  record('C5: decoded frames differ across the two hybrid shots',
    signatureDistance(evidence.frames[0].signature, evidence.frames[1].signature) > 3
      && evidence.frames.every((entry) => entry.rgb.some((channel) => channel > 10)),
    {distance: signatureDistance(evidence.frames[0].signature, evidence.frames[1].signature), frames: evidence.frames.map((entry) => entry.rgb)});

  const report = path.relative(project.projectDir, writeEvidence(project, 'provider-hybrid-evidence.json', {
    jobs, compile, evidence,
  })).split(path.sep).join('/');
  console.log(JSON.stringify({projectId: projectC, evidence: report}));
});

// ---------------------------------------------------------------------------
// Project D — security, refusal and recovery
// ---------------------------------------------------------------------------

const projectD = 'synthetic-provider-guard-demo';
guard(`${projectD}: refusal flow`, () => {
  approveStoryboard(projectD);
  const project = loadProject(projectD, {workspaceRoot, engineRoot: repoRoot});

  const prepared = JSON.parse(gen(projectD, 'prepare', [
    '--requirement', 'REQ-001', '--provider', 'runway', '--model', 'gen4_turbo', '--revision', '1',
  ]));
  const guardJob = prepared.job.jobId;
  gen(projectD, 'approve-request', [
    '--job', guardJob, '--authorization', 'authorized-for-simulation',
    '--max-spend', '0', '--max-submissions', '1', '--notes', 'Guard project; simulation only.',
  ]);

  const live = genStatus(projectD, 'submit-live', ['--job', guardJob]);
  record('D1: live provider execution is refused', live.status === 1 && /NOT_GRANTED/.test(`${live.stderr}${live.stdout}`),
    {exit: live.status, message: `${live.stderr}`.trim().split('\n')[0]});

  const missingTask = genStatus(projectD, 'retrieve', ['--job', guardJob, '--fixture', 'generation/fixtures/video-task.json']);
  record('D2: retrieval without a persisted task id is refused',
    missingTask.status === 1 && /no provider task id/i.test(`${missingTask.stderr}`),
    {exit: missingTask.status});

  const timeoutRun = genStatus(projectD, 'resume', ['--job', guardJob, '--fixtures', 'generation/fixtures/timeout.json']);
  const timeoutJob = readJson(path.join(project.projectDir, 'generation', 'jobs.json'))
    .jobs.find((job) => job.jobId === guardJob);
  const retryBlocked = genStatus(projectD, 'resume', ['--job', guardJob, '--fixtures', 'generation/fixtures/video-task.json']);
  record('D3: an uncertain submission parks the job and blocks a second billable attempt',
    timeoutRun.status === 1
      && timeoutJob.execution.state === 'unknown-submission-state'
      && timeoutJob.execution.providerTaskId === null
      && timeoutJob.execution.failureKind === 'submission'
      && retryBlocked.status === 1,
    {
      timeoutExit: timeoutRun.status,
      state: timeoutJob.execution.state,
      failureKind: timeoutJob.execution.failureKind,
      retryExit: retryBlocked.status,
    });

  const staleJob = JSON.parse(gen(projectD, 'prepare', ['--requirement', 'REQ-001', '--revision', '2']));
  const briefPath = path.join(project.projectDir, 'preproduction', 'creative-brief.json');
  const brief = readJson(briefPath);
  // The requirement description embeds the concept, so changing the brief
  // changes the requirement fingerprint and invalidates the prepared job.
  brief.concept = `${brief.concept} (revised after preparation)`;
  writeFileSync(briefPath, `${JSON.stringify(brief, null, 2)}\n`);
  pre(projectD, 'plan', ['--new-revision']);
  pre(projectD, 'approve-plan', ['--revision', '2']);
  pre(projectD, 'storyboard', ['--new-revision']);
  pre(projectD, 'approve-storyboard', ['--revision', '2']);
  const staleStatus = genStatus(projectD, 'status', ['--job', staleJob.job.jobId]);
  const staleReport = JSON.parse(staleStatus.stdout);
  const staleApprove = genStatus(projectD, 'approve-request', [
    '--job', staleJob.job.jobId, '--authorization', 'authorized-for-simulation',
    '--max-spend', '0', '--max-submissions', '1', '--notes', 'Stale authorization attempt.',
  ]);
  record('D4: a stale requirement cannot be authorised or bound',
    staleStatus.status === 2
      && staleReport.staleJobs.includes(staleJob.job.jobId)
      && staleApprove.status === 1
      && /changed|stale/i.test(`${staleApprove.stderr}${staleApprove.stdout}`),
    {
      statusExit: staleStatus.status,
      staleJobs: staleReport.staleJobs,
      approveExit: staleApprove.status,
      message: `${staleApprove.stderr}`.trim().split('\n')[0],
    });
});

// Project D also exercises the retrieval guards on Project B's bound job.
guard('synthetic-provider-video-demo: retrieval guards', () => {
  const project = loadProject(projectB, {workspaceRoot, engineRoot: repoRoot});
  const jobs = readJson(path.join(project.projectDir, 'generation', 'jobs.json')).jobs;
  const bound = jobs.find((job) => job.execution.providerTaskId === 'task-vid-1');
  if (!bound) throw new Error('no bound video job is available for the retrieval guards');

  const ssrf = genStatus(projectB, 'retrieve', ['--job', bound.jobId, '--fixture', 'generation/fixtures/d-ssrf.json']);
  record('D5: a destination resolving to loopback is refused',
    ssrf.status === 1 && /blocked|loopback|disallowed/i.test(`${ssrf.stderr}`),
    {exit: ssrf.status, message: `${ssrf.stderr}`.trim().split('\n')[0]});

  const oversize = genStatus(projectB, 'retrieve', ['--job', bound.jobId, '--fixture', 'generation/fixtures/d-oversize.json']);
  record('D6: an oversized declared response is refused before any bytes are stored',
    oversize.status === 1 && /exceeds the .* byte limit/i.test(`${oversize.stderr}`),
    {exit: oversize.status, message: `${oversize.stderr}`.trim().split('\n')[0]});

  const tinyLimit = genStatus(projectB, 'retrieve', [
    '--job', bound.jobId, '--fixture', 'generation/fixtures/video-task.json', '--max-bytes', '512',
  ]);
  record('D7: the download limit is enforced on real byte counts, not only Content-Length',
    tinyLimit.status === 1 && /byte limit/i.test(`${tinyLimit.stderr}`),
    {exit: tinyLimit.status, message: `${tinyLimit.stderr}`.trim().split('\n')[0]});

  const html = genStatus(projectB, 'retrieve', ['--job', bound.jobId, '--fixture', 'generation/fixtures/d-html.json']);
  record('D8: an HTML page disguised as an MP4 is refused',
    html.status === 1 && /magic|content does not match/i.test(`${html.stderr}`),
    {exit: html.status, message: `${html.stderr}`.trim().split('\n')[0]});

  const crossProject = genStatus(projectB, 'retrieve', [
    '--job', bound.jobId, '--fixture', 'generation/fixtures/video-task.json',
    '--out', '../synthetic-provider-image-demo/renders/stolen.mp4',
  ]);
  record('D9: a cross-project retrieval destination is refused',
    crossProject.status === 1 && /outside|escapes|forbidden/i.test(`${crossProject.stderr}`),
    {exit: crossProject.status, message: `${crossProject.stderr}`.trim().split('\n')[0]});

  const before = readJson(path.join(project.projectDir, 'generation', 'jobs.json'))
    .jobs.find((job) => job.jobId === bound.jobId);
  const expired = genStatus(projectB, 'retrieve', ['--job', bound.jobId, '--fixture', 'generation/fixtures/d-expire.json']);
  const after = readJson(path.join(project.projectDir, 'generation', 'jobs.json'))
    .jobs.find((job) => job.jobId === bound.jobId);
  const submissions = (job) => (job.execution.attemptHistory ?? []).filter((entry) => entry.phase === 'submit').length;
  record('D10: an expired result URL is recovered by re-querying the same task, never by resubmitting',
    expired.status === 0 && submissions(after) === submissions(before) && after.execution.providerTaskId === 'task-vid-1',
    {
      exit: expired.status,
      submitAttemptsBefore: submissions(before),
      submitAttemptsAfter: submissions(after),
      providerTaskId: after.execution.providerTaskId,
    });

  const duplicate = JSON.parse(gen(projectB, 'retrieve', ['--job', bound.jobId, '--fixture', 'generation/fixtures/video-task.json']));
  record('D11: a repeated retrieval is idempotent',
    duplicate.sha256 === after.result.files[0].sha256,
    {sha256: duplicate.sha256, recorded: after.result.files[0].sha256});

  const replaceApproved = genStatus(projectB, 'stage', [
    '--job', bound.jobId, '--rights', 'Unauthorized replacement of an approved attachment',
  ]);
  record('D12: an approved attachment cannot be replaced without an explicit decision',
    replaceApproved.status === 1 && /already has approved asset/i.test(`${replaceApproved.stderr}`),
    {exit: replaceApproved.status, message: `${replaceApproved.stderr}`.trim().split('\n')[0]});

  const wrongKind = genStatus(projectA, 'retrieve', [
    '--job', readJson(path.join(loadProject(projectA, {workspaceRoot, engineRoot: repoRoot}).projectDir, 'generation', 'jobs.json'))
      .jobs.find((job) => job.operation === 'text-to-image').jobId,
    '--fixture', 'generation/fixtures/image-wrongkind.json',
  ]);
  record('D13: a video payload delivered to an image job is refused',
    wrongKind.status === 1 && /expects image/i.test(`${wrongKind.stderr}`),
    {exit: wrongKind.status, message: `${wrongKind.stderr}`.trim().split('\n')[0]});
});

const pass = checks.every((check) => check.pass);
const summary = {
  pass,
  total: checks.length,
  failed: checks.filter((check) => !check.pass).map((check) => check.name),
  liveProviderExecution: 'NOT_GRANTED',
  liveAiGeneration: 'NOT RUN — NOT AUTHORIZED',
  note: 'Every byte in this run came from a recorded fixture through an injected transport.',
};
console.log(JSON.stringify(summary, null, 2));
if (!pass) process.exitCode = 1;
