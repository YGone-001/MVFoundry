import type {LoadedProject} from '../config/types';
import type {AssetRequirement} from '../preproduction/types';
import type {
  CapabilityViolation,
  CostEstimate,
  GenerationJob,
  GenerationPermissionRecord,
  LedgerDocument,
  PricingDecision,
  PricingSnapshot,
} from './types';
import {summarizeLedger} from './ledger';

export const PREFLIGHT_SCHEMA_VERSION = 1;

export type PreflightReadiness = 'BLOCKED' | 'READY FOR SEPARATELY AUTHORIZED PILOT';

export type PreflightReferenceStatus = {
  assetId: string;
  disclosure: string;
  bytes: number | null;
  blockers: string[];
};

export type PreflightInput = {
  project: LoadedProject;
  job: GenerationJob;
  requirement: AssetRequirement | null;
  permissionRecord: GenerationPermissionRecord | null;
  ledger: LedgerDocument;
  pricing: PricingSnapshot;
  estimate: PricingDecision;
  capabilityViolations: CapabilityViolation[];
  references: PreflightReferenceStatus[];
  intakeReview: 'pending' | 'in-review' | 'approved' | 'rejected' | null;
  storyboard: {revision: number; status: string; renderReady: boolean};
  credentialsPresent: boolean;
  liveExecutionEnabled: boolean;
  transport: {ready: boolean; reason: string};
  now: Date;
};

export type PreflightReport = {
  schemaVersion: typeof PREFLIGHT_SCHEMA_VERSION;
  projectId: string;
  jobId: string;
  generatedAt: string;
  readiness: PreflightReadiness;
  /** Explicit: technical readiness is not authorization. */
  liveExecution: 'NOT_GRANTED';
  submissionAuthorized: false;
  wouldSend: {
    provider: string;
    model: string;
    operation: string;
    endpoint: string;
    promptCharacters: number;
    includesLyrics: boolean;
    includesAudio: boolean;
    includesPrivatePaths: boolean;
    outputKind: string;
    aspectRatio: string;
    durationFrames: number | null;
    seed: number | null;
    referenceAssetIds: string[];
  };
  assetsLeavingMachine: PreflightReferenceStatus[];
  disclosureAuthorized: boolean;
  estimate: CostEstimate | null;
  estimateError: string | null;
  budget: {
    authorizedMaxUsd: number | null;
    remainingProjectUsd: number | null;
    reservedUsd: number;
    actualKnownUsd: number;
    unknownActualCount: number;
  };
  submission: {
    authorizedMax: number | null;
    used: number;
    providerTaskId: string | null;
    alreadySubmitted: boolean;
    uncertain: boolean;
  };
  capabilityCompliance: {ok: boolean; violations: CapabilityViolation[]};
  transport: {ready: boolean; reason: string};
  credentials: {present: boolean; note: string};
  requirementCurrent: boolean;
  intakeReview: 'pending' | 'in-review' | 'approved' | 'rejected' | null;
  storyboard: {revision: number; status: string; renderReady: boolean};
  /** Project-level policy gates. These are authorization, not technical readiness. */
  policyGates: {
    externalGeneration: boolean;
    localOnly: boolean;
    allowNetwork: boolean;
    note: string;
  };
  blockers: string[];
  operatorNextSteps: string[];
  caveats: string[];
};

const OPEN_ENTRY_STATUSES = ['reserved', 'submitted', 'reconciled-unknown'];

/**
 * Builds the operator-facing readiness report. It answers "what would happen if
 * someone authorized this?" and never authorizes anything itself.
 */
