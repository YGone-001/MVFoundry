import {existsSync} from 'node:fs';
import type {
  LoadedProject,
  ProjectAsset,
  ProjectConfig,
  Shot,
  ShotHybridMedia,
  ShotMediaConfig,
  ShotVideoMedia,
  VideoSourceConfig,
} from '../config/types';
import {validateProjectConfig} from '../config/validate';
import {PreproductionError} from '../errors';
import {sha256File} from '../media/hash';
import {DEFAULT_SCENE_REGISTRY} from '../scenes/registry';
import {resolveProjectRelativePath} from '../workspace/guard';
import type {WriteBoundary} from '../workspace/writeBoundary';
import type {
  AnnotationDocument,
  AssetIntakeDocument,
  AssetRequirement,
  CompileReport,
  ContinuityDocument,
  LyricsDocument,
  MissingAssetsReport,
  Storyboard,
  StoryboardShot,
} from './types';
import {PREPRODUCTION_PATHS, writeProjectJson} from './store';
import {validateStoryboard} from './storyboard';

const isMediaRendererName = (renderer: string): boolean => renderer === 'video' || renderer === 'hybrid';

const intakeRecordFor = (intake: AssetIntakeDocument | null, requirementId: string) =>
  intake?.records.find((record) => record.requirementId === requirementId) ?? null;

/**
 * Resolve the approved local asset bound to a requirement. An approved intake
 * record is authoritative and may describe a file that `project.json` does not
 * declare; the legacy hand-edited requirement path still works so previously
 * accepted projects keep compiling.
 */
const resolveBoundAsset = (
  project: LoadedProject,
  requirement: AssetRequirement,
  intake: AssetIntakeDocument | null,
): ProjectAsset | null => {
  const record = intakeRecordFor(intake, requirement.id);
  if (record) {
    if (record.review !== 'approved') return null;
    if (record.fingerprint !== requirement.fingerprint) {
      throw new PreproductionError(
        `Requirement ${requirement.id} has a stale asset intake for ${record.assetId}; re-attach and re-review it`,
      );
    }
    if (record.kind !== requirement.kind) {
      throw new PreproductionError(
        `Requirement ${requirement.id} expects a ${requirement.kind} asset but the approved intake is ${record.kind}`,
      );
    }
    if (requirement.alphaRequired && record.technical.hasAlpha !== true) {
      throw new PreproductionError(
        `Requirement ${requirement.id} needs transparency but the approved asset ${record.assetId} has no alpha channel`,
      );
    }
    const declared = project.config.assets.find((asset) => asset.id === record.assetId);
    if (declared) {
      if (declared.approval !== 'approved') {
        throw new PreproductionError(
          `Asset ${declared.id} is declared in project.json with approval ${declared.approval}; only approved assets can bind`,
        );
      }
      if (declared.path !== record.path || declared.sha256 !== record.sha256) {
        throw new PreproductionError(
          `Asset ${declared.id} no longer matches the reviewed intake path or hash`,
        );
      }
      return declared;
    }
    return {
      id: record.assetId,
      kind: record.kind,
      path: record.path,
      sha256: record.sha256,
      source: record.provenance,
      rights: record.rights,
      approval: 'approved',
    };
  }
  if (requirement.status !== 'approved' || !requirement.fulfilledAssetId) return null;
  if (requirement.kind === 'scene-module') {
    if (!project.sceneModules.some((module) => module.id === requirement.fulfilledAssetId)) {
      throw new PreproductionError(
        `Requirement ${requirement.id} names scene module ${requirement.fulfilledAssetId}, which the project does not declare`,
      );
    }
    return null;
  }
  const asset = project.config.assets.find((entry) => entry.id === requirement.fulfilledAssetId);
  if (!asset) {
    throw new PreproductionError(
      `Requirement ${requirement.id} references unknown asset ${requirement.fulfilledAssetId}`,
    );
  }
  if (asset.approval !== 'approved') {
    throw new PreproductionError(`Asset ${asset.id} is not approved in project.json`);
  }
  return asset;
};

