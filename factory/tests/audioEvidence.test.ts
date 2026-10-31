import assert from 'node:assert/strict';
import test from 'node:test';
import {
  amplitudeDb,
  findToneRegions,
  measurePulseAt,
  measureTone,
  peakOfRange,
  rmsOfRange,
} from '../src/audio/evidence';
import {frameToSampleIndex} from '../src/timeline/audioClock';

const sine = (frequency: number, amplitude: number, seconds: number, rate = 48000): Float32Array => {
  const samples = new Float32Array(Math.round(seconds * rate));
  for (let index = 0; index < samples.length; index++) {
    samples[index] = Math.sin((2 * Math.PI * frequency * index) / rate) * amplitude;
  }
  return samples;
};

const addBurst = (
  samples: Float32Array,
  rate: number,
  startSeconds: number,
  durationSeconds: number,
  frequency: number,
  amplitude: number,
): void => {
  const start = Math.round(startSeconds * rate);
  const length = Math.round(durationSeconds * rate);
  for (let index = 0; index < length && start + index < samples.length; index++) {
    samples[start + index] +=
      Math.sin((2 * Math.PI * frequency * index) / rate) * amplitude;
  }
};

test('single-bin tone measurement recovers synthetic amplitudes', () => {
  const samples = sine(440, 0.25, 0.5);
  const measurement = measureTone(samples, 48000, 440, 0, samples.length);
  assert.ok(Math.abs(measurement.amplitude - 0.25) < 1e-3);
  assert.ok(Math.abs(measurement.dbfs - amplitudeDb(0.25)) < 1e-3);
  assert.ok(Math.abs(measurement.rms - 0.25 / Math.sqrt(2)) < 1e-3);
  const other = measureTone(samples, 48000, 660, 0, samples.length);
  assert.ok(other.amplitude < 1e-3);
});

test('tone regions find scheduled bursts in decoded-like PCM', () => {
  const samples = sine(220, 0.05, 2);
  addBurst(samples, 48000, 0.5, 0.1, 1000, 0.5);
  addBurst(samples, 48000, 1.5, 0.1, 1000, 0.5);
  const regions = findToneRegions(samples, 48000, 1000, {
    threshold: 0.05,
    windowSeconds: 0.01,
    hopSeconds: 0.005,
  });
  assert.equal(regions.length, 2);
  assert.ok(Math.abs(regions[0].startSeconds - 0.5) <= 0.015);
  assert.ok(Math.abs(regions[1].startSeconds - 1.5) <= 0.015);
  assert.ok(regions.every((region) => region.peakAmplitude > 0.4));
});

test('dB, RMS and peak helpers report measurable levels', () => {
  assert.ok(Math.abs(amplitudeDb(0.1) - -20) < 1e-9);
  assert.ok(Math.abs(amplitudeDb(1) - 0) < 1e-9);
  const samples = new Float32Array([0.5, -0.5, 0.25, -0.25]);
  assert.equal(peakOfRange(samples, 0, samples.length), 0.5);
  assert.ok(Math.abs(rmsOfRange(samples, 0, samples.length) - Math.sqrt(0.15625)) < 1e-6);
  assert.throws(() => peakOfRange(samples, 2, 2), /Invalid analysis sample range/);
  assert.throws(() => measureTone(samples, 48000, 24000, 0, 2), /outside/);
});

test('sample-level pulse measurement separates the leading edge from the pulse center', () => {
  const rate = 44100;
  const samples = new Float32Array(rate);
  const expected = 10000;
  const length = Math.round(0.012 * rate);
  for (let index = 0; index < length; index++) {
    const fade = Math.min(1, index / Math.round(0.002 * rate), (length - index) / Math.round(0.002 * rate));
    samples[expected + index] =
      Math.sin((2 * Math.PI * 2000 * index) / rate) * 0.7 * Math.max(0, fade);
  }
  const pulse = measurePulseAt(samples, rate, expected, {thresholdRatio: 0.1});
  assert.ok(pulse.firstDeltaMs >= 0 && pulse.firstDeltaMs <= 0.5);
  assert.ok(pulse.centroidDeltaMs >= 5 && pulse.centroidDeltaMs <= 7);
  assert.ok(pulse.peakDeltaMs >= 0 && pulse.peakDeltaMs <= 12);
  assert.ok(pulse.lastSample > pulse.firstSample);
  assert.throws(() => measurePulseAt(samples, rate, 5000), /No pulse energy/);
});

test('region detection aligns with the frame clock used by the renderer', () => {
  const samples = sine(330, 0.02, 2, 44100);
  addBurst(samples, 44100, 25 / 24, 0.012, 2000, 0.7);
  const region = findToneRegions(samples, 44100, 2000, {
    threshold: 0.05,
    windowSeconds: 0.01,
    hopSeconds: 0.0025,
  })[0];
  assert.ok(region);
  const frame = Math.round(region.startSeconds * 24);
  assert.ok(frame === 25 || frame === 24);
  assert.equal(frameToSampleIndex(25, 44100, 24), 45938);
});