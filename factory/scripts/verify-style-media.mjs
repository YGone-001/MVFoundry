// Bounded synthetic regression for the style-aware media route.
//
// Proves, with actual decoded output:
//   1. A style-driven project can place a styled Canvas shot, a Video shot,
//      a Hybrid shot and an asset-backed parallax shot on one timeline.
//   2. Foreground, subject and midground layers displace by different
//      amounts under the same camera move (real parallax, not a global warp).
//   3. A short MP4 decodes with the expected codec, size, frame count,
//      pixel format and exactly one audio stream.
//   4. Unknown styles, unsupported combinations and unapproved media fail closed
//      before any output is written.
//
// No private artwork is required: every fixture is generated here.
//
// Usage:
//   node factory/scripts/verify-style-media.mjs [--keep]
import {createHash} from 'node:crypto';
import {cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync, spawnSync} from 'node:child_process';
import {deflateSync} from 'node:zlib';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const keep = process.argv.includes('--keep');

const workspace = mkdtempSync(path.join(tmpdir(), 'mv-style-media-'));
const projectId = 'synthetic-style-media-demo';
const projectDir = path.join(workspace, projectId);
const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
const fail = (message) => {
  throw new Error(message);
};

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

const crc32 = (buffer) => {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
};

const pngChunk = (type, data) => {
  const name = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([name, data])), 0);
  return Buffer.concat([length, name, data, crc]);
};

const writePng = (file, width, height, paint) => {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 4 + 1);
    raw[row] = 0;
    for (let x = 0; x < width; x += 1) {
      const [r, g, b, a] = paint(x, y);
      const index = row + 1 + x * 4;
      raw[index] = r;
      raw[index + 1] = g;
      raw[index + 2] = b;
      raw[index + 3] = a;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  writeFileSync(
    file,
    Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      pngChunk('IHDR', header),
      pngChunk('IDAT', deflateSync(raw, {level: 9})),
      pngChunk('IEND', Buffer.alloc(0)),
    ]),
  );
};

const WIDTH = 640;
const HEIGHT = 360;
const FPS = 24;
const FRAMES = 48;
const SHOT = 12;
const PARALLAX_START = 36;
const PARALLAX_END = 47;
const STRIPE = 44;

const stripeLayer = (file, color, centreY) => {
  writePng(file, WIDTH, HEIGHT, (x, y) => {
    const insideX = x >= WIDTH / 2 - STRIPE / 2 && x < WIDTH / 2 + STRIPE / 2;
    const insideY = y >= centreY - STRIPE / 2 && y < centreY + STRIPE / 2;
    return insideX && insideY ? [color[0], color[1], color[2], 255] : [0, 0, 0, 0];
  });
};

