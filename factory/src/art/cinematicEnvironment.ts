// Cinematic environment art: establishing street, close-up bokeh, tram shelter
// midground and foreground occlusion planes.
//
// The environment carries most of the perceived production value, so the
// drawing code favours many small articulated elements, layered haze and wet
// reflections over broad flat shapes.

import type {Ctx} from './shared';
import {
  clamp,
  dashedStroke,
  fillRoundRect,
  glow,
  hash,
  hash2,
  hazeBand,
  linearGradient,
  rgba,
  roundRect,
  wetReflection,
} from './shared';

const C = {
  skyTop: '#03070d',
  skyMid: '#081827',
  skyHorizon: '#173445',
  skyWarm: '#3a2a20',
  far: '#12283a',
  mid: '#091724',
  near: '#03070c',
  warm: '#ffcf8a',
  sodium: '#e29a4a',
  cool: '#6fd0cc',
  steel: '#3f7f95',
  street: '#05080d',
  asphalt: '#0a1016',
  rail: '#22323f',
  railLight: '#a7c2d2',
  ink: '#03060a',
};

const windowGrid = (
  ctx: Ctx,
  x: number,
  y: number,
  width: number,
  height: number,
  seed: number,
  cols: number,
  rows: number,
  style: 'far' | 'mid',
): void => {
  const cellW = width / cols;
  const cellH = height / rows;
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const value = hash2(seed + row * 13.7, seed * 0.5 + col * 7.1);
      const lit = value > 0.66;
      const warm = hash2(seed + col * 3.3, seed + row * 2.1) > 0.42;
      const alpha = lit ? (style === 'far' ? 0.28 : 0.62) : style === 'far' ? 0.04 : 0.09;
      ctx.fillStyle = lit
        ? rgba(warm ? C.warm : C.cool, alpha)
        : rgba('#7898ab', alpha);
      const w = Math.max(1.4, cellW * 0.4);
      const h = Math.max(1.4, cellH * 0.44);
      ctx.fillRect(x + col * cellW + cellW * 0.3, y + row * cellH + cellH * 0.28, w, h);
      if (lit && style === 'mid' && value > 0.9) {
        glow(
          ctx,
          x + col * cellW + cellW * 0.5,
          y + row * cellH + cellH * 0.5,
          cellW * 2.2,
          warm ? C.warm : C.cool,
          0.16,
        );
      }
    }
  }
};

const tower = (
  ctx: Ctx,
  x: number,
  baseY: number,
  width: number,
  height: number,
  color: string,
  seed: number,
  style: 'far' | 'mid',
): void => {
  ctx.fillStyle = color;
  ctx.fillRect(x, baseY - height, width, height);

  // Setback: a narrower upper storey.
  if (hash(seed * 1.9) > 0.62 && height > baseY * 0.02) {
    const setbackH = height * (0.2 + hash(seed * 3.1) * 0.16);
    const setbackW = width * (0.62 + hash(seed * 5.7) * 0.2);
    ctx.fillRect(x + (width - setbackW) / 2, baseY - height - setbackH, setbackW, setbackH);
    windowGrid(
      ctx,
      x + (width - setbackW) / 2 + setbackW * 0.12,
      baseY - height - setbackH + setbackH * 0.16,
      setbackW * 0.76,
      setbackH * 0.7,
      seed * 11.3,
      3,
      3,
      style,
    );
  }

  // Roof clutter: water tank, aerial, AC boxes.
  ctx.fillStyle = rgba('#0e2030', 1);
  if (hash(seed * 7.3) > 0.45) {
    ctx.fillRect(x + width * 0.66, baseY - height - height * 0.045, width * 0.16, height * 0.045);
  }
  if (hash(seed * 9.1) > 0.6) {
    ctx.strokeStyle = rgba('#0b1a26', 0.95);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x + width * 0.3, baseY - height);
    ctx.lineTo(x + width * 0.34, baseY - height - height * 0.1);
    ctx.stroke();
  }

  // Facade articulation.
  ctx.fillStyle = rgba('#8fb2c4', style === 'far' ? 0.04 : 0.08);
  ctx.fillRect(x, baseY - height, width, Math.max(1, height * 0.008));
  ctx.fillRect(x, baseY - height, Math.max(1, width * 0.05), height);
  ctx.fillStyle = rgba('#000000', style === 'far' ? 0.2 : 0.32);
  ctx.fillRect(x + width * 0.93, baseY - height, width * 0.07, height);

  windowGrid(
    ctx,
    x + width * 0.1,
    baseY - height + height * 0.1,
    width * 0.78,
    height * 0.82,
    seed,
    Math.max(2, Math.round(width / (style === 'far' ? 12 : 20))),
    Math.max(3, Math.round(height / (style === 'far' ? 14 : 24))),
    style,
  );

  // A vertical signboard on some mid buildings.
  if (style === 'mid' && hash(seed * 13.7) > 0.7) {
    const signX = x + width * 0.02;
    const signY = baseY - height * (0.55 + hash(seed * 17.1) * 0.25);
    const signW = Math.max(4, width * 0.07);
    const signH = height * 0.14;
    const color = hash(seed * 19.3) > 0.5 ? C.cool : C.sodium;
    fillRoundRect(ctx, signX, signY, signW, signH, 2, rgba('#050e16', 0.92));
    ctx.strokeStyle = rgba(color, 0.45);
    ctx.lineWidth = 1.2;
    roundRect(ctx, signX, signY, signW, signH, 2);
    ctx.stroke();
    for (let bar = 0; bar < 4; bar += 1) {
      ctx.fillStyle = rgba(color, 0.65);
      ctx.fillRect(
        signX + signW * 0.2,
        signY + signH * (0.1 + bar * 0.21),
        signW * (0.45 + hash(seed + bar) * 0.3),
        Math.max(1.5, signH * 0.055),
      );
    }
    glow(ctx, signX + signW * 0.5, signY + signH * 0.5, signW * 3, color, 0.14);
  }
};

