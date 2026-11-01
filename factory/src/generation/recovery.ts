import {PreproductionError} from '../errors';
import type {
  GenerationAttemptRecord,
  GenerationFailureKind,
  GenerationJob,
} from './types';

const now = (): string => new Date().toISOString();

const fail = (message: string): never => {
  throw new PreproductionError(message);
};

export const attemptHistoryOf = (job: GenerationJob): GenerationAttemptRecord[] =>
  Array.isArray(job.execution.attemptHistory) ? [...job.execution.attemptHistory] : [];

/**
 * Appends an attempt record without dropping earlier ones. Recovery evidence is
 * append-only: a later success never erases the record of an earlier timeout.
 */
export const recordAttempt = (
  job: GenerationJob,
  record: Omit<GenerationAttemptRecord, 'attempt' | 'at'> & {at?: string},
): GenerationJob => {
  const history = attemptHistoryOf(job);
  const attempt = history.length + 1;
  const entry: GenerationAttemptRecord = {
    attempt,
    at: record.at ?? now(),
    phase: record.phase,
    outcome: record.outcome,
    providerTaskId: record.providerTaskId,
    message: record.message,
  };
  return {
    ...job,
    execution: {
      ...job.execution,
      attempts: Math.max(job.execution.attempts, attempt),
      attemptHistory: [...history, entry],
      lastTransition: entry.at,
    },
  };
};

/**
 * A persisted task id is the only proof that a billable submission happened.
 * Once it exists, no code path may submit again for the same job.
 */
export const submissionAlreadyRecorded = (job: GenerationJob): boolean =>
  job.execution.providerTaskId !== null;

/** Conflicting task identity is a hard failure, never a silent reassignment. */
export const assertTaskIdConsistency = (job: GenerationJob, taskId: string): void => {
  if (!taskId || taskId.trim() === '') fail(`Provider returned an empty task id for job ${job.jobId}`);
  const existing = job.execution.providerTaskId;
  if (existing !== null && existing !== taskId) {
    fail(
      `Job ${job.jobId} is already bound to provider task ${existing}; refusing to rebind to ${taskId}`,
    );
  }
};

export const submissionBlocker = (job: GenerationJob): string | null => {
  const state = job.execution.state;
  if (job.execution.providerTaskId !== null && state !== 'prepared' && state !== 'awaiting-authorization') {
    return `job ${job.jobId} already has provider task ${job.execution.providerTaskId}; resume status and retrieval instead of submitting again`;
  }
  if (state === 'unknown-submission-state') {
    return 'previous submission outcome is unknown; reconcile the provider task before any new submission';
  }
  return null;
};

export const retrievalBlocker = (job: GenerationJob): string | null => {
  if (job.execution.providerTaskId === null) {
    return 'no provider task id is recorded; there is nothing to retrieve and no safe way to infer one';
  }
  if (job.execution.state === 'failed') {
    return 'the provider reported generation failure; retrieval cannot produce output';
  }
  if (job.execution.state === 'canceled') {
    return 'the provider task was canceled; retrieval cannot produce output';
  }
  return null;
};

export const markFailure = (
  job: GenerationJob,
  kind: GenerationFailureKind,
  message: string,
): GenerationJob => ({
  ...job,
  execution: {
    ...job.execution,
    failure: message,
    failureKind: kind,
    lastTransition: now(),
  },
});

export const markRetrievalRecovered = (job: GenerationJob): GenerationJob =>
  recordAttempt(job, {
    phase: 'retrieve',
    outcome: 'recovered',
    providerTaskId: job.execution.providerTaskId,
    message: 'result URL refreshed from the existing provider task',
  });

/**
 * An expired result URL is recoverable only by re-querying the existing task.
 * It never justifies a new submission.
 */
export const describeRetrievalFailure = (input: {
  code: string;
  message: string;
  recoverable: boolean;
}): string =>
  input.recoverable
    ? `retrieval can be retried by re-querying the existing provider task (${input.code}): ${input.message}`
    : `retrieval failed permanently (${input.code}): ${input.message}`;
