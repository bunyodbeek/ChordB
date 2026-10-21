// Live chord recognition: mic → spectrum → chroma → match against `target` (chroma.ts).
// `matched` turns true once the target has held for ~300 ms, and stays true until the
// target changes or reset() is called (a game moves on to the next chord).
import { useCallback, useEffect, useRef, useState } from "react";

import { Stability, chromaFromSpectrum, dbToLinear, matchChord } from "./chroma";
import type { Chord } from "./notation";
import { tuningOffsetCents } from "./practice";
import { loadPreset } from "./tuning";
import { useMic } from "./useMic";

const FFT_SIZE = 8192; // ~6 Hz bins at 48 kHz: the low strings' semitones are ~5 Hz apart
const EVERY_MS = 50;
const MIN_RMS = 0.004; // below this the room is quiet, not a chord

export function useChordListener(target: Pick<Chord, "root" | "quality"> | null) {
  const [matched, setMatched] = useState(false);
  const [confidence, setConfidence] = useState(0);
  const stability = useRef(new Stability());
  const targetRef = useRef(target);
  const matchedRef = useRef(false);
  const spectrum = useRef<Float32Array<ArrayBuffer> | null>(null);
  const wave = useRef<Float32Array<ArrayBuffer> | null>(null);
  // The tuner's preset and residual: a down-tuned guitar's Am shape still reads as Am.
  const offset = useRef(tuningOffsetCents(loadPreset()));

  const reset = useCallback(() => {
    stability.current.reset();
    matchedRef.current = false;
    setMatched(false);
    setConfidence(0);
  }, []);

  useEffect(() => {
    targetRef.current = target;
    reset();
  }, [target?.root, target?.quality, reset]); // eslint-disable-line react-hooks/exhaustive-deps

  const onFrame = useCallback((analyser: AnalyserNode, sampleRate: number, now: number) => {
    const t = targetRef.current;
    if (!t || matchedRef.current) return;
    wave.current ??= new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(wave.current);
    let sum = 0;
    for (const v of wave.current) sum += v * v;
    if (Math.sqrt(sum / wave.current.length) < MIN_RMS) {
      stability.current.update(false, now);
      setConfidence(0);
      return;
    }
    spectrum.current ??= new Float32Array(analyser.frequencyBinCount);
    analyser.getFloatFrequencyData(spectrum.current);
    const chroma = chromaFromSpectrum(dbToLinear(spectrum.current), sampleRate, analyser.fftSize, offset.current);
    const m = matchChord(chroma, t);
    setConfidence(m.confidence);
    if (stability.current.update(m.matched, now)) {
      matchedRef.current = true;
      setMatched(true);
    }
  }, []);

  const { status, start } = useMic(FFT_SIZE, EVERY_MS, onFrame);
  return { status, listening: status === "listening", matched, confidence, reset, start };
}
