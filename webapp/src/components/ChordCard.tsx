import { useState } from "react";

import { voicings, type Frets } from "../chords";
import { formatChord, type Chord, type NotationKind } from "../notation";
import { haptic } from "../telegram";
import { t } from "../texts";
import { ChordDiagram } from "./ChordDiagram";

/** "x32010"; frets past 9 need separators: "x-10-12-12-12-10". */
export function fretString(frets: Frets): string {
  const parts = frets.map((f) => (f < 0 ? "x" : String(f)));
  return frets.some((f) => f > 9) ? parts.join("-") : parts.join("");
}

/**
 * A library card (chords-library-v3): name, diagram, the frets as text, and the same
 * "‹ 1/3 ›" voicing pager as the player's cards.
 */
export function ChordCard({
  chord,
  notation,
  onOpen,
}: {
  chord: Chord;
  notation: NotationKind;
  onOpen: () => void;
}) {
  const name = formatChord(chord, notation);
  const options = voicings(chord);
  const [pick, setPick] = useState(0);
  const { frets } = options[Math.min(pick, options.length - 1)];
  const n = options.length;
  return (
    <div className="chord-card">
      <button
        type="button"
        className="chord-card-hit"
        onClick={() => {
          haptic.tap();
          onOpen();
        }}
      >
        <span className={`chord-name${notation === "solfege" ? " sol" : ""}`}>{name}</span>
        <ChordDiagram frets={frets} label={t.player.diagram(name)} />
        <span className="chord-frets">{fretString(frets)}</span>
      </button>
      {n > 1 && (
        <span className="lane-pager">
          <button
            type="button"
            aria-label={t.player.prevVoicing}
            onClick={() => {
              haptic.tap();
              setPick((pick + n - 1) % n);
            }}
          >
            ‹
          </button>
          <span aria-label={t.player.voicingOf(pick + 1, n)}>
            {pick + 1}/{n}
          </span>
          <button
            type="button"
            aria-label={t.player.nextVoicing}
            onClick={() => {
              haptic.tap();
              setPick((pick + 1) % n);
            }}
          >
            ›
          </button>
        </span>
      )}
    </div>
  );
}
