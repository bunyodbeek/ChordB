import { describe, expect, it } from "vitest";

import { formatChord, parseChord } from "./notation";
import { transpose } from "./chords";
import { artistLine, displayTitle, suggestCapo } from "./songTitle";

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

describe("suggestCapo", () => {
  const chords = (s: string) => s.split(" ").map(parseChord);

  it("Fm Bbm Eb Ab → capo 1: Em Am D G", () => {
    const song = chords("Fm Bbm Eb Ab Eb Fm");
    expect(suggestCapo(song, 0)).toBe(1);
    expect(chords("Fm Bbm Eb Ab").map((c) => formatChord(transpose(c, -1), "letter"))).toEqual([
      "Em",
      "Am",
      "D",
      "G",
    ]);
  });

  it("Am F C G → capo 5: Em C G D, all open", () => {
    expect(suggestCapo(chords("Am F C G"), 0)).toBe(5);
  });

  it("nothing to suggest for open-chord songs", () => {
    expect(suggestCapo(chords("Am C G Em"), 0)).toBeNull();
    expect(suggestCapo([], 0)).toBeNull();
  });

  it("is relative to the capo the song already uses", () => {
    // Played with capo 1 as Em Am D G already: no better capo.
    expect(suggestCapo(chords("Fm Bbm Eb Ab"), 1)).toBeNull();
  });
});
