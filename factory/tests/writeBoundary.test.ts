import {spawnSync} from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {after, before, test} from 'node:test';
import assert from 'node:assert/strict';
import {loadProject} from '../src/project/loadProject';
import {stageProjectMedia} from '../src/media/stagePublic';
import {sha256File} from '../src/media/hash';
import {WriteBoundaryError} from '../src/errors';
import {
  assertSafePath,
  createProjectWriteBoundary,
  resolveRenderOutputPath,
  safeRecreateDirectory,
  type WriteBoundary,
} from '../src/workspace/writeBoundary';
import {REPO_ROOT, cloneProject, makeWorkspace} from './helpers';

let workspace: string;

before(() => {
  workspace = makeWorkspace();
});

after(() => {
  rmSync(workspace, {recursive: true, force: true});
});

const loadPixel = (id = 'synthetic-pixel-demo') =>
  loadProject(id, {workspaceRoot: workspace, engineRoot: REPO_ROOT});

const safeJunction = (target: string, link: string): boolean => {
  try {
    symlinkSync(target, link, 'junction');
    return true;
  } catch {
    return false;
  }
};

const outputFiles = (dir: string): string[] =>
  existsSync(dir) ? readdirSync(dir).filter((name) => /\.(mp4|png)$/i.test(name)) : [];

test('G02: project-local output overrides resolve under renders', () => {
  const project = loadPixel();
  const boundary = createProjectWriteBoundary(project, {engineRoot: REPO_ROOT});
  const relative = resolveRenderOutputPath(boundary, {
    mode: 'still',
    projectId: project.config.projectId,
    frame: 3,
    requested: 'still.png',
  });
  assert.equal(relative, path.join(boundary.rendersRoot, 'still.png'));

  const absolute = resolveRenderOutputPath(boundary, {
    mode: 'video',
    projectId: project.config.projectId,
    requested: path.join(boundary.rendersRoot, 'absolute.mp4'),
  });
  assert.equal(absolute, path.join(boundary.rendersRoot, 'absolute.mp4'));

  const fallback = resolveRenderOutputPath(boundary, {
    mode: 'video',
    projectId: project.config.projectId,
  });
  assert.equal(fallback, path.join(boundary.rendersRoot, `${project.config.projectId}-render.mp4`));
});

test('G02: output escapes are rejected without writing', () => {
  const project = loadPixel();
  const boundary = createProjectWriteBoundary(project, {engineRoot: REPO_ROOT});
  const outside = mkdtempSync(path.join(tmpdir(), 'mvfoundry-output-escape-'));
  const attempts = [
    '../escape.mp4',
    'nested/escape.mp4',
    path.join(outside, 'escape.mp4'),
    path.join(REPO_ROOT, 'escape.mp4'),
    project.audioPath,
  ];
  try {
    for (const requested of attempts) {
      assert.throws(
        () =>
          resolveRenderOutputPath(boundary, {
            mode: 'video',
            projectId: project.config.projectId,
            requested,
          }),
        WriteBoundaryError,
      );
    }
    assert.deepEqual(outputFiles(boundary.rendersRoot), []);
    assert.equal(existsSync(path.join(outside, 'escape.mp4')), false);
    assert.equal(sha256File(project.audioPath), project.config.audio.sha256);
  } finally {
    rmSync(outside, {recursive: true, force: true});
  }
});

test('G02: render CLI rejects unsafe --out before writing output', () => {
  cloneProject(workspace, 'synthetic-pixel-demo', 'cli-output-test');
  const project = loadPixel('cli-output-test');
  const script = path.join(REPO_ROOT, 'factory', 'scripts', 'render-project.mjs');
  const outside = mkdtempSync(path.join(tmpdir(), 'mvfoundry-cli-output-'));
  const env = {
    ...process.env,
    MV_WORKSPACE_ROOT: workspace,
    REMOTION_BROWSER_EXECUTABLE: '',
  };
  try {
    for (const requested of ['../escape.png', path.join(outside, 'escape.png')]) {
      const result = spawnSync(
        process.execPath,
        [script, '--project', 'cli-output-test', '--mode', 'still', '--frame', '0', '--out', requested],
        {cwd: REPO_ROOT, env, encoding: 'utf8', timeout: 60000},
      );
      assert.notEqual(result.status, 0);
      assert.match(`${result.stdout}\n${result.stderr}`, /single filename|direct child|outside|forbidden/i);
    }
    assert.deepEqual(outputFiles(path.join(project.projectDir, 'renders')), []);
    assert.equal(existsSync(path.join(outside, 'escape.png')), false);
  } finally {
    rmSync(outside, {recursive: true, force: true});
  }
});

test('G02: symlinked output destination is rejected', (t) => {
  const project = loadPixel();
  const boundary = createProjectWriteBoundary(project, {engineRoot: REPO_ROOT});
  mkdirSync(boundary.rendersRoot, {recursive: true});
  const outside = mkdtempSync(path.join(tmpdir(), 'mvfoundry-output-link-'));
  const sentinel = path.join(outside, 'sentinel.mp4');
  writeFileSync(sentinel, 'outside');
  const link = path.join(boundary.rendersRoot, 'linked.mp4');
  try {
    symlinkSync(sentinel, link, 'file');
  } catch {
    rmSync(outside, {recursive: true, force: true});
    t.skip('file symlink creation is unavailable on this host');
    return;
  }
  try {
    assert.throws(
      () =>
        resolveRenderOutputPath(boundary, {
          mode: 'video',
          projectId: project.config.projectId,
          requested: 'linked.mp4',
        }),
      WriteBoundaryError,
    );
    assert.equal(readFileSync(sentinel, 'utf8'), 'outside');
  } finally {
    rmSync(outside, {recursive: true, force: true});
  }
});

