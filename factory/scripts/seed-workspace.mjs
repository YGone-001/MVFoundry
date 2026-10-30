// Copies the synthetic example projects into MV_WORKSPACE_ROOT.
// Usage: MV_WORKSPACE_ROOT=C:\path\to\workspaces node factory/scripts/seed-workspace.mjs
// Requires: npm run build (for the compiled workspace guard).

import {cpSync, existsSync, lstatSync, mkdirSync, readdirSync, realpathSync} from 'node:fs';
import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const examples = path.resolve(here, '..', 'examples', 'projects');
const args = process.argv.slice(2);
const rootArg = args.includes('--root') ? args[args.indexOf('--root') + 1] : undefined;
const force = args.includes('--force');

const rawRoot = rootArg ?? process.env.MV_WORKSPACE_ROOT;
if (!rawRoot) {
  console.error('MV_WORKSPACE_ROOT (or --root) is required');
  process.exit(2);
}

const {DEFAULT_ENGINE_ROOT, getWorkspaceRoot, isInside} = require('../dist/src/workspace/guard.js');
const engineRoot = realpathSync(repoRoot);

// Validate the nearest existing ancestor before creating the workspace root.
let existingAncestor = path.resolve(rawRoot);
while (!existsSync(existingAncestor)) {
  const parent = path.dirname(existingAncestor);
  if (parent === existingAncestor) break;
  existingAncestor = parent;
}
const ancestorReal = realpathSync(existingAncestor);
if (isInside(engineRoot, ancestorReal) || isInside(ancestorReal, engineRoot)) {
  throw new Error('Workspace root must be outside and must not contain the engine repository');
}
mkdirSync(rawRoot, {recursive: true});

const workspaceRoot = getWorkspaceRoot({explicitRoot: rawRoot, engineRoot: DEFAULT_ENGINE_ROOT});

const rejectLinks = (directory) => {
  for (const entry of readdirSync(directory, {withFileTypes: true})) {
    const child = path.join(directory, entry.name);
    const stat = lstatSync(child);
    if (stat.isSymbolicLink()) {
      throw new Error(`Linked entry is not allowed during seeding: ${child}`);
    }
    const real = realpathSync(child);
    if (!isInside(workspaceRoot, real)) {
      throw new Error(`Seed target escapes the workspace: ${child}`);
    }
    if (stat.isDirectory()) rejectLinks(child);
  }
};

const assertTarget = (target) => {
  if (!isInside(workspaceRoot, path.resolve(target))) {
    throw new Error(`Seed target escapes the workspace: ${target}`);
  }
  if (!existsSync(target)) return;
  const stat = lstatSync(target);
  if (stat.isSymbolicLink()) throw new Error(`Seed target is a link: ${target}`);
  const real = realpathSync(target);
  if (!isInside(workspaceRoot, real)) throw new Error(`Seed target escapes the workspace: ${target}`);
  rejectLinks(target);
};

const projectIds = readdirSync(examples, {withFileTypes: true})
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

const PROJECT_DIRS = [
  'source/audio',
  'source/lyrics',
  'source/rights',
  'analysis',
  'writing',
  'visual',
  'assets/images',
  'assets/video',
  'assets/layers',
  'scenes',
  'cache',
  'renders',
  'reports',
];

for (const projectId of projectIds) {
  const source = path.join(examples, projectId);
  const target = path.join(workspaceRoot, projectId);
  assertTarget(target);
  if (existsSync(target) && !force) {
    console.log(`skip ${projectId}: already exists (use --force to overwrite)`);
  } else {
    cpSync(source, target, {recursive: true, force: true});
    console.log(`seeded ${projectId} -> ${target}`);
  }
  for (const relative of PROJECT_DIRS) {
    mkdirSync(path.join(target, relative), {recursive: true});
  }
  assertTarget(target);
}

console.log(JSON.stringify({workspaceRoot, projects: projectIds}, null, 2));
