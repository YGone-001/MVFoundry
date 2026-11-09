import {ConfigValidationError} from '../errors';
import {durationFramesFromSeconds, DURATION_POLICIES} from './duration';
import {parseSceneModules} from './sceneModules';
import {PROJECT_SCENE_RENDERER_PREFIX} from '../scenes/external/constants';
import {
  getStyleMediaRoute,
  getStyleProfile,
  MEDIA_RENDERER_KINDS,
  STYLE_IDS,
  styleMediaRouteSupports,
  type MediaRendererKind,
  type VisualStyleProfile,
} from '../style/catalog';
import {isRegisteredTheme, THEME_IDS} from '../style/themes';
import {
  CAMERA_AMPLITUDE_LIMIT,
  LAYER_MOTION_LIMIT,
  ROLE_ORDER,
  ROLE_PARALLAX_RANGES,
} from '../scenes/parallaxMath';
import type {
  AssetApproval,
  AtmosphereConfig,
  AudioAutomationPoint,
  AudioConfig,
  AudioFormat,
  AudioTrackConfig,
  AudioTrackRole,
  CameraMoveConfig,
  Chapter,
  ComicImpactFrame,
  ComicPanelWipe,
  ComicTreatmentConfig,
  Cue,
  CueSource,
  GradeConfig,
  HybridLayerConfig,
  HybridOverlayConfig,
  LayerMotionConfig,
  LightVariationConfig,
  LightSweepConfig,
  MediaFit,
  NarrativeMode,
  ParallaxBackgroundConfig,
  ParallaxCharacterConfig,
  ParallaxCharacterIdleConfig,
  ParallaxLayerConfig,
  ParallaxLayerRole,
  ParallaxPoseKeyframe,
  ProjectAsset,
  ProjectAssetKind,
  ProjectConfig,
  SceneModuleParams,
  SceneParams,
  Shot,
  ShotHybridMedia,
  ShotMediaConfig,
  ShotParallaxMedia,
  ShotVideoMedia,
  VideoSourceConfig,
  VisualConfig,
} from './types';

const NARRATIVE_MODES: readonly NarrativeMode[] = ['narrative', 'abstract', 'lyric', 'hybrid'];
const CUE_SOURCES: readonly CueSource[] = ['measured', 'estimated', 'synthetic'];
const ASSET_KINDS: readonly ProjectAssetKind[] = ['image', 'video', 'layer', 'audio-reference'];
const APPROVALS: readonly AssetApproval[] = ['approved', 'pending', 'rejected', 'not_present'];
const AUDIO_FORMATS: readonly AudioFormat[] = ['wav-pcm', 'mp3', 'flac', 'm4a-aac'];
const AUDIO_ROLES: readonly AudioTrackRole[] = ['sfx', 'voiceover', 'ambience'];
const MEDIA_FITS: readonly MediaFit[] = ['contain', 'cover'];
const MEDIA_RENDERERS = new Set<string>([...MEDIA_RENDERER_KINDS]);
const PARALLAX_ROLES: readonly ParallaxLayerRole[] = ['midground', 'subject', 'foreground'];
const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const PROJECT_ID_PATTERN = /^[a-z0-9][a-z0-9-]{2,63}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

function fail(message: string): never {
  throw new ConfigValidationError(message);
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

const optionalText = (value: unknown, field: string): string | undefined => {
  if (value === undefined) return undefined;
  return text(value, field);
};

const integer = (value: unknown, field: string, minimum = 0): number => {
  if (!Number.isInteger(value) || (value as number) < minimum) {
    fail(`${field} must be an integer >= ${minimum}`);
  }
  return value as number;
};

const number = (value: unknown, field: string): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail(`${field} must be a finite number`);
  }
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

const oneOf = <T extends string>(value: unknown, allowed: readonly T[], field: string): T => {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    fail(`${field} must be one of: ${allowed.join(', ')}`);
  }
  return value as T;
};

const relativePath = (value: unknown, field: string): string => {
  const result = text(value, field);
  if (/^[a-zA-Z]:[\\/]/.test(result) || result.startsWith('/') || result.startsWith('\\')) {
    fail(`${field} must be a project-relative path`);
  }
  const segments = result.split(/[\\/]+/);
  if (segments.includes('..')) fail(`${field} must not contain parent traversal`);
  return result;
};

const uniqueIds = (items: Array<{id: string}>, field: string): void => {
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.id)) fail(`${field} contains duplicate id ${item.id}`);
    seen.add(item.id);
  }
};

const validateParams = (value: unknown, field: string): SceneParams => {
  const params = record(value, field);
  const result: SceneParams = {};
  result.background = optionalText(params.background, `${field}.background`);
  result.accent = optionalText(params.accent, `${field}.accent`);
  result.secondary = optionalText(params.secondary, `${field}.secondary`);
  result.label = optionalText(params.label, `${field}.label`);
  result.assetId = optionalText(params.assetId, `${field}.assetId`);
  if (params.bars !== undefined) result.bars = integer(params.bars, `${field}.bars`, 1);
  if (params.motion !== undefined) result.motion = number(params.motion, `${field}.motion`);
  const unit = (name: 'washTop' | 'washBottom' | 'overlayOpacity' | 'lineOpacity' | 'grainOpacity'): void => {
    const raw = params[name];
    if (raw === undefined) return;
    const parsed = number(raw, `${field}.${name}`);
    if (!(parsed >= 0 && parsed <= 1)) {
      fail(`${field}.${name} must be between 0 and 1, received ${parsed}`);
    }
    result[name] = parsed;
  };
  unit('washTop');
  unit('washBottom');
  unit('overlayOpacity');
  unit('lineOpacity');
  unit('grainOpacity');
  return result;
};

const MODULE_PARAM_KEY = /^[A-Za-z][A-Za-z0-9_]{0,31}$/;

const validateModuleParams = (
  value: unknown,
  field: string,
): SceneModuleParams | undefined => {
  if (value === undefined) return undefined;
  const params = record(value, field);
  const keys = Object.keys(params);
  if (keys.length > 32) fail(`${field} must contain at most 32 keys`);
  const result: SceneModuleParams = {};
  for (const key of keys.sort()) {
    if (!MODULE_PARAM_KEY.test(key)) fail(`${field}.${key} is not a valid parameter name`);
    const item = params[key];
    if (typeof item === 'string') {
      if (item.length > 1000) fail(`${field}.${key} string is too long`);
      result[key] = item;
    } else if (typeof item === 'number') {
      if (!Number.isFinite(item)) fail(`${field}.${key} must be finite`);
      result[key] = item;
    } else if (typeof item === 'boolean') {
      result[key] = item;
    } else {
      fail(`${field}.${key} must be a string, finite number or boolean`);
    }
  }
  return result;
};

const validateAsset = (value: unknown, index: number): ProjectAsset => {
  const asset = record(value, `assets[${index}]`);
  const id = text(asset.id, `assets[${index}].id`);
  const kind = oneOf(asset.kind, ASSET_KINDS, `assets[${index}].kind`);
  const path = relativePath(asset.path, `assets[${index}].path`);
  const sha256 = text(asset.sha256, `assets[${index}].sha256`);
  if (!SHA256_PATTERN.test(sha256)) fail(`assets[${index}].sha256 must be lowercase hex`);
  return {
    id,
    kind,
    path,
    sha256,
    source: text(asset.source, `assets[${index}].source`),
    rights: text(asset.rights, `assets[${index}].rights`),
    approval: oneOf(asset.approval, APPROVALS, `assets[${index}].approval`),
  };
};

const validateCue = (value: unknown, index: number, fps: number, durationInFrames: number): Cue => {
  const cue = record(value, `cues[${index}]`);
  const frame = integer(cue.frame, `cues[${index}].frame`);
  if (frame > durationInFrames) fail(`cues[${index}].frame exceeds the project duration`);
  const timeSeconds = number(cue.timeSeconds, `cues[${index}].timeSeconds`);
  if (timeSeconds < 0) fail(`cues[${index}].timeSeconds must be non-negative`);
  const expected = frame / fps;
  if (Math.abs(expected - timeSeconds) > 1 / (2 * fps) + 1e-9) {
    fail(`cues[${index}] frame/time disagree: ${frame}/${fps} != ${timeSeconds}`);
  }
  return {
    id: text(cue.id, `cues[${index}].id`),
    frame,
    timeSeconds,
    source: oneOf(cue.source, CUE_SOURCES, `cues[${index}].source`),
    label: text(cue.label, `cues[${index}].label`),
  };
};

