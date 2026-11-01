// Procedural synthetic media helpers shared by the external-workspace seeds.
//
// Everything here is generated: no third-party bytes, no sample media, no
// production assets. The clips are deliberately shaped to exercise the engine's
// acceptance and rejection paths.

import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {deflateSync} from 'node:zlib';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';

export const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');

export const writeJson = (file, value) => {
  mkdirSync(path.dirname(file), {recursive: true});
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
};

/** Stereo 16-bit PCM WAV with a quiet tone plus a periodic pulse. */
export const writeWav = (file, seconds, frequency) => {
  const sampleRate = 48000;
  const channels = 2;
  const frames = Math.round(seconds * sampleRate);
  const dataSize = frames * channels * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * channels * 2, 28);
  buffer.writeUInt16LE(channels * 2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);
  const fade = Math.round(sampleRate * 0.02);
  for (let index = 0; index < frames; index++) {
    const envelope = Math.min(1, index / fade, (frames - index) / fade);
    const pulse = index % Math.round(sampleRate / 2) < Math.round(sampleRate / 14) ? 0.35 : 0;
    const value = Math.max(
      -1,
      Math.min(1, Math.sin((2 * Math.PI * frequency * index) / sampleRate) * 0.16 * envelope + pulse * envelope),
    );
    const sample = Math.round(value * 32767);
    buffer.writeInt16LE(sample, 44 + index * 4);
    buffer.writeInt16LE(sample, 46 + index * 4);
  }
  mkdirSync(path.dirname(file), {recursive: true});
  writeFileSync(file, buffer);
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

/** Opaque RGBA PNG with one bright horizontal band. */
export const writePlatePng = (file, width, height, rgb) => {
  const rowSize = width * 4 + 1;
  const raw = Buffer.alloc(rowSize * height);
  for (let y = 0; y < height; y++) {
    const row = y * rowSize;
    raw[row] = 0;
    const inBand = y > height * 0.4 && y < height * 0.55;
    for (let x = 0; x < width; x++) {
      const index = row + 1 + x * 4;
      raw[index] = inBand ? Math.min(255, rgb[0] + 150) : rgb[0];
      raw[index + 1] = inBand ? Math.min(255, rgb[1] + 150) : rgb[1];
      raw[index + 2] = inBand ? Math.min(255, rgb[2] + 150) : rgb[2];
      raw[index + 3] = 255;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  mkdirSync(path.dirname(file), {recursive: true});
  writeFileSync(
    file,
    Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      pngChunk('IHDR', header),
      pngChunk('IDAT', deflateSync(raw, {level: 6})),
      pngChunk('IEND', Buffer.alloc(0)),
    ]),
  );
};

const ffmpeg = (argv) => {
  execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...argv], {
    stdio: 'pipe',
    windowsHide: true,
  });
};

/**
 * A clip the accepted Video renderer must reject: variable frame rate, non-zero
 * display rotation and an embedded audio stream. Colour segments keep decoded
 * frames visually distinct after scaling.
 */
export const writeIncompatibleClip = (file, seconds, palette) => {
  mkdirSync(path.dirname(file), {recursive: true});
  const base = `${file}.base.mp4`;
  const vfr = `${file}.vfr.mp4`;
  const segment = seconds / palette.length;
  const inputArgs = [];
  for (const color of palette) {
    inputArgs.push('-f', 'lavfi', '-i', `color=c=${color}:s=320x180:r=30:d=${segment.toFixed(6)}`);
  }
  inputArgs.push('-f', 'lavfi', '-i', `sine=frequency=330:duration=${seconds}`);
  const filter = `${palette.map((_, index) => `[${index}:v]`).join('')}concat=n=${palette.length}:v=1:a=0[v]`;
  ffmpeg([
    ...inputArgs,
    '-filter_complex',
    filter,
    '-map',
    '[v]',
    '-map',
    `${palette.length}:a`,
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-t',
    seconds.toFixed(6),
    '-movflags',
    '+faststart',
    base,
  ]);
  ffmpeg([
    '-i',
    base,
    '-vf',
    "select='not(mod(n\\,2))+not(mod(n\\,3))'",
    '-fps_mode',
    'passthrough',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'copy',
    '-movflags',
    '+faststart',
    vfr,
  ]);
  ffmpeg(['-display_rotation', '90', '-i', vfr, '-c', 'copy', file]);
};

