import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_PRICING_MAX_AGE_DAYS,
  RUNWAY_PRICING_SNAPSHOT,
  billableSecondsForJob,
  computeSnapshotHash,
  estimateGenerationCost,
  outputLongEdgeForJob,
  validatePricingSnapshot,
} from '../src/generation/pricing';
import type {GenerationJob, PricingSnapshot} from '../src/generation/types';

const NOW = new Date('2026-11-05T00:00:00.000Z');

const job = (overrides: Partial<GenerationJob> = {}): GenerationJob => ({
  schemaVersion: 1,
  jobId: 'GEN-1',
  projectId: 'p',
  requirementId: 'REQ-001',
  storyboardRevision: 1,
  requirementFingerprint: 'f',
  shotIds: ['SHOT-001'],
  provider: 'runway',
  operation: 'text-to-image',
  model: 'gen4_image',
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
    draft: '',
    continuityIds: [],
    continuityRevisions: {},
    includesLyrics: false,
    includesAudio: false,
    includesPrivatePaths: false,
  },
  output: {
    kind: 'image',
    width: 1024,
    height: 1024,
    aspectRatio: '1:1',
    durationFrames: null,
    fps: 24,
    frameCount: null,
    seed: null,
  },
  continuityIds: [],
  inputAssets: [],
  permission: {state: 'authorized', recordPath: null},
  execution: {state: 'prepared', providerTaskId: null, attempts: 0, failure: null, lastTransition: ''},
  result: {files: [], manifestPath: null, inspectedAt: null},
  review: {state: 'awaiting-review', notes: null, assetId: null},
  ...overrides,
});

const withSnapshot = (mutate: (snapshot: PricingSnapshot) => void): PricingSnapshot => {
  const clone = JSON.parse(JSON.stringify(RUNWAY_PRICING_SNAPSHOT)) as PricingSnapshot;
  mutate(clone);
  clone.snapshotSha256 = computeSnapshotHash(clone);
  return clone;
};

test('G10: the pricing snapshot records its source, date and hash', () => {
  assert.equal(RUNWAY_PRICING_SNAPSHOT.provider, 'runway');
  assert.equal(RUNWAY_PRICING_SNAPSHOT.creditToUsd, 0.01);
  assert.equal(RUNWAY_PRICING_SNAPSHOT.rounding, 'round-up-to-credit');
  assert.match(RUNWAY_PRICING_SNAPSHOT.sourceUrl, /pricing/);
  assert.match(RUNWAY_PRICING_SNAPSHOT.retrievedAt, /^2026-11-01/);
  assert.equal(computeSnapshotHash(RUNWAY_PRICING_SNAPSHOT), RUNWAY_PRICING_SNAPSHOT.snapshotSha256);
  assert.equal(validatePricingSnapshot({snapshot: RUNWAY_PRICING_SNAPSHOT, now: NOW}).ok, true);
});

test('G11: a 720p-class image is priced at 5 credits and a 1080p-class image at 8', () => {
  const small = estimateGenerationCost({
    snapshot: RUNWAY_PRICING_SNAPSHOT,
    model: 'gen4_image',
    operation: 'text-to-image',
    outputLongEdge: 1280,
    billableSeconds: 0,
    referenceCount: 0,
    now: NOW,
  });
  assert.equal(small.ok, true);
  assert.equal(small.estimate?.estimatedCredits, 5);
  assert.equal(small.estimate?.estimatedUsd, 0.05);

  const large = estimateGenerationCost({
    snapshot: RUNWAY_PRICING_SNAPSHOT,
    model: 'gen4_image',
    operation: 'text-to-image',
    outputLongEdge: 1920,
    billableSeconds: 0,
    referenceCount: 0,
    now: NOW,
  });
  assert.equal(large.ok, true);
  assert.equal(large.estimate?.estimatedCredits, 8);
  assert.equal(large.estimate?.estimatedUsd, 0.08);
});

test('G11: video is priced per billable second of the requested clip', () => {
  const estimate = estimateGenerationCost({
    snapshot: RUNWAY_PRICING_SNAPSHOT,
    model: 'gen4_turbo',
    operation: 'image-to-video',
    outputLongEdge: 1280,
    billableSeconds: 10,
    referenceCount: 0,
    now: NOW,
  });
  assert.equal(estimate.ok, true);
  assert.equal(estimate.estimate?.billableUnits, 10);
  assert.equal(estimate.estimate?.unit, 'per-second');
  assert.equal(estimate.estimate?.estimatedCredits, 50);
  assert.equal(estimate.estimate?.estimatedUsd, 0.5);
});

test('G11: the estimate is rounded up to whole credits', () => {
  const snapshot = withSnapshot((clone) => {
    const model = clone.models.find((entry) => entry.model === 'gen4_turbo');
    assert.ok(model);
    model.tiers = [{min: 0, max: null, creditsPerUnit: 5.2}];
  });
  const estimate = estimateGenerationCost({
    snapshot,
    model: 'gen4_turbo',
    operation: 'image-to-video',
    outputLongEdge: 1280,
    billableSeconds: 5,
    referenceCount: 0,
    now: NOW,
  });
  assert.equal(estimate.ok, true);
  assert.equal(estimate.estimate?.subtotalCredits, 26);
  assert.equal(estimate.estimate?.estimatedCredits, 26);
});

