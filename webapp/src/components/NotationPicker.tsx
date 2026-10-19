import { useState } from "react";

import { formatChord, noteName, type NotationKind } from "../notation";
import { haptic } from "../telegram";
import { t } from "../texts";
import { STANDARD } from "../tuning";

const OPTIONS: { kind: NotationKind; label: string }[] = [
  { kind: "letter", label: t.letter },
  { kind: "solfege", label: t.solfege },
];

/** First-run choice between letter (E A D) and solfège (Mi Lya Re) names. */
export function NotationPicker({ onPick }: { onPick: (n: NotationKind) => void }) {
  const [choice, setChoice] = useState<NotationKind>("letter");

  return (
    <div className="page picker">
      <h1>{t.chooseNotation}</h1>
      <p className="muted">{t.chooseNotationHint}</p>

      <div className="options">
        {OPTIONS.map(({ kind, label }) => (
          <button
            key={kind}
            className={`option${choice === kind ? " selected" : ""}`}
            onClick={() => {
              haptic.tap();
              setChoice(kind);
            }}
          >
            <span className="option-label">{label}</span>
            <span className="option-example">
              {STANDARD.map((s) => noteName(s.pc, kind)).join(" ")}
            </span>
            <span className="muted">
              {formatChord({ root: 9, quality: "min" }, kind)} ·{" "}
              {formatChord({ root: 7, quality: "7" }, kind)}
            </span>
          </button>
        ))}
      </div>

      <button className="button wide" onClick={() => onPick(choice)}>
        {t.continue}
      </button>
    </div>
  );
}
