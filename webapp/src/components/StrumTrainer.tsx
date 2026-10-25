// Ritm mashqi — strum-trainer.reference.html: pick a pattern, play along with the
// metronome; with the mic on, each slot is judged and the accuracy of the last four
// bars opens the next tempo (60 → 80 → 100 → 120). The server keeps the progress.
import { useCallback, useEffect, useRef, useState } from "react";

import { ApiError, api, type StrumPattern, type StrumProgress } from "../api";
import { BARS_JUDGED, nextUnlock, patternLabel, strokes, type SlotResult } from "../strum";
import { haptic, useBackButton } from "../telegram";
import { t } from "../texts";
import { useStrumTrainer } from "../useStrumTrainer";
import { ChordStrum } from "./ChordStrum";
import type { PremiumReason } from "./PremiumSheet";
import { Screen } from "./Screen";
import { Chip, PrimaryButton } from "./ui";

const BPM_MIN = 50;
const BPM_MAX = 140;
const BPM_STEP = 5;
const START_MAX = 120; // a fresh pattern opens at its unlocked tempo, at most this

interface Props {
  onBack: () => void;
  onPremium: (reason: PremiumReason) => void;
}

const DOT: Record<SlotResult, string> = { on: "on", off: "off", extra: "off", miss: "", rest: "" };

const openOf = (progress: StrumProgress | null, patternId: number | null): number =>
  progress?.patterns.find((p) => p.pattern_id === patternId)?.unlocked_bpm ?? 60;

