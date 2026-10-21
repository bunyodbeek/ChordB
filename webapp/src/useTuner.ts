import { useCallback, useEffect, useRef, useState } from "react";

import { detectPitch, median } from "./pitch";

// "blocked": the mic is allowed but the browser keeps audio off until a tap.
export type TunerStatus = "idle" | "starting" | "listening" | "blocked" | "denied" | "unavailable";

const FFT_SIZE = 4096;
const DETECT_EVERY_MS = 50; // ~20 detections/s is plenty and keeps phones cool
const HISTORY = 5; // median over this many detections steadies the needle
const SILENCE_MS = 400; // clear the readout after this long without a pitch
const RESUME_WAIT_MS = 300; // resume() never settles in some blocked WebViews

/**
 * Microphone → steady fundamental frequency in Hz (null while silent).
 * Starts by itself when mounted (the tuner listens as soon as the mic is allowed).
 */
export function useTuner() {
  const [status, setStatus] = useState<TunerStatus>("idle");
  const [freq, setFreq] = useState<number | null>(null);
  const stopRef = useRef<(() => void) | null>(null);
  // Bumped by stop(): a start() still waiting for the mic sees it and backs out.
  const generation = useRef(0);

  const stop = useCallback(() => {
    generation.current++;
    stopRef.current?.();
    stopRef.current = null;
    setFreq(null);
    setStatus("idle");
  }, []);

  const start = useCallback(async () => {
    if (stopRef.current) return;
    const gen = ++generation.current;
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus("unavailable");
      return;
    }
    setStatus("starting");
    const ctx = new AudioContext();
    void ctx.resume();
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        // Processing meant for voice calls distorts pitch; turn it all off.
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
    } catch (e) {
      void ctx.close();
      if (gen !== generation.current) return;
      const name = e instanceof DOMException ? e.name : "";
      setStatus(name === "NotFoundError" ? "unavailable" : "denied");
      return;
    }
    if (gen !== generation.current) {
      stream.getTracks().forEach((track) => track.stop());
      void ctx.close();
      return;
    }

    const analyser = ctx.createAnalyser();
    analyser.fftSize = FFT_SIZE;
    ctx.createMediaStreamSource(stream).connect(analyser);
    // WebKit only processes nodes that reach the destination; route through a
    // muted gain so the analyser gets data without playing the mic back.
    const mute = ctx.createGain();
    mute.gain.value = 0;
    analyser.connect(mute).connect(ctx.destination);
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

    // Audio blocked until a gesture: the first tap anywhere starts it (once).
    const unlock = () => {
      void ctx.resume();
    };
    const onState = () => {
      if (ctx.state === "running") {
        document.removeEventListener("pointerdown", unlock);
        setStatus("listening");
      } else if (ctx.state !== "closed") {
        // Opening the mic can interrupt the audio session (iOS); pick it back up.
        void ctx.resume();
      }
    };
    ctx.onstatechange = onState;

    stopRef.current = () => {
      cancelAnimationFrame(raf);
      ctx.onstatechange = null;
      document.removeEventListener("pointerdown", unlock);
      stream.getTracks().forEach((track) => track.stop());
      void ctx.close();
    };

    await Promise.race([ctx.resume(), new Promise((r) => setTimeout(r, RESUME_WAIT_MS))]);
    if (gen !== generation.current) return;
    raf = requestAnimationFrame(tick);
    if (ctx.state === "running") {
      setStatus("listening");
    } else {
      document.addEventListener("pointerdown", unlock);
      setStatus("blocked");
    }
  }, []);

  useEffect(() => {
    void start();
    return stop;
  }, [start, stop]);

  return { status, freq, start, stop };
}
