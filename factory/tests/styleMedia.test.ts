import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {after, before, test} from 'node:test';
import {deflateSync} from 'node:zlib';
import {validateProjectConfig} from '../src/config/validate';
import {DEFAULT_SCENE_REGISTRY} from '../src/scenes/registry';
import {loadProject} from '../src/project/loadProject';
import {probeLayerPng} from '../src/media/pngProbe';
import {renderEvidenceFingerprint, isRenderEvidenceCurrent} from '../src/quality/evidence';
import {
  resolveLayerDepthTransform,
  sampleCamera,
  quantizeMotionFrame,
} from '../src/scenes/parallaxMath';
import type {CameraMoveConfig} from '../src/config/types';
import {
  createProjectWriteBoundary,
  resolveRenderOutputPath,
} from '../src/workspace/writeBoundary';
import {EXAMPLES, REPO_ROOT, makeWorkspace} from './helpers';

const rendererKinds = new Set(DEFAULT_SCENE_REGISTRY.kinds());
const validate = (raw: unknown) => validateProjectConfig(raw, {rendererKinds});

const LAYER_SHA = 'c'.repeat(64);
const VIDEO_SHA = 'd'.repeat(64);
const IMAGE_SHA = 'e'.repeat(64);
const MODULE_SHA = 'f'.repeat(64);
const AUDIO_SHA = 'a'.repeat(64);

const camera: CameraMoveConfig = {
  kind: 'push-in',
  fromX: 0,
  fromY: 0,
  fromZoom: 1,
  toX: 0,
  toY: 0,
  toZoom: 1.08,
  easing: 'easeInOut',
};

const parallaxMedia = (overrides: Record<string, unknown> = {}) => ({
  kind: 'parallax-2p5d',
  background: {
    kind: 'image',
    assetId: 'IMAGE-01',
    opacity: 1,
    fit: 'cover',
    positionX: 0,
    positionY: 0,
    scale: 1,
    parallax: 0.04,
  },
  layers: [
    {
      assetId: 'LAYER-01',
      role: 'midground',
      order: 10,
      parallax: 0.25,
      opacity: 1,
      fit: 'cover',
      visibleFromFrame: 0,
      visibleToFrame: 9,
    },
    {
      assetId: 'LAYER-02',
      role: 'subject',
      order: 20,
      parallax: 0.62,
      opacity: 1,
      fit: 'cover',
      visibleFromFrame: 0,
      visibleToFrame: 9,
      motion: {
        translateXFrom: 0,
        translateXTo: 0.02,
        translateYFrom: 0,
        translateYTo: 0.01,
        easing: 'linear',
      },
    },
    {
      assetId: 'LAYER-03',
      role: 'foreground',
      order: 30,
      parallax: 0.95,
      opacity: 0.9,
      fit: 'cover',
      visibleFromFrame: 0,
      visibleToFrame: 9,
    },
  ],
  camera: {...camera},
  atmosphere: {kind: 'rain', intensity: 0.6, windX: -0.08},
  light: {amplitude: 0.12, frequency: 0.8, phase: 0.2},
  ...overrides,
});

