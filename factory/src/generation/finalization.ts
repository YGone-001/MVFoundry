import {
  closeSync,
  copyFileSync,
  existsSync,
  fsyncSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeSync,
} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {FactoryError} from '../errors';
import type {LoadedProject} from '../config/types';
import type {RecoveryClassification, RetrievalState} from './types';
import {FINALIZATION_SCHEMA_VERSION} from './types';
import {assertSafePath, ensureSafeDirectory, type WriteBoundary} from '../workspace/writeBoundary';
import {isInside} from '../workspace/guard';

export const RETRIEVAL_STATE_DIR = 'generation/state';

export const retrievalStatePath = (jobId: string): string => `${RETRIEVAL_STATE_DIR}/${jobId}.json`;

export type FinalizationErrorCode =
  | 'temp-missing'
  | 'temp-incomplete'
  | 'hash-mismatch'
  | 'destination-exists'
  | 'destination-not-allowed'
  | 'finalization-failed';

export class FinalizationError extends FactoryError {
  readonly code: FinalizationErrorCode;

  constructor(code: FinalizationErrorCode, message: string) {
    super(message);
    this.name = 'FinalizationError';
    this.code = code;
  }
}

const fail = (code: FinalizationErrorCode, message: string): never => {
  throw new FinalizationError(code, message);
};

const sha256File = (file: string): string =>
  createHash('sha256').update(readFileSync(file)).digest('hex');

/** Flush the file's data before it is published under its final name. */
const flushFile = (file: string): void => {
  const handle = openSync(file, 'r+');
  try {
    fsyncSync(handle);
  } finally {
    closeSync(handle);
  }
};

const syncDirectory = (directory: string): void => {
  // Directory fsync is not supported on every platform; a failure here must not
  // turn a completed rename into a reported failure.
  let handle: number | null = null;
  try {
    handle = openSync(directory, 'r');
    fsyncSync(handle);
  } catch {
    // Best effort only.
  } finally {
    if (handle !== null) {
      try {
        closeSync(handle);
      } catch {
        // Ignore.
      }
    }
  }
};

export type FinalizeInput = {
  boundary: WriteBoundary;
  jobId: string;
  providerTaskId: string | null;
  tempPath: string;
  targetRelativePath: string;
  expectedSha256: string;
  expectedBytes: number;
  /** Only an explicit replacement may overwrite a previously finalized file. */
  overwriteFinalized?: boolean;
};

export type FinalizeResult = {
  absolutePath: string;
  sha256: string;
  bytes: number;
  idempotent: boolean;
  replacedPrevious: boolean;
  strategy: 'rename' | 'staged-rename';
};

/**
 * Publishes a fully downloaded and validated temporary file under its final
 * name without ever exposing a partial file there.
 *
 * Every write to the destination is a rename of a file whose size and SHA256
 * were verified. There is no "copy into the destination" fallback: if an atomic
 * rename cannot be performed the finalization is refused.
 */
