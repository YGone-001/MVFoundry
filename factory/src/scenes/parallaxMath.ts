// Deterministic camera and depth math for the asset-backed 2.5D compositor.
//
// Everything here is a pure function of (media configuration, shot-local frame).
// No clock, no randomness and no accumulated state means the same frame always
// produces the same transform, which is the contract the renderer relies on.

import type {
  CameraMoveConfig,
  ComicTreatmentConfig,
  GradeConfig,
  LayerMotionConfig,
  ParallaxCharacterConfig,
  ParallaxLayerConfig,
  ParallaxLayerRole,
  ParallaxPoseKeyframe,
} from '../config/types';
import type {StylePaletteRole, VisualStyleProfile} from '../style/catalog';

export const CAMERA_AMPLITUDE_LIMIT = 0.25;
export const LAYER_MOTION_LIMIT = 0.7;

export const ROLE_ORDER: Readonly<Record<ParallaxLayerRole, number>> = Object.freeze({
  midground: 0,
  subject: 1,
  foreground: 2,
});

export const ROLE_PARALLAX_RANGES: Readonly<
  Record<ParallaxLayerRole, {min: number; max: number}>
> = Object.freeze({
  midground: Object.freeze({min: 0.1, max: 0.6}),
  subject: Object.freeze({min: 0.45, max: 0.9}),
  foreground: Object.freeze({min: 0.8, max: 1}),
});

export const clamp = (value: number, minimum: number, maximum: number): number =>
  value < minimum ? minimum : value > maximum ? maximum : value;

export const clampProgress = (value: number): number => clamp(value, 0, 1);

export const easeProgress = (progress: number, easing: 'linear' | 'easeInOut'): number => {
  const t = clampProgress(progress);
  if (easing === 'linear') return t;
  // Cubic smoothstep: zero velocity at both ends, still strictly monotonic.
  return t * t * (3 - 2 * t);
};

/**
 * Comic treatment holds motion at a lower sampling rate. The quantisation is
 * integer arithmetic so the same output frame always resolves to the same tick.
 */
export const quantizeMotionFrame = (
  localFrame: number,
  outputFps: number,
  stepFps: number | undefined,
): number => {
  if (stepFps === undefined || stepFps >= outputFps) return localFrame;
  if (stepFps <= 0) return localFrame;
  return Math.floor((localFrame * stepFps) / outputFps);
};

export type CameraSample = {
  x: number;
  y: number;
  zoom: number;
  progress: number;
};

export const sampleCamera = (
  camera: CameraMoveConfig,
  frame: number,
  shotFrames: number,
): CameraSample => {
  const progress = shotFrames <= 1 ? 0 : clampProgress(frame / (shotFrames - 1));
  const eased = easeProgress(progress, camera.easing);
  return {
    x: camera.fromX + (camera.toX - camera.fromX) * eased,
    y: camera.fromY + (camera.toY - camera.fromY) * eased,
    zoom: camera.fromZoom + (camera.toZoom - camera.fromZoom) * eased,
    progress,
  };
};

export const cameraTravelFraction = (camera: CameraMoveConfig): number => {
  const horizontal = Math.max(Math.abs(camera.fromX), Math.abs(camera.toX));
  const vertical = Math.max(Math.abs(camera.fromY), Math.abs(camera.toY));
  return Math.max(horizontal, vertical);
};

export type LayerMotionSample = {
  x: number;
  y: number;
};

export const sampleLayerMotion = (
  motion: LayerMotionConfig | undefined,
  frame: number,
  shotFrames: number,
): LayerMotionSample => {
  if (!motion) return {x: 0, y: 0};
  const from = motion.fromFrame ?? 0;
  const to = motion.toFrame ?? Math.max(0, shotFrames - 1);
  const progress = to <= from ? 1 : clampProgress((frame - from) / (to - from));
  const eased = easeProgress(progress, motion.easing);
  return {
    x: motion.translateXFrom + (motion.translateXTo - motion.translateXFrom) * eased,
    y: motion.translateYFrom + (motion.translateYTo - motion.translateYFrom) * eased,
  };
};

/**
 * The scale an opaque plate needs so camera travel never exposes an edge.
 * Transparent cutouts carry their own margin, so their bounded motion is not
 * counted here; scaling them for it would destroy detail.
 */
