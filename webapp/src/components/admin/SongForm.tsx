// Admin: create or edit a song's details. Not in the design specs; same tokens as the rest.
import { useEffect, useState } from "react";

import { ApiError, api, type Difficulty, type SongDetail, type SongInput } from "../../api";
import { prefersFlat } from "../../chords";
import { parseDuration, parseYouTubeId } from "../../editor";
import { noteName, type NotationKind } from "../../notation";
import { haptic, useBackButton } from "../../telegram";
import { formatTime } from "../../timeline";
import { t } from "../../texts";

const DIFFICULTIES: Difficulty[] = ["easy", "medium", "hard"];
const LANGUAGES = ["uz", "ru", "en"];
const MAX_CAPO = 12;

interface Props {
  songId: number | null; // null: new song
  notation: NotationKind;
  onBack: () => void;
  onCreated: (id: number) => void;
  onMarkChords: (id: number) => void;
}

export function SongForm({ songId, notation, onBack, onCreated, onMarkChords }: Props) {
  useBackButton(onBack);
  const [loaded, setLoaded] = useState<SongDetail | null>(null);
  const [title, setTitle] = useState("");
  const [artist, setArtist] = useState("");
  const [youtube, setYoutube] = useState("");
  const [keyRoot, setKeyRoot] = useState(9);
  const [keyMinor, setKeyMinor] = useState(true);
  const [capo, setCapo] = useState(0);
  const [difficulty, setDifficulty] = useState<Difficulty>("easy");
  const [language, setLanguage] = useState("uz");
  const [premium, setPremium] = useState(false);
  const [duration, setDuration] = useState("");
  const [published, setPublished] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (songId === null) return;
    let cancelled = false;
    api.song(songId).then(
      (s) => {
        if (cancelled) return;
        setLoaded(s);
        setTitle(s.title);
        setArtist(s.artist);
        setYoutube(`https://youtu.be/${s.youtube_id}`);
        setKeyRoot(s.key.root);
        setKeyMinor(s.key.quality === "min");
        setCapo(s.capo);
        setDifficulty(s.difficulty);
        setLanguage(s.language);
        setPremium(s.is_premium);
        setDuration(formatTime(s.duration_sec));
        setPublished(s.is_published);
      },
      () => !cancelled && setMessage({ ok: false, text: t.loadFailed }),
    );
    return () => {
      cancelled = true;
    };
  }, [songId]);

  const videoId = parseYouTubeId(youtube);
  const seconds = parseDuration(duration);

  const save = async () => {
    if (!title.trim() || !artist.trim()) return setMessage({ ok: false, text: t.admin.form.required });
    if (!videoId) return setMessage({ ok: false, text: t.admin.form.youtubeBad });
    if (!seconds) return setMessage({ ok: false, text: t.admin.form.durationBad });
    const body: SongInput = {
      title: title.trim(),
      artist: artist.trim(),
      youtube_id: videoId,
      key: { root: keyRoot, quality: keyMinor ? "min" : "maj" },
      capo,
      difficulty,
      language,
      is_premium: premium,
      duration_sec: seconds,
    };
    setBusy(true);
    try {
      if (songId === null) {
        const created = await api.admin.create(body);
        haptic.success();
        onCreated(created.id);
      } else {
        setLoaded(await api.admin.update(songId, body));
        setMessage({ ok: true, text: t.admin.form.saved });
        haptic.success();
      }
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  const togglePublished = async (on: boolean) => {
    if (songId === null) return;
    setPublished(on);
    try {
      await api.admin.publish(songId, on);
      setMessage(null);
    } catch (e) {
      setPublished(!on);
      setMessage({ ok: false, text: e instanceof ApiError ? e.message : String(e) });
    }
  };

  return (
    <div className="page songs-page form-page">
      <span className="editor-admin">{t.admin.label}</span>
      <h1 className="songs-h1">{songId === null ? t.admin.form.newTitle : t.admin.form.editTitle}</h1>

      {songId !== null && !loaded && !message ? (
        <div className="center muted">{t.loading}</div>
      ) : (
        <>
          <label className="form-field">
            <span>{t.admin.form.title}</span>
            <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <label className="form-field">
            <span>{t.admin.form.artist}</span>
            <input className="input" value={artist} onChange={(e) => setArtist(e.target.value)} />
          </label>
          <label className="form-field">
            <span>{t.admin.form.youtube}</span>
            <input
              className="input"
              value={youtube}
              inputMode="url"
              placeholder="https://youtu.be/…"
              onChange={(e) => setYoutube(e.target.value)}
            />
            {youtube.trim() && !videoId && <small className="form-error">{t.admin.form.youtubeBad}</small>}
          </label>

          <div className="form-field">
            <span>{t.admin.form.key}</span>
            <div className="sheet-options">
              {Array.from({ length: 12 }, (_, pc) => (
                <button
                  key={pc}
                  type="button"
                  className="filter-chip"
                  aria-pressed={pc === keyRoot}
                  onClick={() => setKeyRoot(pc)}
                >
                  {noteName(pc, notation, prefersFlat(pc))}
                </button>
              ))}
            </div>
            <div className="segmented">
              <button type="button" className={keyMinor ? "" : "selected"} onClick={() => setKeyMinor(false)}>
                major
              </button>
              <button type="button" className={keyMinor ? "selected" : ""} onClick={() => setKeyMinor(true)}>
                minor
              </button>
            </div>
          </div>

          <div className="form-row">
            <div className="form-field">
              <span>{t.admin.form.capo}</span>
              <div className="ton">
                <button type="button" aria-label="−1" onClick={() => setCapo((c) => Math.max(0, c - 1))}>
                  −
                </button>
                <span>{capo}</span>
                <button
                  type="button"
                  aria-label="+1"
                  onClick={() => setCapo((c) => Math.min(MAX_CAPO, c + 1))}
                >
                  +
                </button>
              </div>
            </div>
            <label className="form-field">
              <span>{t.admin.form.duration}</span>
              <input
                className="input"
                value={duration}
                inputMode="numeric"
                placeholder="3:12"
                onChange={(e) => setDuration(e.target.value)}
              />
            </label>
          </div>

          <div className="form-field">
            <span>{t.admin.form.difficulty}</span>
            <div className="segmented">
              {DIFFICULTIES.map((d) => (
                <button
                  key={d}
                  type="button"
                  className={difficulty === d ? "selected" : ""}
                  onClick={() => setDifficulty(d)}
                >
                  {t.songs.levels[d]}
                </button>
              ))}
            </div>
          </div>

          <div className="form-field">
            <span>{t.admin.form.language}</span>
            <div className="segmented">
              {LANGUAGES.map((l) => (
                <button
                  key={l}
                  type="button"
                  className={language === l ? "selected" : ""}
                  onClick={() => setLanguage(l)}
                >
                  {t.admin.form.languages[l]}
                </button>
              ))}
            </div>
          </div>

          <div className="card form-switches">
            <label className="card-row">
              <span className="card-label">{t.admin.form.premium}</span>
              <input
                type="checkbox"
                className="switch"
                checked={premium}
                onChange={(e) => setPremium(e.target.checked)}
              />
            </label>
            {songId !== null && (
              <label className="card-row">
                <span className="card-label">{t.admin.form.published}</span>
                <input
                  type="checkbox"
                  className="switch"
                  checked={published}
                  onChange={(e) => void togglePublished(e.target.checked)}
                />
              </label>
            )}
          </div>

          {message && (
            <p className={`editor-status ${message.ok ? "ok" : "error"}`} role="status">
              {message.text}
            </p>
          )}

          <button type="button" className="button wide" disabled={busy} onClick={save}>
            {songId === null ? t.admin.form.create : t.admin.form.save}
          </button>
          {songId !== null && (
            <button type="button" className="button wide secondary" onClick={() => onMarkChords(songId)}>
              {t.admin.form.markChords}
            </button>
          )}
        </>
      )}
    </div>
  );
}
