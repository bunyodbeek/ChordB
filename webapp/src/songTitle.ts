// What the player's app bar shows for a song: a clean title and an artist line.
// Only the display is cleaned; the raw (YouTube) title stays in the database.
import { isEasyShape, transpose } from "./chords";
import type { Chord } from "./notation";

export interface DisplayTitle {
  title: string;
  artist: string | null; // null when neither the song nor the title names one
  cover: boolean; // the video is a cover version
}

// Bracketed parts that are about the video, not the song: "(Official Video)", "[Lyrics]".
const NOISE =
  /\b(official|video|audio|lyrics?|lyric video|klip|clip|mv|m\/v|hd|hq|4k|1080p|720p|visuali[sz]er|karaoke|premiere|music video|full song|tiktok|remaster(ed)?|cover|guitar|acoustic version|live)\b|клип|текст/i;
const COVER = /\bcover\b|кавер/i;
const FEAT = /\s+(?:ft\.?|feat\.?|featuring)\s+[^()[\]\-–—|]+/gi;
const SEPARATOR = /\s+[-–—|]\s+/;

function tidy(s: string): string {
  return s
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s\-–—|:·]+|[\s\-–—|:·]+$/g, "")
    .trim();
}

/** "Alan Walker - Lily (Guitar Cover) [Official Video] ft. X" → Lily / Alan Walker / cover. */
export function displayTitle(raw: string, artist: string | null = null): DisplayTitle {
  let cover = false;
  let s = raw.replace(/[([{【]([^)\]}】]*)[)\]}】]/g, (whole, inner: string) => {
    if (COVER.test(inner)) cover = true;
    return NOISE.test(inner) ? " " : whole;
  });
  if (COVER.test(s.replace(/[([][^)\]]*[)\]]/g, ""))) cover = true;
  s = s.replace(FEAT, " ");
  // "… | Cover by …", "… - Cover": a trailing cover note without brackets.
  s = s.replace(/\s+[-–—|]\s*(?:guitar\s+)?cover\b.*$/i, " ").replace(/\s+cover\s+by\s+.*$/i, " ");

  let title = tidy(s);
  let who = artist?.trim() || null;
  const parts = title.split(SEPARATOR);
  if (parts.length >= 2) {
    const [first, ...rest] = parts;
    const restTitle = tidy(rest.join(" - "));
    if (!who) {
      who = tidy(first);
      title = restTitle;
    } else if (tidy(first).toLowerCase() === who.toLowerCase()) {
      title = restTitle; // "Artist - Title" with the artist already known
    }
  }
  return { title: title || tidy(raw), artist: who, cover };
}

/** The app bar's second line: "Alan Walker · cover". */
export function artistLine(d: DisplayTitle, fallback: string): string {
  return [d.artist ?? fallback, d.cover ? "cover" : null].filter(Boolean).join(" · ");
}

const MAX_SUGGESTED_CAPO = 7;

/** Distinct chords in song order. */
export function distinct(chords: readonly Chord[]): Chord[] {
  const out: Chord[] = [];
  for (const c of chords) {
    if (!out.some((o) => o.root === c.root && o.quality === c.quality)) out.push(c);
  }
  return out;
}

const hardShapes = (chords: readonly Chord[], capo: number) =>
  chords.filter((c) => !isEasyShape(transpose(c, -capo))).length;

/**
 * The capo that turns the most chords into open shapes, or null when none helps.
 * `chords` are as they sound; with capo N each is played as the shape N semitones lower.
 */
export function suggestCapo(chords: readonly Chord[], currentCapo: number): number | null {
  const unique = distinct(chords);
  if (!unique.length) return null;
  let best = 0;
  let bestHard = Infinity;
  // Ascending, so the lowest capo wins a tie.
  for (let capo = 0; capo <= MAX_SUGGESTED_CAPO; capo++) {
    const hard = hardShapes(unique, capo);
    if (hard < bestHard) {
      best = capo;
      bestHard = hard;
    }
  }
  return bestHard < hardShapes(unique, currentCapo) ? best : null;
}