const assertKeys = (
  value: Record<string, unknown>,
  allowed: readonly string[],
  field: string,
): void => {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) fail(`${field} contains unsupported key ${key}`);
  }
};

const assertApprovedAssetKind = (
  assetById: ReadonlyMap<string, ProjectAsset>,
  assetId: string,
  kind: ProjectAsset['kind'],
  field: string,
): ProjectAsset => {
  const asset = assetById.get(assetId);
  if (!asset) fail(`${field} references unknown asset ${assetId}`);
  if (asset.approval !== 'approved') {
    fail(`${field} references asset ${assetId} with approval ${asset.approval}`);
  }
  if (asset.kind !== kind) {
    fail(`${field} requires asset kind ${kind}, received ${asset.kind}`);
  }
  return asset;
};

const optionalNumber = (value: unknown, field: string, fallback: number): number => {
  if (value === undefined) return fallback;
  return number(value, field);
};

const validateVideoSource = (
  value: unknown,
  field: string,
  assetById: ReadonlyMap<string, ProjectAsset>,
  fps: number,
  extraKeys: readonly string[] = [],
): VideoSourceConfig => {
  const source = record(value, field);
  assertKeys(
    source,
    [
      'assetId',
      'sourceStartSeconds',
      'fit',
      'endBehavior',
      'muted',
      'positionX',
      'positionY',
      'scale',
      ...extraKeys,
    ],
    field,
  );
  const assetId = text(source.assetId, `${field}.assetId`);
  assertApprovedAssetKind(assetById, assetId, 'video', `${field}.assetId`);
  const sourceStartSeconds = number(source.sourceStartSeconds, `${field}.sourceStartSeconds`);
  if (sourceStartSeconds < 0) fail(`${field}.sourceStartSeconds must be non-negative`);
  const alignedFrame = sourceStartSeconds * fps;
  if (Math.abs(alignedFrame - Math.round(alignedFrame)) > 1e-6) {
    fail(
      `${field}.sourceStartSeconds must align to an output-frame boundary at ${fps}fps (received ${sourceStartSeconds})`,
    );
  }
  const fit = oneOf(source.fit === undefined ? 'cover' : source.fit, MEDIA_FITS, `${field}.fit`);
  const endBehavior = oneOf(
    source.endBehavior === undefined ? 'reject' : source.endBehavior,
    ['reject'] as const,
    `${field}.endBehavior`,
  );
  const muted = source.muted === undefined ? true : boolean(source.muted, `${field}.muted`);
  if (!muted) fail(`${field}.muted must be true; the project audio mix is the only final audio authority`);
  const positionX = optionalNumber(source.positionX, `${field}.positionX`, 0);
  const positionY = optionalNumber(source.positionY, `${field}.positionY`, 0);
  const scale = optionalNumber(source.scale, `${field}.scale`, 1);
  if (!(scale > 0) || scale > 20) fail(`${field}.scale must be greater than 0 and at most 20`);
  return {
    assetId,
    sourceStartSeconds,
    fit,
    endBehavior,
    muted: true,
    positionX,
    positionY,
    scale,
  };
};

const validateHybridLayer = (
  value: unknown,
  field: string,
  assetById: ReadonlyMap<string, ProjectAsset>,
  shotLength: number,
): HybridLayerConfig => {
  const layer = record(value, field);
  assertKeys(
    layer,
    [
      'assetId',
      'order',
      'opacity',
      'fit',
      'positionX',
      'positionY',
      'scale',
      'visibleFromFrame',
      'visibleToFrame',
    ],
    field,
  );
  const assetId = text(layer.assetId, `${field}.assetId`);
  assertApprovedAssetKind(assetById, assetId, 'layer', `${field}.assetId`);
  const order = integer(layer.order, `${field}.order`, 0);
  if (order > 31) fail(`${field}.order must be at most 31`);
  const opacity = optionalNumber(layer.opacity, `${field}.opacity`, 1);
  if (opacity < 0 || opacity > 1) fail(`${field}.opacity must be in [0, 1]`);
  const fit = oneOf(layer.fit === undefined ? 'cover' : layer.fit, MEDIA_FITS, `${field}.fit`);
  const positionX = optionalNumber(layer.positionX, `${field}.positionX`, 0);
  const positionY = optionalNumber(layer.positionY, `${field}.positionY`, 0);
  const scale = optionalNumber(layer.scale, `${field}.scale`, 1);
  if (!(scale > 0) || scale > 20) fail(`${field}.scale must be greater than 0 and at most 20`);
  const visibleFromFrame = integer(layer.visibleFromFrame ?? 0, `${field}.visibleFromFrame`, 0);
  const visibleToFrame = integer(
    layer.visibleToFrame ?? shotLength,
    `${field}.visibleToFrame`,
    0,
  );
  if (visibleFromFrame >= visibleToFrame) fail(`${field} visibility range must be non-empty`);
  if (visibleToFrame > shotLength) {
    fail(`${field}.visibleToFrame exceeds the shot-local duration ${shotLength}`);
  }
  return {
    assetId,
    order,
    opacity,
    fit,
    positionX,
    positionY,
    scale,
    visibleFromFrame,
    visibleToFrame,
  };
};

const validateOverlay = (value: unknown, field: string): HybridOverlayConfig => {
  const overlay = record(value, field);
  assertKeys(overlay, ['kind', 'intensity', 'color'], field);
  const kind = oneOf(overlay.kind, ['rain', 'orbits', 'scan'] as const, `${field}.kind`);
  const intensity = optionalNumber(overlay.intensity, `${field}.intensity`, 0.5);
  if (intensity < 0 || intensity > 1) fail(`${field}.intensity must be in [0, 1]`);
  const color = optionalText(overlay.color, `${field}.color`);
  return {kind, intensity, color};
};

const numberInRange = (
  value: unknown,
  field: string,
  minimum: number,
  maximum: number,
): number => {
  const parsed = number(value, field);
  if (parsed < minimum || parsed > maximum) {
    fail(`${field} must be in [${minimum}, ${maximum}], received ${parsed}`);
  }
  return parsed;
};

