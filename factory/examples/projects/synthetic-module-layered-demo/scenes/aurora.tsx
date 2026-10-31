type AuroraContext = {
  frame: {outputFrame: number; localFrame: number; localTime: number; animationTick: number; samplingFps: number};
  canvas: {width: number; height: number};
  output: {width: number; height: number; fps: number};
  params: {background?: string; accent?: string; secondary?: string};
  moduleParams: Record<string, string | number | boolean>;
  assets: Record<string, {publicPath: string}>;
};

const hash = (value: number): number => {
  const noise = Math.sin(value * 53.13 + 17.71) * 15731.743;
  return noise - Math.floor(noise);
};

const sceneModule = {
  id: 'aurora',
  contractVersion: 1,
  moduleType: 'canvas2d' as const,
  label: 'Layered aurora curtains',
  params: [
    {key: 'intensity', type: 'number' as const, required: true},
    {key: 'drift', type: 'number' as const},
  ],
  assetDependencies: ['BG-01'],
  render: (ctx: CanvasRenderingContext2D, context: AuroraContext): void => {
    const width = context.canvas.width;
    const height = context.canvas.height;
    const time = context.frame.localTime;
    const intensity = Math.max(0, Math.min(1, Number(context.moduleParams.intensity ?? 0.6)));
    const drift = Number(context.moduleParams.drift ?? 1);
    const accent = context.params.accent ?? '#2EC4B6';
    const secondary = context.params.secondary ?? '#FF9F1C';
    const backgroundRef = context.assets['BG-01'];
    const baseAlpha = backgroundRef ? 0.05 : 0.2;

    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    for (let band = 0; band < 6; band++) {
      const top = height * (0.05 + band * 0.055);
      const amplitude = height * (0.05 + hash(band * 3.1) * 0.05);
      const sway = time * (0.22 + band * 0.03) * drift + band * 1.4;
      const gradient = ctx.createLinearGradient(0, top, width, top + height * 0.5);
      gradient.addColorStop(0, 'rgba(0,0,0,0)');
      gradient.addColorStop(0.18, band % 2 === 0 ? accent : secondary);
      gradient.addColorStop(0.55, band % 3 === 0 ? secondary : accent);
      gradient.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.globalAlpha = baseAlpha + intensity * (0.16 + hash(band * 7.7) * 0.12);
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.moveTo(0, top);
      for (let x = 0; x <= width; x += 18) {
        const y =
          top +
          Math.sin(x * 0.006 + sway) * amplitude +
          Math.sin(x * 0.017 + sway * 1.7) * amplitude * 0.35;
        ctx.lineTo(x, y);
      }
      ctx.lineTo(width, top + height * 0.48);
      for (let x = width; x >= 0; x -= 18) {
        const y =
          top +
          height * 0.2 +
          Math.sin(x * 0.005 + sway * 1.2) * amplitude * 0.8;
        ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();

    ctx.save();
    ctx.globalAlpha = 0.2 + intensity * 0.3;
    const glow = ctx.createRadialGradient(
      width * 0.5,
      height * 0.72,
      10,
      width * 0.5,
      height * 0.72,
      width * 0.6,
    );
    glow.addColorStop(0, accent);
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, height * 0.35, width, height * 0.65);
    ctx.restore();

    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.strokeStyle = secondary;
    ctx.lineWidth = Math.max(1, width * 0.0016);
    for (let line = 0; line < 8; line++) {
      const y = height * (0.62 + line * 0.035) + Math.sin(time * 0.6 + line) * height * 0.012;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.bezierCurveTo(width * 0.3, y - height * 0.02, width * 0.7, y + height * 0.02, width, y);
      ctx.stroke();
    }
    ctx.restore();

    ctx.save();
    ctx.globalAlpha = 0.35;
    for (let index = 0; index < 90; index++) {
      const x = hash(index * 2.7) * width + Math.sin(time * 0.3 + index) * 8;
      const y = hash(index * 5.3 + 1) * height * 0.7;
      const size = 1 + Math.floor(hash(index * 11.1) * 2);
      ctx.fillStyle = index % 4 === 0 ? secondary : '#E9E3D2';
      ctx.fillRect(Math.floor(x), Math.floor(y), size, size);
    }
    ctx.restore();
  },
};

export {sceneModule};
