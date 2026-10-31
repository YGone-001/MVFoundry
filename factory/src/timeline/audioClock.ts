import {TimelineError} from '../errors';

export const assertAudioClock = (sampleRate: number, outputFps: number): void => {
  if (!Number.isInteger(sampleRate) || sampleRate <= 0) {
    throw new TimelineError(`Audio sample rate must be a positive integer, received ${sampleRate}`);
  }
  if (!Number.isInteger(outputFps) || outputFps <= 0) {
    throw new TimelineError(`Output fps must be a positive integer, received ${outputFps}`);
  }
};

/**
 * Integer rounding policy: nearest sample using Math.round (half up for
 * non-negative values). Frame ranges remain half-open.
 */
export const frameToSampleIndex = (
  frame: number,
  sampleRate: number,
  outputFps: number,
): number => {
  assertAudioClock(sampleRate, outputFps);
  if (!Number.isInteger(frame) || frame < 0) {
    throw new TimelineError(`Frame must be a non-negative integer, received ${frame}`);
  }
  return Math.round((frame * sampleRate) / outputFps);
};

export const sampleIndexToTimeSeconds = (sampleIndex: number, sampleRate: number): number => {
  if (!Number.isInteger(sampleIndex) || sampleIndex < 0) {
    throw new TimelineError(`Sample index must be a non-negative integer, received ${sampleIndex}`);
  }
  if (!Number.isInteger(sampleRate) || sampleRate <= 0) {
    throw new TimelineError(`Audio sample rate must be a positive integer`);
  }
  return sampleIndex / sampleRate;
};

/** Number of samples owned by the half-open output-frame range [startFrame, endFrame). */
export const sampleCountForFrameRange = (
  startFrame: number,
  endFrame: number,
  sampleRate: number,
  outputFps: number,
): number => {
  if (!Number.isInteger(endFrame) || endFrame < startFrame) {
    throw new TimelineError(`Invalid audio frame range [${startFrame}, ${endFrame})`);
  }
  return (
    frameToSampleIndex(endFrame, sampleRate, outputFps) -
    frameToSampleIndex(startFrame, sampleRate, outputFps)
  );
};

export const fadeSampleCount = (
  fadeFrames: number,
  sampleRate: number,
  outputFps: number,
): number => {
  if (!Number.isInteger(fadeFrames) || fadeFrames < 0) {
    throw new TimelineError(`Fade length must be a non-negative integer frame count`);
  }
  return frameToSampleIndex(fadeFrames, sampleRate, outputFps);
};

export const totalMixSamples = (
  durationInFrames: number,
  sampleRate: number,
  outputFps: number,
): number => {
  if (!Number.isInteger(durationInFrames) || durationInFrames <= 0) {
    throw new TimelineError(`Project duration must be a positive integer frame count`);
  }
  return frameToSampleIndex(durationInFrames, sampleRate, outputFps);
};

export const assertSourceStartFrameAligned = (
  sourceStartSeconds: number,
  outputFps: number,
  label: string,
): void => {
  if (!Number.isFinite(sourceStartSeconds) || sourceStartSeconds < 0) {
    throw new TimelineError(`${label} must be finite and non-negative`);
  }
  const frame = sourceStartSeconds * outputFps;
  if (Math.abs(frame - Math.round(frame)) > 1e-6) {
    throw new TimelineError(
      `${label} must align to an output-frame boundary at ${outputFps}fps`,
    );
  }
};