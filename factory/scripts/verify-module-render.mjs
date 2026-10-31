// Verifies project-local scene modules with real Remotion bundles and still renders.
// Usage:
//   node factory/scripts/verify-module-render.mjs
// Requires MV_WORKSPACE_ROOT with the module examples seeded and factory/dist built.

import {createHash} from 'node:crypto';
import {readFileSync, writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : fallback;
};
const workspaceRoot = arg('workspace', process.env.MV_WORKSPACE_ROOT);
const projectIds = arg(
  'projects',
  'synthetic-module-pixel-demo,synthetic-module-layered-demo',
)
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

if (!workspaceRoot) {
  console.error('MV_WORKSPACE_ROOT or --workspace is required');
  process.exit(2);
}

const {loadProject} = require('../dist/src/project/loadProject.js');
const {stageProjectMedia} = require('../dist/src/media/stagePublic.js');
const {bundleProject} = require('../dist/src/remotion/bundleProject.js');
const {sha256File} = require('../dist/src/media/hash.js');
const {
  assertSafePath,
  createProjectWriteBoundary,
  ensureSafeDirectory,
  resolveRenderOutputPath,
} = require('../dist/src/workspace/writeBoundary.js');
const {resolveShotAtFrame, resolveShots} = require('../dist/src/timeline/resolver.js');

const pad = (frame) => String(frame).padStart(4, '0');
const hash = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
const pngSize = (file) => {
  const bytes = readFileSync(file);
  if (bytes.length < 24 || bytes.toString('ascii', 12, 16) !== 'IHDR') {
    throw new Error(`Not a PNG file: ${file}`);
  }
  return {width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), bytes: bytes.length};
};

const framesFor = (projectId) =>
  projectId.includes('pixel')
    ? [0, 1, 2, 3, 22, 23, 24, 25, 46, 47]
    : [0, 1, 19, 20, 21, 44];

const browserExecutable =
  process.env.REMOTION_BROWSER_EXECUTABLE ?? process.env.CHROME_PATH ?? null;

const {openBrowser, getCompositions, renderStill} = await import('@remotion/renderer');
const browser = await openBrowser('chrome', {browserExecutable, logLevel: 'warn'});
const summaries = [];

