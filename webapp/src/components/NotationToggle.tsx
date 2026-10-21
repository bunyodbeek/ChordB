import type { NotationKind } from "../notation";
import { haptic } from "../telegram";
import { t } from "../texts";

const OPTIONS: { kind: NotationKind; label: string }[] = [
  { kind: "letter", label: "ABC" },
  { kind: "solfege", label: "Do Re Mi" },
];

export function NotationToggle({
  value,
  onChange,
}: {
  value: NotationKind;
  onChange: (n: NotationKind) => void;
}) {
  return (
    <div className="notation-toggle" role="radiogroup" aria-label={t.notationLabel}>
      {OPTIONS.map(({ kind, label }) => (
        <button
          key={kind}
          role="radio"
          aria-checked={value === kind}
          className={kind === "letter" ? "mono" : ""}
          onClick={() => {
            if (value === kind) return;
            haptic.tap();
            onChange(kind);
          }}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
