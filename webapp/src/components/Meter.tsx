// Cents meter — tuner-v2.reference.html: 358×64, a tick every 5 cents (3.4 px per cent),
// long ticks every 25, a green zone around 0. The value is only exposed to assistive
// tech (role="meter"); nothing is printed.
import { t } from "../texts";
import { IN_TUNE_CENTS } from "../tuning";

const RANGE = 50;
const W = 358;
const PX_PER_CENT = 3.4;
const ZONE_W = 16;

const x = (cents: number) =>
  ((W / 2 + Math.max(-RANGE, Math.min(RANGE, cents)) * PX_PER_CENT) / W) * 100;

const TICKS = Array.from({ length: 21 }, (_, i) => -RANGE + i * 5);

interface Props {
  cents: number | null; // null: nothing heard
  label: string; // the string's name, for the value text
}

export function Meter({ cents, label }: Props) {
  const inTune = cents !== null && Math.abs(cents) <= IN_TUNE_CENTS;
  const rounded = cents === null ? 0 : Math.round(Math.max(-RANGE, Math.min(RANGE, cents)));
  const text =
    cents === null
      ? t.meter.silent
      : inTune
        ? t.meter.inTune(label)
        : rounded < 0
          ? t.meter.flat(label, -rounded)
          : t.meter.sharp(label, rounded);

  return (
    <div
      className="meter"
      role="meter"
      aria-label={t.meter.label}
      aria-valuemin={-RANGE}
      aria-valuemax={RANGE}
      aria-valuenow={rounded}
      aria-valuetext={text}
    >
      <div className="meter-zone" style={{ left: `${((W - ZONE_W) / 2 / W) * 100}%`, width: `${(ZONE_W / W) * 100}%` }} />
      {TICKS.map((c) => (
        <span
          key={c}
          className={`meter-tick${c % 25 === 0 ? " major" : ""}${c === 0 ? " zero" : ""}`}
          style={{ left: `${x(c)}%` }}
        />
      ))}
      <div
        className={`meter-needle${cents === null ? " idle" : inTune ? " in-tune" : ""}`}
        style={{ left: `${x(cents ?? 0)}%` }}
      />
      <span className="meter-label low">{t.low}</span>
      <span className="meter-label high">{t.high}</span>
    </div>
  );
}
