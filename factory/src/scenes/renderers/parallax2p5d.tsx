import {
  AbsoluteFill,
  Img,
  OffthreadVideo,
  Sequence,
  staticFile,
  useCurrentFrame,
} from 'remotion';
import {useLayoutEffect, useRef} from 'react';
import type {CSSProperties} from 'react';
import {SceneRenderError} from '../../errors';
import {getStyleProfile} from '../../style/catalog';
import type {
  ComicTreatmentConfig,
  GradeConfig,
  ParallaxBackgroundConfig,
  ParallaxCharacterConfig,
  ParallaxLayerConfig,
  ShotParallaxMedia,
} from '../../config/types';
import type {MediaSceneRenderer, MediaSceneRendererProps} from '../types';
import {resolveVideoSource, shotSequenceDuration} from './mediaShared';
import {
  NEUTRAL_GRADE,
  hashNoise,
  mergeDrawOrder,
  quantizeMotionFrame,
  resolveCharacterDepthTransform,
  resolveComic,
  resolveGrade,
  resolveLayerDepthTransform,
  sampleCamera,
  sampleCharacterPerformance,
} from '../parallaxMath';

type DepthCard = {
  parallax: number;
  scale: number;
  positionX: number;
  positionY: number;
  motion?: ParallaxLayerConfig['motion'];
};

type ParallaxPlan = {
  background: {
    kind: 'image' | 'video';
    src: string;
    trimBefore: number;
    opacity: number;
    fit: 'contain' | 'cover';
    blur: number;
    card: DepthCard;
  };
  layers: Array<ParallaxLayerConfig & {src: string}>;
  characters: ParallaxCharacterConfig[];
  /** Public URL for every approved asset this shot draws (layers and poses). */
  assetSrc: Record<string, string>;
  camera: ShotParallaxMedia['camera'];
  grade: GradeConfig;
  comic: ComicTreatmentConfig;
  atmosphere: ShotParallaxMedia['atmosphere'];
  light: ShotParallaxMedia['light'];
  width: number;
  height: number;
  fps: number;
  durationInFrames: number;
};

const cardTransform = (
  card: DepthCard,
  plan: ParallaxPlan,
  motionFrame: number,
): {transform: string; scale: number} => {
  const sample = sampleCamera(plan.camera, motionFrame, plan.durationInFrames);
  const depth = resolveLayerDepthTransform(
    card,
    plan.camera,
    sample,
    motionFrame,
    plan.durationInFrames,
  );
  return {
    scale: depth.scale,
    transform: `translate(${card.positionX + depth.translateX * plan.width}px, ${
      card.positionY + depth.translateY * plan.height
    }px) scale(${depth.scale})`,
  };
};

