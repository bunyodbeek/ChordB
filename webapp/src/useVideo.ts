// A media player bound to a React component: created on mount, polled for the
// playback position, destroyed on unmount. Used by the song player and the editor.
// The media is a YouTube video (IFrame API) or a local file (<audio>, localAudio.ts).
import { useCallback, useEffect, useRef, useState } from "react";

import { createAudioPlayer } from "./localAudio";
import { UNEMBEDDABLE, YTState, createPlayer, type YTPlayer } from "./youtube";

export type MediaSource =
  | { kind: "youtube"; id: string }
  | { kind: "file"; url: string | null }; // null: the file isn't in this browser (yet)

const sourceKey = (s: MediaSource) => (s.kind === "youtube" ? `yt:${s.id}` : `file:${s.url}`);

const POLL_MS = 100;

export interface VideoHandlers {
  onReady?: (p: YTPlayer) => void;
  onStateChange?: (state: number, p: YTPlayer) => void;
  /** Each poll; return a time to show instead (e.g. after a loop seek). */
  onTick?: (now: number, p: YTPlayer) => number | void;
  /** Just before the player is destroyed (e.g. save progress). */
  onDispose?: (p: YTPlayer) => void;
}

export function useVideo(source: MediaSource, startSec: number, handlers: VideoHandlers = {}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const player = useRef<YTPlayer | null>(null);
  const h = useRef(handlers);
  h.current = handlers;

  const [time, setTime] = useState(startSec);
  const [duration, setDuration] = useState<number | null>(null); // from YouTube, once known
  const [playing, setPlaying] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<"blocked" | "failed" | null>(null);

  useEffect(() => {
    if (source.kind === "file" && !source.url) return;
    let disposed = false;
    setReady(false);
    setError(null);
    const create =
      source.kind === "youtube"
        ? (events: Parameters<typeof createPlayer>[3]) =>
            createPlayer(hostRef.current!, source.id, startSec, events)
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
      onError: (e) => setError(UNEMBEDDABLE.has(e.data) ? "blocked" : "failed"),
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

  /** Exact position right now (between polls), for marking chords. */
  const now = useCallback(() => player.current?.getCurrentTime() ?? 0, []);

  return { hostRef, player, time, duration, playing, ready, error, seek, toggle, setRate, now };
}
