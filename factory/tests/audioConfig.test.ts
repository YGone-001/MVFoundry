import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {validateProjectConfig} from '../src/config/validate';
import {ConfigValidationError} from '../src/errors';
import {DEFAULT_SCENE_REGISTRY} from '../src/scenes/registry';
import type {ProjectConfig} from '../src/config/types';
import {REPO_ROOT} from './helpers';

const rendererKinds = new Set(DEFAULT_SCENE_REGISTRY.kinds());

const template = (id: string): Record<string, any> =>
  JSON.parse(
    readFileSync(
      path.join(REPO_ROOT, 'factory', 'examples', 'audio-projects', id, 'project.template.json'),
      'utf8',
    ),
  ) as Record<string, any>;

const wavProject = (): Record<string, any> =>
  JSON.parse(
    readFileSync(
      path.join(REPO_ROOT, 'factory', 'examples', 'projects', 'synthetic-pixel-demo', 'project.json'),
      'utf8',
    ),
  ) as Record<string, any>;

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const validate = (raw: unknown): ProjectConfig => validateProjectConfig(raw, {rendererKinds});

test('existing wav-pcm projects keep working with backward-compatible audio defaults', () => {
  const config = validate(wavProject());
  assert.equal(config.audio.format, 'wav-pcm');
  assert.equal(config.audio.mixSampleRate, 48000);
  assert.equal(config.audio.gainDb, 0);
  assert.equal(config.audio.fadeInFrames, 0);
  assert.equal(config.audio.fadeOutFrames, 0);
  assert.deepEqual(config.audio.gainAutomation, []);
  assert.deepEqual(config.audioTracks, []);
});

test('multi-format audio templates validate with their declared roles and timing', () => {
  const mp3 = validate(template('synthetic-audio-mp3-demo'));
  assert.equal(mp3.audio.format, 'mp3');
  assert.equal(mp3.audio.assetId, 'AUDIO-MUSIC');
  assert.equal(mp3.audio.mixSampleRate, 48000);
  assert.equal(mp3.audioTracks.length, 0);

  const multitrack = validate(template('synthetic-audio-multitrack-demo'));
  assert.equal(multitrack.audio.format, 'flac');
  assert.equal(multitrack.audio.gainAutomation.length, 4);
  assert.deepEqual(
    multitrack.audioTracks.map((track) => [track.id, track.role, track.startFrame]),
    [
      ['sfx-01', 'sfx', 20],
      ['voice-01', 'voiceover', 32],
      ['ambience-01', 'ambience', 8],
    ],
  );
  assert.equal(multitrack.audioTracks[0].sourceStartSeconds, 0.1);
  assert.equal(multitrack.audioTracks[0].muted, false);

  const boundaries = validate(template('synthetic-audio-boundaries-demo'));
  assert.equal(boundaries.audio.format, 'wav-pcm');
  assert.equal(boundaries.audio.mixSampleRate, 44100);
});

test('invalid master audio declarations fail closed', () => {
  const cases: Array<[string, (config: Record<string, any>) => void, RegExp]> = [
    ['format', (config) => (config.audio.format = 'ogg'), /audio.format/],
    ['sample-rate', (config) => (config.audio.mixSampleRate = 22050), /44100 or 48000/],
    ['gain', (config) => (config.audio.gainDb = 20), /audio.gainDb/],
    ['fade', (config) => (config.audio.fadeInFrames = 49), /master fades/],
    [
      'automation-order',
      (config) => (config.audio.gainAutomation = [{frame: 10, gainDb: 0}, {frame: 4, gainDb: -6}]),
      /strictly increasing/,
    ],
    [
      'automation-range',
      (config) => (config.audio.gainAutomation = [{frame: 49, gainDb: 0}]),
      /exceeds the allowed duration/,
    ],
    ['unknown-key', (config) => (config.audio.command = '-af volume=2'), /unsupported key command/],
    [
      'unknown-asset',
      (config) => (config.audio.assetId = 'MISSING'),
      /unknown asset MISSING/,
    ],
    [
      'path-mismatch',
      (config) => (config.audio.path = 'source/audio/other.mp3'),
      /path and hash must match/,
    ],
  ];
  for (const [name, mutate, pattern] of cases) {
    const config = template('synthetic-audio-mp3-demo');
    mutate(config);
    assert.throws(() => validate(config), pattern, name);
  }
});