test('G12: an unknown model is refused rather than guessed', () => {
  const decision = estimateGenerationCost({
    snapshot: RUNWAY_PRICING_SNAPSHOT,
    model: 'gen4_unknown',
    operation: 'text-to-image',
    outputLongEdge: 1024,
    billableSeconds: 0,
    referenceCount: 0,
    now: NOW,
  });
  assert.equal(decision.ok, false);
  assert.equal(decision.code, 'unknown-model');
});

test('G12: a model listed as unsupported is refused with its reason', () => {
  const decision = estimateGenerationCost({
    snapshot: RUNWAY_PRICING_SNAPSHOT,
    model: 'veo3.1',
    operation: 'image-to-video',
    outputLongEdge: 1280,
    billableSeconds: 5,
    referenceCount: 0,
    now: NOW,
  });
  assert.equal(decision.ok, false);
  assert.equal(decision.code, 'unsupported-pricing');
  assert.match(decision.message ?? '', /not implemented/);
});

test('G12: a tampered snapshot is refused', () => {
  const tampered = JSON.parse(JSON.stringify(RUNWAY_PRICING_SNAPSHOT)) as PricingSnapshot;
  tampered.models[0].tiers[0].creditsPerUnit = 1;
  const decision = estimateGenerationCost({
    snapshot: tampered,
    model: 'gen4_image',
    operation: 'text-to-image',
    outputLongEdge: 1024,
    billableSeconds: 0,
    referenceCount: 0,
    now: NOW,
  });
  assert.equal(decision.ok, false);
  assert.equal(decision.code, 'invalid-request');
  assert.match(decision.message ?? '', /tampered|hash/);
});

test('G12: a stale snapshot is refused', () => {
  const stale = new Date('2027-06-01T00:00:00.000Z');
  const validation = validatePricingSnapshot({snapshot: RUNWAY_PRICING_SNAPSHOT, now: stale});
  assert.equal(validation.ok, false);
  assert.equal(validation.code, 'stale');
  const decision = estimateGenerationCost({
    snapshot: RUNWAY_PRICING_SNAPSHOT,
    model: 'gen4_image',
    operation: 'text-to-image',
    outputLongEdge: 1024,
    billableSeconds: 0,
    referenceCount: 0,
    now: stale,
  });
  assert.equal(decision.ok, false);
  assert.equal(decision.code, 'stale-snapshot');
  assert.equal(DEFAULT_PRICING_MAX_AGE_DAYS, 30);
});

test('G11: an operation mismatch is refused', () => {
  const decision = estimateGenerationCost({
    snapshot: RUNWAY_PRICING_SNAPSHOT,
    model: 'gen4_image',
    operation: 'image-to-video',
    outputLongEdge: 1024,
    billableSeconds: 5,
    referenceCount: 0,
    now: NOW,
  });
  assert.equal(decision.ok, false);
  assert.equal(decision.code, 'invalid-request');
});

test('G11: a documented minimum is applied when it exceeds the tier price', () => {
  const snapshot = withSnapshot((clone) => {
    const model = clone.models.find((entry) => entry.model === 'gen4_turbo');
    assert.ok(model);
    model.minimumCredits = 56;
  });
  const estimate = estimateGenerationCost({
    snapshot,
    model: 'gen4_turbo',
    operation: 'image-to-video',
    outputLongEdge: 1280,
    billableSeconds: 5,
    referenceCount: 0,
    now: NOW,
  });
  assert.equal(estimate.ok, true);
  assert.equal(estimate.estimate?.minimumApplied, true);
  assert.equal(estimate.estimate?.estimatedCredits, 56);
});

test('G11: the estimate carries the snapshot identity and its caveats', () => {
  const estimate = estimateGenerationCost({
    snapshot: RUNWAY_PRICING_SNAPSHOT,
    model: 'gen4_turbo',
    operation: 'image-to-video',
    outputLongEdge: 1280,
    billableSeconds: 5,
    referenceCount: 1,
    now: NOW,
  });
  assert.equal(estimate.ok, true);
  assert.equal(estimate.estimate?.snapshotSha256, RUNWAY_PRICING_SNAPSHOT.snapshotSha256);
  assert.equal(estimate.estimate?.pricingVersion, RUNWAY_PRICING_SNAPSHOT.pricingVersion);
  assert.ok(estimate.estimate?.caveats.some((entry) => /not a guarantee/.test(entry)));
  assert.ok(estimate.estimate?.caveats.some((entry) => /no per-reference charge/.test(entry)));
});

test('G11: job helpers derive the long edge and the billable duration', () => {
  assert.equal(outputLongEdgeForJob(job({output: {...job().output, width: 1080, height: 1920}})), 1920);
  const videoJob = job({
    operation: 'image-to-video',
    output: {...job().output, kind: 'video', width: 640, height: 360, durationFrames: 48, fps: 24},
  });
  assert.equal(billableSecondsForJob(videoJob, 5), 5, 'the provider clip duration wins');
  assert.equal(billableSecondsForJob(videoJob, null), 2, 'the shot duration is the fallback');
});
