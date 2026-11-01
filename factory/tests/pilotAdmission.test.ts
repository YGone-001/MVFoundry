import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, readFileSync, realpathSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  PILOT_ADMISSION_SCHEMA_VERSION,
  PilotAdmissionError,
  bindAdmissionTask,
  consumePilotAdmission,
  evaluatePilotAdmission,
  markAdmissionUncertain,
  parsePilotAdmissionDocument,
  pilotSubmissionKey,
  proposePilotAdmission,
  readPilotAdmissions,
  releaseUnownedAdmission,
  reviewPilotAdmission,
  revokePilotAdmission,
  type PilotAdmission,
  type PilotAdmissionDocument,
  type PilotEvaluationInput,
} from '../src/generation/pilotAdmission';
import type {WriteBoundary} from '../src/workspace/writeBoundary';
import {submissionFailureTransmitted} from '../src/generation/submission';
import {TransportError} from '../src/generation/transport';
import {RUNWAY_PRICING_SNAPSHOT, estimateGenerationCost} from '../src/generation/pricing';
import type {GenerationJob, LedgerDocument} from '../src/generation/types';
import {REPO_ROOT} from './helpers';

const PROJECT_ID = 'pilot-unit-demo';
const JOB_ID = 'GEN-abc12345-1';
const FINGERPRINT = 'SHOT-001|video|video|bg|48|16:9|a synthetic shot';

const makeBoundary = (): {boundary: WriteBoundary; projectDir: string} => {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'mv-pilot-')));
  mkdirSync(path.join(dir, 'generation'), {recursive: true});
  return {
    projectDir: dir,
    boundary: {
      projectRoot: dir,
      cacheRoot: path.join(dir, 'cache'),
      rendersRoot: path.join(dir, 'renders'),
      engineRoot: REPO_ROOT,
      sourcePaths: [],
    },
  };
};

const makeAdmission = (overrides: Partial<PilotAdmission> = {}): PilotAdmission => ({
  schemaVersion: PILOT_ADMISSION_SCHEMA_VERSION,
  admissionRevision: 1,
  pilotId: 'pilot-unit-01',
  projectId: PROJECT_ID,
  jobId: JOB_ID,
  requirementId: 'REQ-001',
  requirementFingerprint: FINGERPRINT,
  storyboardRevision: 1,
  provider: 'runway',
  model: 'gen4_turbo',
  operation: 'image-to-video',
  output: {
    kind: 'video',
    width: 640,
    height: 360,
    aspectRatio: '16:9',
    durationFrames: 48,
    fps: 24,
    seed: null,
  },
  pricing: {
    pricingVersion: RUNWAY_PRICING_SNAPSHOT.pricingVersion,
    snapshotSha256: RUNWAY_PRICING_SNAPSHOT.snapshotSha256,
  },
  maxEstimatedCostUsd: 0.3,
  authorizedSpendCeilingUsd: 1,
  maxSubmissions: 1,
  references: [],
  approvalState: 'approved',
  approval: {reviewedAt: '2026-11-01T00:00:00.000Z', notes: 'reviewed'},
  createdAt: '2026-11-01T00:00:00.000Z',
  expiresAt: '2027-11-01T00:00:00.000Z',
  consumption: {state: 'unconsumed', submissionKey: null, consumedAt: null, providerTaskId: null, note: null},
  operatorNotes: '',
  ...overrides,
});

const makeDocument = (admissions: PilotAdmission[]): PilotAdmissionDocument => ({
  schemaVersion: PILOT_ADMISSION_SCHEMA_VERSION,
  projectId: PROJECT_ID,
  revision: 1,
  admissions,
});

