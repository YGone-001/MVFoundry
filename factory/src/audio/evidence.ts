export type ToneMeasurement = {
  frequency: number;
  startSample: number;
  endSample: number;
  samples: number;
  amplitude: number;
  rms: number;
  dbfs: number;
};

export type ToneRegion = {
  startSample: number;
  endSample: number;
  startSeconds: number;
  endSeconds: number;
  peakAmplitude: number;
};

const amplitudeToDb = (value: number): number => 20 * Math.log10(Math.max(value, 1e-9));

const checkedRange = (
  samples: number,
  startSample: number,
  endSample: number,
): [number, number] => {
  const start = Math.max(0, Math.floor(startSample));
  const end = Math.min(samples, Math.ceil(endSample));
  if (!Number.isInteger(start) || !Number.isInteger(end) || end <= start) {
    throw new Error(`Invalid analysis sample range [${startSample}, ${endSample})`);
  }
  return [start, end];
};

/**
 * Rectangular-window single-bin projection. Use windows whose length contains
 * an integer number of cycles for the target frequency to keep the estimate
 * exact for pure synthetic tones.
 */
export const measureTone = (
  mono: Float32Array,
  sampleRate: number,
  frequency: number,
  startSample: number,
  endSample: number,
): ToneMeasurement => {
  if (!(frequency > 0) || frequency >= sampleRate / 2) {
    throw new Error(`Analysis frequency ${frequency} is outside (0, Nyquist)`);
  }
  const [start, end] = checkedRange(mono.length, startSample, endSample);
  let real = 0;
  let imaginary = 0;
  let sumSquares = 0;
  const omega = (2 * Math.PI * frequency) / sampleRate;
  for (let index = start; index < end; index++) {
    const value = mono[index];
    const phase = omega * (index - start);
    real += value * Math.cos(phase);
    imaginary += value * Math.sin(phase);
    sumSquares += value * value;
  }
  const count = end - start;
  const amplitude = (2 * Math.sqrt(real * real + imaginary * imaginary)) / count;
  const rms = Math.sqrt(sumSquares / count);
  return {
    frequency,
    startSample: start,
    endSample: end,
    samples: count,
    amplitude,
    rms,
    dbfs: amplitudeToDb(amplitude),
  };
};

/**
 * Finds contiguous regions where a target tone is above a threshold. Useful
 * for measuring synthetic burst/click placement after lossy encoding.
 */
export const findToneRegions = (
  mono: Float32Array,
  sampleRate: number,
  frequency: number,
  options: {
    threshold: number;
    windowSeconds?: number;
    hopSeconds?: number;
    mergeGapSeconds?: number;
  },
): ToneRegion[] => {
  const windowSeconds = options.windowSeconds ?? 0.01;
  const hopSeconds = options.hopSeconds ?? windowSeconds / 2;
  const mergeGapSeconds = options.mergeGapSeconds ?? windowSeconds;
  const windowSamples = Math.max(1, Math.round(windowSeconds * sampleRate));
  const hopSamples = Math.max(1, Math.round(hopSeconds * sampleRate));
  const mergeGapSamples = Math.round(mergeGapSeconds * sampleRate);
  const regions: ToneRegion[] = [];
  let active: {startSample: number; endSample: number; peakAmplitude: number} | null = null;
  for (let start = 0; start + windowSamples <= mono.length; start += hopSamples) {
    const measurement = measureTone(
      mono,
      sampleRate,
      frequency,
      start,
      start + windowSamples,
    );
    if (measurement.amplitude >= options.threshold) {
      if (!active) {
        active = {
          startSample: start,
          endSample: start + windowSamples,
          peakAmplitude: measurement.amplitude,
        };
      } else {
        active.endSample = start + windowSamples;
        active.peakAmplitude = Math.max(active.peakAmplitude, measurement.amplitude);
      }
    } else if (active && start - active.endSample >= mergeGapSamples) {
      regions.push({
        ...active,
        startSeconds: active.startSample / sampleRate,
        endSeconds: active.endSample / sampleRate,
      });
      active = null;
    }
  }
  if (active) {
    regions.push({
      ...active,
      startSeconds: active.startSample / sampleRate,
      endSeconds: active.endSample / sampleRate,
    });
  }
  return regions;
};

