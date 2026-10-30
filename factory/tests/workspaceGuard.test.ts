import {existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {after, before, test} from 'node:test';
import assert from 'node:assert/strict';
import {
  getWorkspaceRoot,
  resolveProjectDir,
  resolveProjectRelativePath,
} from '../src/workspace/guard';
import {loadProject} from '../src/project/loadProject';
import {REPO_ROOT, makeWorkspace} from './helpers';

let workspace: string;

before(() => {
  workspace = makeWorkspace();
});

after(() => {
  rmSync(workspace, {recursive: true, force: true});
});

const safeJunction = (target: string, link: string): boolean => {
  try {
    symlinkSync(target, link, 'junction');
    return true;
  } catch {
    return false;
  }
};

test('missing workspace configuration never falls back to the repository', () => {
  const previous = process.env.MV_WORKSPACE_ROOT;
  delete process.env.MV_WORKSPACE_ROOT;
  try {
    assert.throws(() => getWorkspaceRoot({engineRoot: REPO_ROOT}), /MV_WORKSPACE_ROOT/);
  } finally {
    if (previous === undefined) delete process.env.MV_WORKSPACE_ROOT;
    else process.env.MV_WORKSPACE_ROOT = previous;
  }
});

test('workspace roots inside or containing the engine repository are rejected', () => {
  assert.throws(
    () => getWorkspaceRoot({explicitRoot: REPO_ROOT, engineRoot: REPO_ROOT}),
    /outside the engine repository/,
  );
  assert.throws(
    () => getWorkspaceRoot({explicitRoot: path.join(REPO_ROOT, 'factory'), engineRoot: REPO_ROOT}),
    /outside the engine repository/,
  );
  assert.equal(getWorkspaceRoot({explicitRoot: workspace, engineRoot: REPO_ROOT}), workspace);
});

test('project ids reject traversal and missing configuration', () => {
  assert.throws(
    () => resolveProjectDir({workspaceRoot: workspace, projectId: '../escape', engineRoot: REPO_ROOT}),
    /Invalid project id/,
  );
  assert.throws(
    () => resolveProjectDir({workspaceRoot: workspace, projectId: 'missing-project', engineRoot: REPO_ROOT}),
    /does not exist/,
  );

  const empty = path.join(workspace, 'empty-project');
  mkdirSync(empty);
  assert.throws(
    () => resolveProjectDir({workspaceRoot: workspace, projectId: 'empty-project', engineRoot: REPO_ROOT}),
    /Missing project.json/,
  );
});

test('junctions cannot escape the workspace or point into the repository', (t) => {
  const repoLink = path.join(workspace, 'escape-repo');
  if (!safeJunction(REPO_ROOT, repoLink)) {
    t.skip('junction creation is unavailable on this host');
    return;
  }
  assert.throws(
    () => resolveProjectDir({workspaceRoot: workspace, projectId: 'escape-repo', engineRoot: REPO_ROOT}),
    /escapes the workspace root|inside the engine repository/,
  );

  const outside = mkdtempSync(path.join(tmpdir(), 'mv-factory-outside-'));
  mkdirSync(path.join(outside, 'project'));
  writeFileSync(path.join(outside, 'project', 'project.json'), '{}');
  const outsideLink = path.join(workspace, 'escape-outside');
  if (!safeJunction(outside, outsideLink)) {
    rmSync(outside, {recursive: true, force: true});
    t.skip('junction creation is unavailable on this host');
    return;
  }
  try {
    assert.throws(
      () => resolveProjectDir({workspaceRoot: workspace, projectId: 'escape-outside', engineRoot: REPO_ROOT}),
      /escapes the workspace root/,
    );
  } finally {
    rmSync(outside, {recursive: true, force: true});
  }
});

test('manifest paths reject absolute paths, traversal and link escapes', () => {
  const project = loadProject('synthetic-pixel-demo', {
    workspaceRoot: workspace,
    engineRoot: REPO_ROOT,
  });

  assert.throws(
    () => resolveProjectRelativePath(project.projectDir, '../project.json'),
    /Parent traversal/,
  );
  assert.throws(
    () => resolveProjectRelativePath(project.projectDir, path.resolve(project.projectDir, 'project.json')),
    /Absolute paths/,
  );
  assert.equal(
    resolveProjectRelativePath(project.projectDir, 'project.json'),
    path.join(project.projectDir, 'project.json'),
  );

  const linkTarget = mkdtempSync(path.join(tmpdir(), 'mv-factory-link-target-'));
  writeFileSync(path.join(linkTarget, 'escape.txt'), 'outside');
  const link = path.join(project.projectDir, 'outside-link');
  if (!safeJunction(linkTarget, link)) {
    rmSync(linkTarget, {recursive: true, force: true});
    return;
  }
  try {
    assert.throws(
      () => resolveProjectRelativePath(project.projectDir, 'outside-link/escape.txt'),
      /escapes the project root/,
    );
    assert.equal(existsSync(link), true);
  } finally {
    rmSync(linkTarget, {recursive: true, force: true});
  }
});
