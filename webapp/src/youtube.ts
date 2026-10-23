// Official YouTube IFrame Player API (https://developers.google.com/youtube/iframe_api_reference).
// Video is only ever played through the embed; nothing is downloaded.

export const YTState = { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 };

// Error codes that mean "this video can't be played here", not "try again".
// 101/150: the owner disabled embedding.
export const UNEMBEDDABLE = new Set([101, 150]);
// 100: removed or private; 152/153: YouTube refused this embed (153 = no Referer sent).
export const REFUSED = new Set([100, 152, 153]);

export type VideoError = "blocked" | "refused" | "failed";

export interface YTPlayer {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  getCurrentTime(): number;
  getDuration(): number;
  getPlayerState(): number;
  setPlaybackRate(rate: number): void;
  destroy(): void;
}

interface YTPlayerOptions {
  videoId: string;
  width?: string | number;
  height?: string | number;
  playerVars?: Record<string, string | number>;
  events?: {
    onReady?: (e: { target: YTPlayer }) => void;
    onStateChange?: (e: { data: number; target: YTPlayer }) => void;
    onError?: (e: { data: number; target: YTPlayer }) => void;
  };
}

interface YTNamespace {
  Player: new (el: HTMLElement, options: YTPlayerOptions) => YTPlayer;
}

declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let loading: Promise<YTNamespace> | null = null;

/** Load https://www.youtube.com/iframe_api once. */
export function loadYouTubeApi(): Promise<YTNamespace> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  loading ??= new Promise<YTNamespace>((resolve, reject) => {
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      resolve(window.YT!);
    };
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    script.async = true;
    script.onerror = () => {
      loading = null; // allow a retry
      reject(new Error("YouTube API failed to load"));
    };
    document.head.appendChild(script);
  });
  return loading;
}

/**
 * Create a player inside `host` (its contents are replaced by the iframe).
 * `controls: false`: no YouTube controls at all; the page's own player bar drives it.
 */
export async function createPlayer(
  host: HTMLElement,
  videoId: string,
  startSec: number,
  events: NonNullable<YTPlayerOptions["events"]>,
  { controls = true }: { controls?: boolean } = {},
): Promise<YTPlayer> {
  const YT = await loadYouTubeApi();
  const mount = document.createElement("div");
  host.replaceChildren(mount);
  return new YT.Player(mount, {
    videoId,
    width: "100%",
    height: "100%",
    playerVars: {
      playsinline: 1, // iOS: play inside the Mini App, not fullscreen
      rel: 0,
      modestbranding: 1,
      ...(controls ? {} : { controls: 0, disablekb: 1, fs: 0, iv_load_policy: 3 }),
      start: Math.floor(startSec),
      origin: window.location.origin,
    },
    events,
  });
}
