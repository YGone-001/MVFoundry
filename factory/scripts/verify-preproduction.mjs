// End-to-end local acceptance for the music-aware preproduction workflow.
// Expects a fresh workspace seeded by npm run preproduction:seed.
//
// Usage: node factory/scripts/verify-preproduction.mjs --workspace <external-root>
// Requires FFmpeg, a Remotion browser and factory/dist.

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
const cliScript = path.join(repoRoot, 'factory', 'scripts', 'preproduction.mjs');

const {loadProject} = require('../dist/src/project/loadProject.js');
const {sha256File} = require('../dist/src/media/hash.js');
const {decodeAudioToNormalizedPcm} = require('../dist/src/media/audioDecode.js');
const {stereoToMono} = require('../dist/src/audio/analysis.js');
const {analyzeBeatGrid} = require('../dist/src/preproduction/beatGrid.js');
const {
  assertSafePath,
  createProjectWriteBoundary,
  ensureSafeDirectory,
} = require('../dist/src/workspace/writeBoundary.js');

const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
const sha = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');

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
    [
      '-v', 'error', '-i', file, '-vf', `select=eq(n\\,${frame})`, '-frames:v', '1',
      '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-',
    ],
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

// Matched-beat error alone never proves beat recovery, so tempo error, matched
// count, missed ground-truth beats and extra detections stay separate metrics.
const beatMetrics = (detectedFrames, truthFrames, fps) => {
  const matched = [];
  const missed = [];
  for (const truth of truthFrames) {
    let best = null;
    for (const frame of detectedFrames) {
      const error = Math.abs(frame - truth);
      if (best === null || error < best.error) best = {frame, error};
    }
    if (best && best.error <= 1) {
      matched.push({
        truthFrame: truth,
        detectedFrame: best.frame,
        errorFrames: best.error,
        errorMs: Number(((best.error / fps) * 1000).toFixed(2)),
      });
    } else {
      missed.push({
        truthFrame: truth,
        nearestDetectedFrame: best ? best.frame : null,
        errorFrames: best ? best.error : null,
      });
    }
  }
  const matchedDetected = new Set(matched.map((entry) => entry.detectedFrame));
  const extra = detectedFrames.filter((frame) => !matchedDetected.has(frame));
  const maxMatchedErrorFrames =
    matched.length > 0 ? Math.max(...matched.map((entry) => entry.errorFrames)) : null;
  return {
    detectedFrames,
    truthFrames,
    matchedCount: matched.length,
    missedCount: missed.length,
    extraCount: extra.length,
    matched,
    missed,
    extra,
    maxMatchedErrorFrames,
    maxMatchedErrorMs:
      maxMatchedErrorFrames === null
        ? null
        : Number(((maxMatchedErrorFrames / fps) * 1000).toFixed(2)),
  };
};

const results = [];
const projectA = path.join(workspaceRoot, 'synthetic-beat-demo');
const projectA2 = path.join(workspaceRoot, 'synthetic-beat-grid-demo');
const projectB = path.join(workspaceRoot, 'synthetic-uncertain-demo');
const projectC = path.join(workspaceRoot, 'synthetic-lyrics-demo');
for (const dir of [projectA, projectA2, projectB, projectC]) {
  if (!existsSync(path.join(dir, 'project.json'))) {
    throw new Error(`Missing seeded preproduction project: ${dir}`);
  }
}

