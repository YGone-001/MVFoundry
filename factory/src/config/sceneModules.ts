import {ConfigValidationError} from '../errors';
import type {
  ProjectSceneModuleType,
  SceneModuleCanvasConfig,
  SceneModuleConfig,
  SceneModuleSampling,
} from './types';
import {
  PROJECT_SCENE_MODULE_CONTRACT_VERSION,
  PROJECT_SCENE_MODULE_MAX_COUNT,
  PROJECT_SCENE_MODULE_TRUST,
  PROJECT_SCENE_MODULE_TYPE,
} from '../scenes/external/constants';
import {isRegisteredStyle, STYLE_IDS} from '../style/catalog';

const MODULE_ID_PATTERN = /^[a-z0-9][a-z0-9-]{2,63}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const STYLE_ID_PATTERN = /^[a-z0-9][a-z0-9-]{2,63}$/;
const MODULE_KEYS = new Set([
  'id',
  'path',
  'moduleType',
  'contractVersion',
  'sha256',
  'trust',
  'canvas',
  'samplingFps',
  'pixelated',
  'label',
  'description',
  'styleIds',
]);

function fail(message: string): never {
  throw new ConfigValidationError(message);
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

const optionalText = (value: unknown, field: string, maxLength: number): string | undefined => {
  if (value === undefined) return undefined;
  const result = text(value, field);
  if (result.length > maxLength) fail(`${field} must be at most ${maxLength} characters`);
  return result;
};

const integer = (value: unknown, field: string, minimum: number, maximum: number): number => {
  if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    fail(`${field} must be an integer in [${minimum}, ${maximum}]`);
  }
  return value as number;
};

const modulePath = (value: unknown, field: string): string => {
  const raw = text(value, field);
  if (/^[a-zA-Z]:/.test(raw) || raw.startsWith('/') || raw.startsWith('\\')) {
    fail(`${field} must be a project-relative path`);
  }
  const segments = raw.replace(/\\/g, '/').split('/');
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    fail(`${field} must not contain empty, current or parent segments`);
  }
  if (segments.some((segment) => segment.includes(':'))) {
    fail(`${field} must not contain drive or alternate-stream syntax`);
  }
  if (segments[0] !== 'scenes' || segments.length < 2) {
    fail(`${field} must point inside the project scenes/ directory`);
  }
  const fileName = segments[segments.length - 1];
  if (!/\.(ts|tsx)$/i.test(fileName) || /\.d\.ts$/i.test(fileName)) {
    fail(`${field} must be a .ts or .tsx implementation file`);
  }
  return segments.join('/');
};

const canvasConfig = (value: unknown, field: string): SceneModuleCanvasConfig => {
  const canvas = record(value, field);
  const allowed = new Set(['mode', 'width', 'height']);
  for (const key of Object.keys(canvas)) {
    if (!allowed.has(key)) fail(`${field} contains unsupported key ${key}`);
  }
  const mode = canvas.mode;
  if (mode === 'output' || mode === 'project-pixel') {
    if (canvas.width !== undefined || canvas.height !== undefined) {
      fail(`${field}.width/height are only valid in custom mode`);
    }
    return {mode};
  }
  if (mode === 'custom') {
    return {
      mode,
      width: integer(canvas.width, `${field}.width`, 1, 16384),
      height: integer(canvas.height, `${field}.height`, 1, 16384),
    };
  }
  return fail(`${field}.mode must be output, project-pixel or custom`);
};

const samplingConfig = (value: unknown, field: string): SceneModuleSampling => {
  if (value === 'output' || value === 'project-pixel') return value;
  return integer(value, field, 1, 120);
};

/**
 * Parses and validates the optional sceneModules manifest section. This function
 * is pure: it never resolves files, reads hashes or executes project code.
 */
export const parseSceneModules = (raw: unknown): SceneModuleConfig[] => {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) fail('sceneModules must be an array');
  if (raw.length > PROJECT_SCENE_MODULE_MAX_COUNT) {
    fail(`sceneModules must contain at most ${PROJECT_SCENE_MODULE_MAX_COUNT} entries`);
  }

  const seen = new Set<string>();
  const modules: SceneModuleConfig[] = [];
  for (const [index, entry] of raw.entries()) {
    const field = `sceneModules[${index}]`;
    const module = record(entry, field);
    for (const key of Object.keys(module)) {
      if (!MODULE_KEYS.has(key)) fail(`${field} contains unsupported key ${key}`);
    }
    const id = text(module.id, `${field}.id`);
    if (!MODULE_ID_PATTERN.test(id)) {
      fail(`${field}.id must be lowercase letters, digits and hyphens (3-64 chars)`);
    }
    if (seen.has(id)) fail(`sceneModules contains duplicate id ${id}`);
    seen.add(id);

    const moduleType = text(module.moduleType, `${field}.moduleType`);
    if (moduleType !== PROJECT_SCENE_MODULE_TYPE) {
      fail(`${field}.moduleType must be ${PROJECT_SCENE_MODULE_TYPE} in contract version 1`);
    }
    if (module.contractVersion !== PROJECT_SCENE_MODULE_CONTRACT_VERSION) {
      fail(`${field}.contractVersion must be ${PROJECT_SCENE_MODULE_CONTRACT_VERSION}`);
    }
    const sha256 = text(module.sha256, `${field}.sha256`);
    if (!SHA256_PATTERN.test(sha256)) fail(`${field}.sha256 must be lowercase hex`);
    if (module.trust !== PROJECT_SCENE_MODULE_TRUST) {
      fail(`${field}.trust must be ${PROJECT_SCENE_MODULE_TRUST}`);
    }
    const canvas = canvasConfig(module.canvas, `${field}.canvas`);
    const samplingFps = samplingConfig(module.samplingFps, `${field}.samplingFps`);
    if (module.pixelated !== undefined && typeof module.pixelated !== 'boolean') {
      fail(`${field}.pixelated must be a boolean`);
    }
    const pixelated =
      module.pixelated === undefined ? canvas.mode !== 'output' : (module.pixelated as boolean);

    let styleIds: string[] | undefined;
    if (module.styleIds !== undefined) {
      if (!Array.isArray(module.styleIds)) fail(`${field}.styleIds must be an array`);
      if (module.styleIds.length === 0) fail(`${field}.styleIds must not be empty`);
      if (module.styleIds.length > 12) fail(`${field}.styleIds may declare at most 12 styles`);
      const seenStyles = new Set<string>();
      styleIds = [];
      for (const [styleIndex, entry] of module.styleIds.entries()) {
        const styleId = text(entry, `${field}.styleIds[${styleIndex}]`);
        if (!STYLE_ID_PATTERN.test(styleId)) {
          fail(`${field}.styleIds[${styleIndex}] must be lowercase letters, digits and hyphens`);
        }
        if (seenStyles.has(styleId)) fail(`${field}.styleIds contains duplicate ${styleId}`);
        seenStyles.add(styleId);
        if (!isRegisteredStyle(styleId)) {
          fail(`${field}.styleIds contains unregistered style ${styleId}; registered: ${STYLE_IDS.join(', ')}`);
        }
        styleIds.push(styleId);
      }
    }

    modules.push({
      id,
      path: modulePath(module.path, `${field}.path`),
      moduleType: moduleType as ProjectSceneModuleType,
      contractVersion: 1,
      sha256,
      trust: PROJECT_SCENE_MODULE_TRUST,
      canvas,
      samplingFps,
      pixelated,
      label: optionalText(module.label, `${field}.label`, 120),
      description: optionalText(module.description, `${field}.description`, 1000),
      styleIds,
    });
  }
  return modules;
};
