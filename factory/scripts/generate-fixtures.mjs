// Generates the synthetic fixtures used by the factory examples.
// All audio is a locally synthesized sine tone; all images are procedural.
// No third-party or copyrighted media is involved.

import {createHash} from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {deflateSync} from 'node:zlib';

const here = path.dirname(fileURLToPath(import.meta.url));
const examples = path.resolve(here, '..', 'examples', 'projects');

const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');

const examplesReal = realpathSync(examples);

// Fixture writes are engine-owned static paths. Reject links or paths that
// escape the examples directory before creating anything.
const assertFixtureTarget = (file) => {
  const absolute = path.resolve(file);
  if (!absolute.startsWith(examplesReal + path.sep)) {
    throw new Error(`Fixture path escapes examples: ${absolute}`);
  }
  let current = examplesReal;
  for (const segment of path.relative(examplesReal, absolute).split(path.sep)) {
    current = path.join(current, segment);
    if (!existsSync(current)) break;
    if (lstatSync(current).isSymbolicLink()) {
      throw new Error(`Fixture path contains a link: ${current}`);
    }
    if (!realpathSync(current).startsWith(examplesReal + path.sep)) {
      throw new Error(`Fixture path escapes examples: ${current}`);
    }
  }
};

const writeWav = (file, seconds, frequency) => {
  const sampleRate = 48000;
  const channels = 1;
  const bits = 16;
  const samples = Math.round(seconds * sampleRate);
  const dataSize = samples * channels * (bits / 8);
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * channels * (bits / 8), 28);
  buffer.writeUInt16LE(channels * (bits / 8), 32);
  buffer.writeUInt16LE(bits, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  const fadeSamples = Math.round(sampleRate * 0.02);
  for (let i = 0; i < samples; i++) {
    const fadeIn = Math.min(1, i / fadeSamples);
    const fadeOut = Math.min(1, (samples - 1 - i) / fadeSamples);
    const value = Math.sin((2 * Math.PI * frequency * i) / sampleRate) * 0.2 * fadeIn * fadeOut;
    buffer.writeInt16LE(Math.round(value * 32767), 44 + i * 2);
  }

  assertFixtureTarget(file);
  mkdirSync(path.dirname(file), {recursive: true});
  writeFileSync(file, buffer);
  return {file, samples, sampleRate, dataSize};
};

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

const crc32 = (buffer) => {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
};

const pngChunk = (type, data) => {
  const name = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([name, data])), 0);
  return Buffer.concat([length, name, data, crc]);
};

const writePng = (file, width, height) => {
  const rowSize = width * 4 + 1;
  const raw = Buffer.alloc(rowSize * height);
  for (let y = 0; y < height; y++) {
    const row = y * rowSize;
    raw[row] = 0;
    for (let x = 0; x < width; x++) {
      const index = row + 1 + x * 4;
      const k = y / (height - 1);
      raw[index] = Math.round(18 + 30 * k);
      raw[index + 1] = Math.round(48 + 120 * (1 - k));
      raw[index + 2] = Math.round(68 + 80 * (1 - k));
      raw[index + 3] = 255;
      const dx = x - width / 2;
      const dy = y - height * 0.42;
      const distance = Math.sqrt(dx * dx + dy * dy);
      if (distance < 180) {
        const glow = 1 - distance / 180;
        raw[index] = Math.min(255, raw[index] + Math.round(80 * glow));
        raw[index + 1] = Math.min(255, raw[index + 1] + Math.round(40 * glow));
      }
      if (x % 120 === 0 || y % 120 === 0) {
        raw[index] = Math.min(255, raw[index] + 18);
        raw[index + 1] = Math.min(255, raw[index + 1] + 18);
        raw[index + 2] = Math.min(255, raw[index + 2] + 18);
      }
    }
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;

  assertFixtureTarget(file);
  mkdirSync(path.dirname(file), {recursive: true});
  writeFileSync(
    file,
    Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      pngChunk('IHDR', header),
      pngChunk('IDAT', deflateSync(raw, {level: 9})),
      pngChunk('IEND', Buffer.alloc(0)),
    ]),
  );
};

const pixelWav = path.join(examples, 'synthetic-pixel-demo', 'source', 'audio', 'tone-2s.wav');
const layeredWav = path.join(examples, 'synthetic-layered-demo', 'source', 'audio', 'tone-1.5s.wav');
const layeredImage = path.join(examples, 'synthetic-layered-demo', 'assets', 'images', 'bg.png');

writeWav(pixelWav, 2, 440);
writeWav(layeredWav, 1.5, 330);
writePng(layeredImage, 1080, 1350);

console.log(JSON.stringify({
  'synthetic-pixel-demo': {
    audio: {path: 'source/audio/tone-2s.wav', sha256: sha256(pixelWav)},
  },
  'synthetic-layered-demo': {
    audio: {path: 'source/audio/tone-1.5s.wav', sha256: sha256(layeredWav)},
    image: {path: 'assets/images/bg.png', sha256: sha256(layeredImage)},
  },
}, null, 2));
