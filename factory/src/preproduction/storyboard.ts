import type {LoadedProject, ShotMediaConfig, Shot} from '../config/types';
import {PreproductionError} from '../errors';
import {DEFAULT_SCENE_REGISTRY} from '../scenes/registry';
import type {
  AnnotationDocument,
  AssetIntakeDocument,
  AssetRequirement,
  ContinuityDocument,
  DirectorPlan,
  LyricsDocument,
  PlanChapter,
  PlanShot,
  PlannedShotMedia,
  Storyboard,
  StoryboardChapter,
  StoryboardShot,
} from './types';
import {
  FATAL_CONTINUITY_CODES,
  checkContinuityUsage,
  validatePlannedMedia,
} from './validate';

const record = (value: unknown, field: string): Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new PreproductionError(`${field} must be an object`);
  }
  return value as Record<string, unknown>;
};

const integer = (value: unknown, field: string, minimum = 0): number => {
  if (!Number.isInteger(value) || (value as number) < minimum) {
    throw new PreproductionError(`${field} must be an integer >= ${minimum}`);
  }
  return value as number;
};

const text = (value: unknown, field: string): string => {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new PreproductionError(`${field} must be a non-empty string`);
  }
  return value;
};

const array = (value: unknown, field: string): unknown[] => {
  if (!Array.isArray(value)) throw new PreproductionError(`${field} must be an array`);
  return value;
};

const oneOf = <T extends string>(value: unknown, allowed: readonly T[], field: string): T => {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new PreproductionError(`${field} must be one of: ${allowed.join(', ')}`);
  }
  return value as T;
};

const optionalNullableText = (value: unknown, field: string): string | null => {
  if (value === null || value === undefined) return null;
  return text(value, field);
};

const TIMING_SOURCES = [
  'manual-bpm',
  'manual-beat',
  'manual-cut',
  'section',
  'approved-beat-grid',
  'project-cue',
  'lyric',
] as const;
const APPROVALS = ['draft', 'proposed', 'approved', 'rejected'] as const;

const isMediaRendererName = (renderer: string): boolean => renderer === 'video' || renderer === 'hybrid';

/**
 * A planned shot keeps its media intent so the compiler can bind an approved
 * asset later. Shot-local visibility is re-checked here because the shot range
 * is only known once the plan exists.
 */
const validatePlannedShotMedia = (
  value: unknown,
  renderer: string,
  field: string,
  shotLength: number,
): PlannedShotMedia | null => {
  if (!isMediaRendererName(renderer)) {
    if (value !== undefined && value !== null) {
      throw new PreproductionError(`${field}.media is only valid for video and hybrid shots`);
    }
    return null;
  }
  if (value === undefined || value === null) {
    throw new PreproductionError(`${field}.media is required for the ${renderer} shot`);
  }
  const media = validatePlannedMedia(value, renderer, `${field}.media`);
  if (media && media.kind === 'hybrid') {
    for (const layer of media.layers) {
      if (layer.visibleToFrame > shotLength) {
        throw new PreproductionError(
          `${field}.media layer ${layer.slot} is visible to frame ${layer.visibleToFrame}, beyond the shot length ${shotLength}`,
        );
      }
    }
  }
  return media;
};

const validateContinuityIdList = (value: unknown, field: string): string[] => {
  if (value === undefined || value === null) return [];
  const items = array(value, field);
  if (items.length > 32) throw new PreproductionError(`${field} must contain at most 32 entries`);
  const ids = items.map((item, index) => text(item, `${field}[${index}]`));
  if (new Set(ids).size !== ids.length) throw new PreproductionError(`${field} contains duplicate ids`);
  return ids;
};

