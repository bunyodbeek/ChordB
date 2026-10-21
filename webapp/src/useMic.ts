// The microphone as an AnalyserNode, shared by the tuner and the chord listener: asks
// for the mic when mounted, works around WebViews that keep audio off until a tap, and
// calls `onFrame` every `everyMs` while listening.
import { useCallback, useEffect, useRef, useState } from "react";

// "blocked": the mic is allowed but the browser keeps audio off until a tap.
export type MicStatus = "idle" | "starting" | "listening" | "blocked" | "denied" | "unavailable";

const RESUME_WAIT_MS = 300; // resume() never settles in some blocked WebViews

export type FrameHandler = (analyser: AnalyserNode, sampleRate: number, now: number) => void;

export function useMic(fftSize: number, everyMs: number, onFrame: FrameHandler) {
  const [status, setStatus] = useState<MicStatus>("idle");
  const stopRef = useRef<(() => void) | null>(null);
  // Bumped by stop(): a start() still waiting for the mic sees it and backs out.
  const generation = useRef(0);
  const frame = useRef(onFrame);
  frame.current = onFrame;

  const stop = useCallback(() => {
    generation.current++;
    stopRef.current?.();
    stopRef.current = null;
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
    analyser.fftSize = fftSize;
    analyser.smoothingTimeConstant = 0;
    ctx.createMediaStreamSource(stream).connect(analyser);
    // WebKit only processes nodes that reach the destination; route through a
    // muted gain so the analyser gets data without playing the mic back.
    const mute = ctx.createGain();
    mute.gain.value = 0;
    analyser.connect(mute).connect(ctx.destination);

    let last = 0;
    let raf = 0;
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (now - last < everyMs) return;
      last = now;
      frame.current(analyser, ctx.sampleRate, now);
    };

    // Audio blocked until a gesture: the first tap anywhere starts it (once).
    const unlock = () => void ctx.resume();
    ctx.onstatechange = () => {
      if (ctx.state === "running") {
        document.removeEventListener("pointerdown", unlock);
        setStatus("listening");
      } else if (ctx.state !== "closed") {
        // Opening the mic can interrupt the audio session (iOS); pick it back up.
        void ctx.resume();
      }
    };

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
  }, [fftSize, everyMs]);

  useEffect(() => {
    void start();
    return stop;
  }, [start, stop]);

  return { status, start, stop };
}
