// The app's only playback API: UI code calls playChord / playNote and never sees
// AudioContexts or sample sources.
import { useSyncExternalStore } from "react";

import { voicing } from "../chords";
import type { Chord } from "../notation";
import { soundfontSource, type GuitarInstrument, type NoteSource, type Stop } from "./sources";
import { buildStrum, type StrumOptions } from "./strum";

export type PlayerStatus = "idle" | "loading" | "ready" | "error";

const RING = 3; // seconds a strummed string rings unless the next strum damps it
const NOTE_LENGTH = 2.5;

let ctx: AudioContext | null = null;
let source: NoteSource = soundfontSource("acoustic_guitar_steel");
let loading: Promise<void> | null = null;
let status: PlayerStatus = "idle";
let ringing: Stop[] = [];

const listeners = new Set<() => void>();
function setStatus(next: PlayerStatus) {
  status = next;
  listeners.forEach((l) => l());
}

function context(): AudioContext {
  if (ctx) return ctx;
  ctx = new AudioContext();
  // Created before any tap it starts suspended; the first tap anywhere resumes it.
  if (ctx.state === "suspended") {
    const unlock = () => {
      void ctx?.resume();
      for (const e of ["pointerdown", "touchend", "keydown"]) {
        document.removeEventListener(e, unlock, true);
      }
    };
    for (const e of ["pointerdown", "touchend", "keydown"]) {
      document.addEventListener(e, unlock, true);
    }
  }
  return ctx;
}

/** Start loading samples (idempotent). Call when a screen that plays sound opens. */
export function preload(): Promise<void> {
  if (status === "ready") return Promise.resolve();
  if (loading) return loading;
  setStatus("loading");
  loading = source.load(context()).then(
    () => setStatus("ready"),
    (e) => {
      loading = null; // allow a retry
      setStatus("error");
      throw e;
    },
  );
  return loading;
}

/** Swap the sample source, e.g. for recorded samples. Reloads on next preload/play. */
export function setSource(next: NoteSource): void {
  if (next.id === source.id) return;
  ringing.forEach((stop) => stop());
  ringing = [];
  source.dispose();
  source = next;
  loading = null;
  setStatus("idle");
}

export function setInstrument(instrument: GuitarInstrument): void {
  setSource(soundfontSource(instrument));
}

async function ready(): Promise<AudioContext> {
  const ac = context();
  await Promise.all([ac.resume(), preload()]);
  return ac;
}

/** Strum a chord with its real fingering (see chords.ts voicing). */
export async function playChord(chord: Chord, options: StrumOptions = {}): Promise<void> {
  const ac = await ready();
  const start = ac.currentTime + 0.03;
  // A new strum damps the previous one, like a hand on real strings.
  ringing.forEach((stop) => stop(start));
  ringing = buildStrum(voicing(chord).frets, options).map((n) =>
    source.play({
      midi: n.midi,
      string: n.string,
      fret: n.fret,
      velocity: n.velocity,
      time: start + n.offset,
      duration: RING,
    }),
  );
}

/** A single pitch, e.g. a reference tone. */
export async function playNote(midi: number, velocity = 80): Promise<void> {
  const ac = await ready();
  source.play({
    midi,
    string: null,
    fret: null,
    velocity,
    time: ac.currentTime + 0.02,
    duration: NOTE_LENGTH,
  });
}

/** Loading state for UI: re-renders when samples start or finish loading. */
export function usePlayerStatus(): PlayerStatus {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => status,
  );
}
