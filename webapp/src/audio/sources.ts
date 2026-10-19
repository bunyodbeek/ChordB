// Where note sounds come from. The player only talks to NoteSource, so the samples
// can be swapped (e.g. for recorded samples/{string}-{fret}.mp3 files) without
// touching the strum logic or the UI.
import { Soundfont } from "smplr";

export interface SourceNote {
  midi: number;
  // The fingering that produced the note; null for a bare pitch (playNote). A
  // recorded-samples source picks samples/{string}-{fret}.mp3 from these and can
  // fall back to the nearest recorded fret for bare pitches.
  string: number | null;
  fret: number | null;
  velocity: number; // 1..127
  time: number; // AudioContext time to start at
  duration: number; // seconds
}

/** Stops a started note, optionally at a given AudioContext time. */
export type Stop = (time?: number) => void;

export interface NoteSource {
  readonly id: string;
  /** Fetch and decode everything needed; resolves when play() will sound. */
  load(ctx: AudioContext): Promise<void>;
  play(note: SourceNote): Stop;
  dispose(): void;
}

export type GuitarInstrument = "acoustic_guitar_steel" | "acoustic_guitar_nylon";

// Only decode the guitar's range: low E (40) up to the 15th fret of high E (79).
const GUITAR_NOTES = Array.from({ length: 40 }, (_, i) => 40 + i);

/** General MIDI guitar samples via smplr (MusyngKite soundfont). */
export function soundfontSource(instrument: GuitarInstrument): NoteSource {
  let sf: ReturnType<typeof Soundfont> | null = null;
  return {
    id: `soundfont:${instrument}`,
    async load(ctx) {
      sf ??= Soundfont(ctx, {
        instrument,
        kit: "MusyngKite",
        notesToLoad: { notes: GUITAR_NOTES },
      });
      await sf.ready;
    },
    play({ midi, velocity, time, duration }) {
      if (!sf) throw new Error("soundfont not loaded");
      return sf.start({ note: midi, velocity, time, duration });
    },
    dispose() {
      sf?.dispose();
      sf = null;
    },
  };
}