const makeJob = (overrides: Record<string, unknown> = {}): GenerationJob =>
  ({
    schemaVersion: 1,
    jobId: JOB_ID,
    projectId: PROJECT_ID,
    requirementId: 'REQ-001',
    storyboardRevision: 1,
    requirementFingerprint: FINGERPRINT,
    shotIds: ['SHOT-001'],
    provider: 'runway',
    operation: 'image-to-video',
    model: 'gen4_turbo',
    requestRevision: 1,
    prompt: {
      version: 'prompt-v1',
      structured: {
        depict: '',
        references: [],
        movement: '',
        mustNotChange: [],
        durationAndAspect: '',
        excluded: [],
        supportedCapabilities: [],
        advisoryOnly: [],
      },
      draft: 'a synthetic shot',
      continuityIds: [],
      continuityRevisions: {},
      includesLyrics: false,
      includesAudio: false,
      includesPrivatePaths: false,
    },
    output: {
      kind: 'video',
      width: 640,
      height: 360,
      aspectRatio: '16:9',
      durationFrames: 48,
      fps: 24,
      frameCount: 48,
      seed: null,
    },
    continuityIds: [],
    inputAssets: [],
    permission: {state: 'authorized', recordPath: null},
    execution: {state: 'awaiting-authorization', providerTaskId: null, attempts: 0, failure: null, lastTransition: ''},
    result: {files: [], manifestPath: null, inspectedAt: null},
    review: {state: 'awaiting-review', notes: null, assetId: null},
    ...overrides,
  }) as unknown as GenerationJob;

const emptyLedger = (): LedgerDocument => ({
  schemaVersion: 1,
  projectId: PROJECT_ID,
  revision: 1,
  entries: [
    {
      entryId: 'LED-1',
      projectId: PROJECT_ID,
      jobId: JOB_ID,
      provider: 'runway',
      model: 'gen4_turbo',
      operation: 'image-to-video',
      authorizationRevision: 1,
      authorizedMaxUsd: 1,
      authorizedMaxCredits: null,
      estimatedUsd: 0.25,
      estimatedCredits: 25,
      reservedUsd: 0.25,
      actualUsd: null,
      actualClassification: 'unknown',
      releasedUsd: 0,
      submissionCount: 0,
      providerTaskId: null,
      status: 'reserved',
      pricingVersion: RUNWAY_PRICING_SNAPSHOT.pricingVersion,
      createdAt: '2026-11-01T00:00:00.000Z',
      updatedAt: '2026-11-01T00:00:00.000Z',
      provenance: 'unit',
      notes: [],
    },
  ],
  projectCeilingUsd: 1,
});

const evaluationInput = (overrides: Partial<PilotEvaluationInput> = {}): PilotEvaluationInput => {
  const job = makeJob();
  const estimate = estimateGenerationCost({
    snapshot: RUNWAY_PRICING_SNAPSHOT,
    model: job.model,
    operation: job.operation,
    outputLongEdge: 640,
    billableSeconds: 5,
    referenceCount: 0,
    now: new Date('2026-11-02T00:00:00.000Z'),
  });
  return {
    projectId: PROJECT_ID,
    job,
    requirement: {id: 'REQ-001', fingerprint: FINGERPRINT} as never,
    storyboard: {revision: 1, status: 'approved', renderReady: false},
    admission: makeAdmission(),
    estimate,
    pricing: RUNWAY_PRICING_SNAPSHOT,
    ledger: emptyLedger(),
    permissionRecord: {
      jobId: JOB_ID,
      provider: 'runway',
      model: 'gen4_turbo',
      operation: 'image-to-video',
      maxSpendUsd: 1,
      maxSubmissions: 1,
      authorization: 'authorized-for-simulation',
      uploadsPrivateAssets: false,
      inputAssetIds: [],
      authorizationRevision: 1,
    },
    references: [],
    credentialsPresent: true,
    transport: {ready: true, reason: 'closed gate'},
    now: new Date('2026-11-02T00:00:00.000Z'),
    ...overrides,
  };
};

test('a reviewed admission bound to the exact job is ADMITTED_FOR_PILOT', () => {
  const evaluation = evaluatePilotAdmission(evaluationInput());
  assert.equal(evaluation.status, 'ADMITTED_FOR_PILOT');
  assert.equal(evaluation.refusalCode, null);
  assert.equal(evaluation.blockers.length, 0);
  assert.ok(evaluation.checks.every((check) => check.ok));
});

