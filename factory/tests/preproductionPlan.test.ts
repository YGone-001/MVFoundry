import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {after, before, test} from 'node:test';
import {loadProject} from '../src/project/loadProject';
import {DEFAULT_SCENE_REGISTRY} from '../src/scenes/registry';
import {createProjectWriteBoundary} from '../src/workspace/writeBoundary';
import {generateDirectorPlan} from '../src/preproduction/director';
import {buildApprovedBeatGrid} from '../src/preproduction/beatGrid';
import {
  buildStoryboard,
  validatePlan,
} from '../src/preproduction/storyboard';
import {compileApprovedStoryboard} from '../src/preproduction/compile';
import {
  validateAnnotations,
  validateApprovedBeatGrid,
  validateCreativeBrief,
  validateJsonLyrics,
} from '../src/preproduction/validate';
import type {PreproductionContext} from '../src/preproduction/validate';
import {PREPRODUCTION_PATHS, readProjectJson} from '../src/preproduction/store';
import {BEAT_GRID_ALGORITHM_VERSION} from '../src/preproduction/types';
import type {BeatGridReport} from '../src/preproduction/types';
import {REPO_ROOT} from './helpers';

let workspace: string;

before(() => {
  workspace = mkdtempSync(path.join(tmpdir(), 'mvfoundry-preproduction-plan-'));
  execFileSync(
    process.execPath,
    [path.join(REPO_ROOT, 'factory', 'scripts', 'seed-preproduction-workspace.mjs'), '--root', workspace],
    {encoding: 'utf8', env: {...process.env, MV_WORKSPACE_ROOT: workspace}, windowsHide: true},
  );
});

after(() => {
  rmSync(workspace, {recursive: true, force: true});
});

const loadInputs = (projectId: string, withLyrics = false) => {
  const project = loadProject(projectId, {workspaceRoot: workspace, engineRoot: REPO_ROOT});
  const context: PreproductionContext = {
    projectId,
    fps: project.config.output.fps,
    durationInFrames: project.durationInFrames,
    width: project.config.output.width,
    height: project.config.output.height,
    assets: project.config.assets,
    rendererKinds: new Set([
      ...DEFAULT_SCENE_REGISTRY.kinds(),
      ...project.sceneModules.map((module) => `project:${module.id}`),
    ]),
  };
  const annotations = validateAnnotations(
    readProjectJson(project.projectDir, PREPRODUCTION_PATHS.annotations, {engineRoot: REPO_ROOT}),
    context,
    {requireApproved: true, requireCoverage: true},
  );
  context.sections = annotations.sections;
  const brief = validateCreativeBrief(
    readProjectJson(project.projectDir, PREPRODUCTION_PATHS.brief, {engineRoot: REPO_ROOT}),
    context,
  );
  let lyrics = null;
  if (withLyrics) {
    lyrics = validateJsonLyrics({
      raw: readProjectJson(project.projectDir, PREPRODUCTION_PATHS.lyricsJson, {engineRoot: REPO_ROOT}),
      language: 'en',
      sourcePath: PREPRODUCTION_PATHS.lyricsJson,
      sourceSha256: 'b'.repeat(64),
      context,
    });
  }
  return {project, annotations, brief, lyrics};
};

