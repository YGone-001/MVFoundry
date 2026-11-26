// Starter art plates for the editorial-motion-graphics style.
//
// Original procedural artwork generated offline by this repository. These are
// layout starters for 2.5D authoring, not art-directed production graphics.

import type {Ctx} from './shared';
import {rgba} from './shared';

const paper = '#f3efe6';
const ink = '#111111';
const coral = '#d97757';
const cobalt = '#2456d6';
const yellow = '#ffcf5c';
const gray = '#8a857b';

const grid = (ctx: Ctx, width: number, height: number, alpha: number): void => {
  ctx.save();
  ctx.strokeStyle = rgba(gray, alpha);
  ctx.lineWidth = Math.max(1, width * 0.0007);
  for (let column = 0; column <= 12; column += 1) {
    const x = (width / 12) * column;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
  ctx.restore();
};

export const drawEditorialGridBackground = (ctx: Ctx, width: number, height: number): void => {
  ctx.fillStyle = paper;
  ctx.fillRect(0, 0, width, height);
  grid(ctx, width, height, 0.25);

  ctx.fillStyle = cobalt;
  ctx.fillRect(width * 0.06, height * 0.1, width * 0.27, height * 0.33);
  ctx.fillStyle = yellow;
  ctx.fillRect(width * 0.35, height * 0.1, width * 0.17, height * 0.15);
  ctx.fillStyle = coral;
  ctx.fillRect(width * 0.54, height * 0.1, width * 0.38, height * 0.04);
  ctx.fillStyle = rgba(cobalt, 0.9);
  ctx.beginPath();
  ctx.moveTo(width * 0.7, height * 0.3);
  ctx.lineTo(width * 0.92, height * 0.3);
  ctx.lineTo(width * 0.92, height * 0.45);
  ctx.lineTo(width * 0.78, height * 0.45);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = rgba(ink, 0.5);
  ctx.lineWidth = Math.max(1, height * 0.002);
  ctx.beginPath();
  ctx.moveTo(0, height * 0.5);
  ctx.lineTo(width, height * 0.5);
  ctx.stroke();
};

export const drawEditorialCutoutMidground = (ctx: Ctx, width: number, height: number): void => {
  // Duotone character cutout as an image block, not an actor.
  ctx.fillStyle = coral;
  ctx.fillRect(width * 0.64, height * 0.58, width * 0.18, height * 0.24);
  ctx.fillStyle = ink;
  ctx.beginPath();
  ctx.arc(width * 0.73, height * 0.7, height * 0.05, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(width * 0.64, height * 0.6);
  ctx.lineTo(width * 0.64, height * 0.78);
  ctx.lineTo(width * 0.73, height * 0.7);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = rgba(cobalt, 0.22);
  ctx.fillRect(width * 0.08, height * 0.54, width * 0.3, height * 0.03);
};

export const drawEditorialGraphicsForeground = (ctx: Ctx, width: number, height: number): void => {
  for (let row = 0; row < 4; row += 1) {
    ctx.fillStyle = ink;
    ctx.fillRect(width * 0.06, height * (0.54 + row * 0.075), width * (0.5 - row * 0.07), height * 0.038);
  }

  ctx.strokeStyle = rgba(ink, 0.85);
  ctx.lineWidth = Math.max(1.5, height * 0.0025);
  ctx.beginPath();
  ctx.arc(width * 0.86, height * 0.72, height * 0.07, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = ink;
  ctx.beginPath();
  ctx.moveTo(width * 0.8, height * 0.62);
  ctx.lineTo(width * 0.8, height * 0.8);
  ctx.lineTo(width * 0.88, height * 0.71);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = ink;
  ctx.fillRect(width * 0.09, height * 0.82, width * 0.012, height * 0.09);
  ctx.strokeStyle = rgba(ink, 0.6);
  ctx.lineWidth = Math.max(1, height * 0.0018);
  ctx.beginPath();
  ctx.moveTo(width * 0.06, height * 0.9);
  ctx.lineTo(width * 0.94, height * 0.9);
  ctx.stroke();
};