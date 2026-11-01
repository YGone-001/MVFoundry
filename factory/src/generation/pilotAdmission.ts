import {closeSync, fsyncSync, openSync, renameSync, rmSync, writeSync} from 'node:fs';
import {randomBytes, createHash} from 'node:crypto';
import path from 'node:path';
import type {LoadedProject} from '../config/types';
import {FactoryError} from '../errors';
import {isInside} from '../workspace/guard';
import {assertSafePath, ensureSafeDirectory, type WriteBoundary} from '../workspace/writeBoundary';
import {readOptionalProjectJson} from '../preproduction/store';
import {acquireLedgerLock} from './ledger';
import type {AssetRequirement} from '../preproduction/types';
import type {
  GenerationJob,
  GenerationOperation,
  GenerationOutputKind,
  GenerationProviderId,
  CostEstimate,
  LedgerDocument,
  PricingDecision,
  PricingSnapshot,
} from './types';

/**
 * A pilot admission is a project-local, reviewed, single-use record that names
 * exactly one project, one job, one requirement fingerprint, one provider, one
 * model and one operation.
 *
 * It is operational evidence written by a trusted local operator command. It is
 * NOT authenticated identity verification: nothing here proves who approved it,
 * and no field may be presented as cryptographic authorization.
 *
 * It deliberately does not open the P0 project policy. `project.json`
 * `permissions` stay at their local-only values, and `validateProjectConfig`
 * keeps rejecting anything else. The admission only supplies an additional,
 * narrowly scoped execution context that is evaluated at the submission
 * boundary.
 */
export const PILOT_ADMISSION_SCHEMA_VERSION = 1;

export const PILOT_ADMISSION_PATHS = {
  document: 'generation/pilot-admission.json',
  reports: 'generation/reports',
} as const;

export const PILOT_ID_PATTERN = /^[a-z0-9][a-z0-9-]{2,63}$/;

export type PilotApprovalState = 'proposed' | 'approved' | 'denied' | 'revoked';

/** `consumed` and `uncertain` are terminal: neither is auto-released. */
export type PilotConsumptionState = 'unconsumed' | 'consumed' | 'uncertain';

export type PilotPolicyStatus = 'DENIED_P0' | 'PENDING' | 'ADMITTED_FOR_PILOT' | 'REFUSED';

export type PilotRefusalCode =
  | 'no-admission'
  | 'admission-incomplete'
  | 'admission-denied'
  | 'admission-revoked'
  | 'admission-expired'
  | 'admission-consumed'
  | 'admission-uncertain'
  | 'project-mismatch'
  | 'job-mismatch'
  | 'requirement-mismatch'
  | 'fingerprint-changed'
  | 'storyboard-changed'
  | 'provider-mismatch'
  | 'model-mismatch'
  | 'operation-mismatch'
  | 'output-mismatch'
  | 'reference-changed'
  | 'pricing-changed'
  | 'cost-exceeds-admission'
  | 'submission-ceiling';

export type PilotAdmissionReference = {
  assetId: string;
  sha256: string;
  /** Per-reference upload permission. A job-level flag is not enough. */
  uploadAuthorized: boolean;
};

export type PilotAdmissionOutputProfile = {
  kind: GenerationOutputKind;
  width: number | null;
  height: number | null;
  aspectRatio: string;
  durationFrames: number | null;
  fps: number;
  seed: number | null;
};

export type PilotAdmission = {
  schemaVersion: typeof PILOT_ADMISSION_SCHEMA_VERSION;
  /** Monotonic per pilot id; a new attempt is a new pilot id, never a renewal. */
  admissionRevision: number;
  pilotId: string;
  projectId: string;
  jobId: string;
  requirementId: string;
  requirementFingerprint: string;
  storyboardRevision: number;
  provider: GenerationProviderId;
  model: string;
  operation: GenerationOperation;
  output: PilotAdmissionOutputProfile;
  pricing: {
    pricingVersion: string;
    snapshotSha256: string;
  };
  /** Upper bound the estimator must stay at or below for this pilot. */
  maxEstimatedCostUsd: number;
  /** Spend the operator authorizes for this pilot; never above the job ceiling. */
  authorizedSpendCeilingUsd: number;
  /** Always exactly 1 in this phase. */
  maxSubmissions: number;
  references: PilotAdmissionReference[];
  approvalState: PilotApprovalState;
  approval: {
    reviewedAt: string | null;
    notes: string;
  };
  createdAt: string;
  expiresAt: string;
  consumption: {
    state: PilotConsumptionState;
    submissionKey: string | null;
    consumedAt: string | null;
    providerTaskId: string | null;
    note: string | null;
  };
  operatorNotes: string;
};

export type PilotAdmissionDocument = {
  schemaVersion: typeof PILOT_ADMISSION_SCHEMA_VERSION;
  projectId: string;
  revision: number;
  admissions: PilotAdmission[];
};

export class PilotAdmissionError extends FactoryError {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'PilotAdmissionError';
    this.code = code;
  }
}

function fail(code: string, message: string): never {
  throw new PilotAdmissionError(code, message);
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const SHA256 = /^[a-f0-9]{64}$/;

/** `asset:<id>#sha256:<12 hex>` is the redacted reference identity used elsewhere. */
const nonEmpty = (value: unknown, field: string): string => {
  if (typeof value !== 'string' || value.trim() === '') {
    fail('admission-malformed', `${field} must be a non-empty string`);
  }
  return value as string;
};

const nonNegativeFinite = (value: unknown, field: string): number => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    fail('admission-malformed', `${field} must be a non-negative finite number`);
  }
  return value as number;
};

const positiveInteger = (value: unknown, field: string): number => {
  if (!Number.isInteger(value) || (value as number) < 1) {
    fail('admission-malformed', `${field} must be an integer >= 1`);
  }
  return value as number;
};

const isoDate = (value: unknown, field: string): string => {
  const text = nonEmpty(value, field);
  if (Number.isNaN(Date.parse(text))) fail('admission-malformed', `${field} must be an ISO 8601 timestamp`);
  return text;
};

