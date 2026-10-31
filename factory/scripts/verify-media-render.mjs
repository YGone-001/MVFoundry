// Verifies the Video and Hybrid renderers with real Remotion bundles, stills,
// full synthetic videos and FFprobe/FFmpeg inspection.
//
// Usage:
//   node factory/scripts/verify-media-render.mjs --workspace <external-workspace>
// Requires FFmpeg/FFprobe on PATH and factory/dist built.

import {execFileSync, spawnSync} from 'node:child_process';
import {existsSync, readFileSync, statSync, writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
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
const projectIds = arg('projects', 'synthetic-video-demo,synthetic-hybrid-demo')
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
const {probeLayerPng} = require('../dist/src/media/pngProbe.js');
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

const PALETTE = {
  red: [255, 0, 0],
  green: [0, 255, 0],
  blue: [0, 0, 255],
  yellow: [255, 255, 0],
  magenta: [255, 0, 255],
  cyan: [0, 255, 255],
};

const rawFrame = (file) =>
  execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], {
    encoding: null,
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
  });

const averageRegion = (file, width, x, y, regionWidth, regionHeight) => {
  const bytes = rawFrame(file);
  const sums = [0, 0, 0];
  let count = 0;
  for (let row = 0; row < regionHeight; row++) {
    for (let column = 0; column < regionWidth; column++) {
      const index = ((y + row) * width + (x + column)) * 3;
      sums[0] += bytes[index];
      sums[1] += bytes[index + 1];
      sums[2] += bytes[index + 2];
      count++;
    }
  }
  return sums.map((sum) => Math.round(sum / count));
};

const nearestPalette = (rgb) => {
  let best = null;
  for (const [name, color] of Object.entries(PALETTE)) {
    const distance = Math.sqrt(
      (rgb[0] - color[0]) ** 2 + (rgb[1] - color[1]) ** 2 + (rgb[2] - color[2]) ** 2,
    );
    if (!best || distance < best.distance) best = {name, distance};
  }
  return best;
};

const ffprobeJson = (file) => {
  const raw = execFileSync(
    'ffprobe',
    ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', file],
    {encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, windowsHide: true},
  );
  return JSON.parse(raw);
};

const bandVolumeDb = (file, frequency) => {
  const result = spawnSync(
    'ffmpeg',
    [
      '-hide_banner',
      '-nostats',
      '-i',
      file,
      '-vn',
      '-af',
      `bandpass=f=${frequency}:width_type=h:w=20,volumedetect`,
      '-f',
      'null',
      '-',
    ],
    {encoding: 'utf8', windowsHide: true},
  );
  if (result.status !== 0) {
    throw new Error(`Unable to analyze audio band ${frequency}Hz: ${result.stderr}`);
  }
  const match = result.stderr.match(/mean_volume:\s*(-?[\d.]+) dB/);
  if (!match) throw new Error(`No mean_volume reported for ${frequency}Hz`);
  return Number(match[1]);
};

const stillFrames = (projectId) =>
  projectId.includes('hybrid') ? [0, 1, 10, 19, 20, 21, 44] : [0, 12, 23, 24, 25, 47];

const expectedVideoColors = (projectId) =>
  projectId.includes('hybrid')
    ? {0: 'green', 10: 'blue', 20: 'yellow', 44: 'magenta'}
    : {0: 'green', 12: 'blue', 23: 'yellow', 24: 'magenta', 25: 'magenta', 47: 'cyan'};

const browserExecutable =
  process.env.REMOTION_BROWSER_EXECUTABLE ?? process.env.CHROME_PATH ?? null;
const {openBrowser, getCompositions, renderStill} = await import('@remotion/renderer');
const browser = await openBrowser('chrome', {browserExecutable, logLevel: 'warn'});
const summaries = [];

