import type {AssetRequirementKind} from '../preproduction/types';

export const GENERATION_SCHEMA_VERSION = 1;
export const GENERATION_PROMPT_VERSION = 'prompt-v1';
export const RUNWAY_API_VERSION = '2024-11-06';

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
  lastTransition: string;
};

export type GenerationJobResultFile = {
  kind: GenerationOutputKind;
  path: string;
  sha256: string;
  bytes: number;
  marker: 'synthetic-offline-test-output' | 'provider-output';
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
};

export type ProviderOutputFile = {
  kind: GenerationOutputKind;
  source: 'local' | 'https';
  location: string;
  bytes: number | null;
};

export type ProviderOutput = {
  files: ProviderOutputFile[];
  providerTaskId: string | null;
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
  retrieve: (taskId: string) => Promise<ProviderOutput>;
  cancel: ((taskId: string) => Promise<boolean>) | null;
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
