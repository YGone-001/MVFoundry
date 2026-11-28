// MVFoundry synthetic six-style gallery module.
//
// This file is NOT engine source. It is a self-contained TypeScript scene
// module template read as text by:
//   - factory/scripts/verify-style-render.mjs   (temporary workspace proof)
//   - factory/scripts/seed-style-gallery.mjs    (persistent external examples)
//
// The module is intentionally import-free, clock-free, randomness-free and
// network-free so it passes the project scene-module static source policy.
// It exists only to prove that one contract can produce six structurally
// different visual languages; it is not an artistic approval.

type Ctx = CanvasRenderingContext2D;
type StyleContext = {id: string; label: string} | null;
type RenderContext = {
  canvas: {width: number; height: number};
  frame: {localFrame: number; animationTick: number};
  style: StyleContext;
  moduleParams?: Record<string, string | number | boolean>;
};
type Point = [number, number];

const hash = (value: number): number => {
  const noise = Math.sin(value * 127.1 + 311.7) * 43758.5453;
  return noise - Math.floor(noise);
};

const fill = (ctx: Ctx, color: string, x: number, y: number, w: number, h: number, alpha = 1): void => {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
  ctx.restore();
};

const disc = (ctx: Ctx, color: string, x: number, y: number, radius: number, alpha = 1): void => {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
};

const ring = (ctx: Ctx, color: string, x: number, y: number, radius: number, width: number, alpha = 1): void => {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
};

const line = (
  ctx: Ctx,
  color: string,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  width: number,
  alpha = 1,
): void => {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.restore();
};

const polygon = (ctx: Ctx, color: string, points: Point[], alpha = 1): void => {
  if (points.length === 0) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(points[0][0], points[0][1]);
  for (let index = 1; index < points.length; index += 1) ctx.lineTo(points[index][0], points[index][1]);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
};

