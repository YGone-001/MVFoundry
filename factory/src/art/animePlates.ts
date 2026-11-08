// Original procedural artwork for the anime motion-comic prototype.
//
// A separate art language from the cinematic plates: flat cel fills, thick ink
// outlines, halftone shadow blocks, graphic rain and comic proportions.

import type {Ctx} from './shared';
import {
  dashedStroke,
  fillRoundRect,
  glow,
  halftone,
  hash,
  hash2,
  linearGradient,
  rgba,
  roundRect,
} from './shared';

const A = {
  ink: '#0a0a12',
  nightSky: '#14234a',
  deepSky: '#0b1733',
  electricBlue: '#2f5fd0',
  alertRed: '#e64545',
  highlight: '#ffd166',
  paper: '#f7f4ea',
  mid: '#1d3160',
  far: '#233a6b',
  skin: '#f4c9a3',
  skinShadow: '#c98d6f',
  hair: '#151221',
  coatCream: '#f2e7d6',
  coatOlive: '#38402b',
  shadow: '#2a3560',
};

const inkOutline = (
  ctx: Ctx,
  draw: () => void,
  width: number,
  color = A.ink,
): void => {
  draw();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineJoin = 'round';
  ctx.stroke();
};

const comicBuilding = (
  ctx: Ctx,
  x: number,
  baseY: number,
  width: number,
  height: number,
  fill: string,
  seed: number,
): void => {
  ctx.fillStyle = fill;
  ctx.fillRect(x, baseY - height, width, height);
  ctx.strokeStyle = A.ink;
  ctx.lineWidth = Math.max(2, width * 0.02);
  ctx.strokeRect(x, baseY - height, width, height);
  // Graphic window blocks, not a realistic grid.
  const cols = Math.max(2, Math.floor(width / (width * 0.22)));
  for (let row = 0; row < 4; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const value = hash2(seed + row * 3.3, col * 5.1);
      if (value < 0.55) continue;
      ctx.fillStyle = value > 0.8 ? A.highlight : rgba(A.electricBlue, 0.8);
      ctx.fillRect(
        x + width * (0.08 + col * 0.2),
        baseY - height + height * (0.12 + row * 0.19),
        width * 0.13,
        height * 0.07,
      );
    }
  }
};

export const drawAnimeBackground = (ctx: Ctx, width: number, height: number): void => {
  // Two-tone sky with a hard terminator, no soft gradient.
  ctx.fillStyle = A.nightSky;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = A.deepSky;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(width, 0);
  ctx.lineTo(width, height * 0.42);
  ctx.lineTo(0, height * 0.55);
  ctx.closePath();
  ctx.fill();

  // Halftone field in the sky: comic texture, not a gradient.
  halftone(ctx, 0, 0, width, height * 0.62, 11, A.ink, 0.16, 2.2);

  // Diagonal speed lines behind the skyline.
  ctx.strokeStyle = rgba(A.ink, 0.5);
  for (let index = 0; index < 46; index += 1) {
    const startX = -width * 0.1 + index * width * 0.028;
    ctx.lineWidth = 1 + hash(index * 2.1) * 3;
    ctx.beginPath();
    ctx.moveTo(startX, height * 0.52);
    ctx.lineTo(startX + width * 0.16, height * 0.06);
    ctx.stroke();
  }

  const horizon = height * 0.68;

  // Far blocks: flat, outlined, deliberately graphic.
  for (let index = 0; index < 15; index += 1) {
    const buildingWidth = width * (0.05 + hash(index * 2.7) * 0.09);
    const buildingHeight = height * (0.12 + hash(index * 4.3) * 0.3);
    comicBuilding(
      ctx,
      -width * 0.03 + index * width * 0.072,
      horizon,
      buildingWidth,
      buildingHeight,
      index % 3 === 0 ? A.mid : A.far,
      index * 6.7,
    );
  }

  // Bold ground plane and rails.
  ctx.fillStyle = '#050810';
  ctx.fillRect(0, horizon, width, height - horizon);
  ctx.strokeStyle = rgba(A.electricBlue, 0.5);
  ctx.lineWidth = 2;
  for (let index = 0; index < 5; index += 1) {
    ctx.beginPath();
    ctx.moveTo(width * (0.08 + index * 0.2), height);
    ctx.lineTo(width * (0.47 + index * 0.02), horizon);
    ctx.stroke();
  }
  ctx.strokeStyle = rgba(A.highlight, 0.6);
  ctx.lineWidth = 4;
  dashedStroke(ctx, width * 0.35, height, width * 0.5, horizon, rgba(A.highlight, 0.35), 4, height * 0.03);

  // Graphic rain: short, hard, redrawn as a texture.
  ctx.strokeStyle = rgba(A.paper, 0.16);
  for (let index = 0; index < 180; index += 1) {
    ctx.lineWidth = 1 + hash(index * 3.3) * 2;
    const x = hash(index * 1.7) * width;
    const y = hash(index * 2.9) * height;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - 3, y + 14 + hash(index * 4.1) * 14);
    ctx.stroke();
  }

  // A single graphic glow: the tram headlight will enter from the right.
  glow(ctx, width * 0.82, horizon - height * 0.06, height * 0.22, A.highlight, 0.22);
};

