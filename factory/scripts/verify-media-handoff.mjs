// End-to-end local acceptance for media-aware storyboards and asset handoff.
// Expects a fresh workspace seeded by npm run handoff:seed.
//
// Usage: node factory/scripts/verify-media-handoff.mjs --workspace <external-root>
// Requires FFmpeg/FFprobe, a Remotion browser and factory/dist.

import {execFileSync, spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {copyFileSync, existsSync, readFileSync, statSync, writeFileSync} from 'node:fs';
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
const cliScript = path.join(repoRoot, 'factory', 'scripts', 'preproduction.mjs');

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
const writeJsonFile = (file, value) => writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);

const ffprobeJson = (file) => {
  const raw = execFileSync(
    'ffprobe',
    ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', file],
    {encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, windowsHide: true},
  );
  return JSON.parse(raw);
};

const rawFrame = (file, frame, width, height) => {
  const bytes = execFileSync(
    'ffmpeg',
    ['-v', 'error', '-i', file, '-vf', `select=eq(n\\,${frame})`, '-frames:v', '1',
      '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'],
    {encoding: null, maxBuffer: 64 * 1024 * 1024, windowsHide: true},
  );
  if (bytes.length !== width * height * 3) {
    throw new Error(`Decoded frame ${frame} has ${bytes.length} bytes; expected ${width * height * 3}`);
  }
  return bytes;
};

const averageRgb = (bytes) => {
  const sums = [0, 0, 0];
  const pixels = bytes.length / 3;
  for (let index = 0; index < bytes.length; index += 3) {
    sums[0] += bytes[index];
    sums[1] += bytes[index + 1];
    sums[2] += bytes[index + 2];
  }
  return sums.map((sum) => Math.round(sum / pixels));
};

// Goertzel magnitude at one frequency, used to prove an embedded source track is
// muted while the project mix is present.
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

const runCli = (projectId, command, extra = []) =>
  execFileSync(
    process.execPath,
    [cliScript, command, '--project', projectId, '--workspace', workspaceRoot, ...extra],
    {encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, windowsHide: true, env: process.env},
  );

const runCliStatus = (projectId, command, extra = []) =>
  spawnSync(
    process.execPath,
    [cliScript, command, '--project', projectId, '--workspace', workspaceRoot, ...extra],
    {encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, windowsHide: true, env: process.env},
  );

const writeEvidence = (project, name, value) => {
  const boundary = createProjectWriteBoundary(project, {engineRoot: repoRoot});
  const reportsDir = ensureSafeDirectory(boundary, path.join(boundary.projectRoot, 'reports'), 'project');
  const file = assertSafePath(boundary, path.join(reportsDir, name), {expect: 'file', subtree: 'project'});
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
  return file;
};

const PROJECTS = {
  'synthetic-mixed-timeline-demo': {
    frames: 120,
    fps: 30,
    width: 1280,
    height: 720,
    attachments: [
      {requirement: 'REQ-001', assetId: 'VID-HARBOUR', file: 'intake/video/harbour-30fps.mp4'},
      {requirement: 'REQ-002', assetId: 'VID-HARBOUR', file: 'intake/video/harbour-30fps.mp4'},
    ],
  },
  'synthetic-hybrid-continuity-demo': {
    frames: 96,
    fps: 24,
    width: 540,
    height: 960,
    attachments: [
      {requirement: 'REQ-001', assetId: 'VID-STAIRWELL', file: 'intake/video/stairwell-24fps.mp4'},
      {requirement: 'REQ-002', assetId: 'LYR-LANTERN', file: 'intake/layers/lantern.png'},
      {requirement: 'REQ-003', assetId: 'LYR-GRID', file: 'intake/layers/grid.png'},
      {requirement: 'REQ-004', assetId: 'VID-STAIRWELL', file: 'intake/video/stairwell-24fps.mp4'},
      {requirement: 'REQ-005', assetId: 'LYR-LANTERN', file: 'intake/layers/lantern.png'},
      {requirement: 'REQ-006', assetId: 'LYR-GRID', file: 'intake/layers/grid.png'},
    ],
  },
  'synthetic-unresolved-media-demo': {
    frames: 75,
    fps: 25,
    width: 800,
    height: 800,
    attachments: [
      {requirement: 'REQ-001', assetId: 'VID-WATER', file: 'intake/video/water-25fps.mp4'},
      {requirement: 'REQ-002', assetId: 'LYR-SIGIL', file: 'intake/layers/sigil.png'},
    ],
  },
};

