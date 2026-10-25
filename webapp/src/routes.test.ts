import { describe, expect, it } from "vitest";

import { parsePath, pathOf, type Route } from "./routes";

describe("routes", () => {
  it.each<[string, Route]>([
    ["/", { name: "home" }],
    ["/songs", { name: "songs" }],
    ["/practice", { name: "practice" }],
    ["/profile", { name: "profile" }],
    ["/tuner", { name: "tuner" }],
    ["/chords", { name: "chords" }],
    ["/practice/strum", { name: "strum" }],
    ["/songs/12", { name: "song", id: 12 }],
    ["/songs/12/edit", { name: "song-edit", id: 12 }],
  ])("%s round-trips", (path, route) => {
    expect(parsePath(path)).toEqual(route);
    expect(pathOf(route)).toBe(path);
  });

  it.each(["", "/songs/", "/tuner/"])("%j: a trailing slash is the same page", (path) => {
    expect(pathOf(parsePath(path))).toBe(path.replace(/\/+$/, "") || "/");
  });

  it.each(["/nope", "/songs/abc", "/songs/12/x", "/index.html"])("%s: Asosiy", (path) => {
    expect(parsePath(path)).toEqual({ name: "home" });
  });
});