export const rmsOfRange = (
  mono: Float32Array,
  startSample: number,
  endSample: number,
): number => {
  const [start, end] = checkedRange(mono.length, startSample, endSample);
  let sum = 0;
  for (let index = start; index < end; index++) sum += mono[index] * mono[index];
  return Math.sqrt(sum / (end - start));
};

export const peakOfRange = (
  mono: Float32Array,
  startSample: number,
  endSample: number,
): number => {
  const [start, end] = checkedRange(mono.length, startSample, endSample);
  let peak = 0;
  for (let index = start; index < end; index++) {
    peak = Math.max(peak, Math.abs(mono[index]));
  }
  return peak;
};

export const amplitudeDb = amplitudeToDb;

export type PulseMeasurement = {
  expectedSample: number;
  peak: number;
  threshold: number;
  firstSample: number;
  peakSample: number;
  centroidSample: number;
  lastSample: number;
  firstDeltaSamples: number;
  peakDeltaSamples: number;
  centroidDeltaSamples: number;
  firstDeltaMs: number;
  peakDeltaMs: number;
  centroidDeltaMs: number;
};

/**
 * Measures one synthetic pulse at sample resolution. The first threshold
 * crossing identifies the physical leading edge; the amplitude centroid
 * identifies the pulse center. Search before the expected sample is bounded so
 * codec pre-ringing can be observed without selecting a neighboring pulse.
 */
export const measurePulseAt = (
  mono: Float32Array,
  sampleRate: number,
  expectedSample: number,
  options: {
    searchBeforeSeconds?: number;
    searchAfterSeconds?: number;
    thresholdRatio?: number;
  } = {},
): PulseMeasurement => {
  if (!Number.isInteger(expectedSample) || expectedSample < 0 || expectedSample >= mono.length) {
    throw new Error(`Expected pulse sample ${expectedSample} is outside the signal`);
  }
  const before = Math.round((options.searchBeforeSeconds ?? 0.02) * sampleRate);
  const after = Math.round((options.searchAfterSeconds ?? 0.05) * sampleRate);
  const start = Math.max(0, expectedSample - before);
  const end = Math.min(mono.length, expectedSample + after);
  let peak = 0;
  let peakSample = start;
  for (let index = start; index < end; index++) {
    const magnitude = Math.abs(mono[index]);
    if (magnitude > peak) {
      peak = magnitude;
      peakSample = index;
    }
  }
  if (peak <= 0) throw new Error(`No pulse energy found near sample ${expectedSample}`);
  const threshold = peak * (options.thresholdRatio ?? 0.1);
  let firstSample = -1;
  let lastSample = -1;
  for (let index = start; index < end; index++) {
    if (Math.abs(mono[index]) >= threshold) {
      if (firstSample < 0) firstSample = index;
      lastSample = index;
    }
  }
  if (firstSample < 0) throw new Error(`Pulse threshold was not crossed near sample ${expectedSample}`);
  let weighted = 0;
  let weight = 0;
  for (let index = firstSample; index <= lastSample; index++) {
    const magnitude = Math.abs(mono[index]);
    weighted += index * magnitude;
    weight += magnitude;
  }
  const centroidSample = weight > 0 ? weighted / weight : (firstSample + lastSample) / 2;
  const toMs = (sample: number) => (sample / sampleRate) * 1000;
  return {
    expectedSample,
    peak,
    threshold,
    firstSample,
    peakSample,
    centroidSample,
    lastSample,
    firstDeltaSamples: firstSample - expectedSample,
    peakDeltaSamples: peakSample - expectedSample,
    centroidDeltaSamples: centroidSample - expectedSample,
    firstDeltaMs: toMs(firstSample - expectedSample),
    peakDeltaMs: toMs(peakSample - expectedSample),
    centroidDeltaMs: toMs(centroidSample - expectedSample),
  };
};