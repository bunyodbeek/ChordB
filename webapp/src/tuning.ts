import { noteName, type NotationKind } from "./notation";
import { centsOff, midiToFreq, midiToNote } from "./pitch";

export interface GuitarString {
  number: number; // 6 = low E … 1 = high E
  midi: number;
  freq: number;
  pc: number;
  octave: number;
}

export type PresetId = "standard" | "half_down" | "whole_down" | "drop_d";

export interface TuningPreset {
  id: PresetId;
  strings: GuitarString[]; // low string first
  flat: boolean; // spell its notes with flats (Eb Ab Db …)
}

function strings(midis: number[]): GuitarString[] {
  return midis.map((midi, i) => ({ number: 6 - i, midi, freq: midiToFreq(midi), ...midiToNote(midi) }));
}

export const PRESETS: TuningPreset[] = [
  { id: "standard", strings: strings([40, 45, 50, 55, 59, 64]), flat: false }, // E A D G B E
  { id: "half_down", strings: strings([39, 44, 49, 54, 58, 63]), flat: true }, // Eb Ab Db Gb Bb Eb
  { id: "whole_down", strings: strings([38, 43, 48, 53, 57, 62]), flat: false }, // D G C F A D
  { id: "drop_d", strings: strings([38, 45, 50, 55, 59, 64]), flat: false }, // D A D G B E
];

// Standard tuning E2 A2 D3 G3 B3 E4, low string first.
export const STANDARD: GuitarString[] = PRESETS[0].strings;

export const presetById = (id: PresetId) => PRESETS.find((p) => p.id === id) ?? PRESETS[0];

/** Preset for an analysis's alt_tuning shift (semitones below standard). */
export function presetForShift(shift: number): PresetId | null {
  return shift === -1 ? "half_down" : shift === -2 ? "whole_down" : null;
}

const STORAGE_KEY = "chordb.tuning";

/** The preset chosen last time on this device (standard when unknown). */
export function loadPreset(): PresetId {
  try {
    const id = localStorage.getItem(STORAGE_KEY);
    if (PRESETS.some((p) => p.id === id)) return id as PresetId;
  } catch {
    // storage blocked (private mode, some WebViews): fall back to standard
  }
  return "standard";
}

export function savePreset(id: PresetId): void {
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // not remembered this time; the tuner still works
  }
}

/** A string's note, compact enough for the tuner: "Eb", "Mi♭", "F#", "Fa♯". */
export function stringName(pc: number, notation: NotationKind, flat = false): string {
  return noteName(pc, notation, flat).replace(" bemol", "♭").replace(" diyez", "♯");
}

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