test('audio track validation rejects unsafe roles, assets and ranges', () => {
  const cases: Array<[string, (config: Record<string, any>) => void, RegExp]> = [
    [
      'unknown-asset',
      (config) => (config.audioTracks[0].assetId = 'MISSING'),
      /unknown asset MISSING/,
    ],
    [
      'pending-asset',
      (config) => (config.assets[1].approval = 'pending'),
      /approval pending/,
    ],
    [
      'wrong-kind',
      (config) => (config.audioTracks[0].assetId = 'VIDEO-01'),
      /requires asset kind audio-reference/,
    ],
    ['role', (config) => (config.audioTracks[0].role = 'music'), /audioTracks\[0\].role/],
    ['zero-duration', (config) => (config.audioTracks[0].durationFrames = 0), /integer >= 1/],
    [
      'project-range',
      (config) => (config.audioTracks[0].startFrame = 50),
      /exceeds the project duration/,
    ],
    [
      'in-point',
      (config) => (config.audioTracks[0].sourceStartSeconds = 0.11),
      /align to an output-frame boundary/,
    ],
    ['gain', (config) => (config.audioTracks[0].gainDb = 20), /gainDb/],
    [
      'fades',
      (config) => {
        config.audioTracks[0].fadeInFrames = 8;
        config.audioTracks[0].fadeOutFrames = 8;
      },
      /fades exceed/,
    ],
    [
      'automation-range',
      (config) =>
        (config.audioTracks[0].gainAutomation = [{frame: 13, gainDb: -6}]),
      /exceeds the allowed duration/,
    ],
    [
      'automation-order',
      (config) =>
        (config.audioTracks[0].gainAutomation = [
          {frame: 5, gainDb: 0},
          {frame: 2, gainDb: -6},
        ]),
      /strictly increasing/,
    ],
    [
      'duplicate-id',
      (config) => (config.audioTracks[1].id = 'sfx-01'),
      /duplicate id sfx-01/,
    ],
    [
      'unknown-key',
      (config) => (config.audioTracks[0].filter = 'volume=2'),
      /unsupported key filter/,
    ],
    ['not-array', (config) => (config.audioTracks = {}), /must be an array/],
  ];
  for (const [name, mutate, pattern] of cases) {
    const config = template('synthetic-audio-multitrack-demo');
    mutate(config);
    assert.throws(() => validate(config), pattern, name);
  }
});

test('master asset identity must match an approved audio-reference asset', () => {
  const pending = template('synthetic-audio-mp3-demo');
  pending.assets[0].approval = 'pending';
  assert.throws(() => validate(pending), /approval pending/);

  const wrongKind = template('synthetic-audio-mp3-demo');
  wrongKind.assets[0].kind = 'image';
  assert.throws(() => validate(wrongKind), /must reference an audio-reference asset/);

  const mismatch = template('synthetic-audio-mp3-demo');
  mismatch.assets[0].sha256 = 'f'.repeat(64);
  assert.throws(() => validate(mismatch), /path and hash must match/);
});

test('muted tracks remain declaratively valid and are not an alternative master', () => {
  const config = template('synthetic-audio-multitrack-demo');
  config.audioTracks[0].muted = true;
  const validated = validate(config);
  assert.equal(validated.audioTracks[0].muted, true);
  assert.equal(validated.audio.path, 'source/audio/music.flac');
  assert.equal(validated.audio.assetId, 'AUDIO-MUSIC');
});

test('audio validation errors are ConfigValidationError instances', () => {
  const config = template('synthetic-audio-mp3-demo');
  config.audio.format = 'aiff';
  assert.throws(() => validate(config), ConfigValidationError);
});