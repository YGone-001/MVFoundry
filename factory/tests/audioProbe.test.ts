import assert from 'node:assert/strict';
import {execFileSync, spawnSync} from 'node:child_process';
import {mkdtempSync, rmSync, statSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {MediaError} from '../src/errors';
import {probeAudio} from '../src/media/audioProbe';
import {decodeAudioToNormalizedPcm} from '../src/media/audioDecode';
import {sha256File} from '../src/media/hash';
import {encodePcm16Wav} from '../src/media/wav';

const hasCommand = (command: string): boolean =>
  spawnSync(command, ['-version'], {stdio: 'ignore', windowsHide: true}).status === 0;

const ffmpegAvailable = (): boolean => hasCommand('ffmpeg') && hasCommand('ffprobe');

const encode = (input: string, output: string, args: string[]): void => {
  execFileSync(
    'ffmpeg',
    ['-y', '-v', 'error', '-i', input, ...args, output],
    {stdio: 'ignore', windowsHide: true},
  );
};

test('probes WAV, MP3, FLAC and M4A/AAC by decoded content', (t) => {
  if (!ffmpegAvailable()) {
    t.skip('ffmpeg/ffprobe are unavailable on this host');
    return;
  }
  const directory = mkdtempSync(path.join(tmpdir(), 'mvfoundry-audio-probe-'));
  try {
    const rate = 48000;
    const frames = rate / 2;
    const samples = new Float32Array(frames * 2);
    for (let frame = 0; frame < frames; frame++) {
      const value = Math.sin((2 * Math.PI * 440 * frame) / rate) * 0.2;
      samples[frame * 2] = value;
      samples[frame * 2 + 1] = value;
    }
    const wav = path.join(directory, 'source.wav');
    writeFileSync(wav, encodePcm16Wav(samples, rate, 2));
    const mp3 = path.join(directory, 'source.mp3');
    const flac = path.join(directory, 'source.flac');
    const m4a = path.join(directory, 'source.m4a');
    encode(wav, mp3, ['-vn', '-ac', '2', '-ar', '44100', '-c:a', 'libmp3lame', '-b:a', '160k']);
    encode(wav, flac, ['-vn', '-ac', '2', '-ar', '48000', '-c:a', 'flac']);
    encode(wav, m4a, ['-vn', '-ac', '2', '-ar', '48000', '-c:a', 'aac', '-b:a', '128k']);
    const before = [wav, mp3, flac, m4a].map((file) => sha256File(file));

    const wavMetadata = probeAudio(wav, 'WAV', 'wav-pcm');
    assert.equal(wavMetadata.format, 'wav-pcm');
    assert.equal(wavMetadata.container, 'wav');
    assert.equal(wavMetadata.codec, 'pcm_s16le');
    assert.equal(wavMetadata.sampleRate, 48000);
    assert.equal(wavMetadata.channels, 2);
    assert.ok(Math.abs(wavMetadata.decodedDurationSeconds - 0.5) < 0.001);
    assert.equal(wavMetadata.hasUnexpectedStreams, false);
    assert.equal(wavMetadata.fileSizeBytes, statSync(wav).size);

    const mp3Metadata = probeAudio(mp3, 'MP3', 'mp3');
    assert.equal(mp3Metadata.format, 'mp3');
    assert.equal(mp3Metadata.codec, 'mp3');
    assert.equal(mp3Metadata.sampleRate, 44100);
    assert.ok(Math.abs(mp3Metadata.decodedDurationSeconds - 0.5) < 0.03);

    const flacMetadata = probeAudio(flac, 'FLAC', 'flac');
    assert.equal(flacMetadata.format, 'flac');
    assert.equal(flacMetadata.codec, 'flac');
    assert.equal(flacMetadata.sampleRate, 48000);
    assert.ok(Math.abs(flacMetadata.decodedDurationSeconds - 0.5) < 0.001);

    const m4aMetadata = probeAudio(m4a, 'M4A', 'm4a-aac');
    assert.equal(m4aMetadata.format, 'm4a-aac');
    assert.equal(m4aMetadata.codec, 'aac');
    assert.ok(Math.abs(m4aMetadata.decodedDurationSeconds - 0.5) < 0.03);
    assert.ok(
      m4aMetadata.encoderDelaySamples === null ||
        m4aMetadata.encoderDelaySamples >= 0,
    );

    assert.deepEqual(
      [wav, mp3, flac, m4a].map((file) => sha256File(file)),
      before,
    );
  } finally {
    rmSync(directory, {recursive: true, force: true});
  }
});

test('normalization is deterministic stereo 16-bit PCM at the requested rate', (t) => {
  if (!ffmpegAvailable()) {
    t.skip('ffmpeg/ffprobe are unavailable on this host');
    return;
  }
  const directory = mkdtempSync(path.join(tmpdir(), 'mvfoundry-audio-normalize-'));
  try {
    const frames = 24000;
    const stereo = new Float32Array(frames * 2);
    for (let frame = 0; frame < frames; frame++) {
      const left = Math.sin((2 * Math.PI * 330 * frame) / 48000) * 0.25;
      const right = Math.sin((2 * Math.PI * 550 * frame) / 48000) * 0.2;
      stereo[frame * 2] = left;
      stereo[frame * 2 + 1] = right;
    }
    const wav = path.join(directory, 'stereo.wav');
    writeFileSync(wav, encodePcm16Wav(stereo, 48000, 2));
    const flac = path.join(directory, 'mono.flac');
    encode(wav, flac, ['-vn', '-c:a', 'flac']);

    const first = decodeAudioToNormalizedPcm(flac, 48000, 'FLAC');
    const second = decodeAudioToNormalizedPcm(flac, 48000, 'FLAC');
    assert.equal(first.sampleRate, 48000);
    assert.equal(first.channels, 2);
    assert.equal(first.frameCount, 24000);
    assert.equal(first.durationSeconds, 0.5);
    assert.equal(first.normalizedSha256, second.normalizedSha256);
    assert.deepEqual(first.wavBytes, second.wavBytes);
    assert.ok(Math.abs(first.samples[200] - stereo[200]) < 0.005);
    assert.ok(Math.abs(first.samples[201] - stereo[201]) < 0.005);
    assert.ok(Math.abs(first.samples[200] - first.samples[201]) > 1e-4);
    assert.equal(first.wavBytes.toString('ascii', 0, 4), 'RIFF');
  } finally {
    rmSync(directory, {recursive: true, force: true});
  }
});

test('rejects mismatched, malformed, multichannel and unexpected-stream audio', (t) => {
  if (!ffmpegAvailable()) {
    t.skip('ffmpeg/ffprobe are unavailable on this host');
    return;
  }
  const directory = mkdtempSync(path.join(tmpdir(), 'mvfoundry-audio-reject-'));
  try {
    const wav = path.join(directory, 'tone.wav');
    writeFileSync(wav, encodePcm16Wav(new Float32Array(48000 * 2).fill(0.1), 48000, 2));
    const mp3 = path.join(directory, 'tone.mp3');
    encode(wav, mp3, ['-vn', '-c:a', 'libmp3lame', '-b:a', '128k']);

    assert.throws(() => probeAudio(mp3, 'MISLABELED', 'wav-pcm'), /declares wav-pcm/);
    assert.throws(() => probeAudio(wav, 'MISLABELED', 'mp3'), /declares mp3/);

    const corrupt = path.join(directory, 'corrupt.mp3');
    writeFileSync(corrupt, 'not audio');
    assert.throws(() => probeAudio(corrupt, 'CORRUPT'), MediaError);
    assert.throws(() => probeAudio(path.join(directory, 'missing.mp3'), 'MISSING'), MediaError);

    const multichannel = path.join(directory, 'surround.m4a');
    try {
      encode(wav, multichannel, ['-vn', '-ac', '6', '-c:a', 'aac']);
      assert.throws(() => probeAudio(multichannel, 'SURROUND'), /mono or stereo/);
    } catch (error) {
      if (error instanceof assert.AssertionError) throw error;
      t.skip('AAC multichannel fixture is unavailable');
      return;
    }

    const withVideo = path.join(directory, 'with-video.mp4');
    execFileSync(
      'ffmpeg',
      [
        '-y',
        '-v',
        'error',
        '-f',
        'lavfi',
        '-i',
        'color=c=red:s=160x120:r=24:d=0.5',
        '-i',
        wav,
        '-shortest',
        '-c:v',
        'libx264',
        '-pix_fmt',
        'yuv420p',
        '-c:a',
        'aac',
        withVideo,
      ],
      {stdio: 'ignore', windowsHide: true},
    );
    assert.throws(() => probeAudio(withVideo, 'WITH-VIDEO'), /exactly one audio stream/);
  } finally {
    rmSync(directory, {recursive: true, force: true});
  }
});