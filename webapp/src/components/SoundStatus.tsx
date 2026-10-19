import { useEffect } from "react";

import { preload, usePlayerStatus } from "../audio/player";
import { t } from "../texts";

/** Preloads the guitar samples while mounted and shows a small badge until ready. */
export function SoundStatus() {
  const status = usePlayerStatus();

  useEffect(() => {
    preload().catch(() => {}); // the error state is shown below
  }, []);

  if (status === "loading") {
    return (
      <div className="sound-status" role="status">
        <span className="spinner" aria-hidden="true" />
        {t.soundLoading}
      </div>
    );
  }
  if (status === "error") {
    return (
      <button className="sound-status error" onClick={() => preload().catch(() => {})}>
        {t.soundFailed}
      </button>
    );
  }
  return null;
}
