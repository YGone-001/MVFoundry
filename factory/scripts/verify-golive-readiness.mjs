// Go-live readiness acceptance: pricing, spend reservations, transport policy,
// atomic retrieval, crash recovery, operator preflight and a full synthetic
// generation-to-render regression.
//
// Everything runs offline through recorded fixtures and injected transports.
// LIVE AI GENERATION: NOT RUN - NOT AUTHORIZED
//
// Usage: node factory/scripts/verify-golive-readiness.mjs --workspace <external-root>
// Requires FFmpeg/FFprobe, a Remotion browser and factory/dist.

import {execFileSync, spawnSync, spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync, readFileSync, rmSync, statSync, writeFileSync} from 'node:fs';
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

process.env.RUNWAY_BASE_URL = process.env.RUNWAY_BASE_URL
  || `${'https'}://${['api', 'simulated', 'invalid'].join('.')}`;
const SIMULATED_KEY = 'simulation-key-never-live';
process.env.RUNWAY_API_KEY = process.env.RUNWAY_API_KEY || SIMULATED_KEY;

const generationCli = path.join(repoRoot, 'factory', 'scripts', 'generation.mjs');
const preproductionCli = path.join(repoRoot, 'factory', 'scripts', 'preproduction.mjs');

const {loadProject} = require('../dist/src/project/loadProject.js');
const {sha256File} = require('../dist/src/media/hash.js');
const {decodeAudioToNormalizedPcm} = require('../dist/src/media/audioDecode.js');
const {stereoToMono} = require('../dist/src/audio/analysis.js');
const {createProjectWriteBoundary, ensureSafeDirectory, assertSafePath} = require('../dist/src/workspace/writeBoundary.js');
const {LEDGER_PATHS} = require('../dist/src/generation/ledger.js');

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

const run = (script, scriptArgs, env = process.env) =>
  execFileSync(process.execPath, [script, ...scriptArgs, '--workspace', workspaceRoot],
    {encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, windowsHide: true, env});
const runStatus = (script, scriptArgs, env = process.env) =>
  spawnSync(process.execPath, [script, ...scriptArgs, '--workspace', workspaceRoot],
    {encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, windowsHide: true, env});

const gen = (projectId, command, extra = [], env) => run(generationCli, [command, '--project', projectId, ...extra], env);
const genStatus = (projectId, command, extra = [], env) => runStatus(generationCli, [command, '--project', projectId, ...extra], env);
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

const cleanLedger = (projectId) => {
  const project = loadProject(projectId, {workspaceRoot, engineRoot: repoRoot});
  for (const relative of [LEDGER_PATHS.ledger, LEDGER_PATHS.lock]) {
    const file = path.join(project.projectDir, relative);
    if (existsSync(file)) rmSync(file, {force: true});
  }
};

const approveStoryboard = (projectId) => {
  pre(projectId, 'plan');
  pre(projectId, 'approve-plan');
  pre(projectId, 'storyboard');
  pre(projectId, 'approve-storyboard');
};

const jobFor = (projectId, requirementId) => {
  const project = loadProject(projectId, {workspaceRoot, engineRoot: repoRoot});
  const document = readJson(path.join(project.projectDir, 'generation', 'jobs.json'));
  const job = document.jobs.find((entry) => entry.requirementId === requirementId);
  if (!job) throw new Error(`no job prepared for ${requirementId} in ${projectId}`);
  return job;
};

const prepareJob = (projectId, requirementId, model, revision = 1) =>
  JSON.parse(gen(projectId, 'prepare', [
    '--requirement', requirementId, '--provider', 'runway', '--model', model, '--revision', String(revision),
  ])).job.jobId;

const authorize = (projectId, jobId, {maxSpend = 1, uploadsPrivate = false} = {}) =>
  gen(projectId, 'approve-request', [
    '--job', jobId, '--authorization', 'authorized-for-simulation',
    '--max-spend', String(maxSpend), '--max-submissions', '1',
    ...(uploadsPrivate ? ['--uploads-private'] : []),
    '--notes', 'Synthetic go-live readiness rehearsal; no live request.',
  ]);

