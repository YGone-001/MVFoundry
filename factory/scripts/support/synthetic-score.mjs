// Deterministic synthetic score for the complete-MV rehearsal.
//
// Everything here is generated: no samples, no third-party audio, no external
// tooling. The composition has real section structure (intro, pulse, drive,
// drift, bloom, resolve) with distinct instrumentation and density so the
// director planner and the acceptance verifier have genuine musical evidence to
// work from rather than one continuous tone.

export const SCORE_BPM = 120;
export const SCORE_BARS = 30;
export const SCORE_BEATS_PER_BAR = 4;
export const SCORE_SAMPLE_RATE = 48000;

/**
 * Bar ranges are 0-based and half-open. 30 bars at 120 BPM in 4/4 is exactly
 * 60 seconds. Each section length is a multiple of two bars, so every section
 * boundary lands on a bar line (and, at 24 fps, on a frame multiple of 96).
 */
export const SCORE_SECTIONS = [
  {id: 'SEC-01', label: 'intro', startBar: 0, endBar: 2, energy: 'sparse'},
  {id: 'SEC-02', label: 'pulse', startBar: 2, endBar: 6, energy: 'building'},
  {id: 'SEC-03', label: 'drive', startBar: 6, endBar: 12, energy: 'rhythmic'},
  {id: 'SEC-04', label: 'drift', startBar: 12, endBar: 20, energy: 'contrast'},
  {id: 'SEC-05', label: 'bloom', startBar: 20, endBar: 26, energy: 'peak'},
  {id: 'SEC-06', label: 'resolve', startBar: 26, endBar: 30, energy: 'closing'},
];

const CHORDS = {
  Am: [110.0, 164.81, 220.0, 261.63],
  F: [87.31, 130.81, 174.61, 220.0],
  C: [130.81, 196.0, 261.63, 329.63],
  G: [98.0, 146.83, 196.0, 246.94],
};

const ARP = {
  Am: [440.0, 523.25, 659.25, 880.0],
  F: [349.23, 440.0, 523.25, 698.46],
  C: [523.25, 659.25, 783.99, 1046.5],
  G: [392.0, 493.88, 587.33, 783.99],
};

const mulberry32 = (seed) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const chordFor = (bar, section) => {
  if (section.label === 'intro') return 'Am';
  if (section.label === 'pulse') return bar % 2 === 0 ? 'Am' : 'F';
  if (section.label === 'drive') return ['Am', 'F', 'C', 'G'][bar % 4];
  if (section.label === 'drift') return ['F', 'C', 'G', 'Am'][bar % 4];
  if (section.label === 'bloom') return ['Am', 'F', 'C', 'G'][bar % 4];
  return 'Am';
};

/**
 * One deterministic render pass. Both channels are written independently so the
 * master is a genuine stereo mix (pad and arp are spread, drums are centred).
 */
