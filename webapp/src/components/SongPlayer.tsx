// Song player — follows song-player-v2.reference.html. Also plays analysed songs
// (AnalysisPlayer.tsx): both are turned into a PlayerModel.
import { useEffect, useMemo, useRef, useState } from "react";

import { ApiError, api, type ChordJson, type SongDetail, type SongSummary } from "../api";
import { spelled, transpose, voicing } from "../chords";
import { formatChord, type Chord, type NotationKind } from "../notation";
import { artistLine, displayTitle, distinct, suggestCapo } from "../songTitle";
import { haptic, openLink, useBackButton } from "../telegram";
import { t } from "../texts";
import { activeIndex, formatTime, sectionBounds, type TimedEvent, type TimedSection } from "../timeline";
import { presetById, presetForShift, stringName, type PresetId } from "../tuning";
import { useVideo, type MediaSource } from "../useVideo";
import { YTState, type YTPlayer } from "../youtube";
import { MiniChordDiagram, type MiniColors } from "./ChordDiagram";
import { Screen } from "./Screen";

const SPEEDS = [1, 0.75, 0.5];
const MAX_SHIFT = 6;
const SAVE_EVERY_MS = 10_000;
const STRIP_BEFORE = 1; // chords already played that stay visible in the strip
const STRIP_LEN = 8;
const NOTE_MS = 4000;

const NOW_COLORS: MiniColors = { fg: "#ffffff", line: "rgba(255,255,255,0.45)", dot: "#ffffff" };
const NEXT_COLORS: MiniColors = { fg: "var(--text)", line: "#c4c7c1", dot: "var(--blue)" };

export type PlayerEvent = TimedEvent & { chord: ChordJson | null }; // null = no chord

/** Everything the player shows; built from a song or from an analysis. */
export interface PlayerModel {
  title: string; // raw: a YouTube title is cleaned for display only
  artist: string | null; // the catalog's artist; analyses take it from the title
  source: string; // the second line when there is no artist ("YouTube", "Fayl")
  capo: number;
  tag: { label: string; className: string }; // "auto" = automatically detected chords
  note?: string; // shown when the tag is tapped, e.g. "chords may contain errors"
  durationSec: number;
  sections: TimedSection[];
  events: PlayerEvent[];
  media: MediaSource;
  youtubeId: string | null; // "open on YouTube" when the embed is refused
  startSec: number;
  onSave?: (positionSec: number) => void;
  onPickFile?: (file: File) => void; // a file analysis whose file isn't in this browser
  fileName?: string;
  // Analyses: the song was most likely played in a down-tuning (shift -1 = Eb standard);
  // its shapes are the chords moved up by -shift.
  altTuning?: { name: string; shift: number } | null;
  onOpenTuner?: (preset: PresetId) => void;
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
    artist: song.artist,
    source: song.artist,
    capo: song.capo,
    tag: { label: t.songs.levels[song.difficulty], className: song.difficulty },
    durationSec: song.duration_sec,
    sections: song.sections,
    events: song.events.map((e) => ({
      time_sec: e.time_sec,
      section_id: e.section_id,
      chord: { root: e.root, quality: e.quality },
    })),
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
  return <Player model={model} notation={notation} onEdit={onEdit} />;
}

