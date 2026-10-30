// Generates the synthetic fixtures used by the factory examples.
// All audio is a locally synthesized sine tone; all images are procedural.
// No third-party or copyrighted media is involved.

import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const examples = path.resolve(here, '..', 'examples', 'projects');

const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');

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

  mkdirSync(path.dirname(file), {recursive: true});
  writeFileSync(file, buffer);
  return {file, samples, sampleRate, dataSize};
};

const writePng = (file, width, height) => {
  const raw = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = (y * width + x) * 4;
      const k = y / (height - 1);
      raw[index] = Math.round(18 + 30 * k);
      raw[index + 1] = Math.round(48 + 120 * (1 - k));
      raw[index + 2] = Math.round(68 + 80 * (1 - k));
      raw[index + 3] = 255;
      const dx = x - width / 2;
      const dy = y - height * 0.42;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 180) {
        const glow = 1 - dist / 180;
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

  const tempRaw = path.join(tmpdir(), `mv-factory-bg-${process.pid}.rgba`);
  writeFileSync(tempRaw, raw);
  mkdirSync(path.dirname(file), {recursive: true});
  try {
    execFileSync(
      'ffmpeg',
      ['-v', 'error', '-f', 'rawvideo', '-pixel_format', 'rgba', '-video_size', `${width}x${height}`, '-i', tempRaw, '-frames:v', '1', '-y', file],
      {stdio: 'inherit'},
    );
  } finally {
    rmSync(tempRaw, {force: true});
  }
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
