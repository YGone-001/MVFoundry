// Seeds fresh synthetic projects for the go-live readiness acceptance suite
// (pricing, budget reservations, network policy, retrieval finalization and a
// full generation-to-render regression). All media is generated procedurally.
//
// Usage: npm run golive:seed
//        node factory/scripts/seed-golive-workspace.mjs --root <external-root>
// Requires FFmpeg for the synthetic clips.

import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {deflateSync} from 'node:zlib';
import {existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const {isInside} = require('../dist/src/workspace/guard.js');

const args = process.argv.slice(2);
const rootArg = args.includes('--root') ? args[args.indexOf('--root') + 1] : undefined;
const rawRoot = rootArg ?? process.env.MV_WORKSPACE_ROOT;
if (!rawRoot) {
  console.error('MV_WORKSPACE_ROOT or --root is required');
  process.exit(2);
}

const engineRoot = realpathSync(repoRoot);
let ancestor = path.resolve(rawRoot);
while (!existsSync(ancestor)) {
  const parent = path.dirname(ancestor);
  if (parent === ancestor) break;
  ancestor = parent;
}
if (isInside(engineRoot, realpathSync(ancestor)) || isInside(realpathSync(ancestor), engineRoot)) {
  throw new Error('Go-live workspace must be outside and must not contain the engine repository');
}
mkdirSync(rawRoot, {recursive: true});
const workspaceRoot = realpathSync(rawRoot);
if (isInside(engineRoot, workspaceRoot) || isInside(workspaceRoot, engineRoot)) {
  throw new Error('Go-live workspace must be outside and must not contain the engine repository');
}

const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');

const writeWav = (file, seconds, frequency) => {
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
    const value = Math.max(-1, Math.min(1,
      Math.sin((2 * Math.PI * frequency * index) / sampleRate) * 0.16 * envelope + pulse * envelope));
    const sample = Math.round(value * 32767);
    buffer.writeInt16LE(sample, 44 + index * 4);
    buffer.writeInt16LE(sample, 46 + index * 4);
  }
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

const writePlatePng = (file, width, height, rgb) => {
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
  writeFileSync(file, Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(raw, {level: 6})),
    pngChunk('IEND', Buffer.alloc(0)),
  ]));
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
const writeIncompatibleClip = (file, seconds, palette) => {
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
    '-filter_complex', filter,
    '-map', '[v]',
    '-map', `${palette.length}:a`,
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac',
    '-t', seconds.toFixed(6),
    '-movflags', '+faststart', base,
  ]);
  ffmpeg([
    '-i', base,
    '-vf', "select='not(mod(n\\,2))+not(mod(n\\,3))'",
    '-fps_mode', 'passthrough',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'copy',
    '-movflags', '+faststart', vfr,
  ]);
  ffmpeg(['-display_rotation', '90', '-i', vfr, '-c', 'copy', file]);
};

const baseProject = ({projectId, width, height, fps, durationFrames, audioFile, renderer, params, chapters, permissions}) => ({
  schemaVersion: 1,
  projectId,
  song: {title: `Synthetic ${projectId}`, artist: 'Factory Fixtures'},
  audio: {
    path: audioFile,
    sha256: '0'.repeat(64),
    durationSeconds: durationFrames / fps,
    durationPolicy: 'round',
    format: 'wav-pcm',
    assetId: 'AUDIO-MUSIC',
    mixSampleRate: 48000,
  },
  lyrics: {language: 'none', path: null},
  narrative: {mode: 'abstract'},
  visual: {styleProfile: 'abstract', defaultRenderer: renderer},
  output: {width, height, fps, durationInFrames: durationFrames},
  cues: [
    {id: 'CUE-01', frame: 0, timeSeconds: 0, source: 'synthetic', label: 'start'},
    {id: 'CUE-02', frame: durationFrames, timeSeconds: durationFrames / fps, source: 'synthetic', label: 'end'},
  ],
  chapters,
  sceneModules: [],
  audioTracks: [],
  assets: [
    {
      id: 'AUDIO-MUSIC',
      kind: 'audio-reference',
      path: audioFile,
      sha256: '0'.repeat(64),
      source: 'Procedural synthetic WAV fixture generated by factory/scripts/seed-golive-workspace.mjs',
      rights: 'Synthetic fixture; no third-party rights',
      approval: 'approved',
    },
  ],
  permissions: permissions ?? {externalGeneration: false, localOnly: true, allowNetwork: false},
  render: {codec: 'h264', pixelFormat: 'yuv420p', colorSpace: 'bt709', imageFormat: 'png'},
});

