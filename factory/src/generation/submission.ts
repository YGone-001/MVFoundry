import path from 'node:path';
import type {LoadedProject} from '../config/types';
import type {AssetRequirement} from '../preproduction/types';
import {writeProjectJson, readOptionalProjectJson} from '../preproduction/store';
import type {WriteBoundary} from '../workspace/writeBoundary';
import {TransportError} from './transport';
import {readLedger} from './ledger';
import {readJobDocument, writeJobDocument} from './pipeline';
import {assertTaskIdConsistency, attemptHistoryOf, recordAttempt, submissionBlocker} from './recovery';
import {
  PILOT_ADMISSION_PATHS,
  bindAdmissionTask,
  consumePilotAdmission,
  evaluatePilotAdmission,
  markAdmissionUncertain,
  readPilotAdmissions,
  releaseUnownedAdmission,
  type PilotAdmission,
  type PilotEvaluation,
  type PilotReferenceFacts,
} from './pilotAdmission';
import {RETRY_POLICY} from './retry';
import type {
  CapabilityViolation,
  GenerationJob,
  GenerationPermissionRecord,
  PricingDecision,
  PricingSnapshot,
  ProviderCapabilities,
  ProviderOutput,
  ProviderRequest,
  ProviderRetrieveExpectation,
  ProviderStatusResult,
  ProviderSubmitResult,
} from './types';

export const PILOT_SUBMISSION_SCHEMA_VERSION = 1 as const;
export const PILOT_RETRIEVAL_SCHEMA_VERSION = 1 as const;

/**
 * The phase boundary, as a single named constant.
 *
 * Flipping this is not a configuration change: it requires a separately
 * authorized engine change, a reviewed pilot admission, an explicit operator
 * command and a real credential. No project field, environment variable or
 * admission record can set it.
 */
export const LIVE_PROVIDER_EXECUTION_GRANTED = false;

export const LIVE_EXECUTION_STATEMENT =
  'LIVE_PROVIDER_EXECUTION = NOT_GRANTED: no provider request may leave this machine in this phase';

/**
 * A grant is a caller-supplied object, never a project field.
 *
 * `simulated` means "run the whole orchestration through an injected fake
 * provider"; it is not a live authorization. `live` is refused while
 * `LIVE_PROVIDER_EXECUTION_GRANTED` is false.
 */
export type PilotLiveGrant =
  | {kind: 'simulated'; reason: string}
  | {kind: 'live'; approvalRef: string};

export type PilotDriverKind = 'simulated' | 'live';

export type PilotDriver = {
  kind: PilotDriverKind;
  submit: (request: ProviderRequest) => Promise<ProviderSubmitResult>;
  status: (taskId: string) => Promise<ProviderStatusResult>;
  retrieve: (taskId: string, expectation: ProviderRetrieveExpectation) => Promise<ProviderOutput>;
};

export const createRefusingDriver = (): PilotDriver => {
  const refuse = async (): Promise<never> => {
    throw new TransportError('live-not-authorized', LIVE_EXECUTION_STATEMENT);
  };
  return {kind: 'live', submit: refuse, status: refuse, retrieve: refuse};
};

/**
 * Wraps an existing provider adapter (the Runway adapter, or a fake one) into a
 * driver. The driver kind is supplied by the caller so a simulated adapter can
 * never be mistaken for a live one.
 */
export const createAdapterDriver = (
  provider: {
    submit: (request: ProviderRequest) => Promise<ProviderSubmitResult>;
    status: (taskId: string) => Promise<ProviderStatusResult>;
    retrieve: (taskId: string, expectation: ProviderRetrieveExpectation) => Promise<ProviderOutput>;
  },
  kind: PilotDriverKind,
): PilotDriver => ({
  kind,
  submit: (request) => provider.submit(request),
  status: (taskId) => provider.status(taskId),
  retrieve: (taskId, expectation) => provider.retrieve(taskId, expectation),
});

/**
 * Transport failures that are decided before a socket is opened. Only these may
 * return an admission to `unconsumed`: nothing was transmitted, so no billable
 * task can exist. Everything else is treated as financially exposed.
 */