const assertCoverage = (
  chapters: Array<{startFrame: number; endFrame: number; shots: Array<{startFrame: number; endFrame: number; id: string}>}>,
  durationInFrames: number,
  label: string,
): void => {
  if (chapters.length === 0) throw new PreproductionError(`${label} must contain chapters`);
  let cursor = 0;
  const ids = new Set<string>();
  for (const chapter of chapters) {
    if (chapter.startFrame !== cursor) {
      throw new PreproductionError(`${label} has a gap or overlap at frame ${cursor}`);
    }
    if (chapter.endFrame <= chapter.startFrame) {
      throw new PreproductionError(`${label} chapter range is invalid at frame ${cursor}`);
    }
    let shotCursor = chapter.startFrame;
    for (const shot of chapter.shots) {
      if (ids.has(shot.id)) throw new PreproductionError(`${label} contains duplicate shot id ${shot.id}`);
      ids.add(shot.id);
      if (shot.startFrame !== shotCursor || shot.endFrame <= shot.startFrame) {
        throw new PreproductionError(`${label} shots are not contiguous at frame ${shotCursor}`);
      }
      shotCursor = shot.endFrame;
    }
    if (shotCursor !== chapter.endFrame) {
      throw new PreproductionError(`${label} shots do not cover chapter ${chapter.startFrame}-${chapter.endFrame}`);
    }
    cursor = chapter.endFrame;
  }
  if (cursor !== durationInFrames) {
    throw new PreproductionError(`${label} must end at the project duration ${durationInFrames}`);
  }
};

