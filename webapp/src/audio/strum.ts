// Turns a fingering into timed, velocity-shaped notes. Pure: no audio APIs, so the
// feel of the strum can be tested and reused by any sample source.
import { OPEN_MIDI, type Frets } from "../chords";

export type StrumDirection = "down" | "up"; // down = low E first, up = high E first

export interface StrumNote {
  string: number; // guitar numbering: 6 = low E … 1 = high E
  fret: number;
  midi: number;
  offset: number; // seconds after the strum starts
  velocity: number; // 1..127
}

export interface StrumOptions {
  direction?: StrumDirection;
  gap?: number; // seconds between strings
  timingJitter?: number; // ± seconds per string
  velocity?: [number, number]; // range the strum's base velocity is picked from
  velocityJitter?: number; // ± per string
  rand?: () => number; // [0, 1); injectable for tests
}

export const STRUM_DEFAULTS = {
  direction: "down",
  gap: 0.025,
  timingJitter: 0.005,
  velocity: [70, 85],
  velocityJitter: 5,
} satisfies StrumOptions;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function buildStrum(frets: Frets, options: StrumOptions = {}): StrumNote[] {
  const { direction, gap, timingJitter, velocity, velocityJitter } = { ...STRUM_DEFAULTS, ...options };
  const rand = options.rand ?? Math.random;
  const spread = (amount: number) => (rand() * 2 - 1) * amount; // uniform in ±amount

  const played = frets.flatMap((fret, i) =>
    fret < 0 ? [] : [{ string: 6 - i, fret, midi: OPEN_MIDI[i] + fret }],
  );
  if (direction === "up") played.reverse();

  // One base velocity per strum (how hard this stroke is), then per-string variation.
  const base = velocity[0] + rand() * (velocity[1] - velocity[0]);
  return played.map((n, k) => ({
    ...n,
    // The first string anchors the strum at 0; later ones never move before it.
    offset: k === 0 ? 0 : Math.max(0, k * gap + spread(timingJitter)),
    velocity: Math.round(clamp(base + spread(velocityJitter), 1, 127)),
  }));
}
