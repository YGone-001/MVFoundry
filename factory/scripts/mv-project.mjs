// Generic local MV project initialization and explicit audio import.
//
// This is the production entry point for a project that is NOT the built-in
// Signal Garden rehearsal. Every input is explicit: the project id, the
// authorized external workspace root, the output profile, and one selected
// local audio source with its declared provenance and rights. Nothing here
// scans folders, imports media automatically, touches existing projects, or
// contacts any service.
//
// Usage:
//   node factory/scripts/mv-project.mjs init \
//     --project <id> --workspace <root> \
//     --width 1280 --height 720 --fps 24 \
//     --audio <absolute-or-workspace-relative-path> \
//     --source "<where the file came from>" \
//     --rights "<declared rights statement>" \
//     [--title "<song title>"] [--artist "<artist>"]
//
//   node factory/scripts/mv-project.mjs import-audio \
//     --project <id> --workspace <root> \
//     --audio <path> --source "<...>" --rights "<...>" \
//     --replace  # explicit decision to supersede an approved source
//
// A user-declared rights assertion is an operational record, not independent
// verification of copyright ownership. Source bytes are preserved untouched.

import {createHash} from 'node:crypto';
import {copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');

const args = process.argv.slice(2);
const command = args[0];
const arg = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : fallback;
};
const hasFlag = (name) => args.includes(`--${name}`);

const fail = (message, code = 2) => {
  console.error(JSON.stringify({status: 'REFUSED', code, message}, null, 2));
  process.exit(1);
};

if (!command || command === '--help' || command === 'help') {
  console.log(`mv-project — generic local MV project initialization and audio import

Commands:
  init          create a new project in an authorized external workspace
  import-audio  import or explicitly replace the master audio source

init:
  --project <id>          project identifier (required)
  --workspace <root>      external workspace root (or MV_WORKSPACE_ROOT)
  --width <n> --height <n>  output dimensions, both even and >= 16
  --fps <n>               frames per second, 1..120
  --audio <path>          one explicitly selected local audio file
  --source "<text>"       declared provenance of the audio file
  --rights "<text>"       declared rights statement for the audio file
  --title "<text>" --artist "<text>"   optional song metadata
  --force                 allow init when only an empty project dir exists

import-audio:
  --project <id> --workspace <root>
  --audio <path> --source "<text>" --rights "<text>"
  --replace               explicitly supersede an already approved source

Nothing here approves assets, plans, or storyboards, and nothing contacts a
provider.`);
  process.exit(0);
}

if (!['init', 'import-audio'].includes(command)) {
  fail(`unknown command ${command}`);
}

// ---------------------------------------------------------------------------
// Shared validation
// ---------------------------------------------------------------------------

const projectId = arg('project');
if (!projectId) fail('--project is required');
if (!/^[a-z0-9][a-z0-9-]{2,62}[a-z0-9]$/.test(projectId)) {
  fail(`project id ${projectId} is invalid: use 4-64 lowercase letters, digits and hyphens`);
}

const workspaceRoot = arg('workspace', process.env.MV_WORKSPACE_ROOT);
if (!workspaceRoot) fail('MV_WORKSPACE_ROOT or --workspace is required');

const {createWriteBoundary, ensureSafeDirectory, assertSafePath} = require('../dist/src/workspace/writeBoundary.js');
const {probeAudio} = require('../dist/src/media/audioProbe.js');
const {sha256File} = require('../dist/src/media/hash.js');

const absolute = (value) => path.resolve(value);
const workspaceAbsolute = absolute(workspaceRoot);
const repoAbsolute = absolute(repoRoot);

// The workspace must be outside the engine root; nothing engine-owned is a
// valid destination for project data.
if (workspaceAbsolute === repoAbsolute || workspaceAbsolute.startsWith(repoAbsolute + path.sep)) {
  fail('the workspace root must be outside the engine root', 'engine-root-destination');
}
mkdirSync(workspaceAbsolute, {recursive: true});

const projectDir = path.join(workspaceAbsolute, projectId);
const projectFile = path.join(projectDir, 'project.json');

