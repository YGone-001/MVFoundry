// Verifies multi-format audio ingestion, frame/sample alignment, multitrack
// mixing and cue analysis with real Remotion renders and decoded output audio.
//
// Usage:
//   node factory/scripts/verify-audio-render.mjs --workspace <external-workspace>
//   node factory/scripts/verify-audio-render.mjs --workspace <...> --no-render
//
// Requires FFmpeg/FFprobe on PATH, a usable Remotion browser and factory/dist.

import {execFileSync} from 'node:child_process';
import {existsSync, readFileSync, statSync, writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : fallback;
};
const workspaceRoot = arg('workspace', process.env.MV_WORKSPACE_ROOT);
const noRender = args.includes('--no-render');
if (!workspaceRoot) {
  console.error('MV_WORKSPACE_ROOT or --workspace is required');
  process.exit(2);
}

const {loadProject} = require('../dist/src/project/loadProject.js');
const {sha256File} = require('../dist/src/media/hash.js');
const {decodeAudioToNormalizedPcm} = require('../dist/src/media/audioDecode.js');
const {stereoToMono} = require('../dist/src/audio/analysis.js');
const {
  measureTone,
  findToneRegions,
  measurePulseAt,
  rmsOfRange,
  peakOfRange,
  amplitudeDb,
} = require('../dist/src/audio/evidence.js');
const {frameToSampleIndex} = require('../dist/src/timeline/audioClock.js');
const {
  assertSafePath,
  createProjectWriteBoundary,
  ensureSafeDirectory,
  resolveRenderOutputPath,
} = require('../dist/src/workspace/writeBoundary.js');

const PROJECTS = [
  {
    id: 'synthetic-audio-mp3-demo',
    frames: [0, 47],
    mixSampleRate: 48000,
    outputFps: 24,
    expectedFrames: 48,
    width: 480,
    height: 270,
  },
  {
    id: 'synthetic-audio-multitrack-demo',
    frames: [0, 59],
    mixSampleRate: 48000,
    outputFps: 30,
    expectedFrames: 60,
    width: 1080,
    height: 1920,
  },
  {
    id: 'synthetic-audio-boundaries-demo',
    frames: [24, 40],
    mixSampleRate: 44100,
    outputFps: 24,
    expectedFrames: 17,
    width: 480,
    height: 270,
  },
];

const ffprobeJson = (file) => {
  const raw = execFileSync(
    'ffprobe',
    ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', file],
    {encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, windowsHide: true},
  );
  return JSON.parse(raw);
};

const rawFrame = (file, frame, width, height) => {
  const bytes = execFileSync(
    'ffmpeg',
    [
      '-v',
      'error',
      '-i',
      file,
      '-vf',
      `select=eq(n\\,${frame})`,
      '-frames:v',
      '1',
      '-f',
      'rawvideo',
      '-pix_fmt',
      'rgb24',
      '-',
    ],
    {encoding: null, maxBuffer: 64 * 1024 * 1024, windowsHide: true},
  );
  if (bytes.length !== width * height * 3) {
    throw new Error(
      `Decoded frame ${frame} has ${bytes.length} bytes; expected ${width * height * 3}`,
    );
  }
  return bytes;
};

const averageRgb = (bytes) => {
  const sums = [0, 0, 0];
  const pixels = bytes.length / 3;
  for (let index = 0; index < bytes.length; index += 3) {
    sums[0] += bytes[index];
    sums[1] += bytes[index + 1];
    sums[2] += bytes[index + 2];
  }
  return sums.map((sum) => Math.round(sum / pixels));
};

const frameWindow = (startFrame, endFrame, sampleRate, fps) => [
  frameToSampleIndex(startFrame, sampleRate, fps),
  frameToSampleIndex(endFrame, sampleRate, fps),
];

const toneAt = (mono, sampleRate, frequency, startSample, endSample) => {
  const measurement = measureTone(mono, sampleRate, frequency, startSample, endSample);
  return {
    frequency,
    startSample: measurement.startSample,
    endSample: measurement.endSample,
    amplitude: Number(measurement.amplitude.toFixed(6)),
    dbfs: Number(measurement.dbfs.toFixed(3)),
  };
};

