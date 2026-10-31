import assert from 'node:assert/strict';
import test from 'node:test';
import {AUDIO_ANALYSIS_VERSION, analyzePcm, stereoToMono} from '../src/audio/analysis';

const clickTrack = (): Float32Array => {
  const rate = 48000;
  const samples = new Float32Array(rate * 2);
  for (const start of [0.25, 25 / 24, 1.5]) {
    const first = Math.round(start * rate);
    const length = Math.round(0.012 * rate);
    for (let index = 0; index < length; index++) {
      const fade = Math.min(1, index / 100, (length - index) / 100);
      samples[first + index] =
        Math.sin((2 * Math.PI * 2000 * index) / rate) * 0.7 * Math.max(0, fade);
    }
  }
  return samples;
};

test('deterministic analysis reports frame-aligned synthetic clicks', () => {
  const samples = clickTrack();
  const first = analyzePcm(samples, 48000, {
    outputFps: 24,
    sourceSha256: 'a'.repeat(64),
  });
  const second = analyzePcm(samples, 48000, {
    outputFps: 24,
    sourceSha256: 'a'.repeat(64),
  });
  assert.equal(first.algorithmVersion, AUDIO_ANALYSIS_VERSION);
  assert.equal(first.sourceSha256, 'a'.repeat(64));
  assert.equal(first.outputFps, 24);
  assert.equal(first.sampleRate, 48000);
  assert.ok(Math.abs(first.durationSeconds - 2) < 1e-9);
  assert.deepEqual(
    first.onsets.map((event) => event.frame),
    [6, 25, 36],
  );
  assert.ok(first.onsets.every((event) => event.source === 'estimated'));
  assert.ok(first.onsets.every((event) => event.classification === 'estimated'));
  assert.ok(first.onsets.every((event) => event.confidence === null));
  assert.ok(first.onsets.every((event) => event.metric > 0));
  assert.ok(first.rmsEnvelope.length > 90);
  assert.equal(first.peakEnvelope.length, first.rmsEnvelope.length);
  assert.ok(Math.max(...first.peakEnvelope.map((window) => window.peak)) > 0.6);
  assert.equal(first.peak.frame, 6);
  assert.ok(first.peak.value > 0.6);
  assert.deepEqual(JSON.parse(JSON.stringify(first)), JSON.parse(JSON.stringify(second)));
  assert.equal('sections' in first, false);
  assert.equal('lyrics' in first, false);
  assert.equal('tempo' in first, false);
});

test('continuous tones do not produce onset candidates', () => {
  const samples = new Float32Array(96000);
  for (let index = 0; index < samples.length; index++) {
    samples[index] = Math.sin((2 * Math.PI * 220 * index) / 48000) * 0.2;
  }
  const report = analyzePcm(samples, 48000, {
    outputFps: 30,
    sourceSha256: 'b'.repeat(64),
  });
  assert.deepEqual(report.onsets, []);
  assert.ok(report.rmsEnvelope.every((window) => window.rms > 0.1));
});

test('analysis parameters are recorded and custom thresholds remain bounded', () => {
  const samples = clickTrack();
  const report = analyzePcm(samples, 48000, {
    outputFps: 24,
    sourceSha256: 'c'.repeat(64),
    windowSeconds: 0.02,
    onsetThresholdRatio: 1.5,
    minimumOnsetGapSeconds: 0.1,
  });
  assert.deepEqual(report.parameters, {
    windowSeconds: 0.02,
    onsetThresholdRatio: 1.5,
    minimumOnsetGapSeconds: 0.1,
  });
  assert.deepEqual(
    report.onsets.map((event) => event.frame),
    [6, 25, 36],
  );
});

test('analysis events outside the project frame duration are not reported', () => {
  const rate = 48000;
  const samples = new Float32Array(rate * 3);
  for (const start of [2.1, 2.5]) {
    const first = Math.round(start * rate);
    for (let index = 0; index < 600; index++) {
      samples[first + index] = Math.sin((2 * Math.PI * 2000 * index) / rate) * 0.7;
    }
  }
  const report = analyzePcm(samples, rate, {
    outputFps: 24,
    sourceSha256: 'd'.repeat(64),
    durationInFrames: 48,
  });
  assert.deepEqual(report.onsets, []);
  assert.throws(
    () =>
      analyzePcm(samples, rate, {
        outputFps: 24,
        sourceSha256: 'd'.repeat(64),
        durationInFrames: 0,
      }),
    /durationInFrames/,
  );
});

test('stereo-to-mono conversion averages channels without changing length', () => {
  const stereo = new Float32Array([0.5, -0.5, 0.2, 0.4]);
  const mono = stereoToMono(stereo);
  assert.equal(mono.length, 2);
  assert.equal(mono[0], 0);
  assert.ok(Math.abs(mono[1] - 0.3) < 1e-7);
});