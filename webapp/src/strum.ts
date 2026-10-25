// Strumming: patterns, the player's strumming row and the rhythm trainer's timing
// (strum-trainer.reference.html). Pure: no React, no Web Audio.

/** D down, U up, - rest, x a muted chuck. */
export type Stroke = "D" | "U" | "-" | "x";

export const SLOTS_PER_BAR = 8; // a pattern is one bar of eighth notes

const STROKES = new Set<string>(["D", "U", "-", "x"]);

/** For songs with no pattern of their own (the server's default, chordb_common.strum). */
export const DEFAULT_PATTERN = { name: "Pop", slots: "D-DU-UDU" } as const;
/** The tempo when nothing better is known: no BPM from the admin or the beat tracker. */
export const DEFAULT_BPM = 90;

/** "1 & 2 & 3 & 4 &" for a bar of `perBar` eighths. */
export function countLabels(perBar: number): string[] {
  return Array.from({ length: perBar }, (_, i) => (i % 2 ? "&" : String(i / 2 + 1)));
}

/** "D-DU-UDU" → its strokes; anything unexpected is a rest. */
export function strokes(slots: string): Stroke[] {
  return Array.from({ length: SLOTS_PER_BAR }, (_, i) => (STROKES.has(slots[i]) ? (slots[i] as Stroke) : "-"));
}

/** A stroke that makes a sound, so the trainer expects to hear it. */
export const sounds = (s: Stroke): boolean => s !== "-";

/** "D-DU-UDU" → "D · DU · UDU": the strokes between the rests. */
export function patternLabel(slots: string): string {
  return slots
    .split("-")
    .filter(Boolean)
    .join(" · ");
}

/** Eighth notes in one bar: 4/4 → 8, 3/4 → 6, 2/4 → 4, 6/8 → 6. */
export function eighthsPerBar(timeSignature: string): number {
  const [n, d] = timeSignature.split("/").map(Number);
  const eighths = (n * 8) / d;
  return Number.isInteger(eighths) && eighths > 0 ? eighths : SLOTS_PER_BAR;
}

/**
 * The stroke on slot `i` of a bar: the pattern starts again every bar; a shorter bar
 * (3/4) plays the pattern's first eighths.
 */
export function strokeAt(pattern: readonly Stroke[], i: number, perBar = SLOTS_PER_BAR): Stroke {
  return pattern[(i % perBar) % pattern.length];
}

// --- the player's bar grid ---------------------------------------------------------------
// The pattern follows the song's bars, not its chords: a chord that changes mid-bar does
// not start the pattern again. The bars are laid on the beat tracker's beats when the video
// has an analysis, else on a steady `bpm` from the first chord.

export interface BarGrid {
  beats: number[]; // beat times (s), from before 0 to past the end
  downbeat: number; // the index of a beat that starts a bar
  beatsPerBar: number;
}

const ON_BEAT = 0.3; // a chord change within 0.3 beat of a beat is on it
const MAX_GRID_BEATS = 10_000;

/** The index of the last beat at or before `t`; -1 before the first. */
function beatIndex(beats: readonly number[], t: number): number {
  let lo = 0;
  let hi = beats.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (beats[mid] <= t) lo = mid + 1;
    else hi = mid;
  }
  return lo - 1;
}

function medianStep(beats: readonly number[]): number {
  const steps = beats
    .slice(1)
    .map((b, i) => b - beats[i])
    .filter((d) => d > 0)
    .sort((a, b) => a - b);
  return steps.length ? steps[Math.floor(steps.length / 2)] : 0;
}

/**
 * Which beat, counted modulo `period`, the chord changes fall on most: songs change chord
 * on the bar's first beat. A tie goes to the first change's beat.
 */