/**
 * Intake assets are not declared in project.json, so compilation is the only
 * point that can confirm the reviewed bytes are still the ones being bound.
 */
const verifyUndeclaredAssetBytes = (project: LoadedProject, assets: readonly ProjectAsset[]): void => {
  for (const asset of assets) {
    if (project.config.assets.some((entry) => entry.id === asset.id)) continue;
    const absolute = resolveProjectRelativePath(project.projectDir, asset.path);
    if (!existsSync(absolute)) {
      throw new PreproductionError(`Bound local asset ${asset.id} is missing at ${asset.path}`);
    }
    const computed = sha256File(absolute);
    if (computed !== asset.sha256) {
      throw new PreproductionError(
        `Bound local asset ${asset.id} changed since review: expected ${asset.sha256}, found ${computed}`,
      );
    }
  }
};

const secondsForFrames = (frames: number, fps: number): number => {
  const seconds = frames / fps;
  if (Math.abs(seconds * fps - frames) > 1e-6) {
    throw new PreproductionError(`In-point of ${frames} frames is not expressible at ${fps}fps`);
  }
  return seconds;
};

const sourceDurationSeconds = (
  project: LoadedProject,
  intake: AssetIntakeDocument | null,
  assetId: string,
): number | null => {
  const loaded = project.assets.find((asset) => asset.id === assetId);
  if (loaded?.videoMetadata) return loaded.videoMetadata.durationSeconds;
  const record = intake?.records.find((entry) => entry.assetId === assetId) ?? null;
  return record?.technical.durationSeconds ?? null;
};

const assertSourceCoversShot = (
  project: LoadedProject,
  intake: AssetIntakeDocument | null,
  shotId: string,
  video: VideoSourceConfig,
  shotLengthFrames: number,
  fps: number,
): void => {
  const available = sourceDurationSeconds(project, intake, video.assetId);
  if (available === null) return;
  const required = video.sourceStartSeconds + shotLengthFrames / fps;
  if (required > available + 1e-3) {
    throw new PreproductionError(
      `Shot ${shotId} needs ${required.toFixed(6)}s of video ${video.assetId} from ${video.sourceStartSeconds.toFixed(
        6,
      )}s but the reviewed probe reports ${available.toFixed(6)}s`,
    );
  }
};