export const drawAnimeMidground = (ctx: Ctx, width: number, height: number): void => {
  const horizon = height * 0.68;

  // Shelter: flat panels with thick outlines.
  ctx.fillStyle = '#16224a';
  ctx.beginPath();
  ctx.moveTo(width * 0.03, height * 0.26);
  ctx.lineTo(width * 0.56, height * 0.26);
  ctx.lineTo(width * 0.6, height * 0.33);
  ctx.lineTo(0, height * 0.33);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = A.ink;
  ctx.lineWidth = 5;
  ctx.stroke();
  // Canopy stripe.
  ctx.fillStyle = A.alertRed;
  ctx.fillRect(width * 0.03, height * 0.285, width * 0.52, height * 0.012);
  ctx.fillStyle = A.highlight;
  ctx.fillRect(width * 0.03, height * 0.26, width * 0.52, height * 0.008);

  // Glass panels: flat translucent blue fields with hard diagonal highlights.
  for (let index = 0; index < 4; index += 1) {
    const x = width * (0.05 + index * 0.125);
    ctx.fillStyle = rgba('#9fd8ff', 0.16);
    ctx.beginPath();
    ctx.moveTo(x, height * 0.33);
    ctx.lineTo(x + width * 0.11, height * 0.33);
    ctx.lineTo(x + width * 0.1, horizon - height * 0.02);
    ctx.lineTo(x + width * 0.01, horizon - height * 0.02);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = A.ink;
    ctx.lineWidth = 3;
    ctx.stroke();
    // Hard highlight slash.
    ctx.fillStyle = rgba(A.paper, 0.18);
    ctx.beginPath();
    ctx.moveTo(x + width * 0.02, horizon - height * 0.03);
    ctx.lineTo(x + width * 0.065, height * 0.35);
    ctx.lineTo(x + width * 0.085, height * 0.35);
    ctx.lineTo(x + width * 0.04, horizon - height * 0.03);
    ctx.closePath();
    ctx.fill();
  }

  // Posts.
  for (let index = 0; index < 5; index += 1) {
    const x = width * (0.04 + index * 0.125);
    ctx.fillStyle = A.ink;
    ctx.fillRect(x, height * 0.33, width * 0.014, horizon - height * 0.33);
  }

  // Hanging route sign.
  ctx.fillStyle = '#08101f';
  roundRect(ctx, width * 0.38, height * 0.34, width * 0.1, height * 0.16, width * 0.01);
  ctx.fill();
  ctx.strokeStyle = A.highlight;
  ctx.lineWidth = 4;
  roundRect(ctx, width * 0.38, height * 0.34, width * 0.1, height * 0.16, width * 0.01);
  ctx.stroke();
  for (let glyph = 0; glyph < 3; glyph += 1) {
    ctx.fillStyle = A.paper;
    ctx.fillRect(
      width * 0.4,
      height * (0.365 + glyph * 0.04),
      width * (0.055 - glyph * 0.01),
      height * 0.018,
    );
  }

  // Lamp: hard graphic cone of light, not a soft bloom.
  ctx.fillStyle = rgba(A.highlight, 0.12);
  ctx.beginPath();
  ctx.moveTo(width * 0.28, height * 0.29);
  ctx.lineTo(width * 0.19, horizon);
  ctx.lineTo(width * 0.39, horizon);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = A.highlight;
  ctx.beginPath();
  ctx.arc(width * 0.29, height * 0.285, height * 0.018, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = A.ink;
  ctx.lineWidth = 3;
  ctx.stroke();

  // Bench, bold silhouette.
  ctx.fillStyle = A.ink;
  ctx.fillRect(width * 0.12, height * 0.59, width * 0.14, height * 0.014);
  ctx.fillRect(width * 0.125, height * 0.604, width * 0.008, height * 0.06);
  ctx.fillRect(width * 0.245, height * 0.604, width * 0.008, height * 0.06);

  // Platform edge safety band, flat and graphic.
  ctx.fillStyle = A.highlight;
  ctx.fillRect(0, horizon - height * 0.018, width * 0.7, height * 0.018);
  ctx.strokeStyle = A.ink;
  ctx.lineWidth = 2;
  ctx.strokeRect(0, horizon - height * 0.018, width * 0.7, height * 0.018);
};

export const drawAnimeCloseupBackground = (ctx: Ctx, width: number, height: number): void => {
  ctx.fillStyle = A.deepSky;
  ctx.fillRect(0, 0, width, height);
  // Flat plate tone block.
  ctx.fillStyle = A.nightSky;
  ctx.beginPath();
  ctx.moveTo(0, height * 0.2);
  ctx.lineTo(width, 0);
  ctx.lineTo(width, height * 0.6);
  ctx.lineTo(0, height * 0.85);
  ctx.closePath();
  ctx.fill();
  halftone(ctx, 0, 0, width, height, 14, A.ink, 0.22, 3);
  // Radial emphasis lines, graphic not soft.
  const cx = width * 0.5;
  const cy = height * 0.42;
  for (let index = 0; index < 56; index += 1) {
    const angle = hash(index * 2.7) * Math.PI * 2;
    const inner = height * (0.18 + hash(index * 4.9) * 0.16);
    const outer = Math.hypot(width, height);
    ctx.strokeStyle = rgba(A.ink, 0.26 + hash(index * 6.3) * 0.2);
    ctx.lineWidth = 2 + hash(index * 8.1) * 5;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(angle) * inner, cy + Math.sin(angle) * inner);
    ctx.lineTo(cx + Math.cos(angle) * outer, cy + Math.sin(angle) * outer);
    ctx.stroke();
  }
  // Flat rain bands.
  for (let index = 0; index < 90; index += 1) {
    const x = hash(index * 1.7) * width;
    const y = hash(index * 3.3) * height;
    ctx.strokeStyle = rgba(A.paper, 0.1 + hash(index * 5.1) * 0.14);
    ctx.lineWidth = 1 + hash(index * 7.3) * 2;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - 4, y + 18);
    ctx.stroke();
  }
};

