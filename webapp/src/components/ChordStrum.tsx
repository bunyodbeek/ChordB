// A strumming stroke as an arrow: ↓ down, ↑ up, • rest, × chuck (song-player-v4 and
// strum-trainer.reference.html). Drawn in currentColor; the rest dot is always grey.
import type { Stroke } from "../strum";
import { t } from "../texts";

export function ChordStrum({ stroke, size = 14, weight = 2.6 }: { stroke: Stroke; size?: number; weight?: number }) {
  const label = t.strum.strokes[stroke];
  if (stroke === "-") {
    return (
      <svg role="img" aria-label={label} width={size} height={size} viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="2.2" fill="var(--diagram-line)" />
      </svg>
    );
  }
  const path = stroke === "D" ? "M12 3v17M5 13l7 7 7-7" : stroke === "U" ? "M12 21V4M5 11l7-7 7 7" : "M6 6l12 12M18 6L6 18";
  return (
    <svg
      role="img"
      aria-label={label}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={weight}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={path} />
    </svg>
  );
}
