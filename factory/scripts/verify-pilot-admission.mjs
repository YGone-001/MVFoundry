// Pilot-admission acceptance suite.
//
// Projects A-E: ordinary P0 refusal, scoped pilot admission, one-shot
// concurrency, the full fake-provider lifecycle to a real rendered MP4, the
// transport wiring against a controlled local HTTPS server, and the negative
// controls. Nothing here contacts a provider: every submit, poll and download is
// a recorded response through an injected transport, except the transport leg,
// which drives the real secure transport against a loopback HTTPS server.
//
// LIVE AI GENERATION: NOT RUN - NOT AUTHORIZED
//
// Usage: node factory/scripts/verify-pilot-admission.mjs --workspace <external-root>
// Requires factory/dist, FFmpeg/FFprobe, a Remotion browser and openssl.

import {execFileSync, spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createServer as createHttpsServer} from 'node:https';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  rmdirSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
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

const SIMULATED_HOST = ['api', 'simulated', 'invalid'].join('.');
const SIMULATED_BASE_URL = `${'https'}://${SIMULATED_HOST}`;
const DELIVERY_HOST = ['dnznrvs05pmza', 'cloudfront', 'net'].join('.');
const SIMULATED_KEY = 'simulation-key-never-live';
process.env.RUNWAY_BASE_URL = SIMULATED_BASE_URL;
process.env.RUNWAY_API_KEY = SIMULATED_KEY;
// A local run without the Remotion-managed browser would otherwise stall on a
// browser download. CI provisions the managed browser and keeps its own choice.
if (!process.env.CI && !process.env.REMOTION_BROWSER_EXECUTABLE && !process.env.CHROME_PATH) {
  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  ];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (found) process.env.REMOTION_BROWSER_EXECUTABLE = found;
}

const generationCli = path.join(repoRoot, 'factory', 'scripts', 'generation.mjs');
const preproductionCli = path.join(repoRoot, 'factory', 'scripts', 'preproduction.mjs');
const raceScript = path.join(repoRoot, 'factory', 'scripts', 'support', 'race-submit.mjs');

const {loadProject} = require('../dist/src/project/loadProject.js');
const {decodeAudioToNormalizedPcm} = require('../dist/src/media/audioDecode.js');
const {stereoToMono} = require('../dist/src/audio/analysis.js');
const {createProjectWriteBoundary, ensureSafeDirectory, assertSafePath} = require('../dist/src/workspace/writeBoundary.js');
const {LEDGER_PATHS} = require('../dist/src/generation/ledger.js');
const {readPilotAdmissions, findAdmission} = require('../dist/src/generation/pilotAdmission.js');
const {LIVE_PROVIDER_EXECUTION_GRANTED, createAdapterDriver, runPilotSubmission} = require('../dist/src/generation/submission.js');
const {createRunwayProvider, RUNWAY_CAPABILITIES, resolveProviderDuration} = require('../dist/src/generation/providers.js');
const {createLiveHttpsTransport, createProviderHttpTransport, TransportError, RUNWAY_ENDPOINT_POLICY} = require('../dist/src/generation/transport.js');
const {isDisallowedAddress} = require('../dist/src/generation/retrieval.js');
const {RUNWAY_PRICING_SNAPSHOT, estimateGenerationCost, outputLongEdgeForJob, billableSecondsForJob} = require('../dist/src/generation/pricing.js');
const {prepareReferenceInput} = require('../dist/src/generation/references.js');
const {buildProviderRequest} = require('../dist/src/generation/pipeline.js');

const ORDINARY = 'synthetic-pilot-ordinary-demo';
const SCOPE = 'synthetic-pilot-scope-demo';
const CONCURRENCY = 'synthetic-pilot-concurrency-demo';
const RENDER = 'synthetic-pilot-render-demo';

const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
const readJsonIfPresent = (file) => (existsSync(file) ? readJson(file) : null);
const sha = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');

const run = (script, scriptArgs, env = process.env) =>
  execFileSync(process.execPath, [script, ...scriptArgs, '--workspace', workspaceRoot], {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    windowsHide: true,
    env,
    timeout: 600_000,
  });
const runStatus = (script, scriptArgs, env = process.env) =>
  spawnSync(process.execPath, [script, ...scriptArgs, '--workspace', workspaceRoot], {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    windowsHide: true,
    env,
    timeout: 600_000,
  });

const gen = (projectId, command, extra = [], env) => run(generationCli, [command, '--project', projectId, ...extra], env);
const genStatus = (projectId, command, extra = [], env) => runStatus(generationCli, [command, '--project', projectId, ...extra], env);
const genJson = (projectId, command, extra = [], env) => JSON.parse(gen(projectId, command, extra, env));
const genJsonStatus = (projectId, command, extra = [], env) => {
  const result = genStatus(projectId, command, extra, env);
  let body = null;
  try {
    body = JSON.parse(result.stdout);
  } catch {
    body = null;
  }
  return {exit: result.status, body, stderr: `${result.stderr}`, stdout: `${result.stdout}`};
};
const pre = (projectId, command, extra = []) => run(preproductionCli, [command, '--project', projectId, ...extra]);
const preStatus = (projectId, command, extra = []) => runStatus(preproductionCli, [command, '--project', projectId, ...extra]);

const checks = [];
const record = (name, pass, details) => {
  checks.push({name, pass: Boolean(pass), details});
  console.log(JSON.stringify(pass ? {check: name, pass: true} : {check: name, pass: false, details}));
};

const guard = async (name, fn) => {
  try {
    await fn();
  } catch (error) {
    record(name, false, {error: error instanceof Error ? error.message : String(error)});
  }
};

const projectOf = (projectId) => loadProject(projectId, {workspaceRoot, engineRoot: repoRoot});
const jobsOf = (projectId) => readJson(path.join(projectOf(projectId).projectDir, 'generation', 'jobs.json')).jobs;
const jobOf = (projectId, jobId) => jobsOf(projectId).find((entry) => entry.jobId === jobId);
const admissionOf = (projectId, pilotId) => findAdmission(readPilotAdmissions(projectOf(projectId)), pilotId);

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

const prepareJob = (projectId, requirementId, model, revision = 1) =>
  genJson(projectId, 'prepare', [
    '--requirement', requirementId, '--provider', 'runway', '--model', model, '--revision', String(revision),
  ]).job.jobId;

const authorize = (projectId, jobId, {maxSpend = 1, uploadsPrivate = true} = {}) =>
  gen(projectId, 'approve-request', [
    '--job', jobId, '--authorization', 'authorized-for-simulation',
    '--max-spend', String(maxSpend), '--max-submissions', '1',
    ...(uploadsPrivate ? ['--uploads-private'] : []),
    '--notes', 'Synthetic pilot rehearsal; no live request and no credits.',
  ]);

