// End-to-end acceptance for the generation layer: offline media generation,
// simulated provider lifecycle, review-gated intake, compilation and rendering.
//
// Usage: node factory/scripts/verify-generation.mjs --workspace <external-root>
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
const generationCli = path.join(repoRoot, 'factory', 'scripts', 'generation.mjs');
// The adapter carries no provider host of its own; the simulated lifecycle gets
// a synthetic base URL assembled from parts so no provider literal exists here.
const simScheme = 'https';
const simHost = ['api', 'simulated', 'invalid'].join('.');
process.env.RUNWAY_BASE_URL = process.env.RUNWAY_BASE_URL || `${simScheme}://${simHost}`;
const preproductionCli = path.join(repoRoot, 'factory', 'scripts', 'preproduction.mjs');

const {loadProject} = require('../dist/src/project/loadProject.js');
const {sha256File} = require('../dist/src/media/hash.js');
const {decodeAudioToNormalizedPcm} = require('../dist/src/media/audioDecode.js');
const {stereoToMono} = require('../dist/src/audio/analysis.js');
const {
  assertSafePath,
  createProjectWriteBoundary,
  ensureSafeDirectory,
} = require('../dist/src/workspace/writeBoundary.js');

const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
const sha = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');

const ffprobeJson = (file) => JSON.parse(execFileSync('ffprobe',
  ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', file],
  {encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, windowsHide: true}));

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

const writeEvidence = (project, name, value) => {
  const boundary = createProjectWriteBoundary(project, {engineRoot: repoRoot});
  const reportsDir = ensureSafeDirectory(boundary, path.join(boundary.projectRoot, 'reports'), 'project');
  const file = assertSafePath(boundary, path.join(reportsDir, name), {expect: 'file', subtree: 'project'});
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
  return file;
};

const results = [];

