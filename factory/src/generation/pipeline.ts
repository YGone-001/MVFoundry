import {copyFileSync, existsSync, mkdirSync, readFileSync, statSync} from 'node:fs';
import path from 'node:path';
import type {LoadedProject, ProjectAssetKind} from '../config/types';
import {PreproductionError} from '../errors';
import {sha256File} from '../media/hash';
import {probeLayerPng} from '../media/pngProbe';
import {probeVideo} from '../media/videoProbe';
import type {WriteBoundary} from '../workspace/writeBoundary';
import {ensureSafeDirectory, assertSafePath} from '../workspace/writeBoundary';
import {resolveProjectRelativePath} from '../workspace/guard';
import {
  PREPRODUCTION_PATHS,
  readOptionalProjectJson,
  readProjectJson,
  writeProjectJson,
} from '../preproduction/store';
import {validateAssetIntake} from '../preproduction/validate';
import {requirementFingerprint} from '../preproduction/director';
import type {
  AssetIntakeDocument,
  AssetIntakeRecord,
  AssetRequirement,
  ContinuityDocument,
  CreativeBrief,
  StoryboardShot,
} from '../preproduction/types';
import type {
  GenerationJob,
  GenerationJobDocument,
  GenerationJobSeed,
  GenerationOutputKind,
  GenerationOutputSpec,
  GenerationPermissionRecord,
  GenerationPrompt,
  GenerationProvider,
  ProviderRequest,
} from './types';
import {GENERATION_PROMPT_VERSION, GENERATION_SCHEMA_VERSION} from './types';

export const GENERATION_DIR = 'generation';

export const GENERATION_PATHS = {
  jobs: `${GENERATION_DIR}/jobs.json`,
  permissions: `${GENERATION_DIR}/permissions.json`,
  outputs: `${GENERATION_DIR}/outputs`,
  staging: `${GENERATION_DIR}/staging`,
  manifests: `${GENERATION_DIR}/manifests`,
  reports: `${GENERATION_DIR}/reports`,
} as const;

