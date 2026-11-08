import type {
  ProjectConfig,
  RenderProjectChapter,
  RenderProjectSnapshot,
  ShotMediaConfig,
  VideoAssetMetadata,
} from '../config/types';
import {resolveShots} from '../timeline/resolver';

const cloneMedia = (media: ShotMediaConfig | undefined): ShotMediaConfig | undefined => {
  if (!media) return undefined;
  if (media.kind === 'video') return {...media};
  if (media.kind === 'parallax-2p5d') {
    return {
      kind: 'parallax-2p5d',
      background: {...media.background},
      layers: media.layers.map((layer) =>
        layer.motion
          ? {...layer, motion: {...layer.motion}}
          : {...layer},
      ),
      camera: {...media.camera},
      atmosphere: {...media.atmosphere},
      light: media.light.sweep
        ? {...media.light, sweep: {...media.light.sweep}}
        : {...media.light},
      ...(media.grade ? {grade: {...media.grade}} : {}),
      ...(media.comic
        ? {
            comic: {
              ...media.comic,
              ...(media.comic.panel ? {panel: {...media.comic.panel}} : {}),
              impacts: (media.comic.impacts ?? []).map((impact) => ({...impact})),
              wipes: (media.comic.wipes ?? []).map((wipe) => ({...wipe})),
            },
          }
        : {}),
    };
  }
  return {
    kind: 'hybrid',
    video: {...media.video},
    layers: media.layers.map((layer) => ({...layer})),
    overlay: {...media.overlay},
  };
};

/** Builds the browser-safe render snapshot: no absolute paths or workspace roots. */
export const toRenderProject = (
  config: ProjectConfig,
  durationInFrames: number,
  videoMetadata: Record<string, VideoAssetMetadata> = {},
): RenderProjectSnapshot => {
  const chapters: RenderProjectChapter[] = config.chapters.map((chapter) => ({
    id: chapter.id,
    title: chapter.title,
    startFrame: chapter.startFrame,
    endFrame: chapter.endFrame,
    shots: chapter.shots.map((shot) => ({
      ...shot,
      params: {...shot.params},
      media: cloneMedia(shot.media),
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
    sceneModules: config.sceneModules.map((module) => ({
      id: module.id,
      contractVersion: module.contractVersion,
      moduleType: module.moduleType,
      sha256: module.sha256,
    })),
    render: {...config.render},
    audio: {
      durationSeconds: config.audio.durationSeconds,
      sha256: config.audio.sha256,
      durationPolicy: config.audio.durationPolicy,
      format: config.audio.format,
      mixSampleRate: config.audio.mixSampleRate,
      gainDb: config.audio.gainDb,
      fadeInFrames: config.audio.fadeInFrames,
      fadeOutFrames: config.audio.fadeOutFrames,
      gainAutomation: config.audio.gainAutomation.map((point) => ({...point})),
    },
    assets: config.assets.map((asset) => ({
      id: asset.id,
      kind: asset.kind,
      sha256: asset.sha256,
      approval: asset.approval,
    })),
    mediaAssets: Object.fromEntries(
      Object.entries(videoMetadata).map(([assetId, metadata]) => [assetId, {...metadata}]),
    ),
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
