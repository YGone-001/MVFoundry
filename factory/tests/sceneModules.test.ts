import {createHash} from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {after, before, test} from 'node:test';
import assert from 'node:assert/strict';
import {loadProject} from '../src/project/loadProject';
import {stageProjectBundle} from '../src/project/stageSceneBundle';
import {
  bindProjectSceneModules,
  createProjectSceneRenderer,
  projectSceneRendererKind,
  readProjectSceneModule,
  type ProjectSceneModuleBinding,
  type ProjectSceneModuleDefinition,
} from '../src/scenes/external/contract';
import {ConfigValidationError, SceneModuleError} from '../src/errors';
import {sha256File} from '../src/media/hash';
import {createProjectWriteBoundary} from '../src/workspace/writeBoundary';
import {isInside} from '../src/workspace/guard';
import {createDefaultSceneRegistry, DEFAULT_SCENE_REGISTRY} from '../src/scenes/registry';
import {buildSceneFrameInfo} from '../src/timeline/frameClock';
import type {RenderProjectShot} from '../src/config/types';
import {REPO_ROOT, cloneProject, makeWorkspace, readProjectJson} from './helpers';

let workspace: string;

before(() => {
  workspace = makeWorkspace();
});

after(() => {
  rmSync(workspace, {recursive: true, force: true});
});

const load = (id: string, root = workspace) =>
  loadProject(id, {workspaceRoot: root, engineRoot: REPO_ROOT});

const updateModuleSource = (
  root: string,
  projectId: string,
  relativePath: string,
  source: string,
): string => {
  const projectDir = path.join(root, projectId);
  const file = path.join(projectDir, relativePath);
  mkdirSync(path.dirname(file), {recursive: true});
  writeFileSync(file, source, 'utf8');
  const hash = createHash('sha256').update(Buffer.from(source, 'utf8')).digest('hex');
  const config = readProjectJson(root, projectId);
  const entry = config.sceneModules.find((module: Record<string, unknown>) => module.path === relativePath);
  assert.ok(entry, `missing sceneModules entry for ${relativePath}`);
  entry.sha256 = hash;
  writeFileSync(path.join(projectDir, 'project.json'), JSON.stringify(config, null, 2));
  return hash;
};

const safeJunction = (target: string, link: string): boolean => {
  try {
    symlinkSync(target, link, 'junction');
    return true;
  } catch {
    return false;
  }
};

const binding = (
  id: string,
  overrides: Partial<ProjectSceneModuleBinding> = {},
): ProjectSceneModuleBinding => ({
  id,
  contractVersion: 1,
  moduleType: 'canvas2d',
  sha256: 'a'.repeat(64),
  canvas: {mode: 'project-pixel'},
  samplingFps: 'project-pixel',
  pixelated: true,
  ...overrides,
});

const definition = (
  id: string,
  overrides: Partial<ProjectSceneModuleDefinition> = {},
): ProjectSceneModuleDefinition => ({
  id,
  contractVersion: 1,
  moduleType: 'canvas2d',
  params: [{key: 'speed', type: 'number', required: true}],
  assetDependencies: [],
  render: () => undefined,
  ...overrides,
});

test('module projects load with verified hashes and deterministic renderer kinds', () => {
  const pixel = load('synthetic-module-pixel-demo');
  const layered = load('synthetic-module-layered-demo');

  assert.deepEqual(pixel.sceneModules.map((module) => module.id), ['runner', 'signal']);
  assert.deepEqual(layered.sceneModules.map((module) => module.id), ['aurora', 'ribbons']);
  for (const project of [pixel, layered]) {
    for (const module of project.sceneModules) {
      assert.equal(sha256File(module.absolutePath), module.sha256);
      assert.equal(module.computedSha256, module.sha256);
      assert.equal(module.trust, 'user-authored-approved');
      assert.equal(isInside(project.projectDir, module.absolutePath), true);
    }
  }
  assert.deepEqual(
    pixel.shots.map((entry) => entry.shot.renderer),
    ['project:runner', 'project:signal'],
  );
  assert.deepEqual(
    layered.shots.map((entry) => entry.shot.renderer),
    ['project:aurora', 'project:ribbons'],
  );
  assert.deepEqual(pixel.renderProject.sceneModules.map((module) => module.id), ['runner', 'signal']);
  assert.equal('path' in pixel.renderProject.sceneModules[0], false);
  assert.equal(load('synthetic-pixel-demo').sceneModules.length, 0);
});