test('Project A plan, storyboard, and candidate compile are complete and frame-accurate', () => {
  const {project, annotations, brief} = loadInputs('synthetic-beat-demo');
  const projectJson = readFileSync(path.join(project.projectDir, 'project.json'));
  const plan = generateDirectorPlan({
    project,
    brief,
    annotations,
    lyrics: null,
    beatGrid: null,
    approvedBeatGrid: null,
    revision: 1,
  });
  assert.equal(plan.status, 'proposed');
  assert.equal(plan.source.manualTimingUsed, true);
  assert.equal(plan.source.beatGridUsed, false);
  assert.equal(plan.source.approvedBeatGridUsed, false);
  assert.equal(plan.source.approvedBeatGrid, null);
  assert.equal(plan.chapters.length, 3);
  assert.ok(plan.chapters.flatMap((chapter) => chapter.shots).length >= 4);
  assert.ok(
    plan.chapters
      .flatMap((chapter) => chapter.shots)
      .every((shot) => shot.timingSource === 'manual-beat' || shot.timingSource === 'manual-cut'),
  );
  assert.equal(plan.chapters[0].startFrame, 0);
  assert.equal(plan.chapters[plan.chapters.length - 1].endFrame, 120);

  const storyboard = buildStoryboard({
    project,
    plan: {...plan, status: 'approved'},
    annotations,
    lyrics: null,
    revision: 1,
    status: 'approved',
  });
  assert.equal(storyboard.renderReady, true);
  assert.equal(storyboard.missingAssetRequirements.length, 0);
  assert.equal(storyboard.chapters[0].startFrame, 0);
  assert.equal(storyboard.chapters[2].endFrame, 120);

  const boundary = createProjectWriteBoundary(project, {engineRoot: REPO_ROOT});
  const result = compileApprovedStoryboard({
    project,
    storyboard,
    annotations,
    lyrics: null,
    boundary,
  });
  assert.equal(result.report.status, 'ready');
  assert.ok(result.candidate);
  assert.equal(result.candidate?.projectId, 'synthetic-beat-demo');
  assert.equal(result.candidate?.audio.sha256, project.config.audio.sha256);
  assert.equal(result.candidate?.output.fps, 30);
  assert.equal(result.candidate?.output.durationInFrames, 120);
  assert.deepEqual(
    result.candidate?.chapters.map((chapter) => chapter.shots.map((shot) => [shot.id, shot.startFrame, shot.endFrame])),
    storyboard.chapters.map((chapter) => chapter.shots.map((shot) => [shot.id, shot.startFrame, shot.endFrame])),
  );
  assert.deepEqual(readFileSync(path.join(project.projectDir, 'project.json')), projectJson);
});

test('Project B uses approved manual anchors and produces an editable storyboard', () => {
  const {project, annotations, brief} = loadInputs('synthetic-uncertain-demo');
  const plan = generateDirectorPlan({
    project,
    brief,
    annotations,
    lyrics: null,
    beatGrid: null,
    approvedBeatGrid: null,
    revision: 1,
  });
  assert.equal(plan.source.manualTimingUsed, true);
  assert.equal(plan.source.beatGridUsed, false);
  assert.equal(plan.chapters.length, 3);
  const shots = plan.chapters.flatMap((chapter) => chapter.shots);
  assert.ok(shots.every((shot) => shot.timingSource !== 'approved-beat-grid'));
  assert.ok(shots.some((shot) => shot.timingSource === 'manual-beat' || shot.timingSource === 'manual-cut'));
  const storyboard = buildStoryboard({
    project,
    plan: {...plan, status: 'approved'},
    annotations,
    lyrics: null,
    revision: 1,
  });
  assert.equal(storyboard.status, 'draft');
  assert.equal(storyboard.renderReady, true);
  assert.equal(storyboard.chapters[0].startFrame, 0);
  assert.equal(storyboard.chapters[2].endFrame, 120);
});

test('Project C preserves lyric associations and blocks compilation on missing assets', () => {
  const {project, annotations, brief, lyrics} = loadInputs('synthetic-lyrics-demo', true);
  assert.ok(lyrics);
  assert.equal(lyrics?.lines.length, 4);
  const plan = generateDirectorPlan({
    project,
    brief,
    annotations,
    lyrics,
    beatGrid: null,
    approvedBeatGrid: null,
    revision: 1,
  });
  assert.equal(plan.assetRequirements.length, 1);
  assert.equal(plan.assetRequirements[0].status, 'needed');
  assert.equal(plan.source.lyricLineCount, 4);
  const storyboard = buildStoryboard({
    project,
    plan: {...plan, status: 'approved'},
    annotations,
    lyrics,
    revision: 1,
    status: 'approved',
  });
  assert.equal(storyboard.renderReady, false);
  assert.deepEqual(storyboard.missingAssetRequirements, ['REQ-001']);
  assert.ok(
    storyboard.chapters
      .flatMap((chapter) => chapter.shots)
      .some((shot) => shot.lyricLineIds.length > 0),
  );
  const boundary = createProjectWriteBoundary(project, {engineRoot: REPO_ROOT});
  const result = compileApprovedStoryboard({
    project,
    storyboard,
    annotations,
    lyrics,
    boundary,
  });
  assert.equal(result.report.status, 'blocked');
  assert.equal(result.candidate, null);
  assert.equal(result.report.candidatePath, null);
  assert.deepEqual(result.report.missingAssetRequirements, ['REQ-001']);
});

