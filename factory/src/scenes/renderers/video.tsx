import {AbsoluteFill, OffthreadVideo, Sequence} from 'remotion';
import {SceneRenderError} from '../../errors';
import type {MediaSceneRenderer, MediaSceneRendererProps} from '../types';
import {
  resolveVideoSource,
  shotSequenceDuration,
  videoLayerStyle,
} from './mediaShared';

const VideoScene: React.FC<MediaSceneRendererProps> = ({project, shot, publicAssets}) => {
  const media = shot.media;
  if (!media || media.kind !== 'video') {
    throw new SceneRenderError(`Video renderer requires shot.media.kind = video on ${shot.id}`);
  }
  const source = resolveVideoSource(project, shot, media, publicAssets);
  const durationInFrames = shotSequenceDuration(shot);
  const requiredEnd = media.sourceStartSeconds + durationInFrames / project.output.fps;
  if (requiredEnd > source.metadata.durationSeconds + 1e-3) {
    throw new SceneRenderError(
      `Video asset ${media.assetId} is too short for shot ${shot.id} at render time`,
    );
  }
  return (
    <Sequence from={shot.startFrame} durationInFrames={durationInFrames} layout="none">
      <AbsoluteFill
        style={{backgroundColor: shot.params.background ?? '#000000', overflow: 'hidden'}}
      >
        <OffthreadVideo
          src={source.src}
          trimBefore={source.trimBefore}
          muted
          style={videoLayerStyle(media)}
        />
      </AbsoluteFill>
    </Sequence>
  );
};

export const videoSceneRenderer: MediaSceneRenderer = {
  kind: 'video',
  mode: 'media',
  Component: VideoScene,
};
