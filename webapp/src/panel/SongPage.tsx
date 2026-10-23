// Yangi qoʻshiq / tahrirlash — follows docs/design/admin-add-song.reference.html.
// The YouTube link is analysed by the chord-detection engine; the admin checks the
// chords, fills in the details and saves a draft or publishes.
import { useEffect, useRef, useState } from "react";

import { analysisErrorText } from "../analysis";
import { ApiError, api, errorCode, type AnalysisDetail, type Difficulty, type SongDetail, type SongInput } from "../api";
import { spelled } from "../chords";
import { parseDuration, parseYouTubeId } from "../editor";
import { formatChord, type NotationKind } from "../notation";
import { navigate } from "../router";
import { confirmDialog, copyText } from "../telegram";
import { formatTime } from "../timeline";
import { t } from "../texts";
import { useVideo } from "../useVideo";
import { changesToTimeline, chordChanges, chunk, type ChordChange } from "./format";
import { PanelLink, useLoad } from "./ui";

const DIFFICULTIES: Difficulty[] = ["easy", "medium", "hard"];
const LANGUAGES = ["uz", "ru", "en"];
const POLL_MS = 2000;
const GROUP = 8; // chord changes per group without real sections, like the analysis player
const MAX_CAPO = 12;

interface Group {
  title: string;
  chords: ChordChange[];
}

type Analysis =
  | { state: "idle" }
  | { state: "running" }
  | { state: "done"; bpm: number | null; duration: number }
  | { state: "failed"; message: string };

interface Props {
  songId: number | null; // null: a new song
  notation: NotationKind;
  prefill: { youtube: string | null; title: string | null }; // from a catalog request
}

/** "Artist - Title" (the usual YouTube title) → both parts. */
function splitTitle(raw: string): { artist: string; title: string } {
  const m = raw.match(/^(.+?)\s+[-–—]\s+(.+)$/);
  return m ? { artist: m[1].trim(), title: m[2].trim() } : { artist: "", title: raw.trim() };
}

function groupsOf(changes: ChordChange[], song: SongDetail | null): Group[] {
  if (song && song.sections.length) {
    const ids = song.events.map((e) => e.section_id);
    return song.sections
      .map((s) => ({ title: s.title, chords: changes.filter((_, i) => ids[i] === s.id) }))
      .filter((g) => g.chords.length);
  }
  return chunk(changes, GROUP).map((chords, i) => ({ title: t.analyze.part(i + 1), chords }));
}

