import {rmSync} from 'node:fs';
import {after, before, test} from 'node:test';
import assert from 'node:assert/strict';
import {loadProject} from '../src/project/loadProject';
import {durationFramesFromSeconds} from '../src/config/duration';
import {
  buildSceneFrameInfo,
  computeAnimationTick,
} from '../src/timeline/frameClock';
import {
  assertShotCoverage,
  resolveShotAtFrame,
  resolveShots,
} from '../src/timeline/resolver';
import {TimelineError} from '../src/errors';
import {REPO_ROOT, cloneProject, makeWorkspace} from './helpers';

let workspace: string;

before(() => {
  workspace = makeWorkspace();
  cloneProject(workspace, 'synthetic-pixel-demo', 'odd-boundary-demo', (config) => {
    config.chapters[0].endFrame = 25;
    config.chapters[0].shots[0].endFrame = 25;
    config.chapters[1].startFrame = 25;
    config.chapters[1].shots[0].startFrame = 25;
  });
});

after(() => {
  rmSync(workspace, {recursive: true, force: true});
});

test('G07: every output frame resolves; final frame and boundaries are exact', () => {
  const pixel = loadProject('synthetic-pixel-demo', {workspaceRoot: workspace, engineRoot: REPO_ROOT});
  const shots = resolveShots(pixel.config.chapters);
  assertShotCoverage(shots, pixel.durationInFrames);

  for (let frame = 0; frame < pixel.durationInFrames; frame++) {
    const entry = resolveShotAtFrame(shots, frame, pixel.durationInFrames);
    assert.ok(frame >= entry.shot.startFrame && frame < entry.shot.endFrame);
  }
  assert.equal(resolveShotAtFrame(shots, 0, pixel.durationInFrames).shot.id, 'SHOT-01');
  assert.equal(resolveShotAtFrame(shots, 23, pixel.durationInFrames).shot.id, 'SHOT-01');
  assert.equal(resolveShotAtFrame(shots, 24, pixel.durationInFrames).shot.id, 'SHOT-02');
  assert.equal(resolveShotAtFrame(shots, 47, pixel.durationInFrames).shot.id, 'SHOT-02');
  assert.throws(() => resolveShotAtFrame(shots, 48, pixel.durationInFrames), TimelineError);
  assert.throws(() => resolveShotAtFrame(shots, -1, pixel.durationInFrames), TimelineError);

  const layered = loadProject('synthetic-layered-demo', {workspaceRoot: workspace, engineRoot: REPO_ROOT});
  const layeredShots = resolveShots(layered.config.chapters);
  assert.equal(resolveShotAtFrame(layeredShots, 19, layered.durationInFrames).shot.id, 'SHOT-01');
  assert.equal(resolveShotAtFrame(layeredShots, 20, layered.durationInFrames).shot.id, 'SHOT-02');
  assert.equal(resolveShotAtFrame(layeredShots, 44, layered.durationInFrames).shot.id, 'SHOT-02');
});

test('G08: selection happens before sampling and odd cuts keep tick zero', () => {
  const project = loadProject('odd-boundary-demo', {workspaceRoot: workspace, engineRoot: REPO_ROOT});
  const shots = resolveShots(project.config.chapters);
  assert.equal(shots[0].shot.endFrame, 25);

  const beforeBoundary = resolveShotAtFrame(shots, 24, project.durationInFrames);
  const atBoundary = resolveShotAtFrame(shots, 25, project.durationInFrames);
  assert.equal(beforeBoundary.shot.id, 'SHOT-01');
  assert.equal(atBoundary.shot.id, 'SHOT-02');

  const frame24 = buildSceneFrameInfo(24, beforeBoundary.shot.startFrame, 24, 12, 48);
  const frame25 = buildSceneFrameInfo(25, atBoundary.shot.startFrame, 24, 12, 48);
  assert.equal(frame24.animationTick, 12);
  assert.equal(frame25.localFrame, 0);
  assert.equal(frame25.animationTick, 0);
});

test('sampling uses exact rational math for non-integer ratios', () => {
  assert.equal(computeAnimationTick(0, 30, 12), 0);
  assert.equal(computeAnimationTick(1, 30, 12), 0);
  assert.equal(computeAnimationTick(2, 30, 12), 0);
  assert.equal(computeAnimationTick(3, 30, 12), 1);
  assert.equal(computeAnimationTick(5, 30, 12), 2);
  assert.equal(computeAnimationTick(29, 30, 12), 11);
  assert.equal(computeAnimationTick(47, 24, 12), 23);
  assert.throws(() => computeAnimationTick(-1, 24, 12), TimelineError);
});

test('audio duration policies and frame rounding are explicit', () => {
  assert.equal(durationFramesFromSeconds(2, 24, 'round'), 48);
  assert.equal(durationFramesFromSeconds(1.49, 24, 'floor'), 35);
  assert.equal(durationFramesFromSeconds(1.49, 24, 'ceil'), 36);
  assert.equal(durationFramesFromSeconds(1.49, 24, 'round'), 36);
  assert.equal(durationFramesFromSeconds(1.5, 30, 'round'), 45);
});