const PRE_CONNECTION_CODES = new Set([
  'live-not-authorized',
  'host-not-allowed',
  'malformed-url',
  'unsupported-protocol',
  'credentials-in-url',
  'dns-failure',
  'blocked-address',
  'proxy-not-supported',
  'authorization-header-refused',
]);

export const submissionFailureTransmitted = (error: unknown): boolean => {
  if (error instanceof TransportError) return !PRE_CONNECTION_CODES.has(error.code);
  const code = (error as {code?: unknown})?.code;
  if (typeof code === 'string' && PRE_CONNECTION_CODES.has(code)) return false;
  const explicit = (error as {transmitted?: unknown})?.transmitted;
  if (typeof explicit === 'boolean') return explicit;
  // An unrecognised failure is presumed exposed.
  return true;
};

export type PilotSubmissionStatus =
  | 'refused'
  | 'refused-live-not-granted'
  | 'already-submitted'
  | 'submitted'
  | 'uncertain';

export type PilotSubmissionOutcome = {
  schemaVersion: typeof PILOT_SUBMISSION_SCHEMA_VERSION;
  projectId: string;
  jobId: string;
  pilotId: string | null;
  status: PilotSubmissionStatus;
  /** Gate that decided the outcome; never a free-form message. */
  stage: string;
  refusalCode: string | null;
  blockers: string[];
  ownership: {submissionKey: string; consumedAt: string} | null;
  providerTaskId: string | null;
  liveExecution: 'NOT_GRANTED';
  submissionAuthorized: boolean;
  simulated: boolean;
  providerContacted: false;
  evidencePath: string | null;
  at: string;
  evaluation: PilotEvaluation;
};

export type PilotSubmissionInput = {
  project: LoadedProject;
  boundary: WriteBoundary;
  job: GenerationJob;
  requirement: AssetRequirement | null;
  storyboard: {revision: number; status: string; renderReady: boolean};
  permissionRecord: GenerationPermissionRecord | null;
  capabilities: ProviderCapabilities;
  capabilityViolations: CapabilityViolation[];
  request: ProviderRequest;
  estimate: PricingDecision;
  pricing: PricingSnapshot;
  references: PilotReferenceFacts[];
  credentialsPresent: boolean;
  transport: {ready: boolean; reason: string};
  endpoint: {provider: string; apiHost: string; deliveryHosts: string[]};
  grant: PilotLiveGrant | null;
  driver: PilotDriver | null;
  /** The exact pilot the operator named. Never inferred from the job alone. */
  pilotId?: string | null;
  now?: Date;
};

/**
 * Resolves the admission the caller named. An explicitly named pilot is never
 * silently replaced by another admission on the same job, and a name that does
 * not match the job resolves to nothing rather than to a neighbour.
 */
const readAdmission = (
  project: LoadedProject,
  jobId: string,
  pilotId: string | null,
): PilotAdmission | null => {
  const document = readPilotAdmissions(project);
  if (pilotId !== null) {
    const exact = document.admissions.find((entry) => entry.pilotId === pilotId);
    return exact && exact.jobId === jobId ? exact : null;
  }
  const forJob = document.admissions
    .filter((entry) => entry.jobId === jobId)
    .sort((left, right) => right.admissionRevision - left.admissionRevision);
  return forJob.find((entry) => entry.consumption.state === 'unconsumed') ?? forJob[0] ?? null;
};

/**
 * Runs one submission attempt for one explicitly selected job.
 *
 * The function is the only place where "admitted" can turn into "submitted". It
 * evaluates every gate first, obtains exclusive ownership second, and only then
 * calls the driver once. It never retries a submission and never invents a task
 * id, a cost, or a refund.
 */
