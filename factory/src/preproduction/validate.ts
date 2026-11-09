import {PreproductionError} from '../errors';
import type {CameraMoveConfig, MediaFit, ProjectAsset, ProjectAssetKind} from '../config/types';
import type {
  AnnotationDocument,
  ApprovedBeatGrid,
  ApprovalStatus,
  AssetIntakeDocument,
  AssetIntakeRecord,
  AssetIntakeReview,
  AssetRequirement,
  BeatGridInterpretation,
  BeatGridReport,
  ContinuityDocument,
  ContinuityEntry,
  ContinuityFinding,
  CreativeBrief,
  CreativeBriefAssetNeed,
  CreativeBriefPacing,
  CreativeBriefRendererDirective,
  LyricsDocument,
  LyricLine,
  ManualBeatAnchor,
  ManualBpm,
  ManualCutCue,
  PlannedHybridLayer,
  PlannedLayerMotion,
  PlannedParallaxCharacter,
  PlannedParallaxLayer,
  PlannedParallaxMedia,
  PlannedParallaxPose,
  PlannedShotMedia,
  SectionAnnotation,
} from './types';
import {BEAT_GRID_ALGORITHM_VERSION, CONTINUITY_SCHEMA_VERSION, ASSET_INTAKE_SCHEMA_VERSION} from './types';

const MEDIA_FITS: readonly ['contain', 'cover'] = ['contain', 'cover'];
const CONTINUITY_KINDS = [
  'character',
  'location',
  'appearance',
  'prop',
  'style',
  'palette',
  'lighting',
  'camera',
] as const;

export type PreproductionContext = {
  projectId: string;
  fps: number;
  durationInFrames: number;
  width: number;
  height: number;
  assets: ProjectAsset[];
  rendererKinds: ReadonlySet<string>;
  sections?: SectionAnnotation[];
};

const APPROVALS: readonly ApprovalStatus[] = ['draft', 'proposed', 'approved', 'rejected'];
const BEAT_INTERPRETATIONS: readonly BeatGridInterpretation[] = ['as-estimated', 'half-tempo'];
const SOURCE_KINDS = ['user'] as const;
const NARRATIVE_MODES = ['narrative', 'abstract', 'lyric', 'hybrid'] as const;
const ASSET_KINDS = ['image', 'video', 'layer', 'scene-module', 'existing-asset'] as const;
const ID_PATTERN = /^[a-z0-9][a-z0-9-]{2,63}$/;

function fail(message: string): never {
  throw new PreproductionError(message);
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const record = (value: unknown, field: string): Record<string, unknown> => {
  if (!isRecord(value)) fail(`${field} must be an object`);
  return value;
};

const text = (value: unknown, field: string): string => {
  if (typeof value !== 'string' || value.trim() === '') fail(`${field} must be a non-empty string`);
  return value;
};

const optionalText = (value: unknown, field: string): string | undefined =>
  value === undefined ? undefined : text(value, field);

const integer = (value: unknown, field: string, minimum = 0): number => {
  if (!Number.isInteger(value) || (value as number) < minimum) {
    fail(`${field} must be an integer >= ${minimum}`);
  }
  return value as number;
};

const number = (value: unknown, field: string): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(`${field} must be finite`);
  return value;
};

const boolean = (value: unknown, field: string): boolean => {
  if (typeof value !== 'boolean') fail(`${field} must be a boolean`);
  return value;
};

const array = (value: unknown, field: string): unknown[] => {
  if (!Array.isArray(value)) fail(`${field} must be an array`);
  return value;
};

const textArray = (value: unknown, field: string, maximum = 64): string[] => {
  if (value === undefined) return [];
  const items = array(value, field);
  if (items.length > maximum) fail(`${field} must contain at most ${maximum} entries`);
  return items.map((item, index) => text(item, `${field}[${index}]`));
};

const oneOf = <T extends string>(value: unknown, allowed: readonly T[], field: string): T => {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    fail(`${field} must be one of: ${allowed.join(', ')}`);
  }
  return value as T;
};

const approval = (value: unknown, field: string): ApprovalStatus =>
  oneOf(value, APPROVALS, field);

const userSource = (value: unknown, field: string): 'user' => {
  if (value !== 'user') fail(`${field} must be "user" for manual annotations`);
  return 'user';
};

const assertKeys = (value: Record<string, unknown>, allowed: readonly string[], field: string): void => {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) fail(`${field} contains unsupported key ${key}`);
  }
};

const uniqueIds = (items: Array<{id: string}>, field: string): void => {
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.id)) fail(`${field} contains duplicate id ${item.id}`);
    seen.add(item.id);
  }
};

const assertFrameTime = (frame: number, timeSeconds: number, fps: number, field: string): void => {
  if (timeSeconds < 0) fail(`${field}.timeSeconds must be non-negative`);
  if (Math.abs(frame / fps - timeSeconds) > 1 / (2 * fps) + 1e-9) {
    fail(`${field} frame/time disagree: ${frame}/${fps} != ${timeSeconds}`);
  }
};

const validateManualBpm = (value: unknown): ManualBpm | null => {
  if (value === null || value === undefined) return null;
  const item = record(value, 'annotations.bpm');
  assertKeys(item, ['value', 'source', 'approval', 'notes'], 'annotations.bpm');
  const result: ManualBpm = {
    value: number(item.value, 'annotations.bpm.value'),
    source: userSource(item.source, 'annotations.bpm.source'),
    approval: approval(item.approval, 'annotations.bpm.approval'),
  };
  if (result.value < 1 || result.value > 400) fail('annotations.bpm.value must be in [1, 400]');
  const notes = optionalText(item.notes, 'annotations.bpm.notes');
  if (notes !== undefined) result.notes = notes;
  return result;
};

const validateBeatAnchor = (value: unknown, index: number, context: PreproductionContext): ManualBeatAnchor => {
  const field = `annotations.beatAnchors[${index}]`;
  const item = record(value, field);
  assertKeys(item, ['id', 'frame', 'timeSeconds', 'source', 'approval', 'notes'], field);
  const frame = integer(item.frame, `${field}.frame`);
  if (frame >= context.durationInFrames) fail(`${field}.frame must be inside the project duration`);
  const timeSeconds = number(item.timeSeconds, `${field}.timeSeconds`);
  assertFrameTime(frame, timeSeconds, context.fps, field);
  const result: ManualBeatAnchor = {
    id: text(item.id, `${field}.id`),
    frame,
    timeSeconds,
    source: userSource(item.source, `${field}.source`),
    approval: approval(item.approval, `${field}.approval`),
  };
  const notes = optionalText(item.notes, `${field}.notes`);
  if (notes !== undefined) result.notes = notes;
  return result;
};

const validateCutCue = (value: unknown, index: number, context: PreproductionContext): ManualCutCue => {
  const field = `annotations.cutCues[${index}]`;
  const item = record(value, field);
  assertKeys(item, ['id', 'frame', 'timeSeconds', 'label', 'source', 'approval', 'notes'], field);
  const frame = integer(item.frame, `${field}.frame`);
  if (frame >= context.durationInFrames) fail(`${field}.frame must be inside the project duration`);
  const timeSeconds = number(item.timeSeconds, `${field}.timeSeconds`);
  assertFrameTime(frame, timeSeconds, context.fps, field);
  const result: ManualCutCue = {
    id: text(item.id, `${field}.id`),
    frame,
    timeSeconds,
    label: text(item.label, `${field}.label`),
    source: userSource(item.source, `${field}.source`),
    approval: approval(item.approval, `${field}.approval`),
  };
  const notes = optionalText(item.notes, `${field}.notes`);
  if (notes !== undefined) result.notes = notes;
  return result;
};

const validateSection = (value: unknown, index: number, context: PreproductionContext): SectionAnnotation => {
  const field = `annotations.sections[${index}]`;
  const item = record(value, field);
  assertKeys(item, ['id', 'label', 'startFrame', 'endFrame', 'source', 'approval', 'notes'], field);
  const startFrame = integer(item.startFrame, `${field}.startFrame`);
  const endFrame = integer(item.endFrame, `${field}.endFrame`);
  if (endFrame <= startFrame) fail(`${field} must satisfy startFrame < endFrame`);
  if (endFrame > context.durationInFrames) fail(`${field}.endFrame exceeds the project duration`);
  const result: SectionAnnotation = {
    id: text(item.id, `${field}.id`),
    label: text(item.label, `${field}.label`),
    startFrame,
    endFrame,
    source: userSource(item.source, `${field}.source`),
    approval: approval(item.approval, `${field}.approval`),
  };
  const notes = optionalText(item.notes, `${field}.notes`);
  if (notes !== undefined) result.notes = notes;
  return result;
};