const canonical = (file) => {
  let real;
  try {
    real = require('node:fs').realpathSync(file);
  } catch (error) {
    fail(`cannot resolve ${file}: ${error.message}`, 'unreadable-path');
  }
  if (real !== absolute(file)) {
    // A symlink or junction was followed somewhere else; refuse rather than
    // import bytes from an uncontrolled location.
    fail(`path resolves outside its declared location: ${file} -> ${real}`, 'symlink-escape');
  }
  return real;
};

const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
const writeJson = (file, value) => writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
const sha = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');

// ---------------------------------------------------------------------------
// Audio import (shared by init and import-audio)
// ---------------------------------------------------------------------------

const FORMAT_BY_EXTENSION = {
  '.wav': 'wav-pcm',
  '.mp3': 'mp3',
  '.flac': 'flac',
  '.m4a': 'm4a-aac',
  '.aac': 'm4a-aac',
  '.mp4': 'm4a-aac',
};

const importAudio = ({targetDir, sourcePath, sourceDeclaration, rightsDeclaration, replace}) => {
  if (!sourcePath) fail('--audio is required', 'missing-audio');
  if (!sourceDeclaration || !sourceDeclaration.trim()) fail('--source is required: declare where the file came from', 'missing-provenance');
  if (!rightsDeclaration || !rightsDeclaration.trim()) fail('--rights is required: declare the rights basis', 'missing-rights');

  const resolved = absolute(sourcePath);
  if (!existsSync(resolved)) fail(`audio source does not exist: ${resolved}`, 'missing-audio');
  const stat = statSync(resolved);
  if (!stat.isFile()) fail(`audio source is not a regular file: ${resolved}`, 'missing-audio');
  if (stat.size < 1024) fail(`audio source is only ${stat.size} bytes`, 'unsupported-audio');
  canonical(resolved);

  const extension = path.extname(resolved).toLowerCase();
  const expectedFormat = FORMAT_BY_EXTENSION[extension];
  if (!expectedFormat) {
    fail(`unsupported audio extension ${extension}; supported: wav, mp3, flac, m4a/aac`, 'unsupported-audio');
  }

  // Probe the real bytes before anything is copied.
  let metadata;
  try {
    metadata = probeAudio(resolved, 'AUDIO-MASTER', expectedFormat);
  } catch (error) {
    fail(`audio probe failed: ${error.message}`, 'unsupported-audio');
  }
  if (metadata.decodedDurationSeconds < 1) {
    fail(`decoded duration ${metadata.decodedDurationSeconds}s is too short`, 'unsupported-audio');
  }
  if (metadata.hasUnexpectedStreams) {
    fail('the audio source carries unexpected streams', 'unsupported-audio');
  }

  const sourceSha = sha256File(resolved);
  const targetRelative = `source/audio/${projectId}-master${extension}`;
  const targetAbsolute = path.join(targetDir, targetRelative);
  mkdirSync(path.dirname(targetAbsolute), {recursive: true});

  if (existsSync(targetAbsolute)) {
    const existingSha = sha(targetAbsolute);
    if (existingSha === sourceSha) {
      // Idempotent: the identical approved source is already present.
      return {
        status: 'unchanged',
        path: targetRelative,
        sha256: sourceSha,
        format: metadata.format,
        decodedDurationSeconds: metadata.decodedDurationSeconds,
        sampleRate: metadata.sampleRate,
        channels: metadata.channels,
        fileSizeBytes: metadata.fileSizeBytes,
      };
    }
    if (!replace) {
      fail(
        `a different audio source is already imported (${existingSha.slice(0, 12)} != ${sourceSha.slice(0, 12)}); ` +
          'pass --replace to explicitly supersede it',
        'source-hash-mismatch',
      );
    }
  }

  // Copy the bytes; the source is never moved, trimmed, stretched or resampled.
  copyFileSync(resolved, targetAbsolute);
  const copiedSha = sha256File(targetAbsolute);
  if (copiedSha !== sourceSha) {
    fail(`copy verification failed: expected ${sourceSha}, found ${copiedSha}`, 'source-hash-mismatch');
  }

  return {
    status: existsSync(targetAbsolute) ? 'imported' : 'imported',
    path: targetRelative,
    sha256: sourceSha,
    format: metadata.format,
    container: metadata.container,
    codec: metadata.codec,
    decodedDurationSeconds: metadata.decodedDurationSeconds,
    probeDurationSeconds: metadata.probeDurationSeconds,
    sampleRate: metadata.sampleRate,
    channels: metadata.channels,
    channelLayout: metadata.channelLayout,
    fileSizeBytes: metadata.fileSizeBytes,
    sourceDeclaration: sourceDeclaration.trim(),
    rightsDeclaration: rightsDeclaration.trim(),
    sourcePath: path.basename(resolved),
    importedAt: new Date().toISOString(),
    note: 'The source file was copied byte-for-byte. It was not trimmed, stretched or resampled; decoded duration is reported so the caller can derive the frame count.',
  };
};

