type SignalContext = {
  frame: {outputFrame: number; localFrame: number; animationTick: number; samplingFps: number};
  canvas: {width: number; height: number};
  output: {width: number; height: number};
  params: {background?: string; accent?: string; secondary?: string};
  moduleParams: Record<string, string | number | boolean>;
};

const hash = (value: number): number => {
  const noise = Math.sin(value * 91.7 + 47.3) * 24634.6345;
  return noise - Math.floor(noise);
};

const sceneModule = {
  id: 'signal',
  contractVersion: 1,
  moduleType: 'canvas2d' as const,
  label: 'Pixel signal tower',
  params: [
    {key: 'bands', type: 'number' as const, required: true},
    {key: 'glow', type: 'boolean' as const},
  ],
  assetDependencies: [] as string[],
  render: (ctx: CanvasRenderingContext2D, context: SignalContext): void => {
    const width = context.canvas.width;
    const height = context.canvas.height;
    const tick = context.frame.animationTick;
    const bands = Math.max(1, Math.min(32, Math.round(Number(context.moduleParams.bands ?? 5))));
    const glow = context.moduleParams.glow === true;
    const background = context.params.background ?? '#101726';
    const accent = context.params.accent ?? '#FF9F1C';
    const secondary = context.params.secondary ?? '#2EC4B6';

    const sky = ctx.createLinearGradient(0, 0, 0, height);
    sky.addColorStop(0, background);
    sky.addColorStop(0.62, '#1C2A3B');
    sky.addColorStop(1, '#090E15');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, width, height);

    for (let index = 0; index < 48; index++) {
      const x = Math.floor(hash(index * 4.31) * width);
      const y = Math.floor(hash(index * 8.17 + 3) * height * 0.42);
      ctx.globalAlpha = 0.2 + hash(index * 3.77) * 0.4;
      ctx.fillStyle = '#E8EDF2';
      ctx.fillRect(x, y, 1, 1);
    }
    ctx.globalAlpha = 1;

    const horizon = 214;
    for (let index = 0; index < 26; index++) {
      const buildingWidth = 12 + Math.floor(hash(index * 2.1) * 14);
      const buildingHeight = 18 + Math.floor(hash(index * 5.9) * 62);
      const x = index * 20 - 8;
      ctx.fillStyle = index % 3 === 0 ? '#111C28' : '#0D1620';
      ctx.fillRect(x, horizon - buildingHeight, buildingWidth, buildingHeight + 40);
      for (let row = 0; row < Math.floor(buildingHeight / 9); row++) {
        for (let column = 0; column < 2; column++) {
          const lit = hash(index * 31 + row * 7 + column) > 0.58;
          if (!lit) continue;
          ctx.fillStyle = hash(index + row) > 0.6 ? accent : secondary;
          ctx.globalAlpha = 0.55;
          ctx.fillRect(x + 4 + column * 6, horizon - buildingHeight + 5 + row * 9, 2, 2);
          ctx.globalAlpha = 1;
        }
      }
    }

    const towerX = 338;
    const towerBase = 226;
    const towerTop = 92;
    ctx.fillStyle = '#0A121B';
    ctx.beginPath();
    ctx.moveTo(towerX - 17, towerBase);
    ctx.lineTo(towerX - 4, towerTop);
    ctx.lineTo(towerX + 4, towerTop);
    ctx.lineTo(towerX + 17, towerBase);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = secondary;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(towerX, towerTop);
    ctx.lineTo(towerX, 62);
    ctx.stroke();
    ctx.fillStyle = accent;
    ctx.fillRect(towerX - 1, 58, 3, 3);

    for (let band = 0; band < bands; band++) {
      const radius = 12 + ((tick + band * 9) % 42);
      const alpha = Math.max(0, 1 - radius / 56);
      ctx.globalAlpha = alpha * 0.9;
      ctx.strokeStyle = band % 2 === 0 ? accent : secondary;
      if (glow) {
        ctx.shadowBlur = 8;
        ctx.shadowColor = accent;
      }
      ctx.beginPath();
      ctx.arc(towerX, 60, radius, Math.PI * 1.08, Math.PI * 1.92);
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
    ctx.globalAlpha = 1;

    ctx.fillStyle = '#05090E';
    ctx.fillRect(0, horizon, width, height - horizon);
    ctx.fillStyle = secondary;
    for (let lane = 0; lane < 5; lane++) {
      const y = horizon + 12 + lane * 10;
      for (let x = 0; x < width; x += 24) {
        const offset = (x + tick * (lane + 1) * 0.9) % 24;
        ctx.globalAlpha = 0.25 + lane * 0.08;
        ctx.fillRect(Math.floor(offset), y, 10, 1);
      }
    }
    ctx.globalAlpha = 1;

    const sweep = (tick * 1.7) % width;
    const sweepGradient = ctx.createLinearGradient(sweep - 28, 0, sweep + 28, 0);
    sweepGradient.addColorStop(0, 'rgba(46,196,182,0)');
    sweepGradient.addColorStop(0.5, 'rgba(46,196,182,0.10)');
    sweepGradient.addColorStop(1, 'rgba(46,196,182,0)');
    ctx.fillStyle = sweepGradient;
    ctx.fillRect(sweep - 28, 0, 56, height);
  },
};

export {sceneModule};
