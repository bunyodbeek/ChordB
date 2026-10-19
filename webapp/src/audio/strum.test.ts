import { describe, expect, it } from "vitest";

import { buildStrum } from "./strum";

const C = [-1, 3, 2, 0, 1, 0]; // x32010
const fixed = (v: number) => () => v;

describe("buildStrum", () => {
  it("uses the real fingering and skips muted strings", () => {
    const notes = buildStrum(C, { rand: fixed(0.5) });
    expect(notes.map((n) => n.midi)).toEqual([48, 52, 55, 60, 64]); // C3 E3 G3 C4 E4
    expect(notes.map((n) => n.string)).toEqual([5, 4, 3, 2, 1]);
    expect(notes.map((n) => n.fret)).toEqual([3, 2, 0, 1, 0]);
  });

  it("strums low to high 25 ms apart, without jitter at the midpoint", () => {
    const offsets = buildStrum(C, { rand: fixed(0.5) }).map((n) => n.offset);
    offsets.forEach((o, k) => expect(o).toBeCloseTo(k * 0.025, 6));
  });

  it("up-strum goes high to low", () => {
    const notes = buildStrum(C, { direction: "up", rand: fixed(0.5) });
    expect(notes.map((n) => n.string)).toEqual([1, 2, 3, 4, 5]);
    expect(notes[0].offset).toBe(0);
  });

  it("keeps humanised timing within ±5 ms and velocity within 65..90", () => {
    for (let trial = 0; trial < 200; trial++) {
      const notes = buildStrum([0, 2, 2, 1, 0, 0]);
      notes.forEach((n, k) => {
        if (k > 0) expect(Math.abs(n.offset - k * 0.025)).toBeLessThanOrEqual(0.005 + 1e-9);
        expect(n.velocity).toBeGreaterThanOrEqual(65);
        expect(n.velocity).toBeLessThanOrEqual(90);
      });
      // Strings never sound out of order.
      for (let k = 1; k < notes.length; k++) {
        expect(notes[k].offset).toBeGreaterThan(notes[k - 1].offset);
      }
    }
  });

  it("varies between strums", () => {
    const a = buildStrum(C).map((n) => n.velocity).join();
    const b = Array.from({ length: 20 }, () => buildStrum(C).map((n) => n.velocity).join());
    expect(b.some((x) => x !== a)).toBe(true);
  });
});