export const drawAnimeBokehMidground = (ctx: Ctx, width: number, height: number): void => {
  // Transparent comic midground: halftone field plus radial emphasis lines.
  halftone(ctx, width * 0.35, 0, width * 0.65, height, 12, A.ink, 0.2, 3.2);
  const cx = width * 0.62;
  const cy = height * 0.42;
  for (let index = 0; index < 44; index += 1) {
    const angle = hash(index * 2.3) * Math.PI * 2;
    const inner = height * (0.1 + hash(index * 4.7) * 0.24);
    const outer = height * (0.5 + hash(index * 6.1) * 0.3);
    ctx.strokeStyle = rgba(A.paper, 0.1 + hash(index * 8.3) * 0.12);
    ctx.lineWidth = 2 + hash(index * 9.7) * 5;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(angle) * inner, cy + Math.sin(angle) * inner);
    ctx.lineTo(cx + Math.cos(angle) * outer, cy + Math.sin(angle) * outer);
    ctx.stroke();
  }
  // A couple of flat speed bands.
  for (let index = 0; index < 6; index += 1) {
    const y = height * (0.1 + index * 0.14);
    ctx.fillStyle = rgba(A.paper, 0.06);
    ctx.fillRect(0, y, width * (0.2 + hash(index * 3.1) * 0.4), 2 + hash(index * 5.3) * 6);
  }
};

