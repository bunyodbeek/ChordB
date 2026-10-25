// Mashq — practice-hub.reference.html: streak, today's three steps, the games, the chord
// collection. Games open as full screens (no tab bar); Telegram's BackButton returns.
import { useCallback, useEffect, useState } from "react";

import {
  api,
  type ChordJson,
  type EarProgress,
  type PracticeStep,
  type PracticeSummary,
  type StrumProgress,
} from "../api";
import { spelled } from "../chords";
import { formatChord, type NotationKind } from "../notation";
import { haptic } from "../telegram";
import { t } from "../texts";
import { ChordSwitchGame } from "./practice/ChordSwitchGame";
import { ChordTrySheet } from "./practice/ChordTrySheet";
import { EarTest } from "./practice/EarTest";
import type { PremiumReason } from "./PremiumSheet";
import { Screen } from "./Screen";

type View = { name: "hub" } | { name: "switch"; chain: ChordJson[] } | { name: "ear"; resume: string | null };

interface Props {
  notation: NotationKind;
  onFullscreen: (on: boolean) => void;
  onTune: () => void; // the "tune" step happens on the Sozlash tab
  onStrum: () => void; // Ritm mashqi: its own page, /practice/strum
  earResume?: string | null; // an ear-test run to continue ("Davom ettirish" in the profile)
  isPremium: boolean;
  onPremium: (reason: PremiumReason) => void;
}

const COLLECTION_PREVIEW = 8;

