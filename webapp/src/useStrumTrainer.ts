// The rhythm trainer's engine: a metronome scheduled on the AudioContext's clock and,
// with the mic on, every slot judged against the strokes heard (strum.ts). One
// AudioContext does both, so clicks and onsets share a clock.
import { useCallback, useEffect, useRef, useState } from "react";

import {
  BARS_JUDGED,
  CLOSE_SEC,
  OnsetDetector,
  SLOTS_PER_BAR,
  accuracy,
  judgeSlot,
  type SlotResult,
  type Stroke,
} from "./strum";

const LEAD_IN_SEC = 0.25; // the first click, after start
const LOOKAHEAD_SEC = 0.15; // clicks are scheduled this far ahead, every frame
const JUDGE_MARGIN_SEC = 0.04; // a slot is judged once its window and this have passed
const BEATS_PER_BAR = 4;
const FFT = 2048;
const KEEP_ONSETS_SEC = 1;

export type TrainerMic = "off" | "starting" | "on" | "denied" | "unavailable";

export interface TrainerSettings {
  pattern: readonly Stroke[];
  bpm: number;
  mic: boolean;
}

export interface TrainerState {
  running: boolean;
  slot: number; // the slot sounding now, 0..7; -1 when stopped
  results: (SlotResult | null)[]; // the latest verdict on each of the eight slots
  accuracy: number | null; // over the last four bars (fewer at first)
  bars: number; // judged since start
  mic: TrainerMic;
}

const IDLE: Omit<TrainerState, "mic"> = {
  running: false,
  slot: -1,
  results: Array(SLOTS_PER_BAR).fill(null),
  accuracy: null,
  bars: 0,
};

interface Session {
  ctx: AudioContext;
  stream: MediaStream | null;
  raf: number;
}

/** `onBar` runs after every judged bar, with the accuracy over the last four. */
export function useStrumTrainer(onBar: (accuracy: number | null, bars: number) => void) {
  const [state, setState] = useState<TrainerState>({ ...IDLE, mic: "off" });
  const session = useRef<Session | null>(null);
  const generation = useRef(0); // bumped by stop(): a start() still waiting backs out
  const barRef = useRef(onBar);
  barRef.current = onBar;

  const stop = useCallback(() => {
    generation.current++;
    const s = session.current;
    session.current = null;
    if (s) {
      cancelAnimationFrame(s.raf);
      s.stream?.getTracks().forEach((track) => track.stop());
      void s.ctx.close();
    }
    setState((st) => ({ ...st, ...IDLE, results: st.results, accuracy: st.accuracy, bars: st.bars }));
  }, []);

  const start = useCallback(
    async ({ pattern, bpm, mic }: TrainerSettings) => {
      stop();
      const gen = generation.current;
      const ctx = new AudioContext();
      void ctx.resume(); // inside the tap that started it
      let stream: MediaStream | null = null;
      let micState: TrainerMic = "off";
      if (mic) {
        setState((st) => ({ ...st, mic: "starting" }));
        if (!navigator.mediaDevices?.getUserMedia) {
          micState = "unavailable";
        } else {
          try {
            stream = await navigator.mediaDevices.getUserMedia({
              // Echo cancellation keeps our own clicks out of the mic; the rest would
              // flatten the strokes' attacks.
              audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: false },
            });
            micState = "on";
          } catch (e) {
            micState = e instanceof DOMException && e.name === "NotFoundError" ? "unavailable" : "denied";
          }
        }
      }
      if (gen !== generation.current) {
        stream?.getTracks().forEach((track) => track.stop());
        void ctx.close();
        return;
      }
      await ctx.resume();

      let analyser: AnalyserNode | null = null;
      if (stream) {
        analyser = ctx.createAnalyser();
        analyser.fftSize = FFT;
        analyser.smoothingTimeConstant = 0;
        ctx.createMediaStreamSource(stream).connect(analyser);
        // WebKit only runs nodes that reach the destination: through a muted gain.
        const mute = ctx.createGain();
        mute.gain.value = 0;
        analyser.connect(mute).connect(ctx.destination);
      }
      const buf = new Float32Array(FFT);
      const detector = new OnsetDetector(ctx.sampleRate);
      // A click is heard this much after its time; strokes answer the heard click.
      const latency = ctx.outputLatency || ctx.baseLatency || 0;

      const beatSec = 60 / bpm;
      const slotSec = beatSec / 2;
      const t0 = ctx.currentTime + LEAD_IN_SEC;
      let nextBeat = 0;
      let nextJudge = 0; // slot index
      let lastRead = ctx.currentTime;
      let shownSlot = -1;
      let onsets: number[] = [];
      const history: SlotResult[] = [];
      const results: (SlotResult | null)[] = Array(SLOTS_PER_BAR).fill(null);
      let bars = 0;

      const click = (at: number, accent: boolean) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.frequency.value = accent ? 1600 : 1000;
        gain.gain.setValueAtTime(accent ? 0.9 : 0.45, at);
        gain.gain.exponentialRampToValueAtTime(0.001, at + 0.05);
        osc.connect(gain).connect(ctx.destination);
        osc.start(at);
        osc.stop(at + 0.06);
      };

      const s: Session = { ctx, stream, raf: 0 };
      session.current = s;
      setState({ ...IDLE, running: true, mic: micState });

      const frame = () => {
        s.raf = requestAnimationFrame(frame);
        const now = ctx.currentTime;
        // Clicks: whatever falls in the next LOOKAHEAD_SEC, at its exact time.
        for (let at = t0 + nextBeat * beatSec; at < now + LOOKAHEAD_SEC; at = t0 + nextBeat * beatSec) {
          if (at >= now) click(at, nextBeat % BEATS_PER_BAR === 0);
          nextBeat++;
        }
        const heard = now - latency;
        const slot = heard < t0 ? -1 : Math.floor((heard - t0) / slotSec) % SLOTS_PER_BAR;

        let judged = false;
        if (analyser) {
          analyser.getFloatTimeDomainData(buf);
          const fresh = Math.min(FFT, Math.round((now - lastRead) * ctx.sampleRate));
          lastRead = now;
          if (fresh > 0) {
            for (const o of detector.push(buf.subarray(FFT - fresh), now)) onsets.push(o - latency);
          }
          // Judge each slot once nothing more can land in its window.
          while (t0 + nextJudge * slotSec + CLOSE_SEC + JUDGE_MARGIN_SEC < heard) {
            const at = t0 + nextJudge * slotSec;
            const i = nextJudge % SLOTS_PER_BAR;
            const r = judgeSlot(pattern[i], at, slotSec, onsets);
            results[i] = r;
            history.push(r);
            if (history.length > BARS_JUDGED * SLOTS_PER_BAR) history.shift();
            onsets = onsets.filter((o) => o > at - KEEP_ONSETS_SEC);
            nextJudge++;
            judged = true;
            if (i === SLOTS_PER_BAR - 1) {
              bars++;
              barRef.current(accuracy(history), bars);
            }
          }
        }
        if (slot !== shownSlot || judged) {
          shownSlot = slot;
          setState((st) => ({
            ...st,
            slot,
            results: [...results],
            accuracy: accuracy(history),
            bars,
          }));
        }
      };
      s.raf = requestAnimationFrame(frame);
    },
    [stop],
  );

  // Hidden (Telegram minimised): the frames stop, so stop the clicks too.
  useEffect(() => {
    const onHide = () => document.visibilityState === "hidden" && stop();
    document.addEventListener("visibilitychange", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      stop();
    };
  }, [stop]);

  return { ...state, start, stop };
}
