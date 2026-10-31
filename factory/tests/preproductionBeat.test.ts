import assert from 'node:assert/strict';
import test from 'node:test';
import {
  analyzeBeatGrid,
  buildApprovedBeatGrid,
  selectBeatGridInterpretation,
} from '../src/preproduction/beatGrid';
import {validateApprovedBeatGrid} from '../src/preproduction/validate';

const RATE = 48000;
const FPS = 30;
const FRAMES = 120;
const SECONDS = 4;

const track = (): Float32Array => new Float32Array(RATE * SECONDS);

const kick = (samples: Float32Array, time: number, amplitude = 0.8): void => {
  const start = Math.round(time * RATE);
  const length = Math.round(0.09 * RATE);
  for (let index = 0; index < length && start + index < samples.length; index++) {
    const envelope = Math.exp(-index / (RATE * 0.025));
    samples[start + index] += Math.sin((2 * Math.PI * 60 * index) / RATE) * amplitude * envelope;
  }
};

const click = (samples: Float32Array, time: number, amplitude = 0.25): void => {
  const start = Math.round(time * RATE);
  const length = Math.round(0.018 * RATE);
  for (let index = 0; index < length && start + index < samples.length; index++) {
    const envelope = Math.exp(-index / (RATE * 0.004));
    samples[start + index] += Math.sin((2 * Math.PI * 2000 * index) / RATE) * amplitude * envelope;
  }
};

const analyze = (samples: Float32Array, id = 'beat-test') =>
  analyzeBeatGrid(samples, {
    projectId: id,
    sourceSha256: 'a'.repeat(64),
    sampleRate: RATE,
    outputFps: FPS,
    durationFrames: FRAMES,
  });

const strongTrack = (): Float32Array => {
  const samples = track();
  for (let time = 0; time < SECONDS; time += 0.5) {
    kick(samples, time);
    click(samples, time + 0.25, 0.22);
  }
  return samples;
};

test('strong 120 BPM track yields a frame-aligned candidate beat grid', () => {
  const report = analyze(strongTrack());
  assert.ok(report.estimatedTempo);
  assert.ok(Math.abs(report.estimatedTempo.bpm - 120) <= 2);
  assert.ok(report.estimatedTempo.confidence > 0.4);
  assert.ok(report.beatEvents.length >= 6);
  const expected = Array.from({length: 8}, (_, index) => index * 15);
  for (const beat of report.beatEvents) {
    const nearest = Math.min(...expected.map((frame) => Math.abs(frame - beat.frame)));
    assert.ok(nearest <= 1, `beat frame ${beat.frame} is not within one frame of the synthetic grid`);
    assert.equal(beat.source, 'estimated');
    assert.equal(beat.classification, 'estimated');
    assert.equal(beat.confidence, report.estimatedTempo?.confidence);
  }
  assert.ok(report.limitations.includes('constant-tempo-only'));
  assert.ok(report.limitations.includes('offbeat-transients-present'));
  assert.ok(report.evidence.meanIntervalFrames > 13 && report.evidence.meanIntervalFrames < 17);
  assert.ok(report.evidence.intervalJitterFrames < 2);
});

test('half/double tempo candidates and ambiguity are explicit', () => {
  const samples = track();
  for (let time = 0; time < SECONDS; time += 0.5) kick(samples, time, 0.75);
  const report = analyze(samples, 'ambiguous');
  assert.ok(report.estimatedTempo);
  assert.ok(
    report.tempoCandidates.some(
      (candidate) => candidate.relation === 'half' || candidate.relation === 'double',
    ),
    'expected a half/double candidate relation',
  );
  const ambiguity = report.estimatedTempo.ambiguity;
  assert.ok(ambiguity.halfTempo || ambiguity.doubleTempo || ambiguity.notes.length > 0);
});

test('silence and sparse ambient material fail to produce a confident grid', () => {
  const silence = analyze(track(), 'silence');
  assert.equal(silence.estimatedTempo, null);
  assert.equal(silence.beatEvents.length, 0);
  assert.ok(silence.limitations.includes('insufficient-rhythmic-evidence'));

  const sparseSamples = track();
  for (const time of [0.3, 1.1, 2.4, 3.7]) click(sparseSamples, time, 0.3);
  const sparseReport = analyze(sparseSamples, 'sparse');
  assert.ok(sparseReport.estimatedTempo === null || sparseReport.estimatedTempo.quality !== 'high');
  assert.ok(
    sparseReport.limitations.includes('tempo-change-suspected') ||
      sparseReport.limitations.includes('insufficient-rhythmic-evidence') ||
      (sparseReport.estimatedTempo?.confidence ?? 0) < 0.7,
  );
});