const baseConfig = (
  styleId = 'cinematic-illustration-2p5d',
  options: {declaredStyles?: string[]; shots?: unknown[]} = {},
): Record<string, any> => {
  const shots =
    options.shots ?? [
      {
        id: 'SHOT-01',
        startFrame: 0,
        endFrame: 9,
        renderer: 'project:style-module',
        params: {background: '#05080d'},
      },
      {
        id: 'SHOT-02',
        startFrame: 9,
        endFrame: 18,
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
        id: 'SHOT-03',
        startFrame: 18,
        endFrame: 27,
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
              assetId: 'LAYER-01',
              order: 5,
              opacity: 0.8,
              fit: 'contain',
              visibleFromFrame: 0,
              visibleToFrame: 9,
            },
          ],
          overlay: {kind: 'rain', intensity: 0.5},
        },
      },
      {
        id: 'SHOT-04',
        startFrame: 27,
        endFrame: 36,
        renderer: 'parallax-2p5d',
        params: {background: '#05080d'},
        media: parallaxMedia({
          layers: [
            {
              assetId: 'LAYER-01',
              role: 'midground',
              order: 10,
              parallax: 0.25,
              opacity: 1,
              fit: 'cover',
              visibleFromFrame: 0,
              visibleToFrame: 9,
            },
            {
              assetId: 'LAYER-02',
              role: 'subject',
              order: 20,
              parallax: 0.62,
              opacity: 1,
              fit: 'cover',
              visibleFromFrame: 0,
              visibleToFrame: 9,
            },
            {
              assetId: 'LAYER-03',
              role: 'foreground',
              order: 30,
              parallax: 0.95,
              opacity: 0.9,
              fit: 'cover',
              visibleFromFrame: 0,
              visibleToFrame: 9,
            },
          ],
        }),
      },
    ];

  return {
    schemaVersion: 1,
    projectId: 'synthetic-style-media-demo',
    song: {title: 'Synthetic Style Media', artist: 'MVFoundry Synthetic Fixture'},
    audio: {
      path: 'source/audio/tone.wav',
      sha256: AUDIO_SHA,
      durationSeconds: 1.5,
      durationPolicy: 'round',
      format: 'wav-pcm',
    },
    lyrics: {language: 'none', path: null},
    narrative: {mode: 'narrative'},
    visual: {
      styleProfile: styleId,
      defaultRenderer: 'project:style-module',
      style: {id: styleId},
    },
    output: {width: 640, height: 360, fps: 24},
    cues: [],
    chapters: [
      {
        id: 'CH-01',
        title: 'Style media',
        startFrame: 0,
        endFrame: 36,
        shots,
      },
    ],
    sceneModules: [
      {
        id: 'style-module',
        path: 'scenes/style.ts',
        moduleType: 'canvas2d',
        contractVersion: 1,
        sha256: MODULE_SHA,
        trust: 'user-authored-approved',
        canvas: {mode: 'output'},
        samplingFps: 'output',
        pixelated: false,
        styleIds: options.declaredStyles ?? [styleId],
      },
    ],
    assets: [
      {
        id: 'IMAGE-01',
        kind: 'image',
        path: 'assets/plates/background.png',
        sha256: IMAGE_SHA,
        source: 'Original synthetic artwork generated offline by MVFoundry',
        rights: 'Original synthetic artwork; no third-party rights',
        approval: 'approved',
      },
      {
        id: 'VIDEO-01',
        kind: 'video',
        path: 'assets/video/plate.mp4',
        sha256: VIDEO_SHA,
        source: 'Original synthetic fixture',
        rights: 'Original synthetic fixture; no third-party rights',
        approval: 'approved',
      },
      {
        id: 'LAYER-01',
        kind: 'layer',
        path: 'assets/layers/midground.png',
        sha256: LAYER_SHA,
        source: 'Original synthetic artwork generated offline by MVFoundry',
        rights: 'Original synthetic artwork; no third-party rights',
        approval: 'approved',
      },
      {
        id: 'LAYER-02',
        kind: 'layer',
        path: 'assets/layers/subject.png',
        sha256: LAYER_SHA,
        source: 'Original synthetic artwork generated offline by MVFoundry',
        rights: 'Original synthetic artwork; no third-party rights',
        approval: 'approved',
      },
      {
        id: 'LAYER-03',
        kind: 'layer',
        path: 'assets/layers/foreground.png',
        sha256: LAYER_SHA,
        source: 'Original synthetic artwork generated offline by MVFoundry',
        rights: 'Original synthetic artwork; no third-party rights',
        approval: 'approved',
      },
    ],
    permissions: {externalGeneration: false, localOnly: true, allowNetwork: false},
    render: {codec: 'h264', pixelFormat: 'yuv420p', colorSpace: 'bt709', imageFormat: 'png'},
  };
};

const withShot = (mutate: (shot: any) => void, index = 0) => {
  const config = baseConfig();
  mutate(config.chapters[0].shots[index]);
  return config;
};