export const finalizeDownloadedFile = (input: FinalizeInput): FinalizeResult => {
  const tempAbsolute = path.resolve(input.tempPath);
  if (!existsSync(tempAbsolute)) {
    fail('temp-missing', `temporary download is missing for job ${input.jobId}`);
  }
  if (!statSync(tempAbsolute).isFile()) {
    fail('temp-missing', `temporary download is not a regular file for job ${input.jobId}`);
  }
  const tempBytes = statSync(tempAbsolute).size;
  if (tempBytes !== input.expectedBytes) {
    fail(
      'temp-incomplete',
      `temporary download is ${tempBytes} bytes but ${input.expectedBytes} were validated`,
    );
  }
  const tempSha = sha256File(tempAbsolute);
  if (tempSha !== input.expectedSha256) {
    fail('hash-mismatch', 'temporary download no longer matches the validated hash');
  }
  flushFile(tempAbsolute);

  const targetAbsolute = assertSafePath(input.boundary, input.targetRelativePath, {
    expect: 'file',
    subtree: 'project',
  });
  if (!isInside(input.boundary.projectRoot, targetAbsolute)) {
    fail('destination-not-allowed', 'finalization destination is outside the authorized project');
  }
  const targetDirectory = path.dirname(targetAbsolute);
  if (!isInside(input.boundary.projectRoot, targetDirectory)) {
    fail('destination-not-allowed', 'finalization directory is outside the authorized project');
  }
  // The destination directory must exist before the rename; creating it here
  // keeps the publish step a single atomic operation.
  ensureSafeDirectory(input.boundary, targetDirectory, 'project');

  let replacedPrevious = false;
  if (existsSync(targetAbsolute)) {
    const existingSha = sha256File(targetAbsolute);
    if (existingSha === input.expectedSha256) {
      rmSync(tempAbsolute, {force: true});
      return {
        absolutePath: targetAbsolute,
        sha256: existingSha,
        bytes: statSync(targetAbsolute).size,
        idempotent: true,
        replacedPrevious: false,
        strategy: 'rename',
      };
    }
    if (input.overwriteFinalized !== true) {
      fail(
        'destination-exists',
        `a different finalized output already exists at ${input.targetRelativePath}; replacement needs an explicit decision`,
      );
    }
    // Move the previous file aside so a crash cannot leave the destination empty
    // with no recoverable copy.
    const previous = `${targetAbsolute}.replaced`;
    if (existsSync(previous)) rmSync(previous, {force: true});
    renameSync(targetAbsolute, previous);
    replacedPrevious = true;
  }

  const verify = (file: string): void => {
    const bytes = statSync(file).size;
    if (bytes !== input.expectedBytes) {
      fail('finalization-failed', `finalized output is ${bytes} bytes, expected ${input.expectedBytes}`);
    }
    const sha = sha256File(file);
    if (sha !== input.expectedSha256) {
      fail('finalization-failed', 'finalized output does not match the validated hash');
    }
  };

  const publish = (source: string): 'rename' | 'staged-rename' => {
    try {
      renameSync(source, targetAbsolute);
      return 'rename';
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'EXDEV' && code !== 'EPERM' && code !== 'EACCES') {
        fail('finalization-failed', `atomic rename failed (${code ?? 'unknown'})`);
      }
      // Cross-device or permission-restricted rename: stage a verified copy in
      // the destination directory and rename that. The destination itself is
      // never written in place.
      const staging = `${targetAbsolute}.finalizing`;
      if (existsSync(staging)) rmSync(staging, {force: true});
      try {
        copyFileSync(source, staging);
        flushFile(staging);
        verify(staging);
        renameSync(staging, targetAbsolute);
      } catch (stagingError) {
        if (existsSync(staging)) rmSync(staging, {force: true});
        fail(
          'finalization-failed',
          `staged finalization failed (${(stagingError as NodeJS.ErrnoException).code ?? 'unknown'}); no output was published`,
        );
      }
      rmSync(source, {force: true});
      return 'staged-rename';
    }
  };

  const strategy = publish(tempAbsolute);
  syncDirectory(targetDirectory);
  try {
    verify(targetAbsolute);
  } catch (error) {
    // A destination that fails verification is removed: a partial or corrupt
    // file must never be mistaken for a completed provider result.
    rmSync(targetAbsolute, {force: true});
    throw error;
  }
  const previous = `${targetAbsolute}.replaced`;
  if (existsSync(previous)) rmSync(previous, {force: true});
  return {
    absolutePath: targetAbsolute,
    sha256: input.expectedSha256,
    bytes: input.expectedBytes,
    idempotent: false,
    replacedPrevious,
    strategy,
  };
};

export const readRetrievalState = (project: LoadedProject, jobId: string): RetrievalState | null => {
  const file = path.resolve(project.projectDir, retrievalStatePath(jobId));
  if (!isInside(project.projectDir, file)) return null;
  if (!existsSync(file)) return null;
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as RetrievalState;
    if (!parsed || parsed.schemaVersion !== FINALIZATION_SCHEMA_VERSION || parsed.jobId !== jobId) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
};