const toneAtFrames = (mono, sampleRate, fps, frequency, startFrame, endFrame) => {
  const [start, end] = frameWindow(startFrame, endFrame, sampleRate, fps);
  return toneAt(mono, sampleRate, frequency, start, end);
};

const expectedAmplitude = (sourceAmplitude, gainDb) => sourceAmplitude * 10 ** (gainDb / 20);

const projectFiles = (project) => {
  const master = project.assets.find((asset) => asset.id === project.config.audio.assetId);
  return {
    master,
    tracks: project.config.audioTracks.map((track) => ({
      track,
      asset: project.assets.find((asset) => asset.id === track.assetId),
    })),
    hashAll: project.assets
      .filter((asset) => asset.approval === 'approved' && asset.absolutePath)
      .map((asset) => ({id: asset.id, path: asset.path, sha256: sha256File(asset.absolutePath)})),
  };
};

const runRender = (project) => {
  const start = project.frames[0];
  const end = project.frames[1];
  const script = path.join(repoRoot, 'factory', 'scripts', 'render-project.mjs');
  execFileSync(
    process.execPath,
    [
      script,
      '--project',
      project.id,
      '--mode',
      'video',
      '--frames',
      `${start}-${end}`,
      '--workspace',
      workspaceRoot,
    ],
    {cwd: repoRoot, env: process.env, stdio: 'inherit', windowsHide: true},
  );
};