const skyline = (ctx: Ctx, width: number, height: number): void => {
  const horizon = height * 0.66;
  for (let index = 0; index < 46; index += 1) {
    const w = width * (0.018 + hash(index * 1.7) * 0.042);
    const h = height * (0.08 + hash(index * 2.9) * 0.26);
    const x = -width * 0.08 + (index / 45) * width * 1.16;
    tower(ctx, x, horizon, w, h, rgba(C.far, 0.42 + hash(index) * 0.2), index * 3.1, 'far');
  }
  hazeBand(ctx, horizon - height * 0.06, height * 0.14, width, '#5d8ea6', 0.12);

  for (let index = 0; index < 20; index += 1) {
    const w = width * (0.038 + hash(index * 4.3) * 0.068);
    const h = height * (0.12 + hash(index * 6.1) * 0.3);
    const x = -width * 0.03 + (index / 19) * width * 1.06;
    tower(ctx, x, horizon, w, h, rgba(C.mid, 0.9), index * 7.7 + 4, 'mid');
  }
  hazeBand(ctx, horizon - height * 0.02, height * 0.09, width, '#6f9cb2', 0.12);

  // Neon boards with a strong bloom.
  const signs: Array<[number, number, string]> = [
    [0.11, 0.2, C.cool],
    [0.34, 0.15, C.sodium],
    [0.58, 0.24, C.warm],
    [0.79, 0.18, '#d97757'],
    [0.92, 0.13, C.cool],
  ];
  for (const [fx, fy, color] of signs) {
    const sx = width * fx;
    const sy = horizon - height * fy;
    fillRoundRect(ctx, sx, sy, width * 0.016, height * 0.085, width * 0.004, rgba('#061019', 0.95));
    ctx.strokeStyle = rgba(color, 0.55);
    ctx.lineWidth = width * 0.0009;
    roundRect(ctx, sx, sy, width * 0.016, height * 0.085, width * 0.004);
    ctx.stroke();
    for (let bar = 0; bar < 3; bar += 1) {
      ctx.fillStyle = rgba(color, 0.75);
      ctx.fillRect(
        sx + width * 0.0035,
        sy + height * (0.012 + bar * 0.024),
        width * 0.009,
        height * 0.012,
      );
    }
    glow(ctx, sx, sy + height * 0.04, width * 0.075, color, 0.2);
  }
};

