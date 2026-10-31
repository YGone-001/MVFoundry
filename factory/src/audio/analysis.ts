export const AUDIO_ANALYSIS_VERSION = '1';

export type AudioAnalysisEvent = {
  timeSeconds: number;
  frame: number;
  confidence: null;
  source: 'estimated';
  classification: 'estimated';
  metric: number;
};

export type AudioAnalysisReport = {
  algorithmVersion: string;
  sourceSha256: string;
  sampleRate: number;
  durationSeconds: number;
  outputFps: number;
  parameters: {
    windowSeconds: number;
    onsetThresholdRatio: number;
    minimumOnsetGapSeconds: number;
  };
  peak: {value: number; timeSeconds: number; frame: number};
  rmsEnvelope: Array<{timeSeconds: number; rms: number}>;
  peakEnvelope: Array<{timeSeconds: number; peak: number}>;
  onsets: AudioAnalysisEvent[];
};

export type AnalyzeOptions = {
  outputFps: number;
  sourceSha256: string;
  durationInFrames?: number;
  windowSeconds?: number;
  onsetThresholdRatio?: number;
  minimumOnsetGapSeconds?: number;
};

/**
 * Minimal deterministic energy/onset analysis. It is a candidate-event
 * foundation, not tempo/section/lyric understanding.
 */
export const analyzePcm = (
  mono: Float32Array,
  sampleRate: number,
  options: AnalyzeOptions,
): AudioAnalysisReport => {
  if (!Number.isInteger(sampleRate) || sampleRate <= 0) {
    throw new Error('sampleRate must be a positive integer');
  }
  if (!Number.isInteger(options.outputFps) || options.outputFps <= 0) {
    throw new Error('outputFps must be a positive integer');
  }
  if (
    options.durationInFrames !== undefined &&
    (!Number.isInteger(options.durationInFrames) || options.durationInFrames <= 0)
  ) {
    throw new Error('durationInFrames must be a positive integer when provided');
  }
  const windowSeconds = options.windowSeconds ?? 0.02;
  const thresholdRatio = options.onsetThresholdRatio ?? 1.8;
  const minimumGapSeconds = options.minimumOnsetGapSeconds ?? 0.08;
  const windowSamples = Math.max(1, Math.round(windowSeconds * sampleRate));
  const windowCount = Math.ceil(mono.length / windowSamples);
  const rmsEnvelope: Array<{timeSeconds: number; rms: number}> = [];
  const peakEnvelope: Array<{timeSeconds: number; peak: number}> = [];
  const rmsValues: number[] = [];
  let peakValue = 0;
  let peakSample = 0;

  for (let window = 0; window < windowCount; window++) {
    const start = window * windowSamples;
    const end = Math.min(mono.length, start + windowSamples);
    let sum = 0;
    let windowPeak = 0;
    for (let index = start; index < end; index++) {
      const value = mono[index];
      sum += value * value;
      const magnitude = Math.abs(value);
      if (magnitude > windowPeak) windowPeak = magnitude;
      if (magnitude > peakValue) {
        peakValue = magnitude;
        peakSample = index;
      }
    }
    const rms = end > start ? Math.sqrt(sum / (end - start)) : 0;
    rmsValues.push(rms);
    rmsEnvelope.push({timeSeconds: start / sampleRate, rms});
    peakEnvelope.push({timeSeconds: start / sampleRate, peak: windowPeak});
  }

  const onsets: AudioAnalysisEvent[] = [];
  let lastOnsetSample = -Infinity;
  const minimumGapSamples = minimumGapSeconds * sampleRate;
  for (let window = 1; window < rmsValues.length; window++) {
    const current = rmsValues[window];
    const previous = rmsValues[window - 1];
    if (current <= 0.015 || current <= previous * thresholdRatio) continue;
    const sample = window * windowSamples;
    if (sample - lastOnsetSample < minimumGapSamples) continue;
    lastOnsetSample = sample;
    const timeSeconds = sample / sampleRate;
    const frame = Math.round(timeSeconds * options.outputFps);
    if (options.durationInFrames !== undefined && frame > options.durationInFrames) continue;
    onsets.push({
      timeSeconds,
      frame,
      confidence: null,
      source: 'estimated',
      classification: 'estimated',
      metric: current,
    });
  }

  return {
    algorithmVersion: AUDIO_ANALYSIS_VERSION,
    sourceSha256: options.sourceSha256,
    sampleRate,
    durationSeconds: mono.length / sampleRate,
    outputFps: options.outputFps,
    parameters: {
      windowSeconds,
      onsetThresholdRatio: thresholdRatio,
      minimumOnsetGapSeconds: minimumGapSeconds,
    },
    peak: {
      value: peakValue,
      timeSeconds: peakSample / sampleRate,
      frame: Math.round((peakSample / sampleRate) * options.outputFps),
    },
    rmsEnvelope,
    peakEnvelope,
    onsets,
  };
};

export const stereoToMono = (samples: Float32Array): Float32Array => {
  const mono = new Float32Array(samples.length / 2);
  for (let index = 0; index < mono.length; index++) {
    mono[index] = (samples[index * 2] + samples[index * 2 + 1]) / 2;
  }
  return mono;
};