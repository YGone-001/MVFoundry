import type {
  RenderProjectShot,
  RenderProjectSnapshot,
  SceneModuleCanvasConfig,
  SceneModuleParams,
  SceneModuleSampling,
  SceneParams,
} from '../../config/types';
import {SceneModuleError} from '../../errors';
import type {SceneFrameInfo} from '../../timeline/frameClock';
import type {CanvasSize, CanvasSceneRenderer} from '../types';
import {
  assertRegisteredStyle,
  isRegisteredStyle,
  STYLE_IDS,
  type VisualStyleProfile,
} from '../../style/catalog';
import {getThemeProfile, type ThemeProfile} from '../../style/themes';
import {
  PROJECT_SCENE_MODULE_CONTRACT_VERSION,
  PROJECT_SCENE_MODULE_TYPE,
  PROJECT_SCENE_RENDERER_PREFIX,
} from './constants';

export type ProjectSceneModuleParameter = {
  key: string;
  type: 'string' | 'number' | 'boolean';
  required?: boolean;
};

export type ProjectSceneAssetReference = Readonly<{publicPath: string}>;

export type ProjectSceneStyleContext = {
  id: string;
  label: string;
  theme: Readonly<{
    id: string;
    label: string;
    mode: 'dark' | 'light';
    roles: Readonly<ThemeProfile['roles']>;
  }> | null;
  profile: Readonly<VisualStyleProfile>;
};

export type ProjectSceneModuleRenderContext = {
  frame: Readonly<SceneFrameInfo>;
  canvas: Readonly<{
    width: number;
    height: number;
  }>;
  output: Readonly<{
    width: number;
    height: number;
    fps: number;
    durationInFrames: number;
  }>;
  shot: Readonly<{
    id: string;
    chapterId: string;
    chapterTitle: string;
    startFrame: number;
    endFrame: number;
  }>;
  params: Readonly<SceneParams>;
  moduleParams: Readonly<SceneModuleParams>;
  assets: Readonly<Record<string, ProjectSceneAssetReference>>;
  style: Readonly<ProjectSceneStyleContext> | null;
};

export type ProjectSceneModuleDefinition = {
  id: string;
  contractVersion: number;
  moduleType: 'canvas2d';
  params?: readonly ProjectSceneModuleParameter[];
  assetDependencies?: readonly string[];
  label?: string;
  description?: string;
  supportedStyles?: readonly string[];
  render: (
    ctx: CanvasRenderingContext2D,
    context: ProjectSceneModuleRenderContext,
  ) => void;
};

export type ProjectSceneModuleBinding = {
  id: string;
  contractVersion: number;
  moduleType: 'canvas2d';
  sha256: string;
  canvas: SceneModuleCanvasConfig;
  samplingFps: SceneModuleSampling;
  pixelated: boolean;
  styleIds?: readonly string[];
};

const MODULE_ID_PATTERN = /^[a-z0-9][a-z0-9-]{2,63}$/;
const PARAM_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,31}$/;
const PARAM_TYPES = new Set(['string', 'number', 'boolean']);

