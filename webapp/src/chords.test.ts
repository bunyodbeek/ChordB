import { describe, expect, it } from "vitest";

import { INTERVALS, QUALITIES, chordTones, soundedPcs, voicing } from "./chords";
import { parseChord } from "./notation";

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
