import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeSync,
} from 'node:fs';
import {randomBytes} from 'node:crypto';
import path from 'node:path';
import type {LoadedProject} from '../config/types';
import {FactoryError} from '../errors';
import {isInside} from '../workspace/guard';
import type {
  ChargeClassification,
  GenerationJob,
  LedgerDocument,
  LedgerEntry,
  LedgerEntryStatus,
  LedgerSummary,
} from './types';
import {LEDGER_SCHEMA_VERSION} from './types';

export const LEDGER_PATHS = {
  ledger: 'generation/ledger.json',
  lock: 'generation/ledger.lock',
} as const;

export type LedgerErrorCode =
  | 'lock-busy'
  | 'lock-stale'
  | 'already-reserved'
  | 'budget-exceeded'
  | 'job-ceiling-exceeded'
  | 'unknown-entry'
  | 'invalid-transition'
  | 'submission-limit'
  | 'malformed-ledger';

export class LedgerError extends FactoryError {
  readonly code: LedgerErrorCode;

  constructor(code: LedgerErrorCode, message: string) {
    super(message);
    this.name = 'LedgerError';
    this.code = code;
  }
}

const fail = (code: LedgerErrorCode, message: string): never => {
  throw new LedgerError(code, message);
};

const absolute = (project: LoadedProject, relative: string): string =>
  path.resolve(project.projectDir, relative);

const emptyLedger = (projectId: string): LedgerDocument => ({
  schemaVersion: LEDGER_SCHEMA_VERSION,
  projectId,
  revision: 0,
  entries: [],
  projectCeilingUsd: null,
});

export const readLedger = (project: LoadedProject): LedgerDocument => {
  const file = absolute(project, LEDGER_PATHS.ledger);
  if (!existsSync(file)) return emptyLedger(project.config.projectId);
  let parsed: LedgerDocument;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8')) as LedgerDocument;
  } catch {
    return fail('malformed-ledger', 'generation/ledger.json is not readable JSON; refusing to continue');
  }
  if (
    !parsed ||
    parsed.schemaVersion !== LEDGER_SCHEMA_VERSION ||
    !Array.isArray(parsed.entries) ||
    parsed.projectId !== project.config.projectId
  ) {
    return fail('malformed-ledger', 'generation/ledger.json does not match this project; refusing to continue');
  }
  return parsed;
};

const writeLedger = (project: LoadedProject, document: LedgerDocument): void => {
  const target = absolute(project, LEDGER_PATHS.ledger);
  const directory = path.dirname(target);
  if (!isInside(project.projectDir, target)) {
    fail('malformed-ledger', 'ledger path escapes the project');
  }
  mkdirSync(directory, {recursive: true});
  const staging = `${target}.${randomBytes(6).toString('hex')}.tmp`;
  const handle = openSync(staging, 'wx');
  try {
    writeSync(handle, `${JSON.stringify(document, null, 2)}\n`);
    fsyncSync(handle);
  } finally {
    closeSync(handle);
  }
  // Atomic replace: a crash leaves either the old document or the new one.
  renameSync(staging, target);
};

const OPEN_STATUSES: LedgerEntryStatus[] = ['reserved', 'submitted', 'reconciled-unknown'];

const openExposure = (entry: LedgerEntry): number => {
  if (!OPEN_STATUSES.includes(entry.status)) return 0;
  return Math.max(0, entry.reservedUsd - entry.releasedUsd);
};

export const summarizeLedger = (document: LedgerDocument): LedgerSummary => {
  const reservedUsd = document.entries.reduce((total, entry) => total + openExposure(entry), 0);
  const actualKnownUsd = document.entries.reduce(
    (total, entry) =>
      entry.status === 'reconciled-known' && typeof entry.actualUsd === 'number'
        ? total + entry.actualUsd
        : total,
    0,
  );
  const releasedUsd = document.entries.reduce((total, entry) => total + entry.releasedUsd, 0);
  const uncertain = document.entries.filter((entry) => entry.status === 'reconciled-unknown');
  const ceiling = document.projectCeilingUsd;
  return {
    projectId: document.projectId,
    projectCeilingUsd: ceiling,
    reservedUsd: Number(reservedUsd.toFixed(6)),
    actualKnownUsd: Number(actualKnownUsd.toFixed(6)),
    actualUnknownCount: uncertain.length,
    releasedUsd: Number(releasedUsd.toFixed(6)),
    remainingUsd:
      ceiling === null ? null : Number(Math.max(0, ceiling - reservedUsd - actualKnownUsd).toFixed(6)),
    entries: document.entries.length,
    uncertainEntries: uncertain.map((entry) => entry.jobId),
  };
};