export function SongPage({ songId, notation, prefill }: Props) {
  const [id, setId] = useState<number | null>(songId);
  const [song, setSong] = useState<SongDetail | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  const [youtube, setYoutube] = useState(prefill.youtube ? `https://youtu.be/${prefill.youtube}` : "");
  const [title, setTitle] = useState(() => (prefill.title ? splitTitle(prefill.title).title : ""));
  const [artist, setArtist] = useState(() => (prefill.title ? splitTitle(prefill.title).artist : ""));
  const [difficulty, setDifficulty] = useState<Difficulty>("easy");
  const [language, setLanguage] = useState("uz");
  const [premium, setPremium] = useState(false);
  const [keyRoot, setKeyRoot] = useState(9);
  const [keyMinor, setKeyMinor] = useState(true);
  const [capo, setCapo] = useState(0);
  const [duration, setDuration] = useState("");
  const [published, setPublished] = useState(false);

  const [changes, setChanges] = useState<ChordChange[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [timelineDirty, setTimelineDirty] = useState(false);
  const [analysis, setAnalysis] = useState<Analysis>({ state: "idle" });
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const seekRef = useRef<((sec: number) => void) | null>(null);
  const alive = useRef(true);
  useEffect(() => () => void (alive.current = false), []);

  useEffect(() => {
    if (songId === null) return;
    let cancelled = false;
    api.song(songId).then(
      (s) => {
        if (cancelled) return;
        setSong(s);
        setYoutube(`https://youtu.be/${s.youtube_id}`);
        setTitle(s.title);
        setArtist(s.artist);
        setDifficulty(s.difficulty);
        setLanguage(s.language);
        setPremium(s.is_premium);
        setKeyRoot(s.key.root);
        setKeyMinor(s.key.quality === "min");
        setCapo(s.capo);
        setDuration(formatTime(s.duration_sec));
        setPublished(s.is_published);
        const existing = s.events.map(({ time_sec, root, quality }) => ({ time_sec, root, quality, low: false }));
        setChanges(existing);
        setGroups(groupsOf(existing, s));
      },
      () => !cancelled && setLoadFailed(true),
    );
    return () => {
      cancelled = true;
    };
  }, [songId]);

  const videoId = parseYouTubeId(youtube);

  const applyAnalysis = (a: AnalysisDetail) => {
    const found = chordChanges(a.events ?? []);
    setChanges(found);
    setGroups(groupsOf(found, null));
    setTimelineDirty(true);
    if (a.key) {
      setKeyRoot(a.key.root);
      setKeyMinor(a.key.quality === "min" || a.key.quality === "m7");
    }
    const lastChange = found.at(-1)?.time_sec ?? 0;
    const secs = Math.ceil(Math.max(a.duration_sec ?? 0, lastChange + 1));
    setDuration(formatTime(secs));
    if (a.title && !title.trim() && !artist.trim()) {
      const split = splitTitle(a.title);
      setTitle(split.title);
      setArtist(split.artist);
    }
    setAnalysis({ state: "done", bpm: a.bpm, duration: secs });
  };

  const analyze = async () => {
    if (!videoId) return setStatus({ ok: false, text: t.admin.form.youtubeBad });
    if (changes.length && !(await confirmDialog(t.panel.replaceChords))) return;
    setStatus(null);
    setAnalysis({ state: "running" });
    try {
      let a = await api.analyze.youtube(`https://youtu.be/${videoId}`);
      while (a.status === "queued" || a.status === "running") {
        await new Promise((r) => setTimeout(r, POLL_MS));
        if (!alive.current) return;
        a = await api.analyze.get(a.id);
      }
      if (!alive.current) return;
      if (a.status === "failed") {
        setAnalysis({ state: "failed", message: analysisErrorText(a.error_code, "youtube") });
      } else {
        applyAnalysis(a);
      }
    } catch (e) {
      if (alive.current) setAnalysis({ state: "failed", message: analysisErrorText(errorCode(e), "youtube") });
    }
  };

  /** Create or update, then the timeline and publishing. The song's id, or null on failure. */
  const save = async (publish: boolean | null): Promise<number | null> => {
    const seconds = parseDuration(duration);
    const fail = (text: string) => {
      setStatus({ ok: false, text });
      return null;
    };
    if (!title.trim() || !artist.trim()) return fail(t.admin.form.required);
    if (!videoId) return fail(t.admin.form.youtubeBad);
    if (!seconds) return fail(t.admin.form.durationBad);
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
    setStatus(null);
    try {
      let saved = id;
      if (saved === null) {
        saved = (await api.admin.create(body)).id;
        setId(saved);
        // The page stays as it is (low-confidence marks included); a reload opens the song.
        history.replaceState(null, "", `/admin#/songs/${saved}`);
      } else {
        await api.admin.update(saved, body);
      }
      if (timelineDirty && changes.length) {
        await api.admin.timeline(saved, changesToTimeline(changes));
        setTimelineDirty(false);
      }
      if (publish !== null) {
        await api.admin.publish(saved, publish);
        setPublished(publish);
      }
      setStatus({ ok: true, text: publish ? t.panel.publishedOk : t.panel.saved });
      return saved;
    } catch (e) {
      setStatus({ ok: false, text: e instanceof ApiError ? e.message : String(e) });
      return null;
    } finally {
      setBusy(false);
    }
  };

  if (songId !== null && !song) {
    return <div className="pn-note muted">{loadFailed ? t.loadFailed : t.loading}</div>;
  }

  const low = changes.filter((c) => c.low).length;
  const chordName = (c: { root: number; quality: ChordChange["quality"] }) => formatChord(spelled(c), notation);

  return (
    <>
      <div className="pn-head">
        <div className="pn-head-title">
          <PanelLink to="#/songs" className="pn-link">
            {t.panel.backToSongs}
          </PanelLink>
          <h1>{id === null ? t.admin.form.newTitle : t.panel.editSong}</h1>
        </div>
        <div className="pn-actions">
          <button type="button" className="pn-btn big" disabled={busy} onClick={() => void save(null)}>
            {id === null || !published ? t.panel.saveDraft : t.panel.save}
          </button>
          {published ? (
            <button type="button" className="pn-btn big danger" disabled={busy} onClick={() => void save(false)}>
              {t.panel.unpublish}
            </button>
          ) : (
            <button type="button" className="pn-btn big primary" disabled={busy} onClick={() => void save(true)}>
              {t.panel.publish}
            </button>
          )}
        </div>
      </div>
      {status && (
        <p className={`pn-status ${status.ok ? "ok" : "error"}`} role="status">
          {status.text}
        </p>
      )}

      <section aria-label={t.panel.step1} className="pn-card pn-yt">
        <div className="pn-field grow">
          <label htmlFor="pn-yt" className="pn-strong">
            {t.panel.step1}
          </label>
          <input
            id="pn-yt"
            type="url"
            className="pn-input mono"
            placeholder="https://youtu.be/…"
            value={youtube}
            onChange={(e) => setYoutube(e.target.value)}
          />
        </div>
        <button
          type="button"
          className="pn-btn big ink"
          disabled={analysis.state === "running" || !videoId}
          onClick={() => void analyze()}
        >
          {analysis.state === "running" ? t.panel.analyzing : t.panel.analyze}
        </button>
        {youtube.trim() && !videoId && <span className="pn-yt-note error">{t.admin.form.youtubeBad}</span>}
        {analysis.state === "done" && (
          <span className="pn-yt-note ok">{t.panel.analysisDone(formatTime(analysis.duration))}</span>
        )}
        {analysis.state === "failed" && <span className="pn-yt-note error">{analysis.message}</span>}
      </section>

      <div className="pn-row top">
        <section aria-label={t.panel.step2} className="pn-card grow3">
          <div className="pn-card-head wrap">
            <h2>{t.panel.step2}</h2>
            <div className="pn-chips">
              <span className="pn-chip">
                {t.panel.keyLabel} <strong>{chordName({ root: keyRoot, quality: keyMinor ? "min" : "maj" })}</strong>
              </span>
              {analysis.state === "done" && analysis.bpm !== null && (
                <span className="pn-chip">
                  BPM <strong>{Math.round(analysis.bpm)}</strong>
                </span>
              )}
            </div>
          </div>
          <div className="pn-song-body">
            {videoId ? <SongVideo id={videoId} seekRef={seekRef} /> : <div className="pn-video-empty">YouTube video</div>}
            <div className="pn-groups">
              {groups.length === 0 ? (
                <p className="muted">{t.panel.noChordsYet}</p>
              ) : (
                groups.map((g, gi) => (
                  <div key={gi} className="pn-group">
                    <span className="pn-group-title">{g.title}</span>
                    <div className="pn-chord-grid">
                      {g.chords.map((c, i) => (
                        <button
                          key={i}
                          type="button"
                          className={`pn-chord${c.low ? " low" : ""}`}
                          aria-label={`${chordName(c)}, ${formatTime(c.time_sec)}${c.low ? `, ${t.panel.lowAria}` : ""}`}
                          title={formatTime(c.time_sec)}
                          onClick={() => seekRef.current?.(c.time_sec)}
                        >
                          {chordName(c)}
                        </button>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
          <div className="pn-card-foot">
            <span className="pn-legend">
              {low > 0 && (
                <>
                  <span aria-hidden="true" className="pn-legend-swatch" />
                  {t.panel.lowConfidence(low)}
                </>
              )}
            </span>
            <button
              type="button"
              className="pn-btn soft"
              disabled={busy}
              onClick={async () => {
                // The editor loads the song from the server: save what is here first.
                const saved = id === null || timelineDirty ? await save(null) : id;
                if (saved !== null) navigate(`/admin#/songs/${saved}/editor`);
              }}
            >
              {t.panel.openEditor}
            </button>
          </div>
        </section>

        <div className="pn-col grow2">
          <section aria-label={t.panel.step3} className="pn-card">
            <h2>{t.panel.step3}</h2>
            <div className="pn-form-grid">
              <label className="pn-field">
                {t.admin.form.title}
                <input className="pn-input" value={title} onChange={(e) => setTitle(e.target.value)} />
              </label>
              <label className="pn-field">
                {t.admin.form.artist}
                <input className="pn-input" value={artist} onChange={(e) => setArtist(e.target.value)} />
              </label>
              <label className="pn-field">
                {t.admin.form.difficulty}
                <select
                  className="pn-input"
                  value={difficulty}
                  onChange={(e) => setDifficulty(e.target.value as Difficulty)}
                >
                  {DIFFICULTIES.map((d) => (
                    <option key={d} value={d}>
                      {t.songs.levels[d]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="pn-field">
                {t.admin.form.language}
                <select className="pn-input" value={language} onChange={(e) => setLanguage(e.target.value)}>
                  {LANGUAGES.map((l) => (
                    <option key={l} value={l}>
                      {t.admin.form.languages[l]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="pn-field">
                {t.admin.form.key}
                <select
                  className="pn-input"
                  value={`${keyRoot}:${keyMinor ? "min" : "maj"}`}
                  onChange={(e) => {
                    const [root, q] = e.target.value.split(":");
                    setKeyRoot(Number(root));
                    setKeyMinor(q === "min");
                  }}
                >
                  {(["maj", "min"] as const).flatMap((q) =>
                    Array.from({ length: 12 }, (_, root) => (
                      <option key={`${root}:${q}`} value={`${root}:${q}`}>
                        {chordName({ root, quality: q })}
                      </option>
                    )),
                  )}
                </select>
              </label>
              <label className="pn-field">
                {t.admin.form.capo}
                <select className="pn-input" value={capo} onChange={(e) => setCapo(Number(e.target.value))}>
                  {Array.from({ length: MAX_CAPO + 1 }, (_, n) => (
                    <option key={n} value={n}>
                      {n === 0 ? t.player.noCapo : n}
                    </option>
                  ))}
                </select>
              </label>
              <label className="pn-field">
                {t.admin.form.duration}
                <input
                  className="pn-input mono"
                  value={duration}
                  inputMode="numeric"
                  placeholder="3:12"
                  onChange={(e) => setDuration(e.target.value)}
                />
              </label>
            </div>
            <label className="pn-check">
              <input type="checkbox" checked={premium} onChange={(e) => setPremium(e.target.checked)} />
              {t.admin.form.premium}
            </label>
          </section>

          <InstaLink songId={id} />
        </div>
      </div>
    </>
  );
}

function SongVideo({ id, seekRef }: { id: string; seekRef: React.RefObject<((sec: number) => void) | null> }) {
  const video = useVideo({ kind: "youtube", id }, 0);
  useEffect(() => {
    seekRef.current = video.seek;
    return () => {
      seekRef.current = null;
    };
  }, [video.seek, seekRef]);
  return (
    <div className="pn-video">
      <div ref={video.hostRef} className="video-host" />
      {video.error && (
        <p className="pn-video-error">{t.player.videoError(video.error, video.errorCode)}</p>
      )}
    </div>
  );
}

function InstaLink({ songId }: { songId: number | null }) {
  const link = useLoad(() => (songId === null ? Promise.resolve(null) : api.admin.songLink(songId)), [songId]);
  const [caption, setCaption] = useState<string | null>(null);
  const [copied, setCopied] = useState<"link" | "caption" | null>(null);
  const url = link.data?.url ?? null;
  const text = caption ?? (url ? t.panel.captionText(url) : "");

  const copy = async (what: "link" | "caption", value: string) => {
    if (await copyText(value)) {
      setCopied(what);
      setTimeout(() => setCopied(null), 1500);
    }
  };

  return (
    <section aria-label={t.panel.step4} className="pn-card pn-insta">
      <h2>{t.panel.step4}</h2>
      <span className="pn-insta-hint">{t.panel.instaHint}</span>
      {songId === null ? (
        <span className="pn-insta-hint">{t.panel.instaNeedsSave}</span>
      ) : link.data && !url ? (
        <span className="pn-insta-hint">{t.panel.instaNoLink}</span>
      ) : (
        <>
          <div className="pn-insta-row">
            <span className="pn-insta-link">{url ?? t.loading}</span>
            <button type="button" className="pn-btn small light" disabled={!url} onClick={() => url && void copy("link", url)}>
              {copied === "link" ? t.premium.copied : t.premium.copy}
            </button>
          </div>
          <label htmlFor="pn-caption" className="pn-strong">
            {t.panel.caption}
          </label>
          <textarea
            id="pn-caption"
            rows={3}
            className="pn-insta-text"
            value={text}
            onChange={(e) => setCaption(e.target.value)}
          />
          <div className="pn-insta-foot">
            <span>
              {t.panel.linkOpened}: <strong>{link.data?.opened ?? 0}</strong> · {t.panel.linkPaid}:{" "}
              <strong>{link.data?.paid ?? 0}</strong>
            </span>
            <button type="button" className="pn-btn small light" disabled={!text} onClick={() => void copy("caption", text)}>
              {copied === "caption" ? t.premium.copied : t.premium.copy}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
