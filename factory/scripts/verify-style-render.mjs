// P1-G-A focused style-render verification.
//
// Proves that all six registered visual styles render structurally different
// decoded pixels through the same project-local Canvas 2D module path, that a
// repeat render is deterministic, and that an unknown style fails closed
// before writing any output. The fixture is synthetic and lives in a
// disposable external workspace.
//
// The artwork is a single shared template
// (factory/scripts/support/style-gallery-module.ts) so this proof and the
// persistent examples seeded by seed-style-gallery.mjs cannot drift apart.
//
// Usage:
//   node factory/scripts/verify-style-render.mjs [--keep]
import {createHash} from 'node:crypto';
import {cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const keep = process.argv.includes('--keep');

const {STYLE_IDS} = require('../dist/src/style/catalog.js');
const STYLES = [...STYLE_IDS];
const FRAME = 24;
const WIDTH = 640;
const HEIGHT = 360;
const FPS = 24;
const DURATION_SECONDS = 2;
const DURATION_FRAMES = FPS * DURATION_SECONDS;

const workspace = mkdtempSync(path.join(tmpdir(), 'mv-style-verify-'));
const projectId = 'synthetic-style-gallery-demo';
const projectDir = path.join(workspace, projectId);
const configFile = path.join(projectDir, 'project.json');
const modulePath = path.join(projectDir, 'scenes', 'style-gallery.ts');
const audioPath = path.join(projectDir, 'source', 'audio', 'tone-2s.wav');

const fail = (message, details = '') => {
  throw new Error(details ? `${message}: ${details}` : message);
};

const sha = (value) => createHash('sha256').update(value).digest('hex');

const moduleSource = readFileSync(path.join(here, 'support', 'style-gallery-module.ts'), 'utf8');

// A deterministic 2 s WAV so this proof does not depend on fixture generation.
const writeToneWav = (file) => {
  const sampleRate = 48000;
  const channels = 1;
  const samples = sampleRate * DURATION_SECONDS;
  const buffer = Buffer.alloc(44 + samples * 2);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + samples * 2, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(samples * 2, 40);
  const fade = Math.round(sampleRate * 0.02);
  for (let index = 0; index < samples; index += 1) {
    const fadeIn = Math.min(1, index / fade);
    const fadeOut = Math.min(1, (samples - 1 - index) / fade);
    const value = Math.sin((2 * Math.PI * 440 * index) / sampleRate) * 0.2 * fadeIn * fadeOut;
    buffer.writeInt16LE(Math.round(value * 32767), 44 + index * 2);
  }
  writeFileSync(file, buffer);
  return sha(buffer);
};

const baseConfig = JSON.parse(
  readFileSync(
    path.join(repoRoot, 'factory', 'examples', 'projects', 'synthetic-module-pixel-demo', 'project.json'),
    'utf8',
  ),
);

let audioSha = null;

const writeProject = (styleId) => {
  const config = JSON.parse(JSON.stringify(baseConfig));
  config.projectId = projectId;
  config.song = {title: 'Synthetic Six-Style Verification', artist: 'MVFoundry Synthetic Fixture'};
  config.audio = {
    ...config.audio,
    path: 'source/audio/tone-2s.wav',
    sha256: audioSha,
    durationSeconds: DURATION_SECONDS,
    durationPolicy: 'round',
    format: 'wav-pcm',
  };
  config.narrative.mode = 'abstract';
  config.output = {width: WIDTH, height: HEIGHT, fps: FPS};
  config.visual = {
    styleProfile: styleId,
    defaultRenderer: 'project:style-gallery',
    style: {id: styleId},
  };
  config.chapters = [
    {
      id: 'CH-01',
      title: 'Style verification',
      startFrame: 0,
      endFrame: DURATION_FRAMES,
      shots: [
        {
          id: 'SHOT-01',
          startFrame: 0,
          endFrame: DURATION_FRAMES,
          renderer: 'project:style-gallery',
          params: {background: '#000000'},
        },
      ],
    },
  ];
  config.cues = [];
  config.sceneModules = [
    {
      id: 'style-gallery',
      path: 'scenes/style-gallery.ts',
      moduleType: 'canvas2d',
      contractVersion: 1,
      sha256: sha(readFileSync(modulePath)),
      trust: 'user-authored-approved',
      canvas: {mode: 'output'},
      samplingFps: 'output',
      pixelated: false,
      label: 'Synthetic six-style gallery',
      description: 'One module, six registered visual styles, synthetic verification only.',
      styleIds: [styleId],
    },
  ];
  config.assets = [];
  config.audioTracks = [];
  writeFileSync(configFile, `${JSON.stringify(config, null, 2)}\n`);
};

const render = (output) => {
  return spawnSync(
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
      String(FRAME),
      '--out',
      output,
    ],
    {cwd: repoRoot, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024},
  );
};

