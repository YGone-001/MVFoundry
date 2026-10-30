import {existsSync, readFileSync, rmSync, statSync} from 'node:fs';
import path from 'node:path';
import {after, before, test} from 'node:test';
import assert from 'node:assert/strict';
import {loadProject} from '../src/project/loadProject';
import {stageProjectMedia} from '../src/media/stagePublic';
import {sha256File} from '../src/media/hash';
import {MediaError} from '../src/errors';
import {isInside} from '../src/workspace/guard';
import {REPO_ROOT, cloneProject, makeWorkspace} from './helpers';

let workspace: string;

before(() => {
  workspace = makeWorkspace();
});

after(() => {
  rmSync(workspace, {recursive: true, force: true});
});

test('approved assets and audio are staged inside the project workspace', () => {
  const project = loadProject('synthetic-layered-demo', {
    workspaceRoot: workspace,
    engineRoot: REPO_ROOT,
  });
  const staged = stageProjectMedia(project, {engineRoot: REPO_ROOT});

  assert.equal(isInside(project.projectDir, staged.publicDir), true);
  assert.equal(isInside(REPO_ROOT, staged.publicDir), false);
  assert.equal(staged.publicAssets['BG-01'], 'assets/images/bg.png');
  const copiedImage = path.join(staged.publicDir, 'assets/images/bg.png');
  assert.equal(existsSync(copiedImage), true);
  assert.equal(sha256File(copiedImage), project.config.assets[0].sha256);
  assert.ok(staged.audioPublicPath);
  const copiedAudio = path.join(staged.publicDir, staged.audioPublicPath);
  assert.equal(sha256File(copiedAudio), project.config.audio.sha256);
  assert.ok(statSync(copiedAudio).size > 0);
});

test('pending assets are never staged', () => {
  cloneProject(workspace, 'synthetic-layered-demo', 'pending-extra-asset', (config) => {
    config.assets.push({
      id: 'PENDING-01',
      kind: 'image',
      path: 'assets/images/pending.png',
      sha256: '1'.repeat(64),
      source: 'Synthetic pending fixture',
      rights: 'Pending',
      approval: 'pending',
    });
  });
  const project = loadProject('pending-extra-asset', {
    workspaceRoot: workspace,
    engineRoot: REPO_ROOT,
  });
  const staged = stageProjectMedia(project, {engineRoot: REPO_ROOT});
  assert.equal(staged.publicAssets['PENDING-01'], undefined);
  assert.equal(existsSync(path.join(staged.publicDir, 'assets/images/pending.png')), false);
});

test('staging rejects tampered approved assets at load time', () => {
  cloneProject(workspace, 'synthetic-layered-demo', 'tampered-asset', (config) => {
    config.assets[0].sha256 = '2'.repeat(64);
  });
  assert.throws(
    () => loadProject('tampered-asset', {workspaceRoot: workspace, engineRoot: REPO_ROOT}),
    MediaError,
  );
});

test('staged public directory never lives in the engine repository', () => {
  const project = loadProject('synthetic-pixel-demo', {
    workspaceRoot: workspace,
    engineRoot: REPO_ROOT,
  });
  const staged = stageProjectMedia(project, {engineRoot: REPO_ROOT});
  assert.equal(isInside(REPO_ROOT, staged.publicDir), false);
  assert.equal(readFileSync(path.join(staged.publicDir, 'source/audio/tone-2s.wav')).length > 0, true);
});
