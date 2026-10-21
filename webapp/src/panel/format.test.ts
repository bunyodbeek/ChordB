import { describe, expect, it } from "vitest";

import type { AdminUserRow } from "../api";
import {
  ago,
  chordChanges,
  formatAmount,
  fullDate,
  initials,
  monthTitle,
  percent,
  shortDate,
  userStatus,
} from "./format";

const NOW = new Date("2026-10-21T12:00:00");

function row(over: Partial<AdminUserRow> = {}): AdminUserRow {
  return {
    id: 1,
    telegram_id: 5,
    first_name: "Sevara",
    last_name: "M.",
    username: "sevara_m",
    photo_url: null,
    created_at: "2026-10-12T10:00:00",
    last_seen_at: "2026-10-21T11:55:00",
    has_premium: false,
    premium_forever: false,
    premium_until: null,
    is_blocked_bot: false,
    pending_payment: false,
    ...over,
  };
}

describe("formatting", () => {
  it("initials", () => {
    expect(initials({ first_name: "Sevara", last_name: "M." })).toBe("SM");
    expect(initials({ first_name: "aziz", last_name: null })).toBe("A");
    expect(initials({ first_name: "Oʻtkir", last_name: " " })).toBe("O");
  });

  it("amounts", () => {
    expect(formatAmount(840000)).toBe("840 000");
    expect(formatAmount(1500)).toBe("1 500");
    expect(formatAmount(999)).toBe("999");
  });

  it("dates", () => {
    expect(shortDate("2026-10-12T10:00:00")).toBe("12-okt");
    expect(shortDate("2026-11-14T10:00:00")).toBe("14-noyab");
    expect(fullDate("2026-11-04T10:00:00")).toBe("04.11.2026");
    expect(monthTitle(NOW)).toBe("Oktabr 2026");
  });

  it("ago", () => {
    expect(ago("2026-10-21T11:59:30", NOW)).toBe("hozir");
    expect(ago("2026-10-21T11:48:00", NOW)).toBe("12 daq oldin");
    expect(ago("2026-10-21T09:00:00", NOW)).toBe("3 soat oldin");
    expect(ago("2026-10-20T09:00:00", NOW)).toBe("kecha");
    expect(ago("2026-10-05T12:00:00", NOW)).toBe("16 kun oldin");
  });

  it("percent with a decimal comma", () => {
    expect(percent(42, 1248)).toBe("3,4%");
    expect(percent(1, 0)).toBe("0%");
    expect(percent(5, 5)).toBe("100%");
  });
});

describe("userStatus", () => {
  it("pending beats everything", () => {
    expect(userStatus(row({ pending_payment: true, has_premium: true }), NOW).tone).toBe("pending");
  });

  it("premium with and without an end date", () => {
    expect(userStatus(row({ has_premium: true, premium_until: "2026-11-14T10:00:00" }), NOW).label).toBe(
      "Premium · 14-noyab gacha",
    );
    expect(userStatus(row({ has_premium: true, premium_forever: true }), NOW).label).toBe(
      "Premium · muddatsiz",
    );
  });

  it("free: active within a week, idle after", () => {
    expect(userStatus(row(), NOW).label).toBe("Bepul · faol");
    expect(userStatus(row({ last_seen_at: "2026-10-05T12:00:00" }), NOW).label).toBe("Bepul · nofaol");
  });
});

describe("chordChanges", () => {
  const am = { root: 9, quality: "min" as const };
  const f = { root: 5, quality: "maj" as const };

  it("drops no-chord gaps and merges a chord held across them", () => {
    const changes = chordChanges([
      { start_sec: 0, end_sec: 1, chord: null, confidence: 0.9 },
      { start_sec: 1.004, end_sec: 2, chord: am, confidence: 0.9 },
      { start_sec: 2, end_sec: 3, chord: null, confidence: 0.9 },
      { start_sec: 3, end_sec: 4, chord: am, confidence: 0.3 },
      { start_sec: 4, end_sec: 5, chord: f, confidence: 0.3 },
    ]);
    expect(changes).toEqual([
      { time_sec: 1, ...am, low: false },
      { time_sec: 4, ...f, low: true },
    ]);
  });

  it("a change is low only if every part of it was", () => {
    const changes = chordChanges([
      { start_sec: 0, end_sec: 1, chord: am, confidence: 0.2 },
      { start_sec: 1, end_sec: 2, chord: am, confidence: 0.2 },
    ]);
    expect(changes[0].low).toBe(true);
  });
});