// ---------------------------------------------------------------------------
// init
// ---------------------------------------------------------------------------

if (command === 'init') {
  const width = Number(arg('width'));
  const height = Number(arg('height'));
  const fps = Number(arg('fps'));
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 16 || height < 16 || width > 7680 || height > 4320) {
    fail('--width and --height must be integers between 16 and 7680/4320', 'invalid-output-profile');
  }
  if (width % 2 !== 0 || height % 2 !== 0) {
    fail('--width and --height must be even (yuv420p requirement)', 'invalid-output-profile');
  }
  if (!Number.isInteger(fps) || fps < 1 || fps > 120) {
    fail('--fps must be an integer between 1 and 120', 'invalid-output-profile');
  }

  if (existsSync(projectFile)) {
    fail(`project ${projectId} already exists at ${projectFile}; refusing to overwrite project.json`, 'project-collision');
  }
  if (existsSync(projectDir) && !hasFlag('force')) {
    const entries = require('node:fs').readdirSync(projectDir);
    if (entries.length > 0) {
      fail(`directory ${projectDir} already exists and is not empty`, 'project-collision');
    }
  }

  // Create the project skeleton first, then enforce the write boundary.
  for (const dir of ['source/audio', 'assets', 'preproduction', 'renders', 'reports', 'cache']) {
    mkdirSync(path.join(projectDir, dir), {recursive: true});
  }
  const boundary = createWriteBoundary({projectDir, engineRoot: repoRoot});
  ensureSafeDirectory(boundary, path.join(projectDir, 'source', 'audio'), 'project');
  ensureSafeDirectory(boundary, path.join(projectDir, 'assets'), 'project');
  ensureSafeDirectory(boundary, path.join(projectDir, 'preproduction'), 'project');
  ensureSafeDirectory(boundary, path.join(projectDir, 'renders'), 'project');
  ensureSafeDirectory(boundary, path.join(projectDir, 'reports'), 'project');

  const audio = importAudio({
    targetDir: projectDir,
    sourcePath: arg('audio'),
    sourceDeclaration: arg('source', ''),
    rightsDeclaration: arg('rights', ''),
    replace: false,
  });

  const fpsRatio = fps;
  const durationInFrames = Math.max(1, Math.round(audio.decodedDurationSeconds * fpsRatio));

  const project = {
    schemaVersion: 1,
    projectId,
    song: {
      title: arg('title', projectId),
      artist: arg('artist', 'unspecified'),
    },
    audio: {
      path: audio.path,
      sha256: audio.sha256,
      durationSeconds: audio.decodedDurationSeconds,
      durationPolicy: 'round',
      format: audio.format,
      assetId: 'AUDIO-MASTER',
      mixSampleRate: audio.sampleRate,
    },
    lyrics: {language: 'none', path: null},
    narrative: {mode: 'narrative'},
    visual: {
      styleProfile: arg('style', 'unspecified'),
      defaultRenderer: 'layered-canvas',
      pixel: {
        internalWidth: Math.max(8, Math.round(width / 4)),
        internalHeight: Math.max(8, Math.round(height / 4)),
        samplingFps: 12,
      },
    },
    output: {width, height, fps, durationInFrames, aspectRatio: `${width}:${height}`},
    cues: [],
    chapters: [],
    sceneModules: [],
    audioTracks: [],
    assets: [
      {
        id: 'AUDIO-MASTER',
        kind: 'audio-reference',
        path: audio.path,
        sha256: audio.sha256,
        source: audio.sourceDeclaration,
        rights: audio.rightsDeclaration,
        approval: 'approved',
      },
    ],
    // P0 default-deny. Nothing in this workflow can change these.
    permissions: {externalGeneration: false, localOnly: true, allowNetwork: false},
    render: {codec: 'h264', pixelFormat: 'yuv420p', colorSpace: 'bt709', imageFormat: 'png'},
  };

  assertSafePath(boundary, projectFile, {expect: 'file', subtree: 'project'});
  writeJson(projectFile, project);
  writeJson(path.join(projectDir, 'source', 'audio', 'import-record.json'), {
    schemaVersion: 1,
    projectId,
    ...audio,
    verification: 'A user-declared rights assertion is an operational record, not independent verification of copyright ownership.',
  });

  console.log(JSON.stringify({
    status: 'initialized',
    projectId,
    projectDir: path.relative(workspaceAbsolute, projectDir).split(path.sep).join('/'),
    output: {width, height, fps, durationInFrames, aspectRatio: project.output.aspectRatio},
    audio: {
      path: audio.path,
      sha256: audio.sha256,
      format: audio.format,
      decodedDurationSeconds: audio.decodedDurationSeconds,
      sampleRate: audio.sampleRate,
      channels: audio.channels,
      frameCount: durationInFrames,
      sourceDeclaration: audio.sourceDeclaration,
      rightsDeclaration: audio.rightsDeclaration,
    },
    permissions: project.permissions,
    note: 'No asset, plan or storyboard has been approved. Production stays blocked until every requirement is reviewed.',
  }, null, 2));
  process.exit(0);
}

