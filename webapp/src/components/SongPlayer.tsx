// Song player — follows song-player-v4.reference.html: the video, one chord strip under
// a fixed playhead (each card with its voicing pager), the tool buttons, the "Ritm" card,
// the floating play bar. Kapo and Ton open one sheet; ✎ or a long press fixes a chord.
// Also plays analysed songs (AnalysisPlayer.tsx): both are turned into a PlayerModel.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ApiError, api, type ChordJson, type PlayerSettings, type SongDetail, type SongSummary } from "../api";
import { voicings } from "../chords";
import {
  MAX_CAPO_SHOWN,
  applyCapo,
  capoOptions,
  distinctChords,
  easiestCapo,
  simplify,
  spell,
  transpose,
  transposeKey,
  type Key,
  type PitchChord,
} from "../harmony";
import { formatChord, type NotationKind } from "../notation";
import { loadRhythm, loadVoicings, storeRhythm, storeVoicings, type VoicingChoices } from "../playerPrefs";
import { artistLine, displayTitle } from "../songTitle";
import { stripLayout, cardAt } from "../strip";
import { DEFAULT_BPM, DEFAULT_PATTERN, barGrid, eighthsPerBar, patternIds, strokes } from "../strum";
import { haptic, openLink, useBackButton } from "../telegram";
import { t } from "../texts";
import { formatTime, sectionBounds, type TimedEvent, type TimedSection } from "../timeline";
import { presetForShift, type PresetId } from "../tuning";
import { useVideo, type MediaSource } from "../useVideo";
import { YTState, type YTPlayer } from "../youtube";
import { CapoKeySheet } from "./player/CapoKeySheet";
import { ChordEditSheet, type EditTarget } from "./player/ChordEditSheet";
import { ChordStrip, type CardShape } from "./player/ChordStrip";
import { DEFAULT_PATTERN_KEY, RhythmCard, type PlayerStrum } from "./player/RhythmCard";
import { Screen } from "./Screen";
import type { PremiumReason } from "./PremiumSheet";
import { Icon, LockIcon, TunerIcon } from "./ui";

const SLOW = 0.5;
const MAX_SHIFT = 6;
const SAVE_EVERY_MS = 10_000;
const SETTINGS_DEBOUNCE_MS = 600;
const NOTE_MS = 4000;
const TOAST_MS = 3000;
// The strip runs this far ahead of the music (real seconds, so also when slowed down).
const LEAD_SEC = 0.3;

// chord null = no chord; unsure = a detected chord the detector was not confident about.
export type PlayerEvent = TimedEvent & { chord: ChordJson | null; unsure?: boolean };
export type { PlayerStrum };

/** Everything the player shows; built from a song or from an analysis. */
export interface PlayerModel {
  title: string; // raw: a YouTube title is cleaned for display only
  artist: string | null; // the catalog's artist; analyses take it from the title
  source: string; // the second line when there is no artist ("YouTube", "Fayl")
  capo: number; // the song's own; analyses have none
  key: Key | null; // names the chords: G# in C#m, Ab in Fm
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
  // Analyses: the song may have been played in a down-tuning (shift -1 = Eb standard);
  // its shapes are the chords moved up by -shift. Offered in the sheet, off at first:
  // a standard-tuned guitar with a capo plays the same sound without retuning.
  altTuning?: { name: string; shift: number } | null;
  onOpenTuner?: (preset: PresetId) => void;
  strum: PlayerStrum;
  storageKey: string; // "song:12" / "analysis:5": this song's remembered voicings
  settings: PlayerSettings | null; // the user's capo / key / simple, from the server
  onSettings?: (s: PlayerSettings) => void;
  // ✎: "fix" changes the user's own song at once, "suggest" sends the admin a suggestion.
  // Resolves to the message to show.
  editMode: "fix" | "suggest";
  onChordEdit?: (events: number[], chord: ChordJson) => Promise<string>;
}

