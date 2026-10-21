// Sozlash — tuner-v2.reference.html. Listens as soon as the mic is allowed; auto mode
// picks the nearest string, tapping a key locks one ("Avto" in the app bar goes back).
import { useEffect, useRef, useState } from "react";

import { api } from "../api";
import type { NotationKind } from "../notation";
import { centsOff } from "../pitch";
import { canRequestWriteAccess, haptic, requestWriteAccess } from "../telegram";
import { t } from "../texts";
import {
  IN_TUNE_CENTS,
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
import { Screen } from "./Screen";

const HOLD_MS = 600; // a string must stay in tune this long to count as tuned

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
  const lastTarget = useRef<GuitarString | null>(null);
  const tuning = presetById(preset);
  const strings = tuning.strings;

  // Another tuning: every string has a new target, so start over.
  useEffect(() => {
    setTuned(new Set());
    setSelected(null);
    lastTarget.current = null;
    inTuneSince.current = null;
  }, [preset]);

  const locked = selected !== null ? strings.find((s) => s.number === selected)! : null;
  const target = locked ?? (freq !== null ? nearestString(freq, strings) : null);
  const cents = freq !== null && target ? centsOff(freq, target.freq) : null;
  if (target) lastTarget.current = target;
  const shownTarget = target ?? lastTarget.current;
  const inTune = cents !== null && Math.abs(cents) <= IN_TUNE_CENTS;

  // Mark a string tuned once it has stayed in the green zone for HOLD_MS.
  useEffect(() => {
    if (!inTune || !target) {
      inTuneSince.current = null;
      return;
    }
    const now = performance.now();
    const n = target.number;
    if (inTuneSince.current?.string !== n) {
      inTuneSince.current = { string: n, at: now };
    } else if (now - inTuneSince.current.at >= HOLD_MS && !tuned.has(n)) {
      haptic.success();
      setTuned((prev) => new Set(prev).add(n));
    }
  }, [freq, inTune, target, tuned]);

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

  // Only problems get a line; a working tuner shows the meter and nothing else.
  let problem: { text: string; onClick?: () => void } | null = null;
  if (status === "blocked") problem = { text: t.tapToStart };
  else if (status === "denied") problem = { text: t.micDenied, onClick: () => void start() };
  else if (status === "unavailable") problem = { text: t.micUnavailable };

  const right = (
    <>
      {preset !== "standard" && (
        <button
          type="button"
          className="bar-chip"
          aria-label={t.backToStandard}
          onClick={() => {
            haptic.tap();
            onPresetChange("standard");
          }}
        >
          {t.presets[preset]} ×
        </button>
      )}
      {selected !== null && (
        <button
          type="button"
          className="bar-chip auto"
          aria-label={t.backToAuto}
          onClick={() => {
            haptic.tap();
            setSelected(null);
          }}
        >
          <span aria-hidden="true" className="auto-dot" />
          {t.auto}
        </button>
      )}
      <NotationToggle value={notation} onChange={onNotationChange} />
    </>
  );

  return (
    <Screen title={t.tuneTitle} right={right} className="tuner" bodyClassName="tuner-body">
      <Meter
        cents={cents}
        label={shownTarget ? stringName(shownTarget.pc, notation, tuning.flat) : ""}
      />
      {problem &&
        (problem.onClick ? (
          <button type="button" className="tuner-problem action" onClick={problem.onClick}>
            {problem.text}
          </button>
        ) : (
          <p className="tuner-problem" role="status">
            {problem.text}
          </p>
        ))}
      <Headstock
        notation={notation}
        strings={strings}
        flat={tuning.flat}
        active={target?.number ?? null}
        tuned={tuned}
        onSelect={(n) => {
          haptic.tap();
          setSelected(n);
        }}
      />
    </Screen>
  );
}
