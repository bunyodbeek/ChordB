import { useCallback, useRef, useState } from "react";

import { detectPitch, median } from "./pitch";
import { useMic, type MicStatus } from "./useMic";

export type TunerStatus = MicStatus;

const FFT_SIZE = 4096;
const DETECT_EVERY_MS = 50; // ~20 detections/s is plenty and keeps phones cool
const HISTORY = 5; // median over this many detections steadies the needle
const SILENCE_MS = 400; // clear the readout after this long without a pitch

/**
 * Microphone → steady fundamental frequency in Hz (null while silent).
 * Starts by itself when mounted (the tuner listens as soon as the mic is allowed).
 */
export function useTuner() {
  const [freq, setFreq] = useState<number | null>(null);
  const history = useRef<number[]>([]);
  const lastHeard = useRef(0);
  const buf = useRef<Float32Array<ArrayBuffer> | null>(null);

  const onFrame = useCallback((analyser: AnalyserNode, sampleRate: number, now: number) => {
    buf.current ??= new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(buf.current);
    const f = detectPitch(buf.current, sampleRate);
    const h = history.current;
    if (f !== null) {
      lastHeard.current = now;
      h.push(f);
      if (h.length > HISTORY) h.shift();
      setFreq(median(h));
    } else if (h.length && now - lastHeard.current > SILENCE_MS) {
      h.length = 0;
      setFreq(null);
    }
  }, []);

  const { status, start, stop } = useMic(FFT_SIZE, DETECT_EVERY_MS, onFrame);
  return { status, freq, start, stop };
}
