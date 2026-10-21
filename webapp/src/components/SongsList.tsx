// Songs list — follows songs-list-v2.reference.html.
import { useEffect, useState } from "react";

import { api, type ChordJson, type SongSummary, type SongsResponse } from "../api";
import { spelled } from "../chords";
import { formatChord, type NotationKind } from "../notation";
import { haptic } from "../telegram";
import { t } from "../texts";
import { Screen } from "./Screen";

type FilterKey = "easy" | "uzbek" | "no_capo";
const FILTERS: FilterKey[] = ["easy", "uzbek", "no_capo"];
const NO_FILTERS: Record<FilterKey, boolean> = { easy: false, uzbek: false, no_capo: false };

const SEARCH_DEBOUNCE_MS = 250;

const PlayIcon = ({ size }: { size: number }) => (
  <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
    <path d="M8 5v14l11-7z" />
  </svg>
);

export function chordLine(chords: ChordJson[], notation: NotationKind): string {
  return chords.map((c) => formatChord(spelled(c), notation)).join(" · ");
}

interface Props {
  notation: NotationKind;
  isAdmin: boolean;
  onOpen: (song: SongSummary) => void;
  onLocked: (song: SongSummary) => void;
  onAdmin?: () => void; // admins only: song management
  onAnalyze: () => void; // "Akkordlarni aniqlash": its own screen
}

export function SongsList({ notation, isAdmin, onOpen, onLocked, onAdmin, onAnalyze }: Props) {
  const [q, setQ] = useState("");
  const [filters, setFilters] = useState(NO_FILTERS);
  const [data, setData] = useState<SongsResponse | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const ctrl = new AbortController();
    // Typing waits for a pause; chip taps fetch at once.
    const timer = setTimeout(
      () =>
        api.songs({ q, ...filters }, ctrl.signal).then(
          (d) => {
            setData(d);
            setFailed(false);
          },
          () => {
            if (!ctrl.signal.aborted) setFailed(true);
          },
        ),
      q ? SEARCH_DEBOUNCE_MS : 0,
    );
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [q, filters, attempt]);

  const anyFilter = FILTERS.some((f) => filters[f]);
  const open = (song: SongSummary) => {
    haptic.tap();
    if (song.locked) onLocked(song);
    else onOpen(song);
  };
  const cont = data?.continue_playing;

  const right = (
    <>
      {onAdmin && (
        <button type="button" className="bar-chip" onClick={onAdmin}>
          {t.admin.label}
        </button>
      )}
      <button type="button" className="bar-icon" aria-label={t.analyze.title} onClick={onAnalyze}>
        <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2" strokeLinecap="round">
          <path d="M3 12h2M7 8v8M11 5v14M15 9v6M19 11v2" />
        </svg>
      </button>
    </>
  );

  return (
    <Screen title={t.tabs.songs} right={right} bodyClassName="songs-body">
      <div className="search">
        <label htmlFor="qs" className="sr-only">
          {t.songs.searchLabel}
        </label>
        <svg
          aria-hidden="true"
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        >
          <circle cx="11" cy="11" r="6" />
          <path d="M20 20l-4.5-4.5" />
        </svg>
        <input
          id="qs"
          type="search"
          placeholder={t.songs.search}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          autoComplete="off"
        />
      </div>

      <div className="filter-chips">
        <button
          type="button"
          className="filter-chip"
          aria-pressed={!anyFilter}
          onClick={() => {
            haptic.tap();
            setFilters(NO_FILTERS);
          }}
        >
          {t.songs.filters.all}
        </button>
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            className="filter-chip"
            aria-pressed={filters[f]}
            onClick={() => {
              haptic.tap();
              setFilters((prev) => ({ ...prev, [f]: !prev[f] }));
            }}
          >
            {t.songs.filters[f]}
          </button>
        ))}
      </div>

      {cont && (
        <button type="button" className="continue-card" onClick={() => open(cont.song)}>
          <span className="continue-text">
            <span className="continue-label">{t.songs.continue}</span>
            <span className="continue-title">{cont.song.title}</span>
            <span className="continue-chords">{chordLine(cont.song.chords_preview, notation)}</span>
            <span className="continue-bar">
              <span
                style={{
                  width: `${Math.min(100, (cont.position_sec / cont.song.duration_sec) * 100)}%`,
                }}
              />
            </span>
          </span>
          <span className="continue-play" aria-hidden="true">
            <PlayIcon size={18} />
          </span>
        </button>
      )}

      <div className="song-list scroll-y">
        {failed ? (
          <div className="song-list-note">
            <p>{t.loadFailed}</p>
            <button type="button" className="button" onClick={() => setAttempt((n) => n + 1)}>
              {t.retry}
            </button>
          </div>
        ) : !data ? (
          Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="song-row skeleton" aria-hidden="true">
              <span className="song-tile" />
              <span className="song-text">
                <span className="sk-line" style={{ width: "55%" }} />
                <span className="sk-line" style={{ width: "35%" }} />
              </span>
            </div>
          ))
        ) : data.songs.length === 0 ? (
          <div className="song-list-note muted">
            {q.trim() || anyFilter ? t.songs.notFound : t.songs.empty}
          </div>
        ) : (
          data.songs.map((s) => (
            <button key={s.id} type="button" className="song-row" onClick={() => open(s)}>
              <span className="song-tile" aria-hidden="true">
                <PlayIcon size={16} />
                {s.locked && (
                  <span className="song-lock">
                    <svg
                      width="10"
                      height="10"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="#FFFFFF"
                      strokeWidth="3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <rect x="5" y="11" width="14" height="9" rx="2" />
                      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
                    </svg>
                  </span>
                )}
              </span>
              <span className="song-text">
                <span className="song-title">{s.title}</span>
                <span className="song-artist">
                  {s.artist}
                  {isAdmin && !s.is_published && ` · ${t.songs.draft}`}
                </span>
                {s.chords_preview.length > 0 && (
                  <span className="song-chords">{chordLine(s.chords_preview, notation)}</span>
                )}
              </span>
              <span className={`tag ${s.locked ? "premium" : s.difficulty}`}>
                {s.locked ? t.songs.premium : t.songs.levels[s.difficulty]}
              </span>
            </button>
          ))
        )}
      </div>
    </Screen>
  );
}
