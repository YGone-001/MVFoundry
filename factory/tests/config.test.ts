import {cpSync, rmSync} from 'node:fs';
import path from 'node:path';
import {after, before, test} from 'node:test';
import assert from 'node:assert/strict';
import {loadProject} from '../src/project/loadProject';
import {ConfigValidationError} from '../src/errors';
import {REPO_ROOT, cloneProject, makeWorkspace} from './helpers';

let workspace: string;

before(() => {
  workspace = makeWorkspace();
});

after(() => {
  rmSync(workspace, {recursive: true, force: true});
});

test('two synthetic projects load with materially different profiles', () => {
  const pixel = loadProject('synthetic-pixel-demo', {workspaceRoot: workspace, engineRoot: REPO_ROOT});
  const layered = loadProject('synthetic-layered-demo', {workspaceRoot: workspace, engineRoot: REPO_ROOT});

  assert.equal(pixel.durationInFrames, 48);
  assert.equal(pixel.config.output.fps, 24);
  assert.equal(pixel.config.output.width, 1920);
  assert.equal(pixel.config.output.height, 1080);
  assert.equal(pixel.config.visual.styleProfile, 'pixel-art');
  assert.equal(pixel.config.visual.pixel?.samplingFps, 12);

  assert.equal(layered.durationInFrames, 45);
  assert.equal(layered.config.output.fps, 30);
  assert.equal(layered.config.output.width, 1080);
  assert.equal(layered.config.output.height, 1350);
  assert.equal(layered.config.visual.styleProfile, 'abstract');
  assert.equal(layered.config.visual.pixel, undefined);
  assert.equal(layered.assets[0].id, 'BG-01');
  assert.equal(layered.assets[0].hashVerified, true);
});

test('invalid durations, coverage, permissions and renderers fail closed', () => {
  cloneProject(workspace, 'synthetic-pixel-demo', 'bad-duration', (config) => {
    config.output.fps = 30;
  });
  assert.throws(
    () => loadProject('bad-duration', {workspaceRoot: workspace, engineRoot: REPO_ROOT}),
    ConfigValidationError,
  );

  cloneProject(workspace, 'synthetic-pixel-demo', 'bad-gap', (config) => {
    config.chapters[0].endFrame = 20;
  });
  assert.throws(
    () => loadProject('bad-gap', {workspaceRoot: workspace, engineRoot: REPO_ROOT}),
    ConfigValidationError,
  );

  cloneProject(workspace, 'synthetic-pixel-demo', 'bad-permission', (config) => {
    config.permissions.externalGeneration = true;
  });
  assert.throws(
    () => loadProject('bad-permission', {workspaceRoot: workspace, engineRoot: REPO_ROOT}),
    /externalGeneration/,
  );

  cloneProject(workspace, 'synthetic-pixel-demo', 'bad-renderer', (config) => {
    config.chapters[0].shots[0].renderer = 'not-registered';
  });
  assert.throws(
    () => loadProject('bad-renderer', {workspaceRoot: workspace, engineRoot: REPO_ROOT}),
    /not registered/,
  );

  cloneProject(workspace, 'synthetic-layered-demo', 'pending-scene', (config) => {
    config.assets[0].approval = 'pending';
  });
  assert.throws(
    () => loadProject('pending-scene', {workspaceRoot: workspace, engineRoot: REPO_ROOT}),
    /approval pending/,
  );
});

test('audio hash and declared duration are verified', () => {
  cloneProject(workspace, 'synthetic-pixel-demo', 'bad-audio-hash', (config) => {
    config.audio.sha256 = 'f'.repeat(64);
  });
  assert.throws(
    () => loadProject('bad-audio-hash', {workspaceRoot: workspace, engineRoot: REPO_ROOT}),
    /Audio SHA256 mismatch/,
  );

  cloneProject(workspace, 'synthetic-pixel-demo', 'bad-audio-duration', (config) => {
    config.audio.durationSeconds = 2.2;
    config.chapters[1].endFrame = 53;
    config.chapters[1].shots[0].endFrame = 53;
  });
  assert.throws(
    () => loadProject('bad-audio-duration', {workspaceRoot: workspace, engineRoot: REPO_ROOT}),
    /Audio duration mismatch/,
  );
});

test('project id must match the folder and be declared consistently', () => {
  cpSync(path.join(workspace, 'synthetic-pixel-demo'), path.join(workspace, 'id-mismatch'), {
    recursive: true,
  });
  assert.throws(
    () => loadProject('id-mismatch', {workspaceRoot: workspace, engineRoot: REPO_ROOT}),
    /declares/,
  );
});
