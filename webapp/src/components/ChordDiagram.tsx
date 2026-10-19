import type { Voicing } from "../chords";

const LEFT = 18;
const GAP_X = 14; // between strings
const TOP = 24;
const GAP_Y = 18; // between frets
const FRETS = 5;
const RIGHT = LEFT + GAP_X * 5;
const BOTTOM = TOP + GAP_Y * FRETS;

/** Classic chord box: strings vertical (low E left), nut on top, X / O for muted / open. */
export function ChordDiagram({ voicing }: { voicing: Voicing }) {
  const { frets, barre } = voicing;
  const fretted = frets.filter((f) => f > 0);
  // Start at the nut when the shape fits in the first frets, else at its lowest fret.
  const base = fretted.length && Math.max(...fretted) > 4 ? Math.min(...fretted) : 1;
  const x = (i: number) => LEFT + i * GAP_X;
  const y = (fret: number) => TOP + (fret - base + 0.5) * GAP_Y;

  return (
    <svg className="chord-diagram" viewBox={`0 0 ${RIGHT + 12} ${BOTTOM + 6}`} aria-hidden="true">
      {base === 1 ? (
        <rect className="cd-nut" x={LEFT - 1} y={TOP - 4} width={RIGHT - LEFT + 2} height={4} rx={1} />
      ) : (
        <text className="cd-base" x={LEFT - 6} y={TOP + GAP_Y * 0.5 + 4} textAnchor="end">
          {base}
        </text>
      )}
      {Array.from({ length: FRETS + 1 }, (_, i) => (
        <line key={`f${i}`} className="cd-fret" x1={LEFT} x2={RIGHT} y1={TOP + i * GAP_Y} y2={TOP + i * GAP_Y} />
      ))}
      {frets.map((_, i) => (
        <line key={`s${i}`} className="cd-string" x1={x(i)} x2={x(i)} y1={TOP} y2={BOTTOM} />
      ))}

      {barre && (
        <rect
          className="cd-dot"
          x={x(barre.from) - 6}
          y={y(barre.fret) - 6}
          width={x(barre.to) - x(barre.from) + 12}
          height={12}
          rx={6}
        />
      )}
      {frets.map((f, i) => {
        if (f < 0) {
          return (
            <text key={i} className="cd-mark" x={x(i)} y={TOP - 9} textAnchor="middle">
              ×
            </text>
          );
        }
        if (f === 0) {
          return <circle key={i} className="cd-open" cx={x(i)} cy={TOP - 13} r={3.5} />;
        }
        if (barre && f === barre.fret && i >= barre.from && i <= barre.to) return null;
        return <circle key={i} className="cd-dot" cx={x(i)} cy={y(f)} r={6} />;
      })}
    </svg>
  );
}
