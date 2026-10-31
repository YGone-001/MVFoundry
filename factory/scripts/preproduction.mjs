// Local music-aware preproduction CLI.
// Usage: npm run preproduction -- <command> --project <id> [--workspace <root>]
// Requires: npm run build and MV_WORKSPACE_ROOT or --workspace.

import {createHash} from 'node:crypto';
import {existsSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const args = process.argv.slice(2);
const command = args[0];
const arg = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : fallback;
};
const hasFlag = (name) => args.includes(`--${name}`);
const projectId = arg('project');
const workspaceRoot = arg('workspace', process.env.MV_WORKSPACE_ROOT);

if (!command || command === '--help' || command === 'help') {
  console.log(`Commands:
  analyze-beats --project <id>
  beat-grid-candidates --project <id>
  approve-beats --project <id> --interpretation <as-estimated|half-tempo> --notes "<review>" [--acknowledge-ambiguity] [--new-revision]
  validate --project <id>
  plan --project <id> [--new-revision]
  approve-plan --project <id> [--revision N]
  storyboard --project <id> [--new-revision]
  approve-storyboard --project <id> [--revision N]
  report-assets --project <id>
  compile --project <id>
  render-preview --project <id> [--frames A-B]

All commands accept --workspace <external-root> or MV_WORKSPACE_ROOT.
Preproduction files live under <project>/preproduction/.
A beat grid is estimated evidence; only approve-beats can turn one measured
interpretation into timing the director planner is allowed to use.`);
  process.exit(command ? 0 : 2);
}
if (!projectId) {
  console.error('--project is required');
  process.exit(2);
}
if (!workspaceRoot) {
  console.error('MV_WORKSPACE_ROOT or --workspace is required');
  process.exit(2);
}

const {loadProject} = require('../dist/src/project/loadProject.js');
const {decodeAudioToNormalizedPcm} = require('../dist/src/media/audioDecode.js');
const {stereoToMono} = require('../dist/src/audio/analysis.js');
const {DEFAULT_SCENE_REGISTRY} = require('../dist/src/scenes/registry.js');
const {createProjectWriteBoundary} = require('../dist/src/workspace/writeBoundary.js');
const {analyzeBeatGrid, buildApprovedBeatGrid} = require('../dist/src/preproduction/beatGrid.js');
const {
  validateAnnotations,
  validateApprovedBeatGrid,
  validateBeatGridReport,
  validateCreativeBrief,
  validateJsonLyrics,
  parseLrcLyrics,
} = require('../dist/src/preproduction/validate.js');
const {
  PREPRODUCTION_PATHS,
  readOptionalProjectJson,
  readOptionalProjectText,
  readProjectJson,
  revisionPath,
  writeProjectJson,
} = require('../dist/src/preproduction/store.js');
const {generateDirectorPlan} = require('../dist/src/preproduction/director.js');
const {
  buildStoryboard,
  validatePlan,
  validateStoryboard,
} = require('../dist/src/preproduction/storyboard.js');
const {compileApprovedStoryboard} = require('../dist/src/preproduction/compile.js');

const fail = (message) => {
  const error = new Error(message);
  error.preproduction = true;
  throw error;
};

const revisionNumber = () => {
  const value = arg('revision');
  if (value === undefined) return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) fail('--revision must be a positive integer');
  return parsed;
};