export const validateAnnotations = (
  raw: unknown,
  context: PreproductionContext,
  options: {requireApproved?: boolean; requireCoverage?: boolean} = {},
): AnnotationDocument => {
  const document = record(raw, 'annotations');
  assertKeys(document, ['schemaVersion', 'projectId', 'bpm', 'beatAnchors', 'cutCues', 'sections'], 'annotations');
  if (document.schemaVersion !== 1) fail('annotations.schemaVersion must be 1');
  if (text(document.projectId, 'annotations.projectId') !== context.projectId) {
    fail(`annotations.projectId must be ${context.projectId}`);
  }
  const bpm = validateManualBpm(document.bpm);
  const rawAnchors = document.beatAnchors === undefined ? [] : array(document.beatAnchors, 'annotations.beatAnchors');
  const rawCuts = document.cutCues === undefined ? [] : array(document.cutCues, 'annotations.cutCues');
  const rawSections = document.sections === undefined ? [] : array(document.sections, 'annotations.sections');
  if (rawAnchors.length > 512) fail('annotations.beatAnchors must contain at most 512 entries');
  if (rawCuts.length > 256) fail('annotations.cutCues must contain at most 256 entries');
  if (rawSections.length > 64) fail('annotations.sections must contain at most 64 entries');

  const beatAnchors = rawAnchors.map((item, index) => validateBeatAnchor(item, index, context));
  const cutCues = rawCuts.map((item, index) => validateCutCue(item, index, context));
  const sections = rawSections.map((item, index) => validateSection(item, index, context));
  uniqueIds(beatAnchors, 'annotations.beatAnchors');
  uniqueIds(cutCues, 'annotations.cutCues');
  uniqueIds(sections, 'annotations.sections');
  for (let index = 1; index < beatAnchors.length; index++) {
    if (beatAnchors[index].frame <= beatAnchors[index - 1].frame) {
      fail('annotations.beatAnchors must have strictly increasing frames');
    }
  }
  for (let index = 1; index < cutCues.length; index++) {
    if (cutCues[index].frame <= cutCues[index - 1].frame) {
      fail('annotations.cutCues must have strictly increasing frames');
    }
  }
  for (let index = 1; index < sections.length; index++) {
    if (sections[index].startFrame < sections[index - 1].endFrame) {
      fail('annotations.sections must not overlap');
    }
  }
  if (options.requireCoverage) {
    if (sections.length === 0) fail('annotations.sections are required for a render-ready storyboard');
    if (sections[0].startFrame !== 0) fail('annotations.sections must start at frame 0');
    if (sections[sections.length - 1].endFrame !== context.durationInFrames) {
      fail('annotations.sections must end at the project duration');
    }
    for (let index = 1; index < sections.length; index++) {
      if (sections[index].startFrame !== sections[index - 1].endFrame) {
        fail('annotations.sections contain a gap or overlap');
      }
    }
  }
  if (options.requireApproved) {
    if (bpm && bpm.approval !== 'approved') fail('annotations.bpm must be approved');
    if (beatAnchors.some((entry) => entry.approval !== 'approved')) {
      fail('annotations.beatAnchors must all be approved');
    }
    if (cutCues.some((entry) => entry.approval !== 'approved')) {
      fail('annotations.cutCues must all be approved');
    }
    if (sections.some((entry) => entry.approval !== 'approved')) {
      fail('annotations.sections must all be approved');
    }
  }
  return {schemaVersion: 1, projectId: context.projectId, bpm, beatAnchors, cutCues, sections};
};

const parseAspectRatio = (value: string): number => {
  const match = value.match(/^(\d+):(\d+)$/);
  if (!match) fail('creativeBrief.aspectRatio must look like W:H');
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!(width > 0) || !(height > 0)) fail('creativeBrief.aspectRatio must be positive');
  return width / height;
};

const validatePacing = (value: unknown): CreativeBriefPacing => {
  const pacing = record(value, 'creativeBrief.pacing');
  assertKeys(
    pacing,
    ['preferredShotFrames', 'minShotFrames', 'maxShotFrames', 'allowBeatCuts'],
    'creativeBrief.pacing',
  );
  const result: CreativeBriefPacing = {
    preferredShotFrames: integer(pacing.preferredShotFrames, 'creativeBrief.pacing.preferredShotFrames', 1),
    minShotFrames: integer(pacing.minShotFrames, 'creativeBrief.pacing.minShotFrames', 1),
    maxShotFrames: integer(pacing.maxShotFrames, 'creativeBrief.pacing.maxShotFrames', 1),
    allowBeatCuts: boolean(pacing.allowBeatCuts, 'creativeBrief.pacing.allowBeatCuts'),
  };
  if (result.minShotFrames > result.preferredShotFrames) {
    fail('creativeBrief.pacing.minShotFrames must not exceed preferredShotFrames');
  }
  if (result.preferredShotFrames > result.maxShotFrames) {
    fail('creativeBrief.pacing.maxShotFrames must be at least preferredShotFrames');
  }
  return result;
};

const validateAssetNeed = (value: unknown, index: number): CreativeBriefAssetNeed => {
  const field = `creativeBrief.requiredAssets[${index}]`;
  const item = record(value, field);
  assertKeys(item, ['kind', 'description', 'visualStyle', 'alphaRequired', 'durationFrames', 'continuityReferences'], field);
  const result: CreativeBriefAssetNeed = {
    kind: oneOf(item.kind, ASSET_KINDS, `${field}.kind`),
    description: text(item.description, `${field}.description`),
    alphaRequired: item.alphaRequired === undefined ? false : boolean(item.alphaRequired, `${field}.alphaRequired`),
    continuityReferences: textArray(item.continuityReferences, `${field}.continuityReferences`),
  };
  const visualStyle = optionalText(item.visualStyle, `${field}.visualStyle`);
  if (visualStyle !== undefined) result.visualStyle = visualStyle;
  if (item.durationFrames !== undefined) {
    result.durationFrames = integer(item.durationFrames, `${field}.durationFrames`, 1);
  }
  return result;
};

const UNIT_RANGE = (value: unknown, field: string): number => {
  const number_ = number(value, field);
  if (number_ < 0 || number_ > 1) fail(`${field} must be in [0, 1]`);
  return number_;
};

const validateMediaTransform = (
  source: Record<string, unknown>,
  field: string,
): {fit: MediaFit; positionX: number; positionY: number; scale: number} => {
  const fit = oneOf(source.fit === undefined ? 'cover' : source.fit, MEDIA_FITS, `${field}.fit`);
  const positionX = source.positionX === undefined ? 0 : number(source.positionX, `${field}.positionX`);
  const positionY = source.positionY === undefined ? 0 : number(source.positionY, `${field}.positionY`);
  const scale = source.scale === undefined ? 1 : number(source.scale, `${field}.scale`);
  if (!(scale > 0) || scale > 20) fail(`${field}.scale must be greater than 0 and at most 20`);
  return {fit, positionX, positionY, scale};
};

const bounded = (value: unknown, field: string, minimum: number, maximum: number): number => {
  const parsed = number(value, field);
  if (parsed < minimum || parsed > maximum) {
    fail(`${field} must be in [${minimum}, ${maximum}]`);
  }
  return parsed;
};

const PLANNED_PARALLAX_ROLES = ['midground', 'subject', 'foreground'] as const;
const PLANNED_ROLE_RANK: Readonly<Record<(typeof PLANNED_PARALLAX_ROLES)[number], number>> = {
  midground: 0,
  subject: 1,
  foreground: 2,
};
const PLANNED_ROLE_PARALLAX: Readonly<
  Record<(typeof PLANNED_PARALLAX_ROLES)[number], {min: number; max: number}>
> = {
  midground: {min: 0.1, max: 0.6},
  subject: {min: 0.45, max: 0.9},
  foreground: {min: 0.8, max: 1},
};

const validatePlannedLayerMotion = (value: unknown, field: string): PlannedLayerMotion => {
  const motion = record(value, field);
  assertKeys(
    motion,
    ['translateXFrom', 'translateXTo', 'translateYFrom', 'translateYTo', 'fromFrame', 'toFrame', 'easing'],
    field,
  );
  const result: PlannedLayerMotion = {
    translateXFrom: bounded(motion.translateXFrom, `${field}.translateXFrom`, -0.7, 0.7),
    translateXTo: bounded(motion.translateXTo, `${field}.translateXTo`, -0.7, 0.7),
    translateYFrom: bounded(motion.translateYFrom, `${field}.translateYFrom`, -0.7, 0.7),
    translateYTo: bounded(motion.translateYTo, `${field}.translateYTo`, -0.7, 0.7),
    easing: oneOf(motion.easing === undefined ? 'easeInOut' : motion.easing, ['linear', 'easeInOut'] as const, `${field}.easing`),
  };
  if (motion.fromFrame !== undefined) result.fromFrame = integer(motion.fromFrame, `${field}.fromFrame`);
  if (motion.toFrame !== undefined) result.toFrame = integer(motion.toFrame, `${field}.toFrame`);
  if (
    Math.abs(result.translateXFrom - result.translateXTo) < 1e-9 &&
    Math.abs(result.translateYFrom - result.translateYTo) < 1e-9
  ) {
    fail(`${field} declares no movement; omit motion for a static layer`);
  }
  return result;
};

