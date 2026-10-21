import { describe, expect, it } from "vitest";

import { EAR_QUESTIONS, earQuestions, rng } from "./practice";

describe("ear test questions", () => {
  const qs = earQuestions(rng(42));

  it("ten questions of four options", () => {
    expect(qs).toHaveLength(EAR_QUESTIONS);
    for (const q of qs) expect(q.options).toHaveLength(4);
  });

  it("the answer and its parallel are always options, two major and two minor", () => {
    for (const q of qs) {
      const has = (root: number, quality: string) =>
        q.options.some((o) => o.root === root && o.quality === quality);
      expect(has(q.answer.root, q.answer.quality)).toBe(true);
      expect(has(q.answer.root, q.answer.quality === "maj" ? "min" : "maj")).toBe(true);
      expect(q.options.filter((o) => o.quality === "maj")).toHaveLength(2);
      const keys = new Set(q.options.map((o) => `${o.root}:${o.quality}`));
      expect(keys.size).toBe(4);
    }
  });

  it("no chord is the answer twice in a row", () => {
    for (let i = 1; i < qs.length; i++) {
      expect(`${qs[i].answer.root}:${qs[i].answer.quality}`).not.toBe(
        `${qs[i - 1].answer.root}:${qs[i - 1].answer.quality}`,
      );
    }
  });

  it("is reproducible from the seed", () => {
    expect(earQuestions(rng(7))).toEqual(earQuestions(rng(7)));
  });
});
