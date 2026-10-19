// Mirrors common/chordb_common/notation.py: keep the tables in sync.
// Notes are a pitch class (0 = C … 11 = B) plus an optional octave; chords are
// root pitch class + quality. Shown as letter ("Am") or solfège ("Lya minor").

export type NotationKind = "letter" | "solfege";

export type Quality = "maj" | "min" | "7" | "maj7" | "m7" | "dim" | "aug" | "sus2" | "sus4";

export interface Note {
  pc: number;
  octave?: number | null;
  flat?: boolean; // spell accidentals as flats (Bb) instead of sharps (A#)
}

export interface Chord {
  root: number;
  quality: Quality;
  flat?: boolean;
}

// Natural notes by pitch class.
const LETTER: Record<number, string> = { 0: "C", 2: "D", 4: "E", 5: "F", 7: "G", 9: "A", 11: "B" };
const SOLFEGE: Record<number, string> = {
  0: "Do",
  2: "Re",
  4: "Mi",
  5: "Fa",
  7: "Sol",
  9: "Lya",
  11: "Si",
};

const LETTER_SUFFIX: Record<Quality, string> = {
  maj: "",
  min: "m",
  "7": "7",
  maj7: "maj7",
  m7: "m7",
  dim: "dim",
  aug: "aug",
  sus2: "sus2",
  sus4: "sus4",
};
const SOLFEGE_SUFFIX: Record<Quality, string> = {
  maj: "major",
  min: "minor",
  "7": "7",
  maj7: "major 7",
  m7: "minor 7",
  dim: "dim",
  aug: "aug",
  sus2: "sus2",
  sus4: "sus4",
};

const mod12 = (n: number) => ((n % 12) + 12) % 12;

export function noteName(pc: number, notation: NotationKind, flat = false): string {
  pc = mod12(pc);
  const names = notation === "letter" ? LETTER : SOLFEGE;
  if (pc in names) return names[pc];
  if (notation === "letter") {
    return flat ? names[mod12(pc + 1)] + "b" : names[pc - 1] + "#";
  }
  return flat ? names[mod12(pc + 1)] + " bemol" : names[pc - 1] + " diyez";
}

export function formatNote(note: Note, notation: NotationKind): string {
  const name = noteName(note.pc, notation, note.flat);
  if (note.octave == null) return name;
  const sep = notation === "letter" ? "" : " ";
  return `${name}${sep}${note.octave}`;
}

export function formatChord(chord: Chord, notation: NotationKind): string {
  const root = noteName(chord.root, notation, chord.flat);
  if (notation === "letter") return root + LETTER_SUFFIX[chord.quality];
  return `${root} ${SOLFEGE_SUFFIX[chord.quality]}`;
}

const CHORD_RE = /^([A-G])([#b]?)(.*)$/;
const SUFFIX_TO_QUALITY = Object.fromEntries(
  Object.entries(LETTER_SUFFIX).map(([q, s]) => [s, q as Quality]),
) as Record<string, Quality>;
const LETTER_TO_PC = Object.fromEntries(
  Object.entries(LETTER).map(([pc, l]) => [l, Number(pc)]),
) as Record<string, number>;

/** Parse a letter chord symbol such as "Am", "G7", "Bbmaj7", "F#m". */
export function parseChord(symbol: string): Chord {
  const m = CHORD_RE.exec(symbol.trim());
  if (!m || !(m[3] in SUFFIX_TO_QUALITY)) throw new Error(`Unknown chord symbol: ${symbol}`);
  const [, letter, accidental, suffix] = m;
  const offset = { "": 0, "#": 1, b: -1 }[accidental as "" | "#" | "b"];
  return {
    root: mod12(LETTER_TO_PC[letter] + offset),
    quality: SUFFIX_TO_QUALITY[suffix],
    flat: accidental === "b",
  };
}