export const resolveOverscan = (camera: CameraMoveConfig, parallax: number): number => {
  const travel = 2 * cameraTravelFraction(camera) * parallax;
  return clamp(1 + travel + 0.04, 1, 2.5);
};

export type LayerDepthTransform = {
  translateX: number;
  translateY: number;
  scale: number;
  overscan: number;
};

/**
 * Camera displacement is multiplied by each layer's `parallax`, so two layers
 * with different depth values can never move by the same amount. Zoom is also
 * depth-weighted: the foreground grows faster than the background.
 */
export const resolveLayerDepthTransform = (
  layer: Pick<ParallaxLayerConfig, 'parallax' | 'scale' | 'motion'>,
  camera: CameraMoveConfig,
  shaft: CameraSample,
  frame: number,
  shotFrames: number,
): LayerDepthTransform => {
  const motion = sampleLayerMotion(layer.motion, frame, shotFrames);
  const overscan = resolveOverscan(camera, layer.parallax);
  const depthZoom = 1 + (shaft.zoom - 1) * (0.35 + 0.65 * layer.parallax);
  return {
    translateX: -shaft.x * layer.parallax + motion.x,
    translateY: -shaft.y * layer.parallax + motion.y,
    scale: depthZoom * layer.scale * overscan,
    overscan,
  };
};

export const ROLE_RANK = (role: ParallaxLayerRole): number => ROLE_ORDER[role];

/* -------------------------------------------------------------------------- */
/* Character performance                                                       */
/* -------------------------------------------------------------------------- */

export type CharacterPoseSample = {
  assetId: string;
  /** Blend weight for this pose, already multiplied by the pose opacity. */
  opacity: number;
  offsetX: number;
  offsetY: number;
  scale: number;
};

export type CharacterPerformanceSample = {
  poses: CharacterPoseSample[];
  /** Idle sway in fractions of the output frame. Not camera motion. */
  idleX: number;
  idleY: number;
  /** Idle breathing scale multiplier. */
  idleScale: number;
};

/**
 * Half-open pose range lookup. A frame outside every range is an authoring bug,
 * so it fails closed instead of silently freezing the last drawing.
 */
export const activePoseIndex = (poses: readonly ParallaxPoseKeyframe[], frame: number): number => {
  const index = poses.findIndex((pose) => frame >= pose.fromFrame && frame < pose.toFrame);
  if (index < 0) {
    throw new Error(`Character pose timeline does not cover local frame ${frame}`);
  }
  return index;
};

const idleWave = (
  config: {amplitude: number; periodFrames: number} | undefined,
  frame: number,
): number =>
  config === undefined || config.amplitude === 0
    ? 0
    : config.amplitude * Math.sin((frame / config.periodFrames) * Math.PI * 2);

/**
 * Samples the authored pose track for one shot-local frame. A crossfade blends
 * the outgoing pose with the incoming one; a cut resolves on exactly one frame.
 * The result depends only on (poses, frame), so repeated renders match.
 */
export const sampleCharacterPerformance = (
  character: ParallaxCharacterConfig,
  frame: number,
): CharacterPerformanceSample => {
  const poses = character.poses;
  const index = activePoseIndex(poses, frame);
  const current = poses[index];
  const outgoing = index > 0 ? poses[index - 1] : undefined;
  const fadeFrames = current.transition === 'crossfade' ? current.fadeFrames : 0;
  const sinceStart = frame - current.fromFrame;
  const sample: CharacterPoseSample = {
    assetId: current.assetId,
    opacity: current.opacity,
    offsetX: current.offsetX,
    offsetY: current.offsetY,
    scale: current.scale,
  };
  const result: CharacterPerformanceSample = {
    poses: [sample],
    idleX: idleWave(character.sway, frame),
    idleY: 0,
    idleScale: 1 + idleWave(character.breathe, frame),
  };
  if (outgoing && fadeFrames > 0 && sinceStart < fadeFrames) {
    const raw = clampProgress((sinceStart + 1) / fadeFrames);
    const incoming = raw * raw * (3 - 2 * raw);
    result.poses = [
      {
        assetId: outgoing.assetId,
        opacity: outgoing.opacity * (1 - incoming),
        offsetX: outgoing.offsetX,
        offsetY: outgoing.offsetY,
        scale: outgoing.scale,
      },
      {
        assetId: current.assetId,
        opacity: current.opacity * incoming,
        offsetX: current.offsetX,
        offsetY: current.offsetY,
        scale: current.scale,
      },
    ];
  }
  return result;
};

