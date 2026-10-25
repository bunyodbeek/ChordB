// The player's chord strip (song-player-v4.reference.html): one card per chord change,
// as wide as the chord lasts, scrolled under a fixed playhead. Pure geometry.

export interface StripEvent {
  time_sec: number;
  chord: unknown; // null = no chord: the gap belongs to the chord before it
}

export interface StripCard {
  event: number; // index into the events
  start: number; // seconds
  end: number;
  beats: number; // the card's dots
  x: number; // left edge along the strip, px
  width: number;
}

const MIN_BEATS = 1;
const MAX_BEATS = 16;
// 2 beats = 104px and 4 beats = 120px, as in the design.
const BASE_W = 88;
const BEAT_W = 8;
const FALLBACK_BEAT_SEC = 0.5;

export interface StripOptions {
  beatSec?: number | null; // from the song's tempo; otherwise guessed
}

/**
 * Cards for the chord changes. Without a tempo a beat is guessed: the median chord
 * lasts one bar of four. Each card is BASE_W + BEAT_W per beat wide.
 */
export function stripLayout(
  events: readonly StripEvent[],
  duration: number,
  { beatSec: given = null }: StripOptions = {},
): StripCard[] {
  const changes = events.flatMap((e, i) => (e.chord ? [i] : []));
  const spans = changes.map((i, k) => {
    const start = events[i].time_sec;
    const next = changes[k + 1];
    const end = next !== undefined ? events[next].time_sec : Math.max(start, duration);
    return { event: i, start, end };
  });
  const lengths = spans.map((s) => s.end - s.start).filter((d) => d > 0).sort((a, b) => a - b);
  const median = lengths.length ? lengths[Math.floor(lengths.length / 2)] : 0;
  const beatSec = given && given > 0 ? given : median > 0 ? median / 4 : FALLBACK_BEAT_SEC;

  let x = 0;
  return spans.map((s) => {
    const beats = Math.min(MAX_BEATS, Math.max(MIN_BEATS, Math.round((s.end - s.start) / beatSec)));
    const card = { ...s, beats, x, width: BASE_W + BEAT_W * beats };
    x += card.width;
    return card;
  });
}

/** Where on the strip time `t` is: 0 before the first chord, the end after the last. */
export function xAt(cards: readonly StripCard[], t: number): number {
  if (!cards.length || t <= cards[0].start) return 0;
  for (const c of cards) {
    if (t < c.end) return c.x + ((t - c.start) / (c.end - c.start)) * c.width;
  }
  const last = cards[cards.length - 1];
  return last.x + last.width;
}

/** The inverse of xAt: the time under strip position `x`. */
export function timeAt(cards: readonly StripCard[], x: number): number {
  if (!cards.length) return 0;
  if (x <= 0) return cards[0].start;
  for (const c of cards) {
    if (x < c.x + c.width) return c.start + ((x - c.x) / c.width) * (c.end - c.start);
  }
  return cards[cards.length - 1].end;
}

/** The card playing at `t`, or -1 before the first chord. */
export function cardAt(cards: readonly StripCard[], t: number): number {
  let k = -1;
  while (k + 1 < cards.length && cards[k + 1].start <= t) k++;
  return k;
}

/** What the strip lights at `t`: the card playing, its beat dots, and the next card once due. */
export interface StripLit {
  cur: number; // cardAt
  lit: number; // beats of `cur` begun, 0 … beats
  soon: boolean; // the next card starts within a beat
}

export function litAt(cards: readonly StripCard[], t: number): StripLit {
  const cur = cardAt(cards, t);
  const c = cards[Math.max(0, cur)];
  if (!c) return { cur, lit: 0, soon: false };
  const beat = (c.end - c.start) / c.beats;
  const next = cards[cur + 1];
  return {
    cur,
    lit: cur < 0 ? 0 : Math.min(c.beats, Math.floor((t - c.start) / beat) + 1),
    soon: !!next && next.start - t <= beat,
  };
}