const validatePlannedCamera = (value: unknown, field: string): CameraMoveConfig => {
  const camera = record(value, field);
  assertKeys(camera, ['kind', 'fromX', 'fromY', 'fromZoom', 'toX', 'toY', 'toZoom', 'easing'], field);
  const kind = oneOf(camera.kind, ['pan', 'push-in', 'pull-back', 'hold'] as const, `${field}.kind`);
  const limit = 0.25;
  const result: CameraMoveConfig = {
    kind,
    fromX: bounded(camera.fromX, `${field}.fromX`, -limit, limit),
    fromY: bounded(camera.fromY, `${field}.fromY`, -limit, limit),
    fromZoom: bounded(camera.fromZoom, `${field}.fromZoom`, 1, 2.5),
    toX: bounded(camera.toX, `${field}.toX`, -limit, limit),
    toY: bounded(camera.toY, `${field}.toY`, -limit, limit),
    toZoom: bounded(camera.toZoom, `${field}.toZoom`, 1, 2.5),
    easing: oneOf(camera.easing === undefined ? 'easeInOut' : camera.easing, ['linear', 'easeInOut'] as const, `${field}.easing`),
  };
  const travel = Math.abs(result.toX - result.fromX) + Math.abs(result.toY - result.fromY);
  const zoomDelta = result.toZoom - result.fromZoom;
  if (kind === 'pan' && (Math.abs(zoomDelta) > 1e-9 || travel < 1e-6)) {
    fail(`${field}.kind pan requires a moving camera with a constant zoom`);
  }
  if (kind === 'push-in' && !(zoomDelta > 1e-6)) {
    fail(`${field}.kind push-in requires toZoom > fromZoom`);
  }
  if (kind === 'pull-back' && !(zoomDelta < -1e-6)) {
    fail(`${field}.kind pull-back requires toZoom < fromZoom`);
  }
  if (kind === 'hold' && (travel > 1e-6 || Math.abs(zoomDelta) > 1e-6)) {
    fail(`${field}.kind hold requires an unmoving camera`);
  }
  return result;
};

/**
 * A planned 2.5D shot names requirement slots, not asset IDs. Depth roles,
 * draw order, camera bounds and pose geometry are validated here so a plan can
 * never compile into a shot the project validator would reject later.
 */
const validatePlannedParallax = (
  media: Record<string, unknown>,
  field: string,
): PlannedParallaxMedia => {
  assertKeys(
    media,
    ['kind', 'backgroundSlot', 'background', 'camera', 'atmosphere', 'light', 'layers', 'characters'],
    field,
  );
  const backgroundSlot = text(media.backgroundSlot, `${field}.backgroundSlot`);
  const background = record(media.background, `${field}.background`);
  assertKeys(
    background,
    ['parallax', 'opacity', 'fit', 'positionX', 'positionY', 'scale', 'blur'],
    `${field}.background`,
  );
  const backgroundParsed = {
    parallax: bounded(background.parallax, `${field}.background.parallax`, 0, 0.12),
    opacity: background.opacity === undefined ? 1 : UNIT_RANGE(background.opacity, `${field}.background.opacity`),
    ...validateMediaTransform(background, `${field}.background`),
    ...(background.blur === undefined
      ? {}
      : {blur: bounded(background.blur, `${field}.background.blur`, 0, 16)}),
  };

  const rawLayers = array(media.layers, `${field}.layers`);
  if (rawLayers.length === 0) fail(`${field}.layers must contain at least one layer`);
  if (rawLayers.length > 16) fail(`${field}.layers must contain at most 16 layers`);
  const layers: PlannedParallaxLayer[] = rawLayers.map((layerValue, index) => {
    const layerField = `${field}.layers[${index}]`;
    const layer = record(layerValue, layerField);
    assertKeys(
      layer,
      [
        'slot', 'role', 'order', 'parallax', 'opacity', 'fit', 'positionX', 'positionY',
        'scale', 'blur', 'visibleFromFrame', 'visibleToFrame', 'motion',
      ],
      layerField,
    );
    const role = oneOf(layer.role, PLANNED_PARALLAX_ROLES, `${layerField}.role`);
    const range = PLANNED_ROLE_PARALLAX[role];
    const order = integer(layer.order, `${layerField}.order`);
    if (order > 31) fail(`${layerField}.order must be at most 31`);
    const visibleFromFrame = integer(layer.visibleFromFrame ?? 0, `${layerField}.visibleFromFrame`);
    const visibleToFrame = integer(layer.visibleToFrame, `${layerField}.visibleToFrame`, 1);
    if (visibleFromFrame >= visibleToFrame) fail(`${layerField} visibility range must be non-empty`);
    return {
      slot: text(layer.slot, `${layerField}.slot`),
      role,
      order,
      parallax: bounded(layer.parallax, `${layerField}.parallax`, range.min, range.max),
      opacity: layer.opacity === undefined ? 1 : UNIT_RANGE(layer.opacity, `${layerField}.opacity`),
      ...validateMediaTransform(layer, layerField),
      ...(layer.blur === undefined ? {} : {blur: bounded(layer.blur, `${layerField}.blur`, 0, 16)}),
      visibleFromFrame,
      visibleToFrame,
      ...(layer.motion === undefined
        ? {}
        : {motion: validatePlannedLayerMotion(layer.motion, `${layerField}.motion`)}),
    };
  });

  const rawCharacters = media.characters === undefined ? [] : array(media.characters, `${field}.characters`);
  if (rawCharacters.length > 4) fail(`${field}.characters must contain at most 4 characters`);
  const characters: PlannedParallaxCharacter[] = rawCharacters.map((entry, index) => {
    const entryField = `${field}.characters[${index}]`;
    const character = record(entry, entryField);
    assertKeys(
      character,
      ['characterId', 'order', 'parallax', 'anchorX', 'anchorY', 'pivotX', 'pivotY', 'height', 'breathe', 'sway', 'poses'],
      entryField,
    );
    const characterId = text(character.characterId, `${entryField}.characterId`);
    if (!ID_PATTERN.test(characterId)) fail(`${entryField}.characterId must be a lowercase id`);
    const rawPoses = array(character.poses, `${entryField}.poses`);
    if (rawPoses.length === 0) fail(`${entryField}.poses must declare at least one pose`);
    if (rawPoses.length > 24) fail(`${entryField}.poses must declare at most 24 poses`);
    const poses: PlannedParallaxPose[] = rawPoses.map((poseValue, poseIndex) => {
      const poseField = `${entryField}.poses[${poseIndex}]`;
      const pose = record(poseValue, poseField);
      assertKeys(
        pose,
        ['slot', 'fromFrame', 'toFrame', 'transition', 'fadeFrames', 'offsetX', 'offsetY', 'scale', 'opacity'],
        poseField,
      );
      const transition = oneOf(
        pose.transition === undefined ? 'cut' : pose.transition,
        ['cut', 'crossfade'] as const,
        `${poseField}.transition`,
      );
      const fadeFrames =
        transition === 'cut'
          ? bounded(pose.fadeFrames ?? 0, `${poseField}.fadeFrames`, 0, 0)
          : bounded(pose.fadeFrames ?? 4, `${poseField}.fadeFrames`, 2, 12);
      return {
        slot: text(pose.slot, `${poseField}.slot`),
        fromFrame: integer(pose.fromFrame, `${poseField}.fromFrame`),
        toFrame: integer(pose.toFrame, `${poseField}.toFrame`, 1),
        transition,
        fadeFrames,
        offsetX: bounded(pose.offsetX ?? 0, `${poseField}.offsetX`, -0.7, 0.7),
        offsetY: bounded(pose.offsetY ?? 0, `${poseField}.offsetY`, -0.5, 0.5),
        scale: bounded(pose.scale ?? 1, `${poseField}.scale`, 0.5, 2.5),
        opacity: bounded(pose.opacity ?? 1, `${poseField}.opacity`, 0, 1),
      };
    });
    const idle = (value: unknown, idleField: string) => {
      const parsed = record(value, idleField);
      assertKeys(parsed, ['amplitude', 'periodFrames'], idleField);
      return {
        amplitude: bounded(parsed.amplitude, `${idleField}.amplitude`, 0, 0.06),
        periodFrames: bounded(parsed.periodFrames, `${idleField}.periodFrames`, 8, 240),
      };
    };
    return {
      characterId,
      order: integer(character.order, `${entryField}.order`),
      parallax: bounded(character.parallax, `${entryField}.parallax`, 0.45, 0.9),
      anchorX: bounded(character.anchorX, `${entryField}.anchorX`, -0.25, 1.25),
      anchorY: bounded(character.anchorY, `${entryField}.anchorY`, 0, 1.6),
      pivotX: bounded(character.pivotX, `${entryField}.pivotX`, 0, 1),
      pivotY: bounded(character.pivotY, `${entryField}.pivotY`, 0, 1),
      height: bounded(character.height, `${entryField}.height`, 0.1, 2),
      ...(character.breathe === undefined ? {} : {breathe: idle(character.breathe, `${entryField}.breathe`)}),
      ...(character.sway === undefined ? {} : {sway: idle(character.sway, `${entryField}.sway`)}),
      poses,
    };
  });

  const slots = new Set<string>();
  const orders = new Set<number>();
  const claimSlot = (slot: string, slotField: string): void => {
    if (slot === backgroundSlot) fail(`${slotField} must differ from backgroundSlot`);
    if (slots.has(slot)) fail(`Planned media slot ${slot} is declared twice`);
    slots.add(slot);
  };
  for (const layer of layers) {
    claimSlot(layer.slot, `${field}.layers[${layers.indexOf(layer)}].slot`);
    if (orders.has(layer.order)) fail(`${field}.layers contains duplicate order ${layer.order}`);
    orders.add(layer.order);
  }
  const characterIds = new Set<string>();
  for (const character of characters) {
    if (characterIds.has(character.characterId)) {
      fail(`${field}.characters contains duplicate characterId ${character.characterId}`);
    }
    characterIds.add(character.characterId);
    if (orders.has(character.order)) fail(`${field} character reuses order ${character.order}`);
    orders.add(character.order);
    for (const pose of character.poses) claimSlot(pose.slot, `${field}.characters[${character.characterId}].poses`);
  }
  if (!layers.some((layer) => layer.role === 'midground')) fail(`${field}.layers requires a midground layer`);
  if (!layers.some((layer) => layer.role === 'foreground')) fail(`${field}.layers requires a foreground layer`);
  if (!layers.some((layer) => layer.role === 'subject') && characters.length === 0) {
    fail(`${field} requires a subject layer or a character performance`);
  }
  let previousRank = -1;
  const drawOrder = [
    ...layers.map((layer) => ({order: layer.order, role: layer.role})),
    ...characters.map((character) => ({
      order: character.order,
      role: 'subject' as (typeof PLANNED_PARALLAX_ROLES)[number],
    })),
  ].sort((left, right) => left.order - right.order);
  for (const entry of drawOrder) {
    const rank = PLANNED_ROLE_RANK[entry.role];
    if (rank < previousRank) {
      fail(`${field} draw order must increase with depth: midground, subject, foreground`);
    }
    previousRank = rank;
  }
  const depths = [
    backgroundParsed.parallax,
    ...layers.map((layer) => layer.parallax),
    ...characters.map((character) => character.parallax),
  ];
  if (Math.max(...depths) - Math.min(...depths) < 0.25) {
    fail(`${field} depth span must be at least 0.25 between the nearest and farthest layer`);
  }

  const atmosphereRaw = record(media.atmosphere, `${field}.atmosphere`);
  assertKeys(atmosphereRaw, ['kind', 'intensity', 'windX'], `${field}.atmosphere`);
  const lightRaw = record(media.light, `${field}.light`);
  assertKeys(lightRaw, ['amplitude', 'frequency', 'phase', 'sweep'], `${field}.light`);
  if (lightRaw.sweep !== undefined && lightRaw.sweep !== null) {
    fail(`${field}.light.sweep is not supported in a planned 2.5D shot; author it directly in project.json`);
  }

  return {
    kind: 'parallax-2p5d',
    backgroundSlot,
    background: backgroundParsed,
    camera: validatePlannedCamera(media.camera, `${field}.camera`),
    atmosphere: {
      kind: oneOf(atmosphereRaw.kind === undefined ? 'none' : atmosphereRaw.kind, ['rain', 'mist', 'rain-mist', 'none'] as const, `${field}.atmosphere.kind`),
      intensity: UNIT_RANGE(atmosphereRaw.intensity, `${field}.atmosphere.intensity`),
      windX: bounded(atmosphereRaw.windX, `${field}.atmosphere.windX`, -1, 1),
    },
    light: {
      amplitude: bounded(lightRaw.amplitude, `${field}.light.amplitude`, 0, 1),
      frequency: bounded(lightRaw.frequency, `${field}.light.frequency`, 0, 8),
      phase: bounded(lightRaw.phase, `${field}.light.phase`, -1, 1),
    },
    layers,
    characters,
  };
};