const optionalIsoDate = (value: unknown, field: string): string | null =>
  value === null || value === undefined ? null : isoDate(value, field);

/**
 * Fields an admission must never carry. This is a structural check, not a
 * scanner: it stops a future field from smuggling a credential, a signed URL, a
 * raw payload, a private path or song material into the record.
 */
const FORBIDDEN_KEY_PATTERN =
  /api[-_]?key|bearer|token|secret|password|credential|cookie|signature|signed[-_]?url|authorization[-_]?header|payload|base64|data[-_]?uri|lyrics|audio|songtext|absolute[-_]?path|filesystem[-_]?path|image[-_]?bytes/i;

const FORBIDDEN_VALUE_PATTERNS: RegExp[] = [
  /[A-Za-z]:[\\/]/,
  /^\/(?:Users|home)\//,
  /^file:\/\//,
  /^https?:\/\/\S*[?&](?:X-Amz|Signature|token|jwt)/i,
];

const looksLikePathOrSignedUrl = (value: string): boolean =>
  FORBIDDEN_VALUE_PATTERNS.some((pattern) => pattern.test(value));

const assertNoForbiddenFields = (value: unknown, trail: string): void => {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoForbiddenFields(entry, `${trail}[${index}]`));
    return;
  }
  if (!isRecord(value)) {
    if (typeof value === 'string' && looksLikePathOrSignedUrl(value)) {
      fail('admission-forbidden-field', `${trail} contains a private path or signed URL`);
    }
    return;
  }
  for (const [key, entry] of Object.entries(value)) {
    if (FORBIDDEN_KEY_PATTERN.test(key)) {
      fail('admission-forbidden-field', `${trail}.${key} is not allowed in a pilot admission record`);
    }
    assertNoForbiddenFields(entry, `${trail}.${key}`);
  }
};

const ALLOWED_KEYS = new Set([
  'schemaVersion',
  'admissionRevision',
  'pilotId',
  'projectId',
  'jobId',
  'requirementId',
  'requirementFingerprint',
  'storyboardRevision',
  'provider',
  'model',
  'operation',
  'output',
  'pricing',
  'maxEstimatedCostUsd',
  'authorizedSpendCeilingUsd',
  'maxSubmissions',
  'references',
  'approvalState',
  'approval',
  'createdAt',
  'expiresAt',
  'consumption',
  'operatorNotes',
]);

const assertKeys = (value: Record<string, unknown>, allowed: readonly string[], field: string): void => {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) fail('admission-malformed', `${field} contains unsupported key ${key}`);
  }
};

const parseOutput = (value: unknown): PilotAdmissionOutputProfile => {
  if (!isRecord(value)) fail('admission-malformed', 'output must be an object');
  assertKeys(value, ['kind', 'width', 'height', 'aspectRatio', 'durationFrames', 'fps', 'seed'], 'output');
  const kind = nonEmpty(value.kind, 'output.kind');
  if (!['image', 'video', 'transparent-layer'].includes(kind)) {
    fail('admission-malformed', `output.kind ${kind} is not a supported output kind`);
  }
  const dimension = (raw: unknown, field: string): number | null => {
    if (raw === null || raw === undefined) return null;
    return positiveInteger(raw, field);
  };
  const fps = value.fps;
  if (!Number.isInteger(fps) || (fps as number) < 1 || (fps as number) > 120) {
    fail('admission-malformed', 'output.fps must be an integer in [1, 120]');
  }
  return {
    kind: kind as GenerationOutputKind,
    width: dimension(value.width, 'output.width'),
    height: dimension(value.height, 'output.height'),
    aspectRatio: nonEmpty(value.aspectRatio, 'output.aspectRatio'),
    durationFrames: dimension(value.durationFrames, 'output.durationFrames'),
    fps: fps as number,
    seed: value.seed === null || value.seed === undefined ? null : nonNegativeFinite(value.seed, 'output.seed'),
  };
};

const parseReference = (value: unknown, field: string): PilotAdmissionReference => {
  if (!isRecord(value)) fail('admission-malformed', `${field} must be an object`);
  assertKeys(value, ['assetId', 'sha256', 'uploadAuthorized'], field);
  const sha256 = nonEmpty(value.sha256, `${field}.sha256`);
  if (!SHA256.test(sha256)) fail('admission-malformed', `${field}.sha256 must be lowercase hex`);
  if (typeof value.uploadAuthorized !== 'boolean') {
    fail('admission-malformed', `${field}.uploadAuthorized must be a boolean`);
  }
  return {
    assetId: nonEmpty(value.assetId, `${field}.assetId`),
    sha256,
    uploadAuthorized: value.uploadAuthorized,
  };
};