const baseAnnotations = (projectId, sections) => ({
  schemaVersion: 1,
  projectId,
  bpm: null,
  beatAnchors: sections.map((section, index) => ({
    id: `ANCHOR-0${index + 1}`,
    frame: section.startFrame,
    timeSeconds: section.startFrame / section.fps,
    source: 'user',
    approval: 'approved',
  })),
  cutCues: [],
  sections: sections.map((section, index) => ({
    id: `SEC-0${index + 1}`,
    label: section.label,
    startFrame: section.startFrame,
    endFrame: section.endFrame,
    source: 'user',
    approval: 'approved',
  })),
});

const baseBrief = ({projectId, concept, aspectRatio, style, renderers, directives, requiredAssets}) => ({
  schemaVersion: 1,
  projectId,
  source: 'user',
  approval: 'approved',
  concept,
  narrativeMode: 'abstract',
  moodProgression: ['still', 'settling'],
  visualStyle: style,
  aspectRatio,
  palette: ['#101820', '#F2B705', '#7BDFF2'],
  characters: [],
  setting: 'a synthetic go-live test chamber',
  continuityRules: ['Keep the single warm accent.'],
  pacing: {preferredShotFrames: 48, minShotFrames: 12, maxShotFrames: 48, allowBeatCuts: false},
  cameraLanguage: ['locked frame'],
  transitions: ['no cut'],
  approvedReferences: [],
  excludedElements: ['faces', 'text overlays'],
  productionConstraints: [
    'Provider output is replayed from recorded fixtures; no live request is authorized.',
    'A technical PASS never becomes an approval without a reviewer decision.',
  ],
  preferredRenderers: renderers,
  rendererDirectives: directives,
  requiredAssets,
  assumptions: ['Provider bytes are replayed offline; no AI generation is executed.'],
});

const continuity = (projectId, entries) => ({schemaVersion: 1, projectId, revision: 1, entries});

const SIM_SCHEME = 'https';
const SIM_HOST = ['dnznrvs05pmza', 'cloudfront', 'net'].join('.');
const SIM_RESOLVER = {[SIM_HOST]: ['93.184.216.34']};
const simUrl = (name) => `${SIM_SCHEME}://${SIM_HOST}/${name}`;

const writeJson = (file, value) => {
  mkdirSync(path.dirname(file), {recursive: true});
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
};

const videoFixture = ({taskId, url, mediaFile}) => ({
  note: 'Recorded Runway contract responses for an image-to-video task; replayed offline.',
  responses: [
    {status: 200, body: {id: taskId}},
    {status: 200, body: {status: 'RUNNING', progress: 0.6}},
    {status: 200, body: {status: 'SUCCEEDED', output: [url]}},
  ],
  tasks: [{status: 200, body: {id: taskId, status: 'SUCCEEDED', output: [url]}}],
  download: {
    steps: [{kind: 'media', contentType: 'video/mp4', file: mediaFile}],
    resolver: SIM_RESOLVER,
  },
});

const PROJECTS = {};

// --- Project A: pricing, authorization and preflight -----------------------