// Project A: strong constant tempo, approved manual timing, real preview.
{
  const projectId = 'synthetic-beat-demo';
  const project = loadProject(projectId, {workspaceRoot, engineRoot: repoRoot});
  const projectJsonBefore = sha256File(path.join(project.projectDir, 'project.json'));
  const audioHashBefore = sha256File(project.audioPath);
  runCli(projectId, 'validate');
  runCli(projectId, 'analyze-beats');
  const beatGrid = readJson(path.join(project.projectDir, 'preproduction', 'beat-grid.json'));
  runCli(projectId, 'plan');
  runCli(projectId, 'approve-plan');
  const plan = readJson(path.join(project.projectDir, 'preproduction', 'director-plan.json'));
  runCli(projectId, 'storyboard');
  runCli(projectId, 'approve-storyboard');
  const storyboard = readJson(path.join(project.projectDir, 'preproduction', 'storyboard.json'));
  const expectedBeatFrames = Array.from({length: 8}, (_, index) => index * 15);
  const beatTiming = beatMetrics(beatGrid.beatEvents.map((event) => event.frame), expectedBeatFrames, 30);
  const tempoErrorBpm = beatGrid.estimatedTempo ? Number(Math.abs(beatGrid.estimatedTempo.bpm - 120).toFixed(3)) : null;
  runCli(projectId, 'compile');
  const compileReport = readJson(path.join(project.projectDir, 'preproduction', 'compile-report.json'));
  const candidate = readJson(path.join(project.projectDir, 'preproduction', 'project-candidate.json'));
  runCli(projectId, 'render-preview');
  const output = path.join(project.projectDir, 'renders', 'storyboard-preview.mp4');
  if (!existsSync(output)) throw new Error('Project A storyboard preview is missing');
  const renderReport = readJson(path.join(project.projectDir, 'reports', `render-${projectId}-video.json`));
  const probe = ffprobeJson(output);
  const videoStream = (probe.streams || []).find((stream) => stream.codec_type === 'video');
  const audioStreams = (probe.streams || []).filter((stream) => stream.codec_type === 'audio');
  if (!videoStream) throw new Error('Project A preview has no video stream');
  const frames = Number(videoStream.nb_frames);
  const cutFrames = storyboard.chapters.flatMap((chapter) => chapter.shots.map((shot) => shot.startFrame)).filter((frame) => frame > 0);
  const cutEvidence = [];
  for (const cut of cutFrames) {
    const before = rawFrame(output, cut - 1, videoStream.width, videoStream.height);
    const at = rawFrame(output, cut, videoStream.width, videoStream.height);
    cutEvidence.push({cut, changed: Buffer.compare(before, at) !== 0, before: averageRgb(before), at: averageRgb(at)});
  }
  const decodedAudio = decodeAudioToNormalizedPcm(output, 48000, 'preview');
  const outputBeat = analyzeBeatGrid(stereoToMono(decodedAudio.samples), {
    projectId,
    sourceSha256: project.config.audio.sha256,
    sampleRate: 48000,
    outputFps: 30,
    durationFrames: 120,
  });
  const checks = [
    {name: 'beat-grid has a plausible 120 BPM candidate', pass: Boolean(beatGrid.estimatedTempo) && Math.abs(beatGrid.estimatedTempo.bpm - 120) <= 2, details: {estimatedTempo: beatGrid.estimatedTempo, tempoErrorBpm}},
    {name: 'every matched candidate beat aligns to the synthetic 120 BPM grid within one output frame', pass: beatTiming.matchedCount >= 6 && beatTiming.maxMatchedErrorFrames <= 1 && beatTiming.extraCount === 0, details: {tempoErrorBpm, matchedCount: beatTiming.matchedCount, missedCount: beatTiming.missedCount, extraCount: beatTiming.extraCount, maxMatchedErrorFrames: beatTiming.maxMatchedErrorFrames, maxMatchedErrorMs: beatTiming.maxMatchedErrorMs, matched: beatTiming.matched, extra: beatTiming.extra}},
    {name: 'the undetected frame-zero beat is reported as a boundary limitation and never silently invented', pass: beatTiming.missedCount === 1 && beatTiming.missed[0].truthFrame === 0 && beatGrid.limitations.includes('frame-zero-onset-not-detected') && beatGrid.beatEvents.every((event) => event.frame > 0), details: {missed: beatTiming.missed, limitations: beatGrid.limitations, phase: beatGrid.phase}},
    {name: 'offbeat transients are reported and half-tempo ambiguity is explicit', pass: beatGrid.limitations.includes('offbeat-transients-present') && (beatGrid.estimatedTempo?.ambiguity?.halfTempo === true || beatGrid.estimatedTempo?.ambiguity?.doubleTempo === true), details: beatGrid.estimatedTempo?.ambiguity},
    {name: 'plan uses approved manual timing, not the estimated grid', pass: plan.source.manualTimingUsed === true && plan.source.beatGridUsed === false, details: plan.source},
    {name: 'plan and storyboard cover the complete 120-frame duration', pass: storyboard.chapters[0]?.startFrame === 0 && storyboard.chapters[storyboard.chapters.length - 1]?.endFrame === 120 && storyboard.chapters.flatMap((chapter) => chapter.shots).every((shot) => shot.endFrame > shot.startFrame), details: {chapters: storyboard.chapters.length}},
    {name: 'storyboard is approved and render-ready', pass: storyboard.status === 'approved' && storyboard.renderReady === true, details: {status: storyboard.status, renderReady: storyboard.renderReady}},
    {name: 'compiled candidate preserves master audio, project id, fps, and duration', pass: compileReport.status === 'ready' && candidate.projectId === projectId && candidate.audio.sha256 === project.config.audio.sha256 && candidate.output.fps === 30 && candidate.output.durationInFrames === 120, details: compileReport},
    {name: 'candidate chapters and shots match the approved storyboard', pass: JSON.stringify(candidate.chapters.map((chapter) => ({startFrame: chapter.startFrame, endFrame: chapter.endFrame, shots: chapter.shots.map((shot) => [shot.id, shot.startFrame, shot.endFrame, shot.renderer])}))) === JSON.stringify(storyboard.chapters.map((chapter) => ({startFrame: chapter.startFrame, endFrame: chapter.endFrame, shots: chapter.shots.map((shot) => [shot.id, shot.startFrame, shot.endFrame, shot.renderer])})))},
    {
      name: 'storyboard references approved project cues and candidate preserves cue identity',
      pass:
        (() => {
          const shotCueIds = storyboard.chapters.flatMap((chapter) => chapter.shots).flatMap((shot) => shot.cueIds);
          const known = new Set(project.config.cues.map((cue) => cue.id));
          return (
            shotCueIds.length >= 2 &&
            shotCueIds.every((id) => known.has(id)) &&
            JSON.stringify(candidate.cues) === JSON.stringify(project.config.cues)
          );
        })(),
      details: {
        shotCueIds: storyboard.chapters.flatMap((chapter) => chapter.shots).flatMap((shot) => shot.cueIds),
        candidateCues: candidate.cues,
      },
    },
    {name: 'the render actually used the generated candidate config', pass: renderReport.configPath === 'preproduction/project-candidate.json' && compileReport.candidatePath === 'preproduction/project-candidate.json', details: {configPath: renderReport.configPath, candidatePath: compileReport.candidatePath}},
    {name: 'preview metadata matches the candidate profile', pass: videoStream.codec_name === 'h264' && videoStream.width === 640 && videoStream.height === 360 && videoStream.r_frame_rate === '30/1' && frames === 120 && audioStreams.length === 1 && Number(audioStreams[0].sample_rate) === 48000, details: {video: {codec: videoStream.codec_name, width: videoStream.width, height: videoStream.height, fps: videoStream.r_frame_rate, frames}, audio: audioStreams.length, sampleRate: audioStreams[0]?.sample_rate}},
    {name: 'every storyboard cut changes decoded visual content', pass: cutEvidence.length >= 5 && cutEvidence.every((entry) => entry.changed), details: cutEvidence},
    {name: 'decoded preview audio reproduces the 120 BPM pulse grid', pass: Boolean(outputBeat.estimatedTempo) && Math.abs(outputBeat.estimatedTempo.bpm - 120) <= 3, details: outputBeat.estimatedTempo},
    {name: 'source audio and project.json remain unchanged', pass: sha256File(project.audioPath) === audioHashBefore && sha256File(path.join(project.projectDir, 'project.json')) === projectJsonBefore, details: {audioHashBefore, projectJsonBefore}},
  ];
  const record = {
    projectId,
    pass: checks.every((check) => check.pass),
    checks,
    beatGrid: {path: 'preproduction/beat-grid.json', estimatedTempo: beatGrid.estimatedTempo, tempoErrorBpm, phase: beatGrid.phase, candidateCount: beatGrid.tempoCandidates.length, limitations: beatGrid.limitations, beatCount: beatGrid.beatEvents.length, metrics: beatTiming},
    plan: {revision: plan.revision, status: plan.status, shots: plan.chapters.flatMap((chapter) => chapter.shots).length, timingNotes: plan.timingNotes},
    storyboard: {revision: storyboard.revision, status: storyboard.status, renderReady: storyboard.renderReady, shots: storyboard.chapters.flatMap((chapter) => chapter.shots).length},
    output: {path: 'renders/storyboard-preview.mp4', bytes: statSync(output).size, video: {width: videoStream.width, height: videoStream.height, fps: videoStream.r_frame_rate, frames}, audioStreams: audioStreams.length, configPath: renderReport.configPath},
    cutEvidence,
  };
  record.report = path.relative(project.projectDir, writeEvidence(project, 'preproduction-evidence.json', record)).split(path.sep).join('/');
  results.push(record);
  console.log(JSON.stringify({projectId, pass: record.pass, checks: checks.map((check) => ({name: check.name, pass: check.pass})), report: record.report}));
}

