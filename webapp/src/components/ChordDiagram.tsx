import { diagramLayout, type Frets, type Voicing } from "../chords";

export interface MiniColors {
  fg: string; // nut, ×/○ marks, base fret
  line: string; // strings and frets
  dot: string;
}

const MINI_TOP = 14;

/**
 * The player's chord box — song-player-v2.reference.html. `big` is the "Hozir" card.
 * Barre shapes get a bar across the barred strings and "N-lad" under the grid; above
 * the first fret a thin line replaces the nut.
 */
export function MiniChordDiagram({
  frets,
  colors,
  label,
  big = false,
}: {
  frets: Frets | null;
  colors: MiniColors;
  label: string;
  big?: boolean;
}) {
  const sp = big ? 12 : 10;
  const fr = big ? 16 : 13;
  const dot = big ? 12 : 10;
  const l = frets ? diagramLayout(frets) : null;
  const rows = l?.rows ?? 4;
  const gridW = 5 * sp + 1;
  const gridH = rows * fr;
  const w = 5 * sp + 8;
  const h = MINI_TOP + gridH + 18;
  const y = (row: number) => MINI_TOP + (row - 0.5) * fr;

  return (
    <svg
      role="img"
      aria-label={label}
      className="mini-diagram"
      width={w}
      height={h}
      viewBox={`-4 0 ${w} ${h}`}
    >
      {l?.marks.map((m, i) =>
        m ? (
          <text key={`t${i}`} x={i * sp} y={9} fontSize={10} textAnchor="middle" fill={colors.fg}>
            {m === "x" ? "×" : "○"}
          </text>
        ) : null,
      )}
      <rect x={0} y={MINI_TOP} width={gridW} height={l && l.base > 1 ? 1 : 3} fill={colors.fg} />
      {Array.from({ length: rows }, (_, k) => (
        <rect key={`f${k}`} x={0} y={MINI_TOP + (k + 1) * fr} width={gridW} height={1} fill={colors.line} />
      ))}
      {Array.from({ length: 6 }, (_, i) => (
        <rect key={`s${i}`} x={i * sp} y={MINI_TOP} width={1} height={gridH} fill={colors.line} />
      ))}
      {l?.barre && (
        <rect
          x={l.barre.from * sp - dot / 2 + 0.5}
          y={y(l.barre.row) - dot / 2}
          width={(l.barre.to - l.barre.from) * sp + dot}
          height={dot}
          rx={dot / 2}
          fill={colors.dot}
        />
      )}
      {l?.dots.map((d) => (
        <circle key={`d${d.string}`} cx={d.string * sp + 0.5} cy={y(d.row)} r={dot / 2} fill={colors.dot} />
      ))}
      {l && l.base > 1 && (
        <text
          x={0}
          y={MINI_TOP + gridH + 14}
          fontSize={11}
          fontWeight={600}
          fontFamily="var(--mono)"
          fill={colors.fg}
        >
          {l.base}-lad
        </text>
      )}
    </svg>
  );
}

const LEFT = 18;
const GAP_X = 14; // between strings
const TOP = 24;
const GAP_Y = 18; // between frets
const RIGHT = LEFT + GAP_X * 5;

/** Classic chord box for the Akkordlar tab: same rules as the player's, larger. */
export function ChordDiagram({ voicing }: { voicing: Voicing }) {
  const l = diagramLayout(voicing.frets);
  const rows = Math.max(5, l.rows);
  const bottom = TOP + GAP_Y * rows;
  const x = (i: number) => LEFT + i * GAP_X;
  const y = (row: number) => TOP + (row - 0.5) * GAP_Y;

  return (
    <svg className="chord-diagram" viewBox={`0 0 ${RIGHT + 12} ${bottom + 18}`} aria-hidden="true">
      <rect
        className="cd-nut"
        x={LEFT - 1}
        y={l.base > 1 ? TOP - 1 : TOP - 4}
        width={RIGHT - LEFT + 2}
        height={l.base > 1 ? 1.5 : 4}
        rx={l.base > 1 ? 0 : 1}
      />
      {Array.from({ length: rows }, (_, i) => (
        <line key={`f${i}`} className="cd-fret" x1={LEFT} x2={RIGHT} y1={TOP + (i + 1) * GAP_Y} y2={TOP + (i + 1) * GAP_Y} />
      ))}
      {voicing.frets.map((_, i) => (
        <line key={`s${i}`} className="cd-string" x1={x(i)} x2={x(i)} y1={TOP} y2={bottom} />
      ))}
      {l.barre && (
        <rect
          className="cd-dot"
          x={x(l.barre.from) - 6}
          y={y(l.barre.row) - 6}
          width={x(l.barre.to) - x(l.barre.from) + 12}
          height={12}
          rx={6}
        />
      )}
      {l.marks.map((m, i) =>
        m === "x" ? (
          <text key={`m${i}`} className="cd-mark" x={x(i)} y={TOP - 9} textAnchor="middle">
            ×
          </text>
        ) : m === "o" ? (
          <circle key={`m${i}`} className="cd-open" cx={x(i)} cy={TOP - 13} r={3.5} />
        ) : null,
      )}
      {l.dots.map((d) => (
        <circle key={`d${d.string}`} className="cd-dot" cx={x(d.string)} cy={y(d.row)} r={6} />
      ))}
      {l.base > 1 && (
        <text className="cd-base" x={LEFT - 1} y={bottom + 14}>
          {l.base}-lad
        </text>
      )}
    </svg>
  );
}
