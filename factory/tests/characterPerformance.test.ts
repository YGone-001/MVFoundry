import assert from 'node:assert/strict';
import {test} from 'node:test';
import {validateProjectConfig} from '../src/config/validate';
import {validatePlannedMedia} from '../src/preproduction/validate';
import {DEFAULT_SCENE_REGISTRY} from '../src/scenes/registry';
import {
  activePoseIndex,
  mergeDrawOrder,
  resolveCharacterDepthTransform,
  sampleCamera,
  sampleCharacterPerformance,
} from '../src/scenes/parallaxMath';
import type {CameraMoveConfig, ParallaxCharacterConfig, ParallaxPoseKeyframe} from '../src/config/types';

const rendererKinds = new Set(DEFAULT_SCENE_REGISTRY.kinds());
const validate = (raw: unknown) => validateProjectConfig(raw, {rendererKinds});

const LAYER_SHA = 'b'.repeat(64);
const IMAGE_SHA = 'c'.repeat(64);
const AUDIO_SHA = 'a'.repeat(64);

const camera: CameraMoveConfig = {
  kind: 'push-in',
  fromX: 0,
  fromY: 0,
  fromZoom: 1,
  toX: 0,
  toY: 0,
  toZoom: 1.06,
  easing: 'easeInOut',
};

const poses: ParallaxPoseKeyframe[] = [
  {assetId: 'POSE-A', fromFrame: 0, toFrame: 10, transition: 'cut', fadeFrames: 0, offsetX: 0, offsetY: 0, scale: 1, opacity: 1},
  {assetId: 'POSE-B', fromFrame: 10, toFrame: 20, transition: 'crossfade', fadeFrames: 4, offsetX: 0.01, offsetY: 0, scale: 1, opacity: 1},
  {assetId: 'POSE-C', fromFrame: 20, toFrame: 30, transition: 'cut', fadeFrames: 0, offsetX: 0.02, offsetY: -0.01, scale: 1, opacity: 1},
];

const character: ParallaxCharacterConfig = {
  characterId: 'woman',
  role: 'subject',
  order: 20,
  parallax: 0.62,
  anchorX: 0.42,
  anchorY: 0.9,
  pivotX: 0.5,
  pivotY: 0.985,
  height: 0.8,
  breathe: {amplitude: 0.004, periodFrames: 48},
  sway: {amplitude: 0.002, periodFrames: 72},
  poses,
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
      visibleToFrame: 30,
    },
    {
      assetId: 'LAYER-02',
      role: 'foreground',
      order: 30,
      parallax: 0.95,
      opacity: 0.9,
      fit: 'cover',
      visibleFromFrame: 0,
      visibleToFrame: 30,
    },
  ],
  characters: [JSON.parse(JSON.stringify(character))],
  camera: {...camera},
  atmosphere: {kind: 'rain', intensity: 0.6, windX: -0.08},
  light: {amplitude: 0.12, frequency: 0.8, phase: 0.2},
  ...overrides,
});

const baseConfig = (): Record<string, any> => ({
  schemaVersion: 1,
  projectId: 'synthetic-character-performance-demo',
  song: {title: 'Synthetic Character Performance', artist: 'MVFoundry Synthetic Fixture'},
  audio: {
    path: 'source/audio/tone.wav',
    sha256: AUDIO_SHA,
    durationSeconds: 1.25,
    durationPolicy: 'round',
    format: 'wav-pcm',
  },
  lyrics: {language: 'none', path: null},
  narrative: {mode: 'narrative'},
  visual: {styleProfile: 'cinematic-illustration-2p5d', defaultRenderer: 'parallax-2p5d'},
  output: {width: 640, height: 360, fps: 24},
  cues: [],
  chapters: [
    {
      id: 'CH-01',
      title: 'Performance',
      startFrame: 0,
      endFrame: 30,
      shots: [
        {
          id: 'SHOT-B',
          startFrame: 0,
          endFrame: 30,
          renderer: 'parallax-2p5d',
          params: {background: '#05080d'},
          media: parallaxMedia(),
        },
      ],
    },
  ],
  assets: [
    {
      id: 'IMAGE-01',
      kind: 'image',
      path: 'assets/plates/background.png',
      sha256: IMAGE_SHA,
      source: 'Original procedural artwork generated offline by MVFoundry',
      rights: 'Original synthetic artwork; no third-party rights',
      approval: 'approved',
    },
    {
      id: 'LAYER-01',
      kind: 'layer',
      path: 'assets/plates/midground.png',
      sha256: LAYER_SHA,
      source: 'Original procedural artwork generated offline by MVFoundry',
      rights: 'Original synthetic artwork; no third-party rights',
      approval: 'approved',
    },
    {
      id: 'LAYER-02',
      kind: 'layer',
      path: 'assets/plates/foreground.png',
      sha256: LAYER_SHA,
      source: 'Original procedural artwork generated offline by MVFoundry',
      rights: 'Original synthetic artwork; no third-party rights',
      approval: 'approved',
    },
    ...['POSE-A', 'POSE-B', 'POSE-C'].map((id) => ({
      id,
      kind: 'layer',
      path: `assets/poses/${id.toLowerCase()}.png`,
      sha256: LAYER_SHA,
      source: 'Original procedural character artwork generated offline by MVFoundry',
      rights: 'Original synthetic artwork; no third-party rights',
      approval: 'approved',
    })),
  ],
  permissions: {externalGeneration: false, localOnly: true, allowNetwork: false},
  render: {codec: 'h264', pixelFormat: 'yuv420p', colorSpace: 'bt709', imageFormat: 'png'},
});

