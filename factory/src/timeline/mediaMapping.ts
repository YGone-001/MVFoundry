import {TimelineError} from '../errors';

/** Remotion trimBefore/startFrom values are in composition-frame units. */
export const sourceTrimBeforeFrames = (
  sourceStartSeconds: number,
  outputFps: number,
): number => {
  if (!Number.isFinite(sourceStartSeconds) || sourceStartSeconds < 0) {
    throw new TimelineError(`sourceStartSeconds must be finite and non-negative`);
  }
  if (!Number.isInteger(outputFps) || outputFps <= 0) {
    throw new TimelineError(`outputFps must be a positive integer`);
  }
  const frames = sourceStartSeconds * outputFps;
  if (Math.abs(frames - Math.round(frames)) > 1e-6) {
    throw new TimelineError(
      `Source in-point ${sourceStartSeconds}s does not align to an output frame at ${outputFps}fps`,
    );
  }
  return Math.round(frames);
};