const drawRainAndMist = (
  ctx: CanvasRenderingContext2D,
  frame: number,
  fps: number,
  width: number,
  height: number,
  plan: ParallaxPlan,
): void => {
  const atmosphere = plan.atmosphere;
  const intensity = atmosphere.intensity;
  const time = frame / fps;

  if (atmosphere.kind === 'mist' || atmosphere.kind === 'rain-mist') {
    for (let band = 0; band < 4; band += 1) {
      const baseY = height * (0.18 + band * 0.16);
      const drift = Math.sin(time * (0.35 + band * 0.12) + band) * width * 0.06;
      const gradient = ctx.createLinearGradient(0, baseY - height * 0.1, 0, baseY + height * 0.1);
      gradient.addColorStop(0, 'rgba(150,170,190,0)');
      gradient.addColorStop(0.5, `rgba(150,170,190,${(0.05 + intensity * 0.12).toFixed(4)})`);
      gradient.addColorStop(1, 'rgba(150,170,190,0)');
      ctx.fillStyle = gradient;
      ctx.fillRect(drift - width * 0.2, baseY - height * 0.1, width * 1.4, height * 0.2);
    }
  }

  if (atmosphere.kind !== 'rain' && atmosphere.kind !== 'rain-mist') return;
  const wind = atmosphere.windX;
  ctx.lineCap = 'round';
  // Two streak tiers: rain itself carries depth separation.
  for (let tier = 0; tier < 2; tier += 1) {
    const count = tier === 0 ? 120 : 64;
    const speed = tier === 0 ? 0.55 : 1.1;
    const length = tier === 0 ? 10 : 22;
    ctx.strokeStyle =
      tier === 0
        ? `rgba(170,190,210,${(0.1 + intensity * 0.16).toFixed(4)})`
        : `rgba(210,225,240,${(0.16 + intensity * 0.3).toFixed(4)})`;
    ctx.lineWidth = tier === 0 ? 1 : 2;
    for (let index = 0; index < count; index += 1) {
      const seed = index + tier * 131;
      const x = hashNoise(seed * 3.17) * (width + 120) - 60 + wind * height * time;
      const y = ((hashNoise(seed * 5.13) * height + time * speed * height) % (height + 120)) - 60;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x - wind * length * 1.6 - 2, y + length);
      ctx.stroke();
    }
  }
  ctx.strokeStyle = `rgba(200,220,240,${(0.08 + intensity * 0.18).toFixed(4)})`;
  ctx.lineWidth = 1;
  for (let index = 0; index < 48; index += 1) {
    const x = hashNoise(index * 9.71 + frame * 0.13) * width;
    const y = height * 0.86 + hashNoise(index * 4.31) * height * 0.13;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + 2, y - 4);
    ctx.stroke();
  }
};

