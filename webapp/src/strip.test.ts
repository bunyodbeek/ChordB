import { describe, expect, it } from "vitest";

import { cardAt, litAt, stripLayout, timeAt, xAt } from "./strip";

const C = { root: 0, quality: "maj" };
// Bars of 2 s (beat 0.5 s); a gap with no chord after the third chord.
const EVENTS = [
  { time_sec: 1, chord: C },
  { time_sec: 3, chord: C },
  { time_sec: 5, chord: C },
  { time_sec: 6, chord: null },
  { time_sec: 7, chord: C },
];

describe("chord strip", () => {
  const cards = stripLayout(EVENTS, 8);

  it("makes a card per chord, as wide as its beats", () => {
    expect(cards.map((c) => [c.event, c.start, c.end, c.beats, c.x, c.width])).toEqual([
      [0, 1, 3, 4, 0, 120],
      [1, 3, 5, 4, 120, 120],
      [2, 5, 7, 4, 240, 120], // the gap is the chord ringing on
      [4, 7, 8, 2, 360, 104],
    ]);
  });

  it("maps time to position and back", () => {
    expect(xAt(cards, 0)).toBe(0);
    expect(xAt(cards, 2)).toBe(60);
    expect(xAt(cards, 7.5)).toBe(412);
    expect(xAt(cards, 99)).toBe(464);
    for (const t of [1, 2.25, 4, 6.5, 7.9]) expect(timeAt(cards, xAt(cards, t))).toBeCloseTo(t);
    expect(timeAt(cards, -50)).toBe(1);
    expect(timeAt(cards, 10_000)).toBe(8);
  });

  it("finds the card playing", () => {
    expect([0.5, 1, 4.9, 6.5, 7, 9].map((t) => cardAt(cards, t))).toEqual([-1, 0, 1, 2, 3, 3]);
  });

  it("copes with no chords and a single one", () => {
    expect(stripLayout([], 10)).toEqual([]);
    expect(xAt([], 3)).toBe(0);
    const one = stripLayout([{ time_sec: 0, chord: C }], 0);
    expect(one[0].beats).toBe(1);
  });

  it("lights the card, its beats, and the next one a beat early", () => {
    expect(litAt(cards, 0)).toEqual({ cur: -1, lit: 0, soon: false });
    expect(litAt(cards, 0.6)).toEqual({ cur: -1, lit: 0, soon: true });
    expect(litAt(cards, 1)).toEqual({ cur: 0, lit: 1, soon: false });
    expect(litAt(cards, 2.49)).toEqual({ cur: 0, lit: 3, soon: false });
    expect(litAt(cards, 2.5)).toEqual({ cur: 0, lit: 4, soon: true });
    expect(litAt(cards, 7.9)).toEqual({ cur: 3, lit: 2, soon: false });
    expect(litAt([], 1)).toEqual({ cur: -1, lit: 0, soon: false });
  });
});
