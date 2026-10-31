import {PreproductionError} from '../errors';
import type {
  ApprovedBeatGrid,
  BeatEvent,
  BeatGridInterpretation,
  BeatGridReport,
  BeatQuality,
  TempoCandidate,
  TempoRelation,
} from './types';
import {BEAT_GRID_ALGORITHM_VERSION} from './types';

export type BeatGridOptions = {
  projectId: string;
  sourceSha256: string;
  sampleRate: number;
  outputFps: number;
  durationFrames: number;
  frameSize?: number;
  hopSize?: number;
  minBpm?: number;
  maxBpm?: number;
  bpmStep?: number;
  onsetThreshold?: number;
};

type OnsetEnvelope = {
  values: Float64Array;
  frameSize: number;
  hopSize: number;
  hopSeconds: number;
  mean: number;
  max: number;
  activeFrames: number;
  peaks: number[];
  strongPeaks: number[];
};

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.max(minimum, Math.min(maximum, value));

const normalizedCorrelation = (
  values: Float64Array,
  lag: number,
  start = 0,
  end = values.length,
): number => {
  if (lag <= 0) return 0;
  const from = Math.max(start, 0);
  const to = Math.min(end, values.length - lag);
  let numerator = 0;
  let leftEnergy = 0;
  let rightEnergy = 0;
  for (let index = from; index < to; index++) {
    const left = values[index];
    const right = values[index + lag];
    numerator += left * right;
    leftEnergy += left * left;
    rightEnergy += right * right;
  }
  const denominator = Math.sqrt(leftEnergy * rightEnergy);
  return denominator > 0 ? numerator / denominator : 0;
};

const onsetEnvelope = (
  mono: Float32Array,
  sampleRate: number,
  frameSize: number,
  hopSize: number,
): OnsetEnvelope => {
  const frameCount = Math.max(1, Math.ceil(mono.length / hopSize));
  const rms = new Float64Array(frameCount);
  for (let frame = 0; frame < frameCount; frame++) {
    const start = frame * hopSize;
    const end = Math.min(mono.length, start + frameSize);
    let sum = 0;
    for (let index = start; index < end; index++) sum += mono[index] * mono[index];
    rms[frame] = end > start ? Math.sqrt(sum / (end - start)) : 0;
  }
  const flux = new Float64Array(frameCount);
  let maximumRms = 0;
  for (let index = 0; index < rms.length; index++) maximumRms = Math.max(maximumRms, rms[index]);
  for (let index = 1; index < rms.length; index++) {
    const delta = Math.max(0, rms[index] - rms[index - 1]);
    flux[index] = maximumRms > 0 ? delta / maximumRms : 0;
  }
  let max = 0;
  let sum = 0;
  let activeFrames = 0;
  const peaks: number[] = [];
  const strongPeaks: number[] = [];
  const threshold = 0.05;
  for (let index = 1; index < flux.length - 1; index++) {
    max = Math.max(max, flux[index]);
    sum += flux[index];
    if (flux[index] >= threshold) {
      activeFrames++;
      if (flux[index] >= flux[index - 1] && flux[index] >= flux[index + 1]) {
        peaks.push(index);
        if (flux[index] >= 0.25) strongPeaks.push(index);
      }
    }
  }
  return {
    values: flux,
    frameSize,
    hopSize,
    hopSeconds: hopSize / sampleRate,
    mean: flux.length > 0 ? sum / flux.length : 0,
    max,
    activeFrames,
    peaks,
    strongPeaks,
  };
};

const relationFor = (bpm: number, reference: number): TempoRelation => {
  if (Math.abs(bpm - reference / 2) <= 1.1) return 'half';
  if (Math.abs(bpm - reference * 2) <= 1.1) return 'double';
  return bpm === reference ? 'none' : 'other';
};

const qualityFor = (confidence: number, sufficient: boolean): BeatQuality => {
  if (!sufficient) return 'insufficient';
  if (confidence >= 0.72) return 'high';
  if (confidence >= 0.45) return 'medium';
  return 'low';
};

/**
 * Deterministic constant-tempo beat-grid analysis. It measures an energy-flux
 * onset envelope, ranks autocorrelation periods, selects a phase and emits
 * candidate beats. It does not claim musical meter, sections, downbeats or
 * changing-tempo tracking.
 */
