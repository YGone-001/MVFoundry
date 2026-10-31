import assert from 'node:assert/strict';
import test from 'node:test';
import type {AudioAutomationPoint, AudioTrackRole} from '../src/config/types';
import {mixPcmTracks, sliceNormalizedMix, type PcmMixTrack} from '../src/audio/mixer';
import {MediaError} from '../src/errors';
import {encodePcm16Wav, parsePcm16WavBuffer} from '../src/media/wav';
import {frameToSampleIndex} from '../src/timeline/audioClock';

const stereoConstant = (frames: number, value: number): Float32Array => {
  const samples = new Float32Array(frames * 2);
  samples.fill(value);
  return samples;
};

const indexedStereo = (frames: number): Float32Array => {
  const samples = new Float32Array(frames * 2);
  for (let frame = 0; frame < frames; frame++) {
    samples[frame * 2] = frame / 1_000_000;
    samples[frame * 2 + 1] = frame / 1_000_000;
  }
  return samples;
};

const track = (overrides: Partial<PcmMixTrack> = {}): PcmMixTrack => ({
  id: 'sfx-01',
  role: 'sfx' as AudioTrackRole,
  samples: stereoConstant(48000, 0),
  sourceStartSeconds: 0,
  startFrame: 0,
  durationFrames: 24,
  gainDb: 0,
  fadeInFrames: 0,
  fadeOutFrames: 0,
  gainAutomation: [] as AudioAutomationPoint[],
  ...overrides,
});

const mix = (input: {
  masterSamples?: Float32Array;
  masterGainDb?: number;
  masterFadeInFrames?: number;
  masterFadeOutFrames?: number;
  masterGainAutomation?: AudioAutomationPoint[];
  tracks?: PcmMixTrack[];
  durationFrames?: number;
}) =>
  mixPcmTracks({
    masterSamples: input.masterSamples ?? stereoConstant(48000, 0),
    masterGainDb: input.masterGainDb ?? 0,
    masterFadeInFrames: input.masterFadeInFrames ?? 0,
    masterFadeOutFrames: input.masterFadeOutFrames ?? 0,
    masterGainAutomation: input.masterGainAutomation ?? [],
    tracks: input.tracks ?? [],
    durationFrames: input.durationFrames ?? 24,
    outputFps: 24,
    sampleRate: 48000,
  });

test('master gain is applied deterministically and reported', () => {
  const result = mix({
    masterSamples: stereoConstant(48000, 0.5),
    masterGainDb: 20 * Math.log10(0.5),
  });
  assert.equal(result.totalSamples, 48000);
  assert.ok(Math.abs(result.samples[0] - 0.25) < 1e-5);
  assert.ok(Math.abs(result.samples[result.samples.length - 1] - 0.25) < 1e-5);
  assert.ok(Math.abs(result.master.peakContribution - 0.25) < 1e-5);
  assert.equal(result.wouldClipSamples, 0);
  assert.equal(result.clippedSamples, 0);
});

test('tracks are placed on frame boundaries with a source in-point', () => {
  const source = indexedStereo(96000);
  const result = mix({
    masterSamples: stereoConstant(96000, 0),
    durationFrames: 48,
    tracks: [
      track({
        samples: source,
        startFrame: 24,
        durationFrames: 12,
        sourceStartSeconds: 0.5,
      }),
    ],
  });
  const start = frameToSampleIndex(24, 48000, 24);
  const end = frameToSampleIndex(36, 48000, 24);
  assert.equal(result.tracks[0].outputStartSample, start);
  assert.equal(result.tracks[0].outputEndSample, end);
  assert.equal(result.samples[(start - 1) * 2], 0);
  assert.ok(Math.abs(result.samples[start * 2] - 24000 / 1_000_000) < 1e-7);
  assert.ok(
    Math.abs(result.samples[(end - 1) * 2] - 47999 / 1_000_000) < 1e-7,
  );
  assert.equal(result.samples[end * 2], 0);
});

test('linear fades scale the first and final samples without changing timing', () => {
  const result = mix({
    masterSamples: stereoConstant(48000, 0),
    tracks: [
      track({
        samples: stereoConstant(48000, 0.5),
        startFrame: 0,
        durationFrames: 24,
        fadeInFrames: 2,
        fadeOutFrames: 2,
      }),
    ],
  });
  assert.ok(Math.abs(result.samples[0]) < 1e-6);
  assert.ok(Math.abs(result.samples[2000 * 2] - 0.25) < 1e-6);
  assert.ok(Math.abs(result.samples[4000 * 2] - 0.5) < 1e-6);
  assert.ok(Math.abs(result.samples[46000 * 2] - 0.25) < 1e-3);
  assert.ok(Math.abs(result.samples[(48000 - 1) * 2]) < 1e-6);
  assert.equal(result.tracks[0].outputSamples, 48000);
});

