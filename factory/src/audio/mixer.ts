import {createHash} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import path from 'node:path';
import type {
  AudioAutomationPoint,
  AudioTrackConfig,
  AudioTrackRole,
  LoadedProject,
} from '../config/types';
import {MediaError} from '../errors';
import {decodeAudioToNormalizedPcm} from '../media/audioDecode';
import {encodePcm16Wav, parsePcm16WavBuffer} from '../media/wav';
import {
  frameToSampleIndex,
  sampleCountForFrameRange,
  totalMixSamples,
  fadeSampleCount,
} from '../timeline/audioClock';
import {analyzePcm, stereoToMono, type AudioAnalysisReport} from './analysis';
import {
  assertSafePath,
  ensureSafeDirectory,
  type WriteBoundary,
} from '../workspace/writeBoundary';

export type PcmMixTrack = {
  id: string;
  role: AudioTrackRole;
  samples: Float32Array;
  sourceStartSeconds: number;
  startFrame: number;
  durationFrames: number;
  gainDb: number;
  fadeInFrames: number;
  fadeOutFrames: number;
  gainAutomation: readonly AudioAutomationPoint[];
};

export type PcmTrackReport = {
  id: string;
  role: AudioTrackRole;
  outputStartSample: number;
  outputEndSample: number;
  outputSamples: number;
  sourceStartSample: number;
  sourceSamplesAvailable: number;
  peakContribution: number;
  muted: boolean;
};

export type PcmMixResult = {
  samples: Float32Array;
  sampleRate: number;
  channels: 2;
  totalSamples: number;
  durationSeconds: number;
  peakBeforeLimiter: number;
  peakAfterLimiter: number;
  limiterGainDb: number;
  wouldClipSamples: number;
  clippedSamples: number;
  master: {
    outputSamples: number;
    sourceSamplesAvailable: number;
    usedSourceSamples: number;
    peakContribution: number;
  };
  tracks: PcmTrackReport[];
};

const dbToLinear = (db: number): number => 10 ** (db / 20);

const automationDbAt = (
  points: readonly AudioAutomationPoint[],
  sample: number,
  sampleRate: number,
  outputFps: number,
  outputSamples: number,
): number => {
  if (points.length === 0) return 0;
  const localFrame = (sample * outputFps) / sampleRate;
  if (localFrame <= points[0].frame) return points[0].gainDb;
  for (let index = 1; index < points.length; index++) {
    const previous = points[index - 1];
    const next = points[index];
    if (localFrame <= next.frame) {
      const span = next.frame - previous.frame;
      if (span <= 0) return next.gainDb;
      const ratio = (localFrame - previous.frame) / span;
      return previous.gainDb + (next.gainDb - previous.gainDb) * ratio;
    }
  }
  if (outputSamples > 0) return points[points.length - 1].gainDb;
  return points[points.length - 1].gainDb;
};

const fadeEnvelope = (
  sample: number,
  outputSamples: number,
  fadeInSamples: number,
  fadeOutSamples: number,
): number => {
  let envelope = 1;
  if (fadeInSamples > 0 && sample < fadeInSamples) envelope = Math.min(envelope, sample / fadeInSamples);
  if (fadeOutSamples > 0 && sample >= outputSamples - fadeOutSamples) {
    envelope = Math.min(
      envelope,
      Math.max(0, (outputSamples - 1 - sample) / fadeOutSamples),
    );
  }
  return Math.max(0, Math.min(1, envelope));
};

/**
 * Deterministic sample-domain mix. The master spans the whole project; each
 * additional track owns a half-open output-frame range. Sources are stereo PCM
 * already normalized to the mix sample rate.
 */