const proposePilot = (projectId, jobId, pilotId, extra = []) =>
  gen(projectId, 'pilot-propose', ['--job', jobId, '--pilot', pilotId, ...extra]);

const reviewPilot = (projectId, jobId, pilotId, decision = 'approve') =>
  gen(projectId, 'pilot-review', [
    '--job', jobId, '--pilot', pilotId, '--decision', decision,
    '--notes', 'Reviewed the binding, ceiling and disclosure.',
  ]);

const ffprobeJson = (file) =>
  JSON.parse(
    execFileSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', file], {
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
      windowsHide: true,
    }),
  );

const rawFrame = (file, frame, width, height) => {
  const bytes = execFileSync(
    'ffmpeg',
    ['-v', 'error', '-i', file, '-vf', `select=eq(n\\,${frame})`, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'],
    {encoding: null, maxBuffer: 64 * 1024 * 1024, windowsHide: true},
  );
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
      cells.push(count > 0 ? Number((sum / count).toFixed(3)) : 0);
    }
  }
  return cells;
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

const cleanup = [];
process.on('exit', () => {
  for (const entry of cleanup) {
    try {
      rmSync(entry, {recursive: true, force: true});
    } catch {
      /* best effort */
    }
  }
});

const shared = {};

// ===========================================================================
// A — the ordinary P0 boundary
// ===========================================================================

