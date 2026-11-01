// Asset production and review for the complete-MV rehearsal.
//
// Every asset travels the accepted handoff workflow: generation or local
// production, technical validation, pending intake, an explicit reviewer
// decision, then binding to a requirement. Nothing is approved implicitly and a
// rejected asset is never silently replaced.
//
// The rejection scenario runs last, after every other requirement is fulfilled,
// so the compiler can be asked a precise question: with exactly one rejected
// asset, is the project render-ready?

import {execFileSync} from 'node:child_process';
import {existsSync, readFileSync} from 'node:fs';
import path from 'node:path';

const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));

export const ASSET_SOURCES = {
  'REQ-001': {kind: 'attach', path: 'assets/video/shot-003-source.mp4', assetId: 'MV-REQ-001-SRC', note: 'Synthetic cyan garden plate with a moving band.'},
  'REQ-002': {kind: 'attach', path: 'assets/video/shot-004-source.mp4', assetId: 'MV-REQ-002-SRC', note: 'Synthetic amber column plate.'},
  'REQ-003': {kind: 'attach', path: 'assets/layers/ring-a.png', assetId: 'MV-REQ-003-RING', note: 'Transparent amber ring layer.'},
  'REQ-004': {kind: 'replace-after-rejection', rejectPath: 'assets/rejected/flat-grey.mp4', path: 'assets/video/shot-006-source.mp4', assetId: 'MV-REQ-004-SRC'},
  'REQ-005': {kind: 'attach', path: 'assets/video/shot-008-source.mp4', assetId: 'MV-REQ-005-SRC', note: 'Synthetic deep-cyan drift plate.'},
  'REQ-006': {kind: 'generate', note: 'Offline provider transparent layer.'},
  'REQ-007': {kind: 'attach', path: 'assets/video/shot-010-source.mp4', assetId: 'MV-REQ-007-SRC', note: 'Reused cyan plate with a 24-frame in-point.'},
  'REQ-008': {kind: 'attach', path: 'assets/video/shot-011-source.mp4', assetId: 'MV-REQ-008-SRC', note: 'Synthetic warm bloom plate.'},
  'REQ-009': {kind: 'attach', path: 'assets/layers/ring-b.png', assetId: 'MV-REQ-009-RING', note: 'Transparent warm ring layer.'},
  'REQ-010': {kind: 'attach', path: 'assets/layers/glyph-b.png', assetId: 'MV-REQ-010-GLYPH', note: 'Transparent amber glyph lattice.'},
  'REQ-011': {kind: 'generate', note: 'Offline provider video clip.'},
};

const RIGHTS = 'Original synthetic asset generated for this rehearsal; no third-party rights';
const PROVENANCE = 'Generated locally by factory/scripts/seed-mv-production.mjs; no provider, no external media';

const parse = (stdout) => {
  const start = stdout.indexOf('{');
  if (start < 0) throw new Error(`command produced no JSON: ${stdout.slice(0, 200)}`);
  return JSON.parse(stdout.slice(start));
};

/** Runs one CLI command; `allowFailure` returns the exit status instead of throwing. */
export const runCli = ({engineRoot, workspaceRoot, script, args, allowFailure = false, env = process.env}) => {
  const file = path.join(engineRoot, 'factory', 'scripts', script);
  try {
    const stdout = execFileSync(process.execPath, [file, ...args, '--workspace', workspaceRoot], {
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
      windowsHide: true,
      env,
      timeout: 900_000,
    });
    return {exit: 0, stdout, body: parse(stdout)};
  } catch (error) {
    if (!allowFailure) throw error;
    return {exit: error.status ?? 1, stdout: `${error.stdout ?? ''}`, stderr: `${error.stderr ?? ''}`, body: null};
  }
};

const intakeRecordFor = (projectDir, requirementId) => {
  const file = path.join(projectDir, 'preproduction', 'asset-intake.json');
  if (!existsSync(file)) return null;
  return (readJson(file).records ?? []).find((entry) => entry.requirementId === requirementId) ?? null;
};