const rawPixels = (file) => {
  const result = spawnSync(
    'ffmpeg',
    ['-v', 'error', '-i', file, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'],
    {encoding: null, maxBuffer: 64 * 1024 * 1024},
  );
  if (result.status !== 0) throw new Error(`ffmpeg could not decode ${file}`);
  return result.stdout;
};

const edgeMap = (pixels, width, height) => {
  const cellsX = 32;
  const cellsY = 18;
  const gray = new Float64Array(cellsX * cellsY);
  const count = pixels.length / 3;
  for (let index = 0; index < count; index += 1) {
    const x = index % width;
    const y = Math.floor(index / width);
    const cx = Math.min(cellsX - 1, Math.floor((x / width) * cellsX));
    const cy = Math.min(cellsY - 1, Math.floor((y / height) * cellsY));
    gray[cy * cellsX + cx] += pixels[index * 3] * 0.299 + pixels[index * 3 + 1] * 0.587 + pixels[index * 3 + 2] * 0.114;
  }
  const cellCount = (width * height) / (cellsX * cellsY);
  for (let index = 0; index < gray.length; index += 1) gray[index] /= cellCount;
  const edges = [];
  for (let y = 0; y < cellsY - 1; y += 1) {
    for (let x = 0; x < cellsX - 1; x += 1) {
      const a = gray[y * cellsX + x];
      const b = gray[y * cellsX + x + 1];
      const c = gray[(y + 1) * cellsX + x];
      edges.push(Math.abs(a - b) + Math.abs(a - c));
    }
  }
  return edges;
};

const pixelDifferenceRatio = (a, b) => {
  if (a.length !== b.length) return 1;
  let differing = 0;
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) differing += 1;
  }
  return differing / a.length;
};

const structuralDifferenceRatio = (a, b, width, height) => {
  const edgesA = edgeMap(a, width, height);
  const edgesB = edgeMap(b, width, height);
  let difference = 0;
  let energy = 0;
  for (let index = 0; index < edgesA.length; index += 1) {
    difference += Math.abs(edgesA[index] - edgesB[index]);
    energy += Math.max(edgesA[index], edgesB[index]);
  }
  return energy === 0 ? 0 : difference / energy;
};