interface Props {
  songId: number;
  notation: NotationKind;
  onBack: () => void;
  onPaywall: (song: SongSummary) => void;
  onEdit?: () => void; // admins: open the chord editor
  onOpenTuner: (preset: PresetId) => void; // the header's tuner icon
  isPremium: boolean;
  onPremium: (reason: PremiumReason) => void;
}

/** Slow mode and section loop are premium: shown with a lock, tapping opens the sheet. */
export interface PlayerLocks {
  isPremium: boolean;
  onPremium: (reason: PremiumReason) => void;
}

/** Every song strums: its own pattern, else Pop; its tempo, else DEFAULT_BPM. */
export function defaultStrum(bpm: number | null, beats: number[] | null): PlayerStrum {
  return {
    patterns: { [DEFAULT_PATTERN_KEY]: { ...DEFAULT_PATTERN, strokes: strokes(DEFAULT_PATTERN.slots) } },
    eventPatterns: [],
    bpm: bpm && bpm > 0 ? bpm : DEFAULT_BPM,
    beats,
    perBar: 8,
  };
}

function songStrum(song: SongDetail): PlayerStrum {
  const base = defaultStrum(song.bpm ?? song.bpm_detected, song.beats);
  for (const p of song.strum_patterns) {
    base.patterns[String(p.id)] = { name: p.name, slots: p.slots, strokes: strokes(p.slots) };
  }
  return {
    ...base,
    eventPatterns: patternIds(song.events, song.strum_pattern_id).map((id) =>
      id !== null && base.patterns[String(id)] ? String(id) : DEFAULT_PATTERN_KEY,
    ),
    perBar: eighthsPerBar(song.time_signature),
  };
}

/** The message for a refused suggestion: the daily limit has its own. */
function suggestionError(e: unknown): Error {
  return new Error(e instanceof ApiError && e.status === 429 ? t.edit.limit : t.edit.failed);
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
    key: { root: song.key.root, minor: song.key.quality === "min" },
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
    strum: songStrum(song),
    storageKey: `song:${song.id}`,
    settings: song.settings,
    onSettings: (s) => void api.saveSettings("song", song.id, s),
    editMode: "suggest",
    onChordEdit: async (events, chord) => {
      try {
        const r = await api.suggestChord(song.id, events.map((i) => song.events[i].id), chord);
        return t.edit.suggested(r.remaining_today);
      } catch (e) {
        throw suggestionError(e);
      }
    },
  };
}

