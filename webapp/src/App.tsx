import { useCallback, useEffect, useState } from "react";

import { api, type Me, type Settings, type SongSummary } from "./api";
import { ChordEditor } from "./components/admin/ChordEditor";
import { Chords } from "./components/Chords";
import { Home } from "./components/Home";
import { NotationPicker } from "./components/NotationPicker";
import { Practice } from "./components/Practice";
import { PremiumSheet, type PremiumReason } from "./components/PremiumSheet";
import { Profile } from "./components/Profile";
import { SongPlayer } from "./components/SongPlayer";
import { Songs } from "./components/Songs";
import { StrumTrainer } from "./components/StrumTrainer";
import { Tuner } from "./components/Tuner";
import { BottomNav, type Tab } from "./components/ui";
import { isTab, useRouter } from "./routes";
import { hideSplash } from "./splash";
import { parseStart } from "./startLink";
import { getInitData, startParam } from "./telegram";
import { t } from "./texts";
import { loadPreset, savePreset, type PresetId } from "./tuning";

type Load =
  | { state: "loading" }
  | { state: "error"; message: string; canRetry: boolean }
  | { state: "ready"; me: Me };

export default function App() {
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const { route, go, back } = useRouter();
  // The nav's highlighted tab: the route's, or for /tuner and /chords the tab they were
  // opened from (the nav stays under them).
  const [lastTab, setLastTab] = useState<Tab>(isTab(route) ? route.name : "home");
  const tab = isTab(route)
    ? route.name
    : route.name.startsWith("song")
      ? "songs"
      : route.name === "strum"
        ? "practice"
        : lastTab;
  useEffect(() => setLastTab(tab), [tab]);
  const [fullscreen, setFullscreen] = useState(false); // a tab's own inner screen hides the nav
  // Locked song (or null: from a premium card) the premium sheet was opened for.
  // What opened the premium sheet; null = closed. Anything premium stays visible, with a
  // lock, and opens this.
  const [paywall, setPaywall] = useState<PremiumReason | null>(null);
  const showPaywall = useCallback((song: SongSummary) => setPaywall({ kind: "song", song }), []);
  const [preset, setPreset] = useState<PresetId>(loadPreset); // remembered on this device
  const [earResume, setEarResume] = useState<string | null>(null); // the profile's "Davom ettirish"

  const changePreset = useCallback((id: PresetId) => {
    setPreset(id);
    savePreset(id);
  }, []);
  // "Tyunerni ochish" in the song player: the tuner, already in that song's tuning.
  const openTuner = useCallback(
    (id: PresetId) => {
      changePreset(id);
      go({ name: "tuner" });
    },
    [changePreset, go],
  );
  const openSong = useCallback(
    (song: SongSummary) => (song.locked ? showPaywall(song) : go({ name: "song", id: song.id })),
    [go, showPaywall],
  );

  // On a cold start the splash (index.html) stays up until this has answered; the app
  // renders as it fades.
  const fetchMe = useCallback(() => {
    if (!getInitData()) {
      void hideSplash().then(() =>
        setLoad({ state: "error", message: t.openInTelegram, canRetry: false }),
      );
      return;
    }
    setLoad({ state: "loading" });
    api.me().then(
      async (me) => {
        // A t.me/…?startapp= link: the server reads it from initData; a Web App button
        // (e.g. the practice reminder without BOT_USERNAME) passes it in the URL instead.
        const link = parseStart(startParam());
        const songId = me.start_song_id ?? link.songId;
        // Otherwise the app opens where the URL points: Asosiy (/) on a normal launch.
        if (songId !== null) {
          go({ name: "song", id: songId }, { replace: true }); // ← goes to the list
        } else if (me.start_tab === "practice" || link.practice) {
          go({ name: "practice" }, { replace: true });
        }
        await hideSplash();
        setLoad({ state: "ready", me });
        // Practice days follow the phone's midnight; tell the server its zone once.
        const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        if (zone && me.settings.timezone !== zone) {
          api.patchSettings({ timezone: zone }).then(
            (next) => setLoad((l) => (l.state === "ready" ? { ...l, me: next } : l)),
            () => {},
          );
        }
      },
      async () => {
        await hideSplash();
        setLoad({ state: "error", message: t.loadFailed, canRetry: true });
      },
    );
  }, [go]);

  useEffect(fetchMe, [fetchMe]);

  const markWriteAccessAsked = useCallback(
    () =>
      setLoad((l) =>
        l.state === "ready" ? { ...l, me: { ...l.me, needs_write_access: false } } : l,
      ),
    [],
  );

  if (load.state === "loading") {
    // Under the splash on a cold start; on a retry, a plain line.
    return <div className="center muted">{t.loading}</div>;
  }
  if (load.state === "error") {
    return (
      <div className="center">
        <p className="message">{load.message}</p>
        {load.canRetry && (
          <button className="button" onClick={fetchMe}>
            {t.retry}
          </button>
        )}
      </div>
    );
  }

  const me = load.me;
  const premium = me.is_premium || me.is_admin; // admins see everything unlocked
  const setMe = (next: Me) => setLoad({ state: "ready", me: next });

  // Optimistic: show the change at once, roll back if the server refuses it.
  const updateSettings = async (patch: Partial<Settings>) => {
    setMe({ ...me, settings: { ...me.settings, ...patch } });
    try {
      setMe(await api.patchSettings(patch));
    } catch {
      setMe(me);
    }
  };

  if (me.settings.notation === null) {
    return <NotationPicker onPick={(notation) => updateSettings({ notation })} />;
  }

  const notation = me.settings.notation;
  const setNotation = (n: typeof notation) => updateSettings({ notation: n });
  let page;
  switch (route.name) {
    case "tuner":
      page = (
        <Tuner
          onBack={back}
          notation={notation}
          onNotationChange={setNotation}
          needsWriteAccess={me.needs_write_access}
          onWriteAccessAsked={markWriteAccessAsked}
          preset={preset}
          onPresetChange={changePreset}
        />
      );
      break;
    case "chords":
      page = <Chords onBack={back} notation={notation} />;
      break;
    case "strum":
      page = <StrumTrainer onBack={back} onPremium={setPaywall} />;
      break;
    case "song":
      page = (
        <SongPlayer
          key={route.id}
          songId={route.id}
          notation={notation}
          onBack={back}
          onPaywall={showPaywall}
          isPremium={premium}
          onPremium={setPaywall}
          onEdit={me.is_admin ? () => go({ name: "song-edit", id: route.id }) : undefined}
          onOpenTuner={openTuner}
        />
      );
      break;
    case "song-edit":
      page = <ChordEditor key={route.id} songId={route.id} notation={notation} onBack={back} />;
      break;
    case "home":
      page = (
        <Home
          firstName={me.first_name}
          isPremium={me.is_premium}
          notation={notation}
          onOpenTuner={() => go({ name: "tuner" })}
          onOpenChords={() => go({ name: "chords" })}
          onOpenSong={openSong}
          onAllSongs={() => go({ name: "songs" })}
          onPremium={() => setPaywall({ kind: "general" })}
        />
      );
      break;
    case "practice":
      page = (
        <Practice
          notation={notation}
          onFullscreen={setFullscreen}
          onTune={() => go({ name: "tuner" })}
          onStrum={() => go({ name: "strum" })}
          earResume={earResume}
          isPremium={premium}
          onPremium={setPaywall}
        />
      );
      break;
    case "songs":
      page = (
        <Songs
          notation={notation}
          isAdmin={me.is_admin}
          onFullscreen={setFullscreen}
          onOpenTuner={openTuner}
          onOpenSong={(id) => go({ name: "song", id })}
          onPaywall={showPaywall}
          isPremium={premium}
          onPremium={setPaywall}
        />
      );
      break;
    case "profile":
      page = (
        <Profile
          me={me}
          onChange={updateSettings}
          onPremium={() => setPaywall({ kind: "general" })}
          onResumeEar={(runId) => {
            setEarResume(runId);
            go({ name: "practice" });
          }}
        />
      );
      break;
  }
  // The player and its editor are full-screen pages; a tab's own inner screens (a game,
  // the song form) say so through onFullscreen.
  const hideNav = route.name === "song" || route.name === "song-edit" || fullscreen;

  return (
    <div className="app">
      <main className={`content${hideNav ? " fullscreen" : ""}`}>{page}</main>
      {!hideNav && (
        <BottomNav
          tab={tab}
          onChange={(next) => {
            setEarResume(null);
            go({ name: next });
          }}
        />
      )}
      {paywall && <PremiumSheet reason={paywall} onClose={() => setPaywall(null)} />}
    </div>
  );
}
