import { describe, expect, it } from "vitest";

import { artistLine, displayTitle } from "./songTitle";

describe("displayTitle", () => {
  it.each([
    ["Alan Walker - Lily (Guitar Cover)", { title: "Lily", artist: "Alan Walker", cover: true }],
    ["Shahzoda - Yor-yor [Official Video]", { title: "Yor-yor", artist: "Shahzoda", cover: false }],
    ["Ozodbek Nazarbekov – Sevgilim (Lyrics)", { title: "Sevgilim", artist: "Ozodbek Nazarbekov", cover: false }],
    ["Marshmello - Alone ft. Someone (Official Music Video)", { title: "Alone", artist: "Marshmello", cover: false }],
    ["Perfect - Ed Sheeran | Guitar cover by Bob", { title: "Ed Sheeran", artist: "Perfect", cover: true }],
    ["Yesterday (Acoustic Cover)", { title: "Yesterday", artist: null, cover: true }],
    ["Bohemian Rhapsody (Remix) [HD]", { title: "Bohemian Rhapsody (Remix)", artist: null, cover: false }],
  ])("%s", (raw, want) => {
    expect(displayTitle(raw)).toEqual(want);
  });

  it("keeps the catalog's artist and drops it from the title", () => {
    expect(displayTitle("Shahzoda - Yor-yor (Official Video)", "Shahzoda")).toEqual({
      title: "Yor-yor",
      artist: "Shahzoda",
      cover: false,
    });
    // A dash that is part of the name stays.
    expect(displayTitle("Yor-yor", "Xalq qoʻshigʻi").title).toBe("Yor-yor");
  });

  it("never returns an empty title", () => {
    expect(displayTitle("(Official Video)").title).toBe("(Official Video)");
  });

  it("artist line", () => {
    expect(artistLine(displayTitle("Alan Walker - Lily (Cover)"), "YouTube")).toBe("Alan Walker · cover");
    expect(artistLine(displayTitle("Lily"), "YouTube")).toBe("YouTube");
  });
});
