// Admin chord editor — follows admin-chord-editor.reference.html.
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { api, type ChordJson, type SongDetail } from "../../api";
import { QUALITIES, prefersFlat, spelled } from "../../chords";
import {
  DEFAULT_OFFSET,
  SECTION_TITLES,
  addEvent,
  addSection,
  chordKey,
  formatClock,
  palette,
  roundTime,
  timelineProblem,
  type DraftEvent,
  type DraftSection,
} from "../../editor";
import { formatChord, noteName, type NotationKind, type Quality } from "../../notation";
import { confirmDialog, haptic, openLink, useBackButton } from "../../telegram";
import { t } from "../../texts";
import { useVideo } from "../../useVideo";

const SPEEDS = [1, 0.75, 0.5];
const OFFSET_KEY = "chordb.editor.offset";
const OFFSET_STEP = 0.05;
const RECENT = 5;

function loadOffset(): number {
  try {
    const raw = localStorage.getItem(OFFSET_KEY);
    const v = raw === null ? NaN : Number(raw);
    return Number.isFinite(v) ? v : DEFAULT_OFFSET;
  } catch {
    return DEFAULT_OFFSET;
  }
}

function storeOffset(v: number) {
  try {
    localStorage.setItem(OFFSET_KEY, String(v));
  } catch {
    // private mode etc.: the offset just isn't remembered
  }
}

interface Props {
  songId: number;
  notation: NotationKind;
  onBack: () => void;
}

export function ChordEditor({ songId, notation, onBack }: Props) {
  const [song, setSong] = useState<SongDetail | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    api.song(songId).then(
      (s) => !cancelled && setSong(s),
      () => !cancelled && setFailed(true),
    );
    return () => {
      cancelled = true;
    };
  }, [songId, attempt]);

  if (!song) {
    return <LoadingPage failed={failed} onBack={onBack} onRetry={() => setAttempt((n) => n + 1)} />;
  }
  return <Editor song={song} notation={notation} onBack={onBack} />;
}

function LoadingPage({
  failed,
  onBack,
  onRetry,
}: {
  failed: boolean;
  onBack: () => void;
  onRetry: () => void;
}) {
  useBackButton(onBack);
  return (
    <div className="page editor-page">
      {failed ? (
        <div className="song-list-note">
          <p>{t.loadFailed}</p>
          <button type="button" className="button" onClick={onRetry}>
            {t.retry}
          </button>
        </div>
      ) : (
        <div className="center muted">{t.loading}</div>
      )}
    </div>
  );
}

type Snapshot = { events: DraftEvent[]; sections: DraftSection[] };

