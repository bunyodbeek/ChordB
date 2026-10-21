// Admin panel: formatting and the analysis → song conversion. Pure: no React, no API calls.
import type { AdminUserRow, AnalysisEvent, ChordJson, HistoryItem, TimelineInput } from "../api";
import { t } from "../texts";

const MONTHS_SHORT = ["yan", "fev", "mar", "apr", "may", "iyun", "iyul", "avg", "sen", "okt", "noyab", "dek"];
const MONTHS = [
  "yanvar", "fevral", "mart", "aprel", "may", "iyun",
  "iyul", "avgust", "sentabr", "oktabr", "noyabr", "dekabr",
];

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Days active in the last week before someone counts as idle (matches the backend). */
export const ACTIVE_DAYS = 7;
/** Analysis segments below this posterior get the dashed "check me" border. */
export const LOW_CONFIDENCE = 0.5;

export function displayName(u: { first_name: string; last_name: string | null }): string {
  return [u.first_name, u.last_name].filter(Boolean).join(" ");
}

/** "Sevara Mirzayeva" → "SM"; "aziz" → "A". */
export function initials(u: { first_name: string; last_name: string | null }): string {
  const parts = [u.first_name, u.last_name ?? ""].map((p) => p.trim()).filter(Boolean);
  return parts
    .slice(0, 2)
    .map((p) => Array.from(p)[0].toUpperCase())
    .join("");
}

/** 840000 → "840 000" (the design's thin grouping, a plain space here). */
export function formatAmount(n: number): string {
  return Math.round(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

export const formatSom = (n: number) => `${formatAmount(n)} soʻm`;

/** "12-okt" */
export function shortDate(iso: string | Date): string {
  const d = new Date(iso);
  return `${d.getDate()}-${MONTHS_SHORT[d.getMonth()]}`;
}

/** "14.11.2026" */
export function fullDate(iso: string | Date): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
}

export const monthName = (d: Date) => MONTHS[d.getMonth()];

/** "Oktabr 2026" */
export function monthTitle(d: Date): string {
  const m = monthName(d);
  return `${m[0].toUpperCase()}${m.slice(1)} ${d.getFullYear()}`;
}

/** "hozir", "5 daq oldin", "3 soat oldin", "kecha", "16 kun oldin". */
export function ago(iso: string, now: Date = new Date()): string {
  const ms = now.getTime() - new Date(iso).getTime();
  if (ms < MINUTE) return "hozir";
  if (ms < HOUR) return `${Math.floor(ms / MINUTE)} daq oldin`;
  if (ms < DAY) return `${Math.floor(ms / HOUR)} soat oldin`;
  if (ms < 2 * DAY) return "kecha";
  return `${Math.floor(ms / DAY)} kun oldin`;
}

export type Tone = "pending" | "premium" | "free" | "blocked";

/** The users table's status pill. */
export function userStatus(u: AdminUserRow, now: Date = new Date()): { label: string; tone: Tone } {
  const s = t.panel.status;
  if (u.pending_payment) return { label: s.pending, tone: "pending" };
  if (u.has_premium) {
    return {
      label: u.premium_forever || !u.premium_until ? s.premiumForever : s.premiumUntil(shortDate(u.premium_until)),
      tone: "premium",
    };
  }
  if (u.is_blocked_bot) return { label: s.blocked, tone: "blocked" };
  const active = now.getTime() - new Date(u.last_seen_at).getTime() < ACTIVE_DAYS * DAY;
  return { label: active ? s.freeActive : s.freeIdle, tone: "free" };
}

export function historyLine(h: HistoryItem): string {
  const who = h.admin_name ?? t.panel.adminFallback;
  const line = t.panel.historyLine;
  switch (h.kind) {
    case "granted":
      return line.granted(who, h.days);
    case "paid":
      return line.paid(who, h.days);
    case "rejected":
      return line.rejected(who);
    case "revoked":
      return line.revoked(who);
    case "expired":
      return line.expired();
  }
}

/** Share of `n` in `total`, "3,4%" (Uzbek decimal comma); "0%" when total is 0. */
export function percent(n: number, total: number): string {
  if (!total) return "0%";
  const v = Math.round((n / total) * 1000) / 10;
  return `${String(v).replace(".", ",")}%`;
}

export interface ChordChange extends ChordJson {
  time_sec: number;
  low: boolean; // the detector wasn't sure
}

/**
 * Analysis segments as chord changes: "no chord" gaps dropped and a chord that carries
 * on across them merged, so the result is what the song timeline stores.
 */
export function chordChanges(segments: readonly AnalysisEvent[]): ChordChange[] {
  const out: ChordChange[] = [];
  for (const s of segments) {
    if (!s.chord) continue;
    const prev = out.at(-1);
    if (prev && prev.root === s.chord.root && prev.quality === s.chord.quality) {
      prev.low = prev.low && s.confidence < LOW_CONFIDENCE;
      continue;
    }
    out.push({
      time_sec: Math.round(s.start_sec * 100) / 100,
      root: s.chord.root,
      quality: s.chord.quality,
      low: s.confidence < LOW_CONFIDENCE,
    });
  }
  return out;
}

export function changesToTimeline(changes: readonly ChordChange[]): TimelineInput {
  return { sections: [], events: changes.map(({ time_sec, root, quality }) => ({ time_sec, root, quality })) };
}

/** Rows of `size` for the chord grid. */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += size) rows.push(items.slice(i, i + size));
  return rows;
}
