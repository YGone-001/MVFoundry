import assert from 'node:assert/strict';
import {execFileSync, spawnSync} from 'node:child_process';
import {existsSync, mkdtempSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  NORMALIZATION_PROFILE,
  frameTimingPolicy,
  inspectVideoDeep,
  normalizeVideo,
} from '../src/media/videoNormalize';

const hasFfmpeg = (): boolean => {
  const probe = spawnSync('ffmpeg', ['-version'], {encoding: 'utf8', windowsHide: true});
  return probe.status === 0;
};

const ffmpeg = (args: string[]): void => {
  execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...args], {
    stdio: 'pipe',
    windowsHide: true,
  });
};

type Fixtures = {
  dir: string;
  cfr: string;
  vfr: string;
  rotated: string;
  corrupt: string;
};

const buildFixtures = (): Fixtures => {
  const dir = mkdtempSync(path.join(tmpdir(), 'mv-normalize-'));
  const cfr = path.join(dir, 'cfr.mp4');
  ffmpeg([
    '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=30:duration=2',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest',
    '-movflags', '+faststart', cfr,
  ]);
  const vfr = path.join(dir, 'vfr.mp4');
  ffmpeg([
    '-i', cfr,
    '-vf', "select='not(mod(n\\,2))+not(mod(n\\,3))'",
    '-fps_mode', 'passthrough',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'copy',
    '-movflags', '+faststart', vfr,
  ]);
  const rotated = path.join(dir, 'rotated.mp4');
  ffmpeg(['-display_rotation', '90', '-i', vfr, '-c', 'copy', rotated]);
  const corrupt = path.join(dir, 'corrupt.mp4');
  writeFileSync(corrupt, Buffer.from('this is definitely not an mp4 container'));
  return {dir, cfr, vfr, rotated, corrupt};
};

test('P1-E-D G13: deep inspection reports real container, timing and decode evidence', (t) => {
  if (!hasFfmpeg()) {
    t.skip('ffmpeg is unavailable on this host');
    return;
  }
  const fixtures = buildFixtures();

  const cfr = inspectVideoDeep(fixtures.cfr, 'cfr');
  assert.equal(cfr.codec, 'h264');
  assert.equal(cfr.pixelFormat, 'yuv420p');
  assert.equal(cfr.width, 320);
  assert.equal(cfr.height, 180);
  assert.equal(cfr.rotation, 0);
  assert.equal(cfr.decodesCleanly, true);
  assert.equal(cfr.audioStreamCount, 1);
  assert.equal(cfr.timing.variableFrameRate, false);
  assert.ok(Math.abs(cfr.averageFrameRate - 30) < 0.01);

  const vfr = inspectVideoDeep(fixtures.vfr, 'vfr');
  assert.equal(vfr.decodesCleanly, true);
  assert.ok(
    vfr.timing.variableFrameRate || Math.abs(vfr.nominalFrameRate - vfr.averageFrameRate) > 0.01,
    `VFR evidence missing: nominal ${vfr.nominalFrameRate}, average ${vfr.averageFrameRate}, timing ${JSON.stringify(vfr.timing)}`,
  );

  const rotated = inspectVideoDeep(fixtures.rotated, 'rotated');
  assert.ok(Math.abs(rotated.rotation) > 0.01, 'rotation metadata must be visible to the inspector');

  assert.throws(() => inspectVideoDeep(fixtures.corrupt, 'corrupt'), /no video stream|duration|malformed|ffprobe exited/i);
});

