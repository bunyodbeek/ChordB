// Chord charts. Only public-domain / traditional songs, and chords only (no lyrics).
// Chords are written as letter symbols (parseChord) and rendered in the user's notation.
import { prefersFlat } from "./chords";
import { parseChord, type Chord } from "./notation";

export interface Section {
  name: string;
  // One entry per bar; two chords in a bar are separated by a space ("G D").
  bars: string[];
}

export interface Song {
  id: string;
  title: string;
  author: string;
  kind: "song" | "progression";
  key: string; // chord symbol of the key, e.g. "Am" or "G"
  meter: string;
  level: "easy" | "medium";
  sections: Section[];
}

export const SONGS: Song[] = [
  {
    id: "rising-sun",
    title: "House of the Rising Sun",
    author: "Anʼanaviy",
    kind: "song",
    key: "Am",
    meter: "6/8",
    level: "medium",
    sections: [
      {
        name: "Kuplet",
        bars: ["Am", "C", "D", "F", "Am", "C", "E", "E", "Am", "C", "D", "F", "Am", "E", "Am", "E"],
      },
    ],
  },
  {
    id: "greensleeves",
    title: "Greensleeves",
    author: "Anʼanaviy",
    kind: "song",
    key: "Am",
    meter: "3/4",
    level: "medium",
    sections: [
      {
        name: "Kuplet",
        bars: ["Am", "C", "G", "Em", "Am", "Dm", "E", "E", "Am", "C", "G", "Em", "Am", "E", "Am", "Am"],
      },
      {
        name: "Naqarot",
        bars: ["C", "C", "G", "Em", "Am", "Dm", "E", "E", "C", "C", "G", "Em", "Am", "E", "Am", "Am"],
      },
    ],
  },
  {
    id: "amazing-grace",
    title: "Amazing Grace",
    author: "Jon Nyuton, 1779",
    kind: "song",
    key: "G",
    meter: "3/4",
    level: "easy",
    sections: [
      {
        name: "Kuplet",
        bars: ["G", "G", "C", "G", "G", "G", "D", "D", "G", "G7", "C", "G", "G", "D", "G", "G"],
      },
    ],
  },
  {
    id: "oh-susanna",
    title: "Oh! Susanna",
    author: "Stiven Foster, 1848",
    kind: "song",
    key: "C",
    meter: "4/4",
    level: "easy",
    sections: [
      { name: "Kuplet", bars: ["C", "C", "C", "G7", "C", "C", "G7", "C"] },
      { name: "Naqarot", bars: ["F", "F", "C", "G7", "C", "C", "G7", "C"] },
    ],
  },
  {
    id: "jingle-bells",
    title: "Jingle Bells",
    author: "Jeyms Pirpont, 1857",
    kind: "song",
    key: "G",
    meter: "4/4",
    level: "easy",
    sections: [
      { name: "Naqarot", bars: ["G", "G", "G", "G", "C", "G", "A7", "D7", "G", "G", "G", "G", "C", "G", "D7", "G"] },
    ],
  },
  {
    id: "happy-birthday",
    title: "Happy Birthday",
    author: "Mildred va Petti Xill",
    kind: "song",
    key: "G",
    meter: "3/4",
    level: "easy",
    sections: [{ name: "Qoʻshiq", bars: ["G", "D", "D", "G", "G7", "C", "G D", "G"] }],
  },
  {
    id: "pop",
    title: "Pop progressiyasi (I–V–vi–IV)",
    author: "Minglab qoʻshiqlarda",
    kind: "progression",
    key: "C",
    meter: "4/4",
    level: "easy",
    sections: [{ name: "Aylanma", bars: ["C", "G", "Am", "F", "C", "G", "Am", "F"] }],
  },
  {
    id: "fifties",
    title: "50-lar progressiyasi (I–vi–IV–V)",
    author: "Doo-wop, rok-n-roll",
    kind: "progression",
    key: "G",
    meter: "4/4",
    level: "easy",
    sections: [{ name: "Aylanma", bars: ["G", "Em", "C", "D", "G", "Em", "C", "D"] }],
  },
  {
    id: "andalusian",
    title: "Andaluz kadensiyasi",
    author: "Flamenko, rok",
    kind: "progression",
    key: "Am",
    meter: "4/4",
    level: "easy",
    sections: [{ name: "Aylanma", bars: ["Am", "G", "F", "E", "Am", "G", "F", "E"] }],
  },
  {
    id: "blues",
    title: "12 taktli blyuz",
    author: "Blyuz, rok",
    kind: "progression",
    key: "A",
    meter: "4/4",
    level: "medium",
    sections: [
      {
        name: "Aylanma",
        bars: ["A7", "A7", "A7", "A7", "D7", "D7", "A7", "A7", "E7", "D7", "A7", "E7"],
      },
    ],
  },
];

/** Chord moved by `semitones`, spelled the usual guitar way for its new root. */
export function transpose(chord: Chord, semitones: number): Chord {
  const root = (((chord.root + semitones) % 12) + 12) % 12;
  return { ...chord, root, flat: prefersFlat(root) };
}

/** Every distinct chord of a song in order of first appearance, as symbols. */
export function chordsOf(song: Song): string[] {
  const seen = new Set<string>();
  for (const s of song.sections) {
    for (const bar of s.bars) for (const sym of bar.split(" ")) seen.add(sym);
  }
  return [...seen];
}

/** Parse a symbol and transpose it; songs are written so that parsing never fails. */
export function songChord(symbol: string, semitones: number): Chord {
  return transpose(parseChord(symbol), semitones);
}