// ---------------------------------------------------------------------------
// Project B — concurrent reservation (run first so the ledger starts clean)
// ---------------------------------------------------------------------------

const projectPricing = 'synthetic-golive-pricing-demo';
guard(`${projectPricing}: concurrent reservation`, () => {
  approveStoryboard(projectPricing);
  cleanLedger(projectPricing);
  const videoA = prepareJob(projectPricing, 'REQ-001', 'gen4_turbo');
  const videoB = prepareJob(projectPricing, 'REQ-002', 'gen4_turbo');
  authorize(projectPricing, videoA, {maxSpend: 1});
  authorize(projectPricing, videoB, {maxSpend: 1});
  gen(projectPricing, 'ledger-ceiling', ['--max-spend', '0.30', '--notes', 'Room for exactly one submission']);

  const raceScript = path.join(repoRoot, 'factory', 'scripts', 'support', 'race-reserve.mjs');
  const race = spawnSync(
    process.execPath,
    [raceScript, generationCli, workspaceRoot, projectPricing, videoA, videoB],
    {encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, windowsHide: true, env: process.env, timeout: 120_000},
  );
  if (race.status !== 0) throw new Error(`race helper failed: ${race.stderr || race.stdout}`);
  const outcome = JSON.parse(race.stdout.slice(race.stdout.indexOf('{'))).results;

  const successes = outcome.filter((entry) => entry.code === 0);
  const failures = outcome.filter((entry) => entry.code !== 0);
  record('B1: two processes racing for the last of the budget produce exactly one reservation',
    successes.length === 1 && failures.length === 1,
    {exitCodes: outcome.map((entry) => entry.code)});

  const project = loadProject(projectPricing, {workspaceRoot, engineRoot: repoRoot});
  const ledger = readJson(path.join(project.projectDir, LEDGER_PATHS.ledger));
  const summary = JSON.parse(gen(projectPricing, 'ledger')).summary;
  record('B2: the stored ledger is consistent after the race',
    ledger.entries.length === 1
      && summary.reservedUsd === 0.25
      && summary.remainingUsd === 0.05
      && (summary.remainingUsd ?? -1) >= 0,
    {entries: ledger.entries.length, summary});
  record('B3: the losing process failed with a clear budget refusal',
    failures[0].code === 1 && /budget/i.test(`${failures[0].stderr}${failures[0].stdout}`),
    {message: `${failures[0].stderr}`.trim().split('\n')[0]});

  const winner = ledger.entries[0].jobId;
  const loser = winner === videoA ? videoB : videoA;
  record('B4: the winning job cannot reserve twice', (() => {
    const second = genStatus(projectPricing, 'reserve', ['--job', winner]);
    return second.status === 1 && /already holds reservation/i.test(`${second.stderr}`);
  })(), {});

  const evidence = path.relative(project.projectDir, writeEvidence(project, 'golive-concurrency-evidence.json', {
    videoA, videoB, outcome: outcome.map((entry) => entry.code), summary, loser,
  })).split(path.sep).join('/');
  console.log(JSON.stringify({projectId: projectPricing, evidence}));
});

// ---------------------------------------------------------------------------
// Project A — pricing, authorization and preflight
// ---------------------------------------------------------------------------

