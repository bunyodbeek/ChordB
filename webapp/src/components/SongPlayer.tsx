// Song player — follows song-player.reference.html. Also plays analysed songs
// (AnalysisPlayer.tsx): both are turned into a PlayerModel.
import { useEffect, useMemo, useRef, useState } from "react";

import { ApiError, api, type ChordJson, type SongDetail, type SongSummary } from "../api";
import { spelled, transpose, voicing } from "../chords";
import { formatChord, type Chord, type NotationKind } from "../notation";
import { haptic, inTelegram, openLink, useBackButton } from "../telegram";
import { t } from "../texts";
import {
  BEATS_PER_BAR,
  activeIndex,
  beatFromBeats,
  beatOf,
  formatTime,
  groupBySection,
  sectionBounds,
  type TimedEvent,
  type TimedSection,
} from "../timeline";
import { useVideo, type MediaSource } from "../useVideo";
import { YTState, type YTPlayer } from "../youtube";
import { MiniChordDiagram, type MiniColors } from "./ChordDiagram";

const SPEEDS = [1, 0.75, 0.5];
const MAX_SHIFT = 6;
const MAX_CAPO = 7;
const SAVE_EVERY_MS = 10_000;

const ACCENT = "var(--blue)";
const NOW_COLORS: MiniColors = { fg: "#ffffff", line: "rgba(255,255,255,0.45)", dot: "#ffffff" };
const NEXT_COLORS: MiniColors = { fg: "var(--text)", line: "#c4c7c1", dot: ACCENT };

export type PlayerEvent = TimedEvent & { chord: ChordJson | null }; // null = no chord

/** Everything the player shows; built from a song or from an analysis. */
export interface PlayerModel {
  title: string;
  subtitle: string; // artist, or where an analysis came from
  key: ChordJson | null;
  capo: number;
  tag: { label: string; className: string };
  note?: string; // e.g. "chords may contain errors"
  durationSec: number;
  sections: TimedSection[];
  events: PlayerEvent[];
  beats: number[] | null; // detected beats drive the beat bar when known
  media: MediaSource;
  youtubeId: string | null; // "open on YouTube" when the embed is refused
  startSec: number;
  onSave?: (positionSec: number) => void;
  onPickFile?: (file: File) => void; // a file analysis whose file isn't in this browser
  fileName?: string;
}

interface Props {
  songId: number;
  notation: NotationKind;
  onBack: () => void;
  onPaywall: (song: SongSummary) => void;
  onEdit?: () => void; // admins: open the chord editor
}

export function songModel(song: SongDetail): PlayerModel {
  const resumeAt =
    song.position_sec && song.position_sec >= 1 && song.position_sec < song.duration_sec - 5
      ? song.position_sec
      : 0;
  return {
    title: song.title,
    subtitle: song.artist,
    key: song.key,
    capo: song.capo,
    tag: { label: t.songs.levels[song.difficulty], className: song.difficulty },
    durationSec: song.duration_sec,
    sections: song.sections,
    events: song.events.map((e) => ({
      time_sec: e.time_sec,
      section_id: e.section_id,
      chord: { root: e.root, quality: e.quality },
    })),
    beats: null,
    media: { kind: "youtube", id: song.youtube_id },
    youtubeId: song.youtube_id,
    startSec: resumeAt,
    onSave: (sec) => void api.saveProgress(song.id, sec),
  };
}