export const drawAnimeForeground = (ctx: Ctx, width: number, height: number): void => {
  // Heavy ink railing.
  ctx.fillStyle = A.ink;
  ctx.fillRect(-width * 0.02, height * 0.79, width * 1.04, height * 0.026);
  ctx.fillRect(-width * 0.02, height * 0.9, width * 1.04, height * 0.036);
  for (let index = 0; index < 6; index += 1) {
    ctx.fillRect(width * (0.04 + index * 0.19), height * 0.78, width * 0.018, height * 0.17);
  }
  ctx.fillStyle = rgba(A.paper, 0.12);
  ctx.fillRect(-width * 0.02, height * 0.79, width * 1.04, height * 0.006);

  // Foreground cable, thick and graphic.
  ctx.strokeStyle = A.ink;
  ctx.lineWidth = Math.max(8, width * 0.012);
  ctx.beginPath();
  ctx.moveTo(-width * 0.05, height * 0.2);
  ctx.quadraticCurveTo(width * 0.43, height * 0.02, width * 1.06, height * 0.14);
  ctx.stroke();
  ctx.strokeStyle = rgba(A.paper, 0.14);
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(-width * 0.05, height * 0.208);
  ctx.quadraticCurveTo(width * 0.43, height * 0.028, width * 1.06, height * 0.148);
  ctx.stroke();

  // Comic splash marks on the wet ground.
  ctx.fillStyle = rgba(A.paper, 0.08);
  for (let index = 0; index < 26; index += 1) {
    const x = hash(index * 3.7) * width;
    const y = height * (0.9 + hash(index * 5.1) * 0.09);
    const size = 2 + hash(index * 7.3) * 8;
    ctx.beginPath();
    ctx.arc(x, y, size, 0, Math.PI * 2);
    ctx.fill();
  }
};

