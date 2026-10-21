// The launch splash (markup and CSS in index.html, from docs/design/chordb-splash.html).
// It is only ever in the page on a cold start; the app hides it once, when /api/me has
// answered, after it has been up for at least MIN_MS.
import { setAppChrome } from "./telegram";

const MIN_MS = 1300;
const FADE_MS = 320;
const FADE_REDUCED_MS = 200; // prefers-reduced-motion (index.html)

declare global {
  interface Window {
    __splashShownAt?: number; // performance.now() when index.html painted it
  }
}

let hiding: Promise<void> | null = null;

/** Fade the splash out; resolves when the fade starts, so the app can render under it. */
export function hideSplash(): Promise<void> {
  hiding ??= (async () => {
    const el = document.getElementById("splash");
    if (!el) {
      setAppChrome();
      return;
    }
    const shownFor = performance.now() - (window.__splashShownAt ?? 0);
    if (shownFor < MIN_MS) await new Promise((r) => setTimeout(r, MIN_MS - shownFor));
    el.classList.add("is-done");
    // Telegram's header and background go from the splash colour to the app's now, as
    // the splash fades, so there is no white flash in between.
    setAppChrome();
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setTimeout(() => el.remove(), reduced ? FADE_REDUCED_MS : FADE_MS);
  })();
  return hiding;
}