// Beat evidence is read without promoting anything: a stale or invalid approval
// is reported, never silently repaired, so re-analysis and re-approval always
// remain possible.
const loadBeatEvidence = () => {
  const project = loadProject(projectId, {workspaceRoot, engineRoot: repoRoot});
  const boundary = createProjectWriteBoundary(project, {engineRoot: repoRoot});
  const gridContext = {
    projectId,
    fps: project.config.output.fps,
    durationInFrames: project.durationInFrames,
    sourceSha256: project.config.audio.sha256,
    beatGridPath: PREPRODUCTION_PATHS.beatGrid,
  };
  const beatGridRaw = readOptionalProjectJson(project.projectDir, PREPRODUCTION_PATHS.beatGrid, {engineRoot: repoRoot});
  const beatGrid = beatGridRaw
    ? validateBeatGridReport(beatGridRaw, gridContext)
    : null;
  const approvedBeatGridRaw = readOptionalProjectJson(
    project.projectDir,
    PREPRODUCTION_PATHS.approvedBeatGrid,
    {engineRoot: repoRoot},
  );
  if (approvedBeatGridRaw === null) {
    return {project, boundary, beatGrid, approvalPresent: false, approvedBeatGrid: null, approvalError: null};
  }
  try {
    return {
      project,
      boundary,
      beatGrid,
      approvalPresent: true,
      approvedBeatGrid: validateApprovedBeatGrid(approvedBeatGridRaw, gridContext, beatGrid),
      approvalError: null,
    };
  } catch (error) {
    return {
      project,
      boundary,
      beatGrid,
      approvalPresent: true,
      approvedBeatGrid: null,
      approvalError: error instanceof Error ? error.message : String(error),
    };
  }
};

