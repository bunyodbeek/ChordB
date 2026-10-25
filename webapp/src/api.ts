// Client for the backend's /api endpoints (backend/app/routes).
import type { NotationKind, Quality } from "./notation";
import { getInitData } from "./telegram";

export interface Settings {
  notation: NotationKind | null; // null until the user picks one
  notifications_enabled: boolean;
  timezone: string | null; // IANA; practice days are counted in it
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
  premium_until: string | null; // null with is_premium = no end date
  is_admin: boolean;
  start_song_id: number | null; // opened through a t.me/…?startapp=song_<id> link
  start_tab: "practice" | null; // opened through a t.me/…?startapp=practice link
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
  youtube_id: string;
  key: ChordJson;
  capo: number;
  difficulty: Difficulty;
  difficulty_auto: boolean; // follows the chords (the admin form's "Avto")
  language: string;
  is_premium: boolean;
  is_published: boolean;
  duration_sec: number;
  created_at: string;
  locked: boolean; // premium song this user can't open
  saved: boolean; // this user saved it (the player's bookmark)
  chords_preview: ChordJson[];
}

export type TimeSignature = "2/4" | "3/4" | "4/4" | "6/8";

/** One bar of eight eighth notes: D down, U up, - rest, x chuck. */
export interface StrumPattern {
  id: number;
  name: string;
  slots: string;
  is_premium: boolean;
  locked: boolean; // premium and this user hasn't got it (the trainer's lock)
}

export interface SongDetail extends SongSummary {
  sections: { id: number; order: number; title: string; start_sec: number }[];
  // strum_pattern_id: a different pattern from this chord on; null = the song's.
  events: (ChordJson & { id: number; time_sec: number; section_id: number | null; strum_pattern_id: number | null })[];
  position_sec: number | null; // where this user stopped last time
  strum_pattern_id: number | null; // the default pattern when the admin picked none
  strum_patterns: StrumPattern[]; // every pattern the song or its events use
  bpm: number | null; // the admin's
  bpm_detected: number | null; // from an analysis of the video, when bpm is null
  beats: number[] | null; // beat times (s) from that analysis: the player's bar grid
  time_signature: TimeSignature;
  settings: PlayerSettings | null; // this user's, null until they change something
}

/** How a user plays a song: capo, semitones up/down, simplified chords. Kept per song. */
export interface PlayerSettings {
  capo: number;
  shift: number;
  simple: boolean;
}

export type SongKind = "song" | "analysis";

/** Song fields an admin edits (POST /api/admin/songs). */
export interface SongInput {
  title: string;
  artist: string;
  youtube_id: string;
  key: ChordJson; // maj or min
  capo: number;
  difficulty: Difficulty | "auto"; // auto: the server picks it from the chords and capo
  language: string;
  is_premium: boolean;
  duration_sec: number;
  strum_pattern_id?: number | null; // null = the default pattern
  bpm?: number | null; // null = from the analysis
  time_signature?: TimeSignature;
}

export interface TimelineInput {
  sections: { title: string; start_sec: number }[];
  events: (ChordJson & { time_sec: number; strum_pattern_id?: number | null })[];
}

export interface SongsResponse {
  continue_playing: { song: SongSummary; position_sec: number } | null;
  songs: SongSummary[];
}

export interface HomeData {
  recommended: SongSummary | null; // null once every openable song has been opened
  streak: number;
  popular: SongSummary[];
  premium_price_month: number; // soʻm
}

export interface SongFilters {
  q?: string;
  difficulty?: Difficulty;
  saved?: boolean;
}

export type EventType =
  | "tuner_opened"
  | "write_access_requested"
  | "write_access_granted"
  | "premium_viewed"
  | "game_start";

// --- daily practice (/api/practice, /api/games, /api/collection) ---

export type PracticeStep = "tune" | "chord_switch" | "ear_test";
export type GameId = "chord_switch" | "ear_test";

export interface Streak {
  current: number;
  best: number;
  freezes_left: number;
  last_practice_date: string | null;
}

