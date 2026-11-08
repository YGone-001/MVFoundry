// High-detail figure and prop drawing for the cinematic prototype.
//
// Shapes are painted with clipped gradients, fold strokes and rim light instead
// of flat fills, so the cutouts read as illustrated people rather than icons.

import type {Ctx} from './shared';
import {glow, hash, linearGradient, rgba, roundRect} from './shared';

const PAL = {
  skin: '#e8b58d',
  skinLight: '#f6d3b4',
  skinShade: '#b9784f',
  skinDeep: '#8f5439',
  hair: '#12131a',
  hairMid: '#242633',
  hairLight: '#4a4150',
  cream: '#efe3ce',
  creamLight: '#fff3de',
  creamShade: '#c2b59c',
  creamDeep: '#9d9179',
  olive: '#4c5838',
  oliveLight: '#67754a',
  oliveShade: '#343d26',
  oliveDeep: '#232a18',
  trouser: '#20262e',
  trouserLight: '#39424e',
  trouserShade: '#10151b',
  boot: '#0b0f14',
  bootLight: '#2b333d',
  scarf: '#b84753',
  scarfLight: '#d9636f',
  scarfShade: '#7c2b35',
  ink: '#05080c',
};

type Stop = [number, string];

const paint = (
  ctx: Ctx,
  path: () => void,
  stops: Stop[],
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): void => {
  ctx.save();
  path();
  const gradient = linearGradient(ctx, x0, y0, x1, y1, stops);
  ctx.fillStyle = gradient;
  ctx.fill();
  ctx.restore();
};