test('G03: staging keeps originals unchanged and stays in cache', () => {
  const project = loadProject('synthetic-layered-demo', {
    workspaceRoot: workspace,
    engineRoot: REPO_ROOT,
  });
  const beforeAssetHashes = project.assets.map((asset) =>
    asset.absolutePath ? sha256File(asset.absolutePath) : '',
  );
  const staged = stageProjectMedia(project, {engineRoot: REPO_ROOT});
  assert.ok(staged.publicDir.startsWith(path.join(project.projectDir, 'cache')));
  assert.equal(staged.publicAssets['BG-01'], 'assets/images/bg.png');
  for (const [index, asset] of project.assets.entries()) {
    if (asset.absolutePath) assert.equal(sha256File(asset.absolutePath), beforeAssetHashes[index]);
  }
  assert.equal(sha256File(project.audioPath), project.config.audio.sha256);
});

test('G03: staging refuses a cache link instead of deleting its target', (t) => {
  const project = loadPixel();
  const boundary = createProjectWriteBoundary(project, {engineRoot: REPO_ROOT});
  const publicDir = path.join(boundary.cacheRoot, 'render-public');
  mkdirSync(boundary.cacheRoot, {recursive: true});
  rmSync(publicDir, {recursive: true, force: true});
  const outside = mkdtempSync(path.join(tmpdir(), 'mvfoundry-stage-link-'));
  const sentinel = path.join(outside, 'sentinel.txt');
  writeFileSync(sentinel, 'keep');
  if (!safeJunction(outside, publicDir)) {
    rmSync(outside, {recursive: true, force: true});
    t.skip('junction creation is unavailable on this host');
    return;
  }
  try {
    assert.throws(() => stageProjectMedia(project, {engineRoot: REPO_ROOT}), WriteBoundaryError);
    assert.equal(readFileSync(sentinel, 'utf8'), 'keep');
  } finally {
    rmSync(outside, {recursive: true, force: true});
  }
});

test('G04: cache cleanup cannot escape or delete protected roots', () => {
  const project = loadPixel();
  const boundary = createProjectWriteBoundary(project, {engineRoot: REPO_ROOT});
  const scratch = path.join(boundary.cacheRoot, 'scratch-test');
  mkdirSync(scratch, {recursive: true});
  writeFileSync(path.join(scratch, 'old.txt'), 'old');
  safeRecreateDirectory(boundary, scratch);
  assert.equal(existsSync(path.join(scratch, 'old.txt')), false);

  assert.throws(() => safeRecreateDirectory(boundary, boundary.projectRoot), WriteBoundaryError);
  assert.throws(() => safeRecreateDirectory(boundary, boundary.cacheRoot), WriteBoundaryError);
  assert.throws(
    () => safeRecreateDirectory(boundary, path.join(boundary.projectRoot, 'source', 'audio')),
    WriteBoundaryError,
  );
  assert.equal(sha256File(project.audioPath), project.config.audio.sha256);
});

test('G04: cache junction cleanup is rejected and target survives', (t) => {
  const project = loadPixel();
  const boundary = createProjectWriteBoundary(project, {engineRoot: REPO_ROOT});
  const outside = mkdtempSync(path.join(tmpdir(), 'mvfoundry-cleanup-link-'));
  const sentinel = path.join(outside, 'sentinel.txt');
  writeFileSync(sentinel, 'keep');
  const linked = path.join(boundary.cacheRoot, 'linked-cache');
  if (!safeJunction(outside, linked)) {
    rmSync(outside, {recursive: true, force: true});
    t.skip('junction creation is unavailable on this host');
    return;
  }
  try {
    assert.throws(() => safeRecreateDirectory(boundary, linked), WriteBoundaryError);
    assert.equal(readFileSync(sentinel, 'utf8'), 'keep');
  } finally {
    rmSync(outside, {recursive: true, force: true});
  }
});

test('G09: workspace seeding refuses an engine-inside root before creating it', () => {
  const unsafe = path.join(REPO_ROOT, 'factory', 'unsafe-seed-workspace');
  rmSync(unsafe, {recursive: true, force: true});
  const script = path.join(REPO_ROOT, 'factory', 'scripts', 'seed-workspace.mjs');
  const result = spawnSync(process.execPath, [script, '--root', unsafe], {
    cwd: REPO_ROOT,
    env: {...process.env, MV_WORKSPACE_ROOT: ''},
    encoding: 'utf8',
    timeout: 60000,
  });
  assert.notEqual(result.status, 0);
  assert.equal(existsSync(unsafe), false);
});

test('G07: another project and engine paths cannot be used as output roots', () => {
  const pixel = loadPixel();
  const layered = loadProject('synthetic-layered-demo', {
    workspaceRoot: workspace,
    engineRoot: REPO_ROOT,
  });
  const boundaryA = createProjectWriteBoundary(pixel, {engineRoot: REPO_ROOT});
  const boundaryB = createProjectWriteBoundary(layered, {engineRoot: REPO_ROOT});
  assert.throws(
    () =>
      resolveRenderOutputPath(boundaryA, {
        mode: 'video',
        projectId: pixel.config.projectId,
        requested: path.join(boundaryB.rendersRoot, 'other.mp4'),
      }),
    WriteBoundaryError,
  );
  assert.throws(
    () =>
      assertSafePath(boundaryA, path.join(REPO_ROOT, 'unsafe.mp4'), {
        expect: 'file',
        subtree: 'renders',
      }),
    WriteBoundaryError,
  );
  assert.equal(existsSync(path.join(boundaryB.rendersRoot, 'other.mp4')), false);
});
