import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync, existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type {LoadedProject} from '../src/config/types';
import type {GenerationJob} from '../src/generation/types';
import {
  LEDGER_PATHS,
  LedgerError,
  acquireLedgerLock,
  markSubmitted,
  readLedger,
  reconcileLedgerEntry,
  reserveBudget,
  setProjectCeiling,
  summarizeLedger,
  unlockLedger,
} from '../src/generation/ledger';

const NOW = new Date('2026-11-05T00:00:00.000Z');

const makeProject = (): LoadedProject => {
  const dir = mkdtempSync(path.join(tmpdir(), 'mv-ledger-'));
  mkdirSync(path.join(dir, 'generation'), {recursive: true});
  return {projectDir: dir, config: {projectId: 'ledger-demo'}} as unknown as LoadedProject;
};

const makeJob = (jobId: string, overrides: Partial<GenerationJob> = {}): GenerationJob =>
  ({
    jobId,
    projectId: 'ledger-demo',
    provider: 'runway',
    model: 'gen4_turbo',
    operation: 'image-to-video',
    output: {
      kind: 'video',
      width: 640,
      height: 360,
      aspectRatio: '16:9',
      durationFrames: 120,
      fps: 24,
      frameCount: 120,
      seed: null,
    },
    inputAssets: [],
    ...overrides,
  }) as unknown as GenerationJob;

const estimate = (usd: number) => ({
  estimatedUsd: usd,
  estimatedCredits: Math.round(usd * 100),
  pricingVersion: 'runway-2026-11-01',
  snapshotSha256: 'b'.repeat(64),
});

const authorization = (maxUsd: number) => ({
  authorizedMaxUsd: maxUsd,
  authorizedMaxCredits: null,
  authorizationRevision: 1,
});

const expectLedgerError = async (promise: Promise<unknown>, code: string): Promise<void> => {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof LedgerError, `expected LedgerError, got ${String(error)}`);
    assert.equal(error.code, code);
    return true;
  });
};

test('G14: a reservation records the estimate, the ceiling and the pricing provenance', async () => {
  const project = makeProject();
  const result = await reserveBudget({
    project,
    job: makeJob('GEN-1'),
    estimate: estimate(0.25),
    authorization: authorization(1),
    now: NOW,
  });
  assert.equal(result.entry.status, 'reserved');
  assert.equal(result.entry.reservedUsd, 0.25);
  assert.equal(result.entry.actualUsd, null);
  assert.equal(result.entry.actualClassification, 'unknown');
  assert.match(result.entry.provenance, /pricing snapshot/);
  assert.equal(result.summary.reservedUsd, 0.25);
  assert.equal(result.summary.remainingUsd, null, 'no project ceiling means no derived remainder');
});

test('G14: the project ceiling limits the remaining budget', async () => {
  const project = makeProject();
  await setProjectCeiling({project, ceilingUsd: 1, note: 'pilot ceiling'});
  const first = await reserveBudget({
    project,
    job: makeJob('GEN-1'),
    estimate: estimate(0.25),
    authorization: authorization(1),
  });
  assert.equal(first.summary.remainingUsd, 0.75);
  const second = await reserveBudget({
    project,
    job: makeJob('GEN-2'),
    estimate: estimate(0.5),
    authorization: authorization(1),
  });
  assert.equal(second.summary.remainingUsd, 0.25);
  await expectLedgerError(
    reserveBudget({
      project,
      job: makeJob('GEN-3'),
      estimate: estimate(0.5),
      authorization: authorization(1),
    }),
    'budget-exceeded',
  );
});

test('G13: a per-job ceiling is enforced independently of the project budget', async () => {
  const project = makeProject();
  await setProjectCeiling({project, ceilingUsd: 100, note: 'generous'});
  await expectLedgerError(
    reserveBudget({
      project,
      job: makeJob('GEN-1'),
      estimate: estimate(0.5),
      authorization: authorization(0.2),
    }),
    'job-ceiling-exceeded',
  );
});

test('G15: a job cannot reserve twice while its reservation is open', async () => {
  const project = makeProject();
  await reserveBudget({project, job: makeJob('GEN-1'), estimate: estimate(0.25), authorization: authorization(1)});
  await expectLedgerError(
    reserveBudget({project, job: makeJob('GEN-1'), estimate: estimate(0.25), authorization: authorization(1)}),
    'already-reserved',
  );
});