test('bounded gain automation interpolates in the frame domain', () => {
  const result = mix({
    masterSamples: stereoConstant(24000, 0),
    durationFrames: 12,
    tracks: [
      track({
        samples: stereoConstant(24000, 0.5),
        startFrame: 0,
        durationFrames: 12,
        gainAutomation: [
          {frame: 0, gainDb: 0},
          {frame: 10, gainDb: -20},
          {frame: 12, gainDb: -20},
        ],
      }),
    ],
  });
  assert.ok(Math.abs(result.samples[0] - 0.5) < 1e-6);
  const frame5 = frameToSampleIndex(5, 48000, 24) * 2;
  assert.ok(Math.abs(result.samples[frame5] - 0.5 * 10 ** (-10 / 20)) < 1e-6);
  const frame10 = frameToSampleIndex(10, 48000, 24) * 2;
  assert.ok(Math.abs(result.samples[frame10] - 0.05) < 1e-6);
  assert.ok(Math.abs(result.samples[23999 * 2] - 0.05) < 1e-6);
});

test('master automation can implement explicit manual ducking', () => {
  const result = mix({
    masterSamples: stereoConstant(24000, 0.2),
    durationFrames: 12,
    masterGainAutomation: [
      {frame: 0, gainDb: 0},
      {frame: 4, gainDb: -8},
      {frame: 8, gainDb: -8},
      {frame: 12, gainDb: 0},
    ],
  });
  const before = result.samples[0];
  const ducked = result.samples[frameToSampleIndex(6, 48000, 24) * 2];
  const after = result.samples[frameToSampleIndex(11, 48000, 24) * 2];
  assert.ok(Math.abs(before - 0.2) < 1e-5);
  assert.ok(Math.abs(ducked - 0.2 * 10 ** (-8 / 20)) < 1e-5);
  assert.ok(after > ducked && after < 0.2);
});

test('overlapping tracks sum and silence outside their ranges is preserved', () => {
  const result = mix({
    masterSamples: stereoConstant(48000, 0),
    tracks: [
      track({id: 'sfx-01', samples: stereoConstant(48000, 0.1)}),
      track({id: 'voice-01', role: 'voiceover', samples: stereoConstant(48000, 0.1)}),
    ],
  });
  assert.ok(Math.abs(result.samples[0] - 0.2) < 1e-6);
  assert.equal(result.tracks.length, 2);
});

test('the peak limiter reports pre-limiter overflow and bounds output', () => {
  const result = mix({
    masterSamples: stereoConstant(48000, 0.8),
    tracks: [track({samples: stereoConstant(48000, 0.8)})],
  });
  assert.ok(result.peakBeforeLimiter > 1.5);
  assert.ok(result.peakBeforeLimiter <= 1.6001);
  assert.ok(Math.abs(result.peakAfterLimiter - 0.999) < 1e-6);
  assert.ok(result.wouldClipSamples > 0);
  assert.equal(result.clippedSamples, 0);
  assert.ok(result.limiterGainDb < 0);
});

test('tracks that exceed the project or source bounds fail closed', () => {
  assert.throws(
    () =>
      mix({
        durationFrames: 24,
        tracks: [track({startFrame: 12, durationFrames: 24})],
      }),
    MediaError,
  );
  assert.throws(
    () =>
      mix({
        tracks: [track({samples: stereoConstant(1000, 0.2), startFrame: 0, durationFrames: 24})],
      }),
    /source is too short/,
  );
});

test('mix slices select the exact frame-range sample interval', () => {
  const frames = 48000;
  const samples = new Float32Array(frames * 2);
  for (let index = 0; index < frames; index++) {
    samples[index * 2] = index / 1_000_000;
    samples[index * 2 + 1] = index / 1_000_000;
  }
  const wav = encodePcm16Wav(samples, 48000, 2);
  const sliced = sliceNormalizedMix(wav, 1, 2, 48000, 24);
  const parsed = parsePcm16WavBuffer(sliced, 'slice');
  assert.equal(parsed.frameCount, 2000);
  assert.ok(Math.abs(parsed.samples[0] - 2000 / 1_000_000) < 1e-4);
  assert.ok(Math.abs(parsed.samples[parsed.samples.length - 1] - 3999 / 1_000_000) < 1e-4);
  assert.throws(() => sliceNormalizedMix(wav, 25, 26, 48000, 24), MediaError);
});