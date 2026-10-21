// Chord theory and guitar voicings. Names are rendered by notation.ts.
import type { Chord, Quality } from "./notation";

export const QUALITIES: Quality[] = ["maj", "min", "7", "m7", "maj7", "sus2", "sus4", "dim", "aug"];

/** Semitones above the root. */
export const INTERVALS: Record<Quality, number[]> = {
  maj: [0, 4, 7],
  min: [0, 3, 7],
  "7": [0, 4, 7, 10],
  maj7: [0, 4, 7, 11],
  m7: [0, 3, 7, 10],
  dim: [0, 3, 6],
  aug: [0, 4, 8],
  sus2: [0, 2, 7],
  sus4: [0, 5, 7],
};

const mod12 = (n: number) => ((n % 12) + 12) % 12;

export function chordTones(chord: Chord): number[] {
  return INTERVALS[chord.quality].map((i) => mod12(chord.root + i));
}

/** Usual guitar spelling of a root: Eb, Ab, Bb with flats; C#, F# with sharps. */
export const prefersFlat = (pc: number) => [3, 8, 10].includes(mod12(pc));

/** A canonical chord (as the API sends it), spelled the usual guitar way. */
export function spelled(chord: { root: number; quality: Quality }): Chord {
  return { root: mod12(chord.root), quality: chord.quality, flat: prefersFlat(chord.root) };
}

/** Chord moved by `semitones`, spelled the usual guitar way for its new root. */
export function transpose(chord: Chord, semitones: number): Chord {
  return spelled({ ...chord, root: chord.root + semitones });
}

/** Open-string pitches as MIDI numbers, string 6 (low E) first. */
export const OPEN_MIDI = [40, 45, 50, 55, 59, 64];

// Frets per string, string 6 (low E) first; -1 = not played.
export type Frets = number[];

export interface Voicing {
  frets: Frets;
  barre: { fret: number; from: number; to: number } | null; // string indexes into frets
}

// Open shapes everyone learns first, keyed by letter symbol.
const OPEN: Record<string, Frets> = {
  C: [-1, 3, 2, 0, 1, 0],
  A: [-1, 0, 2, 2, 2, 0],
  G: [3, 2, 0, 0, 0, 3],
  E: [0, 2, 2, 1, 0, 0],
  D: [-1, -1, 0, 2, 3, 2],
  Am: [-1, 0, 2, 2, 1, 0],
  Em: [0, 2, 2, 0, 0, 0],
  Dm: [-1, -1, 0, 2, 3, 1],
  C7: [-1, 3, 2, 3, 1, 0],
  A7: [-1, 0, 2, 0, 2, 0],
  G7: [3, 2, 0, 0, 0, 1],
  E7: [0, 2, 0, 1, 0, 0],
  D7: [-1, -1, 0, 2, 1, 2],
  B7: [-1, 2, 1, 2, 0, 2],
  Am7: [-1, 0, 2, 0, 1, 0],
  Em7: [0, 2, 0, 0, 0, 0],
  Dm7: [-1, -1, 0, 2, 1, 1],
  Cmaj7: [-1, 3, 2, 0, 0, 0],
  Fmaj7: [-1, -1, 3, 2, 1, 0],
  Amaj7: [-1, 0, 2, 1, 2, 0],
  Dmaj7: [-1, -1, 0, 2, 2, 2],
  Emaj7: [0, 2, 1, 1, 0, 0],
  Gmaj7: [3, 2, 0, 0, 0, 2],
  Asus2: [-1, 0, 2, 2, 0, 0],
  Dsus2: [-1, -1, 0, 2, 3, 0],
  Asus4: [-1, 0, 2, 2, 3, 0],
  Dsus4: [-1, -1, 0, 2, 3, 3],
  Esus4: [0, 2, 2, 2, 0, 0],
};

// Movable shapes, relative to the barre fret: E-shape has its root on string 6,
// A-shape on string 5. Fret 0 of the template = the barre.
const E_SHAPE: Record<Quality, Frets> = {
  maj: [0, 2, 2, 1, 0, 0],
  min: [0, 2, 2, 0, 0, 0],
  "7": [0, 2, 0, 1, 0, 0],
  m7: [0, 2, 0, 0, 0, 0],
  maj7: [0, 2, 1, 1, 0, 0],
  sus2: [0, 2, 2, -1, 0, 2],
  sus4: [0, 2, 2, 2, 0, 0],
  dim: [0, 1, 2, 0, -1, -1],
  aug: [0, 3, 2, 1, 1, 0],
};
const A_SHAPE: Record<Quality, Frets> = {
  maj: [-1, 0, 2, 2, 2, 0],
  min: [-1, 0, 2, 2, 1, 0],
  "7": [-1, 0, 2, 0, 2, 0],
  m7: [-1, 0, 2, 0, 1, 0],
  maj7: [-1, 0, 2, 1, 2, 0],
  sus2: [-1, 0, 2, 2, 0, 0],
  sus4: [-1, 0, 2, 2, 3, 0],
  dim: [-1, 0, 1, 2, 1, -1],
  aug: [-1, 0, 3, 2, 2, 1],
};

