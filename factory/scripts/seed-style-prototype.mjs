// Seeds the two P1-G-B synthetic prototypes: a cinematic layered 2.5D short
// and an anime motion-comic short, both built only from locally generated
// artwork and an original synthetic score.
//
// Usage:
//   node factory/scripts/seed-style-prototype.mjs --workspace <root> --project <id> --set cinematic|anime
//
// The project directory and its assets/plates folder must already exist with
// generated plates (run generate-art-plates.mjs first).

import {createHash} from 'node:crypto';
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
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
const projectId = arg('project');
const set = arg('set');
if (!workspaceRoot || !projectId || !set) {
  console.error('--workspace, --project and --set are required');
  process.exit(2);
}
if (!['cinematic', 'anime'].includes(set)) {
  console.error('--set must be cinematic or anime');
  process.exit(2);
}

const {resolveProjectDir} = require('../dist/src/workspace/guard.js');
const {
  assertSafePath,
  createWriteBoundary,
  ensureSafeDirectory,
} = require('../dist/src/workspace/writeBoundary.js');

const projectDir = resolveProjectDir({workspaceRoot, projectId, engineRoot: repoRoot});
const boundary = createWriteBoundary({projectDir, engineRoot: repoRoot});
const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');

/* -------------------------------------------------------------------------- */
/* Original synthetic score                                                    */
/* -------------------------------------------------------------------------- */

const SAMPLE_RATE = 48000;
const DURATION_SECONDS = 15;

