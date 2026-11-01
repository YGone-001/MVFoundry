// Deterministic synthetic score for the independent Project B ("Prism Transit").
//
// 50 seconds, 5/4 meter, two tempo regions (100 BPM and 120 BPM) with explicit
// tempo changes, five nonuniform sections. Generated from oscillators and a
// seeded noise source so the bytes are reproducible; nothing is sampled.
//
// The point of the odd meter and the tempo change is to prove the production
// path does not assume 4/4, a constant tempo, equal sections or a fixed song
// length.

import {execFileSync} from 'node:child_process';
import {mkdirSync, writeFileSync} from 'node:fs';
import path from 'node:path';

const SAMPLE_RATE = 48000;
const DURATION_SECONDS = 50;
const TOTAL_SAMPLES = SAMPLE_RATE * DURATION_SECONDS;

// Section boundaries in seconds. Durations: 9, 12.5, 12, 12.5, 4 — nonuniform.
export const SCORE_B_SECTIONS = [
  {id: 'PT-SEC-01', label: 'threshold', startSeconds: 0, endSeconds: 9, bpm: 100, meter: 5},
  {id: 'PT-SEC-02', label: 'ascent', startSeconds: 9, endSeconds: 21.5, bpm: 120, meter: 5},
  {id: 'PT-SEC-03', label: 'fracture', startSeconds: 21.5, endSeconds: 33.5, bpm: 100, meter: 5},
  {id: 'PT-SEC-04', label: 'surge', startSeconds: 33.5, endSeconds: 46, bpm: 120, meter: 5},
  {id: 'PT-SEC-05', label: 'settle', startSeconds: 46, endSeconds: 50, bpm: 100, meter: 5},
];

// Explicit tempo-change markers (the music actually changes speed here).
export const SCORE_B_TEMPO_CHANGES = [
  {atSeconds: 9, fromBpm: 100, toBpm: 120, label: 'accelerando into ascent'},
  {atSeconds: 21.5, fromBpm: 120, toBpm: 100, label: 'ritardando into fracture'},
  {atSeconds: 33.5, fromBpm: 100, toBpm: 120, label: 'accelerando into surge'},
];

const NOTE = {
  E2: 82.407, G2: 97.999, A2: 110.0, B2: 123.47, C3: 130.81, D3: 146.83,
  E3: 164.81, G3: 195.998, A3: 220.0, B3: 246.94, C4: 261.63, D4: 293.66,
  E4: 329.63, G4: 391.995, A4: 440.0, B4: 493.88, C5: 523.25, D5: 587.33, E5: 659.25,
};

const clamp = (value, low, high) => (value < low ? low : value > high ? high : value);

// Deterministic pseudo-noise in [-1, 1].
const noise = (index, seed) => {
  const value = Math.sin(index * 12.9898 + seed * 78.233) * 43758.5453;
  return (value - Math.floor(value)) * 2 - 1;
};

const envelope = (t, attack, decay, sustain, release, length) => {
  if (t < 0 || t > length) return 0;
  if (t < attack) return t / attack;
  if (t < attack + decay) return 1 - (1 - sustain) * ((t - attack) / decay);
  if (t < length - release) return sustain;
  return sustain * Math.max(0, (length - t) / release);
};

const osc = (t, frequency, kind) => {
  const phase = 2 * Math.PI * frequency * t;
  if (kind === 'sine') return Math.sin(phase);
  if (kind === 'triangle') return (2 / Math.PI) * Math.asin(Math.sin(phase));
  if (kind === 'saw') return 2 * ((frequency * t) % 1) - 1;
  if (kind === 'square') return Math.sin(phase) >= 0 ? 1 : -1;
  return Math.sin(phase);
};

const beatTimes = (section) => {
  const beat = 60 / section.bpm;
  const times = [];
  for (let t = section.startSeconds; t < section.endSeconds - 1e-6; t += beat) {
    times.push({t, beat: times.length % section.meter});
  }
  return times;
};

