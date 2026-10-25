// Akkordni tuzatish — a bottom sheet over the player: the chord's time and name, the 12
// roots (named the way the song's key writes them), five types, the diagram and ▶ to
// hear it. The user's own song is fixed at once; a catalog song gets a suggestion.
import { useState } from "react";

import type { ChordJson } from "../../api";
import { playChord } from "../../audio/player";
import { voicing } from "../../chords";
import { spell, type Key } from "../../harmony";
import { formatChord, noteName, type NotationKind, type Quality } from "../../notation";
import { haptic } from "../../telegram";
import { formatTime } from "../../timeline";
import { t } from "../../texts";
import { ChordDiagram } from "../ChordDiagram";

const TYPES: Quality[] = ["maj", "min", "7", "m7", "sus4"];

export interface EditTarget {
  index: number; // the event
  start: number;
  end: number;
  chord: ChordJson;
  same: number; // events in the song with this same chord, this one included
}

export function ChordEditSheet({
  target,
  songKey,
  notation,
  mode,
  onSave,
  onClose,
}: {
  target: EditTarget;
  songKey: Key | null;
  notation: NotationKind;
  mode: "fix" | "suggest";
  onSave: (chord: ChordJson, all: boolean) => Promise<string>;
  onClose: () => void;
}) {
  const [root, setRoot] = useState(target.chord.root);
  const [quality, setQuality] = useState<Quality>(
    TYPES.includes(target.chord.quality) ? target.chord.quality : target.chord.quality === "maj7" ? "maj" : "min",
  );
  const [all, setAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const name = (c: ChordJson) => formatChord(spell(c, songKey), notation);
  const chosen = spell({ root, quality }, songKey);
  const label = formatChord(chosen, notation);
  const unchanged = root === target.chord.root && quality === target.chord.quality;

  return (
    <div className="overlay" onClick={onClose}>
      <div
        className="sheet player-sheet edit-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={t.edit.title}
        onClick={(e) => e.stopPropagation()}
      >
        <span className="sheet-handle" aria-hidden="true" />
        <div className="edit-head">
          <h2>{t.edit.title}</h2>
          <span className="muted small mono">
            {t.edit.range(formatTime(target.start), formatTime(target.end))} · {t.edit.now(name(target.chord))}
          </span>
        </div>

        <div className="sheet-block">
          <span className="card-label">{t.edit.root}</span>
          <div className="edit-roots" role="radiogroup" aria-label={t.edit.root}>
            {Array.from({ length: 12 }, (_, pc) => (
              <button
                key={pc}
                type="button"
                role="radio"
                aria-checked={pc === root}
                className="edit-chip"
                onClick={() => {
                  haptic.tap();
                  setRoot(pc);
                }}
              >
                {noteName(pc, notation, spell({ root: pc, quality }, songKey).flat)}
              </button>
            ))}
          </div>
        </div>

        <div className="sheet-block">
          <span className="card-label">{t.edit.type}</span>
          <div className="edit-types" role="radiogroup" aria-label={t.edit.type}>
            {TYPES.map((q) => (
              <button
                key={q}
                type="button"
                role="radio"
                aria-checked={q === quality}
                className="edit-chip"
                onClick={() => {
                  haptic.tap();
                  setQuality(q);
                }}
              >
                {t.edit.types[q]}
              </button>
            ))}
          </div>
        </div>

        <div className="edit-preview">
          <span className={`edit-name${notation === "solfege" ? " sol" : ""}`}>{label}</span>
          <ChordDiagram frets={voicing(chosen).frets} label={t.player.diagram(label)} size="md" />
          <button
            type="button"
            className="edit-play"
            aria-label={t.edit.play}
            onClick={() => {
              haptic.tap();
              void playChord(chosen);
            }}
          >
            <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <path d="M8 5v14l11-7z" />
            </svg>
          </button>
        </div>

        {target.same > 1 && (
          <label className="edit-all">
            <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />
            {t.edit.all(name(target.chord), target.same)}
          </label>
        )}
        {mode === "suggest" && <p className="muted small">{t.edit.suggestHint}</p>}
        {error && (
          <p className="edit-error" role="alert">
            {error}
          </p>
        )}
        <button
          type="button"
          className="btn-primary wide"
          disabled={busy || unchanged}
          onClick={async () => {
            haptic.tap();
            setBusy(true);
            setError(null);
            try {
              await onSave({ root, quality }, all);
            } catch (e) {
              setError(e instanceof Error && e.message ? e.message : t.edit.failed);
              setBusy(false);
            }
          }}
        >
          {mode === "fix" ? t.edit.save : t.edit.suggest}
        </button>
      </div>
    </div>
  );
}