test('sceneModules reject missing, absolute, traversal, hash, trust, type and duplicate entries', () => {
  const cases: Array<[string, (config: Record<string, any>) => void, RegExp]> = [
    ['missing', (config) => (config.sceneModules[0].path = 'scenes/missing.ts'), /does not exist/],
    [
      'hash',
      (config) => (config.sceneModules[0].sha256 = '0'.repeat(64)),
      /SHA256 mismatch/,
    ],
    [
      'absolute',
      (config) => (config.sceneModules[0].path = path.resolve(workspace, 'escape.ts')),
      /project-relative path/,
    ],
    ['traversal', (config) => (config.sceneModules[0].path = '../escape.ts'), /parent segments/],
    [
      'trust',
      (config) => (config.sceneModules[0].trust = 'user-authored'),
      /trust must be user-authored-approved/,
    ],
    [
      'type',
      (config) => (config.sceneModules[0].moduleType = 'video'),
      /moduleType must be canvas2d/,
    ],
    [
      'duplicate',
      (config) => config.sceneModules.push({...config.sceneModules[1]}),
      /duplicate id/,
    ],
    ['extension', (config) => (config.sceneModules[0].path = 'scenes/runner.js'), /\.ts or \.tsx/],
    [
      'outside',
      (config) => (config.sceneModules[0].path = 'assets/runner.ts'),
      /inside the project scenes\//,
    ],
    [
      'contract',
      (config) => (config.sceneModules[0].contractVersion = 2),
      /contractVersion must be 1/,
    ],
    [
      'canvas',
      (config) => (config.sceneModules[0].canvas = {mode: 'custom', width: 0, height: 10}),
      /canvas\.width/,
    ],
    [
      'sampling',
      (config) => (config.sceneModules[0].samplingFps = 0),
      /samplingFps/,
    ],
    [
      'unknown-field',
      (config) => (config.sceneModules[0].unsupported = true),
      /unsupported key/,
    ],
    ['not-array', (config) => (config.sceneModules = {}), /must be an array/],
  ];

  for (const [name, mutate, expected] of cases) {
    const id = `mod-${name}`;
    cloneProject(workspace, 'synthetic-module-pixel-demo', id, mutate);
    assert.throws(() => load(id), expected, name);
  }
});

test('shots cannot reference undeclared or other-project scene modules', () => {
  cloneProject(workspace, 'synthetic-module-pixel-demo', 'mod-shot-missing', (config) => {
    config.chapters[0].shots[0].renderer = 'project:not-declared';
  });
  assert.throws(() => load('mod-shot-missing'), /undeclared scene module/);

  cloneProject(workspace, 'synthetic-module-pixel-demo', 'mod-shot-cross', (config) => {
    config.chapters[0].shots[0].renderer = 'project:aurora';
  });
  assert.throws(() => load('mod-shot-cross'), /undeclared scene module/);

  cloneProject(workspace, 'synthetic-module-pixel-demo', 'mod-builtin-params', (config) => {
    config.chapters[0].shots[0].renderer = 'pixel-canvas';
  });
  assert.throws(() => load('mod-builtin-params'), /moduleParams is only valid/);
});