const buildShotMediaConfig = (
  project: LoadedProject,
  intake: AssetIntakeDocument | null,
  shot: StoryboardShot,
  requirementById: ReadonlyMap<string, AssetRequirement>,
  fps: number,
): ShotMediaConfig | null => {
  const media = shot.media;
  if (!media) return null;
  const shotLength = shot.endFrame - shot.startFrame;
  const slotOwners = new Map<string, AssetRequirement>();
  for (const requirementId of shot.assetRequirementIds) {
    const requirement = requirementById.get(requirementId);
    if (!requirement || requirement.mediaSlot === null) continue;
    slotOwners.set(requirement.mediaSlot, requirement);
  }
  const backgroundRequirement = slotOwners.get(media.backgroundSlot);
  if (!backgroundRequirement) {
    throw new PreproductionError(
      `Shot ${shot.id} plans background slot ${media.backgroundSlot} with no bound requirement`,
    );
  }
  if (backgroundRequirement.kind !== 'video') {
    throw new PreproductionError(
      `Shot ${shot.id} background slot ${media.backgroundSlot} is a ${backgroundRequirement.kind} requirement; a video asset is required`,
    );
  }
  const backgroundAsset = resolveBoundAsset(project, backgroundRequirement, intake);
  if (!backgroundAsset) {
    throw new PreproductionError(
      `Shot ${shot.id} background slot ${media.backgroundSlot} is not fulfilled by an approved local asset`,
    );
  }
  if (backgroundAsset.kind !== 'video') {
    throw new PreproductionError(
      `Shot ${shot.id} background slot ${media.backgroundSlot} is bound to a ${backgroundAsset.kind} asset; an approved MP4/H.264 video is required`,
    );
  }
  const video: VideoSourceConfig = {
    assetId: backgroundAsset.id,
    sourceStartSeconds: secondsForFrames(media.sourceStartFrames, fps),
    fit: media.fit,
    endBehavior: 'reject',
    muted: true,
    positionX: media.positionX,
    positionY: media.positionY,
    scale: media.scale,
  };
  assertSourceCoversShot(project, intake, shot.id, video, shotLength, fps);
  if (media.kind === 'video') {
    if (shot.renderer !== 'video') {
      throw new PreproductionError(`Shot ${shot.id} plans video media on renderer ${shot.renderer}`);
    }
    return {kind: 'video', ...video} satisfies ShotVideoMedia;
  }
  if (shot.renderer !== 'hybrid') {
    throw new PreproductionError(`Shot ${shot.id} plans hybrid media on renderer ${shot.renderer}`);
  }
  const layers = media.layers.map((layer) => {
    const requirement = slotOwners.get(layer.slot);
    if (!requirement) {
      throw new PreproductionError(
        `Shot ${shot.id} plans layer slot ${layer.slot} with no bound requirement`,
      );
    }
    const asset = resolveBoundAsset(project, requirement, intake);
    if (!asset) {
      throw new PreproductionError(
        `Shot ${shot.id} layer slot ${layer.slot} is not fulfilled by an approved local asset`,
      );
    }
    if (asset.kind !== 'layer') {
      throw new PreproductionError(
        `Shot ${shot.id} layer slot ${layer.slot} is bound to a ${asset.kind} asset; a transparent PNG layer is required`,
      );
    }
    return {
      assetId: asset.id,
      order: layer.order,
      opacity: layer.opacity,
      fit: layer.fit,
      positionX: layer.positionX,
      positionY: layer.positionY,
      scale: layer.scale,
      visibleFromFrame: layer.visibleFromFrame,
      visibleToFrame: layer.visibleToFrame,
    };
  });
  return {
    kind: 'hybrid',
    video,
    layers,
    overlay: {kind: media.overlay.kind, intensity: media.overlay.intensity, color: media.overlay.color},
  } satisfies ShotHybridMedia;
};

