import {TimelineError} from '../errors';
import type {Chapter, ResolvedShot} from '../config/types';
import {assertOutputFrame} from './frameClock';

export const resolveShots = (chapters: readonly Chapter[]): ResolvedShot[] => {
  const shots: ResolvedShot[] = [];
  for (const chapter of chapters) {
    for (const [index, shot] of chapter.shots.entries()) {
      shots.push({
        shot,
        chapterId: chapter.id,
        chapterTitle: chapter.title,
        index,
      });
    }
  }
  return shots;
};

export const assertShotCoverage = (
  shots: readonly ResolvedShot[],
  durationInFrames: number,
): void => {
  if (shots.length === 0) throw new TimelineError('At least one shot is required');
  if (shots[0].shot.startFrame !== 0) {
    throw new TimelineError(`First shot must start at frame 0`);
  }
  for (const [index, entry] of shots.entries()) {
    if (entry.shot.endFrame <= entry.shot.startFrame) {
      throw new TimelineError(`Shot ${entry.shot.id} has an empty range`);
    }
    if (index > 0 && entry.shot.startFrame !== shots[index - 1].shot.endFrame) {
      throw new TimelineError(
        `Shot ${entry.shot.id} starts at ${entry.shot.startFrame}, previous ends at ${shots[index - 1].shot.endFrame}`,
      );
    }
  }
  const last = shots[shots.length - 1];
  if (last.shot.endFrame !== durationInFrames) {
    throw new TimelineError(
      `Last shot ends at ${last.shot.endFrame}, expected ${durationInFrames}`,
    );
  }
};

export const resolveShotAtFrame = (
  shots: readonly ResolvedShot[],
  frame: number,
  durationInFrames: number,
): ResolvedShot => {
  assertOutputFrame(frame, durationInFrames);
  let low = 0;
  let high = shots.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const entry = shots[middle];
    if (frame < entry.shot.startFrame) {
      high = middle - 1;
    } else if (frame >= entry.shot.endFrame) {
      low = middle + 1;
    } else {
      return entry;
    }
  }
  throw new TimelineError(`No shot owns output frame ${frame}`);
};

export const shotLocalFrame = (outputFrame: number, shot: ResolvedShot): number =>
  outputFrame - shot.shot.startFrame;
