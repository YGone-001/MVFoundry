import assert from 'node:assert/strict';
import test from 'node:test';
import {TimelineError} from '../src/errors';
import {
  assertAudioClock,
  assertSourceStartFrameAligned,
  fadeSampleCount,
  frameToSampleIndex,
  sampleCountForFrameRange,
  sampleIndexToTimeSeconds,
  totalMixSamples,
} from '../src/timeline/audioClock';

test('frame-to-sample mapping is exact at integer ratios', () => {
  assert.equal(frameToSampleIndex(0, 48000, 24), 0);
  assert.equal(frameToSampleIndex(1, 48000, 24), 2000);
  assert.equal(frameToSampleIndex(24, 48000, 24), 48000);
  assert.equal(frameToSampleIndex(48, 48000, 24), 96000);
  assert.equal(totalMixSamples(48, 48000, 24), 96000);
});

test('non-integer frame/sample ratios use documented half-up rounding', () => {
  // 44100 / 24 = 1837.5 samples per frame.
  assert.equal(frameToSampleIndex(1, 44100, 24), 1838);
  assert.equal(frameToSampleIndex(2, 44100, 24), 3675);
  assert.equal(frameToSampleIndex(24, 44100, 24), 44100);
  assert.equal(frameToSampleIndex(25, 44100, 24), 45938);
  assert.equal(frameToSampleIndex(41, 44100, 24), 75338);
  assert.equal(sampleCountForFrameRange(24, 41, 44100, 24), 31238);
  assert.equal(totalMixSamples(48, 44100, 24), 88200);
});

test('sample boundaries are monotonic and bounded by one sample per frame', () => {
  for (const [rate, fps] of [
    [44100, 24],
    [48000, 30],
    [44100, 30],
    [48000, 24],
  ] as const) {
    let previous = frameToSampleIndex(0, rate, fps);
    for (let frame = 1; frame <= 240; frame++) {
      const current = frameToSampleIndex(frame, rate, fps);
      assert.ok(current > previous, `${frame} must advance at ${rate}/${fps}`);
      assert.ok(current - previous <= Math.ceil(rate / fps) + 1);
      previous = current;
    }
  }
});

test('fade lengths and time conversion follow the same clock', () => {
  assert.equal(fadeSampleCount(1, 48000, 24), 2000);
  assert.equal(fadeSampleCount(4, 48000, 30), 6400);
  assert.equal(fadeSampleCount(1, 44100, 24), 1838);
  assert.equal(sampleIndexToTimeSeconds(44100, 44100), 1);
  assert.equal(sampleIndexToTimeSeconds(45938, 44100) > 1.0416, true);
});

test('source in-points must align to output frames', () => {
  assert.doesNotThrow(() => assertSourceStartFrameAligned(0.1, 30, 'sourceStartSeconds'));
  assert.doesNotThrow(() => assertSourceStartFrameAligned(0, 24, 'sourceStartSeconds'));
  assert.throws(
    () => assertSourceStartFrameAligned(0.11, 30, 'sourceStartSeconds'),
    TimelineError,
  );
  assert.throws(
    () => assertSourceStartFrameAligned(-0.1, 30, 'sourceStartSeconds'),
    TimelineError,
  );
});

test('invalid clocks and frames fail closed', () => {
  assert.throws(() => assertAudioClock(0, 24), TimelineError);
  assert.throws(() => assertAudioClock(48000, 0), TimelineError);
  assert.throws(() => frameToSampleIndex(-1, 48000, 24), TimelineError);
  assert.throws(() => frameToSampleIndex(1.5, 48000, 24), TimelineError);
  assert.throws(() => sampleCountForFrameRange(10, 9, 48000, 24), TimelineError);
  assert.throws(() => totalMixSamples(0, 48000, 24), TimelineError);
  assert.throws(() => fadeSampleCount(-1, 48000, 24), TimelineError);
});