const withCharacter = (mutate: (entry: any) => void) => {
  const config = baseConfig();
  mutate(config.chapters[0].shots[0].media.characters[0]);
  return config;
};

/* -------------------------------------------------------------------------- */
/* Pose sampling                                                              */
/* -------------------------------------------------------------------------- */

test('a pose track resolves frame-exactly on half-open ranges', () => {
  assert.equal(activePoseIndex(poses, 0), 0);
  assert.equal(activePoseIndex(poses, 9), 0);
  assert.equal(activePoseIndex(poses, 10), 1);
  assert.equal(activePoseIndex(poses, 19), 1);
  assert.equal(activePoseIndex(poses, 20), 2);
  assert.equal(activePoseIndex(poses, 29), 2);
  assert.throws(() => activePoseIndex(poses, 30), /does not cover local frame 30/);
});

test('a cut resolves to one pose on the exact frame', () => {
  const before = sampleCharacterPerformance(character, 9);
  const at = sampleCharacterPerformance(character, 20);
  assert.deepEqual(before.poses.map((entry) => entry.assetId), ['POSE-A']);
  assert.deepEqual(at.poses.map((entry) => entry.assetId), ['POSE-C']);
  assert.equal(at.poses.length, 1);
});

test('a crossfade blends the outgoing and incoming pose deterministically', () => {
  const first = sampleCharacterPerformance(character, 10);
  assert.equal(first.poses.length, 2);
  assert.equal(first.poses[0].assetId, 'POSE-A');
  assert.equal(first.poses[1].assetId, 'POSE-B');
  assert.ok(first.poses[0].opacity > 0 && first.poses[1].opacity > 0);

  const later = sampleCharacterPerformance(character, 14);
  assert.equal(later.poses.length, 1);
  assert.equal(later.poses[0].assetId, 'POSE-B');

  // The same frame always produces the same sample.
  assert.deepEqual(sampleCharacterPerformance(character, 11), sampleCharacterPerformance(character, 11));
});

test('idle life is frame-derived and never feeds camera motion', () => {
  const zero = sampleCharacterPerformance(character, 0);
  assert.equal(zero.idleX, 0);
  assert.equal(zero.idleScale, 1);
  const shifted = sampleCharacterPerformance(character, 12);
  assert.notEqual(shifted.idleX, 0);
  const shaft = sampleCamera(camera, 12, 30);
  assert.equal(shaft.x, 0);
});

test('draw order interleaves layers and characters so occlusion is explicit', () => {
  const layers = [
    {assetId: 'L1', role: 'midground' as const, order: 10},
    {assetId: 'L2', role: 'foreground' as const, order: 30},
  ] as any;
  const entries = mergeDrawOrder(layers, [{...character, order: 20}]);
  assert.deepEqual(
    entries.map((entry) => (entry.kind === 'character' ? `C:${entry.character.characterId}` : `L:${entry.layer.assetId}`)),
    ['L:L1', 'C:woman', 'L:L2'],
  );
});

test('character depth never matches a nearer layer under the same camera move', () => {
  const shaft = {x: 0.1, y: 0.05, zoom: 1.04, progress: 0.5};
  const near = resolveCharacterDepthTransform({parallax: 0.62}, shaft);
  const far = resolveCharacterDepthTransform({parallax: 0.3}, shaft);
  assert.notEqual(near.zoom.toFixed(6), far.zoom.toFixed(6));
  assert.notEqual(near.translateX.toFixed(6), far.translateX.toFixed(6));
  assert.ok(Math.abs(near.translateX) > Math.abs(far.translateX));
});