function fail(message: string): never {
  throw new SceneModuleError(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const record = (value: unknown, field: string): Record<string, unknown> => {
  if (!isRecord(value)) fail(`${field} must be an object`);
  return value;
};

const text = (value: unknown, field: string): string => {
  if (typeof value !== 'string' || value.trim() === '') fail(`${field} must be a non-empty string`);
  return value;
};

const positiveInteger = (value: unknown, field: string): number => {
  if (!Number.isInteger(value) || (value as number) <= 0) {
    fail(`${field} must be a positive integer`);
  }
  return value as number;
};

export const projectSceneRendererKind = (id: string): string =>
  `${PROJECT_SCENE_RENDERER_PREFIX}${id}`;

export const isProjectSceneRendererKind = (kind: string): boolean =>
  kind.startsWith(PROJECT_SCENE_RENDERER_PREFIX);

const assertBinding = (binding: ProjectSceneModuleBinding): void => {
  if (!isRecord(binding)) fail('Project scene module binding must be an object');
  if (!MODULE_ID_PATTERN.test(binding.id)) fail(`Invalid project scene module id: ${binding.id}`);
  if (binding.contractVersion !== PROJECT_SCENE_MODULE_CONTRACT_VERSION) {
    fail(`Unsupported contract version for scene module ${binding.id}`);
  }
  if (binding.moduleType !== PROJECT_SCENE_MODULE_TYPE) {
    fail(`Unsupported module type for scene module ${binding.id}: ${binding.moduleType}`);
  }
  if (typeof binding.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(binding.sha256)) {
    fail(`Invalid verified hash for scene module ${binding.id}`);
  }
  const canvas = record(binding.canvas, `scene module ${binding.id} canvas`);
  if (canvas.mode === 'custom') {
    positiveInteger(canvas.width, `scene module ${binding.id} canvas.width`);
    positiveInteger(canvas.height, `scene module ${binding.id} canvas.height`);
  } else if (canvas.mode !== 'output' && canvas.mode !== 'project-pixel') {
    fail(`Invalid canvas mode for scene module ${binding.id}`);
  }
  if (
    binding.samplingFps !== 'output' &&
    binding.samplingFps !== 'project-pixel' &&
    (!Number.isInteger(binding.samplingFps) || binding.samplingFps <= 0)
  ) {
    fail(`Invalid sampling rate for scene module ${binding.id}`);
  }
  if (typeof binding.pixelated !== 'boolean') {
    fail(`Invalid pixelated flag for scene module ${binding.id}`);
  }
  if (binding.styleIds !== undefined) {
    if (!Array.isArray(binding.styleIds) || binding.styleIds.length === 0) {
      fail(`Scene module ${binding.id} styleIds must be a non-empty array when present`);
    }
    const seenStyles = new Set<string>();
    for (const styleId of binding.styleIds) {
      if (typeof styleId !== 'string' || !isRegisteredStyle(styleId)) {
        fail(`Scene module ${binding.id} declares unknown style ${String(styleId)}`);
      }
      if (seenStyles.has(styleId)) {
        fail(`Scene module ${binding.id} declares duplicate style ${styleId}`);
      }
      seenStyles.add(styleId);
    }
  }
};

const readParameters = (
  value: unknown,
  moduleId: string,
): ProjectSceneModuleParameter[] => {
  if (value === undefined) return [];
  if (!Array.isArray(value)) fail(`Scene module ${moduleId} params must be an array`);
  if (value.length > 32) fail(`Scene module ${moduleId} declares too many parameters`);
  const seen = new Set<string>();
  const result: ProjectSceneModuleParameter[] = [];
  for (const [index, entry] of value.entries()) {
    const field = `Scene module ${moduleId} params[${index}]`;
    const parameter = record(entry, field);
    const key = text(parameter.key, `${field}.key`);
    if (!PARAM_KEY_PATTERN.test(key) || seen.has(key)) {
      fail(`Invalid or duplicate parameter key in ${field}`);
    }
    seen.add(key);
    const type = text(parameter.type, `${field}.type`);
    if (!PARAM_TYPES.has(type)) fail(`${field}.type must be string, number or boolean`);
    if (parameter.required !== undefined && typeof parameter.required !== 'boolean') {
      fail(`${field}.required must be a boolean`);
    }
    result.push({
      key,
      type: type as ProjectSceneModuleParameter['type'],
      required: parameter.required === true,
    });
  }
  return result;
};

const readAssetDependencies = (
  value: unknown,
  moduleId: string,
  approvedAssetIds: ReadonlySet<string>,
): string[] => {
  if (value === undefined) return [];
  if (!Array.isArray(value)) fail(`Scene module ${moduleId} assetDependencies must be an array`);
  if (value.length > 64) fail(`Scene module ${moduleId} declares too many asset dependencies`);
  const result: string[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    const assetId = text(entry, `Scene module ${moduleId} asset dependency`);
    if (seen.has(assetId)) fail(`Duplicate asset dependency in scene module ${moduleId}`);
    seen.add(assetId);
    if (!approvedAssetIds.has(assetId)) {
      fail(`Scene module ${moduleId} references unapproved or undeclared asset ${assetId}`);
    }
    result.push(assetId);
  }
  return result;
};

const readSupportedStyles = (value: unknown, moduleId: string): string[] => {
  if (value === undefined) return [];
  if (!Array.isArray(value)) fail(`Scene module ${moduleId} supportedStyles must be an array`);
  if (value.length > 12) fail(`Scene module ${moduleId} declares too many supported styles`);
  const result: string[] = [];
  const seen = new Set<string>();
  for (const [index, entry] of value.entries()) {
    const styleId = text(entry, `Scene module ${moduleId} supportedStyles[${index}]`);
    if (!isRegisteredStyle(styleId)) {
      fail(
        `Scene module ${moduleId} declares unregistered style ${styleId}; registered: ${STYLE_IDS.join(', ')}`,
      );
    }
    if (seen.has(styleId)) fail(`Scene module ${moduleId} declares duplicate style ${styleId}`);
    seen.add(styleId);
    result.push(styleId);
  }
  return result;
};

export const readProjectSceneModule = (
  imported: unknown,
  binding: ProjectSceneModuleBinding,
  approvedAssetIds: ReadonlySet<string>,
): ProjectSceneModuleDefinition => {
  assertBinding(binding);
  const module = record(imported, `Scene module ${binding.id} export`);
  if (module.id !== binding.id) {
    fail(`Scene module export id ${String(module.id)} does not match manifest id ${binding.id}`);
  }
  if (module.contractVersion !== binding.contractVersion) {
    fail(`Scene module ${binding.id} contract version does not match the manifest`);
  }
  if (module.moduleType !== binding.moduleType) {
    fail(`Scene module ${binding.id} module type does not match the manifest`);
  }
  if (typeof module.render !== 'function') {
    fail(`Scene module ${binding.id} must export a render(ctx, context) function`);
  }
  const parameters = readParameters(module.params, binding.id);
  const assetDependencies = readAssetDependencies(
    module.assetDependencies,
    binding.id,
    approvedAssetIds,
  );
  const supportedStyles = readSupportedStyles(module.supportedStyles, binding.id);
  if (binding.styleIds !== undefined) {
    for (const styleId of binding.styleIds) {
      if (!supportedStyles.includes(styleId)) {
        fail(
          `Scene module ${binding.id} declares style ${styleId} in the project manifest but does not export supportedStyles containing it`,
        );
      }
    }
  }
  const definition: ProjectSceneModuleDefinition = {
    id: binding.id,
    contractVersion: binding.contractVersion,
    moduleType: binding.moduleType,
    params: Object.freeze(parameters),
    assetDependencies: Object.freeze(assetDependencies),
    supportedStyles: Object.freeze(supportedStyles),
    render: module.render as ProjectSceneModuleDefinition['render'],
  };
  if (typeof module.label === 'string') definition.label = module.label;
  if (typeof module.description === 'string') definition.description = module.description;
  return Object.freeze(definition);
};

export const resolveProjectSceneCanvas = (
  binding: ProjectSceneModuleBinding,
  project: RenderProjectSnapshot,
): CanvasSize => {
  if (binding.canvas.mode === 'custom') {
    return {width: binding.canvas.width, height: binding.canvas.height};
  }
  if (binding.canvas.mode === 'project-pixel') {
    const pixel = project.visual.pixel;
    if (!pixel) {
      fail(`Scene module ${binding.id} requires visual.pixel, but the project has no profile`);
    }
    return {width: pixel.internalWidth, height: pixel.internalHeight};
  }
  return {width: project.output.width, height: project.output.height};
};

export const resolveProjectSceneSampling = (
  binding: ProjectSceneModuleBinding,
  project: RenderProjectSnapshot,
): number => {
  if (binding.samplingFps === 'output') return project.output.fps;
  if (binding.samplingFps === 'project-pixel') {
    const pixel = project.visual.pixel;
    if (!pixel) {
      fail(`Scene module ${binding.id} requires visual.pixel, but the project has no profile`);
    }
    return pixel.samplingFps;
  }
  return binding.samplingFps;
};

const validateModuleParams = (
  definition: ProjectSceneModuleDefinition,
  shot: RenderProjectShot,
): SceneModuleParams => {
  const provided = shot.moduleParams ?? {};
  const schema = definition.params ?? [];
  const declared = new Map(schema.map((parameter) => [parameter.key, parameter]));
  const result: SceneModuleParams = {};
  for (const key of Object.keys(provided).sort()) {
    if (!declared.has(key)) {
      fail(`Scene module ${definition.id} does not declare parameter ${key}`);
    }
  }
  for (const parameter of schema) {
    const value = provided[parameter.key];
    if (value === undefined) {
      if (parameter.required) {
        fail(`Scene module ${definition.id} requires parameter ${parameter.key}`);
      }
      continue;
    }
    if (typeof value !== parameter.type) {
      fail(
        `Scene module ${definition.id} parameter ${parameter.key} must be ${parameter.type}`,
      );
    }
    if (typeof value === 'number' && !Number.isFinite(value)) {
      fail(`Scene module ${definition.id} parameter ${parameter.key} must be finite`);
    }
    result[parameter.key] = value;
  }
  return Object.freeze(result);
};

const collectAssets = (
  definition: ProjectSceneModuleDefinition,
  project: RenderProjectSnapshot,
  publicAssets: Record<string, string>,
): Readonly<Record<string, ProjectSceneAssetReference>> => {
  const result: Record<string, ProjectSceneAssetReference> = {};
  for (const assetId of definition.assetDependencies ?? []) {
    const asset = project.assets.find((candidate) => candidate.id === assetId);
    if (!asset || asset.approval !== 'approved') {
      fail(`Scene module ${definition.id} references unapproved asset ${assetId}`);
    }
    const publicPath = publicAssets[assetId];
    if (!publicPath) {
      fail(`Scene module ${definition.id} asset ${assetId} is not staged for rendering`);
    }
    result[assetId] = Object.freeze({publicPath});
  }
  return Object.freeze(result);
};

const resolveActiveStyle = (
  project: RenderProjectSnapshot,
  definition: ProjectSceneModuleDefinition,
): ProjectSceneStyleContext | null => {
  const selection = project.visual.style;
  if (!selection) return null;
  const profile = assertRegisteredStyle(selection.id);
  if (!definition.supportedStyles || !definition.supportedStyles.includes(selection.id)) {
    fail(
      `Scene module ${definition.id} does not implement active style ${selection.id}; exported: ${(definition.supportedStyles ?? []).join(', ') || 'none'}`,
    );
  }
  const theme = selection.theme ? getThemeProfile(selection.theme) : undefined;
  if (selection.theme && !theme) {
    fail(`Project selects unregistered theme ${selection.theme}`);
  }
  return Object.freeze({
    id: profile.id,
    label: profile.label,
    theme: theme
      ? Object.freeze({
          id: theme.id,
          label: theme.label,
          mode: theme.mode,
          roles: Object.freeze({...theme.roles}),
        })
      : null,
    profile,
  });
};

export const createProjectSceneRenderer = (
  binding: ProjectSceneModuleBinding,
  definition: ProjectSceneModuleDefinition,
): CanvasSceneRenderer => ({
  kind: projectSceneRendererKind(binding.id),
  pixelated: binding.pixelated,
  canvasSize: (project) => resolveProjectSceneCanvas(binding, project),
  samplingFps: (project) => resolveProjectSceneSampling(binding, project),
  render: (ctx, context) => {
    const moduleParams = validateModuleParams(definition, context.shot);
    const assets = collectAssets(definition, context.project, context.publicAssets);
    const canvas = resolveProjectSceneCanvas(binding, context.project);
    const style = resolveActiveStyle(context.project, definition);
    const moduleContext: ProjectSceneModuleRenderContext = Object.freeze({
      frame: Object.freeze({...context.frame}),
      canvas: Object.freeze({width: canvas.width, height: canvas.height}),
      output: Object.freeze({
        width: context.project.output.width,
        height: context.project.output.height,
        fps: context.project.output.fps,
        durationInFrames: context.project.output.durationInFrames,
      }),
      shot: Object.freeze({
        id: context.shot.id,
        chapterId: context.shot.chapterId,
        chapterTitle: context.shot.chapterTitle,
        startFrame: context.shot.startFrame,
        endFrame: context.shot.endFrame,
      }),
      params: Object.freeze({...context.shot.params}),
      moduleParams,
      assets,
      style,
    });
    try {
      definition.render(ctx, moduleContext);
    } catch (error) {
      if (error instanceof SceneModuleError) throw error;
      const message = error instanceof Error ? error.message : String(error);
      throw new SceneModuleError(
        `Scene module ${binding.id} failed at output frame ${context.frame.outputFrame}: ${message}`,
      );
    }
  },
});

export const bindProjectSceneModules = (
  bindings: readonly ProjectSceneModuleBinding[],
  importedModules: readonly unknown[],
  approvedAssetIds: readonly string[],
): CanvasSceneRenderer[] => {
  if (!Array.isArray(bindings) || !Array.isArray(importedModules)) {
    fail('Scene module bindings and imports must be arrays');
  }
  if (bindings.length !== importedModules.length) {
    fail('Scene module binding count does not match the imported module count');
  }
  const approved = new Set(approvedAssetIds);
  const seen = new Set<string>();
  const renderers: CanvasSceneRenderer[] = [];
  for (const [index, binding] of bindings.entries()) {
    assertBinding(binding);
    const kind = projectSceneRendererKind(binding.id);
    if (seen.has(kind)) fail(`Duplicate scene module renderer: ${kind}`);
    seen.add(kind);
    const definition = readProjectSceneModule(importedModules[index], binding, approved);
    renderers.push(createProjectSceneRenderer(binding, definition));
  }
  return Object.freeze(renderers) as CanvasSceneRenderer[];
};