const beatFrames = [20, 40, 60, 80, 100];

// A measured-grid stand-in with the same shape the analyzer emits for the 90 BPM
// synthetic fixture, so the approval-to-timing path is testable without FFmpeg.
const estimatedGrid = (projectId: string, sourceSha256: string): BeatGridReport => {
  const confidence = 0.818619;
  return {
    schemaVersion: 1,
    projectId,
    algorithmVersion: BEAT_GRID_ALGORITHM_VERSION,
    sourceSha256,
    sampleRate: 48000,
    outputFps: 30,
    durationFrames: 120,
    parameters: {frameSize: 1024, hopSize: 256, minBpm: 40, maxBpm: 240, bpmStep: 0.5, onsetThreshold: 0.05},
    onsetStrength: {frameCount: 750, mean: 0.012, max: 0.302646, activeFrames: 34},
    tempoCandidates: [
      {bpm: 90, lagHops: 125, periodicity: 0.91, harmonicScore: 0.55, score: 0.83, relation: 'none'},
      {bpm: 45, lagHops: 250, periodicity: 0.62, harmonicScore: 0.3, score: 0.55, relation: 'half'},
    ],
    estimatedTempo: {
      bpm: 90,
      confidence,
      quality: 'high',
      ambiguity: {
        halfTempo: true,
        doubleTempo: false,
        offbeatOnsets: 6,
        notes: ['A half-tempo candidate is close in score; manual confirmation may be required.'],
      },
    },
    phase: {offsetHops: 122, offsetSeconds: 0.650667, score: 0.252205, contrast: 0.950237},
    beatEvents: beatFrames.map((frame, index) => ({
      id: `BEAT-${String(index + 1).padStart(3, '0')}`,
      timeSeconds: frame / 30,
      frame,
      strength: 0.18,
      source: 'estimated',
      classification: 'estimated',
      confidence,
    })),
    evidence: {
      onsetCount: 34,
      beatCount: beatFrames.length,
      meanIntervalFrames: 20,
      intervalJitterFrames: 0,
      tempoChangeSuspected: false,
    },
    limitations: [
      'constant-tempo-only',
      'half-tempo-ambiguous',
      'offbeat-transients-present',
      'frame-zero-onset-not-detected',
    ],
    status: 'estimated',
    approval: 'unapproved',
  };
};