const results = [];

const runProject = (projectId, expectations) => {
  const spec = PROJECTS[projectId];
  const project = loadProject(projectId, {workspaceRoot, engineRoot: repoRoot});
  const preproductionDir = path.join(project.projectDir, 'preproduction');
  const projectJsonBefore = sha256File(path.join(project.projectDir, 'project.json'));
  const audioHashBefore = sha256File(project.audioPath);
  const intakePathsBefore = spec.attachments.map((entry) =>
    sha256File(path.join(project.projectDir, entry.file)),
  );

  runCli(projectId, 'validate');
  runCli(projectId, 'plan');
  runCli(projectId, 'approve-plan');
  const storyboardBefore = JSON.parse(runCli(projectId, 'storyboard'));
  runCli(projectId, 'approve-storyboard');

  // Before any attachment the project must stay blocked with no candidate.
  const blockedCompile = runCliStatus(projectId, 'compile');
  const blockedReport = readJson(path.join(preproductionDir, 'compile-report.json'));
  const blockedTasks = runCliStatus(projectId, 'tasks');
  const tasksBefore = readJson(path.join(preproductionDir, 'production-tasks.json'));
  const candidateBeforeExists = existsSync(path.join(preproductionDir, 'project-candidate.json'));

  // Technical validation without a reviewer decision must not unblock either.
  for (const entry of spec.attachments) {
    runCli(projectId, 'attach-asset', [
      '--requirement', entry.requirement,
      '--asset-id', entry.assetId,
      '--path', entry.file,
      '--provenance', 'Procedural synthetic FFmpeg/Node fixture generated by the seed script',
      '--rights', 'Synthetic fixture; no third-party rights',
    ]);
  }
  const unreviewedCompile = runCliStatus(projectId, 'compile');
  const unreviewedTasks = runCliStatus(projectId, 'tasks');
  const unreviewedTaskDoc = readJson(path.join(preproductionDir, 'production-tasks.json'));

  for (const entry of spec.attachments) {
    runCli(projectId, 'review-asset', [
      '--requirement', entry.requirement,
      '--decision', 'approve',
      '--notes', `Reviewer approved the ${entry.assetId} fixture for ${entry.requirement}.`,
    ]);
  }
  const readyStoryboard = JSON.parse(runCli(projectId, 'storyboard', ['--new-revision']));
  runCli(projectId, 'approve-storyboard');
  const compileOutput = JSON.parse(runCli(projectId, 'compile'));
  const candidate = readJson(path.join(preproductionDir, 'project-candidate.json'));
  const finalTasks = JSON.parse(runCli(projectId, 'tasks'));
  runCli(projectId, 'render-preview', ['--frames', `0-${spec.frames - 1}`]);

  const output = path.join(project.projectDir, 'renders', 'storyboard-preview.mp4');
  if (!existsSync(output)) throw new Error(`${projectId} preview is missing`);
  const probe = ffprobeJson(output);
  const videoStream = (probe.streams || []).find((stream) => stream.codec_type === 'video');
  const audioStreams = (probe.streams || []).filter((stream) => stream.codec_type === 'audio');
  if (!videoStream) throw new Error(`${projectId} preview has no video stream`);
  const renderReport = readJson(
    path.join(project.projectDir, 'reports', `render-${projectId}-video.json`),
  );

  const sourceVideoPath = path.join(project.projectDir, spec.attachments[0].file);
  const sourceProbe = ffprobeJson(sourceVideoPath);
  const sourceStream = (sourceProbe.streams || []).find((stream) => stream.codec_type === 'video');
  if (!sourceStream) throw new Error(`${projectId} intake video has no decodable video stream`);
  // Frames are decoded from the same source file used for binding so composited
  // output can be compared with what the raw plate alone would have produced.
  const sourceFrameRgb = (frame) =>
    averageRgb(rawFrame(sourceVideoPath, frame, sourceStream.width, sourceStream.height));
  const frameEvidence = expectations.frames.map((frame) => ({
    frame,
    rgb: averageRgb(rawFrame(output, frame, videoStream.width, videoStream.height)),
    sourceRgb: sourceFrameRgb(frame),
  }));
  // Tone magnitudes are measured on a mono downmix of the decoded PCM. The
  // source clip carries a distinctive 950 Hz tone that the project mix does
  // not, so its absence in the output proves the embedded track stayed muted
  // while the mix itself survived the mux unchanged.
  const monoOf = (decoderInput) => stereoToMono(decoderInput.samples);
  const masterMono = monoOf(decodeAudioToNormalizedPcm(project.audioPath, 48000, 'master'));
  const outputMono = monoOf(decodeAudioToNormalizedPcm(output, 48000, 'preview'));
  const sourceMono = monoOf(
    decodeAudioToNormalizedPcm(path.join(project.projectDir, spec.attachments[0].file), 48000, 'source'),
  );
  const audioEvidence = {
    masterTone: Number(toneMagnitude(masterMono, 48000, expectations.masterFrequency).toFixed(6)),
    outputTone: Number(toneMagnitude(outputMono, 48000, expectations.masterFrequency).toFixed(6)),
    masterSourceFrequency: Number(toneMagnitude(masterMono, 48000, 950).toFixed(6)),
    outputSourceFrequency: Number(toneMagnitude(outputMono, 48000, 950).toFixed(6)),
    clipSourceFrequency: Number(toneMagnitude(sourceMono, 48000, 950).toFixed(6)),
    samples: outputMono.length,
    masterSamples: masterMono.length,
  };

  const continuityDoc = readJson(path.join(preproductionDir, 'continuity.json'));
  const intakeDoc = readJson(path.join(preproductionDir, 'asset-intake.json'));
  const checks = [
    {
      name: `${projectId}: compile is blocked before any asset is attached`,
      pass: blockedCompile.status === 2
        && blockedReport.status === 'blocked'
        && blockedReport.candidatePath === null
        && !candidateBeforeExists
        && blockedTasks.status === 2
        && tasksBefore.tasks.every((task) => task.productionStatus === 'needed'),
      details: {
        compileExit: blockedCompile.status,
        reportStatus: blockedReport.status,
        candidateWritten: candidateBeforeExists,
        tasksExit: blockedTasks.status,
        statuses: tasksBefore.tasks.map((task) => `${task.id}:${task.productionStatus}`),
      },
    },
    {
      name: `${projectId}: technical validation alone does not approve an asset`,
      pass: unreviewedCompile.status === 2
        && unreviewedTasks.status === 2
        && unreviewedTaskDoc.tasks.every((task) => task.productionStatus === 'delivered')
        && unreviewedTaskDoc.tasks.every((task => task.reviewStatus === 'draft')),
      details: {
        compileExit: unreviewedCompile.status,
        tasksExit: unreviewedTasks.status,
        statuses: unreviewedTaskDoc.tasks.map((task) => `${task.id}:${task.productionStatus}:${task.reviewStatus}`),
      },
    },
    {
      name: `${projectId}: reviewer approval transitions the storyboard to render-ready`,
      pass: readyStoryboard.renderReady === true
        && readyStoryboard.missingAssetRequirements.length === 0
        && compileOutput.status === 'ready'
        && finalTasks.unresolved.length === 0
        && existsSync(path.join(preproductionDir, 'project-candidate.json')),
      details: {
        renderReady: readyStoryboard.renderReady,
        compileStatus: compileOutput.status,
        taskStatuses: unreviewedTaskDoc.tasks.map((task) => task.productionStatus),
        notes: compileOutput.notes,
      },
    },
    {
      name: `${projectId}: candidate carries the intended renderer families`,
      pass: expectations.renderers.every(
        (entry) => candidate.chapters
          .flatMap((chapter) => chapter.shots)
          .find((shot) => shot.id === entry.shot)?.renderer === entry.renderer,
      ),
      details: {
        renderers: candidate.chapters.flatMap((chapter) => chapter.shots).map((shot) => `${shot.id}:${shot.renderer}`),
      },
    },
    {
      name: `${projectId}: media shots bind approved local assets with typed configuration`,
      pass: expectations.media.every((entry) => {
        const shot = candidate.chapters.flatMap((chapter) => chapter.shots).find((item) => item.id === entry.shot);
        if (!shot || !shot.media) return false;
        if (shot.media.kind !== entry.kind) return false;
        const video = shot.media.kind === 'video' ? shot.media : shot.media.video;
        if (video.assetId !== entry.assetId) return false;
        if (Math.abs(video.sourceStartSeconds - entry.sourceStartSeconds) > 1e-6) return false;
        if (video.muted !== true || video.endBehavior !== 'reject') return false;
        if (entry.layers) {
          const layers = shot.media.layers;
          if (layers.length !== entry.layers.length) return false;
          return entry.layers.every((want, index) => {
            const got = layers[index];
            return got.assetId === want.assetId
              && got.order === want.order
              && got.visibleFromFrame === want.visibleFromFrame
              && got.visibleToFrame === want.visibleToFrame
              && Math.abs(got.opacity - want.opacity) < 1e-9;
          });
        }
        return true;
      }),
      details: {
        media: candidate.chapters
          .flatMap((chapter) => chapter.shots)
          .filter((shot) => shot.media)
          .map((shot) => {
            const video = shot.media.kind === 'video' ? shot.media : shot.media.video;
            return {
              id: shot.id,
              kind: shot.media.kind,
              assetId: video.assetId,
              in: video.sourceStartSeconds,
              muted: video.muted,
              endBehavior: video.endBehavior,
              layers: shot.media.kind === 'hybrid'
                ? shot.media.layers.map((layer) => `${layer.assetId}@${layer.order}:${layer.visibleFromFrame}-${layer.visibleToFrame}:op${layer.opacity}`)
                : null,
              overlay: shot.media.kind === 'hybrid' ? shot.media.overlay.kind : null,
            };
          }),
      },
    },
    {
      name: `${projectId}: candidate assets contain only approved, hash-verified local bindings`,
      pass: candidate.assets.every((asset) => asset.approval === 'approved')
        && expectations.expectedAssetIds.every((id) => candidate.assets.some((asset) => asset.id === id))
        && candidate.assets
          .filter((asset) => asset.kind === 'video' || asset.kind === 'layer')
          .every((asset) => intakeDoc.records.some((record) => record.assetId === asset.id && record.review === 'approved')),
      details: {
        assets: candidate.assets.map((asset) => `${asset.id}:${asset.kind}:${asset.approval}`),
        intake: intakeDoc.records.map((record) => `${record.requirementId}:${record.assetId}:${record.review}`),
      },
    },
    {
      name: `${projectId}: preview metadata matches the compiled candidate`,
      pass: videoStream.codec_name === 'h264'
        && videoStream.width === spec.width
        && videoStream.height === spec.height
        && videoStream.r_frame_rate === `${spec.fps}/1`
        && Number(videoStream.nb_frames) === spec.frames
        && audioStreams.length === 1
        && Number(audioStreams[0].sample_rate) === 48000,
      details: {
        video: {codec: videoStream.codec_name, width: videoStream.width, height: videoStream.height, fps: videoStream.r_frame_rate, frames: Number(videoStream.nb_frames)},
        audioStreams: audioStreams.length,
        sampleRate: audioStreams[0]?.sample_rate,
        bytes: statSync(output).size,
      },
    },
    {
      name: `${projectId}: the render actually used the compiled candidate config`,
      pass: renderReport.configPath === 'preproduction/project-candidate.json',
      details: {configPath: renderReport.configPath},
    },
    {
      name: `${projectId}: decoded frames show the intended video and layer composition`,
      pass: expectations.frameChecks.every((entry) => entry.evaluate(frameEvidence)),
      details: {frameEvidence, assertions: expectations.frameChecks.map((entry) => entry.description)},
    },
    {
      name: `${projectId}: the project mix is audible and the embedded source audio stays muted`,
      pass: audioEvidence.outputTone > 1e-4
        && Math.abs(audioEvidence.outputTone - audioEvidence.masterTone) / audioEvidence.masterTone < 0.05
        && audioEvidence.clipSourceFrequency > audioEvidence.masterSourceFrequency * 50
        && audioEvidence.outputSourceFrequency <= Math.max(audioEvidence.masterSourceFrequency * 1.5, 1e-4),
      details: audioEvidence,
    },
    {
      name: `${projectId}: approved continuity references survive the handoff unchanged`,
      pass: continuityDoc.entries.length === expectations.continuityCount
        && JSON.stringify(continuityDoc) === JSON.stringify(expectations.continuityBefore)
        && continuityDoc.entries.every((entry) => entry.approval === 'approved'),
      details: {
        entries: continuityDoc.entries.map((entry) => `${entry.id}:${entry.kind}:${entry.approval}:${entry.shotIds.join('+')}`),
        revision: continuityDoc.revision,
      },
    },
    {
      name: `${projectId}: source media, project.json and intake bytes stay unmodified`,
      pass: sha256File(path.join(project.projectDir, 'project.json')) === projectJsonBefore
        && sha256File(project.audioPath) === audioHashBefore
        && spec.attachments.every((entry, index) =>
          sha256File(path.join(project.projectDir, entry.file)) === intakePathsBefore[index]),
      details: {projectJsonBefore, audioHashBefore, intakePathsBefore},
    },
  ];

  const record = {
    projectId,
    pass: checks.every((check) => check.pass),
    checks,
    audioEvidence,
    frameEvidence,
    candidateSummary: {
      renderers: candidate.chapters.flatMap((chapter) => chapter.shots).map((shot) => `${shot.id}:${shot.renderer}`),
      assets: candidate.assets.map((asset) => `${asset.id}:${asset.kind}`),
    },
    output: {path: 'renders/storyboard-preview.mp4', bytes: statSync(output).size, configPath: renderReport.configPath},
  };
  record.report = path
    .relative(project.projectDir, writeEvidence(project, 'media-handoff-evidence.json', record))
    .split(path.sep)
    .join('/');
  results.push(record);
  console.log(JSON.stringify({
    projectId,
    pass: record.pass,
    checks: checks.map((check) => ({name: check.name, pass: check.pass})),
    report: record.report,
  }));
};

