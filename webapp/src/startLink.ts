// startapp deep links: t.me/<bot>/<app>?startapp=song_123 | practice.

/** "song_123" → song 123; "practice" → the Mashq tab. */
export function parseStart(param: string | null): { songId: number | null; practice: boolean } {
  const song = param?.match(/^song_(\d+)$/);
  return { songId: song ? Number(song[1]) : null, practice: param === "practice" };
}
