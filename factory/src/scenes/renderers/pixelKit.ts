/** Deterministic pixel primitives for the generic pixel-canvas style pack. */

export const P = {
  deep: '#0B1B2B',
  teal: '#123044',
  ink: '#05080D',
  amber: '#FF9F1C',
  mint: '#2EC4B6',
  bone: '#E9E3D2',
  steel: '#8E9AA8',
  red: '#C0392B',
} as const;

export const hash = (n: number): number => {
  const value = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return value - Math.floor(value);
};

export const rect = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
): void => {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
};

export const px = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  color: string,
): void => rect(ctx, x, y, 1, 1, color);

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

export const bayer = (x: number, y: number): number => BAYER[(y & 3) * 4 + (x & 3)] / 16;

export const mix = (a: string, b: string, k: number): string => {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  return `#${pa
    .map((value, index) => Math.round(value + (pb[index] - value) * k).toString(16).padStart(2, '0'))
    .join('')}`;
};

export const ditherV = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  top: string,
  bottom: string,
  bands = 6,
): void => {
  const colors = Array.from({length: bands}, (_, i) => mix(top, bottom, i / (bands - 1)));
  for (let row = 0; row < h; row++) {
    const level = h <= 1 ? 0 : (row / (h - 1)) * (bands - 1);
    const base = Math.min(bands - 1, Math.floor(level));
    const fraction = level - base;
    for (let column = 0; column < w; column++) {
      const up = bayer(x + column, y + row) < fraction;
      ctx.fillStyle = colors[Math.min(bands - 1, base + (up ? 1 : 0))];
      ctx.fillRect(x + column, y + row, 1, 1);
    }
  }
};

export const ellipse = (
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  color: string,
): void => {
  ctx.fillStyle = color;
  for (let y = -Math.ceil(ry); y <= Math.ceil(ry); y++) {
    const k = 1 - (y * y) / (ry * ry);
    if (k <= 0) continue;
    const width = Math.floor(rx * Math.sqrt(k));
    ctx.fillRect(Math.round(cx) - width, Math.round(cy) + y, width * 2 + 1, 1);
  }
};

export const speckle = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
  density: number,
  seed: number,
): void => {
  const count = Math.floor(w * h * density);
  for (let i = 0; i < count; i++) {
    const sx = x + Math.floor(hash(seed + i * 1.7) * w);
    const sy = y + Math.floor(hash(seed + i * 2.9) * h);
    ctx.fillStyle = color;
    ctx.fillRect(sx, sy, 1, 1);
  }
};

export const vignette = (
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  strength = 1,
): void => {
  const band = Math.max(8, Math.round(Math.min(width, height) * 0.18));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const distance = Math.min(x, width - 1 - x, y, height - 1 - y);
      if (distance >= band) continue;
      const depth = 1 - distance / band;
      if (bayer(x, y) < depth * depth * 0.5 * strength) px(ctx, x, y, P.ink);
    }
  }
};
