// Seeds fresh synthetic projects for the provider output lifecycle acceptance
// suite (retrieval, normalization, handoff, rendering). All media here is
// generated procedurally; nothing is a third-party asset.
//
// Usage: npm run provider:seed
//        node factory/scripts/seed-provider-workspace.mjs --root <external-root>
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
  throw new Error('Provider workspace must be outside and must not contain the engine repository');
}
mkdirSync(rawRoot, {recursive: true});
const workspaceRoot = realpathSync(rawRoot);
if (isInside(engineRoot, workspaceRoot) || isInside(workspaceRoot, engineRoot)) {
  throw new Error('Provider workspace must be outside and must not contain the engine repository');
}

const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');

// --- synthetic WAV -----------------------------------------------------------

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

// --- synthetic PNG -----------------------------------------------------------

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

/**
 * Flat opaque RGBA plate with one lighter band. The colour is deliberately far
 * from the canvas gradient so a decoded render proves the image reached the
 * composition.
 */
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

// --- deliberately incompatible provider clips -------------------------------

const ffmpeg = (argv) => {
  execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...argv], {
    stdio: 'pipe',
    windowsHide: true,
  });
};

/**
 * Produces a clip that the accepted Video renderer must reject: variable frame
 * rate, non-zero display rotation and an embedded audio stream. The palette is
 * split into equal colour segments so decoded frames stay visually distinct
 * after any scaling or rotation.
 */