PROJECTS['synthetic-golive-pricing-demo'] = {
  width: 640,
  height: 360,
  fps: 24,
  durationFrames: 144,
  audio: ['test-golive-pricing-tone.wav', 6, 330],
  media: (target) => {
    writePlatePng(path.join(target, 'assets', 'images', 'plate.png'), 640, 640, [40, 120, 220]);
    const snapshotDir = path.join(target, 'generation', 'fixtures');
    const base = {
      schemaVersion: 1,
      provider: 'runway',
      pricingVersion: 'runway-fixture',
      sourceUrl: 'docs.dev.runwayml.com/guides/pricing/',
      creditToUsd: 0.01,
      currency: 'USD',
      rounding: 'round-up-to-credit',
      taxNote: 'Synthetic fixture.',
      models: [
        {
          model: 'gen4_turbo',
          operation: 'image-to-video',
          unit: 'per-second',
          tierDimension: 'duration-seconds',
          tiers: [{min: 0, max: null, creditsPerUnit: 5}],
          minimumCredits: null,
          creditsPerReference: null,
          notes: ['Synthetic fixture tier.'],
        },
      ],
      unsupported: [],
      caveats: ['Synthetic fixture; not the published tariff.'],
    };
    const withHash = (value) => {
      const {createHash} = require('node:crypto');
      const canonical = (input) => {
        if (input === null || typeof input !== 'object') return JSON.stringify(input);
        if (Array.isArray(input)) return `[${input.map(canonical).join(',')}]`;
        const entries = Object.entries(input)
          .filter(([, entry]) => entry !== undefined)
          .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
        return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(',')}}`;
      };
      return {...value, snapshotSha256: createHash('sha256').update(canonical(value)).digest('hex')};
    };
    writeJson(
      path.join(snapshotDir, 'pricing-stale.json'),
      withHash({...base, retrievedAt: '2020-01-01T00:00:00.000Z'}),
    );
    writeJson(
      path.join(snapshotDir, 'pricing-unsupported.json'),
      withHash({
        ...base,
        retrievedAt: new Date().toISOString(),
        models: [],
        unsupported: [{model: 'gen4_turbo', reason: 'synthetic fixture marks this model unsupported'}],
      }),
    );
    writeJson(
      path.join(snapshotDir, 'pricing-missing.json'),
      withHash({...base, retrievedAt: new Date().toISOString(), models: [], unsupported: []}),
    );
    const tampered = withHash({...base, retrievedAt: new Date().toISOString()});
    tampered.models[0].tiers[0].creditsPerUnit = 1;
    writeJson(path.join(snapshotDir, 'pricing-tampered.json'), tampered);
  },
  build: ({audioFile}) => ({
    project: baseProject({
      projectId: 'synthetic-golive-pricing-demo',
      width: 640,
      height: 360,
      fps: 24,
      durationFrames: 144,
      audioFile,
      renderer: 'layered-canvas',
      params: {background: '#101820', accent: '#F2B705', secondary: '#7BDFF2'},
      chapters: [
        {
          id: 'CH-01',
          title: 'First',
          startFrame: 0,
          endFrame: 48,
          shots: [{id: 'SHOT-001', startFrame: 0, endFrame: 48, renderer: 'layered-canvas', params: {background: '#101820'}}],
        },
        {
          id: 'CH-02',
          title: 'Second',
          startFrame: 48,
          endFrame: 96,
          shots: [{id: 'SHOT-002', startFrame: 48, endFrame: 96, renderer: 'layered-canvas', params: {background: '#0A1220'}}],
        },
        {
          id: 'CH-03',
          title: 'Third',
          startFrame: 96,
          endFrame: 144,
          shots: [{id: 'SHOT-003', startFrame: 96, endFrame: 144, renderer: 'layered-canvas', params: {background: '#121A24'}}],
        },
      ],
    }),
    annotations: baseAnnotations('synthetic-golive-pricing-demo', [
      {label: 'first', startFrame: 0, endFrame: 48, fps: 24},
      {label: 'second', startFrame: 48, endFrame: 96, fps: 24},
      {label: 'third', startFrame: 96, endFrame: 144, fps: 24},
    ]),
    brief: baseBrief({
      projectId: 'synthetic-golive-pricing-demo',
      concept: 'Two priced clips and one plate settle in a chamber.',
      aspectRatio: '16:9',
      style: 'flat vector plate',
      renderers: ['video', 'layered-canvas'],
      directives: [
        {
          id: 'DIR-CLIP-A',
          renderer: 'video',
          continuityIds: ['CONT-CHAMBER'],
          media: {
            kind: 'video',
            backgroundSlot: 'bg',
            sourceStartFrames: 0,
            fit: 'cover',
            positionX: 0,
            positionY: 0,
            scale: 1,
          },
        },
        {
          id: 'DIR-CLIP-B',
          renderer: 'video',
          continuityIds: ['CONT-CHAMBER'],
          media: {
            kind: 'video',
            backgroundSlot: 'bg',
            sourceStartFrames: 0,
            fit: 'cover',
            positionX: 0,
            positionY: 0,
            scale: 1,
          },
        },
        {id: 'DIR-PLATE', renderer: 'layered-canvas', continuityIds: ['CONT-PLATE'], media: null},
      ],
      requiredAssets: [
        {kind: 'image', description: 'Priced sigil plate for the final shot', visualStyle: 'flat vector', alphaRequired: false},
      ],
    }),
    continuity: continuity('synthetic-golive-pricing-demo', [
      {
        id: 'CONT-PLATE',
        identity: 'priced-plate',
        kind: 'prop',
        description: 'Cool blue plate with one pale band.',
        shotIds: ['SHOT-003'],
        referenceAssetId: null,
        attributes: {shape: 'banded plate', accent: 'blue'},
        constraints: ['Plate stays cool blue.'],
        exclusions: ['Photographic texture'],
        approval: 'approved',
        revision: 1,
        supersedes: null,
      },
      {
        id: 'CONT-CHAMBER',
        identity: 'priced-chamber',
        kind: 'location',
        description: 'Dark chamber with one amber practical light.',
        shotIds: ['SHOT-001', 'SHOT-002'],
        referenceAssetId: null,
        attributes: {lighting: 'single amber key', walls: 'dark'},
        constraints: ['No daylight.'],
        exclusions: ['Crowds'],
        approval: 'approved',
        revision: 1,
        supersedes: null,
      },
    ]),
  }),
};

// --- Project C/D: network policy, retrieval and a real render --------------

PROJECTS['synthetic-golive-render-demo'] = {
  width: 640,
  height: 360,
  fps: 24,
  durationFrames: 48,
  audio: ['test-golive-render-tone.wav', 2, 392],
  media: (target) => {
    writeIncompatibleClip(
      path.join(target, 'generation', 'fixtures', 'media', 'clip-incompatible.mp4'),
      2.4,
      ['#E23B3B', '#3BE27B', '#3B7BE2'],
    );
    writePlatePng(path.join(target, 'assets', 'reference', 'frame.png'), 640, 640, [200, 90, 40]);
    const mediaDir = path.join(target, 'generation', 'fixtures', 'media');
    writeFileSync(path.join(mediaDir, 'not-a-video.mp4'), '<html><body>this is a web page</body></html>');
    writeJson(
      path.join(target, 'generation', 'fixtures', 'video-task.json'),
      videoFixture({
        taskId: 'task-golive-1',
        url: simUrl('clip.mp4'),
        mediaFile: 'generation/fixtures/media/clip-incompatible.mp4',
      }),
    );
    writeJson(path.join(target, 'generation', 'fixtures', 'd-ssrf.json'), {
      note: 'Resolution attempt towards a loopback address; must be refused.',
      tasks: [{status: 200, body: {id: 'task-golive-1', status: 'SUCCEEDED', output: [simUrl('ssrf.mp4')]}}],
      download: {
        steps: [{kind: 'media', contentType: 'video/mp4', file: 'generation/fixtures/media/clip-incompatible.mp4'}],
        resolver: {[SIM_HOST]: ['127.0.0.1']},
      },
    });
    writeJson(path.join(target, 'generation', 'fixtures', 'd-oversize.json'), {
      note: 'Declares a response far above the download limit.',
      tasks: [{status: 200, body: {id: 'task-golive-1', status: 'SUCCEEDED', output: [simUrl('big.mp4')]}}],
      download: {
        steps: [{
          kind: 'media',
          contentType: 'video/mp4',
          file: 'generation/fixtures/media/clip-incompatible.mp4',
          headers: {'content-length': '999999999'},
        }],
        resolver: SIM_RESOLVER,
      },
    });
    writeJson(path.join(target, 'generation', 'fixtures', 'd-interrupted.json'), {
      note: 'A truncated stream; the finalization must refuse and leave no published output.',
      tasks: [{status: 200, body: {id: 'task-golive-1', status: 'SUCCEEDED', output: [simUrl('cut.mp4')]}}],
      download: {
        steps: [{
          kind: 'media',
          contentType: 'video/mp4',
          file: 'generation/fixtures/media/clip-incompatible.mp4',
          truncateAt: 4096,
        }],
        resolver: SIM_RESOLVER,
      },
    });
    writeJson(path.join(target, 'generation', 'fixtures', 'd-expire.json'), {
      note: 'First result URL has expired; a re-query of the same task yields a fresh URL.',
      tasks: [
        {status: 200, body: {id: 'task-golive-1', status: 'SUCCEEDED', output: [simUrl('expired.mp4')]}},
        {status: 200, body: {id: 'task-golive-1', status: 'SUCCEEDED', output: [simUrl('fresh.mp4')]}},
      ],
      download: {
        steps: [
          {kind: 'status', status: 403},
          {kind: 'media', contentType: 'video/mp4', file: 'generation/fixtures/media/clip-incompatible.mp4'},
        ],
        resolver: SIM_RESOLVER,
      },
    });
    writeJson(path.join(target, 'generation', 'fixtures', 'timeout.json'), {
      note: 'Simulates a timeout after the request may have reached the provider.',
      responses: [{timeout: true}],
    });
    writeJson(path.join(target, 'generation', 'fixtures', 'd-redirect.json'), {
      note: 'A redirect towards a host outside the trusted delivery policy.',
      tasks: [{status: 200, body: {id: 'task-golive-1', status: 'SUCCEEDED', output: [simUrl('redirect.mp4')]}}],
      download: {
        steps: [{kind: 'redirect', status: 302, location: `${SIM_SCHEME}://attacker.example.invalid/stolen.mp4`}],
        resolver: SIM_RESOLVER,
      },
    });
    writeJson(path.join(target, 'generation', 'fixtures', 'd-html.json'), {
      note: 'An HTML page served with a video content type.',
      tasks: [{status: 200, body: {id: 'task-golive-1', status: 'SUCCEEDED', output: [simUrl('page.mp4')]}}],
      download: {
        steps: [{kind: 'media', contentType: 'video/mp4', file: 'generation/fixtures/media/not-a-video.mp4'}],
        resolver: SIM_RESOLVER,
      },
    });
  },
  build: ({audioFile}) => ({
    project: baseProject({
      projectId: 'synthetic-golive-render-demo',
      width: 640,
      height: 360,
      fps: 24,
      durationFrames: 48,
      audioFile,
      renderer: 'layered-canvas',
      params: {background: '#0A1220', accent: '#F2B705', secondary: '#7BDFF2'},
      chapters: [
        {
          id: 'CH-01',
          title: 'Single',
          startFrame: 0,
          endFrame: 48,
          shots: [{id: 'SHOT-001', startFrame: 0, endFrame: 48, renderer: 'layered-canvas', params: {background: '#0A1220'}}],
        },
      ],
    }),
    annotations: baseAnnotations('synthetic-golive-render-demo', [
      {label: 'single', startFrame: 0, endFrame: 48, fps: 24},
    ]),
    brief: baseBrief({
      projectId: 'synthetic-golive-render-demo',
      concept: 'A retrieved pass through the go-live chamber.',
      aspectRatio: '16:9',
      style: 'captured plate',
      renderers: ['video'],
      directives: [
        {
          id: 'DIR-CLIP',
          renderer: 'video',
          continuityIds: ['CONT-CHAMBER'],
          media: {
            kind: 'video',
            backgroundSlot: 'bg',
            sourceStartFrames: 0,
            fit: 'cover',
            positionX: 0,
            positionY: 0,
            scale: 1,
          },
        },
      ],
      requiredAssets: [],
    }),
    continuity: continuity('synthetic-golive-render-demo', [
      {
        id: 'CONT-CHAMBER',
        identity: 'golive-chamber',
        kind: 'location',
        description: 'Dark chamber with one amber practical light.',
        shotIds: ['SHOT-001'],
        referenceAssetId: 'REF-FRAME',
        attributes: {lighting: 'single amber key', walls: 'dark'},
        constraints: ['No daylight.'],
        exclusions: ['Crowds'],
        approval: 'approved',
        revision: 1,
        supersedes: null,
      },
    ]),
  }),
};