const parseAdmission = (value: unknown, index: number, projectId: string): PilotAdmission => {
  const field = `admissions[${index}]`;
  if (!isRecord(value)) fail('admission-malformed', `${field} must be an object`);
  assertNoForbiddenFields(value, field);
  assertKeys(value, [...ALLOWED_KEYS], field);

  if (value.schemaVersion !== PILOT_ADMISSION_SCHEMA_VERSION) {
    fail('admission-malformed', `${field}.schemaVersion must be ${PILOT_ADMISSION_SCHEMA_VERSION}`);
  }
  const pilotId = nonEmpty(value.pilotId, `${field}.pilotId`);
  if (!PILOT_ID_PATTERN.test(pilotId)) {
    fail('admission-malformed', `${field}.pilotId must be lowercase letters, digits and hyphens (3-64 chars)`);
  }
  const admittedProjectId = nonEmpty(value.projectId, `${field}.projectId`);
  if (admittedProjectId !== projectId) {
    fail(
      'admission-cross-project',
      `${field}.projectId is ${admittedProjectId} but the admission document belongs to ${projectId}`,
    );
  }
  const provider = nonEmpty(value.provider, `${field}.provider`);
  if (!['offline-fixture', 'runway'].includes(provider)) {
    fail('admission-malformed', `${field}.provider is not a supported provider`);
  }
  const operation = nonEmpty(value.operation, `${field}.operation`);
  if (!['text-to-image', 'image-to-video', 'text-to-video'].includes(operation)) {
    fail('admission-malformed', `${field}.operation is not a supported operation`);
  }
  const approvalState = nonEmpty(value.approvalState, `${field}.approvalState`);
  if (!['proposed', 'approved', 'denied', 'revoked'].includes(approvalState)) {
    fail('admission-malformed', `${field}.approvalState is not a supported state`);
  }
  const approval = value.approval;
  if (!isRecord(approval)) fail('admission-malformed', `${field}.approval must be an object`);
  assertKeys(approval, ['reviewedAt', 'notes'], `${field}.approval`);
  const consumption = value.consumption;
  if (!isRecord(consumption)) fail('admission-malformed', `${field}.consumption must be an object`);
  assertKeys(
    consumption,
    ['state', 'submissionKey', 'consumedAt', 'providerTaskId', 'note'],
    `${field}.consumption`,
  );
  const consumptionState = nonEmpty(consumption.state, `${field}.consumption.state`);
  if (!['unconsumed', 'consumed', 'uncertain'].includes(consumptionState)) {
    fail('admission-malformed', `${field}.consumption.state is not a supported state`);
  }
  const pricing = value.pricing;
  if (!isRecord(pricing)) fail('admission-malformed', `${field}.pricing must be an object`);
  assertKeys(pricing, ['pricingVersion', 'snapshotSha256'], `${field}.pricing`);
  const snapshotSha256 = nonEmpty(pricing.snapshotSha256, `${field}.pricing.snapshotSha256`);
  if (!SHA256.test(snapshotSha256)) {
    fail('admission-malformed', `${field}.pricing.snapshotSha256 must be lowercase hex`);
  }
  const references = Array.isArray(value.references) ? value.references : null;
  if (references === null) fail('admission-malformed', `${field}.references must be an array`);
  const parsedReferences = (references as unknown[]).map((entry, entryIndex) =>
    parseReference(entry, `${field}.references[${entryIndex}]`),
  );
  const seenAssets = new Set<string>();
  for (const reference of parsedReferences) {
    if (seenAssets.has(reference.assetId)) {
      fail('admission-malformed', `${field}.references contains duplicate asset ${reference.assetId}`);
    }
    seenAssets.add(reference.assetId);
  }
  const maxSubmissions = positiveInteger(value.maxSubmissions, `${field}.maxSubmissions`);
  if (maxSubmissions !== 1) {
    fail('admission-malformed', `${field}.maxSubmissions must be exactly 1; a pilot is one shot`);
  }
  const revision = positiveInteger(value.admissionRevision, `${field}.admissionRevision`);
  const subject = value.requirementFingerprint;
  if (typeof subject !== 'string' || subject.trim() === '') {
    fail('admission-malformed', `${field}.requirementFingerprint must be a non-empty string`);
  }

  return {
    schemaVersion: PILOT_ADMISSION_SCHEMA_VERSION,
    admissionRevision: revision,
    pilotId,
    projectId: admittedProjectId,
    jobId: nonEmpty(value.jobId, `${field}.jobId`),
    requirementId: nonEmpty(value.requirementId, `${field}.requirementId`),
    requirementFingerprint: subject,
    storyboardRevision: positiveInteger(value.storyboardRevision, `${field}.storyboardRevision`),
    provider: provider as GenerationProviderId,
    model: nonEmpty(value.model, `${field}.model`),
    operation: operation as GenerationOperation,
    output: parseOutput(value.output),
    pricing: {
      pricingVersion: nonEmpty(pricing.pricingVersion, `${field}.pricing.pricingVersion`),
      snapshotSha256,
    },
    maxEstimatedCostUsd: nonNegativeFinite(value.maxEstimatedCostUsd, `${field}.maxEstimatedCostUsd`),
    authorizedSpendCeilingUsd: nonNegativeFinite(
      value.authorizedSpendCeilingUsd,
      `${field}.authorizedSpendCeilingUsd`,
    ),
    maxSubmissions,
    references: parsedReferences,
    approvalState: approvalState as PilotApprovalState,
    approval: {
      reviewedAt: optionalIsoDate(approval.reviewedAt, `${field}.approval.reviewedAt`),
      notes: typeof approval.notes === 'string' ? approval.notes : '',
    },
    createdAt: isoDate(value.createdAt, `${field}.createdAt`),
    expiresAt: isoDate(value.expiresAt, `${field}.expiresAt`),
    consumption: {
      state: consumptionState as PilotConsumptionState,
      submissionKey:
        consumption.submissionKey === null || consumption.submissionKey === undefined
          ? null
          : nonEmpty(consumption.submissionKey, `${field}.consumption.submissionKey`),
      consumedAt: optionalIsoDate(consumption.consumedAt, `${field}.consumption.consumedAt`),
      providerTaskId:
        consumption.providerTaskId === null || consumption.providerTaskId === undefined
          ? null
          : nonEmpty(consumption.providerTaskId, `${field}.consumption.providerTaskId`),
      note: typeof consumption.note === 'string' ? consumption.note : null,
    },
    operatorNotes: typeof value.operatorNotes === 'string' ? value.operatorNotes : '',
  };
};

export const parsePilotAdmissionDocument = (
  raw: unknown,
  projectId: string,
): PilotAdmissionDocument => {
  if (!isRecord(raw)) fail('admission-malformed', 'pilot admission document must be an object');
  assertKeys(raw, ['schemaVersion', 'projectId', 'revision', 'admissions'], 'pilot admission document');
  if (raw.schemaVersion !== PILOT_ADMISSION_SCHEMA_VERSION) {
    fail('admission-malformed', `pilot admission schemaVersion must be ${PILOT_ADMISSION_SCHEMA_VERSION}`);
  }
  const declared = nonEmpty(raw.projectId, 'projectId');
  if (declared !== projectId) {
    fail('admission-cross-project', `pilot admission document declares ${declared}, loaded as ${projectId}`);
  }
  if (!Array.isArray(raw.admissions)) fail('admission-malformed', 'admissions must be an array');
  const admissions = (raw.admissions as unknown[]).map((entry, index) => parseAdmission(entry, index, projectId));
  const seen = new Set<string>();
  for (const admission of admissions) {
    if (seen.has(admission.pilotId)) {
      fail('admission-malformed', `duplicate pilotId ${admission.pilotId}`);
    }
    seen.add(admission.pilotId);
  }
  return {
    schemaVersion: PILOT_ADMISSION_SCHEMA_VERSION,
    projectId,
    revision: Number.isInteger(raw.revision) ? (raw.revision as number) : 0,
    admissions,
  };
};

