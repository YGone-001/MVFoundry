import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import {probeImagePng, probeLayerPng} from '../src/media/pngProbe';
import {MediaError} from '../src/errors';

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const IEND = Buffer.from([0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]);

const pngBytes = (
  width: number,
  height: number,
  bitDepth: number,
  colorType: number,
  options: {signature?: boolean; iend?: boolean; ihdr?: boolean} = {},
): Buffer => {
  const header = Buffer.alloc(33);
  (options.signature === false ? Buffer.alloc(8, 0) : PNG_SIGNATURE).copy(header, 0);
  header.writeUInt32BE(13, 8);
  header.write(options.ihdr === false ? 'XXXX' : 'IHDR', 12, 'ascii');
  header.writeUInt32BE(width, 16);
  header.writeUInt32BE(height, 20);
  header[24] = bitDepth;
  header[25] = colorType;
  return options.iend === false ? header : Buffer.concat([header, IEND]);
};

const write = (dir: string, name: string, bytes: Buffer): string => {
  const file = path.join(dir, name);
  writeFileSync(file, bytes);
  return file;
};

test('ordinary RGB and RGBA PNGs are accepted as images', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'mvfoundry-image-probe-'));
  try {
    const rgb = probeImagePng(write(dir, 'rgb.png', pngBytes(640, 360, 8, 2)), 'IMG-RGB');
    assert.deepEqual(
      {width: rgb.width, height: rgb.height, bitDepth: rgb.bitDepth, colorType: rgb.colorType, hasAlpha: rgb.hasAlpha},
      {width: 640, height: 360, bitDepth: 8, colorType: 2, hasAlpha: false},
    );

    const rgba = probeImagePng(write(dir, 'rgba.png', pngBytes(1920, 1080, 8, 6)), 'IMG-RGBA');
    assert.equal(rgba.hasAlpha, true);

    const gray = probeImagePng(write(dir, 'gray.png', pngBytes(64, 64, 8, 0)), 'IMG-GRAY');
    assert.equal(gray.hasAlpha, false);

    const grayAlpha = probeImagePng(write(dir, 'gray-alpha.png', pngBytes(64, 64, 8, 4)), 'IMG-GRAY-A');
    assert.equal(grayAlpha.hasAlpha, true);
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});

test('transparent layers still require alpha-capable PNG data', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'mvfoundry-layer-strict-'));
  try {
    const rgba = write(dir, 'rgba.png', pngBytes(256, 256, 8, 6));
    assert.equal(probeLayerPng(rgba, 'LAYER-RGBA').hasAlpha, true);

    const rgb = write(dir, 'rgb.png', pngBytes(256, 256, 8, 2));
    assert.throws(() => probeLayerPng(rgb, 'LAYER-RGB'), /alpha PNG/);

    const gray = write(dir, 'gray.png', pngBytes(256, 256, 8, 0));
    assert.throws(() => probeLayerPng(gray, 'LAYER-GRAY'), /alpha PNG/);

    const jpeg = write(dir, 'photo.jpg', Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46]));
    assert.throws(() => probeLayerPng(jpeg, 'LAYER-JPEG'), /not a PNG/);
    assert.throws(() => probeImagePng(jpeg, 'IMG-JPEG'), /not a PNG/);
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});

test('unsupported, corrupt and oversized PNG data is refused', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'mvfoundry-image-negative-'));
  try {
    assert.throws(
      () => probeImagePng(write(dir, 'deep.png', pngBytes(100, 100, 16, 6)), 'DEEP'),
      /8-bit/,
    );
    assert.throws(
      () => probeImagePng(write(dir, 'palette.png', pngBytes(100, 100, 8, 3)), 'PALETTE'),
      /palette/,
    );
    assert.throws(
      () => probeImagePng(write(dir, 'huge.png', pngBytes(9000, 100, 8, 2)), 'HUGE'),
      /exceed/,
    );
    assert.throws(
      () => probeImagePng(write(dir, 'bad-signature.png', pngBytes(16, 16, 8, 2, {signature: false})), 'SIG'),
      /not a PNG/,
    );
    assert.throws(
      () => probeImagePng(write(dir, 'bad-ihdr.png', pngBytes(16, 16, 8, 2, {ihdr: false})), 'IHDR'),
      /IHDR/,
    );
    assert.throws(
      () => probeImagePng(write(dir, 'truncated.png', pngBytes(16, 16, 8, 2, {iend: false})), 'TRUNC'),
      /truncated/,
    );
    assert.throws(
      () => probeImagePng(write(dir, 'zero.png', pngBytes(0, 16, 8, 2)), 'ZERO'),
      /invalid dimensions/,
    );
    assert.throws(() => probeImagePng(path.join(dir, 'missing.png'), 'MISSING'), MediaError);
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});