// Practice games, pure parts: ear-test labels, the guitar's tuning offset for chord
// recognition. The API side is /api/practice, /api/games, /api/collection and /api/ear.
import type { ChordJson, EarFinish, EarKind, EarLevel, EarOption } from "./api";
import { spelled } from "./chords";
import { formatChord, type NotationKind } from "./notation";
import { t } from "./texts";
import type { PresetId } from "./tuning";

export const EAR_QUESTIONS = 10;
export const SWITCH_SECONDS = 60;

// --- ear test (the levels, questions and answers come from /api/ear) ---------------

/** "Am", "C → G → Am → F", or level 1's "Major" / "Minor". */
export function earOptionLabel(option: EarOption, notation: NotationKind): string {
  if (!option.chords.length) return t.practice.qualities[option.id] ?? option.id;
  return option.chords.map((c) => formatChord(spelled(c), notation)).join(" → ");
}

/** The chords that sounded, by name. */
export function chordsLabel(chords: ChordJson[], notation: NotationKind): string {
  return chords.map((c) => formatChord(spelled(c), notation)).join(" → ");
}

/** A level's pool on the levels map: "C G D A E · Am Em Dm", "F Bm + ochiq". */
export function earPoolLabel(level: Pick<EarLevel, "shown" | "note">, notation: NotationKind): string {
  // Solfège names have spaces of their own ("Lya minor"), so they need commas.
  const sep = notation === "solfege" ? ", " : " ";
  const groups = level.shown.map((g) => g.map((c) => formatChord(spelled(c), notation)).join(sep));
  return [groups.join(" · "), level.note].filter(Boolean).join(" ");
}

export type MistakeTip = keyof typeof t.practice.tips;

/** Which hint fits a run's mistakes: major/minor, 7th chords, the order, or a general one. */
export function mistakeTip(kind: EarKind, mistakes: EarFinish["mistakes"]): MistakeTip {
  if (kind === "progression") return "progression";
  const pairs = mistakes.map((m) => [m.asked.chords[0], m.answered.chords[0]]).filter(([a, b]) => a && b);
  if (pairs.some(([a, b]) => a.quality === "7" || b.quality === "7")) return "seventh";
  if (kind === "quality" || pairs.some(([a, b]) => a.quality !== b.quality)) return "quality";
  return "chord";
}

export function toJson(c: ChordJson): ChordJson {
  return { root: c.root, quality: c.quality };
}

// --- the guitar's tuning, for chord recognition -------------------------------------

const RESIDUAL_KEY = "chordb.tuningResidual";
const PRESET_CENTS: Record<PresetId, number> = {
  standard: 0,
  half_down: -100,
  whole_down: -200,
  drop_d: 0, // only the low string moves; chord pitch classes are unaffected
};

/** The tuner saves how far off A440 the tuned strings ended up (a few cents). */
export function saveTuningResidual(cents: number): void {
  try {
    localStorage.setItem(RESIDUAL_KEY, String(Math.round(cents * 10) / 10));
  } catch {
    // storage blocked: recognition just assumes A440
  }
}

function loadResidual(): number {
  try {
    const v = Number(localStorage.getItem(RESIDUAL_KEY));
    return Number.isFinite(v) ? Math.max(-50, Math.min(50, v)) : 0;
  } catch {
    return 0;
  }
}

/** Offset for chord recognition: the tuner's preset plus the measured residual. */
export function tuningOffsetCents(preset: PresetId): number {
  return PRESET_CENTS[preset] + loadResidual();
}
