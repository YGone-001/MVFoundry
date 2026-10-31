import {readFileSync} from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import {validateProjectConfig} from '../src/config/validate';
import {ConfigValidationError, MediaError, TimelineError} from '../src/errors';
import {DEFAULT_SCENE_REGISTRY} from '../src/scenes/registry';
import {assertMediaTimelines, requiredSourceEndSeconds} from '../src/media/mediaTimeline';
import {sourceTrimBeforeFrames} from '../src/timeline/mediaMapping';
import type {LoadedAsset, ProjectConfig, VideoAssetMetadata} from '../src/config/types';
import {REPO_ROOT} from './helpers';

const rendererKinds = new Set(DEFAULT_SCENE_REGISTRY.kinds());

const template = (id: string): Record<string, any> =>
  JSON.parse(
    readFileSync(
      path.join(REPO_ROOT, 'factory', 'examples', 'media-projects', id, 'project.template.json'),
      'utf8',
    ),
  ) as Record<string, any>;

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const validate = (raw: unknown): ProjectConfig => validateProjectConfig(raw, {rendererKinds});

const baseVideoMetadata = (
  overrides: Partial<VideoAssetMetadata> = {},
): VideoAssetMetadata => ({
  assetId: 'VIDEO-01',
  container: 'mp4',
  codec: 'h264',
  width: 1280,
  height: 720,
  fps: 30,
  durationSeconds: 3,
  hasAudio: true,
  pixelFormat: 'yuv420p',
  rotation: 0,
  ...overrides,
});

const loadedAsset = (metadata: VideoAssetMetadata): LoadedAsset => ({
  id: 'VIDEO-01',
  kind: 'video',
  path: 'assets/video/source.mp4',
  sha256: 'a'.repeat(64),
  source: 'synthetic',
  rights: 'synthetic',
  approval: 'approved',
  absolutePath: 'C:/synthetic/source.mp4',
  hashVerified: true,
  videoMetadata: metadata,
});

test('media templates validate and normalize the video/hybrid schema', () => {
  const video = validate(template('synthetic-video-demo'));
  const hybrid = validate(template('synthetic-hybrid-demo'));

  const videoShot = video.chapters[0].shots[0];
  assert.equal(videoShot.renderer, 'video');
  assert.equal(videoShot.media?.kind, 'video');
  assert.equal(videoShot.media?.kind === 'video' ? videoShot.media.fit : null, 'cover');
  assert.equal(videoShot.media?.muted, true);
  assert.equal(videoShot.media?.endBehavior, 'reject');
  assert.equal(videoShot.media?.positionX, 0);
  assert.equal(videoShot.media?.scale, 1);

  const hybridShot = hybrid.chapters[0].shots[0];
  assert.equal(hybridShot.renderer, 'hybrid');
  assert.equal(hybridShot.media?.kind, 'hybrid');
  if (hybridShot.media?.kind === 'hybrid') {
    assert.equal(hybridShot.media.video.muted, true);
    assert.equal(hybridShot.media.layers.length, 1);
    assert.equal(hybridShot.media.layers[0].opacity, 0.9);
    assert.equal(hybridShot.media.layers[0].visibleFromFrame, 0);
    assert.equal(hybridShot.media.layers[0].visibleToFrame, 20);
    assert.equal(hybridShot.media.overlay.kind, 'rain');
  }
  const secondHybrid = hybrid.chapters[1].shots[0];
  if (secondHybrid.media?.kind === 'hybrid') {
    assert.equal(secondHybrid.media.overlay.kind, 'orbits');
    assert.equal(secondHybrid.media.layers[0].scale, 0.72);
    assert.equal(secondHybrid.media.layers[0].positionX, 120);
  }
});

