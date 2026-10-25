import { describe, expect, it } from "vitest";

import { stripLayout } from "./strip";
import {
  OnsetDetector,
  accuracy,
  barGrid,
  barSlotAt,
  bestPhase,
  countLabels,
  eighthsPerBar,
  judgeBar,
  judgeSlot,
  nextUnlock,
  patternIds,
  patternLabel,
  strokeAt,
  strokes,
} from "./strum";

const C = { root: 0, quality: "maj" };
const POP = strokes("D-DU-UDU");

describe("patterns", () => {
  it("reads the slots", () => {
    expect(strokes("D-DU-UDU")).toEqual(["D", "-", "D", "U", "-", "U", "D", "U"]);
    expect(strokes("Dx?")).toEqual(["D", "x", "-", "-", "-", "-", "-", "-"]); // short or odd: rests
  });

  it.each([
    ["D-DU-UDU", "D · DU · UDU"],
    ["D-D-D-D-", "D · D · D · D"],
    ["-U-U-U-U", "U · U · U · U"],
    ["D-D-DUDU", "D · D · DUDU"],
  ])("%s reads as %s", (slots, label) => {
    expect(patternLabel(slots)).toBe(label);
  });

  it("counts eighths per bar", () => {
    expect(["4/4", "3/4", "2/4", "6/8", "nope"].map(eighthsPerBar)).toEqual([8, 6, 4, 6, 8]);
  });

  it("restarts the pattern every bar", () => {
    const row = Array.from({ length: 12 }, (_, i) => strokeAt(POP, i)).join("");
    expect(row).toBe("D-DU-UDUD-DU");
    const waltz = Array.from({ length: 12 }, (_, i) => strokeAt(POP, i, 6)).join("");
    expect(waltz).toBe("D-DU-UD-DU-U");
  });

  it("lets an event change the pattern from there on", () => {
    const events = [{}, { strum_pattern_id: 3 }, {}, { strum_pattern_id: 2 }, { strum_pattern_id: null }];
    expect(patternIds(events, 2)).toEqual([2, 3, 3, 2, 2]);
    expect(patternIds([{}], null)).toEqual([null]);
  });
});

describe("beats on the strip", () => {
  // 120 BPM: a beat is 0.5 s, a bar of 4/4 is 2 s.
  const events = [
    { time_sec: 0, chord: C }, // 2 s = 1 bar
    { time_sec: 2, chord: C }, // 1 s = half a bar
    { time_sec: 3, chord: C }, // 4 s = 2 bars
  ];

  it("counts the bar", () => {
    expect(countLabels(8).join(" ")).toBe("1 & 2 & 3 & 4 &");
    expect(countLabels(6).join(" ")).toBe("1 & 2 & 3 &");
  });

  it("uses the song's tempo over the guess", () => {
    const guessed = stripLayout(events, 7); // the median chord (2 s) taken as one bar
    const slow = stripLayout(events, 7, { beatSec: 1 }); // 60 BPM
    expect(guessed.map((c) => c.beats)).toEqual([4, 2, 8]);
    expect(slow.map((c) => c.beats)).toEqual([2, 1, 4]);
  });

});

describe("the bar grid", () => {
  const range = (n: number, from: number, step: number) => Array.from({ length: n }, (_, i) => from + i * step);

  it("counts bars from the first chord at a steady tempo", () => {
    // 120 BPM, the first chord 1 s in: bars start at 1, 3, 5 …
    const grid = barGrid({ beats: null, bpm: 120, perBar: 8, duration: 6, changes: [1, 3] });
    const at = (t: number) => barSlotAt(grid, 8, t);
    expect([1, 1.24, 1.25, 1.8, 2.99, 3, 0.1].map(at)).toEqual([0, 0, 1, 3, 7, 0, 4]);
    expect(grid.beats[0]).toBeLessThanOrEqual(0);
    expect(grid.beats[grid.beats.length - 1]).toBeGreaterThanOrEqual(6);
  });

  it("keeps counting through a chord that changes mid-bar", () => {
    const grid = barGrid({ beats: null, bpm: 120, perBar: 8, duration: 8, changes: [0, 2, 3, 4] });
    // The change at 3 s is on beat 3: the bar goes on, it does not start again.
    expect(barSlotAt(grid, 8, 3)).toBe(4);
    expect(barSlotAt(grid, 8, 4)).toBe(0);
  });

  it("puts the bar line where the chords change", () => {
    // Tracked beats every 0.5 s from 0.2; the chords change on every fourth from the second.
    const beats = range(20, 0.2, 0.5);
    const grid = barGrid({ beats, bpm: 120, perBar: 8, duration: 10, changes: [0.7, 2.7, 4.7, 6.7] });
    expect(barSlotAt(grid, 8, 0.7)).toBe(0);
    expect(barSlotAt(grid, 8, 2.7)).toBe(0);
    expect(barSlotAt(grid, 8, 2.2)).toBe(6);
  });

  it("follows the tracked beats, not a steady tempo", () => {
    // A song that speeds up: the slots stay on its beats.
    const beats = [0, 0.6, 1.2, 1.8, 2.3, 2.8, 3.3, 3.8, 4.2, 4.6];
    const grid = barGrid({ beats, bpm: 110, perBar: 8, duration: 5, changes: [0, 2.3] });
    expect(barSlotAt(grid, 8, 2.3)).toBe(0);
    expect(barSlotAt(grid, 8, 4.25)).toBe(0);
    expect(barSlotAt(grid, 8, 4.45)).toBe(1);
  });

  it("fits a tracker that counted half or double time", () => {
    const half = barGrid({ beats: range(10, 0, 1), bpm: 120, perBar: 8, duration: 9, changes: [0] });
    expect(half.beats.slice(0, 4)).toEqual([0, 0.5, 1, 1.5]);
    // Double time: the beats the chords change on are kept.
    const double = barGrid({ beats: range(40, 0, 0.25), bpm: 120, perBar: 8, duration: 9, changes: [0.25, 2.25] });
    expect(double.beats.slice(0, 3)).toEqual([-0.25, 0.25, 0.75]);
    expect(barSlotAt(double, 8, 2.25)).toBe(0);
  });

  it("has three beats to a bar of 3/4", () => {
    const grid = barGrid({ beats: null, bpm: 120, perBar: 6, duration: 4, changes: [0, 1.5] });
    expect([0, 0.5, 1, 1.25, 1.5].map((t) => barSlotAt(grid, 6, t))).toEqual([0, 2, 4, 5, 0]);
  });

  it("picks the phase most changes fall on", () => {
    const beats = range(16, 0, 0.5);
    expect(bestPhase(beats, [0.5, 2.5, 4.5], 4)).toBe(1);
    expect(bestPhase(beats, [0.5, 1], 4)).toBe(1); // a tie: the first change's
    expect(bestPhase(beats, [0.25], 4)).toBe(0); // off the beats: nothing to go on
  });
});

