import type {CSSProperties} from 'react';
import {staticFile} from 'remotion';
import {SceneRenderError} from '../../errors';
import type {
  RenderProjectShot,
  RenderProjectSnapshot,
  VideoAssetMetadata,
  VideoSourceConfig,
} from '../../config/types';
import {sourceTrimBeforeFrames} from '../../timeline/mediaMapping';

export type ResolvedVideoSource = {
  src: string;
  trimBefore: number;
  metadata: VideoAssetMetadata;
};

export const resolveVideoSource = (
  project: RenderProjectSnapshot,
  shot: RenderProjectShot,
  video: VideoSourceConfig,
  publicAssets: Record<string, string>,
): ResolvedVideoSource => {
  const publicPath = publicAssets[video.assetId];
  if (!publicPath) {
    throw new SceneRenderError(
      `Video asset ${video.assetId} for shot ${shot.id} is not staged for rendering`,
    );
  }
  const metadata = project.mediaAssets[video.assetId];
  if (!metadata) {
    throw new SceneRenderError(
      `Video asset ${video.assetId} for shot ${shot.id} has no verified probe metadata`,
    );
  }
  const trimBefore = sourceTrimBeforeFrames(video.sourceStartSeconds, project.output.fps);
  return {src: staticFile(publicPath), trimBefore, metadata};
};

export const videoLayerStyle = (
  video: VideoSourceConfig,
): CSSProperties => ({
  position: 'absolute',
  inset: 0,
  width: '100%',
  height: '100%',
  objectFit: video.fit,
  transform: `translate(${video.positionX}px, ${video.positionY}px) scale(${video.scale})`,
  transformOrigin: 'center center',
});

export const imageLayerStyle = (
  layer: {opacity: number; fit: 'contain' | 'cover'; positionX: number; positionY: number; scale: number},
): CSSProperties => ({
  position: 'absolute',
  inset: 0,
  width: '100%',
  height: '100%',
  objectFit: layer.fit,
  opacity: layer.opacity,
  transform: `translate(${layer.positionX}px, ${layer.positionY}px) scale(${layer.scale})`,
  transformOrigin: 'center center',
});

export const shotSequenceDuration = (shot: RenderProjectShot): number =>
  shot.endFrame - shot.startFrame;
