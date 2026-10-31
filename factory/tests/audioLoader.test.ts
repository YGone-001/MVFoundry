import assert from 'node:assert/strict';
import {execFileSync, spawnSync} from 'node:child_process';
import {readFileSync, rmSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {after, before, test} from 'node:test';
import {sha256File} from '../src/media/hash';
import {writePcm16Wav} from '../src/media/wav';
import {loadProject} from '../src/project/loadProject';
import {
  REPO_ROOT,
  cloneProject,
  makeWorkspace,
  readProjectJson,
} from './helpers';

let workspace: string;

const hasCommand = (command: string): boolean =>
  spawnSync(command, ['-version'], {stdio: 'ignore', windowsHide: true}).status === 0;

before(() => {
  workspace = makeWorkspace();
});

after(() => {
  rmSync(workspace, {recursive: true, force: true});
});

const audioTrackAsset = (id: string, file: string, sha256: string) => ({
  id,
  kind: 'audio-reference',
  path: `source/audio/${path.basename(file)}`,
  sha256,
  source: 'Synthetic test fixture',
  rights: 'Synthetic test fixture; no third-party rights',
  approval: 'approved',
});

const writeProject = (projectId: string, config: Record<string, any>): void => {
  writeFileSync(
    path.join(workspace, projectId, 'project.json'),
    JSON.stringify(config, null, 2),
  );
};

const load = (projectId: string) =>
  loadProject(projectId, {workspaceRoot: workspace, engineRoot: REPO_ROOT});

test('loader verifies approved WAV tracks and exposes the audio contract', () => {
  const projectId = 'audio-track-demo';
  const projectDir = cloneProject(workspace, 'synthetic-pixel-demo', projectId, (config) => {
    config.audioTracks = [];
  });
  const trackFile = path.join(projectDir, 'source', 'audio', 'sfx.wav');
  const samples = new Float32Array(48000 * 2);
  for (let frame = 0; frame < 48000; frame++) {
    const value = Math.sin((2 * Math.PI * 1200 * frame) / 48000) * 0.3;
    samples[frame * 2] = value;
    samples[frame * 2 + 1] = value;
  }
  writePcm16Wav(trackFile, samples, 48000, 2);
  const config = readProjectJson(workspace, projectId);
  config.assets.push(audioTrackAsset('AUDIO-SFX', trackFile, sha256File(trackFile)));
  config.audioTracks = [
    {
      id: 'sfx-01',
      role: 'sfx',
      assetId: 'AUDIO-SFX',
      startFrame: 12,
      durationFrames: 12,
      sourceStartSeconds: 0.25,
      gainDb: -3,
      fadeInFrames: 1,
      fadeOutFrames: 2,
      muted: false,
      gainAutomation: [],
    },
  ];
  writeProject(projectId, config);

  const beforeMaster = sha256File(path.join(projectDir, config.audio.path));
  const beforeTrack = sha256File(trackFile);
  const project = load(projectId);
  assert.equal(project.audioMetadata?.format, 'wav-pcm');
  assert.equal(project.audioMetadata?.sampleRate, 48000);
  assert.equal(project.audioTracks.length, 1);
  assert.equal(project.audioTracks[0].id, 'sfx-01');
  assert.equal(project.audioTracks[0].sourceStartSeconds, 0.25);
  const track = project.assets.find((asset) => asset.id === 'AUDIO-SFX');
  assert.equal(track?.audioMetadata?.format, 'wav-pcm');
  assert.equal(track?.audioMetadata?.decodedDurationSeconds, 1);
  assert.equal(project.renderProject.audio.mixSampleRate, 48000);
  assert.equal(project.renderProject.audio.gainDb, 0);
  assert.equal(sha256File(path.join(projectDir, config.audio.path)), beforeMaster);
  assert.equal(sha256File(trackFile), beforeTrack);
});

test('loader rejects a track that exceeds its decoded source duration', () => {
  const sourceId = 'audio-track-demo';
  const projectId = 'audio-track-too-long';
  const projectDir = cloneProject(workspace, sourceId, projectId, (config) => {
    config.audioTracks[0].startFrame = 12;
    config.audioTracks[0].durationFrames = 24;
    config.audioTracks[0].sourceStartSeconds = 0.25;
  });
  const config = readProjectJson(workspace, projectId);
  const trackFile = path.join(projectDir, config.assets.find((asset: any) => asset.id === 'AUDIO-SFX').path);
  assert.equal(sha256File(trackFile), config.assets.find((asset: any) => asset.id === 'AUDIO-SFX').sha256);
  assert.throws(() => load(projectId), /exceeds the decoded source duration/);
});

test('loader rejects a master whose declared format disagrees with its content', () => {
  const projectId = 'audio-format-mismatch';
  cloneProject(workspace, 'synthetic-pixel-demo', projectId, (config) => {
    config.audio.format = 'mp3';
  });
  assert.throws(() => load(projectId), /declares mp3/);
});

test('loader rejects an approved track whose source hash changed', () => {
  const sourceId = 'audio-track-demo';
  const projectId = 'audio-track-hash';
  const projectDir = cloneProject(workspace, sourceId, projectId);
  const config = readProjectJson(workspace, projectId);
  const trackFile = path.join(projectDir, config.assets.find((asset: any) => asset.id === 'AUDIO-SFX').path);
  const bytes = readFileSync(trackFile);
  bytes[bytes.length - 1] ^= 0xff;
  writeFileSync(trackFile, bytes);
  assert.throws(() => load(projectId), /Asset SHA256 mismatch/);
});

test('loader probes MP3 masters and verifies declared duration', (t) => {
  if (!hasCommand('ffmpeg') || !hasCommand('ffprobe')) {
    t.skip('ffmpeg/ffprobe are unavailable on this host');
    return;
  }
  const validId = 'audio-mp3-demo';
  const validDir = cloneProject(workspace, 'synthetic-pixel-demo', validId);
  const source = path.join(validDir, 'source', 'audio', 'tone-2s.wav');
  const mp3 = path.join(validDir, 'source', 'audio', 'master.mp3');
  execFileSync(
    'ffmpeg',
    ['-y', '-v', 'error', '-i', source, '-vn', '-ac', '2', '-ar', '44100', '-c:a', 'libmp3lame', '-b:a', '192k', mp3],
    {stdio: 'ignore', windowsHide: true},
  );
  const validConfig = readProjectJson(workspace, validId);
  validConfig.audio = {
    ...validConfig.audio,
    path: 'source/audio/master.mp3',
    format: 'mp3',
    sha256: sha256File(mp3),
    durationSeconds: 2,
    assetId: undefined,
  };
  writeProject(validId, validConfig);
  const project = load(validId);
  assert.equal(project.audioMetadata?.format, 'mp3');
  assert.equal(project.audioMetadata?.codec, 'mp3');
  assert.equal(project.audioMetadata?.sampleRate, 44100);
  assert.ok(Math.abs((project.audioMetadata?.decodedDurationSeconds ?? 0) - 2) < 0.05);
  assert.equal(project.durationInFrames, 48);
  assert.equal(project.renderProject.audio.format, 'mp3');

  const badId = 'audio-mp3-duration';
  const badDir = cloneProject(workspace, validId, badId, (config) => {
    config.audio.durationSeconds = 2.2;
    config.chapters[1].endFrame = 53;
    config.chapters[1].shots[0].endFrame = 53;
  });
  const badConfig = readProjectJson(workspace, badId);
  assert.equal(sha256File(path.join(badDir, badConfig.audio.path)), badConfig.audio.sha256);
  assert.throws(() => load(badId), /Audio duration mismatch/);
});

test('loaded configs expose only project-relative audio paths', () => {
  const project = load('audio-track-demo');
  for (const asset of project.assets.filter((candidate) => candidate.kind === 'audio-reference')) {
    assert.equal(path.isAbsolute(asset.path), false);
    assert.ok(asset.absolutePath?.startsWith(project.projectDir));
  }
});

test('the loaded project retains declarative track identity and source metadata', () => {
  const project = load('audio-track-demo');
  assert.equal(project.config.audioTracks[0].durationFrames, 12);
  assert.equal(project.audioTracks[0].assetId, 'AUDIO-SFX');
  assert.equal(
    project.assets.find((asset) => asset.id === 'AUDIO-SFX')?.audioMetadata?.codec,
    'pcm_s16le',
  );
});