export type LedgerLock = {
  path: string;
  nonce: string;
  release: () => void;
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export type AcquireLockOptions = {
  maxWaitMs?: number;
  staleMs?: number;
  random?: () => number;
};

/**
 * Exclusive lock over the project ledger. Acquisition is an atomic
 * `open(…, 'wx')`; a lock older than `staleMs` is never removed silently — it
 * fails closed and requires an explicit operator unlock.
 */
export const acquireLedgerLock = async (
  project: LoadedProject,
  options: AcquireLockOptions = {},
): Promise<LedgerLock> => {
  const lockPath = absolute(project, LEDGER_PATHS.lock);
  if (!isInside(project.projectDir, lockPath)) {
    fail('lock-busy', 'lock path escapes the project');
  }
  mkdirSync(path.dirname(lockPath), {recursive: true});
  const maxWaitMs = options.maxWaitMs ?? 5_000;
  const staleMs = options.staleMs ?? 120_000;
  const random = options.random ?? Math.random;
  const nonce = randomBytes(8).toString('hex');
  const deadline = Date.now() + maxWaitMs;

  for (;;) {
    let handle: number | null = null;
    try {
      handle = openSync(lockPath, 'wx');
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'EEXIST') {
        fail('lock-busy', `unable to create the ledger lock (${code ?? 'unknown'})`);
      }
      let ageMs = 0;
      try {
        ageMs = Date.now() - statSync(lockPath).mtimeMs;
      } catch {
        ageMs = 0;
      }
      if (ageMs > staleMs) {
        fail(
          'lock-stale',
          `ledger lock at ${LEDGER_PATHS.lock} is ${Math.round(ageMs / 1000)}s old; inspect it and remove it explicitly with "generation ledger-unlock"`,
        );
      }
      if (Date.now() > deadline) {
        fail('lock-busy', `ledger lock is held by another process; gave up after ${maxWaitMs}ms`);
      }
      await sleep(10 + Math.floor(random() * 40));
      continue;
    }
    try {
      writeSync(handle, JSON.stringify({pid: process.pid, nonce, at: new Date().toISOString()}));
      fsyncSync(handle);
    } finally {
      closeSync(handle);
    }
    return {
      path: lockPath,
      nonce,
      release: () => {
        try {
          const content = JSON.parse(readFileSync(lockPath, 'utf8')) as {nonce?: string};
          if (content.nonce !== nonce) return;
          unlinkSync(lockPath);
        } catch {
          // A missing or foreign lock is left untouched.
        }
      },
    };
  }
};

export const unlockLedger = (project: LoadedProject, note: string): {removed: boolean; note: string} => {
  const lockPath = absolute(project, LEDGER_PATHS.lock);
  if (!isInside(project.projectDir, lockPath)) {
    fail('lock-busy', 'lock path escapes the project');
  }
  if (!existsSync(lockPath)) return {removed: false, note: 'no lock was present'};
  rmSync(lockPath, {force: true});
  const document = readLedger(project);
  const next: LedgerDocument = {
    ...document,
    revision: document.revision + 1,
    interventions: [
      ...(document.interventions ?? []),
      {at: new Date().toISOString(), action: 'ledger-unlock', note},
    ],
  };
  writeLedger(project, next);
  return {removed: true, note};
};

const findOpenEntry = (document: LedgerDocument, jobId: string): LedgerEntry | null =>
  document.entries.find((entry) => entry.jobId === jobId && OPEN_STATUSES.includes(entry.status)) ?? null;