test('every style declares its media routes and none is assumed compatible', () => {
  const cinematic = validate(baseConfig()).visual.style;
  assert.equal(cinematic?.id, 'cinematic-illustration-2p5d');

  const validated = validate(baseConfig());
  assert.equal(validated.chapters[0].shots.length, 4);
  assert.equal(validated.chapters[0].shots[3].media?.kind, 'parallax-2p5d');
});

test('a styled Canvas shot can be followed by styled Video and Hybrid shots', () => {
  const config = validate(baseConfig());
  assert.deepEqual(
    config.chapters[0].shots.map((shot) => shot.renderer),
    ['project:style-module', 'video', 'hybrid', 'parallax-2p5d'],
  );
  const parallax = config.chapters[0].shots[3].media;
  assert.equal(parallax?.kind, 'parallax-2p5d');
  if (parallax?.kind !== 'parallax-2p5d') return;
  assert.equal(parallax.layers.length, 3);
  assert.equal(parallax.camera.kind, 'push-in');
});

test('unsupported style and backend combinations fail closed', () => {
  const retro = baseConfig('retro-pixel');
  assert.throws(() => validate(retro), /does not declare/);

  const diorama = baseConfig('stylized-3d-diorama', {declaredStyles: ['stylized-3d-diorama']});
  assert.throws(() => validate(diorama), /parallax-2p5d, which style stylized-3d-diorama does not declare/);

  const comicOnCinematic = withShot((shot) => {
    if (shot.media?.kind === 'parallax-2p5d') {
      shot.media.comic = {halftone: 0.4};
    }
  }, 3);
  assert.throws(() => validate(comicOnCinematic), /does not support comic-treatment/);

  const anime = baseConfig('anime-motion-comic', {declaredStyles: ['anime-motion-comic']});
  anime.chapters[0].shots[3].media.comic = {halftone: 0.4, speedLines: 0.3, motionStepFps: 8};
  const validatedAnime = validate(anime);
  const animeMedia = validatedAnime.chapters[0].shots[3].media;
  assert.equal(animeMedia?.kind, 'parallax-2p5d');
  assert.equal(
    animeMedia?.kind === 'parallax-2p5d' ? animeMedia.comic?.motionStepFps : undefined,
    8,
  );
});

test('unapproved or wrong-kind assets are rejected before any render', () => {
  const pendingVideo = baseConfig();
  pendingVideo.assets[1].approval = 'pending';
  assert.throws(() => validate(pendingVideo), /references asset VIDEO-01 with approval pending/);

  const pendingLayer = baseConfig();
  pendingLayer.assets[2].approval = 'rejected';
  assert.throws(() => validate(pendingLayer), /approval rejected/);

  const swapped = baseConfig();
  swapped.chapters[0].shots[3].media.layers[0].assetId = 'IMAGE-01';
  assert.throws(() => validate(swapped), /requires asset kind layer, received image/);

  const videoAsPlane = baseConfig();
  videoAsPlane.chapters[0].shots[3].media.background = {
    ...videoAsPlane.chapters[0].shots[3].media.background,
    kind: 'image',
    assetId: 'VIDEO-01',
  };
  assert.throws(() => validate(videoAsPlane), /requires asset kind image, received video/);
});

test('missing media, invalid in-points and wrong media kinds fail closed', () => {
  const missing = withShot((shot) => {
    delete shot.media;
  }, 1);
  assert.throws(() => validate(missing), /media is required for the video renderer/);

  const unaligned = withShot((shot) => {
    shot.media.sourceStartSeconds = 0.13;
  }, 1);
  assert.throws(() => validate(unaligned), /must align to an output-frame boundary/);

  const mismatched = withShot((shot) => {
    shot.media.kind = 'hybrid';
  }, 1);
  assert.throws(() => validate(mismatched), /must match renderer "video"/);

  const unmuted = withShot((shot) => {
    shot.media.muted = false;
  }, 1);
  assert.throws(() => validate(unmuted), /must be true/);

  const mediaOnCanvas = withShot((shot) => {
    shot.media = {kind: 'video'};
  }, 0);
  assert.throws(() => validate(mediaOnCanvas), /media is only valid for/);
});