try {
  for (const projectId of projectIds) {
    const project = loadProject(projectId, {workspaceRoot, engineRoot: repoRoot});
    const videoAssets = project.assets.filter((asset) => asset.videoMetadata);
    const layerAssets = project.assets.filter((asset) => asset.kind === 'layer' && asset.absolutePath);
    if (videoAssets.length === 0) throw new Error(`${projectId} has no probed video asset`);

    const boundary = createProjectWriteBoundary(project, {engineRoot: repoRoot});
    const reportsDir = ensureSafeDirectory(
      boundary,
      path.join(boundary.projectRoot, 'reports'),
      'project',
    );
    const reportPath = assertSafePath(
      boundary,
      path.join(reportsDir, 'media-render-evidence.json'),
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
    for (const frame of stillFrames(projectId)) {
      const output = resolveRenderOutputPath(boundary, {
        mode: 'still',
        projectId,
        frame,
        requested: `media-evidence-${projectId}-frame-${pad(frame)}.png`,
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
      if (size.width !== project.config.output.width || size.height !== project.config.output.height) {
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
    check('composition metadata matches the project', true);
    check(
      'all still frames use the declared media renderer',
      frames.every((entry) => entry.renderer === (projectId.includes('hybrid') ? 'hybrid' : 'video')),
    );
    check(
      'still PNG dimensions match the output profile',
      frames.every(
        (entry) =>
          entry.width === project.config.output.width &&
          entry.height === project.config.output.height,
      ),
    );

    const expectedColors = expectedVideoColors(projectId);
    const sampledColors = {};
    for (const [frameText, expected] of Object.entries(expectedColors)) {
      const frame = Number(frameText);
      const entry = byFrame.get(frame);
      if (!entry) throw new Error(`Missing still for color sample at frame ${frame}`);
      const rgb =
        projectId.includes('hybrid')
          ? averageRegion(
              path.join(project.projectDir, 'renders', entry.file),
              entry.width,
              20,
              20,
              60,
              40,
            )
          : averageRegion(
              path.join(project.projectDir, 'renders', entry.file),
              entry.width,
              100,
              100,
              40,
              40,
            );
      const nearest = nearestPalette(rgb);
      sampledColors[frame] = {rgb, nearest};
      check(
        `frame ${frame} decodes the expected source color ${expected}`,
        nearest.name === expected && nearest.distance <= 120,
      );
    }

    if (projectId.includes('hybrid')) {
      check(
        'hybrid cut at frame 20 changes the video background',
        byFrame.get(19).sha256 !== byFrame.get(20).sha256 &&
          sampledColors[20].nearest.name === 'yellow',
      );
      check(
        'hybrid canvas overlay animates between frames',
        byFrame.get(0).sha256 !== byFrame.get(1).sha256,
      );
      const ringRgb = averageRegion(
        path.join(project.projectDir, 'renders', byFrame.get(0).file),
        byFrame.get(0).width,
        530,
        626,
        20,
        20,
      );
      check(
        'transparent PNG ring is visibly composited',
        ringRgb[0] > 140 && ringRgb[1] > 80 && ringRgb[2] < 160,
      );
      check('layer asset is a transparent PNG', layerAssets.length > 0 && layerAssets.every((asset) => {
        const metadata = probeLayerPng(asset.absolutePath, asset.id);
        return metadata.hasAlpha;
      }));
    } else {
      check(
        'video cut at frame 24 changes the decoded source segment',
        byFrame.get(23).sha256 !== byFrame.get(24).sha256 &&
          sampledColors[23].nearest.name === 'yellow' &&
          sampledColors[24].nearest.name === 'magenta',
      );
      check(
        'shot-local source motion changes frame data',
        byFrame.get(0).sha256 !== byFrame.get(12).sha256 &&
          byFrame.get(25).sha256 !== byFrame.get(47).sha256,
      );
    }

    const sourceVideoHashes = videoAssets.map((asset) => ({
      id: asset.id,
      sha256: sha256File(asset.absolutePath),
    }));
    const sourceLayerHashes = layerAssets.map((asset) => ({
      id: asset.id,
      sha256: sha256File(asset.absolutePath),
    }));
    check(
      'source video hashes remain unchanged',
      sourceVideoHashes.every((entry, index) => entry.sha256 === videoAssets[index].sha256),
    );

    const summary = {
      projectId,
      composition: {
        width: composition.width,
        height: composition.height,
        fps: composition.fps,
        durationInFrames: composition.durationInFrames,
      },
      mediaAssets: videoAssets.map((asset) => ({
        id: asset.id,
        metadata: asset.videoMetadata,
        sha256: asset.sha256,
      })),
      layerAssets: layerAssets.map((asset) => ({
        id: asset.id,
        sha256: asset.sha256,
        png: probeLayerPng(asset.absolutePath, asset.id),
      })),
      bundle: {
        entryPoint: path.relative(project.projectDir, prepared.entryPoint).split(path.sep).join('/'),
        bundleDir: path.relative(project.projectDir, prepared.bundleDir).split(path.sep).join('/'),
      },
      frames,
      sampledColors,
      checks,
      sourceVideoHashes,
      sourceLayerHashes,
      pass: false,
      outputDirectory: path.join(project.projectDir, 'renders'),
    };
    summaries.push({project, boundary, summary, reportPath});
  }
} finally {
  await browser.close({silent: true});
}

for (const record of summaries) {
  const {project, boundary, summary} = record;
  const renderScript = path.join(repoRoot, 'factory', 'scripts', 'render-project.mjs');
  const videoOutput = resolveRenderOutputPath(boundary, {
    mode: 'video',
    projectId: project.config.projectId,
  });
  execFileSync(
    process.execPath,
    [
      renderScript,
      '--project',
      project.config.projectId,
      '--mode',
      'video',
      '--frames',
      `0-${project.durationInFrames - 1}`,
      '--workspace',
      workspaceRoot,
    ],
    {cwd: repoRoot, env: process.env, stdio: 'inherit', windowsHide: true},
  );
  if (!existsSync(videoOutput)) throw new Error(`Video output missing: ${videoOutput}`);
  const probe = ffprobeJson(videoOutput);
  const videoStream = (probe.streams || []).find((stream) => stream.codec_type === 'video');
  const audioStreams = (probe.streams || []).filter((stream) => stream.codec_type === 'audio');
  if (!videoStream) throw new Error(`No video stream in ${videoOutput}`);
  if (audioStreams.length !== 1) {
    throw new Error(`Expected exactly one soundtrack stream in ${videoOutput}`);
  }
  const soundtrackFreq = project.config.projectId.includes('hybrid') ? 330 : 440;
  const sourceBandDb = bandVolumeDb(videoOutput, 950);
  const soundtrackBandDb = bandVolumeDb(videoOutput, soundtrackFreq);
  const frameCount = Number(videoStream.nb_frames);
  summary.video = {
    path: path.relative(project.projectDir, videoOutput).split(path.sep).join('/'),
    bytes: statSync(videoOutput).size,
    codec: videoStream.codec_name,
    width: videoStream.width,
    height: videoStream.height,
    fps: videoStream.r_frame_rate,
    frames: Number.isFinite(frameCount) ? frameCount : null,
    durationSeconds: Number(probe.format?.duration ?? videoStream.duration),
    audioStreams: audioStreams.length,
    audioCodec: audioStreams[0].codec_name,
    audioBandDb: {source950: sourceBandDb, soundtrack: soundtrackBandDb},
  };
  summary.checks.push({
    name: 'video codec, dimensions, fps and frame count match the project',
    pass:
      videoStream.codec_name === 'h264' &&
      videoStream.width === project.config.output.width &&
      videoStream.height === project.config.output.height &&
      videoStream.r_frame_rate === `${project.config.output.fps}/1` &&
      frameCount === project.durationInFrames,
  });
  summary.checks.push({
    name: 'exactly one soundtrack audio stream is present',
    pass: audioStreams.length === 1,
  });
  summary.checks.push({
    name: 'embedded source audio is muted',
    pass: sourceBandDb < soundtrackBandDb - 10,
  });
  const afterVideoHashes = project.assets
    .filter((asset) => asset.kind === 'video' && asset.absolutePath)
    .map((asset) => ({id: asset.id, sha256: sha256File(asset.absolutePath)}));
  const afterLayerHashes = project.assets
    .filter((asset) => asset.kind === 'layer' && asset.absolutePath)
    .map((asset) => ({id: asset.id, sha256: sha256File(asset.absolutePath)}));
  summary.sourceHashesAfter = {video: afterVideoHashes, layers: afterLayerHashes};
  summary.checks.push({
    name: 'source media hashes remain unchanged after rendering',
    pass:
      afterVideoHashes.every((entry, index) =>
        entry.sha256 === summary.mediaAssets[index].sha256,
      ) &&
      afterLayerHashes.every((entry, index) =>
        entry.sha256 === summary.layerAssets[index].sha256,
      ),
  });
  summary.pass = summary.checks.every((check) => check.pass);
  writeFileSync(record.reportPath, JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
}

const pass = summaries.every((record) => record.summary.pass);
console.log(
  JSON.stringify(
    {
      pass,
      projects: summaries.map((record) => record.summary.projectId),
      reports: summaries.map((record) => `${record.summary.projectId}/reports/media-render-evidence.json`),
    },
    null,
    2,
  ),
);
if (!pass) process.exitCode = 1;
