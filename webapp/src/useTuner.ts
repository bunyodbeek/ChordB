import { useCallback, useEffect, useRef, useState } from "react";

import { detectPitch, median } from "./pitch";

export type TunerStatus = "idle" | "starting" | "listening" | "denied" | "unavailable";

const FFT_SIZE = 4096;
const DETECT_EVERY_MS = 50; // ~20 detections/s is plenty and keeps phones cool
const HISTORY = 5; // median over this many detections steadies the needle
const SILENCE_MS = 400; // clear the readout after this long without a pitch

/** Microphone → steady fundamental frequency in Hz (null while silent). */
export function useTuner() {
  const [status, setStatus] = useState<TunerStatus>("idle");
  const [freq, setFreq] = useState<number | null>(null);
  const stopRef = useRef<(() => void) | null>(null);

  const stop = useCallback(() => {
    stopRef.current?.();
    stopRef.current = null;
    setFreq(null);
    setStatus("idle");
  }, []);

  const start = useCallback(async () => {
    if (stopRef.current) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus("unavailable");
      return;
    }
    setStatus("starting");
    // Created inside the tap handler, before any await: iOS only allows audio to
    // start from a user gesture.
    const ctx = new AudioContext();
    // Resume while still inside the gesture too: after the await below, some
    // WebViews (Telegram on iOS) refuse and leave the context suspended, silent.
    void ctx.resume();
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        // Processing meant for voice calls distorts pitch; turn it all off.
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
    } catch (e) {
      void ctx.close();
      const name = e instanceof DOMException ? e.name : "";
      setStatus(name === "NotFoundError" ? "unavailable" : "denied");
      return;
    }
    await ctx.resume();

    const analyser = ctx.createAnalyser();
    analyser.fftSize = FFT_SIZE;
    ctx.createMediaStreamSource(stream).connect(analyser);
    // WebKit only processes nodes that reach the destination; route through a
    // muted gain so the analyser gets data without playing the mic back.
    const mute = ctx.createGain();
    mute.gain.value = 0;
    analyser.connect(mute).connect(ctx.destination);
    // Opening the mic can interrupt the audio session (iOS); pick it back up.
    ctx.onstatechange = () => {
      if (ctx.state !== "running" && ctx.state !== "closed") void ctx.resume();
    };
    const buf = new Float32Array(FFT_SIZE);

    const history: number[] = [];
    let lastDetect = 0;
    let lastHeard = 0;
    let raf = 0;

    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (now - lastDetect < DETECT_EVERY_MS) return;
      lastDetect = now;

      analyser.getFloatTimeDomainData(buf);
      const f = detectPitch(buf, ctx.sampleRate);
      if (f !== null) {
        lastHeard = now;
        history.push(f);
        if (history.length > HISTORY) history.shift();
        setFreq(median(history));
      } else if (history.length && now - lastHeard > SILENCE_MS) {
        history.length = 0;
        setFreq(null);
      }
    };
    raf = requestAnimationFrame(tick);

    stopRef.current = () => {
      cancelAnimationFrame(raf);
      ctx.onstatechange = null;
      stream.getTracks().forEach((track) => track.stop());
      void ctx.close();
    };
    setStatus("listening");
  }, []);

  useEffect(() => () => stopRef.current?.(), []);

  return { status, freq, start, stop };
}
