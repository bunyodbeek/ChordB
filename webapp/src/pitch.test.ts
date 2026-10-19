import { describe, expect, it } from "vitest";

import { centsOff, detectPitch, freqToMidi, median, midiToNote } from "./pitch";
import { STANDARD, nearestString } from "./tuning";

const SR = 48000;
const N = 4096; // the AnalyserNode fftSize used by the tuner

/** A plucked-string-like tone: a few decaying harmonics, optional noise. */
function tone(freq: number, { sr = SR, noise = 0, harmonics = [1, 0.6, 0.4, 0.25] } = {}) {
  const buf = new Float32Array(N);
  let seed = 1;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  for (let i = 0; i < N; i++) {
    let v = 0;
    harmonics.forEach((amp, h) => {
      v += amp * Math.sin((2 * Math.PI * freq * (h + 1) * i) / sr);
    });
    buf[i] = 0.3 * v + noise * rand();
  }
  return buf;
}

describe("detectPitch", () => {
  it.each(STANDARD.map((s) => [s.number, s.freq] as const))(
    "finds string %i (%f Hz) within 1 cent",
    (_n, freq) => {
      const got = detectPitch(tone(freq), SR);
      expect(got).not.toBeNull();
      expect(Math.abs(centsOff(got!, freq))).toBeLessThan(1);
    },
  );

  it("works at 44.1 kHz", () => {
    const got = detectPitch(tone(110, { sr: 44100 }), 44100);
    expect(Math.abs(centsOff(got!, 110))).toBeLessThan(1);
  });

  it("is not fooled into an octave by a strong 2nd harmonic", () => {
    const got = detectPitch(tone(82.41, { harmonics: [0.5, 1, 0.5] }), SR);
    expect(Math.abs(centsOff(got!, 82.41))).toBeLessThan(1);
  });

  it("tolerates some noise", () => {
    const got = detectPitch(tone(196, { noise: 0.05 }), SR);
    expect(Math.abs(centsOff(got!, 196))).toBeLessThan(3);
  });

  it("detects a slightly flat string", () => {
    const flat = 110 * 2 ** (-20 / 1200); // A2, 20 cents flat
    const got = detectPitch(tone(flat), SR)!;
    expect(centsOff(got, 110)).toBeCloseTo(-20, 0);
  });

  it("returns null for silence and for noise", () => {
    expect(detectPitch(new Float32Array(N), SR)).toBeNull();
    expect(detectPitch(tone(0, { harmonics: [], noise: 0.3 }), SR)).toBeNull();
  });
});

describe("note math", () => {
  it("maps frequencies to notes", () => {
    expect(freqToMidi(440)).toBeCloseTo(69);
    expect(midiToNote(40)).toEqual({ pc: 4, octave: 2 }); // E2
    expect(midiToNote(64)).toEqual({ pc: 4, octave: 4 }); // E4
    expect(midiToNote(60)).toEqual({ pc: 0, octave: 4 }); // C4
  });

  it("picks the nearest string", () => {
    expect(nearestString(84).number).toBe(6);
    expect(nearestString(105).number).toBe(5);
    expect(nearestString(250).number).toBe(2);
    expect(nearestString(330).number).toBe(1);
  });

  it("medians", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });
});