export function bestPhase(beats: readonly number[], changes: readonly number[], period: number): number {
  const step = medianStep(beats);
  const score = new Array<number>(period).fill(0);
  let first = -1;
  for (const c of changes) {
    let i = beatIndex(beats, c);
    if (i + 1 < beats.length && (i < 0 || beats[i + 1] - c < c - beats[i])) i++;
    if (i < 0 || Math.abs(beats[i] - c) > ON_BEAT * step) continue;
    const phase = ((i % period) + period) % period;
    if (first < 0) first = phase;
    score[phase]++;
  }
  let best = Math.max(first, 0);
  score.forEach((s, p) => {
    if (s > score[best]) best = p;
  });
  return best;
}

/**
 * The tracker's beats fitted to `bpm` (it often counts half or double time), extended at
 * a steady step to cover [0, duration]; or, with none, a steady `bpm` from the first change.
 */
function gridBeats(
  tracked: readonly number[] | null,
  bpm: number,
  duration: number,
  changes: readonly number[],
): number[] {
  const want = 60 / bpm;
  let beats = tracked && tracked.length >= 4 ? [...tracked].sort((a, b) => a - b) : null;
  if (beats) {
    const ratio = medianStep(beats) / want;
    if (ratio > 1.5) {
      // Half time: a beat between every two.
      beats = beats.flatMap((b, i) => (i + 1 < beats!.length ? [b, (b + beats![i + 1]) / 2] : [b]));
    } else if (ratio < 0.67) {
      // Double time: every other beat, the ones the chords change on.
      const keep = bestPhase(beats, changes, 2);
      beats = beats.filter((_, i) => i % 2 === keep);
    }
  }
  const step = beats ? medianStep(beats) : want;
  if (!(step > 0)) return [];
  if (!beats) beats = [changes[0] ?? 0];
  const before: number[] = [];
  for (let b = beats[0] - step; b > -step && before.length < MAX_GRID_BEATS; b -= step) before.unshift(b);
  const out = [...before, ...beats];
  for (let b = out[out.length - 1] + step; b < duration + step && out.length < MAX_GRID_BEATS; b += step) {
    out.push(b);
  }
  return out;
}

/** The bars of a song: its beats (see gridBeats) and the bar line the chords agree on. */
export function barGrid({
  beats,
  bpm,
  perBar,
  duration,
  changes,
}: {
  beats: readonly number[] | null; // the beat tracker's, if any
  bpm: number;
  perBar: number; // eighths per bar
  duration: number;
  changes: readonly number[]; // chord change times
}): BarGrid {
  const beatsPerBar = Math.max(1, Math.round(perBar / 2));
  const grid = gridBeats(beats, bpm > 0 ? bpm : DEFAULT_BPM, duration, changes);
  return { beats: grid, downbeat: bestPhase(grid, changes, beatsPerBar), beatsPerBar };
}

/** The eighth of the bar sounding at `t` (0 … perBar − 1); -1 off the grid. */
export function barSlotAt(grid: BarGrid, perBar: number, t: number): number {
  const { beats, downbeat, beatsPerBar } = grid;
  const i = beatIndex(beats, t);
  if (i < 0 || i + 1 >= beats.length) return -1;
  const half = t >= (beats[i] + beats[i + 1]) / 2 ? 1 : 0;
  const slot = ((((i - downbeat) % beatsPerBar) + beatsPerBar) % beatsPerBar) * 2 + half;
  return slot < perBar ? slot : -1;
}

/**
 * The pattern of each event: an event's own pattern holds from it on, until another
 * event sets one; before any, the song's.
 */
export function patternIds(
  events: readonly { strum_pattern_id?: number | null }[],
  songPattern: number | null,
): (number | null)[] {
  let current = songPattern;
  return events.map((e) => (current = e.strum_pattern_id ?? current));
}

// --- the trainer -----------------------------------------------------------------------

export const ON_TIME_SEC = 0.06; // green
export const CLOSE_SEC = 0.12; // amber: early or late
export const BARS_JUDGED = 4; // accuracy is over the last four bars
const EPS = 1e-9; // the limits are inclusive: 1 − 0.94 is a hair over 0.06 in floats

/** on: |Δ| ≤ 60 ms; off: ≤ 120 ms; miss: nothing near; rest: a rest left alone; extra: a rest struck. */
export type SlotResult = "on" | "off" | "miss" | "rest" | "extra";

