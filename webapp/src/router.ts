// Two top-level screens share one bundle: the Mini App (/) and the admin panel (/admin).
// The panel's own pages live in the hash (#/users/12), so a reload keeps the page.
import { useEffect, useState } from "react";

const CHANGE = "chordb:navigate";

/** Go to another path or hash without reloading (Telegram keeps initData in this page). */
export function navigate(to: string): void {
  if (to === location.pathname + location.hash) return;
  history.pushState(null, "", to);
  window.dispatchEvent(new Event(CHANGE));
}

function useLocationValue<T>(read: () => T): T {
  const [value, setValue] = useState(read);
  useEffect(() => {
    const update = () => setValue(read);
    window.addEventListener("popstate", update);
    window.addEventListener("hashchange", update);
    window.addEventListener(CHANGE, update);
    return () => {
      window.removeEventListener("popstate", update);
      window.removeEventListener("hashchange", update);
      window.removeEventListener(CHANGE, update);
    };
    // read is a module-level function in every caller
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return value;
}

const readPath = () => location.pathname;
const readHash = () => location.hash;

export const usePath = () => useLocationValue(readPath);
export const useHash = () => useLocationValue(readHash);

export interface HashRoute {
  parts: string[]; // "#/users/12" → ["users", "12"]
  query: URLSearchParams; // "#/songs/new?yt=abc" → yt=abc
}

export function parseHash(hash: string): HashRoute {
  const raw = hash.replace(/^#\/?/, "");
  const [path, query = ""] = raw.split("?");
  return { parts: path.split("/").filter(Boolean), query: new URLSearchParams(query) };
}