export const runPilotSubmission = async (
  input: PilotSubmissionInput,
): Promise<PilotSubmissionOutcome> => {
  const now = input.now ?? new Date();
  const at = now.toISOString();
  const ledger = readLedger(input.project);
  const admission = readAdmission(input.project, input.job.jobId, input.pilotId ?? null);
  const evaluation = evaluatePilotAdmission({
    projectId: input.project.config.projectId,
    job: input.job,
    requirement: input.requirement,
    storyboard: input.storyboard,
    admission,
    estimate: input.estimate,
    pricing: input.pricing,
    ledger,
    permissionRecord: input.permissionRecord,
    references: input.references,
    credentialsPresent: input.credentialsPresent,
    transport: input.transport,
    now,
  });

  const base = {
    schemaVersion: PILOT_SUBMISSION_SCHEMA_VERSION,
    projectId: input.project.config.projectId,
    jobId: input.job.jobId,
    pilotId: admission ? admission.pilotId : null,
    liveExecution: 'NOT_GRANTED' as const,
    simulated: input.grant?.kind === 'simulated',
    providerContacted: false as const,
    at,
    evaluation,
  };

  const writeEvidence = (outcome: Omit<PilotSubmissionOutcome, 'evidencePath'>): PilotSubmissionOutcome => {
    const relative = `${PILOT_ADMISSION_PATHS.reports}/${input.job.jobId}-pilot-submission.json`;
    // Refusals must not erase the record of an earlier submitted outcome, so the
    // document keeps an append-only history of every attempt.
    const previous = readOptionalProjectJson<{history?: unknown[]}>(input.project.projectDir, relative);
    const history = [
      ...(Array.isArray(previous?.history) ? (previous?.history as unknown[]) : []),
      {
        at: outcome.at,
        status: outcome.status,
        stage: outcome.stage,
        pilotId: outcome.pilotId,
        submissionKey: outcome.ownership ? outcome.ownership.submissionKey : null,
        providerTaskId: outcome.providerTaskId,
      },
    ];
    const file = writeProjectJson(input.boundary, relative, {...outcome, evidencePath: null, history});
    return {...outcome, evidencePath: path.relative(input.project.projectDir, file).split(path.sep).join('/')};
  };

  const refuse = (
    stage: string,
    status: PilotSubmissionStatus,
    blockers: string[],
    refusalCode: string | null,
  ): PilotSubmissionOutcome =>
    writeEvidence({
      ...base,
      status,
      stage,
      refusalCode: refusalCode ?? evaluation.refusalCode,
      blockers,
      ownership: null,
      providerTaskId: null,
      submissionAuthorized: false,
    });

  if (evaluation.status !== 'ADMITTED_FOR_PILOT') {
    return refuse('admission', 'refused', evaluation.blockers, evaluation.refusalCode);
  }

  if (input.capabilityViolations.length > 0) {
    return refuse(
      'capability',
      'refused',
      input.capabilityViolations.map((entry) => `${entry.code}: ${entry.message}`),
      'admission-incomplete',
    );
  }

  const blocker = submissionBlocker(input.job);
  if (blocker) {
    return refuse(
      'submission-state',
      input.job.execution.providerTaskId !== null ? 'already-submitted' : 'refused',
      [blocker],
      input.job.execution.providerTaskId !== null ? 'admission-consumed' : 'admission-uncertain',
    );
  }

  const taskIdInLedger = ledger.entries.find((entry) => entry.jobId === input.job.jobId)?.providerTaskId ?? null;
  if (taskIdInLedger !== null) {
    return refuse(
      'ledger-binding',
      'already-submitted',
      [`the ledger already binds this job to provider task ${taskIdInLedger}`],
      'admission-consumed',
    );
  }

  if (!input.grant) {
    return refuse('live-authorization', 'refused-live-not-granted', [LIVE_EXECUTION_STATEMENT], 'admission-incomplete');
  }
  if (input.grant.kind === 'live' && !LIVE_PROVIDER_EXECUTION_GRANTED) {
    return refuse('live-authorization', 'refused-live-not-granted', [LIVE_EXECUTION_STATEMENT], 'admission-incomplete');
  }
  if (!input.driver || input.driver.kind !== input.grant.kind) {
    return refuse(
      'driver-binding',
      'refused',
      [`a ${input.grant.kind} grant requires a ${input.grant.kind} driver; none was supplied`],
      'admission-incomplete',
    );
  }
  if (admission === null) {
    return refuse('admission', 'refused', ['no pilot admission names this job'], 'no-admission');
  }

  const consumed = await consumePilotAdmission({
    project: input.project,
    boundary: input.boundary,
    pilotId: admission.pilotId,
    jobId: input.job.jobId,
    now,
    revalidate: (current) => {
      const recheck = evaluatePilotAdmission({
        projectId: input.project.config.projectId,
        job: input.job,
        requirement: input.requirement,
        storyboard: input.storyboard,
        admission: current,
        estimate: input.estimate,
        pricing: input.pricing,
        ledger: readLedger(input.project),
        permissionRecord: input.permissionRecord,
        references: input.references,
        credentialsPresent: input.credentialsPresent,
        transport: input.transport,
        now,
      });
      return recheck.status === 'ADMITTED_FOR_PILOT' ? [] : recheck.blockers;
    },
  });
  if (!consumed.ok || !consumed.admission || !consumed.submissionKey || !consumed.consumedAt) {
    return refuse('ownership', 'refused', consumed.blockers, consumed.code);
  }

  const ownership = {submissionKey: consumed.submissionKey, consumedAt: consumed.consumedAt};

  let submitted: ProviderSubmitResult;
  try {
    submitted = await input.driver.submit(input.request);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const transmitted = submissionFailureTransmitted(error);
    if (!transmitted) {
      const document = readPilotAdmissions(input.project);
      releaseUnownedAdmission({
        boundary: input.boundary,
        document,
        pilotId: consumed.admission.pilotId,
        now,
        reason: message,
        submissionKey: consumed.submissionKey,
      });
      return writeEvidence({
        ...base,
        status: 'refused',
        stage: 'submit',
        refusalCode: 'admission-incomplete',
        blockers: [
          `the submission was refused before any connection was opened: ${message}`,
          'the admission was returned to unconsumed because nothing left the machine',
        ],
        ownership,
        providerTaskId: null,
        submissionAuthorized: false,
      });
    }
    const parked = recordAttempt(
      {
        ...input.job,
        execution: {
          ...input.job.execution,
          state: 'unknown-submission-state',
          providerTaskId: null,
          attempts: input.job.execution.attempts + 1,
          failure: message,
          failureKind: 'submission',
          lastTransition: now.toISOString(),
        },
      },
      {phase: 'submit', outcome: 'unknown', providerTaskId: null, message},
    );
    const document = readJobDocument(input.project);
    if (document) {
      writeJobDocument(
        input.boundary,
        input.project.config.projectId,
        [...document.jobs.filter((entry) => entry.jobId !== parked.jobId), parked],
      );
    }
    markAdmissionUncertain({
      boundary: input.boundary,
      document: readPilotAdmissions(input.project),
      pilotId: consumed.admission.pilotId,
      now,
      note: `submission outcome unknown: ${message}`,
    });
    return writeEvidence({
      ...base,
      status: 'uncertain',
      stage: 'submit',
      refusalCode: 'admission-uncertain',
      blockers: [
        `the submission may have succeeded without a task id: ${message}`,
        'the admission stays consumed and the budget stays exposed until an operator reconciles the provider task',
        'no automatic retry is permitted',
      ],
      ownership,
      providerTaskId: null,
      submissionAuthorized: false,
    });
  }

  assertTaskIdConsistency(input.job, submitted.taskId);
  // Durable task identity first: a crash after this point resumes instead of resubmitting.
  const bound = recordAttempt(
    {
      ...input.job,
      execution: {
        ...input.job.execution,
        state: 'submitted',
        providerTaskId: submitted.taskId,
        attempts: input.job.execution.attempts + 1,
        failure: null,
        failureKind: null,
        lastTransition: at,
      },
    },
    {phase: 'submit', outcome: 'submitted', providerTaskId: submitted.taskId, message: null},
  );
  const jobDocument = readJobDocument(input.project);
  if (jobDocument) {
    writeJobDocument(
      input.boundary,
      input.project.config.projectId,
      [...jobDocument.jobs.filter((entry) => entry.jobId !== bound.jobId), bound],
    );
  }
  bindAdmissionTask({
    boundary: input.boundary,
    document: readPilotAdmissions(input.project),
    pilotId: consumed.admission.pilotId,
    now,
    providerTaskId: submitted.taskId,
  });

  return writeEvidence({
    ...base,
    status: 'submitted',
    stage: 'submitted',
    refusalCode: null,
    blockers: [],
    ownership,
    providerTaskId: submitted.taskId,
    submissionAuthorized: false,
  });
};