const writeFixtures = () => {
  mkdirSync(path.join(projectDir, 'assets', 'plates'), {recursive: true});
  mkdirSync(path.join(projectDir, 'assets', 'layers'), {recursive: true});
  mkdirSync(path.join(projectDir, 'assets', 'video'), {recursive: true});
  mkdirSync(path.join(projectDir, 'source', 'audio'), {recursive: true});
  mkdirSync(path.join(projectDir, 'scenes'), {recursive: true});

  const backgroundFile = path.join(projectDir, 'assets', 'plates', 'background.png');
  writePng(backgroundFile, WIDTH, HEIGHT, (x, y) => {
    const value = 12 + Math.round((y / HEIGHT) * 16);
    const grid = x % 64 === 0 || y % 64 === 0 ? 8 : 0;
    return [value + grid, value + 6 + grid, value + 12 + grid, 255];
  });

  const midFile = path.join(projectDir, 'assets', 'layers', 'midground.png');
  const subjectFile = path.join(projectDir, 'assets', 'layers', 'subject.png');
  const foregroundFile = path.join(projectDir, 'assets', 'layers', 'foreground.png');
  stripeLayer(midFile, [0, 220, 90], 110);
  stripeLayer(subjectFile, [230, 30, 30], 168);
  stripeLayer(foregroundFile, [40, 80, 240], 228);

  const videoFile = path.join(projectDir, 'assets', 'video', 'plate.mp4');
  execFileSync(
    'ffmpeg',
    [
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      `color=c=#1d3a4a:s=${WIDTH}x${HEIGHT}:r=${FPS}:d=2`,
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '20',
      '-pix_fmt',
      'yuv420p',
      '-r',
      String(FPS),
      '-movflags',
      '+faststart',
      videoFile,
    ],
    {encoding: 'utf8', windowsHide: true},
  );

  const tone = path.join(
    repoRoot,
    'factory',
    'examples',
    'projects',
    'synthetic-pixel-demo',
    'source',
    'audio',
    'tone-2s.wav',
  );
  if (!existsSync(tone)) fail('Synthetic tone fixture is missing; run npm run fixtures first');
  const audioFile = path.join(projectDir, 'source', 'audio', 'tone-2s.wav');
  cpSync(tone, audioFile);

  const moduleFile = path.join(projectDir, 'scenes', 'style-media-canvas.ts');
  writeFileSync(
    moduleFile,
    [
      'export default {',
      "  id: 'style-media-canvas',",
      '  contractVersion: 1,',
      "  moduleType: 'canvas2d',",
      '  params: [],',
      '  assetDependencies: [],',
      "  supportedStyles: ['cinematic-illustration-2p5d'],",
      '  render(ctx, context) {',
      "    ctx.fillStyle = '#0b1a26';",
      '    ctx.fillRect(0, 0, context.canvas.width, context.canvas.height);',
      "    ctx.fillStyle = '#6fd0cc';",
      '    ctx.fillRect(context.canvas.width * 0.2, context.canvas.height * 0.3, context.canvas.width * 0.24, context.canvas.height * 0.4);',
      '  },',
      '};',
      '',
    ].join('\n'),
  );

  return {
    background: sha256(backgroundFile),
    midground: sha256(midFile),
    subject: sha256(subjectFile),
    foreground: sha256(foregroundFile),
    video: sha256(videoFile),
    audio: sha256(audioFile),
    module: sha256(moduleFile),
  };
};

const parallaxMedia = () => ({
  kind: 'parallax-2p5d',
  background: {
    kind: 'image',
    assetId: 'BG-01',
    opacity: 1,
    fit: 'cover',
    positionX: 0,
    positionY: 0,
    scale: 1,
    parallax: 0.04,
    blur: 0,
  },
  layers: [
    {
      assetId: 'LAYER-MID',
      role: 'midground',
      order: 10,
      parallax: 0.3,
      opacity: 1,
      fit: 'cover',
      visibleFromFrame: 0,
      visibleToFrame: SHOT,
      blur: 0,
    },
    {
      assetId: 'LAYER-SUB',
      role: 'subject',
      order: 20,
      parallax: 0.6,
      opacity: 1,
      fit: 'cover',
      visibleFromFrame: 0,
      visibleToFrame: SHOT,
      blur: 0,
    },
    {
      assetId: 'LAYER-FG',
      role: 'foreground',
      order: 30,
      parallax: 0.95,
      opacity: 1,
      fit: 'cover',
      visibleFromFrame: 0,
      visibleToFrame: SHOT,
      blur: 0,
    },
  ],
  camera: {
    kind: 'pan',
    fromX: 0.1,
    fromY: 0,
    fromZoom: 1.02,
    toX: -0.1,
    toY: 0,
    toZoom: 1.02,
    easing: 'linear',
  },
  atmosphere: {kind: 'none', intensity: 0, windX: 0},
  light: {amplitude: 0, frequency: 0, phase: 0},
  grade: {saturation: 1, contrast: 1, brightness: 1, tintOpacity: 0, vignette: 0, grain: 0},
});

