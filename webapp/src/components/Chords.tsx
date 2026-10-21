import { useState } from "react";

import { QUALITIES, prefersFlat } from "../chords";
import { noteName, type NotationKind } from "../notation";
import { haptic } from "../telegram";
import { t } from "../texts";
import { ChordCard } from "./ChordCard";
import { NotationToggle } from "./NotationToggle";
import { Screen } from "./Screen";
import { SoundStatus } from "./SoundStatus";

const ROOTS = Array.from({ length: 12 }, (_, pc) => pc);

interface Props {
  notation: NotationKind;
  onNotationChange: (n: NotationKind) => void;
}

export function Chords({ notation, onNotationChange }: Props) {
  const [root, setRoot] = useState(9); // A: a friendly place to start
  const flat = prefersFlat(root);

  return (
    <Screen
      title={t.tabs.chords}
      right={<NotationToggle value={notation} onChange={onNotationChange} />}
      bodyClassName="chords-body"
    >
      <SoundStatus />

      <div className="chips" role="radiogroup">
        {ROOTS.map((pc) => (
          <button
            key={pc}
            role="radio"
            aria-checked={pc === root}
            className={`chip${pc === root ? " selected" : ""}`}
            onClick={() => {
              haptic.tap();
              setRoot(pc);
            }}
          >
            {noteName(pc, notation, prefersFlat(pc))}
          </button>
        ))}
      </div>

      <div className="chord-grid scroll-y">
        {QUALITIES.map((quality) => (
          <ChordCard key={quality} chord={{ root, quality, flat }} notation={notation} />
        ))}
      </div>
    </Screen>
  );
}
