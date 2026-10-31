import {
  AbsoluteFill,
  Img,
  OffthreadVideo,
  Sequence,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import {useLayoutEffect, useRef} from 'react';
import {SceneRenderError} from '../../errors';
import type {HybridOverlayConfig, ShotHybridMedia} from '../../config/types';
import type {MediaSceneRenderer, MediaSceneRendererProps} from '../types';
import {
  imageLayerStyle,
  resolveVideoSource,
  shotSequenceDuration,
  videoLayerStyle,
} from './mediaShared';

const hash = (value: number): number => {
  const noise = Math.sin(value * 12.9898 + 78.233) * 43758.5453;
  return noise - Math.floor(noise);
};

const drawRain = (
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  frame: number,
  fps: number,
  color: string,
  intensity: number,
): void => {
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  const alphaBase = 0.12 + intensity * 0.55;
  for (let index = 0; index < 90; index++) {
    const x = hash(index * 3.17) * width + Math.sin(frame * 0.01 + index) * 8;
    const speed = height * (0.3 + hash(index * 7.31) * 0.9) * (0.5 + intensity);
    const y = ((hash(index * 5.13) * height + (frame / fps) * speed) % (height + 80)) - 40;
    ctx.globalAlpha = alphaBase * (0.35 + hash(index * 11.7) * 0.65);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - 5 - intensity * 5, y + 16 + intensity * 10);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
};

const drawOrbits = (
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  frame: number,
  fps: number,
  color: string,
  intensity: number,
): void => {
  const centerX = width * 0.5;
  const centerY = height * 0.48;
  const min = Math.min(width, height);
  const time = frame / fps;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  for (let ring = 0; ring < 7; ring++) {
    const radius = min * (0.12 + ring * 0.045) + Math.sin(time * 0.7 + ring) * min * 0.015;
    ctx.globalAlpha = (0.12 + intensity * 0.3) * (1 - ring * 0.1);
    ctx.lineWidth = Math.max(1, min * 0.0022);
    ctx.beginPath();
    ctx.ellipse(
      centerX,
      centerY,
      radius,
      radius * (0.42 + ring * 0.015),
      Math.sin(time * 0.2 + ring * 0.4) * 0.15,
      0,
      Math.PI * 2,
    );
    ctx.stroke();
    const angle = time * (0.5 + ring * 0.08) + ring;
    const dotX = centerX + Math.cos(angle) * radius;
    const dotY = centerY + Math.sin(angle) * radius * (0.42 + ring * 0.015);
    const dotRadius = Math.max(2, min * 0.006) * (0.6 + intensity);
    ctx.globalAlpha = 0.35 + intensity * 0.45;
    ctx.beginPath();
    ctx.arc(dotX, dotY, dotRadius, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
};

const drawScan = (
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  frame: number,
  fps: number,
  color: string,
  intensity: number,
): void => {
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.04 + intensity * 0.08;
  for (let y = 0; y < height; y += 6) {
    ctx.fillRect(0, y, width, 1);
  }
  const bandY = ((frame / fps) * height * 0.45) % (height + 200) - 100;
  const gradient = ctx.createLinearGradient(0, bandY - 90, 0, bandY + 90);
  gradient.addColorStop(0, 'rgba(0,0,0,0)');
  gradient.addColorStop(0.5, color);
  gradient.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.globalAlpha = 0.15 + intensity * 0.35;
  ctx.fillStyle = gradient;
  ctx.fillRect(0, bandY - 90, width, 180);
  ctx.globalAlpha = 1;
};

const CanvasOverlay: React.FC<HybridOverlayConfig> = ({kind, intensity, color}) => {
  const frame = useCurrentFrame();
  const {fps, width, height} = useVideoConfig();
  const ref = useRef<HTMLCanvasElement>(null);
  const resolvedColor = color ?? '#E9E3D2';

  useLayoutEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, width, height);
    ctx.save();
    if (kind === 'rain') {
      drawRain(ctx, width, height, frame, fps, resolvedColor, intensity);
    } else if (kind === 'orbits') {
      drawOrbits(ctx, width, height, frame, fps, resolvedColor, intensity);
    } else {
      drawScan(ctx, width, height, frame, fps, resolvedColor, intensity);
    }
    ctx.restore();
  }, [frame, fps, height, intensity, kind, resolvedColor, width]);

  return (
    <canvas
      ref={ref}
      width={width}
      height={height}
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
      }}
    />
  );
};

const HybridInner: React.FC<{
  media: ShotHybridMedia;
  videoSrc: string;
  trimBefore: number;
  layerSources: Array<{order: number; src: string; opacity: number; fit: 'contain' | 'cover'; positionX: number; positionY: number; scale: number; visibleFromFrame: number; visibleToFrame: number}>;
  background: string;
  accent: string;
}> = ({media, videoSrc, trimBefore, layerSources, background, accent}) => {
  const localFrame = useCurrentFrame();
  return (
    <AbsoluteFill style={{backgroundColor: background, overflow: 'hidden'}}>
      <OffthreadVideo
        src={videoSrc}
        trimBefore={trimBefore}
        muted
        style={videoLayerStyle(media.video)}
      />
      {layerSources.map((layer) =>
        localFrame >= layer.visibleFromFrame && localFrame < layer.visibleToFrame ? (
          <Img key={layer.order} src={layer.src} style={imageLayerStyle(layer)} />
        ) : null,
      )}
      <CanvasOverlay
        kind={media.overlay.kind}
        intensity={media.overlay.intensity}
        color={media.overlay.color ?? accent}
      />
    </AbsoluteFill>
  );
};

const HybridScene: React.FC<MediaSceneRendererProps> = ({project, shot, publicAssets}) => {
  const media = shot.media;
  if (!media || media.kind !== 'hybrid') {
    throw new SceneRenderError(`Hybrid renderer requires shot.media.kind = hybrid on ${shot.id}`);
  }
  const source = resolveVideoSource(project, shot, media.video, publicAssets);
  const durationInFrames = shotSequenceDuration(shot);
  const requiredEnd =
    media.video.sourceStartSeconds + durationInFrames / project.output.fps;
  if (requiredEnd > source.metadata.durationSeconds + 1e-3) {
    throw new SceneRenderError(
      `Video asset ${media.video.assetId} is too short for hybrid shot ${shot.id} at render time`,
    );
  }
  const layerSources = [...media.layers]
    .sort((left, right) => left.order - right.order)
    .map((layer) => {
      const publicPath = publicAssets[layer.assetId];
      if (!publicPath) {
        throw new SceneRenderError(
          `Layer asset ${layer.assetId} for shot ${shot.id} is not staged for rendering`,
        );
      }
      return {
        order: layer.order,
        src: staticFile(publicPath),
        opacity: layer.opacity,
        fit: layer.fit,
        positionX: layer.positionX,
        positionY: layer.positionY,
        scale: layer.scale,
        visibleFromFrame: layer.visibleFromFrame,
        visibleToFrame: layer.visibleToFrame,
      };
    });

  return (
    <Sequence from={shot.startFrame} durationInFrames={durationInFrames} layout="none">
      <HybridInner
        media={media}
        videoSrc={source.src}
        trimBefore={source.trimBefore}
        layerSources={layerSources}
        background={shot.params.background ?? '#000000'}
        accent={shot.params.accent ?? '#FFFFFF'}
      />
    </Sequence>
  );
};

export const hybridSceneRenderer: MediaSceneRenderer = {
  kind: 'hybrid',
  mode: 'media',
  Component: HybridScene,
};