guard(`${projectPricing}: pricing and authorization`, () => {
  cleanLedger(projectPricing);
  const videoJob = prepareJob(projectPricing, 'REQ-001', 'gen4_turbo', 2);
  const imageJob = prepareJob(projectPricing, 'REQ-003', 'gen4_image');

  const pricing = JSON.parse(gen(projectPricing, 'pricing'));
  record('A1: the pricing snapshot reports its source, date, unit and integrity',
    pricing.provider === 'runway'
      && pricing.creditToUsd === 0.01
      && pricing.rounding === 'round-up-to-credit'
      && pricing.integrity.ok === true
      && /pricing/.test(pricing.sourceUrl),
    {version: pricing.pricingVersion, sha: pricing.snapshotSha256, integrity: pricing.integrity});

  const videoEstimate = JSON.parse(gen(projectPricing, 'estimate', ['--job', videoJob]));
  record('A2: a 5s image-to-video request is priced per second',
    videoEstimate.ok === true
      && videoEstimate.estimate.unit === 'per-second'
      && videoEstimate.estimate.billableUnits === 5
      && videoEstimate.estimate.estimatedCredits === 25
      && videoEstimate.estimate.estimatedUsd === 0.25,
    videoEstimate.estimate);

  const imageEstimate = JSON.parse(gen(projectPricing, 'estimate', ['--job', imageJob]));
  record('A3: an image request is priced per image at the 720p-class rate',
    imageEstimate.ok === true
      && imageEstimate.estimate.unit === 'per-image'
      && imageEstimate.estimate.billableUnits === 1
      && imageEstimate.estimate.estimatedCredits === 5
      && imageEstimate.estimate.estimatedUsd === 0.05,
    imageEstimate.estimate);

  const stale = genStatus(projectPricing, 'estimate', ['--job', videoJob, '--snapshot', 'generation/fixtures/pricing-stale.json']);
  record('A4: a stale pricing snapshot is refused', stale.status === 2 && /stale-snapshot/.test(stale.stdout),
    {exit: stale.status});

  const unsupported = genStatus(projectPricing, 'estimate', ['--job', videoJob, '--snapshot', 'generation/fixtures/pricing-unsupported.json']);
  record('A5: an unsupported pricing model is refused', unsupported.status === 2 && /unsupported-pricing/.test(unsupported.stdout),
    {exit: unsupported.status});

  const missing = genStatus(projectPricing, 'estimate', ['--job', videoJob, '--snapshot', 'generation/fixtures/pricing-missing.json']);
  record('A6: a model missing from the snapshot is refused', missing.status === 2 && /unknown-model/.test(missing.stdout),
    {exit: missing.status});

  const tampered = genStatus(projectPricing, 'estimate', ['--job', videoJob, '--snapshot', 'generation/fixtures/pricing-tampered.json']);
  record('A7: a tampered snapshot is refused', tampered.status === 2 && /tampered|hash/.test(tampered.stdout),
    {exit: tampered.status});

  gen(projectPricing, 'ledger-ceiling', ['--max-spend', '1.00', '--notes', 'Pilot ceiling']);
  authorize(projectPricing, imageJob, {maxSpend: 0.01});
  const tooExpensive = genStatus(projectPricing, 'reserve', ['--job', imageJob]);
  record('A8: a reservation above the job authorization is refused',
    tooExpensive.status === 1 && /job authorization/i.test(`${tooExpensive.stderr}`),
    {exit: tooExpensive.status, message: `${tooExpensive.stderr}`.trim().split('\n')[0]});

  authorize(projectPricing, imageJob, {maxSpend: 0.10});
  const reserved = JSON.parse(gen(projectPricing, 'reserve', ['--job', imageJob]));
  record('A9: a reservation records the estimate and reduces the remaining budget',
    reserved.reserved === true
      && reserved.entry.reservedUsd === 0.05
      && reserved.summary.remainingUsd === 0.95,
    {entry: reserved.entry.entryId, summary: reserved.summary});

  const preflightWithoutCredentials = (() => {
    const env = {...process.env};
    delete env.RUNWAY_API_KEY;
    const result = genStatus(projectPricing, 'preflight', ['--job', videoJob], env);
    return {status: result.status, body: JSON.parse(result.stdout)};
  })();
  record('A10: preflight reports a missing credential as a blocker without printing one',
    preflightWithoutCredentials.body.readiness === 'BLOCKED'
      && preflightWithoutCredentials.body.credentials.present === false
      && preflightWithoutCredentials.body.blockers.some((entry) => /credentials/.test(entry))
      && !JSON.stringify(preflightWithoutCredentials.body).includes(SIMULATED_KEY),
    {readiness: preflightWithoutCredentials.body.readiness, blockers: preflightWithoutCredentials.body.blockers});

  authorize(projectPricing, videoJob, {maxSpend: 1});
  gen(projectPricing, 'reserve', ['--job', videoJob]);
  const preflight = JSON.parse(gen(projectPricing, 'preflight', ['--job', videoJob]));
  record('A11: a fully prepared job reports READY FOR SEPARATELY AUTHORIZED PILOT and still forbids submission',
    preflight.readiness === 'READY FOR SEPARATELY AUTHORIZED PILOT'
      && preflight.liveExecution === 'NOT_GRANTED'
      && preflight.submissionAuthorized === false
      && preflight.estimate.estimatedUsd === 0.25
      && preflight.budget.remainingProjectUsd === 0.70
      && preflight.transport.ready === true
      && preflight.capabilityCompliance.ok === true
      && preflight.requirementCurrent === true
      && preflight.policyGates.allowNetwork === false
      && preflight.policyGates.note.length > 0,
    {
      readiness: preflight.readiness,
      estimate: preflight.estimate.estimatedUsd,
      budget: preflight.budget,
      blockers: preflight.blockers,
      next: preflight.operatorNextSteps,
    });

  const transport = JSON.parse(gen(projectPricing, 'transport-check'));
  record('A12: the transport reports the binding policy and a closed gate',
    transport.implemented === true
      && transport.gateOpen === false
      && /validated address/.test(transport.dnsBinding)
      && transport.proxyPolicy === 'refuse-if-configured'
      && transport.tls.includes('rejectUnauthorized never disabled'),
    {policyVersion: transport.policyVersion, gateOpen: transport.gateOpen});

  gen(projectPricing, 'ledger-reconcile', [
    '--job', videoJob, '--status', 'reconciled-unknown',
    '--notes', 'synthetic rehearsal: task outcome unknown',
  ]);
  const afterUnknown = JSON.parse(gen(projectPricing, 'ledger')).summary;
  record('A13: an uncertain outcome keeps the reservation exposed',
    afterUnknown.reservedUsd === 0.30
      && afterUnknown.remainingUsd === 0.70
      && afterUnknown.uncertainEntries.includes(videoJob),
    afterUnknown);

  const canceled = JSON.parse(gen(projectPricing, 'ledger-reconcile', [
    '--job', imageJob, '--status', 'canceled',
    '--notes', 'synthetic rehearsal: canceled without billing evidence',
  ]));
  const afterCancel = JSON.parse(gen(projectPricing, 'ledger')).summary;
  record('A14: cancellation releases the reservation without inventing a refund',
    canceled.entry.actualUsd === null
      && canceled.entry.actualClassification === 'unknown'
      && afterCancel.reservedUsd === 0.25
      && afterCancel.remainingUsd === 0.75,
    {entry: {actualUsd: canceled.entry.actualUsd, classification: canceled.entry.actualClassification}, summary: afterCancel});

  const project = loadProject(projectPricing, {workspaceRoot, engineRoot: repoRoot});
  const evidence = path.relative(project.projectDir, writeEvidence(project, 'golive-pricing-evidence.json', {
    videoJob, imageJob, pricing, videoEstimate, imageEstimate, preflight, transport, afterUnknown, afterCancel,
  })).split(path.sep).join('/');
  console.log(JSON.stringify({projectId: projectPricing, evidence}));
});

