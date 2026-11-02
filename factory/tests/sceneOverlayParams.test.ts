import {rmSync} from 'node:fs';
import {after, before, test} from 'node:test';
import assert from 'node:assert/strict';
import {loadProject} from '../src/project/loadProject';
import {validateProjectConfig} from '../src/config/validate';
import {DEFAULT_SCENE_REGISTRY} from '../src/scenes/registry';
import type {CanvasSceneRenderer} from '../src/scenes/types';
import {REPO_ROOT, cloneProject, makeWorkspace, readProjectJson} from './helpers';

let workspace: string;

before(() => {
  workspace = makeWorkspace();
});

after(() => {
  rmSync(workspace, {recursive: true, force: true});
});

type DrawCall = {kind: 'gradient'; alpha: number} | {kind: 'alpha'; alpha: number};

const recordingContext = (calls: DrawCall[]): CanvasRenderingContext2D => {
  let alpha = 1;
  const gradient = {addColorStop: (): void => undefined};
  const ctx = {
    get globalAlpha() {
      return alpha;
    },
    set globalAlpha(value: number) {
      alpha = value;
    },
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    clearRect: (): void => undefined,
    fillRect: (): void => {
      calls.push({kind: 'alpha', alpha});
    },
    createLinearGradient: () => gradient,
    save: (): void => undefined,
    restore: (): void => {
      calls.push({kind: 'gradient', alpha: -1});
    },
    beginPath: (): void => undefined,
    arc: (): void => undefined,
    fill: (): void => {
      calls.push({kind: 'gradient', alpha});
    },
    stroke: (): void => {
      calls.push({kind: 'gradient', alpha});
    },
    moveTo: (): void => undefined,
    lineTo: (): void => undefined,
  };
  return ctx as unknown as CanvasRenderingContext2D;
};

const renderShot = (params: Record<string, unknown>): DrawCall[] => {
  const renderer = DEFAULT_SCENE_REGISTRY.get('layered-canvas') as CanvasSceneRenderer;
  const calls: DrawCall[] = [];
  const project = {
    projectId: 'probe',
    output: {width: 320, height: 180, fps: 30, durationInFrames: 30},
  } as never;
  renderer.render(recordingContext(calls), {
    project,
    shot: {id: 'SHOT-001', startFrame: 0, endFrame: 30, renderer: 'layered-canvas', params} as never,
    frame: {localFrame: 5, localTime: 5 / 30, animationTick: 5} as never,
    publicAssets: {},
  });
  return calls;
};

test('omitting the overlay controls reproduces the historical grade', () => {
  const legacy = renderShot({background: '#101010', accent: '#2EC4B6', secondary: '#FF9F1C', motion: 1.5});
  const explicitDefaults = renderShot({
    background: '#101010',
    accent: '#2EC4B6',
    secondary: '#FF9F1C',
    motion: 1.5,
    washTop: 0.18,
    washBottom: 0.55,
    overlayOpacity: 0.22,
    lineOpacity: 0.6,
    grainOpacity: 0.08,
  });
  assert.deepEqual(explicitDefaults, legacy);
  const alphas = legacy.filter((call) => call.kind === 'gradient' && call.alpha >= 0).map((call) => call.alpha);
  assert.ok(alphas.includes(0.22), `overlay alpha ${alphas.join(',')}`);
  assert.ok(alphas.includes(0.6));
});

test('a low-wash configuration changes the drawn alphas', () => {
  const lowWash = renderShot({
    background: '#101010',
    accent: '#2EC4B6',
    secondary: '#FF9F1C',
    motion: 1.5,
    washTop: 0.02,
    washBottom: 0.1,
    overlayOpacity: 0.1,
    lineOpacity: 0.2,
    grainOpacity: 0.01,
  });
  const alphas = lowWash.filter((call) => call.kind === 'gradient' && call.alpha >= 0).map((call) => call.alpha);
  assert.deepEqual([...new Set(alphas)].sort((a, b) => a - b), [0.1, 0.2]);
  // Grain is painted with fillRect, so its opacity is recorded separately.
  const grain = lowWash.filter((call) => call.kind === 'alpha').map((call) => call.alpha);
  assert.ok(grain.includes(0.01), `grain alpha ${grain.join(',')}`);
});

test('overlay parameters are validated and stay project-local', () => {
  cloneProject(workspace, 'synthetic-layered-demo', 'overlay-params-demo', (config) => {
    config.chapters[0].shots[0].params.washTop = 0.05;
    config.chapters[0].shots[0].params.washBottom = 0.2;
    config.chapters[0].shots[0].params.overlayOpacity = 0.05;
    config.chapters[0].shots[0].params.lineOpacity = 0.15;
    config.chapters[0].shots[0].params.grainOpacity = 0.01;
  });
  const project = loadProject('overlay-params-demo', {workspaceRoot: workspace, engineRoot: REPO_ROOT});
  const params = project.config.chapters[0].shots[0].params;
  assert.equal(params.washTop, 0.05);
  assert.equal(params.grainOpacity, 0.01);

  const base = readProjectJson(workspace, 'synthetic-layered-demo');
  const withParam = (value: unknown): unknown => {
    const config = JSON.parse(JSON.stringify(base)) as Record<string, any>;
    config.chapters[0].shots[0].params.overlayOpacity = value;
    return config;
  };
  const kinds = new Set(DEFAULT_SCENE_REGISTRY.kinds());
  assert.throws(() => validateProjectConfig(withParam(1.5), {rendererKinds: kinds}), /between 0 and 1/);
  assert.throws(() => validateProjectConfig(withParam(-0.1), {rendererKinds: kinds}), /between 0 and 1/);
  assert.throws(() => validateProjectConfig(withParam('loud'), {rendererKinds: kinds}), /overlayOpacity/);
  const accepted = validateProjectConfig(withParam(0.33), {rendererKinds: kinds});
  assert.equal(accepted.chapters[0].shots[0].params.overlayOpacity, 0.33);
});