const emptyDocument = (projectId: string): PilotAdmissionDocument => ({
  schemaVersion: PILOT_ADMISSION_SCHEMA_VERSION,
  projectId,
  revision: 0,
  admissions: [],
});

export const readPilotAdmissions = (project: LoadedProject): PilotAdmissionDocument => {
  const raw = readOptionalProjectJson<unknown>(project.projectDir, PILOT_ADMISSION_PATHS.document);
  if (raw === null) return emptyDocument(project.config.projectId);
  return parsePilotAdmissionDocument(raw, project.config.projectId);
};

/**
 * Atomic replacement inside the project. A crash leaves either the previous
 * document or the new one, never a truncated record that could be misread as
 * "unconsumed".
 */
export const writePilotAdmissions = (
  boundary: WriteBoundary,
  document: PilotAdmissionDocument,
): string => {
  const target = path.join(boundary.projectRoot, PILOT_ADMISSION_PATHS.document);
  ensureSafeDirectory(boundary, path.dirname(target), 'project');
  const checked = assertSafePath(boundary, target, {expect: 'file', subtree: 'project'});
  if (!isInside(boundary.projectRoot, checked)) fail('admission-malformed', 'admission path escapes the project');
  const staging = `${checked}.${randomBytes(6).toString('hex')}.tmp`;
  assertSafePath(boundary, staging, {expect: 'file', subtree: 'project'});
  const handle = openSync(staging, 'wx');
  try {
    writeSync(handle, `${JSON.stringify(document, null, 2)}\n`);
    fsyncSync(handle);
  } finally {
    closeSync(handle);
  }
  try {
    renameSync(staging, checked);
  } catch (error) {
    rmSync(staging, {force: true});
    throw error;
  }
  return checked;
};

export const findAdmission = (
  document: PilotAdmissionDocument,
  pilotId: string,
): PilotAdmission | null => document.admissions.find((entry) => entry.pilotId === pilotId) ?? null;

export const findAdmissionForJob = (
  document: PilotAdmissionDocument,
  jobId: string,
): PilotAdmission | null => {
  // The newest unconsumed admission for the job, else the newest one at all.
  const matching = document.admissions.filter((entry) => entry.jobId === jobId);
  if (matching.length === 0) return null;
  const ordered = [...matching].sort((left, right) => right.admissionRevision - left.admissionRevision);
  return ordered.find((entry) => entry.consumption.state === 'unconsumed') ?? ordered[0];
};

export const admissionOutputProfile = (job: GenerationJob): PilotAdmissionOutputProfile => ({
  kind: job.output.kind,
  width: job.output.width,
  height: job.output.height,
  aspectRatio: job.output.aspectRatio,
  durationFrames: job.output.durationFrames,
  fps: job.output.fps,
  seed: job.output.seed,
});

export const admissionOutputMatches = (
  admission: PilotAdmission,
  job: GenerationJob,
): boolean => JSON.stringify(admission.output) === JSON.stringify(admissionOutputProfile(job));

export const admissionReferencesFrom = (job: GenerationJob): PilotAdmissionReference[] =>
  job.inputAssets.map((asset) => ({assetId: asset.assetId, sha256: asset.sha256, uploadAuthorized: false}));

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

export type PilotReferenceFacts = {
  assetId: string;
  sha256: string;
  disclosure: string;
  blockers: string[];
};

export type PilotEvaluationInput = {
  projectId: string;
  job: GenerationJob;
  requirement: AssetRequirement | null;
  storyboard: {revision: number; status: string; renderReady: boolean};
  admission: PilotAdmission | null;
  estimate: PricingDecision;
  pricing: PricingSnapshot;
  ledger: LedgerDocument;
  permissionRecord:
    | {
        jobId: string;
        provider: string;
        model: string;
        operation: string;
        maxSpendUsd: number;
        maxSubmissions: number;
        authorization: string;
        uploadsPrivateAssets: boolean;
        inputAssetIds: string[];
        authorizationRevision: number;
      }
    | null;
  references: PilotReferenceFacts[];
  credentialsPresent: boolean;
  transport: {ready: boolean; reason: string};
  now: Date;
};

export type PilotCheck = {id: string; ok: boolean; detail: string};

export type PilotEvaluation = {
  status: PilotPolicyStatus;
  refusalCode: PilotRefusalCode | null;
  pilotId: string | null;
  admissionRevision: number | null;
  approvalState: PilotApprovalState | null;
  consumptionState: PilotConsumptionState | null;
  expired: boolean;
  expiresAt: string | null;
  spendCeilingUsd: number | null;
  estimatedUsd: number | null;
  referencesAuthorized: boolean;
  pricingCurrent: boolean;
  budget: {
    reservedUsd: number;
    remainingUsd: number | null;
    openReservation: boolean;
    uncertain: boolean;
  };
  checks: PilotCheck[];
  blockers: string[];
  note: string;
};

const TRUST_NOTE =
  'A pilot admission is local operational evidence, not cryptographic proof of the approver identity.';

/**
 * Pure, side-effect free evaluation. Technical readiness never implies
 * permission, and permission never implies technical readiness.
 */
