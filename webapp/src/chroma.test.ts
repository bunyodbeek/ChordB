import { describe, expect, it } from "vitest";

import { OPEN_MIDI, voicing } from "./chords";
import { Stability, chromaFromSpectrum, matchChord } from "./chroma";
import { parseChord } from "./notation";

const SR = 48000;
const FFT = 8192;
const BIN = SR / FFT;

/** The spectrum of a strummed voicing: every string with 6 harmonics (1/h loud). */
function strum(name: string, { cents = 0, noise = 0, seed = 1 } = {}): Float32Array {
  const mags = new Float32Array(FFT / 2);
  let s = seed;
  const rand = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  if (noise) for (let i = 0; i < mags.length; i++) mags[i] = rand() * noise;
  const { frets } = voicing(parseChord(name));
  frets.forEach((f, i) => {
    if (f < 0) return;
    const freq = 440 * 2 ** ((OPEN_MIDI[i] + f - 69 + cents / 100) / 12);
    for (let h = 1; h <= 6; h++) {
      const bin = (freq * h) / BIN;
      const lo = Math.floor(bin);
      if (lo + 1 >= mags.length) continue;
      // Leak into the two nearest bins, like a windowed FFT.
      mags[lo] += (1 / h) * (1 - (bin - lo));
      mags[lo + 1] += (1 / h) * (bin - lo);
    }
  });
  return mags;
}

const chromaOf = (mags: Float32Array, offset = 0) => chromaFromSpectrum(mags, SR, FFT, offset);
const matches = (played: string, target: string, opts = {}, offset = 0) =>
  matchChord(chromaOf(strum(played, opts), offset), parseChord(target)).matched;

describe("chord matching", () => {
  it.each(["Am", "C", "G", "F", "Em", "D", "E", "A", "Dm", "Bm", "F#m"])("%s is recognised", (c) => {
    expect(matches(c, c)).toBe(true);
  });

  it.each([
    ["Am", "C"],
    ["C", "Am"],
    ["G", "Em"],
    ["E", "Em"],
    ["Em", "E"],
    ["A", "Am"],
    ["D", "Bm"],
  ])("%s is not taken for %s", (played, target) => {
    expect(matches(played, target)).toBe(false);
  });

  it("a noisy room: the chord still wins over moderate noise", () => {
    expect(matches("G", "G", { noise: 0.05 })).toBe(true);
    expect(matches("Am", "Am", { noise: 0.05, seed: 7 })).toBe(true);
  });

  it("noise alone is no chord", () => {
    const noise = new Float32Array(FFT / 2);
    let s = 3;
    for (let i = 0; i < noise.length; i++) noise[i] = (s = (s * 16807) % 2147483647) / 2147483647;
    for (const target of ["Am", "C", "G", "F", "E"]) {
      expect(matchChord(chromaOf(noise), parseChord(target)).matched).toBe(false);
    }
  });

  it("silence is no chord", () => {
    expect(matchChord(chromaOf(new Float32Array(FFT / 2)), parseChord("Am"))).toEqual({
      confidence: 0,
      matched: false,
    });
  });

  it("the tuning offset maps a down-tuned guitar back to the shape played", () => {
    // An Am shape on a guitar tuned a half step down sounds as G#m.
    expect(matches("Am", "Am", { cents: -100 })).toBe(false);
    expect(matches("Am", "Am", { cents: -100 }, -100)).toBe(true);
    // A guitar 30 cents flat still reads right without any offset.
    expect(matches("C", "C", { cents: -30 })).toBe(true);
  });
});

describe("Stability", () => {
  it("needs the match to hold for 300 ms", () => {
    const s = new Stability(300);
    expect(s.update(true, 0)).toBe(false);
    expect(s.update(true, 250)).toBe(false);
    expect(s.update(true, 310)).toBe(true);
    expect(s.update(false, 350)).toBe(false);
    expect(s.update(true, 400)).toBe(false); // starts over after a break
    expect(s.update(true, 700)).toBe(true);
  });
});