export const buildCandidateProject = (input: {
  project: LoadedProject;
  storyboard: Storyboard;
  intake?: AssetIntakeDocument | null;
}): ProjectConfig => {
  const {project, storyboard} = input;
  const intake = input.intake ?? null;
  const requirementById = new Map(
    storyboard.assetRequirements.map((requirement) => [requirement.id, requirement]),
  );
  const extraAssets = new Map<string, ProjectAsset>();
  const fps = project.config.output.fps;

  const chapters = storyboard.chapters.map((chapter) => ({
    id: chapter.id,
    title: chapter.title,
    startFrame: chapter.startFrame,
    endFrame: chapter.endFrame,
    shots: chapter.shots.map((storyShot): Shot => {
      const params = {...storyShot.rendererParams};
      const plannedMedia = storyShot.media;
      for (const requirementId of storyShot.assetRequirementIds) {
        const requirement = requirementById.get(requirementId);
        if (!requirement) throw new PreproductionError(`Unknown asset requirement ${requirementId}`);
        if (requirement.mediaSlot !== null) {
          // Media slots are bound by buildShotMediaConfig below; their approved
          // intake assets still have to reach the candidate asset table so the
          // project validator can resolve the reference.
          const bound = resolveBoundAsset(project, requirement, intake);
          if (bound && !project.config.assets.some((asset) => asset.id === bound.id)) {
            extraAssets.set(bound.id, bound);
          }
          continue;
        }
        const bound = resolveBoundAsset(project, requirement, intake);
        if (bound && !project.config.assets.some((asset) => asset.id === bound.id)) {
          extraAssets.set(bound.id, bound);
        }
        if (requirement.kind === 'scene-module') {
          if (storyShot.renderer !== `project:${requirement.fulfilledAssetId}`) {
            throw new PreproductionError(
              `Scene-module requirement ${requirement.id} must be used by its declared module renderer`,
            );
          }
          continue;
        }
        if (requirement.kind === 'video' || requirement.kind === 'layer') {
          if (!plannedMedia) {
            throw new PreproductionError(
              `Requirement ${requirement.id} needs a typed Video/Hybrid media shot, which this plan does not define`,
            );
          }
          continue;
        }
        if (
          requirement.kind === 'image' ||
          (requirement.kind === 'existing-asset' && bound?.kind === 'image')
        ) {
          if (storyShot.renderer !== 'layered-canvas') {
            throw new PreproductionError(
              `Image requirement ${requirement.id} is only supported by the layered-canvas renderer`,
            );
          }
          if (!bound) {
            throw new PreproductionError(`Image requirement ${requirement.id} is not fulfilled`);
          }
          params.assetId = bound.id;
          continue;
        }
        if (requirement.kind === 'existing-asset') {
          if (isMediaRendererName(storyShot.renderer) && !plannedMedia) {
            throw new PreproductionError(
              `Requirement ${requirement.id} targets ${storyShot.renderer} without typed media planning`,
            );
          }
          continue;
        }
        throw new PreproductionError(
          `Requirement ${requirement.id} has unsupported kind ${requirement.kind}`,
        );
      }
      const media = buildShotMediaConfig(project, intake, storyShot, requirementById, fps);
      if (isMediaRendererName(storyShot.renderer)) {
        // The project validator rejects params.assetId on media renderers; media
        // references live only in the typed shot.media configuration.
        delete params.assetId;
        if (media === null) {
          throw new PreproductionError(
            `Shot ${storyShot.id} has no typed media for the ${storyShot.renderer} renderer`,
          );
        }
      }
      if (media && media.kind !== storyShot.renderer) {
        throw new PreproductionError(
          `Shot ${storyShot.id} media kind ${media.kind} does not match renderer ${storyShot.renderer}`,
        );
      }
      const shot: Shot = {
        id: storyShot.id,
        startFrame: storyShot.startFrame,
        endFrame: storyShot.endFrame,
        renderer: storyShot.renderer,
        params,
      };
      if (media) shot.media = media;
      return shot;
    }),
  }));

  const firstRenderer = chapters[0]?.shots[0]?.renderer ?? project.config.visual.defaultRenderer;
  const candidate: ProjectConfig = {
    ...project.config,
    audio: {...project.config.audio},
    lyrics: {...project.config.lyrics},
    narrative: {...project.config.narrative},
    visual: {
      ...project.config.visual,
      pixel: project.config.visual.pixel ? {...project.config.visual.pixel} : undefined,
      defaultRenderer: firstRenderer,
    },
    output: {
      ...project.config.output,
      durationInFrames: project.durationInFrames,
    },
    cues: project.config.cues.map((cue) => ({...cue})),
    chapters,
    sceneModules: project.config.sceneModules.map((module) => ({...module})),
    audioTracks: project.config.audioTracks.map((track) => ({
      ...track,
      gainAutomation: track.gainAutomation.map((point) => ({...point})),
    })),
    assets: [
      ...project.config.assets.map((asset) => ({...asset})),
      ...[...extraAssets.values()].map((asset) => ({...asset})),
    ],
    permissions: {...project.config.permissions},
    render: {...project.config.render},
  };
  if (storyboard.source.audioSha256 !== project.config.audio.sha256) {
    throw new PreproductionError('Storyboard audio hash does not match the master audio');
  }
  if (storyboard.source.fps !== project.config.output.fps) {
    throw new PreproductionError('Storyboard fps does not match the project');
  }
  if (storyboard.source.durationFrames !== project.durationInFrames) {
    throw new PreproductionError('Storyboard duration does not match the project');
  }
  verifyUndeclaredAssetBytes(project, [...extraAssets.values()]);
  const rendererKinds = new Set([
    ...DEFAULT_SCENE_REGISTRY.kinds(),
    ...project.sceneModules.map((module) => `project:${module.id}`),
  ]);
  validateProjectConfig(candidate, {rendererKinds});
  return candidate;
};

