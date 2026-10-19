import { useState } from "react";

import { QUALITIES, prefersFlat } from "../chords";
import { noteName, type NotationKind } from "../notation";
import { haptic } from "../telegram";
import { t } from "../texts";
import { ChordCard } from "./ChordCard";
import { NotationToggle } from "./NotationToggle";

const ROOTS = Array.from({ length: 12 }, (_, pc) => pc);

interface Props {
  notation: NotationKind;
  onNotationChange: (n: NotationKind) => void;
}

export function Chords({ notation, onNotationChange }: Props) {
  const [root, setRoot] = useState(9); // A: a friendly place to start
  const flat = prefersFlat(root);

  return (
    <div className="page">
      <header className="tuner-header">
        <div>
          <h1>{t.tabs.chords}</h1>
          <div className="subtitle">{t.chordsHint}</div>
        </div>
        <NotationToggle value={notation} onChange={onNotationChange} />
      </header>

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

      <div className="chord-grid">
        {QUALITIES.map((quality) => (
          <ChordCard key={quality} chord={{ root, quality, flat }} notation={notation} />
        ))}
      </div>
    </div>
  );
}