export const writeRetrievalState = (
  boundary: WriteBoundary,
  state: Omit<RetrievalState, 'schemaVersion' | 'updatedAt'> & {updatedAt?: string},
): RetrievalState => {
  const document: RetrievalState = {
    schemaVersion: FINALIZATION_SCHEMA_VERSION,
    jobId: state.jobId,
    providerTaskId: state.providerTaskId,
    phase: state.phase,
    tempPath: state.tempPath,
    targetPath: state.targetPath,
    sha256: state.sha256,
    bytes: state.bytes,
    message: state.message,
    updatedAt: state.updatedAt ?? new Date().toISOString(),
  };
  const relative = retrievalStatePath(state.jobId);
  const target = assertSafePath(boundary, path.join(boundary.projectRoot, relative), {
    expect: 'file',
    subtree: 'project',
  });
  const directory = ensureSafeDirectory(boundary, path.dirname(target), 'project');
  const staging = `${target}.tmp`;
  if (existsSync(staging)) rmSync(staging, {force: true});
  const handle = openSync(staging, 'wx');
  try {
    writeSync(handle, `${JSON.stringify(document, null, 2)}\n`);
    fsyncSync(handle);
  } finally {
    closeSync(handle);
  }
  renameSync(staging, target);
  return document;
};

export type RecoveryFacts = {
  state: RetrievalState | null;
  tempExists: boolean;
  tempBytes: number;
  targetExists: boolean;
  targetSha256: string | null;
  manifestExists: boolean;
  intakeReview: 'pending' | 'in-review' | 'approved' | 'rejected' | null;
};

/**
 * Classifies what a restart finds on disk. The classification is deliberately
 * conservative: contradictory evidence is `ambiguous`, never an implicit
 * success, so a failed recovery cannot create an approved-looking output.
 */
export const classifyRecovery = (facts: RecoveryFacts): RecoveryClassification => {
  const {state} = facts;
  if (
    facts.targetExists &&
    state?.sha256 &&
    facts.targetSha256 !== null &&
    facts.targetSha256 !== state.sha256
  ) {
    return 'ambiguous';
  }
  if (facts.targetExists) {
    if (facts.intakeReview === 'approved') return 'approved';
    if (!facts.manifestExists) return 'finalized-not-manifested';
    if (facts.intakeReview === 'pending' || facts.intakeReview === 'in-review') {
      return 'finalized-awaiting-review';
    }
    return 'ambiguous';
  }
  if (facts.tempExists) {
    const expected = state?.bytes ?? null;
    if (state?.phase === 'downloading' || (expected !== null && facts.tempBytes < expected)) {
      return 'incomplete-temp';
    }
    if (state?.phase === 'downloaded' || state?.phase === 'validated' || state?.phase === 'finalizing') {
      return 'downloaded-not-finalized';
    }
    return 'ambiguous';
  }
  if (!state) return 'no-media';
  if (state.phase === 'idle' || state.phase === 'failed') return 'no-media';
  return 'ambiguous';
};

/** Removes a task-owned temporary file and its state, never a published output. */
export const discardIncompleteRetrieval = (input: {
  boundary: WriteBoundary;
  project: LoadedProject;
  jobId: string;
}): boolean => {
  const state = readRetrievalState(input.project, input.jobId);
  let removed = false;
  if (state?.tempPath) {
    const temp = path.resolve(input.project.projectDir, state.tempPath);
    if (isInside(input.boundary.cacheRoot, temp) && existsSync(temp)) {
      rmSync(temp, {force: true});
      removed = true;
    }
  }
  const statePath = path.resolve(input.project.projectDir, retrievalStatePath(input.jobId));
  if (existsSync(statePath) && isInside(input.project.projectDir, statePath)) {
    unlinkSync(statePath);
    removed = true;
  }
  return removed;
};
