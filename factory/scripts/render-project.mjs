// Renders a local factory project from MV_WORKSPACE_ROOT.
// Usage:
//   node factory/scripts/render-project.mjs --project synthetic-pixel-demo --mode video --frames 0-23
//   node factory/scripts/render-project.mjs --project synthetic-layered-demo --mode still --frame 10
// Requires: npm run factory:build.

import {execFileSync} from 'node:child_process';
import {
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
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
const projectId = arg('project');
const workspaceRoot = arg('workspace', process.env.MV_WORKSPACE_ROOT);
const mode = arg('mode', 'video');
const stillFrame = Number(arg('frame', '0'));
const frameRange = arg('frames', '0-23');
const projectOut = arg('out');
const concurrency = Number(arg('concurrency', '1'));

if (!projectId) {
  console.error('--project is required');
  process.exit(2);
}
if (!workspaceRoot) {
  console.error('MV_WORKSPACE_ROOT or --workspace is required');
  process.exit(2);
}
if (!['video', 'still'].includes(mode)) {
  console.error('--mode must be video or still');
  process.exit(2);
}

const {loadProject} = require('../dist/src/project/loadProject.js');
const {stageProjectMedia} = require('../dist/src/media/stagePublic.js');

const project = loadProject(projectId, {workspaceRoot, engineRoot: repoRoot});
const staged = stageProjectMedia(project, {engineRoot: repoRoot});
const renderProject = {
  ...project.renderProject,
  publicAssets: staged.publicAssets,
  audioPublicPath: staged.audioPublicPath,
};

const tmpDir = path.join(project.projectDir, 'cache', 'tmp');
mkdirSync(tmpDir, {recursive: true});
process.env.TMP = tmpDir;
process.env.TEMP = tmpDir;
process.env.TMPDIR = tmpDir;

const {bundle} = await import('@remotion/bundler');
const {getCompositions, openBrowser, renderFrames, renderStill} = await import(
  '@remotion/renderer'
);

// Browser selection is configuration-driven. When unset, Remotion manages its
// own headless shell.
const browserExecutable =
  process.env.REMOTION_BROWSER_EXECUTABLE ?? process.env.CHROME_PATH ?? null;

const rendersDir = path.join(project.projectDir, 'renders');
const reportsDir = path.join(project.projectDir, 'reports');
mkdirSync(rendersDir, {recursive: true});
mkdirSync(reportsDir, {recursive: true});

const output =
  projectOut ??
  (mode === 'still'
    ? path.join(rendersDir, `${projectId}-still-${String(stillFrame).padStart(4, '0')}.png`)
    : path.join(rendersDir, `${projectId}-render.mp4`));

const serveUrl = await bundle({
  entryPoint: path.join(repoRoot, 'factory', 'src', 'entry.tsx'),
  publicDir: staged.publicDir,
  onProgress: () => undefined,
  enableCaching: false,
});

const browser = await openBrowser('chrome', {browserExecutable, logLevel: 'warn'});
let reportFrames = null;
try {
  const compositions = await getCompositions(serveUrl, {
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

  if (mode === 'still') {
    if (!Number.isInteger(stillFrame) || stillFrame < 0 || stillFrame >= project.durationInFrames) {
      throw new Error(`Still frame ${stillFrame} is outside [0, ${project.durationInFrames})`);
    }
    await renderStill({
      composition,
      serveUrl,
      output,
      frame: stillFrame,
      imageFormat: 'png',
      overwrite: true,
      inputProps: {project: renderProject},
      puppeteerInstance: browser,
      browserExecutable,
      logLevel: 'warn',
    });
  } else {
    const [startText, endText] = frameRange.split('-');
    const start = Number(startText);
    const end = Number(endText ?? startText);
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end >= project.durationInFrames) {
      throw new Error(`Invalid frame range ${frameRange} for ${project.durationInFrames} frames`);
    }

    const frameDir = path.join(project.projectDir, 'cache', 'frames', `${projectId}-${start}-${end}`);
    const sequenceDir = path.join(project.projectDir, 'cache', 'sequence', `${projectId}-${start}-${end}`);
    rmSync(frameDir, {recursive: true, force: true});
    rmSync(sequenceDir, {recursive: true, force: true});
    mkdirSync(frameDir, {recursive: true});
    mkdirSync(sequenceDir, {recursive: true});

    const frameResult = await renderFrames({
      composition,
      serveUrl,
      outputDir: frameDir,
      inputProps: {project: renderProject},
      imageFormat: 'png',
      frameRange: [start, end],
      puppeteerInstance: browser,
      browserExecutable,
      concurrency,
      logLevel: 'warn',
      onStart: (data) => console.log(`renderFrames: ${data.frameCount} frames, concurrency ${data.resolvedConcurrency}`),
      onFrameUpdate: (rendered, frameIndex) => {
        if (rendered === 1 || (rendered % 12 === 0) || rendered === end - start + 1) {
          console.log(`frame ${frameIndex} (${rendered}/${end - start + 1})`);
        }
      },
    });

    const rendered = readdirSync(frameDir)
      .filter((name) => name.endsWith('.png'))
      .sort((a, b) => Number(a.match(/(\d+)\.png$/)?.[1] ?? 0) - Number(b.match(/(\d+)\.png$/)?.[1] ?? 0));
    if (rendered.length !== frameResult.frameCount || rendered.length !== end - start + 1) {
      throw new Error(
        `Rendered frame count mismatch: ${rendered.length}, expected ${end - start + 1}`,
      );
    }
    rendered.forEach((name, index) => {
      renameSync(path.join(frameDir, name), path.join(sequenceDir, `frame-${String(index).padStart(3, '0')}.png`));
    });

    const audioFile = staged.audioPublicPath
      ? path.join(staged.publicDir, staged.audioPublicPath)
      : null;
    const ffmpegArgs = [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-framerate',
      String(project.config.output.fps),
      '-start_number',
      '0',
      '-i',
      path.join(sequenceDir, 'frame-%03d.png'),
    ];
    if (audioFile) ffmpegArgs.push('-i', audioFile);
    ffmpegArgs.push(
      '-c:v',
      'libx264',
      '-preset',
      'medium',
      '-crf',
      '18',
      '-pix_fmt',
      project.config.render.pixelFormat,
      '-colorspace',
      project.config.render.colorSpace,
      '-color_primaries',
      project.config.render.colorSpace,
      '-color_trc',
      project.config.render.colorSpace,
      '-x264-params',
      'colorprim=bt709:transfer=bt709:colormatrix=bt709',
      '-r',
      String(project.config.output.fps),
    );
    if (audioFile) ffmpegArgs.push('-af', 'apad', '-c:a', 'aac', '-b:a', '192k', '-shortest');
    ffmpegArgs.push('-movflags', '+faststart', output);
    execFileSync('ffmpeg', ffmpegArgs, {stdio: 'inherit'});

    reportFrames = {frameDir, sequenceDir, rendered: rendered.length, audioFile};
  }

  const report = {
    projectId,
    workspaceRoot: project.workspaceRoot,
    projectDir: project.projectDir,
    publicDir: staged.publicDir,
    publicAssets: staged.publicAssets,
    audioPublicPath: staged.audioPublicPath,
    composition: {
      id: composition.id,
      width: composition.width,
      height: composition.height,
      fps: composition.fps,
      durationInFrames: composition.durationInFrames,
    },
    mode,
    frameRange: mode === 'still' ? [stillFrame, stillFrame] : frameRange,
    output,
    bytes: statSync(output).size,
    frames: reportFrames,
    encoder: mode === 'video' ? 'system-ffmpeg' : 'remotion-render-still',
    networkActions: ['none; local bundle and local files only'],
  };
  writeFileSync(
    path.join(reportsDir, `render-${projectId}-${mode}.json`),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close({silent: true});
}