test('continuous ambient tones do not yield a confident beat grid', () => {
  const samples = track();
  for (let index = 0; index < samples.length; index++) {
    const time = index / RATE;
    samples[index] =
      Math.sin(2 * Math.PI * 110 * time) * 0.05 + Math.sin(2 * Math.PI * 223 * time) * 0.03;
  }
  const report = analyze(samples, 'ambient');
  assert.equal(report.estimatedTempo, null);
  assert.equal(report.beatEvents.length, 0);
  assert.ok(report.limitations.includes('insufficient-rhythmic-evidence'));
});

test('a pickup transient is not promoted to the start of the beat grid', () => {
  const samples = track();
  click(samples, 0.1, 0.35);
  for (let time = 0.5; time < SECONDS; time += 0.5) kick(samples, time);
  const report = analyze(samples, 'pickup');
  assert.ok(report.estimatedTempo);
  assert.ok(Math.abs(report.estimatedTempo.bpm - 120) <= 2);
  assert.ok(report.beatEvents.length >= 6);
  assert.ok(report.beatEvents.every((beat) => beat.frame >= 10));
});

test('changing tempo is not presented as a confident constant grid', () => {
  const samples = track();
  for (let time = 0; time < 2; time += 0.6) kick(samples, time, 0.75);
  for (let time = 2; time < 3.8; time += 0.4) kick(samples, time, 0.75);
  const report = analyze(samples, 'tempo-change');
  assert.ok(report.evidence.tempoChangeSuspected || report.estimatedTempo === null || report.estimatedTempo.quality !== 'high');
  assert.ok(report.limitations.includes('tempo-change-suspected') || report.estimatedTempo === null);
});

test('beat frames are integer output frames inside the project duration', () => {
  const report = analyze(strongTrack(), 'frames');
  for (const beat of report.beatEvents) {
    assert.ok(Number.isInteger(beat.frame));
    assert.ok(beat.frame >= 0 && beat.frame < FRAMES);
  }
});

const delayedTrack = (): Float32Array => {
  const samples = track();
  for (let time = 0.2; time < SECONDS; time += 0.5) {
    kick(samples, time);
    click(samples, time + 0.25, 0.22);
  }
  return samples;
};

test('an onset at frame zero is reported as outside the detection domain, never invented', () => {
  const report = analyze(strongTrack(), 'frame-zero');
  assert.ok(report.estimatedTempo);
  assert.ok(report.beatEvents.length >= 6);
  assert.ok(report.beatEvents[0].frame > 0, 'a flux envelope cannot peak at hop 0');
  assert.ok(report.beatEvents.every((beat) => beat.frame !== 0));
  assert.ok(report.limitations.includes('frame-zero-onset-not-detected'));
  assert.ok(Math.abs(report.evidence.meanIntervalFrames - 15) <= 1);
});

test('the same rhythm delayed past the analysis boundary recovers its leading beat', () => {
  const samples = track();
  for (let time = 0.2; time < SECONDS; time += 0.5) {
    kick(samples, time);
    click(samples, time + 0.25, 0.22);
  }
  const report = analyze(samples, 'delayed');
  assert.ok(report.estimatedTempo);
  assert.ok(Math.abs(report.estimatedTempo.bpm - 120) <= 2);
  assert.ok(
    report.beatEvents.some((beat) => Math.abs(beat.frame - 6) <= 1),
    `expected a leading beat near frame 6, got ${report.beatEvents.map((beat) => beat.frame).join(', ')}`,
  );
  assert.ok(!report.limitations.includes('frame-zero-onset-not-detected'));
});

const approvalInput = (
  projectId: string,
  interpretation: 'as-estimated' | 'half-tempo',
  ambiguityAcknowledged: boolean,
) => ({
  projectId,
  beatGridPath: 'preproduction/beat-grid.json',
  interpretation,
  reviewNotes: 'Reviewed against the synthetic pulse train.',
  approvalRevision: 1,
  ambiguityAcknowledged,
});

test('a flagged tempo ambiguity cannot be approved without explicit acknowledgement', () => {
  const report = analyze(strongTrack(), 'beat-test');
  assert.ok(report.estimatedTempo);
  assert.ok(report.estimatedTempo.ambiguity.halfTempo || report.estimatedTempo.ambiguity.doubleTempo);
  assert.throws(
    () => buildApprovedBeatGrid(report, approvalInput('beat-test', 'as-estimated', false)),
    /competing tempo interpretations/,
  );
  const approved = buildApprovedBeatGrid(report, approvalInput('beat-test', 'as-estimated', true));
  assert.equal(approved.status, 'approved');
  assert.equal(approved.selected.selectedBy, 'user');
  assert.equal(approved.selected.ambiguityAcknowledged, true);
});