export const evaluatePilotAdmission = (input: PilotEvaluationInput): PilotEvaluation => {
  const checks: PilotCheck[] = [];
  const blockers: string[] = [];
  let refusalCode: PilotRefusalCode | null = null;

  const refuse = (code: PilotRefusalCode, detail: string): void => {
    if (refusalCode === null) refusalCode = code;
    blockers.push(detail);
  };

  const check = (id: string, ok: boolean, detail: string, onFail?: () => void): boolean => {
    checks.push({id, ok, detail});
    if (!ok && onFail) onFail();
    return ok;
  };

  const admission = input.admission;
  const estimate = input.estimate.ok ? (input.estimate.estimate as CostEstimate) : null;
  const estimatedUsd = estimate ? estimate.estimatedUsd : null;

  const openEntry = input.ledger.entries.find(
    (entry) =>
      entry.jobId === input.job.jobId &&
      ['reserved', 'submitted', 'reconciled-unknown'].includes(entry.status),
  );
  const uncertainEntry = input.ledger.entries.some(
    (entry) => entry.jobId === input.job.jobId && entry.status === 'reconciled-unknown',
  );
  const reservedUsd = input.ledger.entries.reduce(
    (total, entry) =>
      ['reserved', 'submitted', 'reconciled-unknown'].includes(entry.status)
        ? total + Math.max(0, entry.reservedUsd - entry.releasedUsd)
        : total,
    0,
  );
  const ceiling = input.ledger.projectCeilingUsd;
  const remainingUsd =
    ceiling === null ? null : Number(Math.max(0, ceiling - reservedUsd).toFixed(6));

  const referencesAuthorized =
    input.references.length === (admission?.references.length ?? 0) &&
    input.references.every((reference) => reference.blockers.length === 0) &&
    (admission?.references ?? []).every(
      (reference) =>
        reference.uploadAuthorized &&
        input.references.some(
          (actual) => actual.assetId === reference.assetId && actual.sha256 === reference.sha256,
        ),
    );

  const pricingCurrent =
    estimate !== null &&
    admission !== null &&
    estimate.snapshotSha256 === admission.pricing.snapshotSha256 &&
    estimate.pricingVersion === admission.pricing.pricingVersion;

  if (!admission) {
    checks.push({id: 'admission-present', ok: false, detail: 'no pilot admission names this job'});
    refusalCode = 'no-admission';
    return {
      status: 'DENIED_P0',
      refusalCode,
      pilotId: null,
      admissionRevision: null,
      approvalState: null,
      consumptionState: null,
      expired: false,
      expiresAt: null,
      spendCeilingUsd: null,
      estimatedUsd,
      referencesAuthorized: false,
      pricingCurrent: false,
      budget: {reservedUsd, remainingUsd, openReservation: Boolean(openEntry), uncertain: uncertainEntry},
      checks,
      blockers: ['no pilot admission names this job; the P0 policy denies external generation'],
      note: TRUST_NOTE,
    };
  }

  check('project-binding', admission.projectId === input.projectId, `project ${admission.projectId}`, () =>
    refuse('project-mismatch', `admission ${admission.pilotId} belongs to project ${admission.projectId}`));
  check('job-binding', admission.jobId === input.job.jobId, `job ${admission.jobId}`, () =>
    refuse('job-mismatch', `admission ${admission.pilotId} is bound to job ${admission.jobId}, not ${input.job.jobId}`));
  check(
    'requirement-binding',
    admission.requirementId === input.job.requirementId,
    `requirement ${admission.requirementId}`,
    () =>
      refuse(
        'requirement-mismatch',
        `admission ${admission.pilotId} authorizes requirement ${admission.requirementId}, job uses ${input.job.requirementId}`,
      ),
  );
  check(
    'requirement-fingerprint',
    Boolean(input.requirement) && input.requirement?.fingerprint === admission.requirementFingerprint,
    `fingerprint ${admission.requirementFingerprint.slice(0, 12)}`,
    () => refuse('fingerprint-changed', 'the requirement fingerprint changed after the admission was reviewed'),
  );
  check(
    'storyboard-revision',
    input.storyboard.revision === admission.storyboardRevision,
    `storyboard revision ${admission.storyboardRevision}`,
    () =>
      refuse(
        'storyboard-changed',
        `admission reviewed storyboard revision ${admission.storyboardRevision}, current is ${input.storyboard.revision}`,
      ),
  );
  check(
    'storyboard-approval',
    input.storyboard.status === 'approved',
    `storyboard status ${input.storyboard.status}`,
    () => refuse('storyboard-changed', `storyboard revision ${input.storyboard.revision} is ${input.storyboard.status}`),
  );
  check('provider-binding', admission.provider === input.job.provider, `provider ${admission.provider}`, () =>
    refuse('provider-mismatch', `admission authorizes ${admission.provider}, job uses ${input.job.provider}`));
  check('model-binding', admission.model === input.job.model, `model ${admission.model}`, () =>
    refuse('model-mismatch', `admission authorizes model ${admission.model}, job uses ${input.job.model}`));
  check('operation-binding', admission.operation === input.job.operation, `operation ${admission.operation}`, () =>
    refuse('operation-mismatch', `admission authorizes ${admission.operation}, job uses ${input.job.operation}`));
  check('output-binding', admissionOutputMatches(admission, input.job), 'output profile matches the job', () =>
    refuse('output-mismatch', 'the job output profile changed after the admission was reviewed'));

  const admittedAssets = new Map(admission.references.map((entry) => [entry.assetId, entry.sha256]));
  const currentAssets = new Map(input.job.inputAssets.map((entry) => [entry.assetId, entry.sha256]));
  const sameReferences =
    admittedAssets.size === currentAssets.size &&
    [...admittedAssets].every(([assetId, sha256]) => currentAssets.get(assetId) === sha256);
  check('reference-binding', sameReferences, `${admittedAssets.size} reference assets`, () =>
    refuse('reference-changed', 'the job reference set or an approved reference hash changed after review'));

  check('pricing-snapshot', pricingCurrent, `pricing ${admission.pricing.pricingVersion}`, () =>
    refuse('pricing-changed', 'the pricing snapshot identity changed after the admission was reviewed'));
  check(
    'cost-within-admission',
    estimatedUsd !== null && estimatedUsd <= admission.maxEstimatedCostUsd + 1e-9,
    estimatedUsd === null ? 'no estimate' : `estimated $${estimatedUsd.toFixed(4)} <= $${admission.maxEstimatedCostUsd.toFixed(4)}`,
    () =>
      refuse(
        'cost-exceeds-admission',
        estimatedUsd === null
          ? 'no supported cost estimate is available'
          : `estimated $${estimatedUsd.toFixed(4)} exceeds the admitted maximum $${admission.maxEstimatedCostUsd.toFixed(4)}`,
      ),
  );

  check(
    'permission-record',
    Boolean(input.permissionRecord) &&
      input.permissionRecord?.jobId === input.job.jobId &&
      input.permissionRecord?.provider === input.job.provider &&
      input.permissionRecord?.model === input.job.model &&
      input.permissionRecord?.operation === input.job.operation &&
      input.permissionRecord?.authorization !== 'denied',
    input.permissionRecord ? `authorization ${input.permissionRecord.authorization}` : 'no permission record',
    () => refuse('admission-incomplete', 'the per-job permission record is missing, mismatched or denied'),
  );
  check(
    'spend-ceiling',
    Boolean(input.permissionRecord) &&
      admission.authorizedSpendCeilingUsd <= (input.permissionRecord?.maxSpendUsd ?? -1) + 1e-9,
    `admission ceiling $${admission.authorizedSpendCeilingUsd.toFixed(4)}`,
    () => refuse('cost-exceeds-admission', 'the admission spend ceiling exceeds the per-job authorization'),
  );
  check(
    'submission-ceiling',
    admission.maxSubmissions === 1 && (input.permissionRecord?.maxSubmissions ?? 0) >= 1,
    `max submissions ${admission.maxSubmissions}`,
    () => refuse('submission-ceiling', 'a pilot authorizes exactly one submission'),
  );

  check(
    'reservation-active',
    Boolean(openEntry),
    openEntry ? `reservation ${openEntry.entryId} (${openEntry.status})` : 'no open reservation',
    () => refuse('admission-incomplete', 'no active budget reservation exists for this job'),
  );
  check('reservation-not-uncertain', !uncertainEntry, uncertainEntry ? 'uncertain prior outcome' : 'no uncertain exposure', () =>
    refuse('admission-uncertain', 'a previous outcome is financially uncertain; reconcile it before submitting'));
  check(
    'project-budget',
    remainingUsd === null || (estimatedUsd !== null && estimatedUsd <= remainingUsd + 1e-9),
    remainingUsd === null ? 'no project ceiling' : `remaining $${remainingUsd.toFixed(4)}`,
    () => refuse('cost-exceeds-admission', 'the estimate exceeds the remaining project budget'),
  );

  check(
    'reference-disclosure',
    referencesAuthorized || input.references.length === 0,
    `${input.references.length} references, ${input.references.filter((entry) => entry.blockers.length === 0).length} disclosed`,
    () => refuse('admission-incomplete', 'one or more references are not authorized for disclosure'),
  );
  check('credentials', input.credentialsPresent, input.credentialsPresent ? 'credential present' : 'no credential', () =>
    refuse('admission-incomplete', 'provider credentials are not available in the environment'));
  check('transport', input.transport.ready, input.transport.reason, () =>
    refuse('admission-incomplete', `network transport is not ready: ${input.transport.reason}`));

  const alreadySubmitted = input.job.execution.providerTaskId !== null;
  check(
    'not-already-submitted',
    !alreadySubmitted,
    alreadySubmitted ? `bound to ${input.job.execution.providerTaskId}` : 'not submitted',
    () => refuse('admission-consumed', 'the job is already bound to a provider task; resume instead of submitting'),
  );
  check(
    'job-state-submittable',
    input.job.execution.state !== 'unknown-submission-state',
    `execution state ${input.job.execution.state}`,
    () => refuse('admission-uncertain', 'a previous submission outcome is unknown; reconcile it first'),
  );

  const expiresAtMs = Date.parse(admission.expiresAt);
  const expired = Number.isFinite(expiresAtMs) ? expiresAtMs <= input.now.getTime() : true;
  check('not-expired', !expired, expired ? `expired at ${admission.expiresAt}` : `valid until ${admission.expiresAt}`, () =>
    refuse('admission-expired', `admission ${admission.pilotId} expired at ${admission.expiresAt}`));

  const pendingApproval = admission.approvalState === 'proposed';
  check(
    'approval-state',
    admission.approvalState === 'approved',
    `approval ${admission.approvalState}`,
    () => {
      if (admission.approvalState === 'revoked') {
        refuse('admission-revoked', `admission ${admission.pilotId} was revoked`);
      } else if (admission.approvalState === 'denied') {
        refuse('admission-denied', `admission ${admission.pilotId} was denied at review`);
      } else {
        refuse('admission-incomplete', `admission ${admission.pilotId} has not been reviewed`);
      }
    },
  );
  check(
    'consumption-state',
    admission.consumption.state === 'unconsumed',
    `consumption ${admission.consumption.state}`,
    () => {
      if (admission.consumption.state === 'consumed') {
        refuse('admission-consumed', `admission ${admission.pilotId} was already consumed`);
      } else {
        refuse('admission-uncertain', `admission ${admission.pilotId} has an uncertain submission outcome`);
      }
    },
  );

  const blocked = blockers.length > 0;
  const status: PilotPolicyStatus = blocked
    ? pendingApproval && refusalCode === 'admission-incomplete'
      ? 'PENDING'
      : 'REFUSED'
    : 'ADMITTED_FOR_PILOT';

  return {
    status,
    refusalCode,
    pilotId: admission.pilotId,
    admissionRevision: admission.admissionRevision,
    approvalState: admission.approvalState,
    consumptionState: admission.consumption.state,
    expired,
    expiresAt: admission.expiresAt,
    spendCeilingUsd: admission.authorizedSpendCeilingUsd,
    estimatedUsd,
    referencesAuthorized,
    pricingCurrent,
    budget: {
      reservedUsd,
      remainingUsd,
      openReservation: Boolean(openEntry),
      uncertain: uncertainEntry,
    },
    checks,
    blockers,
    note: TRUST_NOTE,
  };
};