const loadInputs = ({requireApproved = false} = {}) => {
  const project = loadProject(projectId, {workspaceRoot, engineRoot: repoRoot});
  const boundary = createProjectWriteBoundary(project, {engineRoot: repoRoot});
  const context = {
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
  const annotationsRaw = readProjectJson(project.projectDir, PREPRODUCTION_PATHS.annotations, {engineRoot: repoRoot});
  const annotations = validateAnnotations(annotationsRaw, context, {
    requireApproved,
    requireCoverage: false,
  });
  context.sections = annotations.sections;
  const briefRaw = readProjectJson(project.projectDir, PREPRODUCTION_PATHS.brief, {engineRoot: repoRoot});
  const brief = validateCreativeBrief(briefRaw, {...context, sections: annotations.sections});
  if (requireApproved && brief.approval !== 'approved') {
    fail('creative brief must be approved before planning');
  }
  if (requireApproved && !annotations.sections.every((section) => section.approval === 'approved')) {
    fail('annotations.sections must all be approved before planning');
  }
  const lyricsJsonText = readOptionalProjectText(project.projectDir, PREPRODUCTION_PATHS.lyricsJson, {engineRoot: repoRoot});
  const lyricsLrcText = readOptionalProjectText(project.projectDir, PREPRODUCTION_PATHS.lyricsLrc, {engineRoot: repoRoot});
  let lyrics = null;
  if (lyricsJsonText !== null) {
    lyrics = validateJsonLyrics({
      raw: JSON.parse(lyricsJsonText.replace(/^\uFEFF/, '')),
      language: project.config.lyrics.language === 'none' ? 'und' : project.config.lyrics.language,
      sourcePath: PREPRODUCTION_PATHS.lyricsJson,
      sourceSha256: createHash('sha256').update(lyricsJsonText).digest('hex'),
      context: {...context, sections: annotations.sections},
    });
  } else if (lyricsLrcText !== null) {
    lyrics = parseLrcLyrics({
      text: lyricsLrcText,
      language: project.config.lyrics.language === 'none' ? 'und' : project.config.lyrics.language,
      sourcePath: PREPRODUCTION_PATHS.lyricsLrc,
      sourceSha256: createHash('sha256').update(lyricsLrcText).digest('hex'),
      approval: 'approved',
      context: {...context, sections: annotations.sections},
    });
  }
  if (requireApproved && lyrics && lyrics.approval !== 'approved') {
    fail('lyrics must be approved before planning');
  }
  const evidence = loadBeatEvidence();
  if (evidence.approvalError) {
    fail(`Approved beat grid is not valid against the current beat grid: ${evidence.approvalError}`);
  }
  return {
    project,
    boundary,
    annotations,
    brief,
    lyrics,
    beatGrid: evidence.beatGrid,
    approvedBeatGrid: evidence.approvedBeatGrid,
    approvalError: evidence.approvalError,
    context,
  };
};

const activeOrRevision = (kind, activePath) => {
  const revision = revisionNumber();
  if (revision === null) {
    const active = readOptionalProjectJson(projectId === undefined ? '' : loadProjectProjectDir(), activePath, {engineRoot: repoRoot});
    if (!active) fail(`No active ${kind} found; run the generation command first`);
    return {raw: active, path: activePath, revision: null};
  }
  const file = revisionPath(kind, revision);
  const raw = readOptionalProjectJson(loadProjectProjectDir(), file, {engineRoot: repoRoot});
  if (!raw) fail(`No ${kind} revision ${revision} found at ${file}`);
  return {raw, path: file, revision};
};

const loadProjectProjectDir = () => {
  const project = loadProject(projectId, {workspaceRoot, engineRoot: repoRoot});
  return project.projectDir;
};

const writeRevisionAndActive = (boundary, kind, value, active, writeActive) => {
  writeProjectJson(boundary, revisionPath(kind, value.revision), value);
  if (writeActive) writeProjectJson(boundary, active, value);
};

const run = () => {
  if (command === 'analyze-beats') {
    const {project, boundary, beatGrid, approvalPresent, approvalError} = loadBeatEvidence();
    const normalized = decodeAudioToNormalizedPcm(project.audioPath, project.config.audio.mixSampleRate, 'master');
    const report = analyzeBeatGrid(stereoToMono(normalized.samples), {
      projectId,
      sourceSha256: project.config.audio.sha256,
      sampleRate: normalized.sampleRate,
      outputFps: project.config.output.fps,
      durationFrames: project.durationInFrames,
    });
    writeProjectJson(boundary, PREPRODUCTION_PATHS.beatGrid, report);
    console.log(JSON.stringify({
      projectId,
      beatGrid: PREPRODUCTION_PATHS.beatGrid,
      algorithmVersion: report.algorithmVersion,
      estimatedTempo: report.estimatedTempo,
      phase: report.phase,
      candidates: report.tempoCandidates,
      beatCount: report.beatEvents.length,
      beatFrames: report.beatEvents.map((event) => event.frame),
      beatIds: report.beatEvents.map((event) => event.id),
      limitations: report.limitations,
      approval: 'unapproved',
      previousBeatGridWasPresent: beatGrid !== null,
      approvalWasPresent: approvalPresent,
      approvalRemainsValid: approvalPresent ? approvalError === null : null,
      approvalError,
      note: 'Reanalysis never promotes an estimate; review the candidates with approve-beats before planning.',
    }, null, 2));
    return 0;
  }

  if (command === 'beat-grid-candidates') {
    const {project, beatGrid, approvedBeatGrid, approvalPresent, approvalError} = loadBeatEvidence();
    if (!beatGrid) fail(`No beat grid found at ${PREPRODUCTION_PATHS.beatGrid}; run analyze-beats first`);
    console.log(JSON.stringify({
      projectId,
      audioSha256: project.config.audio.sha256,
      status: beatGrid.status,
      approval: beatGrid.approval,
      algorithmVersion: beatGrid.algorithmVersion,
      estimatedTempo: beatGrid.estimatedTempo,
      tempoCandidates: beatGrid.tempoCandidates,
      evidence: beatGrid.evidence,
      limitations: beatGrid.limitations,
      beats: beatGrid.beatEvents.map((event) => ({id: event.id, frame: event.frame, strength: event.strength})),
      approved: approvedBeatGrid
        ? {
            path: PREPRODUCTION_PATHS.approvedBeatGrid,
            interpretation: approvedBeatGrid.selected.interpretation,
            bpm: approvedBeatGrid.selected.bpm,
            approvalRevision: approvedBeatGrid.selected.approvalRevision,
          }
        : null,
      approvalPresent,
      approvalError,
    }, null, 2));
    return 0;
  }

  if (command === 'approve-beats') {
    const {project, boundary, beatGrid} = loadBeatEvidence();
    if (!beatGrid) fail(`No beat grid found at ${PREPRODUCTION_PATHS.beatGrid}; run analyze-beats first`);
    const interpretation = arg('interpretation');
    if (interpretation !== 'as-estimated' && interpretation !== 'half-tempo') {
      fail('--interpretation must be as-estimated or half-tempo');
    }
    const reviewNotes = arg('notes');
    if (!reviewNotes) fail('--notes is required: record the review that produced this approval');
    const existingRaw = readOptionalProjectJson(project.projectDir, PREPRODUCTION_PATHS.approvedBeatGrid, {engineRoot: repoRoot});
    if (existingRaw && !hasFlag('new-revision')) {
      fail('An approved beat grid exists; pass --new-revision to record a new approval revision without losing the current one');
    }
    const revision = revisionNumber() ?? (existingRaw ? Number(existingRaw.selected.approvalRevision) + 1 : 1);
    const approved = buildApprovedBeatGrid(beatGrid, {
      projectId,
      beatGridPath: PREPRODUCTION_PATHS.beatGrid,
      interpretation,
      reviewNotes,
      approvalRevision: revision,
      ambiguityAcknowledged: hasFlag('acknowledge-ambiguity'),
    });
    const activeUpdated = !existingRaw || hasFlag('new-revision');
    writeProjectJson(boundary, revisionPath('approved-beat-grid', revision), approved);
    if (activeUpdated) writeProjectJson(boundary, PREPRODUCTION_PATHS.approvedBeatGrid, approved);
    console.log(JSON.stringify({
      projectId,
      approvalRevision: revision,
      interpretation,
      bpm: approved.selected.bpm,
      beatFrames: approved.selected.beatFrames,
      beatIds: approved.selected.beatIds,
      candidateBpm: approved.source.candidateBpm,
      confidence: approved.source.confidence,
      quality: approved.source.quality,
      ambiguity: approved.source.ambiguity,
      revisionPath: revisionPath('approved-beat-grid', revision),
      activePath: activeUpdated ? PREPRODUCTION_PATHS.approvedBeatGrid : null,
      activeUpdated,
    }, null, 2));
    return 0;
  }

  if (command === 'validate') {
    const {annotations, brief, lyrics, beatGrid, approvedBeatGrid} = loadInputs();
    console.log(JSON.stringify({
      projectId,
      annotations: {
        bpm: annotations.bpm,
        beatAnchors: annotations.beatAnchors.length,
        cutCues: annotations.cutCues.length,
        sections: annotations.sections.length,
      },
      brief: {approval: brief.approval, concept: brief.concept, renderers: brief.preferredRenderers},
      lyrics: lyrics ? {language: lyrics.language, lines: lyrics.lines.length, approval: lyrics.approval} : null,
      beatGrid: beatGrid ? {quality: beatGrid.estimatedTempo?.quality ?? 'insufficient', bpm: beatGrid.estimatedTempo?.bpm ?? null, approval: beatGrid.approval} : null,
      approvedBeatGrid: approvedBeatGrid
        ? {interpretation: approvedBeatGrid.selected.interpretation, bpm: approvedBeatGrid.selected.bpm, beats: approvedBeatGrid.selected.beatFrames.length, approvalRevision: approvedBeatGrid.selected.approvalRevision}
        : null,
    }, null, 2));
    return 0;
  }

  if (command === 'plan') {
    const {project, boundary, annotations, brief, lyrics, beatGrid, approvedBeatGrid} = loadInputs({requireApproved: true});
    const existing = readOptionalProjectJson(project.projectDir, PREPRODUCTION_PATHS.plan, {engineRoot: repoRoot});
    if (existing?.status === 'approved' && !hasFlag('new-revision')) {
      fail('An approved director plan exists; pass --new-revision to propose a revision without overwriting it');
    }
    const revision = existing ? Number(existing.revision) + 1 : 1;
    const plan = generateDirectorPlan({
      project,
      brief,
      annotations,
      lyrics,
      beatGrid,
      approvedBeatGrid,
      revision,
    });
    writeRevisionAndActive(
      boundary,
      'director-plan',
      plan,
      PREPRODUCTION_PATHS.plan,
      !(existing?.status === 'approved' && hasFlag('new-revision')),
    );
    const activeUpdated = !(existing?.status === 'approved' && hasFlag('new-revision'));
    console.log(JSON.stringify({
      projectId,
      revision: plan.revision,
      status: plan.status,
      revisionPath: revisionPath('director-plan', plan.revision),
      activePath: activeUpdated ? PREPRODUCTION_PATHS.plan : null,
      activeUpdated,
      chapters: plan.chapters.length,
      shots: plan.chapters.reduce((sum, chapter) => sum + chapter.shots.length, 0),
      timing: {
        manualTimingUsed: plan.source.manualTimingUsed,
        beatGridUsed: plan.source.beatGridUsed,
        approvedBeatGridUsed: plan.source.approvedBeatGridUsed,
        approvedBeatGrid: plan.source.approvedBeatGrid,
      },
      timingNotes: plan.timingNotes,
      requirements: plan.assetRequirements.length,
    }, null, 2));
    return 0;
  }

  if (command === 'approve-plan') {
    const {project, boundary, annotations, lyrics} = loadInputs();
    const source = activeOrRevision('director-plan', PREPRODUCTION_PATHS.plan);
    const plan = validatePlan(source.raw, project, annotations, lyrics);
    if (plan.status === 'rejected') fail('A rejected plan cannot be approved without a new revision');
    const approved = {...plan, status: 'approved'};
    writeRevisionAndActive(boundary, 'director-plan', approved, PREPRODUCTION_PATHS.plan, true);
    console.log(JSON.stringify({projectId, revision: approved.revision, status: approved.status, output: PREPRODUCTION_PATHS.plan}, null, 2));
    return 0;
  }

  if (command === 'storyboard') {
    const {project, boundary, annotations, lyrics, beatGrid} = loadInputs({requireApproved: true});
    const plan = readOptionalProjectJson(project.projectDir, PREPRODUCTION_PATHS.plan, {engineRoot: repoRoot});
    if (!plan) fail('No director plan found; run plan and approve-plan first');
    if (plan.status !== 'approved') fail('The active director plan must be approved before storyboard generation');
    const validatedPlan = validatePlan(plan, project, annotations, lyrics);
    const existing = readOptionalProjectJson(project.projectDir, PREPRODUCTION_PATHS.storyboard, {engineRoot: repoRoot});
    if (existing?.status === 'approved' && !hasFlag('new-revision')) {
      fail('An approved storyboard exists; pass --new-revision to draft a revision without overwriting it');
    }
    const revision = existing ? Number(existing.revision) + 1 : 1;
    const storyboard = buildStoryboard({
      project,
      plan: validatedPlan,
      annotations,
      lyrics,
      revision,
      status: 'draft',
    });
    writeRevisionAndActive(
      boundary,
      'storyboard',
      storyboard,
      PREPRODUCTION_PATHS.storyboard,
      !(existing?.status === 'approved' && hasFlag('new-revision')),
    );
    const activeUpdated = !(existing?.status === 'approved' && hasFlag('new-revision'));
    console.log(JSON.stringify({
      projectId,
      revision: storyboard.revision,
      status: storyboard.status,
      revisionPath: revisionPath('storyboard', storyboard.revision),
      activePath: activeUpdated ? PREPRODUCTION_PATHS.storyboard : null,
      activeUpdated,
      renderReady: storyboard.renderReady,
      missingAssetRequirements: storyboard.missingAssetRequirements,
      shots: storyboard.chapters.reduce((sum, chapter) => sum + chapter.shots.length, 0),
      beatGridPresent: beatGrid !== null,
    }, null, 2));
    return 0;
  }

  if (command === 'approve-storyboard') {
    const {project, boundary, annotations, lyrics} = loadInputs();
    const source = activeOrRevision('storyboard', PREPRODUCTION_PATHS.storyboard);
    const storyboard = validateStoryboard(source.raw, project, annotations, lyrics);
    if (storyboard.status === 'rejected') fail('A rejected storyboard cannot be approved without a new revision');
    const approved = {...storyboard, status: 'approved'};
    writeRevisionAndActive(boundary, 'storyboard', approved, PREPRODUCTION_PATHS.storyboard, true);
    console.log(JSON.stringify({
      projectId,
      revision: approved.revision,
      status: approved.status,
      renderReady: approved.renderReady,
      missingAssetRequirements: approved.missingAssetRequirements,
      output: PREPRODUCTION_PATHS.storyboard,
    }, null, 2));
    return 0;
  }

  if (command === 'report-assets') {
    const {project, boundary, annotations, lyrics} = loadInputs();
    const storyboardRaw = readOptionalProjectJson(project.projectDir, PREPRODUCTION_PATHS.storyboard, {engineRoot: repoRoot});
    if (!storyboardRaw) fail('No storyboard found; run storyboard first');
    const storyboard = validateStoryboard(storyboardRaw, project, annotations, lyrics);
    const manifest = {
      schemaVersion: 1,
      projectId,
      storyboardRevision: storyboard.revision,
      renderReady: storyboard.renderReady,
      requirements: storyboard.assetRequirements,
      missingAssetRequirements: storyboard.missingAssetRequirements,
      notes: [
        'A requirement is not an asset. Only an approved, hash-verified local file or declared scene module fulfils it.',
        'Provider prompts or planned media are not generated or uploaded in this phase.',
      ],
    };
    writeProjectJson(boundary, PREPRODUCTION_PATHS.assetRequirements, manifest);
    console.log(JSON.stringify({projectId, output: PREPRODUCTION_PATHS.assetRequirements, renderReady: storyboard.renderReady, missingAssetRequirements: storyboard.missingAssetRequirements, requirements: storyboard.assetRequirements.length}, null, 2));
    return storyboard.renderReady ? 0 : 2;
  }

  if (command === 'compile') {
    const {project, boundary, annotations, lyrics} = loadInputs();
    const storyboardRaw = readOptionalProjectJson(project.projectDir, PREPRODUCTION_PATHS.storyboard, {engineRoot: repoRoot});
    if (!storyboardRaw) fail('No storyboard found; run storyboard and approve-storyboard first');
    const storyboard = validateStoryboard(storyboardRaw, project, annotations, lyrics);
    const result = compileApprovedStoryboard({project, storyboard, annotations, lyrics, boundary});
    console.log(JSON.stringify(result.report, null, 2));
    return result.report.status === 'ready' ? 0 : 2;
  }

  if (command === 'render-preview') {
    const compileReport = readOptionalProjectJson(projectId === undefined ? '' : loadProjectProjectDir(), PREPRODUCTION_PATHS.compileReport, {engineRoot: repoRoot});
    if (!compileReport) fail('No compile report found; run compile first');
    if (compileReport.status !== 'ready' || !compileReport.candidatePath) {
      fail('Storyboard is not compiled as render-ready; missing assets or approval are unresolved');
    }
    const project = loadProject(projectId, {workspaceRoot, engineRoot: repoRoot, configPath: compileReport.candidatePath});
    const frames = arg('frames', `0-${project.durationInFrames - 1}`);
    const [startText, endText] = frames.split('-');
    const start = Number(startText);
    const end = Number(endText ?? startText);
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end >= project.durationInFrames) {
      fail(`Invalid --frames ${frames} for ${project.durationInFrames} frames`);
    }
    const renderScript = path.join(repoRoot, 'factory', 'scripts', 'render-project.mjs');
    const result = spawnSync(
      process.execPath,
      [
        renderScript,
        '--project', projectId,
        '--workspace', workspaceRoot,
        '--config', compileReport.candidatePath,
        '--mode', 'video',
        '--frames', `${start}-${end}`,
        '--out', 'storyboard-preview.mp4',
      ],
      {cwd: repoRoot, env: process.env, stdio: 'inherit', windowsHide: true},
    );
    if (result.status !== 0) fail(`Storyboard preview render failed with exit ${result.status ?? 'unknown'}`);
    const output = path.join(project.projectDir, 'renders', 'storyboard-preview.mp4');
    if (!existsSync(output)) fail('Storyboard preview output is missing');
    console.log(JSON.stringify({projectId, output: path.relative(project.projectDir, output).split(path.sep).join('/'), frames: [start, end], config: compileReport.candidatePath}, null, 2));
    return 0;
  }

  fail(`Unknown command: ${command}`);
};

try {
  process.exitCode = run();
} catch (error) {
  console.error(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}