await guard('A: ordinary P0 refusal', async () => {
  const sourceDir = projectOf(ORDINARY).projectDir;
  const source = readJson(path.join(sourceDir, 'project.json'));
  const audioName = path.basename(source.audio.path);
  const variants = [
    ['external-generation', (config) => { config.permissions.externalGeneration = true; }, /externalGeneration/],
    ['local-only-off', (config) => { config.permissions.localOnly = false; }, /localOnly/],
    ['network-on', (config) => { config.permissions.allowNetwork = true; }, /allowNetwork/],
  ];
  const results = variants.map(([label, mutate, pattern]) => {
    const cloneId = `pilot-p0-${label}`;
    const target = path.join(workspaceRoot, cloneId);
    rmSync(target, {recursive: true, force: true});
    mkdirSync(path.join(target, 'source', 'audio'), {recursive: true});
    writeFileSync(path.join(target, 'source', 'audio', audioName), readFileSync(path.join(sourceDir, source.audio.path)));
    const config = JSON.parse(JSON.stringify(source));
    config.projectId = cloneId;
    mutate(config);
    writeFileSync(path.join(target, 'project.json'), `${JSON.stringify(config, null, 2)}\n`);
    cleanup.push(target);
    let message = null;
    try {
      loadProject(cloneId, {workspaceRoot, engineRoot: repoRoot});
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    return {label, refused: message !== null && pattern.test(message), message};
  });
  record('A1: an ordinary project still rejects externalGeneration, localOnly:false and allowNetwork:true',
    results.every((entry) => entry.refused), results);

  const permissions = readJson(path.join(sourceDir, 'project.json')).permissions;
  record('A2: the ordinary project keeps the P0-safe permission flags on disk',
    permissions.externalGeneration === false && permissions.localOnly === true && permissions.allowNetwork === false,
    permissions);

  const live = genStatus(RENDER, 'submit-live', ['--job', 'GEN-00000000-1']);
  record('A3: submit-live is still refused unconditionally',
    live.status === 1 && /NOT_GRANTED/.test(`${live.stderr}${live.stdout}`), {exit: live.status});

  record('A4: LIVE_PROVIDER_EXECUTION_GRANTED is false in the shipped engine',
    LIVE_PROVIDER_EXECUTION_GRANTED === false, {value: LIVE_PROVIDER_EXECUTION_GRANTED});

  const transport = genJson(ORDINARY, 'transport-check');
  record('A5: the transport reports one API host, one delivery host and a closed gate',
    transport.gateOpen === false
      && transport.provider === 'runway'
      && transport.apiHost === RUNWAY_ENDPOINT_POLICY.apiHost
      && transport.deliveryHosts.length === 1
      && /NOT_GRANTED/.test(transport.reason),
    {apiHost: transport.apiHost, gateOpen: transport.gateOpen, reason: transport.reason});
});

// ===========================================================================
// B — scoped pilot admission
// ===========================================================================

await guard('B: scoped pilot admission', async () => {
  approveStoryboard(SCOPE);
  const jobA = prepareJob(SCOPE, 'REQ-001', 'gen4_turbo', 1);
  const jobB = prepareJob(SCOPE, 'REQ-001', 'gen4_turbo', 2);
  shared.scopeJobA = jobA;
  shared.scopeJobB = jobB;
  authorize(SCOPE, jobA);
  authorize(SCOPE, jobB);
  gen(SCOPE, 'ledger-ceiling', ['--max-spend', '1.00', '--notes', 'Pilot admission rehearsal']);
  gen(SCOPE, 'reserve', ['--job', jobA]);
  gen(SCOPE, 'reserve', ['--job', jobB]);

  proposePilot(SCOPE, jobA, 'pilot-scope-01', [
    '--max-estimated-cost', '0.30', '--spend-ceiling', '1.00', '--expires-in-hours', '24',
    '--upload', 'REF-FRAME', '--notes', 'One reviewed shot, one submission, one reference.',
  ]);

  const diff = genJson(SCOPE, 'pilot-diff', ['--job', jobA, '--pilot', 'pilot-scope-01']);
  record('B1: the admission binds project, job, requirement, fingerprint, model, operation, output and references',
    diff.identical === true && diff.mismatches.length === 0 && diff.rows.length >= 10,
    {rows: diff.rows.length, mismatches: diff.mismatches});

  const before = genJsonStatus(SCOPE, 'pilot-validate', ['--job', jobA, '--pilot', 'pilot-scope-01']);
  record('B2: an unreviewed admission is PENDING and authorizes nothing',
    before.exit === 2 && before.body.status === 'PENDING' && before.body.submissionAuthorized === false,
    {status: before.body.status, blockers: before.body.blockers});

  const proposed = admissionOf(SCOPE, 'pilot-scope-01');
  const serialized = JSON.stringify(proposed);
  record('B3: the admission record carries no credential, signed URL, payload, private path, audio or lyrics',
    !/apiKey|bearer|token|secret|password/i.test(serialized)
      && !/[A-Za-z]:[\\/]/.test(serialized)
      && !/https?:\/\//.test(serialized)
      && !/lyrics|audio/i.test(serialized),
    {fields: Object.keys(proposed)});

  reviewPilot(SCOPE, jobA, 'pilot-scope-01');
  const approved = genJson(SCOPE, 'pilot-validate', ['--job', jobA, '--pilot', 'pilot-scope-01']);
  record('B4: a reviewed admission is ADMITTED_FOR_PILOT and still refuses to submit',
    approved.status === 'ADMITTED_FOR_PILOT'
      && approved.submissionAuthorized === false
      && approved.liveExecutionAuthorization === 'NOT_GRANTED',
    {status: approved.status, failedChecks: approved.checks.filter((entry) => !entry.ok)});

  const preflight = genJson(SCOPE, 'preflight', ['--job', jobA]);
  record('B5: preflight separates technical readiness from policy admission',
    preflight.technicalReadiness === 'READY'
      && preflight.policyAdmission === 'ADMITTED_FOR_PILOT'
      && preflight.budgetReservation === 'ACTIVE'
      && preflight.referenceDisclosure === 'AUTHORIZED'
      && preflight.liveExecutionAuthorization === 'NOT_GRANTED'
      && preflight.submissionState === 'NOT-SUBMITTED'
      && preflight.submissionAuthorized === false,
    {
      technicalReadiness: preflight.technicalReadiness,
      policyAdmission: preflight.policyAdmission,
      budgetReservation: preflight.budgetReservation,
      referenceDisclosure: preflight.referenceDisclosure,
      submissionState: preflight.submissionState,
    });

  const submit = genJsonStatus(SCOPE, 'pilot-submit', ['--job', jobA, '--pilot', 'pilot-scope-01']);
  record('B6: pilot-submit refuses at the live-authorization gate without consuming the admission',
    submit.exit === 1
      && submit.body.status === 'refused-live-not-granted'
      && submit.body.stage === 'live-authorization'
      && submit.body.ownership === null
      && admissionOf(SCOPE, 'pilot-scope-01').consumption.state === 'unconsumed',
    {status: submit.body.status, stage: submit.body.stage, consumption: admissionOf(SCOPE, 'pilot-scope-01').consumption.state});

  const request = genJson(SCOPE, 'pilot-request', ['--job', jobA, '--pilot', 'pilot-scope-01']);
  record('B7: the pending request shows exactly what would leave the machine, without a credential',
    request.request.sendsLyrics === false
      && request.request.sendsAudio === false
      && request.request.sendsPrivatePaths === false
      && request.request.method === 'POST'
      && request.request.referenceAssetIds.length === 1
      && !JSON.stringify(request).includes(SIMULATED_KEY),
    request.request);

  const stalePricing = genJsonStatus(SCOPE, 'pilot-validate', ['--job', jobA, '--pilot', 'pilot-scope-01', '--snapshot', 'generation/fixtures/pricing-stale.json']);
  record('B8: a stale pricing snapshot blocks the admission',
    stalePricing.exit === 2 && stalePricing.body.checks.some((entry) => !entry.ok && entry.id === 'pricing-snapshot'),
    {blockers: stalePricing.body.blockers.slice(0, 2)});

  const unsupportedPricing = genJsonStatus(SCOPE, 'pilot-validate', ['--job', jobA, '--pilot', 'pilot-scope-01', '--snapshot', 'generation/fixtures/pricing-unsupported.json']);
  record('B9: a model with no supported price blocks the admission',
    unsupportedPricing.exit === 2 && unsupportedPricing.body.checks.some((entry) => !entry.ok && entry.id === 'cost-within-admission'),
    {blockers: unsupportedPricing.body.blockers.filter((entry) => /estimate/i.test(entry))});

  gen(SCOPE, 'ledger-ceiling', ['--max-spend', '0.05', '--notes', 'Temporary ceiling below the estimate']);
  const exhausted = genJsonStatus(SCOPE, 'pilot-validate', ['--job', jobA, '--pilot', 'pilot-scope-01']);
  gen(SCOPE, 'ledger-ceiling', ['--max-spend', '1.00', '--notes', 'Restored after the budget-exhaustion check']);
  record('B10: an exhausted project budget blocks the admission',
    exhausted.body.checks.some((entry) => !entry.ok && entry.id === 'project-budget'),
    {blockers: exhausted.body.blockers.filter((entry) => /budget/i.test(entry))});

  const foreignDocument = path.join(projectOf(ORDINARY).projectDir, 'generation', 'pilot-admission.json');
  mkdirSync(path.dirname(foreignDocument), {recursive: true});
  writeFileSync(foreignDocument, readFileSync(path.join(projectOf(SCOPE).projectDir, 'generation', 'pilot-admission.json')));
  let crossProjectError = null;
  try {
    readPilotAdmissions(projectOf(ORDINARY));
  } catch (error) {
    crossProjectError = error instanceof Error ? error.message : String(error);
  }
  rmSync(foreignDocument, {force: true});
  record('B11: an admission document from another project fails closed on load',
    crossProjectError !== null && /cross-project|declares|belongs to/.test(crossProjectError), {message: crossProjectError});

  const reportsDir = path.join(projectOf(SCOPE).projectDir, 'generation', 'reports');
  const escapeTarget = path.join(workspaceRoot, 'pilot-escape-target');
  mkdirSync(escapeTarget, {recursive: true});
  cleanup.push(escapeTarget);
  let junctionCreated = false;
  try {
    symlinkSync(escapeTarget, `${reportsDir}-link`, 'junction');
    renameSync(reportsDir, `${reportsDir}-real`);
    renameSync(`${reportsDir}-link`, reportsDir);
    junctionCreated = true;
  } catch {
    junctionCreated = false;
  }
  const escaped = genJsonStatus(SCOPE, 'pilot-submit', ['--job', jobA, '--pilot', 'pilot-scope-01']);
  if (junctionCreated) {
    rmdirSync(reportsDir);
    renameSync(`${reportsDir}-real`, reportsDir);
  } else if (existsSync(`${reportsDir}-link`)) {
    rmdirSync(`${reportsDir}-link`);
  }
  record('B12: a linked write destination inside the project is refused',
    escaped.exit === 1 && /link|junction|escapes|forbidden/i.test(`${escaped.stderr}`),
    {junctionCreated, exit: escaped.exit, message: `${escaped.stderr}`.trim().split('\n')[0]});

  proposePilot(SCOPE, jobA, 'pilot-scope-failed', [
    '--max-estimated-cost', '0.30', '--upload', 'REF-FRAME', '--notes', 'Negative control: the provider reports failure.',
  ]);
  reviewPilot(SCOPE, jobA, 'pilot-scope-failed');
  const failedRun = genJsonStatus(SCOPE, 'pilot-simulate', [
    '--job', jobA, '--pilot', 'pilot-scope-failed', '--fixtures', 'generation/fixtures/failed-task.json',
  ]);
  const failedJob = jobOf(SCOPE, jobA);
  const intake = readJsonIfPresent(path.join(projectOf(SCOPE).projectDir, 'preproduction', 'asset-intake.json'));
  record('B13: a provider task that reports failure produces no output and no asset',
    failedRun.exit === 1
      && failedJob.execution.state === 'failed'
      && failedJob.result.files.length === 0
      && (intake?.records ?? []).length === 0,
    {exit: failedRun.exit, state: failedJob.execution.state, files: failedJob.result.files.length});

  const project = projectOf(SCOPE);
  writeEvidence(project, 'pilot-admission-evidence.json', {
    jobA, jobB,
    diff: diff.rows,
    beforeReview: before.body.status,
    approved: approved.status,
    preflight: {
      technicalReadiness: preflight.technicalReadiness,
      policyAdmission: preflight.policyAdmission,
      budgetReservation: preflight.budgetReservation,
      referenceDisclosure: preflight.referenceDisclosure,
      liveExecutionAuthorization: preflight.liveExecutionAuthorization,
      submissionState: preflight.submissionState,
      submissionAuthorized: preflight.submissionAuthorized,
    },
    submit: {status: submit.body.status, stage: submit.body.stage},
    request: request.request,
    failedTask: {exit: failedRun.exit, state: failedJob.execution.state},
  });
});

// ===========================================================================
// C — one-shot concurrency and uncertain outcomes
// ===========================================================================

await guard('C: one-shot concurrency', async () => {
  approveStoryboard(CONCURRENCY);
  const job1 = prepareJob(CONCURRENCY, 'REQ-001', 'gen4_turbo', 1);
  const job2 = prepareJob(CONCURRENCY, 'REQ-002', 'gen4_turbo', 1);
  shared.concurrencyJob1 = job1;
  shared.concurrencyJob2 = job2;
  authorize(CONCURRENCY, job1);
  authorize(CONCURRENCY, job2);
  gen(CONCURRENCY, 'ledger-ceiling', ['--max-spend', '1.00', '--notes', 'One-shot concurrency rehearsal']);
  gen(CONCURRENCY, 'reserve', ['--job', job1]);
  gen(CONCURRENCY, 'reserve', ['--job', job2]);

  const withoutAdmission = genJsonStatus(CONCURRENCY, 'preflight', ['--job', job2]);
  record('C1: a job with no pilot admission reports DENIED_P0 and authorizes nothing',
    withoutAdmission.body.policyAdmission === 'DENIED_P0' && withoutAdmission.body.submissionAuthorized === false,
    {policyAdmission: withoutAdmission.body.policyAdmission, exit: withoutAdmission.exit});
  const noAdmissionSubmit = genStatus(CONCURRENCY, 'pilot-submit', ['--job', job2]);
  record('C2: pilot submission without an admission is refused before any network activity',
    noAdmissionSubmit.status === 1 && /No pilot admission/i.test(`${noAdmissionSubmit.stderr}`),
    {exit: noAdmissionSubmit.status, message: `${noAdmissionSubmit.stderr}`.trim().split('\n')[0]});

  proposePilot(CONCURRENCY, job1, 'pilot-race-01', [
    '--max-estimated-cost', '0.30', '--upload', 'REF-FRAME', '--notes', 'Two processes race for this single shot.',
  ]);
  reviewPilot(CONCURRENCY, job1, 'pilot-race-01');

  const race = spawnSync(
    process.execPath,
    [raceScript, generationCli, workspaceRoot, CONCURRENCY, job1, 'pilot-race-01', 'generation/fixtures/video-task.json'],
    {encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, windowsHide: true, env: process.env, timeout: 600_000},
  );
  if (race.status !== 0) throw new Error(`race helper failed: ${race.stderr || race.stdout}`);
  const outcome = JSON.parse(race.stdout.slice(race.stdout.indexOf('{'))).results;
  const winners = outcome.filter((entry) => entry.status === 'submitted');
  record('C3: two processes targeting one admission produce exactly one submission',
    winners.length === 1 && outcome.filter((entry) => entry.code !== 0).length === 1,
    {codes: outcome.map((entry) => entry.code), statuses: outcome.map((entry) => entry.status)});

  const raceAdmission = admissionOf(CONCURRENCY, 'pilot-race-01');
  const raceJob = jobOf(CONCURRENCY, job1);
  const ledger = readJson(path.join(projectOf(CONCURRENCY).projectDir, LEDGER_PATHS.ledger));
  const raceEntries = ledger.entries.filter((entry) => entry.jobId === job1);
  const submitRecords = (raceJob.execution.attemptHistory ?? []).filter((entry) => entry.phase === 'submit');
  record('C4: the winner took ownership exactly once and recorded one durable task id',
    raceAdmission.consumption.state === 'consumed'
      && raceAdmission.consumption.submissionKey !== null
      && raceAdmission.consumption.providerTaskId === 'task-pilot-1'
      && submitRecords.length === 1
      && raceJob.execution.providerTaskId === 'task-pilot-1',
    {
      consumption: raceAdmission.consumption.state,
      submissionKey: raceAdmission.consumption.submissionKey,
      submitRecords: submitRecords.length,
      taskId: raceJob.execution.providerTaskId,
    });
  record('C5: the budget is reserved once per job and never twice for the same submission',
    raceEntries.length === 1
      && raceEntries[0].reservedUsd === 0.25
      && ledger.entries.length === 2,
    {entries: ledger.entries.length, reserved: raceEntries[0]?.reservedUsd});

  const secondAttempt = genJsonStatus(CONCURRENCY, 'pilot-simulate', [
    '--job', job1, '--pilot', 'pilot-race-01', '--fixtures', 'generation/fixtures/video-task.json',
  ]);
  record('C6: a consumed admission cannot be simulated again',
    secondAttempt.exit === 1 && /consumed|already bound/i.test(`${secondAttempt.stderr}${secondAttempt.stdout}`),
    {exit: secondAttempt.exit});

  const expiresAt = new Date(Date.now() + 2_000).toISOString();
  proposePilot(CONCURRENCY, job2, 'pilot-c-expired', ['--expires-at', expiresAt, '--upload', 'REF-FRAME', '--notes', 'Expiry control.']);
  reviewPilot(CONCURRENCY, job2, 'pilot-c-expired');
  await new Promise((resolve) => setTimeout(resolve, 2_500));
  const expired = genJsonStatus(CONCURRENCY, 'pilot-validate', ['--job', job2, '--pilot', 'pilot-c-expired']);
  record('C7: an expired admission is refused and is not silently renewed',
    expired.body.status === 'REFUSED' && expired.body.refusalCode === 'admission-expired' && expired.body.expired === true,
    {status: expired.body.status, code: expired.body.refusalCode});

  proposePilot(CONCURRENCY, job2, 'pilot-c-revoked', ['--upload', 'REF-FRAME', '--notes', 'Revocation control.']);
  reviewPilot(CONCURRENCY, job2, 'pilot-c-revoked');
  gen(CONCURRENCY, 'pilot-revoke', ['--job', job2, '--pilot', 'pilot-c-revoked', '--notes', 'Revoked during the rehearsal.']);
  const revoked = genJsonStatus(CONCURRENCY, 'pilot-validate', ['--job', job2, '--pilot', 'pilot-c-revoked']);
  record('C8: a revoked admission is refused and the revocation is recorded',
    revoked.body.status === 'REFUSED'
      && revoked.body.refusalCode === 'admission-revoked'
      && admissionOf(CONCURRENCY, 'pilot-c-revoked').approvalState === 'revoked',
    {status: revoked.body.status, code: revoked.body.refusalCode});

  proposePilot(CONCURRENCY, job2, 'pilot-c-nodisclose', ['--notes', 'No reference upload authorized.']);
  const refusedReview = genStatus(CONCURRENCY, 'pilot-review', [
    '--job', job2, '--pilot', 'pilot-c-nodisclose', '--decision', 'approve', '--notes', 'Should be refused.',
  ]);
  const nodisclose = genJsonStatus(CONCURRENCY, 'pilot-validate', ['--job', job2, '--pilot', 'pilot-c-nodisclose']);
  record('C9: a reference without recorded upload permission blocks review and validation',
    refusedReview.status === 1
      && /reference-disclosure/.test(`${refusedReview.stderr}`)
      && nodisclose.body.status !== 'ADMITTED_FOR_PILOT',
    {reviewExit: refusedReview.status, status: nodisclose.body.status});

  proposePilot(CONCURRENCY, job2, 'pilot-c-uncertain', ['--upload', 'REF-FRAME', '--notes', 'Uncertain-outcome control.']);
  reviewPilot(CONCURRENCY, job2, 'pilot-c-uncertain');
  const timeoutRun = genJsonStatus(CONCURRENCY, 'pilot-simulate', [
    '--job', job2, '--pilot', 'pilot-c-uncertain', '--fixtures', 'generation/fixtures/timeout.json',
  ]);
  const uncertainJob = jobOf(CONCURRENCY, job2);
  const uncertainAdmission = admissionOf(CONCURRENCY, 'pilot-c-uncertain');
  const uncertainLedger = readJson(path.join(projectOf(CONCURRENCY).projectDir, LEDGER_PATHS.ledger));
  const uncertainEntry = uncertainLedger.entries.find((entry) => entry.jobId === job2);
  record('C10: a submission that may have succeeded is parked as uncertain with no task id',
    timeoutRun.body?.status === 'uncertain'
      && uncertainJob.execution.state === 'unknown-submission-state'
      && uncertainJob.execution.providerTaskId === null
      && uncertainAdmission.consumption.state === 'uncertain',
    {status: timeoutRun.body?.status, jobState: uncertainJob.execution.state, admission: uncertainAdmission.consumption.state});

  const retry = genStatus(CONCURRENCY, 'pilot-simulate', [
    '--job', job2, '--pilot', 'pilot-c-uncertain', '--fixtures', 'generation/fixtures/video-task.json',
  ]);
  record('C11: an uncertain submission is never retried automatically and the exposure stays reserved',
    retry.status === 1 && uncertainEntry?.status === 'reserved' && uncertainEntry?.reservedUsd === 0.25,
    {exit: retry.status, entryStatus: uncertainEntry?.status, reserved: uncertainEntry?.reservedUsd});

  writeEvidence(projectOf(CONCURRENCY), 'pilot-concurrency-evidence.json', {
    job1, job2,
    race: outcome,
    admission: {state: raceAdmission.consumption.state, submissionKey: raceAdmission.consumption.submissionKey},
    ledger: uncertainLedger.entries.map((entry) => ({jobId: entry.jobId, status: entry.status, reservedUsd: entry.reservedUsd})),
    uncertain: {jobState: uncertainJob.execution.state, admission: uncertainAdmission.consumption.state},
  });
});

// ===========================================================================
// D — full fake-provider lifecycle to a real render
// ===========================================================================

await guard('D: fake provider lifecycle', async () => {
  approveStoryboard(RENDER);
  const jobId = prepareJob(RENDER, 'REQ-001', 'gen4_turbo', 1);
  shared.renderJob = jobId;
  authorize(RENDER, jobId);
  gen(RENDER, 'ledger-ceiling', ['--max-spend', '1.00', '--notes', 'Lifecycle rehearsal']);
  gen(RENDER, 'reserve', ['--job', jobId]);
  proposePilot(RENDER, jobId, 'pilot-render-01', [
    '--max-estimated-cost', '0.30', '--spend-ceiling', '1.00', '--upload', 'REF-FRAME',
    '--notes', 'One shot, one submission, one render.',
  ]);
  reviewPilot(RENDER, jobId, 'pilot-render-01');

  const validate = genJson(RENDER, 'pilot-validate', ['--job', jobId, '--pilot', 'pilot-render-01']);
  record('D1: the render project admission is ADMITTED_FOR_PILOT',
    validate.status === 'ADMITTED_FOR_PILOT' && validate.liveExecutionAuthorization === 'NOT_GRANTED',
    {status: validate.status});

  const simulate = genJson(RENDER, 'pilot-simulate', [
    '--job', jobId, '--pilot', 'pilot-render-01', '--fixtures', 'generation/fixtures/video-task.json',
  ]);
  const project = projectOf(RENDER);
  const storedRelative = simulate.resumed?.retrieved?.storedPath;
  const storedAbsolute = storedRelative ? path.join(project.projectDir, storedRelative) : null;
  record('D2: one submission yields a durable task id, bounded polling and real local bytes',
    simulate.status === 'submitted'
      && simulate.providerTaskId === 'task-pilot-1'
      && simulate.resumed?.state === 'retrieved'
      && simulate.resumed.polls >= 1
      && storedAbsolute !== null
      && existsSync(storedAbsolute)
      && sha(storedAbsolute) === simulate.resumed.retrieved.sha256
      && simulate.providerContacted === false,
    {status: simulate.status, taskId: simulate.providerTaskId, polls: simulate.resumed?.polls, stored: storedRelative});

  const originalSha = storedAbsolute ? sha(storedAbsolute) : null;
  const resubmit = genStatus(RENDER, 'pilot-simulate', [
    '--job', jobId, '--pilot', 'pilot-render-01', '--fixtures', 'generation/fixtures/video-task.json',
  ]);
  record('D3: the same job is never submitted twice',
    resubmit.status === 1, {exit: resubmit.status});

  const reused = genJsonStatus(RENDER, 'pilot-validate', ['--job', jobId, '--pilot', 'pilot-render-01']);
  record('D11: the consumed admission is refused afterwards',
    reused.body.status === 'REFUSED' && ['admission-consumed', 'admission-uncertain'].includes(reused.body.refusalCode),
    {status: reused.body.status, code: reused.body.refusalCode});

  const inspection = genJson(RENDER, 'inspect-media', ['--file', storedRelative]);
  record('D4: the retrieved clip is deliberately incompatible with the renderer',
    inspection.inspection.timing.variableFrameRate
      && Math.abs(inspection.inspection.rotation) > 0.01
      && inspection.inspection.audioStreamCount === 1,
    {rotation: inspection.inspection.rotation, audioStreams: inspection.inspection.audioStreamCount});

  const corrupt = path.join(project.projectDir, 'generation', 'outputs', jobId, 'corrupt.mp4');
  writeFileSync(corrupt, 'not a video');
  const corruptStage = genStatus(RENDER, 'stage', ['--job', jobId, '--file', `generation/outputs/${jobId}/corrupt.mp4`, '--rights', 'corrupt attempt']);
  const crossStage = genStatus(RENDER, 'stage', ['--job', jobId, '--file', `../${CONCURRENCY}/project.json`, '--rights', 'cross-project attempt']);
  rmSync(corrupt, {force: true});
  record('D5: corrupt media and a cross-project path are refused at intake',
    corruptStage.status === 1 && crossStage.status === 1,
    {corrupt: corruptStage.status, crossProject: crossStage.status});

  const normalized = genJson(RENDER, 'normalize', [
    '--job', jobId, '--fps', '24', '--width', '640', '--height', '360',
    '--rights', 'Derived locally from simulated provider output; synthetic fixture bytes',
  ]);
  const staged = genJson(RENDER, 'stage', [
    '--job', jobId, '--rights', 'Simulated provider output through a recorded fixture; synthetic bytes',
  ]);
  const blocked = preStatus(RENDER, 'compile');
  record('D6: normalization keeps the provider original and staging lands as pending',
    normalized.normalized === true
      && normalized.original.sha256 === simulate.resumed.retrieved.sha256
      && sha(storedAbsolute) === originalSha
      && staged.staged.review === 'pending'
      && blocked.status === 2,
    {derived: normalized.derived.sha256, original: normalized.original.sha256, review: staged.staged.review});

  gen(RENDER, 'review', ['--job', jobId, '--decision', 'approve', '--notes', 'Reviewed the normalized clip, both hashes and the provenance.']);
  pre(RENDER, 'storyboard', ['--new-revision']);
  pre(RENDER, 'approve-storyboard');
  const compileResult = preStatus(RENDER, 'compile');
  if (compileResult.status !== 0) {
    throw new Error(`compile failed: ${compileResult.stdout}${compileResult.stderr}`);
  }
  const compile = JSON.parse(compileResult.stdout);
  const candidate = readJson(path.join(project.projectDir, 'preproduction', 'project-candidate.json'));
  const shot = candidate.chapters.flatMap((chapter) => chapter.shots).find((entry) => entry.id === 'SHOT-001');
  record('D7: the approved clip compiles into a muted Video shot',
    compile.status === 'ready' && shot.renderer === 'video' && shot.media?.kind === 'video' && shot.media.muted === true,
    {compile: compile.status, media: shot.media});

  pre(RENDER, 'render-preview', ['--frames', '0-47']);
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
  record('D8: the preview is a real H.264 MP4 with exactly one soundtrack',
    video.codec_name === 'h264'
      && video.width === 640
      && video.height === 360
      && video.r_frame_rate === '24/1'
      && Number(video.nb_frames) === 48
      && audioStreams.length === 1
      && audioEvidence.masterTone > 1e-4,
    {
      video: {codec: video.codec_name, width: video.width, height: video.height, fps: video.r_frame_rate, frames: Number(video.nb_frames)},
      audioStreams: audioStreams.length,
      audioEvidence,
    });
  record('D9: decoded frames differ across the normalized clip',
    signatureDistance(frames[0].signature, frames[1].signature) > 3,
    {distance: signatureDistance(frames[0].signature, frames[1].signature), frames: frames.map((entry) => entry.rgb)});
  record('D10: the provider original stays byte-identical through staging, approval and render',
    sha(storedAbsolute) === originalSha, {expected: originalSha, actual: sha(storedAbsolute)});

  writeEvidence(project, 'pilot-render-evidence.json', {
    jobId,
    simulate: {
      status: simulate.status,
      taskId: simulate.providerTaskId,
      polls: simulate.resumed?.polls,
      stored: storedRelative,
      sha256: simulate.resumed?.retrieved?.sha256,
    },
    normalize: {original: normalized.original.sha256, derived: normalized.derived.sha256},
    staged: staged.staged,
    compile: {status: compile.status, media: shot.media},
    render: {
      video: {codec: video.codec_name, width: video.width, height: video.height, fps: video.r_frame_rate, frames: Number(video.nb_frames)},
      audioStreams: audioStreams.length,
      audioEvidence,
      frames: frames.map((entry) => entry.rgb),
    },
  });
});

// ===========================================================================
// F — real adapter and transport wiring against a controlled local HTTPS server
// ===========================================================================

await guard('F: transport wiring', async () => {
  let hasOpenssl = true;
  try {
    execFileSync('openssl', ['version'], {stdio: 'pipe', windowsHide: true});
  } catch {
    hasOpenssl = false;
  }
  record('F0: openssl is available for the controlled TLS server', hasOpenssl, {});
  if (!hasOpenssl) return;

  const certDir = mkdtempSync(path.join(tmpdir(), 'mv-pilot-tls-'));
  cleanup.push(certDir);
  const openssl = (argv) => execFileSync('openssl', argv, {cwd: certDir, stdio: 'pipe', windowsHide: true});
  openssl(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'ca.key', '-out', 'ca.pem', '-days', '2', '-subj', '/CN=MVFoundry Pilot Test CA']);
  openssl(['req', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'server.key', '-out', 'server.csr', '-subj', `/CN=${SIMULATED_HOST}`]);
  writeFileSync(path.join(certDir, 'server.cnf'), `subjectAltName=DNS:${SIMULATED_HOST}\n`);
  openssl(['x509', '-req', '-in', 'server.csr', '-CA', 'ca.pem', '-CAkey', 'ca.key', '-CAcreateserial', '-out', 'server.pem', '-days', '2', '-extfile', 'server.cnf']);
  const caPem = readFileSync(path.join(certDir, 'ca.pem'), 'utf8');
  const key = readFileSync(path.join(certDir, 'server.key'), 'utf8');
  const cert = readFileSync(path.join(certDir, 'server.pem'), 'utf8');

  const seen = [];
  const server = createHttpsServer({key, cert}, (request, response) => {
    // The body must be drained before responding: answering early lets Node
    // reset the connection while the client is still writing, which would look
    // like an unknown submission outcome.
    request.on('data', () => {});
    request.on('end', () => {
      seen.push({
        method: request.method,
        path: request.url,
        version: request.headers['x-runway-version'] ?? null,
        authorization: Boolean(request.headers.authorization),
      });
      response.writeHead(200, {'content-type': 'application/json'});
      if (request.method === 'POST') {
        response.end(JSON.stringify({id: 'task-pilot-tls'}));
        return;
      }
      response.end(JSON.stringify({id: 'task-pilot-tls', status: 'SUCCEEDED', output: [`${'https'}://${DELIVERY_HOST}/clip.mp4`]}));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  try {
    const project = projectOf(SCOPE);
    const boundary = createProjectWriteBoundary(project, {engineRoot: repoRoot});
    const job = jobsOf(SCOPE).find((entry) => entry.requestRevision === 2);
    if (!job) throw new Error('the second scope job is missing');
    const permissionRecord = readJson(path.join(project.projectDir, 'generation', 'permissions.json'))
      .records.find((entry) => entry.jobId === job.jobId);
    if (!permissionRecord) throw new Error(`the second job ${job.jobId} has no permission record`);
    const storyboard = readJson(path.join(project.projectDir, 'preproduction', 'storyboard.json'));
    const requirement = storyboard.assetRequirements.find((entry) => entry.id === job.requirementId) ?? null;
    const model = RUNWAY_CAPABILITIES.models.find((entry) => entry.id === job.model);
    const estimate = estimateGenerationCost({
      snapshot: RUNWAY_PRICING_SNAPSHOT,
      model: job.model,
      operation: job.operation,
      outputLongEdge: outputLongEdgeForJob(job),
      billableSeconds: billableSecondsForJob(job, resolveProviderDuration(model, (job.output.durationFrames ?? 0) / job.output.fps)),
      referenceCount: job.inputAssets.length,
      now: new Date(),
    });
    const references = job.inputAssets.map((asset) => {
      const prepared = prepareReferenceInput({
        project,
        assetId: asset.assetId,
        expectedSha256: asset.sha256,
        provider: job.provider,
        model: job.model,
        maxReferences: model ? model.maxReferences : 0,
        disclosure: 'authorized-for-simulation',
        engineRoot: repoRoot,
      });
      return {assetId: prepared.assetId, sha256: prepared.sha256, disclosure: prepared.disclosure, blockers: prepared.blockers};
    });
    const request = buildProviderRequest({
      job,
      references: job.inputAssets.map((asset) => ({assetId: asset.assetId, path: asset.assetId, sha256: asset.sha256})),
    });

    proposePilot(SCOPE, job.jobId, 'pilot-tls-01', [
      '--max-estimated-cost', '0.30', '--upload', 'REF-FRAME',
      '--notes', 'Transport wiring rehearsal against a controlled local server.',
    ]);
    reviewPilot(SCOPE, job.jobId, 'pilot-tls-01');

    const transport = createLiveHttpsTransport({
      policy: {provider: 'runway', apiHost: SIMULATED_HOST, deliveryHosts: []},
      resolver: async () => ['127.0.0.1'],
      classifyAddress: (address) =>
        address === '127.0.0.1' || address === '::1'
          ? 'allowed'
          : isDisallowedAddress(address)
            ? 'blocked-address'
            : 'allowed',
      liveExecutionEnabled: true,
      environment: {},
      trustedCa: [caPem],
      request: (options, callback) => require('node:https').request({...options, port}, callback),
    });
    const provider = createRunwayProvider({
      transport: createProviderHttpTransport(transport, {provider: 'runway', apiHost: SIMULATED_HOST, deliveryHosts: []}),
      apiKey: SIMULATED_KEY,
      baseUrl: SIMULATED_BASE_URL,
    });

    const outcome = await runPilotSubmission({
      project,
      boundary,
      job,
      requirement,
      storyboard: {revision: storyboard.revision, status: storyboard.status, renderReady: storyboard.renderReady},
      permissionRecord,
      capabilities: provider.capabilities,
      capabilityViolations: provider.validate(request),
      request,
      estimate,
      pricing: RUNWAY_PRICING_SNAPSHOT,
      references,
      credentialsPresent: true,
      transport: {ready: true, reason: 'controlled local HTTPS server'},
      endpoint: {provider: 'runway', apiHost: SIMULATED_HOST, deliveryHosts: []},
      grant: {kind: 'simulated', reason: 'controlled local HTTPS server'},
      driver: createAdapterDriver(provider, 'simulated'),
    });

    const submitCall = seen.find((entry) => entry.method === 'POST');
    record('F1: the real adapter and the real secure transport submit through a controlled local HTTPS server',
      outcome.status === 'submitted'
        && outcome.providerTaskId === 'task-pilot-tls'
        && submitCall?.path === '/v1/image_to_video'
        && submitCall?.version !== null
        && submitCall?.authorization === true,
      {status: outcome.status, taskId: outcome.providerTaskId, call: submitCall, blockers: outcome.blockers});
    record('F2: the recorded admission is bound to the task the local server returned',
      admissionOf(SCOPE, 'pilot-tls-01').consumption.providerTaskId === 'task-pilot-tls'
        && outcome.providerContacted === false,
      {admissionTaskId: admissionOf(SCOPE, 'pilot-tls-01').consumption.providerTaskId});

    const closedTransport = createLiveHttpsTransport({
      policy: {provider: 'runway', apiHost: SIMULATED_HOST, deliveryHosts: []},
      resolver: async () => ['127.0.0.1'],
      classifyAddress: () => 'allowed',
      environment: {},
    });
    let closedError = null;
    try {
      await closedTransport({
        method: 'GET',
        url: `${SIMULATED_BASE_URL}/v1/tasks/x`,
        headers: {},
        body: null,
        authorizationHosts: [SIMULATED_HOST],
      });
    } catch (error) {
      closedError = error instanceof TransportError ? error.code : String(error);
    }
    record('F3: the same transport refuses every request while the live gate is closed',
      closedError === 'live-not-authorized', {code: closedError});

    writeEvidence(project, 'pilot-transport-evidence.json', {
      jobId: job.jobId,
      calls: seen,
      outcome: {status: outcome.status, taskId: outcome.providerTaskId, stage: outcome.stage},
      note: 'A controlled local HTTPS server with a generated CA. No provider endpoint was resolved, contacted or billed.',
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

// ===========================================================================
// E — negative controls that need the earlier state
// ===========================================================================

await guard('E: negative controls', async () => {
  const jobA = shared.scopeJobA;
  const job1 = shared.concurrencyJob1;
  const renderJob = shared.renderJob;

  const wrongProject = genStatus(SCOPE, 'pilot-validate', ['--job', jobA, '--pilot', 'pilot-render-01']);
  record('E1: an admission cannot be used from another project',
    wrongProject.status === 1 && /unknown pilot/i.test(`${wrongProject.stderr}`), {exit: wrongProject.status});

  const wrongJob = genStatus(CONCURRENCY, 'pilot-validate', ['--job', job1, '--pilot', 'pilot-scope-01']);
  record('E2: an admission bound to one job cannot validate another job',
    wrongJob.status === 1 && /bound to job|unknown pilot/i.test(`${wrongJob.stderr}`), {exit: wrongJob.status});

  const unsupportedModel = genStatus(SCOPE, 'prepare', [
    '--requirement', 'REQ-001', '--provider', 'runway', '--model', 'gen4_unknown', '--revision', '9',
  ]);
  record('E3: an unsupported model is rejected before any submission',
    unsupportedModel.status !== 0, {exit: unsupportedModel.status});

  const withoutKey = {...process.env};
  delete withoutKey.RUNWAY_API_KEY;
  const noCredential = genJsonStatus(SCOPE, 'pilot-validate', ['--job', jobA, '--pilot', 'pilot-scope-01'], withoutKey);
  record('E4: a missing credential blocks the admission without printing one',
    noCredential.body.checks.some((entry) => !entry.ok && entry.id === 'credentials')
      && !JSON.stringify(noCredential.body).includes(SIMULATED_KEY),
    {blockers: noCredential.body.blockers.filter((entry) => /credential/i.test(entry))});

  const referenceTamper = (() => {
    const file = path.join(projectOf(SCOPE).projectDir, 'generation', 'pilot-admission.json');
    const document = readJson(file);
    const target = document.admissions.find((entry) => entry.pilotId === 'pilot-scope-01');
    const original = target.references[0].sha256;
    target.references[0].sha256 = 'f'.repeat(64);
    writeFileSync(file, `${JSON.stringify(document, null, 2)}\n`);
    const result = genJsonStatus(SCOPE, 'pilot-validate', ['--job', jobA, '--pilot', 'pilot-scope-01']);
    target.references[0].sha256 = original;
    writeFileSync(file, `${JSON.stringify(document, null, 2)}\n`);
    return result;
  })();
  record('E5: a changed reference hash invalidates the admission',
    referenceTamper.body.status === 'REFUSED' && referenceTamper.body.refusalCode === 'reference-changed',
    {status: referenceTamper.body.status, code: referenceTamper.body.refusalCode});

  const taskConflict = (() => {
    const file = path.join(projectOf(RENDER).projectDir, 'generation', 'jobs.json');
    const document = readJson(file);
    const target = document.jobs.find((entry) => entry.jobId === renderJob);
    const original = target.execution.providerTaskId;
    target.execution.providerTaskId = 'task-conflicting-id';
    writeFileSync(file, `${JSON.stringify(document, null, 2)}\n`);
    const result = genStatus(RENDER, 'pilot-simulate', [
      '--job', renderJob, '--pilot', 'pilot-render-01', '--fixtures', 'generation/fixtures/video-task.json',
    ]);
    const after = readJson(file).jobs.find((entry) => entry.jobId === renderJob).execution.providerTaskId;
    target.execution.providerTaskId = original;
    writeFileSync(file, `${JSON.stringify(document, null, 2)}\n`);
    return {exit: result.status, after};
  })();
  record('E6: a conflicting provider task id is never silently rebound',
    taskConflict.exit === 1 && taskConflict.after === 'task-conflicting-id', taskConflict);

  const consumedReview = genStatus(CONCURRENCY, 'pilot-review', [
    '--job', job1, '--pilot', 'pilot-race-01', '--decision', 'deny', '--notes', 'Should be refused: already consumed.',
  ]);
  record('E7: a consumed admission cannot be reviewed into a new attempt',
    consumedReview.status === 1, {exit: consumedReview.status});

  const staleStoryboard = (() => {
    const current = readJson(path.join(projectOf(SCOPE).projectDir, 'preproduction', 'storyboard.json')).revision;
    pre(SCOPE, 'storyboard', ['--new-revision']);
    pre(SCOPE, 'approve-storyboard', ['--revision', String(current + 1)]);
    return genJsonStatus(SCOPE, 'pilot-validate', ['--job', jobA, '--pilot', 'pilot-scope-01']);
  })();
  record('E8: a new storyboard revision invalidates the admission',
    staleStoryboard.body.status === 'REFUSED' && staleStoryboard.body.refusalCode === 'storyboard-changed',
    {status: staleStoryboard.body.status, code: staleStoryboard.body.refusalCode});

  const fingerprintChange = (() => {
    const project = projectOf(SCOPE);
    const briefPath = path.join(project.projectDir, 'preproduction', 'creative-brief.json');
    const brief = readJson(briefPath);
    brief.concept = `${brief.concept} (revised for the fingerprint control)`;
    writeFileSync(briefPath, `${JSON.stringify(brief, null, 2)}\n`);
    pre(SCOPE, 'plan', ['--new-revision']);
    pre(SCOPE, 'approve-plan', ['--revision', '2']);
    const current = readJson(path.join(project.projectDir, 'preproduction', 'storyboard.json')).revision;
    pre(SCOPE, 'storyboard', ['--new-revision']);
    pre(SCOPE, 'approve-storyboard', ['--revision', String(current + 1)]);
    return genJsonStatus(SCOPE, 'pilot-validate', ['--job', jobA, '--pilot', 'pilot-scope-01']);
  })();
  record('E9: a changed requirement fingerprint invalidates the admission',
    fingerprintChange.body.status === 'REFUSED'
      && ['fingerprint-changed', 'storyboard-changed', 'requirement-mismatch'].includes(fingerprintChange.body.refusalCode),
    {status: fingerprintChange.body.status, code: fingerprintChange.body.refusalCode});

  record('E10: no refusal produced an approved-looking asset',
    (readJsonIfPresent(path.join(projectOf(SCOPE).projectDir, 'preproduction', 'asset-intake.json'))?.records ?? []).every(
      (entry) => entry.review === 'pending',
    ),
    {records: (readJsonIfPresent(path.join(projectOf(SCOPE).projectDir, 'preproduction', 'asset-intake.json'))?.records ?? []).length});
});

const pass = checks.every((check) => check.pass);
console.log(JSON.stringify({
  pass,
  total: checks.length,
  failed: checks.filter((check) => !check.pass).map((check) => check.name),
  liveProviderExecution: LIVE_PROVIDER_EXECUTION_GRANTED ? 'GRANTED (unexpected)' : 'NOT_GRANTED',
  liveAiGeneration: 'NOT RUN - NOT AUTHORIZED',
  paidProviderSubmissions: 0,
  realProviderCostObservation: 'NOT RUN',
  note: 'Every submit, poll and download in this run came from a recorded fixture or a controlled local HTTPS server. No provider was contacted.',
}, null, 2));
if (!pass) process.exitCode = 1;