/**
 * Planned media is validated structurally here. The shot-local bounds that the
 * project validator enforces (visibility inside the shot, frame-aligned
 * in-points) are checked once the planner has produced real shot ranges.
 */
export const validatePlannedMedia = (
  value: unknown,
  renderer: string,
  field: string,
): PlannedShotMedia | null => {
  if (value === null || value === undefined) return null;
  const media = record(value, field);
  const kind = oneOf(media.kind, ['video', 'hybrid', 'parallax-2p5d'] as const, `${field}.kind`);
  if (kind !== renderer) {
    fail(`${field}.kind "${kind}" does not match the planned renderer "${renderer}"`);
  }
  if (kind === 'parallax-2p5d') {
    return validatePlannedParallax(media, field);
  }
  const sourceStartFrames = integer(
    media.sourceStartFrames,
    `${field}.sourceStartFrames`,
  );
  const backgroundSlot = text(media.backgroundSlot, `${field}.backgroundSlot`);
  const transform = validateMediaTransform(media, field);
  if (kind === 'video') {
    assertKeys(media, ['kind', 'backgroundSlot', 'sourceStartFrames', 'fit', 'positionX', 'positionY', 'scale'], field);
    return {kind: 'video', backgroundSlot, sourceStartFrames, ...transform};
  }
  assertKeys(
    media,
    ['kind', 'backgroundSlot', 'sourceStartFrames', 'fit', 'positionX', 'positionY', 'scale', 'layers', 'overlay'],
    field,
  );
  const rawLayers = array(media.layers, `${field}.layers`);
  if (rawLayers.length === 0) fail(`${field}.layers must contain at least one layer`);
  if (rawLayers.length > 16) fail(`${field}.layers must contain at most 16 layers`);
  const layers: PlannedHybridLayer[] = rawLayers.map((layerValue, index) => {
    const layerField = `${field}.layers[${index}]`;
    const layer = record(layerValue, layerField);
    assertKeys(
      layer,
      ['slot', 'order', 'opacity', 'fit', 'positionX', 'positionY', 'scale', 'visibleFromFrame', 'visibleToFrame'],
      layerField,
    );
    const order = integer(layer.order, `${layerField}.order`);
    if (order > 31) fail(`${layerField}.order must be at most 31`);
    const visibleFromFrame = integer(layer.visibleFromFrame, `${layerField}.visibleFromFrame`);
    const visibleToFrame = integer(layer.visibleToFrame, `${layerField}.visibleToFrame`, 1);
    if (visibleFromFrame >= visibleToFrame) fail(`${layerField} visibility range must be non-empty`);
    return {
      slot: text(layer.slot, `${layerField}.slot`),
      order,
      opacity: layer.opacity === undefined ? 1 : UNIT_RANGE(layer.opacity, `${layerField}.opacity`),
      ...validateMediaTransform(layer, layerField),
      visibleFromFrame,
      visibleToFrame,
    };
  });
  const orders = new Set<number>();
  const slots = new Set<string>();
  for (const layer of layers) {
    if (orders.has(layer.order)) fail(`${field}.layers contains duplicate order ${layer.order}`);
    orders.add(layer.order);
    if (slots.has(layer.slot)) fail(`${field}.layers contains duplicate slot ${layer.slot}`);
    slots.add(layer.slot);
    if (layer.slot === backgroundSlot) fail(`${field}.layers slot must differ from backgroundSlot`);
  }
  const overlay = record(media.overlay, `${field}.overlay`);
  assertKeys(overlay, ['kind', 'intensity', 'color'], `${field}.overlay`);
  return {
    kind: 'hybrid',
    backgroundSlot,
    sourceStartFrames,
    ...transform,
    layers,
    overlay: {
      kind: oneOf(overlay.kind, ['rain', 'orbits', 'scan'] as const, `${field}.overlay.kind`),
      intensity: overlay.intensity === undefined ? 0.5 : UNIT_RANGE(overlay.intensity, `${field}.overlay.intensity`),
      color: overlay.color === undefined ? null : text(overlay.color, `${field}.overlay.color`),
    },
  };
};

const validateRendererDirective = (
  value: unknown,
  index: number,
  context: PreproductionContext,
): CreativeBriefRendererDirective => {
  const field = `creativeBrief.rendererDirectives[${index}]`;
  const directive = record(value, field);
  assertKeys(directive, ['id', 'renderer', 'continuityIds', 'media'], field);
  const renderer = text(directive.renderer, `${field}.renderer`);
  if (!context.rendererKinds.has(renderer)) {
    fail(`${field}.renderer references unregistered renderer ${renderer}`);
  }
  const isMediaRenderer = renderer === 'video' || renderer === 'hybrid' || renderer === 'parallax-2p5d';
  if (!isMediaRenderer && directive.media !== undefined && directive.media !== null) {
    fail(`${field}.media is only valid for the video, hybrid and parallax-2p5d renderer directives`);
  }
  const media = isMediaRenderer ? validatePlannedMedia(directive.media, renderer, field) : null;
  if (isMediaRenderer && media === null) {
    fail(`${field}.media is required for the ${renderer} renderer directive`);
  }
  return {
    id: text(directive.id, `${field}.id`),
    renderer,
    continuityIds: textArray(directive.continuityIds, `${field}.continuityIds`, 32),
    media,
  };
};