/**
 * Renders the score into a stereo Float32 buffer, then writes a PCM WAV.
 * Returns the metadata the caller records as timing evidence.
 */
export const writeScoreB = (file) => {
  const left = new Float32Array(TOTAL_SAMPLES);
  const right = new Float32Array(TOTAL_SAMPLES);
  const add = (t, value, pan = 0.5, gain = 1) => {
    const index = Math.round(t * SAMPLE_RATE);
    if (index < 0 || index >= TOTAL_SAMPLES) return;
    left[index] += value * gain * (1 - pan);
    right[index] += value * gain * pan;
  };

  const kick = (t, strength = 1) => {
    for (let i = 0; i < SAMPLE_RATE * 0.28; i++) {
      const tt = i / SAMPLE_RATE;
      const freq = 110 * Math.exp(-tt * 18) + 42;
      const env = Math.exp(-tt * 11);
      const value = Math.sin(2 * Math.PI * freq * tt) * env * 0.85 * strength;
      const index = Math.round(t * SAMPLE_RATE) + i;
      if (index >= TOTAL_SAMPLES) break;
      left[index] += value * 0.5;
      right[index] += value * 0.5;
    }
  };

  const snare = (t, strength = 1) => {
    for (let i = 0; i < SAMPLE_RATE * 0.2; i++) {
      const tt = i / SAMPLE_RATE;
      const env = Math.exp(-tt * 22);
      const value = (noise(i, 7) * 0.7 + Math.sin(2 * Math.PI * 195 * tt) * 0.3) * env * 0.5 * strength;
      const index = Math.round(t * SAMPLE_RATE) + i;
      if (index >= TOTAL_SAMPLES) break;
      left[index] += value * 0.55;
      right[index] += value * 0.45;
    }
  };

  const bell = (t, freq, gain = 1, length = 1.6) => {
    for (let i = 0; i < SAMPLE_RATE * length; i++) {
      const tt = i / SAMPLE_RATE;
      const env = Math.exp(-tt * 2.4);
      const value = (
        Math.sin(2 * Math.PI * freq * tt) * 0.6 +
        Math.sin(2 * Math.PI * freq * 2.01 * tt) * 0.25 +
        Math.sin(2 * Math.PI * freq * 3.02 * tt) * 0.12
      ) * env * 0.32 * gain;
      const index = Math.round(t * SAMPLE_RATE) + i;
      if (index >= TOTAL_SAMPLES) break;
      left[index] += value * 0.5;
      right[index] += value * 0.5;
    }
  };

  const bassNote = (t, freq, length, gain = 1, kind = 'triangle') => {
    for (let i = 0; i < SAMPLE_RATE * length; i++) {
      const tt = i / SAMPLE_RATE;
      const env = envelope(tt, 0.008, 0.09, 0.62, 0.09, length);
      const value = (osc(tt, freq, kind) * 0.75 + osc(tt, freq * 2, 'sine') * 0.25) * env * 0.3 * gain;
      const index = Math.round(t * SAMPLE_RATE) + i;
      if (index >= TOTAL_SAMPLES) break;
      left[index] += value * 0.5;
      right[index] += value * 0.5;
    }
  };

  const padChord = (t, freqs, length, gain = 1) => {
    for (let i = 0; i < SAMPLE_RATE * length; i++) {
      const tt = i / SAMPLE_RATE;
      const env = envelope(tt, length * 0.25, length * 0.2, 0.75, length * 0.35, length);
      let value = 0;
      for (const [index, freq] of freqs.entries()) {
        value += osc(tt, freq, 'saw') * (0.22 / freqs.length);
        value += osc(tt, freq * 1.004, 'triangle') * (0.12 / freqs.length);
        void index;
      }
      value *= env * 0.55 * gain;
      const index = Math.round(t * SAMPLE_RATE) + i;
      if (index >= TOTAL_SAMPLES) break;
      left[index] += value * 0.55;
      right[index] += value * 0.45;
    }
  };

  const arpNote = (t, freq, length, gain = 1) => {
    for (let i = 0; i < SAMPLE_RATE * length; i++) {
      const tt = i / SAMPLE_RATE;
      const env = envelope(tt, 0.004, 0.05, 0.35, 0.05, length);
      const value = osc(tt, freq, 'square') * env * 0.13 * gain;
      const index = Math.round(t * SAMPLE_RATE) + i;
      if (index >= TOTAL_SAMPLES) break;
      left[index] += value * 0.42;
      right[index] += value * 0.58;
    }
  };

  const leadNote = (t, freq, length, gain = 1) => {
    for (let i = 0; i < SAMPLE_RATE * length; i++) {
      const tt = i / SAMPLE_RATE;
      const env = envelope(tt, 0.02, 0.12, 0.7, 0.18, length);
      const vibrato = 1 + Math.sin(2 * Math.PI * 5.2 * tt) * 0.006;
      const value = (
        osc(tt, freq * vibrato, 'saw') * 0.4 +
        osc(tt, freq * vibrato * 2, 'triangle') * 0.2
      ) * env * 0.2 * gain;
      const index = Math.round(t * SAMPLE_RATE) + i;
      if (index >= TOTAL_SAMPLES) break;
      left[index] += value * 0.5;
      right[index] += value * 0.5;
    }
  };

  // ---- Section 1: threshold (0-9s, 100 BPM 5/4, sparse) ----
  padChord(0, [NOTE.A2, NOTE.E3, NOTE.C4], 9, 0.9);
  bell(1.2, NOTE.E4, 0.8);
  bell(4.2, NOTE.A4, 0.7);
  bell(7.2, NOTE.C5, 0.6);
  for (const {t, beat} of beatTimes(SCORE_B_SECTIONS[0])) {
    if (beat === 0) kick(t, 0.55);
  }

  // ---- Section 2: ascent (9-21.5s, 120 BPM 5/4, rhythmic) ----
  padChord(9, [NOTE.G2, NOTE.D3, NOTE.B3], 12.5, 0.7);
  const ascentArp = [NOTE.G3, NOTE.B3, NOTE.D4, NOTE.G4, NOTE.D4, NOTE.B3];
  let ascentStep = 0;
  for (const {t, beat} of beatTimes(SCORE_B_SECTIONS[1])) {
    if (beat === 0 || beat === 3) kick(t, 1);
    if (beat === 2) snare(t, 0.85);
    const beatLength = 60 / 120;
    bassNote(t, beat % 2 === 0 ? NOTE.G2 : NOTE.D3, beatLength * 0.9, 1);
    for (let sub = 0; sub < 2; sub++) {
      arpNote(t + sub * beatLength * 0.5, ascentArp[ascentStep % ascentArp.length], beatLength * 0.48, 1);
      ascentStep += 1;
    }
  }
  bell(20.6, NOTE.B4, 0.6, 1.2);

  // ---- Section 3: fracture (21.5-33.5s, 100 BPM 5/4, contrasting) ----
  padChord(21.5, [NOTE.C3, NOTE.F3, NOTE.G3, NOTE.A3], 12, 0.8);
  for (const {t, beat} of beatTimes(SCORE_B_SECTIONS[2])) {
    if (beat === 0) kick(t, 0.7);
    if (beat === 4) snare(t, 0.5);
    // A deliberate dissonant cluster that resolves later.
    if (beat === 1 || beat === 3) {
      bell(t, NOTE.C5 * (beat === 1 ? 1 : 1.06), 0.55, 0.9);
    }
  }
  bell(28, NOTE.E5, 0.5, 2.2);

  // ---- Section 4: surge (33.5-46s, 120 BPM 5/4, densest) ----
  padChord(33.5, [NOTE.E2, NOTE.B2, NOTE.E3, NOTE.G3], 12.5, 0.85);
  const surgeArp = [NOTE.E4, NOTE.G4, NOTE.B4, NOTE.E5, NOTE.B4, NOTE.G4];
  let surgeStep = 0;
  for (const {t, beat} of beatTimes(SCORE_B_SECTIONS[3])) {
    kick(t, 1.05);
    if (beat === 2) snare(t, 1);
    const beatLength = 60 / 120;
    bassNote(t, NOTE.E2, beatLength * 0.9, 1.15);
    bassNote(t, NOTE.E3, beatLength * 0.85, 0.55);
    for (let sub = 0; sub < 2; sub++) {
      arpNote(t + sub * beatLength * 0.5, surgeArp[surgeStep % surgeArp.length], beatLength * 0.48, 1.1);
      surgeStep += 1;
    }
    if (beat === 0) leadNote(t, NOTE.B4, beatLength * 1.6, 0.9);
    if (beat === 3) leadNote(t, NOTE.G4, beatLength * 1.4, 0.8);
  }

  // ---- Section 5: settle (46-50s, final chord, decay) ----
  padChord(46, [NOTE.A2, NOTE.E3, NOTE.A3, NOTE.C4], 4, 1);
  bell(46.2, NOTE.A4, 0.9, 2.4);
  bell(48, NOTE.E4, 0.6, 2.0);
  kick(46, 0.5);

  // Global fade-in / fade-out so the file never starts or ends on a click.
  const fadeSamples = Math.round(SAMPLE_RATE * 0.02);
  for (let i = 0; i < fadeSamples; i++) {
    const gain = i / fadeSamples;
    left[i] *= gain;
    right[i] *= gain;
    const end = TOTAL_SAMPLES - 1 - i;
    left[end] *= gain;
    right[end] *= gain;
  }

  // Normalize to a comfortable peak with headroom.
  let peak = 0;
  for (let i = 0; i < TOTAL_SAMPLES; i++) {
    peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
  }
  const scale = peak > 0 ? 0.82 / peak : 1;
  for (let i = 0; i < TOTAL_SAMPLES; i++) {
    left[i] *= scale;
    right[i] *= scale;
  }

  // ---- Write 16-bit stereo PCM WAV ----
  const dataSize = TOTAL_SAMPLES * 2 * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8, 'ascii');
  buffer.write('fmt ', 12, 'ascii');
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(2, 22);
  buffer.writeUInt32LE(SAMPLE_RATE, 24);
  buffer.writeUInt32LE(SAMPLE_RATE * 2 * 2, 28);
  buffer.writeUInt16LE(4, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36, 'ascii');
  buffer.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < TOTAL_SAMPLES; i++) {
    const l = clamp(Math.round(left[i] * 32767), -32768, 32767);
    const r = clamp(Math.round(right[i] * 32767), -32768, 32767);
    buffer.writeInt16LE(l, 44 + i * 4);
    buffer.writeInt16LE(r, 44 + i * 4 + 2);
  }
  mkdirSync(path.dirname(file), {recursive: true});
  writeFileSync(file, buffer);

  // Deterministic timing metadata: section times, tempo changes and every hit.
  const hits = [];
  for (const section of SCORE_B_SECTIONS) {
    for (const {t, beat} of beatTimes(section)) {
      hits.push({timeSeconds: Number(t.toFixed(4)), section: section.id, beat});
    }
  }
  const metadata = {
    schemaVersion: 1,
    title: 'Prism Transit (synthetic score)',
    generator: 'factory/scripts/support/synthetic-score-b.mjs',
    sampleRate: SAMPLE_RATE,
    channels: 2,
    durationSeconds: DURATION_SECONDS,
    meter: '5/4',
    tempoModel: 'explicit regions with recorded tempo changes',
    sections: SCORE_B_SECTIONS,
    tempoChanges: SCORE_B_TEMPO_CHANGES,
    beatMarkers: hits,
    note: 'Generated from oscillators and a seeded noise source. Nothing is sampled and no third-party audio is used.',
  };
  writeFileSync(file.replace(/\.wav$/i, '.json'), `${JSON.stringify(metadata, null, 2)}\n`);

  void execFileSync;
  return metadata;
};

export const SCORE_B_SECONDS = DURATION_SECONDS;