export function PlayerLoading({ failed, onRetry }: { failed: boolean; onRetry: () => void }) {
  return (
    <Screen title={t.tabs.songs} bodyClassName="player-body">
      {failed ? (
        <div className="song-list-note">
          <p>{t.loadFailed}</p>
          <button type="button" className="button" onClick={onRetry}>
            {t.retry}
          </button>
        </div>
      ) : (
        <div className="song-list-note muted">{t.loading}</div>
      )}
    </Screen>
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
  // Shown as played in the detected down-tuning by default: covers are tabbed that way.
  const [useAlt, setUseAlt] = useState(Boolean(model.altTuning));
  const [loop, setLoop] = useState<{ start: number; end: number } | null>(null);
  const [sheet, setSheet] = useState(false);
  const [note, setNote] = useState(false);
  const loopRef = useRef(loop);
  loopRef.current = loop;
  const lastSave = useRef(Date.now());

  const save = (p: YTPlayer) => {
    const now = p.getCurrentTime();
    if (now > 0) model.onSave?.(now);
    lastSave.current = Date.now();
  };

  const video = useVideo(
    model.media,
    model.startSec,
    {
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
    },
    { controls: false }, // the player bar below is the only control
  );
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

  useEffect(() => {
    if (!note) return;
    const id = setTimeout(() => setNote(false), NOTE_MS);
    return () => clearTimeout(id);
  }, [note]);

  const { events, sections } = model;
  const index = activeIndex(events, time);

  // Chords as played without a capo: transposed, and moved up for a down-tuning.
  const altShift = useAlt && model.altTuning ? model.altTuning.shift : 0;
  const played = (c: ChordJson): Chord => transpose(spelled(c), shift - altShift);
  // Shapes are shown relative to the capo: Am with capo 2 is played as a Gm shape.
  const shape = (c: ChordJson, withCapo = capo): Chord => transpose(played(c), -withCapo);
  const name = (c: ChordJson | null) => (c ? formatChord(shape(c), notation) : "—");

  const songChords = useMemo(
    () => distinct(events.flatMap((e) => (e.chord ? [transpose(spelled(e.chord), shift - altShift)] : []))),
    [events, shift, altShift],
  );
  const suggested = useMemo(() => suggestCapo(songChords, model.capo), [songChords, model.capo]);
  const firstShapes = (withCapo: number) =>
    songChords
      .slice(0, 4)
      .map((c) => formatChord(transpose(c, -withCapo), notation))
      .join(" ");

  // The strip: chord changes only ("no chord" gaps aren't chords to play).
  const chordEvents = useMemo(
    () => events.flatMap((e, i) => (e.chord ? [{ i, e }] : [])),
    [events],
  );
  let cur = -1;
  for (let k = 0; k < chordEvents.length && chordEvents[k].i <= index; k++) cur = k;
  const nowChord = index >= 0 ? events[index].chord : null;
  const nextChord = chordEvents[cur + 1]?.e.chord ?? null;
  const stripStart = Math.max(0, cur - STRIP_BEFORE);
  const strip = chordEvents.slice(stripStart, stripStart + STRIP_LEN);

  const sol = notation === "solfege";
  const isFile = model.media.kind === "file";
  const shown = displayTitle(model.title, model.artist);

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
  const progress = duration > 0 ? Math.min(100, (time / duration) * 100) : 0;

  const card = (label: string, chord: ChordJson | null, now: boolean) => {
    const display = name(chord);
    return (
      <div className={`chord-now${now ? " is-now" : ""}`}>
        <MiniChordDiagram
          frets={chord ? voicing(shape(chord)).frets : null}
          colors={now ? NOW_COLORS : NEXT_COLORS}
          label={t.player.diagram(display)}
          big={now}
        />
        <div className="chord-now-text">
          <span className="chord-now-label">{label}</span>
          <span
            className="chord-now-name"
            style={{
              fontFamily: sol ? "var(--font)" : "var(--mono)",
              fontSize: now ? (sol ? 20 : 34) : sol ? 17 : 24,
            }}
          >
            {display}
          </span>
        </div>
      </div>
    );
  };

  const capoOn = capo !== model.capo;
  const showCapo = suggested !== null || capoOn || model.capo > 0;

  const right = (
    <>
      {model.tag.className === "auto" && model.note ? (
        <button
          type="button"
          className="tag auto"
          aria-expanded={note}
          onClick={() => {
            haptic.tap();
            setNote((n) => !n);
          }}
        >
          {model.tag.label}
        </button>
      ) : (
        <span className={`tag ${model.tag.className}`}>{model.tag.label}</span>
      )}
      {note && model.note && (
        <span className="avto-note" role="status">
          {model.note}
        </span>
      )}
    </>
  );

  const bar = (
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
          role="slider"
          aria-label={t.player.position}
          aria-valuemin={0}
          aria-valuemax={Math.round(duration)}
          aria-valuenow={Math.round(time)}
          aria-valuetext={`${formatTime(time)} / ${formatTime(duration)}`}
          tabIndex={0}
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            seek(((e.clientX - r.left) / r.width) * duration);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowRight") seek(Math.min(duration, time + 5));
            if (e.key === "ArrowLeft") seek(Math.max(0, time - 5));
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
        className={`player-settings${loop || speed !== 1 || shift !== 0 ? " on" : ""}`}
        aria-label={t.player.settings}
        onClick={() => {
          haptic.tap();
          setSheet(true);
        }}
      >
        <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2" strokeLinecap="round">
          <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
          <circle cx="16" cy="7" r="2" />
          <circle cx="10" cy="17" r="2" />
        </svg>
      </button>
    </div>
  );

  return (
    <Screen
      title={shown.title}
      sub={artistLine(shown, model.source)}
      right={right}
      className="player"
      bodyClassName="player-body"
      after={bar}
    >
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
      </div>

      {showCapo && (
        <button
          type="button"
          className={`capo-card${capoOn ? " on" : ""}`}
          aria-pressed={capoOn}
          disabled={!capoOn && suggested === null}
          onClick={() => {
            haptic.tap();
            setCapo(capoOn ? model.capo : suggested!);
          }}
        >
          <span className="capo-num" aria-hidden="true">
            {capo}
          </span>
          <span className="capo-text">
            <span className="capo-title">
              {capoOn
                ? t.player.capoOn(capo)
                : suggested !== null
                  ? t.player.capoOffer(suggested)
                  : t.player.capoAt(capo)}
            </span>
            <span className="capo-sub">
              {capoOn
                ? t.player.capoBack
                : suggested !== null
                  ? `${firstShapes(model.capo)} → ${firstShapes(suggested)}`
                  : firstShapes(capo)}
            </span>
          </span>
        </button>
      )}

      {events.length === 0 ? (
        <p className="muted">{t.player.noChords}</p>
      ) : (
        <>
          <div className="chord-pair">
            {card(t.player.now, nowChord, true)}
            {card(t.player.next, nextChord, false)}
          </div>

          <div className="chord-strip" aria-label={t.player.strip}>
            {strip.map(({ i, e }, k) => {
              const label = name(e.chord);
              const at = stripStart + k;
              return (
                <button
                  key={i}
                  type="button"
                  aria-label={t.player.seekTo(label)}
                  aria-current={at === cur ? "true" : undefined}
                  className={`strip-cell${at === cur ? " now" : at < cur ? " past" : ""}`}
                  style={{ fontFamily: sol ? "var(--font)" : "var(--mono)", fontSize: sol ? 12 : 15 }}
                  onClick={() => seek(e.time_sec)}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </>
      )}

      {sheet && (
        <SettingsSheet
          model={model}
          notation={notation}
          shift={shift}
          speed={speed}
          loop={loop !== null}
          useAlt={useAlt}
          onShift={(s) => setShift(Math.max(-MAX_SHIFT, Math.min(MAX_SHIFT, s)))}
          onSpeed={(s) => {
            setSpeed(s);
            video.setRate(s);
          }}
          onLoop={(on) => setLoop(on ? sectionBounds(sections, time, duration) : null)}
          onUseAlt={setUseAlt}
          onEdit={onEdit}
          onClose={() => setSheet(false)}
        />
      )}
    </Screen>
  );
}

/** The player's settings: transpose, speed, section loop; tuning for down-tuned covers. */
function SettingsSheet({
  model,
  notation,
  shift,
  speed,
  loop,
  useAlt,
  onShift,
  onSpeed,
  onLoop,
  onUseAlt,
  onEdit,
  onClose,
}: {
  model: PlayerModel;
  notation: NotationKind;
  shift: number;
  speed: number;
  loop: boolean;
  useAlt: boolean;
  onShift: (s: number) => void;
  onSpeed: (s: number) => void;
  onLoop: (on: boolean) => void;
  onUseAlt: (on: boolean) => void;
  onEdit?: () => void;
  onClose: () => void;
}) {
  const alt = model.altTuning;
  const preset = alt ? presetForShift(alt.shift) : null;
  const presetNotes = (id: PresetId) => {
    const p = presetById(id);
    return p.strings.map((s) => stringName(s.pc, notation, p.flat)).join(" ");
  };
  return (
    <div className="overlay" onClick={onClose}>
      <div
        className="sheet player-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={t.player.settings}
        onClick={(e) => e.stopPropagation()}
      >
        <span className="sheet-handle" aria-hidden="true" />
        <div className="sheet-row">
          <span className="card-label">{t.player.ton}</span>
          <div className="ton">
            <button type="button" aria-label={t.player.tonDown} onClick={() => onShift(shift - 1)}>
              −
            </button>
            <span>{shift > 0 ? `+${shift}` : shift < 0 ? `−${-shift}` : "0"}</span>
            <button type="button" aria-label={t.player.tonUp} onClick={() => onShift(shift + 1)}>
              +
            </button>
          </div>
        </div>
        <div className="sheet-row">
          <span className="card-label">{t.player.speed}</span>
          <div className="segmented" role="group" aria-label={t.player.speed}>
            {SPEEDS.map((s) => (
              <button
                key={s}
                type="button"
                className={s === speed ? "selected" : ""}
                aria-pressed={s === speed}
                onClick={() => {
                  haptic.tap();
                  onSpeed(s);
                }}
              >
                {s}×
              </button>
            ))}
          </div>
        </div>
        <label className="sheet-row">
          <span className="card-label">{t.player.loop}</span>
          <input
            type="checkbox"
            className="switch"
            checked={loop}
            onChange={(e) => {
              haptic.tap();
              onLoop(e.target.checked);
            }}
          />
        </label>
        {alt && (
          <div className="sheet-block">
            <span className="card-label">{t.player.tuningLabel}</span>
            <div className="segmented wide" role="group" aria-label={t.player.tuningLabel}>
              <button
                type="button"
                className={useAlt ? "" : "selected"}
                aria-pressed={!useAlt}
                onClick={() => onUseAlt(false)}
              >
                {t.player.standardTuning}
              </button>
              <button
                type="button"
                className={useAlt ? "selected" : ""}
                aria-pressed={useAlt}
                onClick={() => onUseAlt(true)}
              >
                {t.player.altTuning(alt.shift)}
              </button>
            </div>
            {useAlt && preset && (
              <div className="tuning-hint">
                <span className="mono">{presetNotes(preset)}</span>
                {model.onOpenTuner && (
                  <button type="button" className="control small" onClick={() => model.onOpenTuner!(preset)}>
                    {t.player.openTuner}
                  </button>
                )}
              </div>
            )}
          </div>
        )}
        {onEdit && (
          <button type="button" className="button wide secondary" onClick={onEdit}>
            {t.player.edit}
          </button>
        )}
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
