import { useCallback, useEffect, useState } from "react";

import type { SongSummary } from "../api";
import type { NotationKind } from "../notation";
import type { PresetId } from "../tuning";
import { t } from "../texts";
import { AdminSongs } from "./admin/AdminSongs";
import { AnalysisPlayer } from "./AnalysisPlayer";
import { ChordEditor } from "./admin/ChordEditor";
import { SongForm } from "./admin/SongForm";
import { SongPlayer } from "./SongPlayer";
import { SongsList } from "./SongsList";

type View =
  | { name: "list" }
  | { name: "player"; id: number }
  | { name: "analysis"; id: number }
  | { name: "admin" }
  | { name: "form"; id: number | null }
  | { name: "editor"; id: number };

interface Props {
  notation: NotationKind;
  isAdmin: boolean;
  onFullscreen: (on: boolean) => void; // everything but the list hides the tab bar
  onOpenTuner: (preset: PresetId) => void;
}

// The screen stack outlives the tab: after "Tyunerni ochish" and back, the same song is open.
let savedStack: View[] = [{ name: "list" }];

/** The Qoʻshiqlar tab: a small stack of screens; back pops one. */
export function Songs({ notation, isAdmin, onFullscreen, onOpenTuner }: Props) {
  const [stack, setStack] = useState<View[]>(savedStack);
  savedStack = stack;
  const [paywall, setPaywall] = useState<SongSummary | null>(null);
  const view = stack[stack.length - 1];

  const push = useCallback((v: View) => setStack((s) => [...s, v]), []);
  const replace = useCallback((v: View) => setStack((s) => [...s.slice(0, -1), v]), []);
  // Stable, so Telegram's back button and child effects aren't re-run every render.
  const back = useCallback(() => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s)), []);

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
          onOpen={(s) => push({ name: "player", id: s.id })}
          onLocked={setPaywall}
          onAdmin={isAdmin ? () => push({ name: "admin" }) : undefined}
          onOpenAnalysis={(id) => push({ name: "analysis", id })}
        />
      );
      break;
    case "player":
      screen = (
        <SongPlayer
          key={view.id}
          songId={view.id}
          notation={notation}
          onBack={back}
          onPaywall={setPaywall}
          onEdit={isAdmin ? () => push({ name: "editor", id: view.id }) : undefined}
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

  return (
    <>
      {screen}
      {paywall && <PremiumSheet song={paywall} onClose={() => setPaywall(null)} />}
    </>
  );
}

function PremiumSheet({ song, onClose }: { song: SongSummary; onClose: () => void }) {
  return (
    <div className="overlay" onClick={onClose}>
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="premium-title"
        onClick={(e) => e.stopPropagation()}
      >
        <span className="tag premium">{t.songs.premium}</span>
        <h2 id="premium-title">{t.songs.premiumTitle}</h2>
        <p className="sheet-song">
          {song.title} · <span className="muted">{song.artist}</span>
        </p>
        <p className="muted">{t.songs.premiumText}</p>
        <button type="button" className="button wide" onClick={onClose}>
          {t.songs.ok}
        </button>
      </div>
    </div>
  );
}