const loadContinuity = (projectId) =>
  readJson(path.join(workspaceRoot, projectId, 'preproduction', 'continuity.json'));

runProject('synthetic-mixed-timeline-demo', {
  frames: [5, 35, 65, 95],
  masterFrequency: 440,
  continuityCount: 2,
  continuityBefore: loadContinuity('synthetic-mixed-timeline-demo'),
  renderers: [
    {shot: 'SHOT-001', renderer: 'pixel-canvas'},
    {shot: 'SHOT-002', renderer: 'video'},
    {shot: 'SHOT-003', renderer: 'pixel-canvas'},
    {shot: 'SHOT-004', renderer: 'video'},
  ],
  expectedAssetIds: ['VID-HARBOUR', 'AUDIO-MUSIC'],
  media: [
    {shot: 'SHOT-002', kind: 'video', assetId: 'VID-HARBOUR', sourceStartSeconds: 1},
    {shot: 'SHOT-004', kind: 'video', assetId: 'VID-HARBOUR', sourceStartSeconds: 1},
  ],
  frameChecks: [
    {
      description: 'video shot frames read the lime source segment while canvas shots stay dark',
      evaluate: (frames) => {
        const at = (frame) => frames.find((entry) => entry.frame === frame).rgb;
        const video = at(35);
        const canvas = at(5);
        return video[1] > 170 && video[0] < 90 && video[2] < 90 && canvas[1] < canvas[0] + 40 && canvas[2] < 90;
      },
    },
    {
      description: 'the canvas/video boundary at frame 30 changes decoded pixels',
      evaluate: (frames) =>
        JSON.stringify(frames.find((entry) => entry.frame === 35).rgb) !==
        JSON.stringify(frames.find((entry) => entry.frame === 5).rgb),
    },
  ],
});

