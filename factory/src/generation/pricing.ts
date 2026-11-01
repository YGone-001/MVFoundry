import {createHash} from 'node:crypto';
import type {
  CostEstimate,
  GenerationJob,
  GenerationOperation,
  ModelPrice,
  PricingDecision,
  PricingSnapshot,
  PricingTier,
} from './types';
import {PRICING_SCHEMA_VERSION} from './types';

/** Canonical JSON: sorted keys, no whitespace, so the hash is reproducible. */
const canonical = (value: unknown): string => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(',')}}`;
};

export const computeSnapshotHash = (snapshot: Omit<PricingSnapshot, 'snapshotSha256'> | PricingSnapshot): string => {
  const {snapshotSha256: _ignored, ...rest} = snapshot as PricingSnapshot;
  return createHash('sha256').update(canonical(rest)).digest('hex');
};

/**
 * Documented Runway tariff, retrieved 2026-11-01 from
 * `docs.dev.runwayml.com/guides/pricing/`.
 *
 * Only the two models this engine actually supports are priced. Every other
 * model is listed as unsupported so a request can never inherit a guessed rate.
 */
const RUNWAY_MODELS: ModelPrice[] = [
  {
    model: 'gen4_image',
    operation: 'text-to-image',
    unit: 'per-image',
    tierDimension: 'long-edge',
    // "5 credits per 720p image, 8 credits per 1080p image". The documented
    // boundary is a resolution class, not a pixel count, so the split is placed
    // at the 720p long edge (1280) and everything wider is priced as 1080p.
    tiers: [
      {min: 0, max: 1280, creditsPerUnit: 5},
      {min: 1281, max: null, creditsPerUnit: 8},
    ],
    minimumCredits: null,
    creditsPerReference: null,
    notes: [
      'Documented as 5 credits per 720p image and 8 credits per 1080p image.',
      'The engine maps a long edge of 1280 or less to the 720p rate and anything wider to the 1080p rate.',
    ],
  },
  {
    model: 'gen4_turbo',
    operation: 'image-to-video',
    unit: 'per-second',
    tierDimension: 'duration-seconds',
    tiers: [{min: 0, max: null, creditsPerUnit: 5}],
    minimumCredits: null,
    creditsPerReference: null,
    notes: [
      'Documented as 5 credits per second with no resolution tier published.',
      'Billable seconds are the provider clip duration actually requested, not the shot length.',
    ],
  },
];

const RUNWAY_UNSUPPORTED = [
  {model: 'gen4.5', reason: 'not implemented by this engine; priced elsewhere on the provider page'},
  {model: 'act_two', reason: 'not implemented by this engine'},
  {model: 'veo3.1', reason: 'not implemented by this engine'},
  {model: 'veo3.1_fast', reason: 'not implemented by this engine'},
  {model: 'kling2.5_turbo_pro', reason: 'not implemented by this engine'},
  {model: 'seedance2', reason: 'not implemented by this engine'},
  {model: 'aleph2', reason: 'not implemented by this engine'},
  {model: 'seedance2_mini', reason: 'not implemented by this engine'},
];

const RUNWAY_CAVEATS = [
  'A local estimate is not a guarantee of the final invoice.',
  'Sales tax, account discounts, promotional pricing and other API clients on the same account are not visible to MVFoundry.',
  'The provider documents that charges are rounded up to the next credit.',
  'No live pricing API was queried; the snapshot is transcribed from the published pricing page.',
];

const buildSnapshot = (): PricingSnapshot => {
  const base: Omit<PricingSnapshot, 'snapshotSha256'> = {
    schemaVersion: PRICING_SCHEMA_VERSION,
    provider: 'runway',
    pricingVersion: 'runway-2026-11-01',
    sourceUrl: 'docs.dev.runwayml.com/guides/pricing/',
    retrievedAt: '2026-11-01T00:00:00.000Z',
    creditToUsd: 0.01,
    currency: 'USD',
    rounding: 'round-up-to-credit',
    taxNote: 'Sales tax may apply depending on the account location.',
    models: RUNWAY_MODELS,
    unsupported: RUNWAY_UNSUPPORTED,
    caveats: RUNWAY_CAVEATS,
  };
  return {...base, snapshotSha256: computeSnapshotHash(base)};
};

export const RUNWAY_PRICING_SNAPSHOT: PricingSnapshot = buildSnapshot();

export const DEFAULT_PRICING_MAX_AGE_DAYS = 30;

export type SnapshotValidation = {
  ok: boolean;
  code: 'hash-mismatch' | 'stale' | 'malformed' | null;
  message: string | null;
};

/** Integrity and freshness check. A snapshot that fails either is unusable. */
export const validatePricingSnapshot = (input: {
  snapshot: PricingSnapshot;
  now: Date;
  maxAgeDays?: number;
}): SnapshotValidation => {
  const {snapshot} = input;
  if (
    !snapshot ||
    snapshot.schemaVersion !== PRICING_SCHEMA_VERSION ||
    typeof snapshot.snapshotSha256 !== 'string' ||
    !Array.isArray(snapshot.models)
  ) {
    return {ok: false, code: 'malformed', message: 'pricing snapshot is malformed'};
  }
  if (computeSnapshotHash(snapshot) !== snapshot.snapshotSha256) {
    return {
      ok: false,
      code: 'hash-mismatch',
      message: 'pricing snapshot content does not match its recorded hash; treat it as tampered',
    };
  }
  const retrieved = Date.parse(snapshot.retrievedAt);
  if (!Number.isFinite(retrieved)) {
    return {ok: false, code: 'malformed', message: 'pricing snapshot has no readable retrieval date'};
  }
  const maxAgeDays = input.maxAgeDays ?? DEFAULT_PRICING_MAX_AGE_DAYS;
  const ageDays = (input.now.getTime() - retrieved) / 86_400_000;
  if (ageDays > maxAgeDays) {
    return {
      ok: false,
      code: 'stale',
      message: `pricing snapshot is ${ageDays.toFixed(1)} days old; the limit is ${maxAgeDays} days`,
    };
  }
  return {ok: true, code: null, message: null};
};

export const findModelPrice = (snapshot: PricingSnapshot, model: string): ModelPrice | null =>
  snapshot.models.find((entry) => entry.model === model) ?? null;

const tierFor = (price: ModelPrice, dimension: number): PricingTier | null =>
  price.tiers.find((tier) => dimension >= tier.min && (tier.max === null || dimension <= tier.max)) ?? null;

export type EstimateInput = {
  snapshot: PricingSnapshot;
  model: string;
  operation: GenerationOperation;
  /** Long edge of the requested output, used for per-image tiers. */
  outputLongEdge: number;
  /** Provider clip duration in seconds, used for per-second pricing. */
  billableSeconds: number;
  referenceCount: number;
  now: Date;
  maxAgeDays?: number;
};

/**
 * Conservative estimate for one reviewed request. It refuses rather than guesses:
 * an unknown model, an unsupported model, a tampered snapshot or a stale
 * snapshot all fail closed.
 */
export const estimateGenerationCost = (input: EstimateInput): PricingDecision => {
  const validation = validatePricingSnapshot({
    snapshot: input.snapshot,
    now: input.now,
    maxAgeDays: input.maxAgeDays,
  });
  if (!validation.ok) {
    return {
      ok: false,
      estimate: null,
      code: validation.code === 'stale' ? 'stale-snapshot' : 'invalid-request',
      message: validation.message ?? 'pricing snapshot is unusable',
    };
  }
  const price = findModelPrice(input.snapshot, input.model);
  if (!price) {
    const unsupported = input.snapshot.unsupported.find((entry) => entry.model === input.model);
    if (unsupported) {
      return {
        ok: false,
        estimate: null,
        code: 'unsupported-pricing',
        message: `${input.model} has no supported pricing model: ${unsupported.reason}`,
      };
    }
    return {
      ok: false,
      estimate: null,
      code: 'unknown-model',
      message: `${input.model} is not present in pricing snapshot ${input.snapshot.pricingVersion}`,
    };
  }
  if (price.operation !== input.operation) {
    return {
      ok: false,
      estimate: null,
      code: 'invalid-request',
      message: `${input.model} is priced for ${price.operation}, not ${input.operation}`,
    };
  }
  const dimension = price.tierDimension === 'long-edge' ? input.outputLongEdge : input.billableSeconds;
  if (!Number.isFinite(dimension) || dimension <= 0) {
    return {
      ok: false,
      estimate: null,
      code: 'invalid-request',
      message: `cannot price ${input.model} without a positive ${price.tierDimension}`,
    };
  }
  if (input.referenceCount < 0 || !Number.isInteger(input.referenceCount)) {
    return {
      ok: false,
      estimate: null,
      code: 'invalid-request',
      message: 'reference count must be a non-negative integer',
    };
  }
  const tier = tierFor(price, dimension);
  if (!tier) {
    return {
      ok: false,
      estimate: null,
      code: 'unsupported-pricing',
      message: `${input.model} has no documented tier covering ${price.tierDimension} ${dimension}`,
    };
  }
  const billableUnits = price.unit === 'per-image' ? 1 : input.billableSeconds;
  const baseCredits = tier.creditsPerUnit * billableUnits;
  const referenceCredits =
    price.creditsPerReference === null ? 0 : price.creditsPerReference * input.referenceCount;
  const subtotal = baseCredits + referenceCredits;
  const minimumCredits = price.minimumCredits ?? 0;
  const minimumApplied = minimumCredits > subtotal;
  const preRounding = Math.max(subtotal, minimumCredits);
  const estimatedCredits =
    input.snapshot.rounding === 'round-up-to-credit' ? Math.ceil(preRounding) : preRounding;
  const estimate: CostEstimate = {
    schemaVersion: PRICING_SCHEMA_VERSION,
    provider: input.snapshot.provider,
    model: input.model,
    operation: input.operation,
    pricingVersion: input.snapshot.pricingVersion,
    snapshotSha256: input.snapshot.snapshotSha256,
    retrievedAt: input.snapshot.retrievedAt,
    billableUnits,
    unit: price.unit,
    tierApplied: tier,
    referenceCount: input.referenceCount,
    referenceCredits,
    subtotalCredits: subtotal,
    minimumApplied,
    estimatedCredits,
    estimatedUsd: Number((estimatedCredits * input.snapshot.creditToUsd).toFixed(6)),
    conservative: true,
    caveats: [
      ...input.snapshot.caveats,
      ...price.notes,
      ...(price.creditsPerReference === null && input.referenceCount > 0
        ? ['The provider documents no per-reference charge for this model; reference input is estimated at zero.']
        : []),
    ],
  };
  return {ok: true, estimate, code: null, message: null};
};

/** Long edge of the job's requested output, falling back to the aspect ratio. */
export const outputLongEdgeForJob = (job: GenerationJob): number => {
  const {width, height} = job.output;
  if (typeof width === 'number' && typeof height === 'number' && width > 0 && height > 0) {
    return Math.max(width, height);
  }
  const match = /^(\d+):(\d+)$/.exec(job.output.aspectRatio);
  if (match) {
    const left = Number(match[1]);
    const right = Number(match[2]);
    if (left > 0 && right > 0) return Math.max(left, right);
  }
  return 0;
};

/** Billable seconds for a video request, using the provider clip duration. */
export const billableSecondsForJob = (job: GenerationJob, providerDurationSeconds: number | null): number => {
  if (typeof providerDurationSeconds === 'number' && providerDurationSeconds > 0) {
    return providerDurationSeconds;
  }
  const frames = job.output.durationFrames ?? 0;
  const fps = job.output.fps > 0 ? job.output.fps : 1;
  return frames / fps;
};