const compileOnce = ({engineRoot, workspaceRoot, projectId}) =>
  runCli({
    engineRoot,
    workspaceRoot,
    script: 'preproduction.mjs',
    args: ['compile', '--project', projectId],
    allowFailure: true,
  });

const ensureGenerationJob = ({engineRoot, workspaceRoot, projectDir, projectId, requirementId}) => {
  const jobsFile = path.join(projectDir, 'generation', 'jobs.json');
  const existing = existsSync(jobsFile)
    ? readJson(jobsFile).jobs.find((job) => job.requirementId === requirementId)
    : null;
  if (existing) return existing.jobId;
  const prepared = runCli({
    engineRoot,
    workspaceRoot,
    script: 'generation.mjs',
    args: ['prepare', '--project', projectId, '--requirement', requirementId, '--provider', 'offline-fixture'],
  }).body;
  return prepared.job.jobId;
};

const approveRecord = ({engineRoot, workspaceRoot, projectId, requirementId, notes}) =>
  runCli({
    engineRoot,
    workspaceRoot,
    script: 'preproduction.mjs',
    args: ['review-asset', '--project', projectId, '--requirement', requirementId, '--decision', 'approve', '--notes', notes],
  });

const attachRecord = ({engineRoot, workspaceRoot, projectId, requirementId, assetId, file, provenance, rights = RIGHTS}) =>
  runCli({
    engineRoot,
    workspaceRoot,
    script: 'preproduction.mjs',
    args: [
      'attach-asset', '--project', projectId, '--requirement', requirementId,
      '--asset-id', assetId, '--path', file, '--provenance', provenance, '--rights', rights,
    ],
  }).body;

/**
 * Delivers, validates and reviews every requirement of the approved storyboard.
 * Returns a structured history so the caller can prove what was rejected and why.
 */