export const validateCreativeBrief = (
  raw: unknown,
  context: PreproductionContext,
): CreativeBrief => {
  const brief = record(raw, 'creativeBrief');
  assertKeys(
    brief,
    [
      'schemaVersion',
      'projectId',
      'source',
      'approval',
      'concept',
      'narrativeMode',
      'moodProgression',
      'visualStyle',
      'aspectRatio',
      'palette',
      'characters',
      'setting',
      'continuityRules',
      'pacing',
      'cameraLanguage',
      'transitions',
      'approvedReferences',
      'excludedElements',
      'productionConstraints',
      'preferredRenderers',
      'rendererDirectives',
      'requiredAssets',
      'assumptions',
    ],
    'creativeBrief',
  );
  if (brief.schemaVersion !== 1) fail('creativeBrief.schemaVersion must be 1');
  if (text(brief.projectId, 'creativeBrief.projectId') !== context.projectId) {
    fail(`creativeBrief.projectId must be ${context.projectId}`);
  }
  const aspectRatio = text(brief.aspectRatio, 'creativeBrief.aspectRatio');
  const ratio = parseAspectRatio(aspectRatio);
  const outputRatio = context.width / context.height;
  if (Math.abs(ratio - outputRatio) > 0.01) {
    fail(`creativeBrief.aspectRatio ${aspectRatio} does not match the project output ${context.width}x${context.height}`);
  }
  const approvedReferences = textArray(brief.approvedReferences, 'creativeBrief.approvedReferences', 64);
  const assetsById = new Map(context.assets.map((asset) => [asset.id, asset]));
  for (const assetId of approvedReferences) {
    const asset = assetsById.get(assetId);
    if (!asset) fail(`creativeBrief.approvedReferences references unknown asset ${assetId}`);
    if (asset.approval !== 'approved') {
      fail(`creativeBrief.approvedReferences references unapproved asset ${assetId}`);
    }
  }
  const preferredRenderers = textArray(brief.preferredRenderers, 'creativeBrief.preferredRenderers', 8);
  if (preferredRenderers.length === 0) fail('creativeBrief.preferredRenderers must not be empty');
  for (const renderer of preferredRenderers) {
    if (!context.rendererKinds.has(renderer)) {
      fail(`creativeBrief.preferredRenderers references unregistered renderer ${renderer}`);
    }
  }
  const requiredAssets = (brief.requiredAssets === undefined
    ? []
    : array(brief.requiredAssets, 'creativeBrief.requiredAssets')
  ).map(validateAssetNeed);
  if (requiredAssets.length > 32) fail('creativeBrief.requiredAssets must contain at most 32 entries');
  const rawDirectives = brief.rendererDirectives === undefined
    ? []
    : array(brief.rendererDirectives, 'creativeBrief.rendererDirectives');
  if (rawDirectives.length > 32) fail('creativeBrief.rendererDirectives must contain at most 32 entries');
  const rendererDirectives = rawDirectives.map((directive, index) =>
    validateRendererDirective(directive, index, context),
  );
  uniqueIds(rendererDirectives, 'creativeBrief.rendererDirectives');

  return {
    schemaVersion: 1,
    projectId: context.projectId,
    source: userSource(brief.source, 'creativeBrief.source'),
    approval: approval(brief.approval, 'creativeBrief.approval'),
    concept: text(brief.concept, 'creativeBrief.concept'),
    narrativeMode: oneOf(brief.narrativeMode, NARRATIVE_MODES, 'creativeBrief.narrativeMode'),
    moodProgression: textArray(brief.moodProgression, 'creativeBrief.moodProgression'),
    visualStyle: text(brief.visualStyle, 'creativeBrief.visualStyle'),
    aspectRatio,
    palette: textArray(brief.palette, 'creativeBrief.palette', 16),
    characters: textArray(brief.characters, 'creativeBrief.characters'),
    setting: text(brief.setting, 'creativeBrief.setting'),
    continuityRules: textArray(brief.continuityRules, 'creativeBrief.continuityRules'),
    pacing: validatePacing(brief.pacing),
    cameraLanguage: textArray(brief.cameraLanguage, 'creativeBrief.cameraLanguage'),
    transitions: textArray(brief.transitions, 'creativeBrief.transitions'),
    approvedReferences,
    excludedElements: textArray(brief.excludedElements, 'creativeBrief.excludedElements'),
    productionConstraints: textArray(brief.productionConstraints, 'creativeBrief.productionConstraints'),
    preferredRenderers,
    rendererDirectives,
    requiredAssets,
    assumptions: textArray(brief.assumptions, 'creativeBrief.assumptions'),
  };
};

const validateLyricLine = (
  value: unknown,
  index: number,
  context: PreproductionContext,
  sectionById: Map<string, SectionAnnotation>,
): Omit<LyricLine, 'id' | 'approval' | 'source'> => {
  const field = `lyrics.lines[${index}]`;
  const item = record(value, field);
  assertKeys(item, ['timeSeconds', 'text', 'sectionId'], field);
  const timeSeconds = number(item.timeSeconds, `${field}.timeSeconds`);
  if (timeSeconds < 0) fail(`${field}.timeSeconds must be non-negative`);
  if (timeSeconds > context.durationInFrames / context.fps + 1 / context.fps) {
    fail(`${field}.timeSeconds is beyond the project duration`);
  }
  const frame = Math.round(timeSeconds * context.fps);
  if (frame > context.durationInFrames) fail(`${field} maps beyond the project duration`);
  const lyricText = text(item.text, `${field}.text`);
  const sectionId = optionalText(item.sectionId, `${field}.sectionId`) ?? null;
  if (sectionId !== null) {
    const section = sectionById.get(sectionId);
    if (!section) fail(`${field}.sectionId references unknown section ${sectionId}`);
    if (section.approval !== 'approved') fail(`${field}.sectionId references unapproved section ${sectionId}`);
    if (frame < section.startFrame || frame >= section.endFrame) {
      fail(`${field} lies outside section ${sectionId}`);
    }
  }
  return {timeSeconds, frame, text: lyricText, sectionId};
};

const finalizeLyrics = (
  projectId: string,
  language: string,
  format: 'lrc' | 'json',
  sourcePath: string,
  sourceSha256: string,
  lines: Omit<LyricLine, 'id' | 'approval' | 'source'>[],
  approvalStatus: ApprovalStatus,
  context: PreproductionContext,
): LyricsDocument => {
  const sorted = [...lines].sort((left, right) => left.timeSeconds - right.timeSeconds);
  for (let index = 1; index < sorted.length; index++) {
    if (sorted[index].timeSeconds <= sorted[index - 1].timeSeconds) {
      fail('lyrics timestamps must be strictly increasing; overlapping/duplicate lines are not accepted');
    }
  }
  if (sorted.length === 0) fail('lyrics file contains no timed lines');
  if (sorted.length > 512) fail('lyrics contains more than 512 lines');
  const sectionById = new Map((context.sections ?? []).map((section) => [section.id, section]));
  for (const line of sorted) {
    if (line.sectionId && !sectionById.has(line.sectionId)) {
      fail(`lyrics sectionId references unknown section ${line.sectionId}`);
    }
  }
  return {
    schemaVersion: 1,
    projectId,
    language,
    format,
    sourcePath,
    sourceSha256,
    lines: sorted.map((line, index) => ({
      ...line,
      id: `LYRIC-${String(index + 1).padStart(3, '0')}`,
      approval: approvalStatus,
      source: 'user',
    })),
    approval: approvalStatus,
  };
};

