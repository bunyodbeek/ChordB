import { useCallback, useEffect, useState } from "react";

import { api, type Me, type Settings } from "./api";
import { Chords } from "./components/Chords";
import { NotationPicker } from "./components/NotationPicker";
import { Profile } from "./components/Profile";
import { Songs } from "./components/Songs";
import { TabBar, type Tab } from "./components/TabBar";
import { Tuner } from "./components/Tuner";
import { getInitData } from "./telegram";
import { t } from "./texts";

type Load =
  | { state: "loading" }
  | { state: "error"; message: string; canRetry: boolean }
  | { state: "ready"; me: Me };

export default function App() {
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [tab, setTab] = useState<Tab>("tuner");

  const fetchMe = useCallback(() => {
    if (!getInitData()) {
      setLoad({ state: "error", message: t.openInTelegram, canRetry: false });
      return;
    }
    setLoad({ state: "loading" });
    api.me().then(
      (me) => setLoad({ state: "ready", me }),
      () => setLoad({ state: "error", message: t.loadFailed, canRetry: true }),
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
      <main className="content">
        {tab === "tuner" && (
          <Tuner
            notation={me.settings.notation}
            onNotationChange={(notation) => updateSettings({ notation })}
            needsWriteAccess={me.needs_write_access}
            onWriteAccessAsked={markWriteAccessAsked}
          />
        )}
        {tab === "chords" && (
          <Chords
            notation={me.settings.notation}
            onNotationChange={(notation) => updateSettings({ notation })}
          />
        )}
        {tab === "songs" && <Songs notation={me.settings.notation} />}
        {tab === "profile" && <Profile me={me} onChange={updateSettings} />}
      </main>
      <TabBar
        tab={tab}
        onChange={(next) => {
          setTab(next);
          window.scrollTo(0, 0);
        }}
      />
    </div>
  );
}
