import { diagramLayout, fingering, type Frets } from "../chords";

// The v3 chord box (chords-library-v3 / song-player-v4): 4+ frets, ×/○ above the nut,
// a rounded bar for a barre, and above the first fret only the fret number ("6"), left
// of the grid on the barre's row. Open shapes have no number.
// pad: room left of the first string (and, +2, right of the last); col: the fret
// number's column; fs: its size. sm and md are the references' numbers exactly.
const SIZES = {
  sm: { sp: 11, fr: 14, r: 5, pad: 4, col: 12, fs: 11 }, // the library grid
  md: { sp: 14, fr: 24, r: 6, pad: 4, col: 12, fs: 11 }, // the player's strip
  lg: { sp: 30, fr: 36, r: 12, pad: 12, col: 18, fs: 15 }, // the ear test
} as const;

export type DiagramSize = keyof typeof SIZES;

const D_TOP = 14; // the ×/○ row above the nut

export function ChordDiagram({
  frets,
  label,
  size = "sm",
  tone = "accent",
  fingers = false,
}: {
  frets: Frets;
  label: string; // e.g. "Am akkordi diagrammasi"
  size?: DiagramSize;
  tone?: "accent" | "green"; // green: the ear test's right answer
  fingers?: boolean; // the finger number in each dot (lg: the games' chord box)
}) {
  const { sp, fr, r, pad, col, fs } = SIZES[size];
  const l = diagramLayout(frets);
  const fretNo = l.base > 1 ? l.base : null;
  const left = pad + (fretNo ? col : 0);
  const gridW = 5 * sp;
  const gridH = l.rows * fr;
  const w = left + gridW + pad + 2;
  const h = D_TOP + gridH + 4;
  const x = (i: number) => left + i * sp;
  const y = (row: number) => D_TOP + (row - 0.5) * fr;
  // The first dotted row: where the barre is, else the lowest fretted note.
  const firstRow = l.barre?.row ?? Math.min(...l.dots.map((d) => d.row));
  const finger = fingers ? fingering(frets) : null;
  const fingerY = (row: number) => y(row) + r * 0.36;

  return (
    <svg
      role="img"
      aria-label={label}
      className={`cdg${tone === "green" ? " green" : ""}`}
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
    >
      {l.marks.map((m, i) =>
        m === "x" ? (
          <path key={`m${i}`} className="cdg-mark-x" d={`M${x(i) - 3.5} 3.5l7 7M${x(i) + 3.5} 3.5l-7 7`} />
        ) : m === "o" ? (
          <circle key={`m${i}`} className="cdg-open" cx={x(i)} cy={7} r={3.6} />
        ) : null,
      )}
      <rect className="cdg-nut" x={left} y={D_TOP} width={gridW} height={fretNo ? 1.2 : 3} />
      {Array.from({ length: l.rows }, (_, k) => (
        <rect key={`f${k}`} className="cdg-line" x={left} y={D_TOP + (k + 1) * fr} width={gridW} height={1} />
      ))}
      {Array.from({ length: 6 }, (_, i) => (
        <rect key={`s${i}`} className="cdg-line" x={x(i) - 0.5} y={D_TOP} width={1} height={gridH} />
      ))}
      {l.barre && (
        <rect
          className="cdg-dot"
          x={x(l.barre.from) - r}
          y={y(l.barre.row) - r}
          width={x(l.barre.to) - x(l.barre.from) + 2 * r}
          height={2 * r}
          rx={r}
        />
      )}
      {l.barre && finger && (
        <text className="cdg-finger" x={x(l.barre.from)} y={fingerY(l.barre.row)} textAnchor="middle">
          1
        </text>
      )}
      {l.dots.map((d) => (
        <circle key={`d${d.string}`} className="cdg-dot" cx={x(d.string)} cy={y(d.row)} r={r} />
      ))}
      {finger &&
        l.dots.map((d) => (
          <text key={`n${d.string}`} className="cdg-finger" x={x(d.string)} y={fingerY(d.row)} textAnchor="middle">
            {finger[d.string] ?? ""}
          </text>
        ))}
      {fretNo && (
        <text className="cdg-fret" x={left - 6} y={y(firstRow) + fs * 0.36} textAnchor="end" fontSize={fs}>
          {fretNo}
        </text>
      )}
    </svg>
  );
}
