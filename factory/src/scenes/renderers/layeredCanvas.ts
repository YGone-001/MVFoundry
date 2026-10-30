import type {RenderProjectSnapshot} from '../../config/types';
import type {SceneRenderContext, SceneRenderer} from '../types';

const hash = (n: number): number => {
  const value = Math.sin(n * 12.9898 + 78.233) * 43758.5453;
  return value - Math.floor(value);
};

export const layeredCanvasRenderer: SceneRenderer = {
  kind: 'layered-canvas',
  canvasSize: (project) => ({width: project.output.width, height: project.output.height}),
  samplingFps: (project) => project.output.fps,
  render: (ctx, context: SceneRenderContext) => {
    const {project, shot, frame, publicAssets} = context;
    const width = project.output.width;
    const height = project.output.height;
    const params = shot.params;
    const background = params.background ?? '#123044';
    const accent = params.accent ?? '#2EC4B6';
    const secondary = params.secondary ?? '#FF9F1C';
    const hasImage = Boolean(params.assetId && publicAssets[params.assetId]);

    ctx.clearRect(0, 0, width, height);
    if (!hasImage) {
      const gradient = ctx.createLinearGradient(0, 0, width, height);
      gradient.addColorStop(0, background);
      gradient.addColorStop(1, accent);
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, width, height);
    } else {
      const wash = ctx.createLinearGradient(0, 0, 0, height);
      wash.addColorStop(0, 'rgba(5, 8, 13, 0.18)');
      wash.addColorStop(1, 'rgba(5, 8, 13, 0.55)');
      ctx.fillStyle = wash;
      ctx.fillRect(0, 0, width, height);
    }

    const t = frame.localTime;
    const motion = params.motion ?? 1.5;
    ctx.save();
    ctx.globalAlpha = 0.22;
    ctx.fillStyle = accent;
    for (let i = 0; i < 4; i++) {
      const radius = width * (0.12 + i * 0.05);
      const cx = width * (0.25 + 0.18 * i) + Math.sin(t * motion + i) * width * 0.04;
      const cy = height * (0.35 + 0.12 * i) + Math.cos(t * motion * 0.7 + i) * height * 0.03;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    ctx.save();
    ctx.globalAlpha = 0.6;
    ctx.strokeStyle = secondary;
    ctx.lineWidth = Math.max(1, Math.round(width * 0.0015));
    for (let line = 0; line < 7; line++) {
      const y = height * (0.22 + line * 0.09) + Math.sin(t * motion + line * 0.8) * height * 0.02;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y + Math.cos(t * motion * 0.6 + line) * height * 0.01);
      ctx.stroke();
    }
    ctx.restore();

    ctx.save();
    ctx.globalAlpha = 0.08;
    ctx.fillStyle = '#E9E3D2';
    const grainCount = Math.floor((width * height) / 9000);
    for (let i = 0; i < grainCount; i++) {
      const x = Math.floor(hash(i * 1.3 + frame.localFrame) * width);
      const y = Math.floor(hash(i * 2.7 + frame.localFrame * 1.1) * height);
      ctx.fillRect(x, y, 2, 2);
    }
    ctx.restore();
  },
};