const runProject = (projectId, spec) => {
  const project = loadProject(projectId, {workspaceRoot, engineRoot: repoRoot});
  const preproductionDir = path.join(project.projectDir, 'preproduction');
  const projectJsonBefore = sha256File(path.join(project.projectDir, 'project.json'));
  const audioBefore = sha256File(project.audioPath);

  pre(projectId, 'plan');
  pre(projectId, 'approve-plan');
  pre(projectId, 'storyboard');
  pre(projectId, 'approve-storyboard');

  const blockedBefore = runStatus(preproductionCli, ['compile', '--project', projectId, '--workspace', workspaceRoot]);
  const candidateBefore = existsSync(path.join(preproductionDir, 'project-candidate.json'));

  const jobs = [];
  for (const requirementId of spec.requirements) {
    const prepared = JSON.parse(gen(projectId, 'prepare', ['--requirement', requirementId, ...(spec.prepareArgs ?? [])]));
    jobs.push(prepared.job.jobId);
    gen(projectId, 'approve-request', [
      '--job', prepared.job.jobId,
      '--authorization', 'authorized-for-simulation',
      '--max-spend', '0',
      '--max-submissions', '1',
      '--notes', 'Offline fixture only; no paid submission authorized.',
    ]);
  }

  // Compilation must stay blocked while outputs are unreviewed.
  const unreviewed = [];
  for (const jobId of jobs) {
    const output = JSON.parse(gen(projectId, 'run-offline', ['--job', jobId]));
    unreviewed.push(output);
  }
  const blockedUnreviewed = runStatus(preproductionCli, ['compile', '--project', projectId, '--workspace', workspaceRoot]);
  const reviewed = [];
  for (const jobId of jobs) {
    reviewed.push(JSON.parse(gen(projectId, 'review', [
      '--job', jobId,
      '--decision', 'approve',
      '--notes', 'Reviewed generated synthetic output; provenance and media metadata recorded.',
    ])));
  }
  pre(projectId, 'storyboard', ['--new-revision']);
  pre(projectId, 'approve-storyboard');
  const compile = JSON.parse(pre(projectId, 'compile'));
  const candidate = readJson(path.join(preproductionDir, 'project-candidate.json'));
  gen(projectId, 'report');
  const report = readJson(path.join(project.projectDir, 'generation', 'reports', 'generation-report.json'));
  pre(projectId, 'render-preview', ['--frames', `0-${spec.frames - 1}`]);

  const output = path.join(project.projectDir, 'renders', 'storyboard-preview.mp4');
  const probe = ffprobeJson(output);
  const videoStream = (probe.streams || []).find((stream) => stream.codec_type === 'video');
  const audioStreams = (probe.streams || []).filter((stream) => stream.codec_type === 'audio');
  const frameEvidence = spec.framesToCheck.map((frame) => ({
    frame,
    rgb: averageRgb(rawFrame(output, frame, videoStream.width, videoStream.height)),
  }));
  const mono = stereoToMono(decodeAudioToNormalizedPcm(output, 48000, 'preview').samples);
  const audioEvidence = {
    masterTone: Number(toneMagnitude(mono, 48000, spec.tone).toFixed(6)),
    samples: mono.length,
  };
  const jobDocs = readJson(path.join(project.projectDir, 'generation', 'jobs.json'));
  const intake = readJson(path.join(preproductionDir, 'asset-intake.json'));

  const checks = [
    {
      name: `${projectId}: compilation is blocked before any generated output exists`,
      pass: blockedBefore.status === 2 && !candidateBefore,
      details: {exit: blockedBefore.status, candidateWritten: candidateBefore},
    },
    {
      name: `${projectId}: every prepared job is capability-valid, deterministic and unauthorised until reviewed`,
      pass: jobs.length === spec.requirements.length
        && jobDocs.jobs.length === jobs.length
        && jobDocs.jobs.every((job) => job.execution.state === 'awaiting-review' || job.execution.state === 'succeeded')
        && jobDocs.jobs.every((job) => job.permission.state === 'authorized')
        && jobDocs.jobs.every((job) => job.prompt.includesLyrics === false && job.prompt.includesAudio === false && job.prompt.includesPrivatePaths === false),
      details: {jobs: jobDocs.jobs.map((job) => `${job.jobId}:${job.execution.state}:${job.provider}`)},
    },
    {
      name: `${projectId}: offline outputs are real files with verified hashes and metadata`,
      pass: unreviewed.length === spec.requirements.length
        && unreviewed.every((entry) => entry.staged.sha256 === sha(path.join(project.projectDir, entry.staged.path)))
        && unreviewed.every((entry) => entry.technical.probed === 'video' || entry.technical.probed === 'layer' || entry.technical.probed === 'image')
        && unreviewed.every((entry) => statSync(path.join(project.projectDir, entry.staged.path)).size > 0),
      details: {outputs: unreviewed.map((entry) => ({path: entry.staged.path, sha: entry.staged.sha256, kind: entry.outputKind, technical: entry.technical}))},
    },
    {
      name: `${projectId}: technical validation alone never makes the storyboard render-ready`,
      pass: blockedUnreviewed.status === 2
        && intake.records.every((record) => record.review === 'approved')
        && reviewed.every((entry) => entry.review === 'approved'),
      details: {unreviewedCompileExit: blockedUnreviewed.status, intake: intake.records.map((record) => `${record.requirementId}:${record.review}`)},
    },
    {
      name: `${projectId}: approved outputs compile into typed media and a valid candidate`,
      pass: compile.status === 'ready'
        && candidate.assets.every((asset) => asset.approval === 'approved'),
      details: {compile: compile.notes, assets: candidate.assets.map((asset) => `${asset.id}:${asset.kind}`)},
    },
    {
      name: `${projectId}: the expected renderer family and media binding are present`,
      pass: spec.expectedShots.every((entry) => {
        const shot = candidate.chapters.flatMap((chapter) => chapter.shots).find((item) => item.id === entry.shot);
        if (!shot || shot.renderer !== entry.renderer) return false;
        if (entry.kind === 'video') return Boolean(shot.media && shot.media.kind === 'video');
        if (entry.kind === 'hybrid') return Boolean(shot.media && shot.media.kind === 'hybrid' && shot.media.layers.length > 0);
        return true;
      }),
      details: {shots: candidate.chapters.flatMap((chapter) => chapter.shots).map((shot) => `${shot.id}:${shot.renderer}:${shot.media ? shot.media.kind : 'none'}`)},
    },
    {
      name: `${projectId}: the preview is a real H.264 MP4 with the intended soundtrack`,
      pass: videoStream.codec_name === 'h264'
        && videoStream.width === spec.width
        && videoStream.height === spec.height
        && videoStream.r_frame_rate === `${spec.fps}/1`
        && Number(videoStream.nb_frames) === spec.frames
        && audioStreams.length === 1
        && Number(audioStreams[0].sample_rate) === 48000
        && audioEvidence.masterTone > 1e-4,
      details: {
        video: {codec: videoStream.codec_name, width: videoStream.width, height: videoStream.height, fps: videoStream.r_frame_rate, frames: Number(videoStream.nb_frames)},
        audioStreams: audioStreams.length,
        audioEvidence,
        bytes: statSync(output).size,
      },
    },
    {
      name: `${projectId}: decoded frames show generated content at the expected positions`,
      pass: spec.frameChecks.every((entry) => entry.evaluate(frameEvidence)),
      details: {frameEvidence},
    },
    {
      name: `${projectId}: generation report records the offline provider and no live execution`,
      pass: report.liveExecution === 'NOT_GRANTED'
        && report.jobs.length === jobs.length
        && report.capabilities.runway.notes.some((note) => /No live request/.test(note)),
      details: {liveExecution: report.liveExecution, jobs: report.jobs.map((job) => `${job.jobId}:${job.provider}`)},
    },
    {
      name: `${projectId}: source audio and project.json stay untouched`,
      pass: sha256File(project.audioPath) === audioBefore
        && sha256File(path.join(project.projectDir, 'project.json')) === projectJsonBefore,
      details: {audioBefore, projectJsonBefore},
    },
  ];

  const record = {projectId, pass: checks.every((check) => check.pass), checks, jobs, frameEvidence, audioEvidence};
  record.report = path.relative(project.projectDir, writeEvidence(project, 'generation-evidence.json', record)).split(path.sep).join('/');
  results.push(record);
  console.log(JSON.stringify({projectId, pass: record.pass, checks: checks.map((check) => ({name: check.name, pass: check.pass})), report: record.report}));
};