test('an approval preserves the estimated provenance and the selected interpretation', () => {
  const report = analyze(strongTrack(), 'beat-test');
  const approved = buildApprovedBeatGrid(report, approvalInput('beat-test', 'as-estimated', true));
  assert.equal(approved.source.algorithmVersion, report.algorithmVersion);
  assert.equal(approved.source.sourceSha256, report.sourceSha256);
  assert.equal(approved.source.candidateBpm, report.estimatedTempo?.bpm);
  assert.equal(approved.source.confidence, report.estimatedTempo?.confidence);
  assert.equal(approved.source.quality, report.estimatedTempo?.quality);
  assert.equal(approved.source.ambiguity.halfTempo, report.estimatedTempo?.ambiguity.halfTempo);
  assert.deepEqual(approved.source.candidateBeatFrames, report.beatEvents.map((beat) => beat.frame));
  assert.deepEqual(approved.source.candidateBeatIds, report.beatEvents.map((beat) => beat.id));
  assert.deepEqual(approved.selected.beatFrames, report.beatEvents.map((beat) => beat.frame));
  assert.deepEqual(approved.selected.beatIds, report.beatEvents.map((beat) => beat.id));
  assert.equal(approved.selected.bpm, report.estimatedTempo?.bpm);
  assert.equal(report.approval, 'unapproved', 'the estimate itself must stay unapproved');
});

test('a half-tempo approval selects every second measured beat and halves the tempo', () => {
  const report = analyze(strongTrack(), 'beat-test');
  assert.ok(report.estimatedTempo?.ambiguity.halfTempo);
  const selected = selectBeatGridInterpretation(report, 'half-tempo');
  assert.equal(selected.bpm, (report.estimatedTempo?.bpm ?? 0) / 2);
  assert.deepEqual(selected.events, report.beatEvents.filter((_, index) => index % 2 === 0));
  const approved = buildApprovedBeatGrid(report, approvalInput('beat-test', 'half-tempo', true));
  assert.equal(approved.selected.interpretation, 'half-tempo');
  assert.deepEqual(approved.selected.beatFrames, selected.events.map((beat) => beat.frame));
});

test('a grid without a competing half-tempo candidate cannot be approved as half tempo', () => {
  const samples = track();
  for (let time = 0; time < SECONDS; time += 0.5) kick(samples, time, 0.9);
  const report = analyze(samples, 'no-half');
  if (!report.estimatedTempo?.ambiguity.halfTempo) {
    assert.throws(
      () => selectBeatGridInterpretation(report, 'half-tempo'),
      /competing half-tempo candidate/,
    );
  }
});

test('an insufficient-evidence grid cannot be approved as timing', () => {
  const report = analyze(track(), 'silence');
  assert.equal(report.estimatedTempo, null);
  assert.throws(
    () => buildApprovedBeatGrid(report, approvalInput('silence', 'as-estimated', true)),
    /insufficient rhythmic evidence/,
  );
  assert.throws(
    () =>
      validateApprovedBeatGrid(
        {schemaVersion: 1, projectId: 'silence', status: 'approved', source: {}, selected: {}},
        {
          projectId: 'silence',
          fps: FPS,
          durationInFrames: FRAMES,
          sourceSha256: 'a'.repeat(64),
          beatGridPath: 'preproduction/beat-grid.json',
        },
        report,
      ),
    /insufficient rhythmic evidence/,
  );
});

test('a stale approval is rejected when the grid is re-analysed', () => {
  const report = analyze(strongTrack(), 'beat-test');
  const approved = buildApprovedBeatGrid(report, approvalInput('beat-test', 'as-estimated', true));
  const context = {
    projectId: 'beat-test',
    fps: FPS,
    durationInFrames: FRAMES,
    sourceSha256: report.sourceSha256,
    beatGridPath: 'preproduction/beat-grid.json',
  };
  assert.equal(validateApprovedBeatGrid(approved, context, report).status, 'approved');

  const other = analyze(delayedTrack(), 'beat-test');
  assert.throws(() => validateApprovedBeatGrid(approved, context, other), /stale|do not match/);
  assert.throws(
    () => validateApprovedBeatGrid({...approved, status: 'proposed'}, context, report),
    /must be "approved"/,
  );
  assert.throws(
    () => validateApprovedBeatGrid(approved, context, null),
    /missing/,
  );
  assert.throws(
    () =>
      validateApprovedBeatGrid(
        {
          ...approved,
          selected: {...approved.selected, beatFrames: [0, ...approved.selected.beatFrames]},
        },
        context,
        report,
      ),
    /measured by the approved interpretation/,
  );
});