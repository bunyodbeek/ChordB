import { describe, expect, it } from "vitest";

import { chordTones, soundedPcs, voicing } from "./chords";
import { formatChord, parseChord } from "./notation";
import { SONGS, chordsOf, songChord, transpose } from "./songs";

describe("songs", () => {
  it("have unique ids and at least one bar", () => {
    expect(new Set(SONGS.map((s) => s.id)).size).toBe(SONGS.length);
    for (const s of SONGS) expect(s.sections.flatMap((x) => x.bars).length).toBeGreaterThan(0);
  });

  it.each(SONGS.map((s) => [s.id, s] as const))("%s: every chord parses and is playable", (_id, s) => {
    parseChord(s.key);
    for (const sym of chordsOf(s)) {
      for (let shift = -6; shift <= 6; shift++) {
        const chord = songChord(sym, shift);
        const sounded = soundedPcs(voicing(chord).frets);
        expect(sounded.every((pc) => chordTones(chord).includes(pc))).toBe(true);
      }
    }
  });

  it("lists distinct chords in order", () => {
    const rising = SONGS.find((s) => s.id === "rising-sun")!;
    expect(chordsOf(rising)).toEqual(["Am", "C", "D", "F", "E"]);
    const birthday = SONGS.find((s) => s.id === "happy-birthday")!;
    expect(chordsOf(birthday)).toEqual(["G", "D", "G7", "C"]);
  });
});

describe("transpose", () => {
  it("moves the root and respells", () => {
    expect(formatChord(transpose(parseChord("Am"), 2), "letter")).toBe("Bm");
    expect(formatChord(transpose(parseChord("G"), 3), "letter")).toBe("Bb");
    expect(formatChord(transpose(parseChord("C"), -1), "letter")).toBe("B");
    expect(formatChord(transpose(parseChord("E7"), 2), "letter")).toBe("F#7");
    expect(formatChord(transpose(parseChord("D"), 1), "solfege")).toBe("Mi bemol major");
  });
});
