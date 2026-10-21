// Akkord almashtirish — game-chord-switch.reference.html. 60 seconds round a chain of
// chords (Am → C → G → F by default, or a song's); the mic hears each one and the game
// moves on with a green flash. The clock starts with the first chord heard.
import { useCallback, useEffect, useRef, useState } from "react";

import { api, type ChordJson, type SongSummary } from "../../api";
import { spelled, voicing } from "../../chords";
import { formatChord, type NotationKind } from "../../notation";
import { SWITCH_SECONDS, toJson } from "../../practice";
import { haptic, useBackButton } from "../../telegram";
import { t } from "../../texts";
import { useChordListener } from "../../useChordListener";
import { Screen } from "../Screen";
import { BigChordDiagram } from "./BigChordDiagram";
import { GameResult } from "./GameResult";

const FLASH_MS = 600;
// At most one counted switch a second: the server rejects more than 60 a minute.
const MIN_SWITCH_MS = 1000;
const CHAIN_FROM_SONG = 4;

type Phase = "ready" | "running" | "done";

interface Props {
  chain: ChordJson[];
  best: number;
  notation: NotationKind;
  onBack: () => void;
  onChain: (chain: ChordJson[]) => void;
}

export function ChordSwitchGame({ chain, best, notation, onBack, onChain }: Props) {
  useBackButton(onBack);
  const [phase, setPhase] = useState<Phase>("ready");
  const [idx, setIdx] = useState(0);
  const [switches, setSwitches] = useState(0);
  const [startAt, setStartAt] = useState(0);
  const [now, setNow] = useState(0);
  const [flash, setFlash] = useState(false);
  const [result, setResult] = useState<{ best: number; newBest: boolean } | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const flashTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const lastAdvance = useRef(0);

  const target = phase === "done" ? null : spelled(chain[idx]);
  const listener = useChordListener(target);
  const manual = listener.status === "denied" || listener.status === "unavailable";

  useEffect(() => {
    void api.event("game_start", "chord_switch");
  }, []);

  const advance = useCallback(() => {
    const at = performance.now();
    if (at - lastAdvance.current < MIN_SWITCH_MS) {
      listener.reset(); // too soon to count: listen for the same chord again
      return;
    }
    lastAdvance.current = at;
    haptic.success();
    if (phase === "ready") {
      setPhase("running");
      setStartAt(at);
      setNow(at);
    } else {
      setSwitches((n) => n + 1);
    }
    setIdx((i) => (i + 1) % chain.length);
    setFlash(true);
    clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(false), FLASH_MS);
  }, [phase, chain.length, listener.reset]);

  useEffect(() => {
    if (listener.matched && phase !== "done") advance();
    // advance only on a new match (the target changes after each one)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listener.matched]);

  // The clock.
  useEffect(() => {
    if (phase !== "running") return;
    const id = setInterval(() => setNow(performance.now()), 200);
    return () => clearInterval(id);
  }, [phase]);
  const elapsed = phase === "running" ? (now - startAt) / 1000 : 0;
  const left = Math.max(0, SWITCH_SECONDS - elapsed);

  // Time is up: save the result.
  useEffect(() => {
    if (phase !== "running" || left > 0) return;
    setPhase("done");
    const chains = Math.floor((switches + 1) / chain.length); // the first chord counts too
    api.practice
      .result("chord_switch", switches, {
        chain: chain.map(toJson),
        switches,
        chains,
        duration_sec: SWITCH_SECONDS,
      })
      .then(
        (r) => setResult({ best: r.best, newBest: r.new_best }),
        () => setSaveFailed(true),
      );
  }, [phase, left, switches, chain]);

  useEffect(() => () => clearTimeout(flashTimer.current), []);

  const again = () => {
    setPhase("ready");
    setIdx(0);
    setSwitches(0);
    setResult(null);
    setSaveFailed(false);
    listener.reset();
  };

  const name = (c: ChordJson) => formatChord(spelled(c), notation);
  const chainText = chain.map(name).join(" → ");
  const loops = Math.floor((switches + (phase === "ready" ? 0 : 1)) / chain.length);
  const shownBest = Math.max(best, result?.best ?? 0);

  if (phase === "done") {
    return (
      <Screen title={t.practice.switchTitle} bodyClassName="game-body">
        <GameResult
          title={t.practice.switchTitle}
          score={switches}
          caption={`${t.practice.switches} · ${loops} ${t.practice.chains}`}
          best={result ? result.best : null}
          newBest={result?.newBest ?? false}
          failed={saveFailed}
          shareText={t.practice.shareText(switches, chainText)}
          onAgain={again}
          onDone={onBack}
        />
      </Screen>
    );
  }

  const current = spelled(chain[idx]);
  const status = flash
    ? { text: t.practice.correct, tone: "ok" }
    : manual
      ? { text: t.practice.tapWhenPlayed, tone: "" }
      : phase === "ready"
        ? { text: t.practice.startHint, tone: "" }
        : { text: t.practice.listening, tone: "" };
  const mm = Math.floor(Math.ceil(left) / 60);
  const ss = String(Math.ceil(left) % 60).padStart(2, "0");

  return (
    <Screen
      title={t.practice.switchTitle}
      right={
        <span className="game-timer" role="timer" aria-label={t.practice.timeLeft}>
          {mm}:{ss}
        </span>
      }
      bodyClassName="game-body"
    >
      <div className="game-progress" aria-hidden="true">
        <div style={{ width: `${(left / SWITCH_SECONDS) * 100}%` }} />
      </div>
      <div className="game-main">
        <button
          type="button"
          className="game-chain"
          aria-label={`${t.practice.chain}: ${chainText}. ${t.practice.changeChain}`}
          disabled={phase !== "ready"}
          onClick={() => setChoosing(true)}
        >
          {chain.map((c, i) => (
            <span key={i} className="game-chain-item">
              <span className={`game-chip${i === idx ? " now" : i < idx ? " past" : ""}`}>{name(c)}</span>
              {i < chain.length - 1 && (
                <span aria-hidden="true" className="game-arrow">
                  →
                </span>
              )}
            </span>
          ))}
        </button>

        <button
          type="button"
          className={`game-card${flash ? " flash" : ""}`}
          aria-label={manual ? t.practice.correctAria : formatChord(current, notation)}
          aria-live="polite"
          onClick={manual ? advance : undefined}
        >
          <span className={`game-chord${notation === "solfege" ? " sol" : ""}`}>{formatChord(current, notation)}</span>
          <BigChordDiagram frets={voicing(current).frets} label={t.player.diagram(formatChord(current, notation))} />
          <span className={`game-status ${status.tone}`}>{status.text}</span>
        </button>

        <div className="game-counters">
          <div className="game-counter">
            <span className="game-counter-n">{switches}</span>
            <span className="game-counter-label">{t.practice.switches}</span>
          </div>
          <div className="game-counter">
            <span className="game-counter-n">{loops}</span>
            <span className="game-counter-label">{t.practice.chainsRecord(shownBest)}</span>
          </div>
        </div>
      </div>

      {choosing && (
        <ChainChooser
          notation={notation}
          onPick={(c) => {
            setChoosing(false);
            onChain(c);
          }}
          onClose={() => setChoosing(false)}
        />
      )}
    </Screen>
  );
}

const DEFAULT_CHAIN: ChordJson[] = [
  { root: 9, quality: "min" },
  { root: 0, quality: "maj" },
  { root: 7, quality: "maj" },
  { root: 5, quality: "maj" },
];

/** The default chain, or the first chords of a song from the catalog. */
function ChainChooser({
  notation,
  onPick,
  onClose,
}: {
  notation: NotationKind;
  onPick: (chain: ChordJson[]) => void;
  onClose: () => void;
}) {
  const [songs, setSongs] = useState<SongSummary[] | null>(null);
  useEffect(() => {
    api.songs({}).then(
      (r) => setSongs(r.songs.filter((s) => !s.locked && s.chords_preview.length >= 2)),
      () => setSongs([]),
    );
  }, []);
  const line = (c: ChordJson[]) => c.map((x) => formatChord(spelled(x), notation)).join(" → ");
  return (
    <div className="overlay" onClick={onClose}>
      <div
        className="sheet chain-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={t.practice.changeChain}
        onClick={(e) => e.stopPropagation()}
      >
        <span className="sheet-handle" aria-hidden="true" />
        <h2>{t.practice.changeChain}</h2>
        <button type="button" className="chain-option" onClick={() => onPick(DEFAULT_CHAIN)}>
          <span className="chain-option-title">{t.practice.chainDefault}</span>
        </button>
        <span className="chain-group">{t.practice.chainFromSong}</span>
        <div className="chain-list scroll-y">
          {songs === null ? (
            <p className="muted">{t.loading}</p>
          ) : (
            songs.map((s) => {
              const c = s.chords_preview.slice(0, CHAIN_FROM_SONG);
              return (
                <button key={s.id} type="button" className="chain-option" onClick={() => onPick(c)}>
                  <span className="chain-option-title">{s.title}</span>
                  <span className="chain-option-chords">{line(c)}</span>
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