// Project A2: an explicitly approved estimated beat grid drives director shot
// timing and the actual rendered cuts, with no manual timing present at all.
{
  const projectId = 'synthetic-beat-grid-demo';
  const groundTruthBpm = 90;
  const fps = 30;
  const truthBeatFrames = Array.from({length: 6}, (_, index) => index * 20);
  const project = loadProject(projectId, {workspaceRoot, engineRoot: repoRoot});
  const preproductionDir = path.join(project.projectDir, 'preproduction');
  const annotations = readJson(path.join(preproductionDir, 'annotations.json'));
  if (annotations.bpm !== null || annotations.beatAnchors.length > 0 || annotations.cutCues.length > 0) {
    throw new Error('Project A2 must not carry manual timing that could override the approved beat grid');
  }
  const projectJsonBefore = sha256File(path.join(project.projectDir, 'project.json'));
  const audioHashBefore = sha256File(project.audioPath);

  runCli(projectId, 'validate');
  const planWithoutApproval = runCliStatus(projectId, 'plan');

  runCli(projectId, 'analyze-beats');
  const beatGrid = readJson(path.join(preproductionDir, 'beat-grid.json'));
  const candidateView = JSON.parse(runCli(projectId, 'beat-grid-candidates'));
  const planAfterAnalysis = runCliStatus(projectId, 'plan');
  const planCreatedWithoutApproval = existsSync(path.join(preproductionDir, 'director-plan.json'));
  const unacknowledged = runCliStatus(projectId, 'approve-beats', [
    '--interpretation', 'as-estimated',
    '--notes', 'Ambiguity acknowledgement deliberately omitted.',
  ]);

  const approval = JSON.parse(runCli(projectId, 'approve-beats', [
    '--interpretation', 'as-estimated',
    '--acknowledge-ambiguity',
    '--notes', 'Compared the 90 BPM as-estimated candidate with the competing 45 BPM half-tempo reading; the synthetic pulse train is 90 BPM, so as-estimated is the intended interpretation. The frame-zero onset is outside the flux detection domain and is not required for these cuts.',
  ]));
  const approvedPath = path.join(preproductionDir, 'approved-beat-grid.json');
  const approvalHashR001 = sha256File(approvedPath);
  const approvalR001 = sha256File(path.join(preproductionDir, 'revisions', 'approved-beat-grid-r001.json'));

  const planOutput = JSON.parse(runCli(projectId, 'plan'));
  runCli(projectId, 'approve-plan');
  const planPath = path.join(preproductionDir, 'director-plan.json');
  const plan = readJson(planPath);
  const approvedPlanHash = sha256File(planPath);
  runCli(projectId, 'storyboard');
  runCli(projectId, 'approve-storyboard');
  const storyboard = readJson(path.join(preproductionDir, 'storyboard.json'));
  runCli(projectId, 'report-assets');
  runCli(projectId, 'compile');
  const compileReport = readJson(path.join(preproductionDir, 'compile-report.json'));
  const candidate = readJson(path.join(preproductionDir, 'project-candidate.json'));
  const candidateHashBeforeRender = sha256File(path.join(preproductionDir, 'project-candidate.json'));
  runCli(projectId, 'render-preview');
  const output = path.join(project.projectDir, 'renders', 'storyboard-preview.mp4');
  if (!existsSync(output)) throw new Error('Project A2 storyboard preview is missing');
  const renderReport = readJson(path.join(project.projectDir, 'reports', `render-${projectId}-video.json`));

  const probe = ffprobeJson(output);
  const videoStream = (probe.streams || []).find((stream) => stream.codec_type === 'video');
  const audioStreams = (probe.streams || []).filter((stream) => stream.codec_type === 'audio');
  if (!videoStream) throw new Error('Project A2 preview has no video stream');
  const frames = Number(videoStream.nb_frames);

  const allShots = storyboard.chapters.flatMap((chapter) => chapter.shots);
  const beatCuts = allShots
    .filter((shot) => shot.timingSource === 'approved-beat-grid')
    .map((shot) => ({shotId: shot.id, startFrame: shot.startFrame, beatId: shot.cueId}));
  const cutFrames = allShots.map((shot) => shot.startFrame).filter((frame) => frame > 0);
  const cutEvidence = [];
  for (const cut of cutFrames) {
    const before = rawFrame(output, cut - 1, videoStream.width, videoStream.height);
    const at = rawFrame(output, cut, videoStream.width, videoStream.height);
    cutEvidence.push({
      cut,
      changed: Buffer.compare(before, at) !== 0,
      before: averageRgb(before),
      at: averageRgb(at),
      approvedBeatId: beatCuts.find((entry) => entry.startFrame === cut)?.beatId ?? null,
    });
  }

  const detectedBeatFrames = beatGrid.beatEvents.map((event) => event.frame);
  const beatTiming = beatMetrics(detectedBeatFrames, truthBeatFrames, fps);
  const tempoErrorBpm = beatGrid.estimatedTempo
    ? Number(Math.abs(beatGrid.estimatedTempo.bpm - groundTruthBpm).toFixed(3))
    : null;
  const halfTempoCandidate = candidateView.tempoCandidates.find((entry) => entry.relation === 'half');

  // Rendered-cut error against both the approved beat frame and the synthetic
  // ground truth, so an approved estimate is never reported as exact by itself.
  const renderedCuts = beatCuts.map((entry) => {
    const truth = truthBeatFrames.reduce(
      (best, frame) => (Math.abs(frame - entry.startFrame) < Math.abs(best - entry.startFrame) ? frame : best),
      truthBeatFrames[0],
    );
    return {
      shotId: entry.shotId,
      beatId: entry.beatId,
      approvedBeatFrame: entry.startFrame,
      renderedCutFrame: cutEvidence.find((item) => item.cut === entry.startFrame)?.cut ?? null,
      frameErrorVsApprovedBeat: cutEvidence.some((item) => item.cut === entry.startFrame) ? 0 : null,
      groundTruthFrame: truth,
      frameErrorVsGroundTruth: Math.abs(entry.startFrame - truth),
    };
  });

  const decodedAudio = decodeAudioToNormalizedPcm(output, 48000, 'preview');
  const outputBeat = analyzeBeatGrid(stereoToMono(decodedAudio.samples), {
    projectId,
    sourceSha256: project.config.audio.sha256,
    sampleRate: 48000,
    outputFps: fps,
    durationFrames: 120,
  });

  // Approval and revision integrity, checked after the render so the evidence
  // above is bound to the as-estimated approval revision 1.
  const planBlocked = runCliStatus(projectId, 'plan');
  const planRevision = runCliStatus(projectId, 'plan', ['--new-revision']);
  const approvalBlocked = runCliStatus(projectId, 'approve-beats', [
    '--interpretation', 'half-tempo',
    '--acknowledge-ambiguity',
    '--notes', 'Second review must not silently replace the active approval.',
  ]);
  const approvalActiveBeforeRevision = sha256File(approvedPath);
  const approvalRevision = runCliStatus(projectId, 'approve-beats', [
    '--interpretation', 'half-tempo',
    '--acknowledge-ambiguity',
    '--notes', 'Explicit second review revision recorded without discarding revision 1.',
    '--new-revision',
  ]);

  const planRevisionActiveUnchanged = sha256File(planPath) === approvedPlanHash;
  const planAfterRevision = readJson(planPath);
  const r001ApprovalPreserved =
    sha256File(path.join(preproductionDir, 'revisions', 'approved-beat-grid-r001.json')) === approvalR001;
  const candidateUnchanged =
    sha256File(path.join(preproductionDir, 'project-candidate.json')) === candidateHashBeforeRender;
  const activeApprovalAfterRevision = readJson(approvedPath);
  const immutability = {
    'plan without --new-revision is refused': planBlocked.status === 1,
    'active plan stays the approved revision 1':
      planRevisionActiveUnchanged &&
      planAfterRevision.status === 'approved' &&
      planAfterRevision.revision === 1,
    'plan --new-revision succeeds and only writes a revision file':
      planRevision.status === 0 &&
      existsSync(path.join(preproductionDir, 'revisions', 'director-plan-r002.json')) &&
      planRevisionActiveUnchanged,
    'approve-beats without --new-revision is refused': approvalBlocked.status === 1,
    'refused approval left the active approval byte-identical': approvalActiveBeforeRevision === approvalHashR001,
    'approve-beats --new-revision succeeds and writes revision 2':
      approvalRevision.status === 0 &&
      existsSync(path.join(preproductionDir, 'revisions', 'approved-beat-grid-r002.json')) &&
      activeApprovalAfterRevision.selected.approvalRevision === 2,
    'revision 1 approval file is preserved unchanged': r001ApprovalPreserved,
    'compiled candidate used by the render is untouched': candidateUnchanged,
  };

  const timingTrace = [
    {stage: 'synthetic ground-truth rhythm', value: `${groundTruthBpm} BPM, beat frames ${truthBeatFrames.join(', ')}`},
    {stage: 'estimated beat-grid candidate', value: `${beatGrid.estimatedTempo?.bpm} BPM, confidence ${beatGrid.estimatedTempo?.confidence}, quality ${beatGrid.estimatedTempo?.quality}, beats ${detectedBeatFrames.join(', ')}`},
    {stage: 'explicit candidate review/approval', value: `revision ${approval.approvalRevision}, interpretation ${approval.interpretation}, ambiguityAcknowledged ${beatGrid.estimatedTempo?.ambiguity.halfTempo || beatGrid.estimatedTempo?.ambiguity.doubleTempo}`},
    {stage: 'approved timing input', value: `${approval.bpm} BPM, beat frames ${approval.beatFrames.join(', ')}, beat ids ${approval.beatIds.join(', ')}`},
    {stage: 'director shot timing decision', value: beatCuts.map((entry) => `${entry.shotId}@${entry.startFrame}=${entry.beatId}`).join(', ')},
    {stage: 'storyboard frame boundaries', value: allShots.map((shot) => `[${shot.startFrame},${shot.endFrame})`).join(' ')},
    {stage: 'validated render-ready candidate', value: `${compileReport.status} at ${compileReport.candidatePath}`},
    {stage: 'actual rendered video', value: `renders/storyboard-preview.mp4 ${videoStream.width}x${videoStream.height} ${videoStream.r_frame_rate} ${frames} frames`},
    {stage: 'decoded cut-frame verification', value: cutEvidence.map((entry) => `${entry.cut}:${entry.changed ? 'changed' : 'UNCHANGED'}`).join(', ')},
  ];

  const checks = [
    {
      name: 'estimated tempo matches the 90 BPM synthetic ground truth with recorded confidence and ambiguity',
      pass:
        Boolean(beatGrid.estimatedTempo) &&
        tempoErrorBpm !== null &&
        tempoErrorBpm <= 1 &&
        beatGrid.estimatedTempo.quality === 'high' &&
        beatGrid.estimatedTempo.ambiguity.halfTempo === true &&
        Boolean(halfTempoCandidate),
      details: {tempoErrorBpm, estimatedTempo: beatGrid.estimatedTempo, halfTempoCandidate, candidateCount: candidateView.tempoCandidates.length},
    },
    {
      name: 'beat recovery is reported as matched, missed and extra beats, not only maximum matched error',
      pass:
        beatTiming.matchedCount === 5 &&
        beatTiming.missedCount === 1 &&
        beatTiming.missed[0].truthFrame === 0 &&
        beatTiming.extraCount === 0 &&
        beatTiming.maxMatchedErrorFrames === 0 &&
        beatGrid.limitations.includes('frame-zero-onset-not-detected'),
      details: beatTiming,
    },
    {
      name: 'a flagged competing tempo interpretation cannot be approved without explicit acknowledgement',
      pass: unacknowledged.status === 1 && approval.approvalRevision === 1 && approval.interpretation === 'as-estimated',
      details: {unacknowledgedExit: unacknowledged.status, unacknowledgedError: (unacknowledged.stderr || '').trim().split('\n')[0]},
    },
    {
      name: 'an estimated beat grid never becomes director timing without an approval',
      pass:
        planWithoutApproval.status === 1 &&
        planAfterAnalysis.status === 1 &&
        planCreatedWithoutApproval === false &&
        candidateView.approval === 'unapproved' &&
        beatGrid.approval === 'unapproved' &&
        beatGrid.beatEvents.every((event) => event.source === 'estimated' && event.classification === 'estimated'),
      details: {
        planWithoutApprovalExit: planWithoutApproval.status,
        planAfterAnalysisExit: planAfterAnalysis.status,
        planCreatedWithoutApproval,
        planWithoutApprovalError: (planWithoutApproval.stderr || '').trim().split('\n')[0],
        planAfterAnalysisError: (planAfterAnalysis.stderr || '').trim().split('\n')[0],
        beatGridApproval: beatGrid.approval,
      },
    },
    {
      name: 'the approval preserves the estimated candidate provenance and the reviewer selection',
      pass:
        approval.beatFrames.length === beatGrid.beatEvents.length &&
        JSON.stringify(approval.beatFrames) === JSON.stringify(detectedBeatFrames) &&
        JSON.stringify(approval.beatIds) === JSON.stringify(beatGrid.beatEvents.map((event) => event.id)) &&
        approval.candidateBpm === beatGrid.estimatedTempo.bpm &&
        approval.confidence === beatGrid.estimatedTempo.confidence &&
        approval.quality === beatGrid.estimatedTempo.quality &&
        approval.ambiguity.halfTempo === true &&
        readJson(approvedPath).selected.selectedBy === 'user' &&
        readJson(approvedPath).source.algorithmVersion === beatGrid.algorithmVersion &&
        readJson(approvedPath).source.sourceSha256 === project.config.audio.sha256,
      details: {approval, algorithmVersion: beatGrid.algorithmVersion},
    },
    {
      name: 'the director plan is driven by the approved beat grid, not by manual timing',
      pass:
        planOutput.timing.manualTimingUsed === false &&
        planOutput.timing.beatGridUsed === true &&
        planOutput.timing.approvedBeatGridUsed === true &&
        plan.source.approvedBeatGrid?.bpm === approval.bpm &&
        plan.source.approvedBeatGrid?.interpretation === 'as-estimated' &&
        plan.source.approvedBeatGrid?.approvalRevision === 1 &&
        JSON.stringify(plan.source.approvedBeatGrid?.selectedBeatIds) === JSON.stringify(approval.beatIds) &&
        JSON.stringify(plan.source.approvedBeatGrid?.candidateBeatIds) === JSON.stringify(beatGrid.beatEvents.map((event) => event.id)),
      details: {planSource: plan.source, timingNotes: plan.timingNotes},
    },
    {
      name: 'approved beat frames become actual shot boundaries',
      pass:
        beatCuts.length >= 4 &&
        beatCuts.every((entry) => approval.beatFrames.includes(entry.startFrame) && approval.beatIds.includes(entry.beatId)) &&
        JSON.stringify(cutFrames) === JSON.stringify(approval.beatFrames.filter((frame) => frame > 0 && frame < 120)) &&
        allShots.every((shot) => shot.timingSource !== 'manual-beat' && shot.timingSource !== 'manual-bpm' && shot.timingSource !== 'manual-cut'),
      details: {beatCuts, cutFrames, approvedBeatFrames: approval.beatFrames, shotTimingSources: allShots.map((shot) => `${shot.id}:${shot.timingSource}`)},
    },
    {
      name: 'storyboard is approved, render-ready and covers the complete 120-frame duration',
      pass:
        storyboard.status === 'approved' &&
        storyboard.renderReady === true &&
        storyboard.missingAssetRequirements.length === 0 &&
        storyboard.chapters[0].startFrame === 0 &&
        storyboard.chapters[storyboard.chapters.length - 1].endFrame === 120 &&
        allShots.every((shot) => shot.endFrame > shot.startFrame),
      details: {chapters: storyboard.chapters.length, shots: allShots.length, ranges: allShots.map((shot) => [shot.startFrame, shot.endFrame])},
    },
    {
      name: 'compiled candidate preserves master audio, project id, fps, duration and cue identity',
      pass:
        compileReport.status === 'ready' &&
        candidate.projectId === projectId &&
        candidate.audio.sha256 === project.config.audio.sha256 &&
        candidate.output.fps === fps &&
        candidate.output.durationInFrames === 120 &&
        JSON.stringify(candidate.cues) === JSON.stringify(project.config.cues) &&
        JSON.stringify(candidate.chapters.map((chapter) => chapter.shots.map((shot) => [shot.id, shot.startFrame, shot.endFrame]))) ===
          JSON.stringify(storyboard.chapters.map((chapter) => chapter.shots.map((shot) => [shot.id, shot.startFrame, shot.endFrame]))),
      details: {compileReport, candidateCues: candidate.cues},
    },
    {
      name: 'the render actually used the generated candidate config',
      pass:
        renderReport.configPath === 'preproduction/project-candidate.json' &&
        compileReport.candidatePath === 'preproduction/project-candidate.json',
      details: {configPath: renderReport.configPath, candidatePath: compileReport.candidatePath},
    },
    {
      name: 'preview metadata matches the candidate profile',
      pass:
        videoStream.codec_name === 'h264' &&
        videoStream.width === 640 &&
        videoStream.height === 360 &&
        videoStream.r_frame_rate === '30/1' &&
        frames === 120 &&
        audioStreams.length === 1 &&
        Number(audioStreams[0].sample_rate) === 48000,
      details: {video: {codec: videoStream.codec_name, width: videoStream.width, height: videoStream.height, fps: videoStream.r_frame_rate, frames}, audioStreams: audioStreams.length, sampleRate: audioStreams[0]?.sample_rate},
    },
    {
      name: 'every approved beat cut changes decoded visual content',
      pass: cutEvidence.length === 5 && cutEvidence.every((entry) => entry.changed && entry.approvedBeatId !== null),
      details: cutEvidence,
    },
    {
      name: 'rendered cut frames equal the approved beat frames with zero frame error',
      pass:
        renderedCuts.length === 5 &&
        renderedCuts.every((entry) => entry.frameErrorVsApprovedBeat === 0 && entry.frameErrorVsGroundTruth === 0),
      details: renderedCuts,
    },
    {
      name: 'decoded preview soundtrack reproduces the 90 BPM pulse grid',
      pass: Boolean(outputBeat.estimatedTempo) && Math.abs(outputBeat.estimatedTempo.bpm - groundTruthBpm) <= 3,
      details: {outputTempo: outputBeat.estimatedTempo, sourceTempoErrorBpm: tempoErrorBpm},
    },
    {
      name: 'approved plan and approved beat grid are immutable without an explicit new revision',
      pass: Object.values(immutability).every(Boolean),
      details: {
        conditions: immutability,
        planBlockedExit: planBlocked.status,
        planRevisionExit: planRevision.status,
        approvalBlockedExit: approvalBlocked.status,
        approvalRevisionExit: approvalRevision.status,
        planBlockedError: (planBlocked.stderr || '').trim().split('\n')[0],
        approvalBlockedError: (approvalBlocked.stderr || '').trim().split('\n')[0],
        activePlanRevision: planAfterRevision.revision,
        activePlanStatus: planAfterRevision.status,
        revision1ApprovalPreserved: r001ApprovalPreserved,
        activeApprovalAfterExplicitRevision: activeApprovalAfterRevision.selected,
        compiledCandidateUnchanged: candidateUnchanged,
      },
    },
    {
      name: 'source audio and project.json remain unchanged',
      pass: sha256File(project.audioPath) === audioHashBefore && sha256File(path.join(project.projectDir, 'project.json')) === projectJsonBefore,
      details: {audioHashBefore, projectJsonBefore},
    },
  ];

  const record = {
    projectId,
    scenario: 'approved-beat-grid-to-render',
    pass: checks.every((check) => check.pass),
    checks,
    timingTrace,
    beatGrid: {
      path: 'preproduction/beat-grid.json',
      estimatedTempo: beatGrid.estimatedTempo,
      tempoErrorBpm,
      phase: beatGrid.phase,
      candidates: candidateView.tempoCandidates,
      limitations: beatGrid.limitations,
      beatCount: beatGrid.beatEvents.length,
      metrics: beatTiming,
    },
    approval: {path: 'preproduction/approved-beat-grid.json', record: readJson(path.join(preproductionDir, 'revisions', 'approved-beat-grid-r001.json'))},
    plan: {revision: plan.revision, status: plan.status, shots: allShots.length, source: plan.source, timingNotes: plan.timingNotes},
    storyboard: {revision: storyboard.revision, status: storyboard.status, renderReady: storyboard.renderReady, shots: allShots.length},
    compile: {report: compileReport, candidateCues: candidate.cues},
    output: {path: 'renders/storyboard-preview.mp4', bytes: statSync(output).size, video: {width: videoStream.width, height: videoStream.height, fps: videoStream.r_frame_rate, frames}, audioStreams: audioStreams.length, configPath: renderReport.configPath},
    cutEvidence,
    renderedCuts,
  };
  record.report = path.relative(project.projectDir, writeEvidence(project, 'preproduction-evidence.json', record)).split(path.sep).join('/');
  results.push(record);
  console.log(JSON.stringify({projectId, pass: record.pass, checks: checks.map((check) => ({name: check.name, pass: check.pass})), report: record.report}));
}