export const validatePlan = (
  raw: unknown,
  project: LoadedProject,
  annotations: AnnotationDocument,
  lyrics: LyricsDocument | null,
): DirectorPlan => {
  const plan = record(raw, 'directorPlan');
  if (plan.schemaVersion !== 1) throw new PreproductionError('directorPlan.schemaVersion must be 1');
  if (text(plan.projectId, 'directorPlan.projectId') !== project.config.projectId) {
    throw new PreproductionError('directorPlan.projectId does not match the project');
  }
  if (!['draft', 'proposed', 'approved', 'rejected'].includes(plan.status as string)) {
    throw new PreproductionError('directorPlan.status is invalid');
  }
  integer(plan.revision, 'directorPlan.revision', 1);
  const source = record(plan.source, 'directorPlan.source');
  if (source.audioSha256 !== project.config.audio.sha256) {
    throw new PreproductionError('directorPlan.source audio hash does not match the master audio');
  }
  if (source.fps !== project.config.output.fps || source.durationFrames !== project.durationInFrames) {
    throw new PreproductionError('directorPlan.source fps/duration does not match the project');
  }
  const approvedGrid =
    source.approvedBeatGrid === null || source.approvedBeatGrid === undefined
      ? null
      : record(source.approvedBeatGrid, 'directorPlan.source.approvedBeatGrid');
  if (Boolean(source.approvedBeatGridUsed) !== (approvedGrid !== null)) {
    throw new PreproductionError(
      'directorPlan.source.approvedBeatGridUsed must match the presence of an approved beat grid',
    );
  }
  const approvedBeatIds = new Set(
    approvedGrid
      ? array(approvedGrid.selectedBeatIds, 'directorPlan.source.approvedBeatGrid.selectedBeatIds').map(
          (id, index) => text(id, `directorPlan.source.approvedBeatGrid.selectedBeatIds[${index}]`),
        )
      : [],
  );
  const chapters = array(plan.chapters, 'directorPlan.chapters').map((value, chapterIndex) => {
    const chapterField = `directorPlan.chapters[${chapterIndex}]`;
    const chapter = record(value, chapterField);
    const shots = array(chapter.shots, `${chapterField}.shots`).map(
      (shotValue, shotIndex) => {
        const field = `${chapterField}.shots[${shotIndex}]`;
        const shot = record(shotValue, field);
        const startFrame = integer(shot.startFrame, `${field}.startFrame`);
        const endFrame = integer(shot.endFrame, `${field}.endFrame`);
        if (endFrame <= startFrame) throw new PreproductionError(`${field} range is invalid`);
        const renderer = text(shot.renderer, `${field}.renderer`);
        const known =
          DEFAULT_SCENE_REGISTRY.kinds().includes(renderer) ||
          project.sceneModules.some((module) => renderer === `project:${module.id}`);
        if (!known) throw new PreproductionError(`${field}.renderer is not available`);
        const assetRequirementIds = shot.assetRequirementIds === undefined
          ? []
          : array(shot.assetRequirementIds, `${field}.assetRequirementIds`).map((id, index) =>
              text(id, `${field}.assetRequirementIds[${index}]`),
            );
        const sourceFrame =
          shot.sourceFrame === null || shot.sourceFrame === undefined
            ? null
            : integer(shot.sourceFrame, `${field}.sourceFrame`);
        const cueId = optionalNullableText(shot.cueId, `${field}.cueId`);
        const rendererParams = record(shot.rendererParams, `${field}.rendererParams`);
        const timingSource = oneOf(shot.timingSource, TIMING_SOURCES, `${field}.timingSource`);
        const continuityIds = validateContinuityIdList(shot.continuityIds, `${field}.continuityIds`);
        const media = validatePlannedShotMedia(shot.media, renderer, field, endFrame - startFrame);
        if (timingSource === 'approved-beat-grid' && (cueId === null || !approvedBeatIds.has(cueId))) {
          throw new PreproductionError(
            `${field} claims approved beat-grid timing without referencing a beat id from the approved candidate`,
          );
        }
        const reviewStatus = oneOf(shot.reviewStatus, APPROVALS, `${field}.reviewStatus`);
        const characterReferences = shot.characterReferences === undefined
          ? []
          : array(shot.characterReferences, `${field}.characterReferences`).map((item, index) =>
              text(item, `${field}.characterReferences[${index}]`),
            );
        const continuityReferences = shot.continuityReferences === undefined
          ? []
          : array(shot.continuityReferences, `${field}.continuityReferences`).map((item, index) =>
              text(item, `${field}.continuityReferences[${index}]`),
            );
        const assumptions = shot.assumptions === undefined
          ? []
          : array(shot.assumptions, `${field}.assumptions`).map((item, index) =>
              text(item, `${field}.assumptions[${index}]`),
            );
        return {
          ...(shot as unknown as PlanShot),
          id: text(shot.id, `${field}.id`),
          purpose: text(shot.purpose, `${field}.purpose`),
          visualDescription: text(shot.visualDescription, `${field}.visualDescription`),
          startFrame,
          endFrame,
          renderer,
          rendererParams,
          camera: text(shot.camera, `${field}.camera`),
          movement: text(shot.movement, `${field}.movement`),
          colorAndLighting: text(shot.colorAndLighting, `${field}.colorAndLighting`),
          environmentReference: text(shot.environmentReference, `${field}.environmentReference`),
          timingRationale: text(shot.timingRationale, `${field}.timingRationale`),
          timingSource,
          sourceFrame,
          cueId,
          assetRequirementIds,
          continuityIds,
          media,
          characterReferences,
          continuityReferences,
          assumptions,
          reviewStatus,
        };
      },
    );
    return {
      ...(chapter as unknown as PlanChapter),
      id: text(chapter.id, `${chapterField}.id`),
      title: text(chapter.title, `${chapterField}.title`),
      label: text(chapter.label, `${chapterField}.label`),
      sectionId: optionalNullableText(chapter.sectionId, `${chapterField}.sectionId`),
      startFrame: integer(chapter.startFrame, `${chapterField}.startFrame`),
      endFrame: integer(chapter.endFrame, `${chapterField}.endFrame`),
      shots,
    };
  });
  assertCoverage(chapters, project.durationInFrames, 'directorPlan');
  const planIds = new Set(
    array(plan.assetRequirements ?? [], 'directorPlan.assetRequirements').map((value, index) => {
      const requirement = record(value, `directorPlan.assetRequirements[${index}]`);
      return text(requirement.id, `directorPlan.assetRequirements[${index}].id`);
    }),
  );
  for (const chapter of chapters) {
    for (const shot of chapter.shots) {
      for (const id of shot.assetRequirementIds) {
        if (!planIds.has(id)) {
          throw new PreproductionError(`shot ${shot.id} references unknown asset requirement ${id}`);
        }
      }
    }
  }
  void annotations;
  void lyrics;
  return {...(plan as unknown as DirectorPlan), chapters};
};

export type Fulfillment = {
  fulfilled: boolean;
  reason: string;
  assetId: string | null;
  path: string | null;
  sha256: string | null;
};