try {
  for (const projectId of projectIds) {
    const project = loadProject(projectId, {workspaceRoot, engineRoot: repoRoot});
    for (const module of project.sceneModules) {
      if (sha256File(module.absolutePath) !== module.sha256) {
        throw new Error(`Module changed after load: ${module.id}`);
      }
    }
    const audioHashBefore = sha256File(project.audioPath);
    const assetHashesBefore = project.assets.map((asset) =>
      asset.absolutePath ? sha256File(asset.absolutePath) : '',
    );

    const boundary = createProjectWriteBoundary(project, {engineRoot: repoRoot});
    const reportsDir = ensureSafeDirectory(
      boundary,
      path.join(boundary.projectRoot, 'reports'),
      'project',
    );
    const reportPath = assertSafePath(
      boundary,
      path.join(reportsDir, 'module-render-evidence.json'),
      {expect: 'file', subtree: 'project'},
    );
    const staged = stageProjectMedia(project, {engineRoot: repoRoot, boundary});
    const renderProject = {
      ...project.renderProject,
      publicAssets: staged.publicAssets,
      audioPublicPath: staged.audioPublicPath,
    };
    const prepared = await bundleProject(project, {
      engineRoot: repoRoot,
      boundary,
      stagedMedia: staged,
      onProgress: () => undefined,
    });
    const compositions = await getCompositions(prepared.serveUrl, {
      inputProps: {project: renderProject},
      puppeteerInstance: browser,
      browserExecutable,
      logLevel: 'warn',
    });
    const composition = compositions.find((item) => item.id === 'MV-Factory');
    if (!composition) throw new Error('MV-Factory composition is missing');
    if (
      composition.width !== project.config.output.width ||
      composition.height !== project.config.output.height ||
      composition.fps !== project.config.output.fps ||
      composition.durationInFrames !== project.durationInFrames
    ) {
      throw new Error(
        `Composition metadata mismatch: ${composition.width}x${composition.height}@${composition.fps} ${composition.durationInFrames}f`,
      );
    }

    const shots = resolveShots(
      renderProject.chapters.map((chapter) => ({
        id: chapter.id,
        title: chapter.title,
        startFrame: chapter.startFrame,
        endFrame: chapter.endFrame,
        shots: chapter.shots,
      })),
    );
    const frames = [];
    for (const frame of framesFor(projectId)) {
      const output = resolveRenderOutputPath(boundary, {
        mode: 'still',
        projectId,
        frame,
        requested: `evidence-${projectId}-frame-${pad(frame)}.png`,
      });
      await renderStill({
        composition,
        serveUrl: prepared.serveUrl,
        output,
        frame,
        imageFormat: 'png',
        overwrite: true,
        inputProps: {project: renderProject},
        puppeteerInstance: browser,
        browserExecutable,
        logLevel: 'warn',
      });
      const size = pngSize(output);
      if (
        size.width !== project.config.output.width ||
        size.height !== project.config.output.height
      ) {
        throw new Error(`PNG size mismatch at frame ${frame}: ${size.width}x${size.height}`);
      }
      const resolved = resolveShotAtFrame(shots, frame, project.durationInFrames);
      frames.push({
        frame,
        shotId: resolved.shot.id,
        renderer: resolved.shot.renderer,
        file: path.basename(output),
        width: size.width,
        height: size.height,
        bytes: size.bytes,
        sha256: hash(output),
      });
    }

    const byFrame = new Map(frames.map((entry) => [entry.frame, entry]));
    const checks = [];
    const check = (name, pass) => checks.push({name, pass: Boolean(pass)});
    check(
      'composition metadata matches the project',
      composition.width === project.config.output.width &&
        composition.height === project.config.output.height &&
        composition.fps === project.config.output.fps &&
        composition.durationInFrames === project.durationInFrames,
    );
    check(
      'all rendered frames belong to declared module renderers',
      frames.every((entry) => entry.renderer.startsWith('project:')),
    );

    const moduleIds = new Set(project.sceneModules.map((module) => module.id));
    check(
      'every referenced module is declared for this project',
      frames.every((entry) => moduleIds.has(entry.renderer.slice('project:'.length))),
    );

    if (projectId.includes('pixel')) {
      const holds = [
        [0, 1],
        [2, 3],
        [22, 23],
        [24, 25],
        [46, 47],
      ];
      check(
        '12fps sampling holds each drawing for two output frames',
        holds.every(([a, b]) => byFrame.get(a).sha256 === byFrame.get(b).sha256),
      );
      check(
        'animation advances between sampled ticks',
        byFrame.get(0).sha256 !== byFrame.get(2).sha256 &&
          byFrame.get(24).sha256 !== byFrame.get(46).sha256,
      );
      check(
        'the cut at frame 24 changes shot and module',
        byFrame.get(23).shotId === 'SHOT-01' &&
          byFrame.get(23).renderer === 'project:runner' &&
          byFrame.get(24).shotId === 'SHOT-02' &&
          byFrame.get(24).renderer === 'project:signal' &&
          byFrame.get(23).sha256 !== byFrame.get(24).sha256,
      );
    } else {
      check(
        '30fps sampling advances every output frame',
        byFrame.get(0).sha256 !== byFrame.get(1).sha256 &&
          byFrame.get(20).sha256 !== byFrame.get(21).sha256,
      );
      check(
        'the cut at frame 20 changes shot and module',
        byFrame.get(19).shotId === 'SHOT-01' &&
          byFrame.get(19).renderer === 'project:aurora' &&
          byFrame.get(20).shotId === 'SHOT-02' &&
          byFrame.get(20).renderer === 'project:ribbons' &&
          byFrame.get(19).sha256 !== byFrame.get(20).sha256,
      );
    }

    check('source audio is unchanged', sha256File(project.audioPath) === audioHashBefore);
    check(
      'approved source assets are unchanged',
      project.assets.every((asset, index) =>
        asset.absolutePath ? sha256File(asset.absolutePath) === assetHashesBefore[index] : true,
      ),
    );
    check(
      'bundle and generated entry stay in the project cache',
      prepared.entryPoint.startsWith(path.join(project.projectDir, 'cache')) &&
        prepared.bundleDir.startsWith(path.join(project.projectDir, 'cache')),
    );

    const summary = {
      projectId,
      composition: {
        width: composition.width,
        height: composition.height,
        fps: composition.fps,
        durationInFrames: composition.durationInFrames,
      },
      modules: project.sceneModules.map((module) => ({
        id: module.id,
        path: module.path,
        sha256: module.sha256,
        canvas: module.canvas,
        samplingFps: module.samplingFps,
      })),
      bundle: {
        entryPoint: path.relative(project.projectDir, prepared.entryPoint).split(path.sep).join('/'),
        bundleDir: path.relative(project.projectDir, prepared.bundleDir).split(path.sep).join('/'),
        stagedModules: prepared.modules.map((module) => ({
          id: module.id,
          stagedFile: `cache/engine-bundle/modules/${module.stagedFileName}`,
          sha256: module.sha256,
        })),
      },
      frames,
      checks,
      pass: checks.every((entry) => entry.pass),
      outputDirectory: path.join(project.projectDir, 'renders'),
    };
    writeFileSync(reportPath, JSON.stringify(summary, null, 2));
    summaries.push(summary);
    console.log(JSON.stringify(summary, null, 2));
    if (!summary.pass) {
      const failed = checks.filter((entry) => !entry.pass).map((entry) => entry.name);
      throw new Error(`${projectId} failed evidence checks: ${failed.join(', ')}`);
    }
  }
} finally {
  await browser.close({silent: true});
}

console.log(
  JSON.stringify(
    {
      pass: summaries.every((summary) => summary.pass),
      projects: summaries.map((summary) => summary.projectId),
      reports: summaries.map((summary) => `${summary.projectId}/reports/module-render-evidence.json`),
    },
    null,
    2,
  ),
);