test('module paths reject linked components and cross-project junctions', (t) => {
  const outside = mkdtempSync(path.join(tmpdir(), 'mv-module-outside-'));
  writeFileSync(path.join(outside, 'runner.ts'), 'export default {};\n');
  const linkedId = 'mod-linked';
  cloneProject(workspace, 'synthetic-module-pixel-demo', linkedId);
  rmSync(path.join(workspace, linkedId, 'scenes', 'runner.ts'));
  const link = path.join(workspace, linkedId, 'scenes', 'linked');
  if (!safeJunction(outside, link)) {
    rmSync(outside, {recursive: true, force: true});
    t.skip('junction creation is unavailable on this host');
    return;
  }
  try {
    const config = readProjectJson(workspace, linkedId);
    config.sceneModules[0].path = 'scenes/linked/runner.ts';
    writeFileSync(
      path.join(workspace, linkedId, 'project.json'),
      JSON.stringify(config, null, 2),
    );
    assert.throws(() => load(linkedId), /must not contain symlinks|escapes/);
  } finally {
    rmSync(outside, {recursive: true, force: true});
  }

  const crossId = 'mod-cross-link';
  cloneProject(workspace, 'synthetic-module-pixel-demo', crossId);
  rmSync(path.join(workspace, crossId, 'scenes', 'runner.ts'));
  const crossLink = path.join(workspace, crossId, 'scenes', 'other');
  if (!safeJunction(path.join(workspace, 'synthetic-module-layered-demo', 'scenes'), crossLink)) {
    t.skip('junction creation is unavailable on this host');
    return;
  }
  try {
    const config = readProjectJson(workspace, crossId);
    config.sceneModules[0].path = 'scenes/other/aurora.tsx';
    writeFileSync(
      path.join(workspace, crossId, 'project.json'),
      JSON.stringify(config, null, 2),
    );
    assert.throws(() => load(crossId), /must not contain symlinks|escapes/);
  } finally {
    rmSync(crossLink, {recursive: true, force: true});
  }
});

test('module source policy rejects imports, URLs, clocks, randomness and dynamic code', () => {
  const id = 'mod-source';
  cloneProject(workspace, 'synthetic-module-pixel-demo', id);
  const cases: Array<[string, string, RegExp]> = [
    ['import', "import {helper} from './helper';\nexport default {};\n", /import declarations/],
    [
      'url',
      "const endpoint = 'https://remotion.dev/scene';\nexport default {};\n",
      /network or data URL/,
    ],
    [
      'fetch',
      "const load = () => fetch('/local');\nexport default {};\n",
      /forbidden global fetch/,
    ],
    ['timer', 'setInterval(() => undefined, 16);\nexport default {};\n', /setInterval/],
    ['random', 'const value = Math.random();\nexport default {};\n', /Math\.random/],
    ['date', 'const value = new Date();\nexport default {};\n', /forbidden global Date/],
    ['process', 'const value = process.env.SECRET;\nexport default {};\n', /forbidden global process/],
    ['require', "const value = require('./x');\nexport default {};\n", /require\(\)/],
    ['dynamic', "const value = import('./x');\nexport default {};\n", /dynamic import/],
    [
      'function',
      "const value = new Function('return 1;');\nexport default {};\n",
      /construct functions/,
    ],
    ['dom', 'const value = document.body;\nexport default {};\n', /forbidden global document/],
  ];
  for (const [name, source, expected] of cases) {
    updateModuleSource(workspace, id, 'scenes/runner.ts', source);
    assert.throws(() => load(id), expected, name);
  }
});

test('loading hashes and scans module bytes without executing project code', () => {
  const id = 'mod-no-exec';
  cloneProject(workspace, 'synthetic-module-pixel-demo', id);
  updateModuleSource(
    workspace,
    id,
    'scenes/runner.ts',
    "throw new Error('scene module must not execute during load');\nexport default {};\n",
  );
  const project = load(id);
  assert.match(project.sceneModules[0].sourceText, /must not execute during load/);
});

test('moduleParams are JSON-safe and confined to project renderers', () => {
  cloneProject(workspace, 'synthetic-module-pixel-demo', 'mod-param-object', (config) => {
    config.chapters[0].shots[0].moduleParams.extra = {nested: true};
  });
  assert.throws(() => load('mod-param-object'), /must be a string, finite number or boolean/);
});

