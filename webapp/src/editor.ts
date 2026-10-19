// Admin chord editor logic. Pure: no React, no YouTube.
import type { ChordJson } from "./api";

export interface DraftEvent extends ChordJson {
  time_sec: number;
}

export interface DraftSection {
  title: string;
  start_sec: number;
}

export const SECTION_TITLES = ["Kirish", "Kuplet", "Naqarot", "Koʻprik", "Yakun"];
export const DEFAULT_OFFSET = -0.15; // seconds: taps land a little after the change

/** Times are stored to 1/100 s; two marks on the same 1/100 s are the same mark. */
export const roundTime = (t: number) => Math.round(Math.max(0, t) * 100) / 100;

export const chordKey = (c: ChordJson) => `${c.root}:${c.quality}`;

/** Insert keeping time order; a mark at the same (rounded) time replaces the old one. */
export function insertTimed<T extends { time_sec?: number; start_sec?: number }>(
  list: readonly T[],
  item: T,
  timeOf: (x: T) => number,
): T[] {
  const t = timeOf(item);
  const rest = list.filter((x) => timeOf(x) !== t);
  const at = rest.findIndex((x) => timeOf(x) > t);
  return at === -1 ? [...rest, item] : [...rest.slice(0, at), item, ...rest.slice(at)];
}

export const addEvent = (events: readonly DraftEvent[], e: DraftEvent) =>
  insertTimed(events, { ...e, time_sec: roundTime(e.time_sec) }, (x) => x.time_sec);

export const addSection = (sections: readonly DraftSection[], s: DraftSection) =>
  insertTimed(sections, { ...s, start_sec: roundTime(s.start_sec) }, (x) => x.start_sec);

const pc = (n: number) => ((n % 12) + 12) % 12;

/** The chords most songs in this key use, most common first. */
export function diatonic(key: ChordJson): ChordJson[] {
  const r = key.root;
  if (key.quality === "min") {
    // i, VI, III, VII, v, iv, V (the major V of harmonic minor)
    return [
      { root: pc(r), quality: "min" },
      { root: pc(r + 8), quality: "maj" },
      { root: pc(r + 3), quality: "maj" },
      { root: pc(r + 10), quality: "maj" },
      { root: pc(r + 7), quality: "min" },
      { root: pc(r + 5), quality: "min" },
      { root: pc(r + 7), quality: "maj" },
    ];
  }
  // I, V, vi, IV, ii, iii, V7
  return [
    { root: pc(r), quality: "maj" },
    { root: pc(r + 7), quality: "maj" },
    { root: pc(r + 9), quality: "min" },
    { root: pc(r + 5), quality: "maj" },
    { root: pc(r + 2), quality: "min" },
    { root: pc(r + 4), quality: "min" },
    { root: pc(r + 7), quality: "7" },
  ];
}

/** Palette: chords already in the timeline, then the key's chords, then added ones. */
export function palette(key: ChordJson, events: readonly ChordJson[], extra: readonly ChordJson[]) {
  const seen = new Set<string>();
  const out: ChordJson[] = [];
  for (const c of [...events, ...diatonic(key), ...extra]) {
    const k = chordKey(c);
    if (!seen.has(k)) {
      seen.add(k);
      out.push({ root: c.root, quality: c.quality });
    }
  }
  return out;
}

/** Problems the server would reject, worded for the admin. Null when the timeline is fine. */
export function timelineProblem(
  events: readonly DraftEvent[],
  sections: readonly DraftSection[],
  durationSec: number,
): "empty" | "beforeSection" | "tooLate" | null {
  if (events.length === 0) return "empty";
  if (sections.length && events[0].time_sec < sections[0].start_sec) return "beforeSection";
  const last = Math.max(events[events.length - 1].time_sec, sections.at(-1)?.start_sec ?? 0);
  if (last > durationSec) return "tooLate";
  return null;
}

/** Video id from a YouTube link (watch, youtu.be, shorts, embed) or a bare id. */
export function parseYouTubeId(input: string): string | null {
  const s = input.trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s;
  let url: URL;
  try {
    url = new URL(s.includes("://") ? s : `https://${s}`);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^(www\.|m\.|music\.)/, "");
  let id: string | null = null;
  if (host === "youtu.be") id = url.pathname.slice(1).split("/")[0];
  else if (host === "youtube.com" || host === "youtube-nocookie.com") {
    id =
      url.searchParams.get("v") ??
      url.pathname.match(/^\/(?:shorts|embed|live|v)\/([^/?#]+)/)?.[1] ??
      null;
  }
  return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
}

/** "3:12" or "192" → seconds; null if not a time. */
export function parseDuration(input: string): number | null {
  const s = input.trim();
  const m = s.match(/^(\d{1,3}):([0-5]\d)$/);
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  return /^\d{1,5}$/.test(s) ? Number(s) : null;
}

/** 13.4 → "0:13.4" (the editor clock and timeline). */
export function formatClock(sec: number): string {
  const tenths = Math.max(0, Math.round(sec * 10));
  const m = Math.floor(tenths / 600);
  const s = (tenths % 600) / 10;
  return `${m}:${s.toFixed(1).padStart(4, "0")}`;
}