const animeFace = (
  ctx: Ctx,
  cx: number,
  cy: number,
  scale: number,
  options: {look: 'away' | 'down'; tear?: boolean},
): void => {
  const {look, tear} = options;
  const hw = 46 * scale;
  const hh = 58 * scale;

  // Face: rounded jaw, wide cheekbones, no pointed chin.
  const facePath = (): void => {
    ctx.beginPath();
    ctx.moveTo(cx - hw, cy - hh * 0.35);
    ctx.quadraticCurveTo(cx - hw * 1.06, cy + hh * 0.28, cx - hw * 0.72, cy + hh * 0.62);
    ctx.quadraticCurveTo(cx - hw * 0.34, cy + hh * 0.94, cx, cy + hh * 0.96);
    ctx.quadraticCurveTo(cx + hw * 0.34, cy + hh * 0.94, cx + hw * 0.72, cy + hh * 0.62);
    ctx.quadraticCurveTo(cx + hw * 1.06, cy + hh * 0.28, cx + hw, cy - hh * 0.35);
    ctx.quadraticCurveTo(cx, cy - hh * 1.02, cx - hw, cy - hh * 0.35);
    ctx.closePath();
  };
  inkOutline(
    ctx,
    () => {
      ctx.fillStyle = A.skin;
      facePath();
      ctx.fill();
    },
    3 * scale,
  );

  // Hard cel shadow on the shadow side.
  ctx.save();
  facePath();
  ctx.clip();
  ctx.fillStyle = rgba(A.skinShadow, 0.85);
  ctx.beginPath();
  ctx.moveTo(cx - hw * 1.1, cy - hh * 0.5);
  ctx.lineTo(cx - hw * 0.3, cy - hh * 0.4);
  ctx.lineTo(cx - hw * 0.22, cy + hh * 0.5);
  ctx.lineTo(cx - hw * 0.55, cy + hh * 0.85);
  ctx.lineTo(cx - hw * 1.1, cy + hh * 0.9);
  ctx.closePath();
  ctx.fill();
  // Cheek blush strokes.
  ctx.strokeStyle = rgba(A.alertRed, 0.35);
  ctx.lineWidth = 2.4 * scale;
  for (let line = 0; line < 3; line += 1) {
    ctx.beginPath();
    ctx.moveTo(cx + hw * (0.28 + line * 0.1), cy + hh * 0.42);
    ctx.lineTo(cx + hw * (0.36 + line * 0.1), cy + hh * 0.3);
    ctx.stroke();
  }
  ctx.restore();

  // Eyes: large manga almonds with a bright iris.
  const eyeY = cy + hh * 0.08;
  const eyeW = 17 * scale;
  const eyeH = 12 * scale;
  const shift = look === 'away' ? 5 * scale : 0;
  for (const side of [-1, 1] as const) {
    const ex = cx + side * hw * 0.42 + shift;
    ctx.fillStyle = A.paper;
    ctx.beginPath();
    ctx.ellipse(ex, eyeY, eyeW, eyeH, side * 0.1, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = A.ink;
    ctx.lineWidth = 2.6 * scale;
    ctx.stroke();
    ctx.fillStyle = A.electricBlue;
    ctx.beginPath();
    ctx.ellipse(ex + shift * 0.5, eyeY + eyeH * 0.08, eyeW * 0.52, eyeH * 0.85, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#0b0a12';
    ctx.beginPath();
    ctx.ellipse(ex + shift * 0.5, eyeY + eyeH * 0.12, eyeW * 0.24, eyeH * 0.42, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = A.paper;
    ctx.beginPath();
    ctx.arc(ex - eyeW * 0.18 + shift * 0.5, eyeY - eyeH * 0.3, eyeW * 0.16, 0, Math.PI * 2);
    ctx.fill();
  }

  // Brows.
  for (const side of [-1, 1] as const) {
    ctx.strokeStyle = A.ink;
    ctx.lineWidth = 3.4 * scale;
    ctx.beginPath();
    ctx.moveTo(cx + side * hw * 0.7, eyeY - hh * 0.26);
    ctx.quadraticCurveTo(
      cx + side * hw * 0.42,
      eyeY - hh * 0.36,
      cx + side * hw * 0.18,
      eyeY - hh * 0.3,
    );
    ctx.stroke();
  }

  // Nose: one short mark.
  ctx.strokeStyle = A.ink;
  ctx.lineWidth = 2.2 * scale;
  ctx.beginPath();
  ctx.moveTo(cx + 2 * scale, eyeY + hh * 0.16);
  ctx.lineTo(cx - 4 * scale, eyeY + hh * 0.24);
  ctx.stroke();

  // Mouth: small but readable; tightened for the emotional beat.
  ctx.lineWidth = 2.6 * scale;
  ctx.beginPath();
  ctx.moveTo(cx - 10 * scale, eyeY + hh * 0.44);
  ctx.quadraticCurveTo(cx, eyeY + hh * 0.5, cx + 10 * scale, eyeY + hh * 0.43);
  ctx.stroke();

  if (tear) {
    ctx.fillStyle = rgba('#bfe6f2', 0.95);
    ctx.beginPath();
    ctx.ellipse(cx + eyeW * 1.3, eyeY + eyeH * 1.2, 3 * scale, 7 * scale, 0.1, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = A.ink;
    ctx.lineWidth = 1.6 * scale;
    ctx.stroke();
  }

  // Hair: crown cap plus fringe and side locks.
  const hairCap = (): void => {
    ctx.beginPath();
    ctx.moveTo(cx - hw * 1.14, cy - hh * 0.22);
    ctx.quadraticCurveTo(cx - hw * 1.2, cy - hh * 1.1, cx, cy - hh * 1.18);
    ctx.quadraticCurveTo(cx + hw * 1.2, cy - hh * 1.1, cx + hw * 1.14, cy - hh * 0.22);
    ctx.lineTo(cx + hw * 1.02, cy - hh * 0.28);
    ctx.lineTo(cx + hw * 0.9, cy - hh * 0.08);
    ctx.lineTo(cx + hw * 0.66, cy - hh * 0.3);
    ctx.lineTo(cx + hw * 0.4, cy - hh * 0.06);
    ctx.lineTo(cx + hw * 0.12, cy - hh * 0.32);
    ctx.lineTo(cx - hw * 0.16, cy - hh * 0.08);
    ctx.lineTo(cx - hw * 0.44, cy - hh * 0.34);
    ctx.lineTo(cx - hw * 0.72, cy - hh * 0.1);
    ctx.lineTo(cx - hw * 1.02, cy - hh * 0.3);
    ctx.closePath();
  };
  inkOutline(
    ctx,
    () => {
      ctx.fillStyle = A.hair;
      hairCap();
      ctx.fill();
    },
    3 * scale,
  );
  // Crown highlight.
  ctx.strokeStyle = rgba(A.electricBlue, 0.35);
  ctx.lineWidth = 4 * scale;
  ctx.beginPath();
  ctx.ellipse(cx - hw * 0.3, cy - hh * 0.72, hw * 0.5, hh * 0.16, -0.2, Math.PI * 0.9, Math.PI * 1.4);
  ctx.stroke();

  // Side locks.
  for (const side of [-1, 1] as const) {
    ctx.fillStyle = A.hair;
    ctx.beginPath();
    ctx.moveTo(cx + side * hw * 1.02, cy - hh * 0.35);
    ctx.quadraticCurveTo(cx + side * hw * 1.24, cy + hh * 0.16, cx + side * hw * 1.02, cy + hh * 0.72);
    ctx.quadraticCurveTo(cx + side * hw * 0.86, cy + hh * 0.1, cx + side * hw * 0.9, cy - hh * 0.3);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = A.ink;
    ctx.lineWidth = 2.4 * scale;
    ctx.stroke();
  }
};

const animeFigure = (
  ctx: Ctx,
  width: number,
  height: number,
  options: {
    coat: string;
    hair: string;
    scarf: string;
    skin: string;
    proportions: 'tall' | 'petite';
    look: 'away' | 'down';
  },
): void => {
  const {coat, scarf, skin, proportions, look} = options;
  const cx = width * 0.5;
  const groundY = height * 0.95;
  const headScale = proportions === 'tall' ? 1.15 : 1.3;
  const headY = groundY - (proportions === 'tall' ? height * 0.78 : height * 0.72);
  const unit = height * 0.001;

  // Contact shadow.
  ctx.fillStyle = rgba(A.ink, 0.55);
  ctx.beginPath();
  ctx.ellipse(cx, groundY, width * 0.22, height * 0.012, 0, 0, Math.PI * 2);
  ctx.fill();

  // Legs.
  ctx.fillStyle = A.ink;
  ctx.fillRect(cx - 40 * unit, groundY - 200 * unit, 32 * unit, 190 * unit);
  ctx.fillRect(cx + 8 * unit, groundY - 200 * unit, 32 * unit, 190 * unit);

  // Coat: sloped shoulders, tapered waist, flat cel fill.
  inkOutline(
    ctx,
    () => {
      ctx.fillStyle = coat;
      ctx.beginPath();
      ctx.moveTo(cx - 96 * unit, headY + 152 * unit);
      ctx.quadraticCurveTo(cx - 104 * unit, headY + 210 * unit, cx - 112 * unit, groundY - 170 * unit);
      ctx.lineTo(cx + 112 * unit, groundY - 170 * unit);
      ctx.quadraticCurveTo(cx + 104 * unit, headY + 210 * unit, cx + 96 * unit, headY + 152 * unit);
      ctx.quadraticCurveTo(cx, headY + 126 * unit, cx - 96 * unit, headY + 152 * unit);
      ctx.closePath();
      ctx.fill();
    },
    4,
  );
  ctx.fillStyle = rgba(A.shadow, 0.28);
  ctx.beginPath();
  ctx.moveTo(cx - 96 * unit, headY + 154 * unit);
  ctx.lineTo(cx - 40 * unit, headY + 154 * unit);
  ctx.lineTo(cx - 52 * unit, groundY - 172 * unit);
  ctx.lineTo(cx - 112 * unit, groundY - 172 * unit);
  ctx.closePath();
  ctx.fill();

  // Arms: separate outlined shapes so the silhouette keeps limbs.
  for (const side of [-1, 1] as const) {
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(cx + side * 92 * unit, headY + 160 * unit);
    ctx.quadraticCurveTo(
      cx + side * 128 * unit,
      headY + 300 * unit,
      cx + side * 116 * unit,
      groundY - 330 * unit,
    );
    ctx.lineTo(cx + side * 86 * unit, groundY - 330 * unit);
    ctx.quadraticCurveTo(
      cx + side * 92 * unit,
      headY + 300 * unit,
      cx + side * 68 * unit,
      headY + 190 * unit,
    );
    ctx.closePath();
    ctx.fillStyle = side === 1 ? rgba(A.shadow, 0.28) : coat;
    ctx.fill();
    ctx.strokeStyle = A.ink;
    ctx.lineWidth = 3.4;
    ctx.stroke();
    // Sleeve shadow block.
    ctx.fillStyle = rgba(A.ink, 0.18);
    ctx.beginPath();
    ctx.moveTo(cx + side * 100 * unit, headY + 200 * unit);
    ctx.lineTo(cx + side * 118 * unit, headY + 320 * unit);
    ctx.lineTo(cx + side * 104 * unit, groundY - 340 * unit);
    ctx.lineTo(cx + side * 92 * unit, headY + 260 * unit);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // Scarf: the only saturated accent.
  ctx.fillStyle = scarf;
  ctx.beginPath();
  ctx.ellipse(cx, headY + 140 * unit, 60 * unit, 22 * unit, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = A.ink;
  ctx.lineWidth = 3.4;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx + 20 * unit, headY + 150 * unit);
  ctx.lineTo(cx + 56 * unit, groundY - 470 * unit);
  ctx.lineTo(cx + 38 * unit, groundY - 470 * unit);
  ctx.lineTo(cx + 4 * unit, headY + 152 * unit);
  ctx.closePath();
  ctx.fillStyle = scarf;
  ctx.fill();
  ctx.stroke();

  // Neck.
  ctx.fillStyle = rgba(skin, 1);
  ctx.fillRect(cx - 18 * unit, headY + 110 * unit, 36 * unit, 36 * unit);

  animeFace(ctx, cx, headY, headScale, {look});
};

export const drawAnimeWoman = (ctx: Ctx, width: number, height: number): void => {
  animeFigure(ctx, width, height, {
    coat: A.coatCream,
    hair: A.hair,
    scarf: A.alertRed,
    skin: A.skin,
    proportions: 'petite',
    look: 'away',
  });
};

export const drawAnimeMan = (ctx: Ctx, width: number, height: number): void => {
  animeFigure(ctx, width, height, {
    coat: A.coatOlive,
    hair: A.hair,
    scarf: rgba(A.ink, 0.9),
    skin: '#e0b48c',
    proportions: 'tall',
    look: 'down',
  });
};

export const drawAnimeCloseup = (ctx: Ctx, width: number, height: number): void => {
  const cx = width * 0.5;
  const cy = height * 0.42;

  // Radial speed lines behind the face.
  ctx.strokeStyle = rgba(A.ink, 0.55);
  for (let index = 0; index < 64; index += 1) {
    const angle = (index / 64) * Math.PI * 2 + 0.05;
    const inner = height * (0.22 + hash(index * 3.1) * 0.1);
    const outer = height * 0.75;
    ctx.lineWidth = 2 + hash(index * 5.3) * 5;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(angle) * inner, cy + Math.sin(angle) * inner);
    ctx.lineTo(cx + Math.cos(angle) * outer, cy + Math.sin(angle) * outer);
    ctx.stroke();
  }

  // Coat shoulders and scarf, cropped by the panel.
  ctx.fillStyle = A.coatCream;
  ctx.beginPath();
  ctx.moveTo(cx - width * 0.5, height);
  ctx.quadraticCurveTo(cx - width * 0.2, height * 0.7, cx - width * 0.1, height * 0.64);
  ctx.lineTo(cx + width * 0.12, height * 0.64);
  ctx.quadraticCurveTo(cx + width * 0.22, height * 0.72, cx + width * 0.5, height);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = A.ink;
  ctx.lineWidth = 6;
  ctx.stroke();
  ctx.fillStyle = A.alertRed;
  ctx.beginPath();
  ctx.ellipse(cx, height * 0.66, width * 0.2, height * 0.055, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = A.ink;
  ctx.lineWidth = 5;
  ctx.stroke();

  // Huge close-up face.
  animeFace(ctx, cx, cy, 5.4, {look: 'away', tear: true});

  // Halftone shadow on the cheek for print texture.
  halftone(ctx, cx - width * 0.16, cy + height * 0.04, width * 0.12, height * 0.16, 7, A.ink, 0.18, 1.8);
};

export const drawAnimeTram = (ctx: Ctx, width: number, height: number): void => {
  const bodyX = width * 0.02;
  const bodyY = height * 0.18;
  const bodyW = width * 0.96;
  const bodyH = height * 0.6;

  // Motion speed lines behind the tram.
  ctx.strokeStyle = rgba(A.paper, 0.22);
  for (let index = 0; index < 26; index += 1) {
    const y = bodyY + hash(index * 2.9) * bodyH;
    ctx.lineWidth = 2 + hash(index * 4.1) * 5;
    ctx.beginPath();
    ctx.moveTo(-width * 0.05, y);
    ctx.lineTo(width * 0.22, y + (hash(index * 6.3) - 0.5) * height * 0.02);
    ctx.stroke();
  }

  // Body with ink outline.
  inkOutline(
    ctx,
    () => {
      ctx.fillStyle = '#1b3060';
      roundRect(ctx, bodyX, bodyY, bodyW, bodyH, height * 0.06);
      ctx.fill();
    },
    6,
  );
  // Front face.
  ctx.fillStyle = '#24407a';
  ctx.beginPath();
  ctx.moveTo(bodyX + bodyW * 0.86, bodyY);
  ctx.lineTo(bodyX + bodyW, bodyY + bodyH * 0.24);
  ctx.lineTo(bodyX + bodyW, bodyY + bodyH * 0.76);
  ctx.lineTo(bodyX + bodyW * 0.86, bodyY + bodyH);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = A.ink;
  ctx.lineWidth = 5;
  ctx.stroke();

  // Big flat window band with hard cel shapes.
  const windowY = bodyY + bodyH * 0.14;
  const windowH = bodyH * 0.34;
  for (let index = 0; index < 4; index += 1) {
    const x = bodyX + bodyW * (0.05 + index * 0.19);
    ctx.fillStyle = A.highlight;
    ctx.fillRect(x, windowY, bodyW * 0.16, windowH);
    ctx.strokeStyle = A.ink;
    ctx.lineWidth = 5;
    ctx.strokeRect(x, windowY, bodyW * 0.16, windowH);
    // Silhouette passenger blocks.
    ctx.fillStyle = rgba(A.ink, 0.8);
    ctx.fillRect(x + bodyW * 0.02, windowY + windowH * 0.5, bodyW * 0.03, windowH * 0.45);
    ctx.fillRect(x + bodyW * 0.08, windowY + windowH * 0.42, bodyW * 0.04, windowH * 0.53);
  }

  // Headlight with a comic starburst.
  glow(ctx, bodyX + bodyW * 0.92, bodyY + bodyH * 0.62, height * 0.2, A.highlight, 0.3);
  ctx.fillStyle = A.paper;
  ctx.beginPath();
  ctx.arc(bodyX + bodyW * 0.92, bodyY + bodyH * 0.62, height * 0.045, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = A.ink;
  ctx.lineWidth = 4;
  ctx.stroke();

  // Door lines and livery band.
  ctx.strokeStyle = A.ink;
  ctx.lineWidth = 4;
  for (let door = 0; door < 2; door += 1) {
    const x = bodyX + bodyW * (0.3 + door * 0.42);
    ctx.beginPath();
    ctx.moveTo(x, bodyY + bodyH * 0.52);
    ctx.lineTo(x, bodyY + bodyH * 0.95);
    ctx.stroke();
  }
  ctx.fillStyle = A.alertRed;
  ctx.fillRect(bodyX, bodyY + bodyH * 0.76, bodyW, bodyH * 0.07);

  // Wheels.
  ctx.fillStyle = A.ink;
  for (const wx of [0.2, 0.72]) {
    ctx.beginPath();
    ctx.arc(bodyX + bodyW * wx, bodyY + bodyH * 0.98, height * 0.055, 0, Math.PI * 2);
    ctx.fill();
  }

  // Ground shadow.
  ctx.fillStyle = rgba(A.ink, 0.4);
  ctx.beginPath();
  ctx.ellipse(width * 0.5, height * 0.97, width * 0.44, height * 0.03, 0, 0, Math.PI * 2);
  ctx.fill();

  // Fillgbree: a couple of flat graphic rain streaks in front.
  ctx.strokeStyle = rgba(A.paper, 0.24);
  for (let index = 0; index < 24; index += 1) {
    const x = hash(index * 7.1) * width;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x - width * 0.01, height * 0.2);
    ctx.stroke();
  }
};