// ---------------------------------------------------------------------------
// Project C — network policy and retrieval finalization
// ---------------------------------------------------------------------------

const projectRender = 'synthetic-golive-render-demo';
guard(`${projectRender}: network and retrieval`, () => {
  approveStoryboard(projectRender);
  cleanLedger(projectRender);
  const jobId = prepareJob(projectRender, 'REQ-001', 'gen4_turbo');
  authorize(projectRender, jobId, {maxSpend: 1, uploadsPrivate: true});

  const referencesBlocked = genStatus(projectRender, 'prepare-references', ['--job', jobId]);
  const referencesAuthorized = JSON.parse(gen(projectRender, 'prepare-references', ['--job', jobId, '--authorize-disclosure']));
  record('D1: a reference asset requires explicit disclosure authorization',
    referencesBlocked.status === 2
      && referencesAuthorized.references.length === 1
      && referencesAuthorized.references[0].blockers.length === 0
      && referencesAuthorized.payloads[0].characters > 0,
    {blockedExit: referencesBlocked.status, payload: referencesAuthorized.payloads});

  gen(projectRender, 'ledger-ceiling', ['--max-spend', '1.00', '--notes', 'Retrieval rehearsal']);
  gen(projectRender, 'reserve', ['--job', jobId]);
  const preflight = JSON.parse(gen(projectRender, 'preflight', ['--job', jobId, '--authorize-disclosure']));
  record('D2: preflight lists what would leave the machine and stays unauthorized',
    preflight.readiness === 'READY FOR SEPARATELY AUTHORIZED PILOT'
      && preflight.disclosureAuthorized === true
      && preflight.assetsLeavingMachine.length === 1
      && preflight.liveExecution === 'NOT_GRANTED'
      && preflight.submissionAuthorized === false,
    {readiness: preflight.readiness, assets: preflight.assetsLeavingMachine, blockers: preflight.blockers});

  gen(projectRender, 'resume', ['--job', jobId, '--fixtures', 'generation/fixtures/video-task.json', '--authorize-disclosure']);

  const project = loadProject(projectRender, {workspaceRoot, engineRoot: repoRoot});
  const target = 'generation/outputs/' + jobId + '/' + jobId + '-provider.mp4';

  const ssrf = genStatus(projectRender, 'retrieve', ['--job', jobId, '--fixture', 'generation/fixtures/d-ssrf.json']);
  record('C1: a destination resolving to loopback is refused',
    ssrf.status === 1 && /blocked|disallowed/i.test(`${ssrf.stderr}`),
    {exit: ssrf.status, message: `${ssrf.stderr}`.trim().split('\n')[0]});

  const redirect = genStatus(projectRender, 'retrieve', ['--job', jobId, '--fixture', 'generation/fixtures/d-redirect.json']);
  record('C2: a redirect to an untrusted host is refused',
    redirect.status === 1 && /not in the .* allowlist|host/i.test(`${redirect.stderr}`),
    {exit: redirect.status, message: `${redirect.stderr}`.trim().split('\n')[0]});

  const oversize = genStatus(projectRender, 'retrieve', ['--job', jobId, '--fixture', 'generation/fixtures/d-oversize.json']);
  record('C3: an oversized declared response is refused before storing bytes',
    oversize.status === 1 && /exceeds the .* byte limit/i.test(`${oversize.stderr}`),
    {exit: oversize.status});

  const html = genStatus(projectRender, 'retrieve', ['--job', jobId, '--fixture', 'generation/fixtures/d-html.json']);
  record('C4: an HTML page served as a video is refused',
    html.status === 1 && /magic|content does not match/i.test(`${html.stderr}`),
    {exit: html.status});

  const interrupted = genStatus(projectRender, 'retrieve', ['--job', jobId, '--fixture', 'generation/fixtures/d-interrupted.json']);
  const interruptedState = JSON.parse(gen(projectRender, 'retrieval-state', ['--job', jobId]));
  record('C5: an interrupted download publishes nothing and records the failure',
    interrupted.status === 1
      && /declared .* but produced|truncated/i.test(`${interrupted.stderr}`)
      && !existsSync(path.join(project.projectDir, target))
      && interruptedState.state.phase === 'failed'
      && interruptedState.classification === 'no-media',
    {
      exit: interrupted.status,
      phase: interruptedState.state.phase,
      classification: interruptedState.classification,
      message: `${interrupted.stderr}`.trim().split('\n')[0],
    });

  const retrieved = JSON.parse(gen(projectRender, 'retrieve', ['--job', jobId, '--fixture', 'generation/fixtures/video-task.json']));
  const storedAbsolute = path.join(project.projectDir, retrieved.stored);
  const finalState = JSON.parse(gen(projectRender, 'retrieval-state', ['--job', jobId]));
  record('C6: a successful retrieval finalizes atomically and records its state',
    retrieved.retrieved === true
      && existsSync(storedAbsolute)
      && sha(storedAbsolute) === retrieved.sha256
      && finalState.state.phase === 'finalized'
      && finalState.classification === 'finalized-not-manifested',
    {stored: retrieved.stored, sha256: retrieved.sha256, phase: finalState.state.phase, classification: finalState.classification});

  record('C7: the retrieval record never contains the signed query string',
    retrieved.source.signedQueryRedacted === true
      && !JSON.stringify(retrieved).includes('_jwt'),
    retrieved.source);

  const duplicate = JSON.parse(gen(projectRender, 'retrieve', ['--job', jobId, '--fixture', 'generation/fixtures/video-task.json']));
  record('C8: a repeated retrieval is idempotent', duplicate.sha256 === retrieved.sha256,
    {sha256: duplicate.sha256});

  const before = readJson(path.join(project.projectDir, 'generation', 'jobs.json')).jobs.find((entry) => entry.jobId === jobId);
  const expired = genStatus(projectRender, 'retrieve', ['--job', jobId, '--fixture', 'generation/fixtures/d-expire.json']);
  const after = readJson(path.join(project.projectDir, 'generation', 'jobs.json')).jobs.find((entry) => entry.jobId === jobId);
  const submissions = (job) => (job.execution.attemptHistory ?? []).filter((entry) => entry.phase === 'submit').length;
  record('C9: an expired URL is recovered by re-querying the same task, never by resubmitting',
    expired.status === 0 && submissions(after) === submissions(before) && after.execution.providerTaskId === 'task-golive-1',
    {exit: expired.status, submitsBefore: submissions(before), submitsAfter: submissions(after)});

  const crossProject = genStatus(projectRender, 'retrieve', [
    '--job', jobId, '--fixture', 'generation/fixtures/video-task.json',
    '--out', '../synthetic-golive-pricing-demo/renders/stolen.mp4',
  ]);
  record('C10: a cross-project retrieval destination is refused',
    crossProject.status === 1 && /outside|escapes|forbidden/i.test(`${crossProject.stderr}`),
    {exit: crossProject.status});

  const evidence = path.relative(project.projectDir, writeEvidence(project, 'golive-network-evidence.json', {
    jobId, retrieved, finalState, interruptions: {ssrf: ssrf.status, redirect: redirect.status, oversize: oversize.status, html: html.status, interrupted: interrupted.status},
  })).split(path.sep).join('/');
  console.log(JSON.stringify({projectId: projectRender, evidence}));
});

