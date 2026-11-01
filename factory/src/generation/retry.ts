import {FactoryError} from '../errors';
import type {TransportErrorCode} from './types';

export type RetryKind = 'submission' | 'status' | 'retrieval';

export type RetryPolicy = {
  version: string;
  /** Attempts for non-billable operations (status polling, output retrieval). */
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  /** Documented guidance: add up to 50% jitter to the computed delay. */
  jitterRatio: number;
  minPollIntervalMs: number;
  maxPollIntervalMs: number;
};

export const RETRY_POLICY: RetryPolicy = {
  version: 'provider-retry-v1',
  maxAttempts: 5,
  baseDelayMs: 500,
  maxDelayMs: 30_000,
  jitterRatio: 0.5,
  minPollIntervalMs: 1_000,
  maxPollIntervalMs: 15_000,
};

export type RetryDecision = {
  retry: boolean;
  delayMs: number;
  reason: string;
  attemptsRemaining: number;
};

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

/** Exponential backoff with bounded jitter. `attempt` is 1-based. */
export const computeBackoffMs = (
  attempt: number,
  policy: RetryPolicy = RETRY_POLICY,
  random: () => number = Math.random,
): number => {
  const safeAttempt = Math.max(1, Math.floor(attempt));
  const raw = policy.baseDelayMs * 2 ** (safeAttempt - 1);
  const bounded = clamp(raw, policy.baseDelayMs, policy.maxDelayMs);
  const jitter = bounded * policy.jitterRatio * random();
  return Math.round(clamp(bounded + jitter, policy.baseDelayMs, policy.maxDelayMs * (1 + policy.jitterRatio)));
};

/** Parses a `Retry-After` header. Seconds or an HTTP date; invalid values are ignored. */
export const parseRetryAfterMs = (value: string | null | undefined, now: Date): number | null => {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) {
    const seconds = Number(trimmed);
    if (!Number.isFinite(seconds) || seconds < 0) return null;
    return seconds * 1000;
  }
  const date = Date.parse(trimmed);
  if (!Number.isFinite(date)) return null;
  const delta = date - now.getTime();
  return delta > 0 ? delta : 0;
};

const RETRYABLE_CODES: ReadonlySet<TransportErrorCode> = new Set<TransportErrorCode>([
  'rate-limited',
  'provider-unavailable',
  'connect-timeout',
  'response-timeout',
  'dns-failure',
]);

const PERMANENT_CODES: ReadonlySet<TransportErrorCode> = new Set<TransportErrorCode>([
  'live-not-authorized',
  'host-not-allowed',
  'malformed-url',
  'unsupported-protocol',
  'credentials-in-url',
  'blocked-address',
  'proxy-not-supported',
  'redirect-not-followed',
  'authorization-header-refused',
  'tls-verification-failed',
  'certificate-hostname-mismatch',
  'authentication-failed',
  'response-too-large',
  'request-failed',
]);

export type RetryInput = {
  kind: RetryKind;
  attempt: number;
  error: {code?: string; retryable?: boolean; status?: number | null} | null;
  policy?: RetryPolicy;
  retryAfterMs?: number | null;
  random?: () => number;
};

/**
 * The single retry decision point.
 *
 * A billable submission is never retried automatically: an uncertain POST may
 * already have created a paid task, and only a reconciled task id plus a
 * separate authorization may permit another submission.
 */
export const decideRetry = (input: RetryInput): RetryDecision => {
  const policy = input.policy ?? RETRY_POLICY;
  if (input.kind === 'submission') {
    return {
      retry: false,
      delayMs: 0,
      reason: 'a billable submission is never retried automatically; reconcile the task id first',
      attemptsRemaining: 0,
    };
  }
  const attemptsRemaining = Math.max(0, policy.maxAttempts - input.attempt);
  if (attemptsRemaining === 0) {
    return {retry: false, delayMs: 0, reason: 'retry budget exhausted', attemptsRemaining: 0};
  }
  const code = input.error?.code as TransportErrorCode | undefined;
  if (code && PERMANENT_CODES.has(code)) {
    return {retry: false, delayMs: 0, reason: `${code} is not retryable`, attemptsRemaining};
  }
  const retryableByCode = code ? RETRYABLE_CODES.has(code) : false;
  const retryableByFlag = input.error?.retryable === true;
  if (!retryableByCode && !retryableByFlag) {
    return {
      retry: false,
      delayMs: 0,
      reason: input.error ? `${code ?? 'error'} is not retryable` : 'no retryable error',
      attemptsRemaining,
    };
  }
  const backoff = computeBackoffMs(input.attempt, policy, input.random);
  const honored =
    typeof input.retryAfterMs === 'number' && Number.isFinite(input.retryAfterMs) && input.retryAfterMs >= 0
      ? Math.min(input.retryAfterMs, policy.maxDelayMs * 2)
      : null;
  const delayMs = honored === null ? backoff : Math.max(backoff, honored);
  return {
    retry: true,
    delayMs,
    reason:
      honored === null
        ? `retryable ${code ?? 'error'}; exponential backoff with jitter`
        : `retryable ${code ?? 'error'}; Retry-After honored`,
    attemptsRemaining,
  };
};

export const pollIntervalMs = (attempt: number, policy: RetryPolicy = RETRY_POLICY): number =>
  clamp(policy.minPollIntervalMs * 2 ** Math.max(0, attempt - 1), policy.minPollIntervalMs, policy.maxPollIntervalMs);

/** The submission path asserts this before any POST. */
export const assertBillableSubmissionNotRetried = (attempt: number): void => {
  if (attempt > 1) {
    throw new FactoryError(
      'refusing an automatic second billable submission; a new attempt needs explicit reconciliation and authorization',
    );
  }
};