// ---------------------------------------------------------------------------
// import-audio
// ---------------------------------------------------------------------------

if (command === 'import-audio') {
  if (!existsSync(projectFile)) fail(`project ${projectId} does not exist in ${workspaceAbsolute}`, 'unknown-project');
  const boundary = createWriteBoundary({projectDir, engineRoot: repoRoot});
  const project = readJson(projectFile);

  const audio = importAudio({
    targetDir: projectDir,
    sourcePath: arg('audio'),
    sourceDeclaration: arg('source', ''),
    rightsDeclaration: arg('rights', ''),
    replace: hasFlag('replace'),
  });

  if (audio.status === 'unchanged') {
    console.log(JSON.stringify({
      status: 'unchanged',
      projectId,
      note: 'The identical approved source is already imported; no duplicate was created and no timing was rewritten.',
      audio,
    }, null, 2));
    process.exit(0);
  }

  // A changed source must never silently rewrite approved timing.
  const previousFrames = project.output.durationInFrames;
  const nextFrames = Math.max(1, Math.round(audio.decodedDurationSeconds * project.output.fps));
  const timingChanged = previousFrames !== undefined && previousFrames !== nextFrames;

  project.audio = {
    path: audio.path,
    sha256: audio.sha256,
    durationSeconds: audio.decodedDurationSeconds,
    durationPolicy: project.audio.durationPolicy ?? 'round',
    format: audio.format,
    assetId: 'AUDIO-MASTER',
    mixSampleRate: audio.sampleRate,
  };
  project.assets = [
    ...(project.assets ?? []).filter((entry) => entry.id !== 'AUDIO-MASTER'),
    {
      id: 'AUDIO-MASTER',
      kind: 'audio-reference',
      path: audio.path,
      sha256: audio.sha256,
      source: audio.sourceDeclaration,
      rights: audio.rightsDeclaration,
      approval: 'approved',
    },
  ];
  assertSafePath(boundary, projectFile, {expect: 'file', subtree: 'project'});
  writeJson(projectFile, project);
  writeJson(path.join(projectDir, 'source', 'audio', 'import-record.json'), {
    schemaVersion: 1,
    projectId,
    previousSha256: project.audio?.sha256 ?? null,
    ...audio,
    verification: 'A user-declared rights assertion is an operational record, not independent verification of copyright ownership.',
  });

  console.log(JSON.stringify({
    status: 'imported',
    projectId,
    audio,
    previousFrames,
    nextFrames,
    timingChanged,
    note: timingChanged
      ? 'The decoded duration changed the frame count. Existing annotations, plans and storyboards are now stale and must be re-approved; nothing was rewritten automatically.'
      : 'The frame count is unchanged. Existing approvals remain valid if their fingerprints still match.',
  }, null, 2));
  process.exit(0);
}
