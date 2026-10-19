// Same cases as common/tests/test_notation.py.
import { describe, expect, it } from "vitest";

import { formatChord, formatNote, parseChord } from "./notation";

describe("chords", () => {
  it.each([
    ["Am", "Am", "Lya minor"],
    ["Em", "Em", "Mi minor"],
    ["C", "C", "Do major"],
    ["G7", "G7", "Sol 7"],
    ["Dm7", "Dm7", "Re minor 7"],
    ["Fmaj7", "Fmaj7", "Fa major 7"],
    ["F#m", "F#m", "Fa diyez minor"],
    ["Bb", "Bb", "Si bemol major"],
    ["Bdim", "Bdim", "Si dim"],
    ["Esus4", "Esus4", "Mi sus4"],
  ])("%s", (symbol, letter, solfege) => {
    const chord = parseChord(symbol);
    expect(formatChord(chord, "letter")).toBe(letter);
    expect(formatChord(chord, "solfege")).toBe(solfege);
  });

  it("is canonical", () => {
    expect(parseChord("Am")).toEqual({ root: 9, quality: "min", flat: false });
  });

  it("rejects bad symbols", () => {
    expect(() => parseChord("H7")).toThrow();
  });
});

describe("notes", () => {
  it("formats", () => {
    expect(formatNote({ pc: 4, octave: 2 }, "letter")).toBe("E2");
    expect(formatNote({ pc: 4, octave: 2 }, "solfege")).toBe("Mi 2");
    expect(formatNote({ pc: 9 }, "solfege")).toBe("Lya");
    expect(formatNote({ pc: 11 }, "solfege")).toBe("Si");
    expect(formatNote({ pc: 1 }, "letter")).toBe("C#");
    expect(formatNote({ pc: 1, flat: true }, "letter")).toBe("Db");
  });
});
