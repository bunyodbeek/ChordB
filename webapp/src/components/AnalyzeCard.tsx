// "Akkordlarni aniqlash" on the Qoʻshiqlar screen: a YouTube link or a gallery file
// goes to /api/analyze, the job is polled every 2 s, and the result opens in the
// song player. "Mening tahlillarim" (history) sits under it.
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";

import { analysisErrorText, analysisTitle, isActive, rememberFile } from "../analysis";
import { api, errorCode, type AnalysisHistory, type AnalysisSummary } from "../api";
import type { NotationKind } from "../notation";
import { haptic } from "../telegram";
import { t } from "../texts";
import { chordLine } from "./SongsList";

const POLL_MS = 2000;
const HISTORY_PREVIEW = 3;

type Job =
  | { phase: "idle" }
  | { phase: "sending"; progress: number | null } // null: a link, no upload progress
  | { phase: "waiting"; analysis: AnalysisSummary; mine: boolean } // queued or running
  | { phase: "error"; message: string };

interface Props {
  notation: NotationKind;
  onOpen: (analysisId: number) => void;
  onLimit: () => void; // the free daily limit was hit: the premium sheet
}

export function AnalyzeCard({ notation, onOpen, onLimit }: Props) {
  const [history, setHistory] = useState<AnalysisHistory | null>(null);
  const [job, setJob] = useState<Job>({ phase: "idle" });
  const [urlOpen, setUrlOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [showAll, setShowAll] = useState(false);
  const urlInput = useRef<HTMLInputElement>(null);
  const onOpenRef = useRef(onOpen);
  onOpenRef.current = onOpen;

  const loadHistory = useCallback(
    () =>
      api.analyze.history().then(
        (h) => {
          setHistory(h);
          return h;
        },
        () => null,
      ),
    [],
  );

  // On mount: a job still running from before (e.g. after opening a song) is resumed.
  useEffect(() => {
    loadHistory().then((h) => {
      const active = h?.items.find(isActive);
      if (active) setJob((j) => (j.phase === "idle" ? { phase: "waiting", analysis: active, mine: false } : j));
    });
  }, [loadHistory]);

  const waitingId = job.phase === "waiting" ? job.analysis.id : null;
  const mine = job.phase === "waiting" && job.mine;
  useEffect(() => {
    if (waitingId === null) return;
    let stopped = false;
    const timer = setInterval(async () => {
      let a;
      try {
        a = await api.analyze.get(waitingId);
      } catch {
        return; // a dropped poll: try again next tick
      }
      if (stopped) return;
      if (a.status === "done") {
        setJob({ phase: "idle" });
        void loadHistory();
        haptic.success();
        if (mine) onOpenRef.current(a.id);
      } else if (a.status === "failed") {
        setJob({ phase: "error", message: analysisErrorText(a.error_code, a.source) });
        void loadHistory();
      } else {
        setJob((j) => (j.phase === "waiting" ? { ...j, analysis: a } : j));
        // Keep the history row in step (queued -> running).
        setHistory((h) => h && { ...h, items: h.items.map((i) => (i.id === a.id ? a : i)) });
      }
    }, POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [waitingId, mine, loadHistory]);

  const started = (a: AnalysisSummary) => {
    void loadHistory();
    if (a.status === "done") {
      haptic.success();
      onOpen(a.id); // cache hit: no waiting at all
    } else if (a.status === "failed") {
      setJob({ phase: "error", message: analysisErrorText(a.error_code, a.source) });
    } else {
      setJob({ phase: "waiting", analysis: a, mine: true });
    }
  };

  const refused = (e: unknown, source: "upload" | "youtube") => {
    const code = errorCode(e);
    if (code === "daily_limit") onLimit();
    setJob({
      phase: "error",
      message: code ? analysisErrorText(code, source, history?.daily_limit) : t.loadFailed,
    });
    void loadHistory();
  };

  const submitUrl = async (e?: FormEvent) => {
    e?.preventDefault();
    const link = url.trim();
    if (!link) {
      urlInput.current?.focus();
      return;
    }
    haptic.tap();
    setJob({ phase: "sending", progress: null });
    try {
      started(await api.analyze.youtube(link));
      setUrl("");
    } catch (err) {
      refused(err, "youtube");
    }
  };

  const submitFile = async (file: File) => {
    haptic.tap();
    setJob({ phase: "sending", progress: 0 });
    try {
      const a = await api.analyze.file(file, (p) =>
        setJob((j) => (j.phase === "sending" ? { ...j, progress: p } : j)),
      );
      rememberFile(a.id, file); // the player plays this very file
      started(a);
    } catch (err) {
      refused(err, "upload");
    }
  };

  const paste = async () => {
    haptic.tap();
    try {
      const text = await navigator.clipboard.readText();
      if (text) setUrl(text.trim());
    } catch {
      setJob({ phase: "error", message: t.analyze.pasteFailed });
    }
    urlInput.current?.focus();
  };

  const busy = job.phase === "sending" || job.phase === "waiting";
  const left = history?.remaining_today;
  const items = history?.items ?? [];
  const shown = showAll ? items : items.slice(0, HISTORY_PREVIEW);

  return (
    <>
      <section className="analyze-card" aria-labelledby="analyze-title">
        <div className="analyze-head">
          <span className="analyze-icon" aria-hidden="true">
            <WaveIcon />
          </span>
          <div className="analyze-head-text">
            <h2 id="analyze-title">{t.analyze.title}</h2>
            <p>{t.analyze.hint}</p>
          </div>
        </div>

        <div className="analyze-actions">
          <button
            type="button"
            className={`control${urlOpen ? " active" : ""}`}
            aria-expanded={urlOpen}
            disabled={busy}
            onClick={() => {
              haptic.tap();
              setUrlOpen((o) => !o);
              setTimeout(() => urlInput.current?.focus(), 0);
            }}
          >
            {t.analyze.youtube}
          </button>
          <label className={`control analyze-file${busy ? " disabled" : ""}`}>
            {t.analyze.gallery}
            <input
              type="file"
              accept="audio/*,video/*"
              className="sr-only"
              disabled={busy}
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = ""; // the same file can be picked again
                if (f) void submitFile(f);
              }}
            />
          </label>
        </div>

        {urlOpen && (
          // noValidate + type="text": "youtu.be/…" without https:// is fine, and the
          // server's check gives an Uzbek message instead of the browser's tooltip.
          <form className="analyze-url" onSubmit={submitUrl} noValidate>
            <label htmlFor="analyze-url" className="sr-only">
              {t.analyze.urlLabel}
            </label>
            <div className="analyze-url-row">
              <input
                id="analyze-url"
                ref={urlInput}
                className="input"
                type="text"
                inputMode="url"
                autoCapitalize="off"
                spellCheck={false}
                autoComplete="off"
                placeholder={t.analyze.urlPlaceholder}
                value={url}
                disabled={busy}
                onChange={(e) => setUrl(e.target.value)}
              />
              <button type="button" className="control small" disabled={busy} onClick={paste}>
                {t.analyze.paste}
              </button>
            </div>
            <button type="submit" className="button wide" disabled={busy}>
              {t.analyze.submit}
            </button>
          </form>
        )}

        <JobStatus job={job} />

        {history && (
          <span className="analyze-left">
            {left === null || left === undefined
              ? t.analyze.unlimited
              : left > 0
                ? t.analyze.remaining(left)
                : t.analyze.noneLeft}
          </span>
        )}
      </section>

      {items.length > 0 && (
        <section className="analyze-history" aria-labelledby="analyze-history-title">
          <h2 id="analyze-history-title" className="analyze-h2">
            {t.analyze.history}
          </h2>
          <div className="song-list">
            {shown.map((a) => (
              <HistoryRow key={a.id} a={a} notation={notation} onOpen={onOpen} />
            ))}
            {!showAll && items.length > HISTORY_PREVIEW && (
              <button type="button" className="analyze-more" onClick={() => setShowAll(true)}>
                {t.analyze.showAll(items.length)}
              </button>
            )}
          </div>
        </section>
      )}
    </>
  );
}

function JobStatus({ job }: { job: Job }) {
  if (job.phase === "idle") return null;
  if (job.phase === "error") {
    return (
      <p className="analyze-status error" role="alert">
        {job.message}
      </p>
    );
  }
  const running = job.phase === "waiting" && job.analysis.status === "running";
  const text =
    job.phase === "sending"
      ? job.progress === null
        ? t.loading
        : t.analyze.uploading(Math.round(job.progress * 100))
      : running
        ? t.analyze.running
        : t.analyze.queued;
  return (
    <div className="analyze-status" role="status">
      <span className="spinner" aria-hidden="true" />
      <span>
        {text}
        {running && <span className="analyze-status-hint">{t.analyze.runningHint}</span>}
      </span>
      {job.phase === "sending" && job.progress !== null && (
        <span className="analyze-progress" aria-hidden="true">
          <span style={{ width: `${Math.round(job.progress * 100)}%` }} />
        </span>
      )}
    </div>
  );
}

function HistoryRow({
  a,
  notation,
  onOpen,
}: {
  a: AnalysisSummary;
  notation: NotationKind;
  onOpen: (id: number) => void;
}) {
  const done = a.status === "done";
  const detail =
    a.status === "done"
      ? a.chords_preview.length
        ? chordLine(a.chords_preview, notation)
        : t.analyze.noChordsFound
      : a.status === "failed"
        ? analysisErrorText(a.error_code, a.source)
        : t.analyze.status[a.status];
  return (
    <button
      type="button"
      className="song-row"
      disabled={!done}
      onClick={() => {
        haptic.tap();
        onOpen(a.id);
      }}
    >
      <span className="song-tile" aria-hidden="true">
        {a.source === "youtube" ? <PlayIcon /> : <NoteIcon />}
      </span>
      <span className="song-text">
        <span className="song-title">{analysisTitle(a)}</span>
        <span className={done ? "song-chords" : `song-artist${a.status === "failed" ? " failed" : ""}`}>
          {isActive(a) && <span className="spinner inline" aria-hidden="true" />}
          {detail}
        </span>
      </span>
    </button>
  );
}

const PlayIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
    <path d="M8 5v14l11-7z" />
  </svg>
);

const NoteIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 18V5l12-2v13" />
    <circle cx="6" cy="18" r="3" />
    <circle cx="18" cy="16" r="3" />
  </svg>
);

const WaveIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2.2" strokeLinecap="round">
    <path d="M3 12h1M7 8v8M11 4v16M15 7v10M19 10v4M21 12h0" />
  </svg>
);