// ---------------------------------------------------------------------------
// Transitions
// ---------------------------------------------------------------------------

const nextDocument = (
  document: PilotAdmissionDocument,
  admission: PilotAdmission,
): PilotAdmissionDocument => ({
  ...document,
  revision: document.revision + 1,
  admissions: document.admissions.map((entry) => (entry.pilotId === admission.pilotId ? admission : entry)),
});

export type ProposeAdmissionInput = {
  boundary: WriteBoundary;
  document: PilotAdmissionDocument;
  admission: PilotAdmission;
};

/**
 * Adds a `proposed` admission. A pilot id is single-use for its whole lifetime:
 * re-proposing the same id is refused rather than treated as a renewal.
 */
export const proposePilotAdmission = (input: ProposeAdmissionInput): PilotAdmissionDocument => {
  const existing = findAdmission(input.document, input.admission.pilotId);
  if (existing) {
    fail(
      'pilot-id-already-used',
      `pilot ${input.admission.pilotId} already exists (${existing.approvalState}/${existing.consumption.state}); a new attempt needs a new pilot id`,
    );
  }
  if (input.admission.approvalState !== 'proposed') {
    fail('admission-malformed', 'a new pilot admission must start as proposed');
  }
  if (input.admission.consumption.state !== 'unconsumed') {
    fail('admission-malformed', 'a new pilot admission must start unconsumed');
  }
  if (Date.parse(input.admission.expiresAt) <= Date.parse(input.admission.createdAt)) {
    fail('admission-malformed', 'the admission must expire after it was created');
  }
  const document: PilotAdmissionDocument = {
    ...input.document,
    revision: input.document.revision + 1,
    admissions: [...input.document.admissions, input.admission],
  };
  writePilotAdmissions(input.boundary, document);
  return document;
};