const LETTER_PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

function openKey(chord: Chord): string | null {
  const suffix = { maj: "", min: "m" }[chord.quality as "maj" | "min"] ?? chord.quality;
  for (const [letter, pc] of Object.entries(LETTER_PC)) {
    if (pc === chord.root) return letter + suffix;
  }
  return null;
}

function shift(template: Frets, fret: number): Voicing {
  const frets = template.map((f) => (f < 0 ? -1 : f + fret));
  if (fret === 0) return { frets, barre: null };
  const at = frets.flatMap((f, i) => (f === fret ? [i] : []));
  return { frets, barre: at.length >= 2 ? { fret, from: at[0], to: at[at.length - 1] } : null };
}

/** An easy voicing: the open shape if there is one, else the lowest barre shape. */
export function voicing(chord: Chord): Voicing {
  const key = openKey(chord);
  if (key && OPEN[key]) return { frets: OPEN[key], barre: null };
  const eFret = mod12(chord.root - 4); // E-shape root on low E
  const aFret = mod12(chord.root - 9); // A-shape root on A
  // Ties go to the E-shape; both open (fret 0) cases are covered above or fine as-is.
  return eFret <= aFret
    ? shift(E_SHAPE[chord.quality], eFret)
    : shift(A_SHAPE[chord.quality], aFret);
}

/** Pitch classes actually sounded by a voicing. */
export function soundedPcs(frets: Frets): number[] {
  return frets.flatMap((f, i) => (f < 0 ? [] : [mod12(OPEN_MIDI[i] + f)]));
}

export interface DiagramLayout {
  base: number; // fret shown in the top row; 1 = the nut is drawn, else "N-lad" under the grid
  rows: number; // fret rows drawn (at least 4)
  marks: ("x" | "o" | "")[]; // above each string: muted, open, or nothing
  barre: { row: number; from: number; to: number } | null; // row 1 = the top row
  dots: { string: number; row: number }[]; // fretted notes not under the barre
}

/**
 * How a chord box draws `frets` (the song-player-v2 / game design rules): start at the
 * nut unless the shape sits higher up, a barre bar across every string held at the
 * lowest fret, and no open-string marks on barre shapes (they have none).
 */
export function diagramLayout(frets: Frets): DiagramLayout {
  const fretted = frets.filter((f) => f > 0);
  const min = fretted.length ? Math.min(...fretted) : 0;
  const max = fretted.length ? Math.max(...fretted) : 0;
  const hasOpen = frets.includes(0);
  const base = max > 4 || (min > 1 && !hasOpen) ? min : 1;
  const atMin = frets.flatMap((f, i) => (f === min ? [i] : []));
  const isBarre = min > 0 && !hasOpen && atMin.length >= 2;
  const row = (f: number) => f - base + 1;
  return {
    base,
    rows: Math.max(4, max ? row(max) : 0),
    marks: frets.map((f) => (f < 0 ? "x" : f === 0 ? "o" : "")),
    barre: isBarre ? { row: row(min), from: atMin[0], to: atMin[atMin.length - 1] } : null,
    dots: frets.flatMap((f, i) =>
      f > 0 && !(isBarre && f === min) ? [{ string: i, row: row(f) }] : [],
    ),
  };
}

/** The open shapes a beginner already knows: no barre, nothing above the 4th fret. */
export function isEasyShape(chord: Chord): boolean {
  const key = openKey(chord);
  return key !== null && key in OPEN;
}

/**
 * Finger numbers (1 = index … 4 = pinky) per string, null where no finger presses.
 * A barre takes finger 1; the other notes get the next fingers, lower frets first and,
 * on the same fret, the lower string first. That reproduces the usual fingerings of the
 * open and barre shapes (Am: 2 3 1, G: 2 1 3, F: 1 3 4 2 1 1).
 */
export function fingering(frets: Frets): (number | null)[] {
  const l = diagramLayout(frets);
  const out: (number | null)[] = frets.map(() => null);
  let next = 1;
  if (l.barre) {
    for (let i = l.barre.from; i <= l.barre.to; i++) if (frets[i] === l.barre.row + l.base - 1) out[i] = 1;
    next = 2;
  }
  const rest = frets
    .map((f, i) => ({ f, i }))
    .filter(({ f, i }) => f > 0 && out[i] === null)
    .sort((a, b) => a.f - b.f || a.i - b.i);
  for (const { i } of rest) out[i] = Math.min(4, next++);
  return out;
}
