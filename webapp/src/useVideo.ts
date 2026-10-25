// A media player bound to a React component: created on mount, polled for the
// playback position, destroyed on unmount. Used by the song player and the editor.
// The media is a YouTube video (IFrame API) or a local file (<audio>, localAudio.ts).
import { useCallback, useEffect, useRef, useState } from "react";

import { createAudioPlayer } from "./localAudio";
import { REFUSED, UNEMBEDDABLE, YTState, createPlayer, type VideoError, type YTPlayer } from "./youtube";

export type MediaSource =
  | { kind: "youtube"; id: string }
  | { kind: "file"; url: string | null }; // null: the file isn't in this browser (yet)

const sourceKey = (s: MediaSource) => (s.kind === "youtube" ? `yt:${s.id}` : `file:${s.url}`);

const POLL_MS = 100;
// YouTube's getCurrentTime() moves in steps (about four a second in the embed). Between
// steps, now() runs the clock on from the last one, for up to this long.
const MAX_GLIDE_SEC = 0.5;
// A jump this big is a seek (or a stall caught up): taken as is, not smoothed.
const JUMP_SEC = 0.3;

export interface VideoHandlers {
  onReady?: (p: YTPlayer) => void;
  onStateChange?: (state: number, p: YTPlayer) => void;
  /** Each poll; return a time to show instead (e.g. after a loop seek). */
  onTick?: (now: number, p: YTPlayer) => number | void;
  /** Just before the player is destroyed (e.g. save progress). */
  onDispose?: (p: YTPlayer) => void;
}

export function useVideo(
  source: MediaSource,
  startSec: number,
  handlers: VideoHandlers = {},
  { controls = true }: { controls?: boolean } = {}, // YouTube's own controls
) {
  const hostRef = useRef<HTMLDivElement>(null);
  const player = useRef<YTPlayer | null>(null);
  const clock = useRef({ raw: -1, at: 0, shown: 0 }); // now()'s last step and answer
  const h = useRef(handlers);
  h.current = handlers;

  const [time, setTime] = useState(startSec);
  const [duration, setDuration] = useState<number | null>(null); // from YouTube, once known
  const [playing, setPlaying] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<VideoError | null>(null);
  const [errorCode, setErrorCode] = useState<number | null>(null); // YouTube's, shown to tell causes apart

  useEffect(() => {
    if (source.kind === "file" && !source.url) return;
    let disposed = false;
    setReady(false);
    setError(null);
    setErrorCode(null);
    const create =
      source.kind === "youtube"
        ? (events: Parameters<typeof createPlayer>[3]) =>
            createPlayer(hostRef.current!, source.id, startSec, events, { controls })
        : (events: Parameters<typeof createPlayer>[3]) =>
            createAudioPlayer(hostRef.current!, source.url!, startSec, events);
    create({
      onReady: (e) => {
        if (disposed) return e.target.destroy();
        player.current = e.target;
        setReady(true);
        h.current.onReady?.(e.target);
      },
      onStateChange: (e) => {
        setPlaying(e.data === YTState.PLAYING || e.data === YTState.BUFFERING);
        h.current.onStateChange?.(e.data, e.target);
      },
      onError: (e) => {
        setErrorCode(e.data);
        setError(UNEMBEDDABLE.has(e.data) ? "blocked" : REFUSED.has(e.data) ? "refused" : "failed");
      },
    }).catch(() => setError("failed"));

    const id = setInterval(() => {
      const p = player.current;
      if (!p) return;
      const d = p.getDuration();
      if (d > 0) setDuration((prev) => (prev === d ? prev : d));
      const now = p.getCurrentTime();
      const shown = h.current.onTick?.(now, p);
      setTime(typeof shown === "number" ? shown : now);
    }, POLL_MS);

    return () => {
      disposed = true;
      clearInterval(id);
      const p = player.current;
      if (p) {
        h.current.onDispose?.(p);
        p.destroy();
      }
      player.current = null;
    };
    // startSec only matters when the player is created.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceKey(source)]);

  const seek = useCallback((sec: number) => {
    const p = player.current;
    if (!p) return;
    p.seekTo(sec, true);
    setTime(sec);
  }, []);

  const toggle = useCallback(() => {
    const p = player.current;
    if (!p) return;
    if (p.getPlayerState() === YTState.PLAYING) p.pauseVideo();
    else p.playVideo();
  }, []);

  const setRate = useCallback((rate: number) => player.current?.setPlaybackRate(rate), []);

  /**
   * The position right now, for marking chords every frame: the player's, run on smoothly
   * between its steps while playing, and never backwards by a jitter.
   */
  const now = useCallback(() => {
    const p = player.current;
    if (!p) return 0;
    const c = clock.current;
    const raw = p.getCurrentTime();
    const at = performance.now();
    if (raw !== c.raw) {
      c.raw = raw;
      c.at = at;
    }
    if (p.getPlayerState() !== YTState.PLAYING) return (c.shown = raw);
    const glide = Math.min(MAX_GLIDE_SEC, (at - c.at) / 1000) * (p.getPlaybackRate() || 1);
    const t = raw + glide;
    c.shown = Math.abs(t - c.shown) > JUMP_SEC ? t : Math.max(c.shown, t);
    return c.shown;
  }, []);

  return { hostRef, player, time, duration, playing, ready, error, errorCode, seek, toggle, setRate, now };
}
