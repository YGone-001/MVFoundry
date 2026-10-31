import {MediaError} from '../errors';
import type {LoadedAsset, ProjectConfig, VideoSourceConfig} from '../config/types';

const SOURCE_END_TOLERANCE_SECONDS = 1e-3;

export const mediaShotDurationSeconds = (
  startFrame: number,
  endFrame: number,
  fps: number,
): number => (endFrame - startFrame) / fps;

export const requiredSourceEndSeconds = (
  video: VideoSourceConfig,
  startFrame: number,
  endFrame: number,
  fps: number,
): number => video.sourceStartSeconds + mediaShotDurationSeconds(startFrame, endFrame, fps);

/**
 * Validates approved local video sources against the exact shot range after
 * FFprobe metadata is available. Media rendering supports the fail-closed
 * `reject` end-of-source policy only.
 */
export const assertMediaTimelines = (
  config: ProjectConfig,
  assets: readonly LoadedAsset[],
  fps: number,
): void => {
  const assetsById = new Map(assets.map((asset) => [asset.id, asset]));
  for (const chapter of config.chapters) {
    for (const shot of chapter.shots) {
      if (!shot.media) continue;
      const video = shot.media.kind === 'video' ? shot.media : shot.media.video;
      if (video.endBehavior !== 'reject') {
        throw new MediaError(
          `Shot ${shot.id} uses unsupported endBehavior ${video.endBehavior}; only reject is supported`,
        );
      }
      const asset = assetsById.get(video.assetId);
      const metadata = asset?.videoMetadata;
      if (!asset || asset.approval !== 'approved' || !metadata) {
        throw new MediaError(
          `Shot ${shot.id} references video asset ${video.assetId} without verified metadata`,
        );
      }
      const requiredEnd = requiredSourceEndSeconds(video, shot.startFrame, shot.endFrame, fps);
      if (requiredEnd > metadata.durationSeconds + SOURCE_END_TOLERANCE_SECONDS) {
        throw new MediaError(
          `Video asset ${video.assetId} is too short for shot ${shot.id}: needs ${requiredEnd.toFixed(
            6,
          )}s from source start ${video.sourceStartSeconds.toFixed(6)}s, available ${metadata.durationSeconds.toFixed(
            6,
          )}s`,
        );
      }
    }
  }
};
