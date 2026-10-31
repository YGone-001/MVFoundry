import {ConfigValidationError} from '../errors';
import {durationFramesFromSeconds, DURATION_POLICIES} from './duration';
import {parseSceneModules} from './sceneModules';
import {PROJECT_SCENE_RENDERER_PREFIX} from '../scenes/external/constants';
import type {
  AssetApproval,
  Chapter,
  Cue,
  CueSource,
  HybridLayerConfig,
  HybridOverlayConfig,
  MediaFit,
  NarrativeMode,
  ProjectAsset,
  ProjectAssetKind,
  ProjectConfig,
  SceneModuleParams,
  SceneParams,
  Shot,
  ShotHybridMedia,
  ShotMediaConfig,
  ShotVideoMedia,
  VideoSourceConfig,
  VisualConfig,
} from './types';

const NARRATIVE_MODES: readonly NarrativeMode[] = ['narrative', 'abstract', 'lyric', 'hybrid'];
const CUE_SOURCES: readonly CueSource[] = ['measured', 'estimated', 'synthetic'];
const ASSET_KINDS: readonly ProjectAssetKind[] = ['image', 'video', 'layer', 'audio-reference'];
const APPROVALS: readonly AssetApproval[] = ['approved', 'pending', 'rejected', 'not_present'];
const MEDIA_FITS: readonly MediaFit[] = ['contain', 'cover'];
const MEDIA_RENDERERS = new Set(['video', 'hybrid']);
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
  if (!muted) fail(`${field}.muted must be true; the soundtrack is the only authorized audio`);
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

const validateMedia = (
  value: unknown,
  field: string,
  renderer: string,
  assetById: ReadonlyMap<string, ProjectAsset>,
  shotLength: number,
  fps: number,
): ShotMediaConfig => {
  const media = record(value, field);
  const kind = oneOf(media.kind, ['video', 'hybrid'] as const, `${field}.kind`);
  if (kind !== renderer) {
    fail(`${field}.kind must match renderer "${renderer}", received "${kind}"`);
  }
  if (kind === 'video') {
    return {
      kind: 'video',
      ...validateVideoSource(media, field, assetById, fps, ['kind']),
    } satisfies ShotVideoMedia;
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

  const audioConfig = {
    path: relativePath(audio.path, 'audio.path'),
    sha256: text(audio.sha256, 'audio.sha256'),
    durationSeconds: number(audio.durationSeconds, 'audio.durationSeconds'),
    durationPolicy: oneOf(audio.durationPolicy, DURATION_POLICIES, 'audio.durationPolicy'),
    format: oneOf(audio.format, ['wav-pcm'] as const, 'audio.format'),
  };
  if (audioConfig.durationSeconds <= 0) fail('audio.durationSeconds must be positive');
  if (!SHA256_PATTERN.test(audioConfig.sha256)) fail('audio.sha256 must be lowercase hex');

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

  const chaptersRaw = array(config.chapters, 'chapters');
  if (chaptersRaw.length === 0) fail('chapters must not be empty');
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
  if (cursor !== derivedDuration) {
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

  const rendererKinds = protectedRendererKinds;
  const isAllowedRenderer = (kind: string): boolean =>
    moduleRendererKinds.has(kind) || (rendererKinds !== undefined && rendererKinds.has(kind));
  const defaultRenderer = text(visualRaw.defaultRenderer, 'visual.defaultRenderer');
  const visual: VisualConfig = {
    styleProfile: text(visualRaw.styleProfile, 'visual.styleProfile'),
    defaultRenderer,
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
    assets,
    permissions: permissionsConfig,
    render: renderConfig,
  };
};