test('no admission is DENIED_P0, and an unreviewed one is PENDING', () => {
  assert.equal(evaluatePilotAdmission(evaluationInput({admission: null})).status, 'DENIED_P0');
  const pending = evaluatePilotAdmission(
    evaluationInput({admission: makeAdmission({approvalState: 'proposed', approval: {reviewedAt: null, notes: ''}})}),
  );
  assert.equal(pending.status, 'PENDING');
  assert.equal(pending.refusalCode, 'admission-incomplete');
});

test('the admission is invalidated by job, model, fingerprint, storyboard, output and reference changes', () => {
  const cases: Array<[Partial<PilotEvaluationInput>, string]> = [
    [{job: makeJob({jobId: 'GEN-ffffffff-1'})}, 'job-mismatch'],
    [{job: makeJob({model: 'gen4_image'})}, 'model-mismatch'],
    [{job: makeJob({provider: 'offline-fixture'})}, 'provider-mismatch'],
    [{storyboard: {revision: 2, status: 'approved', renderReady: false}}, 'storyboard-changed'],
    [{storyboard: {revision: 1, status: 'draft', renderReady: false}}, 'storyboard-changed'],
    [{requirement: {id: 'REQ-001', fingerprint: 'changed'} as never}, 'fingerprint-changed'],
    [{job: makeJob({inputAssets: [{assetId: 'REF-FRAME', role: 'reference', sha256: 'a'.repeat(64)}]})}, 'reference-changed'],
  ];
  for (const [overrides, code] of cases) {
    const evaluation = evaluatePilotAdmission(evaluationInput(overrides));
    assert.equal(evaluation.status, 'REFUSED', `expected REFUSED for ${code}`);
    assert.equal(evaluation.refusalCode, code);
  }
});

test('expiry, revocation and consumption are refused and never auto-renewed', () => {
  const expired = evaluatePilotAdmission(
    evaluationInput({admission: makeAdmission({expiresAt: '2026-11-01T00:00:00.000Z'})}),
  );
  assert.equal(expired.refusalCode, 'admission-expired');
  assert.equal(expired.expired, true);

  const revoked = evaluatePilotAdmission(
    evaluationInput({admission: makeAdmission({approvalState: 'revoked'})}),
  );
  assert.equal(revoked.refusalCode, 'admission-revoked');

  const consumed = evaluatePilotAdmission(
    evaluationInput({
      admission: makeAdmission({
        consumption: {state: 'consumed', submissionKey: 'abc', consumedAt: '2026-11-01T00:00:00.000Z', providerTaskId: null, note: null},
      }),
    }),
  );
  assert.equal(consumed.refusalCode, 'admission-consumed');

  const uncertain = evaluatePilotAdmission(
    evaluationInput({
      admission: makeAdmission({
        consumption: {state: 'uncertain', submissionKey: 'abc', consumedAt: '2026-11-01T00:00:00.000Z', providerTaskId: null, note: null},
      }),
    }),
  );
  assert.equal(uncertain.refusalCode, 'admission-uncertain');
});

test('budget, credentials, transport and submission state are separate blockers', () => {
  const noReservation = evaluatePilotAdmission(evaluationInput({ledger: {...emptyLedger(), entries: []}}));
  assert.equal(noReservation.status, 'REFUSED');
  assert.equal(noReservation.budget.openReservation, false);

  const noCredentials = evaluatePilotAdmission(evaluationInput({credentialsPresent: false}));
  assert.ok(noCredentials.checks.some((check) => check.id === 'credentials' && !check.ok));

  const bound = evaluatePilotAdmission(
    evaluationInput({
      job: makeJob({execution: {state: 'submitted', providerTaskId: 'task-1', attempts: 1, failure: null, lastTransition: ''}}),
    }),
  );
  assert.equal(bound.refusalCode, 'admission-consumed');

  const overBudget = evaluatePilotAdmission(evaluationInput({admission: makeAdmission({maxEstimatedCostUsd: 0.01})}));
  assert.equal(overBudget.refusalCode, 'cost-exceeds-admission');
});

