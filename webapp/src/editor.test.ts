import { describe, expect, it } from "vitest";

import type { ChordJson } from "./api";
import { formatChord } from "./notation";
import { spelled } from "./chords";
import {
  addEvent,
  addSection,
  diatonic,
  formatClock,
  palette,
  parseDuration,
  parseYouTubeId,
  timelineProblem,
} from "./editor";

const AM = { root: 9, quality: "min" as const };
const C = { root: 0, quality: "maj" as const };
const G = { root: 7, quality: "maj" as const };
const names = (cs: ChordJson[]) =>
  cs.map((c) => formatChord(spelled(c), "letter")).join(" ");

describe("addEvent", () => {
  it("keeps time order when marking out of order", () => {
    let ev = addEvent([], { time_sec: 5, ...C });
    ev = addEvent(ev, { time_sec: 1, ...AM });
    ev = addEvent(ev, { time_sec: 3, ...G });
    expect(ev.map((e) => e.time_sec)).toEqual([1, 3, 5]);
  });

  it("rounds to 1/100 s, clamps at 0 and replaces a mark at the same time", () => {
    let ev = addEvent([], { time_sec: 2.0049, ...C });
    ev = addEvent(ev, { time_sec: 2.001, ...G });
    expect(ev).toEqual([{ time_sec: 2, ...G }]);
    expect(addEvent([], { time_sec: -0.15, ...AM })[0].time_sec).toBe(0);
  });

  it("does the same for sections", () => {
    const s = addSection([{ title: "Kuplet", start_sec: 10 }], { title: "Kirish", start_sec: 0 });
    expect(s.map((x) => x.title)).toEqual(["Kirish", "Kuplet"]);
  });
});

describe("palette", () => {
  it("offers the key's common chords", () => {
    expect(names(diatonic(AM))).toBe("Am F C G Em Dm E"); // as in the design spec
    expect(names(diatonic(C))).toBe("C G Am F Dm Em G7");
  });

  it("puts timeline chords first, then key chords, then added ones, without repeats", () => {
    const p = palette(AM, [G, AM, G], [{ root: 2, quality: "maj" }, AM]);
    expect(names(p)).toBe("G Am F C Em Dm E D");
  });
});

describe("timelineProblem", () => {
  const ev = [{ time_sec: 0, ...AM }, { time_sec: 5, ...C }];
  it("finds what the server would reject", () => {
    expect(timelineProblem([], [], 60)).toBe("empty");
    expect(timelineProblem(ev, [{ title: "Kuplet", start_sec: 2 }], 60)).toBe("beforeSection");
    expect(timelineProblem(ev, [], 4)).toBe("tooLate");
    expect(timelineProblem(ev, [{ title: "Kirish", start_sec: 0 }], 60)).toBeNull();
  });
});

describe("parseYouTubeId", () => {
  it.each([
    ["https://youtu.be/P0D3YLBNfys?si=B7S6zwmjfAEiRTDB", "P0D3YLBNfys"],
    ["https://www.youtube.com/watch?v=4tRINzo1Dq0&t=10s", "4tRINzo1Dq0"],
    ["youtube.com/watch?v=u2JeJrNmxjU", "u2JeJrNmxjU"],
    ["https://m.youtube.com/shorts/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://www.youtube.com/embed/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["dQw4w9WgXcQ", "dQw4w9WgXcQ"],
  ])("%s", (input, id) => expect(parseYouTubeId(input)).toBe(id));

  it.each(["", "hello", "https://vimeo.com/123456789", "https://youtu.be/short"])(
    "rejects %j",
    (input) => expect(parseYouTubeId(input)).toBeNull(),
  );
});

it("parses and formats times", () => {
  expect(parseDuration("3:12")).toBe(192);
  expect(parseDuration("80")).toBe(80);
  expect(parseDuration("3:75")).toBeNull();
  expect(parseDuration("abc")).toBeNull();
  expect(formatClock(13.4)).toBe("0:13.4");
  expect(formatClock(0)).toBe("0:00.0");
  expect(formatClock(75.06)).toBe("1:15.1");
});