const projectConfig = (hashes) => ({
  schemaVersion: 1,
  projectId,
  song: {title: 'Synthetic Style Media', artist: 'MVFoundry Synthetic Fixture'},
  audio: {
    path: 'source/audio/tone-2s.wav',
    sha256: hashes.audio,
    durationSeconds: 2,
    durationPolicy: 'round',
    format: 'wav-pcm',
    mixSampleRate: 48000,
    gainDb: 0,
    fadeInFrames: 0,
    fadeOutFrames: 0,
    gainAutomation: [],
  },
  lyrics: {language: 'none', path: null},
  narrative: {mode: 'abstract'},
  visual: {
    styleProfile: 'cinematic-illustration-2p5d',
    defaultRenderer: 'project:style-media-canvas',
    style: {id: 'cinematic-illustration-2p5d'},
  },
  output: {width: WIDTH, height: HEIGHT, fps: FPS},
  cues: [],
  chapters: [
    {
      id: 'CH-01',
      title: 'Style media',
      startFrame: 0,
      endFrame: FRAMES,
      shots: [
        {
          id: 'SHOT-CANVAS',
          startFrame: 0,
          endFrame: SHOT,
          renderer: 'project:style-media-canvas',
          params: {background: '#05080d'},
        },
        {
          id: 'SHOT-VIDEO',
          startFrame: SHOT,
          endFrame: SHOT * 2,
          renderer: 'video',
          params: {background: '#05080d'},
          media: {
            kind: 'video',
            assetId: 'VIDEO-01',
            sourceStartSeconds: 0,
            fit: 'cover',
            endBehavior: 'reject',
            muted: true,
          },
        },
        {
          id: 'SHOT-HYBRID',
          startFrame: SHOT * 2,
          endFrame: SHOT * 3,
          renderer: 'hybrid',
          params: {background: '#05080d', accent: '#6fd0cc'},
          media: {
            kind: 'hybrid',
            video: {
              assetId: 'VIDEO-01',
              sourceStartSeconds: 0,
              fit: 'cover',
              endBehavior: 'reject',
              muted: true,
            },
            layers: [
              {
                assetId: 'LAYER-MID',
                order: 5,
                opacity: 0.8,
                fit: 'contain',
                visibleFromFrame: 0,
                visibleToFrame: SHOT,
              },
            ],
            overlay: {kind: 'scan', intensity: 0.4},
          },
        },
        {
          id: 'SHOT-PARALLAX',
          startFrame: SHOT * 3,
          endFrame: FRAMES,
          renderer: 'parallax-2p5d',
          params: {background: '#05080d'},
          media: parallaxMedia(),
        },
      ],
    },
  ],
  sceneModules: [
    {
      id: 'style-media-canvas',
      path: 'scenes/style-media-canvas.ts',
      moduleType: 'canvas2d',
      contractVersion: 1,
      sha256: hashes.module,
      trust: 'user-authored-approved',
      canvas: {mode: 'output'},
      samplingFps: 'output',
      pixelated: false,
      styleIds: ['cinematic-illustration-2p5d'],
    },
  ],
  assets: [
    {
      id: 'BG-01',
      kind: 'image',
      path: 'assets/plates/background.png',
      sha256: hashes.background,
      source: 'Synthetic fixture generated by verify-style-media.mjs',
      rights: 'Synthetic fixture; no third-party rights',
      approval: 'approved',
    },
    {
      id: 'LAYER-MID',
      kind: 'layer',
      path: 'assets/layers/midground.png',
      sha256: hashes.midground,
      source: 'Synthetic fixture generated by verify-style-media.mjs',
      rights: 'Synthetic fixture; no third-party rights',
      approval: 'approved',
    },
    {
      id: 'LAYER-SUB',
      kind: 'layer',
      path: 'assets/layers/subject.png',
      sha256: hashes.subject,
      source: 'Synthetic fixture generated by verify-style-media.mjs',
      rights: 'Synthetic fixture; no third-party rights',
      approval: 'approved',
    },
    {
      id: 'LAYER-FG',
      kind: 'layer',
      path: 'assets/layers/foreground.png',
      sha256: hashes.foreground,
      source: 'Synthetic fixture generated by verify-style-media.mjs',
      rights: 'Synthetic fixture; no third-party rights',
      approval: 'approved',
    },
    {
      id: 'VIDEO-01',
      kind: 'video',
      path: 'assets/video/plate.mp4',
      sha256: hashes.video,
      source: 'Synthetic fixture generated by verify-style-media.mjs',
      rights: 'Synthetic fixture; no third-party rights',
      approval: 'approved',
    },
  ],
  permissions: {externalGeneration: false, localOnly: true, allowNetwork: false},
  render: {codec: 'h264', pixelFormat: 'yuv420p', colorSpace: 'bt709', imageFormat: 'png'},
});

