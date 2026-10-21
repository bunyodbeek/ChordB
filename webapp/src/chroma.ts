// Live chord recognition, pure part: a magnitude spectrum → 12 pitch-class energies
// (chroma) → cosine similarity with chord templates. The mic side is useChordListener.ts.
import { chordTones } from "./chords";
import type { Chord, Quality } from "./notation";

export const MIN_FREQ = 70; // below the low E (82 Hz) is rumble
export const MAX_FREQ = 1600; // fundamentals and low harmonics of open-position chords

/** Cosine similarity of the target that counts as "that chord" (with the checks below). */
export const MATCH_THRESHOLD = 0.75;
/** The target may trail the best other chord by this much and still count. */
export const MATCH_MARGIN = 0.02;
/** How long the match must hold before it is reported: one strum, not a passing chord. */
export const STABLE_MS = 300;

const mod12 = (n: number) => ((n % 12) + 12) % 12;

/**
 * Chroma from linear magnitudes (`mags[i]` is the bin at i·sampleRate/fftSize Hz).
 * `offsetCents`: how far the guitar sits from A440 (−100 = tuned a half step down), so a
 * down-tuned Am shape still reads as Am.
 */
export function chromaFromSpectrum(
  mags: ArrayLike<number>,
  sampleRate: number,
  fftSize: number,
  offsetCents = 0,
): number[] {
  const chroma = new Array<number>(12).fill(0);
  const binHz = sampleRate / fftSize;
  const first = Math.max(1, Math.ceil(MIN_FREQ / binHz));
  const last = Math.min(mags.length - 1, Math.floor(MAX_FREQ / binHz));
  for (let i = first; i <= last; i++) {
    const m = mags[i];
    if (!(m > 0)) continue;
    const midi = 69 + 12 * Math.log2((i * binHz) / 440) - offsetCents / 100;
    const nearest = Math.round(midi);
    // Bins between two semitones count less: a triangle over ±½ semitone.
    const w = 1 - 2 * Math.abs(midi - nearest);
    chroma[mod12(nearest)] += m * w;
  }
  const max = Math.max(...chroma);
  return max > 0 ? chroma.map((c) => c / max) : chroma;
}

/** dB values from AnalyserNode.getFloatFrequencyData → linear magnitudes, in place. */
export function dbToLinear(db: Float32Array): Float32Array {
  for (let i = 0; i < db.length; i++) db[i] = db[i] === -Infinity ? 0 : 10 ** (db[i] / 20);
  return db;
}

export function chordTemplate(chord: Pick<Chord, "root" | "quality">): number[] {
  const t = new Array<number>(12).fill(0);
  for (const pc of chordTones({ ...chord, flat: false })) t[pc] = 1;
  return t;
}

export function cosine(a: readonly number[], b: readonly number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < 12; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

const TRIADS: Quality[] = ["maj", "min"];
const COMPETITORS = Array.from({ length: 12 }, (_, root) => TRIADS.map((quality) => ({ root, quality }))).flat();

export interface ChordMatch {
  confidence: number; // cosine similarity with the target, 0..1
  matched: boolean; // above the threshold and no other chord fits clearly better
}

/** Does this chroma sound like `target`? Every major and minor triad competes with it. */
export function matchChord(chroma: readonly number[], target: Pick<Chord, "root" | "quality">): ChordMatch {
  const confidence = cosine(chroma, chordTemplate(target));
  let rival = 0;
  for (const c of COMPETITORS) {
    if (c.root === mod12(target.root) && c.quality === target.quality) continue;
    rival = Math.max(rival, cosine(chroma, chordTemplate(c)));
  }
  return { confidence, matched: confidence >= MATCH_THRESHOLD && confidence + MATCH_MARGIN >= rival };
}

/** Reports a match only after it has held for `ms` without a break. */
export class Stability {
  private since: number | null = null;

  constructor(private readonly ms = STABLE_MS) {}

  update(matched: boolean, now: number): boolean {
    if (!matched) {
      this.since = null;
      return false;
    }
    this.since ??= now;
    return now - this.since >= this.ms;
  }

  reset(): void {
    this.since = null;
  }
}
