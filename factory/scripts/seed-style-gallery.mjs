// Seeds six runnable synthetic style-gallery projects, one per registered
// visual style, into an authorized external workspace.
//
// Every project uses the same self-contained module template
// (factory/scripts/support/style-gallery-module.ts) so the examples cannot
// drift from the style:verify proof. No song, recording or third-party media
// is involved; the 2 s score is synthesized in this script.
//
// Usage:
//   MV_WORKSPACE_ROOT=C:\path\outside\repo node factory/scripts/seed-style-gallery.mjs
//   node factory/scripts/seed-style-gallery.mjs --workspace C:\path\outside\repo
// Requires: npm run build
import {createHash} from 'node:crypto';
import {existsSync, mkdirSync, readFileSync, statSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const supportModule = path.join(here, 'support', 'style-gallery-module.ts');

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : fallback;
};

const {DEFAULT_ENGINE_ROOT, getWorkspaceRoot, isInside} = require('../dist/src/workspace/guard.js');
const {assertSafePath, createWriteBoundary, ensureSafeDirectory} = require(
  '../dist/src/workspace/writeBoundary.js',
);

const rawRoot = arg('workspace', process.env.MV_WORKSPACE_ROOT);
if (!rawRoot) {
  console.error('MV_WORKSPACE_ROOT (or --workspace) is required');
  process.exit(2);
}

const workspaceRoot = getWorkspaceRoot({explicitRoot: rawRoot, engineRoot: DEFAULT_ENGINE_ROOT});
const moduleSource = readFileSync(supportModule, 'utf8');
const moduleSha = createHash('sha256').update(moduleSource).digest('hex');

const FPS = 24;
const DURATION_SECONDS = 2;
const DURATION_FRAMES = FPS * DURATION_SECONDS;
const WIDTH = 640;
const HEIGHT = 360;

const STYLES = [
  {id: 'cinematic-illustration-2p5d', slug: 'cinematic', label: 'Cinematic 2.5D illustration'},
  {id: 'anime-motion-comic', slug: 'anime', label: 'Anime motion comic'},
  {id: 'ink-watercolor', slug: 'ink', label: 'Ink and watercolour'},
  {id: 'editorial-motion-graphics', slug: 'editorial', label: 'Editorial motion graphics'},
  {id: 'stylized-3d-diorama', slug: 'diorama', label: 'Stylised 3D diorama'},
  {id: 'retro-pixel', slug: 'pixel', label: 'Retro pixel art'},
];

const writeToneWav = (file, frequency) => {
  const sampleRate = 48000;
  const samples = sampleRate * DURATION_SECONDS;
  const buffer = Buffer.alloc(44 + samples * 2);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + samples * 2, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(samples * 2, 40);
  const fade = Math.round(sampleRate * 0.02);
  for (let index = 0; index < samples; index += 1) {
    const fadeIn = Math.min(1, index / fade);
    const fadeOut = Math.min(1, (samples - 1 - index) / fade);
    const value = Math.sin((2 * Math.PI * frequency * index) / sampleRate) * 0.2 * fadeIn * fadeOut;
    buffer.writeInt16LE(Math.round(value * 32767), 44 + index * 2);
  }
  writeFileSync(file, buffer);
  return createHash('sha256').update(buffer).digest('hex');
};

