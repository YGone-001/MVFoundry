// Starter art plates for the stylised-3d-diorama style.
//
// Original procedural artwork generated offline by this repository. This is an
// isometric Canvas illusion, not WebGL or real 3D, and not an artistic approval.

import type {Ctx} from './shared';
import {rgba} from './shared';

const night = '#0b1724';
const teal = '#1d4a5a';
const deepTeal = '#123441';
const lamp = '#f0a24a';
const cream = '#f5e6c8';
const umbrella = '#b84753';

export const drawDioramaStageBackground = (ctx: Ctx, width: number, height: number): void => {
  ctx.fillStyle = night;
  ctx.fillRect(0, 0, width, height);

  const vignette = ctx.createRadialGradient(
    width * 0.5,
    height * 0.46,
    height * 0.1,
    width * 0.5,
    height * 0.46,
    height * 0.65,
  );
  vignette.addColorStop(0, 'rgba(29,74,90,0.55)');
  vignette.addColorStop(1, 'rgba(4,9,14,0.96)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, width, height);

  const cx = width * 0.5;
  const top = height * 0.29;
  const bottom = height * 0.63;
  ctx.fillStyle = teal;
  ctx.beginPath();
  ctx.moveTo(cx, top);
  ctx.lineTo(width * 0.86, height * 0.46);
  ctx.lineTo(cx, bottom);
  ctx.lineTo(width * 0.14, height * 0.46);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = deepTeal;
  ctx.beginPath();
  ctx.moveTo(width * 0.14, height * 0.46);
  ctx.lineTo(cx, bottom);
  ctx.lineTo(cx, bottom + height * 0.13);
  ctx.lineTo(width * 0.14, height * 0.46 + height * 0.13);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#0e2935';
  ctx.beginPath();
  ctx.moveTo(cx, bottom);
  ctx.lineTo(width * 0.86, height * 0.46);
  ctx.lineTo(width * 0.86, height * 0.46 + height * 0.13);
  ctx.lineTo(cx, bottom + height * 0.13);
  ctx.closePath();
  ctx.fill();

  ctx.save();
  ctx.globalAlpha = 0.28;
  ctx.fillStyle = '#02060a';
  ctx.beginPath();
  ctx.ellipse(cx, bottom + height * 0.15, width * 0.28, height * 0.045, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
};

export const drawDioramaMidground = (ctx: Ctx, width: number, height: number): void => {
  const lampX = width * 0.38;
  const lampY = height * 0.34;
  const glow = ctx.createRadialGradient(lampX, lampY, 0, lampX, lampY, height * 0.18);
  glow.addColorStop(0, 'rgba(240,162,74,0.7)');
  glow.addColorStop(1, 'rgba(240,162,74,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(lampX - height * 0.2, lampY - height * 0.2, height * 0.4, height * 0.4);
  ctx.fillStyle = lamp;
  ctx.beginPath();
  ctx.arc(lampX, lampY, height * 0.018, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#0f2a36';
  ctx.fillRect(lampX - 2, lampY, 4, height * 0.13);

  ctx.fillStyle = teal;
  ctx.fillRect(width * 0.53, height * 0.34, width * 0.14, height * 0.11);
  ctx.fillStyle = cream;
  ctx.beginPath();
  ctx.moveTo(width * 0.53, height * 0.34);
  ctx.lineTo(width * 0.67, height * 0.34);
  ctx.lineTo(width * 0.64, height * 0.3);
  ctx.lineTo(width * 0.56, height * 0.3);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = deepTeal;
  ctx.fillRect(width * 0.545, height * 0.36, width * 0.012, height * 0.09);
  ctx.fillRect(width * 0.655, height * 0.36, width * 0.012, height * 0.09);

  ctx.fillStyle = umbrella;
  ctx.fillRect(width * 0.46, height * 0.42, width * 0.022, height * 0.07);
  ctx.fillStyle = '#e6b189';
  ctx.beginPath();
  ctx.arc(width * 0.471, height * 0.41, height * 0.014, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = cream;
  ctx.fillRect(width * 0.58, height * 0.43, width * 0.022, height * 0.065);
  ctx.fillStyle = '#e6b189';
  ctx.beginPath();
  ctx.arc(width * 0.591, height * 0.42, height * 0.014, 0, Math.PI * 2);
  ctx.fill();
};

export const drawDioramaForeground = (ctx: Ctx, width: number, height: number): void => {
  // Foreground rail and a soft tilt-shift frame; the stage stays one set.
  ctx.strokeStyle = rgba('#a8d8d2', 0.55);
  ctx.lineWidth = Math.max(2, height * 0.004);
  ctx.beginPath();
  ctx.moveTo(0, height * 0.86);
  ctx.lineTo(width, height * 0.78);
  ctx.stroke();
  ctx.strokeStyle = rgba('#0f2a36', 0.9);
  ctx.lineWidth = Math.max(3, height * 0.007);
  ctx.beginPath();
  ctx.moveTo(0, height * 0.9);
  ctx.lineTo(width, height * 0.82);
  ctx.stroke();

  const shift = ctx.createLinearGradient(0, 0, 0, height);
  shift.addColorStop(0, 'rgba(5,10,16,0.65)');
  shift.addColorStop(0.25, 'rgba(5,10,16,0)');
  shift.addColorStop(0.78, 'rgba(5,10,16,0)');
  shift.addColorStop(1, 'rgba(5,10,16,0.7)');
  ctx.fillStyle = shift;
  ctx.fillRect(0, 0, width, height);
};