import { useEffect, useRef, useState } from "react";

import { api } from "../api";
import type { NotationKind } from "../notation";
import { centsOff } from "../pitch";
import { canRequestWriteAccess, haptic, requestWriteAccess } from "../telegram";
import { t } from "../texts";
import {
  IN_TUNE_CENTS,
  PRESETS,
  nearestString,
  presetById,
  stringName,
  type GuitarString,
  type PresetId,
} from "../tuning";
import { useTuner } from "../useTuner";
import { Headstock } from "./Headstock";
import { Meter } from "./Meter";
import { NotationToggle } from "./NotationToggle";

const HOLD_MS = 600; // a string must stay in tune this long to count as tuned

interface Reading {
  target: GuitarString;
  freq: number;
  cents: number;
}

interface Props {
  notation: NotationKind;
  onNotationChange: (n: NotationKind) => void;
  needsWriteAccess: boolean;
  onWriteAccessAsked: () => void;
  preset: PresetId; // remembered by App (tuning.ts savePreset)
  onPresetChange: (id: PresetId) => void;
}

export function Tuner({
  notation,
  onNotationChange,
  needsWriteAccess,
  onWriteAccessAsked,
  preset,
  onPresetChange,
}: Props) {
  const { status, freq, start } = useTuner();
  const [selected, setSelected] = useState<number | null>(null); // string number, null = auto
  const [tuned, setTuned] = useState<ReadonlySet<number>>(new Set());
  const inTuneSince = useRef<{ string: number; at: number } | null>(null);
  const lastReading = useRef<Reading | null>(null);
  const tuning = presetById(preset);
  const strings = tuning.strings;

  // Another tuning: every string has a new target, so start over.
  useEffect(() => {
    setTuned(new Set());
    setSelected(null);
    lastReading.current = null;
    inTuneSince.current = null;
  }, [preset]);

  const locked = selected !== null ? strings.find((s) => s.number === selected)! : null;
  const target = locked ?? (freq !== null ? nearestString(freq, strings) : null);
  const live: Reading | null =
    freq !== null && target ? { target, freq, cents: centsOff(freq, target.freq) } : null;
  if (live) lastReading.current = live;

  // Between plucks keep showing the last reading (dimmed) instead of blanking out.
  const held =
    !live && lastReading.current && (!locked || lastReading.current.target === locked)
      ? lastReading.current
      : null;
  const shown = live ?? held;
  const shownTarget = shown?.target ?? locked;
  const inTune = live !== null && Math.abs(live.cents) <= IN_TUNE_CENTS;

  // Mark a string tuned once it has stayed in the green zone for HOLD_MS.
  useEffect(() => {
    if (!inTune || !live) {
      inTuneSince.current = null;
      return;
    }
    const now = performance.now();
    const n = live.target.number;
    if (inTuneSince.current?.string !== n) {
      inTuneSince.current = { string: n, at: now };
    } else if (now - inTuneSince.current.at >= HOLD_MS && !tuned.has(n)) {
      haptic.success();
      setTuned((prev) => new Set(prev).add(n));
    }
  }, [freq, inTune, live, tuned]);

  useEffect(() => {
    if (status === "listening") void api.event("tuner_opened");
  }, [status]);

  // Ask to allow bot messages right after the first string is tuned: a good moment,
  // and the backend only asks once (needs_write_access).
  useEffect(() => {
    if (tuned.size !== 1 || !needsWriteAccess || !canRequestWriteAccess) return;
    onWriteAccessAsked();
    void api.event("write_access_requested");
    void requestWriteAccess().then((granted) => {
      if (granted) void api.event("write_access_granted");
    });
  }, [tuned.size, needsWriteAccess, onWriteAccessAsked]);

  const onStart = () => {
    haptic.tap();
    void start();
  };

  let pill: { text: string; tone: string; onClick?: () => void };
  switch (status) {
    case "idle":
      pill = { text: t.tapToStart, tone: "action", onClick: onStart };
      break;
    case "denied":
      pill = { text: t.micDenied, tone: "action", onClick: onStart };
      break;
    case "unavailable":
      pill = { text: t.micUnavailable, tone: "muted" };
      break;
    case "starting":
      pill = { text: t.starting, tone: "muted" };
      break;
    case "listening":
      if (!live) {
        pill = { text: tuned.size === strings.length ? t.allTuned : t.listening, tone: "muted" };
      } else if (inTune) {
        pill = { text: t.inTune, tone: "good" };
      } else {
        pill = { text: live.cents < 0 ? t.flat : t.sharp, tone: "info" };
      }
      break;
  }

  const fmtCents = (c: number) => `${c > 0 ? "+" : ""}${Math.round(c)} ${t.cent}`;

  return (
    <div className="page tuner">
      <header className="tuner-header">
        <div>
          <h1>{t.tuneTitle}</h1>
          <div className="subtitle">
            {strings.map((s) => stringName(s.pc, notation, tuning.flat)).join(" ")}
          </div>
        </div>
        <NotationToggle value={notation} onChange={onNotationChange} />
      </header>

      <div className="chips tuning-presets" role="group" aria-label={t.presetsLabel}>
        {PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            className={`chip${p.id === preset ? " selected" : ""}`}
            aria-pressed={p.id === preset}
            onClick={() => {
              haptic.tap();
              onPresetChange(p.id);
            }}
          >
            {t.presets[p.id]}
          </button>
        ))}
      </div>

      <div className="readout">
        <div className={`note${inTune ? " in-tune" : ""}${shown && !live ? " stale" : ""}`}>
          {shownTarget ? stringName(shownTarget.pc, notation, tuning.flat) : "—"}
          {shownTarget && <sub>{shownTarget.octave}</sub>}
        </div>
        <div className={`numbers${live ? "" : " stale"}`}>
          {shown
            ? `${shown.freq.toFixed(2)} Hz · ${fmtCents(shown.cents)}`
            : shownTarget
              ? `${shownTarget.freq.toFixed(2)} Hz`
              : " "}
        </div>
      </div>

      <Meter cents={live?.cents ?? null} />

      <div className="status-row">
        {pill.onClick ? (
          <button className={`pill ${pill.tone}`} onClick={pill.onClick}>
            {pill.text}
          </button>
        ) : (
          <div className={`pill ${pill.tone}`} role="status">
            {pill.text}
          </div>
        )}
        <button
          className={`auto-btn${selected === null ? " on" : ""}`}
          onClick={() => {
            haptic.tap();
            setSelected(null);
          }}
        >
          <span className="auto-dot" />
          {t.auto}
        </button>
      </div>

      <Headstock
        notation={notation}
        strings={strings}
        flat={tuning.flat}
        active={live?.target.number ?? locked?.number ?? null}
        tuned={tuned}
        onSelect={(n) => {
          haptic.tap();
          setSelected(n);
        }}
      />
    </div>
  );
}
