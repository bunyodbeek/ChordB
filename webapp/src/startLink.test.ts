import { describe, expect, it } from "vitest";

import { parseStart } from "./startLink";

describe("startapp links", () => {
  it.each([
    ["song_123", { songId: 123, practice: false }],
    ["practice", { songId: null, practice: true }],
    [null, { songId: null, practice: false }],
    ["song_", { songId: null, practice: false }],
    ["song_12x", { songId: null, practice: false }],
    ["something", { songId: null, practice: false }],
  ])("%s", (param, want) => {
    expect(parseStart(param)).toEqual(want);
  });
});