const unfulfilled = (reason: string): Fulfillment => ({
  fulfilled: false,
  reason,
  assetId: null,
  path: null,
  sha256: null,
});

/**
 * An approved local asset intake is the normal fulfilment route: the bytes were
 * probed and reviewed explicitly, and the record still has to match the
 * requirement fingerprint so a re-cut shot cannot inherit an old attachment.
 * A manually edited requirement remains supported for compatibility.
 */
const requirementState = (
  requirement: AssetRequirement,
  project: LoadedProject,
  intake: AssetIntakeDocument | null,
): Fulfillment => {
  const record = intake?.records.find((entry) => entry.requirementId === requirement.id) ?? null;
  if (record) {
    if (record.review === 'pending') return unfulfilled('asset intake is awaiting explicit review');
    if (record.review === 'rejected') return unfulfilled('asset intake was rejected');
    if (record.fingerprint !== requirement.fingerprint) {
      return unfulfilled('stale fulfillment record: the requirement changed after attachment');
    }
    if (record.kind !== requirement.kind && !(record.kind === 'layer' && requirement.kind === 'image')) {
      return unfulfilled(`intake asset kind ${record.kind} does not match requirement kind ${requirement.kind}`);
    }
    const asset = project.assets.find((entry) => entry.id === record.assetId);
    if (asset && asset.approval !== 'approved') {
      return unfulfilled(`project asset ${asset.id} is not approved`);
    }
    return {
      fulfilled: true,
      reason: 'approved local asset intake',
      assetId: record.assetId,
      path: record.path,
      sha256: record.sha256,
    };
  }
  if (requirement.status === 'rejected') return unfulfilled('rejected requirement');
  if (requirement.status !== 'approved') return unfulfilled(`status is ${requirement.status}`);
  if (!requirement.fulfilledAssetId) return unfulfilled('no fulfilled asset ID');
  if (requirement.kind === 'scene-module') {
    const module = project.sceneModules.find((entry) => entry.id === requirement.fulfilledAssetId);
    return module
      ? {...{reason: 'declared scene module', assetId: requirement.fulfilledAssetId, path: null, sha256: null}, fulfilled: true}
      : unfulfilled('scene module is not declared');
  }
  const asset = project.assets.find((entry) => entry.id === requirement.fulfilledAssetId);
  if (!asset) return unfulfilled('fulfilled asset does not exist');
  if (asset.approval !== 'approved') return unfulfilled('fulfilled asset is not approved');
  if (
    requirement.kind !== 'existing-asset' &&
    asset.kind !== requirement.kind &&
    !(requirement.kind === 'image' && asset.kind === 'image')
  ) {
    return unfulfilled(`asset kind ${asset.kind} does not match ${requirement.kind}`);
  }
  return {
    fulfilled: true,
    reason: 'approved asset',
    assetId: asset.id,
    path: asset.path,
    sha256: asset.sha256,
  };
};

const rendererReadyFor = (shot: PlanShot, project: LoadedProject): boolean => {
  const builtInCanvas = ['pixel-canvas', 'layered-canvas'].includes(shot.renderer);
  const moduleCanvas = project.sceneModules.some((module) => shot.renderer === `project:${module.id}`);
  // A Video/Hybrid shot is renderer-ready only while it carries typed planned
  // media; unfulfilled slots still block the storyboard through requirements.
  const mediaReady = isMediaRendererName(shot.renderer) && shot.media !== null && shot.media !== undefined;
  return builtInCanvas || moduleCanvas || mediaReady;
};

/**
 * Every slot named by a shot's planned media must be covered by exactly one
 * requirement, otherwise the compiler could bind an asset to the wrong layer.
 */
const assertMediaSlots = (shot: PlanShot, requirements: readonly AssetRequirement[]): void => {
  if (!shot.media) return;
  const slots = [
    shot.media.backgroundSlot,
    ...(shot.media.kind === 'hybrid' ? shot.media.layers.map((layer) => layer.slot) : []),
  ];
  for (const slot of slots) {
    const matches = requirements.filter(
      (requirement) =>
        requirement.mediaSlot === slot && requirement.shotIds.includes(shot.id),
    );
    if (matches.length === 0) {
      throw new PreproductionError(
        `Shot ${shot.id} plans media slot ${slot} with no asset requirement; the storyboard cannot bind it`,
      );
    }
    if (matches.length > 1) {
      throw new PreproductionError(
        `Shot ${shot.id} media slot ${slot} is claimed by ${matches.length} requirements`,
      );
    }
  }
};