export type PilotRetrievalRecord = {
  storedPath: string;
  sha256: string;
  bytes: number;
  contentType: string;
  source: {host: string; path: string; signedQueryRedacted: true};
  redirects: number;
};

export type PilotResumeInput = {
  project: LoadedProject;
  boundary: WriteBoundary;
  job: GenerationJob;
  driver: PilotDriver;
  transport: {ready: boolean; reason: string};
  /** Retrieval is injected so the policy and transport stay under the caller. */
  retrieve: (input: {
    taskId: string;
    jobId: string;
    expectation: ProviderRetrieveExpectation;
  }) => Promise<PilotRetrievalRecord>;
  now?: Date;
  maxPolls?: number;
};

export type PilotResumeOutcome = {
  schemaVersion: typeof PILOT_SUBMISSION_SCHEMA_VERSION;
  projectId: string;
  jobId: string;
  providerTaskId: string;
  state: 'succeeded' | 'failed' | 'canceled' | 'blocked' | 'retrieved';
  polls: number;
  failure: string | null;
  retrieved: PilotRetrievalRecord | null;
  blockers: string[];
  note: string;
};

const retrieveBlockers = (job: GenerationJob): string[] => {
  if (job.execution.providerTaskId === null) return ['no provider task id is recorded'];
  if (job.execution.state === 'failed') return ['the provider reported generation failure'];
  if (job.execution.state === 'canceled') return ['the provider task was canceled'];
  return [];
};

