// Song timeline math for the player. Pure: no React, no YouTube.

export interface TimedEvent {
  time_sec: number;
  section_id: number | null;
}

export interface TimedSection {
  id: number;
  title: string;
  start_sec: number;
}

export const BEATS_PER_BAR = 4;

/**
 * Index of the chord sounding at `t`: the last event with time_sec <= t, or -1
 * before the first one. Binary search; `events` must be sorted by time_sec.
 */
export function activeIndex(events: readonly TimedEvent[], t: number): number {
  let lo = 0;
  let hi = events.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (events[mid].time_sec <= t) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

/**
 * Beat (0..3) within the active chord, treating each chord event as one 4-beat
 * bar that lasts until the next event (or the end of the song). -1 when no chord.
 */
export function beatOf(
  events: readonly TimedEvent[],
  index: number,
  t: number,
  durationSec: number,
): number {
  if (index < 0) return -1;
  const start = events[index].time_sec;
  const end = index + 1 < events.length ? events[index + 1].time_sec : durationSec;
  if (end <= start) return BEATS_PER_BAR - 1;
  const frac = Math.min(Math.max((t - start) / (end - start), 0), 0.999999);
  return Math.floor(frac * BEATS_PER_BAR);
}

/** [start, end) of the section playing at `t`; the whole song when there are no sections. */
export function sectionBounds(
  sections: readonly TimedSection[],
  t: number,
  durationSec: number,
): { start: number; end: number } {
  if (sections.length === 0) return { start: 0, end: durationSec };
  let i = 0;
  while (i + 1 < sections.length && sections[i + 1].start_sec <= t) i++;
  return {
    start: sections[i].start_sec,
    end: i + 1 < sections.length ? sections[i + 1].start_sec : durationSec,
  };
}

export interface SectionGroup<E> {
  title: string | null; // null when the song has no sections
  items: { event: E; index: number }[]; // index into the full events array
}

/** Events grouped under their sections, in order, for the sections grid. */
export function groupBySection<E extends TimedEvent>(
  sections: readonly TimedSection[],
  events: readonly E[],
): SectionGroup<E>[] {
  const withIndex = events.map((event, index) => ({ event, index }));
  if (sections.length === 0) return withIndex.length ? [{ title: null, items: withIndex }] : [];
  return sections
    .map((s) => ({ title: s.title, items: withIndex.filter((x) => x.event.section_id === s.id) }))
    .filter((g) => g.items.length > 0);
}

/** 75 → "1:15". */
export function formatTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
