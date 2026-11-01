// Generation job CLI: prepare, authorize, execute offline, simulate a remote
// lifecycle, hand off, review and report.
//
// Usage: npm run generation -- <command> --project <id> [--workspace <root>]
// Requires npm run build and MV_WORKSPACE_ROOT or --workspace.

import {createHash} from 'node:crypto';
import {existsSync, readFileSync, statSync} from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
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
  prepare --project <id> --requirement <REQ> [--provider offline-fixture|runway] [--model M] [--revision N]
  status --project <id> [--job <JOB>]
  inspect --project <id> --job <JOB>
  approve-request --project <id> --job <JOB> --authorization <authorized-for-simulation|denied> \
    --max-spend <usd> [--max-submissions N] [--uploads-private] --notes "<review>"
  run-offline --project <id> --job <JOB> [--rights "<rights assertion>"] [--replace-approved --reason "<why>"]
  submit-live --project <id> --job <JOB>
  resume --project <id> --job <JOB> [--fixtures <fixture.json>]
  inspect-output --project <id> --job <JOB>
  prepare-references --project <id> --job <JOB> [--authorize-disclosure]
  validate-response --project <id> --job <JOB> --response <project-relative.json>
  retrieve --project <id> --job <JOB> --fixture <fixture.json> [--out <project-relative>] [--max-bytes N] [--rights "<rights>"]
  resume-retrieval --project <id> --job <JOB> --fixture <fixture.json> [--out <project-relative>] [--rights "<rights>"]
  inspect-media --project <id> --file <project-relative>
  normalize --project <id> --job <JOB> [--file <project-relative>] [--fps N] [--width W] [--height H] [--rights "<rights>"]
  compare-media --project <id> --original <project-relative> --derived <project-relative>
  stage --project <id> --job <JOB> [--file <project-relative>] --rights "<rights>" [--replace-approved --reason "<why>"]
  handoff --project <id> --job <JOB> [--file <project-relative-output>] --rights "<rights>"
  review --project <id> --job <JOB> --decision <approve|reject> --notes "<review>"
  blockers --project <id> --job <JOB>
  pricing --project <id> [--snapshot <project-relative.json>]
  estimate --project <id> --job <JOB> [--snapshot <project-relative.json>]
  ledger --project <id>
  ledger-ceiling --project <id> --max-spend <usd> --notes "<review>"
  reserve --project <id> --job <JOB> [--snapshot <project-relative.json>]
  ledger-reconcile --project <id> --job <JOB> --status <reserved|submitted|reconciled-known|reconciled-unknown|released|canceled> \
    [--actual-usd N] [--classification <unknown|estimated|user-entered|provider-reported>] [--task-id <ID>] --notes "<review>"
  ledger-unlock --project <id> --confirm --notes "<why>"
  preflight --project <id> --job <JOB> [--authorize-disclosure] [--snapshot <project-relative.json>]
  transport-check --project <id>
  retrieval-state --project <id> --job <JOB>
  report --project <id>