test('G16: an uncertain submission keeps its reservation open', async () => {
  const project = makeProject();
  await setProjectCeiling({project, ceilingUsd: 1, note: 'pilot'});
  await reserveBudget({project, job: makeJob('GEN-1'), estimate: estimate(0.25), authorization: authorization(1)});
  await reconcileLedgerEntry({
    project,
    jobId: 'GEN-1',
    status: 'reconciled-unknown',
    note: 'task outcome unknown after a transport timeout',
  });
  const summary = summarizeLedger(readLedger(project));
  assert.equal(summary.reservedUsd, 0.25, 'the reservation is still exposed');
  assert.equal(summary.remainingUsd, 0.75);
  assert.deepEqual(summary.uncertainEntries, ['GEN-1']);
  assert.equal(summary.actualUnknownCount, 1);
});

test('G16: a known charge releases the reservation and records the actual', async () => {
  const project = makeProject();
  await setProjectCeiling({project, ceilingUsd: 1, note: 'pilot'});
  await reserveBudget({project, job: makeJob('GEN-1'), estimate: estimate(0.25), authorization: authorization(1)});
  const entry = await reconcileLedgerEntry({
    project,
    jobId: 'GEN-1',
    status: 'reconciled-known',
    actualUsd: 0.2,
    actualClassification: 'user-entered',
    note: 'operator read the provider console',
  });
  assert.equal(entry.actualUsd, 0.2);
  assert.equal(entry.actualClassification, 'user-entered');
  const summary = summarizeLedger(readLedger(project));
  assert.equal(summary.reservedUsd, 0);
  assert.equal(summary.actualKnownUsd, 0.2);
  assert.equal(summary.remainingUsd, 0.8);
});

test('G16: cancellation releases the reservation without fabricating a refund', async () => {
  const project = makeProject();
  await reserveBudget({project, job: makeJob('GEN-1'), estimate: estimate(0.25), authorization: authorization(1)});
  const entry = await reconcileLedgerEntry({
    project,
    jobId: 'GEN-1',
    status: 'canceled',
    note: 'provider reported cancellation; billing state is unknown',
  });
  assert.equal(entry.status, 'canceled');
  assert.equal(entry.actualUsd, null, 'no charge is invented');
  assert.equal(entry.actualClassification, 'unknown');
  assert.equal(entry.releasedUsd, 0.25);
  const summary = summarizeLedger(readLedger(project));
  assert.equal(summary.reservedUsd, 0);
  assert.equal(summary.actualUnknownCount, 0);
});

test('G17: the submission counter refuses a second submission beyond the authorization', async () => {
  const project = makeProject();
  await reserveBudget({project, job: makeJob('GEN-1'), estimate: estimate(0.25), authorization: authorization(1)});
  const submitted = await markSubmitted({project, jobId: 'GEN-1', providerTaskId: 'task-1', maxSubmissions: 1});
  assert.equal(submitted.status, 'submitted');
  assert.equal(submitted.submissionCount, 1);
  await expectLedgerError(
    markSubmitted({project, jobId: 'GEN-1', providerTaskId: 'task-1', maxSubmissions: 1}),
    'submission-limit',
  );
});

test('G17: a ledger entry cannot be rebound to a different provider task', async () => {
  const project = makeProject();
  await reserveBudget({project, job: makeJob('GEN-1'), estimate: estimate(0.25), authorization: authorization(1)});
  await markSubmitted({project, jobId: 'GEN-1', providerTaskId: 'task-1', maxSubmissions: 3});
  await expectLedgerError(
    markSubmitted({project, jobId: 'GEN-1', providerTaskId: 'task-2', maxSubmissions: 3}),
    'invalid-transition',
  );
});

test('G15: a stale lock is refused instead of being deleted', async () => {
  const project = makeProject();
  const lockPath = path.join(project.projectDir, LEDGER_PATHS.lock);
  writeFileSync(lockPath, JSON.stringify({pid: 999999, nonce: 'other', at: NOW.toISOString()}));
  const old = new Date(Date.now() - 10 * 60 * 1000);
  utimesSync(lockPath, old, old);
  await expectLedgerError(acquireLedgerLock(project, {staleMs: 1_000}), 'lock-stale');
  assert.equal(existsSync(lockPath), true, 'the stale lock must survive until an operator removes it');
});

