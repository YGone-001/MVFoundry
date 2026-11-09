// Registers the P1-G-C character pose inventory as art plates.
//
// Every pose is a separate approved PNG because the performance route swaps
// drawings instead of deforming a single illustration. Names are prefixed
// `actor-` so the P1-G-B `cinematic-*` and `anime-*` sets stay byte-identical.

import type {ArtPlateSpec} from './plates';
import type {Ctx} from './shared';
import type {PoseSpec} from './characterPoses';
import {
  BUST_POSES,
  CHARACTER_POSE_TABLE,
  MAN_POSE_COUNT,
  WOMAN_POSE_COUNT,
  drawCharacterPose,
} from './characterPoses';

const spec = (
  character: 'woman' | 'man',
  framing: 'full' | 'bust',
  entry: {pose: PoseSpec; width: number; height: number},
  pivotY: number,
): ArtPlateSpec => ({
  name: `actor-${character}-${framing}-${entry.pose.id}`,
  width: entry.width,
  height: entry.height,
  opaque: false,
  note: `${character} ${framing} pose "${entry.pose.id}" (${entry.pose.label}); pivot (0.5, ${pivotY})`,
  draw: (ctx: Ctx, width: number, height: number) =>
    drawCharacterPose(ctx, width, height, character, entry.pose, framing),
});

export const CHARACTER_PLATES: readonly ArtPlateSpec[] = Object.freeze([
  ...CHARACTER_POSE_TABLE.woman.map((entry) => spec('woman', 'full', entry, entry.pivotY)),
  ...CHARACTER_POSE_TABLE.man.map((entry) => spec('man', 'full', entry, entry.pivotY)),
  ...BUST_POSES.map((entry) => spec('woman', 'bust', entry, entry.pivotY)),
]);

export const CHARACTER_PLATE_COUNT = {
  womanFull: WOMAN_POSE_COUNT,
  manFull: MAN_POSE_COUNT,
  womanBust: BUST_POSES.length,
};