test('Project A2 routes an approved beat-grid candidate into shot timing and a render-ready candidate', () => {
  const {project, annotations, brief} = loadInputs('synthetic-beat-grid-demo');
  assert.equal(annotations.bpm, null);
  assert.equal(annotations.beatAnchors.length, 0);
  assert.equal(annotations.cutCues.length, 0);
  assert.equal(brief.pacing.allowBeatCuts, true);

  const grid = estimatedGrid('synthetic-beat-grid-demo', project.config.audio.sha256);
  const approvalContext = {
    projectId: 'synthetic-beat-grid-demo',
    fps: 30,
    durationInFrames: project.durationInFrames,
    sourceSha256: project.config.audio.sha256,
    beatGridPath: PREPRODUCTION_PATHS.beatGrid,
  };
  const input = (ambiguityAcknowledged: boolean) => ({
    projectId: 'synthetic-beat-grid-demo',
    beatGridPath: PREPRODUCTION_PATHS.beatGrid,
    interpretation: 'as-estimated' as const,
    reviewNotes: 'Selected 90 BPM over the competing 45 BPM half-tempo reading.',
    approvalRevision: 1,
    ambiguityAcknowledged,
  });

  assert.throws(
    () => generateDirectorPlan({project, brief, annotations, lyrics: null, beatGrid: grid, approvedBeatGrid: null, revision: 1}),
    /No approved timing source/,
  );
  assert.throws(() => buildApprovedBeatGrid(grid, input(false)), /competing tempo interpretations/);

  const approved = buildApprovedBeatGrid(grid, input(true));
  assert.equal(validateApprovedBeatGrid(approved, approvalContext, grid).selected.bpm, 90);

  const plan = generateDirectorPlan({
    project,
    brief,
    annotations,
    lyrics: null,
    beatGrid: grid,
    approvedBeatGrid: approved,
    revision: 1,
  });
  assert.equal(plan.source.manualTimingUsed, false);
  assert.equal(plan.source.beatGridUsed, true);
  assert.equal(plan.source.approvedBeatGridUsed, true);
  assert.equal(plan.source.approvedBeatGrid?.bpm, 90);
  assert.equal(plan.source.approvedBeatGrid?.interpretation, 'as-estimated');
  assert.equal(plan.source.approvedBeatGrid?.approvalRevision, 1);
  assert.deepEqual(plan.source.approvedBeatGrid?.candidateBeatIds, grid.beatEvents.map((beat) => beat.id));
  const shots = plan.chapters.flatMap((chapter) => chapter.shots);
  const beatCuts = shots.filter((shot) => shot.timingSource === 'approved-beat-grid');
  assert.deepEqual(beatCuts.map((shot) => shot.startFrame), beatFrames);
  assert.deepEqual(beatCuts.map((shot) => shot.cueId), grid.beatEvents.map((beat) => beat.id));
  assert.equal(shots[0].timingSource, 'project-cue');
  assert.ok(shots.every((shot) => shot.timingSource !== 'manual-beat' && shot.timingSource !== 'manual-cut'));

  const storyboard = buildStoryboard({
    project,
    plan: {...plan, status: 'approved'},
    annotations,
    lyrics: null,
    revision: 1,
    status: 'approved',
  });
  assert.equal(storyboard.source.beatGridUsed, true);
  assert.equal(storyboard.source.manualTimingUsed, false);
  assert.equal(storyboard.renderReady, true);
  assert.deepEqual(
    storyboard.chapters.flatMap((chapter) => chapter.shots).map((shot) => [shot.startFrame, shot.endFrame]),
    shots.map((shot) => [shot.startFrame, shot.endFrame]),
  );

  const boundary = createProjectWriteBoundary(project, {engineRoot: REPO_ROOT});
  const result = compileApprovedStoryboard({project, storyboard, annotations, lyrics: null, boundary});
  assert.equal(result.report.status, 'ready');
  assert.ok(result.candidate);
  assert.equal(result.candidate?.audio.sha256, project.config.audio.sha256);
  assert.deepEqual(
    result.candidate?.chapters.flatMap((chapter) => chapter.shots).map((shot) => shot.startFrame),
    [0, ...beatFrames],
  );
});

test('a beat-grid timing claim that no approval selected is rejected by plan validation', () => {
  const {project, annotations, brief} = loadInputs('synthetic-beat-grid-demo');
  const grid = estimatedGrid('synthetic-beat-grid-demo', project.config.audio.sha256);
  const approved = buildApprovedBeatGrid(grid, {
    projectId: 'synthetic-beat-grid-demo',
    beatGridPath: PREPRODUCTION_PATHS.beatGrid,
    interpretation: 'as-estimated',
    reviewNotes: 'Selected 90 BPM over the competing 45 BPM half-tempo reading.',
    approvalRevision: 1,
    ambiguityAcknowledged: true,
  });
  const plan = generateDirectorPlan({
    project,
    brief,
    annotations,
    lyrics: null,
    beatGrid: grid,
    approvedBeatGrid: approved,
    revision: 1,
  });
  const tampered = JSON.parse(JSON.stringify(plan)) as {
    chapters: Array<{shots: Array<{timingSource: string; cueId: string | null}>}>;
  };
  const target = tampered.chapters[0].shots[1];
  target.cueId = 'BEAT-999';
  assert.throws(
    () => validatePlan(tampered, project, annotations, null),
    /approved beat-grid timing/,
  );
  const dropped = JSON.parse(JSON.stringify(plan)) as {
    source: {approvedBeatGrid: null};
    chapters: Array<{shots: Array<{timingSource: string}>}>;
  };
  dropped.source.approvedBeatGrid = null;
  assert.throws(
    () => validatePlan(dropped, project, annotations, null),
    /approvedBeatGridUsed must match/,
  );
});