/** RGBA PNG where the caller decides every pixel (used for transparent layers). */
export const writeAlphaPng = (file, width, height, paint) => {
  const rowSize = width * 4 + 1;
  const raw = Buffer.alloc(rowSize * height);
  for (let y = 0; y < height; y++) {
    const row = y * rowSize;
    raw[row] = 0;
    for (let x = 0; x < width; x++) {
      const pixel = paint(x, y, width, height);
      const index = row + 1 + x * 4;
      raw[index] = pixel[0];
      raw[index + 1] = pixel[1];
      raw[index + 2] = pixel[2];
      raw[index + 3] = pixel[3];
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  mkdirSync(path.dirname(file), {recursive: true});
  writeFileSync(
    file,
    Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      pngChunk('IHDR', header),
      pngChunk('IDAT', deflateSync(raw, {level: 6})),
      pngChunk('IEND', Buffer.alloc(0)),
    ]),
  );
};

/**
 * A constant-frame-rate synthetic clip composed of rising light columns over a
 * base colour, with a slow band sweep. The columns give the clip a readable
 * "signal garden" identity instead of a flat colour field, and every parameter
 * is fixed so the bytes are deterministic.
 * `audioTone` embeds a tone to prove the renderer mutes source audio.
 */
export const writeMovingClip = (file, {width, height, seconds, fps, from, to, audioTone = null, bandSpeed = 1, columns = 6}) => {
  const hex = (rgb) => `#${rgb.map((value) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0')).join('')}`;
  const args = ['-f', 'lavfi', '-i', `color=c=${hex(from)}:s=${width}x${height}:r=${fps}:d=${seconds}`];
  if (audioTone !== null) {
    args.push('-f', 'lavfi', '-i', `sine=frequency=${audioTone}:sample_rate=48000:duration=${seconds}`);
  }
  const columnWidth = Math.max(6, Math.round(width / 28));
  const columnHeight = Math.round(height * 0.72);
  const filters = [`[0:v]null`];
  for (let index = 0; index < columns; index++) {
    const x = Math.round(((index + 0.5) / columns) * width - columnWidth / 2);
    const speed = 26 + ((index * 13) % 19);
    const phase = index * 97;
    // Each column scrolls upward and wraps, so the garden appears to grow.
    const y = `mod(t*${speed}+${phase}\\,${height + columnHeight})-${columnHeight}`;
    filters.push(
      `drawbox=x=${x}:y=${y}:w=${columnWidth}:h=${columnHeight}:color=${hex(to)}@0.42:t=fill`,
    );
  }
  const bandY = `mod(t*${(bandSpeed * height) / 2}\\,${height})`;
  filters.push(`drawbox=x=0:y=${bandY}:w=${width}:h=${Math.round(height / 5)}:color=${hex(to)}@0.35:t=fill`);
  filters.push(`format=yuv420p[v]`);
  args.push('-filter_complex', filters.join(','), '-map', '[v]');
  if (audioTone !== null) args.push('-map', '1:a', '-c:a', 'aac', '-b:a', '128k');
  args.push(
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
    '-g', String(Math.max(1, Math.round(fps / 2))),
    '-pix_fmt', 'yuv420p',
    '-colorspace', 'bt709', '-color_trc', 'bt709', '-color_primaries', 'bt709',
    '-r', String(fps),
    '-movflags', '+faststart',
    '-t', String(seconds),
    '-f', 'mp4', file,
  );
  mkdirSync(path.dirname(file), {recursive: true});
  ffmpeg(args);
};
