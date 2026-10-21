import { describe, expect, it } from "vitest";

import {
  INTERVALS,
  QUALITIES,
  chordTones,
  diagramLayout,
  soundedPcs,
  spelled,
  transpose,
  voicing,
} from "./chords";
import { formatChord, parseChord } from "./notation";

describe("transpose", () => {
  it("moves the root and respells", () => {
    expect(formatChord(transpose(parseChord("Am"), 2), "letter")).toBe("Bm");
    expect(formatChord(transpose(parseChord("G"), 3), "letter")).toBe("Bb");
    expect(formatChord(transpose(parseChord("C"), -1), "letter")).toBe("B");
    expect(formatChord(transpose(parseChord("E7"), 2), "letter")).toBe("F#7");
    expect(formatChord(transpose(parseChord("D"), 1), "solfege")).toBe("Mi bemol major");
  });

  it("spells API chords the guitar way", () => {
    expect(formatChord(spelled({ root: 10, quality: "maj" }), "letter")).toBe("Bb");
    expect(formatChord(spelled({ root: 6, quality: "min" }), "letter")).toBe("F#m");
  });
});

const ALL = Array.from({ length: 12 }, (_, root) =>
  QUALITIES.map((quality) => ({ root, quality })),
).flat();

describe("voicings", () => {
  it.each(ALL.map((c) => [`${c.root}/${c.quality}`, c] as const))(
    "%s sounds only chord tones, with root and every tone but the 5th",
    (_name, chord) => {
      const { frets } = voicing(chord);
      expect(frets).toHaveLength(6);
      const sounded = new Set(soundedPcs(frets));
      const tones = chordTones(chord);
      for (const pc of sounded) expect(tones).toContain(pc);
      // The perfect fifth may be left out; everything else must be there.
      const required = tones.filter((_, i) => INTERVALS[chord.quality][i] !== 7);
      for (const pc of required) expect(sounded).toContain(pc);
      // Lowest sounded string plays the root, so the chord isn't an inversion.
      const lowest = frets.findIndex((f) => f >= 0);
      expect(soundedPcs(frets.map((f, i) => (i === lowest ? f : -1)))[0]).toBe(chord.root);
    },
  );

  it("stays playable: at most 4 frets apart, nothing above fret 12", () => {
    for (const chord of ALL) {
      const fretted = voicing(chord).frets.filter((f) => f > 0);
      expect(Math.max(...fretted) - Math.min(...fretted)).toBeLessThanOrEqual(3);
      expect(Math.max(...fretted)).toBeLessThanOrEqual(14);
    }
  });

  it("uses the familiar open shapes", () => {
    expect(voicing(parseChord("C")).frets).toEqual([-1, 3, 2, 0, 1, 0]);
    expect(voicing(parseChord("G")).frets).toEqual([3, 2, 0, 0, 0, 3]);
    expect(voicing(parseChord("Am")).frets).toEqual([-1, 0, 2, 2, 1, 0]);
  });

  it("barres F on the first fret and Bm on the second", () => {
    expect(voicing(parseChord("F"))).toEqual({
      frets: [1, 3, 3, 2, 1, 1],
      barre: { fret: 1, from: 0, to: 5 },
    });
    expect(voicing(parseChord("Bm"))).toEqual({
      frets: [-1, 2, 4, 4, 3, 2],
      barre: { fret: 2, from: 1, to: 5 },
    });
  });
});

describe("diagram layout (barre chords and enharmonics)", () => {
  const layout = (name: string) => diagramLayout(voicing(parseChord(name)).frets);

  it.each([
    // name, frets, base fret, barre
    ["Fm", [1, 3, 3, 1, 1, 1], 1, { row: 1, from: 0, to: 5 }],
    ["Bbm", [-1, 1, 3, 3, 2, 1], 1, { row: 1, from: 1, to: 5 }],
    ["Ab", [4, 6, 6, 5, 4, 4], 4, { row: 1, from: 0, to: 5 }],
    ["Eb", [-1, 6, 8, 8, 8, 6], 6, { row: 1, from: 1, to: 5 }],
    ["Bm", [-1, 2, 4, 4, 3, 2], 2, { row: 1, from: 1, to: 5 }],
    ["F#m", [2, 4, 4, 2, 2, 2], 2, { row: 1, from: 0, to: 5 }],
    ["C#m", [-1, 4, 6, 6, 5, 4], 4, { row: 1, from: 1, to: 5 }],
  ] as const)("%s", (name, frets, base, barre) => {
    expect(voicing(parseChord(name)).frets).toEqual(frets);
    const l = layout(name);
    expect(l.base).toBe(base);
    expect(l.barre).toEqual(barre);
    expect(l.marks).not.toContain("o"); // no open-string marks on a barre shape
    // Dots never sit under the barre, and the shape fits the 4 drawn rows.
    for (const d of l.dots) expect(d.row).toBeGreaterThan(1);
    expect(l.rows).toBe(4);
  });

  it("open shapes start at the nut and mark open strings", () => {
    const g = layout("G");
    expect(g.base).toBe(1);
    expect(g.barre).toBeNull();
    expect(g.marks).toEqual(["", "", "o", "o", "o", ""]);
    expect(layout("Am").marks).toEqual(["x", "o", "", "", "", "o"]);
  });

  it.each([
    ["Ab", "G#"],
    ["Eb", "D#"],
    ["Bb", "A#"],
    ["Db", "C#"],
    ["Gb", "F#"],
    ["Bbm", "A#m"],
  ])("%s and %s share a shape but keep their own name", (flat, sharp) => {
    expect(voicing(parseChord(flat))).toEqual(voicing(parseChord(sharp)));
    expect(formatChord(parseChord(flat), "letter")).toBe(flat);
    expect(formatChord(parseChord(sharp), "letter")).toBe(sharp);
  });
});