/** Draw order shared by static layers and characters; larger draws nearer. */
export type DrawEntry =
  | {kind: 'layer'; order: number; layer: ParallaxLayerConfig}
  | {kind: 'character'; order: number; character: ParallaxCharacterConfig};

export const mergeDrawOrder = (
  layers: readonly ParallaxLayerConfig[],
  characters: readonly ParallaxCharacterConfig[] = [],
): DrawEntry[] => {
  const entries: DrawEntry[] = [
    ...layers.map((layer) => ({kind: 'layer' as const, order: layer.order, layer})),
    ...characters.map((character) => ({
      kind: 'character' as const,
      order: character.order,
      character,
    })),
  ];
  return entries.sort((left, right) => left.order - right.order);
};

/**
 * Character depth follows the camera exactly like a layer, but without plate
 * overscan: a cutout keeps its own art margin, and scaling it for an opaque
 * plate's edge safety would shrink the subject for no reason.
 */
export const resolveCharacterDepthTransform = (
  character: Pick<ParallaxCharacterConfig, 'parallax'>,
  shaft: CameraSample,
): {translateX: number; translateY: number; zoom: number} => ({
  translateX: -shaft.x * character.parallax,
  translateY: -shaft.y * character.parallax,
  zoom: 1 + (shaft.zoom - 1) * (0.35 + 0.65 * character.parallax),
});

const paletteValue = (
  palette: readonly StylePaletteRole[],
  role: string,
): string | undefined => palette.find((entry) => entry.role === role)?.value;

export const DEFAULT_COMIC: ComicTreatmentConfig = {
  motionStepFps: 24,
  halftone: 0,
  speedLines: 0,
  panel: null,
  impacts: [],
  wipes: [],
};

/**
 * Legacy-safe grade for projects that use the asset route without selecting a
 * style. It is deliberately neutral: no tint, no saturation change and only a
 * light vignette, so approved artwork keeps its authored colours.
 */
export const NEUTRAL_GRADE: GradeConfig = {
  saturation: 1,
  contrast: 1,
  brightness: 1,
  tint: '#000000',
  tintOpacity: 0,
  vignette: 0.2,
  grain: 0.02,
};

/**
 * Merges style-declared grading with per-shot overrides. A missing `tintRole`
 * in the palette is a hard authoring error rather than a silent black tint.
 */
export const resolveGrade = (
  profile: VisualStyleProfile,
  overrides: Partial<GradeConfig> | undefined,
): GradeConfig => {
  const bias = profile.gradeBias;
  const tint = paletteValue(profile.palette, bias.tintRole);
  if (!tint) {
    throw new Error(
      `Style ${profile.id} declares tintRole ${bias.tintRole}, which is missing from its palette`,
    );
  }
  return {
    saturation: overrides?.saturation ?? bias.saturation,
    contrast: overrides?.contrast ?? bias.contrast,
    brightness: overrides?.brightness ?? bias.brightness,
    tint: overrides?.tint ?? tint,
    tintOpacity: overrides?.tintOpacity ?? bias.tintOpacity,
    vignette: overrides?.vignette ?? bias.vignette,
    grain: overrides?.grain ?? bias.grain,
  };
};

export const resolveComic = (
  overrides: Partial<ComicTreatmentConfig> | undefined,
): ComicTreatmentConfig => ({
  motionStepFps: overrides?.motionStepFps ?? DEFAULT_COMIC.motionStepFps,
  halftone: overrides?.halftone ?? DEFAULT_COMIC.halftone,
  speedLines: overrides?.speedLines ?? DEFAULT_COMIC.speedLines,
  panel: overrides?.panel ?? DEFAULT_COMIC.panel,
  impacts: overrides?.impacts ?? [],
  wipes: overrides?.wipes ?? [],
});

export const hashNoise = (seed: number): number => {
  const value = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return value - Math.floor(value);
};
