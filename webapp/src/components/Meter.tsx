import { t } from "../texts";
import { IN_TUNE_CENTS } from "../tuning";

const RANGE = 50; // cents shown on each side

// One tick every 5 cents; longer every 25 and at the ends.
const TICKS = Array.from({ length: 21 }, (_, i) => i);

const pos = (cents: number) => 50 + (Math.max(-RANGE, Math.min(RANGE, cents)) / RANGE) * 50;

/** Horizontal cents meter: needle left of center is flat, right is sharp. */
export function Meter({ cents }: { cents: number | null }) {
  const inTune = cents !== null && Math.abs(cents) <= IN_TUNE_CENTS;
  const zone = (IN_TUNE_CENTS / RANGE) * 50;

  return (
    <div className="meter" aria-hidden="true">
      <div className="meter-scale">
        <div className="meter-zone" style={{ left: `${50 - zone}%`, width: `${2 * zone}%` }} />
        {TICKS.map((i) => (
          <span
            key={i}
            className={`meter-tick${i % 5 === 0 ? " major" : ""}`}
            style={{ left: `${i * 5}%` }}
          />
        ))}
        <div
          className={`meter-needle${cents === null ? " idle" : ""}${inTune ? " in-tune" : ""}`}
          style={{ left: `${cents === null ? 50 : pos(cents)}%` }}
        />
      </div>
      <div className="meter-labels">
        <span>{t.low}</span>
        <span>{t.high}</span>
      </div>
    </div>
  );
}
