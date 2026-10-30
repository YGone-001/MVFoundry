import {TimelineError} from '../errors';
import {durationFramesFromSeconds} from '../config/duration';
import type {DurationPolicy} from '../config/types';

export {durationFramesFromSeconds};

export type SceneFrameInfo = {
  outputFrame: number;
  outputTime: number;
  localFrame: number;
  localTime: number;
  animationTick: number;
  animationTime: number;
  samplingFps: number;
};

export const assertOutputFrame = (frame: number, durationInFrames: number): void => {
  if (!Number.isInteger(frame)) {
    throw new TimelineError(`Output frame must be an integer, received ${frame}`);
  }
  if (!Number.isInteger(durationInFrames) || durationInFrames <= 0) {
    throw new TimelineError(`Duration must be a positive integer, received ${durationInFrames}`);
  }
  if (frame < 0 || frame >= durationInFrames) {
    throw new TimelineError(
      `Output frame ${frame} is outside the valid range [0, ${durationInFrames})`,
    );
  }
};

export const assertDurationProfile = (
  durationSeconds: number,
  fps: number,
  policy: DurationPolicy,
): number => durationFramesFromSeconds(durationSeconds, fps, policy);

export const frameToSeconds = (frame: number, fps: number): number => frame / fps;

/**
 * Renderer-local sampling. Selection has already happened before this call.
 * Integer arithmetic keeps non-integer output/sampling ratios exact.
 */
export const computeAnimationTick = (
  localFrame: number,
  outputFps: number,
  samplingFps: number,
): number => {
  if (!Number.isInteger(localFrame) || localFrame < 0) {
    throw new TimelineError(`localFrame must be a non-negative integer, received ${localFrame}`);
  }
  if (!Number.isInteger(outputFps) || outputFps <= 0) {
    throw new TimelineError(`outputFps must be a positive integer, received ${outputFps}`);
  }
  if (!Number.isInteger(samplingFps) || samplingFps <= 0) {
    throw new TimelineError(`samplingFps must be a positive integer, received ${samplingFps}`);
  }
  return Math.floor((localFrame * samplingFps) / outputFps);
};

export const buildSceneFrameInfo = (
  outputFrame: number,
  shotStartFrame: number,
  outputFps: number,
  samplingFps: number,
  durationInFrames: number,
): SceneFrameInfo => {
  assertOutputFrame(outputFrame, durationInFrames);
  if (!Number.isInteger(shotStartFrame) || shotStartFrame < 0) {
    throw new TimelineError(`shotStartFrame must be a non-negative integer`);
  }
  if (outputFrame < shotStartFrame) {
    throw new TimelineError(
      `Shot starts at ${shotStartFrame}, after output frame ${outputFrame}`,
    );
  }
  const localFrame = outputFrame - shotStartFrame;
  const animationTick = computeAnimationTick(localFrame, outputFps, samplingFps);
  return {
    outputFrame,
    outputTime: outputFrame / outputFps,
    localFrame,
    localTime: localFrame / outputFps,
    animationTick,
    animationTime: animationTick / samplingFps,
    samplingFps,
  };
};
