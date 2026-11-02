import {spawnSync} from 'node:child_process';
import {
  existsSync,
  lstatSync,
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
import {checkRenderBrowser} from '../src/remotion/browserReadiness';
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

// Include directory names and every file hash: a refusal must leave the fresh
// project byte-for-byte unchanged, without even creating an empty cache/report.
const projectSnapshot = (root: string): string[] =>
  readdirSync(root, {withFileTypes: true}).sort((a, b) => a.name.localeCompare(b.name)).flatMap((entry) => {
    const absolute = path.join(root, entry.name);
    return entry.isDirectory()
      ? [entry.name + '/', ...projectSnapshot(absolute).map((item) => entry.name + '/' + item)]
      : [entry.name + ':' + sha256File(absolute)];
  });

const renderWithMissingExecutable = (projectId: string, frame: number, requested: string) =>
  spawnSync(process.execPath, [
    path.join(REPO_ROOT, 'factory', 'scripts', 'render-project.mjs'),
    '--project', projectId, '--mode', 'still', '--frame', String(frame), '--out', requested,
  ], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      MV_WORKSPACE_ROOT: workspace,
      REMOTION_BROWSER_EXECUTABLE: path.join(workspace, 'nonexistent-browser.exe'),
      CHROME_PATH: '',
    },
    encoding: 'utf8',
    windowsHide: true,
    timeout: 60000,
  });

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
  const outside = mkdtempSync(path.join(tmpdir(), 'mvfoundry-cli-output-'));
  const before = projectSnapshot(project.projectDir);
  assert.equal(existsSync(path.join(project.projectDir, 'cache')), false);
  assert.equal(existsSync(path.join(project.projectDir, 'reports')), false);
  try {
    for (const requested of ['../escape.png', 'nested/escape.png', path.join(outside, 'escape.png')]) {
      const result = renderWithMissingExecutable('cli-output-test', 0, requested);
      assert.equal(result.error, undefined);
      assert.notEqual(result.status, 0);
      assert.match(`${result.stdout}\n${result.stderr}`, /single filename|direct child|outside|forbidden/i);
      assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /BROWSER_/);
      assert.deepEqual(projectSnapshot(project.projectDir), before);
    }
    assert.deepEqual(outputFiles(path.join(project.projectDir, 'renders')), []);
    assert.equal(existsSync(path.join(outside, 'escape.png')), false);
  } finally {
    rmSync(outside, {recursive: true, force: true});
  }
});

test('G02: invalid still bounds precede an unavailable browser without any writes', () => {
  cloneProject(workspace, 'synthetic-pixel-demo', 'cli-frame-test');
  const project = loadPixel('cli-frame-test');
  const before = projectSnapshot(project.projectDir);
  for (const frame of [-1, 0.5, project.durationInFrames]) {
    const result = renderWithMissingExecutable('cli-frame-test', frame, 'valid.png');
    assert.equal(result.error, undefined);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Still frame .* is outside/);
    assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /BROWSER_/);
    assert.deepEqual(projectSnapshot(project.projectDir), before);
  }
});

test('G02: valid destination with an invalid executable returns structured refusal without writes', () => {
  cloneProject(workspace, 'synthetic-pixel-demo', 'cli-browser-test');
  const project = loadPixel('cli-browser-test');
  const before = projectSnapshot(project.projectDir);
  const result = renderWithMissingExecutable('cli-browser-test', 0, 'valid.png');
  assert.equal(result.error, undefined);
  assert.equal(result.status, 3);
  const refusal = JSON.parse(result.stderr.slice(result.stderr.indexOf('{')));
  assert.equal(refusal.status, 'REFUSED');
  assert.equal(refusal.code, 'BROWSER_EXECUTABLE_INVALID');
  assert.equal(refusal.browser.provisioning, 'not-required');
  assert.deepEqual(projectSnapshot(project.projectDir), before);
});

test('G02: controlled browser-less readiness refuses before a download can start', async () => {
  let downloads = 0;
  const missing = await checkRenderBrowser({env: {}, ensureBrowser: async () => ({type: 'no-browser'})});
  assert.equal(missing.status, 'BROWSER_MISSING');
  const provisioning = await checkRenderBrowser({
    env: {},
    ensureBrowser: async ({onBrowserDownload}) => {
      onBrowserDownload();
      downloads++;
      return {type: 'no-browser'};
    },
  });
  assert.equal(provisioning.status, 'BROWSER_PROVISIONING_NOT_AUTHORIZED');
  assert.equal(provisioning.provisioning, 'refused');
  assert.equal(downloads, 0);
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
    // Some Windows configurations accept the call and create nothing, which
    // would make this test assert against a destination that never existed.
    if (!lstatSync(link).isSymbolicLink()) throw new Error('symlink was not created');
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
