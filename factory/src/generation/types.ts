import type {AssetRequirementKind} from '../preproduction/types';

export const GENERATION_SCHEMA_VERSION = 1;
export const GENERATION_PROMPT_VERSION = 'prompt-v1';
export const RUNWAY_API_VERSION = '2024-11-06';
export const PROVIDER_OUTPUT_SCHEMA_VERSION = 1;
export const RETRIEVAL_POLICY_VERSION = 'provider-retrieval-v1';
export const NORMALIZATION_VERSION = 'video-normalize-v1';

export type GenerationProviderId = 'offline-fixture' | 'runway';
export type GenerationOperation = 'text-to-image' | 'image-to-video' | 'text-to-video';
export type GenerationOutputKind = 'image' | 'video' | 'transparent-layer';

/**
 * Provider execution and human review are separate state machines on purpose:
 * a succeeded provider task is never an approved production asset.
 */
export type GenerationPermissionState =
  | 'not-requested'
  | 'awaiting-authorization'
  | 'authorized'
  | 'denied';

export type GenerationExecutionState =
  | 'prepared'
  | 'awaiting-authorization'
  | 'queued'
  | 'submitted'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'canceled'
  | 'unknown-submission-state'
  | 'output-retrieved';

export type GenerationReviewState = 'awaiting-review' | 'approved' | 'rejected';

/**
 * Failure provenance is split so a failed download can never be reported as a
 * failed generation: a retrieval problem must not invite a second billable
 * submission.
 */
export type GenerationFailureKind = 'submission' | 'generation' | 'retrieval' | 'normalization';

export type GenerationAttemptRecord = {
  attempt: number;
  at: string;
  phase: 'submit' | 'status' | 'retrieve' | 'normalize';
  outcome: 'submitted' | 'unknown' | 'succeeded' | 'failed' | 'canceled' | 'recovered';
  providerTaskId: string | null;
  message: string | null;
};

export type GenerationPromptSection = {
  depict: string;
  references: string[];
  movement: string;
  mustNotChange: string[];
  durationAndAspect: string;
  excluded: string[];
  supportedCapabilities: string[];
  advisoryOnly: string[];
};

export type GenerationPrompt = {
  version: typeof GENERATION_PROMPT_VERSION;
  structured: GenerationPromptSection;
  draft: string;
  continuityIds: string[];
  continuityRevisions: Record<string, number>;
  includesLyrics: false;
  includesAudio: false;
  includesPrivatePaths: false;
};

export type GenerationOutputSpec = {
  kind: GenerationOutputKind;
  width: number | null;
  height: number | null;
  aspectRatio: string;
  durationFrames: number | null;
  fps: number;
  frameCount: number | null;
  seed: number | null;
};

export type GenerationInputReference = {
  assetId: string;
  role: 'reference';
  sha256: string;
};

export type GenerationJobPermission = {
  state: GenerationPermissionState;
  recordPath: string | null;
};

export type GenerationJobExecution = {
  state: GenerationExecutionState;
  providerTaskId: string | null;
  attempts: number;
  failure: string | null;
  failureKind?: GenerationFailureKind | null;
  attemptHistory?: GenerationAttemptRecord[];
  lastTransition: string;
};

export type GenerationJobResultFile = {
  kind: GenerationOutputKind;
  path: string;
  sha256: string;
  bytes: number;
  marker: 'synthetic-offline-test-output' | 'provider-output';
  /** Project-relative path of the untouched provider bytes when `path` is derived. */
  originalPath?: string | null;
  originalSha256?: string | null;
  normalizationVersion?: string | null;
};

export type GenerationJob = {
  schemaVersion: typeof GENERATION_SCHEMA_VERSION;
  jobId: string;
  projectId: string;
  requirementId: string;
  storyboardRevision: number;
  requirementFingerprint: string;
  shotIds: string[];
  provider: GenerationProviderId;
  operation: GenerationOperation;
  model: string;
  requestRevision: number;
  prompt: GenerationPrompt;
  output: GenerationOutputSpec;
  continuityIds: string[];
  inputAssets: GenerationInputReference[];
  permission: GenerationJobPermission;
  execution: GenerationJobExecution;
  result: {
    files: GenerationJobResultFile[];
    /** Derived compatibility copy; `files` always keeps the provider original. */
    derived?: GenerationJobResultFile | null;
    manifestPath: string | null;
    inspectedAt: string | null;
  };
  review: {
    state: GenerationReviewState;
    notes: string | null;
    assetId: string | null;
  };
};

export type GenerationJobDocument = {
  schemaVersion: typeof GENERATION_SCHEMA_VERSION;
  projectId: string;
  revision: number;
  jobs: GenerationJob[];
};

