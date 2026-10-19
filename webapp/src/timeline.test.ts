import { describe, expect, it } from "vitest";

import { activeIndex, beatOf, formatTime, groupBySection, sectionBounds } from "./timeline";

const ev = (time_sec: number, section_id: number | null = null) => ({ time_sec, section_id });
const EVENTS = [ev(0, 1), ev(4, 1), ev(8, 2), ev(12, 2), ev(16, 2)];
const SECTIONS = [
  { id: 1, title: "Kirish", start_sec: 0 },
  { id: 2, title: "Kuplet", start_sec: 8 },
];

describe("activeIndex", () => {
  it("finds the last event at or before t", () => {
    expect(activeIndex(EVENTS, 0)).toBe(0);
    expect(activeIndex(EVENTS, 3.99)).toBe(0);
    expect(activeIndex(EVENTS, 4)).toBe(1);
    expect(activeIndex(EVENTS, 15)).toBe(3);
    expect(activeIndex(EVENTS, 999)).toBe(4);
  });

  it("is -1 before the first chord and for an empty timeline", () => {
    expect(activeIndex([ev(2.5)], 1)).toBe(-1);
    expect(activeIndex([], 10)).toBe(-1);
  });

  it("agrees with a linear scan on a long timeline", () => {
    const many = Array.from({ length: 500 }, (_, i) => ev(i * 0.37));
    for (let t = -1; t < 200; t += 0.13) {
      let linear = -1;
      many.forEach((e, i) => {
        if (e.time_sec <= t) linear = i;
      });
      expect(activeIndex(many, t)).toBe(linear);
    }
  });
});

describe("beatOf", () => {
  it("splits each chord into 4 beats until the next chord", () => {
    expect(beatOf(EVENTS, 0, 0, 20)).toBe(0);
    expect(beatOf(EVENTS, 0, 1, 20)).toBe(1);
    expect(beatOf(EVENTS, 0, 2.5, 20)).toBe(2);
    expect(beatOf(EVENTS, 0, 3.99, 20)).toBe(3);
  });

  it("uses the song end for the last chord, and -1 without a chord", () => {
    expect(beatOf(EVENTS, 4, 19, 20)).toBe(3);
    expect(beatOf(EVENTS, -1, 0, 20)).toBe(-1);
  });
});

describe("sectionBounds", () => {
  it("returns the section around t", () => {
    expect(sectionBounds(SECTIONS, 3, 20)).toEqual({ start: 0, end: 8 });
    expect(sectionBounds(SECTIONS, 8, 20)).toEqual({ start: 8, end: 20 });
    expect(sectionBounds([], 5, 20)).toEqual({ start: 0, end: 20 });
  });
});

describe("groupBySection", () => {
  it("groups events under their sections, keeping global indexes", () => {
    const groups = groupBySection(SECTIONS, EVENTS);
    expect(groups.map((g) => g.title)).toEqual(["Kirish", "Kuplet"]);
    expect(groups[1].items.map((x) => x.index)).toEqual([2, 3, 4]);
  });

  it("puts everything in one untitled group without sections", () => {
    expect(groupBySection([], [ev(0), ev(1)])).toEqual([
      { title: null, items: [{ event: ev(0), index: 0 }, { event: ev(1), index: 1 }] },
    ]);
    expect(groupBySection([], [])).toEqual([]);
  });
});

it("formats times", () => {
  expect(formatTime(0)).toBe("0:00");
  expect(formatTime(75.9)).toBe("1:15");
  expect(formatTime(195)).toBe("3:15");
});