const FORBIDDEN_PROMPT_TOKENS = [/[A-Za-z]:[\\/]/, /\/(?:Users|home)\//i, /\.[a-z]{2,4}:[\\/]/i];

/** Deterministic identity: same requirement, request and revision => same job. */
export const generationJobId = (seed: GenerationJobSeed, requestRevision: number): string => {
  const canonical = JSON.stringify({
    project: seed.projectId,
    requirement: seed.requirementId,
    storyboard: seed.storyboardRevision,
    fingerprint: seed.requirementFingerprint,
    provider: seed.provider,
    model: seed.model,
    operation: seed.operation,
    output: seed.output,
    continuity: [...seed.continuityIds].sort(),
    inputs: seed.inputAssets.map((asset) => `${asset.assetId}:${asset.sha256}`).sort(),
    revision: requestRevision,
  });
  let hash = 2166136261;
  for (let index = 0; index < canonical.length; index++) {
    hash ^= canonical.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `GEN-${(hash >>> 0).toString(16).padStart(8, '0')}-${requestRevision}`;
};

export type PromptCompileInput = {
  project: LoadedProject;
  brief: CreativeBrief;
  shot: StoryboardShot;
  requirement: AssetRequirement;
  continuity: ContinuityDocument | null;
  provider: GenerationProvider;
  model: string;
  output: GenerationOutputSpec;
};

/**
 * Compiles a provider-neutral instruction draft. It deliberately carries no
 * lyrics, no audio and no filesystem paths, and it labels which constraints a
 * provider can actually enforce.
 */
export const compileGenerationPrompt = (input: PromptCompileInput): GenerationPrompt => {
  const {brief, shot, requirement, continuity, provider, output} = input;
  const model = provider.capabilities.models.find((entry) => entry.id === input.model);
  const entries = (continuity?.entries ?? []).filter((entry) =>
    requirement.continuityReferences.includes(entry.id),
  );
  const references = entries.map(
    (entry) => `${entry.id} (${entry.kind}, revision ${entry.revision}): ${entry.description}`,
  );
  const mustNotChange = [
    ...new Set(
      entries.flatMap((entry) => [
        ...entry.constraints,
        ...Object.entries(entry.attributes).map(([key, value]) => `${key}=${value}`),
      ]),
    ),
  ];
  const supported: string[] = [];
  const advisory: string[] = [];
  if (model) {
    supported.push(`output kind ${output.kind}`);
    supported.push(`aspect ratio ${output.aspectRatio}`);
    if (output.kind === 'video') {
      supported.push(`clip duration ${((output.durationFrames ?? 0) / Math.max(1, output.fps)).toFixed(3)}s at ${output.fps}fps`);
    }
    if (model.supportsSeed) supported.push('deterministic seed');
    else advisory.push('seed is not supported; output cannot be made reproducible');
    if (!model.supportsAlpha && output.kind === 'transparent-layer') {
      advisory.push('alpha is not supported by this model');
    }
    if (model.maxReferences === 0) {
      advisory.push('reference images are not accepted; continuity is described in text only');
    }
  }
  advisory.push('prompt wording cannot guarantee visual identity consistency; output review is required');
  const durationAndAspect =
    output.kind === 'video'
      ? `${((output.durationFrames ?? 0) / Math.max(1, output.fps)).toFixed(3)}s at ${output.fps}fps, ${output.aspectRatio}`
      : `${output.aspectRatio} still, ${output.width ?? 'auto'}x${output.height ?? 'auto'}`;
  const structured = {
    depict: `${shot.visualDescription}. Media slot: ${requirement.mediaSlot ?? 'still'}. Style: ${brief.visualStyle}. Setting: ${brief.setting}.`,
    references,
    movement: shot.movement,
    mustNotChange,
    durationAndAspect,
    excluded: [...brief.excludedElements],
    supportedCapabilities: supported,
    advisoryOnly: advisory,
  };
  const draft = [
    `Shot ${shot.id} (${shot.renderer}, slot ${requirement.mediaSlot ?? 'none'}) for "${brief.concept}".`,
    structured.depict,
    `Camera: ${shot.camera}; movement: ${shot.movement}. Lighting: ${shot.colorAndLighting}.`,
    references.length > 0 ? `Keep consistent: ${references.join(' | ')}` : 'No continuity references were declared.',
    mustNotChange.length > 0 ? `Must not change: ${mustNotChange.join('; ')}` : 'No explicit invariants were declared.',
    `Required: ${durationAndAspect}.`,
    structured.excluded.length > 0 ? `Exclude: ${structured.excluded.join(', ')}.` : 'No exclusions declared.',
    `Provider ${provider.capabilities.provider} model ${input.model} supports: ${supported.join(', ') || 'nothing declared'}.`,
    `Advisory only: ${advisory.join('; ')}.`,
  ].join('\n');
  for (const pattern of FORBIDDEN_PROMPT_TOKENS) {
    if (pattern.test(draft)) {
      throw new PreproductionError('Generation prompt would contain a filesystem path; refusing to prepare the job');
    }
  }
  return {
    version: GENERATION_PROMPT_VERSION,
    structured,
    draft,
    continuityIds: entries.map((entry) => entry.id),
    continuityRevisions: Object.fromEntries(entries.map((entry) => [entry.id, entry.revision])),
    includesLyrics: false,
    includesAudio: false,
    includesPrivatePaths: false,
  };
};

export const outputKindForRequirement = (requirement: AssetRequirement): GenerationOutputKind => {
  if (requirement.kind === 'video') return 'video';
  if (requirement.kind === 'layer') return 'transparent-layer';
  if (requirement.kind === 'image' || requirement.kind === 'existing-asset') return 'image';
  throw new PreproductionError(
    `Requirement ${requirement.id} is a ${requirement.kind} and cannot be produced by a generation job`,
  );
};

export const buildProviderRequest = (input: {
  job: GenerationJob;
  references: Array<{assetId: string; path: string; sha256: string}>;
}): ProviderRequest => ({
  jobId: input.job.jobId,
  operation: input.job.operation,
  model: input.job.model,
  promptText: input.job.prompt.draft,
  output: input.job.output,
  references: input.references,
  seed: input.job.output.seed,
});

export type PermissionCheckInput = {
  job: GenerationJob;
  record: GenerationPermissionRecord | null;
  provider: GenerationProvider;
  networkEnabled: boolean;
  credentialsPresent: boolean;
  requirementStale: boolean;
  uploadsPrivateAssets: boolean;
  attemptsUsed: number;
  live: boolean;
};

export type PermissionDecision = {allowed: boolean; blockers: string[]};

/**
 * Fail-closed gate for any provider network activity. Publication permission,
 * an approved storyboard or a project `allowNetwork` flag never substitute for
 * this record.
 */
export const checkGenerationPermission = (input: PermissionCheckInput): PermissionDecision => {
  const blockers: string[] = [];
  if (input.requirementStale) blockers.push('requirement fingerprint changed; re-prepare the job');
  if (!input.networkEnabled) blockers.push('project permissions.allowNetwork is false');
  if (input.live && !input.credentialsPresent) blockers.push('provider credentials are missing');
  const record = input.record;
  if (!record) {
    blockers.push('no permission record exists for this job');
  } else {
    if (record.jobId !== input.job.jobId) blockers.push('permission record belongs to another job');
    if (record.provider !== input.job.provider || record.model !== input.job.model) {
      blockers.push('permission record does not match the requested provider/model');
    }
    if (record.operation !== input.job.operation) blockers.push('permission record does not match the operation');
    if (input.live && record.authorization !== 'authorized-live') {
      blockers.push(`live provider execution requires authorization-live (record is ${record.authorization})`);
    }
    if (!input.live && record.authorization === 'denied') {
      blockers.push('permission record is denied');
    }
    if (input.uploadsPrivateAssets && !record.uploadsPrivateAssets) {
      blockers.push('reference upload was not authorized for this job');
    }
    if (input.attemptsUsed >= record.maxSubmissions) {
      blockers.push(`authorized submission count ${record.maxSubmissions} already used`);
    }
    if (!(record.maxSpendUsd >= 0)) blockers.push('permission record has no spend ceiling');
  }
  if (!input.provider.capabilities.operations.includes(input.job.operation)) {
    blockers.push(`provider ${input.job.provider} does not implement ${input.job.operation}`);
  }
  const model = input.provider.capabilities.models.find((entry) => entry.id === input.job.model);
  if (!model) blockers.push(`provider ${input.job.provider} has no documented model ${input.job.model}`);
  return {allowed: blockers.length === 0, blockers};
};

export const readJobDocument = (project: LoadedProject): GenerationJobDocument | null =>
  readOptionalProjectJson<GenerationJobDocument>(project.projectDir, GENERATION_PATHS.jobs);

export const writeJobDocument = (
  boundary: WriteBoundary,
  projectId: string,
  jobs: GenerationJob[],
): GenerationJobDocument => {
  const document: GenerationJobDocument = {
    schemaVersion: GENERATION_SCHEMA_VERSION,
    projectId,
    revision: jobs.reduce((max, job) => Math.max(max, job.requestRevision), 0) || 1,
    jobs: [...jobs].sort((left, right) => left.jobId.localeCompare(right.jobId)),
  };
  writeProjectJson(boundary, GENERATION_PATHS.jobs, document);
  return document;
};

export const readPermissionDocument = (project: LoadedProject): GenerationPermissionRecord[] => {
  const document = readOptionalProjectJson<{records?: GenerationPermissionRecord[]}>(
    project.projectDir,
    GENERATION_PATHS.permissions,
  );
  return document?.records ?? [];
};

export const writePermissionRecords = (
  boundary: WriteBoundary,
  projectId: string,
  records: GenerationPermissionRecord[],
): void => {
  writeProjectJson(boundary, GENERATION_PATHS.permissions, {
    schemaVersion: 1,
    projectId,
    records: [...records].sort((left, right) => left.jobId.localeCompare(right.jobId)),
  });
};

const extensionFor = (kind: GenerationOutputKind): string => (kind === 'video' ? '.mp4' : '.png');

export type StageOutputInput = {
  project: LoadedProject;
  boundary: WriteBoundary;
  job: GenerationJob;
  provider: GenerationProvider;
  sourceFile: string;
  requirement: AssetRequirement;
  requirements: AssetRequirement[];
  rights: string;
};

export type StagedOutput = {
  record: AssetIntakeRecord;
  manifestPath: string;
  stagedPath: string;
  technical: AssetIntakeRecord['technical'];
};

/**
 * Validates bytes produced by a provider, stages them inside the project, and
 * records them as pending intake. Approval stays a separate human decision.
 */
export const stageGenerationOutput = (input: StageOutputInput): StagedOutput => {
  const {project, boundary, job, requirement} = input;
  const expected = outputKindForRequirement(requirement);
  if (!existsSync(input.sourceFile)) {
    throw new PreproductionError(`Provider output is missing: ${path.basename(input.sourceFile)}`);
  }
  const stagingDir = ensureSafeDirectory(
    boundary,
    path.join(boundary.projectRoot, GENERATION_PATHS.staging, job.jobId),
    'project',
  );
  const stagedPath = assertSafePath(
    boundary,
    path.join(stagingDir, `${job.jobId}${extensionFor(expected)}`),
    {expect: 'file', subtree: 'project'},
  );
  copyFileSync(input.sourceFile, stagedPath);
  const sha256 = sha256File(stagedPath);
  const bytes = statSync(stagedPath).size;
  if (bytes <= 0) throw new PreproductionError('Provider output is empty');
  const technical: AssetIntakeRecord['technical'] = {
    probed: 'unprobed',
    width: null,
    height: null,
    durationSeconds: null,
    fps: null,
    hasAlpha: null,
    codec: null,
  };
  if (expected === 'video') {
    const metadata = probeVideo(stagedPath, job.jobId);
    technical.probed = 'video';
    technical.width = metadata.width;
    technical.height = metadata.height;
    technical.durationSeconds = metadata.durationSeconds;
    technical.fps = metadata.fps;
    technical.hasAlpha = false;
    technical.codec = metadata.codec;
    const needed = (job.output.durationFrames ?? 0) / Math.max(1, job.output.fps);
    if (metadata.durationSeconds + 1e-3 < needed) {
      throw new PreproductionError(
        `Generated video covers ${metadata.durationSeconds.toFixed(3)}s but the shot needs ${needed.toFixed(3)}s`,
      );
    }
    if (job.output.width !== null && metadata.width !== job.output.width) {
      throw new PreproductionError(`Generated video width ${metadata.width} does not match the requested ${job.output.width}`);
    }
    if (job.output.height !== null && metadata.height !== job.output.height) {
      throw new PreproductionError(`Generated video height ${metadata.height} does not match the requested ${job.output.height}`);
    }
  } else {
    const metadata = probeLayerPng(stagedPath, job.jobId);
    technical.probed = expected === 'transparent-layer' ? 'layer' : 'image';
    technical.width = metadata.width;
    technical.height = metadata.height;
    technical.hasAlpha = metadata.hasAlpha;
    technical.codec = 'png';
    if (expected === 'transparent-layer' && metadata.hasAlpha !== true) {
      throw new PreproductionError('Generated layer has no alpha channel');
    }
  }
  const relative = path
    .relative(project.projectDir, stagedPath)
    .split(path.sep)
    .join('/');
  const assetKind: ProjectAssetKind =
    requirement.kind === 'video' ? 'video' : requirement.kind === 'layer' ? 'layer' : 'image';
  const record: AssetIntakeRecord = {
    requirementId: requirement.id,
    assetId: `GEN-${job.jobId}`,
    kind: assetKind,
    path: relative,
    sha256,
    fileSizeBytes: bytes,
    fingerprint: requirement.fingerprint,
    provenance: `${job.provider}/${job.model}/${job.operation} job ${job.jobId} (${job.result.files[0]?.marker ?? 'provider-output'})`,
    rights: input.rights,
    review: 'pending',
    reviewNotes: null,
    recordedAtStoryboardRevision: job.storyboardRevision,
    technical,
  };
  const requirementFingerprintCheck = requirementFingerprint({
    shotIds: requirement.shotIds,
    renderer: requirement.renderer,
    kind: requirement.kind,
    mediaSlot: requirement.mediaSlot,
    durationFrames: requirement.durationFrames,
    aspectRatio: requirement.aspectRatio,
    description: requirement.description,
  });
  if (requirementFingerprintCheck !== requirement.fingerprint) {
    throw new PreproductionError(
      `Requirement ${requirement.id} fingerprint is inconsistent; re-plan before handing off generated output`,
    );
  }
  const existing = readOptionalProjectJson<AssetIntakeDocument>(
    project.projectDir,
    PREPRODUCTION_PATHS.assetIntake,
  );
  const records = (existing?.records ?? []).filter((entry) => entry.requirementId !== requirement.id);
  records.push(record);
  const knownRequirements = new Map(
    [...input.requirements, requirement].map((entry) => [entry.id, entry]),
  );
  const document = validateAssetIntake(
    {schemaVersion: 1, projectId: project.config.projectId, records},
    {projectId: project.config.projectId, requirements: [...knownRequirements.values()]},
  );
  writeProjectJson(boundary, PREPRODUCTION_PATHS.assetIntake, document);
  const manifestDir = ensureSafeDirectory(
    boundary,
    path.join(boundary.projectRoot, GENERATION_PATHS.manifests),
    'project',
  );
  const manifestPath = path.join(manifestDir, `${job.jobId}.json`);
  writeProjectJson(boundary, path.relative(project.projectDir, manifestPath).split(path.sep).join('/'), {
    schemaVersion: 1,
    jobId: job.jobId,
    projectId: project.config.projectId,
    requirementId: requirement.id,
    provider: job.provider,
    model: job.model,
    operation: job.operation,
    providerTaskId: job.execution.providerTaskId,
    staged: {path: relative, sha256, bytes},
    technical,
    marker: job.result.files[0]?.marker ?? 'provider-output',
    notes: ['Technical validation only; the asset stays pending until a reviewer approves it.'],
  });
  return {record, manifestPath, stagedPath, technical};
};

export const readBrief = (project: LoadedProject): CreativeBrief =>
  readProjectJson<CreativeBrief>(project.projectDir, PREPRODUCTION_PATHS.brief);

export const readContinuity = (project: LoadedProject): ContinuityDocument | null =>
  readOptionalProjectJson<ContinuityDocument>(project.projectDir, PREPRODUCTION_PATHS.continuity);

export const readStoryboard = <T>(project: LoadedProject): T =>
  readProjectJson<T>(project.projectDir, PREPRODUCTION_PATHS.storyboard);

export const readStagedBytes = (file: string): Buffer => readFileSync(file);

export const ensureGenerationDir = (projectDir: string): string => {
  const dir = path.join(projectDir, GENERATION_DIR);
  mkdirSync(dir, {recursive: true});
  return dir;
};

export const projectRelative = (project: LoadedProject, absolute: string): string =>
  path.relative(project.projectDir, absolute).split(path.sep).join('/');

export const resolveInsideProject = (project: LoadedProject, relativePath: string): string =>
  resolveProjectRelativePath(project.projectDir, relativePath);