export const buildPreflight = (input: PreflightInput): PreflightReport => {
  const {job, requirement, permissionRecord} = input;
  const blockers: string[] = [];
  const nextSteps: string[] = [];

  if (!requirement) {
    blockers.push(`requirement ${job.requirementId} no longer exists in the storyboard`);
  } else if (requirement.fingerprint !== job.requirementFingerprint) {
    blockers.push('the requirement fingerprint changed after the job was prepared; re-prepare the job');
  }

  if (!permissionRecord) {
    blockers.push('no permission record exists; authorize the request before any submission');
  } else {
    if (permissionRecord.authorization === 'denied') blockers.push('the permission record is denied');
    if (permissionRecord.jobId !== job.jobId) blockers.push('the permission record belongs to another job');
    if (permissionRecord.provider !== job.provider || permissionRecord.model !== job.model) {
      blockers.push('the permission record does not match the requested provider/model');
    }
    if (permissionRecord.operation !== job.operation) {
      blockers.push('the permission record does not match the operation');
    }
    if (input.references.length > 0 && !permissionRecord.uploadsPrivateAssets) {
      blockers.push('reference assets would leave the machine but upload intent is not recorded');
    }
  }

  const unauthorizedReferences = input.references.filter((entry) => entry.blockers.length > 0);
  for (const entry of unauthorizedReferences) {
    blockers.push(`reference ${entry.assetId}: ${entry.blockers.join('; ')}`);
  }
  const disclosureAuthorized = input.references.length > 0 && unauthorizedReferences.length === 0;

  if (input.capabilityViolations.length > 0) {
    blockers.push(
      `provider capability violations: ${input.capabilityViolations.map((entry) => entry.message).join('; ')}`,
    );
  }

  if (!input.estimate.ok) {
    blockers.push(`cost estimate unavailable (${input.estimate.code ?? 'unknown'}): ${input.estimate.message ?? ''}`);
  }

  const summary = summarizeLedger(input.ledger);
  const estimateUsd = input.estimate.estimate?.estimatedUsd ?? null;
  if (estimateUsd !== null) {
    if (permissionRecord && estimateUsd > permissionRecord.maxSpendUsd + 1e-9) {
      blockers.push(
        `estimated $${estimateUsd.toFixed(4)} exceeds the authorized job ceiling of $${permissionRecord.maxSpendUsd.toFixed(4)}`,
      );
    }
    if (summary.remainingUsd !== null && estimateUsd > summary.remainingUsd + 1e-9) {
      blockers.push(
        `estimated $${estimateUsd.toFixed(4)} exceeds the remaining project budget of $${summary.remainingUsd.toFixed(4)}`,
      );
    }
  }

  const alreadySubmitted = job.execution.providerTaskId !== null;
  const uncertain = job.execution.state === 'unknown-submission-state';
  const usedSubmissions = job.execution.attempts;
  const maxSubmissions = permissionRecord?.maxSubmissions ?? null;
  if (maxSubmissions !== null && usedSubmissions >= maxSubmissions) {
    blockers.push(`authorized submission count ${maxSubmissions} is already used`);
  }
  if (uncertain) {
    blockers.push('a previous submission outcome is unknown; reconcile the provider task before any new submission');
  }
  if (alreadySubmitted) {
    blockers.push(
      `job is already bound to provider task ${job.execution.providerTaskId}; resume status and retrieval instead of submitting`,
    );
  }

  if (!input.credentialsPresent) {
    blockers.push('provider credentials are not available in the environment');
  }

  if (!input.transport.ready) {
    blockers.push(`network transport is not ready: ${input.transport.reason}`);
  }

  const openEntry = input.ledger.entries.find(
    (entry) => entry.jobId === job.jobId && OPEN_ENTRY_STATUSES.includes(entry.status),
  );
  if (!openEntry) {
    blockers.push('no budget reservation exists for this job');
  }

  if (!input.liveExecutionEnabled) {
    // Not a defect: it is the phase boundary.
    nextSteps.push('live execution is NOT_GRANTED; a separate authorization must enable it for a bounded pilot');
  }
  if (!permissionRecord) {
    nextSteps.push('run "generation approve-request" to record a per-job authorization');
  }
  if (!openEntry && estimateUsd !== null) {
    nextSteps.push('run "generation reserve" to hold the estimated budget');
  }
  if (input.references.length > 0 && !disclosureAuthorized) {
    nextSteps.push('run "generation prepare-references --authorize-disclosure" after reviewing every reference asset');
  }
  if (blockers.length === 0) {
    nextSteps.push('request explicit user authorization naming provider, model, operation, spend ceiling and submission count');
    nextSteps.push('a future pilot also needs the project permission flags opened by an authorized change');
  }

  const readiness: PreflightReadiness = blockers.length === 0
    ? 'READY FOR SEPARATELY AUTHORIZED PILOT'
    : 'BLOCKED';

  return {
    schemaVersion: PREFLIGHT_SCHEMA_VERSION,
    projectId: input.project.config.projectId,
    jobId: job.jobId,
    generatedAt: input.now.toISOString(),
    readiness,
    liveExecution: 'NOT_GRANTED',
    submissionAuthorized: false,
    wouldSend: {
      provider: job.provider,
      model: job.model,
      operation: job.operation,
      endpoint: job.operation === 'text-to-image' ? 'POST /v1/text_to_image' : 'POST /v1/image_to_video',
      promptCharacters: job.prompt.draft.length,
      includesLyrics: job.prompt.includesLyrics,
      includesAudio: job.prompt.includesAudio,
      includesPrivatePaths: job.prompt.includesPrivatePaths,
      outputKind: job.output.kind,
      aspectRatio: job.output.aspectRatio,
      durationFrames: job.output.durationFrames,
      seed: job.output.seed,
      referenceAssetIds: job.inputAssets.map((asset) => asset.assetId),
    },
    assetsLeavingMachine: input.references,
    disclosureAuthorized,
    estimate: input.estimate.estimate,
    estimateError: input.estimate.ok ? null : input.estimate.message,
    budget: {
      authorizedMaxUsd: permissionRecord ? permissionRecord.maxSpendUsd : null,
      remainingProjectUsd: summary.remainingUsd,
      reservedUsd: summary.reservedUsd,
      actualKnownUsd: summary.actualKnownUsd,
      unknownActualCount: summary.actualUnknownCount,
    },
    submission: {
      authorizedMax: maxSubmissions,
      used: usedSubmissions,
      providerTaskId: job.execution.providerTaskId,
      alreadySubmitted,
      uncertain,
    },
    capabilityCompliance: {ok: input.capabilityViolations.length === 0, violations: input.capabilityViolations},
    transport: input.transport,
    credentials: {
      present: input.credentialsPresent,
      note: input.credentialsPresent
        ? 'a credential is present in the environment; its value is never read, printed or recorded here'
        : 'no credential is present in the environment',
    },
    requirementCurrent: Boolean(requirement) && requirement?.fingerprint === job.requirementFingerprint,
    intakeReview: input.intakeReview,
    storyboard: input.storyboard,
    policyGates: {
      externalGeneration: input.project.config.permissions.externalGeneration,
      localOnly: input.project.config.permissions.localOnly,
      allowNetwork: input.project.config.permissions.allowNetwork,
      note: 'The engine currently forbids enabling these flags; opening them is an authorization decision for a separately approved pilot, not a technical prerequisite.',
    },
    blockers,
    operatorNextSteps: nextSteps,
    caveats: [
      'A green technical preflight is not authorization to submit.',
      'Project permission flags are reported separately from technical readiness.',
      'Budget controls in this project do not limit spend incurred by other clients on the same provider account.',
      'A local cost estimate is not a guarantee of the final invoice.',
      'No live provider request is made by this report.',
    ],
  };
};