// Project B: weak rhythm, manual anchors and sections; useful editable storyboard.
{
  const projectId = 'synthetic-uncertain-demo';
  const project = loadProject(projectId, {workspaceRoot, engineRoot: repoRoot});
  const projectJsonBefore = sha256File(path.join(project.projectDir, 'project.json'));
  runCli(projectId, 'validate');
  runCli(projectId, 'analyze-beats');
  const beatGrid = readJson(path.join(project.projectDir, 'preproduction', 'beat-grid.json'));
  runCli(projectId, 'plan');
  runCli(projectId, 'approve-plan');
  const plan = readJson(path.join(project.projectDir, 'preproduction', 'director-plan.json'));
  runCli(projectId, 'storyboard');
  const storyboard = readJson(path.join(project.projectDir, 'preproduction', 'storyboard.json'));
  const allShots = storyboard.chapters.flatMap((chapter) => chapter.shots);
  const manualTiming = allShots.every((shot) => shot.timingSource !== 'estimated-beat');
  const checks = [
    {name: 'weak-rhythm analysis is explicitly low-confidence or tempo-change-suspected', pass: !beatGrid.estimatedTempo || beatGrid.estimatedTempo.quality !== 'high' || beatGrid.limitations.includes('tempo-change-suspected') || beatGrid.limitations.includes('insufficient-rhythmic-evidence'), details: beatGrid.estimatedTempo ? {quality: beatGrid.estimatedTempo.quality, confidence: beatGrid.estimatedTempo.confidence, limitations: beatGrid.limitations} : {estimatedTempo: null, limitations: beatGrid.limitations}},
    {name: 'plan uses approved manual anchors instead of estimated beats', pass: plan.source.manualTimingUsed === true && plan.source.beatGridUsed === false && manualTiming, details: {source: plan.source, shotTiming: allShots.map((shot) => shot.timingSource)}},
    {name: 'manual sections produce contiguous chapter and shot coverage', pass: storyboard.chapters.length === 3 && storyboard.chapters[0].startFrame === 0 && storyboard.chapters[2].endFrame === 120 && allShots.every((shot) => shot.endFrame > shot.startFrame), details: {chapters: storyboard.chapters.length, shots: allShots.length}},
    {name: 'storyboard is editable and has no missing assets', pass: storyboard.status === 'draft' && storyboard.missingAssetRequirements.length === 0 && storyboard.renderReady === true, details: {status: storyboard.status, renderReady: storyboard.renderReady, missing: storyboard.missingAssetRequirements}},
    {name: 'project.json remains unchanged by planning', pass: sha256File(path.join(project.projectDir, 'project.json')) === projectJsonBefore},
  ];
  const record = {projectId, pass: checks.every((check) => check.pass), checks, beatGrid: {estimatedTempo: beatGrid.estimatedTempo, limitations: beatGrid.limitations, candidates: beatGrid.tempoCandidates.slice(0, 3)}, plan: {chapters: plan.chapters.length, shots: plan.chapters.flatMap((chapter) => chapter.shots).length}, storyboard: {chapters: storyboard.chapters.length, shots: allShots.length, renderReady: storyboard.renderReady}};
  record.report = path.relative(project.projectDir, writeEvidence(project, 'preproduction-evidence.json', record)).split(path.sep).join('/');
  results.push(record);
  console.log(JSON.stringify({projectId, pass: record.pass, checks: checks.map((check) => ({name: check.name, pass: check.pass})), report: record.report}));
}