export const renderScore = ({seed = 20261101} = {}) => {
  const beatSeconds = 60 / SCORE_BPM;
  const barSeconds = beatSeconds * SCORE_BEATS_PER_BAR;
  const totalSeconds = SCORE_BARS * barSeconds;
  const samples = Math.round(totalSeconds * SCORE_SAMPLE_RATE);
  const left = new Float32Array(samples);
  const right = new Float32Array(samples);
  const random = mulberry32(seed);

  const add = (startSeconds, lengthSeconds, render, {pan = 0, gain = 1} = {}) => {
    const start = Math.round(startSeconds * SCORE_SAMPLE_RATE);
    const length = Math.round(lengthSeconds * SCORE_SAMPLE_RATE);
    const leftGain = gain * Math.cos(((pan + 1) * Math.PI) / 4);
    const rightGain = gain * Math.sin(((pan + 1) * Math.PI) / 4);
    for (let index = 0; index < length; index++) {
      const position = start + index;
      if (position < 0 || position >= samples) continue;
      const value = render(index / SCORE_SAMPLE_RATE, index, length);
      left[position] += value * leftGain;
      right[position] += value * rightGain;
    }
  };

  const kick = (time, gain = 0.9) =>
    add(
      time,
      0.32,
      (t) => {
        const envelope = Math.exp(-t * 18);
        const frequency = 46 + 90 * Math.exp(-t * 26);
        return Math.sin(2 * Math.PI * frequency * t) * envelope * 0.9;
      },
      {gain},
    );

  const snare = (time, gain = 0.5) =>
    add(
      time,
      0.22,
      (t) => {
        const noise = (random() * 2 - 1) * Math.exp(-t * 26);
        const body = Math.sin(2 * Math.PI * 190 * t) * Math.exp(-t * 34);
        return noise * 0.7 + body * 0.35;
      },
      {gain},
    );

  const hat = (time, gain = 0.18) =>
    add(
      time,
      0.06,
      (t) => {
        const noise = (random() * 2 - 1) * Math.exp(-t * 90);
        return noise * 0.6;
      },
      {gain, pan: 0.25},
    );

  const bass = (time, duration, frequency, gain = 0.42) =>
    add(
      time,
      duration,
      (t, _index, length) => {
        const attack = Math.min(1, t / 0.012);
        const release = Math.min(1, (length - _index) / (0.05 * SCORE_SAMPLE_RATE));
        const saw = 2 * ((t * frequency) % 1) - 1;
        const sub = Math.sin(2 * Math.PI * (frequency / 2) * t);
        return (saw * 0.35 + sub * 0.8) * attack * release;
      },
      {gain},
    );

  const pad = (time, duration, frequencies, gain = 0.16) =>
    frequencies.forEach((frequency, voice) => {
      add(
        time,
        duration,
        (t, _index, length) => {
          const attack = Math.min(1, t / 0.35);
          const release = Math.min(1, (length - _index) / (0.6 * SCORE_SAMPLE_RATE));
          const detune = 1 + (voice - 1.5) * 0.0022;
          const a = Math.sin(2 * Math.PI * frequency * detune * t);
          const b = Math.sin(2 * Math.PI * frequency * 1.004 * t + 0.7);
          return (a + b) * 0.5 * attack * release;
        },
        {gain: gain / frequencies.length, pan: (voice - 1.5) * 0.35},
      );
    });

  const pluck = (time, frequency, gain = 0.16, pan = 0) =>
    add(
      time,
      0.28,
      (t) => {
        const envelope = Math.exp(-t * 9);
        const tone = Math.sin(2 * Math.PI * frequency * t);
        const overtone = Math.sin(2 * Math.PI * frequency * 2.01 * t) * 0.3;
        return (tone + overtone) * envelope;
      },
      {gain, pan},
    );

  const bell = (time, frequency, gain = 0.2) =>
    add(
      time,
      1.6,
      (t) => {
        const envelope = Math.exp(-t * 2.2);
        return (
          Math.sin(2 * Math.PI * frequency * t) * 0.7 +
          Math.sin(2 * Math.PI * frequency * 2.76 * t) * 0.2 +
          Math.sin(2 * Math.PI * frequency * 5.4 * t) * 0.08
        ) * envelope;
      },
      {gain, pan: -0.2},
    );

  const markers = {kicks: [], snares: [], sectionStarts: []};

  for (let bar = 0; bar < SCORE_BARS; bar++) {
    const section = SCORE_SECTIONS.find((entry) => bar >= entry.startBar && bar < entry.endBar);
    if (!section) continue;
    const barStart = bar * barSeconds;
    const chord = CHORDS[chordFor(bar, section)];

    if (section.label === 'intro') {
      pad(barStart, barSeconds * 1.1, chord, 0.2);
      bell(barStart + beatSeconds * 2, ARP.Am[3], 0.12);
      if (bar === 1) {
        bass(barStart, barSeconds * 0.8, 55, 0.22);
        kick(barStart + beatSeconds * 2, 0.45);
        markers.kicks.push(barStart + beatSeconds * 2);
      }
      continue;
    }

    if (section.label === 'pulse') {
      pad(barStart, barSeconds * 1.02, chord, 0.16);
      for (let beat = 0; beat < 4; beat++) {
        const time = barStart + beat * beatSeconds;
        if (beat % 2 === 0) {
          kick(time, 0.62);
          markers.kicks.push(time);
        }
        hat(time + beatSeconds / 2, 0.14);
      }
      for (let step = 0; step < 4; step++) {
        bass(barStart + step * beatSeconds, beatSeconds * 0.82, chord[0] / 2, 0.34);
      }
      if (bar >= 4) {
        const notes = ARP[chordFor(bar, section)];
        for (let step = 0; step < 8; step++) {
          pluck(barStart + step * (beatSeconds / 2), notes[step % notes.length], 0.1, step % 2 ? 0.3 : -0.3);
        }
      }
      continue;
    }

    if (section.label === 'drive') {
      pad(barStart, barSeconds * 1.01, chord, 0.14);
      for (let beat = 0; beat < 4; beat++) {
        const time = barStart + beat * beatSeconds;
        kick(time, 0.85);
        markers.kicks.push(time);
        hat(time + beatSeconds / 2, 0.2);
        if (beat % 2 === 1) {
          snare(time, 0.42);
          markers.snares.push(time);
        }
      }
      const notes = ARP[chordFor(bar, section)];
      for (let step = 0; step < 8; step++) {
        bass(barStart + step * (beatSeconds / 2), beatSeconds * 0.42, chord[0] / 2, 0.4);
      }
      for (let step = 0; step < 16; step++) {
        pluck(barStart + step * (beatSeconds / 4), notes[step % notes.length], 0.11, step % 2 ? 0.4 : -0.4);
      }
      continue;
    }

    if (section.label === 'drift') {
      // Contrast: no kick, half-time feel, wider voicing, higher register bell.
      pad(barStart, barSeconds * 1.05, [...chord, chord[1] * 2], 0.24);
      bell(barStart + beatSeconds * (bar % 3), ARP[chordFor(bar, section)][bar % 4], 0.1);
      bass(barStart, barSeconds * 0.9, chord[0] / 2, 0.26);
      for (let step = 0; step < 4; step++) {
        pluck(barStart + step * beatSeconds + beatSeconds / 2, ARP[chordFor(bar, section)][step % 4], 0.08, step % 2 ? 0.5 : -0.5);
      }
      continue;
    }

    if (section.label === 'bloom') {
      pad(barStart, barSeconds * 1.01, [...chord, chord[2] * 2], 0.16);
      for (let beat = 0; beat < 4; beat++) {
        const time = barStart + beat * beatSeconds;
        kick(time, 0.92);
        markers.kicks.push(time);
        hat(time + beatSeconds / 2, 0.22);
        if (beat % 2 === 1) {
          snare(time, 0.5);
          markers.snares.push(time);
        }
      }
      const notes = ARP[chordFor(bar, section)];
      for (let step = 0; step < 8; step++) {
        const frequency = step % 4 === 3 ? (chord[0] / 2) * 2 : chord[0] / 2;
        bass(barStart + step * (beatSeconds / 2), beatSeconds * 0.4, frequency, 0.46);
      }
      for (let step = 0; step < 16; step++) {
        pluck(barStart + step * (beatSeconds / 4), notes[(step + 2) % notes.length] * (step % 8 === 7 ? 2 : 1), 0.13, step % 2 ? 0.35 : -0.35);
      }
      continue;
    }

    if (section.label === 'resolve') {
      if (bar === 26) {
        pad(barStart, barSeconds * 3.6, CHORDS.Am, 0.26);
        kick(barStart, 0.8);
        markers.kicks.push(barStart);
        bass(barStart, barSeconds * 2.2, CHORDS.Am[0] / 2, 0.4);
        bell(barStart + beatSeconds, ARP.Am[0], 0.16);
        bell(barStart + beatSeconds * 2, ARP.Am[2], 0.12);
      }
      if (bar === 27) {
        bell(barStart, ARP.Am[1], 0.1);
      }
      if (bar === 29) {
        // Final decay tail: the last two beats fade to silence by 60.000s.
        pad(barStart, beatSeconds * 2, [CHORDS.Am[0], CHORDS.Am[2]], 0.12);
      }
    }
  }

  markers.sectionStarts = SCORE_SECTIONS.map((section) => section.startBar * barSeconds);

  let peak = 0;
  for (let index = 0; index < samples; index++) {
    peak = Math.max(peak, Math.abs(left[index]), Math.abs(right[index]));
  }
  const target = 0.72;
  const gain = peak > 0 ? target / peak : 1;
  const fadeSamples = Math.round(0.25 * SCORE_SAMPLE_RATE);
  for (let index = 0; index < samples; index++) {
    // Soft knee instead of hard clipping: keeps transients audible.
    const fadeIn = Math.min(1, index / fadeSamples);
    const fadeOut = Math.min(1, (samples - index) / fadeSamples);
    left[index] = Math.tanh(left[index] * gain) * fadeIn * fadeOut;
    right[index] = Math.tanh(right[index] * gain) * fadeIn * fadeOut;
  }

  return {
    left,
    right,
    samples,
    seconds: totalSeconds,
    sampleRate: SCORE_SAMPLE_RATE,
    markers,
    sections: SCORE_SECTIONS.map((section) => ({
      id: section.id,
      label: section.label,
      energy: section.energy,
      startBar: section.startBar,
      endBar: section.endBar,
      startSeconds: section.startBar * barSeconds,
      endSeconds: section.endBar * barSeconds,
    })),
    bpm: SCORE_BPM,
    beatSeconds,
    barSeconds,
  };
};

export const encodeWav = ({left, right, sampleRate}) => {
  const frames = left.length;
  const dataSize = frames * 2 * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(2, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 4, 28);
  buffer.writeUInt16LE(4, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);
  for (let index = 0; index < frames; index++) {
    buffer.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(left[index] * 32767))), 44 + index * 4);
    buffer.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(right[index] * 32767))), 46 + index * 4);
  }
  return buffer;
};
