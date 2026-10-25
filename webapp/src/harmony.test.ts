import { describe, expect, it } from "vitest";

import {
  applyCapo,
  capoOptions,
  easiestCapo,
  keyFlats,
  keyOf,
  shapeScore,
  simplify,
  spell,
  transpose,
  transposeKey,
  type Key,
} from "./harmony";
import { voicings } from "./chords";
import { formatChord, parseChord } from "./notation";

const name = (symbol: string, semitones: number, key: Key | null = null) =>
  formatChord(spell(transpose(parseChord(symbol), semitones), key), "letter");
const key = (symbol: string): Key => keyOf(parseChord(symbol))!;
const chords = (symbols: string) => symbols.split(" ").map(parseChord);
const names = (cs: { root: number; quality: never }[] | ReturnType<typeof chords>, k: Key | null = null) =>
  cs.map((c) => formatChord(spell(c, k), "letter")).join(" ");

describe("transpose, capo, simplify", () => {
  it("moves the root by semitones, both ways and round the octave", () => {
    expect(name("Am", 2)).toBe("Bm");
    expect(name("G", 3)).toBe("Bb");
    expect(name("C", -1)).toBe("B");
    expect(name("E7", 2)).toBe("F#7");
    expect(name("B", 13)).toBe("C");
    expect(transpose({ root: 2, quality: "maj" }, -14)).toEqual({ root: 0, quality: "maj" });
  });

  it("plays a lower shape with a capo", () => {
    expect(names(chords("Fm Bbm Eb Ab").map((c) => applyCapo(c, 1)))).toBe("Em Am D G");
    expect(names(chords("A D E").map((c) => applyCapo(c, 0)))).toBe("A D E");
    expect(names([applyCapo(parseChord("C"), 3)])).toBe("A");
  });

  it("turns sevenths and suspended chords into plain major / minor", () => {
    expect(names(chords("G7 Cmaj7 Am7 Dsus2 Esus4 Am C Bdim Caug").map(simplify))).toBe(
      "G C Am D E Am C Bdim Caug",
    );
  });
});

describe("spelling by key", () => {
  it.each([
    ["G", false], ["D", false], ["A", false], ["E", false], ["B", false], ["F#", false],
    ["Em", false], ["C#m", false], ["F#m", false], ["G#m", false],
    ["F", true], ["Bb", true], ["Eb", true], ["Ab", true], ["Fm", true], ["Cm", true], ["Dm", true],
  ] as const)("%s: flats %s", (k, flats) => {
    expect(keyFlats(key(k))).toBe(flats);
  });

  it("leaves C and Am to the usual guitar spelling", () => {
    expect(keyFlats(key("C"))).toBeNull();
    expect(keyFlats(key("Am"))).toBeNull();
    expect(keyFlats(null)).toBeNull();
    expect(names(chords("Bb Eb F#"), key("C"))).toBe("Bb Eb F#");
  });

  it("names G# in C#m and Ab in Fm", () => {
    const gSharp = { root: 8, quality: "maj" as const };
    expect(names([gSharp], key("C#m"))).toBe("G#");
    expect(names([gSharp], key("Fm"))).toBe("Ab");
    expect(names(chords("C# F# D#m"), key("Eb"))).toBe("Db Gb Ebm");
    expect(names(chords("Db Gb"), key("E"))).toBe("C# F#");
  });

  it("names a transposed song in its new key", () => {
    // C#m (sharps) down a semitone is Cm (flats): G# becomes G, D#m becomes Dm, A becomes Ab.
    const k = transposeKey(key("C#m"), -1);
    expect(names(chords("C#m A E G#").map((c) => transpose(c, -1)), k)).toBe("Cm Ab Eb G");
    // F (flats) up two is G (sharps).
    expect(name("Bb", 2, transposeKey(key("F"), 2))).toBe("C");
    expect(name("A", 1, transposeKey(key("E"), 1))).toBe("Bb"); // E + 1 = F: flats
  });

  it("reads an analysis key, m7 included", () => {
    expect(keyOf({ root: 1, quality: "m7" })).toEqual({ root: 1, minor: true });
    expect(keyOf(null)).toBeNull();
  });
});

describe("the easiest capo", () => {
  it("scores open +2, barre −2, above the 7th fret −3 more", () => {
    expect(shapeScore(parseChord("Am"))).toBe(2);
    expect(shapeScore(parseChord("F"))).toBe(-2);
    expect(shapeScore(parseChord("Bbm"))).toBe(-2); // 1st-fret barre
    expect(shapeScore(parseChord("Ebm"))).toBe(-2); // A-shape at 6
    expect(shapeScore({ root: 3, quality: "sus2" })).toBe(-2); // Ebsus2: A-shape, 6th fret
    // A chosen higher variant: Am barred at the 12th, C at the 8th.
    expect(shapeScore(parseChord("Am"), voicings(parseChord("Am"))[2])).toBe(-5);
    expect(shapeScore(parseChord("C"), voicings(parseChord("C"))[2])).toBe(-5);
    expect(shapeScore(parseChord("C"), voicings(parseChord("C"))[1])).toBe(-2); // 3rd fret
  });

  it("scores the variants the player chose", () => {
    const high = (s: { root: number; quality: never }) => voicings(s).at(-1)!;
    const opts = capoOptions(chords("Am C"), 0, high as never);
    expect(opts[0].score).toBe(-10);
  });

  it("lists capo 0–7 with the shapes", () => {
    const opts = capoOptions(chords("Fm Bbm Eb Ab Fm"));
    expect(opts.map((o) => o.capo)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(names(opts[1].shapes as never)).toBe("Em Am D G"); // distinct, in order
    expect(opts[1].score).toBe(8);
    expect(easiestCapo(opts)).toBe(1);
  });

  it("keeps the lowest capo on a tie, and none without chords", () => {
    expect(easiestCapo(capoOptions(chords("Am C G Em")))).toBe(0);
    expect(easiestCapo(capoOptions([]))).toBeNull();
  });
});
