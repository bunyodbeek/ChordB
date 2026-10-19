// Client for the backend's /api/me endpoints (see backend/app/routes/me.py).
import type { NotationKind } from "./notation";
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
}

export type EventType = "tuner_opened" | "write_access_requested" | "write_access_granted";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: {
      Authorization: `tma ${getInitData()}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.json().then((j) => j.detail, () => res.statusText);
    throw new ApiError(res.status, typeof detail === "string" ? detail : res.statusText);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

export const api = {
  me: () => request<Me>("GET", "/me"),
  patchSettings: (patch: Partial<Settings>) => request<Me>("PATCH", "/me/settings", patch),
  // Analytics only: never let a failed event break the UI.
  event: (type: EventType) => request<void>("POST", "/me/events", { type }).catch(() => {}),
};