export const analyzeBeatGrid = (
  mono: Float32Array,
  options: BeatGridOptions,
): BeatGridReport => {
  const frameSize = options.frameSize ?? 1024;
  const hopSize = options.hopSize ?? 256;
  const minBpm = options.minBpm ?? 40;
  const maxBpm = options.maxBpm ?? 240;
  const bpmStep = options.bpmStep ?? 0.5;
  const threshold = options.onsetThreshold ?? 0.05;
  if (!Number.isInteger(options.sampleRate) || options.sampleRate <= 0) {
    throw new Error('sampleRate must be a positive integer');
  }
  if (!Number.isInteger(options.outputFps) || options.outputFps <= 0) {
    throw new Error('outputFps must be a positive integer');
  }
  if (!Number.isInteger(options.durationFrames) || options.durationFrames <= 0) {
    throw new Error('durationFrames must be a positive integer');
  }
  if (!(frameSize > 0) || !(hopSize > 0) || hopSize > frameSize) {
    throw new Error('frameSize and hopSize must be positive with hopSize <= frameSize');
  }
  if (!(minBpm > 0) || !(maxBpm > minBpm) || maxBpm > 400) {
    throw new Error('Invalid tempo range');
  }
  if (!(bpmStep > 0) || bpmStep > 10) throw new Error('Invalid BPM step');
  if (options.durationFrames * (options.sampleRate / options.outputFps) > mono.length + frameSize) {
    throw new Error('Audio is shorter than the declared project duration');
  }

  const envelope = onsetEnvelope(mono, options.sampleRate, frameSize, hopSize);
  const values = envelope.values;
  const minLag = Math.max(2, Math.floor((60 / maxBpm) / envelope.hopSeconds));
  const maxLag = Math.min(values.length - 2, Math.ceil((60 / minBpm) / envelope.hopSeconds));
  const rawCandidates: Array<{
    lag: number;
    periodicity: number;
    harmonicScore: number;
    score: number;
    bpm: number;
  }> = [];

  for (let lag = minLag; lag <= maxLag; lag++) {
    const periodicity = normalizedCorrelation(values, lag);
    const second = lag * 2 < values.length ? normalizedCorrelation(values, lag * 2) : 0;
    const harmonicScore = second;
    const score = 0.78 * periodicity + 0.22 * second;
    const bpm = (60 * options.sampleRate) / (lag * hopSize);
    rawCandidates.push({lag, periodicity, harmonicScore, score, bpm});
  }

  rawCandidates.sort((left, right) => right.score - left.score || left.bpm - right.bpm);
  const deduped: typeof rawCandidates = [];
  for (const candidate of rawCandidates) {
    if (deduped.some((entry) => Math.abs(entry.bpm - candidate.bpm) <= Math.max(0.8, bpmStep))) {
      continue;
    }
    deduped.push(candidate);
    if (deduped.length >= 5) break;
  }

  const bestRaw = deduped[0];
  const enoughOnsets =
    envelope.peaks.length >= 4 && envelope.strongPeaks.length >= 4 && envelope.max > 0;
  if (!bestRaw || !enoughOnsets || bestRaw.score < 0.08) {
    return {
      schemaVersion: 1,
      projectId: options.projectId,
      algorithmVersion: BEAT_GRID_ALGORITHM_VERSION,
      sourceSha256: options.sourceSha256,
      sampleRate: options.sampleRate,
      outputFps: options.outputFps,
      durationFrames: options.durationFrames,
      parameters: {frameSize, hopSize, minBpm, maxBpm, bpmStep, onsetThreshold: threshold},
      onsetStrength: {
        frameCount: values.length,
        mean: envelope.mean,
        max: envelope.max,
        activeFrames: envelope.activeFrames,
      },
      tempoCandidates: deduped.map((candidate) => ({
        bpm: Number(candidate.bpm.toFixed(3)),
        lagHops: candidate.lag,
        periodicity: candidate.periodicity,
        harmonicScore: candidate.harmonicScore,
        score: candidate.score,
        relation: 'other',
      })),
      estimatedTempo: null,
      phase: null,
      beatEvents: [],
      evidence: {
        onsetCount: envelope.peaks.length,
        beatCount: 0,
        meanIntervalFrames: 0,
        intervalJitterFrames: 0,
        tempoChangeSuspected: false,
      },
      limitations: ['constant-tempo-only', 'insufficient-rhythmic-evidence'],
      status: 'estimated',
      approval: 'unapproved',
    };
  }

  const referenceBpm = bestRaw.bpm;
  const halfCandidate = deduped.find(
    (candidate) => Math.abs(candidate.bpm - referenceBpm / 2) <= 1.1,
  );
  const doubleCandidate = deduped.find(
    (candidate) => Math.abs(candidate.bpm - referenceBpm * 2) <= 1.1,
  );
  const halfTempo = Boolean(halfCandidate && halfCandidate.score >= bestRaw.score * 0.62);
  const doubleTempo = Boolean(doubleCandidate && doubleCandidate.score >= bestRaw.score * 0.62);

  const periodHops = bestRaw.lag;
  const phaseScores: number[] = [];
  const phaseRange = Math.max(1, Math.round(periodHops));
  for (let offset = 0; offset < phaseRange; offset++) {
    let score = 0;
    let hits = 0;
    for (let position = offset; position < values.length; position += periodHops) {
      const rounded = Math.round(position);
      let local = 0;
      for (const delta of [-1, 0, 1]) {
        const index = rounded + delta;
        if (index >= 0 && index < values.length) {
          local = Math.max(local, delta === 0 ? values[index] : values[index] * 0.5);
        }
      }
      score += local;
      hits++;
    }
    phaseScores.push(hits > 0 ? score / hits : 0);
  }
  let bestPhaseOffset = 0;
  for (let index = 1; index < phaseScores.length; index++) {
    if (phaseScores[index] > phaseScores[bestPhaseOffset]) bestPhaseOffset = index;
  }
  const bestPhaseScore = phaseScores[bestPhaseOffset] ?? 0;
  const meanPhaseScore =
    phaseScores.length > 0
      ? phaseScores.reduce((sum, value) => sum + value, 0) / phaseScores.length
      : 0;
  const phaseContrast =
    bestPhaseScore > 0 ? clamp((bestPhaseScore - meanPhaseScore) / bestPhaseScore, 0, 1) : 0;

  const beats: BeatEvent[] = [];
  const beatLimits = options.durationFrames / options.outputFps;
  for (let position = bestPhaseOffset; position < values.length; position += periodHops) {
    let peakIndex = Math.round(position);
    let strength = 0;
    for (let delta = -1; delta <= 1; delta++) {
      const index = peakIndex + delta;
      if (index >= 0 && index < values.length && values[index] > strength) {
        strength = values[index];
        peakIndex = index;
      }
    }
    if (strength < threshold * 0.5) continue;
    const timeSeconds = peakIndex * envelope.hopSeconds;
    if (timeSeconds >= beatLimits) break;
    const frame = Math.round(timeSeconds * options.outputFps);
    if (frame < 0 || frame >= options.durationFrames) continue;
    if (beats.some((beat) => beat.frame === frame)) continue;
    beats.push({
      id: `BEAT-${String(beats.length + 1).padStart(3, '0')}`,
      timeSeconds,
      frame,
      strength,
      source: 'estimated',
      classification: 'estimated',
      confidence: null,
    });
  }

  const intervals = beats.slice(1).map((beat, index) => beat.frame - beats[index].frame);
  const meanIntervalFrames =
    intervals.length > 0 ? intervals.reduce((sum, value) => sum + value, 0) / intervals.length : 0;
  const intervalJitterFrames =
    intervals.length > 0 && meanIntervalFrames > 0
      ? Math.sqrt(
          intervals.reduce((sum, value) => sum + (value - meanIntervalFrames) ** 2, 0) /
            intervals.length,
        )
      : 0;

  const halfLength = Math.floor(values.length / 2);
  const firstHalfScore = bestRaw.lag < halfLength
    ? normalizedCorrelation(values, bestRaw.lag, 0, halfLength)
    : 0;
  const secondHalfScore =
    bestRaw.lag < values.length - halfLength
      ? normalizedCorrelation(values, bestRaw.lag, halfLength, values.length)
      : 0;
  const medianInterval = (startFrame: number, endFrame: number): number | null => {
    const times = envelope.peaks
      .filter((peak) => peak >= startFrame && peak < endFrame)
      .map((peak) => peak * envelope.hopSeconds);
    if (times.length < 4) return null;
    const intervals = times
      .slice(1)
      .map((time, index) => time - times[index])
      .filter((interval) => interval > 0)
      .sort((left, right) => left - right);
    if (intervals.length < 3) return null;
    return intervals[Math.floor(intervals.length / 2)];
  };
  const firstInterval = medianInterval(0, halfLength);
  const secondInterval = medianInterval(halfLength, values.length);
  const intervalTempoShift =
    firstInterval !== null &&
    secondInterval !== null &&
    Math.min(firstInterval, secondInterval) > 0 &&
    Math.abs(firstInterval - secondInterval) /
      Math.min(firstInterval, secondInterval) >
      0.15;
  const tempoChangeSuspected =
    intervalTempoShift ||
    (firstHalfScore > 0.3 &&
      secondHalfScore > 0.3 &&
      Math.abs(firstHalfScore - secondHalfScore) > 0.28);

  const offbeatOnsets = envelope.peaks.filter((onset) => {
    if (beats.length === 0) return false;
    const time = onset * envelope.hopSeconds;
    const nearestBeat = beats.reduce(
      (best, beat) => Math.min(best, Math.abs(beat.timeSeconds - time)),
      Infinity,
    );
    const periodSeconds = periodHops * envelope.hopSeconds;
    return nearestBeat > periodSeconds * 0.18 && nearestBeat < periodSeconds * 0.62;
  }).length;

  let confidence =
    0.6 * bestRaw.periodicity +
    0.25 * phaseContrast +
    0.15 * clamp(envelope.peaks.length / 16, 0, 1);
  if (halfTempo || doubleTempo) confidence *= 0.88;
  if (tempoChangeSuspected) confidence *= 0.55;
  confidence = clamp(confidence, 0, 1);
  const sufficient = beats.length >= 3 && confidence >= 0.18 && envelope.peaks.length >= 4;
  const quality = qualityFor(confidence, sufficient);

  // A first-difference envelope has no predecessor window, so flux[0] is always
  // zero and the first analysis window already contains the attack energy of an
  // onset at t=0. When the measured grid extrapolates back onto frame zero but
  // no beat was detected there, the leading beat is outside the detection domain
  // and has to come from an approved manual start anchor instead.
  const leadingBeatUndetected =
    beats.length >= 2 &&
    meanIntervalFrames > 0 &&
    beats[0].frame > 0 &&
    Math.abs(beats[0].frame - meanIntervalFrames) <= Math.max(1, meanIntervalFrames * 0.25);

  const limitations = ['constant-tempo-only'];
  if (halfTempo) limitations.push('half-tempo-ambiguous');
  if (doubleTempo) limitations.push('double-tempo-ambiguous');
  if (offbeatOnsets > 0) limitations.push('offbeat-transients-present');
  if (leadingBeatUndetected) limitations.push('frame-zero-onset-not-detected');
  if (tempoChangeSuspected) limitations.push('tempo-change-suspected');
  if (!sufficient) limitations.push('insufficient-rhythmic-evidence');

  const candidates: TempoCandidate[] = deduped.map((candidate) => ({
    bpm: Number(candidate.bpm.toFixed(3)),
    lagHops: candidate.lag,
    periodicity: candidate.periodicity,
    harmonicScore: candidate.harmonicScore,
    score: candidate.score,
    relation: relationFor(candidate.bpm, referenceBpm),
  }));

  if (!sufficient) {
    return {
      schemaVersion: 1,
      projectId: options.projectId,
      algorithmVersion: BEAT_GRID_ALGORITHM_VERSION,
      sourceSha256: options.sourceSha256,
      sampleRate: options.sampleRate,
      outputFps: options.outputFps,
      durationFrames: options.durationFrames,
      parameters: {frameSize, hopSize, minBpm, maxBpm, bpmStep, onsetThreshold: threshold},
      onsetStrength: {
        frameCount: values.length,
        mean: envelope.mean,
        max: envelope.max,
        activeFrames: envelope.activeFrames,
      },
      tempoCandidates: candidates,
      estimatedTempo: null,
      phase: null,
      beatEvents: [],
      evidence: {
        onsetCount: envelope.peaks.length,
        beatCount: 0,
        meanIntervalFrames: 0,
        intervalJitterFrames: 0,
        tempoChangeSuspected,
      },
      limitations,
      status: 'estimated',
      approval: 'unapproved',
    };
  }

  return {
    schemaVersion: 1,
    projectId: options.projectId,
    algorithmVersion: BEAT_GRID_ALGORITHM_VERSION,
    sourceSha256: options.sourceSha256,
    sampleRate: options.sampleRate,
    outputFps: options.outputFps,
    durationFrames: options.durationFrames,
    parameters: {frameSize, hopSize, minBpm, maxBpm, bpmStep, onsetThreshold: threshold},
    onsetStrength: {
      frameCount: values.length,
      mean: envelope.mean,
      max: envelope.max,
      activeFrames: envelope.activeFrames,
    },
    tempoCandidates: candidates,
    estimatedTempo: {
      bpm: Number(referenceBpm.toFixed(3)),
      confidence,
      quality,
      ambiguity: {
        halfTempo,
        doubleTempo,
        offbeatOnsets,
        notes: [
          ...(halfTempo ? ['A half-tempo candidate is close in score; manual confirmation may be required.'] : []),
          ...(doubleTempo ? ['A double-tempo candidate is close in score; manual confirmation may be required.'] : []),
          ...(tempoChangeSuspected ? ['Tempo-change evidence was detected; the constant-tempo grid is not authoritative.'] : []),
        ],
      },
    },
    phase: {
      offsetHops: bestPhaseOffset,
      offsetSeconds: bestPhaseOffset * envelope.hopSeconds,
      score: bestPhaseScore,
      contrast: phaseContrast,
    },
    beatEvents: beats.map((beat) => ({...beat, confidence})),
    evidence: {
      onsetCount: envelope.peaks.length,
      beatCount: beats.length,
      meanIntervalFrames,
      intervalJitterFrames,
      tempoChangeSuspected,
    },
    limitations,
    status: 'estimated',
    approval: 'unapproved',
  };
};