// Project C: lyrics, narrative intent, missing asset, blocked compilation.
{
  const projectId = 'synthetic-lyrics-demo';
  const project = loadProject(projectId, {workspaceRoot, engineRoot: repoRoot});
  const projectJsonBefore = sha256File(path.join(project.projectDir, 'project.json'));
  runCli(projectId, 'validate');
  runCli(projectId, 'analyze-beats');
  runCli(projectId, 'plan');
  runCli(projectId, 'approve-plan');
  const plan = readJson(path.join(project.projectDir, 'preproduction', 'director-plan.json'));
  runCli(projectId, 'storyboard');
  runCli(projectId, 'approve-storyboard');
  const storyboard = readJson(path.join(project.projectDir, 'preproduction', 'storyboard.json'));
  const lyrics = readJson(path.join(project.projectDir, 'preproduction', 'lyrics.json'));
  const assetsStatus = runCliStatus(projectId, 'report-assets');
  const compileStatus = runCliStatus(projectId, 'compile');
  const compileReport = readJson(path.join(project.projectDir, 'preproduction', 'compile-report.json'));
  const assetManifest = readJson(path.join(project.projectDir, 'preproduction', 'asset-requirements.json'));
  const allShots = storyboard.chapters.flatMap((chapter) => chapter.shots);
  const storyboardLyricIds = new Set(allShots.flatMap((shot) => shot.lyricLineIds));
  const expectedLyricIds = lyrics.lines.map((line, index) => `LYRIC-${String(index + 1).padStart(3, '0')}`);
  const checks = [
    {
      name: 'user-authored lyric timestamps and frame mappings are preserved',
      pass:
        lyrics.lines.length === 4 &&
        lyrics.lines.every((line) => Math.round(line.timeSeconds * 24) <= 96) &&
        expectedLyricIds.every((id) => storyboardLyricIds.has(id)),
      details: {lines: lyrics.lines, expectedLyricIds, storyboardLyricIds: [...storyboardLyricIds]},
    },
    {name: 'storyboard associates lyric lines and covers the full duration', pass: allShots.some((shot) => shot.lyricLineIds.length > 0) && storyboard.chapters[0].startFrame === 0 && storyboard.chapters[storyboard.chapters.length - 1].endFrame === 96, details: {lyrics: allShots.map((shot) => shot.lyricLineIds)}},
    {name: 'narrative direction comes from the approved brief', pass: plan.brief.concept === 'A listener in an empty radio city answers a signal that may be its own echo.' && plan.brief.visualStyle === 'filmic illustration', details: plan.brief},
    {name: 'missing asset is reported and cannot be render-ready', pass: storyboard.renderReady === false && storyboard.missingAssetRequirements.includes('REQ-001') && assetManifest.missingAssetRequirements.includes('REQ-001') && assetsStatus.status === 2, details: {storyboard: storyboard.missingAssetRequirements, manifest: assetManifest.missingAssetRequirements, reportStatus: assetsStatus.status}},
    {name: 'compilation is blocked without writing a candidate', pass: compileStatus.status === 2 && compileReport.status === 'blocked' && compileReport.candidatePath === null && !existsSync(path.join(project.projectDir, 'preproduction', 'project-candidate.json')), details: {compileStatus: compileStatus.status, compileReport}},
    {name: 'project.json remains unchanged and the missing-asset candidate is not created', pass: sha256File(path.join(project.projectDir, 'project.json')) === projectJsonBefore && !existsSync(path.join(project.projectDir, 'preproduction', 'project-candidate.json'))},
  ];
  const record = {projectId, pass: checks.every((check) => check.pass), checks, plan: {chapters: plan.chapters.length, shots: allShots.length, concept: plan.brief.concept}, storyboard: {status: storyboard.status, renderReady: storyboard.renderReady, missing: storyboard.missingAssetRequirements}, compile: {status: compileStatus.status, report: compileReport}, lyrics: {language: lyrics.language, lines: lyrics.lines.length}};
  record.report = path.relative(project.projectDir, writeEvidence(project, 'preproduction-evidence.json', record)).split(path.sep).join('/');
  results.push(record);
  console.log(JSON.stringify({projectId, pass: record.pass, checks: checks.map((check) => ({name: check.name, pass: check.pass})), report: record.report}));
}

const pass = results.every((record) => record.pass);
console.log(JSON.stringify({pass, projects: results.map((record) => record.projectId)}, null, 2));
if (!pass) process.exitCode = 1;