export function StrumTrainer({ onBack, onPremium }: Props) {
  useBackButton(onBack);
  const [patterns, setPatterns] = useState<StrumPattern[] | null>(null);
  const [progress, setProgress] = useState<StrumProgress | null>(null);
  const [failed, setFailed] = useState(false);
  const [patternId, setPatternId] = useState<number | null>(null);
  const [bpm, setBpm] = useState(60);
  const [micWanted, setMicWanted] = useState(true);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(() => {
    setFailed(false);
    Promise.all([api.strum.patterns(), api.strum.progress()]).then(
      ([ps, pr]) => {
        setPatterns(ps);
        setProgress(pr);
        // The first open pattern, at the tempo it has reached.
        const first = ps.find((p) => !p.locked) ?? ps[0];
        if (first) {
          setPatternId(first.id);
          setBpm(Math.min(openOf(pr, first.id), START_MAX));
        }
      },
      () => setFailed(true),
    );
  }, []);
  useEffect(load, [load]);

  const pattern = patterns?.find((p) => p.id === patternId) ?? null;
  const unlocked = openOf(progress, patternId);
  const maxBpm = Math.min(BPM_MAX, unlocked);

  // The session's best four-bar accuracy at this tempo; sent on 90% at once (so the next
  // tempo opens), otherwise when the session stops.
  const best = useRef<{ key: string; acc: number; sent: number }>({ key: "", acc: 0, sent: 0 });
  const session = `${patternId}:${bpm}`;
  const send = useCallback(
    (key: string, acc: number) => {
      const [pid, b] = key.split(":").map(Number);
      const before = openOf(progress, pid);
      best.current.sent = Math.max(best.current.sent, acc);
      api.strum.save(pid, b, Math.round(acc * 1000) / 1000).then(
        (pr) => {
          setProgress(pr);
          const after = openOf(pr, pid);
          if (after > before) {
            haptic.success();
            setToast(t.strum.unlocked(after));
          }
        },
        (e) => {
          if (e instanceof ApiError && e.isPaywall && pattern) onPremium({ kind: "strum", name: pattern.name });
        },
      );
    },
    [progress, pattern, onPremium],
  );

  const trainer = useStrumTrainer((acc, bars) => {
    const b = best.current;
    if (b.key !== session) best.current = { key: session, acc: 0, sent: 0 };
    if (acc === null || bars < BARS_JUDGED) return;
    best.current.acc = Math.max(best.current.acc, acc);
    if (acc >= (progress?.unlock_accuracy ?? 0.9) && acc > best.current.sent) send(session, acc);
  });

  const flush = useCallback(() => {
    const b = best.current;
    if (b.key && b.acc > b.sent) send(b.key, b.acc);
  }, [send]);

  const stop = () => {
    trainer.stop();
    flush();
  };
  // Anything that changes what is being played starts it again from the top.
  const restart = (next: { patternId?: number; bpm?: number; mic?: boolean }) => {
    const p = patterns?.find((x) => x.id === (next.patternId ?? patternId));
    if (!trainer.running || !p) return;
    flush();
    void trainer.start({ pattern: strokes(p.slots), bpm: next.bpm ?? bpm, mic: next.mic ?? micWanted });
  };

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 2500);
    return () => clearTimeout(id);
  }, [toast]);
  // Leaving the page: keep what was played.
  const flushRef = useRef(flush);
  flushRef.current = flush;
  useEffect(() => () => flushRef.current(), []);
  // The mic was refused: the toggle goes off and the reason shows under it.
  useEffect(() => {
    if (trainer.mic === "denied" || trainer.mic === "unavailable") setMicWanted(false);
  }, [trainer.mic]);

  const pick = (p: StrumPattern) => {
    if (p.locked) return onPremium({ kind: "strum", name: p.name });
    if (p.id === patternId) return;
    const nextBpm = Math.min(openOf(progress, p.id), START_MAX);
    setPatternId(p.id);
    setBpm(nextBpm);
    restart({ patternId: p.id, bpm: nextBpm });
  };
  const changeBpm = (delta: number) => {
    haptic.tap();
    const next = Math.max(BPM_MIN, Math.min(maxBpm, bpm + delta));
    if (next === bpm) return;
    setBpm(next);
    restart({ bpm: next });
  };

  if (!patterns || !progress) {
    return (
      <Screen title={t.strum.title} sub={t.strum.sub} onBack={onBack} bodyClassName="strum-body scroll-y">
        {failed ? (
          <div className="song-list-note">
            <p>{t.strum.loadFailed}</p>
            <button type="button" className="button" onClick={load}>
              {t.retry}
            </button>
          </div>
        ) : (
          <div className="song-list-note muted">{t.loading}</div>
        )}
      </Screen>
    );
  }

  const slots = pattern ? strokes(pattern.slots) : [];
  const listening = trainer.running && trainer.mic === "on";
  const opens = nextUnlock(progress.ladder, unlocked, BPM_MAX);
  const hint =
    opens === null ? t.strum.allOpen : bpm >= unlocked ? t.strum.unlocks(opens) : t.strum.raiseTo(unlocked);
  const micNote =
    trainer.mic === "denied" ? t.strum.micDenied : trainer.mic === "unavailable" ? t.strum.micUnavailable : null;
  const acc = trainer.accuracy;

  return (
    <Screen title={t.strum.title} sub={t.strum.sub} onBack={onBack} bodyClassName="strum-body scroll-y">
      <div className="chip-row" role="group" aria-label={t.strum.patterns}>
        {patterns.map((p) => (
          <Chip key={p.id} selected={p.id === patternId} locked={p.locked} onClick={() => pick(p)}>
            {p.name}
          </Chip>
        ))}
      </div>

      {pattern && (
        <section className="strum-card" aria-label={t.strum.rhythmOf(pattern.name)}>
          <div className="strum-card-head">
            <span className="strum-card-title">{t.strum.rhythmOf(pattern.name)}</span>
            <span className="strum-card-label">{patternLabel(pattern.slots)}</span>
          </div>
          <div className="strum-slots">
            {slots.map((s, i) => {
              const now = trainer.running && trainer.slot === i;
              return (
                <div key={i} className={`strum-big${now ? " now" : ""}${s === "-" ? " rest" : ""}`}>
                  <span className="strum-big-arrow">
                    <ChordStrum stroke={s} size={28} />
                  </span>
                  <span className={`strum-count${i % 2 ? " and" : ""}`}>{t.strum.count[i]}</span>
                </div>
              );
            })}
          </div>
          {micWanted && (
            <>
              <div className="strum-dots" aria-hidden="true">
                {slots.map((_, i) => {
                  const r = trainer.results[i];
                  return <span key={i} className={r ? DOT[r] : ""} />;
                })}
              </div>
              <div className="strum-legend">
                <span>
                  <span className="on" />
                  {t.strum.onTime}
                </span>
                <span>
                  <span className="off" />
                  {t.strum.offTime}
                </span>
              </div>
            </>
          )}
        </section>
      )}

      <div className="strum-stats">
        <div className="strum-stat">
          <span className="strum-stat-label">{t.strum.tempo}</span>
          <div className="strum-tempo">
            <button type="button" aria-label={t.strum.slower} disabled={bpm <= BPM_MIN} onClick={() => changeBpm(-BPM_STEP)}>
              −
            </button>
            <span className="strum-tempo-value" aria-live="polite">
              <span className="mono">{bpm}</span>
              <span className="strum-stat-label">{t.strum.bpm}</span>
            </span>
            <button type="button" aria-label={t.strum.faster} disabled={bpm >= maxBpm} onClick={() => changeBpm(BPM_STEP)}>
              +
            </button>
          </div>
        </div>
        <div className="strum-stat">
          <span className="strum-stat-label">{t.strum.accuracy}</span>
          <span className={`strum-acc mono${acc !== null && acc >= progress.unlock_accuracy ? " good" : ""}`}>
            {micWanted && acc !== null ? `${Math.round(acc * 100)}%` : "—"}
          </span>
          <span className="strum-stat-label">{micWanted ? hint : t.strum.noMic}</span>
        </div>
      </div>

      <label className="strum-mic">
        <span className={`strum-mic-icon${listening ? " on" : ""}`} aria-hidden="true">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
            strokeLinecap="round" strokeLinejoin="round">
            <rect x="9" y="3" width="6" height="11" rx="3" />
            <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
          </svg>
        </span>
        <span className="strum-mic-text">
          <span className="strum-mic-title">{t.strum.mic}</span>
          <span className="strum-stat-label">{micNote ?? t.strum.micSub}</span>
        </span>
        <input
          type="checkbox"
          className="switch"
          checked={micWanted}
          onChange={(e) => {
            haptic.tap();
            setMicWanted(e.target.checked);
            restart({ mic: e.target.checked });
          }}
        />
      </label>

      {toast && (
        <p className="strum-toast" role="status">
          {toast}
        </p>
      )}

      <PrimaryButton
        wide
        className="strum-go"
        disabled={!pattern}
        onClick={() => {
          haptic.tap();
          if (trainer.running) stop();
          else if (pattern) void trainer.start({ pattern: slots, bpm, mic: micWanted });
        }}
      >
        {trainer.running ? (
          <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            <rect x="6" y="5" width="4" height="14" rx="1" />
            <rect x="14" y="5" width="4" height="14" rx="1" />
          </svg>
        ) : (
          <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            <path d="M8 5v14l11-7z" />
          </svg>
        )}
        {trainer.running ? t.strum.stop : t.strum.start}
      </PrimaryButton>
    </Screen>
  );
}
