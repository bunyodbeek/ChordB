// The ear test's screens: the levels map → a run → its result. Every rule (which levels
// are open, premium, the questions and answers) is the server's; a premium level opens
// the premium sheet (402).
import { useCallback, useEffect, useRef, useState } from "react";

import { api, ApiError, type EarFinish, type EarProgress, type EarRun } from "../../api";
import type { NotationKind } from "../../notation";
import { haptic } from "../../telegram";
import { t } from "../../texts";
import type { PremiumReason } from "../PremiumSheet";
import { EarLevels } from "./EarLevels";
import { EarResult } from "./EarResult";
import { EarTestGame } from "./EarTestGame";

type View =
  | { name: "levels" }
  | { name: "run"; run: EarRun; wasUnlocked: number }
  | { name: "result"; run: EarRun; result: EarFinish; wasUnlocked: number };

interface Props {
  notation: NotationKind;
  resumeRunId?: string | null; // "Davom ettirish" from the profile
  onBack: () => void;
  isPremium: boolean;
  onPremium: (reason: PremiumReason) => void;
}

export function EarTest({ notation, resumeRunId = null, onBack, isPremium, onPremium }: Props) {
  const [view, setView] = useState<View>({ name: "levels" });
  const [progress, setProgress] = useState<EarProgress | null>(null);
  const [failed, setFailed] = useState(false);
  const [busyLevel, setBusyLevel] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const resumed = useRef(false);

  const load = useCallback(() => {
    setFailed(false);
    api.ear.progress().then(setProgress, () => setFailed(true));
  }, []);
  useEffect(load, [load]);

  const unlocked = progress?.max_unlocked_level ?? 1;

  const open = useCallback(
    (start: Promise<EarRun>, level: number) => {
      setBusyLevel(level);
      setError(null);
      start.then(
        (run) => {
          setBusyLevel(null);
          setView({ name: "run", run, wasUnlocked: unlocked });
        },
        (e) => {
          setBusyLevel(null);
          // Shown on whichever screen asked: the levels map or the result.
          if (e instanceof ApiError && e.isPaywall) onPremium({ kind: "ear", level });
          else if (e instanceof ApiError && e.status === 410) {
            setError(t.practice.runExpired);
            load();
          } else setError(t.loadFailed);
        },
      );
    },
    [unlocked, load, onPremium],
  );

  const start = useCallback(
    (level: number) => {
      haptic.tap();
      open(api.ear.start(level), level);
    },
    [open],
  );
  const resume = useCallback(
    (runId: string) => {
      haptic.tap();
      open(api.ear.run(runId), 0);
    },
    [open],
  );

  useEffect(() => {
    if (resumeRunId && progress && !resumed.current) {
      resumed.current = true;
      resume(resumeRunId);
    }
  }, [resumeRunId, progress, resume]);

  const toLevels = useCallback(() => {
    setView({ name: "levels" });
    setError(null);
    load();
  }, [load]);

  const expired = useCallback(() => {
    toLevels();
    setError(t.practice.runExpired);
  }, [toLevels]);

  let screen;
  if (view.name === "run") {
    screen = (
      <EarTestGame
        key={view.run.run_id}
        run={view.run}
        notation={notation}
        onFinished={(result) => {
          setView({ name: "result", run: view.run, result, wasUnlocked: view.wasUnlocked });
          load();
        }}
        onExpired={expired}
        onBack={toLevels}
      />
    );
  } else if (view.name === "result") {
    const { result } = view;
    screen = (
      <EarResult
        result={result}
        kind={view.run.kind}
        levels={progress?.levels ?? []}
        wasUnlocked={view.wasUnlocked}
        busy={busyLevel !== null}
        error={error}
        notation={notation}
        onNext={() => start(result.level + 1)}
        onAgain={() => start(result.level)}
        onLevels={toLevels}
      />
    );
  } else {
    screen = (
      <EarLevels
        progress={progress}
        failed={failed}
        busyLevel={busyLevel}
        error={error}
        notation={notation}
        onStart={start}
        onResume={resume}
        isPremium={isPremium}
        onPremium={(level) => onPremium({ kind: "ear", level })}
        onRetry={load}
        onBack={onBack}
      />
    );
  }

  return screen;
}
