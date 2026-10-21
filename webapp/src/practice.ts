// Practice games, pure parts: ear-test questions, the guitar's tuning offset for chord
// recognition. The API side is /api/practice, /api/games and /api/collection.
import type { ChordJson } from "./api";
import type { Chord, Quality } from "./notation";
import type { PresetId } from "./tuning";

export const EAR_QUESTIONS = 10;
export const SWITCH_SECONDS = 60;

// Level 1: major vs minor, with the chords beginners meet first.
const EAR_POOL: Chord[] = [
  { root: 0, quality: "maj" },
  { root: 7, quality: "maj" },
  { root: 2, quality: "maj" },
  { root: 9, quality: "maj" },
  { root: 4, quality: "maj" },
  { root: 5, quality: "maj" },
  { root: 9, quality: "min" },
  { root: 4, quality: "min" },
  { root: 2, quality: "min" },
  { root: 11, quality: "min" },
];

export interface EarQuestion {
  answer: Chord;
  options: Chord[]; // 4: two major, two minor, the answer and its parallel among them
}

/** A small seeded RNG, so a game can be replayed in tests. */
export function rng(seed: number): () => number {
  let s = seed % 2147483647 || 1;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

const same = (a: Pick<Chord, "root" | "quality">, b: Pick<Chord, "root" | "quality">) =>
  a.root === b.root && a.quality === b.quality;

function shuffle<T>(items: T[], rand: () => number): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Ten major-or-minor questions; no chord is the answer twice in a row. */
export function earQuestions(rand: () => number, count = EAR_QUESTIONS): EarQuestion[] {
  const out: EarQuestion[] = [];
  for (let n = 0; n < count; n++) {
    let answer: Chord;
    do answer = EAR_POOL[Math.floor(rand() * EAR_POOL.length)];
    while (out.length && same(out[out.length - 1].answer, answer));
    const flip: Quality = answer.quality === "maj" ? "min" : "maj";
    const parallel: Chord = { root: answer.root, quality: flip };
    // One more of each quality, so the hint (major/minor) never gives the answer away.
    const pickOther = (q: Quality) =>
      shuffle(
        EAR_POOL.filter((c) => c.quality === q && !same(c, answer) && !same(c, parallel)),
        rand,
      )[0];
    const options = shuffle([answer, parallel, pickOther("maj"), pickOther("min")], rand);
    out.push({ answer, options });
  }
  return out;
}

export function toJson(c: Pick<Chord, "root" | "quality">): ChordJson {
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