const street = (ctx: Ctx, width: number, height: number): void => {
  const horizon = height * 0.66;
  const road = linearGradient(ctx, 0, horizon, 0, height, [
    [0, C.street],
    [0.3, C.asphalt],
    [1, '#03060a'],
  ]);
  ctx.fillStyle = road;
  ctx.fillRect(0, horizon, width, height - horizon);

  // Asphalt texture: fine horizontal grain plus scattered aggregate.
  for (let index = 0; index < 1400; index += 1) {
    const x = hash(index * 1.31) * width;
    const y = horizon + hash(index * 2.77) * (height - horizon);
    const tone = hash(index * 4.13);
    ctx.fillStyle = rgba(tone > 0.5 ? '#9bb4c2' : '#000000', 0.03 + tone * 0.03);
    ctx.fillRect(x, y, 1 + tone * 2, 1);
  }

  // Reflections of the lit sources, broken into vertical smears.
  const reflections: Array<[number, string, number, number]> = [
    [0.11, C.cool, 0.35, 0.16],
    [0.34, C.sodium, 0.3, 0.22],
    [0.58, C.warm, 0.42, 0.3],
    [0.79, '#d97757', 0.24, 0.1],
    [0.92, C.cool, 0.2, 0.13],
    [0.47, C.warm, 0.16, 0.08],
  ];
  for (const [fx, color, alpha, length] of reflections) {
    wetReflection(
      ctx,
      width * fx,
      horizon - height * 0.01,
      height * length,
      width * (0.012 + hash(fx * 91) * 0.022),
      color,
      alpha,
      fx * 71,
    );
    glow(ctx, width * fx, horizon + height * length * 0.3, width * 0.05, color, 0.1);
  }

  // Curb, then rails with sleepers.
  ctx.fillStyle = rgba('#18252f', 0.95);
  ctx.fillRect(0, horizon + (height - horizon) * 0.13, width, Math.max(2, height * 0.006));
  ctx.fillStyle = rgba('#8fa8b8', 0.12);
  ctx.fillRect(0, horizon + (height - horizon) * 0.13, width, 1);

  const vanishingX = width * 0.52;
  const tracks = [
    [0.14, 0.2],
    [0.3, 0.36],
  ];
  for (const [nearLeft, nearRight] of tracks) {
    const nearL = width * nearLeft;
    const nearR = width * nearRight;
    const farL = vanishingX - width * 0.02;
    const farR = vanishingX + width * 0.02;
    // Ballast / sleeper bed.
    ctx.fillStyle = rgba('#0d151c', 0.85);
    ctx.beginPath();
    ctx.moveTo(nearL - width * 0.02, height);
    ctx.lineTo(farL, horizon);
    ctx.lineTo(farR, horizon);
    ctx.lineTo(nearR + width * 0.02, height);
    ctx.closePath();
    ctx.fill();
    // Sleepers in perspective.
    for (let sleeper = 0; sleeper < 14; sleeper += 1) {
      const t = sleeper / 13;
      const y = horizon + (height - horizon) * Math.pow(1 - t, 1.7) * 1.02;
      const spread = width * (0.02 + (nearRight - nearLeft) * 0.5 * Math.pow(1 - t, 1.7));
      ctx.fillStyle = rgba('#1b2833', 0.5);
      ctx.fillRect(vanishingX - spread, y, spread * 2, Math.max(1, (height - horizon) * 0.008 * (1 - t * 0.6)));
    }
    // Rails: two bright steel edges.
    for (const [from, to] of [
      [nearL, farL],
      [nearR, farR],
    ]) {
      ctx.strokeStyle = rgba(C.railLight, 0.28);
      ctx.lineWidth = Math.max(1.4, width * 0.0026);
      ctx.beginPath();
      ctx.moveTo(from, height);
      ctx.lineTo(to, horizon);
      ctx.stroke();
      ctx.strokeStyle = rgba(C.railLight, 0.08);
      ctx.lineWidth = Math.max(3, width * 0.007);
      ctx.beginPath();
      ctx.moveTo(from, height);
      ctx.lineTo(to, horizon);
      ctx.stroke();
    }
  }

  // Puddle islands: overlapping ellipses with a thin sky-coloured rim.
  for (let index = 0; index < 9; index += 1) {
    const cx = width * (0.1 + hash(index * 3.9) * 0.8);
    const cy = horizon + (height - horizon) * (0.2 + hash(index * 5.3) * 0.7);
    const baseR = width * (0.03 + hash(index * 7.1) * 0.07);
    ctx.fillStyle = rgba('#7fa8bc', 0.05);
    for (let blob = 0; blob < 3; blob += 1) {
      ctx.beginPath();
      ctx.ellipse(
        cx + (hash(index * 11.3 + blob) - 0.5) * baseR * 1.4,
        cy + (hash(index * 13.7 + blob) - 0.5) * baseR * 0.3,
        baseR * (0.6 + hash(blob + index) * 0.5),
        baseR * (0.1 + hash(blob + index * 2) * 0.1),
        0,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
    ctx.strokeStyle = rgba('#cfe6f0', 0.045);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(cx, cy, baseR, baseR * 0.14, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Lane marking and a stop line.
  dashedStroke(
    ctx,
    width * 0.49,
    height,
    width * 0.52,
    horizon + (height - horizon) * 0.18,
    rgba('#d4e2ea', 0.1),
    Math.max(1, width * 0.0022),
    height * 0.028,
  );
  ctx.fillStyle = rgba('#d4e2ea', 0.07);
  ctx.fillRect(width * 0.56, height, width * 0.16, Math.max(2, height * 0.004));

  // Static rain texture for depth.
  for (let index = 0; index < 260; index += 1) {
    const x = hash(index * 1.31) * width;
    const y = hash(index * 2.17) * height;
    const length = 6 + hash(index * 3.71) * 22;
    ctx.strokeStyle = rgba('#bcd2e0', 0.03 + hash(index * 4.9) * 0.055);
    ctx.lineWidth = 1;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - 2, y + length);
    ctx.stroke();
  }
};

const overhead = (ctx: Ctx, width: number, height: number): void => {
  const cables: Array<[number, number, number, number, number]> = [
    [-0.02, 0.07, 0.6, 0.17, 0.1],
    [0.16, -0.02, 0.86, 0.13, 0.12],
    [0.44, 0.03, 1.04, 0.23, 0.14],
    [0.7, -0.03, 1.02, 0.35, 0.08],
  ];
  for (const [x0, y0, x1, y1, sag] of cables) {
    ctx.strokeStyle = rgba('#04080c', 0.9);
    ctx.lineWidth = Math.max(1, width * 0.0016);
    ctx.beginPath();
    ctx.moveTo(width * x0, height * y0);
    ctx.quadraticCurveTo(
      width * ((x0 + x1) / 2),
      height * ((y0 + y1) / 2 + sag),
      width * x1,
      height * y1,
    );
    ctx.stroke();
    ctx.strokeStyle = rgba('#8da9bb', 0.12);
    ctx.lineWidth = Math.max(1, width * 0.0006);
    ctx.beginPath();
    ctx.moveTo(width * x0, height * y0);
    ctx.quadraticCurveTo(
      width * ((x0 + x1) / 2),
      height * ((y0 + y1) / 2 + sag),
      width * x1,
      height * y1,
    );
    ctx.stroke();
  }
};

const grain = (ctx: Ctx, width: number, height: number, alpha: number): void => {
  ctx.fillStyle = rgba('#e9e3d2', alpha);
  for (let index = 0; index < (width * height) / 300; index += 1) {
    ctx.fillRect(Math.floor(hash(index * 1.17) * width), Math.floor(hash(index * 2.31) * height), 1, 1);
  }
};

export const drawCinematicStreetBackground = (ctx: Ctx, width: number, height: number): void => {
  const sky = linearGradient(ctx, 0, 0, 0, height * 0.72, [
    [0, C.skyTop],
    [0.34, C.skyMid],
    [0.68, C.skyHorizon],
    [1, '#2d5262'],
  ]);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, width, height);

  // A single warm break in the cloud, not a moon.
  const cloud = ctx.createRadialGradient(
    width * 0.3,
    height * 0.5,
    0,
    width * 0.3,
    height * 0.5,
    height * 0.3,
  );
  cloud.addColorStop(0, rgba(C.skyWarm, 0.16));
  cloud.addColorStop(0.5, rgba(C.skyWarm, 0.06));
  cloud.addColorStop(1, rgba(C.skyWarm, 0));
  ctx.fillStyle = cloud;
  ctx.fillRect(0, 0, width, height);

  for (let index = 0; index < 16; index += 1) {
    const cx = width * (0.05 + hash(index * 2.3) * 0.9);
    const cy = height * (0.1 + hash(index * 4.7) * 0.34);
    const rx = width * (0.07 + hash(index * 6.1) * 0.16);
    const ry = rx * (0.1 + hash(index * 8.3) * 0.1);
    ctx.fillStyle = rgba('#5f8291', 0.04 + hash(index) * 0.035);
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // Near facades framing the street.
  ctx.fillStyle = C.near;
  ctx.fillRect(-width * 0.02, height * 0.19, width * 0.13, height * 0.66 - height * 0.19);
  ctx.fillRect(width * 0.9, height * 0.15, width * 0.13, height * 0.66 - height * 0.15);
  windowGrid(ctx, width * 0.0, height * 0.23, width * 0.1, height * 0.4, 21.3, 5, 12, 'mid');
  windowGrid(ctx, width * 0.915, height * 0.19, width * 0.1, height * 0.44, 43.7, 5, 14, 'mid');
  ctx.strokeStyle = rgba('#6f8ea0', 0.05);
  ctx.lineWidth = 1;
  for (let row = 0; row < 30; row += 1) {
    const y = height * 0.19 + row * height * 0.017;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width * 0.11, y);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(width * 0.91, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }

  skyline(ctx, width, height);
  street(ctx, width, height);
  overhead(ctx, width, height);

  // Practical lamps on the platform side: small, warm, local.
  glow(ctx, width * 0.3, height * 0.285, height * 0.1, C.warm, 0.42);
  glow(ctx, width * 0.3, height * 0.285, height * 0.035, '#fff2d6', 0.85);
  glow(ctx, width * 0.82, height * 0.32, height * 0.09, C.cool, 0.2);
  glow(ctx, width * 0.52, height * 0.67, width * 0.06, C.sodium, 0.1);

  grain(ctx, width, height, 0.028);
};

export const drawCinematicBokehCloseup = (ctx: Ctx, width: number, height: number): void => {
  const base = linearGradient(ctx, 0, 0, width, height, [
    [0, '#04080e'],
    [0.4, '#0b1d2a'],
    [1, '#050e16'],
  ]);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, width, height);

  // Vertical shop-light columns with soft edges.
  for (let index = 0; index < 7; index += 1) {
    const x = width * (0.06 + index * 0.14);
    const color = index % 2 === 0 ? C.cool : C.sodium;
    const column = linearGradient(ctx, x, 0, x + width * 0.07, 0, [
      [0, rgba(color, 0)],
      [0.5, rgba(color, 0.12)],
      [1, rgba(color, 0)],
    ]);
    ctx.fillStyle = column;
    ctx.fillRect(x, height * 0.08, width * 0.07, height * 0.84);
  }

  // Bokeh discs: varied size, colour and softness.
  for (let index = 0; index < 56; index += 1) {
    const cx = width * (0.1 + hash(index * 2.9) * 0.95);
    const cy = height * (0.06 + hash(index * 4.3) * 0.84);
    const radius = height * (0.018 + hash(index * 6.7) * 0.1);
    const warm = hash(index * 8.9) > 0.4;
    glow(ctx, cx, cy, radius, warm ? C.sodium : C.cool, 0.14 + hash(index * 3.3) * 0.18);
    if (hash(index * 11.1) > 0.55) {
      ctx.strokeStyle = rgba(warm ? '#ffd9a0' : '#bff2f0', 0.06);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, radius * 0.75, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  // Wet pavement band with long reflections.
  const floor = linearGradient(ctx, 0, height * 0.72, 0, height, [
    [0, rgba('#08121a', 0.5)],
    [1, rgba('#02060a', 0.95)],
  ]);
  ctx.fillStyle = floor;
  ctx.fillRect(0, height * 0.72, width, height * 0.28);
  for (let index = 0; index < 14; index += 1) {
    wetReflection(
      ctx,
      width * (0.03 + index * 0.072),
      height * 0.74,
      height * 0.2,
      width * 0.011,
      index % 3 === 0 ? C.cool : C.warm,
      0.1,
      index * 17.3,
    );
  }
  grain(ctx, width, height, 0.026);
};

export const drawCinematicPlatformMidground = (ctx: Ctx, width: number, height: number): void => {
  const horizon = height * 0.66;

  // ---- Tiled wall behind the platform -------------------------------------
  const wallX = width * 0.5;
  const wallY = height * 0.28;
  const wallW = width * 0.48;
  const wallH = horizon - wallY + height * 0.04;
  const wallBase = linearGradient(ctx, 0, wallY, 0, wallY + wallH, [
    [0, '#12303e'],
    [0.6, '#0e2836'],
    [1, '#091c27'],
  ]);
  ctx.fillStyle = wallBase;
  ctx.fillRect(wallX, wallY, wallW, wallH);
  const tileW = 46;
  const tileH = 34;
  for (let row = 0; row * tileH < wallH; row += 1) {
    for (let col = 0; col * tileW < wallW; col += 1) {
      const value = hash2(col * 1.7, row * 2.3);
      const tone = value > 0.72 ? '#1d4554' : value > 0.4 ? '#173a48' : '#143340';
      ctx.fillStyle = rgba(tone, 0.85);
      ctx.fillRect(wallX + col * tileW + 0.5, wallY + row * tileH + 0.5, tileW - 1.5, tileH - 2);
      // Grout shadow and top bevel.
      ctx.fillStyle = rgba('#000000', 0.22);
      ctx.fillRect(wallX + col * tileW + 0.5, wallY + row * tileH + tileH - 2.2, tileW - 1.5, 1.6);
      ctx.fillStyle = rgba('#9fd3e0', 0.06);
      ctx.fillRect(wallX + col * tileW + 0.5, wallY + row * tileH + 0.5, tileW - 1.5, 1);
    }
  }
  // Wall wash: darker at the bottom, lit from the left.
  const wash = linearGradient(ctx, wallX, wallY, wallX + wallW, wallY + wallH, [
    [0, rgba('#000000', 0.5)],
    [0.35, rgba('#000000', 0.18)],
    [1, rgba('#000000', 0.62)],
  ]);
  ctx.fillStyle = wash;
  ctx.fillRect(wallX, wallY, wallW, wallH);

  // Poster and route map on the wall: small, readable detail.
  const posterX = wallX + wallW * 0.42;
  const posterY = wallY + wallH * 0.2;
  fillRoundRect(ctx, posterX, posterY, width * 0.042, height * 0.1, 3, rgba('#e9e3d2', 0.16));
  ctx.strokeStyle = rgba('#e9e3d2', 0.22);
  ctx.lineWidth = 1.4;
  roundRect(ctx, posterX, posterY, width * 0.042, height * 0.1, 3);
  ctx.stroke();
  for (let line = 0; line < 5; line += 1) {
    ctx.fillStyle = rgba('#0a1a24', 0.5);
    ctx.fillRect(
      posterX + width * 0.005,
      posterY + height * (0.012 + line * 0.016),
      width * (0.03 - line * 0.003),
      height * 0.005,
    );
  }
  const mapX = wallX + wallW * 0.14;
  const mapY = wallY + wallH * 0.26;
  fillRoundRect(ctx, mapX, mapY, width * 0.08, height * 0.14, 3, rgba('#0a1c26', 0.85));
  ctx.strokeStyle = rgba(C.cool, 0.28);
  ctx.lineWidth = 1.4;
  roundRect(ctx, mapX, mapY, width * 0.08, height * 0.14, 3);
  ctx.stroke();
  for (let stop = 0; stop < 4; stop += 1) {
    ctx.strokeStyle = rgba(C.cool, 0.4);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(mapX + width * 0.006, mapY + height * (0.02 + stop * 0.026));
    ctx.lineTo(mapX + width * 0.072, mapY + height * (0.016 + stop * 0.026));
    ctx.stroke();
  }

  // ---- Shelter -------------------------------------------------------------
  const roofY = height * 0.26;
  const roofX = width * 0.02;
  const roofW = width * 0.52;
  const roofH = height * 0.038;
  // Underside shadow.
  ctx.fillStyle = rgba('#000000', 0.42);
  ctx.fillRect(roofX, roofY + roofH * 0.55, roofW, roofH * 0.5);
  // Side face.
  const roofSide = linearGradient(ctx, 0, roofY, 0, roofY + roofH, [
    [0, '#1a2f3c'],
    [0.4, '#0c1a24'],
    [1, '#050d14'],
  ]);
  ctx.fillStyle = roofSide;
  roundRect(ctx, roofX, roofY, roofW, roofH, height * 0.008);
  ctx.fill();
  // Top face catching the sky.
  const roofTop = linearGradient(ctx, 0, roofY, 0, roofY + roofH * 0.35, [
    [0, rgba('#a8c9d6', 0.5)],
    [1, rgba('#5b8a9e', 0.12)],
  ]);
  ctx.fillStyle = roofTop;
  ctx.fillRect(roofX, roofY, roofW, roofH * 0.34);
  // Roof edge light.
  ctx.fillStyle = rgba('#dfeef4', 0.3);
  ctx.fillRect(roofX, roofY, roofW, Math.max(1, height * 0.004));
  // Support beam under the roof.
  ctx.fillStyle = '#040c12';
  ctx.fillRect(roofX, roofY + roofH, roofW, height * 0.014);
  ctx.fillStyle = rgba('#7fa6b8', 0.16);
  ctx.fillRect(roofX, roofY + roofH, roofW, 1);

  // Posts with thickness and wet highlights.
  const posts = [0.035, 0.14, 0.245, 0.35, 0.44, 0.505];
  for (const px of posts) {
    const postX = width * px;
    const postW = width * 0.012;
    const postGradient = linearGradient(ctx, postX, 0, postX + postW, 0, [
      [0, '#0d1b24'],
      [0.45, '#07121a'],
      [1, '#02070b'],
    ]);
    ctx.fillStyle = postGradient;
    ctx.fillRect(postX, roofY + roofH, postW, horizon - roofY - roofH);
    ctx.fillStyle = rgba('#a9cfdb', 0.18);
    ctx.fillRect(postX, roofY + roofH, Math.max(1, postW * 0.16), horizon - roofY - roofH);
    // Base plate.
    ctx.fillStyle = '#02070a';
    ctx.fillRect(postX - postW * 0.2, horizon - height * 0.012, postW * 1.4, height * 0.012);
  }

  // Glass panels between posts.
  for (let index = 0; index < posts.length - 1; index += 1) {
    const x0 = width * posts[index] + width * 0.012;
    const x1 = width * posts[index + 1];
    if (x1 <= x0) continue;
    const glass = linearGradient(ctx, x0, roofY, x1, horizon, [
      [0, rgba('#c8eef2', 0.1)],
      [0.45, rgba('#7fc0c8', 0.05)],
      [1, rgba('#c8eef2', 0.035)],
    ]);
    ctx.fillStyle = glass;
    ctx.fillRect(x0, roofY + roofH + height * 0.014, x1 - x0, horizon - roofY - roofH - height * 0.02);
    // Frame rails.
    ctx.fillStyle = rgba('#0b1a22', 0.8);
    ctx.fillRect(x0, roofY + roofH + height * 0.008, x1 - x0, height * 0.006);
    ctx.fillRect(x0, horizon - height * 0.014, x1 - x0, height * 0.008);
    // Wet streaks.
    for (let streak = 0; streak < 5; streak += 1) {
      ctx.strokeStyle = rgba('#ddf5f7', 0.09);
      ctx.lineWidth = 1;
      const sx = x0 + (x1 - x0) * (0.15 + streak * 0.18);
      ctx.beginPath();
      ctx.moveTo(sx, roofY + roofH + height * 0.02);
      ctx.lineTo(sx - 3, horizon - height * 0.02);
      ctx.stroke();
    }
    // Diagonal reflection sheet.
    ctx.fillStyle = rgba('#ffffff', 0.04);
    ctx.beginPath();
    ctx.moveTo(x0, horizon - height * 0.02);
    ctx.lineTo(x0 + (x1 - x0) * 0.5, roofY + roofH + height * 0.02);
    ctx.lineTo(x0 + (x1 - x0) * 0.72, roofY + roofH + height * 0.02);
    ctx.lineTo(x0 + (x1 - x0) * 0.22, horizon - height * 0.02);
    ctx.closePath();
    ctx.fill();
  }

  // Hanging route board, with a frame and glyph bars.
  const boardX = width * 0.365;
  const boardY = roofY + roofH + height * 0.02;
  const boardW = width * 0.082;
  const boardH = height * 0.14;
  ctx.fillStyle = rgba('#000000', 0.4);
  ctx.fillRect(boardX + 4, boardY + 6, boardW, boardH);
  fillRoundRect(ctx, boardX, boardY, boardW, boardH, width * 0.006, '#050d13');
  ctx.strokeStyle = rgba(C.cool, 0.4);
  ctx.lineWidth = Math.max(1.5, width * 0.0016);
  roundRect(ctx, boardX, boardY, boardW, boardH, width * 0.006);
  ctx.stroke();
  for (let bar = 0; bar < 4; bar += 1) {
    ctx.fillStyle = rgba('#9adcd8', 0.7);
    ctx.fillRect(
      boardX + boardW * 0.12,
      boardY + boardH * (0.1 + bar * 0.2),
      boardW * (0.5 + hash(bar * 3.7) * 0.28),
      Math.max(2, boardH * 0.055),
    );
  }

  // Bench with slats and backrest.
  const benchX = width * 0.16;
  const benchY = height * 0.56;
  const benchW = width * 0.16;
  ctx.fillStyle = rgba('#000000', 0.3);
  ctx.fillRect(benchX + 3, benchY + height * 0.05, benchW, height * 0.01);
  for (let slat = 0; slat < 5; slat += 1) {
    ctx.fillStyle = slat % 2 === 0 ? '#1b2b33' : '#15242c';
    ctx.fillRect(benchX, benchY + slat * height * 0.009, benchW, height * 0.007);
    ctx.fillStyle = rgba('#a9cfdb', 0.14);
    ctx.fillRect(benchX, benchY + slat * height * 0.009, benchW, 1);
  }
  for (let slat = 0; slat < 4; slat += 1) {
    ctx.fillStyle = slat % 2 === 0 ? '#1b2b33' : '#15242c';
    ctx.fillRect(benchX, benchY - height * 0.05 + slat * height * 0.0105, benchW, height * 0.008);
    ctx.fillStyle = rgba('#a9cfdb', 0.1);
    ctx.fillRect(benchX, benchY - height * 0.05 + slat * height * 0.0105, benchW, 1);
  }
  ctx.fillStyle = '#0a161d';
  for (const legX of [benchX + benchW * 0.08, benchX + benchW * 0.88]) {
    ctx.fillRect(legX, benchY + height * 0.042, width * 0.007, height * 0.055);
    ctx.fillRect(legX, benchY - height * 0.05, width * 0.007, height * 0.094);
  }

  // Trash bin.
  const binX = width * 0.455;
  const binY = height * 0.6;
  fillRoundRect(ctx, binX, binY, width * 0.034, height * 0.062, width * 0.006, '#142026');
  ctx.strokeStyle = rgba('#8fb3c0', 0.2);
  ctx.lineWidth = 1.5;
  roundRect(ctx, binX, binY, width * 0.034, height * 0.062, width * 0.006);
  ctx.stroke();
  ctx.fillStyle = '#071219';
  ctx.fillRect(binX - width * 0.003, binY - height * 0.006, width * 0.04, height * 0.009);

  // Lamp housing and light.
  const lampX = width * 0.29;
  const lampY = roofY + roofH * 0.4;
  ctx.fillStyle = '#07131a';
  roundRect(ctx, lampX - width * 0.028, lampY, width * 0.056, height * 0.02, height * 0.006);
  ctx.fill();
  ctx.fillStyle = rgba('#ffe9bd', 0.95);
  roundRect(ctx, lampX - width * 0.018, lampY + height * 0.016, width * 0.036, height * 0.008, height * 0.004);
  ctx.fill();
  glow(ctx, lampX, lampY + height * 0.02, height * 0.08, C.warm, 0.5);
  glow(ctx, lampX, lampY + height * 0.02, height * 0.026, '#fff6e2', 0.9);
  // Light pool on the platform floor.
  const pool = ctx.createRadialGradient(
    lampX,
    horizon,
    0,
    lampX,
    horizon,
    width * 0.12,
  );
  pool.addColorStop(0, rgba(C.warm, 0.2));
  pool.addColorStop(1, rgba(C.warm, 0));
  ctx.fillStyle = pool;
  ctx.beginPath();
  ctx.ellipse(lampX, horizon + height * 0.02, width * 0.12, height * 0.05, 0, 0, Math.PI * 2);
  ctx.fill();

  // Platform edge safety line with wear.
  const edge = linearGradient(ctx, 0, horizon - height * 0.012, 0, horizon + height * 0.022, [
    [0, rgba('#f0c07a', 0)],
    [0.5, rgba('#f0c07a', 0.5)],
    [1, rgba('#f0c07a', 0.05)],
  ]);
  ctx.fillStyle = edge;
  ctx.fillRect(0, horizon - height * 0.012, width * 0.78, height * 0.034);
  for (let wear = 0; wear < 18; wear += 1) {
    const wx = hash(wear * 5.3) * width * 0.78;
    ctx.fillStyle = rgba('#0a141c', 0.5);
    ctx.fillRect(wx, horizon - height * 0.008, width * (0.006 + hash(wear * 7.1) * 0.02), height * 0.012);
  }

  // Platform slab: translucent, so the street behind still reads while the
  // shelter stops floating above the wet road.
  const platform = linearGradient(ctx, 0, horizon, 0, height, [
    [0, rgba('#0b1720', 0.82)],
    [0.3, rgba('#0a141c', 0.5)],
    [1, rgba('#04080d', 0.18)],
  ]);
  ctx.fillStyle = platform;
  ctx.beginPath();
  ctx.moveTo(-width * 0.04, horizon + height * 0.012);
  ctx.lineTo(width * 0.78, horizon + height * 0.012);
  ctx.lineTo(width * 0.9, height);
  ctx.lineTo(-width * 0.08, height);
  ctx.closePath();
  ctx.fill();
  // Paver joints converging with the platform perspective.
  ctx.strokeStyle = rgba('#000000', 0.35);
  ctx.lineWidth = 1.5;
  for (let index = 0; index < 9; index += 1) {
    const t = index / 8;
    ctx.beginPath();
    ctx.moveTo(width * (0.02 + t * 0.7), horizon + height * 0.014);
    ctx.lineTo(width * (0.04 + t * 0.82), height);
    ctx.stroke();
  }
  for (let row = 0; row < 5; row += 1) {
    const y = horizon + height * (0.03 + row * 0.07);
    ctx.beginPath();
    ctx.moveTo(-width * 0.04, y);
    ctx.lineTo(width * 0.84, y);
    ctx.stroke();
  }
  // Wet sheen on the slab.
  const sheen = linearGradient(ctx, 0, horizon, width * 0.7, horizon + height * 0.12, [
    [0, rgba('#a8cfdc', 0.06)],
    [1, rgba('#a8cfdc', 0)],
  ]);
  ctx.fillStyle = sheen;
  ctx.fillRect(0, horizon, width * 0.78, height * 0.12);

  // Distant stop pole at the right.
  ctx.fillStyle = rgba('#071620', 0.92);
  ctx.fillRect(width * 0.87, height * 0.35, width * 0.007, height * 0.31);
  fillRoundRect(ctx, width * 0.855, height * 0.335, width * 0.036, height * 0.028, width * 0.005, '#08161f');
  ctx.strokeStyle = rgba(C.cool, 0.25);
  ctx.lineWidth = 1.2;
  roundRect(ctx, width * 0.855, height * 0.335, width * 0.036, height * 0.028, width * 0.005);
  ctx.stroke();
};

export const drawCinematicBokehMidground = (ctx: Ctx, width: number, height: number): void => {
  // A transparent defocus plane used for close shots: it sits between the
  // background and the subject and gives the camera something to parallax.
  const discs = 34;
  for (let index = 0; index < discs; index += 1) {
    const cx = width * (0.42 + hash(index * 2.71) * 0.62);
    const cy = height * (0.08 + hash(index * 4.13) * 0.8);
    const radius = height * (0.035 + hash(index * 6.37) * 0.14);
    const warm = hash(index * 8.91) > 0.38;
    const color = warm ? '#e29a4a' : '#6fd0cc';
    const gradient = ctx.createRadialGradient(cx, cy, radius * 0.2, cx, cy, radius);
    gradient.addColorStop(0, rgba(color, 0.1 + hash(index * 3.1) * 0.14));
    gradient.addColorStop(0.65, rgba(color, 0.06 + hash(index * 5.3) * 0.08));
    gradient.addColorStop(1, rgba(color, 0));
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();
  }
  // Thin reflected light streaks.
  for (let index = 0; index < 16; index += 1) {
    const x = width * (0.4 + hash(index * 1.9) * 0.6);
    const y = height * (0.15 + hash(index * 3.7) * 0.7);
    ctx.strokeStyle = rgba('#dff4ff', 0.04 + hash(index * 5.1) * 0.05);
    ctx.lineWidth = 2 + hash(index * 7.3) * 4;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + width * 0.03, y - height * 0.01);
    ctx.stroke();
  }
};

export const drawCinematicRailForeground = (ctx: Ctx, width: number, height: number): void => {
  const barColor = '#01050a';
  const rim = rgba('#8fb0c2', 0.32);

  // Railing.
  ctx.fillStyle = barColor;
  ctx.fillRect(-width * 0.02, height * 0.775, width * 1.04, height * 0.022);
  ctx.fillRect(-width * 0.02, height * 0.9, width * 1.04, height * 0.032);
  for (let index = 0; index < 7; index += 1) {
    const x = width * (0.02 + index * 0.16);
    ctx.fillRect(x, height * 0.765, width * 0.016, height * 0.175);
    ctx.fillStyle = rim;
    ctx.fillRect(x, height * 0.765, Math.max(1, width * 0.0018), height * 0.175);
    ctx.fillStyle = barColor;
  }
  ctx.fillStyle = rim;
  ctx.fillRect(-width * 0.02, height * 0.775, width * 1.04, Math.max(1, height * 0.0024));
  ctx.fillRect(-width * 0.02, height * 0.9, width * 1.04, Math.max(1, height * 0.003));
  // Wear and wet joints.
  for (let index = 0; index < 24; index += 1) {
    ctx.fillStyle = rgba('#7d97a6', 0.1 + hash(index * 3.1) * 0.12);
    ctx.fillRect(
      hash(index * 5.7) * width,
      height * (0.78 + hash(index * 7.3) * 0.14),
      width * (0.004 + hash(index * 9.1) * 0.02),
      1,
    );
  }

  // Bottom water sheet.
  const water = linearGradient(ctx, 0, height * 0.88, 0, height, [
    [0, rgba('#0a1a24', 0)],
    [0.45, rgba('#0b2230', 0.5)],
    [1, rgba('#010407', 0.92)],
  ]);
  ctx.fillStyle = water;
  ctx.fillRect(0, height * 0.88, width, height * 0.12);
  for (let index = 0; index < 60; index += 1) {
    const x = hash(index * 3.3) * width;
    const y = height * (0.89 + hash(index * 5.7) * 0.09);
    ctx.strokeStyle = rgba('#cfe8f2', 0.04 + hash(index * 7.9) * 0.09);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + 8 + hash(index * 9.1) * 24, y - 1);
    ctx.stroke();
  }

  // Extreme foreground cable.
  ctx.strokeStyle = rgba('#010407', 0.96);
  ctx.lineWidth = Math.max(3, width * 0.008);
  ctx.beginPath();
  ctx.moveTo(-width * 0.05, height * 0.21);
  ctx.quadraticCurveTo(width * 0.45, height * 0.04, width * 1.06, height * 0.15);
  ctx.stroke();
  ctx.strokeStyle = rgba('#9fb9c6', 0.12);
  ctx.lineWidth = Math.max(1, width * 0.0016);
  ctx.beginPath();
  ctx.moveTo(-width * 0.05, height * 0.219);
  ctx.quadraticCurveTo(width * 0.45, height * 0.049, width * 1.06, height * 0.159);
  ctx.stroke();

  // Out-of-focus foliage.
  ctx.save();
  ctx.filter = `blur(${Math.round(width * 0.014)}px)`;
  for (let index = 0; index < 18; index += 1) {
    const cx = width * (0.78 + hash(index * 2.3) * 0.26);
    const cy = height * (0.01 + hash(index * 4.1) * 0.2);
    const rx = width * (0.025 + hash(index * 6.1) * 0.07);
    ctx.fillStyle = rgba('#040a07', 0.5);
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, rx * 0.6, hash(index * 8.7) * 0.8 - 0.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = rgba('#1a3026', 0.12);
    ctx.beginPath();
    ctx.ellipse(cx - rx * 0.3, cy - rx * 0.2, rx * 0.5, rx * 0.3, 0.2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  // Near rain streaks, blurred by proximity to the lens.
  ctx.save();
  ctx.filter = `blur(${Math.round(width * 0.004)}px)`;
  ctx.lineCap = 'round';
  for (let index = 0; index < 26; index += 1) {
    const x = hash(index * 1.9) * width;
    const y = hash(index * 3.1) * height;
    const length = height * (0.03 + hash(index * 5.3) * 0.08);
    ctx.strokeStyle = rgba('#d8ecf6', 0.05 + hash(index * 7.7) * 0.1);
    ctx.lineWidth = 2 + hash(index * 9.3) * 3;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - width * 0.012, y + length);
    ctx.stroke();
  }
  ctx.restore();
  void clamp;
};