describe("judging strokes", () => {
  const slot = 0.25; // 120 BPM eighths

  it("grades the nearest onset", () => {
    expect(judgeSlot("D", 1, slot, [1.03])).toBe("on");
    expect(judgeSlot("D", 1, slot, [0.94])).toBe("on"); // 60 ms early still counts
    expect(judgeSlot("U", 1, slot, [1.1])).toBe("off");
    expect(judgeSlot("D", 1, slot, [0.895])).toBe("off");
    expect(judgeSlot("D", 1, slot, [1.2, 0.7])).toBe("miss");
    expect(judgeSlot("D", 1, slot, [])).toBe("miss");
    expect(judgeSlot("x", 1, slot, [1.0])).toBe("on"); // a chuck is heard too
  });

  it("marks a struck rest, not its neighbour's stroke", () => {
    expect(judgeSlot("-", 1, slot, [])).toBe("rest");
    expect(judgeSlot("-", 1, slot, [1.05])).toBe("extra");
    expect(judgeSlot("-", 1, slot, [1.25, 0.75])).toBe("rest"); // the next and last slots' strokes
  });

  it("scores a bar and the accuracy over it", () => {
    // Pop at 120 BPM from t=10: strokes due at 10, 10.5, 10.75, 11.25, 11.5, 11.75.
    const onsets = [10.01, 10.52, 10.85, 11.0, 11.26, 11.5];
    const bar = judgeBar(POP, 10, slot, onsets);
    expect(bar).toEqual(["on", "rest", "on", "off", "extra", "on", "on", "miss"]);
    expect(accuracy(bar)).toBeCloseTo(4 / 6);
  });

  it("counts four bars", () => {
    const perfect = Array.from({ length: 6 }, (_, i) => [10, 10.5, 10.75, 11.25, 11.5, 11.75][i]);
    const bars = [0, 2, 4, 6].flatMap((d) => judgeBar(POP, 10 + d, slot, perfect.map((t) => t + d)));
    expect(bars).toHaveLength(32);
    expect(accuracy(bars)).toBe(1);
    expect(accuracy(["rest", "rest"])).toBeNull(); // nothing expected
  });

  it("opens the next tempo", () => {
    const ladder = [60, 80, 100, 120];
    expect(nextUnlock(ladder, 60, 140)).toBe(80);
    expect(nextUnlock(ladder, 80, 140)).toBe(100);
    expect(nextUnlock(ladder, 120, 140)).toBe(140);
    expect(nextUnlock(ladder, 140, 140)).toBeNull();
  });
});

describe("onset detection", () => {
  const rate = 8000;

  /** Quiet noise with short bursts (strokes) at `hits` seconds. */
  function signal(seconds: number, hits: number[]): Float32Array {
    const x = new Float32Array(seconds * rate);
    let seed = 1;
    const noise = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 0.002;
    for (let i = 0; i < x.length; i++) x[i] = noise();
    for (const h of hits) {
      const at = Math.round(h * rate);
      for (let i = 0; i < 400 && at + i < x.length; i++) x[at + i] += 0.5 * Math.exp(-i / 120) * Math.sin(i);
    }
    return x;
  }

  it("finds the strokes within a block, in chunks of any size", () => {
    const hits = [0.2, 0.5, 0.75, 1.1];
    const x = signal(1.5, hits);
    const d = new OnsetDetector(rate, { block: 64 });
    const found: number[] = [];
    for (let at = 0, n = 333; at < x.length; at += n) {
      const chunk = x.subarray(at, Math.min(x.length, at + n));
      found.push(...d.push(chunk, (at + chunk.length) / rate));
    }
    expect(found).toHaveLength(hits.length);
    found.forEach((t, i) => expect(Math.abs(t - hits[i])).toBeLessThan(64 / rate + 1e-9));
  });

  it("debounces a stroke's ringing and ignores silence", () => {
    const d = new OnsetDetector(rate, { block: 64 });
    expect(d.push(signal(1, [0.3, 0.32]), 1)).toHaveLength(1); // 20 ms apart: one stroke
    expect(new OnsetDetector(rate).push(signal(1, []), 1)).toEqual([]);
  });
});
