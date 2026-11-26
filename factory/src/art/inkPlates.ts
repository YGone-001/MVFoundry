// Starter art plates for the ink-watercolour style.
//
// Original procedural artwork generated offline by this repository. These are
// honest starters for 2.5D authoring, not hand-painted production art and not an
// artistic approval.

import type {Ctx} from './shared';
import {hash, rgba} from './shared';

const paperTone = '#ece4d6';
const ink = '#2b2926';
const inkMid = '#6b655c';
const inkFar = '#9a9386';
const vermilion = '#b0392e';

export const drawInkPaperBackground = (ctx: Ctx, width: number, height: number): void => {
  ctx.fillStyle = paperTone;
  ctx.fillRect(0, 0, width, height);

  for (let band = 0; band < 6; band += 1) {
    ctx.fillStyle = rgba(inkFar, 0.04 + hash(band) * 0.05);
    ctx.fillRect(0, height * (0.12 + band * 0.14), width, height * (0.05 + hash(band + 2) * 0.06));
  }

  // Paper tooth: deterministic pin-prick grain, never animated noise.
  for (let index = 0; index < 2200; index += 1) {
    const x = hash(index * 1.7) * width;
    const y = hash(index * 2.9 + 4) * height;
    ctx.fillStyle = rgba(inkFar, 0.03 + hash(index) * 0.04);
    ctx.fillRect(x, y, 1.4, 1.4);
  }

  // A single low horizon and a tide stain keep the ground from reading as a flat wall.
  ctx.strokeStyle = rgba(inkMid, 0.22);
  ctx.lineWidth = Math.max(1, height * 0.0018);
  ctx.beginPath();
  ctx.moveTo(0, height * 0.68);
  ctx.lineTo(width, height * 0.68);
  ctx.stroke();
  ctx.fillStyle = rgba(inkFar, 0.06);
  ctx.beginPath();
  ctx.ellipse(width * 0.72, height * 0.86, width * 0.24, height * 0.05, 0, 0, Math.PI * 2);
  ctx.fill();
};

export const drawInkMidground = (ctx: Ctx, width: number, height: number): void => {
  const brush = (cx: number, cy: number, length: number, thickness: number, alpha: number): void => {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = ink;
    ctx.lineWidth = thickness;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx - length / 2, cy);
    ctx.quadraticCurveTo(cx, cy - length * 0.2, cx + length / 2, cy + length * 0.04);
    ctx.stroke();
    ctx.restore();
  };
  brush(width * 0.42, height * 0.42, width * 0.34, height * 0.02, 0.78);
  brush(width * 0.54, height * 0.52, width * 0.24, height * 0.012, 0.55);
  brush(width * 0.36, height * 0.62, width * 0.18, height * 0.009, 0.42);

  ctx.save();
  ctx.globalAlpha = 0.08;
  ctx.fillStyle = inkFar;
  ctx.beginPath();
  ctx.ellipse(width * 0.62, height * 0.38, width * 0.2, height * 0.08, -0.15, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
};

export const drawInkForeground = (ctx: Ctx, width: number, height: number): void => {
  // Minimal figure: three brush strokes, not a detailed model.
  ctx.save();
  ctx.strokeStyle = ink;
  ctx.lineCap = 'round';
  ctx.globalAlpha = 0.8;
  ctx.lineWidth = height * 0.012;
  ctx.beginPath();
  ctx.moveTo(width * 0.24, height * 0.5);
  ctx.quadraticCurveTo(width * 0.21, height * 0.62, width * 0.25, height * 0.74);
  ctx.stroke();
  ctx.restore();
  ctx.fillStyle = rgba(ink, 0.82);
  ctx.beginPath();
  ctx.arc(width * 0.242, height * 0.47, height * 0.022, 0, Math.PI * 2);
  ctx.fill();

  // The single warm accent is a seal, not a light source.
  ctx.fillStyle = rgba(vermilion, 0.9);
  ctx.fillRect(width * 0.82, height * 0.72, width * 0.052, height * 0.072);
  ctx.fillStyle = rgba(paperTone, 0.9);
  ctx.fillRect(width * 0.835, height * 0.742, width * 0.016, height * 0.03);

  ctx.strokeStyle = rgba(ink, 0.35);
  ctx.lineWidth = height * 0.008;
  ctx.beginPath();
  ctx.moveTo(width * 0.08, height * 0.9);
  ctx.quadraticCurveTo(width * 0.28, height * 0.84, width * 0.48, height * 0.9);
  ctx.stroke();
};