export type ReviewAdmissionInput = {
  boundary: WriteBoundary;
  document: PilotAdmissionDocument;
  pilotId: string;
  decision: 'approve' | 'deny';
  notes: string;
  now: Date;
};

export const reviewPilotAdmission = (input: ReviewAdmissionInput): PilotAdmissionDocument => {
  const admission = findAdmission(input.document, input.pilotId);
  if (!admission) fail('unknown-pilot', `unknown pilot ${input.pilotId}`);
  const found = admission as PilotAdmission;
  if (found.approvalState !== 'proposed') {
    fail('invalid-transition', `pilot ${input.pilotId} is already ${found.approvalState}`);
  }
  if (!input.notes || input.notes.trim() === '') {
    fail('admission-malformed', 'a review requires recorded notes');
  }
  const updated: PilotAdmission = {
    ...found,
    approvalState: input.decision === 'approve' ? 'approved' : 'denied',
    approval: {reviewedAt: input.now.toISOString(), notes: input.notes},
  };
  const document = nextDocument(input.document, updated);
  writePilotAdmissions(input.boundary, document);
  return document;
};

export type RevokeAdmissionInput = {
  boundary: WriteBoundary;
  document: PilotAdmissionDocument;
  pilotId: string;
  notes: string;
  now: Date;
};

export const revokePilotAdmission = (input: RevokeAdmissionInput): PilotAdmissionDocument => {
  const found = findAdmission(input.document, input.pilotId);
  if (!found) fail('unknown-pilot', `unknown pilot ${input.pilotId}`);
  const admission = found as PilotAdmission;
  if (admission.consumption.state === 'consumed') {
    fail(
      'invalid-transition',
      `pilot ${input.pilotId} was already consumed; revoking it would not undo a provider submission`,
    );
  }
  if (!input.notes || input.notes.trim() === '') {
    fail('admission-malformed', 'a revocation requires recorded notes');
  }
  const updated: PilotAdmission = {
    ...admission,
    approvalState: 'revoked',
    approval: {
      reviewedAt: admission.approval.reviewedAt ?? input.now.toISOString(),
      notes: `${admission.approval.notes}\n${input.now.toISOString()} revoked: ${input.notes}`.trim(),
    },
    consumption:
      admission.consumption.state === 'uncertain'
        ? {
            ...admission.consumption,
            note: `${admission.consumption.note ?? ''}\nrevoked while uncertain; financial exposure is preserved`.trim(),
          }
        : admission.consumption,
  };
  const document = nextDocument(input.document, updated);
  writePilotAdmissions(input.boundary, document);
  return document;
};

export const pilotSubmissionKey = (input: {
  pilotId: string;
  admissionRevision: number;
  jobId: string;
  consumedAt: string;
}): string =>
  createHash('sha256')
    .update(`${input.pilotId}|${input.admissionRevision}|${input.jobId}|${input.consumedAt}`)
    .digest('hex')
    .slice(0, 32);

export type ConsumeAdmissionInput = {
  project: LoadedProject;
  boundary: WriteBoundary;
  pilotId: string;
  jobId: string;
  /** Re-evaluated inside the lock; the caller's earlier evaluation is not trusted. */
  revalidate: (admission: PilotAdmission) => string[];
  now?: Date;
};

export type ConsumeAdmissionResult = {
  ok: boolean;
  admission: PilotAdmission | null;
  submissionKey: string | null;
  consumedAt: string | null;
  code: string | null;
  blockers: string[];
};

/**
 * The only path from "admitted" to "owned". It runs inside the ledger lock, so
 * the admission consumption and the budget reservation can never be observed in
 * an inconsistent order by a second local process. Exactly one caller wins; the
 * loser sees the consumed state and refuses before touching the provider.
 */
