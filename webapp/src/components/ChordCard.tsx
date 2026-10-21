import { playChord } from "../audio/player";
import { voicing } from "../chords";
import { formatChord, type Chord, type NotationKind } from "../notation";
import { haptic } from "../telegram";
import { ChordDiagram } from "./ChordDiagram";

/** A tappable chord: name + diagram. Tapping strums it, or does `onOpen` when given. */
export function ChordCard({
  chord,
  notation,
  compact = false,
  onOpen,
}: {
  chord: Chord;
  notation: NotationKind;
  compact?: boolean;
  onOpen?: () => void;
}) {
  return (
    <button
      className={`chord-card${compact ? " compact" : ""}`}
      onClick={() => {
        haptic.tap();
        if (onOpen) onOpen();
        else void playChord(chord).catch(() => {});
      }}
    >
      <span className="chord-name">{formatChord(chord, notation)}</span>
      <ChordDiagram voicing={voicing(chord)} />
    </button>
  );
}