test('P1-E-D G13: normalization converts VFR + rotation + audio into one reviewed profile', (t) => {
  if (!hasFfmpeg()) {
    t.skip('ffmpeg is unavailable on this host');
    return;
  }
  const fixtures = buildFixtures();
  const derivedPath = path.join(fixtures.dir, 'derived.mp4');
  const outcome = normalizeVideo({
    sourcePath: fixtures.rotated,
    destinationPath: derivedPath,
    label: 'rotated vfr fixture',
    targetFps: 24,
    targetWidth: 640,
    targetHeight: 360,
    requiredDurationSeconds: 1.5,
  });

  assert.ok(outcome.source.audioStreamCount === 1, 'the source fixture carries an audio stream');
  assert.equal(outcome.derived.codec, 'h264');
  assert.equal(outcome.derived.pixelFormat, 'yuv420p');
  assert.equal(outcome.derived.width, 640);
  assert.equal(outcome.derived.height, 360);
  assert.ok(Math.abs(outcome.derived.averageFrameRate - 24) < 1e-3);
  assert.equal(outcome.derived.rotation, 0);
  assert.equal(outcome.derived.decodesCleanly, true);
  assert.equal(outcome.derived.audioStreamCount, 0);
  assert.ok(outcome.derived.durationSeconds >= 1.5);
  assert.equal(outcome.rotationCorrection, 90);
  assert.ok(existsSync(derivedPath));
  assert.ok(outcome.arguments.includes('-autorotate'));
  assert.ok(outcome.arguments.some((entry) => entry.startsWith('fps=24')));
  assert.ok(outcome.arguments.includes('<source>'));
  assert.ok(outcome.arguments.includes('<derived>'));
  assert.ok(!outcome.arguments.some((entry) => entry.includes(fixtures.dir)), 'arguments must not leak local paths');
  assert.equal(outcome.profile.container, 'mp4');
  assert.equal(outcome.profile.audioPolicy, 'strip');
  assert.equal(outcome.profile.scaling, 'fit-pad');
  assert.equal(NORMALIZATION_PROFILE.version, 'video-normalize-v1');

  const policy = frameTimingPolicy(outcome);
  assert.match(policy.frameDropPolicy, /drop|no drop/);
  assert.match(policy.frameDuplicationPolicy, /duplicat|no duplication/);
});

test('P1-E-D G13: normalization refuses an insufficient usable duration', (t) => {
  if (!hasFfmpeg()) {
    t.skip('ffmpeg is unavailable on this host');
    return;
  }
  const fixtures = buildFixtures();
  assert.throws(
    () => normalizeVideo({
      sourcePath: fixtures.cfr,
      destinationPath: path.join(fixtures.dir, 'too-short.mp4'),
      label: 'short fixture',
      targetFps: 24,
      targetWidth: 640,
      targetHeight: 360,
      requiredDurationSeconds: 30,
    }),
    /required/,
  );
});

test('P1-E-D G13: normalization refuses corrupt input and invalid targets', (t) => {
  if (!hasFfmpeg()) {
    t.skip('ffmpeg is unavailable on this host');
    return;
  }
  const fixtures = buildFixtures();
  assert.throws(
    () => normalizeVideo({
      sourcePath: fixtures.corrupt,
      destinationPath: path.join(fixtures.dir, 'corrupt-out.mp4'),
      label: 'corrupt fixture',
      targetFps: 24,
      targetWidth: 640,
      targetHeight: 360,
      requiredDurationSeconds: 1,
    }),
    /no video stream|duration|malformed|ffprobe exited/i,
  );
  assert.throws(
    () => normalizeVideo({
      sourcePath: fixtures.cfr,
      destinationPath: path.join(fixtures.dir, 'odd.mp4'),
      label: 'odd target',
      targetFps: 24,
      targetWidth: 641,
      targetHeight: 360,
      requiredDurationSeconds: 1,
    }),
    /must be even/,
  );
  assert.throws(
    () => normalizeVideo({
      sourcePath: fixtures.cfr,
      destinationPath: path.join(fixtures.dir, 'rate.mp4'),
      label: 'bad rate',
      targetFps: 0,
      targetWidth: 640,
      targetHeight: 360,
      requiredDurationSeconds: 1,
    }),
    /frame rate/,
  );
});