const requirementReport = (storyboard: Storyboard): AssetRequirement[] =>
  storyboard.assetRequirements.filter((requirement) =>
    storyboard.missingAssetRequirements.includes(requirement.id),
  );

export type CompileInput = {
  project: LoadedProject;
  storyboard: Storyboard;
  annotations: AnnotationDocument;
  lyrics: LyricsDocument | null;
  intake?: AssetIntakeDocument | null;
  continuity?: ContinuityDocument | null;
  boundary: WriteBoundary;
};

export const compileApprovedStoryboard = (
  input: CompileInput,
): {report: CompileReport; candidate: ProjectConfig | null} => {
  const intake = input.intake ?? null;
  const storyboard = validateStoryboard(
    input.storyboard,
    input.project,
    input.annotations,
    input.lyrics,
    intake,
    input.continuity ?? null,
  );
  if (storyboard.status !== 'approved') {
    throw new PreproductionError('Storyboard must be explicitly approved before compilation');
  }
  if (!storyboard.renderReady || storyboard.missingAssetRequirements.length > 0) {
    const missing: MissingAssetsReport = {
      schemaVersion: 1,
      projectId: input.project.config.projectId,
      storyboardRevision: storyboard.revision,
      status: 'blocked',
      missingAssetRequirements: [...storyboard.missingAssetRequirements],
      requirements: requirementReport(storyboard),
      notes: [
        'No candidate project was written. Fulfil and approve all required local assets, update the storyboard, and recompile.',
        'Draft plans may remain useful as production specifications, but they are not render-ready.',
      ],
    };
    const report: CompileReport = {
      schemaVersion: 1,
      projectId: input.project.config.projectId,
      storyboardRevision: storyboard.revision,
      status: 'blocked',
      candidatePath: null,
      missingAssetRequirements: [...storyboard.missingAssetRequirements],
      validation: 'not-run',
      notes: missing.notes,
    };
    writeProjectJson(input.boundary, PREPRODUCTION_PATHS.missingAssets, missing);
    writeProjectJson(input.boundary, PREPRODUCTION_PATHS.compileReport, report);
    return {report, candidate: null};
  }
  const candidate = buildCandidateProject({project: input.project, storyboard, intake});
  const candidateConfig: ProjectConfig = input.lyrics
    ? {
        ...candidate,
        lyrics: {language: input.lyrics.language, path: input.lyrics.sourcePath},
      }
    : candidate;
  validateProjectConfig(candidateConfig, {
    rendererKinds: new Set([
      ...DEFAULT_SCENE_REGISTRY.kinds(),
      ...input.project.sceneModules.map((module) => `project:${module.id}`),
    ]),
  });
  const candidatePath = writeProjectJson(
    input.boundary,
    PREPRODUCTION_PATHS.candidate,
    candidateConfig,
  );
  const mediaShots = candidateConfig.chapters
    .flatMap((chapter) => chapter.shots)
    .filter((shot) => shot.media);
  const report: CompileReport = {
    schemaVersion: 1,
    projectId: input.project.config.projectId,
    storyboardRevision: storyboard.revision,
    status: 'ready',
    candidatePath: PREPRODUCTION_PATHS.candidate,
    missingAssetRequirements: [],
    validation: 'passed',
    notes: [
      'Candidate configuration written separately; project.json was not overwritten.',
      `Typed media shots: ${mediaShots.map((shot) => `${shot.id}=${shot.media?.kind}`).join(', ') || 'none'}.`,
      `Candidate path: ${candidatePath}`,
    ],
  };
  writeProjectJson(input.boundary, PREPRODUCTION_PATHS.compileReport, report);
  return {report, candidate: candidateConfig};
};