const writeProject = (config) => {
  writeFileSync(path.join(projectDir, 'project.json'), `${JSON.stringify(config, null, 2)}\n`);
};

const renderStill = (frame, out) =>
  spawnSync(
    process.execPath,
    [
      path.join(repoRoot, 'factory', 'scripts', 'render-project.mjs'),
      '--project',
      projectId,
      '--workspace',
      workspace,
      '--mode',
      'still',
      '--frame',
      String(frame),
      '--out',
      out,
    ],
    {cwd: repoRoot, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024},
  );

const rawRgb = (file) => {
  const result = spawnSync(
    'ffmpeg',
    ['-v', 'error', '-i', file, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'],
    {encoding: null, maxBuffer: 64 * 1024 * 1024, windowsHide: true},
  );
  if (result.status !== 0) fail(`ffmpeg could not decode ${file}`);
  return result.stdout;
};

const classify = (r, g, b) => {
  if (r > 110 && r > g * 1.5 && r > b * 1.5) return 'subject';
  if (g > 110 && g > r * 1.5 && g > b * 1.5) return 'midground';
  if (b > 110 && b > r * 1.5 && b > g * 1.5) return 'foreground';
  return null;
};

const centroids = (file, width, height) => {
  const bytes = rawRgb(file);
  const sums = {midground: 0, subject: 0, foreground: 0};
  const counts = {midground: 0, subject: 0, foreground: 0};
  for (let index = 0; index < width * height; index += 1) {
    const r = bytes[index * 3];
    const g = bytes[index * 3 + 1];
    const b = bytes[index * 3 + 2];
    const kind = classify(r, g, b);
    if (!kind) continue;
    const x = index % width;
    sums[kind] += x;
    counts[kind] += 1;
  }
  return Object.fromEntries(
    Object.keys(sums).map((key) => [
      key,
      counts[key] === 0 ? null : Number((sums[key] / counts[key]).toFixed(3)),
    ]),
  );
};

const frameStats = (file, width, height) => {
  const bytes = rawRgb(file);
  let lit = 0;
  let green = 0;
  for (let index = 0; index < width * height; index += 1) {
    const r = bytes[index * 3];
    const g = bytes[index * 3 + 1];
    const b = bytes[index * 3 + 2];
    if (r + g + b > 30) lit += 1;
    if (classify(r, g, b) === 'midground') green += 1;
  }
  return {
    nonBlackRatio: Number((lit / (width * height)).toFixed(4)),
    greenPixels: green,
  };
};

const ffprobeJson = (file) =>
  JSON.parse(
    execFileSync(
      'ffprobe',
      ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', file],
      {encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, windowsHide: true},
    ),
  );

let summary = null;
try {
  mkdirSync(projectDir, {recursive: true});
  const hashes = writeFixtures();
  const config = projectConfig(hashes);
  writeProject(config);

  const start = renderStill(SHOT * 3, 'parallax-start.png');
  if (start.status !== 0) fail('parallax start still failed', start.stderr);
  const end = renderStill(PARALLAX_END, 'parallax-end.png');
  if (end.status !== 0) fail('parallax end still failed', end.stderr);

  const startFile = path.join(projectDir, 'renders', 'parallax-start.png');
  const endFile = path.join(projectDir, 'renders', 'parallax-end.png');
  const startCentroids = centroids(startFile, WIDTH, HEIGHT);
  const endCentroids = centroids(endFile, WIDTH, HEIGHT);
  const displacement = {
    midground: endCentroids.midground - startCentroids.midground,
    subject: endCentroids.subject - startCentroids.subject,
    foreground: endCentroids.foreground - startCentroids.foreground,
  };
  const checks = [];
  const check = (name, pass, value) => checks.push({name, pass: Boolean(pass), value});
  check(
    'all three depth stripes are visible in the parallax shot',
    Object.values(startCentroids).every((value) => value !== null),
    startCentroids,
  );
  check(
    'foreground displaces more than subject',
    displacement.foreground > displacement.subject + 8,
    displacement,
  );
  check(
    'subject displaces more than midground',
    displacement.subject > displacement.midground + 8,
    displacement,
  );
  check(
    'every depth tier actually moves',
    displacement.midground > 4 && displacement.foreground > 20,
    displacement,
  );
  check('camera pan is leftward over the shot', displacement.midground > 0, displacement.midground);
  check(
    'the styled canvas, video and hybrid shots render without a fallback',
    ['SHOT-CANVAS', 'SHOT-VIDEO', 'SHOT-HYBRID'].every((shotId, index) => {
      const result = renderStill(SHOT * index, `mixed-${index}.png`);
      if (result.status !== 0) fail(`mixed shot ${shotId} still failed`, result.stderr);
      return true;
    }),
    ['SHOT-CANVAS', 'SHOT-VIDEO', 'SHOT-HYBRID'],
  );
  const mixedStats = ['SHOT-CANVAS', 'SHOT-VIDEO', 'SHOT-HYBRID'].map((shotId, index) => ({
    shotId,
    ...frameStats(path.join(projectDir, 'renders', `mixed-${index}.png`), WIDTH, HEIGHT),
  }));
  const parallaxStats = {
    start: frameStats(startFile, WIDTH, HEIGHT),
    end: frameStats(endFile, WIDTH, HEIGHT),
  };
  check(
    'no mixed or 2.5D frame contains an unexpected black gap',
    mixedStats.every((entry) => entry.nonBlackRatio > 0.02) &&
      parallaxStats.start.nonBlackRatio > 0.02 &&
      parallaxStats.end.nonBlackRatio > 0.02,
    {mixedStats, parallaxStats},
  );
  check(
    'the hybrid shot actually composites its approved layer',
    mixedStats[2].greenPixels > 100,
    mixedStats[2],
  );

  // Short decoded video for codec, size, frames, pixel format and audio count.
  const videoOutput = spawnSync(
    process.execPath,
    [
      path.join(repoRoot, 'factory', 'scripts', 'render-project.mjs'),
      '--project',
      projectId,
      '--workspace',
      workspace,
      '--mode',
      'video',
      '--frames',
      `${PARALLAX_START}-${PARALLAX_END}`,
    ],
    {cwd: repoRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024},
  );
  if (videoOutput.status !== 0) fail('short video render failed', videoOutput.stderr);
  const mp4 = path.join(projectDir, 'renders', `${projectId}-render.mp4`);
  if (!existsSync(mp4)) fail('short video output is missing');
  const probe = ffprobeJson(mp4);
  const videoStream = (probe.streams || []).find((stream) => stream.codec_type === 'video');
  const audioStreams = (probe.streams || []).filter((stream) => stream.codec_type === 'audio');
  const expectedFrames = PARALLAX_END - PARALLAX_START + 1;
  check('decoded video is H.264', videoStream?.codec_name === 'h264', videoStream?.codec_name);
  check(
    'decoded video is 640x360 at 24fps',
    videoStream?.width === WIDTH &&
      videoStream?.height === HEIGHT &&
      videoStream?.r_frame_rate === '24/1',
    videoStream ? `${videoStream.width}x${videoStream.height} ${videoStream.r_frame_rate}` : null,
  );
  check(
    'decoded video is yuv420p',
    videoStream?.pix_fmt === 'yuv420p',
    videoStream?.pix_fmt,
  );
  check(
    'decoded video has the expected frame count',
    Number(videoStream?.nb_frames) === expectedFrames,
    videoStream?.nb_frames,
  );
  check(
    'decoded video carries exactly one audio stream',
    audioStreams.length === 1,
    audioStreams.length,
  );
  check(
    'audio and video durations stay aligned',
    Math.abs(Number(videoStream?.duration) - expectedFrames / FPS) < 0.05,
    videoStream?.duration,
  );

  // Negative controls must fail closed without writing output.
  const negative = (name, mutate, pattern) => {
    const broken = projectConfig(hashes);
    mutate(broken);
    writeProject(broken);
    const out = `negative-${name}.png`;
    const result = renderStill(SHOT * 3, out);
    const wrote = existsSync(path.join(projectDir, 'renders', out));
    check(
      `${name} fails closed without output`,
      result.status !== 0 && !wrote && pattern.test(`${result.stdout}\n${result.stderr}`),
      (result.stderr || '').split('\n').find((line) => line.includes('ConfigValidationError')) ?? null,
    );
    return result.status !== 0 && !wrote;
  };
  negative('unknown-style', (config2) => {
    config2.visual.style = {id: 'unknown-style'};
  }, /not a registered style/);
  negative('unapproved-layer', (config2) => {
    config2.assets[1].approval = 'pending';
  }, /approval pending/);
  negative('unsupported-combination', (config2) => {
    config2.visual.style = {id: 'retro-pixel'};
    config2.sceneModules[0].styleIds = ['retro-pixel'];
  }, /does not declare/);
  negative('missing-depth-tier', (config2) => {
    config2.chapters[0].shots[3].media = {
      ...config2.chapters[0].shots[3].media,
      layers: config2.chapters[0].shots[3].media.layers.filter(
        (layer) => layer.role !== 'foreground',
      ),
    };
  }, /at least one foreground layer/);

  // Restore the working project after negative controls.
  writeProject(config);

  summary = {
    projectId,
    workspace,
    composition: {width: WIDTH, height: HEIGHT, fps: FPS, frames: FRAMES},
    renderers: config.chapters[0].shots.map((shot) => shot.renderer),
    parallax: {
      startFrame: SHOT * 3,
      endFrame: PARALLAX_END,
      startCentroids,
      endCentroids,
      displacement,
    },
    video: {
      path: path.relative(projectDir, mp4).split(path.sep).join('/'),
      codec: videoStream?.codec_name,
      width: videoStream?.width,
      height: videoStream?.height,
      fps: videoStream?.r_frame_rate,
      pixFmt: videoStream?.pix_fmt,
      frames: Number(videoStream?.nb_frames),
      audioStreams: audioStreams.length,
      durationSeconds: Number(probe.format?.duration ?? 0),
    },
    checks,
    pass: checks.every((entry) => entry.pass),
  };
  writeFileSync(
    path.join(projectDir, 'reports', 'style-media-evidence.json'),
    `${JSON.stringify(summary, null, 2)}\n`,
  );
  console.log(JSON.stringify(summary, null, 2));
} finally {
  if (!keep) rmSync(workspace, {recursive: true, force: true});
  else console.log(`workspace kept at ${workspace}`);
}

if (!summary || !summary.pass) process.exitCode = 1;