export const mixPcmTracks = (input: {
  masterSamples: Float32Array;
  masterGainDb: number;
  masterFadeInFrames: number;
  masterFadeOutFrames: number;
  masterGainAutomation: readonly AudioAutomationPoint[];
  tracks: readonly PcmMixTrack[];
  durationFrames: number;
  outputFps: number;
  sampleRate: number;
}): PcmMixResult => {
  const totalSamples = totalMixSamples(input.durationFrames, input.sampleRate, input.outputFps);
  const mix = new Float64Array(totalSamples * 2);
  const masterSourceFrames = Math.floor(input.masterSamples.length / 2);
  const masterFadeIn = fadeSampleCount(input.masterFadeInFrames, input.sampleRate, input.outputFps);
  const masterFadeOut = fadeSampleCount(input.masterFadeOutFrames, input.sampleRate, input.outputFps);
  const masterUsed = Math.min(totalSamples, masterSourceFrames);
  let masterPeak = 0;

  for (let sample = 0; sample < masterUsed; sample++) {
    const envelope = fadeEnvelope(sample, totalSamples, masterFadeIn, masterFadeOut);
    const automation = automationDbAt(
      input.masterGainAutomation,
      sample,
      input.sampleRate,
      input.outputFps,
      totalSamples,
    );
    const gain = dbToLinear(input.masterGainDb + automation) * envelope;
    for (let channel = 0; channel < 2; channel++) {
      const value = input.masterSamples[sample * 2 + channel] * gain;
      mix[sample * 2 + channel] += value;
      masterPeak = Math.max(masterPeak, Math.abs(value));
    }
  }

  const trackReports: PcmTrackReport[] = [];
  for (const track of input.tracks) {
    const outputStart = frameToSampleIndex(track.startFrame, input.sampleRate, input.outputFps);
    const outputEnd = frameToSampleIndex(
      track.startFrame + track.durationFrames,
      input.sampleRate,
      input.outputFps,
    );
    const outputSamples = outputEnd - outputStart;
    if (outputStart < 0 || outputEnd > totalSamples || outputSamples <= 0) {
      throw new MediaError(`Track ${track.id} has an invalid output range`);
    }
    const sourceStart = Math.round(track.sourceStartSeconds * input.sampleRate);
    const sourceFrames = Math.floor(track.samples.length / 2);
    if (sourceStart + outputSamples > sourceFrames) {
      throw new MediaError(
        `Track ${track.id} source is too short: needs ${outputSamples} samples from ${sourceStart}, available ${sourceFrames}`,
      );
    }
    const fadeIn = fadeSampleCount(track.fadeInFrames, input.sampleRate, input.outputFps);
    const fadeOut = fadeSampleCount(track.fadeOutFrames, input.sampleRate, input.outputFps);
    let peak = 0;
    for (let sample = 0; sample < outputSamples; sample++) {
      const automation = automationDbAt(
        track.gainAutomation,
        sample,
        input.sampleRate,
        input.outputFps,
        outputSamples,
      );
      const gain = dbToLinear(track.gainDb + automation) *
        fadeEnvelope(sample, outputSamples, fadeIn, fadeOut);
      for (let channel = 0; channel < 2; channel++) {
        const value = track.samples[(sourceStart + sample) * 2 + channel] * gain;
        mix[(outputStart + sample) * 2 + channel] += value;
        peak = Math.max(peak, Math.abs(value));
      }
    }
    trackReports.push({
      id: track.id,
      role: track.role,
      outputStartSample: outputStart,
      outputEndSample: outputEnd,
      outputSamples,
      sourceStartSample: sourceStart,
      sourceSamplesAvailable: sourceFrames,
      peakContribution: peak,
      muted: false,
    });
  }

  let peakBeforeLimiter = 0;
  let wouldClipSamples = 0;
  for (let index = 0; index < mix.length; index++) {
    const value = Math.abs(mix[index]);
    if (value > peakBeforeLimiter) peakBeforeLimiter = value;
    if (value > 1) wouldClipSamples++;
  }
  const limiterScale = peakBeforeLimiter > 0.999 ? 0.999 / peakBeforeLimiter : 1;
  const limiterGainDb = limiterScale < 1 ? 20 * Math.log10(limiterScale) : 0;
  const out = new Float32Array(mix.length);
  let clippedSamples = 0;
  for (let index = 0; index < mix.length; index++) {
    const value = mix[index] * limiterScale;
    if (Math.abs(value) > 1) clippedSamples++;
    out[index] = value;
  }

  return {
    samples: out,
    sampleRate: input.sampleRate,
    channels: 2,
    totalSamples,
    durationSeconds: totalSamples / input.sampleRate,
    peakBeforeLimiter,
    peakAfterLimiter: peakBeforeLimiter * limiterScale,
    limiterGainDb,
    wouldClipSamples,
    clippedSamples,
    master: {
      outputSamples: totalSamples,
      sourceSamplesAvailable: masterSourceFrames,
      usedSourceSamples: masterUsed,
      peakContribution: masterPeak,
    },
    tracks: trackReports,
  };
};

export type AudioMixOutput = {
  mixPath: string;
  mixWavBytes: Buffer;
  mixSha256: string;
  mixSampleRate: number;
  mixSampleCount: number;
  mixDurationSeconds: number;
  reportPath: string;
  analysisPath: string;
  report: Record<string, unknown>;
  analysis: AudioAnalysisReport;
  normalizedFiles: string[];
};

const writeCacheFile = (
  boundary: WriteBoundary,
  directory: string,
  fileName: string,
  bytes: Buffer | Uint8Array,
): string => {
  const target = assertSafePath(boundary, path.join(directory, fileName), {
    expect: 'file',
    subtree: 'cache',
  });
  writeFileSync(target, bytes);
  return target;
};

