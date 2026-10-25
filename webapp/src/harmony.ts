// The player's chord arithmetic, in one place: transpose, capo, simplify, the key's
// spelling (C# or Db) and the easiest capo. Pure: no React.
import { prefersFlat, voicing, type Voicing } from "./chords";
import type { Chord, Quality } from "./notation";

export interface PitchChord {
  root: number; // pitch class, 0 = C
  quality: Quality;
}

/** A song's key: tonic pitch class, major or minor. */
export interface Key {
  root: number;
  minor: boolean;
}

const mod12 = (n: number) => ((n % 12) + 12) % 12;

/** The chord `semitones` higher (or lower, when negative). */
export function transpose<C extends PitchChord>(chord: C, semitones: number): C {
  return { ...chord, root: mod12(chord.root + semitones) };
}

/** The shape to play with a capo on fret `capo`: the chord that many semitones lower. */
export const applyCapo = <C extends PitchChord>(chord: C, capo: number): C => transpose(chord, -capo);

const SIMPLE: Partial<Record<Quality, Quality>> = {
  "7": "maj",
  maj7: "maj",
  m7: "min",
  sus2: "maj",
  sus4: "maj",
};

/** "Oddiy akkordlar": sevenths and suspended chords as plain major or minor. */
export function simplify<C extends PitchChord>(chord: C): C {
  const q = SIMPLE[chord.quality];
  return q ? { ...chord, quality: q } : chord;
}

export const transposeKey = (key: Key, semitones: number): Key => ({
  root: mod12(key.root + semitones),
  minor: key.minor,
});

// Major keys written with flats: F Bb Eb Ab Db (and their relative minors).
const FLAT_MAJORS = new Set([5, 10, 3, 8, 1]);

/**
 * Whether a key writes its black keys as flats: true in F, Bb, Eb, Ab, Db (Dm, Gm, Cm,
 * Fm, Bbm); false in G, D, A, E, B, F# (Em, Bm, F#m, C#m, G#m, D#m); null in C major
 * and A minor, which have neither: each root then gets its usual guitar spelling.
 */
export function keyFlats(key: Key | null): boolean | null {
  if (!key) return null;
  const major = mod12(key.root + (key.minor ? 3 : 0));
  if (major === 0) return null;
  return FLAT_MAJORS.has(major);
}

/** The chord named the way `key` writes it: G# in C#m, Ab in Fm. */
export function spell(chord: PitchChord, key: Key | null): Chord {
  const root = mod12(chord.root);
  const flats = keyFlats(key);
  return { root, quality: chord.quality, flat: flats ?? prefersFlat(root) };
}

/** A key from the API's chord form (an analysis may say m7 for a minor key). */
export function keyOf(chord: PitchChord | null): Key | null {
  return chord ? { root: mod12(chord.root), minor: chord.quality === "min" || chord.quality === "m7" } : null;
}

// --- the easiest capo -----------------------------------------------------------------

export const MAX_CAPO_SHOWN = 7;
const HIGH_FRET = 7;

/**
 * One shape's points as played (`v`: the chosen variant, else the easiest): open +2,
 * barre −2, above the 7th fret −3. The easiest variant never sits above the 7th fret
 * (an E- or A-shape is always lower), so the last only counts for a chosen higher one.
 */
export function shapeScore(shape: PitchChord, v: Voicing = voicing({ root: mod12(shape.root), quality: shape.quality })): number {
  const fretted = v.frets.filter((f) => f > 0);
  const lowest = fretted.length ? Math.min(...fretted) : 0;
  if (v.frets.includes(0) && lowest <= 4 && !v.barre) return 2;
  return (v.barre ? -2 : 0) + (lowest > HIGH_FRET ? -3 : 0);
}

export interface CapoOption {
  capo: number;
  shapes: PitchChord[]; // the song's distinct chords as played with this capo
  score: number;
}

/** Distinct chords, in order of first appearance. */
export function distinctChords<C extends PitchChord>(chords: readonly C[]): C[] {
  const seen = new Set<string>();
  return chords.filter((c) => {
    const k = `${mod12(c.root)}:${c.quality}`;
    return seen.has(k) ? false : (seen.add(k), true);
  });
}

/**
 * Every capo from 0 to `max`, with the shapes it gives and their points. `played`
 * picks the variant a shape is played with (the player's choice), the easiest by default.
 */
export function capoOptions(
  sounding: readonly PitchChord[],
  max = MAX_CAPO_SHOWN,
  played?: (shape: PitchChord) => Voicing,
): CapoOption[] {
  const unique = distinctChords(sounding);
  return Array.from({ length: max + 1 }, (_, capo) => {
    const shapes = unique.map((c) => applyCapo(c, capo));
    return { capo, shapes, score: shapes.reduce((sum, s) => sum + shapeScore(s, played?.(s)), 0) };
  });
}

/** The capo with the most points ("Eng oson"); the lowest one on a tie; null with no chords. */
export function easiestCapo(options: readonly CapoOption[]): number | null {
  if (!options.length || !options[0].shapes.length) return null;
  return options.reduce((best, o) => (o.score > best.score ? o : best)).capo;
}