test('parallax depth contracts reject flat, unordered or opaque-layer disguises', () => {
  const outOfRoleRange = baseConfig();
  outOfRoleRange.chapters[0].shots[3].media.layers[0].parallax = 0.72;
  assert.throws(() => validate(outOfRoleRange), /parallax must be in \[0.1, 0.6\]/);

  const swapped = baseConfig();
  swapped.chapters[0].shots[3].media.layers[0].role = 'foreground';
  swapped.chapters[0].shots[3].media.layers[0].parallax = 0.9;
  swapped.chapters[0].shots[3].media.layers[2].role = 'midground';
  swapped.chapters[0].shots[3].media.layers[2].parallax = 0.25;
  assert.throws(() => validate(swapped), /draw order is wrong|at least one subject|at least one foreground/);

  const noForeground = baseConfig();
  noForeground.chapters[0].shots[3].media.layers = noForeground.chapters[0].shots[3].media.layers.slice(0, 2);
  assert.throws(() => validate(noForeground), /at least one foreground layer/);

  const flatZoomPan = baseConfig();
  flatZoomPan.chapters[0].shots[3].media.camera = {
    kind: 'pan',
    fromX: 0,
    fromY: 0,
    fromZoom: 1,
    toX: 0.1,
    toY: 0,
    toZoom: 1.1,
    easing: 'linear',
  };
  assert.throws(() => validate(flatZoomPan), /pan requires a constant zoom/);

  const outOfBounds = baseConfig();
  outOfBounds.chapters[0].shots[3].media.camera.toX = 0.9;
  assert.throws(() => validate(outOfBounds), /must be in \[-0.25, 0.25\]/);

  const unsafeColour = baseConfig();
  unsafeColour.chapters[0].shots[3].media.grade = {tint: 'url(javascript:alert(1))'};
  assert.throws(() => validate(unsafeColour), /must be a #rrggbb colour/);
});

test('layer ordering and visibility are checked against the shot-local clock', () => {
  const config = withShot((shot) => {
    if (shot.media?.kind === 'parallax-2p5d') {
      shot.media.layers[0].visibleToFrame = 12;
    }
  }, 3);
  assert.throws(() => validate(config), /exceeds the shot-local duration 9/);

  const backwards = withShot((shot) => {
    if (shot.media?.kind === 'parallax-2p5d') {
      shot.media.layers[0].visibleFromFrame = 5;
      shot.media.layers[0].visibleToFrame = 3;
    }
  }, 3);
  assert.throws(() => validate(backwards), /visibility range must be non-empty/);

  const impactOutside = withShot((shot) => {
    if (shot.media?.kind === 'parallax-2p5d') {
      shot.media.comic = {impacts: [{frame: 4, intensity: 0.5}]};
    }
  }, 3);
  // Cinematic does not declare comic treatment, so the capability check fails
  // before any comic frame is accepted.
  assert.throws(() => validate(impactOutside), /comic-treatment/);

  const anime = baseConfig('anime-motion-comic', {declaredStyles: ['anime-motion-comic']});
  anime.chapters[0].shots[3].media.comic = {impacts: [{frame: 12, intensity: 0.5}]};
  assert.throws(() => validate(anime), /inside the shot-local duration 9/);
});

test('legacy projects without visual.style keep their previous behaviour', () => {
  const legacy = JSON.parse(
    readFileSync(
      path.join(REPO_ROOT, 'factory', 'examples', 'media-projects', 'synthetic-hybrid-demo', 'project.template.json'),
      'utf8',
    ),
  );
  const validated = validate(legacy);
  assert.equal(validated.visual.style, undefined);
  assert.equal(validated.visual.defaultRenderer, 'hybrid');
  assert.equal(validated.chapters[0].shots[0].renderer, 'hybrid');
});

test('a style change invalidates previously written render evidence', () => {
  const config = validate(baseConfig());
  const first = renderEvidenceFingerprint(config, 36);
  const repeat = renderEvidenceFingerprint(config, 36);
  assert.equal(first.hash, repeat.hash);
  assert.equal(isRenderEvidenceCurrent({hash: first.hash}, repeat), true);

  const themed = validate({
    ...baseConfig(),
    visual: {styleProfile: 'cinematic-illustration-2p5d', defaultRenderer: 'project:style-module', style: {id: 'cinematic-illustration-2p5d', theme: 'coral-noir'}},
  });
  const changed = renderEvidenceFingerprint(themed, 36);
  assert.notEqual(changed.hash, first.hash);
  assert.equal(isRenderEvidenceCurrent({hash: first.hash}, changed), false);
  assert.equal(isRenderEvidenceCurrent(null, changed), false);
});

test('parallax displacement differs by depth and is deterministic', () => {
  const cameraMove = camera;
  const mid = {parallax: 0.25, scale: 1};
  const subjectLayer = {parallax: 0.62, scale: 1};
  const foreground = {parallax: 0.95, scale: 1};
  const at = (frame: number) =>
    sampleCamera(cameraMove, frame, 9);
  const transform = (layer: {parallax: number; scale: number}, frame: number) =>
    resolveLayerDepthTransform(layer, cameraMove, at(frame), frame, 9);

  const midStart = transform(mid, 0);
  const midEnd = transform(mid, 8);
  const foregroundEnd = transform(foreground, 8);
  assert.deepEqual(transform(mid, 8), midEnd, 'the same frame must reproduce the same transform');
  assert.ok(
    Math.abs(foregroundEnd.scale - 1) > Math.abs(midEnd.scale - 1),
    'the nearer layer must change scale faster',
  );
  assert.equal(midStart.translateX, 0);
  assert.equal(midEnd.translateX, 0);
  assert.ok(foregroundEnd.translateY <= 0);
  assert.ok(foregroundEnd.scale > subjectLayer.scale);
});

test('quantised comic motion holds the same pose across output frames', () => {
  assert.equal(quantizeMotionFrame(0, 24, 8), 0);
  assert.equal(quantizeMotionFrame(2, 24, 8), 0);
  assert.equal(quantizeMotionFrame(3, 24, 8), 1);
  assert.equal(quantizeMotionFrame(8, 24, 8), 2);
  assert.equal(quantizeMotionFrame(8, 24, 24), 8);
});

// ---------------------------------------------------------------------------
// Filesystem-facing tests: hashes, PNG alpha, symlinks, staging and outputs.
// ---------------------------------------------------------------------------

let workspace: string;

const PROJECT_ID = 'synthetic-style-media-fs';
const TONE = path.join(EXAMPLES, 'synthetic-layered-demo', 'source', 'audio', 'tone-1.5s.wav');
const BACKGROUND = path.join(EXAMPLES, 'synthetic-layered-demo', 'assets', 'images', 'bg.png');

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

const crc32 = (buffer: Buffer): number => {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
};

const pngChunk = (type: string, data: Buffer): Buffer => {
  const name = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([name, data])), 0);
  return Buffer.concat([length, name, data, crc]);
};

