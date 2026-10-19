import { strum } from "../audio";
import { voicing } from "../chords";
import { formatChord, type Chord, type NotationKind } from "../notation";
import { haptic } from "../telegram";
import { ChordDiagram } from "./ChordDiagram";

/** A tappable chord: name + diagram; tapping strums it. */
export function ChordCard({
  chord,
  notation,
  compact = false,
}: {
  chord: Chord;
  notation: NotationKind;
  compact?: boolean;
}) {
  const v = voicing(chord);
  return (
    <button
      className={`chord-card${compact ? " compact" : ""}`}
      onClick={() => {
        haptic.tap();
        strum(v.frets);
      }}
    >
      <span className="chord-name">{formatChord(chord, notation)}</span>
      <ChordDiagram voicing={v} />
    </button>
  );
}