test('the document parser rejects forbidden fields, wrong ceilings and cross-project records', () => {
  const base = makeAdmission();
  assert.throws(
    () => parsePilotAdmissionDocument({...makeDocument([{...base, apiKey: 'x'} as never])}, PROJECT_ID),
    /not allowed/,
  );
  assert.throws(
    () => parsePilotAdmissionDocument({...makeDocument([{...base, operatorNotes: 'C:\\Users\\someone\\file.png'}])}, PROJECT_ID),
    /private path/,
  );
  assert.throws(
    () =>
      parsePilotAdmissionDocument(
        {...makeDocument([{...base, operatorNotes: `${'https'}://example.invalid/x?Signature=abc`}])},
        PROJECT_ID,
      ),
    /signed URL|private path/,
  );
  assert.throws(
    () => parsePilotAdmissionDocument({...makeDocument([{...base, maxSubmissions: 2}])}, PROJECT_ID),
    /exactly 1/,
  );
  assert.throws(
    () => parsePilotAdmissionDocument({...makeDocument([base]), projectId: 'other-project'}, PROJECT_ID),
    /declares other-project|cross-project/,
  );
  assert.throws(
    () => parsePilotAdmissionDocument({...makeDocument([base, base])}, PROJECT_ID),
    /duplicate pilotId/,
  );
  assert.throws(
    () =>
      parsePilotAdmissionDocument(
        {
          ...makeDocument([
            {
              ...base,
              references: [
                {assetId: 'REF-A', sha256: 'a'.repeat(64), uploadAuthorized: true},
                {assetId: 'REF-A', sha256: 'b'.repeat(64), uploadAuthorized: true},
              ],
            },
          ]),
        },
        PROJECT_ID,
      ),
    /duplicate asset/,
  );
  assert.throws(() => parsePilotAdmissionDocument({...makeDocument([base]), schemaVersion: 9}, PROJECT_ID), /schemaVersion/);
});

test('a pilot id is single-use and a review needs recorded notes', () => {
  const {boundary, projectDir} = makeBoundary();
  const document = makeDocument([]);
  const proposed = proposePilotAdmission({
    boundary,
    document,
    admission: makeAdmission({approvalState: 'proposed', approval: {reviewedAt: null, notes: ''}}),
  });
  assert.equal(proposed.admissions.length, 1);
  assert.throws(
    () =>
      proposePilotAdmission({
        boundary,
        document: proposed,
        admission: makeAdmission({approvalState: 'proposed', approval: {reviewedAt: null, notes: ''}}),
      }),
    /already exists/,
  );
  assert.throws(
    () =>
      reviewPilotAdmission({
        boundary,
        document: proposed,
        pilotId: 'pilot-unit-01',
        decision: 'approve',
        notes: '',
        now: new Date('2026-11-02T00:00:00.000Z'),
      }),
    /recorded notes/,
  );
  const reviewed = reviewPilotAdmission({
    boundary,
    document: proposed,
    pilotId: 'pilot-unit-01',
    decision: 'approve',
    notes: 'reviewed',
    now: new Date('2026-11-02T00:00:00.000Z'),
  });
  assert.equal(reviewed.admissions[0].approvalState, 'approved');
  assert.throws(
    () =>
      reviewPilotAdmission({
        boundary,
        document: reviewed,
        pilotId: 'pilot-unit-01',
        decision: 'deny',
        notes: 'again',
        now: new Date('2026-11-02T00:00:00.000Z'),
      }),
    /already approved/,
  );
  const stored = readPilotAdmissions({
    projectDir,
    config: {projectId: PROJECT_ID},
  } as never);
  assert.equal(stored.admissions[0].approvalState, 'approved');
  assert.match(readFileSync(path.join(projectDir, 'generation', 'pilot-admission.json'), 'utf8'), /pilot-unit-01/);
});

