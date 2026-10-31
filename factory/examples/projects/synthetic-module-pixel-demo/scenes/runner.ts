type RunnerContext = {
  frame: {outputFrame: number; localFrame: number; animationTick: number; samplingFps: number};
  canvas: {width: number; height: number};
  output: {width: number; height: number};
  params: {background?: string; accent?: string; secondary?: string};
  moduleParams: Record<string, string | number | boolean>;
};

const hash = (value: number): number => {
  const noise = Math.sin(value * 127.1 + 311.7) * 43758.5453;
  return noise - Math.floor(noise);
};

const drawHill = (
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  baseY: number,
  amplitude: number,
  phase: number,
  color: string,
): void => {
  ctx.beginPath();
  ctx.moveTo(0, baseY);
  for (let x = 0; x <= width; x += 8) {
    const y = baseY + Math.sin(x * 0.024 + phase) * amplitude + Math.cos(x * 0.011 + phase) * amplitude * 0.4;
    ctx.lineTo(x, y);
  }
  ctx.lineTo(width, height);
  ctx.lineTo(0, height);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
};

const drawRunner = (
  ctx: CanvasRenderingContext2D,
  x: number,
  groundY: number,
  gait: number,
  bodyColor: string,
  accentColor: string,
): void => {
  const leftLeg = gait === 0 || gait === 1 ? 3 : -2;
  const rightLeg = gait === 2 || gait === 3 ? 3 : -2;
  ctx.fillStyle = accentColor;
  ctx.fillRect(x + leftLeg, groundY - 5, 2, 6);
  ctx.fillRect(x + 5 + rightLeg, groundY - 5, 2, 6);
  ctx.fillStyle = bodyColor;
  ctx.fillRect(x, groundY - 15, 8, 10);
  ctx.fillRect(x + 2, groundY - 20, 5, 5);
  ctx.fillStyle = accentColor;
  ctx.fillRect(x - 1, groundY - 13, 1, 5);
  ctx.fillRect(x + 8, groundY - 13, 1, 5);
};

const sceneModule = {
  id: 'runner',
  contractVersion: 1,
  moduleType: 'canvas2d' as const,
  label: 'Pixel road runner',
  params: [
    {key: 'speed', type: 'number' as const, required: true},
    {key: 'glow', type: 'boolean' as const},
  ],
  assetDependencies: [] as string[],
  render: (ctx: CanvasRenderingContext2D, context: RunnerContext): void => {
    const width = context.canvas.width;
    const height = context.canvas.height;
    const tick = context.frame.animationTick;
    const speed = Number(context.moduleParams.speed ?? 2);
    const glow = context.moduleParams.glow === true;
    const background = context.params.background ?? '#0B1B2B';
    const accent = context.params.accent ?? '#2EC4B6';
    const secondary = context.params.secondary ?? '#FF9F1C';

    const sky = ctx.createLinearGradient(0, 0, 0, height);
    sky.addColorStop(0, background);
    sky.addColorStop(0.7, '#132B3D');
    sky.addColorStop(1, '#081018');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, width, height);

    for (let index = 0; index < 64; index++) {
      const x = Math.floor(hash(index * 2.13 + 1) * width);
      const y = Math.floor(hash(index * 4.71 + 7) * height * 0.55);
      ctx.globalAlpha = 0.25 + hash(index * 9.17) * 0.55;
      ctx.fillStyle = index % 5 === 0 ? accent : '#DDE7EC';
      ctx.fillRect(x, y, 1, 1);
    }
    ctx.globalAlpha = 1;

    const moonRadius = 24;
    const moonX = width - 82;
    const moonY = 66;
    if (glow) {
      ctx.shadowBlur = 24;
      ctx.shadowColor = accent;
    }
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.arc(moonX, moonY, moonRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    drawHill(ctx, width, height, 172, 18, 0.4, '#102536');
    drawHill(ctx, width, height, 198, 13, 2.1, '#0D1B28');
    drawHill(ctx, width, height, 224, 8, 4.3, '#0A141D');

    const groundY = 238;
    ctx.fillStyle = '#060B10';
    ctx.fillRect(0, groundY, width, height - groundY);
    ctx.fillStyle = secondary;
    for (let x = -20; x < width + 20; x += 32) {
      const dashX = (x + tick * speed * 1.2) % (width + 32);
      ctx.fillRect(Math.floor(dashX), groundY + 18, 18, 2);
    }

    const runnerX = ((tick * speed * 2.4 + 40) % (width + 48)) - 24;
    drawRunner(ctx, Math.round(runnerX), groundY, tick % 4, '#E9E3D2', secondary);

    for (let index = 0; index < 18; index++) {
      const x = Math.floor(hash(index * 3.9 + tick * 0.07) * width);
      const y = groundY + 4 + Math.floor(hash(index * 7.3) * 26);
      ctx.globalAlpha = 0.18 + hash(index * 5.1) * 0.2;
      ctx.fillStyle = accent;
      ctx.fillRect(x, y, 2, 1);
    }
    ctx.globalAlpha = 1;

    const vignette = ctx.createLinearGradient(0, 0, 0, height);
    vignette.addColorStop(0, 'rgba(0,0,0,0)');
    vignette.addColorStop(1, 'rgba(0,0,0,0.35)');
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, width, height);
  },
};

export default sceneModule;