const optionalNumberInRange = (
  value: unknown,
  field: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number => (value === undefined ? fallback : numberInRange(value, field, minimum, maximum));

const color = (value: unknown, field: string): string => {
  const parsed = text(value, field);
  if (!HEX_COLOR.test(parsed)) fail(`${field} must be a #rrggbb colour`);
  return parsed.toLowerCase();
};

const validateLayerMotion = (value: unknown, field: string): LayerMotionConfig => {
  const motion = record(value, field);
  assertKeys(
    motion,
    [
      'translateXFrom',
      'translateXTo',
      'translateYFrom',
      'translateYTo',
      'fromFrame',
      'toFrame',
      'easing',
    ],
    field,
  );
  const translateXFrom = numberInRange(
    motion.translateXFrom,
    `${field}.translateXFrom`,
    -LAYER_MOTION_LIMIT,
    LAYER_MOTION_LIMIT,
  );
  const translateXTo = numberInRange(
    motion.translateXTo,
    `${field}.translateXTo`,
    -LAYER_MOTION_LIMIT,
    LAYER_MOTION_LIMIT,
  );
  const translateYFrom = numberInRange(
    motion.translateYFrom,
    `${field}.translateYFrom`,
    -LAYER_MOTION_LIMIT,
    LAYER_MOTION_LIMIT,
  );
  const translateYTo = numberInRange(
    motion.translateYTo,
    `${field}.translateYTo`,
    -LAYER_MOTION_LIMIT,
    LAYER_MOTION_LIMIT,
  );
  const fromFrame =
    motion.fromFrame === undefined ? undefined : integer(motion.fromFrame, `${field}.fromFrame`, 0);
  const toFrame =
    motion.toFrame === undefined ? undefined : integer(motion.toFrame, `${field}.toFrame`, 0);
  if (fromFrame !== undefined && toFrame !== undefined && fromFrame >= toFrame) {
    fail(`${field} requires fromFrame < toFrame`);
  }
  if (
    Math.abs(translateXFrom - translateXTo) < 1e-9 &&
    Math.abs(translateYFrom - translateYTo) < 1e-9
  ) {
    fail(`${field} declares no movement; omit motion for a static layer`);
  }
  return {
    translateXFrom,
    translateXTo,
    translateYFrom,
    translateYTo,
    ...(fromFrame === undefined ? {} : {fromFrame}),
    ...(toFrame === undefined ? {} : {toFrame}),
    easing: oneOf(
      motion.easing === undefined ? 'easeInOut' : motion.easing,
      ['linear', 'easeInOut'] as const,
      `${field}.easing`,
    ),
  };
};

const validateParallaxLayer = (
  value: unknown,
  field: string,
  assetById: ReadonlyMap<string, ProjectAsset>,
  shotLength: number,
): ParallaxLayerConfig => {
  const layer = record(value, field);
  assertKeys(
    layer,
    [
      'assetId',
      'role',
      'order',
      'parallax',
      'opacity',
      'fit',
      'positionX',
      'positionY',
      'scale',
      'visibleFromFrame',
      'visibleToFrame',
      'motion',
      'blur',
    ],
    field,
  );
  const assetId = text(layer.assetId, `${field}.assetId`);
  assertApprovedAssetKind(assetById, assetId, 'layer', `${field}.assetId`);
  const role = oneOf(layer.role, PARALLAX_ROLES, `${field}.role`);
  const range = ROLE_PARALLAX_RANGES[role];
  const parallax = numberInRange(layer.parallax, `${field}.parallax`, range.min, range.max);
  const order = integer(layer.order, `${field}.order`, 0);
  if (order > 31) fail(`${field}.order must be at most 31`);
  const opacity = optionalNumberInRange(layer.opacity, `${field}.opacity`, 1, 0, 1);
  const blur = optionalNumberInRange(layer.blur, `${field}.blur`, 0, 0, 16);
  const fit = oneOf(layer.fit === undefined ? 'cover' : layer.fit, MEDIA_FITS, `${field}.fit`);
  const positionX = optionalNumber(layer.positionX, `${field}.positionX`, 0);
  const positionY = optionalNumber(layer.positionY, `${field}.positionY`, 0);
  const scale = optionalNumber(layer.scale, `${field}.scale`, 1);
  if (!(scale > 0) || scale > 20) fail(`${field}.scale must be greater than 0 and at most 20`);
  const visibleFromFrame = integer(layer.visibleFromFrame ?? 0, `${field}.visibleFromFrame`, 0);
  const visibleToFrame = integer(
    layer.visibleToFrame ?? shotLength,
    `${field}.visibleToFrame`,
    0,
  );
  if (visibleFromFrame >= visibleToFrame) fail(`${field} visibility range must be non-empty`);
  if (visibleToFrame > shotLength) {
    fail(`${field}.visibleToFrame exceeds the shot-local duration ${shotLength}`);
  }
  const motion =
    layer.motion === undefined ? undefined : validateLayerMotion(layer.motion, `${field}.motion`);
  return {
    assetId,
    role,
    order,
    parallax,
    opacity,
    fit,
    positionX,
    positionY,
    scale,
    visibleFromFrame,
    visibleToFrame,
    blur,
    ...(motion === undefined ? {} : {motion}),
  };
};

const validateParallaxIdle = (
  value: unknown,
  field: string,
): ParallaxCharacterIdleConfig => {
  const idle = record(value, field);
  assertKeys(idle, ['amplitude', 'periodFrames'], field);
  return {
    amplitude: numberInRange(idle.amplitude, `${field}.amplitude`, 0, 0.06),
    periodFrames: numberInRange(idle.periodFrames, `${field}.periodFrames`, 8, 240),
  };
};

/**
 * A character pose sequence is the authored performance. It must tile the shot
 * exactly: no gap, no overlap and no substitute for an unapproved drawing.
 */
const validateParallaxCharacters = (
  value: unknown,
  field: string,
  assetById: ReadonlyMap<string, ProjectAsset>,
  shotLength: number,
): ParallaxCharacterConfig[] => {
  const raw = value === undefined ? [] : array(value, field);
  if (raw.length === 0) return [];
  if (raw.length > 4) fail(`${field} must contain at most 4 characters`);
  const characters = raw.map((entry, index) => {
    const entryField = `${field}[${index}]`;
    const character = record(entry, entryField);
    assertKeys(
      character,
      [
        'characterId',
        'role',
        'order',
        'parallax',
        'anchorX',
        'anchorY',
        'pivotX',
        'pivotY',
        'height',
        'breathe',
        'sway',
        'poses',
      ],
      entryField,
    );
    const characterId = text(character.characterId, `${entryField}.characterId`);
    if (!/^[a-z0-9][a-z0-9-]{1,31}$/.test(characterId)) {
      fail(`${entryField}.characterId must be a lowercase id`);
    }
    if (character.role !== 'subject') {
      fail(`${entryField}.role must be "subject"; other roles are static layers`);
    }
    const order = integer(character.order, `${entryField}.order`, 0);
    if (order > 31) fail(`${entryField}.order must be at most 31`);
    const range = ROLE_PARALLAX_RANGES.subject;
    const parallax = numberInRange(character.parallax, `${entryField}.parallax`, range.min, range.max);
    const anchorX = numberInRange(character.anchorX, `${entryField}.anchorX`, -0.25, 1.25);
    const anchorY = numberInRange(character.anchorY, `${entryField}.anchorY`, 0, 1.6);
    const pivotX = numberInRange(character.pivotX, `${entryField}.pivotX`, 0, 1);
    const pivotY = numberInRange(character.pivotY, `${entryField}.pivotY`, 0, 1);
    const height = numberInRange(character.height, `${entryField}.height`, 0.1, 2);
    const breathe =
      character.breathe === undefined
        ? undefined
        : validateParallaxIdle(character.breathe, `${entryField}.breathe`);
    const sway =
      character.sway === undefined
        ? undefined
        : validateParallaxIdle(character.sway, `${entryField}.sway`);

    const rawPoses = array(character.poses, `${entryField}.poses`);
    if (rawPoses.length === 0) fail(`${entryField}.poses must declare at least one pose`);
    if (rawPoses.length > 24) fail(`${entryField}.poses must declare at most 24 poses`);
    const poses: ParallaxPoseKeyframe[] = rawPoses.map((poseValue, poseIndex) => {
      const poseField = `${entryField}.poses[${poseIndex}]`;
      const pose = record(poseValue, poseField);
      assertKeys(
        pose,
        ['assetId', 'fromFrame', 'toFrame', 'transition', 'fadeFrames', 'offsetX', 'offsetY', 'scale', 'opacity'],
        poseField,
      );
      const assetId = text(pose.assetId, `${poseField}.assetId`);
      assertApprovedAssetKind(assetById, assetId, 'layer', `${poseField}.assetId`);
      const fromFrame = integer(pose.fromFrame, `${poseField}.fromFrame`, 0);
      const toFrame = integer(pose.toFrame, `${poseField}.toFrame`, 0);
      if (toFrame <= fromFrame) fail(`${poseField} range must be non-empty`);
      if (toFrame > shotLength) {
        fail(`${poseField}.toFrame exceeds the shot-local duration ${shotLength}`);
      }
      const transition = oneOf(
        pose.transition === undefined ? 'cut' : pose.transition,
        ['cut', 'crossfade'] as const,
        `${poseField}.transition`,
      );
      const fadeFrames =
        transition === 'cut'
          ? optionalNumberInRange(pose.fadeFrames, `${poseField}.fadeFrames`, 0, 0, 0)
          : numberInRange(pose.fadeFrames ?? 4, `${poseField}.fadeFrames`, 2, 12);
      if (fadeFrames >= toFrame - fromFrame) {
        fail(`${poseField}.fadeFrames must stay inside its own pose range`);
      }
      return {
        assetId,
        fromFrame,
        toFrame,
        transition,
        fadeFrames,
        offsetX: numberInRange(pose.offsetX ?? 0, `${poseField}.offsetX`, -0.7, 0.7),
        offsetY: numberInRange(pose.offsetY ?? 0, `${poseField}.offsetY`, -0.5, 0.5),
        scale: numberInRange(pose.scale ?? 1, `${poseField}.scale`, 0.5, 2.5),
        opacity: numberInRange(pose.opacity ?? 1, `${poseField}.opacity`, 0, 1),
      };
    });
    let cursor = 0;
    for (const [poseIndex, pose] of poses.entries()) {
      if (pose.fromFrame !== cursor) {
        fail(
          `${entryField}.poses[${poseIndex}] starts at ${pose.fromFrame} but the previous pose ended at ${cursor}; poses must tile the shot`,
        );
      }
      cursor = pose.toFrame;
    }
    if (cursor !== shotLength) {
      fail(`${entryField}.poses end at ${cursor} but the shot lasts ${shotLength} frames`);
    }
    return {
      characterId,
      role: 'subject' as const,
      order,
      parallax,
      anchorX,
      anchorY,
      pivotX,
      pivotY,
      height,
      ...(breathe === undefined ? {} : {breathe}),
      ...(sway === undefined ? {} : {sway}),
      poses,
    };
  });
  const ids = new Set<string>();
  for (const character of characters) {
    if (ids.has(character.characterId)) {
      fail(`${field} contains duplicate characterId ${character.characterId}`);
    }
    ids.add(character.characterId);
  }
  return characters;
};

const validateParallaxBackground = (
  value: unknown,
  field: string,
  assetById: ReadonlyMap<string, ProjectAsset>,
  fps: number,
): ParallaxBackgroundConfig => {
  const background = record(value, field);
  const kind = oneOf(background.kind, ['image', 'video'] as const, `${field}.kind`);
  if (kind === 'image') {
    assertKeys(
      background,
      ['kind', 'assetId', 'opacity', 'fit', 'positionX', 'positionY', 'scale', 'parallax', 'blur'],
      field,
    );
    const assetId = text(background.assetId, `${field}.assetId`);
    assertApprovedAssetKind(assetById, assetId, 'image', `${field}.assetId`);
    const parallax = numberInRange(background.parallax, `${field}.parallax`, 0, 0.12);
    return {
      kind: 'image',
      assetId,
      opacity: optionalNumberInRange(background.opacity, `${field}.opacity`, 1, 0, 1),
      fit: oneOf(background.fit === undefined ? 'cover' : background.fit, MEDIA_FITS, `${field}.fit`),
      positionX: optionalNumber(background.positionX, `${field}.positionX`, 0),
      positionY: optionalNumber(background.positionY, `${field}.positionY`, 0),
      scale: optionalNumberInRange(background.scale, `${field}.scale`, 1, 0.05, 20),
      parallax,
      blur: optionalNumberInRange(background.blur, `${field}.blur`, 0, 0, 16),
    };
  }
  const video = validateVideoSource(background, field, assetById, fps, [
    'kind',
    'opacity',
    'parallax',
    'blur',
  ]);
  return {
    ...video,
    kind: 'video',
    opacity: optionalNumberInRange(background.opacity, `${field}.opacity`, 1, 0, 1),
    parallax: numberInRange(background.parallax, `${field}.parallax`, 0, 0.12),
    blur: optionalNumberInRange(background.blur, `${field}.blur`, 0, 0, 16),
  };
};

const validateCameraMove = (value: unknown, field: string): CameraMoveConfig => {
  const camera = record(value, field);
  assertKeys(
    camera,
    ['kind', 'fromX', 'fromY', 'fromZoom', 'toX', 'toY', 'toZoom', 'easing'],
    field,
  );
  const kind = oneOf(
    camera.kind,
    ['pan', 'push-in', 'pull-back', 'hold'] as const,
    `${field}.kind`,
  );
  const limit = CAMERA_AMPLITUDE_LIMIT;
  const fromX = numberInRange(camera.fromX, `${field}.fromX`, -limit, limit);
  const fromY = numberInRange(camera.fromY, `${field}.fromY`, -limit, limit);
  const toX = numberInRange(camera.toX, `${field}.toX`, -limit, limit);
  const toY = numberInRange(camera.toY, `${field}.toY`, -limit, limit);
  const fromZoom = numberInRange(camera.fromZoom, `${field}.fromZoom`, 1, 2.5);
  const toZoom = numberInRange(camera.toZoom, `${field}.toZoom`, 1, 2.5);
  const easing = oneOf(
    camera.easing === undefined ? 'easeInOut' : camera.easing,
    ['linear', 'easeInOut'] as const,
    `${field}.easing`,
  );
  const travel = Math.abs(toX - fromX) + Math.abs(toY - fromY);
  const zoomDelta = toZoom - fromZoom;
  if (kind === 'pan') {
    if (Math.abs(zoomDelta) > 1e-9) fail(`${field}.kind pan requires a constant zoom`);
    if (travel < 1e-6) fail(`${field}.kind pan requires a non-zero horizontal or vertical pan`);
  } else if (kind === 'push-in') {
    if (!(zoomDelta > 1e-6)) fail(`${field}.kind push-in requires toZoom > fromZoom`);
  } else if (kind === 'pull-back') {
    if (!(zoomDelta < -1e-6)) fail(`${field}.kind pull-back requires toZoom < fromZoom`);
  } else if (travel > 1e-6 || Math.abs(zoomDelta) > 1e-6) {
    fail(`${field}.kind hold requires an unmoving camera`);
  }
  return {kind, fromX, fromY, fromZoom, toX, toY, toZoom, easing};
};

const validateAtmosphere = (value: unknown, field: string): AtmosphereConfig => {
  const atmosphere = record(value, field);
  assertKeys(atmosphere, ['kind', 'intensity', 'windX'], field);
  return {
    kind: oneOf(
      atmosphere.kind === undefined ? 'none' : atmosphere.kind,
      ['rain', 'mist', 'rain-mist', 'none'] as const,
      `${field}.kind`,
    ),
    intensity: optionalNumberInRange(atmosphere.intensity, `${field}.intensity`, 0, 0, 1),
    windX: optionalNumberInRange(atmosphere.windX, `${field}.windX`, 0, -0.4, 0.4),
  };
};

const validateLightSweep = (value: unknown, field: string): LightSweepConfig => {
  const sweep = record(value, field);
  assertKeys(sweep, ['intensity', 'fromX', 'toX', 'width', 'color'], field);
  const fromX = numberInRange(sweep.fromX, `${field}.fromX`, -1, 2);
  const toX = numberInRange(sweep.toX, `${field}.toX`, -1, 2);
  if (Math.abs(toX - fromX) < 1e-6) fail(`${field} must travel between fromX and toX`);
  return {
    intensity: numberInRange(sweep.intensity, `${field}.intensity`, 0, 1),
    fromX,
    toX,
    width: numberInRange(sweep.width, `${field}.width`, 0.02, 1),
    ...(sweep.color === undefined ? {} : {color: color(sweep.color, `${field}.color`)}),
  };
};

const validateLightVariation = (value: unknown, field: string): LightVariationConfig => {
  const light = record(value, field);
  assertKeys(light, ['amplitude', 'frequency', 'phase', 'sweep'], field);
  return {
    amplitude: optionalNumberInRange(light.amplitude, `${field}.amplitude`, 0, 0, 0.35),
    frequency: optionalNumberInRange(light.frequency, `${field}.frequency`, 0, 0, 8),
    phase: optionalNumberInRange(light.phase, `${field}.phase`, 0, 0, 1),
    ...(light.sweep === undefined
      ? {}
      : {sweep: validateLightSweep(light.sweep, `${field}.sweep`)}),
  };
};

const validateGrade = (value: unknown, field: string): Partial<GradeConfig> | undefined => {
  if (value === undefined) return undefined;
  const grade = record(value, field);
  assertKeys(
    grade,
    ['saturation', 'contrast', 'brightness', 'tint', 'tintOpacity', 'vignette', 'grain'],
    field,
  );
  const result: Partial<GradeConfig> = {};
  if (grade.saturation !== undefined) {
    result.saturation = numberInRange(grade.saturation, `${field}.saturation`, 0.2, 2.5);
  }
  if (grade.contrast !== undefined) {
    result.contrast = numberInRange(grade.contrast, `${field}.contrast`, 0.2, 2.5);
  }
  if (grade.brightness !== undefined) {
    result.brightness = numberInRange(grade.brightness, `${field}.brightness`, 0.4, 2.2);
  }
  if (grade.tint !== undefined) result.tint = color(grade.tint, `${field}.tint`);
  if (grade.tintOpacity !== undefined) {
    result.tintOpacity = numberInRange(grade.tintOpacity, `${field}.tintOpacity`, 0, 0.5);
  }
  if (grade.vignette !== undefined) {
    result.vignette = numberInRange(grade.vignette, `${field}.vignette`, 0, 1);
  }
  if (grade.grain !== undefined) {
    result.grain = numberInRange(grade.grain, `${field}.grain`, 0, 0.4);
  }
  return result;
};

const validateComicTreatment = (
  value: unknown,
  field: string,
  shotLength: number,
  fps: number,
): Partial<ComicTreatmentConfig> => {
  const comic = record(value, field);
  assertKeys(
    comic,
    ['motionStepFps', 'halftone', 'speedLines', 'panel', 'impacts', 'wipes'],
    field,
  );
  const result: Partial<ComicTreatmentConfig> = {};
  if (comic.motionStepFps !== undefined) {
    const step = integer(comic.motionStepFps, `${field}.motionStepFps`, 1);
    if (step > fps) fail(`${field}.motionStepFps must not exceed the output fps ${fps}`);
    result.motionStepFps = step;
  }
  if (comic.halftone !== undefined) {
    result.halftone = numberInRange(comic.halftone, `${field}.halftone`, 0, 1);
  }
  if (comic.speedLines !== undefined) {
    result.speedLines = numberInRange(comic.speedLines, `${field}.speedLines`, 0, 1);
  }
  if (comic.panel !== undefined) {
    const panel = record(comic.panel, `${field}.panel`);
    assertKeys(panel, ['gutter', 'color', 'inset'], `${field}.panel`);
    const gutter = numberInRange(panel.gutter, `${field}.panel.gutter`, 0, 160);
    const inset = optionalNumberInRange(panel.inset, `${field}.panel.inset`, 0, 0, 0.2);
    result.panel = {
      gutter,
      inset,
      color: panel.color === undefined ? '#0a0a12' : color(panel.color, `${field}.panel.color`),
    };
  }
  if (comic.impacts !== undefined) {
    const raw = array(comic.impacts, `${field}.impacts`);
    if (raw.length > 8) fail(`${field}.impacts may contain at most 8 entries`);
    const impacts: ComicImpactFrame[] = [];
    let previous = -1;
    for (const [index, entry] of raw.entries()) {
      const impactField = `${field}.impacts[${index}]`;
      const impact = record(entry, impactField);
      assertKeys(impact, ['frame', 'intensity', 'color'], impactField);
      const frame = integer(impact.frame, `${impactField}.frame`, 0);
      if (frame >= shotLength) {
        fail(`${impactField}.frame must be inside the shot-local duration ${shotLength}`);
      }
      if (frame <= previous) fail(`${field}.impacts must have strictly increasing frames`);
      previous = frame;
      impacts.push({
        frame,
        intensity: numberInRange(impact.intensity, `${impactField}.intensity`, 0.05, 1),
        ...(impact.color === undefined
          ? {}
          : {color: color(impact.color, `${impactField}.color`)}),
      });
    }
    result.impacts = impacts;
  }
  if (comic.wipes !== undefined) {
    const raw = array(comic.wipes, `${field}.wipes`);
    if (raw.length > 8) fail(`${field}.wipes may contain at most 8 entries`);
    const wipes: ComicPanelWipe[] = [];
    let previous = -1;
    for (const [index, entry] of raw.entries()) {
      const wipeField = `${field}.wipes[${index}]`;
      const wipe = record(entry, wipeField);
      assertKeys(wipe, ['frame', 'direction', 'color', 'holdFrames'], wipeField);
      const frame = integer(wipe.frame, `${wipeField}.frame`, 0);
      if (frame >= shotLength) {
        fail(`${wipeField}.frame must be inside the shot-local duration ${shotLength}`);
      }
      if (frame <= previous) fail(`${field}.wipes must have strictly increasing frames`);
      previous = frame;
      wipes.push({
        frame,
        direction: oneOf(
          wipe.direction,
          ['left', 'right', 'up', 'down'] as const,
          `${wipeField}.direction`,
        ),
        holdFrames: optionalNumberInRange(wipe.holdFrames, `${wipeField}.holdFrames`, 2, 1, 12),
        ...(wipe.color === undefined ? {} : {color: color(wipe.color, `${wipeField}.color`)}),
      });
    }
    result.wipes = wipes;
  }
  return result;
};

const validateParallaxMedia = (
  value: unknown,
  field: string,
  assetById: ReadonlyMap<string, ProjectAsset>,
  shotLength: number,
  fps: number,
): ShotParallaxMedia => {
  const media = record(value, field);
  assertKeys(
    media,
    ['kind', 'background', 'layers', 'characters', 'camera', 'atmosphere', 'light', 'grade', 'comic'],
    field,
  );
  const background = validateParallaxBackground(
    media.background,
    `${field}.background`,
    assetById,
    fps,
  );
  const rawLayers = array(media.layers, `${field}.layers`);
  if (rawLayers.length === 0) fail(`${field}.layers must contain at least one layer`);
  if (rawLayers.length > 16) fail(`${field}.layers must contain at most 16 layers`);
  const layers = rawLayers.map((layer, index) =>
    validateParallaxLayer(layer, `${field}.layers[${index}]`, assetById, shotLength),
  );
  const characters = validateParallaxCharacters(
    media.characters,
    `${field}.characters`,
    assetById,
    shotLength,
  );
  const orders = new Set<number>();
  for (const layer of layers) {
    if (orders.has(layer.order)) fail(`${field}.layers contains duplicate order ${layer.order}`);
    orders.add(layer.order);
  }
  for (const character of characters) {
    if (orders.has(character.order)) {
      fail(
        `${field} character ${character.characterId} reuses order ${character.order}; draw order must be unambiguous across layers and characters`,
      );
    }
    orders.add(character.order);
  }
  for (const role of ['midground', 'foreground'] as const) {
    if (!layers.some((layer) => layer.role === role)) {
      fail(`${field}.layers requires at least one ${role} layer for a valid two-and-a-half-D shot`);
    }
  }
  let previousRank = -1;
  const drawOrder: Array<{order: number; role: ParallaxLayerRole}> = [
    ...layers.map((layer) => ({order: layer.order, role: layer.role})),
    ...characters.map((character) => ({order: character.order, role: character.role})),
  ].sort((left, right) => left.order - right.order);
  for (const entry of drawOrder) {
    const rank = ROLE_ORDER[entry.role];
    if (rank < previousRank) {
      fail(
        `${field} draw order is wrong: ${entry.role} appears after a nearer depth tier; background, midground, subject, foreground must increase with order`,
      );
    }
    previousRank = rank;
  }
  const depths = [
    background.parallax,
    ...layers.map((layer) => layer.parallax),
    ...characters.map((character) => character.parallax),
  ];
  if (Math.max(...depths) - Math.min(...depths) < 0.25) {
    fail(
      `${field} depth span must be at least 0.25 between the nearest and farthest layer so parallax is measurable`,
    );
  }
  const camera = validateCameraMove(media.camera, `${field}.camera`);
  const atmosphere = validateAtmosphere(media.atmosphere, `${field}.atmosphere`);
  const light = validateLightVariation(media.light, `${field}.light`);
  const grade = validateGrade(media.grade, `${field}.grade`);
  const comic =
    media.comic === undefined
      ? undefined
      : validateComicTreatment(media.comic, `${field}.comic`, shotLength, fps);
  return {
    kind: 'parallax-2p5d',
    background,
    layers,
    ...(characters.length === 0 ? {} : {characters}),
    camera,
    atmosphere,
    light,
    ...(grade === undefined ? {} : {grade}),
    ...(comic === undefined ? {} : {comic}),
  };
};

export const mediaRendererNeedsCapability = (
  media: ShotMediaConfig,
): ReadonlyArray<'image-plate' | 'video-plate' | 'comic-treatment'> => {
  if (media.kind === 'parallax-2p5d') {
    const needs: Array<'image-plate' | 'video-plate' | 'comic-treatment'> = [
      media.background.kind === 'video' ? 'video-plate' : 'image-plate',
    ];
    if (media.comic !== undefined) needs.push('comic-treatment');
    return needs;
  }
  return ['video-plate'];
};

const assertMediaRendererStyle = (
  renderer: MediaRendererKind,
  media: ShotMediaConfig | undefined,
  profile: VisualStyleProfile | undefined,
  label: string,
): void => {
  if (!profile) return;
  const route = getStyleMediaRoute(profile, renderer);
  if (!route) {
    fail(
      `${label} uses renderer ${renderer}, which style ${profile.id} does not declare; declared media routes: ${profile.mediaRoutes.map((entry) => entry.renderer).join(', ') || 'none'}`,
    );
  }
  if (!media) {
    fail(
      `${label} uses renderer ${renderer} without shot media; media renderers require an explicit media declaration`,
    );
  }
  for (const capability of mediaRendererNeedsCapability(media)) {
    if (!styleMediaRouteSupports(route, capability)) {
      fail(
        `${label} style ${profile.id} media route ${renderer} does not support ${capability}; declared: ${route.capabilities.join(', ') || 'none'}`,
      );
    }
  }
};

const validateMedia = (
  value: unknown,
  field: string,
  renderer: string,
  assetById: ReadonlyMap<string, ProjectAsset>,
  shotLength: number,
  fps: number,
): ShotMediaConfig => {
  const media = record(value, field);
  const kind = oneOf(media.kind, ['video', 'hybrid', 'parallax-2p5d'] as const, `${field}.kind`);
  if (kind !== renderer) {
    fail(`${field}.kind must match renderer "${renderer}", received "${kind}"`);
  }
  if (kind === 'video') {
    return {
      kind: 'video',
      ...validateVideoSource(media, field, assetById, fps, ['kind']),
    } satisfies ShotVideoMedia;
  }
  if (kind === 'parallax-2p5d') {
    return validateParallaxMedia(value, field, assetById, shotLength, fps);
  }
  assertKeys(media, ['kind', 'video', 'layers', 'overlay'], field);
  const video = validateVideoSource(media.video, `${field}.video`, assetById, fps);
  const rawLayers = array(media.layers, `${field}.layers`);
  if (rawLayers.length === 0) fail(`${field}.layers must contain at least one layer`);
  if (rawLayers.length > 16) fail(`${field}.layers must contain at most 16 layers`);
  const layers = rawLayers.map((layer, index) =>
    validateHybridLayer(layer, `${field}.layers[${index}]`, assetById, shotLength),
  );
  const orders = new Set<number>();
  for (const layer of layers) {
    if (orders.has(layer.order)) fail(`${field}.layers contains duplicate order ${layer.order}`);
    orders.add(layer.order);
  }
  const overlay = validateOverlay(media.overlay, `${field}.overlay`);
  return {kind: 'hybrid', video, layers, overlay} satisfies ShotHybridMedia;
};

const validateAudioAutomation = (
  value: unknown,
  field: string,
  trackDurationFrames: number,
): AudioAutomationPoint[] => {
  if (value === undefined) return [];
  const raw = array(value, field);
  if (raw.length > 32) fail(`${field} must contain at most 32 points`);
  const points: AudioAutomationPoint[] = [];
  let previousFrame = -1;
  for (const [index, entry] of raw.entries()) {
    const point = record(entry, `${field}[${index}]`);
    assertKeys(point, ['frame', 'gainDb'], `${field}[${index}]`);
    const frame = integer(point.frame, `${field}[${index}].frame`, 0);
    if (frame > trackDurationFrames) {
      fail(`${field}[${index}].frame exceeds the allowed duration ${trackDurationFrames}`);
    }
    if (frame <= previousFrame) fail(`${field} must have strictly increasing frames`);
    previousFrame = frame;
    const gainDb = number(point.gainDb, `${field}[${index}].gainDb`);
    if (gainDb < -60 || gainDb > 12) fail(`${field}[${index}].gainDb must be in [-60, 12]`);
    points.push({frame, gainDb});
  }
  return points;
};

const validateAudioTracks = (
  value: unknown,
  field: string,
  assetById: ReadonlyMap<string, ProjectAsset>,
  fps: number,
  durationInFrames: number,
): AudioTrackConfig[] => {
  if (value === undefined) return [];
  const raw = array(value, field);
  if (raw.length > 32) fail(`${field} must contain at most 32 tracks`);
  const seen = new Set<string>();
  const tracks: AudioTrackConfig[] = [];
  for (const [index, entry] of raw.entries()) {
    const trackField = `${field}[${index}]`;
    const track = record(entry, trackField);
    assertKeys(
      track,
      [
        'id',
        'role',
        'assetId',
        'startFrame',
        'durationFrames',
        'sourceStartSeconds',
        'gainDb',
        'fadeInFrames',
        'fadeOutFrames',
        'muted',
        'gainAutomation',
      ],
      trackField,
    );
    const id = text(track.id, `${trackField}.id`);
    if (!PROJECT_ID_PATTERN.test(id)) fail(`${trackField}.id must be lowercase letters, digits and hyphens (3-64 chars)`);
    if (seen.has(id)) fail(`${field} contains duplicate id ${id}`);
    seen.add(id);
    const role = oneOf(track.role, AUDIO_ROLES, `${trackField}.role`);
    const assetId = text(track.assetId, `${trackField}.assetId`);
    assertApprovedAssetKind(assetById, assetId, 'audio-reference', `${trackField}.assetId`);
    const startFrame = integer(track.startFrame, `${trackField}.startFrame`);
    const durationFrames = integer(track.durationFrames, `${trackField}.durationFrames`, 1);
    if (startFrame + durationFrames > durationInFrames) {
      fail(`${trackField} exceeds the project duration ${durationInFrames}`);
    }
    const sourceStartSeconds = number(track.sourceStartSeconds, `${trackField}.sourceStartSeconds`);
    if (sourceStartSeconds < 0) fail(`${trackField}.sourceStartSeconds must be non-negative`);
    const aligned = sourceStartSeconds * fps;
    if (Math.abs(aligned - Math.round(aligned)) > 1e-6) {
      fail(`${trackField}.sourceStartSeconds must align to an output-frame boundary at ${fps}fps`);
    }
    const gainDb = number(track.gainDb, `${trackField}.gainDb`);
    if (gainDb < -60 || gainDb > 12) fail(`${trackField}.gainDb must be in [-60, 12]`);
    const fadeInFrames = integer(track.fadeInFrames, `${trackField}.fadeInFrames`, 0);
    const fadeOutFrames = integer(track.fadeOutFrames, `${trackField}.fadeOutFrames`, 0);
    if (fadeInFrames + fadeOutFrames > durationFrames) {
      fail(`${trackField} fades exceed the track duration`);
    }
    const muted = track.muted === undefined ? false : boolean(track.muted, `${trackField}.muted`);
    const gainAutomation = validateAudioAutomation(
      track.gainAutomation,
      `${trackField}.gainAutomation`,
      durationFrames,
    );
    tracks.push({
      id,
      role,
      assetId,
      startFrame,
      durationFrames,
      sourceStartSeconds,
      gainDb,
      fadeInFrames,
      fadeOutFrames,
      muted,
      gainAutomation,
    });
  }
  return tracks;
};

const validateShot = (
  value: unknown,
  field: string,
  assetById: ReadonlyMap<string, ProjectAsset>,
  fps: number,
): Shot => {
  const shot = record(value, field);
  const startFrame = integer(shot.startFrame, `${field}.startFrame`);
  const endFrame = integer(shot.endFrame, `${field}.endFrame`);
  if (endFrame <= startFrame) fail(`${field} must satisfy startFrame < endFrame`);
  const renderer = text(shot.renderer, `${field}.renderer`);
  const isMediaRenderer = MEDIA_RENDERERS.has(renderer);
  if (!isMediaRenderer && shot.media !== undefined) {
    fail(`${field}.media is only valid for the video and hybrid renderers`);
  }
  if (isMediaRenderer && shot.media === undefined) {
    fail(`${field}.media is required for the ${renderer} renderer`);
  }
  const params = validateParams(shot.params, `${field}.params`);
  if (isMediaRenderer && params.assetId) {
    fail(`${field}.params.assetId is not allowed for ${renderer}; use media.assetId`);
  }
  if (params.assetId) {
    const asset = assetById.get(params.assetId);
    if (!asset) fail(`${field}.params.assetId references unknown asset ${params.assetId}`);
    if (asset.approval !== 'approved') {
      fail(`${field}.params.assetId references asset ${params.assetId} with approval ${asset.approval}`);
    }
  }
  const media =
    shot.media === undefined
      ? undefined
      : validateMedia(
          shot.media,
          `${field}.media`,
          renderer,
          assetById,
          endFrame - startFrame,
          fps,
        );
  const moduleParams = validateModuleParams(shot.moduleParams, `${field}.moduleParams`);
  if (moduleParams !== undefined && !renderer.startsWith(PROJECT_SCENE_RENDERER_PREFIX)) {
    fail(`${field}.moduleParams is only valid for a declared project scene module renderer`);
  }
  return {
    id: text(shot.id, `${field}.id`),
    startFrame,
    endFrame,
    renderer,
    params,
    moduleParams,
    media,
  };
};

const validateChapter = (
  value: unknown,
  index: number,
  assetById: ReadonlyMap<string, ProjectAsset>,
  fps: number,
): Chapter => {
  const chapter = record(value, `chapters[${index}]`);
  const startFrame = integer(chapter.startFrame, `chapters[${index}].startFrame`);
  const endFrame = integer(chapter.endFrame, `chapters[${index}].endFrame`);
  if (endFrame <= startFrame) fail(`chapters[${index}] must satisfy startFrame < endFrame`);
  const rawShots = array(chapter.shots, `chapters[${index}].shots`);
  if (rawShots.length === 0) fail(`chapters[${index}] must contain at least one shot`);
  const shots = rawShots.map((shot, shotIndex) =>
    validateShot(shot, `chapters[${index}].shots[${shotIndex}]`, assetById, fps),
  );
  uniqueIds(shots, `chapters[${index}].shots`);

  let cursor = startFrame;
  for (const [shotIndex, shot] of shots.entries()) {
    if (shot.startFrame !== cursor) {
      fail(`chapters[${index}].shots[${shotIndex}] must start at ${cursor}`);
    }
    cursor = shot.endFrame;
  }
  if (cursor !== endFrame) {
    fail(`chapters[${index}] shots end at ${cursor}, expected ${endFrame}`);
  }

  return {
    id: text(chapter.id, `chapters[${index}].id`),
    title: text(chapter.title, `chapters[${index}].title`),
    startFrame,
    endFrame,
    shots,
  };
};

export type ValidateOptions = {
  rendererKinds?: ReadonlySet<string>;
  /**
   * Preproduction-stage loading only. A freshly initialized project has no
   * render timeline yet, so an empty `chapters` array is accepted there. The
   * render path never passes this flag, so a project without a real, complete
   * shot timeline can never be rendered.
   */
  allowEmptyTimeline?: boolean;
};

export const validateProjectConfig = (
  raw: unknown,
  options: ValidateOptions = {},
): ProjectConfig => {
  const config = record(raw, 'project');
  if (config.schemaVersion !== 1) fail('schemaVersion must be 1');
  const projectId = text(config.projectId, 'projectId');
  if (!PROJECT_ID_PATTERN.test(projectId)) {
    fail('projectId must be lowercase letters, digits and hyphens (3-64 chars)');
  }

  const song = record(config.song, 'song');
  const audio = record(config.audio, 'audio');
  const lyrics = record(config.lyrics, 'lyrics');
  const narrative = record(config.narrative, 'narrative');
  const visualRaw = record(config.visual, 'visual');
  const output = record(config.output, 'output');
  const permissions = record(config.permissions, 'permissions');
  const render = record(config.render, 'render');

  assertKeys(
    audio,
    [
      'path',
      'sha256',
      'durationSeconds',
      'durationPolicy',
      'format',
      'assetId',
      'mixSampleRate',
      'gainDb',
      'fadeInFrames',
      'fadeOutFrames',
      'gainAutomation',
    ],
    'audio',
  );
  const audioConfig: AudioConfig = {
    path: relativePath(audio.path, 'audio.path'),
    sha256: text(audio.sha256, 'audio.sha256'),
    durationSeconds: number(audio.durationSeconds, 'audio.durationSeconds'),
    durationPolicy: oneOf(audio.durationPolicy, DURATION_POLICIES, 'audio.durationPolicy'),
    format: oneOf(audio.format, AUDIO_FORMATS, 'audio.format'),
    assetId: optionalText(audio.assetId, 'audio.assetId'),
    mixSampleRate: (audio.mixSampleRate === undefined
      ? 48000
      : audio.mixSampleRate === 44100 || audio.mixSampleRate === 48000
        ? audio.mixSampleRate
        : fail('audio.mixSampleRate must be 44100 or 48000')),
    gainDb: audio.gainDb === undefined ? 0 : number(audio.gainDb, 'audio.gainDb'),
    fadeInFrames:
      audio.fadeInFrames === undefined ? 0 : integer(audio.fadeInFrames, 'audio.fadeInFrames', 0),
    fadeOutFrames:
      audio.fadeOutFrames === undefined ? 0 : integer(audio.fadeOutFrames, 'audio.fadeOutFrames', 0),
    gainAutomation: [],
  };
  if (audioConfig.durationSeconds <= 0) fail('audio.durationSeconds must be positive');
  if (!SHA256_PATTERN.test(audioConfig.sha256)) fail('audio.sha256 must be lowercase hex');
  if (audioConfig.gainDb < -60 || audioConfig.gainDb > 12) fail('audio.gainDb must be in [-60, 12]');

  const width = integer(output.width, 'output.width', 1);
  const height = integer(output.height, 'output.height', 1);
  const fps = integer(output.fps, 'output.fps', 1);
  if (fps > 120) fail('output.fps must be <= 120');
  const derivedDuration = durationFramesFromSeconds(
    audioConfig.durationSeconds,
    fps,
    audioConfig.durationPolicy,
  );
  if (output.durationInFrames !== undefined) {
    const declared = integer(output.durationInFrames, 'output.durationInFrames', 1);
    if (declared !== derivedDuration) {
      fail(
        `output.durationInFrames ${declared} does not match the audio-derived duration ${derivedDuration}`,
      );
    }
  }
  if (audioConfig.fadeInFrames + audioConfig.fadeOutFrames > derivedDuration) {
    fail('audio master fades exceed the project duration');
  }
  audioConfig.gainAutomation = validateAudioAutomation(
    audio.gainAutomation,
    'audio.gainAutomation',
    derivedDuration,
  );

  const sceneModules = parseSceneModules(config.sceneModules);
  const moduleRendererKinds = new Set(
    sceneModules.map((module) => `${PROJECT_SCENE_RENDERER_PREFIX}${module.id}`),
  );
  const protectedRendererKinds = options.rendererKinds;
  if (protectedRendererKinds) {
    for (const module of sceneModules) {
      const kind = `${PROJECT_SCENE_RENDERER_PREFIX}${module.id}`;
      if (protectedRendererKinds.has(kind)) {
        fail(`sceneModules[${module.id}] renderer kind collides with a protected engine renderer`);
      }
    }
  }

  const rawAssets = config.assets === undefined ? [] : array(config.assets, 'assets');
  const assets = rawAssets.map(validateAsset);
  uniqueIds(assets, 'assets');
  const assetById = new Map(assets.map((asset) => [asset.id, asset]));
  if (audioConfig.assetId) {
    const masterAsset = assetById.get(audioConfig.assetId);
    if (!masterAsset) fail(`audio.assetId references unknown asset ${audioConfig.assetId}`);
    if (masterAsset.approval !== 'approved') {
      fail(`audio.assetId references asset ${audioConfig.assetId} with approval ${masterAsset.approval}`);
    }
    if (masterAsset.kind !== 'audio-reference') {
      fail(`audio.assetId must reference an audio-reference asset`);
    }
    const normalized = (value: string): string => value.replace(/\\/g, '/');
    if (
      normalized(masterAsset.path) !== normalized(audioConfig.path) ||
      masterAsset.sha256 !== audioConfig.sha256
    ) {
      fail('audio.assetId path and hash must match the master audio declaration');
    }
  }

  const chaptersRaw = array(config.chapters, 'chapters');
  if (chaptersRaw.length === 0 && !options.allowEmptyTimeline) {
    fail('chapters must not be empty');
  }
  // A preproduction-stage load may legally carry no timeline yet; every other
  // project rule (audio, duration, assets, permissions) still applies below.
  const timelineAllowedEmpty = chaptersRaw.length === 0;
  const chapters = chaptersRaw.map((chapter, index) =>
    validateChapter(chapter, index, assetById, fps),
  );
  uniqueIds(chapters, 'chapters');
  let cursor = 0;
  for (const [index, chapter] of chapters.entries()) {
    if (chapter.startFrame !== cursor) {
      fail(`chapters[${index}] must start at frame ${cursor}`);
    }
    cursor = chapter.endFrame;
  }
  if (!timelineAllowedEmpty && cursor !== derivedDuration) {
    fail(`chapters must end at the derived duration ${derivedDuration}, received ${cursor}`);
  }
  const allShots = chapters.flatMap((chapter) => chapter.shots);
  uniqueIds(allShots, 'shots');

  const cuesRaw = config.cues === undefined ? [] : array(config.cues, 'cues');
  const cues = cuesRaw.map((cue, index) => validateCue(cue, index, fps, derivedDuration));
  uniqueIds(cues, 'cues');
  for (let index = 1; index < cues.length; index++) {
    if (cues[index].frame < cues[index - 1].frame) fail('cues must be sorted by frame');
  }

  const audioTracks = validateAudioTracks(
    config.audioTracks,
    'audioTracks',
    assetById,
    fps,
    derivedDuration,
  );

  const rendererKinds = protectedRendererKinds;
  const isAllowedRenderer = (kind: string): boolean =>
    moduleRendererKinds.has(kind) || (rendererKinds !== undefined && rendererKinds.has(kind));
  const defaultRenderer = text(visualRaw.defaultRenderer, 'visual.defaultRenderer');
  const rawStyle = visualRaw.style;
  let style: VisualConfig['style'];
  if (rawStyle !== undefined) {
    const styleRecord = record(rawStyle, 'visual.style');
    const styleKeys = new Set(['id', 'theme', 'note']);
    for (const key of Object.keys(styleRecord)) {
      if (!styleKeys.has(key)) fail(`visual.style contains unsupported key ${key}`);
    }
    const styleId = text(styleRecord.id, 'visual.style.id');
    const profile = getStyleProfile(styleId);
    if (!profile) {
      fail(`visual.style ${styleId} is not a registered style; registered: ${STYLE_IDS.join(', ')}`);
    }
    if (!profile.implementedBackends.includes('canvas2d')) {
      fail(
        `visual.style ${styleId} is not implemented by any available backend in this phase; implemented: ${profile.implementedBackends.join(', ')}`,
      );
    }
    const themeId =
      styleRecord.theme === undefined ? undefined : text(styleRecord.theme, 'visual.style.theme');
    if (themeId !== undefined && !isRegisteredTheme(themeId)) {
      fail(`visual.style.theme ${themeId} is not a registered theme; registered: ${THEME_IDS.join(', ')}`);
    }
    const note = styleRecord.note === undefined ? undefined : text(styleRecord.note, 'visual.style.note');
    style = {id: styleId};
    if (themeId !== undefined) style.theme = themeId;
    if (note !== undefined) style.note = note;
  }
  const visual: VisualConfig = {
    styleProfile: text(visualRaw.styleProfile, 'visual.styleProfile'),
    defaultRenderer,
    style,
  };
  if (
    defaultRenderer.startsWith(PROJECT_SCENE_RENDERER_PREFIX) &&
    !moduleRendererKinds.has(defaultRenderer)
  ) {
    fail(`visual.defaultRenderer references an undeclared scene module: ${defaultRenderer}`);
  }
  if (!isAllowedRenderer(defaultRenderer) && rendererKinds !== undefined) {
    fail(`visual.defaultRenderer is not registered: ${defaultRenderer}`);
  }
  if (style !== undefined) {
    const styleId = style.id;
    const profile = getStyleProfile(styleId);
    const modulesById = new Map(sceneModules.map((module) => [module.id, module]));
    const assertRendererStyle = (
      renderer: string,
      shotMedia: ShotMediaConfig | undefined,
      label: string,
      requireMedia: boolean,
    ): void => {
      if (renderer.startsWith(PROJECT_SCENE_RENDERER_PREFIX)) {
        const moduleId = renderer.slice(PROJECT_SCENE_RENDERER_PREFIX.length);
        const module = modulesById.get(moduleId);
        if (!module) fail(`${label} references undeclared scene module ${moduleId}`);
        if (!module.styleIds || !module.styleIds.includes(styleId)) {
          fail(
            `${label} uses scene module ${moduleId}, which does not declare visual style ${styleId}; declared: ${(module.styleIds ?? []).join(', ') || 'none'}`,
          );
        }
        return;
      }
      if (MEDIA_RENDERERS.has(renderer)) {
        if (!requireMedia && !shotMedia) {
          if (!profile || !getStyleMediaRoute(profile, renderer as MediaRendererKind)) {
            fail(
              `${label} uses renderer ${renderer}, which style ${styleId} does not declare; declared media routes: ${(profile?.mediaRoutes ?? []).map((entry) => entry.renderer).join(', ') || 'none'}`,
            );
          }
          return;
        }
        assertMediaRendererStyle(
          renderer as MediaRendererKind,
          shotMedia,
          profile,
          label,
        );
        return;
      }
      fail(
        `${label} uses renderer ${renderer}, which does not declare visual style ${styleId}; style-driven projects require a project scene module with styleIds or a style-declared media renderer`,
      );
    };
    assertRendererStyle(defaultRenderer, undefined, 'visual.defaultRenderer', false);
    for (const [index, shot] of allShots.entries()) {
      assertRendererStyle(shot.renderer, shot.media, `shots[${index}]`, true);
    }
  }
  for (const [index, shot] of allShots.entries()) {
    if (
      shot.renderer.startsWith(PROJECT_SCENE_RENDERER_PREFIX) &&
      !moduleRendererKinds.has(shot.renderer)
    ) {
      fail(`shots[${index}].renderer references an undeclared scene module: ${shot.renderer}`);
    }
    if (!isAllowedRenderer(shot.renderer) && rendererKinds !== undefined) {
      fail(`shots[${index}].renderer is not registered: ${shot.renderer}`);
    }
  }
  const needsPixel =
    defaultRenderer === 'pixel-canvas' ||
    allShots.some((shot) => shot.renderer === 'pixel-canvas') ||
    sceneModules.some(
      (module) => module.canvas.mode === 'project-pixel' || module.samplingFps === 'project-pixel',
    );
  if (needsPixel) {
    const pixel = record(visualRaw.pixel, 'visual.pixel');
    const internalWidth = integer(pixel.internalWidth, 'visual.pixel.internalWidth', 1);
    const internalHeight = integer(pixel.internalHeight, 'visual.pixel.internalHeight', 1);
    const samplingFps = integer(pixel.samplingFps, 'visual.pixel.samplingFps', 1);
    if (Math.abs(internalWidth / internalHeight - width / height) > 1e-6) {
      fail(
        `visual.pixel internal aspect ${internalWidth}x${internalHeight} does not match output ${width}x${height}`,
      );
    }
    visual.pixel = {internalWidth, internalHeight, samplingFps};
  } else if (visualRaw.pixel !== undefined) {
    const pixel = record(visualRaw.pixel, 'visual.pixel');
    visual.pixel = {
      internalWidth: integer(pixel.internalWidth, 'visual.pixel.internalWidth', 1),
      internalHeight: integer(pixel.internalHeight, 'visual.pixel.internalHeight', 1),
      samplingFps: integer(pixel.samplingFps, 'visual.pixel.samplingFps', 1),
    };
  }

  const permissionsConfig = {
    externalGeneration: boolean(permissions.externalGeneration, 'permissions.externalGeneration'),
    localOnly: boolean(permissions.localOnly, 'permissions.localOnly'),
    allowNetwork: boolean(permissions.allowNetwork, 'permissions.allowNetwork'),
  };
  if (permissionsConfig.externalGeneration) {
    fail('P0 forbids externalGeneration; no provider activity is authorized');
  }
  if (!permissionsConfig.localOnly) fail('P0 requires permissions.localOnly = true');
  if (permissionsConfig.allowNetwork) fail('P0 requires permissions.allowNetwork = false');

  const renderConfig = {
    codec: oneOf(render.codec, ['h264'] as const, 'render.codec'),
    pixelFormat: oneOf(render.pixelFormat, ['yuv420p'] as const, 'render.pixelFormat'),
    colorSpace: oneOf(render.colorSpace, ['bt709'] as const, 'render.colorSpace'),
    imageFormat: oneOf(render.imageFormat, ['png', 'jpeg'] as const, 'render.imageFormat'),
  };

  return {
    schemaVersion: 1,
    projectId,
    song: {
      title: text(song.title, 'song.title'),
      artist: text(song.artist, 'song.artist'),
    },
    audio: audioConfig,
    lyrics: {
      language: text(lyrics.language, 'lyrics.language'),
      path: lyrics.path === null ? null : relativePath(lyrics.path, 'lyrics.path'),
    },
    narrative: {
      mode: oneOf(narrative.mode, NARRATIVE_MODES, 'narrative.mode'),
    },
    visual,
    output: {
      width,
      height,
      fps,
      durationInFrames: derivedDuration,
      aspectRatio: optionalText(output.aspectRatio, 'output.aspectRatio'),
    },
    cues,
    chapters,
    sceneModules,
    audioTracks,
    assets,
    permissions: permissionsConfig,
    render: renderConfig,
  };
};