const writeRgbPng = (file: string): void => {
  const width = 8;
  const height = 8;
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 3 + 1);
    raw[row] = 0;
    for (let x = 0; x < width; x += 1) {
      const index = row + 1 + x * 3;
      raw[index] = 200;
      raw[index + 1] = 120;
      raw[index + 2] = 80;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
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

const sha256Of = (file: string): string =>
  createHash('sha256').update(readFileSync(file)).digest('hex');

const createFsProject = (projectId = PROJECT_ID): string => {
  const dir = path.join(workspace, projectId);
  mkdirSync(path.join(dir, 'source', 'audio'), {recursive: true});
  mkdirSync(path.join(dir, 'assets', 'plates'), {recursive: true});
  mkdirSync(path.join(dir, 'assets', 'layers'), {recursive: true});
  mkdirSync(path.join(dir, 'scenes'), {recursive: true});
  copyFileSync(TONE, path.join(dir, 'source', 'audio', 'tone.wav'));
  copyFileSync(BACKGROUND, path.join(dir, 'assets', 'plates', 'background.png'));
  copyFileSync(BACKGROUND, path.join(dir, 'assets', 'layers', 'midground.png'));
  copyFileSync(BACKGROUND, path.join(dir, 'assets', 'layers', 'subject.png'));
  copyFileSync(BACKGROUND, path.join(dir, 'assets', 'layers', 'foreground.png'));
  writeFileSync(
    path.join(dir, 'scenes', 'style.ts'),
    'export default {id:"style-module",contractVersion:1,moduleType:"canvas2d",params:[],supportedStyles:["cinematic-illustration-2p5d"],render(){}};',
  );

  const config = baseConfig();
  config.projectId = projectId;
  config.audio.sha256 = sha256Of(path.join(dir, 'source', 'audio', 'tone.wav'));
  config.sceneModules[0].sha256 = sha256Of(path.join(dir, 'scenes', 'style.ts'));
  const imageSha = sha256Of(path.join(dir, 'assets', 'plates', 'background.png'));
  const layerSha = sha256Of(path.join(dir, 'assets', 'layers', 'midground.png'));
  config.assets = [
    {id: 'IMAGE-01', kind: 'image', path: 'assets/plates/background.png', sha256: imageSha, source: 'Original synthetic', rights: 'Original synthetic', approval: 'approved'},
    {id: 'LAYER-01', kind: 'layer', path: 'assets/layers/midground.png', sha256: layerSha, source: 'Original synthetic', rights: 'Original synthetic', approval: 'approved'},
    {id: 'LAYER-02', kind: 'layer', path: 'assets/layers/subject.png', sha256: layerSha, source: 'Original synthetic', rights: 'Original synthetic', approval: 'approved'},
    {id: 'LAYER-03', kind: 'layer', path: 'assets/layers/foreground.png', sha256: layerSha, source: 'Original synthetic', rights: 'Original synthetic', approval: 'approved'},
  ];
  config.chapters[0].shots = [
    {
      id: 'SHOT-01',
      startFrame: 0,
      endFrame: 18,
      renderer: 'project:style-module',
      params: {background: '#05080d'},
    },
    {
      id: 'SHOT-02',
      startFrame: 18,
      endFrame: 36,
      renderer: 'parallax-2p5d',
      params: {background: '#05080d'},
      media: parallaxMedia({
        layers: [
          {assetId: 'LAYER-01', role: 'midground', order: 10, parallax: 0.25, opacity: 1, fit: 'cover', visibleFromFrame: 0, visibleToFrame: 18},
          {assetId: 'LAYER-02', role: 'subject', order: 20, parallax: 0.62, opacity: 1, fit: 'cover', visibleFromFrame: 0, visibleToFrame: 18},
          {assetId: 'LAYER-03', role: 'foreground', order: 30, parallax: 0.95, opacity: 0.9, fit: 'cover', visibleFromFrame: 0, visibleToFrame: 18},
        ],
      }),
    },
  ];
  writeFileSync(path.join(dir, 'project.json'), `${JSON.stringify(config, null, 2)}\n`);
  return dir;
};

before(() => {
  workspace = makeWorkspace();
});

after(() => {
  rmSync(workspace, {recursive: true, force: true});
});

test('the asset-backed route loads, verifies hashes and stages plate and layers', () => {
  createFsProject();
  const project = loadProject(PROJECT_ID, {workspaceRoot: workspace, engineRoot: REPO_ROOT});
  assert.equal(project.shots.length, 2);
  assert.equal(project.shots[1].shot.renderer, 'parallax-2p5d');
  const image = project.assets.find((asset) => asset.id === 'IMAGE-01');
  assert.ok(image?.imageMetadata, 'background plates are probed on the 2.5D route');
  assert.equal(image?.imageMetadata?.hasAlpha, true);
  const layer = project.assets.find((asset) => asset.id === 'LAYER-01');
  assert.equal(layer?.kind, 'layer');
});

test('a modified asset hash is refused instead of rendering stale media', () => {
  const dir = createFsProject('synthetic-style-media-fs-hash');
  const config = JSON.parse(readFileSync(path.join(dir, 'project.json'), 'utf8'));
  config.assets[0].sha256 = '9'.repeat(64);
  writeFileSync(path.join(dir, 'project.json'), `${JSON.stringify(config, null, 2)}\n`);
  assert.throws(
    () => loadProject('synthetic-style-media-fs-hash', {workspaceRoot: workspace, engineRoot: REPO_ROOT}),
    /Asset SHA256 mismatch for IMAGE-01/,
  );
});

test('an opaque RGB PNG cannot pass the transparent-layer intake', () => {
  const dir = createFsProject('synthetic-style-media-fs-alpha');
  const rgbFile = path.join(dir, 'assets', 'layers', 'midground.png');
  writeRgbPng(rgbFile);
  assert.throws(() => probeLayerPng(rgbFile, 'LAYER-01'), /must be an RGBA or grayscale-alpha PNG/);

  const config = JSON.parse(readFileSync(path.join(dir, 'project.json'), 'utf8'));
  config.assets[1].sha256 = sha256Of(rgbFile);
  writeFileSync(path.join(dir, 'project.json'), `${JSON.stringify(config, null, 2)}\n`);
  assert.throws(
    () => loadProject('synthetic-style-media-fs-alpha', {workspaceRoot: workspace, engineRoot: REPO_ROOT}),
    /must be an RGBA or grayscale-alpha PNG/,
  );
});

test('cross-project and linked asset paths cannot be used as media', (t) => {
  const dir = createFsProject('synthetic-style-media-fs-link');
  const config = JSON.parse(readFileSync(path.join(dir, 'project.json'), 'utf8'));
  config.assets[0].path = '../synthetic-style-media-fs/assets/plates/background.png';
  writeFileSync(path.join(dir, 'project.json'), `${JSON.stringify(config, null, 2)}\n`);
  assert.throws(
    () => loadProject('synthetic-style-media-fs-link', {workspaceRoot: workspace, engineRoot: REPO_ROOT}),
    /parent traversal|must not contain parent traversal/,
  );

  const dir2 = createFsProject('synthetic-style-media-fs-junction');
  const outside = mkdtempSync(path.join(tmpdir(), 'mv-style-outside-'));
  copyFileSync(BACKGROUND, path.join(outside, 'outside.png'));
  const link = path.join(dir2, 'assets', 'linked');
  try {
    symlinkSync(outside, link, 'junction');
  } catch {
    rmSync(outside, {recursive: true, force: true});
    t.skip('junction creation is unavailable on this host');
    return;
  }
  try {
    const config2 = JSON.parse(readFileSync(path.join(dir2, 'project.json'), 'utf8'));
    config2.assets[0].path = 'assets/linked/outside.png';
    config2.assets[0].sha256 = sha256Of(path.join(outside, 'outside.png'));
    writeFileSync(path.join(dir2, 'project.json'), `${JSON.stringify(config2, null, 2)}\n`);
    assert.throws(
      () => loadProject('synthetic-style-media-fs-junction', {workspaceRoot: workspace, engineRoot: REPO_ROOT}),
      /escapes the project|link|Links are forbidden/i,
    );
  } finally {
    rmSync(outside, {recursive: true, force: true});
  }
});

test('unsafe render output paths stay outside the write boundary', () => {
  createFsProject();
  const project = loadProject(PROJECT_ID, {workspaceRoot: workspace, engineRoot: REPO_ROOT});
  const boundary = createProjectWriteBoundary(project, {engineRoot: REPO_ROOT});
  assert.throws(
    () => resolveRenderOutputPath(boundary, {mode: 'still', projectId: PROJECT_ID, frame: 0, requested: '../escape.png'}),
    /single filename/,
  );
  assert.throws(
    () =>
      resolveRenderOutputPath(boundary, {
        mode: 'still',
        projectId: PROJECT_ID,
        frame: 0,
        requested: path.join(tmpdir(), 'escape.png'),
      }),
    /direct child of the project renders directory/,
  );
  assert.equal(
    existsSync(path.join(project.projectDir, 'renders', 'safe.png')),
    false,
  );
});