export const buildProjectAudioMix = (
  project: LoadedProject,
  options: {boundary: WriteBoundary},
): AudioMixOutput => {
  const {config, projectDir} = project;
  const sampleRate = config.audio.mixSampleRate;
  const normalizedDir = ensureSafeDirectory(
    options.boundary,
    path.join(options.boundary.cacheRoot, 'audio-normalized'),
    'cache',
  );
  const mixDir = ensureSafeDirectory(
    options.boundary,
    path.join(options.boundary.cacheRoot, 'audio-mix'),
    'cache',
  );
  const reportsDir = ensureSafeDirectory(
    options.boundary,
    path.join(projectDir, 'reports'),
    'project',
  );

  const master = decodeAudioToNormalizedPcm(project.audioPath, sampleRate, 'master');
  const normalizedFiles: string[] = [];
  normalizedFiles.push(
    writeCacheFile(options.boundary, normalizedDir, `master-${master.normalizedSha256}.wav`, master.wavBytes),
  );

  const activeTracks: PcmMixTrack[] = [];
  const trackReports: Array<Record<string, unknown>> = [];
  for (const track of config.audioTracks) {
    const asset = project.assets.find((candidate) => candidate.id === track.assetId);
    if (!asset || !asset.absolutePath) {
      throw new MediaError(`Audio track ${track.id} asset ${track.assetId} is not available`);
    }
    if (track.muted) {
      trackReports.push({
        id: track.id,
        role: track.role,
        assetId: track.assetId,
        assetSha256: asset.sha256,
        sourcePath: asset.path,
        startFrame: track.startFrame,
        durationFrames: track.durationFrames,
        sourceStartSeconds: track.sourceStartSeconds,
        gainDb: track.gainDb,
        fadeInFrames: track.fadeInFrames,
        fadeOutFrames: track.fadeOutFrames,
        muted: true,
        automation: track.gainAutomation,
        probe: asset.audioMetadata ?? null,
        normalized: null,
        output: null,
      });
      continue;
    }
    const normalized = decodeAudioToNormalizedPcm(asset.absolutePath, sampleRate, track.id);
    const normalizedPath = writeCacheFile(
      options.boundary,
      normalizedDir,
      `${track.id}-${normalized.normalizedSha256}.wav`,
      normalized.wavBytes,
    );
    normalizedFiles.push(normalizedPath);
    const outputSamples = sampleCountForFrameRange(
      track.startFrame,
      track.startFrame + track.durationFrames,
      sampleRate,
      config.output.fps,
    );
    const sourceStart = Math.round(track.sourceStartSeconds * sampleRate);
    if (sourceStart + outputSamples > normalized.frameCount) {
      throw new MediaError(
        `Audio track ${track.id} source is too short for its declared range`,
      );
    }
    activeTracks.push({
      id: track.id,
      role: track.role,
      samples: normalized.samples,
      sourceStartSeconds: track.sourceStartSeconds,
      startFrame: track.startFrame,
      durationFrames: track.durationFrames,
      gainDb: track.gainDb,
      fadeInFrames: track.fadeInFrames,
      fadeOutFrames: track.fadeOutFrames,
      gainAutomation: track.gainAutomation,
    });
    trackReports.push({
      id: track.id,
      role: track.role,
      assetId: track.assetId,
      assetSha256: asset.sha256,
      sourcePath: asset.path,
      startFrame: track.startFrame,
      durationFrames: track.durationFrames,
      sourceStartSeconds: track.sourceStartSeconds,
      gainDb: track.gainDb,
      fadeInFrames: track.fadeInFrames,
      fadeOutFrames: track.fadeOutFrames,
      muted: false,
      automation: track.gainAutomation,
      probe: asset.audioMetadata ?? null,
      normalized: {
        sampleRate: normalized.sampleRate,
        channels: normalized.channels,
        frameCount: normalized.frameCount,
        durationSeconds: normalized.durationSeconds,
        sha256: normalized.normalizedSha256,
      },
      output: {
        startSample: frameToSampleIndex(track.startFrame, sampleRate, config.output.fps),
        endSample: frameToSampleIndex(
          track.startFrame + track.durationFrames,
          sampleRate,
          config.output.fps,
        ),
      },
    });
  }

  const mixResult = mixPcmTracks({
    masterSamples: master.samples,
    masterGainDb: config.audio.gainDb,
    masterFadeInFrames: config.audio.fadeInFrames,
    masterFadeOutFrames: config.audio.fadeOutFrames,
    masterGainAutomation: config.audio.gainAutomation,
    tracks: activeTracks,
    durationFrames: project.durationInFrames,
    outputFps: config.output.fps,
    sampleRate,
  });
  for (const report of trackReports) {
    if (report.muted === true) continue;
    const measured = mixResult.tracks.find((track) => track.id === report.id);
    if (measured) {
      report.output = {
        startSample: measured.outputStartSample,
        endSample: measured.outputEndSample,
        samples: measured.outputSamples,
        sourceStartSample: measured.sourceStartSample,
        sourceSamplesAvailable: measured.sourceSamplesAvailable,
        peakContribution: measured.peakContribution,
      };
    }
  }
  const mixWavBytes = encodePcm16Wav(mixResult.samples, sampleRate, 2);
  const mixPath = writeCacheFile(
    options.boundary,
    mixDir,
    `${config.projectId}-mix.wav`,
    mixWavBytes,
  );
  const mixSha256 = createHash('sha256').update(mixWavBytes).digest('hex');

  const analysis = analyzePcm(stereoToMono(master.samples), sampleRate, {
    outputFps: config.output.fps,
    sourceSha256: config.audio.sha256,
    durationInFrames: project.durationInFrames,
  });
  const analysisPath = assertSafePath(
    options.boundary,
    path.join(reportsDir, `audio-analysis-${config.projectId}.json`),
    {expect: 'file', subtree: 'project'},
  );
  writeFileSync(analysisPath, JSON.stringify(analysis, null, 2));

  const report: Record<string, unknown> = {
    projectId: config.projectId,
    mixSampleRate: sampleRate,
    channels: 2,
    normalization: {
      format: 'pcm_s16le',
      sampleRate,
      channels: 2,
      requiredLocalTool: 'ffmpeg',
    },
    durationFrames: project.durationInFrames,
    totalSamples: mixResult.totalSamples,
    durationSeconds: mixResult.durationSeconds,
    master: {
      assetId: config.audio.assetId ?? null,
      sourcePath: config.audio.path,
      sourceSha256: config.audio.sha256,
      format: config.audio.format,
      probe: project.audioMetadata ?? null,
      gainDb: config.audio.gainDb,
      fadeInFrames: config.audio.fadeInFrames,
      fadeOutFrames: config.audio.fadeOutFrames,
      automation: config.audio.gainAutomation,
      normalized: {
        sampleRate: master.sampleRate,
        channels: master.channels,
        frameCount: master.frameCount,
        durationSeconds: master.durationSeconds,
        sha256: master.normalizedSha256,
      },
      output: mixResult.master,
    },
    tracks: trackReports,
    mix: {
      path: path.relative(projectDir, mixPath).split(path.sep).join('/'),
      sha256: mixSha256,
      totalSamples: mixResult.totalSamples,
      durationSeconds: mixResult.durationSeconds,
      peakBeforeLimiter: mixResult.peakBeforeLimiter,
      peakAfterLimiter: mixResult.peakAfterLimiter,
      limiterGainDb: mixResult.limiterGainDb,
      wouldClipSamples: mixResult.wouldClipSamples,
      clippedSamples: mixResult.clippedSamples,
      headroomPolicy:
        'If summed peak exceeds 0.999, apply a deterministic peak gain to 0.999; no automatic loudness normalization.',
    },
    analysis: {
      version: analysis.algorithmVersion,
      sourceSha256: analysis.sourceSha256,
      path: path.relative(projectDir, analysisPath).split(path.sep).join('/'),
    },
  };
  const reportPath = assertSafePath(
    options.boundary,
    path.join(reportsDir, `audio-mix-${config.projectId}.json`),
    {expect: 'file', subtree: 'project'},
  );
  writeFileSync(reportPath, JSON.stringify(report, null, 2));

  return {
    mixPath,
    mixWavBytes,
    mixSha256,
    mixSampleRate: sampleRate,
    mixSampleCount: mixResult.totalSamples,
    mixDurationSeconds: mixResult.durationSeconds,
    reportPath,
    analysisPath,
    report,
    analysis,
    normalizedFiles,
  };
};

export const sliceNormalizedMix = (
  mixWavBytes: Buffer,
  startFrame: number,
  endFrame: number,
  sampleRate: number,
  outputFps: number,
): Buffer => {
  const parsed = parsePcm16WavBuffer(mixWavBytes, 'project mix');
  const startSample = frameToSampleIndex(startFrame, sampleRate, outputFps);
  const endSample = frameToSampleIndex(endFrame, sampleRate, outputFps);
  const start = startSample * parsed.channels;
  const end = endSample * parsed.channels;
  if (end > parsed.samples.length) {
    throw new MediaError(
      `Audio subrange [${startFrame}, ${endFrame}) exceeds the final mix sample count`,
    );
  }
  return encodePcm16Wav(parsed.samples.subarray(start, end), sampleRate, parsed.channels);
};