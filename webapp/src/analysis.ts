// Automatic chord detection, UI side: error texts, history labels and the conversion
// of an analysis into the song player's model. Pure apart from the file registry.
import type { AnalysisDetail, AnalysisSummary } from "./api";
import { t } from "./texts";
import { autoTimeline } from "./timeline";

/** Uzbek message for an analysis error code (a failed job or a refused request). */
export function analysisErrorText(
  code: string | null,
  source: "upload" | "youtube",
  dailyLimit = 3,
): string {
  const e = t.analyze.errors;
  switch (code) {
    case "blocked":
      return e.blocked;
    case "private_or_removed":
    case "not_found":
    case "too_long":
    case "too_short":
    case "decode_failed":
    case "timeout":
    case "invalid_url":
    case "file_too_large":
    case "unsupported_type":
    case "empty_file":
      return e[code];
    case "daily_limit":
      return e.daily_limit(dailyLimit);
    default:
      // unknown, crashed, interrupted, ffmpeg_missing, …
      return source === "youtube" ? e.youtubeUnknown : e.generic;
  }
}

export function analysisTitle(a: AnalysisSummary): string {
  if (a.title) return a.title;
  // A YouTube job gets its title once downloaded; until then (or on failure) the link.
  return a.source === "youtube" && a.youtube_id ? `youtu.be/${a.youtube_id}` : a.source_ref;
}

export const isActive = (a: AnalysisSummary) => a.status === "queued" || a.status === "running";

// Uploaded files live only in this browser session: analysis id -> object URL.
const localFiles = new Map<number, string>();

export function rememberFile(analysisId: number, file: File): string {
  const old = localFiles.get(analysisId);
  if (old) URL.revokeObjectURL(old);
  const url = URL.createObjectURL(file);
  localFiles.set(analysisId, url);
  return url;
}

export const localFileUrl = (analysisId: number) => localFiles.get(analysisId) ?? null;

/** The parts of the player model that come from the analysis itself. */
export function analysisTimeline(a: AnalysisDetail) {
  const { events, sections } = autoTimeline(a.events ?? [], t.analyze.part);
  const lastEnd = a.events?.length ? a.events[a.events.length - 1].end_sec : 0;
  return {
    events,
    sections,
    beats: a.beats,
    durationSec: Math.max(a.duration_sec ?? 0, lastEnd, 1),
  };
}