const parseLrcTimestamp = (value: string): number => {
  const match = value.match(/^(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?$/);
  if (!match) fail(`Invalid LRC timestamp [${value}]`);
  const minutes = Number(match[1]);
  const seconds = Number(match[2]);
  const fraction = match[3] ?? '0';
  const milliseconds = Number(fraction.padEnd(3, '0'));
  if (seconds >= 60 || milliseconds >= 1000) fail(`Invalid LRC timestamp [${value}]`);
  return minutes * 60 + seconds + milliseconds / 1000;
};

export const parseLrcLyrics = (input: {
  text: string;
  language: string;
  sourcePath: string;
  sourceSha256: string;
  approval: ApprovalStatus;
  context: PreproductionContext;
}): LyricsDocument => {
  const lines: Omit<LyricLine, 'id' | 'approval' | 'source'>[] = [];
  let offsetSeconds = 0;
  for (const rawLine of input.text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '') continue;
    const offset = line.match(/^\[offset:([+-]?\d+)\]$/i);
    if (offset) {
      offsetSeconds = Number(offset[1]) / 1000;
      continue;
    }
    if (/^\[(ti|ar|al|by|la|length):/i.test(line)) continue;
    const timestamps: number[] = [];
    let cursor = 0;
    const timestampPattern = /\[([0-9]{1,3}:[0-9]{2}(?:[.:][0-9]{1,3})?)\]/g;
    let match: RegExpExecArray | null;
    while ((match = timestampPattern.exec(line)) !== null) {
      if (match.index !== cursor) break;
      timestamps.push(parseLrcTimestamp(match[1]));
      cursor = timestampPattern.lastIndex;
    }
    if (timestamps.length === 0) {
      fail(`LRC line has no timestamp: ${line}`);
    }
    const lyricText = line.slice(cursor).trim();
    if (lyricText === '') fail(`LRC line has empty text: ${line}`);
    for (const timestamp of timestamps) {
      const timeSeconds = timestamp + offsetSeconds;
      if (timeSeconds < 0) fail('LRC offset moves a timestamp before zero');
      const frame = Math.round(timeSeconds * input.context.fps);
      if (frame > input.context.durationInFrames) fail('LRC timestamp is beyond the project duration');
      lines.push({timeSeconds, frame, text: lyricText, sectionId: null});
    }
  }
  return finalizeLyrics(
    input.context.projectId,
    input.language,
    'lrc',
    input.sourcePath,
    input.sourceSha256,
    lines,
    input.approval,
    input.context,
  );
};

export const validateJsonLyrics = (input: {
  raw: unknown;
  language: string;
  sourcePath: string;
  sourceSha256: string;
  context: PreproductionContext;
}): LyricsDocument => {
  const document = record(input.raw, 'lyrics');
  assertKeys(document, ['schemaVersion', 'language', 'format', 'approval', 'lines'], 'lyrics');
  if (document.schemaVersion !== 1) fail('lyrics.schemaVersion must be 1');
  if (document.format !== 'json') fail('lyrics.format must be "json" for a structured lyrics file');
  const language = text(document.language, 'lyrics.language');
  const approvalStatus = approval(document.approval, 'lyrics.approval');
  const sectionById = new Map((input.context.sections ?? []).map((section) => [section.id, section]));
  const rawLines = array(document.lines, 'lyrics.lines');
  const lines = rawLines.map((line, index) =>
    validateLyricLine(line, index, input.context, sectionById),
  );
  return finalizeLyrics(
    input.context.projectId,
    language || input.language,
    'json',
    input.sourcePath,
    input.sourceSha256,
    lines,
    approvalStatus,
    input.context,
  );
};

export const validateBeatGridReport = (
  raw: unknown,
  context: {projectId: string; fps: number; durationInFrames: number; sourceSha256: string},
): BeatGridReport => {
  const report = record(raw, 'beatGrid');
  if (report.schemaVersion !== 1) fail('beatGrid.schemaVersion must be 1');
  if (report.projectId !== context.projectId) fail(`beatGrid.projectId must be ${context.projectId}`);
  if (report.algorithmVersion !== BEAT_GRID_ALGORITHM_VERSION) {
    fail(`beatGrid.algorithmVersion must be ${BEAT_GRID_ALGORITHM_VERSION}`);
  }
  if (report.sourceSha256 !== context.sourceSha256) fail('beatGrid source hash does not match the master audio');
  if (report.outputFps !== context.fps) fail('beatGrid outputFps does not match the project');
  if (report.durationFrames !== context.durationInFrames) fail('beatGrid durationFrames does not match the project');
  const events = array(report.beatEvents, 'beatGrid.beatEvents');
  let previous = -1;
  for (const [index, value] of events.entries()) {
    const event = record(value, `beatGrid.beatEvents[${index}]`);
    const frame = integer(event.frame, `beatGrid.beatEvents[${index}].frame`);
    if (frame < 0 || frame >= context.durationInFrames) {
      fail(`beatGrid.beatEvents[${index}].frame is outside the project`);
    }
    if (frame <= previous) fail('beatGrid.beatEvents must be strictly increasing by frame');
    previous = frame;
    if (event.source !== 'estimated' || event.classification !== 'estimated') {
      fail('beatGrid beat events must remain estimated candidates');
    }
  }
  return report as unknown as BeatGridReport;
};

export const requirementIds = (requirements: readonly AssetRequirement[]): Set<string> =>
  new Set(requirements.map((requirement) => requirement.id));

const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const INTAKE_REVIEWS: readonly AssetIntakeReview[] = ['pending', 'in-review', 'approved', 'rejected'];
const PROJECT_ASSET_KINDS: readonly ProjectAssetKind[] = ['image', 'video', 'layer', 'audio-reference'];
const INTAKE_PROBED: readonly AssetIntakeRecord['technical']['probed'][] = [
  'video',
  'layer',
  'image',
  'audio',
  'unprobed',
];

const validateIntakeTechnical = (value: unknown, field: string): AssetIntakeRecord['technical'] => {
  const technical = record(value, field);
  assertKeys(
    technical,
    ['probed', 'width', 'height', 'durationSeconds', 'fps', 'hasAlpha', 'codec'],
    field,
  );
  const nullablePositive = (raw: unknown, name: string): number | null => {
    if (raw === null || raw === undefined) return null;
    const parsed = number(raw, `${field}.${name}`);
    if (parsed < 0) fail(`${field}.${name} must be non-negative`);
    return parsed;
  };
  const nullableText = (raw: unknown, name: string): string | null =>
    raw === null || raw === undefined ? null : text(raw, `${field}.${name}`);
  const nullableBoolean = (raw: unknown, name: string): boolean | null =>
    raw === null || raw === undefined ? null : boolean(raw, `${field}.${name}`);
  return {
    probed: oneOf(technical.probed, INTAKE_PROBED, `${field}.probed`),
    width: nullablePositive(technical.width, 'width'),
    height: nullablePositive(technical.height, 'height'),
    durationSeconds: nullablePositive(technical.durationSeconds, 'durationSeconds'),
    fps: nullablePositive(technical.fps, 'fps'),
    hasAlpha: nullableBoolean(technical.hasAlpha, 'hasAlpha'),
    codec: nullableText(technical.codec, 'codec'),
  };
};

const validateIntakePath = (value: unknown, field: string): string => {
  const raw = text(value, field);
  if (raw.startsWith('/') || /^[a-zA-Z]:/.test(raw) || raw.startsWith('\\\\')) {
    fail(`${field} must be project-relative, not absolute`);
  }
  if (raw.split(/[\\/]/).includes('..')) fail(`${field} must not traverse outside the project`);
  if (raw.includes('\\')) fail(`${field} must use forward slashes`);
  return raw;
};

/**
 * Structural validation of recorded local asset intake. Byte verification and
 * media probing happen when a record is created and again at compilation; this
 * only guarantees the document is well formed and bound to real requirements.
 */
export const validateAssetIntake = (
  raw: unknown,
  context: {projectId: string; requirements: readonly AssetRequirement[]},
): AssetIntakeDocument => {
  const document = record(raw, 'assetIntake');
  assertKeys(document, ['schemaVersion', 'projectId', 'records'], 'assetIntake');
  if (document.schemaVersion !== ASSET_INTAKE_SCHEMA_VERSION) {
    fail(`assetIntake.schemaVersion must be ${ASSET_INTAKE_SCHEMA_VERSION}`);
  }
  if (text(document.projectId, 'assetIntake.projectId') !== context.projectId) {
    fail(`assetIntake.projectId must be ${context.projectId}`);
  }
  const rawRecords = array(document.records, 'assetIntake.records');
  if (rawRecords.length > 256) fail('assetIntake.records must contain at most 256 entries');
  const known = requirementIds(context.requirements);
  const seen = new Set<string>();
  const records = rawRecords.map((value, index) => {
    const field = `assetIntake.records[${index}]`;
    const recordValue = record(value, field);
    assertKeys(
      recordValue,
      [
        'requirementId',
        'assetId',
        'kind',
        'path',
        'sha256',
        'fileSizeBytes',
        'fingerprint',
        'provenance',
        'rights',
        'review',
        'reviewNotes',
        'recordedAtStoryboardRevision',
        'technical',
      ],
      field,
    );
    const requirementId = text(recordValue.requirementId, `${field}.requirementId`);
    if (!known.has(requirementId)) fail(`${field}.requirementId ${requirementId} is not a project requirement`);
    if (seen.has(requirementId)) fail(`${field}.requirementId ${requirementId} already has an intake record`);
    seen.add(requirementId);
    const sha256 = text(recordValue.sha256, `${field}.sha256`);
    if (!SHA256_PATTERN.test(sha256)) fail(`${field}.sha256 must be 64 lowercase hex characters`);
    const review = oneOf(recordValue.review, INTAKE_REVIEWS, `${field}.review`);
    return {
      requirementId,
      assetId: text(recordValue.assetId, `${field}.assetId`),
      kind: oneOf(recordValue.kind, PROJECT_ASSET_KINDS, `${field}.kind`),
      path: validateIntakePath(recordValue.path, `${field}.path`),
      sha256,
      fileSizeBytes: integer(recordValue.fileSizeBytes, `${field}.fileSizeBytes`, 1),
      fingerprint: text(recordValue.fingerprint, `${field}.fingerprint`),
      provenance: text(recordValue.provenance, `${field}.provenance`),
      rights: text(recordValue.rights, `${field}.rights`),
      review,
      reviewNotes:
        recordValue.reviewNotes === null || recordValue.reviewNotes === undefined
          ? null
          : text(recordValue.reviewNotes, `${field}.reviewNotes`),
      recordedAtStoryboardRevision: integer(
        recordValue.recordedAtStoryboardRevision,
        `${field}.recordedAtStoryboardRevision`,
        1,
      ),
      technical: validateIntakeTechnical(recordValue.technical, `${field}.technical`),
    } satisfies AssetIntakeRecord;
  });
  return {schemaVersion: ASSET_INTAKE_SCHEMA_VERSION, projectId: context.projectId, records};
};
const sameNumbers = (left: readonly number[], right: readonly number[]): boolean =>
  left.length === right.length && left.every((value, index) => value === right[index]);

const sameText = (left: readonly string[], right: readonly string[]): boolean =>
  left.length === right.length && left.every((value, index) => value === right[index]);

/**
 * Re-validate a recorded beat-grid approval against the beat grid that is
 * currently on disk. Any reanalysis that changes the estimate invalidates the
 * approval, so an estimated candidate can only reach director timing through a
 * review that still matches the measured evidence.
 */
export const validateApprovedBeatGrid = (
  raw: unknown,
  context: {
    projectId: string;
    fps: number;
    durationInFrames: number;
    sourceSha256: string;
    beatGridPath: string;
  },
  report: BeatGridReport | null,
): ApprovedBeatGrid => {
  const document = record(raw, 'approvedBeatGrid');
  assertKeys(document, ['schemaVersion', 'projectId', 'status', 'source', 'selected'], 'approvedBeatGrid');
  if (document.schemaVersion !== 1) fail('approvedBeatGrid.schemaVersion must be 1');
  if (text(document.projectId, 'approvedBeatGrid.projectId') !== context.projectId) {
    fail(`approvedBeatGrid.projectId must be ${context.projectId}`);
  }
  if (document.status !== 'approved') {
    fail('approvedBeatGrid.status must be "approved"; an unapproved candidate cannot drive director timing');
  }
  if (!report) {
    fail('approvedBeatGrid refers to a beat grid that is missing; run analyze-beats and re-approve');
  }
  if (!report.estimatedTempo) {
    fail('The current beat grid has insufficient rhythmic evidence and cannot be approved as timing');
  }
  if (report.evidence.tempoChangeSuspected) {
    fail('The current beat grid suspects a tempo change; a constant-tempo approval is not valid');
  }
  const source = record(document.source, 'approvedBeatGrid.source');
  assertKeys(
    source,
    [
      'beatGridPath',
      'algorithmVersion',
      'sourceSha256',
      'candidateBpm',
      'confidence',
      'quality',
      'ambiguity',
      'candidateBeatFrames',
      'candidateBeatIds',
    ],
    'approvedBeatGrid.source',
  );
  if (text(source.beatGridPath, 'approvedBeatGrid.source.beatGridPath') !== context.beatGridPath) {
    fail(`approvedBeatGrid.source.beatGridPath must be ${context.beatGridPath}`);
  }
  if (source.algorithmVersion !== report.algorithmVersion) {
    fail('approvedBeatGrid was made from a different beat-grid algorithm version; re-analyze and re-approve');
  }
  if (source.sourceSha256 !== report.sourceSha256 || source.sourceSha256 !== context.sourceSha256) {
    fail('approvedBeatGrid source audio hash does not match the current master audio and beat grid');
  }
  const candidateBpm = number(source.candidateBpm, 'approvedBeatGrid.source.candidateBpm');
  if (candidateBpm !== report.estimatedTempo.bpm) {
    fail('approvedBeatGrid candidate BPM does not match the current beat grid; the approval is stale');
  }
  const confidence = number(source.confidence, 'approvedBeatGrid.source.confidence');
  if (confidence !== report.estimatedTempo.confidence) {
    fail('approvedBeatGrid confidence does not match the current beat grid; the approval is stale');
  }
  if (oneOf(source.quality, ['high', 'medium', 'low', 'insufficient'], 'approvedBeatGrid.source.quality') !== report.estimatedTempo.quality) {
    fail('approvedBeatGrid quality does not match the current beat grid; the approval is stale');
  }
  const ambiguity = record(source.ambiguity, 'approvedBeatGrid.source.ambiguity');
  assertKeys(ambiguity, ['halfTempo', 'doubleTempo', 'offbeatOnsets', 'notes'], 'approvedBeatGrid.source.ambiguity');
  const halfTempo = boolean(ambiguity.halfTempo, 'approvedBeatGrid.source.ambiguity.halfTempo');
  const doubleTempo = boolean(ambiguity.doubleTempo, 'approvedBeatGrid.source.ambiguity.doubleTempo');
  if (halfTempo !== report.estimatedTempo.ambiguity.halfTempo || doubleTempo !== report.estimatedTempo.ambiguity.doubleTempo) {
    fail('approvedBeatGrid ambiguity flags do not match the current beat grid');
  }
  if (integer(ambiguity.offbeatOnsets, 'approvedBeatGrid.source.ambiguity.offbeatOnsets') !== report.estimatedTempo.ambiguity.offbeatOnsets) {
    fail('approvedBeatGrid offbeat transient count does not match the current beat grid');
  }
  const candidateFrames = array(source.candidateBeatFrames, 'approvedBeatGrid.source.candidateBeatFrames').map(
    (value, index) => integer(value, `approvedBeatGrid.source.candidateBeatFrames[${index}]`),
  );
  const reportFrames = report.beatEvents.map((event) => event.frame);
  if (!sameNumbers(candidateFrames, reportFrames)) {
    fail('approvedBeatGrid candidate beat frames do not match the current beat grid; the approval is stale');
  }
  const candidateIds = array(source.candidateBeatIds, 'approvedBeatGrid.source.candidateBeatIds').map(
    (value, index) => text(value, `approvedBeatGrid.source.candidateBeatIds[${index}]`),
  );
  if (!sameText(candidateIds, report.beatEvents.map((event) => event.id))) {
    fail('approvedBeatGrid candidate beat ids do not match the current beat grid; the approval is stale');
  }

  const selected = record(document.selected, 'approvedBeatGrid.selected');
  assertKeys(
    selected,
    ['bpm', 'interpretation', 'ambiguityAcknowledged', 'selectedBy', 'beatFrames', 'beatIds', 'reviewNotes', 'approvalRevision'],
    'approvedBeatGrid.selected',
  );
  const interpretation = oneOf(
    selected.interpretation,
    BEAT_INTERPRETATIONS,
    'approvedBeatGrid.selected.interpretation',
  );
  if ((halfTempo || doubleTempo) && !boolean(selected.ambiguityAcknowledged, 'approvedBeatGrid.selected.ambiguityAcknowledged')) {
    fail('The approved beat grid must acknowledge the reported competing tempo interpretations');
  }
  if (interpretation === 'half-tempo' && !halfTempo) {
    fail('A half-tempo approval requires a competing half-tempo candidate in the beat grid');
  }
  const expectedBpm = interpretation === 'as-estimated' ? candidateBpm : candidateBpm / 2;
  const selectedBpm = number(selected.bpm, 'approvedBeatGrid.selected.bpm');
  if (Math.abs(selectedBpm - expectedBpm) > expectedBpm * 0.01) {
    fail(`approvedBeatGrid.selected.bpm must match the ${interpretation} interpretation of ${candidateBpm} BPM`);
  }
  const expectedFrames = interpretation === 'as-estimated'
    ? reportFrames
    : reportFrames.filter((_, index) => index % 2 === 0);
  const expectedIds = interpretation === 'as-estimated'
    ? report.beatEvents.map((event) => event.id)
    : report.beatEvents.filter((_, index) => index % 2 === 0).map((event) => event.id);
  if (expectedFrames.length < 1) fail('The approved beat interpretation produced no beats');
  const beatFrames = array(selected.beatFrames, 'approvedBeatGrid.selected.beatFrames').map(
    (value, index) => integer(value, `approvedBeatGrid.selected.beatFrames[${index}]`),
  );
  if (beatFrames.length > 512) fail('approvedBeatGrid.selected.beatFrames must contain at most 512 entries');
  for (const [index, frame] of beatFrames.entries()) {
    if (frame >= context.durationInFrames) {
      fail(`approvedBeatGrid.selected.beatFrames[${index}] is outside the project duration`);
    }
  }
  if (!sameNumbers(beatFrames, expectedFrames)) {
    fail('approvedBeatGrid.selected.beatFrames must be the beats measured by the approved interpretation');
  }
  const beatIds = array(selected.beatIds, 'approvedBeatGrid.selected.beatIds').map(
    (value, index) => text(value, `approvedBeatGrid.selected.beatIds[${index}]`),
  );
  if (!sameText(beatIds, expectedIds)) {
    fail('approvedBeatGrid.selected.beatIds must reference the candidate beat ids of the approved interpretation');
  }
  if (selected.selectedBy !== 'user') fail('approvedBeatGrid.selected.selectedBy must be "user"');
  const reviewNotes = text(selected.reviewNotes, 'approvedBeatGrid.selected.reviewNotes');
  const approvalRevision = integer(selected.approvalRevision, 'approvedBeatGrid.selected.approvalRevision', 1);
  return {
    schemaVersion: 1,
    projectId: context.projectId,
    status: 'approved',
    source: {
      beatGridPath: context.beatGridPath,
      algorithmVersion: report.algorithmVersion,
      sourceSha256: String(report.sourceSha256),
      candidateBpm,
      confidence,
      quality: report.estimatedTempo.quality,
      ambiguity: {
        halfTempo,
        doubleTempo,
        offbeatOnsets: report.estimatedTempo.ambiguity.offbeatOnsets,
        notes: textArray(ambiguity.notes, 'approvedBeatGrid.source.ambiguity.notes'),
      },
      candidateBeatFrames: candidateFrames,
      candidateBeatIds: candidateIds,
    },
    selected: {
      bpm: selectedBpm,
      interpretation,
      ambiguityAcknowledged: Boolean(selected.ambiguityAcknowledged),
      selectedBy: 'user',
      beatFrames,
      beatIds,
      reviewNotes,
      approvalRevision,
    },
  };
};

const validateContinuityEntry = (
  value: unknown,
  index: number,
  context: PreproductionContext,
): ContinuityEntry => {
  const field = `continuity.entries[${index}]`;
  const entry = record(value, field);
  assertKeys(
    entry,
    [
      'id',
      'identity',
      'kind',
      'description',
      'shotIds',
      'referenceAssetId',
      'attributes',
      'constraints',
      'exclusions',
      'approval',
      'revision',
      'supersedes',
    ],
    field,
  );
  const kind = oneOf(entry.kind, CONTINUITY_KINDS, `${field}.kind`);
  const attributesValue = entry.attributes === undefined ? {} : record(entry.attributes, `${field}.attributes`);
  const attributeKeys = Object.keys(attributesValue);
  if (attributeKeys.length > 32) fail(`${field}.attributes must contain at most 32 entries`);
  const attributes: Record<string, string> = {};
  for (const key of attributeKeys) {
    attributes[key] = text(attributesValue[key], `${field}.attributes.${key}`);
  }
  const referenceAssetId =
    entry.referenceAssetId === null || entry.referenceAssetId === undefined
      ? null
      : text(entry.referenceAssetId, `${field}.referenceAssetId`);
  if (referenceAssetId !== null) {
    const asset = context.assets.find((candidate) => candidate.id === referenceAssetId);
    if (!asset) fail(`${field}.referenceAssetId references unknown asset ${referenceAssetId}`);
    if (asset.approval !== 'approved') {
      fail(`${field}.referenceAssetId references unapproved asset ${referenceAssetId}`);
    }
    if (!['image', 'layer', 'video'].includes(asset.kind)) {
      fail(`${field}.referenceAssetId must reference an image, layer or video asset`);
    }
  }
  return {
    id: text(entry.id, `${field}.id`),
    identity: text(entry.identity, `${field}.identity`),
    kind,
    description: text(entry.description, `${field}.description`),
    shotIds: textArray(entry.shotIds, `${field}.shotIds`, 256),
    referenceAssetId,
    attributes,
    constraints: textArray(entry.constraints, `${field}.constraints`),
    exclusions: textArray(entry.exclusions, `${field}.exclusions`),
    approval: approval(entry.approval, `${field}.approval`),
    revision: integer(entry.revision, `${field}.revision`, 1),
    supersedes:
      entry.supersedes === null || entry.supersedes === undefined
        ? null
        : text(entry.supersedes, `${field}.supersedes`),
  };
};

export const validateContinuity = (
  raw: unknown,
  context: PreproductionContext,
): ContinuityDocument => {
  const document = record(raw, 'continuity');
  assertKeys(document, ['schemaVersion', 'projectId', 'revision', 'entries'], 'continuity');
  if (document.schemaVersion !== CONTINUITY_SCHEMA_VERSION) {
    fail(`continuity.schemaVersion must be ${CONTINUITY_SCHEMA_VERSION}`);
  }
  if (text(document.projectId, 'continuity.projectId') !== context.projectId) {
    fail(`continuity.projectId must be ${context.projectId}`);
  }
  const revision = integer(document.revision, 'continuity.revision', 1);
  const rawEntries = array(document.entries, 'continuity.entries');
  if (rawEntries.length > 256) fail('continuity.entries must contain at most 256 entries');
  const entries = rawEntries.map((entry, index) => validateContinuityEntry(entry, index, context));
  uniqueIds(entries, 'continuity.entries');

  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  for (const entry of entries) {
    if (entry.supersedes === null) continue;
    const previous = byId.get(entry.supersedes);
    if (!previous) fail(`continuity entry ${entry.id} supersedes unknown entry ${entry.supersedes}`);
    if (previous.identity !== entry.identity || previous.kind !== entry.kind) {
      fail(`continuity entry ${entry.id} may only supersede the same identity and kind`);
    }
    if (previous.revision >= entry.revision) {
      fail(`continuity entry ${entry.id} must supersede an earlier revision only`);
    }
    if (entry.approval === 'approved' && previous.approval !== 'approved') {
      fail(
        `continuity entry ${entry.id} records an appearance change over an unapproved reference; approve ${previous.id} or replace it explicitly`,
      );
    }
  }

  // Two approved descriptions of the same identity are contradictory unless one
  // explicitly supersedes the other, which is how an intentional appearance
  // change is recorded and approved.
  const approvedEntries = entries.filter((entry) => entry.approval === 'approved');
  for (const [index, left] of approvedEntries.entries()) {
    for (const right of approvedEntries.slice(index + 1)) {
      if (left.identity !== right.identity || left.kind !== right.kind) continue;
      if (left.supersedes === right.id || right.supersedes === left.id) continue;
      fail(
        `continuity identity "${left.identity}" has contradictory approved entries ${left.id} and ${right.id}; ` +
          'record an explicit superseding entry to approve an appearance change',
      );
    }
  }
  return {schemaVersion: CONTINUITY_SCHEMA_VERSION, projectId: context.projectId, revision, entries};
};

const NEEDS_REFERENCE_ASSET: readonly ContinuityEntry['kind'][] = [
  'character',
  'location',
  'appearance',
  'prop',
];

/**
 * Declarative continuity checking only. It compares explicit references; it
 * never inspects pixels, faces or image similarity.
 */
export const checkContinuityUsage = (
  document: ContinuityDocument,
  shots: Array<{id: string; continuityIds: string[]}>,
): ContinuityFinding[] => {
  const findings: ContinuityFinding[] = [];
  const byId = new Map(document.entries.map((entry) => [entry.id, entry]));
  const referenced = new Map<string, string[]>();
  for (const shot of shots) {
    for (const id of shot.continuityIds) {
      const list = referenced.get(id) ?? [];
      list.push(shot.id);
      referenced.set(id, list);
      const entry = byId.get(id);
      if (!entry) {
        findings.push({
          code: 'unknown-reference',
          continuityId: id,
          shotIds: [shot.id],
          message: `shot ${shot.id} references unknown continuity entry ${id}`,
        });
        continue;
      }
      if (entry.approval !== 'approved') {
        findings.push({
          code: 'unapproved-reference',
          continuityId: id,
          shotIds: [shot.id],
          message: `shot ${shot.id} references unapproved continuity entry ${id} (${entry.approval})`,
        });
      }
    }
  }
  for (const entry of document.entries) {
    const actual = referenced.get(entry.id) ?? [];
    const declared = entry.shotIds;
    const same =
      actual.length === declared.length && [...actual].sort().join('|') === [...declared].sort().join('|');
    if (!same) {
      findings.push({
        code: 'shot-declaration-mismatch',
        continuityId: entry.id,
        shotIds: [...new Set([...declared, ...actual])],
        message:
          `continuity entry ${entry.id} declares shots [${declared.join(', ')}] ` +
          `but the storyboard references it from [${actual.join(', ')}]`,
      });
    }
    if (entry.approval === 'approved' && entry.referenceAssetId === null && NEEDS_REFERENCE_ASSET.includes(entry.kind)) {
      findings.push({
        code: 'missing-reference-asset',
        continuityId: entry.id,
        shotIds: actual,
        message: `continuity entry ${entry.id} (${entry.kind}) has no approved reference asset`,
      });
    }
  }
  return findings;
};

export const FATAL_CONTINUITY_CODES: readonly ContinuityFinding['code'][] = [
  'unknown-reference',
  'unapproved-reference',
  'shot-declaration-mismatch',
];