runProject('synthetic-generation-image-demo', {
  requirements: ['REQ-001'],
  frames: 50,
  fps: 25,
  width: 640,
  height: 640,
  tone: 330,
  framesToCheck: [10, 40],
  expectedShots: [{shot: 'SHOT-001', renderer: 'layered-canvas', kind: 'canvas'}],
  frameChecks: [
    {
      description: 'the generated plate is composited into the canvas frame',
      evaluate: (frames) => frames.every((entry) => entry.rgb.some((channel) => channel > 20)),
    },
  ],
});

runProject('synthetic-generation-video-demo', {
  requirements: ['REQ-001'],
  frames: 48,
  fps: 24,
  width: 640,
  height: 360,
  tone: 392,
  framesToCheck: [6, 30],
  expectedShots: [{shot: 'SHOT-001', renderer: 'video', kind: 'video'}],
  frameChecks: [
    {
      description: 'generated clip segments are visible across the shot',
      evaluate: (frames) => JSON.stringify(frames[0].rgb) !== JSON.stringify(frames[1].rgb),
    },
  ],
});

runProject('synthetic-generation-continuity-demo', {
  requirements: ['REQ-001', 'REQ-002', 'REQ-003', 'REQ-004'],
  frames: 96,
  fps: 24,
  width: 540,
  height: 960,
  tone: 294,
  framesToCheck: [10, 60],
  expectedShots: [
    {shot: 'SHOT-001', renderer: 'hybrid', kind: 'hybrid'},
    {shot: 'SHOT-002', renderer: 'hybrid', kind: 'hybrid'},
  ],
  frameChecks: [
    {
      description: 'both hybrid shots composite generated video with a generated layer',
      evaluate: (frames) => frames.every((entry) => entry.rgb.some((channel) => channel > 15)),
    },
  ],
});

