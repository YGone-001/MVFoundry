import {rmSync} from 'node:fs';
import {after, before, test} from 'node:test';
import assert from 'node:assert/strict';
import {loadProject} from '../src/project/loadProject';
import {computeAnimationTick} from '../src/timeline/frameClock';
import {createDefaultSceneRegistry, DEFAULT_SCENE_REGISTRY} from '../src/scenes/registry';
import {
  SceneRegistry,
  type CanvasSceneRenderer,
  type MediaSceneRenderer,
} from '../src/scenes/types';
import {SceneRenderError} from '../src/errors';
import {REPO_ROOT, cloneProject, makeWorkspace} from './helpers';

let workspace: string;

before(() => {
  workspace = makeWorkspace();
});

after(() => {
  rmSync(workspace, {recursive: true, force: true});
});

test('built-in renderers expose sizes and sampling rates', () => {
  const pixel = loadProject('synthetic-pixel-demo', {workspaceRoot: workspace, engineRoot: REPO_ROOT});
  const layered = loadProject('synthetic-layered-demo', {workspaceRoot: workspace, engineRoot: REPO_ROOT});
  const shot = pixel.renderProject.chapters[0].shots[0];
  const layeredShot = layered.renderProject.chapters[0].shots[0];

  const pixelRenderer = DEFAULT_SCENE_REGISTRY.get('pixel-canvas') as CanvasSceneRenderer;
  assert.deepEqual(pixelRenderer.canvasSize(pixel.renderProject, shot), {width: 480, height: 270});
  assert.equal(pixelRenderer.samplingFps(pixel.renderProject, shot), 12);

  const layeredRenderer = DEFAULT_SCENE_REGISTRY.get('layered-canvas') as CanvasSceneRenderer;
  assert.deepEqual(layeredRenderer.canvasSize(layered.renderProject, layeredShot), {
    width: 1080,
    height: 1350,
  });
  assert.equal(layeredRenderer.samplingFps(layered.renderProject, layeredShot), 30);

  const videoRenderer = DEFAULT_SCENE_REGISTRY.get('video') as MediaSceneRenderer;
  const hybridRenderer = DEFAULT_SCENE_REGISTRY.get('hybrid') as MediaSceneRenderer;
  assert.equal(videoRenderer.mode, 'media');
  assert.equal(hybridRenderer.mode, 'media');
  assert.equal(typeof videoRenderer.Component, 'function');
  assert.equal(typeof hybridRenderer.Component, 'function');
  assert.equal('render' in videoRenderer, false);
  assert.equal('render' in hybridRenderer, false);
});

test('pixel renderer supports a project-specific internal resolution', () => {
  cloneProject(workspace, 'synthetic-pixel-demo', 'small-pixel-demo', (config) => {
    config.visual.pixel.internalWidth = 320;
    config.visual.pixel.internalHeight = 180;
  });
  const small = loadProject('small-pixel-demo', {
    workspaceRoot: workspace,
    engineRoot: REPO_ROOT,
  });
  const renderer = DEFAULT_SCENE_REGISTRY.get('pixel-canvas') as CanvasSceneRenderer;
  const shot = small.renderProject.chapters[0].shots[0];
  assert.deepEqual(renderer.canvasSize(small.renderProject, shot), {width: 320, height: 180});
  assert.equal(renderer.samplingFps(small.renderProject, shot), 12);
});

test('renderers are extensible without changing the frame clock', () => {
  const tickBefore = computeAnimationTick(7, 24, 12);
  const registry = createDefaultSceneRegistry();
  registry.register({
    kind: 'custom-test',
    canvasSize: (project) => ({width: project.output.width, height: project.output.height}),
    samplingFps: (project) => project.output.fps,
    render: () => undefined,
  });
  const tickAfter = computeAnimationTick(7, 24, 12);
  assert.equal(tickBefore, tickAfter);
  assert.equal(registry.has('custom-test'), true);
  assert.equal(DEFAULT_SCENE_REGISTRY.has('custom-test'), false);
  assert.throws(
    () =>
      registry.register({
        kind: 'custom-test',
        canvasSize: () => ({width: 1, height: 1}),
        samplingFps: () => 1,
        render: () => undefined,
      }),
    SceneRenderError,
  );
  assert.throws(() => new SceneRegistry().get('missing'), SceneRenderError);
});
