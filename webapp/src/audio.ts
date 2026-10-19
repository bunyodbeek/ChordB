// Plays chords with a synthesized plucked string (Karplus–Strong), strummed low to high.
import { OPEN_MIDI, type Frets } from "./chords";
import { midiToFreq } from "./pitch";

const STRUM_GAP = 0.03; // seconds between strings
const DURATION = 2.2; // seconds each string rings
const VOLUME = 0.22;

let ctx: AudioContext | null = null;
const cache = new Map<number, AudioBuffer>();

function pluck(ac: AudioContext, midi: number): AudioBuffer {
  const hit = cache.get(midi);
  if (hit) return hit;

  const sr = ac.sampleRate;
  // The two-tap average below adds half a sample of delay; within a few cents is
  // plenty for hearing a chord.
  const n = Math.max(2, Math.round(sr / midiToFreq(midi) - 0.5));
  const len = Math.floor(sr * DURATION);
  const buf = ac.createBuffer(1, len, sr);
  const out = buf.getChannelData(0);

  // Burst of noise, low-passed a little so it sounds like a pick rather than a hiss.
  let prev = 0;
  for (let i = 0; i <= n; i++) {
    prev = 0.6 * (Math.random() * 2 - 1) + 0.4 * prev;
    out[i] = prev;
  }
  const decay = 0.996 - (midi - 40) * 0.0001; // high strings die a bit faster
  for (let i = n + 1; i < len; i++) {
    out[i] = decay * 0.5 * (out[i - n] + out[i - n - 1]);
  }
  // Soft fade-out so the buffer end doesn't click.
  const fade = Math.floor(sr * 0.3);
  for (let i = 0; i < fade; i++) out[len - 1 - i] *= i / fade;

  cache.set(midi, buf);
  return buf;
}

/** Strum a voicing. Call from a tap: browsers only start audio on a user gesture. */
export function strum(frets: Frets): void {
  ctx ??= new AudioContext();
  const ac = ctx;
  void ac.resume();

  const gain = ac.createGain();
  gain.gain.value = VOLUME;
  gain.connect(ac.destination);

  const start = ac.currentTime + 0.02;
  frets.forEach((fret, i) => {
    if (fret < 0) return;
    const src = ac.createBufferSource();
    src.buffer = pluck(ac, OPEN_MIDI[i] + fret);
    src.connect(gain);
    src.start(start + i * STRUM_GAP);
  });
}