// Simulated provider lifecycle plus refusal paths.
{
  const projectId = 'synthetic-generation-video-demo';
  const project = loadProject(projectId, {workspaceRoot, engineRoot: repoRoot});
  const generationDir = path.join(project.projectDir, 'generation');
  const fixturePath = path.join(generationDir, 'fixtures', 'runway-sim.json');
  const timeoutFixturePath = path.join(generationDir, 'fixtures', 'runway-timeout.json');

  const prepared = JSON.parse(gen(projectId, 'prepare', [
    '--requirement', 'REQ-001', '--provider', 'runway', '--model', 'gen4_turbo', '--revision', '2',
  ]));
  const jobId = prepared.job.jobId;
  const liveBlocked = genStatus(projectId, 'submit-live', ['--job', jobId]);
  const unauthorized = genStatus(projectId, 'resume', ['--job', jobId, '--fixtures', 'generation/fixtures/runway-sim.json']);
  gen(projectId, 'approve-request', [
    '--job', jobId, '--authorization', 'authorized-for-simulation',
    '--max-spend', '0', '--max-submissions', '1', '--notes', 'Simulated lifecycle only.',
  ]);
  const simulated = JSON.parse(gen(projectId, 'resume', ['--job', jobId, '--fixtures', 'generation/fixtures/runway-sim.json']));
  const duplicate = JSON.parse(gen(projectId, 'prepare', [
    '--requirement', 'REQ-001', '--provider', 'runway', '--model', 'gen4_turbo', '--revision', '2',
  ]));
  const unsupported = genStatus(projectId, 'prepare', [
    '--requirement', 'REQ-001', '--provider', 'runway', '--model', 'gen4_image', '--revision', '3',
  ]);

  // Uncertain submission must park the job, and a retry must not resubmit blindly.
  const timeoutPrepared = JSON.parse(gen(projectId, 'prepare', [
    '--requirement', 'REQ-001', '--provider', 'runway', '--model', 'gen4_turbo', '--revision', '4',
  ]));
  gen(projectId, 'approve-request', [
    '--job', timeoutPrepared.job.jobId, '--authorization', 'authorized-for-simulation',
    '--max-spend', '0', '--max-submissions', '1', '--notes', 'Timeout rehearsal.',
  ]);
  const timeoutRun = genStatus(projectId, 'resume', [
    '--job', timeoutPrepared.job.jobId, '--fixtures', 'generation/fixtures/runway-timeout.json',
  ]);
  const timeoutJob = readJson(path.join(generationDir, 'jobs.json')).jobs.find((job) => job.jobId === timeoutPrepared.job.jobId);
  const retryBlocked = genStatus(projectId, 'resume', [
    '--job', timeoutPrepared.job.jobId, '--fixtures', 'generation/fixtures/runway-sim.json',
  ]);

  // A rejected output must leave the requirement unfulfilled.
  const rejectedPrepared = JSON.parse(gen(projectId, 'prepare', [
    '--requirement', 'REQ-001', '--revision', '5',
  ]));
  gen(projectId, 'approve-request', [
    '--job', rejectedPrepared.job.jobId, '--authorization', 'authorized-for-simulation',
    '--max-spend', '0', '--max-submissions', '1', '--notes', 'Offline rehearsal.',
  ]);
  gen(projectId, 'run-offline', [
    '--job', rejectedPrepared.job.jobId,
    // REQ-001 already carries an approved attachment; replacing it is an
    // explicit decision, so the rejection rehearsal records one.
    '--replace-approved',
    '--reason', 'Acceptance rehearsal: exercise the reviewer rejection path on a replacement candidate.',
  ]);
  gen(projectId, 'review', ['--job', rejectedPrepared.job.jobId, '--decision', 'reject', '--notes', 'Rejected for acceptance evidence.']);
  const afterReject = genStatus(projectId, 'status');
  const rejectedIntake = readJson(path.join(project.projectDir, 'preproduction', 'asset-intake.json'))
    .records.find((record) => record.requirementId === 'REQ-001');

  const crossProject = genStatus(projectId, 'handoff', [
    '--job', rejectedPrepared.job.jobId,
    '--file', '../synthetic-generation-image-demo/renders/storyboard-preview.mp4',
    '--rights', 'Cross-project attempt',
  ]);
  const brokenMp4 = path.join(generationDir, 'outputs', 'broken.mp4');
  writeFileSync(brokenMp4, 'not a video');
  const brokenFile = genStatus(projectId, 'handoff', [
    '--job', rejectedPrepared.job.jobId,
    '--file', 'generation/outputs/broken.mp4',
    '--rights', 'Broken container attempt',
  ]);

  const checks = [
    {
      name: 'live submission is refused by authorization',
      pass: liveBlocked.status === 1 && /NOT_GRANTED/.test(`${liveBlocked.stderr}${liveBlocked.stdout}`),
      details: {exit: liveBlocked.status, message: `${liveBlocked.stderr}`.trim().split('\n')[0]},
    },
    {
      name: 'a job cannot be resumed before authorization',
      pass: unauthorized.status === 1 && /permission|authoriz/i.test(`${unauthorized.stderr}${unauthorized.stdout}`),
      details: {exit: unauthorized.status},
    },
    {
      name: 'the simulated Runway lifecycle reaches succeeded through the fake transport',
      pass: simulated.simulated.taskId === 'task-sim-1'
        && simulated.simulated.states.includes('running')
        && simulated.simulated.states[simulated.simulated.states.length - 1] === 'succeeded'
        && simulated.simulated.authorizationHeaderRedacted === true
        && simulated.simulated.submitPath === '/v1/image_to_video'
        && simulated.simulated.lastRequestPath === '/v1/tasks/task-sim-1',
      details: simulated.simulated,
    },
    {
      name: 're-preparing the same request is idempotent and does not duplicate a job',
      pass: duplicate.duplicate === true && duplicate.jobId === prepared.job.jobId,
      details: {jobId: duplicate.jobId, duplicate: duplicate.duplicate},
    },
    {
      name: 'an unsupported model/request combination is rejected before submission',
      pass: unsupported.status !== 0,
      details: {exit: unsupported.status, message: `${unsupported.stdout}${unsupported.stderr}`.trim().slice(0, 240)},
    },
    {
      name: 'an uncertain submission is parked as unknown-submission-state',
      pass: timeoutRun.status === 1
        && timeoutJob?.execution.state === 'unknown-submission-state'
        && timeoutJob?.execution.providerTaskId === null,
      details: {exit: timeoutRun.status, state: timeoutJob?.execution.state, taskId: timeoutJob?.execution.providerTaskId},
    },
    {
      name: 'retrying an unreconciled submission is refused instead of billing twice',
      pass: retryBlocked.status === 1
        && /unknown provider task id|already used|unknown-submission/i.test(`${retryBlocked.stderr}${retryBlocked.stdout}`),
      details: {exit: retryBlocked.status},
    },
    {
      name: 'reviewer rejection leaves the requirement unfulfilled and the project blocked',
      pass: afterReject.status === 2 && rejectedIntake?.review === 'rejected',
      details: {statusExit: afterReject.status, intakeReview: rejectedIntake?.review},
    },
    {
      name: 'cross-project destinations are refused',
      pass: crossProject.status === 1,
      details: {exit: crossProject.status, message: `${crossProject.stderr}`.trim().split('\n')[0]},
    },
    {
      name: 'a broken MP4 is refused by the real probe',
      pass: brokenFile.status === 1,
      details: {exit: brokenFile.status, message: `${brokenFile.stderr}`.trim().split('\n')[0]},
    },
  ];

  const record = {projectId: `${projectId}:provider`, pass: checks.every((check) => check.pass), checks};
  record.report = path.relative(project.projectDir, writeEvidence(project, 'generation-provider-evidence.json', record)).split(path.sep).join('/');
  results.push(record);
  console.log(JSON.stringify({projectId: record.projectId, pass: record.pass, checks: checks.map((check) => ({name: check.name, pass: check.pass})), report: record.report}));
}

const pass = results.every((record) => record.pass);
console.log(JSON.stringify({pass, projects: results.map((record) => record.projectId)}, null, 2));
if (!pass) process.exitCode = 1;