const verifyProject = (spec) => {
  const project = loadProject(spec.id, {workspaceRoot, engineRoot: repoRoot});
  if (project.config.audio.mixSampleRate !== spec.mixSampleRate) {
    throw new Error(`${spec.id} mix sample rate does not match the verification spec`);
  }
  if (project.config.output.fps !== spec.outputFps) {
    throw new Error(`${spec.id} output fps does not match the verification spec`);
  }
  const boundary = createProjectWriteBoundary(project, {engineRoot: repoRoot});
  if (!noRender) runRender(spec);

  const output = resolveRenderOutputPath(boundary, {mode: 'video', projectId: spec.id});
  if (!existsSync(output)) throw new Error(`Missing rendered output ${output}`);
  const renderReportPath = path.join(project.projectDir, 'reports', `render-${spec.id}-video.json`);
  const renderReport = JSON.parse(readFileSync(renderReportPath, 'utf8'));
  const probe = ffprobeJson(output);
  const streams = probe.streams || [];
  const videoStream = streams.find((stream) => stream.codec_type === 'video');
  const audioStreams = streams.filter((stream) => stream.codec_type === 'audio');
  if (!videoStream) throw new Error(`No video stream in ${output}`);
  if (audioStreams.length !== 1) {
    throw new Error(`Expected exactly one audio stream, found ${audioStreams.length}`);
  }
  const audioStream = audioStreams[0];
  const checks = [];
  const check = (name, pass, details) => checks.push({name, pass: Boolean(pass), details});

  check(
    'exactly one intended audio stream is present',
    audioStreams.length === 1,
    {audioStreams: audioStreams.length, codec: audioStream.codec_name},
  );
  check(
    'video stream matches the output profile and frame range',
    videoStream.codec_name === 'h264' &&
      videoStream.width === spec.width &&
      videoStream.height === spec.height &&
      Number(videoStream.nb_frames) === spec.expectedFrames &&
      Math.abs(Number(probe.format?.duration) - spec.expectedFrames / spec.outputFps) <= 1 / spec.outputFps,
    {
      codec: videoStream.codec_name,
      width: videoStream.width,
      height: videoStream.height,
      frames: Number(videoStream.nb_frames),
      durationSeconds: Number(probe.format?.duration),
    },
  );

  const outputAudio = decodeAudioToNormalizedPcm(output, spec.mixSampleRate, 'render-output');
  const outputMono = stereoToMono(outputAudio.samples);
  const expectedMixSamples =
    frameToSampleIndex(spec.frames[1] + 1, spec.mixSampleRate, spec.outputFps) -
    frameToSampleIndex(spec.frames[0], spec.mixSampleRate, spec.outputFps);
  check(
    'decoded output audio matches the frame-range sample count',
    outputAudio.frameCount === expectedMixSamples,
    {
      expectedSamples: expectedMixSamples,
      decodedSamples: outputAudio.frameCount,
      decodedDurationSeconds: outputAudio.durationSeconds,
      audioStreamDurationSeconds: Number(audioStream.duration),
    },
  );
  check(
    'output audio duration differs from the frame range by at most one sample',
    Math.abs(outputAudio.frameCount - expectedMixSamples) <= 1,
    {
      differenceSamples: outputAudio.frameCount - expectedMixSamples,
      videoDurationSeconds: Number(videoStream.duration),
      audioDurationSeconds: Number(audioStream.duration),
    },
  );
  check(
    'output audio does not clip',
    peakOfRange(outputMono, 0, outputMono.length) <= 1,
    {peak: Number(peakOfRange(outputMono, 0, outputMono.length).toFixed(6))},
  );

  const mixReportPath = path.join(project.projectDir, renderReport.audioMix.report);
  const mixReport = JSON.parse(readFileSync(mixReportPath, 'utf8'));
  check(
    'the authoritative mix report records no limiter clipping',
    mixReport.mix.clippedSamples === 0 && mixReport.mix.wouldClipSamples === 0,
    {
      peakBeforeLimiter: mixReport.mix.peakBeforeLimiter,
      peakAfterLimiter: mixReport.mix.peakAfterLimiter,
      limiterGainDb: mixReport.mix.limiterGainDb,
      wouldClipSamples: mixReport.mix.wouldClipSamples,
      clippedSamples: mixReport.mix.clippedSamples,
    },
  );
  check(
    'the muxed audio uses the generated project mix',
    renderReport.audioMix.sha256 === mixReport.mix.sha256 &&
      renderReport.audioMix.sampleRate === spec.mixSampleRate,
    {
      renderMixSha256: renderReport.audioMix.sha256,
      reportMixSha256: mixReport.mix.sha256,
      audioFile: path.relative(project.projectDir, renderReport.frames.audioFile).split(path.sep).join('/'),
    },
  );

  const files = projectFiles(project);
  const afterHashes = project.assets
    .filter((asset) => asset.approval === 'approved' && asset.absolutePath)
    .map((asset) => ({id: asset.id, path: asset.path, sha256: sha256File(asset.absolutePath)}));
  check(
    'original source hashes are unchanged',
    JSON.stringify(files.hashAll) === JSON.stringify(afterHashes),
    {before: files.hashAll, after: afterHashes},
  );

  const record = {
    projectId: spec.id,
    output: path.relative(project.projectDir, output).split(path.sep).join('/'),
    outputBytes: statSync(output).size,
    frames: {start: spec.frames[0], end: spec.frames[1], expected: spec.expectedFrames},
    audioMetadata: project.audioMetadata,
    trackMetadata: files.tracks.map((entry) => ({
      id: entry.track.id,
      role: entry.track.role,
      assetId: entry.track.assetId,
      probe: entry.asset?.audioMetadata ?? null,
      config: entry.track,
    })),
    streams: {
      video: {
        codec: videoStream.codec_name,
        width: videoStream.width,
        height: videoStream.height,
        frames: Number(videoStream.nb_frames),
        durationSeconds: Number(videoStream.duration),
        fps: videoStream.r_frame_rate,
      },
      audio: {
        count: audioStreams.length,
        codec: audioStream.codec_name,
        sampleRate: Number(audioStream.sample_rate),
        channels: audioStream.channels,
        durationSeconds: Number(audioStream.duration),
        frames: Number(audioStream.nb_frames),
      },
    },
    decodedOutput: {
      samples: outputAudio.frameCount,
      durationSeconds: outputAudio.durationSeconds,
      expectedSamples: expectedMixSamples,
      peak: Number(peakOfRange(outputMono, 0, outputMono.length).toFixed(6)),
    },
    mixReport: {
      path: renderReport.audioMix.report,
      sha256: mixReport.mix.sha256,
      totalSamples: mixReport.mix.totalSamples,
      peakBeforeLimiter: mixReport.mix.peakBeforeLimiter,
      peakAfterLimiter: mixReport.mix.peakAfterLimiter,
      limiterGainDb: mixReport.mix.limiterGainDb,
      clippedSamples: mixReport.mix.clippedSamples,
      durationSeconds: mixReport.mix.durationSeconds,
    },
    measurements: {},
    checks,
    pass: false,
  };

  if (spec.id === 'synthetic-audio-mp3-demo') {
    const reference = decodeAudioToNormalizedPcm(
      path.join(project.projectDir, 'references', 'reference-pcm.wav'),
      48000,
      'reference',
    );
    const referenceMono = stereoToMono(reference.samples);
    const outputRegions = findToneRegions(outputMono, 48000, 1000, {
      threshold: 0.05,
      windowSeconds: 0.01,
      hopSeconds: 0.005,
    });
    const referenceRegions = findToneRegions(referenceMono, 48000, 1000, {
      threshold: 0.05,
      windowSeconds: 0.01,
      hopSeconds: 0.005,
    });
    const expectedStarts = [0.5, 1.5];
    const outputStarts = outputRegions.map((region) => region.startSeconds);
    const referenceStarts = referenceRegions.map((region) => region.startSeconds);
    check(
      'MP3 master is identified as MP3 by content, not extension',
      project.audioMetadata.format === 'mp3' &&
        project.audioMetadata.decodedDurationSeconds === 2,
      project.audioMetadata,
    );
    check(
      'decoded output contains exactly two 1kHz burst regions',
      outputRegions.length === 2,
      {regions: outputRegions},
    );
    check(
      'burst timing matches the synthetic score within one output frame',
      outputStarts.length === 2 &&
        outputStarts.every((start, index) => Math.abs(start - expectedStarts[index]) <= 1 / 24),
      {expectedStarts, outputStarts},
    );
    check(
      'burst timing matches the PCM reference within 20ms',
      referenceStarts.length === 2 &&
        outputStarts.length === 2 &&
        outputStarts.every((start, index) => Math.abs(start - referenceStarts[index]) <= 0.02),
      {referenceStarts, outputStarts},
    );
    const outputBed = toneAtFrames(outputMono, 48000, 24, 440, 18, 30);
    const referenceBed = toneAtFrames(referenceMono, 48000, 24, 440, 18, 30);
    check(
      '440Hz bed level matches the PCM reference within 3dB',
      Math.abs(outputBed.dbfs - referenceBed.dbfs) <= 3,
      {outputBed, referenceBed},
    );
    const outsideBurst = toneAtFrames(outputMono, 48000, 24, 1000, 6, 10);
    const insideBurst = outputRegions[0]?.peakAmplitude ?? 0;
    check(
      'the 1kHz burst is absent outside its scheduled interval',
      outsideBurst.amplitude < insideBurst * 0.05,
      {outsideBurst, insideBurstPeak: insideBurst},
    );
    check(
      'burst level is consistent with a single mix, not duplicated audio',
      insideBurst > 0.3 && insideBurst < 0.7,
      {insideBurstPeak: insideBurst},
    );
    record.measurements = {
      outputRegions,
      referenceRegions,
      outputBed,
      referenceBed,
      outsideBurst,
    };
  }

  if (spec.id === 'synthetic-audio-multitrack-demo') {
    const ambienceBefore = toneAtFrames(outputMono, 48000, 30, 110, 0, 6);
    const ambienceActive = toneAtFrames(outputMono, 48000, 30, 110, 12, 18);
    const ambienceAfter = toneAtFrames(outputMono, 48000, 30, 110, 52, 58);
    const sfxBefore = toneAtFrames(outputMono, 48000, 30, 1200, 12, 18);
    const sfxActive = toneAtFrames(outputMono, 48000, 30, 1200, 22, 28);
    const sfxAfter = toneAtFrames(outputMono, 48000, 30, 1200, 36, 42);
    const voiceBefore = toneAtFrames(outputMono, 48000, 30, 440, 24, 30);
    const voiceActive = toneAtFrames(outputMono, 48000, 30, 440, 35, 41);
    const voiceAfter = toneAtFrames(outputMono, 48000, 30, 440, 47, 53);
    const masterBaseline = toneAtFrames(outputMono, 48000, 30, 220, 20, 26);
    const masterDucked = toneAtFrames(outputMono, 48000, 30, 220, 34, 40);
    const masterRecovered = toneAtFrames(outputMono, 48000, 30, 220, 48, 54);
    const embedded950 = toneAtFrames(outputMono, 48000, 30, 950, 20, 26);
    const sfxFadeIn = toneAtFrames(outputMono, 48000, 30, 1200, 20, 21);
    const sfxSteady = toneAtFrames(outputMono, 48000, 30, 1200, 24, 27);
    const sfxFadeOut = toneAtFrames(outputMono, 48000, 30, 1200, 31, 32);
    const voiceFadeIn = toneAtFrames(outputMono, 48000, 30, 440, 32, 33);
    const voiceSteady = toneAtFrames(outputMono, 48000, 30, 440, 36, 41);
    const voiceFadeOut = toneAtFrames(outputMono, 48000, 30, 440, 43, 44);

    check(
      'FLAC master, WAV SFX/voice and AAC/M4A ambience are identified by content',
      project.audioMetadata.format === 'flac' &&
        project.audioMetadata.decodedDurationSeconds === 2 &&
        files.tracks[0].asset?.audioMetadata.format === 'wav-pcm' &&
        files.tracks[1].asset?.audioMetadata.format === 'wav-pcm' &&
        files.tracks[2].asset?.audioMetadata.format === 'm4a-aac' &&
        files.tracks[2].asset?.audioMetadata.encoderDelaySamples !== null,
      {
        master: project.audioMetadata,
        tracks: files.tracks.map((entry) => entry.asset?.audioMetadata),
      },
    );
    const expected = {
      master: expectedAmplitude(0.2, -2),
      sfx: expectedAmplitude(0.5, -3),
      voice: expectedAmplitude(0.4, -6),
      ambience: expectedAmplitude(0.15, -18),
    };
    const within = (measured, target, ratio = 0.15) =>
      Math.abs(measured.amplitude / target - 1) <= ratio;
    check(
      'master gain is measured within 15% of -2dB',
      within(masterBaseline, expected.master),
      {measured: masterBaseline, expectedAmplitude: expected.master},
    );
    check(
      'SFX gain is measured within 15% of -3dB',
      within(sfxActive, expected.sfx),
      {measured: sfxActive, expectedAmplitude: expected.sfx},
    );
    check(
      'voiceover gain is measured within 15% of -6dB',
      within(voiceActive, expected.voice),
      {measured: voiceActive, expectedAmplitude: expected.voice},
    );
    check(
      'ambience gain is measured within 15% of -18dB',
      within(ambienceActive, expected.ambience),
      {measured: ambienceActive, expectedAmplitude: expected.ambience},
    );
    check(
      'ambience is silent outside its scheduled interval',
      amplitudeDb(ambienceActive.amplitude) - amplitudeDb(Math.max(ambienceBefore.amplitude, ambienceAfter.amplitude)) > 15,
      {before: ambienceBefore, active: ambienceActive, after: ambienceAfter},
    );
    check(
      'SFX is silent outside its scheduled interval',
      amplitudeDb(sfxActive.amplitude) - amplitudeDb(Math.max(sfxBefore.amplitude, sfxAfter.amplitude)) > 25,
      {before: sfxBefore, active: sfxActive, after: sfxAfter},
    );
    check(
      'voiceover is silent outside its scheduled interval',
      amplitudeDb(voiceActive.amplitude) - amplitudeDb(Math.max(voiceBefore.amplitude, voiceAfter.amplitude)) > 20,
      {before: voiceBefore, active: voiceActive, after: voiceAfter},
    );
    const duckDeltaDb = masterDucked.dbfs - masterBaseline.dbfs;
    check(
      'manual ducking lowers the master by the declared 8dB within 3dB',
      Math.abs(duckDeltaDb - -8) <= 3,
      {duckDeltaDb, expectedDb: -8, baseline: masterBaseline, ducked: masterDucked},
    );
    check(
      'master gain recovers after the voiceover region',
      Math.abs(masterRecovered.dbfs - masterBaseline.dbfs) <= 1.5,
      {baseline: masterBaseline, recovered: masterRecovered},
    );
    check(
      'SFX fade-in rises from the first frame',
      sfxFadeIn.amplitude > 0.1 * sfxSteady.amplitude &&
        sfxFadeIn.amplitude < 0.75 * sfxSteady.amplitude,
      {fadeIn: sfxFadeIn, steady: sfxSteady},
    );
    check(
      'SFX fade-out falls in the final frame',
      sfxFadeOut.amplitude < 0.35 * sfxSteady.amplitude,
      {fadeOut: sfxFadeOut, steady: sfxSteady},
    );
    check(
      'voiceover fade-in starts below steady level',
      voiceFadeIn.amplitude > 0.02 * voiceSteady.amplitude &&
        voiceFadeIn.amplitude < 0.75 * voiceSteady.amplitude,
      {fadeIn: voiceFadeIn, steady: voiceSteady},
    );
    check(
      'voiceover fade-out falls in the final frame',
      voiceFadeOut.amplitude < 0.5 * voiceSteady.amplitude,
      {fadeOut: voiceFadeOut, steady: voiceSteady},
    );
    const videoAsset = project.assets.find((asset) => asset.id === 'VIDEO-01');
    check(
      'embedded source-video audio remains muted in the final mix',
      videoAsset?.videoMetadata?.hasAudio === true &&
        amplitudeDb(masterBaseline.amplitude) - amplitudeDb(embedded950.amplitude) > 30,
      {
        sourceVideoHasAudio: videoAsset?.videoMetadata?.hasAudio,
        masterDb: masterBaseline.dbfs,
        embedded950Db: embedded950.dbfs,
      },
    );
    const trackReports = new Map(mixReport.tracks.map((track) => [track.id, track]));
    const sfxReport = trackReports.get('sfx-01');
    const voiceReport = trackReports.get('voice-01');
    const ambienceReport = trackReports.get('ambience-01');
    check(
      'track sample ranges follow the frame clock exactly',
      sfxReport?.output.startSample === frameToSampleIndex(20, 48000, 30) &&
        sfxReport?.output.endSample === frameToSampleIndex(32, 48000, 30) &&
        voiceReport?.output.startSample === frameToSampleIndex(32, 48000, 30) &&
        voiceReport?.output.endSample === frameToSampleIndex(44, 48000, 30) &&
        ambienceReport?.output.startSample === frameToSampleIndex(8, 48000, 30) &&
        ambienceReport?.output.endSample === frameToSampleIndex(48, 48000, 30),
      {
        sfx: sfxReport?.output,
        voice: voiceReport?.output,
        ambience: ambienceReport?.output,
      },
    );
    const frames0 = rawFrame(output, 0, spec.width, spec.height);
    const frames30 = rawFrame(output, 30, spec.width, spec.height);
    check(
      'hybrid render decodes real frames and changes source content at the cut',
      Buffer.compare(frames0, frames30) !== 0,
      {frame0Rgb: averageRgb(frames0), frame30Rgb: averageRgb(frames30)},
    );
    record.measurements = {
      ambienceBefore,
      ambienceActive,
      ambienceAfter,
      sfxBefore,
      sfxActive,
      sfxAfter,
      voiceBefore,
      voiceActive,
      voiceAfter,
      masterBaseline,
      masterDucked,
      masterRecovered,
      embedded950,
      sfxFadeIn,
      sfxSteady,
      sfxFadeOut,
      voiceFadeIn,
      voiceSteady,
      voiceFadeOut,
      expectedAmplitudes: expected,
      duckDeltaDb,
    };
  }

  if (spec.id === 'synthetic-audio-boundaries-demo') {
    const analysisPath = path.join(project.projectDir, renderReport.audioMix.analysis);
    const analysis = JSON.parse(readFileSync(analysisPath, 'utf8'));
    const onsetFrames = analysis.onsets.map((event) => event.frame);
    check(
      'cue analysis reports the three synthetic clicks at frames 6, 25 and 36',
      JSON.stringify(onsetFrames) === JSON.stringify([6, 25, 36]),
      {onsetFrames, events: analysis.onsets},
    );
    check(
      'analysis events carry source hash, version, estimated classification and no invented confidence',
      analysis.algorithmVersion === '1' &&
        analysis.sourceSha256 === project.config.audio.sha256 &&
        analysis.onsets.every(
          (event) =>
            event.source === 'estimated' &&
            event.classification === 'estimated' &&
            event.confidence === null &&
            typeof event.metric === 'number',
        ),
      {
        algorithmVersion: analysis.algorithmVersion,
        sourceSha256: analysis.sourceSha256,
        parameters: analysis.parameters,
      },
    );
    const regions = findToneRegions(outputMono, 44100, 2000, {
      threshold: 0.05,
      windowSeconds: 0.01,
      hopSeconds: 0.0025,
    });
    const expectedOffsets = [1 / 24, 12 / 24];
    check(
      'windowed tone detector brackets both expected nonzero-range pulses',
      regions.length === 2 &&
        regions.every(
          (region, index) =>
            region.startSeconds <= expectedOffsets[index] &&
            region.endSeconds >= expectedOffsets[index] + 0.012,
        ),
      {regions, expectedOffsets},
    );
    const expectedLocalSamples = [
      frameToSampleIndex(25, 44100, 24) - frameToSampleIndex(24, 44100, 24),
      frameToSampleIndex(36, 44100, 24) - frameToSampleIndex(24, 44100, 24),
    ];
    const pulses = expectedLocalSamples.map((sample) =>
      measurePulseAt(outputMono, 44100, sample, {thresholdRatio: 0.1}),
    );
    const segmentFile = renderReport.frames.audioFile;
    const segment = decodeAudioToNormalizedPcm(segmentFile, 44100, 'segment');
    const segmentMono = stereoToMono(segment.samples);
    const segmentPulses = expectedLocalSamples.map((sample) =>
      measurePulseAt(segmentMono, 44100, sample, {thresholdRatio: 0.1}),
    );
    check(
      'decoded pulse leading edges align with the frame boundary within 1ms',
      pulses.every((pulse) => Math.abs(pulse.firstDeltaMs) <= 1),
      {
        pulses,
        expectedLocalSamples,
        explanation:
          'The 2ms synthetic attack crosses 10% of peak 0.317ms after the exact frame boundary; the older 10ms window started 5-7ms before the pulse.',
      },
    );
    check(
      'decoded pulse centers follow the 12ms synthetic pulse by about 6ms',
      pulses.every((pulse) => pulse.centroidDeltaMs >= 5 && pulse.centroidDeltaMs <= 7),
      {pulses},
    );
    check(
      'muxed output and PCM segment pulse timing agree within two samples',
      pulses.every(
        (pulse, index) =>
          Math.abs(pulse.firstSample - segmentPulses[index].firstSample) <= 2 &&
          Math.abs(pulse.centroidSample - segmentPulses[index].centroidSample) <= 2,
      ),
      {pulses, segmentPulses, segmentFile: path.relative(project.projectDir, segmentFile).split(path.sep).join('/')},
    );
    const firstFrameRms = rmsOfRange(outputMono, 0, frameToSampleIndex(1, 44100, 24));
    const secondFrameRms = rmsOfRange(
      outputMono,
      frameToSampleIndex(1, 44100, 24),
      frameToSampleIndex(2, 44100, 24),
    );
    const beforeSecondClick = rmsOfRange(
      outputMono,
      frameToSampleIndex(11, 44100, 24),
      frameToSampleIndex(12, 44100, 24),
    );
    const secondClickFrame = rmsOfRange(
      outputMono,
      frameToSampleIndex(12, 44100, 24),
      frameToSampleIndex(13, 44100, 24),
    );
    check(
      'click at global frame 25 lands in render frame 1, not frame 0',
      firstFrameRms < 0.01 && secondFrameRms > 0.05,
      {firstFrameRms, secondFrameRms},
    );
    check(
      'click at global frame 36 lands in render frame 12, not frame 11',
      beforeSecondClick < 0.01 && secondClickFrame > 0.05,
      {beforeSecondClick, secondClickFrame},
    );
    const expectedSegmentSamples =
      frameToSampleIndex(41, 44100, 24) - frameToSampleIndex(24, 44100, 24);
    check(
      'non-integer frame/sample mapping rounds to the documented sample boundary',
      frameToSampleIndex(25, 44100, 24) === 45938 &&
        expectedSegmentSamples === 31238 &&
        outputAudio.frameCount === expectedSegmentSamples,
      {
        frame25SampleIndex: frameToSampleIndex(25, 44100, 24),
        expectedSegmentSamples,
        decodedSamples: outputAudio.frameCount,
      },
    );
    check(
      'muxed segment sample count equals the frame-range sample boundary',
      segment.frameCount === expectedSegmentSamples,
      {segmentFile: path.relative(project.projectDir, segmentFile).split(path.sep).join('/'), segmentSamples: segment.frameCount, expectedSegmentSamples},
    );
    const frame0 = rawFrame(output, 0, spec.width, spec.height);
    const frame1 = rawFrame(output, 1, spec.width, spec.height);
    check(
      'the odd-frame shot cut at frame 25 is decoded in render frame 1',
      Buffer.compare(frame0, frame1) !== 0,
      {frame0Rgb: averageRgb(frame0), frame1Rgb: averageRgb(frame1)},
    );
    record.measurements = {
      analysis: {
        path: renderReport.audioMix.analysis,
        version: analysis.algorithmVersion,
        parameters: analysis.parameters,
        onsets: analysis.onsets,
      },
      windowedClickRegions: regions,
      expectedOffsets,
      expectedLocalSamples,
      pulses,
      segmentPulses,
      precision: {
        explanation:
          'findToneRegions reports the first 10ms analysis window above threshold, which begins before the pulse. Sample-level measurement shows the actual 10%-peak leading edge and the amplitude centroid of the 12ms pulse.',
        outputVsSegmentLeadingEdgeSamples: pulses.map(
          (pulse, index) => pulse.firstSample - segmentPulses[index].firstSample,
        ),
        outputVsSegmentCentroidSamples: pulses.map(
          (pulse, index) => pulse.centroidSample - segmentPulses[index].centroidSample,
        ),
      },
      frameRms: {firstFrameRms, secondFrameRms, beforeSecondClick, secondClickFrame},
      sampleBoundary: {
        frame25SampleIndex: frameToSampleIndex(25, 44100, 24),
        expectedSegmentSamples,
        segmentSamples: segment.frameCount,
        decodedOutputSamples: outputAudio.frameCount,
      },
      frame0Rgb: averageRgb(frame0),
      frame1Rgb: averageRgb(frame1),
    };
  }

  record.pass = record.checks.every((entry) => entry.pass);
  const reportsDir = ensureSafeDirectory(
    boundary,
    path.join(boundary.projectRoot, 'reports'),
    'project',
  );
  const reportPath = assertSafePath(
    boundary,
    path.join(reportsDir, 'audio-render-evidence.json'),
    {expect: 'file', subtree: 'project'},
  );
  writeFileSync(reportPath, JSON.stringify(record, null, 2));
  return {record, reportPath};
};

const results = [];
for (const spec of PROJECTS) {
  const result = verifyProject(spec);
  results.push(result);
  console.log(
    JSON.stringify({
      projectId: result.record.projectId,
      pass: result.record.pass,
      checks: result.record.checks.map((entry) => ({name: entry.name, pass: entry.pass})),
      report: path.relative(path.dirname(result.reportPath), result.reportPath),
    }),
  );
}

const pass = results.every((result) => result.record.pass);
console.log(JSON.stringify({pass, projects: results.map((result) => result.record.projectId)}, null, 2));
if (!pass) process.exitCode = 1;