export interface PracticeToday {
  date: string;
  steps: PracticeStep[];
  steps_done: PracticeStep[];
  completed: boolean;
  chain: ChordJson[];
  streak: Streak;
}

export interface CollectedChord extends ChordJson {
  mode: "played" | "listened";
  unlocked_at: string;
}

export interface PracticeSummary {
  streak: Streak;
  today: PracticeToday;
  bests: { game: GameId; chain_key: string; value: number }[];
  collection: CollectedChord[];
  collectible: ChordJson[];
}

export interface GameResultOut {
  id: number;
  game: GameId;
  score: number;
  best: number;
  new_best: boolean;
  today: PracticeToday;
}

// --- ear test levels (/api/ear) ---

export type EarKind = "quality" | "chord" | "progression";

export interface EarLevel {
  level: number;
  title: string;
  kind: EarKind;
  premium: boolean;
  shown: ChordJson[][]; // the pool as the levels map lists it, groups split by "·"
  note: string; // after the chords, or instead of them
  unlocked: boolean;
  best: number | null;
}

export interface EarProgress {
  max_unlocked_level: number;
  level_count: number;
  perfect_streak: number;
  perfect_runs: number;
  levels: EarLevel[];
  active_run: { run_id: string; level: number; answered: number; expires_at: string } | null;
}

/** An answer option; level 1's are "maj" / "min" with no chords. */
export interface EarOption {
  id: string;
  chords: ChordJson[];
}

export interface EarQuestion {
  question_id: number;
  options: EarOption[];
  voicing: number[][]; // frets of each chord to play, string 6 first
}

export interface EarAnswer {
  correct: boolean;
  correct_answer: string; // option id
  played: ChordJson[]; // what sounded
}

export interface EarRun {
  run_id: string;
  level: number;
  kind: EarKind;
  title: string;
  expires_at: string;
  questions: EarQuestion[]; // never the answers: the server checks each choice
  answered: (EarAnswer & { question_id: number; choice: string })[];
}

export interface EarSide {
  id: string;
  chords: ChordJson[];
  voicing: number[][];
}

export interface EarFinish {
  score: number;
  perfect: boolean;
  level: number;
  unlocked_level: number | null;
  max_unlocked_level: number;
  best: number;
  mistakes: { question_id: number; asked: EarSide; answered: EarSide }[];
}

// --- rhythm trainer (/api/strum) ---

export interface StrumPatternProgress {
  pattern_id: number;
  unlocked_bpm: number; // the fastest tempo allowed with this pattern
  best: Record<string, number>; // bpm → best accuracy (0..1)
  mastered: boolean;
}

export interface StrumProgress {
  ladder: number[]; // 60, 80, 100, 120
  unlock_accuracy: number; // 0.9
  patterns: StrumPatternProgress[];
  mastered: number;
  top_bpm: number | null;
}

// --- premium payments (/api/payments) ---

export interface Plan {
  id: "month" | "quarter";
  days: number;
  price: number; // soʻm
}

export type PaymentStatus = "pending" | "approved" | "rejected";

export interface Payment {
  id: number;
  plan: string;
  days: number;
  amount: number;
  status: PaymentStatus;
  note: string | null; // the admin's reason on reject
  created_at: string;
  decided_at: string | null;
}

export interface PaymentInfo {
  card: string;
  card_holder: string;
  plans: Plan[];
  latest: Payment | null; // pending, or the last decision
  premium_songs: number; // published premium songs
}

// --- admin panel (/api/admin) ---

export interface UserBrief {
  id: number;
  telegram_id: number;
  first_name: string;
  last_name: string | null;
  username: string | null;
  photo_url: string | null;
}

export interface AdminUserRow extends UserBrief {
  created_at: string;
  last_seen_at: string;
  has_premium: boolean;
  premium_forever: boolean;
  premium_until: string | null;
  is_blocked_bot: boolean;
  pending_payment: boolean;
}

export type UserFilter = "all" | "premium" | "active_free" | "pending" | "blocked";