function Editor({ song, notation, onBack }: { song: SongDetail; notation: NotationKind; onBack: () => void }) {
  const [events, setEvents] = useState<DraftEvent[]>(() =>
    song.events.map(({ time_sec, root, quality }) => ({ time_sec, root, quality })),
  );
  const [sections, setSections] = useState<DraftSection[]>(() =>
    song.sections.map(({ title, start_sec }) => ({ title, start_sec })),
  );
  const [history, setHistory] = useState<Snapshot[]>([]);
  const [dirty, setDirty] = useState(false);
  const [extra, setExtra] = useState<ChordJson[]>([]);
  const [lastTapped, setLastTapped] = useState<string | null>(null);
  const [speed, setSpeed] = useState(0.75);
  const [offset, setOffset] = useState(loadOffset);
  const [sheet, setSheet] = useState<"chord" | "section" | null>(null);
  const [status, setStatus] = useState<{ kind: "idle" | "saving" | "ok" | "error"; text?: string }>({
    kind: "idle",
  });

  const video = useVideo({ kind: "youtube", id: song.youtube_id }, 0, {
    onReady: (p) => p.setPlaybackRate(speed),
  });
  const duration = video.duration ?? song.duration_sec;

  // Keep the stored length in step with the real video, so late marks validate.
  const synced = useRef(false);
  useEffect(() => {
    const d = video.duration;
    if (!d || synced.current || Math.abs(d - song.duration_sec) < 1) return;
    synced.current = true;
    void api.admin.update(song.id, { duration_sec: Math.ceil(d) }).catch(() => {
      synced.current = false;
    });
  }, [video.duration, song.id, song.duration_sec]);

  const back = useCallback(async () => {
    if (dirty && !(await confirmDialog(t.admin.editor.unsaved))) return;
    onBack();
  }, [dirty, onBack]);
  useBackButton(back);

  const change = (next: Snapshot) => {
    setHistory((h) => [...h, { events, sections }]);
    setEvents(next.events);
    setSections(next.sections);
    setDirty(true);
    setStatus({ kind: "idle" });
  };

  // Marks land where the change was heard: the exact player time plus the offset.
  const markTime = () => roundTime(video.now() + offset);

  const markChord = (c: ChordJson) => {
    if (!video.ready) return;
    haptic.tap();
    change({ events: addEvent(events, { time_sec: markTime(), ...c }), sections });
    setLastTapped(chordKey(c));
  };

  const markSection = (title: string) => {
    haptic.tap();
    change({ events, sections: addSection(sections, { title, start_sec: markTime() }) });
    setSheet(null);
  };

  const undo = () => {
    const prev = history.at(-1);
    if (!prev) return;
    haptic.tap();
    setHistory((h) => h.slice(0, -1));
    setEvents(prev.events);
    setSections(prev.sections);
    setDirty(true);
    setLastTapped(prev.events.length ? chordKey(prev.events[prev.events.length - 1]) : null);
  };

  const removeEvent = (e: DraftEvent) =>
    change({ events: events.filter((x) => x !== e), sections });
  const removeSection = (s: DraftSection) =>
    change({ events, sections: sections.filter((x) => x !== s) });

  const save = async () => {
    const problem = timelineProblem(events, sections, duration);
    if (problem) {
      setStatus({ kind: "error", text: t.admin.editor.problems[problem] });
      return;
    }
    haptic.tap();
    setStatus({ kind: "saving" });
    try {
      await api.admin.timeline(song.id, { sections, events });
      await api.admin.publish(song.id, true);
      setDirty(false);
      setStatus({ kind: "ok", text: t.admin.editor.saved });
      haptic.success();
    } catch (e) {
      setStatus({ kind: "error", text: e instanceof Error ? e.message : String(e) });
    }
  };

  const cycleSpeed = () => {
    const next = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length];
    haptic.tap();
    setSpeed(next);
    video.setRate(next);
  };

  const nudgeOffset = (d: number) => {
    const next = Math.round(Math.min(0.5, Math.max(-1, offset + d)) * 100) / 100;
    setOffset(next);
    storeOffset(next);
  };

  const chords = palette(song.key, events, extra);
  const highlighted = lastTapped ?? (events.length ? chordKey(events[events.length - 1]) : null);
  const name = (c: ChordJson) => formatChord(spelled(c), notation);
  const sol = notation === "solfege";

  // The marks just behind the playhead, newest first (the spec's "last events").
  type Row = { time: number; event?: DraftEvent; section?: DraftSection };
  const rows: Row[] = [
    ...events.map((e) => ({ time: e.time_sec, event: e })),
    ...sections.map((s) => ({ time: s.start_sec, section: s })),
  ];
  const behind = rows.filter((r) => r.time <= video.time + 0.3).sort((a, b) => b.time - a.time);
  const recent = (behind.length ? behind : rows.sort((a, b) => a.time - b.time)).slice(0, RECENT);

  return (
    <div className="page editor-page">
      <div className="editor-head">
        <div className="editor-head-text">
          <span className="editor-admin">{t.admin.label}</span>
          <h1>{song.title}</h1>
        </div>
        <button type="button" className="control" onClick={cycleSpeed}>
          {t.player.speed} {speed}×
        </button>
      </div>

      <div className="video">
        <div ref={video.hostRef} className="video-host" />
        <span className="editor-clock">{formatClock(video.time)}</span>
        {video.error && (
          <div className="video-error">
            <p>{t.player.videoError(video.error, video.errorCode)}</p>
            <button
              type="button"
              className="button"
              onClick={() => openLink(`https://www.youtube.com/watch?v=${song.youtube_id}`)}
            >
              {t.player.openOnYouTube}
            </button>
          </div>
        )}
      </div>

      <div className="offset-row" title={t.admin.editor.offsetHint}>
        <span>
          {t.admin.editor.offset}{" "}
          <b>
            {offset > 0 ? "+" : offset < 0 ? "−" : ""}
            {Math.abs(offset).toFixed(2)} s
          </b>
        </span>
        <span className="offset-buttons">
          <button type="button" aria-label="−0.05 s" onClick={() => nudgeOffset(-OFFSET_STEP)}>
            −
          </button>
          <button type="button" aria-label="+0.05 s" onClick={() => nudgeOffset(OFFSET_STEP)}>
            +
          </button>
        </span>
      </div>

      <div className="editor-palette-wrap">
        <span className="editor-tap">{t.admin.editor.tap}</span>
        <div className="editor-palette">
          {chords.map((c) => {
            const on = chordKey(c) === highlighted;
            return (
              <button
                key={chordKey(c)}
                type="button"
                className={`palette-chord${on ? " on" : ""}`}
                style={sol ? { fontFamily: "var(--font)", fontSize: 13 } : undefined}
                disabled={!video.ready}
                onClick={() => markChord(c)}
              >
                {name(c)}
              </button>
            );
          })}
          <button
            type="button"
            className="palette-chord"
            aria-label={t.admin.editor.addChord}
            onClick={() => setSheet("chord")}
          >
            +
          </button>
        </div>
      </div>

      <section className="editor-timeline" aria-label="Belgilangan akkordlar">
        <div className="editor-timeline-head">
          <span>{t.admin.editor.timeline(events.length)}</span>
          <span className="editor-timeline-actions">
            <button type="button" className="control small" onClick={() => setSheet("section")}>
              {t.admin.editor.section}
            </button>
            <button
              type="button"
              className="control small"
              disabled={history.length === 0}
              onClick={undo}
            >
              {t.admin.editor.undo}
            </button>
          </span>
        </div>
        {rows.length === 0 ? (
          <p className="editor-empty muted">{t.admin.editor.empty}</p>
        ) : (
          recent.map((r) => (
            <div key={`${r.section ? "s" : "e"}${r.time}`} className="editor-row">
              <button type="button" className="editor-row-main" onClick={() => video.seek(r.time)}>
                <span className="editor-row-time">{formatClock(r.time)}</span>
                {r.event ? (
                  <span className="editor-row-chord">{name(r.event)}</span>
                ) : (
                  <span className="editor-row-section">§ {r.section!.title}</span>
                )}
              </button>
              <button
                type="button"
                className="editor-row-x"
                aria-label={t.admin.editor.remove}
                onClick={() => (r.event ? removeEvent(r.event) : removeSection(r.section!))}
              >
                ×
              </button>
            </div>
          ))
        )}
      </section>

      {status.kind !== "idle" && status.kind !== "saving" && (
        <p className={`editor-status ${status.kind}`} role="status">
          {status.text}
        </p>
      )}

      <div className="editor-bar">
        <button
          type="button"
          className="editor-play"
          aria-label={video.playing ? t.player.pause : t.player.play}
          disabled={!video.ready}
          onClick={() => {
            haptic.tap();
            video.toggle();
          }}
        >
          {video.playing ? (
            <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <rect x="6" y="5" width="4" height="14" rx="1" />
              <rect x="14" y="5" width="4" height="14" rx="1" />
            </svg>
          ) : (
            <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M8 5v14l11-7z" />
            </svg>
          )}
        </button>
        <button
          type="button"
          className="editor-save"
          disabled={status.kind === "saving"}
          onClick={save}
        >
          {status.kind === "saving" ? t.admin.editor.saving : t.admin.editor.save}
        </button>
      </div>

      {sheet === "section" && (
        <Sheet title={t.admin.editor.sectionPick} onClose={() => setSheet(null)}>
          <div className="sheet-options">
            {SECTION_TITLES.map((title) => (
              <button key={title} type="button" className="filter-chip" onClick={() => markSection(title)}>
                {title}
              </button>
            ))}
          </div>
          <p className="muted small">{formatClock(markTime())}</p>
        </Sheet>
      )}
      {sheet === "chord" && (
        <AddChordSheet
          notation={notation}
          onClose={() => setSheet(null)}
          onAdd={(c) => {
            setExtra((x) => [...x, c]);
            setSheet(null);
          }}
        />
      )}
    </div>
  );
}

function Sheet({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}

function AddChordSheet({
  notation,
  onClose,
  onAdd,
}: {
  notation: NotationKind;
  onClose: () => void;
  onAdd: (c: ChordJson) => void;
}) {
  const [root, setRoot] = useState(9);
  const [quality, setQuality] = useState<Quality>("maj");
  return (
    <Sheet title={t.admin.editor.addChord} onClose={onClose}>
      <div className="sheet-options">
        {Array.from({ length: 12 }, (_, pc) => (
          <button
            key={pc}
            type="button"
            className="filter-chip"
            aria-pressed={pc === root}
            onClick={() => setRoot(pc)}
          >
            {noteName(pc, notation, prefersFlat(pc))}
          </button>
        ))}
      </div>
      <div className="sheet-options">
        {QUALITIES.map((q) => (
          <button
            key={q}
            type="button"
            className="filter-chip"
            aria-pressed={q === quality}
            onClick={() => setQuality(q)}
          >
            {formatChord(spelled({ root, quality: q }), notation)}
          </button>
        ))}
      </div>
      <button type="button" className="button wide" onClick={() => onAdd({ root, quality })}>
        {t.admin.editor.add}
      </button>
    </Sheet>
  );
}