export type BeatGridApprovalInput = {
  projectId: string;
  beatGridPath: string;
  interpretation: BeatGridInterpretation;
  reviewNotes: string;
  approvalRevision: number;
  ambiguityAcknowledged: boolean;
};

/**
 * Turn one measured beat grid into the reviewer's explicit timing decision.
 * The estimate itself is never promoted: only an approved record produced here
 * and re-validated against the same report can drive director timing.
 */
export const selectBeatGridInterpretation = (
  report: BeatGridReport,
  interpretation: BeatGridInterpretation,
): {events: BeatEvent[]; bpm: number} => {
  if (!report.estimatedTempo) {
    throw new PreproductionError(
      'Cannot approve a beat grid with insufficient rhythmic evidence; add approved manual BPM, beat anchors or cut cues instead',
    );
  }
  const bpm = report.estimatedTempo.bpm;
  if (interpretation === 'as-estimated') {
    return {events: report.beatEvents, bpm};
  }
  if (!report.estimatedTempo.ambiguity.halfTempo) {
    throw new PreproductionError(
      'A half-tempo interpretation can only be approved when the beat grid reports a competing half-tempo candidate',
    );
  }
  const events = report.beatEvents.filter((_, index) => index % 2 === 0);
  if (events.length < 2) {
    throw new PreproductionError('A half-tempo interpretation needs at least two approved beats');
  }
  return {events, bpm: bpm / 2};
};

