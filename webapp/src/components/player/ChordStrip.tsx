// The chord strip (song-player-v4): cards slide left under a fixed playhead, smoothly
// (rAF + transform, no re-render per frame). It runs `lead` seconds ahead of the music, so
// a chord is up before it sounds and the next card glows a beat early: hands need the
// time. Dragging it seeks; tapping a card jumps to it; a long press opens the chord fix.
// Each card's pager picks the chord's voicing.
import { useEffect, useRef, useState } from "react";

import type { Voicing } from "../../chords";
import { haptic } from "../../telegram";
import { t } from "../../texts";
import { litAt, timeAt, xAt, type StripCard, type StripLit } from "../../strip";
import { ChordDiagram } from "../ChordDiagram";

const PLAYHEAD = 92; // px from the strip's left edge
const DRAG_SLOP = 6; // px before a touch counts as a drag, not a tap
const LONG_PRESS_MS = 500;
const MAX_DOTS = 8;

/** What a card shows: the shape as played, and its voicings. */
export interface CardShape {
  key: string; // "9:min": the voicing choice is per shape, for the whole song
  label: string;
  options: Voicing[];
  pick: number; // index into options
  unsure: boolean; // a detected chord that may be wrong: marked "?", a long press fixes it
}

export function ChordStrip({
  cards,
  shapes,
  time,
  playing,
  now,
  lead,
  solfege,
  onSeek,
  onVoicing,
  onLongPress,
}: {
  cards: StripCard[];
  shapes: Record<number, CardShape>; // by event index
  time: number;
  playing: boolean;
  now: () => number;
  lead: number; // seconds of song time the strip runs ahead
  solfege: boolean;
  onSeek: (sec: number) => void;
  onVoicing: (key: string, pick: number) => void;
  onLongPress?: (event: number) => void;
}) {
  const track = useRef<HTMLDivElement>(null);
  const drag = useRef<{ startX: number; from: number; at: number; moved: boolean } | null>(null);
  const dragged = useRef(false); // the click that ends a drag (or a long press) is not a tap
  const press = useRef<number | null>(null); // the long-press timer
  const total = cards[cards.length - 1].x + cards[cards.length - 1].width;
  const place = (x: number) => {
    if (track.current) track.current.style.transform = `translateX(${PLAYHEAD - x}px)`;
  };
  // The card and dots lit: re-rendered only when they change, a few times a second.
  const [lit, setLit] = useState<StripLit>(() => litAt(cards, time + lead));
  const show = (t: number) => {
    place(xAt(cards, t));
    const next = litAt(cards, t);
    setLit((cur) =>
      cur.cur === next.cur && cur.lit === next.lit && cur.soon === next.soon ? cur : next,
    );
  };
  const showRef = useRef(show);
  showRef.current = show;
  const cancelPress = () => {
    if (press.current !== null) clearTimeout(press.current);
    press.current = null;
  };

  // Paused: follow the state's time. Not while playing: the polled time is older than the
  // frame loop's, and would pull the strip back for a frame ten times a second.
  useEffect(() => {
    if (!playing && !drag.current) showRef.current(time + lead);
  }, [cards, time, lead, playing]);
  // Playing: every frame, from the player's own clock.
  useEffect(() => {
    if (!playing) return;
    let id = requestAnimationFrame(function frame() {
      if (!drag.current) showRef.current(now() + lead);
      id = requestAnimationFrame(frame);
    });
    return () => cancelAnimationFrame(id);
  }, [playing, cards, now, lead]);
  useEffect(() => cancelPress, []);

  const { cur } = lit;

  return (
    <div
      className="chord-lane"
      role="group"
      aria-label={t.player.strip}
      onPointerDown={(e) => {
        dragged.current = false;
        const from = xAt(cards, now() + lead);
        drag.current = { startX: e.clientX, from, at: from, moved: false };
        const card = (e.target as Element).closest<HTMLElement>("[data-event]");
        if (card && onLongPress && !(e.target as Element).closest(".lane-pager")) {
          const event = Number(card.dataset.event);
          press.current = window.setTimeout(() => {
            press.current = null;
            dragged.current = true;
            drag.current = null;
            haptic.tap();
            onLongPress(event);
          }, LONG_PRESS_MS);
        }
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        const dx = e.clientX - d.startX;
        if (!d.moved && Math.abs(dx) < DRAG_SLOP) return;
        cancelPress();
        if (!d.moved) e.currentTarget.setPointerCapture(e.pointerId);
        d.moved = true;
        d.at = Math.max(0, Math.min(total, d.from - dx));
        place(d.at);
      }}
      onPointerUp={() => {
        cancelPress();
        const d = drag.current;
        drag.current = null;
        if (d?.moved) {
          dragged.current = true;
          onSeek(Math.max(0, timeAt(cards, d.at) - lead));
        }
      }}
      onPointerCancel={() => {
        cancelPress();
        drag.current = null;
        place(xAt(cards, now() + lead));
      }}
      onContextMenu={(e) => e.preventDefault()} // Android's long-press menu
    >
      <div ref={track} className="chord-lane-track">
        {cards.map((c, k) => {
          const s = shapes[c.event];
          const v = s.options[s.pick] ?? s.options[0];
          const on = k < cur ? c.beats : k > cur ? 0 : lit.lit;
          const dots = Math.min(c.beats, MAX_DOTS);
          const n = s.options.length;
          return (
            <div
              key={c.event}
              data-event={c.event}
              className={`lane-card${k < cur ? " past" : ""}${k === cur + 1 && lit.soon ? " soon" : ""}`}
              style={{ width: c.width }}
              aria-current={k === cur ? "true" : undefined}
            >
              <button
                type="button"
                className="lane-hit"
                aria-label={t.player.seekTo(s.unsure ? `${s.label}, ${t.player.unsure}` : s.label)}
                onClick={() => {
                  if (!dragged.current) onSeek(c.start);
                }}
              >
                <span className={`lane-name${solfege ? " sol" : ""}`}>
                  {s.label}
                  {s.unsure && (
                    <span className="lane-unsure" title={t.player.unsure}>
                      ?
                    </span>
                  )}
                </span>
                <ChordDiagram frets={v.frets} label={t.player.diagram(s.label)} size="md" />
                <span className="lane-dots" aria-hidden="true">
                  {Array.from({ length: dots }, (_, i) => (
                    <span key={i} className={i < Math.round((on * dots) / c.beats) ? "on" : ""} />
                  ))}
                </span>
              </button>
              {n > 1 && (
                <span className="lane-pager" onPointerDown={(e) => e.stopPropagation()}>
                  <button
                    type="button"
                    aria-label={t.player.prevVoicing}
                    onClick={() => {
                      haptic.tap();
                      onVoicing(s.key, (s.pick + n - 1) % n);
                    }}
                  >
                    ‹
                  </button>
                  <span aria-label={t.player.voicingOf(s.pick + 1, n)}>
                    {s.pick + 1}/{n}
                  </span>
                  <button
                    type="button"
                    aria-label={t.player.nextVoicing}
                    onClick={() => {
                      haptic.tap();
                      onVoicing(s.key, (s.pick + 1) % n);
                    }}
                  >
                    ›
                  </button>
                </span>
              )}
            </div>
          );
        })}
      </div>
      <span className="lane-playhead" aria-hidden="true" />
    </div>
  );
}