runProject('synthetic-hybrid-continuity-demo', {
  frames: [6, 20, 60, 80],
  masterFrequency: 330,
  continuityCount: 4,
  continuityBefore: loadContinuity('synthetic-hybrid-continuity-demo'),
  renderers: [
    {shot: 'SHOT-001', renderer: 'hybrid'},
    {shot: 'SHOT-002', renderer: 'hybrid'},
  ],
  expectedAssetIds: ['VID-STAIRWELL', 'LYR-LANTERN', 'LYR-GRID'],
  media: [
    {
      shot: 'SHOT-001',
      kind: 'hybrid',
      assetId: 'VID-STAIRWELL',
      sourceStartSeconds: 0,
      layers: [
        {assetId: 'LYR-LANTERN', order: 0, visibleFromFrame: 0, visibleToFrame: 48, opacity: 1},
        {assetId: 'LYR-GRID', order: 1, visibleFromFrame: 12, visibleToFrame: 48, opacity: 0.6},
      ],
    },
    {
      shot: 'SHOT-002',
      kind: 'hybrid',
      assetId: 'VID-STAIRWELL',
      sourceStartSeconds: 1,
      layers: [
        {assetId: 'LYR-LANTERN', order: 0, visibleFromFrame: 0, visibleToFrame: 48, opacity: 1},
        {assetId: 'LYR-GRID', order: 1, visibleFromFrame: 0, visibleToFrame: 36, opacity: 0.6},
      ],
    },
  ],
  frameChecks: [
    {
      description: 'the grid layer appearing at shot-local frame 12 changes composited pixels',
      evaluate: (frames) => {
        const before = frames.find((entry) => entry.frame === 6).rgb;
        const after = frames.find((entry) => entry.frame === 20).rgb;
        return JSON.stringify(before) !== JSON.stringify(after);
      },
    },
    {
      description: 'the cyan plate and rain overlay add green/blue over the raw red source frame',
      evaluate: (frames) => {
        const entry = frames.find((item) => item.frame === 6);
        return entry.rgb[0] > 150
          && entry.sourceRgb[0] > 200
          && entry.sourceRgb[1] < 20
          && entry.rgb[1] > entry.sourceRgb[1] + 5
          && entry.rgb[2] > entry.sourceRgb[2] + 5;
      },
    },
    {
      description: 'the shot boundary at frame 48 changes composited pixels',
      evaluate: (frames) =>
        JSON.stringify(frames.find((entry) => entry.frame === 60).rgb) !==
        JSON.stringify(frames.find((entry) => entry.frame === 20).rgb),
    },
  ],
});

