// Copies the synthetic example projects into MV_WORKSPACE_ROOT.
// Usage: MV_WORKSPACE_ROOT=C:\path\to\workspaces node factory/scripts/seed-workspace.mjs
// Requires: npm run factory:build (for the compiled workspace guard).

import {cpSync, existsSync, mkdirSync, readdirSync} from 'node:fs';
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
mkdirSync(rawRoot, {recursive: true});

const {getWorkspaceRoot} = require('../dist/src/workspace/guard.js');
const workspaceRoot = getWorkspaceRoot({explicitRoot: rawRoot, engineRoot: repoRoot});

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
  if (existsSync(target) && !force) {
    console.log(`skip ${projectId}: already exists (use --force to overwrite)`);
  } else {
    cpSync(source, target, {recursive: true, force: true});
    console.log(`seeded ${projectId} -> ${target}`);
  }
  for (const relative of PROJECT_DIRS) {
    mkdirSync(path.join(target, relative), {recursive: true});
  }
}

console.log(JSON.stringify({workspaceRoot, projects: projectIds}, null, 2));
