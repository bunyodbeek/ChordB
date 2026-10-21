import { useEffect } from "react";

import { preload, usePlayerStatus } from "../audio/player";
import { t } from "../texts";

/** Preloads the guitar samples while mounted; shows a retry if they fail to load. */
export function SoundStatus() {
  const status = usePlayerStatus();

  useEffect(() => {
    preload().catch(() => {}); // the error state is shown below
  }, []);

  if (status === "error") {
    return (
      <button className="sound-status error" onClick={() => preload().catch(() => {})}>
        {t.soundFailed}
      </button>
    );
  }
  return null;
}
