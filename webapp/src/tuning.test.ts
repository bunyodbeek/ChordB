import { describe, expect, it } from "vitest";

import { PRESETS, STANDARD, nearestString, presetById, presetForShift, stringName } from "./tuning";

const notes = (id: Parameters<typeof presetById>[0]) => {
  const p = presetById(id);
  return p.strings.map((s) => stringName(s.pc, "letter", p.flat)).join(" ");
};

describe("tuning presets", () => {
  it("have the right notes, low string first", () => {
    expect(notes("standard")).toBe("E A D G B E");
    expect(notes("half_down")).toBe("Eb Ab Db Gb Bb Eb");
    expect(notes("whole_down")).toBe("D G C F A D");
    expect(notes("drop_d")).toBe("D A D G B E");
    expect(PRESETS.every((p) => p.strings.map((s) => s.number).join() === "6,5,4,3,2,1")).toBe(true);
  });

  it("are a semitone / tone below standard", () => {
    const st = STANDARD.map((s) => s.midi);
    expect(presetById("half_down").strings.map((s) => s.midi)).toEqual(st.map((m) => m - 1));
    expect(presetById("whole_down").strings.map((s) => s.midi)).toEqual(st.map((m) => m - 2));
    expect(presetById("drop_d").strings[0].midi).toBe(38); // only the low string drops
  });

  it("solfège names stay short on the headstock", () => {
    const p = presetById("half_down");
    expect(stringName(p.strings[0].pc, "solfege", p.flat)).toBe("Mi♭");
    expect(stringName(6, "solfege")).toBe("Fa♯");
  });

  it("nearest string follows the preset", () => {
    const d = presetById("drop_d").strings;
    expect(nearestString(73.4, d).number).toBe(6); // D2 is the low string in Drop D
    expect(nearestString(77.8, presetById("half_down").strings).number).toBe(6); // Eb2
  });

  it("maps an analysis shift to a preset", () => {
    expect(presetForShift(-1)).toBe("half_down");
    expect(presetForShift(-2)).toBe("whole_down");
    expect(presetForShift(0)).toBeNull();
  });
});
