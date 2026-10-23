// The large chord box with finger numbers — game-chord-switch / chord-try designs:
// 30 px between strings, 36 px between frets, 24 px dots with the finger in them.
import { diagramLayout, fingering, type Frets } from "../../chords";

const SP = 30;
const FR = 36;
const TOP = 22;
const DOT = 24;
const PAD = 14; // room for the outer dots and the ×/○ marks

export function BigChordDiagram({
  frets,
  label,
  tone = "blue",
  barreFret = false,
}: {
  frets: Frets;
  label: string;
  tone?: "blue" | "green"; // green: the ear test's right answer
  barreFret?: boolean; // "N-lad" under every barre shape, even one at the nut (F: 1-lad)
}) {
  const l = diagramLayout(frets);
  const fingers = fingering(frets);
  const gridH = l.rows * FR;
  const y = (row: number) => TOP + (row - 0.5) * FR;
  const w = 5 * SP + 1;
  const fretLabel = l.base > 1 ? l.base : barreFret && l.barre ? l.barre.row + l.base - 1 : null;

  return (
    <svg
      role="img"
      aria-label={label}
      className={`big-diagram${tone === "green" ? " green" : ""}`}
      width={w + 2 * PAD}
      height={TOP + gridH + (fretLabel ? 22 : 6)}
      viewBox={`${-PAD} 0 ${w + 2 * PAD} ${TOP + gridH + (fretLabel ? 22 : 6)}`}
    >
      {l.marks.map((m, i) =>
        m ? (
          <text key={`m${i}`} x={i * SP} y={12} textAnchor="middle" className="bd-mark">
            {m === "x" ? "×" : "○"}
          </text>
        ) : null,
      )}
      <rect x={0} y={TOP} width={w} height={l.base > 1 ? 1.5 : 5} className="bd-nut" />
      {Array.from({ length: l.rows }, (_, k) => (
        <rect key={`f${k}`} x={0} y={TOP + (k + 1) * FR} width={w} height={1} className="bd-fret" />
      ))}
      {Array.from({ length: 6 }, (_, i) => (
        <rect key={`s${i}`} x={i * SP} y={TOP} width={1} height={gridH} className="bd-string" />
      ))}
      {l.barre && (
        <g>
          <rect
            x={l.barre.from * SP - DOT / 2 + 0.5}
            y={y(l.barre.row) - DOT / 2}
            width={(l.barre.to - l.barre.from) * SP + DOT}
            height={DOT}
            rx={DOT / 2}
            className="bd-dot"
          />
          <text x={l.barre.from * SP + 0.5} y={y(l.barre.row) + 4} textAnchor="middle" className="bd-finger">
            1
          </text>
        </g>
      )}
      {l.dots.map((d) => (
        <g key={`d${d.string}`}>
          <circle cx={d.string * SP + 0.5} cy={y(d.row)} r={DOT / 2} className="bd-dot" />
          <text x={d.string * SP + 0.5} y={y(d.row) + 4} textAnchor="middle" className="bd-finger">
            {fingers[d.string] ?? ""}
          </text>
        </g>
      ))}
      {fretLabel && (
        <text x={0} y={TOP + gridH + 16} className="bd-base">
          {fretLabel}-lad
        </text>
      )}
    </svg>
  );
}