export const consumePilotAdmission = async (
  input: ConsumeAdmissionInput,
): Promise<ConsumeAdmissionResult> => {
  const deny = (code: string, blockers: string[]): ConsumeAdmissionResult => ({
    ok: false,
    admission: null,
    submissionKey: null,
    consumedAt: null,
    code,
    blockers,
  });
  const lock = await acquireLedgerLock(input.project);
  try {
    const document = readPilotAdmissions(input.project);
    const admission = findAdmission(document, input.pilotId);
    if (!admission) return deny('unknown-pilot', [`unknown pilot ${input.pilotId}`]);
    if (admission.jobId !== input.jobId) {
      return deny('job-mismatch', [
        `pilot ${input.pilotId} is bound to job ${admission.jobId}, not ${input.jobId}`,
      ]);
    }
    if (admission.approvalState !== 'approved') {
      return deny('not-approved', [`pilot ${input.pilotId} is ${admission.approvalState}`]);
    }
    if (admission.consumption.state !== 'unconsumed') {
      return deny('admission-already-consumed', [
        `pilot ${input.pilotId} is ${admission.consumption.state}${
          admission.consumption.submissionKey ? ` (owner ${admission.consumption.submissionKey})` : ''
        }; exactly one process may obtain submission ownership`,
      ]);
    }
    const at = (input.now ?? new Date()).toISOString();
    if (Date.parse(admission.expiresAt) <= Date.parse(at)) {
      return deny('admission-expired', [`pilot ${input.pilotId} expired at ${admission.expiresAt}`]);
    }
    const blockers = input.revalidate(admission);
    if (blockers.length > 0) return deny('revalidation-failed', blockers);

    const submissionKey = pilotSubmissionKey({
      pilotId: admission.pilotId,
      admissionRevision: admission.admissionRevision,
      jobId: admission.jobId,
      consumedAt: at,
    });
    const updated: PilotAdmission = {
      ...admission,
      consumption: {
        state: 'consumed',
        submissionKey,
        consumedAt: at,
        providerTaskId: null,
        note: 'submission ownership taken under the project ledger lock',
      },
    };
    writePilotAdmissions(input.boundary, nextDocument(document, updated));
    return {ok: true, admission: updated, submissionKey, consumedAt: at, code: null, blockers: []};
  } finally {
    lock.release();
  }
};

export type MarkAdmissionInput = {
  boundary: WriteBoundary;
  document: PilotAdmissionDocument;
  pilotId: string;
  now: Date;
};

/**
 * Records a submitted task id on an already consumed admission. A different id
 * is a hard failure: identity is never silently rebound.
 */
export const bindAdmissionTask = (input: MarkAdmissionInput & {providerTaskId: string}): PilotAdmissionDocument => {
  const found = findAdmission(input.document, input.pilotId);
  if (!found) fail('unknown-pilot', `unknown pilot ${input.pilotId}`);
  const admission = found as PilotAdmission;
  if (admission.consumption.state !== 'consumed') {
    fail('invalid-transition', `pilot ${input.pilotId} is ${admission.consumption.state}, not consumed`);
  }
  const existing = admission.consumption.providerTaskId;
  if (existing !== null && existing !== input.providerTaskId) {
    fail(
      'task-id-conflict',
      `pilot ${input.pilotId} is bound to task ${existing}; refusing to rebind to ${input.providerTaskId}`,
    );
  }
  const updated: PilotAdmission = {
    ...admission,
    consumption: {...admission.consumption, providerTaskId: input.providerTaskId},
  };
  const document = nextDocument(input.document, updated);
  writePilotAdmissions(input.boundary, document);
  return document;
};

/**
 * An uncertain outcome stays uncertain forever. It keeps the admission and its
 * financial exposure open until an operator reconciles it explicitly; nothing in
 * the engine releases it automatically.
 */
export const markAdmissionUncertain = (
  input: MarkAdmissionInput & {note: string},
): PilotAdmissionDocument => {
  const found = findAdmission(input.document, input.pilotId);
  if (!found) fail('unknown-pilot', `unknown pilot ${input.pilotId}`);
  const admission = found as PilotAdmission;
  if (admission.consumption.state === 'uncertain') {
    const document = nextDocument(input.document, {
      ...admission,
      consumption: {
        ...admission.consumption,
        note: `${admission.consumption.note ?? ''}\n${input.now.toISOString()}: ${input.note}`.trim(),
      },
    });
    writePilotAdmissions(input.boundary, document);
    return document;
  }
  if (admission.consumption.state !== 'consumed') {
    fail('invalid-transition', `pilot ${input.pilotId} is ${admission.consumption.state}, not consumed`);
  }
  const updated: PilotAdmission = {
    ...admission,
    consumption: {
      ...admission.consumption,
      state: 'uncertain',
      note: input.note,
    },
  };
  const document = nextDocument(input.document, updated);
  writePilotAdmissions(input.boundary, document);
  return document;
};

/**
 * Returns an untouched admission to `unconsumed`. Only a provable pre-connection
 * refusal qualifies: no socket was opened, so no provider task can exist.
 */
export const releaseUnownedAdmission = (
  input: MarkAdmissionInput & {reason: string; submissionKey: string},
): PilotAdmissionDocument => {
  const found = findAdmission(input.document, input.pilotId);
  if (!found) fail('unknown-pilot', `unknown pilot ${input.pilotId}`);
  const admission = found as PilotAdmission;
  if (admission.consumption.state !== 'consumed') {
    fail('invalid-transition', `pilot ${input.pilotId} is ${admission.consumption.state}, not consumed`);
  }
  if (admission.consumption.submissionKey !== input.submissionKey) {
    fail('invalid-transition', `pilot ${input.pilotId} is owned by another submission key`);
  }
  const updated: PilotAdmission = {
    ...admission,
    consumption: {
      state: 'unconsumed',
      submissionKey: null,
      consumedAt: null,
      providerTaskId: null,
      note: `${input.now.toISOString()} ownership released before any connection: ${input.reason}`,
    },
  };
  const document = nextDocument(input.document, updated);
  writePilotAdmissions(input.boundary, document);
  return document;
};

export const describeReferenceDisclosure = (
  admission: PilotAdmission | null,
  references: PilotReferenceFacts[],
): 'NOT_REQUIRED' | 'AUTHORIZED' | 'PENDING' | 'DENIED' => {
  if (references.length === 0) return 'NOT_REQUIRED';
  if (!admission) return 'DENIED';
  const authorized = admission.references.every(
    (entry) =>
      entry.uploadAuthorized &&
      references.some(
        (actual) =>
          actual.assetId === entry.assetId &&
          actual.sha256 === entry.sha256 &&
          actual.blockers.length === 0,
      ),
  );
  if (authorized && references.length === admission.references.length) return 'AUTHORIZED';
  return 'PENDING';
};