export type GenerationPermissionRecord = {
  schemaVersion: 1;
  projectId: string;
  jobId: string;
  provider: GenerationProviderId;
  model: string;
  operation: GenerationOperation;
  inputAssetIds: string[];
  uploadsPrivateAssets: boolean;
  maxSpendUsd: number;
  maxCredits: number | null;
  maxSubmissions: number;
  authorization: 'denied' | 'authorized-for-simulation' | 'authorized-live';
  reviewNotes: string;
  authorizationRevision: number;
};

export type ModelCapability = {
  id: string;
  operations: GenerationOperation[];
  outputKinds: GenerationOutputKind[];
  aspectRatios: string[];
  durationsSeconds: number[];
  resolutions: Array<{width: number; height: number}>;
  maxReferences: number;
  supportsSeed: boolean;
  supportsAlpha: boolean;
  generatesAudio: boolean;
  formats: string[];
};

export type ProviderCapabilities = {
  provider: GenerationProviderId;
  apiVersion: string | null;
  operations: GenerationOperation[];
  outputKinds: GenerationOutputKind[];
  models: ModelCapability[];
  maxReferenceUploads: number;
  liveRequests: 'supported' | 'not-implemented';
  notes: string[];
};

export type ProviderRequest = {
  jobId: string;
  operation: GenerationOperation;
  model: string;
  promptText: string;
  output: GenerationOutputSpec;
  references: Array<{assetId: string; path: string; sha256: string}>;
  seed: number | null;
};

export type CapabilityViolation = {
  code:
    | 'unsupported-operation'
    | 'unsupported-output-kind'
    | 'unsupported-model'
    | 'unsupported-aspect-ratio'
    | 'unsupported-duration'
    | 'unsupported-resolution'
    | 'too-many-references'
    | 'references-not-supported'
    | 'seed-not-supported'
    | 'alpha-not-supported'
    | 'audio-not-supported'
    | 'reference-upload-not-authorized';
  message: string;
};

export type ProviderSubmitResult = {
  taskId: string;
  state: 'submitted' | 'running' | 'succeeded';
};

export type ProviderStatusResult = {
  state: 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled';
  progress: number | null;
  failure: string | null;
  outputUrl: string | null;
  /** Every result URL the provider returned, in provider order. */
  outputUrls: string[];
};

export type ProviderOutputFile = {
  kind: GenerationOutputKind;
  source: 'local' | 'https';
  location: string;
  bytes: number | null;
  contentType?: string | null;
};

export type ProviderOutput = {
  files: ProviderOutputFile[];
  providerTaskId: string | null;
  notes: string[];
  /** Kind the provider operation is documented to produce. */
  declaredKind?: GenerationOutputKind | null;
};

/**
 * The adapter cannot know an operation from a task id alone after a restart, so
 * every retrieval states what the bound job expects. A mismatch fails closed.
 */
export type ProviderRetrieveExpectation = {
  jobId: string;
  operation: GenerationOperation;
  outputKind: GenerationOutputKind;
};

export type BoundProviderOutput = {
  schemaVersion: typeof PROVIDER_OUTPUT_SCHEMA_VERSION;
  jobId: string;
  providerTaskId: string;
  kind: GenerationOutputKind;
  selectionPolicy: 'single';
  file: ProviderOutputFile;
  notes: string[];
};

export type HttpRequest = {
  method: 'GET' | 'POST';
  url: string;
  headers: Record<string, string>;
  body: string | null;
};

export type HttpResponse = {
  status: number;
  headers: Record<string, string>;
  body: string;
};

/** Only an injected transport can reach the network; there is no ambient fetch. */
export type HttpTransport = (request: HttpRequest) => Promise<HttpResponse>;

export type GenerationProvider = {
  capabilities: ProviderCapabilities;
  validate: (request: ProviderRequest) => CapabilityViolation[];
  submit: (request: ProviderRequest) => Promise<ProviderSubmitResult>;
  status: (taskId: string) => Promise<ProviderStatusResult>;
  retrieve: (taskId: string, expectation: ProviderRetrieveExpectation) => Promise<ProviderOutput>;
  cancel: ((taskId: string) => Promise<boolean>) | null;
};

// ---------------------------------------------------------------------------
// Reference input preparation
// ---------------------------------------------------------------------------

/**
 * Local approval, intended use, external disclosure and provider execution are
 * four different decisions. Only the last two may move bytes off the machine.
 */
export type ReferenceDisclosureState =
  | 'not-authorized'
  | 'authorized-for-simulation'
  | 'authorized-live';