test('runtime bindings reject identity, schema and asset mismatches', () => {
  const projectA = load('synthetic-module-pixel-demo');
  const projectB = load('synthetic-module-layered-demo');
  assert.throws(
    () => readProjectSceneModule(definition('other'), binding('runner'), new Set()),
    /does not match manifest id/,
  );
  assert.throws(
    () => readProjectSceneModule(definition('runner', {contractVersion: 2}), binding('runner'), new Set()),
    /contract version/,
  );
  assert.throws(
    () => readProjectSceneModule(definition('runner', {moduleType: 'video' as 'canvas2d'}), binding('runner'), new Set()),
    /module type/,
  );
  assert.throws(
    () =>
      readProjectSceneModule(
        {id: 'runner', contractVersion: 1, moduleType: 'canvas2d', render: 1} as unknown,
        binding('runner'),
        new Set(),
      ),
    /render\(ctx, context\)/,
  );
  assert.throws(
    () =>
      readProjectSceneModule(
        definition('runner', {
          params: [
            {key: 'speed', type: 'number'},
            {key: 'speed', type: 'string'},
          ],
        }),
        binding('runner'),
        new Set(),
      ),
    /duplicate parameter/,
  );
  assert.throws(
    () =>
      readProjectSceneModule(
        definition('runner', {assetDependencies: ['EVIL-01']}),
        binding('runner'),
        new Set(['BG-01']),
      ),
    /unapproved or undeclared asset/,
  );
  assert.throws(
    () => bindProjectSceneModules([binding('runner'), binding('runner')], [definition('runner'), definition('runner')], []),
    /Duplicate scene module renderer/,
  );
  assert.equal(projectA.sceneModules.length, 2);
  assert.equal(projectB.sceneModules.length, 2);
});

test('module renderer receives authoritative frame, canvas, params and approved assets', () => {
  const project = load('synthetic-module-layered-demo');
  const shot = project.renderProject.chapters[0].shots[0] as RenderProjectShot;
  let captured: any;
  const module = definition('aurora', {
    params: [
      {key: 'intensity', type: 'number', required: true},
      {key: 'drift', type: 'number'},
    ],
    assetDependencies: ['BG-01'],
    render: (_ctx, context) => {
      captured = context;
    },
  });
  const renderer = createProjectSceneRenderer(
    binding('aurora', {canvas: {mode: 'output'}, samplingFps: 'output', pixelated: false}),
    module,
  );
  assert.equal(renderer.kind, 'project:aurora');
  assert.deepEqual(renderer.canvasSize(project.renderProject, shot), {width: 900, height: 1600});
  assert.equal(renderer.samplingFps(project.renderProject, shot), 30);

  const frame = buildSceneFrameInfo(29, 20, 30, 30, 45);
  renderer.render({} as CanvasRenderingContext2D, {
    project: project.renderProject,
    shot,
    frame,
    publicAssets: {'BG-01': 'assets/images/bg.png'},
  });
  assert.deepEqual(captured.canvas, {width: 900, height: 1600});
  assert.deepEqual(captured.output, {width: 900, height: 1600, fps: 30, durationInFrames: 45});
  assert.equal(captured.frame.localFrame, 9);
  assert.equal(captured.frame.animationTick, 9);
  assert.equal(captured.moduleParams.intensity, 0.7);
  assert.deepEqual(captured.assets['BG-01'], {publicPath: 'assets/images/bg.png'});
  assert.equal(Object.isFrozen(captured.params), true);
  assert.equal(Object.isFrozen(captured.assets), true);
});

test('module renderer fails closed on missing params and unstaged assets', () => {
  const project = load('synthetic-module-layered-demo');
  const shot = project.renderProject.chapters[0].shots[0] as RenderProjectShot;
  const base = binding('aurora', {canvas: {mode: 'output'}, samplingFps: 'output', pixelated: false});
  const renderer = createProjectSceneRenderer(
    base,
    definition('aurora', {
      params: [{key: 'intensity', type: 'number', required: true}],
      assetDependencies: ['BG-01'],
    }),
  );
  const frame = buildSceneFrameInfo(0, 0, 30, 30, 45);
  assert.throws(
    () =>
      renderer.render({} as CanvasRenderingContext2D, {
        project: project.renderProject,
        shot: {...shot, moduleParams: undefined},
        frame,
        publicAssets: {'BG-01': 'assets/images/bg.png'},
      }),
    /requires parameter intensity/,
  );
  assert.throws(
    () =>
      renderer.render({} as CanvasRenderingContext2D, {
        project: project.renderProject,
        shot: {...shot, moduleParams: {intensity: 'bright'}},
        frame,
        publicAssets: {'BG-01': 'assets/images/bg.png'},
      }),
    /parameter intensity must be number/,
  );
  assert.throws(
    () =>
      renderer.render({} as CanvasRenderingContext2D, {
        project: project.renderProject,
        shot: {...shot, moduleParams: {intensity: 0.5, extra: true}},
        frame,
        publicAssets: {'BG-01': 'assets/images/bg.png'},
      }),
    /does not declare parameter extra/,
  );
  assert.throws(
    () =>
      renderer.render({} as CanvasRenderingContext2D, {
        project: project.renderProject,
        shot: {...shot, moduleParams: {intensity: 0.5}},
        frame,
        publicAssets: {},
      }),
    /not staged/,
  );
});

