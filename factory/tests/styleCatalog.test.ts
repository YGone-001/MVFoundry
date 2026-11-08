import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {validateProjectConfig} from '../src/config/validate';
import {DEFAULT_SCENE_REGISTRY} from '../src/scenes/registry';
import {
  bindProjectSceneModules,
  createProjectSceneRenderer,
  type ProjectSceneModuleBinding,
  type ProjectSceneModuleDefinition,
} from '../src/scenes/external/contract';
import {
  FOOTAGE_HYBRID_ROUTE,
  STYLE_BACKEND_CAPABILITIES,
  STYLE_IDS,
  STYLE_PROFILES,
  assertRegisteredStyle,
  getStyleProfile,
  isRegisteredStyle,
} from '../src/style/catalog';
import {
  THEME_IDS,
  THEME_PROFILES,
  THEME_REFERENCE_ONLY,
  getThemeProfile,
  isRegisteredTheme,
} from '../src/style/themes';
import type {RenderProjectSnapshot, RenderProjectShot} from '../src/config/types';
import type {SceneFrameInfo} from '../src/timeline/frameClock';
import {REPO_ROOT} from './helpers';

const rendererKinds = new Set(DEFAULT_SCENE_REGISTRY.kinds());

const moduleProject = (): Record<string, any> =>
  JSON.parse(
    readFileSync(
      path.join(REPO_ROOT, 'factory', 'examples', 'projects', 'synthetic-module-pixel-demo', 'project.json'),
      'utf8',
    ),
  ) as Record<string, any>;

const legacyProject = (): Record<string, any> =>
  JSON.parse(
    readFileSync(
      path.join(REPO_ROOT, 'factory', 'examples', 'projects', 'synthetic-pixel-demo', 'project.json'),
      'utf8',
    ),
  ) as Record<string, any>;

const validate = (raw: unknown) => validateProjectConfig(raw, {rendererKinds});

const withStyle = (
  styleId: string,
  options: {theme?: string; declared?: string[]} = {},
): Record<string, any> => {
  const config = moduleProject();
  const declared = options.declared ?? [styleId];
  config.visual.style = options.theme ? {id: styleId, theme: options.theme} : {id: styleId};
  config.visual.styleProfile = styleId;
  for (const module of config.sceneModules) module.styleIds = declared;
  return config;
};

test('the catalog registers six distinct visual languages, not palette aliases', () => {
  assert.equal(STYLE_IDS.length, 6);
  assert.deepEqual(
    [...STYLE_IDS].sort(),
    [
      'anime-motion-comic',
      'cinematic-illustration-2p5d',
      'editorial-motion-graphics',
      'ink-watercolor',
      'retro-pixel',
      'stylized-3d-diorama',
    ],
  );
  const labels = new Set<string>();
  const intentions = new Set<string>();
  for (const id of STYLE_IDS) {
    const profile = assertRegisteredStyle(id);
    assert.equal(profile.id, id);
    assert.ok(profile.palette.length >= 3, `${id} needs a real palette`);
    assert.ok(profile.materials.length >= 3, `${id} needs material rules`);
    assert.ok(profile.composition.length >= 3, `${id} needs composition rules`);
    assert.ok(profile.motion.length >= 2, `${id} needs motion rules`);
    assert.ok(profile.limitations.length >= 1, `${id} must disclose limitations`);
    assert.ok(profile.implementedBackends.includes('canvas2d'), `${id} must have a real backend`);
    assert.ok(profile.compatibleBackends.includes('canvas2d'), `${id} must be available on canvas`);
    assert.equal(labels.has(profile.label), false);
    assert.equal(intentions.has(profile.intent), false);
    labels.add(profile.label);
    intentions.add(profile.intent);
  }
  assert.equal(getStyleProfile('unknown-style'), undefined);
  assert.equal(isRegisteredStyle('unknown-style'), false);
  assert.throws(() => assertRegisteredStyle('unknown-style'), /Unknown visual style/);
});

test('backend capability is declared honestly and footage-hybrid stays a route', () => {
  const statusOf = (backend: string) =>
    STYLE_BACKEND_CAPABILITIES.find((entry) => entry.backend === backend)?.status;
  assert.equal(statusOf('canvas2d'), 'implemented');
  assert.equal(statusOf('video'), 'implemented');
  assert.equal(statusOf('hybrid'), 'implemented');
  assert.equal(statusOf('parallax-2p5d'), 'implemented');
  for (const blocked of ['svg', 'html', 'three']) {
    assert.equal(statusOf(blocked), 'BLOCKED_CAPABILITY', `${blocked} is not implemented`);
  }
  for (const entry of STYLE_BACKEND_CAPABILITIES) {
    if (entry.status === 'BLOCKED_CAPABILITY') {
      assert.ok(entry.detail.length > 40, `${entry.backend} must state the concrete limitation`);
    }
  }
  assert.equal(isRegisteredStyle(FOOTAGE_HYBRID_ROUTE.id), false);
  assert.deepEqual([...FOOTAGE_HYBRID_ROUTE.requiredAssetKinds], ['video', 'layer']);
  assert.equal(FOOTAGE_HYBRID_ROUTE.compatibleStyles.includes('retro-pixel'), false);
});

