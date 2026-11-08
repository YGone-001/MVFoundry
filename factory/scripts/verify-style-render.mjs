// P1-G-A focused style-render verification.
//
// Proves that selecting a registered visual style changes the actual rendered
// pixels through the existing project-local module path, that the same inputs
// are deterministic, and that an unknown style fails closed before writing any
// output. The fixture is synthetic and lives in a disposable external workspace.
//
// Usage:
//   node factory/scripts/verify-style-render.mjs [--keep]
import {createHash} from 'node:crypto';
import {cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const keep = process.argv.includes('--keep');

const workspace = mkdtempSync(path.join(tmpdir(), 'mv-style-verify-'));
const projectId = 'synthetic-style-demo';
const projectDir = path.join(workspace, projectId);
const styleA = 'cinematic-illustration-2p5d';
const styleB = 'retro-pixel';
const frame = 24;
const configFile = path.join(projectDir, 'project.json');
const modulePath = path.join(projectDir, 'scenes', 'style-signal.ts');

const fail = (message, details = '') => {
  throw new Error(details ? `${message}: ${details}` : message);
};

const sha = (value) => createHash('sha256').update(value).digest('hex');

const moduleSource = `// Synthetic style-aware scene module used only by verify-style-render.mjs.
// It has no imports, no clocks, no randomness and no network access.
type Ctx = CanvasRenderingContext2D;
type StyleContext = {id: string; label: string} | null;
type RenderContext = {
  canvas: {width: number; height: number};
  frame: {localFrame: number; animationTick: number};
  style: StyleContext;
};

const hash = (value: number): number => {
  const noise = Math.sin(value * 127.1 + 311.7) * 43758.5453;
  return noise - Math.floor(noise);
};

const drawCinematic = (ctx: Ctx, width: number, height: number, tick: number): void => {
  const sky = ctx.createLinearGradient(0, 0, 0, height * 0.72);
  sky.addColorStop(0, '#07101c');
  sky.addColorStop(0.55, '#123246');
  sky.addColorStop(1, '#244a5e');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, width, height);

  const glow = ctx.createRadialGradient(width * 0.28, height * 0.34, 0, width * 0.28, height * 0.34, height * 0.24);
  glow.addColorStop(0, 'rgba(255,224,176,0.55)');
  glow.addColorStop(1, 'rgba(255,224,176,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, width, height);

  for (let i = 0; i < 14; i += 1) {
    const bw = width * (0.035 + hash(10 + i) * 0.06);
    const bh = height * (0.1 + hash(20 + i) * 0.3);
    ctx.fillStyle = i % 3 === 0 ? '#10253a' : '#0c1c2c';
    ctx.fillRect(width * (0.02 + i * 0.07) - tick * 0.2, height * 0.62 - bh, bw, bh);
    ctx.fillStyle = '#e29a4a';
    for (let k = 0; k < 4; k += 1) {
      if (hash(30 + i * 7 + k) < 0.4) {
        ctx.fillRect(width * (0.03 + i * 0.07) + k * 7, height * 0.62 - bh + 8 + k * 9, 3, 5);
      }
    }
  }
  ctx.fillStyle = '#08111a';
  ctx.fillRect(0, height * 0.7, width, height * 0.3);
  ctx.strokeStyle = '#1d2a36';
  ctx.lineWidth = 2;
  for (let y = 0.76; y < 0.95; y += 0.08) {
    ctx.beginPath();
    ctx.moveTo(0, height * y);
    ctx.lineTo(width, height * y);
    ctx.stroke();
  }

  const person = (x: number, ground: number, heightValue: number, coat: string, hair: string): void => {
    const u = heightValue / 24;
    ctx.fillStyle = coat;
    ctx.beginPath();
    ctx.moveTo(x - 3 * u, ground - 12 * u);
    ctx.lineTo(x + 3 * u, ground - 12 * u);
    ctx.lineTo(x + 4 * u, ground);
    ctx.lineTo(x - 4 * u, ground);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#e6b189';
    ctx.beginPath();
    ctx.arc(x, ground - 15 * u, 3.2 * u, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = hair;
    ctx.beginPath();
    ctx.arc(x, ground - 16.2 * u, 3.4 * u, Math.PI, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(x - 3.4 * u, ground - 16.2 * u, 6.8 * u, 3 * u);
    ctx.fillStyle = '#b84753';
    ctx.fillRect(x - 2.6 * u, ground - 11 * u, 5.2 * u, 1.4 * u);
    ctx.fillStyle = '#f5f2e9';
    ctx.fillRect(x - 1.7 * u, ground - 15.4 * u, 1.2 * u, 1.2 * u);
    ctx.fillRect(x + 0.5 * u, ground - 15.4 * u, 1.2 * u, 1.2 * u);
  };
  person(width * 0.46, height * 0.9, height * 0.24, '#4c5838', '#0f141c');
  person(width * 0.56, height * 0.9, height * 0.24, '#efe3ce', '#452b22');

  ctx.strokeStyle = '#8fa5b8';
  ctx.lineWidth = 1.5;
  ctx.globalAlpha = 0.55;
  for (let i = 0; i < 90; i += 1) {
    const x = hash(40 + i) * width;
    const y = (hash(50 + i) * height + tick * 4) % height;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - 2, y + 9);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
};

const drawPixel = (ctx: Ctx, width: number, height: number, tick: number): void => {
  const unit = Math.max(2, Math.round(width / 80));
  const px = (x: number, y: number, ww: number, hh: number, color: string): void => {
    ctx.fillStyle = color;
    ctx.fillRect(Math.round(x / unit) * unit, Math.round(y / unit) * unit, Math.round(ww / unit) * unit, Math.round(hh / unit) * unit);
  };
  px(0, 0, width, height, '#05070d');
  px(0, 0, width, height * 0.2, '#070d18');
  px(0, height * 0.2, width, height * 0.2, '#0a1422');
  px(0, height * 0.4, width, height * 0.18, '#16324a');
  for (let i = 0; i < 18; i += 1) {
    const bw = width * (0.04 + hash(60 + i) * 0.06);
    const bh = height * (0.08 + hash(70 + i) * 0.22);
    px(width * (i * 0.055) - tick, height * 0.58 - bh, bw, bh, '#0b1a2a');
    px(width * (i * 0.055) - tick, height * 0.58 - bh, bw, unit, '#1a3450');
    if (hash(80 + i) < 0.5) px(width * (i * 0.055) - tick + unit * 2, height * 0.58 - bh + unit * 2, unit, unit * 2, '#e29a4a');
  }
  px(0, height * 0.62, width, height * 0.38, '#060b10');
  px(0, height * 0.76, width, unit, '#1d2a36');
  px(0, height * 0.86, width, unit, '#1d2a36');

  const person = (x: number, ground: number, coat: string, hair: string): void => {
    px(x - unit * 3, ground - unit * 14, unit * 6, unit * 10, coat);
    px(x - unit * 2, ground - unit * 18, unit * 4, unit * 4, '#e6b189');
    px(x - unit * 2, ground - unit * 19, unit * 4, unit * 2, hair);
    px(x - unit * 2, ground - unit * 13, unit * 4, unit, '#b84753');
    px(x - unit, ground - unit * 17, unit, unit, '#111622');
    px(x + unit, ground - unit * 17, unit, unit, '#111622');
    px(x - unit * 3, ground - unit * 4, unit * 2, unit * 4, '#222a3b');
    px(x + unit, ground - unit * 4, unit * 2, unit * 4, '#222a3b');
  };
  person(width * 0.45, height * 0.9, '#4c5838', '#0f141c');
  person(width * 0.57, height * 0.9, '#efe3ce', '#452b22');

  ctx.fillStyle = '#63cdc6';
  for (let i = 0; i < 40; i += 1) {
    const x = hash(90 + i) * width;
    const y = (hash(100 + i) * height + tick * 6) % height;
    ctx.fillRect(Math.round(x), Math.round(y), unit, unit * 2);
  }
};

const sceneModule = {
  id: 'style-signal',
  contractVersion: 1,
  moduleType: 'canvas2d' as const,
  label: 'Style-aware synthetic test scene',
  params: [] as Array<{key: string; type: 'string' | 'number' | 'boolean'; required?: boolean}>,
  assetDependencies: [] as string[],
  supportedStyles: ['cinematic-illustration-2p5d', 'retro-pixel'] as string[],
  render: (ctx: Ctx, context: RenderContext): void => {
    if (context.style?.id === 'retro-pixel') {
      drawPixel(ctx, context.canvas.width, context.canvas.height, context.frame.animationTick);
      return;
    }
    drawCinematic(ctx, context.canvas.width, context.canvas.height, context.frame.animationTick);
  },
};

export default sceneModule;
`;

const baseConfig = JSON.parse(
  readFileSync(
    path.join(repoRoot, 'factory', 'examples', 'projects', 'synthetic-module-pixel-demo', 'project.json'),
    'utf8',
  ),
);

const writeProject = (styleId) => {
  const config = JSON.parse(JSON.stringify(baseConfig));
  config.projectId = projectId;
  config.song = {title: 'Synthetic Style Verification', artist: 'MVFoundry Synthetic Fixture'};
  config.narrative.mode = 'abstract';
  config.output = {width: 640, height: 360, fps: 24};
  config.visual = {
    styleProfile: styleId,
    defaultRenderer: 'project:style-signal',
    style: {id: styleId},
  };
  config.chapters = [
    {
      id: 'CH-01',
      title: 'Style verification',
      startFrame: 0,
      endFrame: 48,
      shots: [
        {
          id: 'SHOT-01',
          startFrame: 0,
          endFrame: 48,
          renderer: 'project:style-signal',
          params: {background: '#000000'},
        },
      ],
    },
  ];
  config.cues = [];
  config.sceneModules = [
    {
      id: 'style-signal',
      path: 'scenes/style-signal.ts',
      moduleType: 'canvas2d',
      contractVersion: 1,
      sha256: sha(readFileSync(modulePath)),
      trust: 'user-authored-approved',
      canvas: {mode: 'output'},
      samplingFps: 'output',
      pixelated: false,
      label: 'Style-aware synthetic test scene',
      description: 'Two registered styles, one module, used only by the style verification script.',
      styleIds: [styleId],
    },
  ];
  config.assets = [];
  config.audioTracks = [];
  writeFileSync(configFile, `${JSON.stringify(config, null, 2)}\n`);
};

const render = (styleId, output) => {
  writeProject(styleId);
  const result = spawnSync(
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
      output,
    ],
    {cwd: repoRoot, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024},
  );
  return result;
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

const summarize = () => {
  const a = rawPixels(path.join(projectDir, 'renders', 'style-a.png'));
  const b = rawPixels(path.join(projectDir, 'renders', 'style-b.png'));
  const repeat = rawPixels(path.join(projectDir, 'renders', 'style-a-repeat.png'));
  if (a.length !== b.length) fail('raw pixel sizes differ between styles');
  let differing = 0;
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) differing += 1;
  }
  const ratio = differing / a.length;
  const edgesA = edgeMap(a, 640, 360);
  const edgesB = edgeMap(b, 640, 360);
  let edgeDifference = 0;
  let edgeEnergy = 0;
  for (let index = 0; index < edgesA.length; index += 1) {
    edgeDifference += Math.abs(edgesA[index] - edgesB[index]);
    edgeEnergy += Math.max(edgesA[index], edgesB[index]);
  }
  const structuralRatio = edgeEnergy === 0 ? 0 : edgeDifference / edgeEnergy;
  const deterministic = sha(a) === sha(repeat);
  const checks = [
    {name: 'different styles produce different decoded pixels', pass: ratio > 0.2, value: ratio},
    {name: 'differences are structural, not only palette', pass: structuralRatio > 0.2, value: structuralRatio},
    {name: 'the same style is deterministic', pass: deterministic},
    {name: 'both styles keep the declared output size', pass: a.length === 640 * 360 * 3},
  ];
  return {
    projectId,
    styles: [styleA, styleB],
    frame,
    pixelDifferenceRatio: Number(ratio.toFixed(4)),
    structuralDifferenceRatio: Number(structuralRatio.toFixed(4)),
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
  writeFileSync(modulePath, moduleSource);
  writeProject(styleA);

  const first = render(styleA, 'style-a.png');
  if (first.status !== 0) fail('cinematic style render failed', first.stderr);
  const second = render(styleB, 'style-b.png');
  if (second.status !== 0) fail('retro-pixel style render failed', second.stderr);
  const third = render(styleA, 'style-a-repeat.png');
  if (third.status !== 0) fail('deterministic repeat render failed', third.stderr);

  summary = summarize();
  if (!summary.pass) fail('style render evidence failed', JSON.stringify(summary.checks));

  // The unknown style must fail closed and leave no output file.
  const unknownOutput = 'unknown-style.png';
  writeProject('unknown-style');
  const unknown = spawnSync(
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
      unknownOutput,
    ],
    {cwd: repoRoot, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024},
  );
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
