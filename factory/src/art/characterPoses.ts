// Original character artwork for the P1-G-C performance prototype.
//
// One parametric character model paints every pose. Both framings (full figure
// and bust) call the same head and body routines with the same proportions and
// palette, so a pose can never drift into a different person: only the acting
// parameters change. Nothing here is downloaded, traced or sampled from third
// party imagery; every path is authored in code and deterministic.
//
// The pose table is intentionally small and legible:
//   woman: neutral, look-man, look-away, concerned, eyes-down, turn-early, turned-away
//   man:   neutral, look-her, notice, reach, look-away
//
// This is a flat vector illustration language with a hard rim light. It is not
// a photograph, a painted portrait or a 3D character, and it does not claim
// anatomical realism.

import type {Ctx} from './shared';
import {clamp, linearGradient, rgba, roundRect} from './shared';

export type CharacterId = 'woman' | 'man';
export type Framing = 'full' | 'bust';

type MouthShape = 'neutral' | 'press' | 'concern' | 'open';

/** Acting parameters. Everything the performance changes lives here. */
export type PoseSpec = {
  id: string;
  label: string;
  /** Head turn: +1 turns toward screen right, -1 toward screen left. */
  yaw: number;
  /** Gaze direction, independent of head turn. */
  gazeX: number;
  gazeY: number;
  /** -1 lowers the brows, +1 raises them. */
  browLift: number;
  /** +1 lifts the inner brow (concern), -1 lowers it (doubt). */
  browAngle: number;
  /** 0 open, 1 closed. */
  lid: number;
  mouth: MouthShape;
  /** Torso lean, positive leans toward screen right. */
  lean: number;
  /** Blocking offset as a fraction of canvas width. */
  bodyShift: number;
  leftArm: 'down' | 'chest' | 'reach';
  rightArm: 'down' | 'chest' | 'reach';
  /** +1 head pitches down, -1 looks up. */
  pitch: number;
};

const WOMAN_POSES: readonly PoseSpec[] = [
  {
    id: 'neutral',
    label: 'Neutral, resting weight',
    yaw: 0,
    gazeX: 0,
    gazeY: 0,
    browLift: 0,
    browAngle: 0,
    lid: 0.12,
    mouth: 'neutral',
    lean: 0,
    bodyShift: 0,
    leftArm: 'down',
    rightArm: 'chest',
    pitch: 0,
  },
  {
    id: 'look-man',
    label: 'Turns to the other character',
    yaw: 0.4,
    gazeX: 0.7,
    gazeY: -0.06,
    browLift: 0.12,
    browAngle: 0.1,
    lid: 0.1,
    mouth: 'neutral',
    lean: 0.04,
    bodyShift: 0,
    leftArm: 'down',
    rightArm: 'chest',
    pitch: -0.04,
  },
  {
    id: 'look-away',
    label: 'Averts the eyes',
    yaw: -0.16,
    gazeX: -0.9,
    gazeY: 0.1,
    browLift: -0.1,
    browAngle: 0.18,
    lid: 0.28,
    mouth: 'press',
    lean: -0.03,
    bodyShift: 0,
    leftArm: 'down',
    rightArm: 'chest',
    pitch: 0.07,
  },
  {
    id: 'concerned',
    label: 'Recognition: inner brows lift',
    yaw: 0.18,
    gazeX: 0.3,
    gazeY: 0.04,
    browLift: 0.14,
    browAngle: 0.9,
    lid: 0.32,
    mouth: 'concern',
    lean: 0.02,
    bodyShift: 0,
    leftArm: 'down',
    rightArm: 'chest',
    pitch: 0.03,
  },
  {
    id: 'eyes-down',
    label: 'Lowers the eyes, holds the reaction',
    yaw: -0.1,
    gazeX: -0.26,
    gazeY: 0.85,
    browLift: 0.08,
    browAngle: 0.6,
    lid: 0.55,
    mouth: 'concern',
    lean: -0.05,
    bodyShift: 0,
    leftArm: 'down',
    rightArm: 'chest',
    pitch: 0.3,
  },
  {
    id: 'turn-early',
    label: 'Head starts to turn away',
    yaw: -0.55,
    gazeX: -0.78,
    gazeY: 0.28,
    browLift: 0,
    browAngle: 0.3,
    lid: 0.34,
    mouth: 'press',
    lean: -0.1,
    bodyShift: -0.03,
    leftArm: 'down',
    rightArm: 'down',
    pitch: 0.16,
  },
  {
    id: 'turned-away',
    label: 'Turned away, leaving the frame',
    yaw: -0.92,
    gazeX: -1,
    gazeY: 0.12,
    browLift: -0.04,
    browAngle: 0.12,
    lid: 0.3,
    mouth: 'press',
    lean: -0.18,
    bodyShift: -0.07,
    leftArm: 'down',
    rightArm: 'down',
    pitch: 0.1,
  },
];

