import type {
  ProjectConfig,
  RenderProjectChapter,
  RenderProjectSnapshot,
} from '../config/types';
import {resolveShots} from '../timeline/resolver';

/** Builds the browser-safe render snapshot: no absolute paths or workspace roots. */
export const toRenderProject = (
  config: ProjectConfig,
  durationInFrames: number,
): RenderProjectSnapshot => {
  const chapters: RenderProjectChapter[] = config.chapters.map((chapter) => ({
    id: chapter.id,
    title: chapter.title,
    startFrame: chapter.startFrame,
    endFrame: chapter.endFrame,
    shots: chapter.shots.map((shot) => ({
      ...shot,
      params: {...shot.params},
      chapterId: chapter.id,
      chapterTitle: chapter.title,
    })),
  }));

  return {
    projectId: config.projectId,
    song: {...config.song},
    output: {
      width: config.output.width,
      height: config.output.height,
      fps: config.output.fps,
      durationInFrames,
    },
    visual: {
      ...config.visual,
      pixel: config.visual.pixel ? {...config.visual.pixel} : undefined,
    },
    narrative: {...config.narrative},
    cues: config.cues.map((cue) => ({...cue})),
    chapters,
    render: {...config.render},
    audio: {
      durationSeconds: config.audio.durationSeconds,
      sha256: config.audio.sha256,
      durationPolicy: config.audio.durationPolicy,
    },
    assets: config.assets.map((asset) => ({
      id: asset.id,
      kind: asset.kind,
      sha256: asset.sha256,
      approval: asset.approval,
    })),
    publicAssets: {},
  };
};

/** Convenience for callers that already have a validated config. */
export const snapshotFromConfig = (
  config: ProjectConfig,
  durationInFrames = config.output.durationInFrames ?? 0,
): RenderProjectSnapshot => {
  if (!Number.isInteger(durationInFrames) || durationInFrames <= 0) {
    throw new Error('durationInFrames must be a positive integer');
  }
  const shots = resolveShots(config.chapters);
  if (shots.length === 0) throw new Error('Project has no shots');
  return toRenderProject(config, durationInFrames);
};
