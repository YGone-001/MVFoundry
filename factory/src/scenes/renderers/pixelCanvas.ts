import type {RenderProjectShot, RenderProjectSnapshot} from '../../config/types';
import {P, ditherV, ellipse, hash, mix, px, rect, speckle, vignette} from './pixelKit';
import type {CanvasSize, SceneRenderer} from '../types';

const canvasSize = (project: RenderProjectSnapshot): CanvasSize => {
  const pixel = project.visual.pixel;
  if (!pixel) throw new Error('pixel-canvas requires visual.pixel in the project profile');
  return {width: pixel.internalWidth, height: pixel.internalHeight};
};

const renderPixel = (
  ctx: CanvasRenderingContext2D,
  project: RenderProjectSnapshot,
  shot: RenderProjectShot,
  frameTick: number,
): void => {
  const size = canvasSize(project);
  const width = size.width;
  const height = size.height;
  const params = shot.params;
  const background = params.background ?? P.deep;
  const accent = params.accent ?? P.mint;
  const secondary = params.secondary ?? P.amber;
  const bars = params.bars ?? 6;
  const motion = params.motion ?? 2.5;

  ditherV(ctx, 0, 0, width, height, background, P.ink, 6);
  const horizon = Math.round(height * 0.64);
  rect(ctx, 0, horizon, width, height - horizon, mix(background, P.ink, 0.55));

  const shift = frameTick * motion;

  for (let i = 0; i < bars; i++) {
    const barWidth = Math.max(6, Math.round(width / (bars * 1.6)));
    const x = Math.round(((i * width) / bars + shift) % (width + barWidth)) - barWidth;
    const barHeight = Math.max(12, Math.floor(height * 0.12) + Math.floor(hash(i * 7.1 + (project.visual.pixel?.samplingFps ?? 12)) * height * 0.35));
    rect(ctx, x, horizon - barHeight, barWidth, barHeight, mix(background, P.teal, 0.7));
    for (let wy = 6; wy < barHeight - 4; wy += 7) {
      for (let wx = 3; wx < barWidth - 3; wx += 6) {
        if (hash(i * 31 + wy * 7 + wx) > 0.72) {
          px(ctx, x + wx, horizon - barHeight + wy, hash(wy) > 0.5 ? secondary : accent);
        }
      }
    }
  }

  const sunRadius = Math.max(4, Math.round(Math.min(width, height) * 0.063));
  const sunX = width * 0.5 + Math.sin(frameTick / 14) * width * 0.19;
  const sunY = horizon - Math.round(height * 0.14);
  ellipse(ctx, sunX, sunY, sunRadius, sunRadius, accent);
  ellipse(ctx, sunX, sunY, sunRadius + 7, sunRadius + 7, mix(background, accent, 0.35));
  rect(ctx, 0, horizon + 1, width, 1, mix(accent, P.ink, 0.4));

  const lanes = 5;
  const laneGap = Math.max(4, Math.round((height - horizon) / (lanes + 1)));
  for (let lane = 0; lane < lanes; lane++) {
    const y = horizon + laneGap + lane * laneGap;
    if (y >= height) break;
    for (let x = 0; x < width; x += 14) {
      rect(ctx, x + ((frameTick * (1 + lane * 0.2)) % 14), y, 8, 1, mix(P.steel, background, 0.6));
    }
  }

  speckle(ctx, 0, 0, width, height, mix(P.bone, background, 0.6), 0.0009, 11);
  vignette(ctx, width, height, 1.1);
};

export const pixelCanvasRenderer: SceneRenderer = {
  kind: 'pixel-canvas',
  canvasSize,
  samplingFps: (project) => project.visual.pixel?.samplingFps ?? project.output.fps,
  render: (ctx, context) => {
    renderPixel(ctx, context.project, context.shot, context.frame.animationTick);
  },
};
