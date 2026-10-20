import type { NotationKind } from "../notation";
import { STANDARD, stringName, type GuitarString } from "../tuning";

// Drawing coordinates; the HTML buttons are placed in % of the same box.
const W = 320;
const H = 380;
const NUT_Y = 270;
const PEG_Y = [60, 125, 190]; // top to bottom
const PEG_X = { left: 114, right: 206 };
const BTN_X = { left: 40, right: 280 };
const BTN = 56;

// 3+3 headstock: strings 4, 5, 6 on the left (top to bottom), 3, 2, 1 on the right.
const PEGS = [
  ...[4, 5, 6].map((number, i) => ({ number, side: "left" as const, y: PEG_Y[i] })),
  ...[3, 2, 1].map((number, i) => ({ number, side: "right" as const, y: PEG_Y[i] })),
];

/** x of a string at the nut: low E on the left. */
const nutX = (number: number) => 124 + (6 - number) * 14.4;

interface Props {
  notation: NotationKind;
  active: number | null; // string being tuned (detected or locked)
  tuned: ReadonlySet<number>;
  onSelect: (number: number) => void;
  strings?: GuitarString[]; // the tuning preset; standard by default
  flat?: boolean; // spell accidentals with flats
}

export function Headstock({
  notation,
  active,
  tuned,
  onSelect,
  strings = STANDARD,
  flat = false,
}: Props) {
  return (
    <div className="headstock" style={{ aspectRatio: `${W} / ${H}` }}>
      <svg viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
        {/* Connectors from the buttons to the pegs. */}
        {PEGS.map(({ number, side, y }) => (
          <line
            key={`c${number}`}
            className="hs-connector"
            x1={side === "left" ? BTN_X.left + BTN / 2 : PEG_X.right}
            x2={side === "left" ? PEG_X.left : BTN_X.right - BTN / 2}
            y1={y}
            y2={y}
          />
        ))}

        <path
          className="hs-body"
          d={`M 90 28 Q 90 0 118 0 L 202 0 Q 230 0 230 28 L 222 ${NUT_Y} L 98 ${NUT_Y} Z`}
        />
        <rect className="hs-neck" x={108} y={NUT_Y} width={104} height={H - NUT_Y} />
        <line className="hs-fret" x1={108} x2={212} y1={NUT_Y + 62} y2={NUT_Y + 62} />
        <circle className="hs-dot" cx={160} cy={NUT_Y + 88} r={4} />

        {/* Logo: two nested arcs. */}
        <path className="hs-logo" d="M 172 206 A 15 15 0 1 0 172 230" />
        <path className="hs-logo" d="M 166 212 A 7 7 0 1 0 166 224" />

        {/* Inactive strings first so the active one is drawn on top. */}
        {[...PEGS]
          .sort((a, b) => Number(a.number === active) - Number(b.number === active))
          .map(({ number, side, y }) => (
            <polyline
              key={`s${number}`}
              className={`hs-string${number === active ? " active" : ""}`}
              points={`${PEG_X[side]},${y} ${nutX(number)},${NUT_Y} ${nutX(number)},${H}`}
            />
          ))}
        <rect className="hs-nut" x={108} y={NUT_Y - 3} width={104} height={7} rx={1.5} />

        {PEGS.map(({ number, side, y }) => (
          <circle
            key={`p${number}`}
            className={`hs-peg${number === active ? " active" : ""}`}
            cx={PEG_X[side]}
            cy={y}
            r={8}
          />
        ))}
      </svg>

      {PEGS.map(({ number, side, y }) => {
        const s = strings.find((x) => x.number === number)!;
        const isTuned = tuned.has(number);
        return (
          <button
            key={number}
            className={[
              "string-btn",
              number === active && "active",
              isTuned && "tuned",
            ]
              .filter(Boolean)
              .join(" ")}
            style={{
              left: `${((BTN_X[side] - BTN / 2) / W) * 100}%`,
              top: `${((y - BTN / 2) / H) * 100}%`,
              width: `${(BTN / W) * 100}%`,
              height: `${(BTN / H) * 100}%`,
            }}
            onClick={() => onSelect(number)}
            aria-label={`${number}-tor`}
          >
            <span className="string-btn-name">{stringName(s.pc, notation, flat)}</span>
            <span className="string-btn-sub">{isTuned ? "✓" : s.octave}</span>
          </button>
        );
      })}
    </div>
  );
}
