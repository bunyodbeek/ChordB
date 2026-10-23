import { describe, expect, it } from "vitest";

import { chordsLabel, earOptionLabel, earPoolLabel, mistakeTip } from "./practice";

const AM = { root: 9, quality: "min" } as const;
const C = { root: 0, quality: "maj" } as const;
const BB = { root: 10, quality: "maj" } as const;
const G7 = { root: 7, quality: "7" } as const;

const side = (chords: { root: number; quality: "maj" | "min" | "7" }[]) => ({ id: "", chords, voicing: [] });

describe("ear test labels", () => {
  it("names options in the user's notation", () => {
    expect(earOptionLabel({ id: "9:min", chords: [AM] }, "letter")).toBe("Am");
    expect(earOptionLabel({ id: "9:min", chords: [AM] }, "solfege")).toBe("Lya minor");
    expect(earOptionLabel({ id: "10:maj", chords: [BB] }, "letter")).toBe("Bb");
    expect(earOptionLabel({ id: "maj", chords: [] }, "letter")).toBe("Major");
    expect(chordsLabel([C, AM], "letter")).toBe("C → Am");
  });

  it("lists a level's pool with its groups and note", () => {
    expect(earPoolLabel({ shown: [[C], [AM]], note: "" }, "letter")).toBe("C · Am");
    expect(earPoolLabel({ shown: [[C, AM]], note: "+ ochiq" }, "letter")).toBe("C Am + ochiq");
    expect(earPoolLabel({ shown: [], note: "major + minor" }, "letter")).toBe("major + minor");
    expect(earPoolLabel({ shown: [[C, AM]], note: "" }, "solfege")).toBe("Do major, Lya minor");
  });

  it("picks the hint that fits the mistakes", () => {
    const m = (a: Parameters<typeof side>[0], b: Parameters<typeof side>[0]) => ({
      question_id: 0,
      asked: side(a),
      answered: side(b),
    });
    expect(mistakeTip("chord", [m([AM], [C])])).toBe("quality");
    expect(mistakeTip("chord", [m([G7], [C])])).toBe("seventh");
    expect(mistakeTip("chord", [m([C], [BB])])).toBe("chord");
    expect(mistakeTip("progression", [m([C, AM], [AM, C])])).toBe("progression");
  });
});
