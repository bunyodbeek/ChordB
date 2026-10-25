import { useCallback, useEffect, useRef, useState } from "react";

import type { SongSummary } from "../api";
import type { NotationKind } from "../notation";
import { inTelegram, useBackButton } from "../telegram";
import { t } from "../texts";
import type { PresetId } from "../tuning";
import { AnalyzeCard } from "./AnalyzeCard";
import type { PremiumReason } from "./PremiumSheet";
import { AdminSongs } from "./admin/AdminSongs";
import { AnalysisPlayer } from "./AnalysisPlayer";
import { Screen } from "./Screen";
import { ChordEditor } from "./admin/ChordEditor";
import { SongForm } from "./admin/SongForm";
import { SongsList } from "./SongsList";

type View =
  | { name: "list" }
  | { name: "analysis"; id: number }
  | { name: "analyze" }
  | { name: "admin" }
  | { name: "form"; id: number | null }
  | { name: "editor"; id: number };

interface Props {
  notation: NotationKind;
  isAdmin: boolean;
  onFullscreen: (on: boolean) => void; // everything but the list hides the nav
  onOpenTuner: (preset: PresetId) => void;
  onOpenSong: (id: number) => void; // the player is its own page, /songs/:id
  onPaywall: (song: SongSummary) => void;
  isPremium: boolean;
  onPremium: (reason: PremiumReason) => void;
}

// The screen stack outlives the tab: after "Tyunerni ochish" and back, the same screen is open.
let savedStack: View[] = [{ name: "list" }];

/** The Qoʻshiqlar tab: a small stack of screens; back pops one. */
export function Songs({
  notation,
  isAdmin,
  onFullscreen,
  onOpenTuner,
  onOpenSong,
  onPaywall,
  isPremium,
  onPremium,
}: Props) {
  const [stack, setStack] = useState<View[]>(savedStack);
  savedStack = stack;
  const view = stack[stack.length - 1];

  const pop = useCallback(() => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s)), []);
  // Inside Telegram its BackButton pops. In a plain browser (local testing) the browser's
  // own back button does, through history entries; the screens never draw one.
  const depth = useRef(1); // history entries this stack pushed, +1
  useEffect(() => {
    if (inTelegram) return;
    const onPop = () => {
      depth.current = Math.max(1, depth.current - 1);
      pop();
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [pop]);
  const push = useCallback((v: View) => {
    if (!inTelegram) {
      history.pushState({ ...history.state, songs: true }, ""); // keeps routes.ts's depth
      depth.current++;
    }
    setStack((s) => [...s, v]);
  }, []);
  const replace = useCallback((v: View) => setStack((s) => [...s.slice(0, -1), v]), []);
  // Stable, so Telegram's back button and child effects aren't re-run every render.
  const back = useCallback(() => {
    if (!inTelegram && depth.current > 1) history.back(); // popstate pops the screen
    else pop();
  }, [pop]);

  useEffect(() => {
    onFullscreen(view.name !== "list");
    window.scrollTo(0, 0);
  }, [view, onFullscreen]);
  useEffect(() => () => onFullscreen(false), [onFullscreen]);

  let screen;
  switch (view.name) {
    case "list":
      screen = (
        <SongsList
          notation={notation}
          isAdmin={isAdmin}
          onOpen={(s) => onOpenSong(s.id)}
          onLocked={onPaywall}
          onAdmin={isAdmin ? () => push({ name: "admin" }) : undefined}
          onAnalyze={() => push({ name: "analyze" })}
          onLimit={() => onPremium({ kind: "analyze" })}
        />
      );
      break;
    case "analyze":
      screen = (
        <AnalyzeScreen
          notation={notation}
          onBack={back}
          onOpen={(id) => push({ name: "analysis", id })}
          onLimit={() => onPremium({ kind: "analyze" })}
        />
      );
      break;
    case "analysis":
      screen = (
        <AnalysisPlayer
          key={view.id}
          analysisId={view.id}
          notation={notation}
          onBack={back}
          onOpenTuner={onOpenTuner}
          locks={{ isPremium, onPremium }}
        />
      );
      break;
    case "admin":
      screen = (
        <AdminSongs
          onBack={back}
          onOpen={(id) => push({ name: "form", id })}
          onNew={() => push({ name: "form", id: null })}
        />
      );
      break;
    case "form":
      screen = (
        <SongForm
          key={view.id ?? "new"}
          songId={view.id}
          notation={notation}
          onBack={back}
          onCreated={(id) => replace({ name: "form", id })}
          onMarkChords={(id) => push({ name: "editor", id })}
        />
      );
      break;
    case "editor":
      screen = <ChordEditor key={view.id} songId={view.id} notation={notation} onBack={back} />;
      break;
  }

  return screen;
}

function AnalyzeScreen({
  notation,
  onBack,
  onOpen,
  onLimit,
}: {
  notation: NotationKind;
  onBack: () => void;
  onOpen: (analysisId: number) => void;
  onLimit: () => void;
}) {
  useBackButton(onBack);
  return (
    <Screen title={t.analyze.title} onBack={onBack} bodyClassName="scroll-y padded">
      <AnalyzeCard notation={notation} onOpen={onOpen} onLimit={onLimit} />
    </Screen>
  );
}