/**
 * Resumes status polling and retrieval from the persisted task id. It never
 * submits, and a repeated call is idempotent because retrieval is hash-checked.
 */
export const resumePilotSubmission = async (
  input: PilotResumeInput,
): Promise<PilotResumeOutcome> => {
  const now = input.now ?? new Date();
  const blockers = retrieveBlockers(input.job);
  const taskId = input.job.execution.providerTaskId;
  const base = {
    schemaVersion: PILOT_SUBMISSION_SCHEMA_VERSION,
    projectId: input.project.config.projectId,
    jobId: input.job.jobId,
    providerTaskId: taskId ?? '',
  };
  if (blockers.length > 0 || taskId === null) {
    return {
      ...base,
      state: 'blocked',
      polls: 0,
      failure: null,
      retrieved: null,
      blockers,
      note: 'Retrieval is impossible without a persisted provider task id.',
    };
  }
  if (!input.transport.ready) {
    return {
      ...base,
      state: 'blocked',
      polls: 0,
      failure: null,
      retrieved: null,
      blockers: [`network transport is not ready: ${input.transport.reason}`],
      note: 'No provider request was made.',
    };
  }

  const maxPolls = input.maxPolls ?? RETRY_POLICY.maxAttempts;
  let polls = 0;
  let status = await input.driver.status(taskId);
  polls += 1;
  while ((status.state === 'queued' || status.state === 'running') && polls < maxPolls) {
    status = await input.driver.status(taskId);
    polls += 1;
  }
  if (status.state !== 'succeeded') {
    const document = readJobDocument(input.project);
    if (document) {
      const current = document.jobs.find((entry) => entry.jobId === input.job.jobId) ?? input.job;
      const next: GenerationJob = {
        ...current,
        execution: {
          ...current.execution,
          state: status.state === 'failed' ? 'failed' : status.state === 'canceled' ? 'canceled' : 'running',
          failure: status.failure,
          failureKind: status.state === 'failed' ? 'generation' : null,
          lastTransition: now.toISOString(),
        },
      };
      writeJobDocument(
        input.boundary,
        input.project.config.projectId,
        [...document.jobs.filter((entry) => entry.jobId !== next.jobId), next],
      );
    }
    return {
      ...base,
      state: status.state === 'failed' ? 'failed' : status.state === 'canceled' ? 'canceled' : 'blocked',
      polls,
      failure: status.failure,
      retrieved: null,
      blockers: [`provider task ${taskId} is ${status.state}; no output exists to retrieve`],
      note: 'A failed or canceled task is never retried automatically and never priced as zero.',
    };
  }

  const record = await input.retrieve({
    taskId,
    jobId: input.job.jobId,
    expectation: {jobId: input.job.jobId, operation: input.job.operation, outputKind: input.job.output.kind},
  });

  const document = readJobDocument(input.project);
  if (document) {
    const current = document.jobs.find((entry) => entry.jobId === input.job.jobId) ?? input.job;
    const next = recordAttempt(
      {
        ...current,
        execution: {
          ...current.execution,
          state: 'output-retrieved',
          failure: null,
          failureKind: null,
          lastTransition: now.toISOString(),
        },
        result: {
          files: [
            {
              kind: current.output.kind,
              path: record.storedPath,
              sha256: record.sha256,
              bytes: record.bytes,
              marker: 'provider-output',
            },
          ],
          derived: null,
          manifestPath: current.result.manifestPath,
          inspectedAt: now.toISOString(),
        },
      },
      {phase: 'retrieve', outcome: 'succeeded', providerTaskId: taskId, message: null},
    );
    writeJobDocument(
      input.boundary,
      input.project.config.projectId,
      [...document.jobs.filter((entry) => entry.jobId !== next.jobId), next],
    );
  }

  writeProjectJson(input.boundary, `${PILOT_ADMISSION_PATHS.reports}/${input.job.jobId}-pilot-retrieval.json`, {
    schemaVersion: PILOT_RETRIEVAL_SCHEMA_VERSION,
    projectId: input.project.config.projectId,
    jobId: input.job.jobId,
    providerTaskId: taskId,
    polls,
    record,
    note: 'Bytes were resolved through the accepted retrieval path; signed query parameters are never recorded.',
  });

  return {
    ...base,
    state: 'retrieved',
    polls,
    failure: null,
    retrieved: record,
    blockers: [],
    note: 'Output is pending intake; it is not an approved asset.',
  };
};

