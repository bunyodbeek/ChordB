import { useCallback, useEffect, useState } from "react";

import { api, type Me, type Settings } from "./api";
import { Chords } from "./components/Chords";
import { NotationPicker } from "./components/NotationPicker";
import { Practice } from "./components/Practice";
import { Profile } from "./components/Profile";
import { Songs, openSongOnLaunch } from "./components/Songs";
import { TabBar, type Tab } from "./components/TabBar";
import { Tuner } from "./components/Tuner";
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
  const [tab, setTab] = useState<Tab>("tuner");
  const [fullscreen, setFullscreen] = useState(false); // e.g. the song player hides the tab bar
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
      setTab("tuner");
    },
    [changePreset],
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
        if (songId !== null) {
          openSongOnLaunch(songId);
          setTab("songs");
        } else if (me.start_tab === "practice" || link.practice) {
          setTab("practice");
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
  }, []);

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

  return (
    <div className="app">
      <main className={`content${fullscreen ? " fullscreen" : ""}`}>
        {tab === "tuner" && (
          <Tuner
            notation={me.settings.notation}
            onNotationChange={(notation) => updateSettings({ notation })}
            needsWriteAccess={me.needs_write_access}
            onWriteAccessAsked={markWriteAccessAsked}
            preset={preset}
            onPresetChange={changePreset}
          />
        )}
        {tab === "chords" && (
          <Chords
            notation={me.settings.notation}
            onNotationChange={(notation) => updateSettings({ notation })}
          />
        )}
        {tab === "practice" && (
          <Practice
            notation={me.settings.notation}
            onFullscreen={setFullscreen}
            onTune={() => setTab("tuner")}
            earResume={earResume}
          />
        )}
        {tab === "songs" && (
          <Songs
            notation={me.settings.notation}
            isAdmin={me.is_admin}
            onFullscreen={setFullscreen}
            onOpenTuner={openTuner}
          />
        )}
        {tab === "profile" && (
          <Profile
            me={me}
            onChange={updateSettings}
            onResumeEar={(runId) => {
              setEarResume(runId);
              setTab("practice");
            }}
          />
        )}
      </main>
      {!fullscreen && (
        <TabBar
          tab={tab}
          onChange={(next) => {
            setEarResume(null);
            setTab(next);
          }}
        />
      )}
    </div>
  );
}