test('themes are separate from styles and reference-only themes stay unregistered', () => {
  assert.equal(THEME_IDS.length, 4);
  for (const id of THEME_IDS) {
    const theme = getThemeProfile(id);
    assert.ok(theme, `${id} must resolve`);
    assert.ok(theme!.roles.bg.length > 0);
    assert.ok(theme!.roles.accent.length > 0);
    assert.ok(theme!.limitations.length >= 1);
  }
  for (const id of THEME_REFERENCE_ONLY) {
    assert.equal(isRegisteredTheme(id), false, `${id} is reference-only`);
    assert.equal(getThemeProfile(id), undefined);
  }
  // A theme changes shared roles, never the style identity.
  for (const styleId of STYLE_IDS) {
    const profile = assertRegisteredStyle(styleId);
    assert.equal(profile.id, styleId);
  }
});

test('all six styles select through project configuration with declared modules', () => {
  for (const styleId of STYLE_IDS) {
    const config = validate(withStyle(styleId));
    assert.equal(config.visual.style?.id, styleId);
    assert.equal(config.visual.styleProfile, styleId);
    assert.equal(config.visual.style?.theme, undefined);
  }
  const themed = validate(withStyle('cinematic-illustration-2p5d', {theme: 'coral-noir'}));
  assert.equal(themed.visual.style?.theme, 'coral-noir');
  const noted = validate(
    (() => {
      const config = withStyle('cinematic-illustration-2p5d');
      config.visual.style.note = 'reviewer note, not a style definition';
      return config;
    })(),
  );
  assert.equal(noted.visual.style?.note, 'reviewer note, not a style definition');
});

test('legacy projects are not reinterpreted by the style catalog', () => {
  const legacy = validate(legacyProject());
  assert.equal(legacy.visual.style, undefined);
  assert.equal(legacy.visual.styleProfile, 'pixel-art');
  assert.equal(legacy.visual.defaultRenderer, 'pixel-canvas');
  assert.deepEqual(legacy.visual.pixel, {internalWidth: 480, internalHeight: 270, samplingFps: 12});

  const module = validate(moduleProject());
  assert.equal(module.visual.style, undefined);
  assert.equal(module.visual.styleProfile, 'pixel-art-module');
  assert.equal(module.sceneModules[0].styleIds, undefined);
});

test('style-driven configuration fails closed on unknown and mismatched declarations', () => {
  const cases: Array<[string, () => unknown, RegExp]> = [
    [
      'unknown-style',
      () => validate(withStyle('unknown-style', {declared: ['cinematic-illustration-2p5d']})),
      /not a registered style/,
    ],
    [
      'unknown-theme',
      () => validate(withStyle('cinematic-illustration-2p5d', {theme: 'unknown-theme'})),
      /not a registered theme/,
    ],
    [
      'style-not-declared-by-modules',
      () => {
        const config = withStyle('cinematic-illustration-2p5d');
        for (const module of config.sceneModules) module.styleIds = ['anime-motion-comic'];
        return validate(config);
      },
      /does not declare visual style/,
    ],
    [
      'module-without-style-ids',
      () => {
        const config = withStyle('cinematic-illustration-2p5d');
        delete config.sceneModules[0].styleIds;
        return validate(config);
      },
      /does not declare visual style/,
    ],
    [
      'built-in-renderer',
      () => {
        const config = withStyle('cinematic-illustration-2p5d');
        config.visual.defaultRenderer = 'pixel-canvas';
        return validate(config);
      },
      /style-driven projects require a project scene module/,
    ],
    [
      'unregistered-module-style',
      () => {
        const config = withStyle('cinematic-illustration-2p5d');
        config.sceneModules[0].styleIds = ['unknown-style'];
        return validate(config);
      },
      /unregistered style unknown-style/,
    ],
    [
      'duplicate-module-style',
      () => {
        const config = withStyle('cinematic-illustration-2p5d', {
          declared: ['cinematic-illustration-2p5d', 'cinematic-illustration-2p5d'],
        });
        return validate(config);
      },
      /duplicate/,
    ],
    [
      'unknown-style-field',
      () => {
        const config = withStyle('cinematic-illustration-2p5d');
        config.visual.style.palette = '#000000';
        return validate(config);
      },
      /unsupported key palette/,
    ],
    [
      'duplicate-selected-style',
      () => {
        const config = withStyle('cinematic-illustration-2p5d');
        config.sceneModules[0].styleIds = ['cinematic-illustration-2p5d', 'cinematic-illustration-2p5d'];
        return validate(config);
      },
      /duplicate/,
    ],
  ];
  for (const [name, run, pattern] of cases) {
    assert.throws(run, pattern, name);
  }
});