export function Practice({ notation, onFullscreen, onTune, onStrum, earResume = null, isPremium, onPremium }: Props) {
  const [view, setView] = useState<View>(() =>
    earResume ? { name: "ear", resume: earResume } : { name: "hub" },
  );
  const [summary, setSummary] = useState<PracticeSummary | null>(null);
  const [ear, setEar] = useState<EarProgress | null>(null);
  const [strum, setStrum] = useState<StrumProgress | null>(null);
  const [failed, setFailed] = useState(false);
  const [trying, setTrying] = useState<number | null>(null); // collection index in the sheet

  const load = useCallback(() => {
    api.practice.summary().then(
      (s) => {
        setSummary(s);
        setFailed(false);
      },
      () => setFailed(true),
    );
    api.ear.progress().then(setEar, () => {});
    api.strum.progress().then(setStrum, () => {});
  }, []);
  useEffect(load, [load]);

  useEffect(() => {
    onFullscreen(view.name !== "hub");
    if (view.name === "hub") load(); // results and steps changed while playing
  }, [view, onFullscreen, load]);
  useEffect(() => () => onFullscreen(false), [onFullscreen]);

  const back = useCallback(() => setView({ name: "hub" }), []);
  const name = (c: ChordJson) => formatChord(spelled(c), notation);

  if (view.name === "switch") {
    const best = Math.max(0, ...(summary?.bests.filter((b) => b.game === "chord_switch").map((b) => b.value) ?? []));
    return (
      <ChordSwitchGame
        key={view.chain.map((c) => `${c.root}${c.quality}`).join("-")}
        chain={view.chain}
        best={best}
        notation={notation}
        onBack={back}
        onChain={(chain) => setView({ name: "switch", chain })}
      />
    );
  }
  if (view.name === "ear") {
    return <EarTest
        notation={notation}
        resumeRunId={view.resume}
        onBack={back}
        isPremium={isPremium}
        onPremium={onPremium}
      />;
  }

  const today = summary?.today;
  const chain = today?.chain ?? [];
  const startStep = (step: PracticeStep) => {
    haptic.tap();
    if (step === "tune") onTune();
    else if (step === "chord_switch") setView({ name: "switch", chain });
    else setView({ name: "ear", resume: null });
  };
  const nextStep = today?.steps.find((s) => !today.steps_done.includes(s));
  const switchBest = summary?.bests.filter((b) => b.game === "chord_switch").map((b) => b.value) ?? [];
  const have = new Set(summary?.collection.map((c) => `${c.root}:${c.quality}`) ?? []);
  const collectible = summary?.collectible ?? [];
  const firstLocked = Math.max(0, collectible.findIndex((c) => !have.has(`${c.root}:${c.quality}`)));

  const streak = summary?.streak.current ?? 0;
  const badge = (
    <span className="streak-badge" role="img" aria-label={t.practice.streakAria(streak)}>
      <svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 2c1 4 6 6 6 12a6 6 0 0 1-12 0c0-3 2-5 3-6 0 2 1 3 2 3 0-3-1-6 1-9z" />
      </svg>
      {t.practice.streak(streak)}
    </span>
  );

  return (
    <Screen title={t.tabs.practice} right={badge} bodyClassName="practice-body scroll-y">
      {failed && !summary ? (
        <div className="song-list-note">
          <p>{t.practice.loadFailed}</p>
          <button type="button" className="button" onClick={load}>
            {t.retry}
          </button>
        </div>
      ) : !today ? (
        <div className="today-card skeleton" aria-hidden="true" />
      ) : (
        <button
          type="button"
          className="today-card"
          onClick={() => startStep(nextStep ?? "chord_switch")}
        >
          <span className="today-head">
            <span className="today-label">{t.practice.today}</span>
            <span className="today-label">{t.practice.progress(today.steps_done.length, today.steps.length)}</span>
          </span>
          <span className="today-text">
            <span className="today-chain">{chain.map(name).join(" → ")}</span>
            <span className="today-steps">
              {today.steps
                .map((s) => t.practice.stepNames[s] + (today.steps_done.includes(s) ? " ✓" : ""))
                .join(" · ")}
            </span>
          </span>
          <span className="today-bar">
            <span style={{ width: `${(today.steps_done.length / today.steps.length) * 100}%` }} />
          </span>
          <span className="today-cta">{today.completed ? t.practice.again : t.practice.continue}</span>
        </button>
      )}

      <h2 className="practice-h2">{t.practice.games}</h2>
      <GameRow
        icon="1:00"
        tone="blue"
        title={t.practice.switchTitle}
        sub={t.practice.switchSub}
        meta={switchBest.length ? t.practice.record(Math.max(...switchBest)) : ""}
        onClick={() => startStep("chord_switch")}
      />
      <GameRow
        icon="♪"
        tone="green"
        title={t.practice.earTitle}
        sub={t.practice.earSub}
        meta={ear ? t.practice.levelShort(ear.max_unlocked_level, ear.level_count) : ""}
        onClick={() => startStep("ear_test")}
      />
      <GameRow
        icon="↓↑"
        tone="amber"
        title={t.practice.rhythmTitle}
        sub={t.practice.rhythmSub}
        meta={strum?.top_bpm ? t.practice.rhythmMeta(strum.top_bpm) : ""}
        onClick={() => {
          haptic.tap();
          onStrum();
        }}
      />
      <GameRow icon="F" tone="grey" title={t.practice.barreTitle} sub={t.practice.barreSub} meta={t.practice.soon} />

      <button
        type="button"
        className="collection-card"
        disabled={!collectible.length}
        onClick={() => {
          haptic.tap();
          setTrying(firstLocked);
        }}
      >
        <span className="collection-head">
          <span className="collection-title">{t.practice.collection}</span>
          <span className="collection-count">
            {have.size}/{collectible.length || 24}
          </span>
        </span>
        <span className="collection-grid">
          {collectible.slice(0, COLLECTION_PREVIEW).map((c) => (
            <span
              key={`${c.root}:${c.quality}`}
              className={`collection-chip${have.has(`${c.root}:${c.quality}`) ? " have" : ""}`}
            >
              {formatChord(spelled(c), "letter")}
            </span>
          ))}
        </span>
      </button>

      {trying !== null && (
        <ChordTrySheet
          chords={collectible.map(spelled)}
          start={trying}
          caption={(i) => t.practice.position(i + 1, collectible.length)}
          notation={notation}
          onUnlocked={load}
          onClose={() => setTrying(null)}
        />
      )}
    </Screen>
  );
}

function GameRow({
  icon,
  tone,
  title,
  sub,
  meta,
  onClick,
}: {
  icon: string;
  tone: "blue" | "green" | "amber" | "grey";
  title: string;
  sub: string;
  meta: string;
  onClick?: () => void;
}) {
  return (
    <button type="button" className={`game-row${onClick ? "" : " soon"}`} disabled={!onClick} onClick={onClick}>
      <span className={`game-icon ${tone}`} aria-hidden="true">
        {icon}
      </span>
      <span className="game-text">
        <span className="game-title">{title}</span>
        <span className="game-sub">{sub}</span>
      </span>
      <span className={`game-meta${onClick ? "" : " muted"}`}>{meta}</span>
    </button>
  );
}
