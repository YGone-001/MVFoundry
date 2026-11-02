import {execFileSync, spawnSync} from 'node:child_process';
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import {probeVideo} from '../src/media/videoProbe';
import {probeLayerPng} from '../src/media/pngProbe';
import {MediaError} from '../src/errors';

const hasCommand = (command: string): boolean =>
  spawnSync(command, ['-version'], {stdio: 'ignore', windowsHide: true}).status === 0;

const writePngHeader = (
  file: string,
  width: number,
  height: number,
  bitDepth = 8,
  colorType = 6,
): void => {
  // IHDR plus a terminating IEND so the fixture is a structurally complete
  // PNG; the probe deliberately checks for truncation.
  const buffer = Buffer.alloc(45);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(buffer, 0);
  buffer.writeUInt32BE(13, 8);
  buffer.write('IHDR', 12, 'ascii');
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  buffer[24] = bitDepth;
  buffer[25] = colorType;
  buffer.writeUInt32BE(0, 33);
  buffer.write('IEND', 37, 'ascii');
  buffer.writeUInt32BE(0xae426082, 41);
  writeFileSync(file, buffer);
};

test('FFprobe validates local H.264 MP4 media and rejects unsupported media', (t) => {
  if (!hasCommand('ffmpeg') || !hasCommand('ffprobe')) {
    t.skip('ffmpeg/ffprobe are unavailable on this host');
    return;
  }
  const dir = mkdtempSync(path.join(tmpdir(), 'mvfoundry-media-probe-'));
  try {
    const valid = path.join(dir, 'valid.mp4');
    execFileSync(
      'ffmpeg',
      [
        '-y',
        '-v',
        'error',
        '-f',
        'lavfi',
        '-i',
        'color=c=red:s=320x240:r=24:d=1',
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=950:sample_rate=48000:duration=1',
        '-c:v',
        'libx264',
        '-pix_fmt',
        'yuv420p',
        '-c:a',
        'aac',
        '-shortest',
        valid,
      ],
      {stdio: 'ignore', windowsHide: true},
    );
    const metadata = probeVideo(valid, 'VIDEO-01');
    assert.equal(metadata.container, 'mp4');
    assert.equal(metadata.codec, 'h264');
    assert.equal(metadata.width, 320);
    assert.equal(metadata.height, 240);
    assert.equal(metadata.fps, 24);
    assert.ok(Math.abs(metadata.durationSeconds - 1) < 0.05);
    assert.equal(metadata.hasAudio, true);
    assert.equal(metadata.pixelFormat, 'yuv420p');
    assert.equal(metadata.rotation, 0);

    const corrupt = path.join(dir, 'corrupt.mp4');
    writeFileSync(corrupt, 'not a media container');
    assert.throws(() => probeVideo(corrupt, 'CORRUPT'), MediaError);
    assert.throws(() => probeVideo(path.join(dir, 'missing.mp4'), 'MISSING'), MediaError);

    const unsupported = path.join(dir, 'unsupported.mp4');
    try {
      execFileSync(
        'ffmpeg',
        ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=160x120:r=24:d=0.2', '-c:v', 'mpeg4', unsupported],
        {stdio: 'ignore', windowsHide: true},
      );
      assert.throws(() => probeVideo(unsupported, 'UNSUPPORTED'), /unsupported|H\.264/);
    } catch (error) {
      if (error instanceof assert.AssertionError) throw error;
      t.skip('mpeg4 encoder is unavailable for the unsupported-codec fixture');
    }
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});

test('layer validation requires an 8-bit alpha PNG with safe dimensions', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'mvfoundry-layer-probe-'));
  try {
    const valid = path.join(dir, 'valid.png');
    writePngHeader(valid, 1080, 1920, 8, 6);
    const metadata = probeLayerPng(valid, 'LAYER-01');
    assert.equal(metadata.width, 1080);
    assert.equal(metadata.height, 1920);
    assert.equal(metadata.hasAlpha, true);

    const opaque = path.join(dir, 'opaque.png');
    writePngHeader(opaque, 100, 100, 8, 2);
    assert.throws(() => probeLayerPng(opaque, 'OPAQUE'), /alpha PNG/);

    const deep = path.join(dir, 'deep.png');
    writePngHeader(deep, 100, 100, 16, 6);
    assert.throws(() => probeLayerPng(deep, 'DEEP'), /8-bit/);

    const zero = path.join(dir, 'zero.png');
    writePngHeader(zero, 0, 100, 8, 6);
    assert.throws(() => probeLayerPng(zero, 'ZERO'), /invalid dimensions/);
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});