const binding = (styleIds: string[]): ProjectSceneModuleBinding => ({
  id: 'style-test',
  contractVersion: 1,
  moduleType: 'canvas2d',
  sha256: 'a'.repeat(64),
  canvas: {mode: 'output'},
  samplingFps: 'output',
  pixelated: false,
  styleIds,
});

const definition = (
  supportedStyles: string[],
  capture: (style: unknown) => void,
): ProjectSceneModuleDefinition => ({
  id: 'style-test',
  contractVersion: 1,
  moduleType: 'canvas2d',
  params: [],
  assetDependencies: [],
  supportedStyles,
  render: (_ctx, context) => capture(context.style),
});

const renderContext = (style?: {id: string; theme?: string}) => {
  const project = {
    projectId: 'style-test-project',
    output: {width: 320, height: 180, fps: 24, durationInFrames: 48},
    visual: {
      styleProfile: style?.id ?? 'legacy',
      defaultRenderer: 'project:style-test',
      ...(style ? {style} : {}),
    },
    assets: [],
    shots: [],
  } as unknown as RenderProjectSnapshot;
  const shot = {
    id: 'SHOT-01',
    chapterId: 'CH-01',
    chapterTitle: 'Style test',
    startFrame: 0,
    endFrame: 24,
    renderer: 'project:style-test',
    params: {},
  } as RenderProjectShot;
  const frame: SceneFrameInfo = {
    outputFrame: 0,
    outputTime: 0,
    localFrame: 0,
    localTime: 0,
    animationTick: 0,
    animationTime: 0,
    samplingFps: 24,
  };
  return {project, shot, frame, publicAssets: {}};
};

test('the active style and theme reach a project module at render time', () => {
  let captured: any = null;
  const renderer = createProjectSceneRenderer(
    binding(['cinematic-illustration-2p5d']),
    definition(['cinematic-illustration-2p5d'], (style) => {
      captured = style;
    }),
  );
  renderer.render({} as CanvasRenderingContext2D, renderContext({id: 'cinematic-illustration-2p5d', theme: 'coral-noir'}));
  assert.equal(captured.id, 'cinematic-illustration-2p5d');
  assert.equal(captured.label, 'Cinematic 2.5D illustration');
  assert.equal(captured.theme.id, 'coral-noir');
  assert.equal(captured.theme.mode, 'dark');
  assert.equal(captured.profile.id, 'cinematic-illustration-2p5d');
});

test('a module that does not implement the active style refuses to render', () => {
  const renderer = createProjectSceneRenderer(
    binding(['cinematic-illustration-2p5d']),
    definition(['cinematic-illustration-2p5d'], () => undefined),
  );
  assert.throws(
    () => renderer.render({} as CanvasRenderingContext2D, renderContext({id: 'retro-pixel'})),
    /does not implement active style retro-pixel/,
  );
});

test('legacy modules render with no style context instead of an invented one', () => {
  let captured: unknown = 'not-called';
  const renderer = createProjectSceneRenderer(
    binding(['cinematic-illustration-2p5d']),
    definition(['cinematic-illustration-2p5d'], (style) => {
      captured = style;
    }),
  );
  renderer.render({} as CanvasRenderingContext2D, renderContext());
  assert.equal(captured, null);
});

test('module supportedStyles must contain every style declared in the manifest', () => {
  const definitionWithStyles = definition(['anime-motion-comic'], () => undefined);
  const module = {
    id: 'style-test',
    contractVersion: 1,
    moduleType: 'canvas2d',
    params: [],
    render: definitionWithStyles.render,
    supportedStyles: ['anime-motion-comic'],
  };
  assert.throws(
    () => bindProjectSceneModules([binding(['cinematic-illustration-2p5d'])], [module], []),
    /does not export supportedStyles containing it/,
  );
  const unknownModule = {
    ...module,
    supportedStyles: ['unknown-style'],
  };
  assert.throws(
    () => bindProjectSceneModules([binding(['anime-motion-comic'])], [unknownModule], []),
    /declares unregistered style unknown-style/,
  );
});

test('style profiles are frozen and cannot be mutated by a scene module', () => {
  const profile = assertRegisteredStyle('cinematic-illustration-2p5d');
  assert.equal(Object.isFrozen(profile), true);
  assert.equal(Object.isFrozen(profile.palette), true);
  assert.equal(Object.isFrozen(profile.palette[0]), true);
  assert.equal(Object.isFrozen(STYLE_PROFILES), true);
  assert.equal(Object.isFrozen(THEME_PROFILES), true);
  assert.throws(() => {
    (profile as any).label = 'mutated';
  }, TypeError);
});