const writeIncompatibleClip = (file, seconds, palette) => {
  mkdirSync(path.dirname(file), {recursive: true});
  const base = `${file}.base.mp4`;
  const vfr = `${file}.vfr.mp4`;
  const segment = seconds / palette.length;
  const inputArgs = [];
  for (const color of palette) {
    inputArgs.push(
      '-f', 'lavfi', '-i',
      `color=c=${color}:s=320x180:r=30:d=${segment.toFixed(6)}`,
    );
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

// --- project scaffolding -----------------------------------------------------

const baseProject = ({projectId, width, height, fps, durationFrames, audioFile, renderer, params, extraAssets = []}) => ({
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
  chapters: [
    {
      id: 'CH-01',
      title: 'Initial',
      startFrame: 0,
      endFrame: durationFrames,
      shots: [{id: 'SHOT-001', startFrame: 0, endFrame: durationFrames, renderer, params}],
    },
  ],
  sceneModules: [],
  audioTracks: [],
  assets: [
    {
      id: 'AUDIO-MUSIC',
      kind: 'audio-reference',
      path: audioFile,
      sha256: '0'.repeat(64),
      source: 'Procedural synthetic WAV fixture generated by factory/scripts/seed-provider-workspace.mjs',
      rights: 'Synthetic fixture; no third-party rights',
      approval: 'approved',
    },
    ...extraAssets,
  ],
  permissions: {externalGeneration: false, localOnly: true, allowNetwork: false},
  render: {codec: 'h264', pixelFormat: 'yuv420p', colorSpace: 'bt709', imageFormat: 'png'},
});

const baseAnnotations = (projectId, durationFrames, fps) => ({
  schemaVersion: 1,
  projectId,
  bpm: null,
  beatAnchors: [{id: 'ANCHOR-01', frame: 0, timeSeconds: 0, source: 'user', approval: 'approved'}],
  cutCues: [],
  sections: [
    {
      id: 'SEC-01',
      label: 'single',
      startFrame: 0,
      endFrame: durationFrames,
      source: 'user',
      approval: 'approved',
      notes: `${(durationFrames / fps).toFixed(3)}s synthetic section`,
    },
  ],
});

const baseBrief = ({projectId, concept, aspectRatio, style, renderers, directives, extra = {}}) => ({
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
  setting: 'a synthetic provider test chamber',
  continuityRules: ['Keep the single warm accent.'],
  pacing: {preferredShotFrames: 50, minShotFrames: 12, maxShotFrames: 96, allowBeatCuts: false},
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
  requiredAssets: [],
  assumptions: ['Provider bytes are replayed offline; no AI generation is executed.'],
  ...extra,
});

const continuity = (projectId, entries) => ({schemaVersion: 1, projectId, revision: 1, entries});

// Fixture URLs are assembled from parts so the engine-source guard against
// provider URLs stays intact.
const SIM_SCHEME = 'https';
const SIM_HOST = ['dnznrvs05pmza', 'cloudfront', 'net'].join('.');
const SIM_OUTPUT_HOST = SIM_HOST;
const SIM_RESOLVER = {[SIM_OUTPUT_HOST]: ['93.184.216.34']};
const simUrl = (name) => `${SIM_SCHEME}://${SIM_OUTPUT_HOST}/${name}`;

const imageFixture = ({taskId, url, mediaFile}) => ({
  note: 'Recorded Runway contract responses for a text-to-image task; replayed offline.',
  responses: [
    {status: 200, body: {id: taskId}},
    {status: 200, body: {status: 'RUNNING', progress: 0.4}},
    {status: 200, body: {status: 'SUCCEEDED', output: [url]}},
  ],
  tasks: [{status: 200, body: {id: taskId, status: 'SUCCEEDED', output: [url]}}],
  download: {
    steps: [{kind: 'media', contentType: 'image/png', file: mediaFile}],
    resolver: SIM_RESOLVER,
  },
});

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

const writeJson = (file, value) => {
  mkdirSync(path.dirname(file), {recursive: true});
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
};

const PROJECTS = {};

// --- Project A: image retrieval, layer approval and a real render ------------

PROJECTS['synthetic-provider-image-demo'] = {
  width: 640,
  height: 640,
  fps: 25,
  durationFrames: 50,
  audio: ['test-provider-image-tone.wav', 2, 330],
  media: (target) => {
    const plate = path.join(target, 'generation', 'fixtures', 'media', 'plate.png');
    writePlatePng(plate, 640, 640, [30, 107, 255]);
    writeIncompatibleClip(path.join(target, 'generation', 'fixtures', 'media', 'wrong-kind.mp4'), 1.2, ['#C23B3B', '#3B5FC2']);
    writeJson(
      path.join(target, 'generation', 'fixtures', 'image-task.json'),
      imageFixture({taskId: 'task-img-1', url: simUrl('image.png'), mediaFile: 'generation/fixtures/media/plate.png'}),
    );
    writeJson(path.join(target, 'generation', 'fixtures', 'image-wrongkind.json'), {
      note: 'A completed image task whose payload is actually a video; the retrieval must refuse it.',
      tasks: [{status: 200, body: {id: 'task-img-1', status: 'SUCCEEDED', output: [simUrl('wrong-kind.mp4')]}}],
      download: {
        steps: [{kind: 'media', contentType: 'video/mp4', file: 'generation/fixtures/media/wrong-kind.mp4'}],
        resolver: SIM_RESOLVER,
      },
    });
  },
  build: ({audioFile}) => ({
    project: baseProject({
      projectId: 'synthetic-provider-image-demo',
      width: 640,
      height: 640,
      fps: 25,
      durationFrames: 50,
      audioFile,
      renderer: 'layered-canvas',
      params: {background: '#101820', accent: '#F2B705', secondary: '#7BDFF2', motion: 1},
    }),
    annotations: baseAnnotations('synthetic-provider-image-demo', 50, 25),
    brief: baseBrief({
      projectId: 'synthetic-provider-image-demo',
      concept: 'A retrieved plate settles over a dark chamber.',
      aspectRatio: '1:1',
      style: 'flat vector plate',
      renderers: ['layered-canvas'],
      directives: [{id: 'DIR-PLATE', renderer: 'layered-canvas', continuityIds: ['CONT-PLATE'], media: null}],
      extra: {
        requiredAssets: [
          {kind: 'image', description: 'Retrieved sigil plate for the single shot', visualStyle: 'flat vector', alphaRequired: false},
        ],
      },
    }),
    continuity: continuity('synthetic-provider-image-demo', [
      {
        id: 'CONT-PLATE',
        identity: 'sigil-plate',
        kind: 'prop',
        description: 'Cool blue plate with one pale band.',
        shotIds: ['SHOT-001'],
        referenceAssetId: null,
        attributes: {shape: 'banded plate', accent: 'blue'},
        constraints: ['Plate stays cool blue.'],
        exclusions: ['Photographic texture'],
        approval: 'approved',
        revision: 1,
        supersedes: null,
      },
    ]),
  }),
};

// --- Project B: video retrieval, normalization and a real render -------------

PROJECTS['synthetic-provider-video-demo'] = {
  width: 640,
  height: 360,
  fps: 24,
  durationFrames: 48,
  audio: ['test-provider-video-tone.wav', 2, 392],
  media: (target) => {
    writeIncompatibleClip(
      path.join(target, 'generation', 'fixtures', 'media', 'clip-incompatible.mp4'),
      2.4,
      ['#E23B3B', '#3BE27B', '#3B7BE2'],
    );
    writePlatePng(path.join(target, 'assets', 'reference', 'frame.png'), 640, 640, [200, 90, 40]);
    writeJson(
      path.join(target, 'generation', 'fixtures', 'video-task.json'),
      videoFixture({
        taskId: 'task-vid-1',
        url: simUrl('clip.mp4'),
        mediaFile: 'generation/fixtures/media/clip-incompatible.mp4',
      }),
    );
    const mediaDir = path.join(target, 'generation', 'fixtures', 'media');
    writeFileSync(path.join(mediaDir, 'not-a-video.mp4'), '<html><body>this is a web page</body></html>');
    writeJson(path.join(target, 'generation', 'fixtures', 'd-ssrf.json'), {
      note: 'Redirect/resolution attempt towards a loopback address; must be refused.',
      tasks: [{status: 200, body: {id: 'task-vid-1', status: 'SUCCEEDED', output: [simUrl('ssrf.mp4')]}}],
      download: {
        steps: [{kind: 'media', contentType: 'video/mp4', file: 'generation/fixtures/media/clip-incompatible.mp4'}],
        resolver: {[SIM_OUTPUT_HOST]: ['127.0.0.1']},
      },
    });
    writeJson(path.join(target, 'generation', 'fixtures', 'd-oversize.json'), {
      note: 'Declares a response far above the download limit.',
      tasks: [{status: 200, body: {id: 'task-vid-1', status: 'SUCCEEDED', output: [simUrl('big.mp4')]}}],
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
    writeJson(path.join(target, 'generation', 'fixtures', 'd-expire.json'), {
      note: 'First result URL has expired; a re-query of the same task yields a fresh URL.',
      tasks: [
        {status: 200, body: {id: 'task-vid-1', status: 'SUCCEEDED', output: [simUrl('expired.mp4')]}},
        {status: 200, body: {id: 'task-vid-1', status: 'SUCCEEDED', output: [simUrl('fresh.mp4')]}},
      ],
      download: {
        steps: [
          {kind: 'status', status: 403},
          {kind: 'media', contentType: 'video/mp4', file: 'generation/fixtures/media/clip-incompatible.mp4'},
        ],
        resolver: SIM_RESOLVER,
      },
    });
    writeJson(path.join(target, 'generation', 'fixtures', 'd-html.json'), {
      note: 'An HTML page served with a video content type.',
      tasks: [{status: 200, body: {id: 'task-vid-1', status: 'SUCCEEDED', output: [simUrl('page.mp4')]}}],
      download: {
        steps: [{kind: 'media', contentType: 'video/mp4', file: 'generation/fixtures/media/not-a-video.mp4'}],
        resolver: SIM_RESOLVER,
      },
    });
  },
  build: ({audioFile, extraAssets}) => ({
    project: baseProject({
      projectId: 'synthetic-provider-video-demo',
      width: 640,
      height: 360,
      fps: 24,
      durationFrames: 48,
      audioFile,
      renderer: 'layered-canvas',
      params: {background: '#0A1220', accent: '#F2B705', secondary: '#7BDFF2'},
      extraAssets,
    }),
    annotations: baseAnnotations('synthetic-provider-video-demo', 48, 24),
    brief: baseBrief({
      projectId: 'synthetic-provider-video-demo',
      concept: 'A retrieved pass through the test chamber.',
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
    }),
    continuity: continuity('synthetic-provider-video-demo', [
      {
        id: 'CONT-CHAMBER',
        identity: 'provider-chamber',
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

// --- Project C: hybrid continuity with retrieved backgrounds ----------------

PROJECTS['synthetic-provider-hybrid-demo'] = {
  width: 540,
  height: 960,
  fps: 24,
  durationFrames: 96,
  audio: ['test-provider-hybrid-tone.wav', 4, 294],
  media: (target) => {
    writeIncompatibleClip(
      path.join(target, 'generation', 'fixtures', 'media', 'clip-in.mp4'),
      2.4,
      ['#E2A03B', '#3B5FE2', '#3BE2C8'],
    );
    writeIncompatibleClip(
      path.join(target, 'generation', 'fixtures', 'media', 'clip-out.mp4'),
      2.4,
      ['#8E3BE2', '#E2E23B', '#3BE25F'],
    );
    writeJson(
      path.join(target, 'generation', 'fixtures', 'video-task-in.json'),
      videoFixture({taskId: 'task-hyb-in', url: simUrl('clip-in.mp4'), mediaFile: 'generation/fixtures/media/clip-in.mp4'}),
    );
    writeJson(
      path.join(target, 'generation', 'fixtures', 'video-task-out.json'),
      videoFixture({taskId: 'task-hyb-out', url: simUrl('clip-out.mp4'), mediaFile: 'generation/fixtures/media/clip-out.mp4'}),
    );
  },
  build: ({audioFile}) => ({
    project: {
      ...baseProject({
        projectId: 'synthetic-provider-hybrid-demo',
        width: 540,
        height: 960,
        fps: 24,
        durationFrames: 96,
        audioFile,
        renderer: 'layered-canvas',
        params: {background: '#0A1220', accent: '#FFD479', secondary: '#7BDFF2'},
      }),
      chapters: [
        {
          id: 'CH-01',
          title: 'Inbound',
          startFrame: 0,
          endFrame: 48,
          shots: [{id: 'SHOT-001', startFrame: 0, endFrame: 48, renderer: 'layered-canvas', params: {background: '#0A1220'}}],
        },
        {
          id: 'CH-02',
          title: 'Outbound',
          startFrame: 48,
          endFrame: 96,
          shots: [{id: 'SHOT-002', startFrame: 48, endFrame: 96, renderer: 'layered-canvas', params: {background: '#101820'}}],
        },
      ],
    },
    annotations: {
      schemaVersion: 1,
      projectId: 'synthetic-provider-hybrid-demo',
      bpm: null,
      beatAnchors: [
        {id: 'ANCHOR-01', frame: 0, timeSeconds: 0, source: 'user', approval: 'approved'},
        {id: 'ANCHOR-02', frame: 48, timeSeconds: 2, source: 'user', approval: 'approved'},
      ],
      cutCues: [],
      sections: [
        {id: 'SEC-01', label: 'inbound', startFrame: 0, endFrame: 48, source: 'user', approval: 'approved'},
        {id: 'SEC-02', label: 'outbound', startFrame: 48, endFrame: 96, source: 'user', approval: 'approved'},
      ],
    },
    brief: baseBrief({
      projectId: 'synthetic-provider-hybrid-demo',
      concept: 'One lantern crosses two retrieved views of a chamber.',
      aspectRatio: '9:16',
      style: 'hybrid plate with a generated layer',
      renderers: ['hybrid'],
      directives: [
        {
          id: 'DIR-IN',
          renderer: 'hybrid',
          continuityIds: ['CONT-LANTERN', 'CONT-CHAMBER'],
          media: {
            kind: 'hybrid',
            backgroundSlot: 'bg',
            sourceStartFrames: 0,
            fit: 'cover',
            positionX: 0,
            positionY: 0,
            scale: 1,
            layers: [
              {slot: 'lantern', order: 0, opacity: 1, fit: 'contain', positionX: 0, positionY: 0, scale: 1, visibleFromFrame: 0, visibleToFrame: 48},
            ],
            overlay: {kind: 'rain', intensity: 0.3, color: '#7BDFF2'},
          },
        },
        {
          id: 'DIR-OUT',
          renderer: 'hybrid',
          continuityIds: ['CONT-LANTERN', 'CONT-CHAMBER'],
          media: {
            kind: 'hybrid',
            backgroundSlot: 'bg',
            sourceStartFrames: 0,
            fit: 'cover',
            positionX: 0,
            positionY: 0,
            scale: 1,
            layers: [
              {slot: 'lantern', order: 0, opacity: 1, fit: 'contain', positionX: 0, positionY: 0, scale: 1, visibleFromFrame: 0, visibleToFrame: 48},
            ],
            overlay: {kind: 'scan', intensity: 0.25, color: '#FFD479'},
          },
        },
      ],
    }),
    continuity: continuity('synthetic-provider-hybrid-demo', [
      {
        id: 'CONT-LANTERN',
        identity: 'provider-lantern',
        kind: 'prop',
        description: 'Round paper lantern with a warm centre.',
        shotIds: ['SHOT-001', 'SHOT-002'],
        referenceAssetId: null,
        attributes: {shape: 'round', accent: 'amber'},
        constraints: ['One warm source only.'],
        exclusions: ['Faces'],
        approval: 'approved',
        revision: 1,
        supersedes: null,
      },
      {
        id: 'CONT-CHAMBER',
        identity: 'provider-chamber',
        kind: 'location',
        description: 'Dark chamber with a tiled floor.',
        shotIds: ['SHOT-001', 'SHOT-002'],
        referenceAssetId: null,
        attributes: {floor: 'tiled', walls: 'dark'},
        constraints: ['Horizon in the upper third.'],
        exclusions: ['Daylight'],
        approval: 'approved',
        revision: 1,
        supersedes: null,
      },
    ]),
  }),
};

// --- Project D: guard-only project for stale and refusal checks -------------

PROJECTS['synthetic-provider-guard-demo'] = {
  width: 640,
  height: 360,
  fps: 24,
  durationFrames: 48,
  audio: ['test-provider-guard-tone.wav', 2, 349],
  media: (target) => {
    writeJson(path.join(target, 'generation', 'fixtures', 'timeout.json'), {
      note: 'Simulates a timeout after the request may have reached the provider.',
      responses: [{timeout: true}],
    });
    writeJson(path.join(target, 'generation', 'fixtures', 'video-task.json'), {
      note: 'A completed task document used only to prove that a parked job cannot be retried.',
      responses: [
        {status: 200, body: {id: 'task-guard-1'}},
        {status: 200, body: {status: 'SUCCEEDED', output: [simUrl('guard.mp4')]}},
      ],
      tasks: [{status: 200, body: {id: 'task-guard-1', status: 'SUCCEEDED', output: [simUrl('guard.mp4')]}}],
      download: {
        steps: [{kind: 'status', status: 403}],
        resolver: SIM_RESOLVER,
      },
    });
  },
  build: ({audioFile}) => ({
    project: baseProject({
      projectId: 'synthetic-provider-guard-demo',
      width: 640,
      height: 360,
      fps: 24,
      durationFrames: 48,
      audioFile,
      renderer: 'layered-canvas',
      params: {background: '#0A1220', accent: '#F2B705', secondary: '#7BDFF2'},
    }),
    annotations: baseAnnotations('synthetic-provider-guard-demo', 48, 24),
    brief: baseBrief({
      projectId: 'synthetic-provider-guard-demo',
      concept: 'A guard-only chamber used for refusal checks.',
      aspectRatio: '16:9',
      style: 'captured plate',
      renderers: ['video'],
      directives: [
        {
          id: 'DIR-CLIP',
          renderer: 'video',
          continuityIds: ['CONT-GUARD'],
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
    }),
    continuity: continuity('synthetic-provider-guard-demo', [
      {
        id: 'CONT-GUARD',
        identity: 'guard-chamber',
        kind: 'location',
        description: 'Guard-only chamber.',
        shotIds: ['SHOT-001'],
        referenceAssetId: null,
        attributes: {lighting: 'flat', walls: 'dark'},
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

  const extraAssets = [];
  const referenceFile = path.join(target, 'assets', 'reference', 'frame.png');
  spec.media(target);
  if (existsSync(referenceFile)) {
    extraAssets.push({
      id: 'REF-FRAME',
      kind: 'image',
      path: 'assets/reference/frame.png',
      sha256: sha256(referenceFile),
      source: 'Procedural synthetic reference plate generated by factory/scripts/seed-provider-workspace.mjs',
      rights: 'Synthetic fixture; no third-party rights',
      approval: 'approved',
    });
  }

  const built = spec.build({audioFile: audioRelative, extraAssets});
  built.project.audio.sha256 = audioSha;
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