const mulberry32 = (seed) => () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const writeScore = (file) => {
  const samples = SAMPLE_RATE * DURATION_SECONDS;
  const channels = 2;
  const buffer = Buffer.alloc(44 + samples * channels * 2);
  const random = mulberry32(0x5eed1234);
  let lowNoise = 0;
  let pinkNoise = 0;
  let rumble = 0;

  const envelope = (time, centre, width, peak) => {
    const distance = Math.abs(time - centre) / width;
    return distance > 1 ? 0 : peak * Math.pow(1 - distance, 2);
  };

  for (let index = 0; index < samples; index += 1) {
    const time = index / SAMPLE_RATE;
    const white = random() * 2 - 1;

    // Rain bed: band-limited noise, steady but not flat.
    lowNoise += 0.06 * (white - lowNoise);
    pinkNoise += 0.004 * (white - pinkNoise);
    const rain = (lowNoise - pinkNoise) * 0.5;
    const rainTone = rain * (0.16 + 0.04 * Math.sin(2 * Math.PI * 0.11 * time));

    // Slow harmonic pad in a minor second cluster.
    const pad =
      Math.sin(2 * Math.PI * 98 * time) * 0.035 +
      Math.sin(2 * Math.PI * 146.8 * time + 0.6) * 0.022 +
      Math.sin(2 * Math.PI * 220 * time + 1.2) * 0.012;
    const padSwell = 0.55 + 0.45 * Math.sin(2 * Math.PI * 0.07 * time - 0.4);

    // Tram rumble: two swells, low-passed noise with a gear hum.
    rumble += 0.012 * (white - rumble);
    const rumbleEnv =
      envelope(time, 4.4, 1.9, 1) + envelope(time, 11.9, 1.6, 0.8);
    const rumbleTone =
      rumble * rumbleEnv * 1.5 +
      Math.sin(2 * Math.PI * 58 * time) * rumbleEnv * 0.02;

    // A single bell on the realisation beat at 6.8s.
    const bellStart = 6.8;
    const bell =
      time > bellStart && time < bellStart + 2.4
        ? (Math.sin(2 * Math.PI * 523.25 * (time - bellStart)) * 0.12 +
            Math.sin(2 * Math.PI * 784.87 * (time - bellStart)) * 0.05) *
          Math.exp(-(time - bellStart) * 2.4)
        : 0;

    // Fade in and out.
    const fadeIn = Math.min(1, time / 0.6);
    const fadeOut = Math.min(1, (DURATION_SECONDS - time) / 1.2);
    const master = Math.max(0, Math.min(1, fadeIn * fadeOut));

    const left = (rainTone + pad * padSwell + rumbleTone + bell) * master;
    const right =
      (rainTone * 0.96 +
        pad * padSwell * 1.02 +
        rumbleTone * 0.95 +
        bell * 0.98) *
      master;

    const open = Math.max(-1, Math.min(1, left));
    const close = Math.max(-1, Math.min(1, right));
    buffer.writeInt16LE(Math.round(open * 32767), 44 + index * 4);
    buffer.writeInt16LE(Math.round(close * 32767), 44 + index * 4 + 2);
  }

  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(buffer.length - 8, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(SAMPLE_RATE, 24);
  buffer.writeUInt32LE(SAMPLE_RATE * channels * 2, 28);
  buffer.writeUInt16LE(channels * 2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(samples * channels * 2, 40);

  writeFileSync(file, buffer);
  return {samples, sampleRate: SAMPLE_RATE, channels};
};

const audioDir = ensureSafeDirectory(
  boundary,
  path.join(projectDir, 'source', 'audio'),
  'project',
);
const audioPath = assertSafePath(boundary, path.join(audioDir, 'score-15s.wav'), {
  expect: 'file',
  subtree: 'project',
});
const score = writeScore(audioPath);

/* -------------------------------------------------------------------------- */
/* Plate inventory                                                             */
/* -------------------------------------------------------------------------- */

const platesDir = path.join(projectDir, 'assets', 'plates');
const manifestFile = path.join(platesDir, 'plates.json');
if (!existsSync(manifestFile)) {
  console.error(`Missing ${path.relative(projectDir, manifestFile)}; run generate-art-plates.mjs first`);
  process.exit(2);
}
const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
const plateByName = new Map(manifest.plates.map((plate) => [plate.name, plate]));

const asset = (id, name, kind, description) => {
  const plate = plateByName.get(name);
  if (!plate) throw new Error(`Plate ${name} is missing from the manifest`);
  const file = path.join(projectDir, plate.path);
  if (!existsSync(file)) throw new Error(`Plate file is missing: ${plate.path}`);
  const hash = sha256(file);
  if (hash !== plate.sha256) throw new Error(`Plate hash changed: ${name}`);
  return {
    id,
    kind,
    path: plate.path,
    sha256: hash,
    source: `Original procedural artwork generated offline by MVFoundry (${description})`,
    rights: 'Original MVFoundry artwork; no third-party rights, no real actors',
    approval: 'approved',
  };
};

const prefix = set === 'cinematic' ? 'cinematic' : 'anime';

const assets = [
  asset('BG-STREET', `${prefix}-bg-street`, 'image', 'rainy street establishing plate'),
  asset('BG-CLOSE', `${prefix}-bg-closeup`, 'image', 'close-up practical bokeh backdrop'),
  asset('MG-PLATFORM', `${prefix}-mg-platform`, 'layer', 'tram shelter midground'),
  asset('MG-BOKEH', `${prefix}-mg-bokeh`, 'layer', 'transparent defocus midground'),
  asset('FG-RAIL', `${prefix}-fg-rail`, 'layer', 'foreground railing and wet pavement'),
  asset('SUBJ-WOMAN', `${prefix}-subject-woman`, 'layer', 'woman full figure cutout'),
  asset('SUBJ-MAN', `${prefix}-subject-man`, 'layer', 'man full figure cutout'),
  asset('SUBJ-WOMAN-CLOSE', `${prefix}-subject-woman-close`, 'layer', 'woman chest-up portrait'),
  asset('TRAM', `${prefix}-tram`, 'layer', 'tram side cutout'),
];

/* -------------------------------------------------------------------------- */
/* Project configuration                                                       */
/* -------------------------------------------------------------------------- */

const FPS = 24;
const TOTAL = 360;
const SHOT_A = [0, 96];
const SHOT_B = [96, 192];
const SHOT_C = [192, 288];
const SHOT_D = [288, 360];

const baseMedia = () => ({
  kind: 'parallax-2p5d',
  background: {
    kind: 'image',
    assetId: 'BG-STREET',
    opacity: 1,
    fit: 'cover',
    positionX: 0,
    positionY: 0,
    scale: 1,
    parallax: 0.05,
  },
  layers: [],
  camera: {
    kind: 'pan',
    fromX: 0.03,
    fromY: 0.01,
    fromZoom: 1.02,
    toX: -0.03,
    toY: -0.005,
    toZoom: 1.02,
    easing: 'easeInOut',
  },
  atmosphere: {kind: 'rain-mist', intensity: 0.72, windX: -0.1},
  light: {
    amplitude: 0.1,
    frequency: 0.55,
    phase: 0.15,
    sweep: {intensity: 0.32, fromX: 0.86, toX: 0.18, width: 0.18, color: '#ffcf8a'},
  },
});

const platformLayer = (shotLength, order = 10) => ({
  assetId: 'MG-PLATFORM',
  role: 'midground',
  order,
  parallax: 0.3,
  opacity: 1,
  fit: 'cover',
  visibleFromFrame: 0,
  visibleToFrame: shotLength,
});

const railForeground = (shotLength, opacity = 1) => ({
  assetId: 'FG-RAIL',
  role: 'foreground',
  order: 30,
  parallax: 0.95,
  opacity,
  fit: 'cover',
  visibleFromFrame: 0,
  visibleToFrame: shotLength,
});

const comicFor = (shotLength, options) => ({
  motionStepFps: 8,
  halftone: options.halftone ?? 0.34,
  speedLines: options.speedLines ?? 0,
  panel: {gutter: 16, inset: 0.025, color: '#0a0a12'},
  impacts: options.impacts ?? [],
  wipes: options.wipes ?? [],
});

const cinematicShots = [
  {
    id: 'SHOT-A',
    startFrame: SHOT_A[0],
    endFrame: SHOT_A[1],
    renderer: 'parallax-2p5d',
    params: {background: '#05080d'},
    media: {
      ...baseMedia(),
      layers: [
        platformLayer(96, 10),
        {
          assetId: 'TRAM',
          role: 'midground',
          order: 14,
          parallax: 0.45,
          opacity: 0.96,
          fit: 'contain',
          scale: 0.62,
          positionX: 300,
          positionY: 40,
          visibleFromFrame: 30,
          visibleToFrame: 96,
          motion: {
            translateXFrom: 0.36,
            translateXTo: -0.18,
            translateYFrom: 0,
            translateYTo: 0,
            easing: 'linear',
          },
        },
        {
          assetId: 'SUBJ-WOMAN',
          role: 'subject',
          order: 20,
          parallax: 0.62,
          opacity: 1,
          fit: 'contain',
          scale: 0.44,
          positionX: -120,
          positionY: 56,
          visibleFromFrame: 0,
          visibleToFrame: 96,
        },
        {
          assetId: 'SUBJ-MAN',
          role: 'subject',
          order: 22,
          parallax: 0.66,
          opacity: 1,
          fit: 'contain',
          scale: 0.46,
          positionX: 52,
          positionY: 53,
          visibleFromFrame: 0,
          visibleToFrame: 96,
        },
        railForeground(96),
      ],
    },
  },
  {
    id: 'SHOT-B',
    startFrame: SHOT_B[0],
    endFrame: SHOT_B[1],
    renderer: 'parallax-2p5d',
    params: {background: '#03070d'},
    media: {
      ...baseMedia(),
      background: {...baseMedia().background, assetId: 'BG-CLOSE', parallax: 0.04},
      camera: {
        kind: 'push-in',
        fromX: 0,
        fromY: 0,
        fromZoom: 1,
        toX: 0,
        toY: 0,
        toZoom: 1.07,
        easing: 'easeInOut',
      },
      layers: [
        {
          assetId: 'MG-BOKEH',
          role: 'midground',
          order: 10,
          parallax: 0.26,
          opacity: 1,
          fit: 'cover',
          visibleFromFrame: 0,
          visibleToFrame: 96,
        },
        {
          assetId: 'SUBJ-WOMAN-CLOSE',
          role: 'subject',
          order: 20,
          parallax: 0.7,
          opacity: 1,
          fit: 'contain',
          scale: 0.94,
          positionX: 26,
          positionY: 22,
          visibleFromFrame: 0,
          visibleToFrame: 96,
        },
        railForeground(96, 0.92),
      ],
      atmosphere: {kind: 'rain-mist', intensity: 0.5, windX: -0.06},
      light: {
        amplitude: 0.08,
        frequency: 0.4,
        phase: 0.3,
        sweep: {intensity: 0.2, fromX: 0.9, toX: 0.3, width: 0.14, color: '#ffcf8a'},
      },
    },
  },
  {
    id: 'SHOT-C',
    startFrame: SHOT_C[0],
    endFrame: SHOT_C[1],
    renderer: 'parallax-2p5d',
    params: {background: '#05080d'},
    media: {
      ...baseMedia(),
      camera: {
        kind: 'pull-back',
        fromX: -0.02,
        fromY: 0,
        fromZoom: 1.1,
        toX: 0.02,
        toY: 0.005,
        toZoom: 1.0,
        easing: 'easeInOut',
      },
      layers: [
        platformLayer(96, 10),
        {
          assetId: 'TRAM',
          role: 'midground',
          order: 14,
          parallax: 0.45,
          opacity: 0.92,
          fit: 'contain',
          scale: 0.68,
          positionX: 240,
          positionY: 26,
          visibleFromFrame: 16,
          visibleToFrame: 78,
          motion: {
            translateXFrom: 0.58,
            translateXTo: -0.58,
            translateYFrom: 0,
            translateYTo: 0,
            easing: 'linear',
          },
        },
        {
          assetId: 'SUBJ-WOMAN',
          role: 'subject',
          order: 20,
          parallax: 0.66,
          opacity: 1,
          fit: 'contain',
          scale: 0.46,
          positionX: -190,
          positionY: 52,
          visibleFromFrame: 0,
          visibleToFrame: 96,
        },
        {
          assetId: 'SUBJ-MAN',
          role: 'subject',
          order: 22,
          parallax: 0.66,
          opacity: 1,
          fit: 'contain',
          scale: 0.48,
          positionX: 190,
          positionY: 48,
          visibleFromFrame: 0,
          visibleToFrame: 96,
        },
        railForeground(96),
      ],
      atmosphere: {kind: 'rain-mist', intensity: 0.8, windX: -0.14},
    },
  },
  {
    id: 'SHOT-D',
    startFrame: SHOT_D[0],
    endFrame: SHOT_D[1],
    renderer: 'parallax-2p5d',
    params: {background: '#04070c'},
    media: {
      ...baseMedia(),
      camera: {
        kind: 'pull-back',
        fromX: 0.02,
        fromY: 0.01,
        fromZoom: 1.06,
        toX: 0.05,
        toY: 0.02,
        toZoom: 1.01,
        easing: 'easeInOut',
      },
      layers: [
        platformLayer(72, 10),
        {
          assetId: 'TRAM',
          role: 'midground',
          order: 14,
          parallax: 0.4,
          opacity: 0.9,
          fit: 'contain',
          scale: 0.58,
          positionX: -40,
          positionY: 46,
          visibleFromFrame: 0,
          visibleToFrame: 72,
          motion: {
            translateXFrom: 0.02,
            translateXTo: 0.62,
            translateYFrom: 0,
            translateYTo: 0,
            easing: 'easeInOut',
          },
        },
        {
          assetId: 'SUBJ-WOMAN',
          role: 'subject',
          order: 20,
          parallax: 0.9,
          opacity: 1,
          fit: 'contain',
          scale: 0.46,
          positionX: -70,
          positionY: 54,
          visibleFromFrame: 0,
          visibleToFrame: 72,
        },
        railForeground(72),
      ],
      atmosphere: {kind: 'rain-mist', intensity: 0.55, windX: -0.08},
      light: {
        amplitude: 0.06,
        frequency: 0.3,
        phase: 0.5,
        sweep: {intensity: 0.18, fromX: 0.2, toX: 0.85, width: 0.2, color: '#e29a4a'},
      },
    },
  },
];

const animeShots = [
  {
    id: 'SHOT-A',
    startFrame: SHOT_A[0],
    endFrame: SHOT_A[1],
    renderer: 'parallax-2p5d',
    params: {background: '#0b1733'},
    media: {
      ...baseMedia(),
      camera: {
        kind: 'pan',
        fromX: 0.02,
        fromY: 0.02,
        fromZoom: 1.0,
        toX: -0.04,
        toY: -0.01,
        toZoom: 1.0,
        easing: 'linear',
      },
      layers: [
        platformLayer(96, 10),
        {
          assetId: 'TRAM',
          role: 'midground',
          order: 14,
          parallax: 0.45,
          opacity: 1,
          fit: 'contain',
          scale: 0.6,
          positionX: 290,
          positionY: 44,
          visibleFromFrame: 30,
          visibleToFrame: 96,
          motion: {
            translateXFrom: 0.42,
            translateXTo: -0.24,
            translateYFrom: 0,
            translateYTo: 0,
            easing: 'linear',
          },
        },
        {
          assetId: 'SUBJ-WOMAN',
          role: 'subject',
          order: 20,
          parallax: 0.62,
          opacity: 1,
          fit: 'contain',
          scale: 0.58,
          positionX: -220,
          positionY: 58,
          visibleFromFrame: 0,
          visibleToFrame: 96,
        },
        {
          assetId: 'SUBJ-MAN',
          role: 'subject',
          order: 22,
          parallax: 0.66,
          opacity: 1,
          fit: 'contain',
          scale: 0.6,
          positionX: 110,
          positionY: 48,
          visibleFromFrame: 0,
          visibleToFrame: 96,
        },
        railForeground(96),
      ],
      atmosphere: {kind: 'rain', intensity: 0.82, windX: -0.2},
      light: {amplitude: 0.05, frequency: 0.6, phase: 0.2},
      comic: comicFor(96, {
        halftone: 0.36,
        speedLines: 0.18,
        wipes: [{frame: 0, direction: 'left', holdFrames: 4, color: '#0a0a12'}],
        impacts: [{frame: 30, intensity: 0.55, color: '#ffd166'}],
      }),
    },
  },
  {
    id: 'SHOT-B',
    startFrame: SHOT_B[0],
    endFrame: SHOT_B[1],
    renderer: 'parallax-2p5d',
    params: {background: '#0a1430'},
    media: {
      ...baseMedia(),
      background: {...baseMedia().background, assetId: 'BG-CLOSE'},
      camera: {
        kind: 'push-in',
        fromX: 0,
        fromY: 0,
        fromZoom: 1.0,
        toX: 0,
        toY: 0,
        toZoom: 1.12,
        easing: 'easeInOut',
      },
      layers: [
        {
          assetId: 'MG-BOKEH',
          role: 'midground',
          order: 10,
          parallax: 0.26,
          opacity: 1,
          fit: 'cover',
          visibleFromFrame: 0,
          visibleToFrame: 96,
        },
        {
          assetId: 'SUBJ-WOMAN-CLOSE',
          role: 'subject',
          order: 20,
          parallax: 0.7,
          opacity: 1,
          fit: 'contain',
          scale: 0.96,
          positionX: 18,
          positionY: 26,
          visibleFromFrame: 0,
          visibleToFrame: 96,
        },
        railForeground(96, 0.95),
      ],
      atmosphere: {kind: 'none', intensity: 0, windX: 0},
      light: {amplitude: 0, frequency: 0, phase: 0},
      comic: comicFor(96, {
        halftone: 0.42,
        speedLines: 0.55,
        impacts: [
          {frame: 34, intensity: 0.7, color: '#ffd166'},
          {frame: 52, intensity: 0.45, color: '#e64545'},
        ],
        wipes: [{frame: 0, direction: 'up', holdFrames: 3, color: '#0a0a12'}],
      }),
    },
  },
  {
    id: 'SHOT-C',
    startFrame: SHOT_C[0],
    endFrame: SHOT_C[1],
    renderer: 'parallax-2p5d',
    params: {background: '#0b1733'},
    media: {
      ...baseMedia(),
      camera: {
        kind: 'pull-back',
        fromX: -0.03,
        fromY: 0,
        fromZoom: 1.14,
        toX: 0.03,
        toY: 0.01,
        toZoom: 1.0,
        easing: 'easeInOut',
      },
      layers: [
        platformLayer(96, 10),
        {
          assetId: 'TRAM',
          role: 'midground',
          order: 14,
          parallax: 0.45,
          opacity: 1,
          fit: 'contain',
          scale: 0.66,
          positionX: 220,
          positionY: 30,
          visibleFromFrame: 12,
          visibleToFrame: 76,
          motion: {
            translateXFrom: 0.62,
            translateXTo: -0.62,
            translateYFrom: 0,
            translateYTo: 0,
            easing: 'linear',
          },
        },
        {
          assetId: 'SUBJ-WOMAN',
          role: 'subject',
          order: 20,
          parallax: 0.68,
          opacity: 1,
          fit: 'contain',
          scale: 0.62,
          positionX: -178,
          positionY: 52,
          visibleFromFrame: 0,
          visibleToFrame: 96,
        },
        {
          assetId: 'SUBJ-MAN',
          role: 'subject',
          order: 22,
          parallax: 0.68,
          opacity: 1,
          fit: 'contain',
          scale: 0.64,
          positionX: 182,
          positionY: 44,
          visibleFromFrame: 0,
          visibleToFrame: 96,
        },
        railForeground(96),
      ],
      atmosphere: {kind: 'rain', intensity: 0.9, windX: -0.22},
      light: {amplitude: 0.04, frequency: 0.5, phase: 0.6},
      comic: comicFor(96, {
        halftone: 0.4,
        speedLines: 0.3,
        impacts: [{frame: 26, intensity: 0.5, color: '#e64545'}],
        wipes: [{frame: 0, direction: 'right', holdFrames: 3, color: '#0a0a12'}],
      }),
    },
  },
  {
    id: 'SHOT-D',
    startFrame: SHOT_D[0],
    endFrame: SHOT_D[1],
    renderer: 'parallax-2p5d',
    params: {background: '#080f24'},
    media: {
      ...baseMedia(),
      camera: {
        kind: 'pull-back',
        fromX: 0.02,
        fromY: 0.02,
        fromZoom: 1.08,
        toX: 0.06,
        toY: 0.03,
        toZoom: 1.01,
        easing: 'easeInOut',
      },
      layers: [
        platformLayer(72, 10),
        {
          assetId: 'TRAM',
          role: 'midground',
          order: 14,
          parallax: 0.4,
          opacity: 0.95,
          fit: 'contain',
          scale: 0.56,
          positionX: -60,
          positionY: 50,
          visibleFromFrame: 0,
          visibleToFrame: 72,
          motion: {
            translateXFrom: 0.0,
            translateXTo: 0.66,
            translateYFrom: 0,
            translateYTo: 0,
            easing: 'easeInOut',
          },
        },
        {
          assetId: 'SUBJ-WOMAN',
          role: 'subject',
          order: 20,
          parallax: 0.9,
          opacity: 1,
          fit: 'contain',
          scale: 0.6,
          positionX: -54,
          positionY: 56,
          visibleFromFrame: 0,
          visibleToFrame: 72,
        },
        railForeground(72),
      ],
      atmosphere: {kind: 'rain', intensity: 0.5, windX: -0.1},
      light: {amplitude: 0.03, frequency: 0.3, phase: 0.4},
      comic: comicFor(72, {
        halftone: 0.26,
        speedLines: 0,
        impacts: [{frame: 6, intensity: 0.3, color: '#14234a'}],
      }),
    },
  },
];

const DEPTH_OF_FIELD = {
  cinematic: {
    'SHOT-A': {background: 2.2, midground: 0.8, subject: 0, foreground: 3.2},
    'SHOT-B': {background: 3.6, midground: 0.6, subject: 0, foreground: 4.6},
    'SHOT-C': {background: 2.4, midground: 0.9, subject: 0, foreground: 3.6},
    'SHOT-D': {background: 2.6, midground: 1.0, subject: 0, foreground: 3.8},
  },
  anime: {
    'SHOT-A': {background: 0.6, midground: 0, subject: 0, foreground: 1.2},
    'SHOT-B': {background: 1.0, midground: 0, subject: 0, foreground: 1.6},
    'SHOT-C': {background: 0.7, midground: 0, subject: 0, foreground: 1.4},
    'SHOT-D': {background: 0.5, midground: 0, subject: 0, foreground: 1.0},
  },
};

const applyDepthOfField = (shots, plan) =>
  shots.map((shot) => {
    const depth = plan[shot.id] ?? {background: 1, midground: 0.5, subject: 0, foreground: 2};
    shot.media.background = {...shot.media.background, blur: depth.background};
    shot.media.layers = shot.media.layers.map((layer) => ({
      ...layer,
      blur:
        layer.role === 'foreground'
          ? depth.foreground
          : layer.role === 'midground'
            ? depth.midground
            : depth.subject,
    }));
    return shot;
  });

const shots = applyDepthOfField(
  set === 'cinematic' ? cinematicShots : animeShots,
  DEPTH_OF_FIELD[set],
);

const styleId =
  set === 'cinematic' ? 'cinematic-illustration-2p5d' : 'anime-motion-comic';
const title =
  set === 'cinematic'
    ? 'Rainy Tram Stop — Cinematic 2.5D Prototype'
    : 'Rainy Tram Stop — Anime Motion Comic Prototype';

const config = {
  schemaVersion: 1,
  projectId,
  song: {
    title,
    artist: 'MVFoundry Original Synthetic Score',
  },
  audio: {
    path: 'source/audio/score-15s.wav',
    sha256: sha256(audioPath),
    durationSeconds: DURATION_SECONDS,
    durationPolicy: 'round',
    format: 'wav-pcm',
    mixSampleRate: 48000,
    gainDb: 0,
    fadeInFrames: 0,
    fadeOutFrames: 0,
    gainAutomation: [],
  },
  lyrics: {language: 'none', path: null},
  narrative: {mode: 'narrative'},
  visual: {
    styleProfile: styleId,
    defaultRenderer: 'parallax-2p5d',
    style: {id: styleId, note: 'P1-G-B synthetic prototype; artistic verdict pending human review'},
  },
  output: {width: 1280, height: 720, fps: FPS},
  cues: [
    {id: 'CUE-A', frame: 0, timeSeconds: 0, source: 'synthetic', label: 'establishing'},
    {id: 'CUE-B', frame: 96, timeSeconds: 4, source: 'synthetic', label: 'realisation'},
    {id: 'CUE-C', frame: 192, timeSeconds: 8, source: 'synthetic', label: 'separation'},
    {id: 'CUE-D', frame: 288, timeSeconds: 12, source: 'synthetic', label: 'aftermath'},
  ],
  chapters: [
    {
      id: 'CH-01',
      title: 'Rainy tram stop',
      startFrame: 0,
      endFrame: TOTAL,
      shots,
    },
  ],
  sceneModules: [],
  assets,
  permissions: {externalGeneration: false, localOnly: true, allowNetwork: false},
  render: {codec: 'h264', pixelFormat: 'yuv420p', colorSpace: 'bt709', imageFormat: 'png'},
};

writeFileSync(path.join(projectDir, 'project.json'), `${JSON.stringify(config, null, 2)}\n`);
mkdirSync(path.join(projectDir, 'reports'), {recursive: true});
writeFileSync(
  path.join(projectDir, 'reports', 'asset-provenance.json'),
  `${JSON.stringify(
    {
      schemaVersion: 1,
      projectId,
      set,
      artwork: 'Original procedural artwork generated offline by this repository; no downloads, no third-party art, no real actors',
      score,
      generatedBy: 'factory/scripts/seed-style-prototype.mjs',
      assets: assets.map((entry) => ({
        id: entry.id,
        kind: entry.kind,
        path: entry.path,
        sha256: entry.sha256,
        source: entry.source,
        rights: entry.rights,
        approval: entry.approval,
      })),
    },
    null,
    2,
  )}\n`,
);

console.log(
  JSON.stringify(
    {
      projectId,
      set,
      styleId,
      frames: TOTAL,
      fps: FPS,
      seconds: TOTAL / FPS,
      audio: {path: 'source/audio/score-15s.wav', sha256: config.audio.sha256},
      assets: assets.length,
      shots: shots.map((shot) => shot.id),
    },
    null,
    2,
  ),
);
