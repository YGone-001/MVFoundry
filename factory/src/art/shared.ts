// Shared drawing helpers for the offline art-plate generator.
//
// These functions are deterministic and produce original procedural artwork.
// They are only executed by the local Chrome canvas through Remotion, never by
// the engine's render-time project module contract.

export type Ctx = CanvasRenderingContext2D;

export const hash = (value: number): number => {
  const noise = Math.sin(value * 127.1 + 311.7) * 43758.5453;
  return noise - Math.floor(noise);
};

export const hash2 = (a: number, b: number): number => hash(a * 57.13 + b * 13.77);

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export const clamp = (value: number, minimum: number, maximum: number): number =>
  value < minimum ? minimum : value > maximum ? maximum : value;

export const rgba = (hex: string, alpha: number): string => {
  const value = hex.replace('#', '');
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
};

export const roundRect = (
  ctx: Ctx,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void => {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.arcTo(x + width, y, x + width, y + r, r);
  ctx.lineTo(x + width, y + height - r);
  ctx.arcTo(x + width, y + height, x + width - r, y + height, r);
  ctx.lineTo(x + r, y + height);
  ctx.arcTo(x, y + height, x, y + height - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
};

export const fillRoundRect = (
  ctx: Ctx,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
  color: string,
): void => {
  ctx.fillStyle = color;
  roundRect(ctx, x, y, width, height, radius);
  ctx.fill();
};

export const glow = (
  ctx: Ctx,
  cx: number,
  cy: number,
  radius: number,
  color: string,
  alpha: number,
): void => {
  const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
  gradient.addColorStop(0, rgba(color, alpha));
  gradient.addColorStop(0.35, rgba(color, alpha * 0.55));
  gradient.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = gradient;
  ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
};

export const linearGradient = (
  ctx: Ctx,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  stops: Array<[number, string]>,
): CanvasGradient => {
  const gradient = ctx.createLinearGradient(x0, y0, x1, y1);
  for (const [offset, color] of stops) gradient.addColorStop(offset, color);
  return gradient;
};

/** A soft horizontal haze band used to separate depth planes. */
export const hazeBand = (
  ctx: Ctx,
  centreY: number,
  thickness: number,
  width: number,
  color: string,
  alpha: number,
  offsetX = 0,
  bandWidth = 1.5,
): void => {
  const gradient = ctx.createLinearGradient(0, centreY - thickness, 0, centreY + thickness);
  gradient.addColorStop(0, rgba(color, 0));
  gradient.addColorStop(0.5, rgba(color, alpha));
  gradient.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = gradient;
  ctx.fillRect(-offsetX - width * 0.2, centreY - thickness, width * bandWidth, thickness * 2);
};

/** Wet-street vertical smear of a lit source. */
export const wetReflection = (
  ctx: Ctx,
  cx: number,
  top: number,
  length: number,
  width: number,
  color: string,
  alpha: number,
  seed: number,
): void => {
  const gradient = ctx.createLinearGradient(0, top, 0, top + length);
  gradient.addColorStop(0, rgba(color, alpha));
  gradient.addColorStop(0.25, rgba(color, alpha * 0.6));
  gradient.addColorStop(0.6, rgba(color, alpha * 0.22));
  gradient.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = gradient;
  for (let slice = 0; slice < 7; slice += 1) {
    const sliceY = top + (length / 7) * slice;
    const wobble = Math.sin(seed + slice * 0.7) * width * 0.18;
    const sliceHeight = length / 7 + 1;
    ctx.fillRect(cx - width / 2 + wobble, sliceY, width, sliceHeight);
  }
};

export const dashedStroke = (
  ctx: Ctx,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  color: string,
  width: number,
  dash: number,
): void => {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.setLineDash([dash, dash * 0.7]);
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
  ctx.setLineDash([]);
};

export const halftone = (
  ctx: Ctx,
  x: number,
  y: number,
  width: number,
  height: number,
  spacing: number,
  color: string,
  alpha: number,
  size: number,
): void => {
  ctx.fillStyle = rgba(color, alpha);
  for (let gy = spacing / 2; gy < height; gy += spacing) {
    for (let gx = spacing / 2; gx < width; gx += spacing) {
      const phase = ((Math.round(gx / spacing) + Math.round(gy / spacing)) % 2) * 0.5;
      if (hash2(gx, gy) < 0.45) continue;
      ctx.beginPath();
      ctx.arc(x + gx + phase * spacing * 0.5, y + gy, size, 0, Math.PI * 2);
      ctx.fill();
    }
  }
};

export const inkStroke = (
  ctx: Ctx,
  points: Array<[number, number]>,
  color: string,
  width: number,
  tapered = true,
): void => {
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (let index = 1; index < points.length; index += 1) {
    const [x0, y0] = points[index - 1];
    const [x1, y1] = points[index];
    ctx.lineWidth = tapered ? width * (1 - index / (points.length + 1) * 0.55) : width;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
  }
};