test('revocation is forward-only and a consumed admission cannot be revoked', () => {
  const {boundary} = makeBoundary();
  const approved = makeDocument([makeAdmission()]);
  const revoked = revokePilotAdmission({
    boundary,
    document: approved,
    pilotId: 'pilot-unit-01',
    notes: 'operator revoked',
    now: new Date('2026-11-02T00:00:00.000Z'),
  });
  assert.equal(revoked.admissions[0].approvalState, 'revoked');
  assert.match(revoked.admissions[0].approval.notes, /revoked/);

  const consumed = makeDocument([
    makeAdmission({
      consumption: {state: 'consumed', submissionKey: 'abc', consumedAt: '2026-11-01T00:00:00.000Z', providerTaskId: null, note: null},
    }),
  ]);
  assert.throws(
    () =>
      revokePilotAdmission({
        boundary,
        document: consumed,
        pilotId: 'pilot-unit-01',
        notes: 'too late',
        now: new Date('2026-11-02T00:00:00.000Z'),
      }),
    /already consumed/,
  );
});

test('exactly one consumer obtains submission ownership', async () => {
  const {boundary, projectDir} = makeBoundary();
  writeFileSync(
    path.join(projectDir, 'generation', 'pilot-admission.json'),
    `${JSON.stringify(makeDocument([makeAdmission()]), null, 2)}\n`,
  );
  const project = {projectDir, config: {projectId: PROJECT_ID}} as never;
  const first = await consumePilotAdmission({
    project,
    boundary,
    pilotId: 'pilot-unit-01',
    jobId: JOB_ID,
    revalidate: () => [],
    now: new Date('2026-11-02T00:00:00.000Z'),
  });
  assert.equal(first.ok, true);
  assert.equal(typeof first.submissionKey, 'string');

  const second = await consumePilotAdmission({
    project,
    boundary,
    pilotId: 'pilot-unit-01',
    jobId: JOB_ID,
    revalidate: () => [],
    now: new Date('2026-11-02T00:00:00.000Z'),
  });
  assert.equal(second.ok, false);
  assert.equal(second.code, 'admission-already-consumed');
  assert.equal(second.admission, null);

  const stored = readPilotAdmissions(project);
  assert.equal(stored.admissions[0].consumption.state, 'consumed');
  assert.equal(stored.admissions[0].consumption.submissionKey, first.submissionKey);
});

test('consumption is refused for an expired admission or a failed revalidation', async () => {
  const {boundary, projectDir} = makeBoundary();
  writeFileSync(
    path.join(projectDir, 'generation', 'pilot-admission.json'),
    `${JSON.stringify(makeDocument([makeAdmission({expiresAt: '2026-10-01T00:00:00.000Z'})]), null, 2)}\n`,
  );
  const project = {projectDir, config: {projectId: PROJECT_ID}} as never;
  const expired = await consumePilotAdmission({
    project,
    boundary,
    pilotId: 'pilot-unit-01',
    jobId: JOB_ID,
    revalidate: () => [],
    now: new Date('2026-11-02T00:00:00.000Z'),
  });
  assert.equal(expired.ok, false);
  assert.equal(expired.code, 'admission-expired');

  writeFileSync(
    path.join(projectDir, 'generation', 'pilot-admission.json'),
    `${JSON.stringify(makeDocument([makeAdmission()]), null, 2)}\n`,
  );
  const invalidated = await consumePilotAdmission({
    project,
    boundary,
    pilotId: 'pilot-unit-01',
    jobId: JOB_ID,
    revalidate: () => ['the price snapshot changed'],
    now: new Date('2026-11-02T00:00:00.000Z'),
  });
  assert.equal(invalidated.ok, false);
  assert.equal(invalidated.code, 'revalidation-failed');
  assert.deepEqual(invalidated.blockers, ['the price snapshot changed']);
  assert.equal(readPilotAdmissions(project).admissions[0].consumption.state, 'unconsumed');
});

