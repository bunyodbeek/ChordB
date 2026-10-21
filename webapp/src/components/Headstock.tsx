// Headstock — tuner-v2.reference.html. Drawn in a 390×600 box that is scaled to fill
// the space between the meter and the tab bar; the key buttons sit in % of that box.
import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";

import type { NotationKind } from "../notation";
import { STANDARD, stringName, type GuitarString } from "../tuning";

const W = 390;
const H = 600;
const KEY = 60;
const KEY_X = { left: 50, right: 340 };
const PEG_X = { left: 140, right: 250 };
// Design order: string 6 (low E) … string 1, with its peg row and the string's path.
const LAYOUT: Record<number, { side: "left" | "right"; y: number; nutX: number; gauge: number }> = {
  6: { side: "left", y: 310, nutX: 158, gauge: 2.8 },
  5: { side: "left", y: 200, nutX: 173, gauge: 2.4 },
  4: { side: "left", y: 90, nutX: 188, gauge: 2.0 },
  3: { side: "right", y: 90, nutX: 203, gauge: 1.7 },
  2: { side: "right", y: 200, nutX: 218, gauge: 1.3 },
  1: { side: "right", y: 310, nutX: 233, gauge: 1.0 },
};
const NUMBERS = [6, 5, 4, 3, 2, 1];
const ACTIVE_EXTRA = 1.4;
// On short screens the neck below the nut may be cut off, but nothing above it.
const MUST_SHOW = 470;

interface Props {
  notation: NotationKind;
  active: number | null; // string being tuned (detected or picked)
  tuned: ReadonlySet<number>;
  onSelect: (number: number) => void;
  strings?: GuitarString[];
  flat?: boolean;
}

/**
 * The 390:600 box at the largest scale that fits the parent's width and shows at least
 * everything down to the nut; on short screens the neck runs off the bottom.
 */
function useFit() {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => {
      const scale = Math.min(el.clientWidth / W, Math.max(el.clientHeight / H, el.clientHeight / MUST_SHOW));
      setSize({ w: W * scale, h: H * scale });
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, size };
}

export function Headstock({ notation, active, tuned, onSelect, strings = STANDARD, flat = false }: Props) {
  const { ref, size } = useFit();
  const overflows = size !== null && ref.current !== null && size.h > ref.current.clientHeight;
  const sol = notation === "solfege";
  // The active string is drawn last, on top of the others.
  const order = [...NUMBERS].sort((a, b) => Number(a === active) - Number(b === active));

  return (
    <div ref={ref} className={`headstock-area${overflows ? " top" : ""}`}>
      {size && (
        <div
          className="headstock"
          // --s scales the key labels with the drawing.
          style={{ width: size.w, height: size.h, "--s": size.w / W } as CSSProperties}
        >
          <svg viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
            <defs>
              <clipPath id="hs-logo">
                <path d="M85.36 85.36A50 50 0 1 1 85.36 14.64L64.14 35.86A20 20 0 1 0 64.14 64.14Z" />
              </clipPath>
            </defs>
            {[90, 200, 310].map((y) => (
              <g key={y} className="hs-connector">
                <line x1={92} y1={y} x2={126} y2={y} />
                <line x1={264} y1={y} x2={298} y2={y} />
              </g>
            ))}
            <path
              className="hs-body"
              d="M148 450 L118 360 L112 52 Q112 20 142 18 L248 18 Q278 20 278 52 L272 360 L242 450 Z"
            />
            <rect className="hs-neck" x={150} y={454} width={90} height={146} />
            <rect className="hs-fret" x={150} y={522} width={90} height={3} />
            <rect className="hs-fret" x={150} y={596} width={90} height={3} />
            <circle className="hs-dot" cx={195} cy={560} r={4} />
            <g transform="translate(181 372) scale(0.28)" clipPath="url(#hs-logo)">
              <rect x={0} y={0} width={100} height={11.9} className="hs-logo-accent" />
              <rect x={0} y={17.7} width={100} height={11.7} className="hs-logo-accent" />
              <rect x={0} y={36.2} width={100} height={10.9} className="hs-logo-accent" />
              <rect x={0} y={52.9} width={100} height={47.1} fill="#ffffff" />
            </g>
            {order.map((n) => {
              const l = LAYOUT[n];
              const on = n === active;
              return (
                <polyline
                  key={`s${n}`}
                  className={`hs-string${on ? " active" : ""}`}
                  strokeWidth={l.gauge + (on ? ACTIVE_EXTRA : 0)}
                  points={`${PEG_X[l.side]},${l.y} ${l.nutX},450 ${l.nutX},600`}
                />
              );
            })}
            <rect className="hs-nut" x={146} y={446} width={98} height={8} rx={2} />
            {NUMBERS.map((n) => {
              const l = LAYOUT[n];
              return (
                <circle
                  key={`p${n}`}
                  className={`hs-peg${n === active ? " active" : ""}`}
                  cx={PEG_X[l.side]}
                  cy={l.y}
                  r={9}
                />
              );
            })}
          </svg>

          {NUMBERS.map((n) => {
            const l = LAYOUT[n];
            const s = strings.find((x) => x.number === n)!;
            const on = n === active;
            const ok = tuned.has(n);
            const name = stringName(s.pc, notation, flat);
            return (
              <button
                key={n}
                type="button"
                className={`string-key${on ? " active" : ""}${ok ? " tuned" : ""}${sol ? " sol" : ""}`}
                aria-label={`${name}${s.octave} tori${ok ? ", sozlangan" : ""}`}
                aria-pressed={on}
                style={{
                  left: `${((KEY_X[l.side] - KEY / 2) / W) * 100}%`,
                  top: `${((l.y - KEY / 2) / H) * 100}%`,
                  width: `${(KEY / W) * 100}%`,
                  height: `${(KEY / H) * 100}%`,
                }}
                onClick={() => onSelect(n)}
              >
                {name}
                <span className="string-key-sub">{ok ? "✓" : s.octave}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
