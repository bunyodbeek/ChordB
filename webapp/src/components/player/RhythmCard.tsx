// "Ritm · Pop" (song-player-v4): the strumming pattern of the bar playing now, under the
// tool buttons. The slot is the song's bar grid (strum.ts barGrid), so the pattern keeps
// counting through chord changes. It is lit from a frame loop by class (it changes several
// times a beat); React only re-renders when the pattern itself changes.
import { useEffect, useRef, useState } from "react";

import { cardAt, type StripCard } from "../../strip";
import { barSlotAt, countLabels, patternLabel, strokeAt, type BarGrid, type Stroke } from "../../strum";
import { t } from "../../texts";
import { ChordStrum } from "../ChordStrum";

export const DEFAULT_PATTERN_KEY = "default";

/** The strumming of a song: the patterns it uses and which event plays which. */
export interface PlayerStrum {
  patterns: Record<string, { name: string; slots: string; strokes: Stroke[] }>; // by id, or "default"
  eventPatterns: string[]; // per event: a key of `patterns`
  bpm: number; // the admin's, the beat tracker's, or DEFAULT_BPM
  beats: number[] | null; // the beat tracker's beat times, when the video was analysed
  perBar: number; // eighths per bar: 8 in 4/4, 6 in 3/4
}

export function RhythmCard({
  strum,
  cards,
  grid,
  time,
  playing,
  now,
}: {
  strum: PlayerStrum;
  cards: StripCard[];
  grid: BarGrid;
  time: number;
  playing: boolean;
  now: () => number;
}) {
  const slots = useRef<(HTMLDivElement | null)[]>([]);
  const lit = useRef(-1);
  const first = cards[0] ? strum.eventPatterns[cards[0].event] : DEFAULT_PATTERN_KEY;
  const [patternKey, setPatternKey] = useState(first ?? DEFAULT_PATTERN_KEY);

  // Which slot of which pattern sounds at `t`: the chord picks the pattern, the bar the slot.
  const mark = (t: number) => {
    const k = cardAt(cards, t);
    const c = cards[Math.max(0, k)];
    if (!c) return;
    const key = strum.eventPatterns[c.event] ?? DEFAULT_PATTERN_KEY;
    setPatternKey((cur) => (cur === key ? cur : key));
    const slot = k < 0 ? -1 : barSlotAt(grid, strum.perBar, t);
    if (slot === lit.current) return;
    slots.current[lit.current]?.classList.remove("now");
    slots.current[slot]?.classList.add("now");
    lit.current = slot;
  };
  const markRef = useRef(mark);
  markRef.current = mark;

  useEffect(() => {
    markRef.current(time);
  }, [time, cards, grid]);
  useEffect(() => {
    if (!playing) return;
    let id = requestAnimationFrame(function frame() {
      markRef.current(now());
      id = requestAnimationFrame(frame);
    });
    return () => cancelAnimationFrame(id);
  }, [playing, now]);
  // A new pattern renders new slots: light the current one again.
  useEffect(() => {
    lit.current = -1;
    markRef.current(now());
  }, [patternKey, now]);

  const pattern = strum.patterns[patternKey] ?? strum.patterns[DEFAULT_PATTERN_KEY];
  if (!pattern) return null;
  const counts = countLabels(strum.perBar);
  return (
    <section className="rhythm-card" aria-label={t.player.rhythmCard(pattern.name)}>
      <div className="rhythm-head">
        <span className="rhythm-title">{t.player.rhythmCard(pattern.name)}</span>
        <span className="rhythm-meta">
          {patternLabel(pattern.slots.slice(0, strum.perBar))} · {t.player.bpm(strum.bpm)}
        </span>
      </div>
      <div className="rhythm-slots" key={patternKey}>
        {counts.map((label, i) => {
          const stroke = strokeAt(pattern.strokes, i, strum.perBar);
          return (
            <div
              key={i}
              ref={(el) => {
                slots.current[i] = el;
              }}
              className={`rhythm-slot${stroke === "-" ? " rest" : ""}`}
            >
              <span className="rhythm-arrow">
                <ChordStrum stroke={stroke} size={22} />
              </span>
              <span className={`rhythm-count${i % 2 ? " and" : ""}`}>{label}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
