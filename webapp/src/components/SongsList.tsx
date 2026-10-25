// Songs list — songs-list-v3.reference.html: the "add your own song" card with today's
// limit, one-choice chips, SongRows. Search hides behind the header's icon.
import { useEffect, useRef, useState } from "react";

import { api, type ChordJson, type Difficulty, type SongSummary, type SongsResponse } from "../api";
import { spelled } from "../chords";
import { formatChord, type NotationKind } from "../notation";
import { haptic } from "../telegram";
import { t } from "../texts";
import { Screen } from "./Screen";
import { Chip, Icon, SearchIcon, SongRow, previewLine } from "./ui";

type Filter = "all" | Difficulty | "saved";
const FILTERS: Filter[] = ["all", "easy", "medium", "hard", "saved"];

const SEARCH_DEBOUNCE_MS = 250;

export function chordLine(chords: ChordJson[], notation: NotationKind): string {
  return chords.map((c) => formatChord(spelled(c), notation)).join(" · ");
}

interface Props {
  notation: NotationKind;
  isAdmin: boolean;
  onOpen: (song: SongSummary) => void;
  onLocked: (song: SongSummary) => void;
  onAdmin?: () => void; // admins only: song management
  onAnalyze: () => void; // "Oʻz qoʻshigʻingizni qoʻshing": its own screen
  onLimit: () => void; // today's free analyses are used up: the premium sheet
}

// Kept across visits to the tab, like the screen stack.
let saved = { q: "", filter: "all" as Filter, searching: false };

export function SongsList({ notation, isAdmin, onOpen, onLocked, onAdmin, onAnalyze, onLimit }: Props) {
  const [q, setQ] = useState(saved.q);
  const [filter, setFilter] = useState<Filter>(saved.filter);
  const [searching, setSearching] = useState(saved.searching);
  saved = { q, filter, searching };
  const [data, setData] = useState<SongsResponse | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  // Today's free analyses left (null: unlimited, or not known yet).
  const [quota, setQuota] = useState<{ left: number; limit: number } | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    const filters =
      filter === "saved" ? { saved: true } : filter === "all" ? {} : { difficulty: filter };
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
  }, [q, filter, attempt]);

  useEffect(() => {
    api.analyze.history().then(
      (h) => setQuota(h.remaining_today === null ? null : { left: h.remaining_today, limit: h.daily_limit }),
      () => {},
    );
  }, []);

  useEffect(() => {
    if (searching) input.current?.focus();
  }, [searching]);

  const open = (song: SongSummary) => {
    haptic.tap();
    if (song.locked) onLocked(song);
    else onOpen(song);
  };

  const right = (
    <>
      {onAdmin && (
        <button type="button" className="bar-chip" onClick={onAdmin}>
          {t.admin.label}
        </button>
      )}
      <button
        type="button"
        className="icon-button"
        aria-label={t.songs.searchLabel}
        aria-expanded={searching}
        onClick={() => {
          haptic.tap();
          if (searching) setQ("");
          setSearching(!searching);
        }}
      >
        <SearchIcon />
      </button>
    </>
  );

  return (
    <Screen title={t.tabs.songs} right={right} bodyClassName="songs-body">
      {searching && (
        <div className="search">
          <label htmlFor="qs" className="sr-only">
            {t.songs.searchLabel}
          </label>
          <SearchIcon />
          <input
            ref={input}
            id="qs"
            type="search"
            placeholder={t.songs.search}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            autoComplete="off"
          />
        </div>
      )}

      <button
        type="button"
        className="add-song"
        onClick={() => {
          haptic.tap();
          if (quota?.left === 0) onLimit();
          else onAnalyze();
        }}
      >
        <span className="add-song-icon">
          <Icon size={22}>
            <path d="M12 5v14M5 12h14" />
          </Icon>
        </span>
        <span className="add-song-text">
          <span className="add-song-title">{t.songs.addTitle}</span>
          <span className="add-song-sub">{t.songs.addSub}</span>
        </span>
        {quota && (
          <span className="add-song-quota" aria-label={t.songs.quotaAria(quota.left, quota.limit)}>
            {quota.left}/{quota.limit}
          </span>
        )}
      </button>

      <div className="chip-row" role="group" aria-label={t.songs.filtersLabel}>
        {FILTERS.map((f) => (
          <Chip key={f} selected={filter === f} onClick={() => setFilter(f)}>
            {t.songs.filters[f]}
          </Chip>
        ))}
      </div>

      <div className="song-list-v3 scroll-y">
        {failed ? (
          <div className="song-list-note">
            <p>{t.loadFailed}</p>
            <button type="button" className="button" onClick={() => setAttempt((n) => n + 1)}>
              {t.retry}
            </button>
          </div>
        ) : !data ? (
          Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="song-row-v3 skeleton" aria-hidden="true">
              <span className="song-row-tile" />
              <span className="song-row-text">
                <span className="sk-line" style={{ width: "55%" }} />
                <span className="sk-line" style={{ width: "35%" }} />
              </span>
            </div>
          ))
        ) : data.songs.length === 0 ? (
          <div className="song-list-note muted">
            {filter === "saved" && !q.trim()
              ? t.songs.noSaved
              : q.trim() || filter !== "all"
                ? t.songs.notFound
                : t.songs.empty}
          </div>
        ) : (
          data.songs.map((s) => (
            <SongRow
              key={s.id}
              id={s.id}
              title={s.title}
              artist={isAdmin && !s.is_published ? `${s.artist} · ${t.songs.draft}` : s.artist}
              difficulty={s.difficulty}
              chords={previewLine(s.chords_preview, notation)}
              locked={s.locked}
              onClick={() => open(s)}
            />
          ))
        )}
      </div>
    </Screen>
  );
}