const strokeInside = (
  ctx: Ctx,
  clip: () => void,
  strokes: Array<{points: Array<[number, number]>; color: string; width: number}>,
): void => {
  ctx.save();
  clip();
  for (const stroke of strokes) {
    ctx.strokeStyle = stroke.color;
    ctx.lineWidth = stroke.width;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (const [index, [x, y]] of stroke.points.entries()) {
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.restore();
};

const rimStroke = (
  ctx: Ctx,
  points: Array<[number, number]>,
  color: string,
  width: number,
): void => {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (const [index, [x, y]] of points.entries()) {
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
};

/* -------------------------------------------------------------------------- */
/* Head                                                                        */
/* -------------------------------------------------------------------------- */

type HeadOptions = {
  cx: number;
  cy: number;
  scale: number;
  hairStyle: 'bob' | 'short';
  look: 'away' | 'down' | 'returning';
  tear?: boolean;
  lipTight?: boolean;
  rimSide: 1 | -1;
};

const drawHead = (ctx: Ctx, options: HeadOptions): void => {
  const {cx, cy, scale, hairStyle, look, tear, lipTight, rimSide} = options;
  const rx = 42 * scale;
  const ry = 54 * scale;

  // Neck: tapered, shaded on the shadow side.
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(cx - 16 * scale, cy + ry * 0.75);
  ctx.lineTo(cx + 16 * scale, cy + ry * 0.75);
  ctx.lineTo(cx + 20 * scale, cy + ry * 1.7);
  ctx.lineTo(cx - 20 * scale, cy + ry * 1.7);
  ctx.closePath();
  const neck = linearGradient(
    ctx,
    cx - 20 * scale,
    0,
    cx + 20 * scale,
    0,
    rimSide === 1
      ? [[0, PAL.skinShade], [0.45, PAL.skin], [1, PAL.skinDeep]]
      : [[0, PAL.skinDeep], [0.55, PAL.skin], [1, PAL.skinShade]],
  );
  ctx.fillStyle = neck;
  ctx.fill();
  // Neck shadow under the jaw.
  const jawShadow = linearGradient(ctx, 0, cy + ry * 0.7, 0, cy + ry * 1.3, [
    [0, rgba(PAL.skinDeep, 0.65)],
    [1, rgba(PAL.skinDeep, 0)],
  ]);
  ctx.fillStyle = jawShadow;
  ctx.fillRect(cx - 20 * scale, cy + ry * 0.7, 40 * scale, ry * 0.6);
  ctx.restore();

  // Face mass: forehead, cheekbones and a tapered jaw.
  const facePath = (): void => {
    ctx.beginPath();
    ctx.moveTo(cx - rx, cy - ry * 0.55);
    ctx.quadraticCurveTo(cx - rx * 1.02, cy + ry * 0.06, cx - rx * 0.78, cy + ry * 0.5);
    ctx.quadraticCurveTo(cx - rx * 0.4, cy + ry * 0.98, cx, cy + ry * 1.02);
    ctx.quadraticCurveTo(cx + rx * 0.4, cy + ry * 0.98, cx + rx * 0.78, cy + ry * 0.5);
    ctx.quadraticCurveTo(cx + rx * 1.02, cy + ry * 0.06, cx + rx, cy - ry * 0.55);
    ctx.quadraticCurveTo(cx, cy - ry * 1.05, cx - rx, cy - ry * 0.55);
    ctx.closePath();
  };
  paint(
    ctx,
    facePath,
    rimSide === 1
      ? [[0, PAL.skinLight], [0.45, PAL.skin], [1, PAL.skinShade]]
      : [[0, PAL.skinShade], [0.5, PAL.skin], [1, PAL.skinLight]],
    cx - rx,
    cy - ry,
    cx + rx,
    cy + ry,
  );

  // Cheek and jaw shading inside the face silhouette.
  strokeInside(ctx, facePath, [
    {
      points: [
        [cx + rimSide * -rx * 0.86, cy + ry * 0.34],
        [cx + rimSide * -rx * 0.62, cy + ry * 0.72],
        [cx + rimSide * -rx * 0.3, cy + ry * 0.94],
      ],
      color: rgba(PAL.skinShade, 0.45),
      width: 6 * scale,
    },
    {
      points: [
        [cx + rimSide * -rx * 0.9, cy - ry * 0.3],
        [cx + rimSide * -rx * 0.8, cy + ry * 0.1],
      ],
      color: rgba(PAL.skinShade, 0.28),
      width: 9 * scale,
    },
  ]);

  // Warm cheek blush.
  const blush = ctx.createRadialGradient(
    cx + rimSide * -rx * 0.55,
    cy + ry * 0.36,
    0,
    cx + rimSide * -rx * 0.55,
    cy + ry * 0.36,
    rx * 0.55,
  );
  blush.addColorStop(0, rgba('#c8615a', 0.18));
  blush.addColorStop(1, rgba('#c8615a', 0));
  ctx.fillStyle = blush;
  ctx.fillRect(cx - rx, cy, rx * 2, ry * 1.1);

  // Hair: a shaped mass with a specular band.
  const hairPath = (): void => {
    if (hairStyle === 'bob') {
      ctx.beginPath();
      ctx.moveTo(cx - rx * 1.16, cy + ry * 0.56);
      ctx.quadraticCurveTo(cx - rx * 1.5, cy - ry * 0.25, cx - rx * 0.92, cy - ry * 0.86);
      ctx.quadraticCurveTo(cx, cy - ry * 1.5, cx + rx * 0.92, cy - ry * 0.86);
      ctx.quadraticCurveTo(cx + rx * 1.5, cy - ry * 0.25, cx + rx * 1.16, cy + ry * 0.56);
      ctx.quadraticCurveTo(cx + rx * 0.9, cy + ry * 0.2, cx + rx * 0.62, cy - ry * 0.42);
      ctx.quadraticCurveTo(cx + rx * 0.2, cy - ry * 0.62, cx, cy - ry * 0.64);
      ctx.quadraticCurveTo(cx - rx * 0.2, cy - ry * 0.62, cx - rx * 0.62, cy - ry * 0.42);
      ctx.quadraticCurveTo(cx - rx * 0.9, cy + ry * 0.2, cx - rx * 1.16, cy + ry * 0.56);
      ctx.closePath();
    } else {
      ctx.beginPath();
      ctx.moveTo(cx - rx * 1.06, cy - ry * 0.12);
      ctx.quadraticCurveTo(cx - rx * 1.1, cy - ry * 1.06, cx, cy - ry * 1.14);
      ctx.quadraticCurveTo(cx + rx * 1.1, cy - ry * 1.06, cx + rx * 1.06, cy - ry * 0.12);
      ctx.quadraticCurveTo(cx + rx * 0.8, cy - ry * 0.52, cx + rx * 0.4, cy - ry * 0.6);
      ctx.quadraticCurveTo(cx - rx * 0.3, cy - ry * 0.64, cx - rx * 0.8, cy - ry * 0.5);
      ctx.closePath();
    }
  };
  paint(
    ctx,
    hairPath,
    [[0, PAL.hairMid], [0.35, PAL.hair], [1, PAL.hair]],
    cx - rx,
    cy - ry,
    cx + rx,
    cy + ry,
  );
  strokeInside(ctx, hairPath, [
    {
      points: [
        [cx + rimSide * -rx * 0.55, cy - ry * 1.05],
        [cx + rimSide * -rx * 0.78, cy - ry * 0.55],
        [cx + rimSide * -rx * 0.9, cy + ry * 0.1],
      ],
      color: rgba(PAL.hairLight, 0.55),
      width: 7 * scale,
    },
    {
      points: [
        [cx + rimSide * -rx * 0.25, cy - ry * 1.1],
        [cx + rimSide * -rx * 0.4, cy - ry * 0.65],
        [cx + rimSide * -rx * 0.55, cy - ry * 0.35],
      ],
      color: rgba(PAL.hairLight, 0.3),
      width: 4 * scale,
    },
  ]);

  // Fringe over the forehead.
  if (hairStyle === 'bob') {
    ctx.save();
    facePath();
    ctx.clip();
    ctx.fillStyle = PAL.hair;
    ctx.beginPath();
    ctx.moveTo(cx - rx, cy - ry * 0.5);
    ctx.lineTo(cx - rx * 0.2, cy - ry * 0.42);
    ctx.lineTo(cx - rx * 0.4, cy - ry * 0.12);
    ctx.lineTo(cx + rx * 0.1, cy - ry * 0.34);
    ctx.lineTo(cx + rx * 0.4, cy - ry * 0.08);
    ctx.lineTo(cx + rx, cy - ry * 0.52);
    ctx.lineTo(cx + rx, cy - ry * 1.2);
    ctx.lineTo(cx - rx, cy - ry * 1.2);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // Eyes.
  const eyeY = cy + ry * 0.08;
  const eyeShift = look === 'away' ? rx * 0.1 : look === 'down' ? 0 : -rx * 0.04;
  for (const side of [-1, 1] as const) {
    const ex = cx + side * rx * 0.42 + eyeShift;
    // Sclera.
    ctx.fillStyle = '#f7efe4';
    ctx.beginPath();
    ctx.ellipse(ex, eyeY, rx * 0.24, ry * 0.16, side * 0.06, 0, Math.PI * 2);
    ctx.fill();
    // Iris.
    const iris = linearGradient(ctx, ex, eyeY - ry * 0.14, ex, eyeY + ry * 0.14, [
      [0, '#4a3226'],
      [1, '#1d1411'],
    ]);
    ctx.fillStyle = iris;
    ctx.beginPath();
    ctx.ellipse(ex + eyeShift * 0.4, eyeY + ry * 0.02, rx * 0.13, ry * 0.13, 0, 0, Math.PI * 2);
    ctx.fill();
    // Pupil and catchlight.
    ctx.fillStyle = '#0c0a0b';
    ctx.beginPath();
    ctx.ellipse(ex + eyeShift * 0.4, eyeY + ry * 0.03, rx * 0.06, ry * 0.07, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = rgba('#fff8ef', 0.9);
    ctx.beginPath();
    ctx.arc(ex + eyeShift * 0.4 - rx * 0.045, eyeY - ry * 0.035, rx * 0.035, 0, Math.PI * 2);
    ctx.fill();
    // Upper lid line and lashes.
    ctx.strokeStyle = rgba('#2a1b17', 0.85);
    ctx.lineWidth = 2.2 * scale;
    ctx.beginPath();
    ctx.moveTo(ex - rx * 0.25, eyeY - ry * 0.1);
    ctx.quadraticCurveTo(ex, eyeY - ry * 0.21, ex + rx * 0.25, eyeY - ry * 0.08);
    ctx.stroke();
    ctx.lineWidth = 1.2 * scale;
    ctx.beginPath();
    ctx.moveTo(ex - rx * 0.22, eyeY + ry * 0.13);
    ctx.quadraticCurveTo(ex, eyeY + ry * 0.2, ex + rx * 0.22, eyeY + ry * 0.11);
    ctx.stroke();
    // Lashes on the outer corner.
    for (let lash = 0; lash < 3; lash += 1) {
      ctx.beginPath();
      ctx.moveTo(ex + side * rx * (0.2 + lash * 0.025), eyeY - ry * (0.07 + lash * 0.01));
      ctx.lineTo(ex + side * rx * (0.28 + lash * 0.03), eyeY - ry * (0.16 + lash * 0.02));
      ctx.stroke();
    }
  }

  // Brows: inner ends raised into a worried line, not an angry one.
  for (const side of [-1, 1] as const) {
    ctx.strokeStyle = rgba('#2b1a17', 0.9);
    ctx.lineWidth = 2.6 * scale;
    ctx.beginPath();
    ctx.moveTo(cx + side * rx * 0.66, eyeY - ry * 0.26);
    ctx.quadraticCurveTo(
      cx + side * rx * 0.44,
      eyeY - ry * 0.44,
      cx + side * rx * 0.2,
      eyeY - ry * 0.38,
    );
    ctx.stroke();
  }

  // Nose: bridge highlight and a soft shadow.
  ctx.strokeStyle = rgba(PAL.skinShade, 0.5);
  ctx.lineWidth = 2 * scale;
  ctx.beginPath();
  ctx.moveTo(cx + rimSide * -rx * 0.06, eyeY + ry * 0.02);
  ctx.quadraticCurveTo(
    cx + rimSide * -rx * 0.1,
    eyeY + ry * 0.22,
    cx + rimSide * -rx * 0.18,
    eyeY + ry * 0.26,
  );
  ctx.stroke();
  ctx.strokeStyle = rgba(PAL.skinLight, 0.5);
  ctx.lineWidth = 2.4 * scale;
  ctx.beginPath();
  ctx.moveTo(cx + rimSide * rx * 0.06, eyeY - ry * 0.04);
  ctx.lineTo(cx + rimSide * rx * 0.04, eyeY + ry * 0.16);
  ctx.stroke();

  // Mouth.
  const mouthY = eyeY + ry * 0.46;
  ctx.strokeStyle = rgba('#7d3a3b', 0.85);
  ctx.lineWidth = 2.4 * scale;
  ctx.beginPath();
  if (lipTight) {
    ctx.moveTo(cx - rx * 0.22, mouthY);
    ctx.lineTo(cx + rx * 0.2, mouthY - ry * 0.02);
  } else {
    ctx.moveTo(cx - rx * 0.22, mouthY);
    ctx.quadraticCurveTo(cx, mouthY + ry * 0.06, cx + rx * 0.2, mouthY - ry * 0.01);
  }
  ctx.stroke();
  ctx.strokeStyle = rgba('#c98380', 0.55);
  ctx.lineWidth = 1.2 * scale;
  ctx.beginPath();
  ctx.moveTo(cx - rx * 0.16, mouthY + ry * 0.05);
  ctx.quadraticCurveTo(cx, mouthY + ry * 0.09, cx + rx * 0.15, mouthY + ry * 0.03);
  ctx.stroke();

  if (tear) {
    const tearX = cx + rx * 0.34;
    const tearY = eyeY + ry * 0.18;
    const drop = linearGradient(ctx, tearX, tearY, tearX, tearY + ry * 0.26, [
      [0, rgba('#e7f7ff', 0.95)],
      [1, rgba('#9fd0e4', 0.5)],
    ]);
    ctx.fillStyle = drop;
    ctx.beginPath();
    ctx.ellipse(tearX, tearY + ry * 0.12, 1.9 * scale, 6.5 * scale, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = rgba('#ffffff', 0.85);
    ctx.beginPath();
    ctx.arc(tearX - 0.6 * scale, tearY + ry * 0.08, 0.9 * scale, 0, Math.PI * 2);
    ctx.fill();
  }

  // Rim light around the lit silhouette edge.
  ctx.strokeStyle = rgba('#ffe0b0', 0.32);
  ctx.lineWidth = 2.4 * scale;
  ctx.beginPath();
  ctx.moveTo(cx + rimSide * -rx * 0.98, cy - ry * 0.5);
  ctx.quadraticCurveTo(cx + rimSide * -rx * 1.02, cy + ry * 0.1, cx + rimSide * -rx * 0.7, cy + ry * 0.62);
  ctx.stroke();
};

/* -------------------------------------------------------------------------- */
/* Figures                                                                     */
/* -------------------------------------------------------------------------- */

type FigureOptions = {
  cx: number;
  groundY: number;
  height: number;
  kind: 'woman' | 'man';
};

const drawLegShadow = (ctx: Ctx, cx: number, groundY: number, spread: number): void => {
  const gradient = ctx.createRadialGradient(cx, groundY, 0, cx, groundY, spread);
  gradient.addColorStop(0, 'rgba(0,0,0,0.55)');
  gradient.addColorStop(0.55, 'rgba(0,0,0,0.22)');
  gradient.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.ellipse(cx, groundY, spread, spread * 0.2, 0, 0, Math.PI * 2);
  ctx.fill();
};

const leg = (
  ctx: Ctx,
  x: number,
  hipY: number,
  ankleY: number,
  width: number,
  color: string,
  light: string,
  shade: string,
  boot: boolean,
): void => {
  const path = (): void => {
    ctx.beginPath();
    ctx.moveTo(x - width * 0.5, hipY);
    ctx.quadraticCurveTo(x - width * 0.42, (hipY + ankleY) / 2, x - width * 0.34, ankleY);
    ctx.lineTo(x + width * 0.34, ankleY);
    ctx.quadraticCurveTo(x + width * 0.42, (hipY + ankleY) / 2, x + width * 0.5, hipY);
    ctx.closePath();
  };
  paint(ctx, path, [[0, light], [0.35, color], [1, shade]], x - width, 0, x + width, 0);
  strokeInside(ctx, path, [
    {
      points: [
        [x - width * 0.14, hipY + 8],
        [x - width * 0.1, (hipY + ankleY) / 2],
        [x - width * 0.14, ankleY - 8],
      ],
      color: rgba('#ffffff', 0.1),
      width: width * 0.14,
    },
    {
      points: [
        [x + width * 0.26, hipY + 8],
        [x + width * 0.28, ankleY - 8],
      ],
      color: rgba('#000000', 0.22),
      width: width * 0.2,
    },
  ]);
  if (boot) {
    ctx.fillStyle = PAL.boot;
    ctx.beginPath();
    ctx.moveTo(x - width * 0.5, ankleY - width * 0.4);
    ctx.lineTo(x + width * 0.5, ankleY - width * 0.4);
    ctx.lineTo(x + width * 0.46, ankleY + width * 0.3);
    ctx.quadraticCurveTo(x + width * 0.2, ankleY + width * 0.44, x - width * 0.44, ankleY + width * 0.34);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = PAL.bootLight;
    ctx.fillRect(x - width * 0.5, ankleY - width * 0.4, width, 2);
  }
};

const hand = (
  ctx: Ctx,
  x: number,
  y: number,
  rx: number,
  ry: number,
  skin: string,
  shade: string,
): void => {
  const gradient = ctx.createLinearGradient(x - rx, y, x + rx, y);
  gradient.addColorStop(0, skin);
  gradient.addColorStop(1, shade);
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0.1, 0, Math.PI * 2);
  ctx.fill();
  // Suggested fingers.
  ctx.fillStyle = rgba(shade, 0.55);
  for (let finger = 0; finger < 3; finger += 1) {
    ctx.beginPath();
    ctx.ellipse(x - rx * 0.2 + finger * rx * 0.22, y + ry * 0.62, rx * 0.2, ry * 0.18, 0.2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = rgba(skin, 0.9);
  ctx.beginPath();
  ctx.ellipse(x - rx * 0.2, y - ry * 0.3, rx * 0.55, ry * 0.4, -0.2, 0, Math.PI * 2);
  ctx.fill();
};

const drawUmbrella = (
  ctx: Ctx,
  options: {cx: number; canopyY: number; radius: number; shaftEndX: number; shaftEndY: number},
): void => {
  const {cx, canopyY, radius, shaftEndX, shaftEndY} = options;
  const ribs = 8;

  // Shaft from the canopy hub to the hand.
  ctx.strokeStyle = rgba('#131a22', 0.95);
  ctx.lineWidth = Math.max(3, radius * 0.022);
  ctx.beginPath();
  ctx.moveTo(cx, canopyY);
  ctx.lineTo(shaftEndX, shaftEndY);
  ctx.stroke();
  ctx.strokeStyle = rgba('#b7c9d2', 0.32);
  ctx.lineWidth = Math.max(1, radius * 0.006);
  ctx.beginPath();
  ctx.moveTo(cx + radius * 0.012, canopyY);
  ctx.lineTo(shaftEndX + radius * 0.012, shaftEndY);
  ctx.stroke();
  // Crook handle.
  ctx.strokeStyle = rgba('#20262e', 0.9);
  ctx.lineWidth = Math.max(3, radius * 0.02);
  ctx.beginPath();
  ctx.moveTo(shaftEndX, shaftEndY);
  ctx.quadraticCurveTo(shaftEndX + radius * 0.05, shaftEndY + radius * 0.09, shaftEndX - radius * 0.03, shaftEndY + radius * 0.1);
  ctx.stroke();

  // Transparent canopy.
  const canopy = ctx.createRadialGradient(cx, canopyY, radius * 0.05, cx, canopyY, radius);
  canopy.addColorStop(0, rgba('#dfeef4', 0.14));
  canopy.addColorStop(0.7, rgba('#bfe0ea', 0.08));
  canopy.addColorStop(1, rgba('#e8f7ff', 0.24));
  ctx.fillStyle = canopy;
  ctx.beginPath();
  ctx.ellipse(cx, canopyY, radius, radius * 0.4, 0, Math.PI, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = rgba('#d8eef6', 0.5);
  ctx.lineWidth = Math.max(2, radius * 0.014);
  ctx.beginPath();
  ctx.ellipse(cx, canopyY, radius, radius * 0.4, 0, Math.PI, Math.PI * 2);
  ctx.stroke();

  // Ribs.
  ctx.strokeStyle = rgba('#2b3540', 0.45);
  ctx.lineWidth = Math.max(1, radius * 0.007);
  for (let rib = 0; rib < ribs; rib += 1) {
    const angle = Math.PI + (rib / (ribs - 1)) * Math.PI;
    ctx.beginPath();
    ctx.moveTo(cx, canopyY);
    ctx.quadraticCurveTo(
      cx + Math.cos(angle) * radius * 0.6,
      canopyY + Math.sin(angle) * radius * 0.26,
      cx + Math.cos(angle) * radius,
      canopyY + Math.sin(angle) * radius * 0.4,
    );
    ctx.stroke();
  }

  // Water beads.
  for (let bead = 0; bead < 34; bead += 1) {
    const angle = Math.PI + hash(bead * 3.1) * Math.PI;
    const distance = radius * (0.2 + hash(bead * 5.3) * 0.78);
    const bx = cx + Math.cos(angle) * distance;
    const by = canopyY + Math.sin(angle) * distance * 0.4;
    ctx.fillStyle = rgba('#eaf9ff', 0.24 + hash(bead * 7.7) * 0.3);
    ctx.beginPath();
    ctx.arc(bx, by, radius * (0.006 + hash(bead * 9.1) * 0.012), 0, Math.PI * 2);
    ctx.fill();
  }

  // Warm rim light on the street side of the canopy.
  ctx.strokeStyle = rgba('#ffe0b0', 0.24);
  ctx.lineWidth = Math.max(2, radius * 0.02);
  ctx.beginPath();
  ctx.ellipse(cx, canopyY, radius, radius * 0.4, 0, Math.PI * 1.12, Math.PI * 1.88);
  ctx.stroke();
};

export const drawCinematicWoman = (ctx: Ctx, width: number, height: number): void => {
  const H = height * 0.74;
  const cx = width * 0.5;
  const groundY = height * 0.96;
  const headTop = groundY - H;
  const headRy = H * 0.068;
  const headRy2 = headRy;
  const headCy = headTop + headRy2 * 1.05;
  const shoulderY = headCy + headRy2 * 1.25;
  const hipY = groundY - H * 0.42;
  const hemY = groundY - H * 0.3;
  const shoulderHalf = H * 0.115;
  const hemHalf = H * 0.128;
  const legWidth = H * 0.075;

  drawLegShadow(ctx, cx, groundY, width * 0.24);

  // Legs.
  leg(ctx, cx - H * 0.06, hipY, groundY - H * 0.03, legWidth, PAL.trouser, PAL.trouserLight, PAL.trouserShade, false);
  leg(ctx, cx + H * 0.06, hipY, groundY - H * 0.03, legWidth, PAL.trouser, PAL.trouserLight, PAL.trouserShade, false);
  // Boots.
  for (const side of [-1, 1] as const) {
    const bx = cx + side * H * 0.06;
    const ankleY = groundY - H * 0.03;
    ctx.fillStyle = PAL.boot;
    ctx.beginPath();
    ctx.moveTo(bx - legWidth * 0.55, ankleY - H * 0.03);
    ctx.lineTo(bx + legWidth * 0.55, ankleY - H * 0.03);
    ctx.lineTo(bx + legWidth * 0.62, ankleY + H * 0.02);
    ctx.quadraticCurveTo(bx + legWidth * 0.2, ankleY + H * 0.032, bx - legWidth * 0.6, ankleY + H * 0.024);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = rgba(PAL.bootLight, 0.7);
    ctx.fillRect(bx - legWidth * 0.55, ankleY - H * 0.03, legWidth * 1.1, H * 0.004);
    ctx.fillStyle = rgba('#000000', 0.5);
    ctx.fillRect(bx - legWidth * 0.62, ankleY + H * 0.028, legWidth * 1.24, H * 0.006);
  }

  // Coat body.
  const coatPath = (): void => {
    ctx.beginPath();
    ctx.moveTo(cx - shoulderHalf, shoulderY);
    ctx.quadraticCurveTo(cx - shoulderHalf * 1.12, shoulderY + H * 0.12, cx - hemHalf, hemY);
    ctx.lineTo(cx + hemHalf, hemY);
    ctx.quadraticCurveTo(cx + shoulderHalf * 1.12, shoulderY + H * 0.12, cx + shoulderHalf, shoulderY);
    ctx.quadraticCurveTo(cx, shoulderY - H * 0.04, cx - shoulderHalf, shoulderY);
    ctx.closePath();
  };
  paint(
    ctx,
    coatPath,
    [[0, PAL.creamLight], [0.35, PAL.cream], [0.85, PAL.creamShade], [1, PAL.creamDeep]],
    cx - hemHalf,
    shoulderY,
    cx + hemHalf,
    hemY,
  );

  // Fabric folds and volume inside the coat.
  strokeInside(ctx, coatPath, [
    {points: [[cx - shoulderHalf * 0.9, shoulderY + H * 0.05], [cx - hemHalf * 0.72, hemY - H * 0.02]], color: rgba(PAL.creamDeep, 0.3), width: H * 0.008},
    {points: [[cx - shoulderHalf * 0.55, shoulderY + H * 0.12], [cx - hemHalf * 0.4, hemY - H * 0.03]], color: rgba(PAL.creamDeep, 0.2), width: H * 0.006},
    {points: [[cx - shoulderHalf * 0.2, shoulderY + H * 0.16], [cx - hemHalf * 0.12, hemY - H * 0.06]], color: rgba('#ffffff', 0.16), width: H * 0.01},
    {points: [[cx + shoulderHalf * 0.42, shoulderY + H * 0.1], [cx + hemHalf * 0.34, hemY - H * 0.02]], color: rgba(PAL.creamDeep, 0.32), width: H * 0.012},
    {points: [[cx + shoulderHalf * 0.78, shoulderY + H * 0.06], [cx + hemHalf * 0.8, hemY - H * 0.02]], color: rgba(PAL.creamDeep, 0.24), width: H * 0.008},
    {points: [[cx + shoulderHalf * 0.95, shoulderY + H * 0.1], [cx + hemHalf * 0.95, hemY - H * 0.02]], color: rgba('#000000', 0.12), width: H * 0.016},
  ]);

  // Open front placket and buttons.
  ctx.save();
  coatPath();
  ctx.clip();
  ctx.strokeStyle = rgba(PAL.creamDeep, 0.55);
  ctx.lineWidth = H * 0.006;
  ctx.beginPath();
  ctx.moveTo(cx - H * 0.012, shoulderY + H * 0.08);
  ctx.lineTo(cx - H * 0.028, hemY);
  ctx.stroke();
  ctx.strokeStyle = rgba('#ffffff', 0.22);
  ctx.lineWidth = H * 0.004;
  ctx.beginPath();
  ctx.moveTo(cx - H * 0.006, shoulderY + H * 0.08);
  ctx.lineTo(cx - H * 0.018, hemY);
  ctx.stroke();
  for (let button = 0; button < 4; button += 1) {
    const by = shoulderY + H * (0.14 + button * 0.12);
    ctx.fillStyle = rgba('#6b5c46', 0.75);
    ctx.beginPath();
    ctx.arc(cx + H * 0.012, by, H * 0.007, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = rgba('#d8c9b0', 0.5);
    ctx.beginPath();
    ctx.arc(cx + H * 0.010, by - H * 0.002, H * 0.003, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  // Lapels.
  for (const side of [-1, 1] as const) {
    ctx.fillStyle = rgba(PAL.creamShade, 0.85);
    ctx.beginPath();
    ctx.moveTo(cx + side * H * 0.01, shoulderY + H * 0.015);
    ctx.lineTo(cx + side * H * 0.09, shoulderY + H * 0.05);
    ctx.lineTo(cx + side * H * 0.045, shoulderY + H * 0.19);
    ctx.lineTo(cx + side * H * 0.015, shoulderY + H * 0.1);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = rgba(PAL.creamDeep, 0.45);
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  // Umbrella, drawn behind the head and in front of the coat.
  drawUmbrella(ctx, {
    cx: cx + H * 0.03,
    canopyY: headTop - H * 0.12,
    radius: H * 0.27,
    shaftEndX: cx + H * 0.116,
    shaftEndY: shoulderY + H * 0.44,
  });

  // Left arm hangs; right arm bends up to the umbrella handle.
  const leftArmPath = (): void => {
    ctx.beginPath();
    ctx.moveTo(cx - shoulderHalf * 0.96, shoulderY + H * 0.02);
    ctx.quadraticCurveTo(cx - shoulderHalf * 1.16, shoulderY + H * 0.22, cx - H * 0.116, shoulderY + H * 0.44);
    ctx.lineTo(cx - H * 0.086, shoulderY + H * 0.44);
    ctx.quadraticCurveTo(cx - shoulderHalf * 0.86, shoulderY + H * 0.2, cx - shoulderHalf * 0.72, shoulderY + H * 0.05);
    ctx.closePath();
  };
  paint(
    ctx,
    leftArmPath,
    [[0, PAL.creamShade], [0.35, PAL.cream], [0.8, PAL.creamShade], [1, PAL.creamDeep]],
    cx - shoulderHalf,
    0,
    cx - shoulderHalf * 0.7,
    shoulderY + H * 0.46,
  );
  strokeInside(ctx, leftArmPath, [
    {
      points: [
        [cx - shoulderHalf * 1.02, shoulderY + H * 0.1],
        [cx - H * 0.112, shoulderY + H * 0.36],
      ],
      color: rgba(PAL.creamDeep, 0.38),
      width: H * 0.008,
    },
    {
      points: [
        [cx - H * 0.098, shoulderY + H * 0.08],
        [cx - H * 0.086, shoulderY + H * 0.42],
      ],
      color: rgba('#5a4f3d', 0.42),
      width: H * 0.012,
    },
  ]);

  const rightArmPath = (): void => {
    ctx.beginPath();
    ctx.moveTo(cx + shoulderHalf * 0.94, shoulderY + H * 0.02);
    ctx.quadraticCurveTo(cx + shoulderHalf * 1.2, shoulderY + H * 0.18, cx + H * 0.142, shoulderY + H * 0.28);
    ctx.quadraticCurveTo(cx + H * 0.132, shoulderY + H * 0.38, cx + H * 0.128, shoulderY + H * 0.44);
    ctx.lineTo(cx + H * 0.094, shoulderY + H * 0.44);
    ctx.quadraticCurveTo(cx + H * 0.1, shoulderY + H * 0.34, cx + H * 0.104, shoulderY + H * 0.27);
    ctx.quadraticCurveTo(cx + shoulderHalf * 0.86, shoulderY + H * 0.16, cx + shoulderHalf * 0.7, shoulderY + H * 0.05);
    ctx.closePath();
  };
  paint(
    ctx,
    rightArmPath,
    [[0, PAL.cream], [0.5, PAL.creamShade], [1, PAL.creamDeep]],
    0,
    shoulderY,
    0,
    shoulderY + H * 0.46,
  );
  strokeInside(ctx, rightArmPath, [
    {
      points: [
        [cx + H * 0.125, shoulderY + H * 0.1],
        [cx + H * 0.136, shoulderY + H * 0.3],
      ],
      color: rgba(PAL.creamDeep, 0.38),
      width: H * 0.01,
    },
  ]);

  // Cuffs.
  ctx.fillStyle = rgba(PAL.creamDeep, 0.85);
  ctx.fillRect(cx - H * 0.118, shoulderY + H * 0.41, H * 0.034, H * 0.016);
  ctx.fillRect(cx + H * 0.094, shoulderY + H * 0.41, H * 0.036, H * 0.016);

  // Hands: left relaxed, right gripping the shaft.
  hand(
    ctx,
    cx - H * 0.101,
    shoulderY + H * 0.45,
    H * 0.018,
    H * 0.026,
    PAL.skin,
    PAL.skinShade,
  );
  hand(
    ctx,
    cx + H * 0.112,
    shoulderY + H * 0.44,
    H * 0.017,
    H * 0.023,
    PAL.skin,
    PAL.skinShade,
  );

  // Scarf.
  const scarfY = headCy + headRy2 * 1.5;
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(cx, scarfY, H * 0.09, H * 0.038, 0, 0, Math.PI * 2);
  ctx.fillStyle = PAL.scarf;
  ctx.fill();
  const scarfGradient = linearGradient(ctx, cx - H * 0.09, 0, cx + H * 0.09, 0, [
    [0, PAL.scarfLight],
    [0.45, PAL.scarf],
    [1, PAL.scarfShade],
  ]);
  ctx.fillStyle = scarfGradient;
  ctx.fill();
  // Wrapped folds.
  for (let fold = 0; fold < 4; fold += 1) {
    ctx.strokeStyle = rgba(PAL.scarfShade, 0.55);
    ctx.lineWidth = H * 0.004;
    ctx.beginPath();
    ctx.ellipse(
      cx - H * 0.04 + fold * H * 0.028,
      scarfY - H * 0.004,
      H * 0.02,
      H * 0.032,
      0.2,
      Math.PI * 0.9,
      Math.PI * 1.9,
    );
    ctx.stroke();
  }
  // Tail.
  ctx.fillStyle = PAL.scarf;
  ctx.beginPath();
  ctx.moveTo(cx + H * 0.03, scarfY + H * 0.02);
  ctx.quadraticCurveTo(cx + H * 0.08, scarfY + H * 0.16, cx + H * 0.075, scarfY + H * 0.3);
  ctx.lineTo(cx + H * 0.035, scarfY + H * 0.29);
  ctx.quadraticCurveTo(cx + H * 0.035, scarfY + H * 0.14, cx + H * 0.005, scarfY + H * 0.02);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = rgba(PAL.scarfShade, 0.5);
  ctx.lineWidth = H * 0.003;
  ctx.beginPath();
  ctx.moveTo(cx + H * 0.058, scarfY + H * 0.04);
  ctx.lineTo(cx + H * 0.058, scarfY + H * 0.28);
  ctx.stroke();
  ctx.restore();

  // Head.
  drawHead(ctx, {
    cx,
    cy: headCy,
    scale: H * 0.00142,
    hairStyle: 'bob',
    look: 'down',
    lipTight: true,
    rimSide: 1,
  });

  // Coat rim light.
  rimStroke(
    ctx,
    [
      [cx + shoulderHalf * 0.98, shoulderY + H * 0.02],
      [cx + shoulderHalf * 1.1, shoulderY + H * 0.16],
      [cx + hemHalf * 0.92, hemY - H * 0.02],
    ],
    rgba('#ffe0b0', 0.28),
    H * 0.006,
  );
  // Shoulder highlight.
  rimStroke(
    ctx,
    [
      [cx - shoulderHalf * 0.8, shoulderY + H * 0.01],
      [cx - shoulderHalf * 0.2, shoulderY - H * 0.01],
      [cx + shoulderHalf * 0.5, shoulderY + H * 0.015],
    ],
    rgba('#fff6e4', 0.16),
    H * 0.012,
  );
};

export const drawCinematicMan = (ctx: Ctx, width: number, height: number): void => {
  const H = height * 0.86;
  const cx = width * 0.5;
  const groundY = height * 0.95;
  const headTop = groundY - H;
  const headRy = H * 0.076;
  const headCy = headTop + headRy * 1.08;
  const shoulderY = headCy + headRy * 1.15;
  const hipY = groundY - H * 0.44;
  const hemY = groundY - H * 0.42;
  const shoulderHalf = H * 0.13;
  const legWidth = H * 0.08;

  drawLegShadow(ctx, cx, groundY, width * 0.23);

  // Trousers.
  leg(ctx, cx - H * 0.07, hipY, groundY - H * 0.02, legWidth, PAL.trouser, PAL.trouserLight, PAL.trouserShade, false);
  leg(ctx, cx + H * 0.07, hipY, groundY - H * 0.02, legWidth, PAL.trouser, PAL.trouserLight, PAL.trouserShade, false);
  for (const side of [-1, 1] as const) {
    const sx = cx + side * H * 0.07;
    const ankleY = groundY - H * 0.02;
    ctx.fillStyle = PAL.boot;
    ctx.beginPath();
    ctx.moveTo(sx - legWidth * 0.58, ankleY - H * 0.03);
    ctx.lineTo(sx + legWidth * 0.58, ankleY - H * 0.03);
    ctx.lineTo(sx + legWidth * 0.66, ankleY + H * 0.022);
    ctx.quadraticCurveTo(sx + legWidth * 0.2, ankleY + H * 0.034, sx - legWidth * 0.62, ankleY + H * 0.026);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = rgba(PAL.bootLight, 0.6);
    ctx.fillRect(sx - legWidth * 0.58, ankleY - H * 0.03, legWidth * 1.16, H * 0.004);
  }
  // Trouser creases.
  for (const side of [-1, 1] as const) {
    const sx = cx + side * H * 0.07;
    ctx.strokeStyle = rgba('#000000', 0.28);
    ctx.lineWidth = H * 0.004;
    ctx.beginPath();
    ctx.moveTo(sx - H * 0.012, hipY + H * 0.02);
    ctx.lineTo(sx - H * 0.016, groundY - H * 0.04);
    ctx.stroke();
    ctx.strokeStyle = rgba(PAL.trouserLight, 0.4);
    ctx.beginPath();
    ctx.moveTo(sx + H * 0.012, hipY + H * 0.02);
    ctx.lineTo(sx + H * 0.014, groundY - H * 0.04);
    ctx.stroke();
  }

  // Jacket.
  const jacketPath = (): void => {
    ctx.beginPath();
    ctx.moveTo(cx - shoulderHalf, shoulderY);
    ctx.quadraticCurveTo(cx - shoulderHalf * 1.05, shoulderY + H * 0.08, cx - shoulderHalf * 0.86, shoulderY + H * 0.24);
    ctx.quadraticCurveTo(cx - shoulderHalf * 0.9, shoulderY + H * 0.33, cx - shoulderHalf * 0.94, hemY);
    ctx.lineTo(cx + shoulderHalf * 0.94, hemY);
    ctx.quadraticCurveTo(cx + shoulderHalf * 0.9, shoulderY + H * 0.33, cx + shoulderHalf * 0.86, shoulderY + H * 0.24);
    ctx.quadraticCurveTo(cx + shoulderHalf * 1.05, shoulderY + H * 0.08, cx + shoulderHalf, shoulderY);
    ctx.quadraticCurveTo(cx, shoulderY - H * 0.04, cx - shoulderHalf, shoulderY);
    ctx.closePath();
  };
  paint(
    ctx,
    jacketPath,
    [[0, PAL.oliveLight], [0.3, PAL.olive], [0.85, PAL.oliveShade], [1, PAL.oliveDeep]],
    cx - shoulderHalf,
    shoulderY,
    cx + shoulderHalf,
    hemY,
  );
  strokeInside(ctx, jacketPath, [
    {points: [[cx - shoulderHalf * 0.9, shoulderY + H * 0.06], [cx - shoulderHalf * 0.96, hemY - H * 0.02]], color: rgba('#000000', 0.18), width: H * 0.012},
    {points: [[cx - shoulderHalf * 0.5, shoulderY + H * 0.12], [cx - shoulderHalf * 0.4, hemY - H * 0.04]], color: rgba(PAL.oliveLight, 0.28), width: H * 0.008},
    {points: [[cx + shoulderHalf * 0.3, shoulderY + H * 0.1], [cx + shoulderHalf * 0.24, hemY - H * 0.02]], color: rgba(PAL.oliveShade, 0.4), width: H * 0.014},
    {points: [[cx + shoulderHalf * 0.8, shoulderY + H * 0.08], [cx + shoulderHalf * 0.78, hemY - H * 0.02]], color: rgba('#000000', 0.22), width: H * 0.018},
  ]);

  // Open front: dark shirt and belt.
  ctx.save();
  jacketPath();
  ctx.clip();
  const shirt = linearGradient(ctx, cx - H * 0.05, 0, cx + H * 0.05, 0, [
    [0, '#232b36'],
    [1, '#0e141c'],
  ]);
  ctx.fillStyle = shirt;
  ctx.beginPath();
  ctx.moveTo(cx - H * 0.055, shoulderY + H * 0.02);
  ctx.lineTo(cx + H * 0.055, shoulderY + H * 0.02);
  ctx.lineTo(cx + H * 0.02, hemY - H * 0.02);
  ctx.lineTo(cx - H * 0.02, hemY - H * 0.02);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = rgba('#0a0d12', 0.9);
  ctx.fillRect(cx - H * 0.06, hemY - H * 0.07, H * 0.12, H * 0.022);
  ctx.fillStyle = rgba('#8f7a4e', 0.55);
  ctx.fillRect(cx - H * 0.014, hemY - H * 0.072, H * 0.028, H * 0.024);
  ctx.restore();

  // Lapels with a strong graphic edge.
  for (const side of [-1, 1] as const) {
    ctx.fillStyle = rgba(PAL.oliveShade, 0.9);
    ctx.beginPath();
    ctx.moveTo(cx + side * H * 0.01, shoulderY + H * 0.01);
    ctx.lineTo(cx + side * H * 0.095, shoulderY + H * 0.06);
    ctx.lineTo(cx + side * H * 0.055, shoulderY + H * 0.2);
    ctx.lineTo(cx + side * H * 0.012, shoulderY + H * 0.09);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = rgba('#0c1008', 0.55);
    ctx.lineWidth = 1.6;
    ctx.stroke();
  }

  // Arms with hands in pockets, painted over the jacket so the silhouette
  // keeps a readable limb.
  for (const side of [-1, 1] as const) {
    const armPath = (): void => {
      ctx.beginPath();
      ctx.moveTo(cx + side * shoulderHalf * 0.9, shoulderY + H * 0.02);
      ctx.quadraticCurveTo(
        cx + side * shoulderHalf * 1.16,
        shoulderY + H * 0.2,
        cx + side * shoulderHalf * 1.0,
        shoulderY + H * 0.38,
      );
      ctx.lineTo(cx + side * shoulderHalf * 0.78, shoulderY + H * 0.37);
      ctx.quadraticCurveTo(
        cx + side * shoulderHalf * 0.82,
        shoulderY + H * 0.18,
        cx + side * shoulderHalf * 0.68,
        shoulderY + H * 0.05,
      );
      ctx.closePath();
    };
    paint(
      ctx,
      armPath,
      [[0, PAL.oliveLight], [0.45, PAL.olive], [1, PAL.oliveDeep]],
      cx + side * shoulderHalf,
      shoulderY,
      cx + side * shoulderHalf,
      shoulderY + H * 0.38,
    );
    strokeInside(ctx, armPath, [
      {
        points: [
          [cx + side * shoulderHalf * 1.04, shoulderY + H * 0.1],
          [cx + side * shoulderHalf * 0.98, shoulderY + H * 0.32],
        ],
        color: rgba('#000000', 0.26),
        width: H * 0.012,
      },
      {
        points: [
          [cx + side * shoulderHalf * 0.8, shoulderY + H * 0.08],
          [cx + side * shoulderHalf * 0.76, shoulderY + H * 0.34],
        ],
        color: rgba(PAL.oliveLight, 0.3),
        width: H * 0.008,
      },
    ]);
    // Pocket line and a hint of the hand.
    ctx.strokeStyle = rgba('#0b1008', 0.55);
    ctx.lineWidth = H * 0.005;
    ctx.beginPath();
    ctx.moveTo(cx + side * shoulderHalf * 0.82, shoulderY + H * 0.3);
    ctx.lineTo(cx + side * shoulderHalf * 1.02, shoulderY + H * 0.31);
    ctx.stroke();
    ctx.fillStyle = rgba('#1b1c18', 0.5);
    ctx.beginPath();
    ctx.ellipse(
      cx + side * shoulderHalf * 0.96,
      shoulderY + H * 0.365,
      H * 0.016,
      H * 0.01,
      0,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }

  // Neck and head.
  drawHead(ctx, {
    cx,
    cy: headCy,
    scale: H * 0.00136,
    hairStyle: 'short',
    look: 'away',
    rimSide: 1,
  });

  // Collar.
  ctx.fillStyle = rgba(PAL.oliveShade, 0.95);
  ctx.beginPath();
  ctx.moveTo(cx - H * 0.075, shoulderY - H * 0.005);
  ctx.quadraticCurveTo(cx, shoulderY - H * 0.05, cx + H * 0.075, shoulderY - H * 0.005);
  ctx.lineTo(cx + H * 0.05, shoulderY + H * 0.035);
  ctx.quadraticCurveTo(cx, shoulderY - H * 0.005, cx - H * 0.05, shoulderY + H * 0.035);
  ctx.closePath();
  ctx.fill();

  rimStroke(
    ctx,
    [
      [cx + shoulderHalf * 0.99, shoulderY + H * 0.02],
      [cx + shoulderHalf * 1.03, shoulderY + H * 0.14],
      [cx + shoulderHalf * 0.98, hemY - H * 0.02],
    ],
    rgba('#ffe0b0', 0.22),
    H * 0.006,
  );
};

export const drawCinematicWomanCloseup = (ctx: Ctx, width: number, height: number): void => {
  const cx = width * 0.5;
  const cy = height * 0.44;
  const rx = width * 0.152;
  const ry = height * 0.19;

  // Defocused practicals behind the subject.
  glow(ctx, width * 0.74, height * 0.2, height * 0.36, '#6fd0cc', 0.1);
  glow(ctx, width * 0.24, height * 0.38, height * 0.3, '#e29a4a', 0.12);

  // Hair mass behind the head and shoulders.
  const hairBack = (): void => {
    ctx.beginPath();
    ctx.moveTo(cx - rx * 1.5, cy + ry * 1.05);
    ctx.quadraticCurveTo(cx - rx * 1.62, cy - ry * 0.5, cx - rx * 1.0, cy - ry * 1.20);
    ctx.quadraticCurveTo(cx, cy - ry * 1.62, cx + rx * 1.0, cy - ry * 1.20);
    ctx.quadraticCurveTo(cx + rx * 1.62, cy - ry * 0.5, cx + rx * 1.5, cy + ry * 1.05);
    ctx.quadraticCurveTo(cx, cy + ry * 1.3, cx - rx * 1.5, cy + ry * 1.05);
    ctx.closePath();
  };
  paint(
    ctx,
    hairBack,
    [[0, '#191a22'], [0.35, PAL.hair], [1, '#07080c']],
    cx - rx,
    cy - ry * 1.4,
    cx + rx,
    cy + ry,
  );

  // Shoulders and coat.
  const coat = linearGradient(ctx, 0, height * 0.72, width, height, [
    [0, PAL.creamLight],
    [0.4, PAL.cream],
    [1, PAL.creamShade],
  ]);
  ctx.fillStyle = coat;
  ctx.beginPath();
  ctx.moveTo(-width * 0.04, height * 1.02);
  ctx.quadraticCurveTo(cx - width * 0.24, height * 0.74, cx - width * 0.2, height * 0.66);
  ctx.lineTo(cx + width * 0.22, height * 0.66);
  ctx.quadraticCurveTo(cx + width * 0.3, height * 0.78, width * 1.04, height * 1.02);
  ctx.closePath();
  ctx.fill();
  for (let fold = 0; fold < 6; fold += 1) {
    const x = cx - width * 0.24 + fold * width * 0.095;
    ctx.strokeStyle = rgba(PAL.creamDeep, 0.26 + (fold % 2) * 0.12);
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(x, height * 0.7);
    ctx.quadraticCurveTo(x - width * 0.02, height * 0.86, x - width * 0.04, height * 1.0);
    ctx.stroke();
  }

  // Neck, shaded under the jaw.
  const neck = linearGradient(ctx, cx - rx * 0.4, 0, cx + rx * 0.4, 0, [
    [0, PAL.skinShade],
    [0.45, PAL.skin],
    [1, PAL.skinDeep],
  ]);
  ctx.fillStyle = neck;
  ctx.beginPath();
  ctx.moveTo(cx - rx * 0.36, cy + ry * 0.72);
  ctx.lineTo(cx + rx * 0.36, cy + ry * 0.72);
  ctx.lineTo(cx + rx * 0.46, height * 0.71);
  ctx.lineTo(cx - rx * 0.46, height * 0.71);
  ctx.closePath();
  ctx.fill();
  const jawShadow = ctx.createLinearGradient(0, cy + ry * 0.68, 0, cy + ry * 1.1);
  jawShadow.addColorStop(0, rgba(PAL.skinDeep, 0.55));
  jawShadow.addColorStop(1, rgba(PAL.skinDeep, 0));
  ctx.fillStyle = jawShadow;
  ctx.fillRect(cx - rx * 0.5, cy + ry * 0.68, rx, ry * 0.5);

  // Scarf.
  const scarf = linearGradient(ctx, cx - width * 0.24, 0, cx + width * 0.24, 0, [
    [0, PAL.scarfLight],
    [0.45, PAL.scarf],
    [1, PAL.scarfShade],
  ]);
  ctx.fillStyle = scarf;
  ctx.beginPath();
  ctx.ellipse(cx, height * 0.695, width * 0.245, height * 0.068, 0, 0, Math.PI * 2);
  ctx.fill();
  // Wrapped band folds.
  for (let fold = 0; fold < 2; fold += 1) {
    ctx.strokeStyle = rgba(PAL.scarfShade, 0.5);
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.ellipse(
      cx,
      height * (0.686 + fold * 0.023),
      width * 0.228,
      height * 0.048,
      0,
      Math.PI * 0.04,
      Math.PI * 0.96,
    );
    ctx.stroke();
  }
  // Tail hanging over the coat.
  ctx.fillStyle = PAL.scarfShade;
  ctx.beginPath();
  ctx.moveTo(cx + width * 0.06, height * 0.72);
  ctx.quadraticCurveTo(cx + width * 0.13, height * 0.82, cx + width * 0.1, height * 0.95);
  ctx.lineTo(cx + width * 0.04, height * 0.945);
  ctx.quadraticCurveTo(cx + width * 0.06, height * 0.82, cx + width * 0.005, height * 0.72);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = rgba(PAL.scarfLight, 0.35);
  ctx.beginPath();
  ctx.moveTo(cx + width * 0.02, height * 0.72);
  ctx.quadraticCurveTo(cx + width * 0.055, height * 0.82, cx + width * 0.048, height * 0.94);
  ctx.lineTo(cx + width * 0.038, height * 0.938);
  ctx.quadraticCurveTo(cx + width * 0.045, height * 0.82, cx + width * 0.012, height * 0.72);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = rgba('#5f1f26', 0.6);
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(cx + width * 0.085, height * 0.74);
  ctx.quadraticCurveTo(cx + width * 0.1, height * 0.85, cx + width * 0.086, height * 0.935);
  ctx.stroke();

  // Face.
  const facePath = (): void => {
    ctx.beginPath();
    ctx.moveTo(cx - rx, cy - ry * 0.5);
    ctx.quadraticCurveTo(cx - rx * 1.02, cy + ry * 0.12, cx - rx * 0.82, cy + ry * 0.52);
    ctx.quadraticCurveTo(cx - rx * 0.44, cy + ry * 0.98, cx, cy + ry * 1.02);
    ctx.quadraticCurveTo(cx + rx * 0.44, cy + ry * 0.98, cx + rx * 0.82, cy + ry * 0.52);
    ctx.quadraticCurveTo(cx + rx * 1.02, cy + ry * 0.12, cx + rx, cy - ry * 0.5);
    ctx.quadraticCurveTo(cx, cy - ry * 1.04, cx - rx, cy - ry * 0.5);
    ctx.closePath();
  };
  paint(
    ctx,
    facePath,
    [[0, PAL.skinLight], [0.42, PAL.skin], [1, PAL.skinShade]],
    cx - rx,
    cy - ry,
    cx + rx,
    cy + ry,
  );
  strokeInside(ctx, facePath, [
    {
      points: [
        [cx + rx * 0.8, cy + ry * 0.3],
        [cx + rx * 0.6, cy + ry * 0.7],
        [cx + rx * 0.28, cy + ry * 0.96],
      ],
      color: rgba(PAL.skinShade, 0.4),
      width: rx * 0.16,
    },
    {
      points: [
        [cx - rx * 0.86, cy - ry * 0.3],
        [cx - rx * 0.8, cy + ry * 0.1],
      ],
      color: rgba(PAL.skinShade, 0.3),
      width: rx * 0.12,
    },
  ]);
  const blush = ctx.createRadialGradient(
    cx - rx * 0.55,
    cy + ry * 0.35,
    0,
    cx - rx * 0.55,
    cy + ry * 0.35,
    rx * 0.6,
  );
  blush.addColorStop(0, rgba('#c8615a', 0.16));
  blush.addColorStop(1, rgba('#c8615a', 0));
  ctx.fillStyle = blush;
  ctx.fillRect(cx - rx, cy, rx * 2, ry * 1.1);

  // Fringe: swept diagonally across the forehead, clipped to the face.
  ctx.save();
  facePath();
  ctx.clip();
  ctx.fillStyle = PAL.hair;
  ctx.beginPath();
  ctx.moveTo(cx - rx * 1.08, cy - ry * 0.85);
  ctx.lineTo(cx + rx * 1.08, cy - ry * 0.85);
  ctx.lineTo(cx + rx * 1.08, cy - ry * 0.2);
  ctx.quadraticCurveTo(cx + rx * 0.24, cy - ry * 0.3, cx - rx * 0.16, cy - ry * 0.46);
  ctx.quadraticCurveTo(cx - rx * 0.56, cy - ry * 0.62, cx - rx * 1.08, cy - ry * 0.34);
  ctx.closePath();
  ctx.fill();
  // Hair strand highlights.
  for (let strand = 0; strand < 6; strand += 1) {
    ctx.strokeStyle = rgba(PAL.hairLight, 0.2 - strand * 0.025);
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(cx - rx * 0.9 + strand * rx * 0.3, cy - ry * 0.8);
    ctx.quadraticCurveTo(
      cx - rx * 0.7 + strand * rx * 0.3,
      cy - ry * 0.6,
      cx - rx * 0.5 + strand * rx * 0.28,
      cy - ry * 0.36,
    );
    ctx.stroke();
  }
  ctx.restore();

  // Side locks outside the face.
  for (const side of [-1, 1] as const) {
    const lock = ctx.createLinearGradient(cx + side * rx * 1.2, 0, cx + side * rx * 0.9, 0);
    lock.addColorStop(0, side === 1 ? '#07080c' : '#14151c');
    lock.addColorStop(1, PAL.hair);
    ctx.fillStyle = lock;
    ctx.beginPath();
    ctx.moveTo(cx + side * rx * 1.04, cy - ry * 0.72);
    ctx.quadraticCurveTo(cx + side * rx * 1.3, cy - ry * 0.1, cx + side * rx * 1.14, cy + ry * 0.86);
    ctx.quadraticCurveTo(cx + side * rx * 0.96, cy + ry * 0.1, cx + side * rx * 0.94, cy - ry * 0.66);
    ctx.closePath();
    ctx.fill();
  }

  // Eyes.
  const eyeY = cy + ry * 0.06;
  for (const side of [-1, 1] as const) {
    const ex = cx + side * rx * 0.38 - rx * 0.04;
    const eyeW = rx * 0.26;
    const eyeH = ry * 0.11;
    // Eye socket shadow.
    const socket = ctx.createRadialGradient(ex, eyeY - eyeH * 0.2, 0, ex, eyeY, eyeW * 1.3);
    socket.addColorStop(0, rgba(PAL.skinDeep, 0.22));
    socket.addColorStop(1, rgba(PAL.skinDeep, 0));
    ctx.fillStyle = socket;
    ctx.fillRect(ex - eyeW, eyeY - eyeH, eyeW * 2, eyeH * 2);
    // Sclera.
    ctx.fillStyle = '#f6ece0';
    ctx.beginPath();
    ctx.ellipse(ex, eyeY, eyeW, eyeH, side * 0.06, 0, Math.PI * 2);
    ctx.fill();
    // Iris.
    const iris = ctx.createRadialGradient(ex, eyeY, 0, ex, eyeY, eyeH * 1.15);
    iris.addColorStop(0, '#5a3b2a');
    iris.addColorStop(1, '#1c1210');
    ctx.fillStyle = iris;
    ctx.beginPath();
    ctx.ellipse(ex - side * eyeW * 0.08, eyeY + eyeH * 0.05, eyeH * 0.85, eyeH * 0.95, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#08070a';
    ctx.beginPath();
    ctx.ellipse(ex - side * eyeW * 0.08, eyeY + eyeH * 0.06, eyeH * 0.4, eyeH * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = rgba('#fffaf2', 0.95);
    ctx.beginPath();
    ctx.arc(ex - side * eyeW * 0.2, eyeY - eyeH * 0.34, eyeH * 0.2, 0, Math.PI * 2);
    ctx.fill();
    // Lid line.
    ctx.strokeStyle = rgba('#241512', 0.9);
    ctx.lineWidth = rx * 0.014;
    ctx.beginPath();
    ctx.moveTo(ex - eyeW * 1.02, eyeY - eyeH * 0.1);
    ctx.quadraticCurveTo(ex, eyeY - eyeH * 1.42, ex + eyeW * 1.02, eyeY - eyeH * 0.04);
    ctx.stroke();
    // Lower lid.
    ctx.strokeStyle = rgba(PAL.skinDeep, 0.5);
    ctx.lineWidth = rx * 0.008;
    ctx.beginPath();
    ctx.moveTo(ex - eyeW * 0.95, eyeY + eyeH * 1.05);
    ctx.quadraticCurveTo(ex, eyeY + eyeH * 1.35, ex + eyeW * 0.95, eyeY + eyeH * 1.0);
    ctx.stroke();
    // Lashes.
    for (let lash = 0; lash < 4; lash += 1) {
      ctx.strokeStyle = rgba('#241512', 0.8);
      ctx.lineWidth = rx * 0.007;
      ctx.beginPath();
      ctx.moveTo(ex + side * eyeW * (0.75 + lash * 0.08), eyeY - eyeH * (0.5 + lash * 0.12));
      ctx.lineTo(ex + side * eyeW * (0.88 + lash * 0.1), eyeY - eyeH * (0.95 + lash * 0.16));
      ctx.stroke();
    }
  }

  // Brows: inner raised, outer soft.
  for (const side of [-1, 1] as const) {
    ctx.strokeStyle = rgba('#2a1a17', 0.85);
    ctx.lineWidth = rx * 0.022;
    ctx.beginPath();
    ctx.moveTo(cx + side * rx * 0.68, eyeY - ry * 0.28);
    ctx.quadraticCurveTo(
      cx + side * rx * 0.46,
      eyeY - ry * 0.4,
      cx + side * rx * 0.2,
      eyeY - ry * 0.34,
    );
    ctx.stroke();
  }

  // Nose.
  ctx.strokeStyle = rgba(PAL.skinShade, 0.45);
  ctx.lineWidth = rx * 0.03;
  ctx.beginPath();
  ctx.moveTo(cx - rx * 0.04, eyeY + ry * 0.06);
  ctx.quadraticCurveTo(cx - rx * 0.08, eyeY + ry * 0.24, cx - rx * 0.16, eyeY + ry * 0.28);
  ctx.stroke();
  ctx.strokeStyle = rgba(PAL.skinLight, 0.55);
  ctx.lineWidth = rx * 0.018;
  ctx.beginPath();
  ctx.moveTo(cx + rx * 0.06, eyeY + ry * 0.02);
  ctx.lineTo(cx + rx * 0.03, eyeY + ry * 0.2);
  ctx.stroke();

  // Lips.
  const lipY = eyeY + ry * 0.52;
  ctx.fillStyle = rgba('#9c4a4c', 0.75);
  ctx.beginPath();
  ctx.moveTo(cx - rx * 0.26, lipY);
  ctx.quadraticCurveTo(cx - rx * 0.12, lipY - ry * 0.05, cx, lipY - ry * 0.01);
  ctx.quadraticCurveTo(cx + rx * 0.12, lipY - ry * 0.05, cx + rx * 0.24, lipY + ry * 0.01);
  ctx.quadraticCurveTo(cx, lipY + ry * 0.07, cx - rx * 0.26, lipY);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = rgba('#6d2f33', 0.9);
  ctx.lineWidth = rx * 0.012;
  ctx.beginPath();
  ctx.moveTo(cx - rx * 0.24, lipY);
  ctx.quadraticCurveTo(cx, lipY + ry * 0.018, cx + rx * 0.23, lipY);
  ctx.stroke();
  ctx.strokeStyle = rgba('#e8b6ac', 0.4);
  ctx.lineWidth = rx * 0.008;
  ctx.beginPath();
  ctx.moveTo(cx - rx * 0.1, lipY + ry * 0.03);
  ctx.quadraticCurveTo(cx, lipY + ry * 0.045, cx + rx * 0.1, lipY + ry * 0.028);
  ctx.stroke();

  // Tear on the right cheek.
  const tearX = cx + rx * 0.42;
  const tearY = eyeY + ry * 0.16;
  const tearGradient = linearGradient(ctx, 0, tearY, 0, tearY + ry * 0.22, [
    [0, rgba('#e9f8ff', 0.95)],
    [1, rgba('#9fd0e4', 0.45)],
  ]);
  ctx.fillStyle = tearGradient;
  ctx.beginPath();
  ctx.ellipse(tearX, tearY + ry * 0.1, rx * 0.024, ry * 0.08, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = rgba('#ffffff', 0.9);
  ctx.beginPath();
  ctx.arc(tearX - rx * 0.008, tearY + ry * 0.05, rx * 0.01, 0, Math.PI * 2);
  ctx.fill();

  // Rim light.
  ctx.strokeStyle = rgba('#9fd6e2', 0.3);
  ctx.lineWidth = width * 0.012;
  ctx.beginPath();
  ctx.moveTo(cx - rx * 1.0, cy - ry * 0.4);
  ctx.quadraticCurveTo(cx - rx * 1.08, cy + ry * 0.2, cx - rx * 0.7, cy + ry * 0.8);
  ctx.stroke();
  ctx.strokeStyle = rgba('#ffd9a0', 0.22);
  ctx.lineWidth = width * 0.008;
  ctx.beginPath();
  ctx.moveTo(cx + rx * 1.15, cy - ry * 0.8);
  ctx.quadraticCurveTo(cx + rx * 1.4, cy - ry * 0.1, cx + rx * 1.1, cy + ry * 0.9);
  ctx.stroke();

  // Grain.
  ctx.fillStyle = rgba('#e9e3d2', 0.028);
  for (let index = 0; index < 2600; index += 1) {
    ctx.fillRect(Math.floor(hash(index * 1.7) * width), Math.floor(hash(index * 2.3) * height), 1, 1);
  }
};

export const drawCinematicTram = (ctx: Ctx, width: number, height: number): void => {
  const bodyX = width * 0.02;
  const bodyY = height * 0.15;
  const bodyW = width * 0.96;
  const bodyH = height * 0.62;

  // Pantograph.
  ctx.strokeStyle = rgba('#0a141c', 0.9);
  ctx.lineWidth = width * 0.004;
  ctx.beginPath();
  ctx.moveTo(width * 0.48, bodyY);
  ctx.lineTo(width * 0.42, bodyY - height * 0.11);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(width * 0.56, bodyY);
  ctx.lineTo(width * 0.62, bodyY - height * 0.11);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(width * 0.42, bodyY - height * 0.11);
  ctx.lineTo(width * 0.62, bodyY - height * 0.11);
  ctx.stroke();
  ctx.strokeStyle = rgba('#8fa8b8', 0.2);
  ctx.lineWidth = width * 0.0012;
  ctx.beginPath();
  ctx.moveTo(width * 0.48, bodyY - 2);
  ctx.lineTo(width * 0.42, bodyY - height * 0.108);
  ctx.stroke();

  // Roof and body shell with a front taper.
  const shell = (): void => {
    ctx.beginPath();
    ctx.moveTo(bodyX + bodyW * 0.02, bodyY + bodyH * 0.08);
    ctx.quadraticCurveTo(bodyX + bodyW * 0.02, bodyY, bodyX + bodyW * 0.08, bodyY);
    ctx.lineTo(bodyX + bodyW * 0.9, bodyY);
    ctx.quadraticCurveTo(bodyX + bodyW * 0.99, bodyY + bodyH * 0.05, bodyX + bodyW * 0.99, bodyY + bodyH * 0.2);
    ctx.lineTo(bodyX + bodyW * 0.99, bodyY + bodyH * 0.84);
    ctx.quadraticCurveTo(bodyX + bodyW * 0.99, bodyY + bodyH, bodyX + bodyW * 0.9, bodyY + bodyH);
    ctx.lineTo(bodyX + bodyW * 0.06, bodyY + bodyH);
    ctx.quadraticCurveTo(bodyX + bodyW * 0.01, bodyY + bodyH, bodyX + bodyW * 0.012, bodyY + bodyH * 0.86);
    ctx.closePath();
  };
  paint(
    ctx,
    shell,
    [[0, '#2f5568'], [0.16, '#1d3d4e'], [0.55, '#122b39'], [1, '#0a1a24']],
    0,
    bodyY,
    0,
    bodyY + bodyH,
  );
  strokeInside(ctx, shell, [
    {points: [[bodyX + bodyW * 0.02, bodyY + bodyH * 0.1], [bodyX + bodyW * 0.01, bodyY + bodyH * 0.9]], color: rgba('#000000', 0.3), width: width * 0.02},
    {points: [[bodyX + bodyW * 0.94, bodyY + bodyH * 0.05], [bodyX + bodyW * 0.95, bodyY + bodyH * 0.95]], color: rgba('#000000', 0.25), width: width * 0.03},
    {points: [[bodyX + bodyW * 0.3, bodyY + bodyH * 0.82], [bodyX + bodyW * 0.74, bodyY + bodyH * 0.82]], color: rgba('#8fc2d2', 0.08), width: height * 0.02},
  ]);
  ctx.strokeStyle = rgba('#8fc2d2', 0.22);
  ctx.lineWidth = 2;
  shell();
  ctx.stroke();

  // Roof wet highlight.
  const roofLight = linearGradient(ctx, 0, bodyY, 0, bodyY + bodyH * 0.05, [
    [0, rgba('#e6f5fb', 0.55)],
    [1, rgba('#e6f5fb', 0)],
  ]);
  ctx.fillStyle = roofLight;
  ctx.fillRect(bodyX + bodyW * 0.08, bodyY, bodyW * 0.82, bodyH * 0.05);

  // Window band.
  const windowY = bodyY + bodyH * 0.14;
  const windowH = bodyH * 0.34;
  const count = 6;
  const pad = bodyW * 0.035;
  const gap = bodyW * 0.012;
  const windowW = (bodyW - pad * 2 - gap * (count - 1)) / count;
  for (let index = 0; index < count; index += 1) {
    const x = bodyX + pad + index * (windowW + gap);
    // Interior light.
    const interior = linearGradient(ctx, 0, windowY, 0, windowY + windowH, [
      [0, rgba('#ffe9bd', 0.98)],
      [0.55, rgba('#e8ab63', 0.9)],
      [1, rgba('#9d6036', 0.75)],
    ]);
    ctx.fillStyle = interior;
    roundRect(ctx, x, windowY, windowW, windowH, height * 0.016);
    ctx.fill();
    // Seat rows and passengers as soft silhouettes.
    ctx.fillStyle = rgba('#3c2a22', 0.32);
    for (let rider = 0; rider < 2; rider += 1) {
      const rx = x + windowW * (0.22 + rider * 0.42);
      ctx.beginPath();
      ctx.ellipse(rx, windowY + windowH * 0.34, windowW * 0.07, windowH * 0.12, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(rx, windowY + windowH * 0.72, windowW * 0.12, windowH * 0.28, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    // Glass reflection: a diagonal sheet.
    ctx.save();
    roundRect(ctx, x, windowY, windowW, windowH, height * 0.016);
    ctx.clip();
    ctx.fillStyle = rgba('#dff4ff', 0.1);
    ctx.beginPath();
    ctx.moveTo(x - windowW * 0.2, windowY + windowH);
    ctx.lineTo(x + windowW * 0.5, windowY);
    ctx.lineTo(x + windowW * 0.72, windowY);
    ctx.lineTo(x + windowW * 0.04, windowY + windowH);
    ctx.closePath();
    ctx.fill();
    // Rain streaks.
    for (let streak = 0; streak < 3; streak += 1) {
      ctx.strokeStyle = rgba('#f4fbff', 0.14);
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(x + windowW * (0.18 + streak * 0.24), windowY + 2);
      ctx.lineTo(x + windowW * (0.15 + streak * 0.24), windowY + windowH - 2);
      ctx.stroke();
    }
    ctx.restore();
    // Window frame.
    ctx.strokeStyle = rgba('#061019', 0.92);
    ctx.lineWidth = Math.max(2, width * 0.0035);
    roundRect(ctx, x, windowY, windowW, windowH, height * 0.016);
    ctx.stroke();
    // Upper and lower frame highlights.
    ctx.strokeStyle = rgba('#a8d2e0', 0.18);
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(x + windowW * 0.08, windowY + 1);
    ctx.lineTo(x + windowW * 0.92, windowY + 1);
    ctx.stroke();
  }

  // Livery bands.
  ctx.fillStyle = rgba('#e2b06a', 0.55);
  ctx.fillRect(bodyX + bodyW * 0.01, bodyY + bodyH * 0.57, bodyW * 0.98, bodyH * 0.035);
  ctx.fillStyle = rgba('#b84753', 0.4);
  ctx.fillRect(bodyX + bodyW * 0.01, bodyY + bodyH * 0.615, bodyW * 0.98, bodyH * 0.018);
  ctx.fillStyle = rgba('#f3d9a4', 0.2);
  ctx.fillRect(bodyX + bodyW * 0.01, bodyY + bodyH * 0.57, bodyW * 0.98, 2);

  // Lower body panel seams.
  ctx.strokeStyle = rgba('#000000', 0.4);
  ctx.lineWidth = 2;
  for (let seam = 0; seam < 5; seam += 1) {
    const sx = bodyX + bodyW * (0.14 + seam * 0.17);
    ctx.beginPath();
    ctx.moveTo(sx, bodyY + bodyH * 0.66);
    ctx.lineTo(sx, bodyY + bodyH * 0.95);
    ctx.stroke();
  }

  // Doors.
  for (let door = 0; door < 2; door += 1) {
    const dx = bodyX + bodyW * (0.16 + door * 0.62);
    ctx.strokeStyle = rgba('#050d14', 0.9);
    ctx.lineWidth = Math.max(3, width * 0.005);
    ctx.beginPath();
    ctx.moveTo(dx, bodyY + bodyH * 0.5);
    ctx.lineTo(dx, bodyY + bodyH * 0.96);
    ctx.stroke();
    ctx.strokeStyle = rgba('#9cc4d2', 0.14);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(dx + 3, bodyY + bodyH * 0.5);
    ctx.lineTo(dx + 3, bodyY + bodyH * 0.96);
    ctx.stroke();
  }

  // Destination board.
  ctx.fillStyle = '#04101b';
  roundRect(ctx, bodyX + bodyW * 0.07, bodyY + bodyH * 0.035, bodyW * 0.22, bodyH * 0.07, height * 0.01);
  ctx.fill();
  ctx.strokeStyle = rgba('#6fd0cc', 0.4);
  ctx.lineWidth = 1.5;
  ctx.stroke();
  for (let glyph = 0; glyph < 3; glyph += 1) {
    ctx.fillStyle = rgba('#ffcf7a', 0.85);
    ctx.fillRect(
      bodyX + bodyW * 0.095 + glyph * bodyW * 0.062,
      bodyY + bodyH * 0.055,
      bodyW * 0.045,
      bodyH * 0.022,
    );
  }

  // Headlights and tail lamp.
  const headX = bodyX + bodyW * 0.965;
  const headY = bodyY + bodyH * 0.52;
  glow(ctx, headX, headY, height * 0.2, '#ffe9bc', 0.55);
  glow(ctx, headX, headY, height * 0.06, '#fff6de', 0.9);
  ctx.fillStyle = '#fffaf0';
  ctx.beginPath();
  ctx.arc(headX, headY, height * 0.032, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = rgba('#fff1cf', 0.6);
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(headX, headY, height * 0.05, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = rgba('#c04a45', 0.75);
  ctx.beginPath();
  ctx.arc(bodyX + bodyW * 0.03, headY + height * 0.08, height * 0.018, 0, Math.PI * 2);
  ctx.fill();

  // Bogies and wheels.
  for (const bogie of [0.18, 0.72]) {
    const bx = bodyX + bodyW * bogie;
    ctx.fillStyle = '#050b11';
    roundRect(ctx, bx - bodyW * 0.09, bodyY + bodyH * 0.82, bodyW * 0.18, bodyH * 0.13, height * 0.012);
    ctx.fill();
    ctx.strokeStyle = rgba('#7c96a6', 0.16);
    ctx.lineWidth = 1.4;
    roundRect(ctx, bx - bodyW * 0.09, bodyY + bodyH * 0.82, bodyW * 0.18, bodyH * 0.13, height * 0.012);
    ctx.stroke();
    for (const offset of [-0.045, 0.045]) {
      ctx.fillStyle = '#0a1016';
      ctx.beginPath();
      ctx.arc(bx + bodyW * offset, bodyY + bodyH * 0.97, height * 0.052, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = rgba('#9ab4c2', 0.2);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(bx + bodyW * offset, bodyY + bodyH * 0.97, height * 0.052, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = rgba('#5f7280', 0.35);
      ctx.beginPath();
      ctx.arc(bx + bodyW * offset, bodyY + bodyH * 0.97, height * 0.02, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Wet side reflections.
  for (let index = 0; index < 6; index += 1) {
    const rx = bodyX + bodyW * (0.1 + index * 0.16);
    ctx.fillStyle = rgba('#dff4ff', 0.05 + hash(index * 3.1) * 0.06);
    ctx.fillRect(rx, bodyY + bodyH * 0.66, bodyW * 0.012, bodyH * 0.28);
  }

  // Ground shadow and reflected glow.
  ctx.fillStyle = rgba('#000000', 0.45);
  ctx.beginPath();
  ctx.ellipse(width * 0.5, height * 0.95, width * 0.48, height * 0.035, 0, 0, Math.PI * 2);
  ctx.fill();
  glow(ctx, headX, height * 0.94, height * 0.1, '#ffe0b0', 0.25);
};