const drawGradeOverlay = (
  ctx: CanvasRenderingContext2D,
  frame: number,
  plan: ParallaxPlan,
): void => {
  const {grade, width, height} = plan;
  if (grade.tintOpacity > 0) {
    ctx.globalAlpha = grade.tintOpacity;
    ctx.fillStyle = grade.tint;
    ctx.fillRect(0, 0, width, height);
    ctx.globalAlpha = 1;
  }
  if (grade.vignette > 0) {
    const gradient = ctx.createRadialGradient(
      width * 0.5,
      height * 0.48,
      Math.min(width, height) * 0.2,
      width * 0.5,
      height * 0.5,
      Math.hypot(width, height) * 0.62,
    );
    gradient.addColorStop(0, 'rgba(0,0,0,0)');
    gradient.addColorStop(1, `rgba(0,0,0,${grade.vignette})`);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
  }
  if (grade.grain > 0) {
    // Position-seeded grain: identical every frame, so renders stay reproducible.
    const cells = Math.floor((width * height) / 2600);
    ctx.fillStyle = grade.tint;
    ctx.globalAlpha = grade.grain;
    for (let index = 0; index < cells; index += 1) {
      const x = Math.floor(hashNoise(index * 1.37) * width);
      const y = Math.floor(hashNoise(index * 2.69) * height);
      ctx.fillRect(x, y, 1, 1);
    }
    ctx.globalAlpha = 1;
  }
  const sweep = plan.light.sweep;
  if (sweep) {
    const progress = plan.durationInFrames <= 1 ? 0 : frame / (plan.durationInFrames - 1);
    const centerX = width * (sweep.fromX + (sweep.toX - sweep.fromX) * progress);
    const bandWidth = width * sweep.width;
    const gradient = ctx.createLinearGradient(centerX - bandWidth, 0, centerX + bandWidth, 0);
    gradient.addColorStop(0, 'rgba(255,255,255,0)');
    gradient.addColorStop(0.5, sweep.color ?? 'rgba(255,224,176,1)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.globalAlpha = Math.min(1, sweep.intensity * 0.9);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
    ctx.globalAlpha = 1;
  }
};

const drawComicOverlays = (
  ctx: CanvasRenderingContext2D,
  frame: number,
  plan: ParallaxPlan,
): void => {
  const comic = plan.comic;
  const {width, height} = plan;

  if (comic.halftone > 0) {
    const spacing = 8;
    ctx.fillStyle = `rgba(10,10,18,${(comic.halftone * 0.22).toFixed(4)})`;
    for (let y = spacing / 2; y < height; y += spacing) {
      for (let x = spacing / 2; x < width; x += spacing) {
        if (hashNoise(Math.round(x) * 0.17 + Math.round(y) * 0.31) > 0.34) continue;
        ctx.beginPath();
        ctx.arc(x, y, 1.7, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  if (comic.speedLines > 0) {
    const centerX = width * 0.5;
    const centerY = height * 0.45;
    const reach = Math.hypot(width, height);
    ctx.strokeStyle = `rgba(10,10,18,${(0.1 + comic.speedLines * 0.5).toFixed(4)})`;
    for (let index = 0; index < 84; index += 1) {
      const angle = hashNoise(index * 2.71) * Math.PI * 2 + frame * 0.012;
      const inner = reach * (0.16 + hashNoise(index * 7.7) * 0.3);
      ctx.lineWidth = width * (0.004 + hashNoise(index * 11.3) * 0.012);
      ctx.beginPath();
      ctx.moveTo(centerX + Math.cos(angle) * inner, centerY + Math.sin(angle) * inner);
      ctx.lineTo(centerX + Math.cos(angle) * reach, centerY + Math.sin(angle) * reach);
      ctx.stroke();
    }
  }

  if (comic.panel) {
    const panel = comic.panel;
    const inset = Math.round(width * panel.inset);
    ctx.strokeStyle = panel.color;
    ctx.lineWidth = panel.gutter;
    ctx.strokeRect(
      inset + panel.gutter / 2,
      inset + panel.gutter / 2,
      width - 2 * inset - panel.gutter,
      height - 2 * inset - panel.gutter,
    );
  }

  for (const impact of comic.impacts) {
    const distance = frame - impact.frame;
    if (distance < 0 || distance > 2) continue;
    ctx.globalAlpha = impact.intensity * (1 - distance / 3);
    ctx.fillStyle = impact.color ?? '#ffd166';
    ctx.fillRect(0, 0, width, height);
    ctx.globalAlpha = 1;
  }

  for (const wipe of comic.wipes) {
    const distance = frame - wipe.frame;
    if (distance < 0 || distance >= wipe.holdFrames) continue;
    const progress = distance / wipe.holdFrames;
    const horizontal = wipe.direction === 'left' || wipe.direction === 'right';
    const size = Math.round((1 - progress) * (horizontal ? width : height));
    ctx.fillStyle = wipe.color ?? '#0a0a12';
    if (wipe.direction === 'left') ctx.fillRect(0, 0, size, height);
    else if (wipe.direction === 'right') ctx.fillRect(width - size, 0, size, height);
    else if (wipe.direction === 'up') ctx.fillRect(0, 0, width, size);
    else ctx.fillRect(0, height - size, width, size);
  }
};

const ParallaxOverlay: React.FC<{plan: ParallaxPlan}> = ({plan}) => {
  const frame = useCurrentFrame();
  const ref = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, plan.width, plan.height);
    ctx.save();
    drawRainAndMist(ctx, frame, plan.fps, plan.width, plan.height, plan);
    ctx.restore();
    ctx.save();
    drawGradeOverlay(ctx, frame, plan);
    ctx.restore();
    ctx.save();
    drawComicOverlays(ctx, frame, plan);
    ctx.restore();
  }, [frame, plan]);
  return (
    <canvas
      ref={ref}
      width={plan.width}
      height={plan.height}
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

/**
 * Draws one approved character pose track. The pivot of the artwork is pinned to
 * the authored anchor, so swapping a pose never makes the subject jump. Pose
 * selection uses the raw shot-local output frame: a cut lands on exactly that
 * frame and a crossfade blends only the poses it names.
 */
const CharacterPose: React.FC<{
  character: ParallaxCharacterConfig;
  plan: ParallaxPlan;
  localFrame: number;
  motionFrame: number;
}> = ({character, plan, localFrame, motionFrame}) => {
  const performance = sampleCharacterPerformance(character, localFrame);
  const shaft = sampleCamera(plan.camera, motionFrame, plan.durationInFrames);
  const depth = resolveCharacterDepthTransform(character, shaft);
  const baseHeight = character.height * plan.height;
  const anchorLeft = (character.anchorX + depth.translateX + performance.idleX) * plan.width;
  const anchorTop = (character.anchorY + depth.translateY + performance.idleY) * plan.height;
  return (
    <>
      {performance.poses.map((pose, index) => {
        const src = plan.assetSrc[pose.assetId];
        if (!src) {
          throw new SceneRenderError(
            `Character ${character.characterId} pose asset ${pose.assetId} is not staged for rendering`,
          );
        }
        const left = anchorLeft + pose.offsetX * plan.width;
        const top = anchorTop + pose.offsetY * plan.height;
        const scale = pose.scale * depth.zoom * performance.idleScale;
        return (
          <div
            key={`${character.characterId}-${pose.assetId}-${index}`}
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              transform: `translate(${left}px, ${top}px) scale(${scale})`,
              transformOrigin: '0 0',
              opacity: pose.opacity,
              willChange: 'transform, opacity',
            }}
          >
            <Img
              src={src}
              style={{
                display: 'block',
                height: baseHeight,
                width: 'auto',
                transform: `translate(${-character.pivotX * 100}%, ${-character.pivotY * 100}%)`,
              }}
            />
          </div>
        );
      })}
    </>
  );
};

const ParallaxInner: React.FC<{plan: ParallaxPlan}> = ({plan}) => {
  const localFrame = useCurrentFrame();
  const motionFrame = quantizeMotionFrame(localFrame, plan.fps, plan.comic.motionStepFps);
  const light =
    plan.light.amplitude > 0 && plan.light.frequency > 0
      ? 1 +
        plan.light.amplitude *
          Math.sin(
            (motionFrame / plan.fps) * plan.light.frequency * Math.PI * 2 +
              plan.light.phase * Math.PI * 2,
          )
      : 1;
  const gradeFilter = `saturate(${plan.grade.saturation}) contrast(${plan.grade.contrast}) brightness(${(
    plan.grade.brightness * light
  ).toFixed(4)})`;

  const backgroundTransform = cardTransform(plan.background.card, plan, motionFrame);
  const backgroundStyle: CSSProperties = {
    position: 'absolute',
    inset: 0,
    width: '100%',
    height: '100%',
    objectFit: plan.background.fit,
    opacity: plan.background.opacity,
    transform: backgroundTransform.transform,
    transformOrigin: 'center center',
    willChange: 'transform',
    filter: plan.background.blur > 0 ? `blur(${plan.background.blur}px)` : undefined,
  };

  return (
    <AbsoluteFill style={{backgroundColor: '#05080d', overflow: 'hidden'}}>
      <AbsoluteFill style={{filter: gradeFilter}}>
        {plan.background.kind === 'video' ? (
          <OffthreadVideo
            src={plan.background.src}
            trimBefore={plan.background.trimBefore}
            muted
            style={backgroundStyle}
          />
        ) : (
          <Img src={plan.background.src} style={backgroundStyle} />
        )}
        {mergeDrawOrder(plan.layers, plan.characters).map((entry) => {
          if (entry.kind === 'character') {
            return (
              <CharacterPose
                key={`character-${entry.character.characterId}`}
                character={entry.character}
                plan={plan}
                localFrame={localFrame}
                motionFrame={motionFrame}
              />
            );
          }
          const layer = entry.layer;
          if (localFrame < layer.visibleFromFrame || localFrame >= layer.visibleToFrame) {
            return null;
          }
          return (
            <Img
              key={`layer-${layer.order}`}
              src={plan.assetSrc[layer.assetId]}
              style={{
                position: 'absolute',
                inset: 0,
                width: '100%',
                height: '100%',
                objectFit: layer.fit,
                opacity: layer.opacity,
                transform: cardTransform(layer, plan, motionFrame).transform,
                transformOrigin: 'center center',
                willChange: 'transform',
                filter: layer.blur && layer.blur > 0 ? `blur(${layer.blur}px)` : undefined,
              }}
            />
          );
        })}
      </AbsoluteFill>
      <ParallaxOverlay plan={plan} />
    </AbsoluteFill>
  );
};

const backgroundSource = (
  project: MediaSceneRendererProps['project'],
  shot: MediaSceneRendererProps['shot'],
  background: ParallaxBackgroundConfig,
  publicAssets: Record<string, string>,
): {src: string; trimBefore: number} => {
  if (background.kind === 'video') {
    const source = resolveVideoSource(project, shot, background, publicAssets);
    return {src: source.src, trimBefore: source.trimBefore};
  }
  const publicPath = publicAssets[background.assetId];
  if (!publicPath) {
    throw new SceneRenderError(
      `Background plate asset ${background.assetId} for shot ${shot.id} is not staged for rendering`,
    );
  }
  return {src: staticFile(publicPath), trimBefore: 0};
};

const ParallaxScene: React.FC<MediaSceneRendererProps> = ({project, shot, publicAssets}) => {
  const media = shot.media;
  if (!media || media.kind !== 'parallax-2p5d') {
    throw new SceneRenderError(
      `parallax-2p5d renderer requires shot.media.kind = parallax-2p5d on ${shot.id}`,
    );
  }
  const durationInFrames = shotSequenceDuration(shot);
  const background = backgroundSource(project, shot, media.background, publicAssets);
  if (media.background.kind === 'video') {
    const metadata = project.mediaAssets[media.background.assetId];
    if (!metadata) {
      throw new SceneRenderError(
        `Background video ${media.background.assetId} for ${shot.id} has no verified probe metadata`,
      );
    }
    const requiredEnd =
      media.background.sourceStartSeconds + durationInFrames / project.output.fps;
    if (requiredEnd > metadata.durationSeconds + 1e-3) {
      throw new SceneRenderError(
        `Background video ${media.background.assetId} is too short for parallax shot ${shot.id} at render time`,
      );
    }
  }

  const layerSources: Array<ParallaxLayerConfig & {src: string}> = media.layers.map((layer) => {
    const publicPath = publicAssets[layer.assetId];
    if (!publicPath) {
      throw new SceneRenderError(
        `Layer asset ${layer.assetId} for shot ${shot.id} is not staged for rendering`,
      );
    }
    return {...layer, src: staticFile(publicPath)};
  });

  const assetSrc: Record<string, string> = {};
  for (const layer of media.layers) {
    assetSrc[layer.assetId] = staticFile(publicAssets[layer.assetId]);
  }
  const characters = media.characters ?? [];
  for (const character of characters) {
    for (const pose of character.poses) {
      const publicPath = publicAssets[pose.assetId];
      if (!publicPath) {
        throw new SceneRenderError(
          `Character ${character.characterId} pose ${pose.assetId} for shot ${shot.id} is not staged for rendering`,
        );
      }
      assetSrc[pose.assetId] = staticFile(publicPath);
    }
  }

  const profile = project.visual.style ? getStyleProfile(project.visual.style.id) : undefined;
  const grade = profile ? resolveGrade(profile, media.grade) : {...NEUTRAL_GRADE, ...media.grade};
  const plan: ParallaxPlan = {
    background: {
      kind: media.background.kind,
      src: background.src,
      trimBefore: background.trimBefore,
      opacity: media.background.opacity,
      fit: media.background.fit,
      blur: media.background.blur ?? 0,
      card: {
        parallax: media.background.parallax,
        scale: media.background.scale,
        positionX: media.background.positionX,
        positionY: media.background.positionY,
      },
    },
    layers: layerSources,
    characters,
    assetSrc,
    camera: media.camera,
    grade,
    comic: resolveComic(media.comic),
    atmosphere: media.atmosphere,
    light: media.light,
    width: project.output.width,
    height: project.output.height,
    fps: project.output.fps,
    durationInFrames,
  };

  return (
    <Sequence from={shot.startFrame} durationInFrames={durationInFrames} layout="none">
      <ParallaxInner plan={plan} />
    </Sequence>
  );
};

export const parallaxSceneRenderer: MediaSceneRenderer = {
  kind: 'parallax-2p5d',
  mode: 'media',
  Component: ParallaxScene,
};