export const stageAssets = ({engineRoot, workspaceRoot, projectDir, projectId, log = () => {}}) => {
  const storyboard = readJson(path.join(projectDir, 'preproduction', 'storyboard.json'));
  const requirements = storyboard.assetRequirements ?? [];
  const history = [];
  const rejected = [];
  let rejectionEvidence = null;

  const straight = requirements.filter((requirement) => ASSET_SOURCES[requirement.id]?.kind !== 'replace-after-rejection');
  const replacements = requirements.filter((requirement) => ASSET_SOURCES[requirement.id]?.kind === 'replace-after-rejection');

  for (const requirement of straight) {
    const source = ASSET_SOURCES[requirement.id];
    if (!source) throw new Error(`No production plan for requirement ${requirement.id}`);
    const current = intakeRecordFor(projectDir, requirement.id);
    if (current && current.review === 'approved') {
      history.push({requirementId: requirement.id, assetId: current.assetId, path: current.path, decision: 'approved'});
      continue;
    }
    if (source.kind === 'generate') {
      // Re-running the rehearsal must not submit the same offline job twice: an
      // existing pending intake is reviewed rather than regenerated.
      let staged = current;
      let jobId = null;
      if (!staged) {
        jobId = ensureGenerationJob({engineRoot, workspaceRoot, projectDir, projectId, requirementId: requirement.id});
        runCli({
          engineRoot,
          workspaceRoot,
          script: 'generation.mjs',
          args: [
            'approve-request', '--project', projectId, '--job', jobId,
            '--authorization', 'authorized-for-simulation', '--max-spend', '0', '--max-submissions', '1',
            '--uploads-private', '--notes', 'Offline synthetic asset rehearsal; no provider request and no cost.',
          ],
          allowFailure: true,
        });
        runCli({
          engineRoot,
          workspaceRoot,
          script: 'generation.mjs',
          args: ['run-offline', '--project', projectId, '--job', jobId, '--rights', RIGHTS],
        });
        staged = intakeRecordFor(projectDir, requirement.id);
        history.push({requirementId: requirement.id, assetId: staged.assetId, path: staged.path, decision: 'generated', jobId, provenance: staged.provenance});
      } else {
        history.push({requirementId: requirement.id, assetId: staged.assetId, path: staged.path, decision: 'reused-pending-generation'});
      }
      approveRecord({
        engineRoot,
        workspaceRoot,
        projectId,
        requirementId: requirement.id,
        notes: 'Synthetic review: generated output matches the planned slot, kind and duration.',
      });
      history.push({requirementId: requirement.id, assetId: staged.assetId, path: staged.path, decision: 'approved'});
      log(`generated ${requirement.id}`);
      continue;
    }
    const attached = attachRecord({
      engineRoot,
      workspaceRoot,
      projectId,
      requirementId: requirement.id,
      assetId: source.assetId,
      file: source.path,
      provenance: PROVENANCE,
    });
    history.push({requirementId: requirement.id, assetId: attached.assetId, path: attached.path, decision: 'attached', note: source.note ?? null});
    approveRecord({
      engineRoot,
      workspaceRoot,
      projectId,
      requirementId: requirement.id,
      notes: 'Synthetic review: asset matches the planned slot, palette and duration.',
    });
    history.push({requirementId: requirement.id, assetId: attached.assetId, path: attached.path, decision: 'approved'});
    log(`attached ${requirement.id}`);
  }

  for (const requirement of replacements) {
    const source = ASSET_SOURCES[requirement.id];
    const current = intakeRecordFor(projectDir, requirement.id);
    if (current && current.review === 'approved' && current.path === source.path) {
      history.push({requirementId: requirement.id, assetId: current.assetId, path: current.path, decision: 'approved', note: 'replacement already in place'});
      continue;
    }
    const bad = attachRecord({
      engineRoot,
      workspaceRoot,
      projectId,
      requirementId: requirement.id,
      assetId: `${source.assetId}-REJECTED`,
      file: source.rejectPath,
      provenance: 'Deliberately unsuitable synthetic flat-grey plate used to exercise the rejection path',
    });
    const rejectedSnapshot = intakeRecordFor(projectDir, requirement.id);
    runCli({
      engineRoot,
      workspaceRoot,
      script: 'preproduction.mjs',
      args: [
        'review-asset', '--project', projectId, '--requirement', requirement.id,
        '--decision', 'reject', '--notes', 'Rejected: flat grey plate carries no garden identity and would break the palette.',
      ],
    });
    rejected.push({
      requirementId: requirement.id,
      review: 'rejected',
      assetId: bad.assetId,
      path: bad.path,
      sha256: bad.sha256,
      technical: bad.technical,
      reason: 'flat grey plate carries no garden identity',
      supersededRecord: rejectedSnapshot,
    });

    // With one rejected asset and everything else approved, the compiler must
    // refuse and name exactly this requirement.
    const blocked = compileOnce({engineRoot, workspaceRoot, projectId});
    const blockedBody = blocked.body ?? {};
    rejectionEvidence = {
      compileExit: blocked.exit,
      status: blockedBody.status ?? null,
      missing: blockedBody.missingAssetRequirements ?? null,
      renderReady: blockedBody.renderReady ?? null,
    };
    if (blocked.exit === 0 || blockedBody.status === 'ready') {
      throw new Error(`Compile stayed ready after rejecting ${requirement.id}`);
    }

    attachRecord({
      engineRoot,
      workspaceRoot,
      projectId,
      requirementId: requirement.id,
      assetId: source.assetId,
      file: source.path,
      provenance: PROVENANCE,
    });
    history.push({requirementId: requirement.id, assetId: source.assetId, path: source.path, decision: 'replacement-attached'});
    approveRecord({
      engineRoot,
      workspaceRoot,
      projectId,
      requirementId: requirement.id,
      notes: 'Replacement reviewed: warm cyan garden plate matches the drift palette and covers the shot.',
    });
    history.push({requirementId: requirement.id, assetId: source.assetId, path: source.path, decision: 'approved', note: 'replacement'});
    log(`rejected and replaced ${requirement.id}`);
  }

  const finalCompile = compileOnce({engineRoot, workspaceRoot, projectId});
  if (finalCompile.exit !== 0 || finalCompile.body?.status !== 'ready') {
    throw new Error(`Compile did not reach ready: ${JSON.stringify(finalCompile.body)}`);
  }

  return {history, rejected, rejectionEvidence, requirements: requirements.length, compile: finalCompile.body};
};
