// A local file (object URL) played by an <audio> element behind the same YTPlayer
// interface and events as the YouTube embed, so the song player works with both.
import { YTState, type YTPlayer } from "./youtube";

interface Events {
  onReady?: (e: { target: YTPlayer }) => void;
  onStateChange?: (e: { data: number; target: YTPlayer }) => void;
  onError?: (e: { data: number; target: YTPlayer }) => void;
}

/** Error code passed to onError (not one of YouTube's, so it reads as "failed"). */
export const AUDIO_ERROR = -100;

export function createAudioPlayer(
  host: HTMLElement,
  url: string,
  startSec: number,
  events: Events,
): Promise<YTPlayer> {
  const audio = document.createElement("audio");
  audio.preload = "auto";
  audio.src = url;
  // Slowed down for practice, a song should keep its pitch.
  audio.preservesPitch = true;
  host.replaceChildren(audio);

  let state = YTState.UNSTARTED;
  const player: YTPlayer = {
    playVideo: () => void audio.play().catch(() => {}),
    pauseVideo: () => audio.pause(),
    seekTo: (sec) => {
      audio.currentTime = sec;
    },
    getCurrentTime: () => audio.currentTime,
    getDuration: () => (Number.isFinite(audio.duration) ? audio.duration : 0),
    getPlayerState: () => state,
    setPlaybackRate: (rate) => {
      audio.playbackRate = rate;
    },
    destroy: () => {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
      audio.remove();
    },
  };

  const set = (next: number) => {
    state = next;
    events.onStateChange?.({ data: next, target: player });
  };
  audio.addEventListener("playing", () => set(YTState.PLAYING));
  audio.addEventListener("waiting", () => set(YTState.BUFFERING));
  audio.addEventListener("pause", () => !audio.ended && set(YTState.PAUSED));
  audio.addEventListener("ended", () => set(YTState.ENDED));
  audio.addEventListener("error", () => events.onError?.({ data: AUDIO_ERROR, target: player }));
  audio.addEventListener(
    "loadedmetadata",
    () => {
      if (startSec > 0) audio.currentTime = startSec;
      set(YTState.CUED);
      events.onReady?.({ target: player });
    },
    { once: true },
  );
  return Promise.resolve(player);
}
