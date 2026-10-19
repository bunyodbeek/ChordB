// Client for the backend's /api endpoints (backend/app/routes).
import type { NotationKind, Quality } from "./notation";
import { getInitData } from "./telegram";

export interface Settings {
  notation: NotationKind | null; // null until the user picks one
  notifications_enabled: boolean;
}

export interface Me {
  id: number;
  telegram_id: number;
  first_name: string;
  last_name: string | null;
  username: string | null;
  language_code: string | null;
  photo_url: string | null;
  is_premium_tg: boolean;
  created_at: string;
  settings: Settings;
  needs_write_access: boolean;
  is_premium: boolean; // ChordB premium: unlocks premium songs
  is_admin: boolean;
}

/** Canonical chord as stored by the backend; render with formatChord. */
export interface ChordJson {
  root: number;
  quality: Quality;
}

export type Difficulty = "easy" | "medium" | "hard";

export interface SongSummary {
  id: number;
  title: string;
  artist: string;
  key: ChordJson;
  capo: number;
  difficulty: Difficulty;
  language: string;
  is_premium: boolean;
  is_published: boolean;
  duration_sec: number;
  created_at: string;
  locked: boolean; // premium song this user can't open
  chords_preview: ChordJson[];
}

export interface SongDetail extends SongSummary {
  youtube_id: string;
  sections: { id: number; order: number; title: string; start_sec: number }[];
  events: (ChordJson & { time_sec: number; section_id: number | null })[];
  position_sec: number | null; // where this user stopped last time
}

/** Song fields an admin edits (POST /api/admin/songs). */
export interface SongInput {
  title: string;
  artist: string;
  youtube_id: string;
  key: ChordJson; // maj or min
  capo: number;
  difficulty: Difficulty;
  language: string;
  is_premium: boolean;
  duration_sec: number;
}

export interface TimelineInput {
  sections: { title: string; start_sec: number }[];
  events: (ChordJson & { time_sec: number })[];
}

export interface SongsResponse {
  continue_playing: { song: SongSummary; position_sec: number } | null;
  songs: SongSummary[];
}

export interface SongFilters {
  q?: string;
  easy?: boolean;
  uzbek?: boolean;
  no_capo?: boolean;
}

export type EventType = "tuner_opened" | "write_access_requested" | "write_access_granted";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly detail: unknown = null, // the raw `detail`, e.g. the premium paywall payload
  ) {
    super(message);
  }

  get isPaywall(): boolean {
    return this.status === 403 && (this.detail as { paywall?: boolean } | null)?.paywall === true;
  }
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: {
      Authorization: `tma ${getInitData()}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    const detail = await res.json().then((j) => j.detail, () => null);
    // FastAPI validation errors are a list of {msg}; our own errors are strings.
    const message =
      typeof detail === "string"
        ? detail
        : Array.isArray(detail)
          ? detail.map((d: { msg?: string }) => d.msg).join("; ")
          : res.statusText;
    throw new ApiError(res.status, message, detail);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

function query(filters: SongFilters): string {
  const p = new URLSearchParams();
  if (filters.q?.trim()) p.set("q", filters.q.trim());
  if (filters.easy) p.set("easy", "true");
  if (filters.uzbek) p.set("uzbek", "true");
  if (filters.no_capo) p.set("no_capo", "true");
  const s = p.toString();
  return s ? `?${s}` : "";
}

export const api = {
  me: () => request<Me>("GET", "/me"),
  patchSettings: (patch: Partial<Settings>) => request<Me>("PATCH", "/me/settings", patch),
  // Analytics only: never let a failed event break the UI.
  event: (type: EventType) => request<void>("POST", "/me/events", { type }).catch(() => {}),
  songs: (filters: SongFilters, signal?: AbortSignal) =>
    request<SongsResponse>("GET", `/songs${query(filters)}`, undefined, signal),
  song: (id: number) => request<SongDetail>("GET", `/songs/${id}`),
  // Best effort, like events: losing one progress save must not break playback.
  saveProgress: (id: number, positionSec: number) =>
    request<void>("PUT", `/songs/${id}/progress`, { position_sec: positionSec }).catch(() => {}),

  // ADMIN_IDS only (me.is_admin).
  admin: {
    songs: () => request<SongSummary[]>("GET", "/admin/songs"),
    create: (body: SongInput) => request<SongDetail>("POST", "/admin/songs", body),
    update: (id: number, patch: Partial<SongInput>) =>
      request<SongDetail>("PATCH", `/admin/songs/${id}`, patch),
    timeline: (id: number, body: TimelineInput) =>
      request<SongDetail>("PUT", `/admin/songs/${id}/events`, body),
    publish: (id: number, isPublished: boolean) =>
      request<SongSummary>("PATCH", `/admin/songs/${id}/publish`, { is_published: isPublished }),
  },
};