test('ownership can only be released before a connection, by its own holder', async () => {
  const {boundary, projectDir} = makeBoundary();
  writeFileSync(
    path.join(projectDir, 'generation', 'pilot-admission.json'),
    `${JSON.stringify(makeDocument([makeAdmission()]), null, 2)}\n`,
  );
  const project = {projectDir, config: {projectId: PROJECT_ID}} as never;
  const consumed = await consumePilotAdmission({
    project,
    boundary,
    pilotId: 'pilot-unit-01',
    jobId: JOB_ID,
    revalidate: () => [],
    now: new Date('2026-11-02T00:00:00.000Z'),
  });
  assert.equal(consumed.ok, true);

  assert.throws(
    () =>
      releaseUnownedAdmission({
        boundary,
        document: readPilotAdmissions(project),
        pilotId: 'pilot-unit-01',
        now: new Date('2026-11-02T00:00:01.000Z'),
        reason: 'attempted by another process',
        submissionKey: 'not-the-owner',
      }),
    /another submission key/,
  );

  const bound = bindAdmissionTask({
    boundary,
    document: readPilotAdmissions(project),
    pilotId: 'pilot-unit-01',
    now: new Date('2026-11-02T00:00:01.000Z'),
    providerTaskId: 'task-1',
  });
  assert.equal(bound.admissions[0].consumption.providerTaskId, 'task-1');
  assert.throws(
    () =>
      bindAdmissionTask({
        boundary,
        document: bound,
        pilotId: 'pilot-unit-01',
        now: new Date('2026-11-02T00:00:02.000Z'),
        providerTaskId: 'task-2',
      }),
    /refusing to rebind/,
  );

  const uncertain = markAdmissionUncertain({
    boundary,
    document: bound,
    pilotId: 'pilot-unit-01',
    now: new Date('2026-11-02T00:00:03.000Z'),
    note: 'the submission may have succeeded',
  });
  assert.equal(uncertain.admissions[0].consumption.state, 'uncertain');
  assert.equal(uncertain.admissions[0].consumption.providerTaskId, 'task-1');
  assert.throws(
    () =>
      releaseUnownedAdmission({
        boundary,
        document: uncertain,
        pilotId: 'pilot-unit-01',
        now: new Date('2026-11-02T00:00:04.000Z'),
        reason: 'should be impossible once the outcome is uncertain',
        submissionKey: consumed.submissionKey,
      }),
    /not consumed/,
  );
});

test('the submission key is deterministic for one attempt and unique across jobs', () => {  const base = {pilotId: 'pilot-unit-01', admissionRevision: 1, consumedAt: '2026-11-02T00:00:00.000Z'};
  assert.equal(pilotSubmissionKey({...base, jobId: JOB_ID}), pilotSubmissionKey({...base, jobId: JOB_ID}));
  assert.notEqual(pilotSubmissionKey({...base, jobId: JOB_ID}), pilotSubmissionKey({...base, jobId: 'GEN-other-1'}));
  assert.match(pilotSubmissionKey({...base, jobId: JOB_ID}), /^[a-f0-9]{32}$/);
});

test('a pre-connection refusal is distinguishable from an exposed submission', () => {
  assert.equal(submissionFailureTransmitted(new TransportError('host-not-allowed', 'x')), false);
  assert.equal(submissionFailureTransmitted(new TransportError('live-not-authorized', 'x')), false);
  assert.equal(submissionFailureTransmitted(new TransportError('blocked-address', 'x')), false);
  assert.equal(submissionFailureTransmitted(new TransportError('connect-timeout', 'x')), true);
  assert.equal(submissionFailureTransmitted(new TransportError('authentication-failed', 'x')), true);
  assert.equal(submissionFailureTransmitted(new Error('unknown')), true);
  assert.equal(submissionFailureTransmitted(Object.assign(new Error('x'), {transmitted: false})), false);
});

test('a malformed admission document is never treated as absent', () => {
  const {projectDir} = makeBoundary();
  mkdirSync(path.join(projectDir, 'generation'), {recursive: true});
  writeFileSync(path.join(projectDir, 'generation', 'pilot-admission.json'), '{"schemaVersion":1}');
  assert.throws(
    () => readPilotAdmissions({projectDir, config: {projectId: PROJECT_ID}} as never),
    PilotAdmissionError,
  );
});