export function SongPlayer({
  songId,
  notation,
  onBack,
  onPaywall,
  onEdit,
  onOpenTuner,
  isPremium,
  onPremium,
}: Props) {
  useBackButton(onBack);
  const [song, setSong] = useState<SongDetail | null>(null);
  const [saved, setSaved] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    api.song(songId).then(
      (s) => {
        if (cancelled) return;
        setSong(s);
        setSaved(s.saved);
      },
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

  const model = useMemo(() => (song ? { ...songModel(song), onOpenTuner } : null), [song, onOpenTuner]);
  // Optimistic, rolled back if the server says no.
  const toggleSaved = () => {
    const next = !saved;
    setSaved(next);
    api.setSaved(songId, next).catch(() => setSaved(!next));
  };
  if (!model) {
    return <PlayerLoading failed={failed} onRetry={() => setAttempt((n) => n + 1)} onBack={onBack} />;
  }
  return (
    <Player
      model={model}
      notation={notation}
      onEdit={onEdit}
      onBack={onBack}
      bookmark={{ saved, onToggle: toggleSaved }}
      locks={{ isPremium, onPremium }}
    />
  );
}

export function PlayerLoading({
  failed,
  onRetry,
  onBack,
}: {
  failed: boolean;
  onRetry: () => void;
  onBack: () => void;
}) {
  return (
    <Screen title={t.tabs.songs} onBack={onBack} bodyClassName="player-body">
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
  onBack,
  bookmark,
  locks,
}: {
  model: PlayerModel;
  notation: NotationKind;
  onEdit?: () => void;
  onBack: () => void;
  bookmark?: { saved: boolean; onToggle: () => void }; // catalog songs: the "Saqlangan" list
  locks: PlayerLocks;
}) {
  // Kapo, Ton and "Oddiy" are the user's for this song, kept on the server. Nothing is
  // applied by itself: the easiest capo is only marked in the sheet.
  const [shift, setShift] = useState(model.settings?.shift ?? 0);
  const [capo, setCapo] = useState(model.settings?.capo ?? model.capo);
  const [simple, setSimple] = useState(model.settings?.simple ?? false);
  const [speed, setSpeed] = useState(1);
  const [useAlt, setUseAlt] = useState(false);
  const [loop, setLoop] = useState<{ start: number; end: number } | null>(null);
  const [sheet, setSheet] = useState(false);
  const [editing, setEditing] = useState<EditTarget | null>(null);
  const [note, setNote] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [rhythm, setRhythm] = useState(loadRhythm);
  const [choices, setChoices] = useState<VoicingChoices>(() => loadVoicings(model.storageKey));
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
  const { time, playing, ready, error: videoError, errorCode: videoErrorCode } = video;
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
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), TOAST_MS);
    return () => clearTimeout(id);
  }, [toast]);

  // Settings go to the server a moment after the last change, and on leaving.
  const pending = useRef<PlayerSettings | null>(null);
  const onSettings = model.onSettings;
  const flushSettings = useCallback(() => {
    if (pending.current) onSettings?.(pending.current);
    pending.current = null;
  }, [onSettings]);
  const changed = useRef(false);
  useEffect(() => {
    if (!changed.current) {
      changed.current = true; // the first run is the initial state
      return;
    }
    pending.current = { capo, shift, simple };
    const id = setTimeout(flushSettings, SETTINGS_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [capo, shift, simple, flushSettings]);
  useEffect(() => flushSettings, [flushSettings]);

  const { events, sections } = model;

  // As it sounds (transposed; moved up for a down-tuning), then the shape under the capo.
  const altShift = useAlt && model.altTuning ? model.altTuning.shift : 0;
  const sound = useCallback(
    (c: ChordJson): PitchChord => {
      const s = transpose(c, shift - altShift);
      return simple ? simplify(s) : s;
    },
    [shift, altShift, simple],
  );
  const keyAt = useCallback(
    (capoAt: number) => (model.key ? transposeKey(model.key, shift - altShift - capoAt) : null),
    [model.key, shift, altShift],
  );
  const shapeKey = keyAt(capo);
  const nameIn = useCallback(
    (c: PitchChord, key: Key | null) => formatChord(spell(c, key), notation),
    [notation],
  );

  const pick = useCallback(
    (shape: PitchChord) => {
      const options = voicings(spell(shape, null));
      const k = `${shape.root}:${shape.quality}`;
      return { k, options, pick: Math.min(choices[k] ?? 0, options.length - 1) };
    },
    [choices],
  );
  const choose = (key: string, i: number) => {
    const next = { ...choices, [key]: i };
    setChoices(next);
    storeVoicings(model.storageKey, next);
  };

  const sounding = useMemo(
    () => distinctChords(events.flatMap((e) => (e.chord ? [sound(e.chord)] : []))),
    [events, sound],
  );
  const options = useMemo(
    () =>
      capoOptions(sounding, Math.max(MAX_CAPO_SHOWN, model.capo), (s) => {
        const p = pick(s);
        return p.options[p.pick];
      }),
    [sounding, model.capo, pick],
  );
  const easiest = useMemo(() => easiestCapo(options), [options]);

  const strum = model.strum;
  const grid = useMemo(
    () =>
      barGrid({
        beats: strum.beats,
        bpm: strum.bpm,
        perBar: strum.perBar,
        duration,
        changes: events.flatMap((e) => (e.chord ? [e.time_sec] : [])),
      }),
    [strum, duration, events],
  );
  const cards = useMemo(
    () => stripLayout(events, duration, { beatSec: 60 / strum.bpm }),
    [events, duration, strum.bpm],
  );
  const shapes = useMemo(() => {
    const out: Record<number, CardShape> = {};
    for (const c of cards) {
      const shape = applyCapo(sound(events[c.event].chord!), capo);
      const p = pick(shape);
      out[c.event] = {
        key: p.k,
        label: nameIn(shape, shapeKey),
        options: p.options,
        pick: p.pick,
        unsure: !!events[c.event].unsure,
      };
    }
    return out;
  }, [cards, events, sound, capo, pick, nameIn, shapeKey]);

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

  const locked = !locks.isPremium;
  const alt = model.altTuning;
  const tunerPreset: PresetId = (useAlt && alt && presetForShift(alt.shift)) || "standard";

  // ✎ edits the chord under the playhead; a long press, the card pressed.
  const editAt = (event: number) => {
    const e = events[event];
    if (!e?.chord || !model.onChordEdit) return;
    const next = events.slice(event + 1).find((x) => x.chord);
    const same = events.filter((x) => x.chord && x.chord.root === e.chord!.root && x.chord.quality === e.chord!.quality);
    setEditing({
      index: event,
      start: e.time_sec,
      end: next?.time_sec ?? duration,
      chord: e.chord,
      same: same.length,
    });
  };
  const saveEdit = async (chord: ChordJson, all: boolean) => {
    if (!editing || !model.onChordEdit) return "";
    const old = editing.chord;
    const indexes = all
      ? events.flatMap((e, i) => (e.chord && e.chord.root === old.root && e.chord.quality === old.quality ? [i] : []))
      : [editing.index];
    const message = await model.onChordEdit(indexes, chord);
    setEditing(null);
    setToast(message);
    haptic.success();
    return message;
  };

  const right = (
    <>
      {model.tag.className === "auto" && model.note && (
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
      )}
      {note && model.note && (
        <span className="avto-note" role="status">
          {model.note}
        </span>
      )}
      {model.onChordEdit && cards.length > 0 && (
        <button
          type="button"
          className="icon-button"
          aria-label={t.player.editChord}
          aria-haspopup="dialog"
          onClick={() => {
            haptic.tap();
            editAt(cards[Math.max(0, cardAt(cards, time))].event);
          }}
        >
          <Icon size={20}>
            <path d="M4 20h4L19 9l-4-4L4 16z" />
            <path d="M13.5 6.5l4 4" />
          </Icon>
        </button>
      )}
      {bookmark && (
        <button
          type="button"
          className="icon-button"
          aria-label={bookmark.saved ? t.player.unsave : t.player.save}
          aria-pressed={bookmark.saved}
          onClick={() => {
            haptic.tap();
            bookmark.onToggle();
          }}
        >
          <Icon size={22}>
            <path
              d="M6 4h12v16l-6-4-6 4z"
              fill={bookmark.saved ? "currentColor" : "none"}
            />
          </Icon>
        </button>
      )}
      {model.onOpenTuner && (
        <button
          type="button"
          className="icon-button"
          aria-label={t.home.tuner}
          onClick={() => {
            haptic.tap();
            model.onOpenTuner!(tunerPreset);
          }}
        >
          <TunerIcon />
        </button>
      )}
    </>
  );

  const bar = (
    <div className="player-dock">
      <button
        type="button"
        className="player-play"
        aria-label={playing ? t.player.pause : t.player.play}
        disabled={!ready}
        onClick={togglePlay}
      >
        {playing ? (
          <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
            <rect x="6" y="5" width="4" height="14" rx="1" />
            <rect x="14" y="5" width="4" height="14" rx="1" />
          </svg>
        ) : (
          <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
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
    </div>
  );

  return (
    <Screen
      title={shown.title}
      sub={`${artistLine(shown, model.source)} · ${model.tag.label}`}
      onBack={onBack}
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
            <p>{t.player.videoError(videoError, videoErrorCode)}</p>
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

      {events.length === 0 || cards.length === 0 ? (
        <p className="muted">{t.player.noChords}</p>
      ) : (
        <ChordStrip
          cards={cards}
          shapes={shapes}
          time={time}
          playing={playing}
          now={video.now}
          lead={LEAD_SEC * speed}
          solfege={notation === "solfege"}
          onSeek={seek}
          onVoicing={choose}
          onLongPress={model.onChordEdit ? editAt : undefined}
        />
      )}

      <div className="player-tools five">
        <button
          type="button"
          className={`player-tool${capo > 0 ? " capo" : ""}`}
          aria-haspopup="dialog"
          onClick={() => {
            haptic.tap();
            setSheet(true);
          }}
        >
          {capo > 0 ? t.player.capoN(capo) : t.player.capo}
        </button>
        <button
          type="button"
          className="player-tool"
          aria-pressed={locked ? undefined : speed !== 1}
          aria-label={locked ? `${SLOW}× · ${t.songs.premium}` : undefined}
          onClick={() => {
            haptic.tap();
            if (locked) return locks.onPremium({ kind: "slow" });
            const next = speed === 1 ? SLOW : 1;
            setSpeed(next);
            video.setRate(next);
          }}
        >
          {SLOW}×{locked && <LockIcon size={12} />}
        </button>
        <button
          type="button"
          className="player-tool"
          aria-pressed={locked ? undefined : loop !== null}
          aria-label={locked ? `${t.player.loop} · ${t.songs.premium}` : t.player.loop}
          onClick={() => {
            haptic.tap();
            if (locked) return locks.onPremium({ kind: "loop" });
            setLoop(loop ? null : sectionBounds(sections, time, duration));
          }}
        >
          {t.player.repeat}
          {locked && <LockIcon size={12} />}
        </button>
        <button
          type="button"
          className="player-tool"
          aria-pressed={shift !== 0 || simple}
          aria-haspopup="dialog"
          onClick={() => {
            haptic.tap();
            setSheet(true);
          }}
        >
          {shift === 0 ? t.player.ton : `${t.player.ton} ${t.player.keyShift(shift)}`}
        </button>
        <button
          type="button"
          className="player-tool"
          aria-pressed={rhythm}
          onClick={() => {
            haptic.tap();
            setRhythm(!rhythm);
            storeRhythm(!rhythm);
          }}
        >
          <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 3v17M5 13l7 7 7-7" />
          </svg>
          {t.player.rhythm}
        </button>
      </div>

      {rhythm && cards.length > 0 && (
        <RhythmCard strum={strum} cards={cards} grid={grid} time={time} playing={playing} now={video.now} />
      )}

      {toast && (
        <p className="player-toast" role="status">
          {toast}
        </p>
      )}

      {sheet && (
        <CapoKeySheet
          notation={notation}
          options={options}
          easiest={easiest}
          songCapo={model.capo}
          capo={capo}
          onCapo={setCapo}
          shift={shift}
          onShift={(s) => setShift(Math.max(-MAX_SHIFT, Math.min(MAX_SHIFT, s)))}
          keyName={
            model.key
              ? nameIn(
                  transpose({ root: model.key.root, quality: model.key.minor ? "min" : "maj" }, shift),
                  transposeKey(model.key, shift),
                )
              : null
          }
          simple={simple}
          onSimple={setSimple}
          shapeName={(o, i) => nameIn(o.shapes[i], keyAt(o.capo))}
          alt={alt}
          useAlt={useAlt}
          onUseAlt={setUseAlt}
          onOpenTuner={model.onOpenTuner}
          onEdit={onEdit}
          onClose={() => setSheet(false)}
        />
      )}
      {editing && (
        <ChordEditSheet
          target={editing}
          songKey={model.key}
          notation={notation}
          mode={model.editMode}
          onSave={saveEdit}
          onClose={() => setEditing(null)}
        />
      )}
    </Screen>
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