const MAN_POSES: readonly PoseSpec[] = [
  {
    id: 'neutral',
    label: 'Neutral, hands at rest',
    yaw: 0,
    gazeX: 0,
    gazeY: 0,
    browLift: 0,
    browAngle: 0,
    lid: 0.1,
    mouth: 'neutral',
    lean: 0,
    bodyShift: 0,
    leftArm: 'down',
    rightArm: 'down',
    pitch: 0,
  },
  {
    id: 'look-her',
    label: 'Watching her',
    yaw: -0.38,
    gazeX: -0.78,
    gazeY: 0.02,
    browLift: 0.08,
    browAngle: 0.15,
    lid: 0.12,
    mouth: 'neutral',
    lean: -0.03,
    bodyShift: 0,
    leftArm: 'down',
    rightArm: 'down',
    pitch: 0,
  },
  {
    id: 'notice',
    label: 'Notices her reaction',
    yaw: -0.28,
    gazeX: -0.6,
    gazeY: -0.05,
    browLift: 0.75,
    browAngle: 0.3,
    lid: 0.03,
    mouth: 'open',
    lean: -0.02,
    bodyShift: 0,
    leftArm: 'down',
    rightArm: 'chest',
    pitch: -0.07,
  },
  {
    id: 'reach',
    label: 'Reaches out hesitantly',
    yaw: -0.18,
    gazeX: -0.58,
    gazeY: 0.1,
    browLift: 0.32,
    browAngle: 0.5,
    lid: 0.2,
    mouth: 'concern',
    lean: -0.12,
    bodyShift: 0,
    leftArm: 'down',
    rightArm: 'reach',
    pitch: 0.08,
  },
  {
    id: 'look-away',
    label: 'Looks away too late',
    yaw: 0.48,
    gazeX: 0.55,
    gazeY: 0.25,
    browLift: -0.18,
    browAngle: 0.2,
    lid: 0.48,
    mouth: 'press',
    lean: 0.05,
    bodyShift: 0,
    leftArm: 'down',
    rightArm: 'down',
    pitch: 0.2,
  },
];

const WOMAN = {
  skin: '#f2cdb1',
  skinShade: '#d3a486',
  skinDeep: '#a8775a',
  hair: '#1d1722',
  hairMid: '#2e2637',
  hairLight: '#584a63',
  coat: '#f3e9d6',
  coatShade: '#cbbfa8',
  coatDeep: '#9c9079',
  scarf: '#b23a4c',
  scarfShade: '#7d2231',
  trouser: '#262b35',
  trouserShade: '#151922',
  boot: '#0f1218',
  iris: '#433026',
  lip: '#b4695f',
  blush: '#e08f7e',
  rim: '#bcd2e8',
};

const MAN = {
  skin: '#e8bc9c',
  skinShade: '#c2916f',
  skinDeep: '#906648',
  hair: '#16181f',
  hairMid: '#282c36',
  hairLight: '#464c59',
  coat: '#4e5a3a',
  coatShade: '#3a442b',
  coatDeep: '#252c1b',
  scarf: '#333d4a',
  scarfShade: '#222a33',
  trouser: '#242b35',
  trouserShade: '#131820',
  boot: '#0e1116',
  iris: '#31271e',
  lip: '#a46458',
  blush: '#c9846e',
  rim: '#bcd2e8',
};