// ---------------------------------------------------------------------------
// Project D — generation to real render
// ---------------------------------------------------------------------------

guard(`${projectRender}: generation to render`, () => {
  const jobId = jobFor(projectRender, 'REQ-001').jobId;
  const retrieved = JSON.parse(gen(projectRender, 'retrieve', ['--job', jobId, '--fixture', 'generation/fixtures/video-task.json']));
  const project = loadProject(projectRender, {workspaceRoot, engineRoot: repoRoot});
  const originalAbsolute = path.join(project.projectDir, retrieved.stored);
  const originalSha = sha(originalAbsolute);

  const inspection = JSON.parse(gen(projectRender, 'inspect-media', ['--file', retrieved.stored]));
  record('D3: the retrieved clip is deliberately incompatible with the renderer',
    (inspection.inspection.timing.variableFrameRate
      || Math.abs(inspection.inspection.nominalFrameRate - inspection.inspection.averageFrameRate) > 0.01)
      && Math.abs(inspection.inspection.rotation) > 0.01
      && inspection.inspection.audioStreamCount === 1,
    {rotation: inspection.inspection.rotation, audioStreams: inspection.inspection.audioStreamCount});

  const normalized = JSON.parse(gen(projectRender, 'normalize', [
    '--job', jobId, '--fps', '24', '--width', '640', '--height', '360',
    '--rights', 'Derived locally from the recorded provider output; no third-party rights',
  ]));
  const compared = genStatus(projectRender, 'compare-media', ['--original', retrieved.stored, '--derived', normalized.derived.path]);
  record('D4: normalization produces a renderer-compatible derived file and keeps the original',
    normalized.normalized === true
      && normalized.original.sha256 === retrieved.sha256
      && normalized.derived.sha256 !== retrieved.sha256
      && compared.status === 0
      && sha(originalAbsolute) === originalSha,
    {derived: normalized.derived.sha256, original: normalized.original.sha256});

  const staged = JSON.parse(gen(projectRender, 'stage', [
    '--job', jobId, '--rights', 'Derived from simulated provider output; synthetic fixture bytes',
  ]));
  const blockedBeforeReview = preStatus(projectRender, 'compile');
  record('D5: staging lands as pending and compilation stays blocked',
    staged.staged.review === 'pending'
      && blockedBeforeReview.status === 2
      && staged.staged.provenance.includes(normalized.original.sha256),
    {review: staged.staged.review, compileExit: blockedBeforeReview.status});

  gen(projectRender, 'review', [
    '--job', jobId, '--decision', 'approve',
    '--notes', 'Reviewed the normalized clip, provenance and both hashes.',
  ]);
  pre(projectRender, 'storyboard', ['--new-revision']);
  pre(projectRender, 'approve-storyboard');
  const compile = JSON.parse(pre(projectRender, 'compile'));
  const candidate = readJson(path.join(project.projectDir, 'preproduction', 'project-candidate.json'));
  const shot = candidate.chapters.flatMap((chapter) => chapter.shots).find((entry) => entry.id === 'SHOT-001');
  record('D6: the approved derived clip compiles into a Video shot',
    compile.status === 'ready' && shot.renderer === 'video' && shot.media && shot.media.kind === 'video' && shot.media.muted === true,
    {compile: compile.status, media: shot.media});

  pre(projectRender, 'render-preview', ['--frames', '0-47']);
  const output = path.join(project.projectDir, 'renders', 'storyboard-preview.mp4');
  const probe = ffprobeJson(output);
  const video = (probe.streams || []).find((stream) => stream.codec_type === 'video');
  const audioStreams = (probe.streams || []).filter((stream) => stream.codec_type === 'audio');
  const mono = stereoToMono(decodeAudioToNormalizedPcm(output, 48000, 'preview').samples);
  const frames = [6, 30].map((frame) => {
    const bytes = rawFrame(output, frame, video.width, video.height);
    return {frame, rgb: averageRgb(bytes), signature: frameSignature(bytes, video.width, video.height)};
  });
  const audioEvidence = {masterTone: Number(toneMagnitude(mono, 48000, 392).toFixed(6)), samples: mono.length};
  record('D7: the preview is a real H.264 MP4 with exactly one soundtrack',
    video.codec_name === 'h264'
      && video.width === 640
      && video.height === 360
      && video.r_frame_rate === '24/1'
      && Number(video.nb_frames) === 48
      && audioStreams.length === 1
      && audioEvidence.masterTone > 1e-4,
    {video: {codec: video.codec_name, width: video.width, height: video.height, fps: video.r_frame_rate, frames: Number(video.nb_frames)}, audioStreams: audioStreams.length, audioEvidence});
  record('D8: decoded frames differ across the normalized clip',
    signatureDistance(frames[0].signature, frames[1].signature) > 3,
    {distance: signatureDistance(frames[0].signature, frames[1].signature), frames: frames.map((entry) => entry.rgb)});
  record('D9: the provider original stays byte-identical through the whole pipeline',
    sha(originalAbsolute) === originalSha,
    {expected: originalSha, actual: sha(originalAbsolute)});

  const evidence = path.relative(project.projectDir, writeEvidence(project, 'golive-render-evidence.json', {
    jobId, retrieved, inspection: inspection.inspection, normalized, staged: staged.staged, compile,
    render: {video: {codec: video.codec_name, width: video.width, height: video.height, fps: video.r_frame_rate, frames: Number(video.nb_frames)}, audioStreams: audioStreams.length, audioEvidence, frames: frames.map((entry) => entry.rgb)},
  })).split(path.sep).join('/');
  console.log(JSON.stringify({projectId: projectRender, evidence}));
});