export const buildApprovedBeatGrid = (
  report: BeatGridReport,
  input: BeatGridApprovalInput,
): ApprovedBeatGrid => {
  if (input.projectId !== report.projectId) {
    throw new PreproductionError('Beat grid approval projectId does not match the report');
  }
  if (!report.estimatedTempo) {
    throw new PreproductionError(
      'Cannot approve a beat grid with insufficient rhythmic evidence; add approved manual BPM, beat anchors or cut cues instead',
    );
  }
  const tempo = report.estimatedTempo;
  const ambiguous = tempo.ambiguity.halfTempo || tempo.ambiguity.doubleTempo;
  if (ambiguous && !input.ambiguityAcknowledged) {
    throw new PreproductionError(
      'The beat grid reports competing tempo interpretations; acknowledge the ambiguity and select one interpretation explicitly',
    );
  }
  const selected = selectBeatGridInterpretation(report, input.interpretation);
  return {
    schemaVersion: 1,
    projectId: input.projectId,
    status: 'approved',
    source: {
      beatGridPath: input.beatGridPath,
      algorithmVersion: report.algorithmVersion,
      sourceSha256: report.sourceSha256,
      candidateBpm: tempo.bpm,
      confidence: tempo.confidence,
      quality: tempo.quality,
      ambiguity: {
        halfTempo: tempo.ambiguity.halfTempo,
        doubleTempo: tempo.ambiguity.doubleTempo,
        offbeatOnsets: tempo.ambiguity.offbeatOnsets,
        notes: [...tempo.ambiguity.notes],
      },
      candidateBeatFrames: report.beatEvents.map((event) => event.frame),
      candidateBeatIds: report.beatEvents.map((event) => event.id),
    },
    selected: {
      bpm: Number(selected.bpm.toFixed(3)),
      interpretation: input.interpretation,
      ambiguityAcknowledged: input.ambiguityAcknowledged,
      selectedBy: 'user',
      beatFrames: selected.events.map((event) => event.frame),
      beatIds: selected.events.map((event) => event.id),
      reviewNotes: input.reviewNotes,
      approvalRevision: input.approvalRevision,
    },
  };
};