export type ReferenceTransportKind = 'data-uri' | 'upload-endpoint';

export type PreparedReference = {
  schemaVersion: 1;
  assetId: string;
  /** Redacted identity: asset id plus a hash prefix, never a filesystem path. */
  identity: string;
  sha256: string;
  bytes: number;
  mimeType: 'image/png' | 'image/jpeg';
  width: number;
  height: number;
  aspectRatio: number;
  transport: ReferenceTransportKind;
  disclosure: ReferenceDisclosureState;
  /** Base64 payload length that a data URI would occupy; never the payload itself. */
  encodedCharacters: number;
  blockers: string[];
};

// ---------------------------------------------------------------------------
// Remote output retrieval
// ---------------------------------------------------------------------------

export type DownloadRequest = {
  url: string;
  headers: Record<string, string>;
  signal: AbortSignal | null;
};

export type DownloadResponse = {
  status: number;
  headers: Record<string, string>;
  body: AsyncIterable<Uint8Array>;
  /** Bytes the transport claims to have produced, when it knows. */
  declaredBytes?: number | null;
};

export type DownloadTransport = (request: DownloadRequest) => Promise<DownloadResponse>;

export type HostResolver = (hostname: string) => Promise<string[]>;

export type OutputHostPolicy = {
  provider: GenerationProviderId;
  /** Exact hostnames. A leading dot marks a suffix rule, e.g. `.cdn.example`. */
  hosts: string[];
  maxRedirects: number;
  maxBytes: number;
  timeoutMs: number;
  contentTypes: string[];
};

export type RedactedSourceIdentity = {
  host: string;
  path: string;
  queryParameters: number;
  signedQueryRedacted: true;
};

export type RetrievalRecord = {
  schemaVersion: 1;
  policyVersion: typeof RETRIEVAL_POLICY_VERSION;
  jobId: string;
  providerTaskId: string | null;
  kind: GenerationOutputKind;
  source: RedactedSourceIdentity;
  redirects: number;
  contentType: string;
  bytes: number;
  sha256: string;
  storedPath: string;
  elapsedMs: number;
};

// ---------------------------------------------------------------------------
// Media normalization
// ---------------------------------------------------------------------------

export type VideoFrameTiming = {
  sampleCount: number;
  medianDeltaSeconds: number;
  maxDeviationSeconds: number;
  variableFrameRate: boolean;
};

export type VideoInspection = {
  container: string;
  codec: string;
  pixelFormat: string;
  width: number;
  height: number;
  timeBase: string;
  nominalFrameRate: number;
  averageFrameRate: number;
  frameCount: number | null;
  durationSeconds: number;
  rotation: number;
  decodesCleanly: boolean;
  decodeErrors: string[];
  audioStreamCount: number;
  timing: VideoFrameTiming;
};

export type NormalizationRecord = {
  schemaVersion: 1;
  normalizationVersion: typeof NORMALIZATION_VERSION;
  jobId: string;
  providerTaskId: string | null;
  original: {
    path: string;
    sha256: string;
    bytes: number;
    inspection: VideoInspection;
  };
  derived: {
    path: string;
    sha256: string;
    bytes: number;
    inspection: VideoInspection;
  };
  profile: {
    container: 'mp4';
    videoCodec: 'libx264';
    pixelFormat: 'yuv420p';
    preset: string;
    crf: number;
    gopFrames: number;
    colorSpace: 'bt709';
    audioPolicy: 'strip';
    scaling: 'fit-pad';
    targetWidth: number;
    targetHeight: number;
    targetFps: number;
    targetDurationSeconds: number;
  };
  /** Exact FFmpeg argument vector with local paths replaced by placeholders. */
  arguments: string[];
  timing: {
    sourceFrameRate: number;
    targetFrameRate: number;
    sourceDurationSeconds: number;
    derivedDurationSeconds: number;
    frameDuplicationPolicy: string;
    frameDropPolicy: string;
  };
  rotationCorrection: number;
  rights: string;
  review: 'pending';
  createdAt: string;
};

export type GenerationJobSeed = {
  projectId: string;
  requirementId: string;
  storyboardRevision: number;
  requirementFingerprint: string;
  shotIds: string[];
  provider: GenerationProviderId;
  model: string;
  operation: GenerationOperation;
  output: GenerationOutputSpec;
  continuityIds: string[];
  inputAssets: GenerationInputReference[];
};

export type GenerationPrepareInput = {
  job: GenerationJobSeed;
  prompt: GenerationPrompt;
  requestRevision: number;
};

export type RequirementKindForOutput = AssetRequirementKind;