const generated = [];
for (const projectId of Object.keys(PROJECTS).sort()) {
  const spec = PROJECTS[projectId];
  const target = path.join(workspaceRoot, projectId);
  if (existsSync(target)) throw new Error(`Project already exists: ${target}; use a fresh workspace`);
  mkdirSync(target, {recursive: true});
  for (const directory of ['source/audio', 'preproduction', 'cache', 'renders', 'reports', 'generation/fixtures', 'generation/outputs']) {
    mkdirSync(path.join(target, directory), {recursive: true});
  }
  const audioRelative = `source/audio/${spec.audio[0]}`;
  const audioFile = path.join(target, audioRelative);
  writeWav(audioFile, spec.audio[1], spec.audio[2]);
  const audioSha = sha256(audioFile);

  spec.media(target);

  const extraAssets = [];
  const referenceFile = path.join(target, 'assets', 'reference', 'frame.png');
  if (existsSync(referenceFile)) {
    extraAssets.push({
      id: 'REF-FRAME',
      kind: 'image',
      path: 'assets/reference/frame.png',
      sha256: sha256(referenceFile),
      source: 'Procedural synthetic reference plate generated by factory/scripts/seed-golive-workspace.mjs',
      rights: 'Synthetic fixture; no third-party rights',
      approval: 'approved',
    });
  }
  const plateFile = path.join(target, 'assets', 'images', 'plate.png');
  if (existsSync(plateFile)) {
    extraAssets.push({
      id: 'IMG-PLATE',
      kind: 'image',
      path: 'assets/images/plate.png',
      sha256: sha256(plateFile),
      source: 'Procedural synthetic plate generated by factory/scripts/seed-golive-workspace.mjs',
      rights: 'Synthetic fixture; no third-party rights',
      approval: 'approved',
    });
  }

  const built = spec.build({audioFile: audioRelative});
  built.project.audio.sha256 = audioSha;
  built.project.assets = [...built.project.assets, ...extraAssets];
  for (const asset of built.project.assets) {
    if (asset.kind === 'audio-reference') asset.sha256 = audioSha;
  }
  writeFileSync(path.join(target, 'project.json'), `${JSON.stringify(built.project, null, 2)}\n`);
  for (const [name, value] of [
    ['annotations', built.annotations],
    ['creative-brief', built.brief],
    ['continuity', built.continuity],
  ]) {
    writeJson(path.join(target, 'preproduction', `${name}.json`), value);
  }
  generated.push({projectId, projectDir: target, audio: {path: audioRelative, sha256: audioSha}});
}

console.log(JSON.stringify({workspaceRoot, projects: generated}, null, 2));
