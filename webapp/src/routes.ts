// The Mini App's pages as URLs: tabs at /, /songs, /practice, /profile; ichki sahifalar
// at /tuner, /chords, /practice/strum, /songs/:id (and the admin's /songs/:id/edit). nginx serves
// index.html for every path, so a reload or a pasted link lands on the same page.
// (router.ts splits off /admin, the panel, before the app sees the path.)
import { useCallback, useEffect, useState } from "react";

import type { Tab } from "./components/ui";

export type Route =
  | { name: Tab }
  | { name: "tuner" }
  | { name: "chords" }
  | { name: "strum" }
  | { name: "song"; id: number }
  | { name: "song-edit"; id: number };

const TAB_PATHS: Record<Tab, string> = {
  home: "/",
  songs: "/songs",
  practice: "/practice",
  profile: "/profile",
};

export function pathOf(r: Route): string {
  switch (r.name) {
    case "tuner":
      return "/tuner";
    case "chords":
      return "/chords";
    case "strum":
      return "/practice/strum";
    case "song":
      return `/songs/${r.id}`;
    case "song-edit":
      return `/songs/${r.id}/edit`;
    default:
      return TAB_PATHS[r.name];
  }
}

/** Anything unknown is the Asosiy page. */
export function parsePath(path: string): Route {
  const p = path.replace(/\/+$/, "") || "/";
  const song = p.match(/^\/songs\/(\d+)(\/edit)?$/);
  if (song) return { name: song[2] ? "song-edit" : "song", id: Number(song[1]) };
  if (p === "/tuner") return { name: "tuner" };
  if (p === "/chords") return { name: "chords" };
  if (p === "/practice/strum") return { name: "strum" };
  const tab = (Object.keys(TAB_PATHS) as Tab[]).find((k) => TAB_PATHS[k] === p);
  return { name: tab ?? "home" };
}

/** Where ← goes when there is no page of ours to go back to (the app started here). */
function parentOf(r: Route): Route {
  switch (r.name) {
    case "song":
      return { name: "songs" };
    case "song-edit":
      return { name: "song", id: r.id };
    case "strum":
      return { name: "practice" };
    default:
      return { name: "home" };
  }
}

export function isTab(r: Route): r is { name: Tab } {
  return r.name in TAB_PATHS;
}

// Each entry we push carries its depth, so after any back/forward we know whether an
// earlier page of ours is there to return to. (The Qoʻshiqlar stack's own entries copy
// the state they sit on, so they keep the depth.)
const depth = (): number => (history.state as { depth?: number } | null)?.depth ?? 0;

export function useRouter() {
  const [route, setRoute] = useState<Route>(() => parsePath(location.pathname));

  useEffect(() => {
    const onPop = () => setRoute(parsePath(location.pathname));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const go = useCallback((next: Route, { replace = false } = {}) => {
    const path = pathOf(next);
    if (path === location.pathname) replace = true; // e.g. tapping the open tab again
    if (replace) history.replaceState({ depth: depth() }, "", path);
    else history.pushState({ depth: depth() + 1 }, "", path);
    setRoute(next);
  }, []);

  const back = useCallback(() => {
    if (depth() > 0) history.back();
    else go(parentOf(parsePath(location.pathname)), { replace: true });
  }, [go]);

  return { route, go, back };
}