/* -------------------------------------------------------------------------- */
/* Config validation                                                          */
/* -------------------------------------------------------------------------- */

test('an authored character performance validates', () => {
  const config = validate(baseConfig());
  const media = config.chapters[0].shots[0].media;
  assert.equal(media?.kind, 'parallax-2p5d');
  if (media?.kind !== 'parallax-2p5d') return;
  assert.equal(media.characters?.length, 1);
  assert.equal(media.characters?.[0].poses.length, 3);
  assert.equal(media.characters?.[0].role, 'subject');
});

test('legacy shots without characters keep their previous shape', () => {
  const config = baseConfig();
  delete config.chapters[0].shots[0].media.characters;
  const validated = validate(config);
  const media = validated.chapters[0].shots[0].media;
  if (media?.kind !== 'parallax-2p5d') throw new Error('expected parallax media');
  assert.equal(media.characters, undefined);
});

test('pose tracks must tile the shot with no gap or overlap', () => {
  const overlap = withCharacter((entry) => {
    entry.poses[1].fromFrame = 8;
  });
  assert.throws(() => validate(overlap), /previous pose ended at 10|must tile/);

  const gap = withCharacter((entry) => {
    entry.poses[1].fromFrame = 12;
    entry.poses[1].toFrame = 22;
    entry.poses[2].fromFrame = 22;
  });
  assert.throws(() => validate(gap), /previous pose ended at 12|must tile/);

  const short = withCharacter((entry) => {
    entry.poses[2].toFrame = 28;
  });
  assert.throws(() => validate(short), /the shot lasts 30 frames/);
});

test('a cut cannot declare a fade and a crossfade must fade for 2-12 frames', () => {
  const cutWithFade = withCharacter((entry) => {
    entry.poses[0].fadeFrames = 3;
  });
  assert.throws(() => validate(cutWithFade), /fadeFrames/);

  const longFade = withCharacter((entry) => {
    entry.poses[1].fadeFrames = 14;
  });
  assert.throws(() => validate(longFade), /fadeFrames/);

  const oneFrameFade = withCharacter((entry) => {
    entry.poses[1].fadeFrames = 1;
  });
  assert.throws(() => validate(oneFrameFade), /fadeFrames/);
});

test('a pose must reference an approved layer asset', () => {
  const missing = withCharacter((entry) => {
    entry.poses[0].assetId = 'POSE-UNKNOWN';
  });
  assert.throws(() => validate(missing), /POSE-UNKNOWN/);

  const wrongKind = withCharacter((entry) => {
    entry.poses[0].assetId = 'IMAGE-01';
  });
  assert.throws(() => validate(wrongKind), /requires asset kind layer/);

  const unapproved = baseConfig();
  unapproved.assets.find((asset: any) => asset.id === 'POSE-B').approval = 'pending';
  assert.throws(() => validate(unapproved), /POSE-B/);
});

test('character draw order must stay unambiguous against layers', () => {
  const clash = withCharacter((entry) => {
    entry.order = 10;
  });
  assert.throws(() => validate(clash), /draw order must be unambiguous|duplicate order/);

  const inverted = withCharacter((entry) => {
    entry.order = 31;
  });
  assert.throws(() => validate(inverted), /draw order is wrong/);
});

test('character geometry is bounded and unknown keys are refused', () => {
  const badHeight = withCharacter((entry) => {
    entry.height = 3;
  });
  assert.throws(() => validate(badHeight), /height/);

  const badParallax = withCharacter((entry) => {
    entry.parallax = 0.2;
  });
  assert.throws(() => validate(badParallax), /parallax/);

  const extraKey = withCharacter((entry) => {
    entry.flip = true;
  });
  assert.throws(() => validate(extraKey), /flip/);

  const duplicateCharacter = baseConfig();
  duplicateCharacter.chapters[0].shots[0].media.characters.push({...character});
  assert.throws(() => validate(duplicateCharacter), /duplicate characterId/);
});

/* -------------------------------------------------------------------------- */
/* Planned 2.5D media                                                         */
/* -------------------------------------------------------------------------- */

