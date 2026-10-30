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
  assert.deepEqual(ids, ['synthetic-layered-demo', 'synthetic-pixel-demo']);
  const projects = loadAllProjects({workspaceRoot: workspace, engineRoot: REPO_ROOT});
  assert.equal(projects.length, 2);

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
});
