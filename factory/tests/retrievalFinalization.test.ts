import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type {LoadedProject} from '../src/config/types';
import {createWriteBoundary} from '../src/workspace/writeBoundary';
import {
  FinalizationError,
  classifyRecovery,
  discardIncompleteRetrieval,
  finalizeDownloadedFile,
  readRetrievalState,
  writeRetrievalState,
} from '../src/generation/finalization';
import type {RetrievalState} from '../src/generation/types';
import {REPO_ROOT} from './helpers';

const sha = (buffer: Buffer): string => createHash('sha256').update(buffer).digest('hex');

const setup = () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'mv-finalize-'));
  mkdirSync(path.join(dir, 'cache', 'retrieval', 'GEN-1'), {recursive: true});
  mkdirSync(path.join(dir, 'generation', 'outputs', 'GEN-1'), {recursive: true});
  const boundary = createWriteBoundary({projectDir: dir, engineRoot: REPO_ROOT});
  const project = {projectDir: dir, config: {projectId: 'finalize-demo'}} as unknown as LoadedProject;
  return {dir, boundary, project};
};

const writeTemp = (dir: string, bytes: Buffer): string => {
  const file = path.join(dir, 'cache', 'retrieval', 'GEN-1', 'out.mp4.part');
  writeFileSync(file, bytes);
  return file;
};

const mp4 = (size = 4096): Buffer => {
  const buffer = Buffer.alloc(size);
  buffer.write('ftyp', 4, 'ascii');
  return buffer;
};

test('G07: a validated download is published by rename with a verified hash', () => {
  const {dir, boundary} = setup();
  const bytes = mp4();
  const temp = writeTemp(dir, bytes);
  const result = finalizeDownloadedFile({
    boundary,
    jobId: 'GEN-1',
    providerTaskId: 'task-1',
    tempPath: temp,
    targetRelativePath: 'generation/outputs/GEN-1/GEN-1-provider.mp4',
    expectedSha256: sha(bytes),
    expectedBytes: bytes.length,
  });
  assert.equal(result.strategy, 'rename');
  assert.equal(result.idempotent, false);
  assert.equal(statSync(result.absolutePath).size, bytes.length);
  assert.equal(sha(readFileSync(result.absolutePath)), sha(bytes));
  assert.equal(existsSync(temp), false, 'the temporary file is consumed by the rename');
});

test('G07: re-publishing identical bytes is idempotent', () => {
  const {dir, boundary} = setup();
  const bytes = mp4();
  const options = {
    boundary,
    jobId: 'GEN-1',
    providerTaskId: 'task-1',
    targetRelativePath: 'generation/outputs/GEN-1/GEN-1-provider.mp4',
    expectedSha256: sha(bytes),
    expectedBytes: bytes.length,
  };
  finalizeDownloadedFile({...options, tempPath: writeTemp(dir, bytes)});
  const second = finalizeDownloadedFile({...options, tempPath: writeTemp(dir, bytes)});
  assert.equal(second.idempotent, true);
});

test('G07: a different finalized file is never overwritten without an explicit decision', () => {
  const {dir, boundary} = setup();
  const first = mp4(2048);
  const second = mp4(4096);
  const target = 'generation/outputs/GEN-1/GEN-1-provider.mp4';
  finalizeDownloadedFile({
    boundary,
    jobId: 'GEN-1',
    providerTaskId: 'task-1',
    tempPath: writeTemp(dir, first),
    targetRelativePath: target,
    expectedSha256: sha(first),
    expectedBytes: first.length,
  });
  assert.throws(
    () =>
      finalizeDownloadedFile({
        boundary,
        jobId: 'GEN-1',
        providerTaskId: 'task-1',
        tempPath: writeTemp(dir, second),
        targetRelativePath: target,
        expectedSha256: sha(second),
        expectedBytes: second.length,
      }),
    (error: unknown) => error instanceof FinalizationError && error.code === 'destination-exists',
  );
  assert.equal(sha(readFileSync(path.join(dir, target))), sha(first), 'the previous file is intact');

  const replaced = finalizeDownloadedFile({
    boundary,
    jobId: 'GEN-1',
    providerTaskId: 'task-1',
    tempPath: writeTemp(dir, second),
    targetRelativePath: target,
    expectedSha256: sha(second),
    expectedBytes: second.length,
    overwriteFinalized: true,
  });
  assert.equal(replaced.replacedPrevious, true);
  assert.equal(sha(readFileSync(path.join(dir, target))), sha(second));
});