export const describePilotSubmission = (job: GenerationJob): {
  state: string;
  attempts: number;
  attemptHistory: ReturnType<typeof attemptHistoryOf>;
  providerTaskId: string | null;
  submissionBlocker: string | null;
} => ({
  state: job.execution.state,
  attempts: job.execution.attempts,
  attemptHistory: attemptHistoryOf(job),
  providerTaskId: job.execution.providerTaskId,
  submissionBlocker: submissionBlocker(job),
});

export const pilotSubmissionRequestView = (
  request: ProviderRequest,
  endpoint: {provider: string; apiHost: string; deliveryHosts: string[]},
): Record<string, unknown> => ({
  method: 'POST',
  endpoint: `${endpoint.apiHost}${request.operation === 'text-to-image' ? '/v1/text_to_image' : '/v1/image_to_video'}`,
  provider: endpoint.provider,
  model: request.model,
  operation: request.operation,
  promptCharacters: request.promptText.length,
  promptPreview: `${request.promptText.slice(0, 160)}${request.promptText.length > 160 ? '…' : ''}`,
  outputKind: request.output.kind,
  aspectRatio: request.output.aspectRatio,
  durationFrames: request.output.durationFrames,
  seed: request.seed,
  referenceAssetIds: request.references.map((entry) => entry.assetId),
  sendsLyrics: false,
  sendsAudio: false,
  sendsPrivatePaths: false,
  deliveryHosts: endpoint.deliveryHosts,
  note: 'Nothing is sent by this view. It is the exact request a separately authorized pilot would submit.',
});