type Palette = typeof WOMAN;

const paint = (
  ctx: Ctx,
  path: () => void,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  stops: Array<[number, string]>,
): void => {
  ctx.save();
  path();
  ctx.fillStyle = linearGradient(ctx, x0, y0, x1, y1, stops);
  ctx.fill();
  ctx.restore();
};

const stroke = (ctx: Ctx, points: Array<[number, number]>, color: string, width: number): void => {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  points.forEach(([x, y], index) => (index === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
  ctx.stroke();
};

const blob = (ctx: Ctx, cx: number, cy: number, rx: number, ry: number): void => {
  ctx.beginPath();
  ctx.ellipse(cx, cy, Math.max(0.5, rx), Math.max(0.5, ry), 0, 0, Math.PI * 2);
};

/* -------------------------------------------------------------------------- */
/* Head                                                                       */
/* -------------------------------------------------------------------------- */

type HeadGeometry = {
  cx: number;
  /** Centre of the skull. */
  cy: number;
  /** Full head width and height. */
  width: number;
  height: number;
  /** Y where the neck meets the shoulders. */
  neckBottom: number;
};

/**
 * Paints the head from a single model. Yaw moves the far-side features and the
 * hair silhouette, pitch raises or lowers every feature together, and gaze moves
 * only the irises. That keeps identity fixed while the acting changes.
 */
const drawHead = (
  ctx: Ctx,
  head: HeadGeometry,
  pose: PoseSpec,
  palette: Palette,
  character: CharacterId,
): void => {
  const {cx, cy, neckBottom} = head;
  const hw = head.width / 2;
  const hh = head.height / 2;
  const yaw = clamp(pose.yaw, -1, 1);
  const pitch = clamp(pose.pitch, -0.6, 0.6);
  const shiftX = yaw * hw * 0.08;
  const shiftY = pitch * hh * 0.06;
  const chinY = cy + hh + shiftY * 0.5;
  const eyeY = cy + hh * 0.14 + shiftY;
  const browY = cy - hh * 0.1 + shiftY;
  const noseY = cy + hh * 0.4 + shiftY;
  const mouthY = cy + hh * 0.64 + shiftY;
  const eyeGap = hw * 0.4;
  const eyeR = hw * 0.185;
  const farSide = yaw >= 0 ? -1 : 1;
  const nearScale = 1 - Math.abs(yaw) * 0.16;

  // Neck: starts under the chin and reaches the shoulder line, so the head is
  // never a floating shape.
  paint(
    ctx,
    () => {
      ctx.beginPath();
      ctx.moveTo(cx - hw * 0.42, cy + hh * 0.7);
      ctx.lineTo(cx - hw * 0.5, neckBottom);
      ctx.quadraticCurveTo(cx, neckBottom + (neckBottom - chinY) * 0.18, cx + hw * 0.5, neckBottom);
      ctx.lineTo(cx + hw * 0.42, cy + hh * 0.7);
      ctx.closePath();
    },
    cx,
    cy + hh * 0.7,
    cx,
    neckBottom,
    [
      [0, palette.skinShade],
      [0.55, palette.skin],
      [1, palette.skinShade],
    ],
  );

  // Hair mass behind the skull. Drawn before the face so it can never cover it.
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(cx - yaw * hw * 0.06, cy - hh * 0.18, hw * 1.04, hh * 0.98, 0, 0, Math.PI * 2);
  ctx.fillStyle = linearGradient(ctx, cx - hw, cy - hh, cx + hw, cy + hh, [
    [0, palette.hairLight],
    [0.5, palette.hairMid],
    [1, palette.hair],
  ]);
  ctx.fill();
  if (character === 'woman') {
    // Bob length: two side masses down to the jaw line.
    for (const side of [-1, 1] as const) {
      blob(ctx, cx + side * hw * 0.85, cy + hh * 0.12 + shiftY, hw * 0.36, hh * 0.62);
      ctx.fillStyle = palette.hair;
      ctx.fill();
    }
  }
  ctx.restore();

  // Skull and jaw.
  const skullPath = (): void => {
    ctx.beginPath();
    ctx.moveTo(cx - hw * 0.92, cy - hh * 0.16);
    ctx.bezierCurveTo(cx - hw * 0.96, cy - hh * 0.98, cx + hw * 0.96, cy - hh * 0.98, cx + hw * 0.92, cy - hh * 0.16);
    ctx.bezierCurveTo(cx + hw * 0.84, cy + hh * 0.42, cx + hw * 0.44, chinY - hh * 0.12, cx + shiftX * 0.4, chinY);
    ctx.bezierCurveTo(cx - hw * 0.44, chinY - hh * 0.12, cx - hw * 0.84, cy + hh * 0.42, cx - hw * 0.92, cy - hh * 0.16);
    ctx.closePath();
  };
  paint(ctx, skullPath, cx - hw, cy - hh, cx + hw, cy + hh, [
    [0, palette.skinShade],
    [0.3, palette.skin],
    [0.75, palette.skin],
    [1, palette.skinDeep],
  ]);
  // Cool rim light on the camera-right edge keeps the silhouette readable on a
  // dark plate.
  ctx.save();
  ctx.globalAlpha = 0.3;
  ctx.strokeStyle = palette.rim;
  ctx.lineWidth = Math.max(1.2, hw * 0.022);
  ctx.beginPath();
  ctx.moveTo(cx + hw * 0.9, cy - hh * 0.36);
  ctx.bezierCurveTo(cx + hw * 0.88, cy + hh * 0.05, cx + hw * 0.66, chinY - hh * 0.32, cx + hw * 0.38, chinY - hh * 0.26);
  ctx.stroke();
  ctx.restore();

  // Ear appears only when the head turns far enough to reveal it.
  if (Math.abs(yaw) > 0.2) {
    ctx.save();
    blob(ctx, cx + farSide * hw * 0.88 + shiftX, eyeY + hh * 0.04, hw * 0.1, hh * 0.13);
    ctx.fillStyle = palette.skinShade;
    ctx.fill();
    ctx.restore();
  }

  // Fringe: a cap across the cranium only. Its lower edge sits on the forehead,
  // well above the eyes, so the face stays open.
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(cx - hw * 0.95, cy - hh * 0.1);
  ctx.bezierCurveTo(cx - hw * 1.0, cy - hh * 1.05, cx + hw * 1.0, cy - hh * 1.05, cx + hw * 0.95, cy - hh * 0.1);
  ctx.bezierCurveTo(
    cx + hw * 0.7 - yaw * hw * 0.2,
    cy - hh * 0.34,
    cx + hw * 0.1 - yaw * hw * 0.1,
    cy - hh * 0.44,
    cx - hw * 0.55 - yaw * hw * 0.16,
    cy - hh * 0.3,
  );
  ctx.closePath();
  ctx.fillStyle = linearGradient(ctx, cx - hw, cy - hh, cx + hw, cy, [
    [0, palette.hair],
    [0.45, palette.hairMid],
    [1, palette.hairLight],
  ]);
  ctx.fill();
  ctx.restore();

  // Eyes.
  for (const side of [-1, 1] as const) {
    if (side === farSide && Math.abs(yaw) > 0.62) continue;
    const squash = side === farSide ? nearScale : 1;
    const ex = cx + side * eyeGap + shiftX * (side === farSide ? 1.2 : 1);
    const open = 1 - clamp(pose.lid, 0, 0.9);
    const height = eyeR * 0.66 * open;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(ex - eyeR * squash, eyeY);
    ctx.quadraticCurveTo(ex, eyeY - height * 1.5, ex + eyeR * squash, eyeY);
    ctx.quadraticCurveTo(ex, eyeY + height * 1.1, ex - eyeR * squash, eyeY);
    ctx.fillStyle = '#f8f3ea';
    ctx.fill();
    ctx.clip();
    const irisX = ex + clamp(pose.gazeX, -1, 1) * eyeR * 0.4;
    const irisY = eyeY + clamp(pose.gazeY, -1, 1) * height * 0.6;
    blob(ctx, irisX, irisY, eyeR * 0.5 * squash, eyeR * 0.5);
    ctx.fillStyle = palette.iris;
    ctx.fill();
    blob(ctx, irisX, irisY, eyeR * 0.22 * squash, eyeR * 0.22);
    ctx.fillStyle = '#0a0807';
    ctx.fill();
    blob(ctx, irisX - eyeR * 0.14, irisY - eyeR * 0.16, eyeR * 0.1, eyeR * 0.1);
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fill();
    ctx.restore();
    ctx.beginPath();
    ctx.moveTo(ex - eyeR * squash, eyeY);
    ctx.quadraticCurveTo(ex, eyeY - height * 2.2, ex + eyeR * squash, eyeY);
    ctx.strokeStyle = 'rgba(26,18,20,0.9)';
    ctx.lineWidth = Math.max(1.6, eyeR * 0.16);
    ctx.stroke();
  }

  // Brows.
  for (const side of [-1, 1] as const) {
    if (side === farSide && Math.abs(yaw) > 0.75) continue;
    const bx = cx + side * eyeGap * 1.02 + shiftX * (side === farSide ? 1.2 : 1);
    const base = browY - pose.browLift * hh * 0.05;
    const innerLift = pose.browAngle * hh * 0.06;
    const innerX = bx - side * eyeR * 0.9;
    const outerX = bx + side * eyeR * 1.05;
    stroke(
      ctx,
      [
        [innerX, base - innerLift],
        [bx, base - innerLift * 0.55 - hh * 0.012],
        [outerX, base + pose.browAngle * hh * 0.02],
      ],
      'rgba(30,22,26,0.9)',
      Math.max(2, head.width * 0.022),
    );
  }

  // Nose: a bridge shadow and both wings, not a single hook line.
  ctx.save();
  const nx = cx + shiftX + yaw * hw * 0.05;
  ctx.beginPath();
  ctx.moveTo(nx - hw * 0.02, noseY - hh * 0.16);
  ctx.quadraticCurveTo(nx + hw * 0.05, noseY - hh * 0.02, nx + hw * 0.02, noseY + hh * 0.04);
  ctx.strokeStyle = rgba(palette.skinDeep, 0.45);
  ctx.lineWidth = Math.max(1.6, head.width * 0.016);
  ctx.stroke();
  for (const side of [-1, 1] as const) {
    blob(ctx, nx + side * hw * 0.07, noseY + hh * 0.075, hw * 0.055, hh * 0.022);
    ctx.fillStyle = rgba(palette.skinDeep, 0.35);
    ctx.fill();
  }
  ctx.restore();

  // Mouth.
  ctx.save();
  const mx = cx + shiftX + yaw * hw * 0.04;
  const mw = hw * 0.26;
  if (pose.mouth === 'open') {
    ctx.beginPath();
    ctx.ellipse(mx, mouthY, mw * 0.62, hh * 0.055, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#5b2c2d';
    ctx.fill();
  } else {
    const curve = pose.mouth === 'concern' ? hh * 0.03 : pose.mouth === 'press' ? -hh * 0.006 : hh * 0.014;
    ctx.beginPath();
    ctx.moveTo(mx - mw, mouthY);
    ctx.quadraticCurveTo(mx, mouthY + curve, mx + mw, mouthY);
    ctx.strokeStyle = rgba(palette.lip, pose.mouth === 'press' ? 0.7 : 0.95);
    ctx.lineWidth = Math.max(2, head.width * 0.02);
    ctx.lineCap = 'round';
    ctx.stroke();
    if (character === 'woman') {
      ctx.beginPath();
      ctx.moveTo(mx - mw * 0.55, mouthY - hh * 0.008);
      ctx.quadraticCurveTo(mx, mouthY - hh * 0.02, mx + mw * 0.55, mouthY - hh * 0.008);
      ctx.strokeStyle = rgba(palette.lip, 0.55);
      ctx.lineWidth = Math.max(1.2, head.width * 0.012);
      ctx.stroke();
    }
  }
  ctx.restore();

  // Cheek warmth on the cheekbone, never at the mouth line.
  ctx.save();
  ctx.globalAlpha = 0.22;
  for (const side of [-1, 1] as const) {
    if (side === farSide && Math.abs(yaw) > 0.5) continue;
    blob(ctx, cx + side * hw * 0.42 + shiftX, eyeY + hh * 0.12, hw * 0.13, hh * 0.055);
    ctx.fillStyle = palette.blush;
    ctx.fill();
  }
  ctx.restore();
};

/* -------------------------------------------------------------------------- */
/* Body                                                                       */
/* -------------------------------------------------------------------------- */

type BodyGeometry = {
  cx: number;
  shoulderY: number;
  shoulderHalf: number;
  waistY: number;
  waistHalf: number;
  hipY: number;
  hipHalf: number;
  groundY: number;
  headTop: number;
};

const drawArm = (
  ctx: Ctx,
  shoulder: [number, number],
  hand: [number, number],
  bend: number,
  palette: Palette,
  width: number,
): void => {
  const [sx, sy] = shoulder;
  const [hx, hy] = hand;
  const midX = (sx + hx) / 2 + bend;
  const midY = (sy + hy) / 2;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(sx, sy - width * 0.34);
  ctx.quadraticCurveTo(midX, midY - width * 0.26, hx, hy - width * 0.17);
  ctx.lineTo(hx, hy + width * 0.17);
  ctx.quadraticCurveTo(midX, midY + width * 0.26, sx, sy + width * 0.34);
  ctx.closePath();
  // The sleeve is deliberately a step darker than the coat body: identical
  // fills made the arm vanish into the torso silhouette.
  ctx.fillStyle = linearGradient(ctx, sx, sy, hx, hy, [
    [0, palette.coatShade],
    [0.4, palette.coatShade],
    [1, palette.coatDeep],
  ]);
  ctx.fill();
  ctx.strokeStyle = rgba(palette.coatDeep, 0.55);
  ctx.lineWidth = Math.max(1.5, width * 0.018);
  ctx.stroke();
  ctx.restore();
  ctx.save();
  // Mitten hand with a thumb: a bare circle reads as a floating ball.
  ctx.beginPath();
  ctx.ellipse(hx, hy, width * 0.26, width * 0.3, 0.25, 0, Math.PI * 2);
  ctx.fillStyle = palette.skin;
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(hx - width * 0.16, hy + width * 0.08, width * 0.1, width * 0.17, 0.6, 0, Math.PI * 2);
  ctx.fillStyle = palette.skinShade;
  ctx.fill();
  ctx.restore();
};

const drawLegs = (
  ctx: Ctx,
  body: BodyGeometry,
  palette: Palette,
  shift: number,
): void => {
  const {cx, hipY, hipHalf, groundY} = body;
  for (const side of [-1, 1] as const) {
    const x = cx + side * hipHalf * 0.5 + shift;
    const kneeY = hipY + (groundY - hipY) * 0.52;
    const bootTop = groundY - (groundY - hipY) * 0.17;
    const topWidth = hipHalf * 0.46;
    const ankleWidth = hipHalf * 0.26;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x - topWidth, hipY - 10);
    ctx.quadraticCurveTo(x - topWidth * 0.85, kneeY, x - ankleWidth, bootTop);
    ctx.lineTo(x + ankleWidth, bootTop);
    ctx.quadraticCurveTo(x + topWidth * 0.85, kneeY, x + topWidth, hipY - 10);
    ctx.closePath();
    ctx.fillStyle = linearGradient(ctx, x - topWidth, hipY, x + topWidth, bootTop, [
      [0, palette.trouser],
      [0.6, palette.trouser],
      [1, palette.trouserShade],
    ]);
    ctx.fill();
    ctx.restore();
    ctx.save();
    roundRect(ctx, x - ankleWidth * 1.2, bootTop, ankleWidth * 2.4, groundY - bootTop, 8);
    ctx.fillStyle = palette.boot;
    ctx.fill();
    ctx.restore();
  }
};

const drawTorso = (
  ctx: Ctx,
  body: BodyGeometry,
  pose: PoseSpec,
  palette: Palette,
  character: CharacterId,
): void => {
  const {cx, shoulderY, shoulderHalf, waistY, waistHalf, hipY, hipHalf} = body;
  const lean = pose.lean * shoulderHalf * 0.5;
  const tilt = pose.yaw * shoulderHalf * 0.12;
  const leftShoulder = cx - shoulderHalf + lean - tilt;
  const rightShoulder = cx + shoulderHalf + lean + tilt;
  const hemY = character === 'woman' ? hipY + (body.groundY - hipY) * 0.2 : hipY + 60;

  paint(
    ctx,
    () => {
      ctx.beginPath();
      ctx.moveTo(leftShoulder, shoulderY);
      ctx.quadraticCurveTo(cx - waistHalf * 1.1 + lean, waistY - 50, cx - hipHalf + lean * 0.6, hipY);
      ctx.lineTo(cx - hipHalf * 1.02 + lean * 0.5, hemY);
      ctx.quadraticCurveTo(cx + lean * 0.4, hemY + 26, cx + hipHalf * 1.02 + lean * 0.5, hemY);
      ctx.lineTo(cx + hipHalf + lean * 0.6, hipY);
      ctx.quadraticCurveTo(cx + waistHalf * 1.1 + lean, waistY - 50, rightShoulder, shoulderY);
      ctx.quadraticCurveTo(cx + lean, shoulderY - body.shoulderHalf * 0.3, leftShoulder, shoulderY);
      ctx.closePath();
    },
    cx - shoulderHalf,
    shoulderY,
    cx + shoulderHalf,
    hemY,
    [
      [0, palette.coat],
      [0.38, palette.coat],
      [0.82, palette.coatShade],
      [1, palette.coatDeep],
    ],
  );

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(cx - waistHalf * 0.4 + lean, shoulderY + 26);
  ctx.lineTo(cx + lean * 0.6, shoulderY + 120);
  ctx.lineTo(cx + waistHalf * 0.4 + lean, shoulderY + 26);
  ctx.strokeStyle = rgba(palette.coatDeep, 0.5);
  ctx.lineWidth = Math.max(2, ctx.lineWidth);
  ctx.stroke();
  ctx.restore();

  if (character === 'woman') {
    ctx.save();
    // Scarf collar follows the neck instead of floating as a wide disc.
    ctx.beginPath();
    ctx.ellipse(cx + lean, shoulderY - 4, shoulderHalf * 0.34, 26, 0, 0, Math.PI * 2);
    ctx.fillStyle = palette.scarf;
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(cx + lean, shoulderY - 4, shoulderHalf * 0.34, 26, 0, Math.PI * 0.15, Math.PI * 0.85);
    ctx.strokeStyle = rgba(palette.scarfShade, 0.8);
    ctx.lineWidth = 6;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx + shoulderHalf * 0.16 + lean, shoulderY + 4);
    ctx.quadraticCurveTo(cx + shoulderHalf * 0.3 + lean, shoulderY + 150, cx + shoulderHalf * 0.06 + lean, shoulderY + 250);
    ctx.lineTo(cx - shoulderHalf * 0.14 + lean, shoulderY + 246);
    ctx.quadraticCurveTo(cx + shoulderHalf * 0.02 + lean, shoulderY + 140, cx - shoulderHalf * 0.06 + lean, shoulderY + 6);
    ctx.closePath();
    ctx.fillStyle = palette.scarfShade;
    ctx.fill();
    ctx.restore();
  } else {
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(cx - shoulderHalf * 0.34 + lean, shoulderY + 10);
    ctx.lineTo(cx + lean, shoulderY + 86);
    ctx.lineTo(cx + shoulderHalf * 0.34 + lean, shoulderY + 10);
    ctx.strokeStyle = palette.coatDeep;
    ctx.lineWidth = 5;
    ctx.stroke();
    ctx.restore();
  }
};

/**
 * Paints one character pose. `framing` selects how much body is visible; the
 * head model, palette and proportions are identical in both framings.
 */
export const drawCharacterPose = (
  ctx: Ctx,
  width: number,
  height: number,
  character: CharacterId,
  pose: PoseSpec,
  framing: Framing,
): void => {
  const palette = character === 'woman' ? WOMAN : MAN;
  const cx = width * 0.5 + pose.bodyShift * width;

  if (framing === 'bust') {
    const headWidth = width * 0.36;
    const headHeight = height * 0.46;
    const headTop = height * 0.08;
    const shoulderY = height * 0.6;
    const body: BodyGeometry = {
      cx,
      shoulderY,
      shoulderHalf: width * 0.36,
      waistY: height * 1.05,
      waistHalf: width * 0.44,
      hipY: height * 1.25,
      hipHalf: width * 0.5,
      groundY: height * 1.7,
      headTop,
    };
    drawTorso(ctx, body, pose, palette, character);
    drawHead(
      ctx,
      {
        cx,
        cy: headTop + headHeight * 0.5,
        width: headWidth,
        height: headHeight,
        neckBottom: shoulderY + height * 0.03,
      },
      pose,
      palette,
      character,
    );
    return;
  }

  const groundY = height * 0.985;
  const headHeight = height * 0.2;
  const headTop = height * 0.035;
  const shoulderY = headTop + headHeight * 1.16;
  const body: BodyGeometry = {
    cx,
    shoulderY,
    shoulderHalf: width * 0.165,
    waistY: height * 0.55,
    waistHalf: width * 0.13,
    hipY: height * 0.62,
    hipHalf: width * 0.145,
    groundY,
    headTop,
  };

  drawLegs(ctx, body, palette, pose.bodyShift * width);
  const armY = shoulderY + 24;
  const shoulderFor = (side: -1 | 1): [number, number] => [
    cx + side * body.shoulderHalf * 0.96 + pose.lean * body.shoulderHalf * 0.5,
    armY,
  ];
  const handFor = (side: -1 | 1): [number, number] => {
    const arm = side === -1 ? pose.leftArm : pose.rightArm;
    const [sx] = shoulderFor(side);
    if (arm === 'reach') return [sx + side * width * 0.28, armY + height * 0.03];
    if (arm === 'chest') return [sx - side * width * 0.06, armY + height * 0.115];
    return [sx + side * width * 0.025, armY + height * 0.24];
  };
  const drawArms = (): void => {
    for (const side of [-1, 1] as const) {
      drawArm(
        ctx,
        shoulderFor(side),
        handFor(side),
        side * body.shoulderHalf * 0.1,
        palette,
        width * 0.092,
      );
    }
  };

  // Sleeves always sit in front of the coat body; a down arm tucked behind the
  // silhouette would read as a missing limb.
  drawTorso(ctx, body, pose, palette, character);
  drawArms();
  drawHead(
    ctx,
    {
      cx,
      cy: headTop + headHeight * 0.5,
      width: width * 0.155,
      height: headHeight,
      neckBottom: shoulderY + 12,
    },
    pose,
    palette,
    character,
  );

  ctx.save();
  ctx.globalAlpha = 0.3;
  blob(ctx, cx, groundY + height * 0.004, width * 0.17, height * 0.018);
  ctx.fillStyle = '#0a0d12';
  ctx.fill();
  ctx.restore();
};

export const WOMAN_POSE_SPECS = WOMAN_POSES;
export const MAN_POSE_SPECS = MAN_POSES;

/** Exposed so the pose sheet and continuity board use the same table. */
export const CHARACTER_POSE_TABLE: Readonly<
  Record<CharacterId, ReadonlyArray<{pose: PoseSpec; width: number; height: number; pivotY: number}>>
> = {
  woman: WOMAN_POSES.map((pose) => ({pose, width: 1000, height: 1400, pivotY: 0.985})),
  man: MAN_POSES.map((pose) => ({pose, width: 1000, height: 1400, pivotY: 0.985})),
};

export const BUST_POSES: ReadonlyArray<{pose: PoseSpec; width: number; height: number; pivotY: number}> =
  WOMAN_POSES.map((pose) => ({pose, width: 1400, height: 1400, pivotY: 1}));

export const MAN_POSE_COUNT = MAN_POSES.length;
export const WOMAN_POSE_COUNT = WOMAN_POSES.length;