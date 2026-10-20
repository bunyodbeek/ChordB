import { describe, expect, it } from "vitest";

import { analysisErrorText, analysisTimeline, analysisTitle } from "./analysis";
import type { AnalysisDetail } from "./api";
import { t } from "./texts";

const BLOCKED = "YouTube'dan yuklab boʻlmadi. Videoni faylga saqlab, «Galereyadan» orqali yuklang.";

describe("analysisErrorText", () => {
  it("uses the required message for blocked and unknown YouTube downloads", () => {
    expect(analysisErrorText("blocked", "youtube")).toBe(BLOCKED);
    expect(analysisErrorText("unknown", "youtube")).toBe(BLOCKED);
    expect(analysisErrorText("crashed", "youtube")).toBe(BLOCKED);
  });

  it("has a message for every other code", () => {
    for (const code of [
      "private_or_removed", "not_found", "too_long", "too_short", "decode_failed", "timeout",
      "invalid_url", "file_too_large", "unsupported_type", "empty_file",
    ]) {
      const text = analysisErrorText(code, "upload");
      expect(text, code).not.toBe(t.analyze.errors.generic);
      expect(text, code).toBeTruthy();
    }
  });

  it("falls back to a generic message for uploads", () => {
    expect(analysisErrorText("unknown", "upload")).toBe(t.analyze.errors.generic);
    expect(analysisErrorText(null, "upload")).toBe(t.analyze.errors.generic);
    expect(analysisErrorText("ffmpeg_missing", "upload")).toBe(t.analyze.errors.generic);
  });

  it("names the daily limit", () => {
    expect(analysisErrorText("daily_limit", "upload", 3)).toContain("3 ta");
  });
});

const AM = { root: 9, quality: "min" as const };
const F = { root: 5, quality: "maj" as const };

function detail(over: Partial<AnalysisDetail> = {}): AnalysisDetail {
  return {
    id: 1, source: "upload", source_ref: "qoshiq.m4a", title: null, youtube_id: null,
    status: "done", error_code: null, cache_hit: false, key: AM, bpm: 96, duration_sec: 12,
    chords_preview: [AM, F], created_at: "", finished_at: "",
    beats: [0.5, 1.1],
    events: [
      { start_sec: 0, end_sec: 4, chord: AM, confidence: 0.9 },
      { start_sec: 4, end_sec: 9, chord: null, confidence: 0.6 },
      { start_sec: 9, end_sec: 12.5, chord: F, confidence: 0.8 },
    ],
    ...over,
  };
}

describe("analysisTimeline", () => {
  it("turns segments into player events, keeping no-chord ones", () => {
    const tl = analysisTimeline(detail());
    expect(tl.events.map((e) => [e.time_sec, e.chord])).toEqual([[0, AM], [4, null], [9, F]]);
    expect(tl.sections).toEqual([{ id: 1, title: "1-qism", start_sec: 0 }]);
    expect(tl.beats).toEqual([0.5, 1.1]);
    expect(tl.durationSec).toBe(12.5); // covers the last segment
  });

  it("copes with an empty result", () => {
    const tl = analysisTimeline(detail({ events: [], duration_sec: null, beats: null }));
    expect(tl.events).toEqual([]);
    expect(tl.durationSec).toBe(1);
  });
});

describe("analysisTitle", () => {
  it("prefers the title, then the file name", () => {
    expect(analysisTitle(detail({ title: "Yor-yor" }))).toBe("Yor-yor");
    expect(analysisTitle(detail())).toBe("qoshiq.m4a");
    expect(analysisTitle(detail({ source: "youtube", youtube_id: "jNQXAC9IVRw" }))).toBe(
      "youtu.be/jNQXAC9IVRw",
    );
  });
});