export type StoryboardBuildInput = {
  project: LoadedProject;
  plan: DirectorPlan;
  annotations: AnnotationDocument;
  lyrics: LyricsDocument | null;
  intake?: AssetIntakeDocument | null;
  continuity?: ContinuityDocument | null;
  revision: number;
  status?: 'draft' | 'approved';
};

const applyContinuity = (
  document: ContinuityDocument | null,
  shots: Array<{id: string; continuityIds: string[]}>,
): void => {
  if (document === null) {
    const declared = shots.filter((shot) => shot.continuityIds.length > 0);
    if (declared.length > 0) {
      throw new PreproductionError(
        `Shots ${declared.map((shot) => shot.id).join(', ')} reference continuity but the project has no continuity.json`,
      );
    }
    return;
  }
  const findings = checkContinuityUsage(document, shots);
  const fatal = findings.filter((finding) => FATAL_CONTINUITY_CODES.includes(finding.code));
  if (fatal.length > 0) {
    throw new PreproductionError(
      `Continuity validation failed: ${fatal.map((finding) => finding.message).join('; ')}`,
    );
  }
};

export const buildStoryboard = (input: StoryboardBuildInput): Storyboard => {
  const plan = validatePlan(input.plan, input.project, input.annotations, input.lyrics);
  const intake = input.intake ?? null;
  const allShots = plan.chapters.flatMap((chapter) => chapter.shots);
  for (const shot of allShots) {
    assertMediaSlots(shot, plan.assetRequirements);
  }
  applyContinuity(input.continuity ?? null, allShots);
  const requirementsById = new Map(plan.assetRequirements.map((requirement) => [requirement.id, requirement]));
  const fulfillment = new Map(
    plan.assetRequirements.map((requirement) => [
      requirement.id,
      requirementState(requirement, input.project, intake),
    ]),
  );
  const chapters: StoryboardChapter[] = plan.chapters.map((chapter) => ({
    ...chapter,
    shots: chapter.shots.map((shot): StoryboardShot => {
      const cueIds = input.project.config.cues
        .filter((cue) => cue.frame >= shot.startFrame && cue.frame < shot.endFrame)
        .map((cue) => cue.id);
      const cutCueIds = input.annotations.cutCues
        .filter((cue) => cue.approval === 'approved' && cue.frame >= shot.startFrame && cue.frame < shot.endFrame)
        .map((cue) => cue.id);
      const lyricLineIds = (input.lyrics?.lines ?? [])
        .filter((line) => line.frame >= shot.startFrame && line.frame < shot.endFrame)
        .map((line) => line.id);
      const missingAssetRequirements = shot.assetRequirementIds.filter(
        (id) => !requirementsById.get(id) || !fulfillment.get(id)?.fulfilled,
      );
      return {
        ...shot,
        cueIds,
        cutCueIds,
        lyricLineIds,
        missingAssetRequirements,
        rendererReady: missingAssetRequirements.length === 0 && rendererReadyFor(shot, input.project),
      };
    }),
  }));
  const missingAssetRequirements = [...new Set(
    chapters.flatMap((chapter) => chapter.shots.flatMap((shot) => shot.missingAssetRequirements)),
  )];
  return {
    schemaVersion: 1,
    projectId: input.project.config.projectId,
    revision: input.revision,
    planRevision: plan.revision,
    status: input.status ?? 'draft',
    source: {
      audioSha256: input.project.config.audio.sha256,
      durationFrames: input.project.durationInFrames,
      fps: input.project.config.output.fps,
      beatGridUsed: plan.source.beatGridUsed,
      manualTimingUsed: plan.source.manualTimingUsed,
    },
    chapters,
    assetRequirements: plan.assetRequirements.map((requirement) => ({
      ...requirement,
      shotIds: [...requirement.shotIds],
    })),
    renderReady:
      missingAssetRequirements.length === 0 &&
      chapters.every((chapter) => chapter.shots.every((shot) => shot.rendererReady)),
    missingAssetRequirements,
    timingNotes: [...plan.timingNotes],
    reviewNotes: [...plan.reviewNotes],
  };
};

