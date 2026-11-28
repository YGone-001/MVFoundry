// Repeatable local render benchmark.
//
// Measures wall-clock time for a short, fixed frame range through the same
// render-project.mjs path used by production. It is a diagnostic baseline, not
// an acceptance gate and not a claim about another host.
//
// Usage:
//   node factory/scripts/benchmark-render.mjs --workspace <root> --project <id> \
//     [--frames 0-47] [--mode video] [--out perf.mp4]
// Requires: npm run build and an available Remotion browser.

import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : fallback;
};

const workspace = arg('workspace', process.env.MV_WORKSPACE_ROOT);
const projectId = arg('project');
const frames = arg('frames', '0-47');
const mode = arg('mode', 'video');
const out = arg('out', `perf-${Date.now()}.mp4`);
const frame = arg('frame', '24');

if (!workspace || !projectId) {
  console.error('--workspace and --project are required');
  process.exit(2);
}
if (!['video', 'still'].includes(mode)) {
  console.error('--mode must be video or still');
  process.exit(2);
}

const parseFrameCount = (value) => {
  const match = /^(\d+)-(\d+)$/.exec(value);
  if (!match) return null;
  const start = Number(match[1]);
  const end = Number(match[2]);
  if (!Number.isInteger(start) || !Number.isInteger(end) || end < start) return null;
  return end - start + 1;
};
const frameCount = mode === 'still' ? 1 : parseFrameCount(frames);
if (mode === 'video' && frameCount === null) {
  console.error('--frames must be an inclusive range such as 0-47');
  process.exit(2);
}

const started = process.hrtime.bigint();
const result = spawnSync(
  process.execPath,
  [
    path.join(repoRoot, 'factory', 'scripts', 'render-project.mjs'),
    '--project',
    projectId,
    '--workspace',
    workspace,
    '--mode',
    mode,
    ...(mode === 'video' ? ['--frames', frames] : ['--frame', frame]),
    '--out',
    out,
  ],
  {cwd: repoRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, windowsHide: true},
);
const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;

if (result.status !== 0) {
  console.error(result.stderr || result.stdout);
  process.exit(result.status ?? 1);
}

console.log(JSON.stringify({
  status: 'benchmarked',
  projectId,
  workspace,
  mode,
  frames: frameCount,
  elapsedMs: Number(elapsedMs.toFixed(1)),
  msPerFrame: Number((elapsedMs / frameCount).toFixed(2)),
  wallFps: Number(((frameCount * 1000) / elapsedMs).toFixed(2)),
  output: out,
  note: 'Wall-clock includes browser/render startup; compare like-for-like runs on the same host and range.',
}, null, 2));