test('media configuration rejects wrong kinds, renderer mismatches and unsafe timing', () => {
  const cases: Array<[string, (config: Record<string, any>) => void, RegExp]> = [
    [
      'wrong-video-kind',
      (config) => (config.assets[0].kind = 'image'),
      /requires asset kind video/,
    ],
    [
      'pending-video',
      (config) => (config.assets[0].approval = 'pending'),
      /approval pending/,
    ],
    [
      'missing-video',
      (config) => (config.chapters[0].shots[0].media.assetId = 'MISSING'),
      /unknown asset MISSING/,
    ],
    [
      'renderer-media-mismatch',
      (config) => (config.chapters[0].shots[0].media.kind = 'hybrid'),
      /must match renderer "video"/,
    ],
    [
      'negative-in-point',
      (config) => (config.chapters[0].shots[0].media.sourceStartSeconds = -1),
      /non-negative/,
    ],
    [
      'unaligned-in-point',
      (config) => (config.chapters[0].shots[0].media.sourceStartSeconds = 0.6),
      /align to an output-frame boundary/,
    ],
    [
      'invalid-fit',
      (config) => (config.chapters[0].shots[0].media.fit = 'stretch'),
      /fit must be one of/,
    ],
    [
      'audio-enabled',
      (config) => (config.chapters[0].shots[0].media.muted = false),
      /soundtrack is the only authorized audio/,
    ],
    [
      'invalid-end-behavior',
      (config) => (config.chapters[0].shots[0].media.endBehavior = 'freeze'),
      /endBehavior/,
    ],
    [
      'invalid-scale',
      (config) => (config.chapters[0].shots[0].media.scale = 0),
      /scale must be greater than 0/,
    ],
    [
      'params-asset-on-media',
      (config) => (config.chapters[0].shots[0].params.assetId = 'VIDEO-01'),
      /params\.assetId is not allowed/,
    ],
    [
      'missing-media',
      (config) => delete config.chapters[0].shots[0].media,
      /media is required/,
    ],
    [
      'unknown-media-key',
      (config) => (config.chapters[0].shots[0].media.unknown = true),
      /unsupported key unknown/,
    ],
    [
      'traversal-video-path',
      (config) => (config.assets[0].path = '../outside.mp4'),
      /parent traversal/,
    ],
  ];

  for (const [name, mutate, expected] of cases) {
    const config = clone(template('synthetic-video-demo'));
    mutate(config);
    assert.throws(() => validate(config), expected, name);
  }

  const canvas = clone(
    JSON.parse(
      readFileSync(
        path.join(REPO_ROOT, 'factory', 'examples', 'projects', 'synthetic-pixel-demo', 'project.json'),
        'utf8',
      ),
    ),
  );
  canvas.chapters[0].shots[0].media = clone(template('synthetic-video-demo')).chapters[0].shots[0].media;
  assert.throws(() => validate(canvas), /only valid for the video and hybrid renderers/);
});

test('hybrid layer and overlay declarations fail closed', () => {
  const cases: Array<[string, (config: Record<string, any>) => void, RegExp]> = [
    [
      'wrong-layer-kind',
      (config) => (config.assets[1].kind = 'video'),
      /requires asset kind layer/,
    ],
    [
      'duplicate-order',
      (config) => {
        const layer = clone(config.chapters[0].shots[0].media.layers[0]);
        layer.assetId = 'LAYER-01';
        config.chapters[0].shots[0].media.layers.push(layer);
      },
      /duplicate order/,
    ],
    [
      'opacity-range',
      (config) => (config.chapters[0].shots[0].media.layers[0].opacity = 1.5),
      /opacity must be in \[0, 1\]/,
    ],
    [
      'visibility-range',
      (config) => (config.chapters[0].shots[0].media.layers[0].visibleToFrame = 21),
      /exceeds the shot-local duration/,
    ],
    [
      'empty-layers',
      (config) => (config.chapters[0].shots[0].media.layers = []),
      /at least one layer/,
    ],
    [
      'overlay-kind',
      (config) => (config.chapters[0].shots[0].media.overlay.kind = 'noise'),
      /overlay\.kind must be one of/,
    ],
    [
      'overlay-intensity',
      (config) => (config.chapters[0].shots[0].media.overlay.intensity = 2),
      /intensity must be in \[0, 1\]/,
    ],
    [
      'unknown-layer-asset',
      (config) => (config.chapters[0].shots[0].media.layers[0].assetId = 'MISSING'),
      /unknown asset MISSING/,
    ],
    [
      'hybrid-with-video-media',
      (config) => (config.chapters[0].shots[0].media.kind = 'video'),
      /must match renderer "hybrid"/,
    ],
  ];
  for (const [name, mutate, expected] of cases) {
    const config = clone(template('synthetic-hybrid-demo'));
    mutate(config);
    assert.throws(() => validate(config), expected, name);
  }
});

test('source timing helpers align to output frames and enforce source duration', () => {
  assert.equal(sourceTrimBeforeFrames(0.625, 24), 15);
  assert.equal(sourceTrimBeforeFrames(2, 24), 48);
  assert.equal(sourceTrimBeforeFrames(0.7, 30), 21);
  assert.equal(sourceTrimBeforeFrames(1.5, 30), 45);
  assert.throws(() => sourceTrimBeforeFrames(0.6, 24), TimelineError);

  const config = validate(template('synthetic-video-demo'));
  assert.equal(requiredSourceEndSeconds(config.chapters[0].shots[0].media as any, 0, 24, 24), 1.625);
  assert.doesNotThrow(() => assertMediaTimelines(config, [loadedAsset(baseVideoMetadata())], 24));
  assert.throws(
    () =>
      assertMediaTimelines(
        config,
        [loadedAsset(baseVideoMetadata({durationSeconds: 1.5}))],
        24,
      ),
    /too short/,
  );

  const hybrid = validate(template('synthetic-hybrid-demo'));
  assert.throws(
    () =>
      assertMediaTimelines(
        hybrid,
        [loadedAsset(baseVideoMetadata({durationSeconds: 1.5}))],
        30,
      ),
    /too short/,
  );
  assert.throws(
    () => assertMediaTimelines(config, [loadedAsset(baseVideoMetadata())].map((asset) => ({...asset, approval: 'pending'})) as LoadedAsset[], 24),
    MediaError,
  );
});
