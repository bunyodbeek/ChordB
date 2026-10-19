import type { NotationKind } from "../notation";
import { haptic } from "../telegram";

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
    <div className="segmented" role="radiogroup">
      {OPTIONS.map(({ kind, label }) => (
        <button
          key={kind}
          role="radio"
          aria-checked={value === kind}
          className={value === kind ? "selected" : ""}
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