runProject('synthetic-unresolved-media-demo', {
  frames: [10, 40, 70],
  masterFrequency: 262,
  continuityCount: 2,
  continuityBefore: loadContinuity('synthetic-unresolved-media-demo'),
  renderers: [{shot: 'SHOT-001', renderer: 'hybrid'}],
  expectedAssetIds: ['VID-WATER', 'LYR-SIGIL'],
  media: [
    {
      shot: 'SHOT-001',
      kind: 'hybrid',
      assetId: 'VID-WATER',
      sourceStartSeconds: 0,
      layers: [{assetId: 'LYR-SIGIL', order: 0, visibleFromFrame: 0, visibleToFrame: 75, opacity: 0.9}],
    },
  ],
  frameChecks: [
    {
      description: 'frames stay composited and differ across the shot',
      evaluate: (frames) =>
        JSON.stringify(frames.find((entry) => entry.frame === 10).rgb) !==
        JSON.stringify(frames.find((entry) => entry.frame === 40).rgb),
    },
  ],
});

// Negative handoff checks. Each must fail closed without writing a candidate.
{
  const projectId = 'synthetic-unresolved-media-demo';
  const project = loadProject(projectId, {workspaceRoot, engineRoot: repoRoot});
  const preproductionDir = path.join(project.projectDir, 'preproduction');
  const candidateBefore = sha256File(path.join(preproductionDir, 'project-candidate.json'));

  const traversal = runCliStatus(projectId, 'attach-asset', [
    '--requirement', 'REQ-001',
    '--asset-id', 'EVIL',
    '--path', '../../outside/harbour.mp4',
    '--provenance', 'Traversal attempt',
    '--rights', 'None',
  ]);
  const absolute = runCliStatus(projectId, 'attach-asset', [
    '--requirement', 'REQ-001',
    '--asset-id', 'EVIL',
    '--path', path.join(workspaceRoot, 'synthetic-mixed-timeline-demo', 'intake', 'video', 'harbour-30fps.mp4'),
    '--provenance', 'Cross-project absolute attempt',
    '--rights', 'None',
  ]);
  const crossProject = runCliStatus(projectId, 'attach-asset', [
    '--requirement', 'REQ-001',
    '--asset-id', 'EVIL',
    '--path', '../synthetic-mixed-timeline-demo/intake/video/harbour-30fps.mp4',
    '--provenance', 'Cross-project relative attempt',
    '--rights', 'None',
  ]);
  const wrongKind = runCliStatus(projectId, 'attach-asset', [
    '--requirement', 'REQ-001',
    '--asset-id', 'LYR-WRONG',
    '--path', 'intake/layers/sigil.png',
    '--provenance', 'PNG offered for a video requirement',
    '--rights', 'Synthetic fixture',
  ]);
  const unknownRequirement = runCliStatus(projectId, 'review-asset', [
    '--requirement', 'REQ-999',
    '--decision', 'approve',
    '--notes', 'No such requirement.',
  ]);
  const intakeAfterNegatives = readJson(path.join(preproductionDir, 'asset-intake.json'));
  const candidateAfterNegatives = path.join(preproductionDir, 'project-candidate.json');
  const compileAfterNegatives = runCliStatus(projectId, 'compile');

  // A stale fulfillment record must not bind: change the editorial section label,
  // re-plan and re-approve, then confirm the compiler refuses the old attachment.
  const annotationsPath = path.join(preproductionDir, 'annotations.json');
  const annotations = readJson(annotationsPath);
  annotations.sections[0].label = 'renamed-after-attachment';
  writeJsonFile(annotationsPath, annotations);
  // --new-revision only proposes; the reviewer must promote each revision
  // explicitly before it becomes the active document.
  const replanned = JSON.parse(runCli(projectId, 'plan', ['--new-revision']));
  runCli(projectId, 'approve-plan', ['--revision', String(replanned.revision)]);
  const restored = JSON.parse(runCli(projectId, 'storyboard', ['--new-revision']));
  const restoredRenderReady = restored.renderReady;
  const restoredMissing = restored.missingAssetRequirements;
  runCli(projectId, 'approve-storyboard', ['--revision', String(restored.revision)]);
  const staleCompile = runCliStatus(projectId, 'compile');
  const staleTasksRun = runCliStatus(projectId, 'tasks');
  const staleReport = readJson(path.join(preproductionDir, 'compile-report.json'));
  const staleTasks = readJson(path.join(preproductionDir, 'production-tasks.json'));
  const staleCompileOutput = `${staleCompile.stdout || ''}${staleCompile.stderr || ''}`;

  const record = {
    projectId: `${projectId}:negatives`,
    pass: [
      traversal.status === 1,
      absolute.status === 1,
      crossProject.status === 1,
      wrongKind.status === 1,
      unknownRequirement.status === 1,
      intakeAfterNegatives.records.length === 2,
      sha256File(candidateAfterNegatives) === candidateBefore,
      staleCompile.status === 2 && staleReport.status === 'blocked',
      staleTasksRun.status === 2,
      restoredMissing.includes('REQ-001'),
      staleTasks.tasks.some((task) => task.productionStatus === 'needed'),
      staleTasks.tasks.some((task) => task.productionStatus === 'approved'),
    ].every(Boolean),
    checks: [
      {name: 'parent traversal path is rejected', pass: traversal.status === 1, details: {exit: traversal.status, error: (traversal.stderr || '').trim().split('\n')[0]}},
      {name: 'absolute cross-project path is rejected', pass: absolute.status === 1, details: {exit: absolute.status, error: (absolute.stderr || '').trim().split('\n')[0]}},
      {name: 'relative cross-project path is rejected', pass: crossProject.status === 1, details: {exit: crossProject.status, error: (crossProject.stderr || '').trim().split('\n')[0]}},
      {name: 'a PNG cannot satisfy a video requirement', pass: wrongKind.status === 1, details: {exit: wrongKind.status, error: (wrongKind.stderr || '').trim().split('\n')[0]}},
      {name: 'reviewing an unknown requirement is rejected', pass: unknownRequirement.status === 1, details: {exit: unknownRequirement.status, error: (unknownRequirement.stderr || '').trim().split('\n')[0]}},
      {name: 'rejected attempts leave exactly two intake records', pass: intakeAfterNegatives.records.length === 2, details: {records: intakeAfterNegatives.records.map((record) => `${record.requirementId}:${record.assetId}:${record.review}`)}},
      {name: 'no recompile during negatives rewrote the accepted candidate', pass: sha256File(candidateAfterNegatives) === candidateBefore, details: {compileExit: compileAfterNegatives.status, status: readJson(path.join(preproductionDir, 'compile-report.json')).status}},
      {
        name: 'a stale fulfillment record blocks recompilation instead of binding silently',
        pass: staleCompile.status === 2
          && staleReport.status === 'blocked'
          && staleReport.candidatePath === null
          && sha256File(candidateAfterNegatives) === candidateBefore
          && staleTasks.tasks.some((task) => task.productionStatus === 'needed')
          && restoredRenderReady === false
          && restoredMissing.includes('REQ-001'),
        details: {
          replannedRevision: replanned.revision,
          restoredRevision: restored.revision,
          restoredRenderReady: restored.renderReady,
          restoredMissing: restored.missingAssetRequirements,
          compileExit: staleCompile.status,
          reportStatus: staleReport.status,
          candidateUnchanged: sha256File(candidateAfterNegatives) === candidateBefore,
          taskStatuses: staleTasks.tasks.map((task) => `${task.id}:${task.productionStatus}`),
          staleReason: staleTasks.tasks
            .filter((task) => task.productionStatus === 'needed')
            .map((task) => `${task.id}:${JSON.stringify(task.acceptanceCriteria.length)}`),
          compileOutput: staleCompileOutput.trim().split('\n').slice(-3),
        },
      },
    ],
  };
  record.report = path
    .relative(project.projectDir, writeEvidence(project, 'media-handoff-negatives.json', record))
    .split(path.sep)
    .join('/');
  results.push(record);
  console.log(JSON.stringify({
    projectId: record.projectId,
    pass: record.pass,
    checks: record.checks.map((check) => ({name: check.name, pass: check.pass})),
    report: record.report,
  }));
}

const pass = results.every((record) => record.pass);
console.log(JSON.stringify({pass, projects: results.map((record) => record.projectId)}, null, 2));
if (!pass) process.exitCode = 1;