test('G07: an incomplete or mismatched temporary file is refused and nothing is published', () => {
  const {dir, boundary} = setup();
  const bytes = mp4();
  const target = 'generation/outputs/GEN-1/GEN-1-provider.mp4';
  assert.throws(
    () =>
      finalizeDownloadedFile({
        boundary,
        jobId: 'GEN-1',
        providerTaskId: 'task-1',
        tempPath: writeTemp(dir, bytes.subarray(0, 100)),
        targetRelativePath: target,
        expectedSha256: sha(bytes),
        expectedBytes: bytes.length,
      }),
    (error: unknown) => error instanceof FinalizationError && error.code === 'temp-incomplete',
  );
  assert.throws(
    () =>
      finalizeDownloadedFile({
        boundary,
        jobId: 'GEN-1',
        providerTaskId: 'task-1',
        tempPath: writeTemp(dir, mp4(2048)),
        targetRelativePath: target,
        expectedSha256: sha(bytes),
        expectedBytes: 2048,
      }),
    (error: unknown) => error instanceof FinalizationError && error.code === 'hash-mismatch',
  );
  assert.equal(existsSync(path.join(dir, target)), false);
});

test('G07: a destination outside the project is refused', () => {
  const {dir, boundary} = setup();
  const bytes = mp4();
  assert.throws(
    () =>
      finalizeDownloadedFile({
        boundary,
        jobId: 'GEN-1',
        providerTaskId: 'task-1',
        tempPath: writeTemp(dir, bytes),
        targetRelativePath: '../elsewhere/out.mp4',
        expectedSha256: sha(bytes),
        expectedBytes: bytes.length,
      }),
    /outside|escapes/i,
  );
});

test('G08: recovery distinguishes every on-disk state', () => {
  const base: RetrievalState = {
    schemaVersion: 1,
    jobId: 'GEN-1',
    providerTaskId: 'task-1',
    phase: 'downloaded',
    tempPath: 'cache/retrieval/GEN-1/out.mp4.part',
    targetPath: 'generation/outputs/GEN-1/GEN-1-provider.mp4',
    sha256: 'a'.repeat(64),
    bytes: 4096,
    message: null,
    updatedAt: '2026-11-05T00:00:00.000Z',
  };
  const classify = (overrides: Partial<Parameters<typeof classifyRecovery>[0]>) =>
    classifyRecovery({
      state: base,
      tempExists: false,
      tempBytes: 0,
      targetExists: false,
      targetSha256: null,
      manifestExists: false,
      intakeReview: null,
      ...overrides,
    });

  assert.equal(classify({state: null}), 'no-media');
  assert.equal(classify({state: {...base, phase: 'idle'}}), 'no-media');
  assert.equal(classify({tempExists: true, tempBytes: 1024}), 'incomplete-temp');
  assert.equal(classify({state: {...base, phase: 'downloading'}, tempExists: true, tempBytes: 4096}), 'incomplete-temp');
  assert.equal(classify({tempExists: true, tempBytes: 4096}), 'downloaded-not-finalized');
  assert.equal(classify({targetExists: true, targetSha256: base.sha256}), 'finalized-not-manifested');
  assert.equal(
    classify({targetExists: true, targetSha256: base.sha256, manifestExists: true, intakeReview: 'pending'}),
    'finalized-awaiting-review',
  );
  assert.equal(
    classify({targetExists: true, targetSha256: base.sha256, manifestExists: true, intakeReview: 'approved'}),
    'approved',
  );
  assert.equal(classify({targetExists: true, targetSha256: 'b'.repeat(64)}), 'ambiguous');
  assert.equal(
    classify({state: {...base, phase: 'manifested'}, targetExists: false, tempExists: false}),
    'ambiguous',
  );
});

test('G08: the retrieval state file round-trips through the write boundary', () => {
  const {boundary, project} = setup();
  const written = writeRetrievalState(boundary, {
    jobId: 'GEN-1',
    providerTaskId: 'task-1',
    phase: 'validated',
    tempPath: 'cache/retrieval/GEN-1/out.mp4.part',
    targetPath: 'generation/outputs/GEN-1/GEN-1-provider.mp4',
    sha256: 'c'.repeat(64),
    bytes: 4096,
    message: null,
  });
  assert.equal(written.phase, 'validated');
  const read = readRetrievalState(project, 'GEN-1');
  assert.equal(read?.sha256, 'c'.repeat(64));
  assert.equal(read?.bytes, 4096);
});

test('G08: discarding an interrupted retrieval removes the temp file but never a published output', () => {
  const {dir, boundary, project} = setup();
  const bytes = mp4();
  const temp = writeTemp(dir, bytes);
  writeRetrievalState(boundary, {
    jobId: 'GEN-1',
    providerTaskId: 'task-1',
    phase: 'downloaded',
    tempPath: 'cache/retrieval/GEN-1/out.mp4.part',
    targetPath: 'generation/outputs/GEN-1/GEN-1-provider.mp4',
    sha256: sha(bytes),
    bytes: bytes.length,
    message: null,
  });
  const published = path.join(dir, 'generation', 'outputs', 'GEN-1', 'GEN-1-provider.mp4');
  writeFileSync(published, bytes);

  const removed = discardIncompleteRetrieval({boundary, project, jobId: 'GEN-1'});
  assert.equal(removed, true);
  assert.equal(existsSync(temp), false);
  assert.equal(existsSync(published), true, 'a published output is never removed by cleanup');
  assert.equal(readRetrievalState(project, 'GEN-1'), null);
});
