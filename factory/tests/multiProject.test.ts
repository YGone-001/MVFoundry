import {rmSync} from 'node:fs';
import {after, before, test} from 'node:test';
import assert from 'node:assert/strict';
import {listProjectIds, loadAllProjects} from '../src/project/loadProject';
import {REPO_ROOT, makeWorkspace} from './helpers';

let workspace: string;

before(() => {
  workspace = makeWorkspace();
});

after(() => {
  rmSync(workspace, {recursive: true, force: true});
});

test('G04/G05/G06: one engine loads independent pixel and nonpixel profiles', () => {
  const ids = listProjectIds({workspaceRoot: workspace, engineRoot: REPO_ROOT});
  assert.deepEqual(ids, [
    'synthetic-layered-demo',
    'synthetic-module-layered-demo',
    'synthetic-module-pixel-demo',
    'synthetic-pixel-demo',
  ]);
  const projects = loadAllProjects({workspaceRoot: workspace, engineRoot: REPO_ROOT});
  assert.equal(projects.length, 4);

  const pixel = projects.find((project) => project.config.projectId === 'synthetic-pixel-demo');
  const layered = projects.find((project) => project.config.projectId === 'synthetic-layered-demo');
  assert.ok(pixel);
  assert.ok(layered);

  assert.notEqual(pixel.config.visual.styleProfile, layered.config.visual.styleProfile);
  assert.notEqual(pixel.config.output.fps, layered.config.output.fps);
  assert.notEqual(pixel.config.output.width, layered.config.output.width);
  assert.notEqual(pixel.config.output.height, layered.config.output.height);
  assert.notEqual(pixel.durationInFrames, layered.durationInFrames);
  assert.equal(pixel.config.visual.pixel?.samplingFps, 12);
  assert.equal(layered.config.visual.pixel, undefined);
  assert.equal(pixel.workspaceRoot, layered.workspaceRoot);

  const modulePixel = projects.find(
    (project) => project.config.projectId === 'synthetic-module-pixel-demo',
  );
  const moduleLayered = projects.find(
    (project) => project.config.projectId === 'synthetic-module-layered-demo',
  );
  assert.ok(modulePixel);
  assert.ok(moduleLayered);
  assert.deepEqual(modulePixel.sceneModules.map((module) => module.id), ['runner', 'signal']);
  assert.deepEqual(moduleLayered.sceneModules.map((module) => module.id), ['aurora', 'ribbons']);
  assert.equal(modulePixel.config.output.fps, 24);
  assert.equal(moduleLayered.config.output.fps, 30);
  assert.notEqual(modulePixel.config.output.width, moduleLayered.config.output.width);
  assert.notEqual(modulePixel.config.output.height, moduleLayered.config.output.height);
  for (const project of projects) {
    assert.equal(
      project.shots.some((entry) => entry.shot.renderer.startsWith('project:')),
      project.sceneModules.length > 0,
    );
  }
});