/** The slot's verdict, from the stroke onsets heard around it (seconds, any order). */
export function judgeSlot(
  stroke: Stroke,
  slotTime: number,
  slotSec: number,
  onsets: readonly number[],
): SlotResult {
  let nearest = Infinity;
  for (const o of onsets) nearest = Math.min(nearest, Math.abs(o - slotTime) - EPS);
  if (!sounds(stroke)) {
    // Struck on a rest: only when the stroke is closer to this slot than to its neighbours.
    return nearest <= Math.min(CLOSE_SEC, slotSec / 2) ? "extra" : "rest";
  }
  if (nearest <= ON_TIME_SEC) return "on";
  if (nearest <= CLOSE_SEC) return "off";
  return "miss";
}

/** On-time strokes / expected strokes; null when nothing was expected. */
export function accuracy(results: readonly SlotResult[]): number | null {
  let expected = 0;
  let on = 0;
  for (const r of results) {
    if (r === "on" || r === "off" || r === "miss") expected++;
    if (r === "on") on++;
  }
  return expected ? on / expected : null;
}

/**
 * Judge a whole bar: the slots start at `barStart`, `slotSec` apart. For tests and for
 * the trainer's catch-up after a stall.
 */
export function judgeBar(
  pattern: readonly Stroke[],
  barStart: number,
  slotSec: number,
  onsets: readonly number[],
): SlotResult[] {
  return pattern.map((s, i) => judgeSlot(s, barStart + i * slotSec, slotSec, onsets));
}

/**
 * What 90% at the `unlocked` tempo opens: the next ladder step, past the top `max`;
 * null once everything is open.
 */
export function nextUnlock(ladder: readonly number[], unlocked: number, max: number): number | null {
  const i = ladder.indexOf(unlocked);
  return i === -1 ? null : (ladder[i + 1] ?? max);
}

// --- onset detection ----------------------------------------------------------------

export interface OnsetOptions {
  block: number; // samples per energy block
  debounceSec: number; // a second onset this soon after one is the same stroke
  ratio: number; // the energy jump, over the recent average, that counts as a stroke
  floor: number; // ignore jumps below this (mean square; silence and hiss)
}

const DEFAULT_ONSET: OnsetOptions = { block: 256, debounceSec: 0.05, ratio: 2.5, floor: 2e-5 };

/**
 * Energy flux onsets: the signal's energy in short blocks; a block whose energy jumps
 * well above the recent average starts a stroke. Feed it consecutive samples.
 */
export class OnsetDetector {
  private readonly opts: OnsetOptions;
  private prev = 0;
  private avg = 0;
  private last = -Infinity;
  private carry = new Float32Array(0); // the end of the last push, short of a block

  constructor(
    private readonly sampleRate: number,
    opts: Partial<OnsetOptions> = {},
  ) {
    this.opts = { ...DEFAULT_ONSET, ...opts };
  }

  /** `fresh` samples end at `endTime` (seconds); returns the onsets found, oldest first. */
  push(fresh: Float32Array, endTime: number): number[] {
    const { block, debounceSec, ratio, floor } = this.opts;
    const samples = new Float32Array(this.carry.length + fresh.length);
    samples.set(this.carry);
    samples.set(fresh, this.carry.length);
    const out: number[] = [];
    const start = endTime - samples.length / this.sampleRate;
    let at = 0;
    for (; at + block <= samples.length; at += block) {
      let e = 0;
      for (let i = at; i < at + block; i++) e += samples[i] * samples[i];
      e /= block;
      const flux = e - this.prev;
      const t = start + at / this.sampleRate;
      if (flux > floor && flux > ratio * this.avg && t - this.last >= debounceSec) {
        out.push(t);
        this.last = t;
      }
      this.prev = e;
      this.avg = 0.9 * this.avg + 0.1 * e; // ~25 ms memory at 44.1 kHz
    }
    this.carry = samples.slice(at);
    return out;
  }
}