export const validateStoryboard = (
  raw: unknown,
  project: LoadedProject,
  annotations: AnnotationDocument,
  lyrics: LyricsDocument | null,
  intake: AssetIntakeDocument | null = null,
  continuity: ContinuityDocument | null = null,
): Storyboard => {
  const storyboard = record(raw, 'storyboard');
  if (storyboard.schemaVersion !== 1) throw new PreproductionError('storyboard.schemaVersion must be 1');
  if (text(storyboard.projectId, 'storyboard.projectId') !== project.config.projectId) {
    throw new PreproductionError('storyboard.projectId does not match the project');
  }
  if (!['draft', 'approved', 'rejected'].includes(storyboard.status as string)) {
    throw new PreproductionError('storyboard.status is invalid');
  }
  integer(storyboard.revision, 'storyboard.revision', 1);
  integer(storyboard.planRevision, 'storyboard.planRevision', 1);
  const requirementsRaw = array(storyboard.assetRequirements ?? [], 'storyboard.assetRequirements');
  const requirements = requirementsRaw.map((value, index) => {
    const requirement = record(value, `storyboard.assetRequirements[${index}]`);
    const id = text(requirement.id, `storyboard.assetRequirements[${index}].id`);
    const status = requirement.status;
    if (!['needed', 'in-production', 'available', 'approved', 'rejected'].includes(status as string)) {
      throw new PreproductionError(`storyboard.assetRequirements[${index}].status is invalid`);
    }
    return {...(requirement as unknown as AssetRequirement), id};
  });
  const requirementIds = new Set(requirements.map((requirement) => requirement.id));
  const chapters = array(storyboard.chapters, 'storyboard.chapters').map((value, chapterIndex) => {
    const chapter = record(value, `storyboard.chapters[${chapterIndex}]`);
    const shots = array(chapter.shots, `storyboard.chapters[${chapterIndex}].shots`).map(
      (shotValue, shotIndex) => {
        const field = `storyboard.chapters[${chapterIndex}].shots[${shotIndex}]`;
        const shot = record(shotValue, field);
        const startFrame = integer(shot.startFrame, `${field}.startFrame`);
        const endFrame = integer(shot.endFrame, `${field}.endFrame`);
        if (endFrame <= startFrame) throw new PreproductionError(`${field} range is invalid`);
        const renderer = text(shot.renderer, `${field}.renderer`);
        const known =
          DEFAULT_SCENE_REGISTRY.kinds().includes(renderer) ||
          project.sceneModules.some((module) => renderer === `project:${module.id}`);
        if (!known) throw new PreproductionError(`${field}.renderer is not available`);
        const requirementRefs = shot.assetRequirementIds === undefined
          ? []
          : array(shot.assetRequirementIds, `${field}.assetRequirementIds`).map((id, index) =>
              text(id, `${field}.assetRequirementIds[${index}]`),
            );
        for (const id of requirementRefs) {
          if (!requirementIds.has(id)) throw new PreproductionError(`${field} references unknown requirement ${id}`);
        }
        const continuityIds = validateContinuityIdList(shot.continuityIds, `${field}.continuityIds`);
        const media = validatePlannedShotMedia(shot.media, renderer, field, endFrame - startFrame);
        return {
          ...(shot as unknown as StoryboardShot),
          startFrame,
          endFrame,
          renderer,
          assetRequirementIds: requirementRefs,
          continuityIds,
          media,
          cueIds: shot.cueIds === undefined ? [] : array(shot.cueIds, `${field}.cueIds`).map((id, index) => text(id, `${field}.cueIds[${index}]`)),
          cutCueIds: shot.cutCueIds === undefined ? [] : array(shot.cutCueIds, `${field}.cutCueIds`).map((id, index) => text(id, `${field}.cutCueIds[${index}]`)),
          lyricLineIds: shot.lyricLineIds === undefined ? [] : array(shot.lyricLineIds, `${field}.lyricLineIds`).map((id, index) => text(id, `${field}.lyricLineIds[${index}]`)),
          missingAssetRequirements: shot.missingAssetRequirements === undefined ? [] : array(shot.missingAssetRequirements, `${field}.missingAssetRequirements`).map((id, index) => text(id, `${field}.missingAssetRequirements[${index}]`)),
        };
      },
    );
    return {
      ...(chapter as unknown as StoryboardChapter),
      startFrame: integer(chapter.startFrame, `storyboard.chapters[${chapterIndex}].startFrame`),
      endFrame: integer(chapter.endFrame, `storyboard.chapters[${chapterIndex}].endFrame`),
      shots,
    };
  });
  assertCoverage(chapters, project.durationInFrames, 'storyboard');
  const flatShots = chapters.flatMap((chapter) => chapter.shots);
  for (const shot of flatShots) {
    assertMediaSlots(shot, requirements);
  }
  applyContinuity(continuity, flatShots);
  const knownCues = new Set(project.config.cues.map((cue) => cue.id));
  const knownCuts = new Set(
    annotations.cutCues.filter((cue) => cue.approval === 'approved').map((cue) => cue.id),
  );
  const knownLyrics = new Set(
    (lyrics?.lines ?? []).filter((line) => line.approval === 'approved').map((line) => line.id),
  );
  for (const chapter of chapters) {
    for (const shot of chapter.shots) {
      for (const id of shot.cueIds) {
        if (!knownCues.has(id)) throw new PreproductionError(`shot ${shot.id} references unknown project cue ${id}`);
      }
      for (const id of shot.cutCueIds) {
        if (!knownCuts.has(id)) throw new PreproductionError(`shot ${shot.id} references unknown manual cut cue ${id}`);
      }
      for (const id of shot.lyricLineIds) {
        if (!knownLyrics.has(id)) throw new PreproductionError(`shot ${shot.id} references unknown lyric line ${id}`);
      }
    }
  }
  const fulfillmentById = new Map(
    requirements.map((requirement) => [requirement.id, requirementState(requirement, project, intake)]),
  );
  const computedMissing = [...new Set(
    requirements
      .filter((requirement) => !fulfillmentById.get(requirement.id)?.fulfilled)
      .map((requirement) => requirement.id),
  )];
  const missing = storyboard.missingAssetRequirements === undefined
    ? computedMissing
    : array(storyboard.missingAssetRequirements, 'storyboard.missingAssetRequirements').map((id, index) =>
        text(id, `storyboard.missingAssetRequirements[${index}]`),
      );
  for (const id of computedMissing) {
    if (!missing.includes(id)) {
      throw new PreproductionError(`storyboard.missingAssetRequirements must include ${id}`);
    }
  }
  if (storyboard.renderReady === true && computedMissing.length > 0) {
    throw new PreproductionError('storyboard cannot be renderReady while asset requirements are missing');
  }
  // Readiness is recomputed from live fulfillment so an approved storyboard
  // becomes render-ready once its assets are attached and reviewed, without
  // rewriting the approved document.
  const renderReady =
    computedMissing.length === 0 &&
    chapters.every((chapter) =>
      chapter.shots.every((shot) => {
        const shotMissing = shot.assetRequirementIds.filter(
          (id) => !fulfillmentById.get(id)?.fulfilled,
        );
        return shotMissing.length === 0 && rendererReadyFor(shot, project);
      }),
    );
  return {
    ...(storyboard as unknown as Storyboard),
    chapters: chapters.map((chapter) => ({
      ...chapter,
      shots: chapter.shots.map((shot) => ({
        ...shot,
        missingAssetRequirements: shot.assetRequirementIds.filter(
          (id) => !fulfillmentById.get(id)?.fulfilled,
        ),
        rendererReady:
          shot.assetRequirementIds.every((id) => fulfillmentById.get(id)?.fulfilled) &&
          rendererReadyFor(shot, project),
      })),
    })),
    assetRequirements: requirements,
    missingAssetRequirements: computedMissing,
    renderReady,
  };
};