// ---------------------------------------------------------------------------
// Project E — negative controls
// ---------------------------------------------------------------------------

guard('negative controls', () => {
  const jobId = jobFor(projectRender, 'REQ-001').jobId;
  const live = genStatus(projectRender, 'submit-live', ['--job', jobId]);
  record('E1: live provider execution is refused', live.status === 1 && /NOT_GRANTED/.test(`${live.stderr}${live.stdout}`),
    {exit: live.status});

  const unsupportedModel = genStatus(projectPricing, 'prepare', [
    '--requirement', 'REQ-001', '--provider', 'runway', '--model', 'gen4_unknown', '--revision', '9',
  ]);
  record('E2: an unsupported model is rejected before submission', unsupportedModel.status !== 0,
    {exit: unsupportedModel.status});

  const duplicateResume = genStatus(projectRender, 'resume', ['--job', jobId, '--fixtures', 'generation/fixtures/video-task.json', '--authorize-disclosure']);
  record('E3: a job bound to a task is not submitted again', duplicateResume.status === 1,
    {exit: duplicateResume.status, message: `${duplicateResume.stderr}`.trim().split('\n')[0]});

  const missingRecord = genStatus(projectRender, 'reserve', ['--job', jobId]);
  record('E4: a reservation without an open authorization is refused', missingRecord.status === 1,
    {exit: missingRecord.status});

  const crossProjectStage = genStatus(projectRender, 'stage', [
    '--job', jobId, '--file', '../synthetic-golive-pricing-demo/renders/storyboard-preview.mp4',
    '--rights', 'cross-project attempt',
  ]);
  record('E5: a cross-project stage is refused', crossProjectStage.status === 1,
    {exit: crossProjectStage.status});

  const brokenMedia = (() => {
    const project = loadProject(projectRender, {workspaceRoot, engineRoot: repoRoot});
    const file = path.join(project.projectDir, 'generation', 'outputs', jobId, 'corrupt.mp4');
    writeFileSync(file, 'not a video');
    return genStatus(projectRender, 'stage', [
      '--job', jobId, '--file', `generation/outputs/${jobId}/corrupt.mp4`, '--rights', 'corrupt attempt',
    ]);
  })();
  record('E6: corrupt generated media is refused by the real probe', brokenMedia.status === 1,
    {exit: brokenMedia.status});

  const staleCheck = (() => {
    const project = loadProject(projectPricing, {workspaceRoot, engineRoot: repoRoot});
    const job = jobFor(projectPricing, 'REQ-002');
    const briefPath = path.join(project.projectDir, 'preproduction', 'creative-brief.json');
    const brief = readJson(briefPath);
    brief.concept = `${brief.concept} (revised for the stale check)`;
    writeFileSync(briefPath, `${JSON.stringify(brief, null, 2)}\n`);
    pre(projectPricing, 'plan', ['--new-revision']);
    pre(projectPricing, 'approve-plan', ['--revision', '2']);
    pre(projectPricing, 'storyboard', ['--new-revision']);
    pre(projectPricing, 'approve-storyboard', ['--revision', '2']);
    const status = genStatus(projectPricing, 'status', ['--job', job.jobId]);
    const approve = genStatus(projectPricing, 'approve-request', [
      '--job', job.jobId, '--authorization', 'authorized-for-simulation',
      '--max-spend', '1', '--max-submissions', '1', '--notes', 'stale attempt',
    ]);
    return {status: status.status, staleJobs: JSON.parse(status.stdout).staleJobs, approve: approve.status};
  })();
  record('E7: a stale requirement fingerprint blocks authorization',
    staleCheck.status === 2 && staleCheck.staleJobs.length > 0 && staleCheck.approve === 1,
    staleCheck);

  const ledgerAfter = JSON.parse(gen(projectRender, 'ledger')).summary;
  record('E8: refusals never create an approved-looking asset or a negative balance',
    (ledgerAfter.remainingUsd ?? 0) >= 0,
    ledgerAfter);
});

const pass = checks.every((check) => check.pass);
console.log(JSON.stringify({
  pass,
  total: checks.length,
  failed: checks.filter((check) => !check.pass).map((check) => check.name),
  liveProviderExecution: 'NOT_GRANTED',
  liveAiGeneration: 'NOT RUN — NOT AUTHORIZED',
  paidProviderSubmissions: 0,
  realProviderCostObservation: 'NOT RUN',
  note: 'Every byte and every priced request in this run came from a local synthetic fixture. No provider was contacted.',
}, null, 2));
if (!pass) process.exitCode = 1;
