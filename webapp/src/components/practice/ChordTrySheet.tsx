// "Sinab koʻrish" — chord-try.reference.html. A chord's diagram with fingers; play it and
// the mic confirms it (the chord joins the collection), then on to the next one.
import { useEffect, useState } from "react";

import { api } from "../../api";
import { playChord } from "../../audio/player";
import { voicing } from "../../chords";
import { formatChord, type Chord, type NotationKind } from "../../notation";
import { haptic } from "../../telegram";
import { t } from "../../texts";
import { useChordListener } from "../../useChordListener";
import { BigChordDiagram } from "./BigChordDiagram";

const STRING_NAMES = ["E", "A", "D", "G", "B", "e"];

interface Props {
  chords: Chord[]; // the list "Keyingi akkord" walks through
  start: number;
  caption: (index: number) => string; // "4 / 24 · boshlovchi akkordlar"
  notation: NotationKind;
  onUnlocked?: () => void;
  onClose: () => void;
}

export function ChordTrySheet({ chords, start, caption, notation, onUnlocked, onClose }: Props) {
  const [i, setI] = useState(start);
  const chord = chords[i % chords.length];
  const listener = useChordListener(chord);
  const manual = listener.status === "denied" || listener.status === "unavailable";
  const [confirmed, setConfirmed] = useState(false); // no mic: "I played it"
  const done = listener.matched || confirmed;
  const name = formatChord(chord, notation);
  const frets = voicing(chord).frets;

  useEffect(() => setConfirmed(false), [i]);

  // Recognised (or confirmed): into the collection.
  useEffect(() => {
    if (!done) return;
    haptic.success();
    api.practice.unlock({ root: chord.root, quality: chord.quality }, confirmed ? "listened" : "played").then(
      () => onUnlocked?.(),
      () => {},
    );
    // once per chord
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="overlay try-overlay" onClick={onClose}>
      <section
        className="sheet try-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={t.practice.tryTitle}
        onClick={(e) => e.stopPropagation()}
      >
        <span className="sheet-handle" aria-hidden="true" />
        <div className="try-head">
          <span className="try-pos">{caption(i % chords.length)}</span>
          <button
            type="button"
            className="try-hear"
            aria-label={t.practice.hearAria}
            onClick={() => void playChord(chord).catch(() => {})}
          >
            <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M11 5L6 9H3v6h3l5 4V5z" />
            </svg>
            {t.practice.hear}
          </button>
        </div>
        <span className={`try-name${notation === "solfege" ? " sol" : ""}`}>{name}</span>
        <BigChordDiagram frets={frets} label={t.player.diagram(name)} />

        <div className="try-strings" aria-label={t.practice.strings}>
          {STRING_NAMES.map((s, k) => {
            const muted = frets[k] < 0;
            const state = muted ? "muted" : done ? "ok" : "wait";
            return (
              <span key={s} className={`try-string ${state}`}>
                {s}
                <span>{muted ? "×" : done ? "✓" : "…"}</span>
              </span>
            );
          })}
        </div>

        {done ? (
          <button
            type="button"
            className="try-action ok"
            onClick={() => {
              haptic.tap();
              setI((n) => n + 1);
            }}
          >
            {t.practice.tryNext}
          </button>
        ) : manual ? (
          <button type="button" className="try-action" onClick={() => setConfirmed(true)}>
            {t.practice.tryHeard}
          </button>
        ) : (
          <button type="button" className="try-action" aria-live="polite">
            {t.practice.tryListening}
          </button>
        )}
      </section>
    </div>
  );
}
