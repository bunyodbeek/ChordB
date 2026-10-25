// What the player's app bar shows for a song: a clean title and an artist line.
// Only the display is cleaned; the raw (YouTube) title stays in the database.

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
