import {ConfigValidationError} from '../errors';
import type {DurationPolicy} from './types';

export const DURATION_POLICIES: readonly DurationPolicy[] = ['round', 'floor', 'ceil'];

export const assertPositiveFinite = (value: number, field: string): number => {
  if (!Number.isFinite(value) || value <= 0) {
    throw new ConfigValidationError(`${field} must be a positive finite number`);
  }
  return value;
};

export const assertPositiveInteger = (value: number, field: string): number => {
  if (!Number.isInteger(value) || value <= 0) {
    throw new ConfigValidationError(`${field} must be a positive integer`);
  }
  return value;
};

/** Derived duration policy. The raw frame value is never rounded before policy. */
export const durationFramesFromSeconds = (
  durationSeconds: number,
  fps: number,
  policy: DurationPolicy,
): number => {
  assertPositiveFinite(durationSeconds, 'audio.durationSeconds');
  assertPositiveInteger(fps, 'output.fps');
  if (!DURATION_POLICIES.includes(policy)) {
    throw new ConfigValidationError(`Unsupported durationPolicy: ${policy}`);
  }
  const raw = durationSeconds * fps;
  const frames =
    policy === 'round' ? Math.round(raw) : policy === 'floor' ? Math.floor(raw) : Math.ceil(raw);
  if (!Number.isInteger(frames) || frames <= 0) {
    throw new ConfigValidationError(`Derived duration must be a positive integer, received ${frames}`);
  }
  return frames;
};
