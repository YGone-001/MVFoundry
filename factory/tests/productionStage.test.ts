import {rmSync} from 'node:fs';
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

test('a freshly initialized project (no chapters) loads for preproduction only', () => {
  cloneProject(workspace, 'synthetic-pixel-demo', 'fresh-onboarding-demo', (config) => {
    config.chapters = [];
  });

  // The render loader keeps requiring a real, complete timeline.
  assert.throws(
    () => loadProject('fresh-onboarding-demo', {workspaceRoot: workspace, engineRoot: REPO_ROOT}),
    (error: unknown) =>
      error instanceof ConfigValidationError && /chapters must not be empty/.test(error.message),
  );

  // Preproduction may load the same project so analysis can begin immediately.
  const project = loadProject('fresh-onboarding-demo', {
    workspaceRoot: workspace,
    engineRoot: REPO_ROOT,
    stage: 'preproduction',
  });
  assert.deepEqual(project.config.chapters, []);
  assert.deepEqual(project.shots, []);
  assert.ok(project.durationInFrames > 0);
  assert.equal(project.audioDurationSeconds, project.config.audio.durationSeconds);
  assert.ok(project.audioMetadata.decodedDurationSeconds > 0);
  assert.ok(project.audioPath.length > 0);
});

test('preproduction stage still refuses incomplete coverage and bad audio', () => {
  cloneProject(workspace, 'synthetic-pixel-demo', 'partial-timeline-demo', (config) => {
    const chapter = config.chapters[config.chapters.length - 1];
    chapter.endFrame = chapter.endFrame - 1;
    chapter.shots[chapter.shots.length - 1].endFrame = chapter.endFrame;
  });
  assert.throws(
    () =>
      loadProject('partial-timeline-demo', {
        workspaceRoot: workspace,
        engineRoot: REPO_ROOT,
        stage: 'preproduction',
      }),
    /chapters must end at the derived duration/,
  );

  cloneProject(workspace, 'synthetic-pixel-demo', 'changed-audio-demo', (config) => {
    config.audio.sha256 = '0'.repeat(64);
  });
  assert.throws(
    () =>
      loadProject('changed-audio-demo', {
        workspaceRoot: workspace,
        engineRoot: REPO_ROOT,
        stage: 'preproduction',
      }),
    /Audio SHA256 mismatch/,
  );
});

test('preproduction stage keeps the P0 permission refusal', () => {
  cloneProject(workspace, 'synthetic-pixel-demo', 'unsafe-permissions-demo', (config) => {
    config.chapters = [];
    config.permissions = {externalGeneration: true, localOnly: true, allowNetwork: false};
  });
  assert.throws(
    () =>
      loadProject('unsafe-permissions-demo', {
        workspaceRoot: workspace,
        engineRoot: REPO_ROOT,
        stage: 'preproduction',
      }),
    /externalGeneration/,
  );
});

test('a complete approved timeline loads in both stages', () => {
  const render = loadProject('synthetic-pixel-demo', {workspaceRoot: workspace, engineRoot: REPO_ROOT});
  const preproduction = loadProject('synthetic-pixel-demo', {
    workspaceRoot: workspace,
    engineRoot: REPO_ROOT,
    stage: 'preproduction',
  });
  assert.equal(preproduction.durationInFrames, render.durationInFrames);
  assert.equal(preproduction.shots.length, render.shots.length);
  assert.ok(render.shots.length > 0);
});