const summarize = () => {
  const pixels = new Map();
  for (const styleId of STYLES) {
    pixels.set(styleId, rawPixels(path.join(projectDir, 'renders', `style-${styleId}.png`)));
  }
  const repeat = rawPixels(path.join(projectDir, 'renders', `style-${STYLES[0]}-repeat.png`));

  const pairwise = [];
  let minPixel = 1;
  let minStructural = 1;
  for (let left = 0; left < STYLES.length; left += 1) {
    for (let right = left + 1; right < STYLES.length; right += 1) {
      const a = pixels.get(STYLES[left]);
      const b = pixels.get(STYLES[right]);
      const pixelRatio = pixelDifferenceRatio(a, b);
      const structuralRatio = structuralDifferenceRatio(a, b, WIDTH, HEIGHT);
      minPixel = Math.min(minPixel, pixelRatio);
      minStructural = Math.min(minStructural, structuralRatio);
      pairwise.push({
        left: STYLES[left],
        right: STYLES[right],
        pixelDifferenceRatio: Number(pixelRatio.toFixed(4)),
        structuralDifferenceRatio: Number(structuralRatio.toFixed(4)),
      });
    }
  }

  const deterministic = sha(pixels.get(STYLES[0])) === sha(repeat);
  const sizeOk = STYLES.every((styleId) => pixels.get(styleId).length === WIDTH * HEIGHT * 3);
  const checks = [
    {
      name: 'every registered style rendered at the declared size',
      pass: STYLES.length >= 2 && sizeOk,
      value: {styles: STYLES.length, sizeOk},
    },
    {
      name: 'every style pair differs in decoded pixels',
      pass: minPixel > 0.2,
      value: Number(minPixel.toFixed(4)),
    },
    {
      name: 'every style pair differs structurally, not only in palette',
      pass: minStructural > 0.2,
      value: Number(minStructural.toFixed(4)),
    },
    {name: 'the same style is deterministic', pass: deterministic},
    {name: 'every render keeps the declared output size', pass: sizeOk},
  ];
  return {
    projectId,
    styles: STYLES,
    frame: FRAME,
    output: {width: WIDTH, height: HEIGHT},
    pairwise,
    minPixelDifferenceRatio: Number(minPixel.toFixed(4)),
    minStructuralDifferenceRatio: Number(minStructural.toFixed(4)),
    deterministic,
    checks,
    pass: checks.every((entry) => entry.pass),
  };
};

let summary = null;
try {
  cpSync(
    path.join(repoRoot, 'factory', 'examples', 'projects', 'synthetic-module-pixel-demo'),
    projectDir,
    {recursive: true},
  );
  mkdirSync(path.dirname(audioPath), {recursive: true});
  mkdirSync(path.join(projectDir, 'cache'), {recursive: true});
  mkdirSync(path.join(projectDir, 'renders'), {recursive: true});
  mkdirSync(path.join(projectDir, 'reports'), {recursive: true});
  writeFileSync(modulePath, moduleSource);
  audioSha = writeToneWav(audioPath);

  for (const styleId of STYLES) {
    writeProject(styleId);
    const result = render(`style-${styleId}.png`);
    if (result.status !== 0) fail(`${styleId} style render failed`, `${result.stdout}\n${result.stderr}`);
  }

  // Repeat the first style to prove deterministic output.
  writeProject(STYLES[0]);
  const repeat = render(`style-${STYLES[0]}-repeat.png`);
  if (repeat.status !== 0) fail('deterministic repeat render failed', repeat.stderr);

  summary = summarize();
  if (!summary.pass) fail('style render evidence failed', JSON.stringify(summary.checks));

  // The unknown style must fail closed and leave no output file.
  const unknownOutput = 'unknown-style.png';
  writeProject('unknown-style');
  const unknown = render(unknownOutput);
  const unknownWroteOutput = existsSync(path.join(projectDir, 'renders', unknownOutput));
  if (unknown.status === 0) fail('unknown style was accepted by the render CLI');
  if (unknownWroteOutput) fail('unknown style wrote an output file');
  if (!/unknown-style|Unknown visual style/i.test(`${unknown.stdout}\n${unknown.stderr}`)) {
    fail('unknown style refusal did not name the unknown style', `${unknown.stdout}\n${unknown.stderr}`);
  }
  summary.unknownStyleRefused = true;
  summary.unknownStyleWroteOutput = unknownWroteOutput;

  writeFileSync(
    path.join(projectDir, 'reports', 'style-render-evidence.json'),
    `${JSON.stringify(summary, null, 2)}\n`,
  );
  console.log(JSON.stringify(summary, null, 2));
} finally {
  if (!keep) rmSync(workspace, {recursive: true, force: true});
  else console.log(`workspace kept at ${workspace}`);
}