const projectConfig = ({projectId, style, audioSha}) => ({
  schemaVersion: 1,
  projectId,
  song: {title: `Synthetic Style Gallery - ${style.label}`, artist: 'MVFoundry Synthetic Fixtures'},
  audio: {
    path: 'source/audio/tone-2s.wav',
    sha256: audioSha,
    durationSeconds: DURATION_SECONDS,
    durationPolicy: 'round',
    format: 'wav-pcm',
  },
  lyrics: {language: 'none', path: null},
  narrative: {mode: 'abstract'},
  visual: {
    styleProfile: style.id,
    defaultRenderer: 'project:style-gallery',
    style: {id: style.id, note: 'Synthetic gallery example; artistic verdict pending human review'},
  },
  output: {width: WIDTH, height: HEIGHT, fps: FPS},
  cues: [
    {id: 'CUE-01', frame: 0, timeSeconds: 0, source: 'synthetic', label: 'start'},
    {id: 'CUE-02', frame: 24, timeSeconds: 1, source: 'synthetic', label: 'mid'},
    {id: 'CUE-03', frame: DURATION_FRAMES, timeSeconds: DURATION_SECONDS, source: 'synthetic', label: 'end'},
  ],
  chapters: [
    {
      id: 'CH-01',
      title: style.label,
      startFrame: 0,
      endFrame: DURATION_FRAMES,
      shots: [
        {
          id: 'SHOT-01',
          startFrame: 0,
          endFrame: DURATION_FRAMES,
          renderer: 'project:style-gallery',
          params: {background: '#000000'},
        },
      ],
    },
  ],
  sceneModules: [
    {
      id: 'style-gallery',
      path: 'scenes/style-gallery.ts',
      moduleType: 'canvas2d',
      contractVersion: 1,
      sha256: moduleSha,
      trust: 'user-authored-approved',
      canvas: {mode: 'output'},
      samplingFps: 'output',
      pixelated: false,
      label: 'Synthetic six-style gallery',
      description: 'One self-contained module, six registered visual styles; synthetic example only.',
      styleIds: [style.id],
    },
  ],
  assets: [],
  audioTracks: [],
  permissions: {externalGeneration: false, localOnly: true, allowNetwork: false},
  render: {codec: 'h264', pixelFormat: 'yuv420p', colorSpace: 'bt709', imageFormat: 'png'},
});

const seeded = [];

for (const [index, style] of STYLES.entries()) {
  const projectId = `synthetic-style-${style.slug}`;
  const projectDir = path.resolve(workspaceRoot, projectId);
  if (!isInside(workspaceRoot, projectDir)) {
    throw new Error(`Project target escapes the workspace: ${projectDir}`);
  }
  if (existsSync(projectDir)) {
    if (!statSync(projectDir).isDirectory()) {
      throw new Error(`Project target exists and is not a directory: ${projectDir}`);
    }
    console.log(`skip ${projectId}: already exists (remove it manually to reseed)`);
    continue;
  }

  mkdirSync(projectDir, {recursive: false});
  for (const relative of ['cache', 'renders', 'scenes', 'source/audio', 'reports']) {
    mkdirSync(path.join(projectDir, relative), {recursive: true});
  }
  const boundary = createWriteBoundary({projectDir, engineRoot: repoRoot});

  const moduleTarget = assertSafePath(boundary, path.join(projectDir, 'scenes', 'style-gallery.ts'), {
    expect: 'file',
    subtree: 'project',
  });
  writeFileSync(moduleTarget, moduleSource);

  const audioTarget = assertSafePath(boundary, path.join(projectDir, 'source', 'audio', 'tone-2s.wav'), {
    expect: 'file',
    subtree: 'project',
  });
  const audioSha = writeToneWav(audioTarget, 330 + index * 20);

  const configTarget = assertSafePath(boundary, path.join(projectDir, 'project.json'), {
    expect: 'file',
    subtree: 'project',
  });
  writeFileSync(configTarget, `${JSON.stringify(projectConfig({projectId, style, audioSha}), null, 2)}\n`);

  const reportsDir = ensureSafeDirectory(boundary, path.join(projectDir, 'reports'), 'project');
  writeFileSync(
    path.join(reportsDir, 'style-gallery.json'),
    `${JSON.stringify(
      {
        seededBy: 'factory/scripts/seed-style-gallery.mjs',
        styleId: style.id,
        projectId,
        moduleSha256: moduleSha,
        audio: {path: 'source/audio/tone-2s.wav', sha256: audioSha, durationSeconds: DURATION_SECONDS},
        note: 'Synthetic example. Technical rendering is not an artistic approval.',
      },
      null,
      2,
    )}\n`,
  );

  seeded.push({projectId, styleId: style.id});
  console.log(`seeded ${projectId} (${style.id}) -> ${projectDir}`);
}

console.log(
  JSON.stringify(
    {
      workspaceRoot,
      seeded,
      skipped: STYLES.length - seeded.length,
      next: 'Render one still per project with: npm run render:project -- --project <id> --mode still --frame 24',
    },
    null,
    2,
  ),
);