const plannedParallax = (overrides: Record<string, unknown> = {}) => ({
  kind: 'parallax-2p5d',
  backgroundSlot: 'bg',
  background: {parallax: 0.04, opacity: 1, fit: 'cover', positionX: 0, positionY: 0, scale: 1},
  layers: [
    {slot: 'mg', role: 'midground', order: 10, parallax: 0.25, opacity: 1, fit: 'cover', visibleFromFrame: 0, visibleToFrame: 30},
    {slot: 'fg', role: 'foreground', order: 30, parallax: 0.95, opacity: 1, fit: 'cover', visibleFromFrame: 0, visibleToFrame: 30},
  ],
  characters: [
    {
      characterId: 'woman',
      order: 20,
      parallax: 0.62,
      anchorX: 0.42,
      anchorY: 0.9,
      pivotX: 0.5,
      pivotY: 0.985,
      height: 0.8,
      poses: [
        {slot: 'w-neutral', fromFrame: 0, toFrame: 12, transition: 'cut', fadeFrames: 0, offsetX: 0, offsetY: 0, scale: 1, opacity: 1},
        {slot: 'w-concerned', fromFrame: 12, toFrame: 30, transition: 'crossfade', fadeFrames: 4, offsetX: 0, offsetY: 0, scale: 1, opacity: 1},
      ],
    },
  ],
  camera: {...camera},
  atmosphere: {kind: 'none', intensity: 0, windX: 0},
  light: {amplitude: 0, frequency: 0, phase: 0},
  ...overrides,
});

test('a planned 2.5D shot validates its slots, depth roles and camera', () => {
  const media = validatePlannedMedia(plannedParallax(), 'parallax-2p5d', 'storyboard.shots[0]');
  assert.equal(media?.kind, 'parallax-2p5d');
  if (media?.kind !== 'parallax-2p5d') return;
  assert.equal(media.layers.length, 2);
  assert.equal(media.characters[0].poses[1].slot, 'w-concerned');
});

test('a planned 2.5D shot without a subject is refused', () => {
  const payload = plannedParallax({characters: []});
  (payload.layers as any[]).push({
    slot: 'sub',
    role: 'subject',
    order: 20,
    parallax: 0.6,
    opacity: 1,
    fit: 'cover',
    visibleFromFrame: 0,
    visibleToFrame: 30,
  });
  (payload.layers as any[]).splice(0, 1);
  assert.throws(
    () => validatePlannedMedia(payload, 'parallax-2p5d', 'storyboard.shots[0]'),
    /midground layer/,
  );
});

test('a planned 2.5D shot with no subject tier at all is refused', () => {
  const payload = plannedParallax({characters: []});
  assert.throws(
    () => validatePlannedMedia(payload, 'parallax-2p5d', 'storyboard.shots[0]'),
    /subject layer or a character performance/,
  );
});

test('planned depth order and slot uniqueness fail closed', () => {
  const wrongOrder = plannedParallax();
  (wrongOrder.layers as any[])[1].order = 5;
  assert.throws(
    () => validatePlannedMedia(wrongOrder, 'parallax-2p5d', 'storyboard.shots[0]'),
    /draw order must increase/,
  );

  const duplicateSlot = plannedParallax();
  (duplicateSlot.characters as any[])[0].poses[1].slot = 'w-neutral';
  assert.throws(
    () => validatePlannedMedia(duplicateSlot, 'parallax-2p5d', 'storyboard.shots[0]'),
    /declared twice/,
  );

  const backgroundClash = plannedParallax();
  (backgroundClash.characters as any[])[0].poses[0].slot = 'bg';
  assert.throws(
    () => validatePlannedMedia(backgroundClash, 'parallax-2p5d', 'storyboard.shots[0]'),
    /backgroundSlot/,
  );
});

test('planned camera and pose timing are bounded', () => {
  const badCamera = plannedParallax({camera: {...camera, toX: 0.9}});
  assert.throws(
    () => validatePlannedMedia(badCamera, 'parallax-2p5d', 'storyboard.shots[0]'),
    /camera\.toX/,
  );

  const badFade = plannedParallax();
  (badFade.characters as any[])[0].poses[1].fadeFrames = 1;
  assert.throws(
    () => validatePlannedMedia(badFade, 'parallax-2p5d', 'storyboard.shots[0]'),
    /fadeFrames/,
  );

  const badKind = plannedParallax();
  (badKind.characters as any[])[0].poses[0].transition = 'morph';
  assert.throws(
    () => validatePlannedMedia(badKind, 'parallax-2p5d', 'storyboard.shots[0]'),
    /transition/,
  );
});

test('planned media kind must match the planned renderer', () => {
  assert.throws(
    () => validatePlannedMedia(plannedParallax(), 'video', 'storyboard.shots[0]'),
    /does not match the planned renderer/,
  );
});