test('G15: an explicit operator unlock removes the lock and records the intervention', async () => {
  const project = makeProject();
  const lockPath = path.join(project.projectDir, LEDGER_PATHS.lock);
  writeFileSync(lockPath, JSON.stringify({pid: 999999, nonce: 'other', at: NOW.toISOString()}));
  const result = unlockLedger(project, 'confirmed no other process is running');
  assert.equal(result.removed, true);
  assert.equal(existsSync(lockPath), false);
  const document = readLedger(project);
  assert.equal(document.interventions?.length, 1);
  assert.equal(document.interventions?.[0].action, 'ledger-unlock');
});

test('G15: the lock is released after a reservation so later work can proceed', async () => {
  const project = makeProject();
  await reserveBudget({project, job: makeJob('GEN-1'), estimate: estimate(0.25), authorization: authorization(1)});
  assert.equal(existsSync(path.join(project.projectDir, LEDGER_PATHS.lock)), false);
  await reserveBudget({project, job: makeJob('GEN-2'), estimate: estimate(0.25), authorization: authorization(1)});
});

const runChild = (args: string[]): Promise<{code: number; payload: any}> =>
  new Promise((resolve) => {
    const child = spawn(process.execPath, [path.resolve(__dirname, 'support', 'reserveChild.js'), ...args], {
      windowsHide: true,
    });
    let stdout = '';
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.on('close', (code) => {
      let payload: any = null;
      try {
        payload = JSON.parse(stdout.trim().split('\n').pop() ?? 'null');
      } catch {
        payload = null;
      }
      resolve({code: code ?? 1, payload});
    });
  });

test('G15: two independent processes cannot both reserve the last of the budget', async () => {
  const project = makeProject();
  await setProjectCeiling({project, ceilingUsd: 0.3, note: 'one submission only'});
  const startAt = Date.now() + 400;
  const args = (jobId: string) => [project.projectDir, 'ledger-demo', jobId, '1', String(startAt)];
  const [first, second] = await Promise.all([runChild(args('GEN-A')), runChild(args('GEN-B'))]);
  const results = [first, second];
  const successes = results.filter((entry) => entry.code === 0 && entry.payload?.ok === true);
  const failures = results.filter((entry) => entry.code !== 0);
  assert.equal(successes.length, 1, `exactly one reservation must succeed: ${JSON.stringify(results)}`);
  assert.equal(failures.length, 1);
  assert.equal(failures[0].payload?.code, 'budget-exceeded');

  const document = readLedger(project);
  assert.equal(document.entries.length, 1, 'no double reservation and no lost update');
  const summary = summarizeLedger(document);
  assert.equal(summary.reservedUsd, 0.25);
  assert.ok((summary.remainingUsd ?? -1) >= 0, 'the balance must never go negative');
  assert.equal(summary.remainingUsd, 0.05);
});

test('G15: a crashed reservation attempt leaves the ledger consistent', async () => {
  const project = makeProject();
  await setProjectCeiling({project, ceilingUsd: 1, note: 'pilot'});
  // Simulate a crash mid-reservation: a lock file without a completed write.
  const lockPath = path.join(project.projectDir, LEDGER_PATHS.lock);
  writeFileSync(lockPath, JSON.stringify({pid: 4242, nonce: 'crashed', at: new Date().toISOString()}));
  const old = new Date(Date.now() - 10 * 60 * 1000);
  utimesSync(lockPath, old, old);

  await expectLedgerError(
    reserveBudget({project, job: makeJob('GEN-1'), estimate: estimate(0.25), authorization: authorization(1)}),
    'lock-stale',
  );
  const document = readLedger(project);
  assert.equal(document.entries.length, 0, 'a failed reservation writes nothing');

  unlockLedger(project, 'crashed process confirmed gone');
  const recovered = await reserveBudget({
    project,
    job: makeJob('GEN-1'),
    estimate: estimate(0.25),
    authorization: authorization(1),
  });
  assert.equal(recovered.entry.status, 'reserved');
  assert.equal(recovered.summary.remainingUsd, 0.75);
  const raw = JSON.parse(readFileSync(path.join(project.projectDir, LEDGER_PATHS.ledger), 'utf8'));
  assert.equal(raw.entries.length, 1);
});