export type ReserveInput = {
  project: LoadedProject;
  job: GenerationJob;
  estimate: {
    estimatedUsd: number;
    estimatedCredits: number;
    pricingVersion: string;
    snapshotSha256: string;
  };
  authorization: {
    authorizedMaxUsd: number;
    authorizedMaxCredits: number | null;
    authorizationRevision: number;
  };
  now?: Date;
};

export type ReserveResult = {
  document: LedgerDocument;
  entry: LedgerEntry;
  summary: LedgerSummary;
};

/**
 * Reserves budget for one submission. The check-and-write happens under the
 * exclusive lock, so two processes cannot both consume the same remaining
 * budget. A job that already holds an open reservation is refused rather than
 * reserving twice.
 */
export const reserveBudget = async (input: ReserveInput): Promise<ReserveResult> => {
  const lock = await acquireLedgerLock(input.project);
  try {
    const document = readLedger(input.project);
    const existing = findOpenEntry(document, input.job.jobId);
    if (existing) {
      fail(
        'already-reserved',
        `job ${input.job.jobId} already holds reservation ${existing.entryId} (${existing.status}); refusing to reserve twice`,
      );
    }
    if (input.estimate.estimatedUsd > input.authorization.authorizedMaxUsd + 1e-9) {
      fail(
        'job-ceiling-exceeded',
        `estimated $${input.estimate.estimatedUsd.toFixed(4)} exceeds the job authorization of $${input.authorization.authorizedMaxUsd.toFixed(4)}`,
      );
    }
    const summary = summarizeLedger(document);
    if (summary.remainingUsd !== null && input.estimate.estimatedUsd > summary.remainingUsd + 1e-9) {
      fail(
        'budget-exceeded',
        `estimated $${input.estimate.estimatedUsd.toFixed(4)} exceeds the remaining project budget of $${summary.remainingUsd.toFixed(4)}`,
      );
    }
    const at = (input.now ?? new Date()).toISOString();
    const entry: LedgerEntry = {
      entryId: `LED-${input.job.jobId}-${document.entries.length + 1}`,
      projectId: input.project.config.projectId,
      jobId: input.job.jobId,
      provider: input.job.provider,
      model: input.job.model,
      operation: input.job.operation,
      authorizationRevision: input.authorization.authorizationRevision,
      authorizedMaxUsd: input.authorization.authorizedMaxUsd,
      authorizedMaxCredits: input.authorization.authorizedMaxCredits,
      estimatedUsd: input.estimate.estimatedUsd,
      estimatedCredits: input.estimate.estimatedCredits,
      reservedUsd: input.estimate.estimatedUsd,
      actualUsd: null,
      actualClassification: 'unknown',
      releasedUsd: 0,
      submissionCount: 0,
      providerTaskId: null,
      status: 'reserved',
      pricingVersion: input.estimate.pricingVersion,
      createdAt: at,
      updatedAt: at,
      provenance: `pricing snapshot ${input.estimate.snapshotSha256.slice(0, 12)} (${input.estimate.pricingVersion})`,
      notes: ['Reservation created before submission.'],
    };
    const next: LedgerDocument = {
      ...document,
      revision: document.revision + 1,
      entries: [...document.entries, entry],
    };
    writeLedger(input.project, next);
    return {document: next, entry, summary: summarizeLedger(next)};
  } finally {
    lock.release();
  }
};

const requireEntry = (document: LedgerDocument, jobId: string): LedgerEntry => {
  const entry = [...document.entries].reverse().find((candidate) => candidate.jobId === jobId);
  if (!entry) fail('unknown-entry', `no ledger entry exists for job ${jobId}`);
  return entry;
};

const replaceEntry = (document: LedgerDocument, updated: LedgerEntry): LedgerDocument => ({
  ...document,
  revision: document.revision + 1,
  entries: document.entries.map((entry) => (entry.entryId === updated.entryId ? updated : entry)),
});

export type ReconcileInput = {
  project: LoadedProject;
  jobId: string;
  status: LedgerEntryStatus;
  actualUsd?: number | null;
  actualClassification?: ChargeClassification;
  providerTaskId?: string | null;
  note: string;
  now?: Date;
};

