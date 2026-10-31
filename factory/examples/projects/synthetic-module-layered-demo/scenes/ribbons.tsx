type RibbonsContext = {
  frame: {outputFrame: number; localFrame: number; localTime: number; animationTick: number; samplingFps: number};
  canvas: {width: number; height: number};
  output: {width: number; height: number; fps: number};
  params: {background?: string; accent?: string; secondary?: string};
  moduleParams: Record<string, string | number | boolean>;
  assets: Record<string, {publicPath: string}>;
};

const hash = (value: number): number => {
  const noise = Math.sin(value * 37.91 + 4.73) * 9317.127;
  return noise - Math.floor(noise);
};

const sceneModule = {
  id: 'ribbons',
  contractVersion: 1,
  moduleType: 'canvas2d' as const,
  label: 'Layered ribbon arcs',
  params: [
    {key: 'count', type: 'number' as const, required: true},
    {key: 'speed', type: 'number' as const},
  ],
  assetDependencies: ['BG-01'],
  render: (ctx: CanvasRenderingContext2D, context: RibbonsContext): void => {
    const width = context.canvas.width;
    const height = context.canvas.height;
    const tick = context.frame.animationTick;
    const time = context.frame.localTime;
    const count = Math.max(1, Math.min(24, Math.round(Number(context.moduleParams.count ?? 7))));
    const speed = Number(context.moduleParams.speed ?? 1);
    const accent = context.params.accent ?? '#FF9F1C';
    const secondary = context.params.secondary ?? '#2EC4B6';
    const hasBackground = context.assets['BG-01'] !== undefined;

    ctx.save();
    const wash = ctx.createLinearGradient(0, 0, 0, height);
    wash.addColorStop(0, 'rgba(5,8,13,0.12)');
    wash.addColorStop(0.55, 'rgba(5,8,13,0.28)');
    wash.addColorStop(1, 'rgba(5,8,13,0.55)');
    ctx.fillStyle = wash;
    ctx.fillRect(0, 0, width, height);
    ctx.restore();

    const centerX = width * 0.5;
    const centerY = height * 0.44;
    ctx.save();
    ctx.lineCap = 'round';
    for (let ribbon = 0; ribbon < count; ribbon++) {
      const progress = ribbon / count;
      const radius = width * (0.08 + progress * 0.36);
      const wobble = Math.sin(time * 0.7 * speed + ribbon * 0.9) * height * 0.018;
      const alpha = 0.1 + (1 - progress) * 0.35;
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = ribbon % 2 === 0 ? accent : secondary;
      ctx.lineWidth = Math.max(1, width * (0.002 + progress * 0.002));
      ctx.beginPath();
      ctx.ellipse(
        centerX + Math.sin(time * 0.3 + ribbon) * width * 0.01,
        centerY + wobble + progress * height * 0.035,
        radius,
        radius * 0.42,
        Math.sin(time * 0.2 + ribbon * 0.4) * 0.18,
        0,
        Math.PI * 2,
      );
      ctx.stroke();
    }
    ctx.restore();

    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = accent;
    ctx.lineWidth = Math.max(1, width * 0.0018);
    for (let band = 0; band < 6; band++) {
      const y = height * (0.66 + band * 0.045);
      ctx.beginPath();
      for (let x = 0; x <= width; x += 12) {
        const wave =
          Math.sin(x * 0.008 + time * (0.6 + band * 0.12) + band) * height * 0.014 +
          Math.cos(x * 0.003 - time * 0.4 + band) * height * 0.01;
        if (x === 0) ctx.moveTo(x, y + wave);
        else ctx.lineTo(x, y + wave);
      }
      ctx.stroke();
    }
    ctx.restore();

    ctx.save();
    ctx.globalAlpha = hasBackground ? 0.42 : 0.62;
    for (let index = 0; index < 12; index++) {
      const angle = (index / 12) * Math.PI * 2 + time * 0.12 * speed;
      const distance = width * (0.24 + hash(index * 6.1) * 0.2);
      const x = centerX + Math.cos(angle) * distance;
      const y = centerY + Math.sin(angle) * distance * 0.55;
      const size = 2 + Math.floor(hash(index * 3.3) * 4);
      ctx.fillStyle = index % 3 === 0 ? '#E9E3D2' : accent;
      ctx.fillRect(Math.floor(x), Math.floor(y), size, size);
    }
    ctx.restore();

    ctx.save();
    ctx.globalAlpha = 0.16 + (tick % 30) / 240;
    ctx.fillStyle = secondary;
    ctx.fillRect(0, height * 0.86, width, 2);
    ctx.restore();
  },
};

export default sceneModule;