export function SongPlayer({ songId, notation, onBack, onPaywall, onEdit }: Props) {
  useBackButton(onBack);
  const [song, setSong] = useState<SongDetail | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    api.song(songId).then(
      (s) => !cancelled && setSong(s),
      (e) => {
        if (cancelled) return;
        if (e instanceof ApiError && e.isPaywall) {
          onPaywall((e.detail as { song: SongSummary }).song);
          onBack();
        } else {
          setFailed(true);
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [songId, attempt, onBack, onPaywall]);

  const model = useMemo(() => (song ? songModel(song) : null), [song]);
  if (!model) {
    return <PlayerLoading failed={failed} onRetry={() => setAttempt((n) => n + 1)} />;
  }
  return (
    <>
      <BrowserBack onBack={onBack} />
      <Player model={model} notation={notation} onEdit={onEdit} />
    </>
  );
}

export function PlayerLoading({ failed, onRetry }: { failed: boolean; onRetry: () => void }) {
  return (
    <div className="page player-page">
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

/** Outside Telegram there is no native back button; show a link instead. */
export function BrowserBack({ onBack }: { onBack: () => void }) {
  if (inTelegram) return null;
  return (
    <div className="browser-back">
      <button type="button" className="back-link" onClick={onBack}>
        ‹ {t.songs.back}
      </button>
    </div>
  );
}

export function Player({
  model,
  notation,
  onEdit,
}: {
  model: PlayerModel;
  notation: NotationKind;
  onEdit?: () => void;
}) {
  const [shift, setShift] = useState(0);
  const [capo, setCapo] = useState(model.capo);
  const [speed, setSpeed] = useState(1);
  const [loop, setLoop] = useState<{ start: number; end: number } | null>(null);
  const loopRef = useRef(loop);
  loopRef.current = loop;
  const lastSave = useRef(Date.now());

  const save = (p: YTPlayer) => {
    const now = p.getCurrentTime();
    if (now > 0) model.onSave?.(now);
    lastSave.current = Date.now();
  };

  const video = useVideo(model.media, model.startSec, {
    onReady: (p) => {
      // A new <audio> (a re-picked file) starts at normal speed; keep the chosen one.
      if (speed !== 1) p.setPlaybackRate(speed);
    },
    onStateChange: (state, p) => {
      if (state === YTState.PAUSED || state === YTState.ENDED) save(p);
    },
    onTick: (now, p) => {
      const l = loopRef.current;
      if (l && now >= l.end - 0.05) {
        p.seekTo(l.start, true);
        return l.start;
      }
      if (p.getPlayerState() === YTState.PLAYING && Date.now() - lastSave.current > SAVE_EVERY_MS) {
        save(p);
      }
    },
    onDispose: save,
  });
  const { time, playing, ready, error: videoError } = video;
  const duration = video.duration ?? model.durationSec;

  // Save when Telegram is minimised or the phone locks.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden" && video.player.current) save(video.player.current);
    };
    document.addEventListener("visibilitychange", onHide);
    return () => document.removeEventListener("visibilitychange", onHide);
  });

  const { events, sections } = model;
  const index = activeIndex(events, time);
  const beat =
    model.beats && index >= 0
      ? beatFromBeats(model.beats, events[index].time_sec, time)
      : beatOf(events, index, time, duration);
  const groups = useMemo(() => groupBySection(sections, events), [sections, events]);

  // Shapes are shown relative to the capo: Am with capo 2 is played as a Gm shape.
  const shown = (c: ChordJson): Chord => transpose(spelled(c), shift - capo);
  const name = (c: ChordJson | null) => (c ? formatChord(shown(c), notation) : "—");
  const nowChord = index >= 0 ? events[index].chord : null;
  const nextChord = index + 1 < events.length ? events[index + 1].chord : null;
  const sol = notation === "solfege";
  const isFile = model.media.kind === "file";

  const seek = (sec: number) => {
    if (!ready) return;
    haptic.tap();
    video.seek(sec);
    if (loop) setLoop(sectionBounds(sections, sec, duration));
  };
  const togglePlay = () => {
    haptic.tap();
    video.toggle();
  };
  const cycleSpeed = () => {
    const next = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length];
    haptic.tap();
    setSpeed(next);
    video.setRate(next);
  };
  const toggleLoop = () => {
    haptic.tap();
    setLoop(loop ? null : sectionBounds(sections, time, duration));
  };

  const progress = duration > 0 ? Math.min(100, (time / duration) * 100) : 0;
  const card = (label: string, chord: ChordJson | null, now: boolean) => {
    const display = name(chord);
    return (
      <div className={`chord-now${now ? " is-now" : ""}`}>
        <MiniChordDiagram
          frets={chord ? voicing(shown(chord)).frets : null}
          colors={now ? NOW_COLORS : NEXT_COLORS}
          label={t.player.diagram(display)}
        />
        <div className="chord-now-text">
          <span className="chord-now-label">{label}</span>
          <span
            className="chord-now-name"
            style={{
              fontFamily: sol ? "var(--font)" : "var(--mono)",
              fontSize: now ? (sol ? 20 : 34) : sol ? 17 : 28,
            }}
          >
            {display}
          </span>
        </div>
      </div>
    );
  };

  return (
    <div className="page player-page">
      <div className="player-head">
        <div className="player-head-text">
          <h1>{model.title}</h1>
          <span className="muted">
            {model.subtitle} · {model.key ? formatChord(shown(model.key), notation) : t.analyze.noKey}{" "}
            · {capo === 0 ? t.player.noCapo : t.player.capo(capo)}
          </span>
        </div>
        <div className="player-head-side">
          {onEdit && (
            <button type="button" className="control small" onClick={onEdit}>
              {t.player.edit}
            </button>
          )}
          <span className={`tag big ${model.tag.className}`}>{model.tag.label}</span>
        </div>
      </div>
      {model.note && <p className="player-note">{model.note}</p>}

      <div className={`video${isFile ? " audio" : ""}`}>
        <div ref={video.hostRef} className="video-host" />
        {isFile && (
          <AudioFace
            name={model.fileName}
            missing={model.media.kind === "file" && !model.media.url}
            failed={videoError !== null}
            onPick={model.onPickFile}
          />
        )}
        {videoError && !isFile && (
          <div className="video-error">
            <p>{videoError === "blocked" ? t.player.videoBlocked : t.player.videoFailed}</p>
            {model.youtubeId && (
              <button
                type="button"
                className="button"
                onClick={() => openLink(`https://www.youtube.com/watch?v=${model.youtubeId}`)}
              >
                {t.player.openOnYouTube}
              </button>
            )}
          </div>
        )}
        <div className="video-progress">
          <div style={{ width: `${progress}%` }} />
        </div>
      </div>

      <div className="chord-pair">
        {card(t.player.now, nowChord, true)}
        {card(t.player.next, nextChord, false)}
      </div>

      <div className="beat-bar" role="img" aria-label={t.player.beat(beat + 1)}>
        {Array.from({ length: BEATS_PER_BAR }, (_, i) => (
          <div key={i} className={i <= beat ? "on" : ""} />
        ))}
      </div>

      <div className="sections-card">
        {groups.length === 0 ? (
          <p className="muted">{t.player.noChords}</p>
        ) : (
          groups.map((g, gi) => (
            <div key={gi} className="section">
              {g.title && <span className="section-name">{g.title}</span>}
              <div className="section-bars">
                {g.items.map(({ event, index: i }) => {
                  const label = name(event.chord);
                  return (
                    <button
                      key={i}
                      type="button"
                      aria-label={t.player.seekTo(label)}
                      className={`bar-cell${i === index ? " now" : i < index ? " past" : ""}`}
                      style={{
                        fontFamily: sol ? "var(--font)" : "var(--mono)",
                        fontSize: sol ? 11 : 16,
                      }}
                      onClick={() => seek(event.time_sec)}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </div>

      <div className="player-controls">
        <div className="ton">
          <button
            type="button"
            aria-label={t.player.tonDown}
            onClick={() => setShift((s) => Math.max(-MAX_SHIFT, s - 1))}
          >
            −
          </button>
          <span>
            {t.player.ton} {shift > 0 ? `+${shift}` : shift < 0 ? `−${-shift}` : "0"}
          </span>
          <button
            type="button"
            aria-label={t.player.tonUp}
            onClick={() => setShift((s) => Math.min(MAX_SHIFT, s + 1))}
          >
            +
          </button>
        </div>
        <button
          type="button"
          className="control"
          onClick={() => {
            haptic.tap();
            setCapo((c) => (c + 1) % (MAX_CAPO + 1));
          }}
        >
          {t.player.kapo} {capo}
        </button>
        <button
          type="button"
          className={`control${speed !== 1 ? " active" : ""}`}
          onClick={cycleSpeed}
        >
          {t.player.speed} {speed}×
        </button>
      </div>

      <div className="player-bar">
        <button
          type="button"
          className="player-play"
          aria-label={playing ? t.player.pause : t.player.play}
          disabled={!ready}
          onClick={togglePlay}
        >
          {playing ? (
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
        <div className="player-track">
          <div
            className="player-progress"
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              seek(((e.clientX - r.left) / r.width) * duration);
            }}
          >
            <div style={{ width: `${progress}%` }} />
          </div>
          <div className="player-times">
            <span>{formatTime(time)}</span>
            <span>{formatTime(duration)}</span>
          </div>
        </div>
        <button
          type="button"
          className={`player-loop${loop ? " on" : ""}`}
          aria-label={t.player.loop}
          aria-pressed={loop !== null}
          onClick={toggleLoop}
        >
          <svg
            aria-hidden="true"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M17 2l3 3-3 3" />
            <path d="M4 11V9a4 4 0 0 1 4-4h12" />
            <path d="M7 22l-3-3 3-3" />
            <path d="M20 13v2a4 4 0 0 1-4 4H4" />
          </svg>
        </button>
      </div>
    </div>
  );
}

/** What the video frame shows for a local file: its name, or a picker when it's missing. */
function AudioFace({
  name,
  missing,
  failed,
  onPick,
}: {
  name?: string;
  missing: boolean;
  failed: boolean;
  onPick?: (file: File) => void;
}) {
  return (
    <div className="audio-face">
      <svg aria-hidden="true" width="28" height="28" viewBox="0 0 24 24" fill="none"
        stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 18V5l12-2v13" />
        <circle cx="6" cy="18" r="3" />
        <circle cx="18" cy="16" r="3" />
      </svg>
      {name && <span className="audio-name">{name}</span>}
      {(missing || failed) && (
        <>
          <span className="audio-hint">{failed ? t.analyze.fileFailed : t.analyze.fileMissing}</span>
          {onPick && (
            <label className="button audio-pick">
              {t.analyze.pickFile}
              <input
                type="file"
                accept="audio/*,video/*"
                className="sr-only"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f) onPick(f);
                }}
              />
            </label>
          )}
        </>
      )}
    </div>
  );
}