export interface AdminUsers {
  counts: Record<UserFilter, number>;
  total: number;
  items: AdminUserRow[];
}

export interface AdminPayment extends Payment {
  user: UserBrief;
}

export interface HistoryItem {
  kind: "granted" | "paid" | "rejected" | "revoked" | "expired";
  days: number | null;
  note: string | null;
  admin_name: string | null;
  created_at: string;
}

export interface AdminUserDetail {
  user: AdminUserRow;
  stats: { active_days: number; songs: number; analyses: number };
  pending: Payment | null;
  payments: Payment[];
  history: HistoryItem[];
}

export type Period = "today" | "7d" | "30d";

export type FunnelStepId = "opened" | "tuner" | "song" | "premium_viewed" | "payment_sent" | "approved";

export interface CatalogRequest {
  title: string;
  users: number;
  searches: number;
  analyses: number;
  youtube_id: string | null;
}

export interface AdminStats {
  period: Period;
  users_total: number;
  users_new: number;
  premium: number;
  active: number;
  active_free: number;
  revenue_month: number;
  new_by_day: { day: string; count: number }[]; // the last 14 days, oldest first
  funnel: { step: FunnelStepId; users: number }[];
  pending_count: number;
  pending: AdminPayment[];
  requests: CatalogRequest[];
}

export interface SongLink {
  url: string | null; // null until BOT_USERNAME is set on the server
  opened: number;
  paid: number;
}

// --- chord detection (/api/analyze) ---

export type AnalysisStatus = "queued" | "running" | "done" | "failed";

export interface AnalysisSummary {
  id: number;
  source: "upload" | "youtube";
  source_ref: string; // the YouTube URL or the uploaded file's name
  title: string | null;
  youtube_id: string | null;
  status: AnalysisStatus;
  error_code: string | null;
  cache_hit: boolean;
  key: ChordJson | null;
  bpm: number | null;
  duration_sec: number | null;
  chords_preview: ChordJson[];
  tuning_offset_cents: number | null; // sub-semitone detuning the engine corrected
  // Most likely played in a down-tuning: shift -1 = Eb standard, -2 = D standard.
  alt_tuning: { name: string; shift: number } | null;
  suggested_capo: number | null; // easier shapes in standard tuning; 0 = none
  created_at: string;
  finished_at: string | null;
}

export interface AnalysisEvent {
  start_sec: number;
  end_sec: number;
  chord: ChordJson | null; // null = no chord
  confidence: number;
}

export interface AnalysisDetail extends AnalysisSummary {
  beats: number[] | null; // set once done
  events: AnalysisEvent[] | null; // with this user's own fixes applied
  settings: PlayerSettings | null;
}

export interface ChordSuggestion {
  id: number;
  song_id: number;
  song_title: string;
  song_artist: string;
  youtube_id: string;
  user: UserBrief;
  times: number[];
  old_chord: ChordJson;
  new_chord: ChordJson;
  status: "pending" | "accepted" | "rejected";
  created_at: string;
}

export interface AnalysisHistory {
  remaining_today: number | null; // null = unlimited (premium)
  daily_limit: number;
  items: AnalysisSummary[];
}