All commands accept --workspace <external-root> or MV_WORKSPACE_ROOT.
LIVE_PROVIDER_EXECUTION = NOT_GRANTED in this phase: submit-live always fails closed.
PRIVATE_REFERENCE_UPLOAD = NOT_GRANTED: reference preparation never transfers bytes.
Only offline-fixture output produces real media locally; it is marked
synthetic-offline-test-output and is never described as AI generation.
Retrieval and normalization commands replay recorded fixtures through injected
transports and never contact a provider.
Budget controls in a project do not limit spend incurred by other clients on the
same provider account, and a local estimate is never a guarantee of the invoice.`);
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
const {DEFAULT_SCENE_REGISTRY} = require('../dist/src/scenes/registry.js');
const {createProjectWriteBoundary} = require('../dist/src/workspace/writeBoundary.js');
const {assertSafePath, ensureSafeDirectory} = require('../dist/src/workspace/writeBoundary.js');
const {resolveProjectRelativePath} = require('../dist/src/workspace/guard.js');
const {
  PREPRODUCTION_PATHS,
  readOptionalProjectJson,
  readProjectJson,
  writeProjectJson,
} = require('../dist/src/preproduction/store.js');
const {
  validateAnnotations,
  validateAssetIntake,
  validateContinuity,
  validateCreativeBrief,
  validateJsonLyrics,
  parseLrcLyrics,
} = require('../dist/src/preproduction/validate.js');
const {validateStoryboard} = require('../dist/src/preproduction/storyboard.js');
const {
  GENERATION_PATHS,
  buildProviderRequest,
  checkGenerationPermission,
  compileGenerationPrompt,
  generationJobId,
  outputKindForRequirement,
  readContinuity,
  readJobDocument,
  readPermissionDocument,
  stageGenerationOutput,
  writeJobDocument,
  writePermissionRecords,
} = require('../dist/src/generation/pipeline.js');
const {
  OFFLINE_CAPABILITIES,
  RUNWAY_CAPABILITIES,
  createOfflineProvider,
  createRunwayProvider,
  createDenyingTransport,
} = require('../dist/src/generation/providers.js');
const {
  bindProviderOutput,
  expectedOutputKindForOperation,
  parseTaskDocument,
} = require('../dist/src/generation/outputContract.js');
const {
  OUTPUT_HOST_POLICIES,
  retrieveRemoteOutput,
  validateOutputUrl,
  clearRetrievalScratch,
} = require('../dist/src/generation/retrieval.js');
const {
  createScriptedDownloadTransport,
  createScriptedResolver,
} = require('../dist/src/generation/simulation.js');
const {
  prepareReferenceInput,
  buildReferenceDataUri,
  createDeniedUploadAdapter,
  inspectReferenceImage,
} = require('../dist/src/generation/references.js');
const {
  attemptHistoryOf,
  assertTaskIdConsistency,
  recordAttempt,
  retrievalBlocker,
  submissionBlocker,
} = require('../dist/src/generation/recovery.js');
const {
  inspectVideoDeep,
  normalizeVideo,
  frameTimingPolicy,
  NORMALIZATION_PROFILE,
} = require('../dist/src/media/videoNormalize.js');
const {sha256File} = require('../dist/src/media/hash.js');
const {
  RUNWAY_PRICING_SNAPSHOT,
  estimateGenerationCost,
  validatePricingSnapshot,
  outputLongEdgeForJob,
  billableSecondsForJob,
} = require('../dist/src/generation/pricing.js');
const {
  readLedger,
  summarizeLedger,
  reserveBudget,
  reconcileLedgerEntry,
  setProjectCeiling,
  unlockLedger,
} = require('../dist/src/generation/ledger.js');
const {buildPreflight} = require('../dist/src/generation/preflight.js');
const {readRetrievalState, classifyRecovery} = require('../dist/src/generation/finalization.js');
const {RUNWAY_ENDPOINT_POLICY, TRANSPORT_POLICY_VERSION} = require('../dist/src/generation/transport.js');
const {RETRY_POLICY} = require('../dist/src/generation/retry.js');
const {resolveProviderDuration} = require('../dist/src/generation/providers.js');
const {GENERATION_SCHEMA_VERSION, RUNWAY_API_VERSION, NORMALIZATION_VERSION} = require('../dist/src/generation/types.js');

const requireRunwayBaseUrl = () => {
  const value = process.env.RUNWAY_BASE_URL;
  if (!value) {
    throw new Error('RUNWAY_BASE_URL must be provided; the adapter carries no hardcoded provider host');
  }
  return value;
};

const redactUrl = (value) => {
  try {
    const parsed = new URL(value);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return '<invalid-url>';
  }
};

const fail = (message) => {
  const error = new Error(message);
  error.generation = true;
  throw error;
};

const loadContext = () => {
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
  const annotations = validateAnnotations(
    readProjectJson(project.projectDir, PREPRODUCTION_PATHS.annotations),
    {...context, sections: []},
    {},
  );
  context.sections = annotations.sections;
  const brief = validateCreativeBrief(
    readProjectJson(project.projectDir, PREPRODUCTION_PATHS.brief),
    context,
  );
  const continuityRaw = readOptionalProjectJson(project.projectDir, PREPRODUCTION_PATHS.continuity);
  const continuity = continuityRaw === null ? null : validateContinuity(continuityRaw, context);
  const lyricsJson = readOptionalProjectJson(project.projectDir, PREPRODUCTION_PATHS.lyricsJson);
  const lyricsLrcPath = resolveProjectRelativePath(project.projectDir, PREPRODUCTION_PATHS.lyricsLrc, {mustExist: false});
  const lyrics = lyricsJson
    ? validateJsonLyrics({
        raw: lyricsJson,
        language: 'und',
        sourcePath: PREPRODUCTION_PATHS.lyricsJson,
        sourceSha256: '0'.repeat(64),
        context: {...context, sections: annotations.sections},
      })
    : existsSync(lyricsLrcPath)
      ? parseLrcLyrics({
          text: readFileSync(lyricsLrcPath, 'utf8'),
          language: 'und',
          sourcePath: PREPRODUCTION_PATHS.lyricsLrc,
          sourceSha256: '0'.repeat(64),
          approval: 'approved',
          context: {...context, sections: annotations.sections},
        })
      : null;
  const storyboardRaw = readOptionalProjectJson(project.projectDir, PREPRODUCTION_PATHS.storyboard);
  if (!storyboardRaw) fail('No storyboard found; run preproduction storyboard first');
  const intakeRaw = readOptionalProjectJson(project.projectDir, PREPRODUCTION_PATHS.assetIntake);
  const intake = intakeRaw
    ? validateAssetIntake(intakeRaw, {projectId, requirements: storyboardRaw.assetRequirements ?? []})
    : null;
  const storyboard = validateStoryboard(
    storyboardRaw,
    project,
    annotations,
    lyrics,
    intake,
    continuity,
  );
  return {project, boundary, brief, continuity, storyboard, lyrics};
};

const requirementOf = (storyboard, requirementId) => {
  const requirement = storyboard.assetRequirements.find((entry) => entry.id === requirementId);
  if (!requirement) fail(`Unknown requirement ${requirementId}`);
  return requirement;
};

const shotOf = (storyboard, requirement) =>
  storyboard.chapters.flatMap((chapter) => chapter.shots).find((shot) => shot.id === requirement.shotIds[0]);

const jobsOrEmpty = (project) => readJobDocument(project)?.jobs ?? [];

const persistJobs = (boundary, jobs) => writeJobDocument(boundary, projectId, jobs);

const outputSpecFor = (project, requirement) => {
  const spec = {
    kind: outputKindForRequirement(requirement),
    width: project.config.output.width,
    height: project.config.output.height,
    aspectRatio: requirement.aspectRatio,
    durationFrames: requirement.durationFrames,
    fps: project.config.output.fps,
    frameCount: requirement.durationFrames,
    seed: null,
  };
  return spec;
};

const statusSummary = (job) => ({
  jobId: job.jobId,
  requirementId: job.requirementId,
  provider: job.provider,
  model: job.model,
  operation: job.operation,
  output: `${job.output.kind}${job.output.durationFrames ? ` ${job.output.durationFrames}f` : ''} ${job.output.aspectRatio}`,
  permission: job.permission.state,
  execution: job.execution.state,
  review: job.review.state,
  continuityIds: job.continuityIds,
  providerTaskId: job.execution.providerTaskId,
  attempts: job.execution.attempts,
  failure: job.execution.failure,
  resultFiles: job.result.files.map((file) => `${file.kind}:${file.path}:${file.marker}`),
});

const run = () => {
  const jobs = () => jobsOrEmpty(loadContext().project);

  if (command === 'prepare') {
    const ctx = loadContext();
    const requirementId = arg('requirement');
    if (!requirementId) fail('--requirement is required');
    const requirement = requirementOf(ctx.storyboard, requirementId);
    if (requirement.status === 'approved' && requirement.fulfilledAssetId) {
      fail(`Requirement ${requirementId} is already fulfilled; prepare a generation job only for unresolved requirements`);
    }
    const providerId = arg('provider', 'offline-fixture');
    const provider =
      providerId === 'offline-fixture'
        ? createOfflineProvider({outputRoot: path.join(ctx.project.projectDir, GENERATION_PATHS.outputs), jobId: 'prepare'})
        : createRunwayProvider({
            transport: createDenyingTransport(),
            apiKey: process.env.RUNWAY_API_KEY ?? null,
            baseUrl: requireRunwayBaseUrl(),
          });
    const model = arg('model', provider.capabilities.models[0].id);
    const revision = Number(arg('revision', '1'));
    if (!Number.isInteger(revision) || revision < 1) fail('--revision must be a positive integer');
    const shot = shotOf(ctx.storyboard, requirement);
    if (!shot) fail(`Requirement ${requirementId} is not attached to a shot`);
    const output = outputSpecFor(ctx.project, requirement);
    const operation = output.kind === 'video' ? 'image-to-video' : 'text-to-image';
    const references = (shot.continuityIds ?? [])
      .map((id) => ctx.continuity?.entries.find((entry) => entry.id === id))
      .filter((entry) => entry && entry.referenceAssetId)
      .map((entry) => {
        const asset = ctx.project.config.assets.find((candidate) => candidate.id === entry.referenceAssetId);
        return asset ? {assetId: asset.id, role: 'reference', sha256: asset.sha256} : null;
      })
      .filter(Boolean);
    const seedValue = arg('seed');
    if (seedValue !== undefined) {
      const parsed = Number(seedValue);
      if (!Number.isInteger(parsed) || parsed < 0) fail('--seed must be a non-negative integer');
      output.seed = parsed;
    }
    const seed = {
      projectId,
      requirementId,
      storyboardRevision: ctx.storyboard.revision,
      requirementFingerprint: requirement.fingerprint,
      shotIds: [...requirement.shotIds],
      provider: provider.capabilities.provider,
      model,
      operation,
      output,
      continuityIds: [...requirement.continuityReferences],
      inputAssets: references,
    };
    const prompt = compileGenerationPrompt({
      project: ctx.project,
      brief: ctx.brief,
      shot,
      requirement,
      continuity: ctx.continuity,
      provider,
      model,
      output,
    });
    const jobId = generationJobId(seed, revision);
    const existing = jobsOrEmpty(ctx.project).find((entry) => entry.jobId === jobId);
    if (existing) {
      console.log(JSON.stringify({projectId, jobId, duplicate: true, status: statusSummary(existing)}, null, 2));
      return 0;
    }
    const job = {
      schemaVersion: GENERATION_SCHEMA_VERSION,
      jobId,
      projectId,
      requirementId,
      storyboardRevision: ctx.storyboard.revision,
      requirementFingerprint: requirement.fingerprint,
      shotIds: [...requirement.shotIds],
      provider: seed.provider,
      operation,
      model,
      requestRevision: revision,
      prompt,
      output,
      continuityIds: seed.continuityIds,
      inputAssets: references,
      permission: {state: 'not-requested', recordPath: null},
      execution: {state: 'prepared', providerTaskId: null, attempts: 0, failure: null, lastTransition: new Date().toISOString()},
      result: {files: [], manifestPath: null, inspectedAt: null},
      review: {state: 'awaiting-review', notes: null, assetId: null},
    };
    const violations = provider.validate(buildProviderRequest({job, references: []}));
    const preparedJobs = jobsOrEmpty(ctx.project);
    preparedJobs.push(job);
    persistJobs(ctx.boundary, preparedJobs);
    console.log(JSON.stringify({
      projectId,
      job: statusSummary(job),
      capabilityViolations: violations,
      promptDraft: prompt.draft,
      output,
      note: 'Prepared only. Nothing was submitted and no credits were authorized.',
    }, null, 2));
    return violations.length === 0 ? 0 : 2;
  }

  if (command === 'status') {
    const ctx = loadContext();
    const jobId = arg('job');
    const all = jobsOrEmpty(ctx.project);
    const selected = jobId ? all.filter((job) => job.jobId === jobId) : all;
    if (jobId && selected.length === 0) fail(`Unknown job ${jobId}`);
    const stale = selected.filter((job) => {
      const requirement = ctx.storyboard.assetRequirements.find((entry) => entry.id === job.requirementId);
      return !requirement || requirement.fingerprint !== job.requirementFingerprint;
    });
    console.log(JSON.stringify({
      projectId,
      storyboardRevision: ctx.storyboard.revision,
      renderReady: ctx.storyboard.renderReady,
      jobs: selected.map(statusSummary),
      staleJobs: stale.map((job) => job.jobId),
      blockers: [
        ...(ctx.storyboard.missingAssetRequirements.length > 0
          ? [`missing requirements: ${ctx.storyboard.missingAssetRequirements.join(', ')}`]
          : []),
        ...(stale.length > 0 ? [`stale jobs: ${stale.map((job) => job.jobId).join(', ')}`] : []),
      ],
      liveExecution: 'NOT_GRANTED',
    }, null, 2));
    return stale.length > 0 || !ctx.storyboard.renderReady ? 2 : 0;
  }

  if (command === 'inspect') {
    const jobId = arg('job');
    if (!jobId) fail('--job is required');
    const job = jobs().find((entry) => entry.jobId === jobId);
    if (!job) fail(`Unknown job ${jobId}`);
    console.log(JSON.stringify({projectId, job: statusSummary(job), prompt: job.prompt, output: job.output, result: job.result}, null, 2));
    return 0;
  }

  if (command === 'approve-request') {
    const jobId = arg('job');
    if (!jobId) fail('--job is required');
    const ctx = loadContext();
    const job = jobsOrEmpty(ctx.project).find((entry) => entry.jobId === jobId);
    if (!job) fail(`Unknown job ${jobId}`);
    const authorization = arg('authorization');
    if (!['authorized-for-simulation', 'denied'].includes(authorization)) {
      fail('--authorization must be authorized-for-simulation or denied in this phase; authorized-live is not available');
    }
    const maxSpend = Number(arg('max-spend'));
    if (!Number.isFinite(maxSpend) || maxSpend < 0) fail('--max-spend must be a non-negative number');
    const maxSubmissions = Number(arg('max-submissions', '1'));
    if (!Number.isInteger(maxSubmissions) || maxSubmissions < 1) fail('--max-submissions must be a positive integer');
    const notes = arg('notes');
    if (!notes) fail('--notes is required: record the authorization review');
    const requirement = ctx.storyboard.assetRequirements.find((entry) => entry.id === job.requirementId);
    if (!requirement) fail(`Job ${jobId} references unknown requirement ${job.requirementId}`);
    if (requirement.fingerprint !== job.requirementFingerprint) {
      fail('Requirement changed since the job was prepared; prepare a new job instead of authorizing a stale one');
    }
    const record = {
      schemaVersion: 1,
      projectId,
      jobId,
      provider: job.provider,
      model: job.model,
      operation: job.operation,
      inputAssetIds: job.inputAssets.map((asset) => asset.assetId),
      uploadsPrivateAssets: hasFlag('uploads-private'),
      maxSpendUsd: maxSpend,
      maxCredits: null,
      maxSubmissions,
      authorization,
      reviewNotes: notes,
      authorizationRevision: job.requestRevision,
    };
    const records = readPermissionDocument(ctx.project).filter((entry) => entry.jobId !== jobId);
    records.push(record);
    writePermissionRecords(ctx.boundary, projectId, records);
    const updated = {
      ...job,
      permission: {state: authorization === 'denied' ? 'denied' : 'authorized', recordPath: `${GENERATION_PATHS.permissions}#${jobId}`},
      execution: {...job.execution, state: 'awaiting-authorization', lastTransition: new Date().toISOString()},
    };
    const all = jobsOrEmpty(ctx.project).filter((entry) => entry.jobId !== jobId);
    all.push(updated);
    persistJobs(ctx.boundary, all);
    console.log(JSON.stringify({projectId, jobId, authorization, maxSpendUsd: maxSpend, maxSubmissions, uploadsPrivateAssets: record.uploadsPrivateAssets, note: 'Authorization applies to this job only; live execution remains NOT_GRANTED.'}, null, 2));
    return 0;
  }

  if (command === 'submit-live') {
    fail('LIVE_PROVIDER_EXECUTION = NOT_GRANTED: no live provider request may be made in this phase');
  }

  if (command === 'run-offline') {
    const jobId = arg('job');
    if (!jobId) fail('--job is required');
    const ctx = loadContext();
    const job = jobsOrEmpty(ctx.project).find((entry) => entry.jobId === jobId);
    if (!job) fail(`Unknown job ${jobId}`);
    if (job.provider !== 'offline-fixture') {
      fail(`Job ${jobId} uses provider ${job.provider}; run-offline only executes the offline fixture provider`);
    }
    const requirement = ctx.storyboard.assetRequirements.find((entry) => entry.id === job.requirementId);
    if (!requirement) fail(`Job ${jobId} references unknown requirement ${job.requirementId}`);
    const stale = requirement.fingerprint !== job.requirementFingerprint;
    const record = readPermissionDocument(ctx.project).find((entry) => entry.jobId === jobId) ?? null;
    const provider = createOfflineProvider({
      outputRoot: path.join(ctx.project.projectDir, GENERATION_PATHS.outputs),
      jobId,
    });
    const decision = checkGenerationPermission({
      job,
      record,
      provider,
      networkEnabled: true,
      credentialsPresent: true,
      requirementStale: stale,
      uploadsPrivateAssets: job.inputAssets.length > 0,
      attemptsUsed: job.execution.attempts,
      live: false,
    });
    if (!decision.allowed) fail(`Generation blocked: ${decision.blockers.join('; ')}`);
    const rights = arg('rights', 'Synthetic offline test output generated locally; no third-party rights');
    const request = buildProviderRequest({
      job,
      references: job.inputAssets.map((asset) => ({
        assetId: asset.assetId,
        path: asset.assetId,
        sha256: asset.sha256,
      })),
    });
    const violations = provider.validate(request);
    if (violations.length > 0) fail(`Provider rejected the request: ${violations.map((entry) => entry.message).join('; ')}`);
    const submitted = provider.submit(request);
    return submitted.then(async (result) => {
      const output = await provider.retrieve(result.taskId, {
        jobId,
        operation: job.operation,
        outputKind: job.output.kind,
      });
      const local = output.files.filter((file) => file.source === 'local');
      if (local.length !== 1) fail('Offline provider must return exactly one local output file');
      const staged = stageGenerationOutput({
        project: ctx.project,
        boundary: ctx.boundary,
        job: {...job, execution: {...job.execution, providerTaskId: result.taskId}, result: {files: [{kind: local[0].kind, path: local[0].location, sha256: '', bytes: local[0].bytes ?? 0, marker: 'synthetic-offline-test-output'}], manifestPath: null, inspectedAt: null}},
        provider,
        sourceFile: local[0].location,
        requirement,
        requirements: ctx.storyboard.assetRequirements,
        rights,
        replaceApproved: hasFlag('replace-approved')
          ? {authorized: true, reason: arg('reason', '')}
          : null,
      });
      const updated = {
        ...job,
        execution: {
          ...job.execution,
          state: 'awaiting-review',
          providerTaskId: result.taskId,
          attempts: job.execution.attempts + 1,
          failure: null,
          lastTransition: new Date().toISOString(),
        },
        result: {
          files: [{kind: local[0].kind, path: staged.record.path, sha256: staged.record.sha256, bytes: staged.record.fileSizeBytes, marker: 'synthetic-offline-test-output'}],
          manifestPath: path.relative(ctx.project.projectDir, staged.manifestPath).split(path.sep).join('/'),
          inspectedAt: new Date().toISOString(),
        },
        review: {state: 'awaiting-review', notes: null, assetId: staged.record.assetId},
      };
      const all = jobsOrEmpty(ctx.project).filter((entry) => entry.jobId !== jobId);
      all.push(updated);
      persistJobs(ctx.boundary, all);
      console.log(JSON.stringify({
        projectId,
        jobId,
        provider: job.provider,
        outputKind: local[0].kind,
        staged: {path: staged.record.path, sha256: staged.record.sha256, bytes: staged.record.fileSizeBytes},
        technical: staged.technical,
        intake: {requirementId: requirement.id, assetId: staged.record.assetId, review: staged.record.review},
        note: 'Output is synthetic-offline-test-output, not AI-generated. It stays pending until review.',
      }, null, 2));
      return 0;
    });
  }

  if (command === 'resume') {
    const jobId = arg('job');
    if (!jobId) fail('--job is required');
    const ctx = loadContext();
    const job = jobsOrEmpty(ctx.project).find((entry) => entry.jobId === jobId);
    if (!job) fail(`Unknown job ${jobId}`);
    if (job.provider !== 'runway') fail(`Job ${jobId} uses provider ${job.provider}; resume drives the simulated Runway lifecycle only`);
    const fixturesPath = arg('fixtures');
    if (!fixturesPath) fail('--fixtures is required: simulations replay recorded responses, never a live endpoint');
    const fixtures = JSON.parse(readFileSync(resolveProjectRelativePath(ctx.project.projectDir, fixturesPath, {engineRoot: repoRoot}), 'utf8'));
    const responses = Array.isArray(fixtures.responses) ? fixtures.responses : [];
    if (responses.length === 0) fail('Fixture transport has no recorded responses');
    let cursor = 0;
    let lastRequest = null;
    let submitPath = null;
    const transport = async (request) => {
      lastRequest = request;
      const scripted = responses[cursor];
      if (!scripted) throw new Error('simulated transport exhausted its recorded responses');
      cursor += 1;
      if (scripted.timeout === true) {
        const error = new Error('simulated network timeout after submission');
        error.unknownSubmission = true;
        throw error;
      }
      return {status: scripted.status, headers: scripted.headers ?? {}, body: JSON.stringify(scripted.body ?? {})};
    };
    const provider = createRunwayProvider({
      transport,
      apiKey: 'simulation-key-never-live',
      baseUrl: requireRunwayBaseUrl(),
    });
    const requirement = ctx.storyboard.assetRequirements.find((entry) => entry.id === job.requirementId);
    if (!requirement) fail(`Job ${jobId} references unknown requirement ${job.requirementId}`);
    if (requirement.fingerprint !== job.requirementFingerprint) {
      fail('Requirement changed since the job was prepared; the recorded job is stale');
    }
    const record = readPermissionDocument(ctx.project).find((entry) => entry.jobId === jobId) ?? null;
    const alreadyBound = job.execution.providerTaskId !== null;
    const decision = checkGenerationPermission({
      job,
      record,
      provider,
      networkEnabled: true,
      credentialsPresent: true,
      requirementStale: false,
      uploadsPrivateAssets: job.inputAssets.length > 0,
      // Resuming a task that already exists consumes no new submission budget.
      attemptsUsed: alreadyBound ? 0 : job.execution.attempts,
      live: false,
    });
    if (!decision.allowed) fail(`Simulated lifecycle blocked: ${decision.blockers.join('; ')}`);
    if (job.permission.state !== 'authorized') fail('Job must be authorized for simulation first');
    if (job.execution.state === 'unknown-submission-state' && !job.execution.providerTaskId) {
      fail('Previous submission has an unknown provider task id; reconcile it before resuming');
    }
    const request = buildProviderRequest({
      job,
      references: job.inputAssets.map((asset) => ({assetId: asset.assetId, path: asset.assetId, sha256: asset.sha256})),
    });
    const violations = provider.validate(request);
    if (violations.length > 0) fail(`Runway capability validation failed: ${violations.map((entry) => entry.message).join('; ')}`);
    const markUnknown = (message) => {
      const unknown = recordAttempt({
        ...job,
        execution: {
          ...job.execution,
          state: 'unknown-submission-state',
          providerTaskId: null,
          attempts: job.execution.attempts + 1,
          failure: message,
          failureKind: 'submission',
          lastTransition: new Date().toISOString(),
        },
      }, {phase: 'submit', outcome: 'unknown', providerTaskId: null, message});
      const all = jobsOrEmpty(ctx.project).filter((entry) => entry.jobId !== jobId);
      all.push(unknown);
      persistJobs(ctx.boundary, all);
    };
    const persistExecution = (next) => {
      const all = jobsOrEmpty(ctx.project).filter((entry) => entry.jobId !== jobId);
      all.push(next);
      persistJobs(ctx.boundary, all);
    };
    submitPath = job.operation === 'text-to-image' ? '/v1/text_to_image' : '/v1/image_to_video';
    const submitBlocker = alreadyBound ? null : submissionBlocker(job);
    if (submitBlocker) fail(`Submission blocked: ${submitBlocker}`);
    const submitted = alreadyBound
      ? Promise.resolve({taskId: job.execution.providerTaskId, state: 'submitted'})
      : provider.submit(request).catch((error) => {
          if (error && error.unknownSubmission) {
            markUnknown(error.message);
            fail(`Submission state is unknown (${error.message}); the job is parked as unknown-submission-state and must be reconciled before any retry`);
          }
          fail(error instanceof Error ? error.message : String(error));
        });
    return submitted.then(async (submission) => {
      assertTaskIdConsistency(job, submission.taskId);
      if (!alreadyBound) {
        // The task id is durable before anything else happens: a crash after this
        // point resumes status and retrieval instead of resubmitting.
        persistExecution(recordAttempt({
          ...job,
          execution: {
            ...job.execution,
            state: 'submitted',
            providerTaskId: submission.taskId,
            attempts: job.execution.attempts + 1,
            failure: null,
            failureKind: null,
            lastTransition: new Date().toISOString(),
          },
        }, {phase: 'submit', outcome: 'submitted', providerTaskId: submission.taskId, message: null}));
      }
      let status = await provider.status(submission.taskId);
      let guard = 0;
      while (status.state === 'queued' || status.state === 'running') {
        if (guard >= 20) fail('Simulated polling exceeded its bounded retry budget');
        status = await provider.status(submission.taskId);
        guard += 1;
      }
      const transcript = {
        provider: 'runway',
        apiVersion: RUNWAY_API_VERSION,
        authorizationHeaderRedacted: true,
        submitPath,
        lastRequestPath: lastRequest ? new URL(lastRequest.url).pathname : null,
        taskId: submission.taskId,
        resumedExistingTask: alreadyBound,
        states: ['submitted', 'running', status.state],
        outputUrl: status.outputUrl ? redactUrl(status.outputUrl) : null,
        outputUrlCount: status.outputUrls.length,
        notes: [
          'Replayed through an injected fake transport; no live endpoint was contacted.',
          `Contract pinned at X-Runway-Version ${RUNWAY_API_VERSION}.`,
          'Signed query parameters are never recorded.',
        ],
      };
      const current = jobsOrEmpty(ctx.project).find((entry) => entry.jobId === jobId) ?? job;
      const updated = {
        ...current,
        execution: {
          ...current.execution,
          state: status.state === 'succeeded' ? 'succeeded' : status.state === 'failed' ? 'failed' : current.execution.state,
          providerTaskId: submission.taskId,
          failure: status.failure,
          failureKind: status.state === 'failed' ? 'generation' : null,
          lastTransition: new Date().toISOString(),
        },
        result: {
          ...current.result,
          files: [],
          derived: null,
          inspectedAt: new Date().toISOString(),
        },
      };
      persistExecution(recordAttempt(updated, {
        phase: 'status',
        outcome: status.state === 'succeeded' ? 'succeeded' : status.state === 'failed' ? 'failed' : status.state === 'canceled' ? 'canceled' : 'succeeded',
        providerTaskId: submission.taskId,
        message: status.failure,
      }));
      writeProjectJson(
        ctx.boundary,
        `${GENERATION_PATHS.reports}/${jobId}-simulation.json`,
        transcript,
      );
      console.log(JSON.stringify({projectId, jobId, simulated: transcript, note: 'Simulated lifecycle only; no media was produced by this provider.'}, null, 2));
      return status.state === 'succeeded' ? 0 : 1;
    });
  }

  if (command === 'inspect-output') {
    const jobId = arg('job');
    if (!jobId) fail('--job is required');
    const ctx = loadContext();
    const job = jobsOrEmpty(ctx.project).find((entry) => entry.jobId === jobId);
    if (!job) fail(`Unknown job ${jobId}`);
    const expected = expectedOutputKindForOperation(job.operation);
    console.log(JSON.stringify({
      projectId,
      jobId,
      provider: job.provider,
      model: job.model,
      operation: job.operation,
      declaredOutputKind: job.output.kind,
      operationOutputKind: expected,
      contractConsistent: job.output.kind === expected,
      execution: job.execution.state,
      providerTaskId: job.execution.providerTaskId,
      attempts: job.execution.attempts,
      attemptHistory: attemptHistoryOf(job),
      failureKind: job.execution.failureKind ?? null,
      failure: job.execution.failure,
      retrievalBlocker: retrievalBlocker(job),
      submissionBlocker: submissionBlocker(job),
      resultFiles: job.result.files,
      derived: job.result.derived ?? null,
      review: job.review.state,
      note: 'Output kind is bound to the job operation; a mismatch is a contract violation, not a variant.',
    }, null, 2));
    return job.output.kind === expected ? 0 : 2;
  }

  if (command === 'prepare-references') {
    const jobId = arg('job');
    if (!jobId) fail('--job is required');
    const ctx = loadContext();
    const job = jobsOrEmpty(ctx.project).find((entry) => entry.jobId === jobId);
    if (!job) fail(`Unknown job ${jobId}`);
    if (job.inputAssets.length === 0) {
      console.log(JSON.stringify({projectId, jobId, references: [], note: 'This job declares no reference inputs.'}, null, 2));
      return 0;
    }
    const disclosure = hasFlag('authorize-disclosure') ? 'authorized-for-simulation' : 'not-authorized';
    const provider = job.provider === 'runway'
      ? createRunwayProvider({
          transport: createDenyingTransport(),
          apiKey: process.env.RUNWAY_API_KEY ?? null,
          baseUrl: requireRunwayBaseUrl(),
        })
      : createOfflineProvider({outputRoot: path.join(ctx.project.projectDir, GENERATION_PATHS.outputs), jobId});
    const model = provider.capabilities.models.find((entry) => entry.id === job.model);
    const prepared = job.inputAssets.map((asset) => prepareReferenceInput({
      project: ctx.project,
      assetId: asset.assetId,
      expectedSha256: asset.sha256,
      provider: job.provider,
      model: job.model,
      maxReferences: model ? model.maxReferences : 0,
      disclosure,
      engineRoot: repoRoot,
    }));
    const payloads = prepared.map((entry) => {
      if (entry.blockers.length > 0) return null;
      const dataUri = buildReferenceDataUri({project: ctx.project, prepared: entry, purpose: 'simulation'});
      return {
        assetId: entry.assetId,
        characters: dataUri.length,
        sha256: createHash('sha256').update(dataUri).digest('hex'),
      };
    });
    writeProjectJson(ctx.boundary, `${GENERATION_PATHS.reports}/${jobId}-references.json`, {
      schemaVersion: 1,
      projectId,
      jobId,
      disclosure,
      prepared,
      note: 'Reference payloads are never written to disk or printed. Only lengths and hashes are recorded.',
    });
    console.log(JSON.stringify({
      projectId,
      jobId,
      provider: job.provider,
      model: job.model,
      disclosure,
      uploadAdapter: createDeniedUploadAdapter().transport,
      references: prepared,
      payloads,
      note: disclosure === 'not-authorized'
        ? 'Local approval is not disclosure consent. Re-run with --authorize-disclosure to prepare a bounded payload for simulation.'
        : 'Simulation payload prepared in memory only; PRIVATE_REFERENCE_UPLOAD = NOT_GRANTED.',
    }, null, 2));
    return prepared.every((entry) => entry.blockers.length === 0) ? 0 : 2;
  }

  if (command === 'validate-response') {
    const jobId = arg('job');
    if (!jobId) fail('--job is required');
    const responseArg = arg('response');
    if (!responseArg) fail('--response is required: a recorded provider response document');
    const ctx = loadContext();
    const job = jobsOrEmpty(ctx.project).find((entry) => entry.jobId === jobId);
    if (!job) fail(`Unknown job ${jobId}`);
    const recorded = JSON.parse(readFileSync(resolveProjectRelativePath(ctx.project.projectDir, responseArg, {engineRoot: repoRoot}), 'utf8'));
    const taskId = typeof recorded.taskId === 'string' ? recorded.taskId : job.execution.providerTaskId;
    if (!taskId) fail('No task id is available: record one in the response document or bind the job first');
    const body = recorded.body ?? (Array.isArray(recorded.tasks) ? recorded.tasks[0]?.body : null) ?? recorded;
    const transport = async () => ({status: 200, headers: {}, body: JSON.stringify(body)});
    const provider = createRunwayProvider({transport, apiKey: 'simulation-key-never-live', baseUrl: requireRunwayBaseUrl()});
    return provider.retrieve(taskId, {jobId, operation: job.operation, outputKind: job.output.kind})
      .then((output) => {
        const bound = bindProviderOutput({job: {...job, execution: {...job.execution, providerTaskId: taskId}}, output});
        const policy = OUTPUT_HOST_POLICIES[job.provider];
        const url = bound.file.source === 'https' ? validateOutputUrl(bound.file.location, policy) : null;
        console.log(JSON.stringify({
          projectId,
          jobId,
          accepted: true,
          kind: bound.kind,
          providerTaskId: bound.providerTaskId,
          selectionPolicy: bound.selectionPolicy,
          source: url ? {host: url.hostname, path: url.pathname, queryParameters: url.queryParameters} : {local: true},
          note: 'Recorded response validated through the real adapter mapping. No request was made.',
        }, null, 2));
        return 0;
      })
      .catch((error) => {
        console.log(JSON.stringify({projectId, jobId, accepted: false, reason: error instanceof Error ? error.message : String(error)}, null, 2));
        return 1;
      });
  }

  if (command === 'retrieve' || command === 'resume-retrieval') {
    const jobId = arg('job');
    if (!jobId) fail('--job is required');
    const fixtureArg = arg('fixture', arg('fixtures'));
    if (!fixtureArg) fail('--fixture is required: retrieval replays a recorded fixture, never a live endpoint');
    const ctx = loadContext();
    const job = jobsOrEmpty(ctx.project).find((entry) => entry.jobId === jobId);
    if (!job) fail(`Unknown job ${jobId}`);
    const blocked = retrievalBlocker(job);
    if (blocked) fail(`Retrieval blocked: ${blocked}`);
    const taskId = job.execution.providerTaskId;
    const fixture = JSON.parse(readFileSync(resolveProjectRelativePath(ctx.project.projectDir, fixtureArg, {engineRoot: repoRoot}), 'utf8'));
    const taskResponses = Array.isArray(fixture.tasks) ? fixture.tasks : [fixture.task];
    if (taskResponses.length === 0 || !taskResponses[0]) fail('Fixture declares no task response');
    let taskCursor = 0;
    const taskTransport = async () => {
      const entry = taskResponses[Math.min(taskCursor, taskResponses.length - 1)];
      taskCursor += 1;
      return {status: entry.status ?? 200, headers: entry.headers ?? {}, body: JSON.stringify(entry.body ?? {})};
    };
    const downloadScript = fixture.download;
    if (!downloadScript || !Array.isArray(downloadScript.steps) || downloadScript.steps.length === 0) {
      fail('Fixture declares no download script');
    }
    const policy = OUTPUT_HOST_POLICIES[job.provider];
    if (!policy) fail(`Provider ${job.provider} has no output host policy`);
    if (command === 'resume-retrieval') {
      const cleared = clearRetrievalScratch(ctx.boundary, jobId);
      console.error(`Resumed retrieval for ${jobId}; cleared task-owned scratch: ${cleared}`);
    }
    const maxBytesArg = arg('max-bytes');
    let effectivePolicy = policy;
    if (maxBytesArg !== undefined) {
      const requested = Number(maxBytesArg);
      if (!Number.isInteger(requested) || requested <= 0) fail('--max-bytes must be a positive integer');
      if (requested > policy.maxBytes) {
        fail(`--max-bytes may only tighten the ${policy.maxBytes} byte provider limit, never raise it`);
      }
      effectivePolicy = {...policy, maxBytes: requested};
    }
    const scripted = createScriptedDownloadTransport(downloadScript, (relative) =>
      readFileSync(resolveProjectRelativePath(ctx.project.projectDir, relative, {engineRoot: repoRoot})));
    const resolver = createScriptedResolver(downloadScript);
    const provider = createRunwayProvider({transport: taskTransport, apiKey: 'simulation-key-never-live', baseUrl: requireRunwayBaseUrl()});
    const rights = arg('rights', 'Simulated provider output; synthetic fixture bytes, no third-party rights');
    const extension = job.output.kind === 'video' ? 'mp4' : 'png';
    const destination = arg('out', `${GENERATION_PATHS.outputs}/${jobId}/${jobId}-provider.${extension}`);

    const attempt = async (retriesLeft) => {
      const output = await provider.retrieve(taskId, {
        jobId,
        operation: job.operation,
        outputKind: job.output.kind,
      });
      const bound = bindProviderOutput({job, output});
      if (bound.file.source !== 'https') fail('Simulated retrieval requires an HTTPS provider location');
      const validated = validateOutputUrl(bound.file.location, effectivePolicy);
      ensureSafeDirectory(ctx.boundary, path.dirname(path.join(ctx.project.projectDir, destination)), 'project');
      assertSafePath(ctx.boundary, path.join(ctx.project.projectDir, destination), {expect: 'file', subtree: 'project'});
      try {
        return await retrieveRemoteOutput({
          boundary: ctx.boundary,
          jobId,
          providerTaskId: bound.providerTaskId,
          kind: bound.kind,
          url: bound.file.location,
          policy: effectivePolicy,
          transport: scripted.transport,
          resolver,
          targetRelativePath: destination,
        });
      } catch (error) {
        const recoverable = error && error.recoverable === true;
        if (recoverable && retriesLeft > 0 && taskResponses.length > 1) {
          console.error(`Recoverable retrieval failure (${error.code}); re-querying task ${taskId} for a fresh URL`);
          return attempt(retriesLeft - 1);
        }
        throw error;
      }
    };

    return attempt(1).then((result) => {
      const updated = {
        ...job,
        execution: {
          ...job.execution,
          state: 'output-retrieved',
          failure: null,
          failureKind: null,
          lastTransition: new Date().toISOString(),
        },
        result: {
          files: [{
            kind: job.output.kind,
            path: result.record.storedPath,
            sha256: result.record.sha256,
            bytes: result.record.bytes,
            marker: 'provider-output',
          }],
          derived: null,
          manifestPath: job.result.manifestPath,
          inspectedAt: new Date().toISOString(),
        },
      };
      const all = jobsOrEmpty(ctx.project).filter((entry) => entry.jobId !== jobId);
      all.push(updated);
      persistJobs(ctx.boundary, all);
      writeProjectJson(ctx.boundary, `${GENERATION_PATHS.reports}/${jobId}-retrieval.json`, {
        schemaVersion: 1,
        projectId,
        jobId,
        rights,
        record: result.record,
        requestedUrls: scripted.requestedUrls.map((value) => {
          try {
            const parsed = new URL(value);
            return `${parsed.origin}${parsed.pathname}`;
          } catch {
            return '<invalid-url>';
          }
        }),
        note: 'Signed query parameters are never recorded. Bytes came from a recorded fixture through an injected transport.',
      });
      console.log(JSON.stringify({
        projectId,
        jobId,
        retrieved: true,
        kind: job.output.kind,
        stored: result.record.storedPath,
        sha256: result.record.sha256,
        bytes: result.record.bytes,
        contentType: result.record.contentType,
        source: result.record.source,
        redirects: result.record.redirects,
        note: 'Bytes were replayed from a fixture; no provider was contacted.',
      }, null, 2));
      return 0;
    });
  }

  if (command === 'inspect-media') {
    const fileArg = arg('file');
    if (!fileArg) fail('--file is required');
    const ctx = loadContext();
    const absolute = resolveProjectRelativePath(ctx.project.projectDir, fileArg, {engineRoot: repoRoot});
    const head = readFileSync(absolute).subarray(0, 16);
    const isPng = head.length >= 8 && head.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const isJpeg = head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
    const base = {
      projectId,
      file: fileArg.split(path.sep).join('/'),
      sha256: sha256File(absolute),
      bytes: statSync(absolute).size,
    };
    if (isPng || isJpeg) {
      const facts = inspectReferenceImage(readFileSync(absolute), path.basename(fileArg));
      console.log(JSON.stringify({
        ...base,
        mediaKind: 'image',
        image: {
          mimeType: facts.mimeType,
          width: facts.width,
          height: facts.height,
          aspectRatio: Number((facts.width / facts.height).toFixed(4)),
        },
        note: 'Content is validated by structure, never by filename extension.',
      }, null, 2));
      return 0;
    }
    const inspection = inspectVideoDeep(absolute, path.basename(fileArg));
    console.log(JSON.stringify({
      ...base,
      mediaKind: 'video',
      inspection,
      note: 'Metadata comes from FFprobe plus a real decode pass; the filename extension is not trusted.',
    }, null, 2));
    return inspection.decodesCleanly ? 0 : 1;
  }

  if (command === 'normalize') {
    const jobId = arg('job');
    if (!jobId) fail('--job is required');
    const ctx = loadContext();
    const job = jobsOrEmpty(ctx.project).find((entry) => entry.jobId === jobId);
    if (!job) fail(`Unknown job ${jobId}`);
    const sourceRelative = arg('file', job.result.files[0]?.path);
    if (!sourceRelative) fail('No provider output is recorded; retrieve one first or pass --file');
    const targetFps = Number(arg('fps', job.output.fps));
    const targetWidth = Number(arg('width', job.output.width ?? 0));
    const targetHeight = Number(arg('height', job.output.height ?? 0));
    if (!Number.isInteger(targetWidth) || !Number.isInteger(targetHeight)) {
      fail('--width and --height are required when the job does not declare output dimensions');
    }
    const requiredDurationSeconds = (job.output.durationFrames ?? 0) / Math.max(1, targetFps);
    if (!(requiredDurationSeconds > 0)) fail('The job declares no shot duration to normalize against');
    const sourceAbsolute = resolveProjectRelativePath(ctx.project.projectDir, sourceRelative, {engineRoot: repoRoot});
    const destinationRelative = `${GENERATION_PATHS.outputs}/${jobId}/normalized/${jobId}-normalized.mp4`;
    ensureSafeDirectory(ctx.boundary, path.dirname(path.join(ctx.project.projectDir, destinationRelative)), 'project');
    const destinationAbsolute = assertSafePath(
      ctx.boundary,
      path.join(ctx.project.projectDir, destinationRelative),
      {expect: 'file', subtree: 'project'},
    );
    const rights = arg('rights', 'Derived locally from the recorded provider output; no third-party rights');
    const outcome = normalizeVideo({
      sourcePath: sourceAbsolute,
      destinationPath: destinationAbsolute,
      label: `${jobId} provider output`,
      targetFps,
      targetWidth,
      targetHeight,
      requiredDurationSeconds,
    });
    const timing = frameTimingPolicy(outcome);
    const record = {
      schemaVersion: 1,
      normalizationVersion: NORMALIZATION_VERSION,
      jobId,
      providerTaskId: job.execution.providerTaskId,
      original: {
        path: sourceRelative.split(path.sep).join('/'),
        sha256: sha256File(sourceAbsolute),
        bytes: statSync(sourceAbsolute).size,
        inspection: outcome.source,
      },
      derived: {
        path: destinationRelative,
        sha256: sha256File(destinationAbsolute),
        bytes: statSync(destinationAbsolute).size,
        inspection: outcome.derived,
      },
      profile: outcome.profile,
      arguments: outcome.arguments,
      timing: {
        sourceFrameRate: outcome.source.averageFrameRate,
        targetFrameRate: outcome.profile.targetFps,
        sourceDurationSeconds: outcome.source.durationSeconds,
        derivedDurationSeconds: outcome.derived.durationSeconds,
        frameDuplicationPolicy: timing.frameDuplicationPolicy,
        frameDropPolicy: timing.frameDropPolicy,
      },
      rotationCorrection: outcome.rotationCorrection,
      rights,
      review: 'pending',
      createdAt: new Date().toISOString(),
    };
    writeProjectJson(ctx.boundary, `${GENERATION_PATHS.reports}/${jobId}-normalization.json`, record);
    const updated = {
      ...job,
      result: {
        ...job.result,
        derived: {
          kind: 'video',
          path: destinationRelative,
          sha256: record.derived.sha256,
          bytes: record.derived.bytes,
          marker: 'provider-output',
          originalPath: record.original.path,
          originalSha256: record.original.sha256,
          normalizationVersion: NORMALIZATION_VERSION,
        },
        inspectedAt: new Date().toISOString(),
      },
    };
    const all = jobsOrEmpty(ctx.project).filter((entry) => entry.jobId !== jobId);
    all.push(updated);
    persistJobs(ctx.boundary, all);
    console.log(JSON.stringify({
      projectId,
      jobId,
      normalized: true,
      original: {path: record.original.path, sha256: record.original.sha256},
      derived: {path: record.derived.path, sha256: record.derived.sha256},
      profile: record.profile,
      rotationCorrection: record.rotationCorrection,
      timing: record.timing,
      note: 'The provider original is untouched; the derived copy stays pending review.',
    }, null, 2));
    return 0;
  }

  if (command === 'compare-media') {
    const originalArg = arg('original');
    const derivedArg = arg('derived');
    if (!originalArg || !derivedArg) fail('--original and --derived are required');
    const ctx = loadContext();
    const originalAbsolute = resolveProjectRelativePath(ctx.project.projectDir, originalArg, {engineRoot: repoRoot});
    const derivedAbsolute = resolveProjectRelativePath(ctx.project.projectDir, derivedArg, {engineRoot: repoRoot});
    const original = inspectVideoDeep(originalAbsolute, 'original');
    const derived = inspectVideoDeep(derivedAbsolute, 'derived');
    const compatible =
      derived.container.split(',').includes('mp4')
      && derived.codec === 'h264'
      && derived.pixelFormat === NORMALIZATION_PROFILE.pixelFormat
      && Math.abs(derived.rotation) < 0.01
      && derived.decodesCleanly
      && derived.audioStreamCount === 0;
    console.log(JSON.stringify({
      projectId,
      original: {path: originalArg, sha256: sha256File(originalAbsolute), inspection: original},
      derived: {path: derivedArg, sha256: sha256File(derivedAbsolute), inspection: derived},
      rendererCompatible: compatible,
      differences: {
        codec: original.codec === derived.codec ? 'unchanged' : `${original.codec} -> ${derived.codec}`,
        pixelFormat: original.pixelFormat === derived.pixelFormat ? 'unchanged' : `${original.pixelFormat} -> ${derived.pixelFormat}`,
        frameRate: original.averageFrameRate === derived.averageFrameRate ? 'unchanged' : `${original.averageFrameRate} -> ${derived.averageFrameRate}`,
        rotation: original.rotation === derived.rotation ? 'unchanged' : `${original.rotation} -> ${derived.rotation}`,
        audioStreams: `${original.audioStreamCount} -> ${derived.audioStreamCount}`,
      },
      note: 'Both files are retained; the original hash is the provenance anchor.',
    }, null, 2));
    return compatible ? 0 : 1;
  }

  if (command === 'handoff' || command === 'stage') {
    const jobId = arg('job');
    if (!jobId) fail('--job is required');
    const ctx = loadContext();
    const job = jobsOrEmpty(ctx.project).find((entry) => entry.jobId === jobId);
    if (!job) fail(`Unknown job ${jobId}`);
    const fileArg = arg('file', job.result.derived?.path ?? job.result.files[0]?.path);
    if (!fileArg) fail('--file is required: this job has no recorded provider output');
    const requirement = ctx.storyboard.assetRequirements.find((entry) => entry.id === job.requirementId);
    if (!requirement) fail(`Job ${jobId} references unknown requirement ${job.requirementId}`);
    if (requirement.fingerprint !== job.requirementFingerprint) {
      fail('Requirement changed since the job was prepared; the output would bind to the wrong shot');
    }
    const source = resolveProjectRelativePath(ctx.project.projectDir, fileArg, {engineRoot: repoRoot});
    if (!existsSync(source)) fail(`Provider output ${fileArg} does not exist`);
    const rights = arg('rights');
    if (!rights) fail('--rights is required: record the rights assertion for this output');
    const derived = job.result.derived ?? null;
    const normalizedPath = derived?.path ? derived.path.split(path.sep).join('/') : null;
    const usingDerived = normalizedPath !== null && normalizedPath === fileArg.split(path.sep).join('/');
    if (usingDerived && (!derived.originalPath || !derived.originalSha256 || !derived.normalizationVersion)) {
      fail('The derived result is missing its original provenance; re-run normalize');
    }
    const provider = createOfflineProvider({outputRoot: path.join(ctx.project.projectDir, GENERATION_PATHS.outputs), jobId});
    const staged = stageGenerationOutput({
      project: ctx.project,
      boundary: ctx.boundary,
      job: {
        ...job,
        result: {
          files: [{kind: job.output.kind, path: source, sha256: '', bytes: 0, marker: 'provider-output'}],
          derived: null,
          manifestPath: null,
          inspectedAt: null,
        },
      },
      provider,
      sourceFile: source,
      requirement,
      requirements: ctx.storyboard.assetRequirements,
      rights,
      derived: usingDerived
        ? {
            originalPath: derived.originalPath,
            originalSha256: derived.originalSha256,
            normalizationVersion: derived.normalizationVersion,
            arguments: [],
          }
        : null,
      replaceApproved: hasFlag('replace-approved')
        ? {authorized: true, reason: arg('reason', '')}
        : null,
    });
    const stagedFile = {
      kind: job.output.kind,
      path: staged.record.path,
      sha256: staged.record.sha256,
      bytes: staged.record.fileSizeBytes,
      marker: 'provider-output',
    };
    const updated = {
      ...job,
      execution: {...job.execution, state: 'output-retrieved', lastTransition: new Date().toISOString()},
      result: {
        files: job.result.files.length > 0 ? job.result.files : [stagedFile],
        derived: usingDerived ? stagedFile : job.result.derived ?? null,
        manifestPath: path.relative(ctx.project.projectDir, staged.manifestPath).split(path.sep).join('/'),
        inspectedAt: new Date().toISOString(),
      },
      review: {state: 'awaiting-review', notes: null, assetId: staged.record.assetId},
    };
    const all = jobsOrEmpty(ctx.project).filter((entry) => entry.jobId !== jobId);
    all.push(updated);
    persistJobs(ctx.boundary, all);
    console.log(JSON.stringify({
      projectId,
      jobId,
      staged: staged.record,
      technical: staged.technical,
      derivedFrom: usingDerived ? derived.originalPath : null,
      note: 'Pending review; nothing is approved automatically.',
    }, null, 2));
    return 0;
  }

  if (command === 'review') {
    const jobId = arg('job');
    if (!jobId) fail('--job is required');
    const decision = arg('decision');
    if (!['approve', 'reject'].includes(decision)) fail('--decision must be approve or reject');
    const notes = arg('notes');
    if (!notes) fail('--notes is required: record the reviewer decision');
    const ctx = loadContext();
    const job = jobsOrEmpty(ctx.project).find((entry) => entry.jobId === jobId);
    if (!job) fail(`Unknown job ${jobId}`);
    if (job.result.files.length === 0) fail('No staged output exists; run-offline or handoff first');
    const intakeRaw = readOptionalProjectJson(ctx.project.projectDir, PREPRODUCTION_PATHS.assetIntake);
    if (!intakeRaw) fail('No asset intake document exists');
    const requirement = ctx.storyboard.assetRequirements.find((entry) => entry.id === job.requirementId);
    if (!requirement) fail(`Job ${jobId} references unknown requirement ${job.requirementId}`);
    const intake = validateAssetIntake(intakeRaw, {projectId, requirements: ctx.storyboard.assetRequirements});
    const record = intake.records.find((entry) => entry.requirementId === job.requirementId);
    if (!record) fail(`No intake record for requirement ${job.requirementId}`);
    if (record.assetId !== `GEN-${jobId}`) fail('Intake record does not belong to this job');
    const review = decision === 'approve' ? 'approved' : 'rejected';
    const records = intake.records.map((entry) =>
      entry.requirementId === job.requirementId ? {...entry, review, reviewNotes: notes} : entry,
    );
    const document = validateAssetIntake(
      {schemaVersion: 1, projectId, records},
      {projectId, requirements: ctx.storyboard.assetRequirements},
    );
    writeProjectJson(ctx.boundary, PREPRODUCTION_PATHS.assetIntake, document);
    const updated = {...job, review: {state: review, notes, assetId: `GEN-${jobId}`}};
    const all = jobsOrEmpty(ctx.project).filter((entry) => entry.jobId !== jobId);
    all.push(updated);
    persistJobs(ctx.boundary, all);
    console.log(JSON.stringify({
      projectId,
      jobId,
      requirementId: job.requirementId,
      review,
      notes,
      assetId: `GEN-${jobId}`,
      note: review === 'approved'
        ? 'Requirement is fulfilled; regenerate the storyboard and recompile.'
        : 'Output is rejected; the requirement stays unfulfilled.',
    }, null, 2));
    return 0;
  }

  if (command === 'blockers') {
    const jobId = arg('job');
    if (!jobId) fail('--job is required');
    const ctx = loadContext();
    const job = jobsOrEmpty(ctx.project).find((entry) => entry.jobId === jobId);
    if (!job) fail(`Unknown job ${jobId}`);
    const requirement = ctx.storyboard.assetRequirements.find((entry) => entry.id === job.requirementId);
    const intakeRaw = readOptionalProjectJson(ctx.project.projectDir, PREPRODUCTION_PATHS.assetIntake);
    const intake = intakeRaw
      ? validateAssetIntake(intakeRaw, {projectId, requirements: ctx.storyboard.assetRequirements})
      : null;
    const record = intake?.records.find((entry) => entry.requirementId === job.requirementId) ?? null;
    const blockers = [];
    if (!requirement) blockers.push(`requirement ${job.requirementId} no longer exists in the storyboard`);
    if (requirement && requirement.fingerprint !== job.requirementFingerprint) {
      blockers.push('the requirement changed after the job was prepared; re-prepare instead of binding stale bytes');
    }
    if (!job.execution.providerTaskId) blockers.push('no provider task id is recorded');
    if (job.result.files.length === 0) blockers.push('no provider output bytes are stored');
    if (!record) blockers.push('no asset intake record exists for this requirement');
    if (record && record.review === 'pending') blockers.push('the intake record is pending a reviewer decision');
    if (record && record.review === 'in-review') blockers.push('the intake record is still in review');
    if (record && record.review === 'rejected') blockers.push('the intake record was rejected');
    if (!ctx.storyboard.renderReady) {
      blockers.push(`storyboard revision ${ctx.storyboard.revision} is not render-ready: ${ctx.storyboard.missingAssetRequirements.join(', ') || 'no details'}`);
    }
    if (ctx.storyboard.status !== 'approved') blockers.push(`storyboard revision ${ctx.storyboard.revision} is ${ctx.storyboard.status}`);
    console.log(JSON.stringify({
      projectId,
      jobId,
      requirementId: job.requirementId,
      execution: job.execution.state,
      review: job.review.state,
      intakeReview: record ? record.review : null,
      storyboardRevision: ctx.storyboard.revision,
      renderReady: ctx.storyboard.renderReady,
      blockers,
      ready: blockers.length === 0,
      note: 'A technical PASS is never an approval; the reviewer decision is the only path to a bound asset.',
    }, null, 2));
    return blockers.length === 0 ? 0 : 2;
  }

  const pricingSnapshot = () => RUNWAY_PRICING_SNAPSHOT;
  const loadSnapshot = (ctx) => {
    const snapshotArg = arg('snapshot');
    if (!snapshotArg) return RUNWAY_PRICING_SNAPSHOT;
    const file = resolveProjectRelativePath(ctx.project.projectDir, snapshotArg, {engineRoot: repoRoot});
    return JSON.parse(readFileSync(file, 'utf8'));
  };
  const estimateFor = (job, snapshot) => {
    const model = RUNWAY_CAPABILITIES.models.find((entry) => entry.id === job.model) ?? null;
    const neededSeconds = (job.output.durationFrames ?? 0) / Math.max(1, job.output.fps);
    const providerDuration = model ? resolveProviderDuration(model, neededSeconds) : null;
    return estimateGenerationCost({
      snapshot,
      model: job.model,
      operation: job.operation,
      outputLongEdge: outputLongEdgeForJob(job),
      billableSeconds: billableSecondsForJob(job, providerDuration),
      referenceCount: job.inputAssets.length,
      now: new Date(),
    });
  };
  const requireJob = (ctx, jobId) => {
    const job = jobsOrEmpty(ctx.project).find((entry) => entry.jobId === jobId);
    if (!job) fail(`Unknown job ${jobId}`);
    return job;
  };
  const intakeReviewFor = (ctx, requirementId) => {
    const raw = readOptionalProjectJson(ctx.project.projectDir, PREPRODUCTION_PATHS.assetIntake);
    if (!raw) return null;
    const record = (raw.records ?? []).find((entry) => entry.requirementId === requirementId);
    return record ? record.review : null;
  };
  const transportStatus = () => ({
    policyVersion: TRANSPORT_POLICY_VERSION,
    provider: RUNWAY_ENDPOINT_POLICY.provider,
    apiHost: RUNWAY_ENDPOINT_POLICY.apiHost,
    deliveryHosts: RUNWAY_ENDPOINT_POLICY.deliveryHosts,
    implemented: true,
    gateOpen: false,
    proxyPolicy: 'refuse-if-configured',
    dnsBinding: 'the validated address is supplied to the socket lookup; the DNS name is kept for SNI and certificate verification',
    redirects: 'not followed by the transport',
    authorizationHeader: 'api host only; never sent to a delivery host',
    tls: 'system trust store, hostname verification, TLS >= 1.2, rejectUnauthorized never disabled',
    retryPolicy: RETRY_POLICY,
    reason: 'LIVE_PROVIDER_EXECUTION = NOT_GRANTED',
  });

  if (command === 'pricing') {
    const ctx = loadContext();
    const snapshot = loadSnapshot(ctx);
    const validation = validatePricingSnapshot({snapshot, now: new Date()});
    console.log(JSON.stringify({
      projectId,
      provider: snapshot.provider,
      pricingVersion: snapshot.pricingVersion,
      snapshotSha256: snapshot.snapshotSha256,
      sourceUrl: snapshot.sourceUrl,
      retrievedAt: snapshot.retrievedAt,
      creditToUsd: snapshot.creditToUsd,
      rounding: snapshot.rounding,
      taxNote: snapshot.taxNote,
      integrity: {ok: validation.ok, code: validation.code, message: validation.message},
      models: snapshot.models,
      unsupported: snapshot.unsupported,
      caveats: snapshot.caveats,
      note: 'Transcribed from the published pricing page; no live pricing API was queried.',
    }, null, 2));
    return validation.ok ? 0 : 2;
  }

  if (command === 'estimate') {
    const jobId = arg('job');
    if (!jobId) fail('--job is required');
    const ctx = loadContext();
    const job = requireJob(ctx, jobId);
    const decision = estimateFor(job, loadSnapshot(ctx));
    console.log(JSON.stringify({
      projectId,
      jobId,
      provider: job.provider,
      model: job.model,
      operation: job.operation,
      ok: decision.ok,
      code: decision.code,
      message: decision.message,
      estimate: decision.estimate,
      note: 'A local estimate is an upper bound for the documented tariff, not a guarantee of the invoice.',
    }, null, 2));
    return decision.ok ? 0 : 2;
  }

  if (command === 'ledger') {
    const ctx = loadContext();
    const document = readLedger(ctx.project);
    const summary = summarizeLedger(document);
    console.log(JSON.stringify({
      projectId,
      summary,
      entries: document.entries,
      interventions: document.interventions ?? [],
      note: 'Budget controls in this project do not limit spend incurred by other clients on the same provider account.',
    }, null, 2));
    return 0;
  }

  if (command === 'ledger-ceiling') {
    const notes = arg('notes');
    if (!notes) fail('--notes is required: record why the project ceiling is being set');
    const raw = arg('max-spend');
    if (raw === undefined) fail('--max-spend is required (a number, or "none" to clear the ceiling)');
    const ceiling = raw === 'none' ? null : Number(raw);
    if (ceiling !== null && (!Number.isFinite(ceiling) || ceiling < 0)) {
      fail('--max-spend must be a non-negative number or "none"');
    }
    const ctx = loadContext();
    return setProjectCeiling({project: ctx.project, ceilingUsd: ceiling, note: notes}).then((document) => {
      console.log(JSON.stringify({
        projectId,
        projectCeilingUsd: document.projectCeilingUsd,
        summary: summarizeLedger(document),
      }, null, 2));
      return 0;
    });
  }

  if (command === 'reserve') {
    const jobId = arg('job');
    if (!jobId) fail('--job is required');
    const ctx = loadContext();
    const job = requireJob(ctx, jobId);
    const record = readPermissionDocument(ctx.project).find((entry) => entry.jobId === jobId) ?? null;
    if (!record) fail(`No permission record exists for job ${jobId}; authorize the request first`);
    const decision = estimateFor(job, loadSnapshot(ctx));
    if (!decision.ok) fail(`Cannot reserve without a supported cost estimate: ${decision.code} ${decision.message}`);
    return reserveBudget({
      project: ctx.project,
      job,
      estimate: {
        estimatedUsd: decision.estimate.estimatedUsd,
        estimatedCredits: decision.estimate.estimatedCredits,
        pricingVersion: decision.estimate.pricingVersion,
        snapshotSha256: decision.estimate.snapshotSha256,
      },
      authorization: {
        authorizedMaxUsd: record.maxSpendUsd,
        authorizedMaxCredits: record.maxCredits,
        authorizationRevision: record.authorizationRevision,
      },
    }).then((result) => {
      console.log(JSON.stringify({
        projectId,
        jobId,
        reserved: true,
        entry: result.entry,
        summary: result.summary,
        note: 'A reservation is not a submission. Live execution remains NOT_GRANTED.',
      }, null, 2));
      return 0;
    });
  }

  if (command === 'ledger-reconcile') {
    const jobId = arg('job');
    if (!jobId) fail('--job is required');
    const status = arg('status');
    const allowed = ['reserved', 'submitted', 'reconciled-known', 'reconciled-unknown', 'released', 'canceled'];
    if (!allowed.includes(status)) fail(`--status must be one of ${allowed.join(', ')}`);
    const notes = arg('notes');
    if (!notes) fail('--notes is required: record the evidence behind this reconciliation');
    const actualRaw = arg('actual-usd');
    const actualUsd = actualRaw === undefined ? null : Number(actualRaw);
    if (actualRaw !== undefined && (!Number.isFinite(actualUsd) || actualUsd < 0)) {
      fail('--actual-usd must be a non-negative number');
    }
    const classification = arg('classification', 'user-entered');
    const allowedClassification = ['unknown', 'estimated', 'user-entered', 'provider-reported'];
    if (!allowedClassification.includes(classification)) {
      fail(`--classification must be one of ${allowedClassification.join(', ')}`);
    }
    const ctx = loadContext();
    return reconcileLedgerEntry({
      project: ctx.project,
      jobId,
      status,
      actualUsd,
      actualClassification: classification,
      providerTaskId: arg('task-id'),
      note: notes,
    }).then((entry) => {
      console.log(JSON.stringify({
        projectId,
        jobId,
        entry,
        summary: summarizeLedger(readLedger(ctx.project)),
        note: classification === 'provider-reported'
          ? 'Recorded as provider-reported evidence supplied by the operator.'
          : 'Recorded as operator-supplied evidence; MVFoundry did not verify it against the provider.',
      }, null, 2));
      return 0;
    });
  }

  if (command === 'ledger-unlock') {
    if (!hasFlag('confirm')) fail('--confirm is required: a stale lock needs explicit operator intervention');
    const notes = arg('notes');
    if (!notes) fail('--notes is required: record why the lock is being removed');
    const ctx = loadContext();
    const result = unlockLedger(ctx.project, notes);
    console.log(JSON.stringify({projectId, ...result, note: 'The intervention is recorded in the ledger document.'}, null, 2));
    return 0;
  }

  if (command === 'transport-check') {
    console.log(JSON.stringify({projectId, ...transportStatus(), note: 'No network request is made by this command.'}, null, 2));
    return 0;
  }

  if (command === 'retrieval-state') {
    const jobId = arg('job');
    if (!jobId) fail('--job is required');
    const ctx = loadContext();
    const job = requireJob(ctx, jobId);
    const state = readRetrievalState(ctx.project, jobId);
    const resolveInside = (relative) => (relative ? path.resolve(ctx.project.projectDir, relative) : null);
    const tempAbsolute = resolveInside(state?.tempPath ?? null);
    const targetAbsolute = resolveInside(state?.targetPath ?? null);
    const tempExists = Boolean(tempAbsolute && existsSync(tempAbsolute));
    const targetExists = Boolean(targetAbsolute && existsSync(targetAbsolute));
    const manifestExists = existsSync(path.join(ctx.project.projectDir, GENERATION_PATHS.manifests, `${jobId}.json`));
    const classification = classifyRecovery({
      state,
      tempExists,
      tempBytes: tempExists ? statSync(tempAbsolute).size : 0,
      targetExists,
      targetSha256: targetExists ? sha256File(targetAbsolute) : null,
      manifestExists,
      intakeReview: intakeReviewFor(ctx, job.requirementId),
    });
    console.log(JSON.stringify({
      projectId,
      jobId,
      state,
      facts: {tempExists, targetExists, manifestExists},
      classification,
      note: 'An ambiguous classification fails closed and needs operator review; nothing is auto-approved.',
    }, null, 2));
    return classification === 'ambiguous' ? 2 : 0;
  }

  if (command === 'preflight') {
    const jobId = arg('job');
    if (!jobId) fail('--job is required');
    const ctx = loadContext();
    const job = requireJob(ctx, jobId);
    const requirement = ctx.storyboard.assetRequirements.find((entry) => entry.id === job.requirementId) ?? null;
    const record = readPermissionDocument(ctx.project).find((entry) => entry.jobId === jobId) ?? null;
    const provider = job.provider === 'runway'
      ? createRunwayProvider({
          transport: createDenyingTransport(),
          apiKey: process.env.RUNWAY_API_KEY ?? null,
          baseUrl: requireRunwayBaseUrl(),
        })
      : createOfflineProvider({outputRoot: path.join(ctx.project.projectDir, GENERATION_PATHS.outputs), jobId});
    const model = provider.capabilities.models.find((entry) => entry.id === job.model) ?? null;
    const disclosure = hasFlag('authorize-disclosure') ? 'authorized-for-simulation' : 'not-authorized';
    const references = job.inputAssets.map((asset) => {
      try {
        const prepared = prepareReferenceInput({
          project: ctx.project,
          assetId: asset.assetId,
          expectedSha256: asset.sha256,
          provider: job.provider,
          model: job.model,
          maxReferences: model ? model.maxReferences : 0,
          disclosure,
          engineRoot: repoRoot,
        });
        return {assetId: prepared.assetId, disclosure: prepared.disclosure, bytes: prepared.bytes, blockers: prepared.blockers};
      } catch (error) {
        return {
          assetId: asset.assetId,
          disclosure,
          bytes: null,
          blockers: [error instanceof Error ? error.message : String(error)],
        };
      }
    });
    const request = buildProviderRequest({
      job,
      references: job.inputAssets.map((asset) => ({assetId: asset.assetId, path: asset.assetId, sha256: asset.sha256})),
    });
    const transport = transportStatus();
    const report = buildPreflight({
      project: ctx.project,
      job,
      requirement,
      permissionRecord: record,
      ledger: readLedger(ctx.project),
      pricing: loadSnapshot(ctx),
      estimate: estimateFor(job, loadSnapshot(ctx)),
      capabilityViolations: provider.validate(request),
      references,
      intakeReview: intakeReviewFor(ctx, job.requirementId),
      storyboard: {revision: ctx.storyboard.revision, status: ctx.storyboard.status, renderReady: ctx.storyboard.renderReady},
      credentialsPresent: Boolean(process.env.RUNWAY_API_KEY),
      liveExecutionEnabled: false,
      transport: {
        ready: transport.implemented,
        reason: transport.gateOpen ? 'live transport gate is open' : transport.reason,
        gateOpen: transport.gateOpen,
      },
      now: new Date(),
    });
    console.log(JSON.stringify({
      ...report,
      transportPolicy: transport,
      note: 'A green technical preflight is not authorization to submit. Live execution remains NOT_GRANTED.',
    }, null, 2));
    return report.readiness === 'READY FOR SEPARATELY AUTHORIZED PILOT' ? 0 : 2;
  }

  if (command === 'report') {
    const ctx = loadContext();
    const all = jobsOrEmpty(ctx.project);
    const report = {
      schemaVersion: 1,
      projectId,
      generatedAt: new Date().toISOString(),
      liveExecution: 'NOT_GRANTED',
      jobs: all.map(statusSummary),
      capabilities: {offline: OFFLINE_CAPABILITIES, runway: RUNWAY_CAPABILITIES},
      requirements: ctx.storyboard.assetRequirements.map((requirement) => ({
        id: requirement.id,
        kind: requirement.kind,
        mediaSlot: requirement.mediaSlot,
        fingerprint: requirement.fingerprint,
      })),
    };
    writeProjectJson(ctx.boundary, `${GENERATION_PATHS.reports}/generation-report.json`, report);
    console.log(JSON.stringify(report, null, 2));
    return 0;
  }

  fail(`Unknown command: ${command}`);
};

try {
  const result = run();
  if (result && typeof result.then === 'function') {
    result.then((code) => {
      process.exitCode = code;
    }).catch((error) => {
      console.error(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    });
  } else {
    process.exitCode = result;
  }
} catch (error) {
  console.error(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