/**
 * Transitions a ledger entry. `reconciled-unknown` keeps the reservation open,
 * because a failed or unreachable task is not evidence of zero billing.
 */
export const reconcileLedgerEntry = async (input: ReconcileInput): Promise<LedgerEntry> => {
  const lock = await acquireLedgerLock(input.project);
  try {
    const document = readLedger(input.project);
    const entry = requireEntry(document, input.jobId);
    if (entry.status === 'released' || entry.status === 'canceled') {
      fail('invalid-transition', `ledger entry for ${input.jobId} is already ${entry.status}`);
    }
    const at = (input.now ?? new Date()).toISOString();
    const released = input.status === 'released' || input.status === 'canceled' ? entry.reservedUsd : 0;
    const actual = input.status === 'reconciled-known' ? input.actualUsd ?? null : entry.actualUsd;
    const classification: ChargeClassification =
      input.status === 'reconciled-known'
        ? input.actualClassification ?? 'user-entered'
        : input.status === 'reconciled-unknown'
          ? 'unknown'
          : entry.actualClassification;
    if (input.status === 'reconciled-known' && actual === null) {
      fail('invalid-transition', 'a reconciled-known entry requires an actual charge');
    }
    const updated: LedgerEntry = {
      ...entry,
      status: input.status,
      actualUsd: actual,
      actualClassification: classification,
      releasedUsd: released,
      providerTaskId: input.providerTaskId === undefined ? entry.providerTaskId : input.providerTaskId,
      updatedAt: at,
      notes: [...entry.notes, `${at} ${input.status}: ${input.note}`],
    };
    writeLedger(input.project, replaceEntry(document, updated));
    return updated;
  } finally {
    lock.release();
  }
};

export const markSubmitted = async (input: {
  project: LoadedProject;
  jobId: string;
  providerTaskId: string;
  maxSubmissions: number;
  now?: Date;
}): Promise<LedgerEntry> => {
  const lock = await acquireLedgerLock(input.project);
  try {
    const document = readLedger(input.project);
    const entry = requireEntry(document, input.jobId);
    if (entry.submissionCount >= input.maxSubmissions) {
      fail(
        'submission-limit',
        `job ${input.jobId} has used ${entry.submissionCount} of ${input.maxSubmissions} authorized submissions`,
      );
    }
    if (entry.status !== 'reserved' && entry.status !== 'submitted') {
      fail('invalid-transition', `cannot submit a ledger entry in status ${entry.status}`);
    }
    if (entry.providerTaskId !== null && entry.providerTaskId !== input.providerTaskId) {
      fail(
        'invalid-transition',
        `ledger entry is bound to provider task ${entry.providerTaskId}; refusing to rebind to ${input.providerTaskId}`,
      );
    }
    const at = (input.now ?? new Date()).toISOString();
    const updated: LedgerEntry = {
      ...entry,
      status: 'submitted',
      providerTaskId: input.providerTaskId,
      submissionCount: entry.submissionCount + 1,
      updatedAt: at,
      notes: [...entry.notes, `${at} submitted as ${input.providerTaskId}`],
    };
    writeLedger(input.project, replaceEntry(document, updated));
    return updated;
  } finally {
    lock.release();
  }
};

export const setProjectCeiling = async (input: {
  project: LoadedProject;
  ceilingUsd: number | null;
  note: string;
  now?: Date;
}): Promise<LedgerDocument> => {
  if (input.ceilingUsd !== null && (!Number.isFinite(input.ceilingUsd) || input.ceilingUsd < 0)) {
    fail('budget-exceeded', 'project ceiling must be a non-negative number or null');
  }
  const lock = await acquireLedgerLock(input.project);
  try {
    const document = readLedger(input.project);
    const next: LedgerDocument = {
      ...document,
      revision: document.revision + 1,
      projectCeilingUsd: input.ceilingUsd,
      interventions: [
        ...(document.interventions ?? []),
        {
          at: (input.now ?? new Date()).toISOString(),
          action: 'set-project-ceiling',
          note: input.note,
        },
      ],
    };
    writeLedger(input.project, next);
    return next;
  } finally {
    lock.release();
  }
};