const halftone = (
  ctx: Ctx,
  color: string,
  x: number,
  y: number,
  w: number,
  h: number,
  step: number,
  radius: number,
  alpha: number,
): void => {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  for (let cx = x; cx < x + w; cx += step) {
    for (let cy = y; cy < y + h; cy += step) {
      const offset = Math.round(cy / step) % 2 === 0 ? 0 : step / 2;
      ctx.beginPath();
      ctx.arc(cx + offset, cy, radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
};

const drawCinematic = (ctx: Ctx, width: number, height: number, tick: number): void => {
  const sky = ctx.createLinearGradient(0, 0, 0, height * 0.72);
  sky.addColorStop(0, '#07101c');
  sky.addColorStop(0.55, '#123246');
  sky.addColorStop(1, '#26495b');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, width, height);

  const glow = ctx.createRadialGradient(
    width * 0.3,
    height * 0.36,
    0,
    width * 0.3,
    height * 0.36,
    height * 0.32,
  );
  glow.addColorStop(0, 'rgba(255,224,176,0.45)');
  glow.addColorStop(1, 'rgba(255,224,176,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, width, height);

  for (let index = 0; index < 16; index += 1) {
    const bw = width * (0.028 + hash(10 + index) * 0.052);
    const bh = height * (0.09 + hash(20 + index) * 0.3);
    const x = width * (0.01 + index * 0.065) - tick * 0.25;
    fill(ctx, index % 3 === 0 ? '#10253a' : '#0b1a2a', x, height * 0.62 - bh, bw, bh);
    fill(ctx, '#e29a4a', x, height * 0.62 - bh, bw, 1.5, 0.5);
    for (let row = 0; row < 5; row += 1) {
      if (hash(30 + index * 7 + row) < 0.45) {
        fill(ctx, '#e2a04a', x + 3 + row * 6, height * 0.62 - bh + 6 + row * 8, 2.5, 3, 0.85);
      }
    }
  }

  fill(ctx, '#08111a', 0, height * 0.66, width, height * 0.34);
  for (let index = 0; index < 20; index += 1) {
    const x = width * (0.05 + index * 0.048);
    line(ctx, '#e29a4a', x, height * 0.68, x, height * (0.78 + hash(index) * 0.12), 1.4, 0.16);
  }
  line(ctx, '#1d2a36', 0, height * 0.72, width, height * 0.72, 2, 0.7);

  const figure = (x: number, ground: number, scale: number, coat: string, hair: string): void => {
    const unit = scale / 26;
    fill(ctx, coat, x - 3 * unit, ground - 13 * unit, 6 * unit, 13 * unit);
    disc(ctx, coat, x, ground - 14 * unit, 3.2 * unit);
    disc(ctx, '#e6b189', x, ground - 16 * unit, 3 * unit);
    disc(ctx, hair, x, ground - 17 * unit, 3.4 * unit);
    fill(ctx, hair, x - 3.4 * unit, ground - 18.5 * unit, 6.8 * unit, 2.6 * unit);
    fill(ctx, '#b84753', x - 2.4 * unit, ground - 12 * unit, 4.8 * unit, 1.2 * unit);
  };
  figure(width * 0.46, height * 0.92, height * 0.24, '#4c5838', '#0f141c');
  figure(width * 0.56, height * 0.92, height * 0.24, '#efe3ce', '#452b22');

  ctx.save();
  ctx.globalAlpha = 0.5;
  ctx.strokeStyle = '#8fa5b8';
  ctx.lineWidth = 1.4;
  for (let index = 0; index < 90; index += 1) {
    const x = hash(40 + index) * width;
    const y = (hash(50 + index) * height + tick * 5) % height;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - 2, y + 9);
    ctx.stroke();
  }
  ctx.restore();

  fill(ctx, '#05080c', 0, 0, width, height * 0.055);
  fill(ctx, '#05080c', 0, height * 0.945, width, height * 0.055);
};

const drawAnime = (ctx: Ctx, width: number, height: number, tick: number): void => {
  fill(ctx, '#f7f4ea', 0, 0, width, height);
  polygon(ctx, '#14234a', [
    [width * 0.5, 0],
    [width, 0],
    [width, height],
    [width * 0.34, height],
  ]);
  line(ctx, '#0a0a12', width * 0.5, 0, width * 0.34, height, width * 0.014);

  const focusX = width * 0.68;
  const focusY = height * 0.44;
  ctx.save();
  ctx.strokeStyle = '#0a0a12';
  for (let index = 0; index < 46; index += 1) {
    const angle = (index / 46) * Math.PI * 2 + tick * 0.004;
    const inner = height * (0.14 + hash(index) * 0.08);
    const outer = height * (0.5 + hash(index + 7) * 0.35);
    ctx.globalAlpha = 0.16 + hash(index + 3) * 0.28;
    ctx.lineWidth = 1 + hash(index + 11) * 2.5;
    ctx.beginPath();
    ctx.moveTo(focusX + Math.cos(angle) * inner, focusY + Math.sin(angle) * inner);
    ctx.lineTo(focusX + Math.cos(angle) * outer, focusY + Math.sin(angle) * outer);
    ctx.stroke();
  }
  ctx.restore();

  const star: Point[] = [];
  for (let index = 0; index < 14; index += 1) {
    const angle = (index / 14) * Math.PI * 2;
    const radius = index % 2 === 0 ? height * 0.2 : height * 0.075;
    star.push([focusX + Math.cos(angle) * radius, focusY + Math.sin(angle) * radius]);
  }
  polygon(ctx, '#e64545', star, 0.95);
  disc(ctx, '#ffd166', focusX, focusY, height * 0.045);

  halftone(ctx, '#14234a', width * 0.05, height * 0.07, width * 0.26, height * 0.24, 10, 1.5, 0.35);

  fill(ctx, '#0a0a12', width * 0.09, height * 0.6, width * 0.12, height * 0.24);
  disc(ctx, '#e6b189', width * 0.15, height * 0.6, height * 0.055);
  fill(ctx, '#e64545', width * 0.12, height * 0.56, width * 0.06, height * 0.03);

  fill(ctx, '#0a0a12', width * 0.06, height * 0.84, width * 0.32, height * 0.08);
  fill(ctx, '#f7f4ea', width * 0.075, height * 0.86, width * 0.29, height * 0.04);
  fill(ctx, '#0a0a12', width * 0.78, height * 0.06, width * 0.16, height * 0.05, 0.9);
  fill(ctx, '#f7f4ea', width * 0.8, height * 0.075, width * 0.12, height * 0.018, 0.9);
};

const drawInk = (ctx: Ctx, width: number, height: number, tick: number): void => {
  fill(ctx, '#ece4d6', 0, 0, width, height);
  for (let index = 0; index < 5; index += 1) {
    fill(
      ctx,
      '#9a9386',
      0,
      height * (0.16 + index * 0.14) + Math.sin(tick * 0.01 + index) * 3,
      width,
      height * (0.05 + hash(index) * 0.06),
      0.05 + hash(index + 2) * 0.05,
    );
  }

  const brush = (cx: number, cy: number, length: number, widthValue: number, alpha: number): void => {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = '#2b2926';
    ctx.lineWidth = widthValue;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx - length / 2, cy);
    ctx.quadraticCurveTo(cx, cy - length * 0.22, cx + length / 2, cy + length * 0.04);
    ctx.stroke();
    ctx.restore();
  };
  brush(width * 0.44, height * 0.44, width * 0.42, height * 0.022, 0.86);
  brush(width * 0.56, height * 0.55, width * 0.30, height * 0.014, 0.6);
  brush(width * 0.36, height * 0.66, width * 0.22, height * 0.01, 0.45);

  disc(ctx, '#2b2926', width * 0.24, height * 0.5, height * 0.022, 0.8);
  ctx.save();
  ctx.globalAlpha = 0.75;
  ctx.strokeStyle = '#2b2926';
  ctx.lineWidth = height * 0.012;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(width * 0.24, height * 0.52);
  ctx.quadraticCurveTo(width * 0.215, height * 0.62, width * 0.245, height * 0.72);
  ctx.stroke();
  ctx.restore();

  fill(ctx, '#b0392e', width * 0.82, height * 0.72, width * 0.055, height * 0.075, 0.9);
  fill(ctx, '#ece4d6', width * 0.836, height * 0.742, width * 0.017, height * 0.032, 0.9);
  fill(ctx, '#9a9386', 0, height * 0.9, width, height * 0.1, 0.08);
};

const drawEditorial = (ctx: Ctx, width: number, height: number, tick: number): void => {
  fill(ctx, '#f3efe6', 0, 0, width, height);
  for (let column = 0; column <= 12; column += 1) {
    line(ctx, '#8a857b', (width / 12) * column, 0, (width / 12) * column, height, 1, 0.28);
  }
  line(ctx, '#111111', 0, height * 0.5, width, height * 0.5, 1.5, 0.5);

  fill(ctx, '#2456d6', width * 0.06, height * 0.1, width * 0.27, height * 0.33);
  fill(ctx, '#ffcf5c', width * 0.35, height * 0.1, width * 0.17, height * 0.15);
  fill(ctx, '#d97757', width * 0.54, height * 0.1, width * 0.38, height * 0.04);
  polygon(ctx, '#2456d6', [
    [width * 0.7, height * 0.3],
    [width * 0.92, height * 0.3],
    [width * 0.92, height * 0.45],
    [width * 0.78, height * 0.45],
  ]);

  for (let row = 0; row < 4; row += 1) {
    fill(ctx, '#111111', width * 0.06, height * (0.54 + row * 0.075), width * (0.5 - row * 0.07), height * 0.038);
  }

  fill(ctx, '#d97757', width * 0.64, height * 0.58, width * 0.18, height * 0.24);
  disc(ctx, '#111111', width * 0.73, height * 0.7, height * 0.05);
  polygon(ctx, '#111111', [
    [width * 0.64, height * 0.6],
    [width * 0.64, height * 0.78],
    [width * 0.73, height * 0.7],
  ]);

  ring(ctx, '#111111', width * 0.86, height * 0.72, height * 0.07, 2.2, 0.8);
  line(ctx, '#111111', width * 0.06, height * 0.9, width * 0.94, height * 0.9, 1.2, 0.6);
  const cursorX = width * (0.09 + (tick % 24) * 0.002);
  fill(ctx, '#111111', cursorX, height * 0.82, width * 0.012, height * 0.09, 0.85);
};

const drawDiorama = (ctx: Ctx, width: number, height: number, tick: number): void => {
  fill(ctx, '#0b1724', 0, 0, width, height);
  const vignette = ctx.createRadialGradient(
    width * 0.5,
    height * 0.46,
    height * 0.1,
    width * 0.5,
    height * 0.46,
    height * 0.62,
  );
  vignette.addColorStop(0, 'rgba(29,74,90,0.55)');
  vignette.addColorStop(1, 'rgba(4,9,14,0.95)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, width, height);

  const cx = width * 0.5;
  const stageTop = height * 0.29;
  const stageBottom = height * 0.63;
  polygon(ctx, '#1d4a5a', [
    [cx, stageTop],
    [width * 0.86, height * 0.46],
    [cx, stageBottom],
    [width * 0.14, height * 0.46],
  ]);
  polygon(ctx, '#123441', [
    [width * 0.14, height * 0.46],
    [cx, stageBottom],
    [cx, stageBottom + height * 0.13],
    [width * 0.14, height * 0.46 + height * 0.13],
  ]);
  polygon(ctx, '#0e2935', [
    [cx, stageBottom],
    [width * 0.86, height * 0.46],
    [width * 0.86, height * 0.46 + height * 0.13],
    [cx, stageBottom + height * 0.13],
  ]);
  ctx.save();
  ctx.globalAlpha = 0.28;
  ctx.fillStyle = '#02060a';
  ctx.beginPath();
  ctx.ellipse(cx, stageBottom + height * 0.15, width * 0.28, height * 0.045, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  const lampX = width * 0.38;
  const lampY = height * 0.34;
  const lampGlow = ctx.createRadialGradient(lampX, lampY, 0, lampX, lampY, height * 0.17);
  lampGlow.addColorStop(0, 'rgba(240,162,74,0.72)');
  lampGlow.addColorStop(1, 'rgba(240,162,74,0)');
  ctx.fillStyle = lampGlow;
  ctx.fillRect(lampX - height * 0.2, lampY - height * 0.2, height * 0.4, height * 0.4);
  disc(ctx, '#f0a24a', lampX, lampY, height * 0.018);
  fill(ctx, '#0f2a36', lampX - 2, lampY, 4, height * 0.13);

  fill(ctx, '#1d4a5a', width * 0.53, height * 0.34, width * 0.14, height * 0.11);
  polygon(ctx, '#f5e6c8', [
    [width * 0.53, height * 0.34],
    [width * 0.67, height * 0.34],
    [width * 0.64, height * 0.3],
    [width * 0.56, height * 0.3],
  ]);
  fill(ctx, '#123441', width * 0.545, height * 0.36, width * 0.012, height * 0.09);
  fill(ctx, '#123441', width * 0.655, height * 0.36, width * 0.012, height * 0.09);

  fill(ctx, '#b84753', width * 0.46, height * 0.42, width * 0.022, height * 0.07);
  disc(ctx, '#e6b189', width * 0.471, height * 0.41, height * 0.014);
  fill(ctx, '#f5e6c8', width * 0.58, height * 0.43, width * 0.022, height * 0.065);
  disc(ctx, '#e6b189', width * 0.591, height * 0.42, height * 0.014);

  for (let index = 0; index < 6; index += 1) {
    const px = width * (0.2 + index * 0.1) + Math.sin(tick * 0.02 + index) * 4;
    const py = height * (0.6 + hash(index) * 0.12);
    fill(ctx, '#a8d8d2', px, py, 2, 2, 0.5);
  }

  const shift = ctx.createLinearGradient(0, 0, 0, height);
  shift.addColorStop(0, 'rgba(5,10,16,0.65)');
  shift.addColorStop(0.25, 'rgba(5,10,16,0)');
  shift.addColorStop(0.78, 'rgba(5,10,16,0)');
  shift.addColorStop(1, 'rgba(5,10,16,0.7)');
  ctx.fillStyle = shift;
  ctx.fillRect(0, 0, width, height);
};

const drawPixel = (ctx: Ctx, width: number, height: number, tick: number): void => {
  const unit = Math.max(4, Math.round(width / 80));
  const px = (x: number, y: number, w: number, h: number, color: string, alpha = 1): void => {
    fill(
      ctx,
      color,
      Math.round(x / unit) * unit,
      Math.round(y / unit) * unit,
      Math.round(w / unit) * unit,
      Math.round(h / unit) * unit,
      alpha,
    );
  };

  px(0, 0, width, height * 0.2, '#070d18');
  px(0, height * 0.2, width, height * 0.2, '#0a1422');
  px(0, height * 0.4, width, height * 0.18, '#16324a');
  for (let index = 0; index < 18; index += 1) {
    const bw = width * (0.04 + hash(60 + index) * 0.06);
    const bh = height * (0.08 + hash(70 + index) * 0.22);
    const x = width * (index * 0.055) - (tick % 64) * unit * 0.4;
    px(x, height * 0.58 - bh, bw, bh, '#0b1a2a');
    px(x, height * 0.58 - bh, bw, unit, '#1a3450');
    if (hash(80 + index) < 0.55) {
      px(x + unit * 2, height * 0.58 - bh + unit * 2, unit, unit * 2, '#e29a4a');
    }
  }
  px(0, height * 0.62, width, height * 0.38, '#060b10');
  px(0, height * 0.76, width, unit, '#1d2a36');
  px(0, height * 0.86, width, unit, '#1d2a36');

  const person = (x: number, ground: number, coat: string, hair: string): void => {
    px(x - unit * 3, ground - unit * 14, unit * 6, unit * 10, coat);
    px(x - unit * 2, ground - unit * 18, unit * 4, unit * 4, '#e6b189');
    px(x - unit * 2, ground - unit * 19, unit * 4, unit * 2, hair);
    px(x - unit * 2, ground - unit * 13, unit * 4, unit, '#b84753');
    px(x - unit, ground - unit * 17, unit, unit, '#111622');
    px(x + unit, ground - unit * 17, unit, unit, '#111622');
    px(x - unit * 3, ground - unit * 4, unit * 2, unit * 4, '#222a3b');
    px(x + unit, ground - unit * 4, unit * 2, unit * 4, '#222a3b');
  };
  person(width * 0.45, height * 0.9, '#4c5838', '#0f141c');
  person(width * 0.57, height * 0.9, '#efe3ce', '#452b22');

  for (let index = 0; index < 40; index += 1) {
    const x = hash(90 + index) * width;
    const y = (hash(100 + index) * height + tick * 3) % height;
    px(x, y, unit, unit * 2, '#63cdc6', 0.8);
  }
};

const sceneModule = {
  id: 'style-gallery',
  contractVersion: 1,
  moduleType: 'canvas2d' as const,
  label: 'Synthetic six-style gallery',
  params: [{key: 'phase', type: 'number' as const}],
  assetDependencies: [] as string[],
  supportedStyles: [
    'cinematic-illustration-2p5d',
    'anime-motion-comic',
    'ink-watercolor',
    'editorial-motion-graphics',
    'stylized-3d-diorama',
    'retro-pixel',
  ] as string[],
  render: (ctx: Ctx, context: RenderContext): void => {
    const width = context.canvas.width;
    const height = context.canvas.height;
    const phase = typeof context.moduleParams?.phase === 'number' ? context.moduleParams.phase : 0;
    const tick = context.frame.animationTick + phase;
    switch (context.style?.id) {
      case 'anime-motion-comic':
        drawAnime(ctx, width, height, tick);
        return;
      case 'ink-watercolor':
        drawInk(ctx, width, height, tick);
        return;
      case 'editorial-motion-graphics':
        drawEditorial(ctx, width, height, tick);
        return;
      case 'stylized-3d-diorama':
        drawDiorama(ctx, width, height, tick);
        return;
      case 'retro-pixel':
        drawPixel(ctx, width, height, tick);
        return;
      default:
        drawCinematic(ctx, width, height, tick);
    }
  },
};

export default sceneModule;
