import { centsOff, midiToFreq, midiToNote } from "./pitch";

export interface GuitarString {
  number: number; // 6 = low E … 1 = high E
  midi: number;
  freq: number;
  pc: number;
  octave: number;
}

// Standard tuning E2 A2 D3 G3 B3 E4, low string first.
export const STANDARD: GuitarString[] = [40, 45, 50, 55, 59, 64].map((midi, i) => ({
  number: 6 - i,
  midi,
  freq: midiToFreq(midi),
  ...midiToNote(midi),
}));

/** Cents within which a string counts as in tune. */
export const IN_TUNE_CENTS = 5;

/** The string whose target pitch is closest to `freq` (by cents, not Hz). */
export function nearestString(freq: number, strings = STANDARD): GuitarString {
  let best = strings[0];
  for (const s of strings) {
    if (Math.abs(centsOff(freq, s.freq)) < Math.abs(centsOff(freq, best.freq))) best = s;
  }
  return best;
}
