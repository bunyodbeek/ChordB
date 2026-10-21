// Pitch detection (YIN) and frequency → note math. Pure functions, no audio APIs.

export const A4 = 440;

export interface PitchOptions {
  minFreq?: number; // lowest pitch looked for (Hz)
  maxFreq?: number; // highest pitch looked for (Hz)
  threshold?: number; // YIN absolute threshold; lower is stricter
  minRms?: number; // below this the frame counts as silence
  window?: number; // samples compared per lag; caps the CPU cost per frame
}

/** RMS level of a frame, 0..1 for normalized audio. */
export function rms(buf: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
  return Math.sqrt(sum / buf.length);
}

/**
 * Fundamental frequency of `buf` in Hz, or null for silence / unpitched sound.
 * YIN (de Cheveigné & Kawahara, 2002) with parabolic interpolation.
 * Needs buf.length >= window + sampleRate / minFreq.
 */
export function detectPitch(
  buf: Float32Array,
  sampleRate: number,
  {
    minFreq = 60,
    maxFreq = 1200,
    threshold = 0.15,
    // ~-50 dBFS: with auto gain off, phone mics pick up a plucked string quietly.
    // Noise that gets past this is still rejected by the YIN threshold.
    minRms = 0.003,
    window = 2048,
  }: PitchOptions = {},
): number | null {
  if (rms(buf) < minRms) return null;

  const tauMax = Math.floor(sampleRate / minFreq);
  const tauMin = Math.max(2, Math.floor(sampleRate / maxFreq));
  const w = Math.min(window, buf.length - tauMax - 1);
  if (w <= 0) throw new Error("buffer too short for minFreq");

  // Difference function, then cumulative mean normalized difference (d').
  const d = new Float32Array(tauMax + 2);
  d[0] = 1;
  let runningSum = 0;
  for (let tau = 1; tau <= tauMax + 1; tau++) {
    let sum = 0;
    for (let j = 0; j < w; j++) {
      const diff = buf[j] - buf[j + tau];
      sum += diff * diff;
    }
    runningSum += sum;
    d[tau] = runningSum === 0 ? 1 : (sum * tau) / runningSum;
  }

  // First dip below the threshold, followed down to its local minimum.
  let tau = -1;
  for (let t = tauMin; t <= tauMax; t++) {
    if (d[t] < threshold) {
      while (t + 1 <= tauMax && d[t + 1] < d[t]) t++;
      tau = t;
      break;
    }
  }
  if (tau === -1) return null;

  // Parabolic interpolation for sub-sample accuracy.
  const a = d[tau - 1];
  const b = d[tau];
  const c = d[tau + 1];
  const denom = a - 2 * b + c;
  const shift = denom === 0 ? 0 : (a - c) / (2 * denom);
  return sampleRate / (tau + shift);
}

/** Fractional MIDI number: 69 = A4. */
export function freqToMidi(freq: number, a4 = A4): number {
  return 69 + 12 * Math.log2(freq / a4);
}

export function midiToFreq(midi: number, a4 = A4): number {
  return a4 * 2 ** ((midi - 69) / 12);
}

/** Cents from `target` to `freq`; positive means sharp. */
export function centsOff(freq: number, target: number): number {
  return 1200 * Math.log2(freq / target);
}

/** Pitch class (0 = C) and octave of a MIDI number, scientific pitch notation. */
export function midiToNote(midi: number): { pc: number; octave: number } {
  return { pc: ((midi % 12) + 12) % 12, octave: Math.floor(midi / 12) - 1 };
}

/** Median of a non-empty list; used to steady the readout between frames. */
export function median(values: number[]): number {
  const s = [...values].sort((x, y) => x - y);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