test('module renderers register per project and never replace built-in renderer ids', () => {
  const renderersA = bindProjectSceneModules(
    [binding('alpha')],
    [definition('alpha', {params: []})],
    [],
  );
  const renderersB = bindProjectSceneModules(
    [binding('beta')],
    [definition('beta', {params: []})],
    [],
  );
  const registryA = createDefaultSceneRegistry();
  for (const renderer of renderersA) registryA.register(renderer);
  const registryB = createDefaultSceneRegistry();
  for (const renderer of renderersB) registryB.register(renderer);

  assert.equal(registryA.has('project:alpha'), true);
  assert.equal(registryA.has('project:beta'), false);
  assert.equal(registryB.has('project:beta'), true);
  assert.equal(registryB.has('project:alpha'), false);
  assert.equal(DEFAULT_SCENE_REGISTRY.has('project:alpha'), false);

  const reserved = binding('pixel-canvas');
  assert.equal(projectSceneRendererKind(reserved.id), 'project:pixel-canvas');
  assert.equal(
    readProjectSceneModule(definition('pixel-canvas', {params: []}), reserved, new Set()).id,
    'pixel-canvas',
  );
  assert.equal(DEFAULT_SCENE_REGISTRY.get('pixel-canvas').kind, 'pixel-canvas');
});

test('staging writes verified module copies and a relative static entry outside the repository', () => {
  const project = load('synthetic-module-pixel-demo');
  const boundary = createProjectWriteBoundary(project, {engineRoot: REPO_ROOT});
  const staged = stageProjectBundle(project, {boundary});

  assert.equal(isInside(project.projectDir, staged.engineBundleDir), true);
  assert.equal(isInside(REPO_ROOT, staged.engineBundleDir), false);
  assert.equal(staged.modules.length, 2);
  for (const [index, module] of staged.modules.entries()) {
    const stagedFile = path.join(staged.modulesDir, module.stagedFileName);
    assert.equal(sha256File(stagedFile), project.sceneModules[index].sha256);
    assert.equal(sha256File(stagedFile), module.sha256);
    assert.equal(sha256File(project.sceneModules[index].absolutePath), module.sha256);
  }
  const entry = readFileSync(staged.entryPoint, 'utf8');
  assert.match(entry, /from '\.\/modules\/000-runner\.ts'/);
  assert.match(entry, /from '\.\/modules\/001-signal\.ts'/);
  assert.match(entry, /bindProjectSceneModules/);
  assert.match(entry, /extraRenderers=\{projectRenderers\}/);
  assert.equal(entry.includes(REPO_ROOT), false);
  assert.equal(entry.includes(project.workspaceRoot), false);
  assert.equal(entry.includes(project.projectDir), false);
  assert.equal(existsSync(path.join(REPO_ROOT, 'factory', 'examples', 'projects', project.config.projectId, 'cache')), false);
});

test('declarative projects keep a module-free staged entry', () => {
  const project = load('synthetic-layered-demo');
  const boundary = createProjectWriteBoundary(project, {engineRoot: REPO_ROOT});
  const staged = stageProjectBundle(project, {boundary});
  assert.equal(staged.modules.length, 0);
  const entry = readFileSync(staged.entryPoint, 'utf8');
  assert.match(entry, /bindProjectSceneModules/);
  assert.doesNotMatch(entry, /from '\.\/modules\//);
});
