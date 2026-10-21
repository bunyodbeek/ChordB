// Admin: every song, drafts included. Not in the design specs; built from the list's parts.
import { useEffect, useState } from "react";

import { api, type SongSummary } from "../../api";
import { useBackButton } from "../../telegram";
import { t } from "../../texts";

interface Props {
  onBack: () => void;
  onOpen: (id: number) => void;
  onNew: () => void;
}

export function AdminSongs({ onBack, onOpen, onNew }: Props) {
  useBackButton(onBack);
  const [songs, setSongs] = useState<SongSummary[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    api.admin.songs().then(
      (s) => !cancelled && setSongs(s),
      () => !cancelled && setFailed(true),
    );
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  return (
    <div className="page songs-page">
      <span className="editor-admin">{t.admin.label}</span>
      <h1 className="songs-h1">{t.admin.songsTitle}</h1>
      <button type="button" className="button wide" onClick={onNew}>
        {t.admin.newSong}
      </button>

      <div className="song-list">
        {failed ? (
          <div className="song-list-note">
            <p>{t.loadFailed}</p>
            <button type="button" className="button" onClick={() => setAttempt((n) => n + 1)}>
              {t.retry}
            </button>
          </div>
        ) : !songs ? (
          <div className="song-list-note muted">{t.loading}</div>
        ) : songs.length === 0 ? (
          <div className="song-list-note muted">{t.songs.empty}</div>
        ) : (
          songs.map((s) => (
            <button key={s.id} type="button" className="song-row" onClick={() => onOpen(s.id)}>
              <span className="song-text">
                <span className="song-title">{s.title}</span>
                <span className="song-artist">
                  {s.artist}
                  {s.chords_preview.length === 0 && ` · ${t.admin.noChords}`}
                </span>
              </span>
              {s.is_premium && <span className="tag premium">{t.songs.premium}</span>}
              <span className={`tag ${s.is_published ? "easy" : "draft"}`}>
                {s.is_published ? t.admin.published : t.admin.draft}
              </span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