/** `detail.code` of an /api/analyze error ("daily_limit", "file_too_large", …). */
export function errorCode(e: unknown): string | null {
  if (!(e instanceof ApiError)) return null;
  return (e.detail as { code?: string } | null)?.code ?? null;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly detail: unknown = null, // the raw `detail`, e.g. the premium paywall payload
  ) {
    super(message);
  }

  get isPaywall(): boolean {
    return (
      (this.status === 403 || this.status === 402) &&
      (this.detail as { paywall?: boolean } | null)?.paywall === true
    );
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
    throw toApiError(res.status, detail, res.statusText);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

function toApiError(status: number, detail: unknown, fallback: string): ApiError {
  // FastAPI validation errors are a list of {msg}; our own errors are strings or {code}.
  const message =
    typeof detail === "string"
      ? detail
      : Array.isArray(detail)
        ? detail.map((d: { msg?: string }) => d.msg).join("; ")
        : ((detail as { code?: string } | null)?.code ?? fallback);
  return new ApiError(status, message, detail);
}

/** An authenticated binary download (e.g. a receipt image), as an object URL. */
async function blobUrl(path: string): Promise<string> {
  const res = await fetch(`/api${path}`, { headers: { Authorization: `tma ${getInitData()}` } });
  if (!res.ok) throw toApiError(res.status, null, res.statusText);
  return URL.createObjectURL(await res.blob());
}

/** Multipart upload with progress (fetch can't report upload progress). */
function upload<T>(
  path: string,
  file: File,
  onProgress: (fraction: number) => void,
  { field = "file", extra = {} }: { field?: string; extra?: Record<string, string> } = {},
): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api${path}`);
    xhr.setRequestHeader("Authorization", `tma ${getInitData()}`);
    xhr.responseType = "json";
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve(xhr.response as T);
      else reject(toApiError(xhr.status, xhr.response?.detail ?? null, xhr.statusText));
    };
    xhr.onerror = () => reject(new TypeError("network error"));
    const form = new FormData();
    for (const [k, v] of Object.entries(extra)) form.append(k, v);
    form.append(field, file, file.name);
    xhr.send(form);
  });
}

function query(filters: SongFilters): string {
  const p = new URLSearchParams();
  if (filters.q?.trim()) p.set("q", filters.q.trim());
  if (filters.difficulty) p.set("difficulty", filters.difficulty);
  if (filters.saved) p.set("saved", "true");
  const s = p.toString();
  return s ? `?${s}` : "";
}

export const api = {
  me: () => request<Me>("GET", "/me"),
  patchSettings: (patch: Partial<Settings>) => request<Me>("PATCH", "/me/settings", patch),
  // Analytics only: never let a failed event break the UI.
  event: (type: EventType, ref = "") =>
    request<void>("POST", "/me/events", ref ? { type, ref } : { type }).catch(() => {}),
  songs: (filters: SongFilters, signal?: AbortSignal) =>
    request<SongsResponse>("GET", `/songs${query(filters)}`, undefined, signal),
  song: (id: number) => request<SongDetail>("GET", `/songs/${id}`),
  home: () => request<HomeData>("GET", "/home"),
  setSaved: (id: number, saved: boolean) =>
    request<void>(saved ? "PUT" : "DELETE", `/songs/${id}/saved`),
  // Best effort, like events: losing one progress save must not break playback.
  saveProgress: (id: number, positionSec: number) =>
    request<void>("PUT", `/songs/${id}/progress`, { position_sec: positionSec }).catch(() => {}),
  // Best effort too: the player keeps working with what is on screen.
  saveSettings: (kind: SongKind, refId: number, s: PlayerSettings) =>
    request<void>("PUT", "/song-settings", { kind, ref_id: refId, ...s }).catch(() => {}),
  suggestChord: (songId: number, eventIds: number[], chord: ChordJson) =>
    request<{ id: number; status: string; remaining_today: number }>(
      "POST",
      `/songs/${songId}/chord-suggestions`,
      { event_ids: eventIds, new_chord: chord },
    ),

  analyze: {
    youtube: (url: string) =>
      request<AnalysisDetail>("POST", "/analyze", { youtube_url: url }),
    file: (file: File, onProgress: (fraction: number) => void) =>
      upload<AnalysisDetail>("/analyze", file, onProgress),
    get: (id: number) => request<AnalysisDetail>("GET", `/analyze/${id}`),
    history: () => request<AnalysisHistory>("GET", "/analyze/history"),
    fixEvents: (id: number, changes: (ChordJson & { index: number })[]) =>
      request<AnalysisDetail>("PATCH", `/analyze/${id}/events`, { changes }),
  },

  practice: {
    today: () => request<PracticeToday>("GET", "/practice/today"),
    summary: () => request<PracticeSummary>("GET", "/practice/summary"),
    step: (step: PracticeStep) => request<PracticeToday>("POST", "/practice/step", { step }),
    result: (game: GameId, score: number, details: unknown) =>
      request<GameResultOut>("POST", "/games/result", { game, score, details }),
    unlock: (chord: ChordJson, mode: "played" | "listened" = "played") =>
      request<CollectedChord[]>("POST", "/collection/unlock", { ...chord, mode }),
  },

  ear: {
    progress: () => request<EarProgress>("GET", "/ear/progress"),
    start: (level: number) => request<EarRun>("POST", "/ear/runs", { level }),
    run: (runId: string) => request<EarRun>("GET", `/ear/runs/${runId}`),
    answer: (runId: string, questionId: number, choice: string) =>
      request<EarAnswer>("POST", `/ear/runs/${runId}/answer`, { question_id: questionId, choice }),
    finish: (runId: string) => request<EarFinish>("POST", `/ear/runs/${runId}/finish`),
  },

  strum: {
    patterns: () => request<StrumPattern[]>("GET", "/strum-patterns"),
    progress: () => request<StrumProgress>("GET", "/strum/progress"),
    save: (patternId: number, bpm: number, accuracy: number) =>
      request<StrumProgress>("POST", "/strum/progress", { pattern_id: patternId, bpm, accuracy }),
  },

  payments: {
    info: () => request<PaymentInfo>("GET", "/payments"),
    create: (plan: Plan["id"], receipt: File, onProgress: (fraction: number) => void) =>
      upload<Payment>("/payments", receipt, onProgress, { field: "receipt", extra: { plan } }),
  },

  // ADMIN_IDS only (me.is_admin).
  admin: {
    stats: (period: Period) => request<AdminStats>("GET", `/admin/stats?period=${period}`),
    users: (filter: UserFilter, q: string, offset = 0, signal?: AbortSignal) => {
      const p = new URLSearchParams({ filter, offset: String(offset) });
      if (q.trim()) p.set("q", q.trim());
      return request<AdminUsers>("GET", `/admin/users?${p}`, undefined, signal);
    },
    user: (id: number) => request<AdminUserDetail>("GET", `/admin/users/${id}`),
    grant: (id: number, days: number | null, note: string) =>
      request<AdminUserDetail>("POST", `/admin/users/${id}/premium`, { days, note: note || null }),
    revoke: (id: number) => request<AdminUserDetail>("POST", `/admin/users/${id}/premium/revoke`, {}),
    payments: () => request<AdminPayment[]>("GET", "/admin/payments"),
    receipt: (paymentId: number) => blobUrl(`/admin/payments/${paymentId}/receipt`),
    approve: (paymentId: number, days: number | null, note: string) =>
      request<AdminUserDetail>("POST", `/admin/payments/${paymentId}/approve`, {
        days,
        note: note || null,
      }),
    reject: (paymentId: number, note: string) =>
      request<AdminUserDetail>("POST", `/admin/payments/${paymentId}/reject`, { note: note || null }),
    songLink: (id: number) => request<SongLink>("GET", `/admin/songs/${id}/link`),
    songs: () => request<SongSummary[]>("GET", "/admin/songs"),
    create: (body: SongInput) => request<SongDetail>("POST", "/admin/songs", body),
    update: (id: number, patch: Partial<SongInput>) =>
      request<SongDetail>("PATCH", `/admin/songs/${id}`, patch),
    timeline: (id: number, body: TimelineInput) =>
      request<SongDetail>("PUT", `/admin/songs/${id}/events`, body),
    publish: (id: number, isPublished: boolean) =>
      request<SongSummary>("PATCH", `/admin/songs/${id}/publish`, { is_published: isPublished }),
    suggestions: () => request<ChordSuggestion[]>("GET", "/admin/chord-suggestions"),
    decide: (id: number, decision: "accept" | "reject") =>
      request<ChordSuggestion>("POST", `/admin/chord-suggestions/${id}/${decision}`),
  },
};
