// Generation job CLI: prepare, authorize, execute offline, simulate a remote
// lifecycle, hand off, review and report.
//
// Usage: npm run generation -- <command> --project <id> [--workspace <root>]
// Requires npm run build and MV_WORKSPACE_ROOT or --workspace.

import {existsSync, readFileSync} from 'node:fs';
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
  run-offline --project <id> --job <JOB> [--rights "<rights assertion>"]
  submit-live --project <id> --job <JOB>
  resume --project <id> --job <JOB> [--fixtures <fixture.json>]
  handoff --project <id> --job <JOB> --file <project-relative-output> [--rights "<rights>"]
  review --project <id> --job <JOB> --decision <approve|reject> --notes "<review>"
  report --project <id>

All commands accept --workspace <external-root> or MV_WORKSPACE_ROOT.
LIVE_PROVIDER_EXECUTION = NOT_GRANTED in this phase: submit-live always fails closed.
Only offline-fixture output produces real media locally; it is marked
synthetic-offline-test-output and is never described as AI generation.`);
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
const {GENERATION_SCHEMA_VERSION, RUNWAY_API_VERSION} = require('../dist/src/generation/types.js');

const requireRunwayBaseUrl = () => {
  const value = process.env.RUNWAY_BASE_URL;
  if (!value) {
    throw new Error('RUNWAY_BASE_URL must be provided; the adapter carries no hardcoded provider host');
  }
  return value;
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
      const output = await provider.retrieve(result.taskId);
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
    const decision = checkGenerationPermission({
      job,
      record,
      provider,
      networkEnabled: true,
      credentialsPresent: true,
      requirementStale: false,
      uploadsPrivateAssets: job.inputAssets.length > 0,
      attemptsUsed: job.execution.attempts,
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
      const unknown = {
        ...job,
        execution: {
          ...job.execution,
          state: 'unknown-submission-state',
          providerTaskId: null,
          attempts: job.execution.attempts + 1,
          failure: message,
          lastTransition: new Date().toISOString(),
        },
      };
      const all = jobsOrEmpty(ctx.project).filter((entry) => entry.jobId !== jobId);
      all.push(unknown);
      persistJobs(ctx.boundary, all);
    };
    submitPath = '/v1/image_to_video';
    const submitted = provider.submit(request).catch((error) => {
      if (error && error.unknownSubmission) {
        markUnknown(error.message);
        fail(`Submission state is unknown (${error.message}); the job is parked as unknown-submission-state and must be reconciled before any retry`);
      }
      fail(error instanceof Error ? error.message : String(error));
    });
    return submitted.then(async (submission) => {
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
        states: ['submitted', 'running', status.state],
        outputUrl: status.outputUrl,
        notes: [
          'Replayed through an injected fake transport; no live endpoint was contacted.',
          `Contract pinned at X-Runway-Version ${RUNWAY_API_VERSION}.`,
        ],
      };
      const updated = {
        ...job,
        execution: {
          ...job.execution,
          state: status.state === 'succeeded' ? 'succeeded' : status.state === 'failed' ? 'failed' : job.execution.state,
          providerTaskId: submission.taskId,
          attempts: job.execution.attempts + 1,
          failure: status.failure,
          lastTransition: new Date().toISOString(),
        },
        result: {
          ...job.result,
          files: [],
          inspectedAt: new Date().toISOString(),
        },
      };
      const all = jobsOrEmpty(ctx.project).filter((entry) => entry.jobId !== jobId);
      all.push(updated);
      persistJobs(ctx.boundary, all);
      writeProjectJson(
        ctx.boundary,
        `${GENERATION_PATHS.reports}/${jobId}-simulation.json`,
        transcript,
      );
      console.log(JSON.stringify({projectId, jobId, simulated: transcript, note: 'Simulated lifecycle only; no media was produced by this provider.'}, null, 2));
      return status.state === 'succeeded' ? 0 : 1;
    });
  }

  if (command === 'handoff') {
    const jobId = arg('job');
    if (!jobId) fail('--job is required');
    const fileArg = arg('file');
    if (!fileArg) fail('--file is required: a project-relative provider output');
    const ctx = loadContext();
    const job = jobsOrEmpty(ctx.project).find((entry) => entry.jobId === jobId);
    if (!job) fail(`Unknown job ${jobId}`);
    const requirement = ctx.storyboard.assetRequirements.find((entry) => entry.id === job.requirementId);
    if (!requirement) fail(`Job ${jobId} references unknown requirement ${job.requirementId}`);
    if (requirement.fingerprint !== job.requirementFingerprint) {
      fail('Requirement changed since the job was prepared; the output would bind to the wrong shot');
    }
    const source = resolveProjectRelativePath(ctx.project.projectDir, fileArg, {engineRoot: repoRoot});
    if (!existsSync(source)) fail(`Provider output ${fileArg} does not exist`);
    const rights = arg('rights');
    if (!rights) fail('--rights is required: record the rights assertion for this output');
    const provider = createOfflineProvider({outputRoot: path.join(ctx.project.projectDir, GENERATION_PATHS.outputs), jobId});
    const staged = stageGenerationOutput({
      project: ctx.project,
      boundary: ctx.boundary,
      job: {...job, result: {files: [{kind: job.output.kind, path: source, sha256: '', bytes: 0, marker: 'provider-output'}], manifestPath: null, inspectedAt: null}},
      provider,
      sourceFile: source,
      requirement,
      requirements: ctx.storyboard.assetRequirements,
      rights,
    });
    const updated = {
      ...job,
      execution: {...job.execution, state: 'output-retrieved', lastTransition: new Date().toISOString()},
      result: {
        files: [{kind: job.output.kind, path: staged.record.path, sha256: staged.record.sha256, bytes: staged.record.fileSizeBytes, marker: 'provider-output'}],
        manifestPath: path.relative(ctx.project.projectDir, staged.manifestPath).split(path.sep).join('/'),
        inspectedAt: new Date().toISOString(),
      },
      review: {state: 'awaiting-review', notes: null, assetId: staged.record.assetId},
    };
    const all = jobsOrEmpty(ctx.project).filter((entry) => entry.jobId !== jobId);
    all.push(updated);
    persistJobs(ctx.boundary, all);
    console.log(JSON.stringify({projectId, jobId, staged: staged.record, technical: staged.technical, note: 'Pending review; nothing is approved automatically.'}, null, 2));
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
