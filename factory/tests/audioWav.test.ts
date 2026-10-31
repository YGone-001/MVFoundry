import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {MediaError} from '../src/errors';
import {
  encodePcm16Wav,
  parsePcm16WavBuffer,
  readPcmWav,
  readWavMetadata,
  writePcm16Wav,
} from '../src/media/wav';

test('16-bit stereo PCM WAV round-trips samples and metadata', () => {
  const samples = new Float32Array([0, 0.25, -0.5, 0.75, -1, 1, 0.1, -0.1]);
  const bytes = encodePcm16Wav(samples, 48000, 2);
  const parsed = parsePcm16WavBuffer(bytes, 'roundtrip');
  assert.equal(parsed.sampleRate, 48000);
  assert.equal(parsed.channels, 2);
  assert.equal(parsed.frameCount, 4);
  assert.equal(parsed.durationSeconds, 4 / 48000);
  for (let index = 0; index < samples.length; index++) {
    assert.ok(Math.abs(parsed.samples[index] - samples[index]) <= 1 / 32000);
  }
});

test('mono WAV files are accepted and retain their channel count', () => {
  const samples = new Float32Array([0, 0.1, -0.1, 0.2, -0.2]);
  const parsed = parsePcm16WavBuffer(encodePcm16Wav(samples, 44100, 1), 'mono');
  assert.equal(parsed.channels, 1);
  assert.equal(parsed.frameCount, 5);
  assert.equal(parsed.sampleRate, 44100);
});

test('file readers report the same data as buffer parsing', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'mvfoundry-wav-'));
  try {
    const file = path.join(directory, 'tone.wav');
    const samples = new Float32Array([0.2, -0.2, 0.4, -0.4]);
    writePcm16Wav(file, samples, 48000, 2);
    const metadata = readWavMetadata(file);
    assert.equal(metadata.channels, 2);
    assert.equal(metadata.sampleRate, 48000);
    assert.equal(metadata.bitsPerSample, 16);
    assert.equal(metadata.audioFormat, 1);
    assert.equal(metadata.durationSeconds, 2 / 48000);
    const parsed = readPcmWav(file);
    assert.equal(parsed.frameCount, 2);
    assert.ok(Math.abs(parsed.samples[0] - 0.2) < 1e-4);
  } finally {
    rmSync(directory, {recursive: true, force: true});
  }
});

test('invalid WAV layouts are rejected with actionable errors', () => {
  assert.throws(() => parsePcm16WavBuffer(Buffer.alloc(10), 'short'), /Not a RIFF\/WAVE/);
  const truncated = encodePcm16Wav(new Float32Array([0, 0]), 48000, 2);
  truncated.writeUInt32LE(0xffff, 40);
  assert.throws(() => parsePcm16WavBuffer(truncated, 'truncated'), /Corrupt WAV chunk/);

  const notPcm = encodePcm16Wav(new Float32Array([0, 0]), 48000, 2);
  notPcm.writeUInt16LE(3, 20);
  assert.throws(() => parsePcm16WavBuffer(notPcm, 'float'), /Only 16-bit PCM/);

  const threeChannels = encodePcm16Wav(new Float32Array([0, 0, 0, 0]), 48000, 2);
  threeChannels.writeUInt16LE(3, 22);
  assert.throws(() => parsePcm16WavBuffer(threeChannels, 'three'), /mono or stereo/);
});

test('the WAV header records the declared size', () => {
  const bytes = encodePcm16Wav(new Float32Array(96), 48000, 2);
  assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
  assert.equal(bytes.readUInt32LE(4), bytes.length - 8);
  assert.equal(bytes.readUInt32LE(24), 48000);
  assert.equal(bytes.readUInt16LE(22), 2);
  assert.equal(bytes.readUInt16LE(34), 16);
  assert.equal(bytes.readUInt32LE(40), 96 * 2);
  const directory = mkdtempSync(path.join(tmpdir(), 'mvfoundry-wav-write-'));
  try {
    const file = path.join(directory, 'silence.wav');
    writeFileSync(file, bytes);
    assert.deepEqual(readFileSync(file), bytes);
  } finally {
    rmSync(directory, {recursive: true, force: true});
  }
  assert.throws(() => encodePcm16Wav(new Float32Array([0]), 48000, 3), MediaError);
});