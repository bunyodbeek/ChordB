// Quloq testi darajalari — ear-levels.reference.html. The eight levels from the server:
// done ones ✓ with their best, the current one with "Boshlash" (or "Davom ettirish" for an
// unfinished run), the rest locked. Passed levels can be played again.
import type { EarProgress } from "../../api";
import type { NotationKind } from "../../notation";
import { earPoolLabel } from "../../practice";
import { useBackButton } from "../../telegram";
import { t } from "../../texts";
import { Screen } from "../Screen";

interface Props {
  progress: EarProgress | null;
  failed: boolean;
  busyLevel: number | null; // a run is being started
  error: string | null;
  notation: NotationKind;
  onStart: (level: number) => void;
  onResume: (runId: string) => void;
  onRetry: () => void;
  onBack: () => void;
}

export function EarLevels({ progress, failed, busyLevel, error, notation, onStart, onResume, onRetry, onBack }: Props) {
  useBackButton(onBack);
  const streak = progress?.perfect_streak ?? 0;
  const right =
    streak > 0 ? (
      <span className="ear-streak" role="img" aria-label={t.practice.perfectStreakAria(streak)}>
        {t.practice.perfectStreak(streak)}
      </span>
    ) : undefined;

  return (
    <Screen title={t.practice.earTitle} sub={t.practice.levelsRule} right={right} bodyClassName="ear-levels scroll-y">
      {error && (
        <p className="editor-status error" role="alert">
          {error}
        </p>
      )}
      {!progress ? (
        failed ? (
          <div className="song-list-note">
            <p>{t.practice.loadFailed}</p>
            <button type="button" className="button" onClick={onRetry}>
              {t.retry}
            </button>
          </div>
        ) : (
          Array.from({ length: 8 }, (_, i) => <div key={i} className="ear-level skeleton" aria-hidden="true" />)
        )
      ) : (
        progress.levels.map((lv) => {
          const current = lv.level === progress.max_unlocked_level;
          const done = lv.level < progress.max_unlocked_level;
          const active = progress.active_run?.level === lv.level ? progress.active_run : null;
          const pool = earPoolLabel(lv, notation);
          const playable = done || current;
          const body = (
            <>
              <span className={`ear-level-badge${done ? " done" : current ? " now" : ""}`} aria-hidden="true">
                {done ? "✓" : lv.level}
              </span>
              <span className="ear-level-text">
                <span className="ear-level-head">
                  <span className="ear-level-title">{t.practice.levelTitle(lv.level, lv.title)}</span>
                  {lv.premium && <span className="ear-level-premium">{t.songs.premium}</span>}
                </span>
                <span className="ear-level-pool">
                  {current && lv.best !== null ? `${pool} · ${t.practice.bestScore(lv.best)}` : pool}
                </span>
              </span>
            </>
          );
          if (current || active) {
            return (
              <div key={lv.level} className={`ear-level${current ? " now" : ""}`}>
                {body}
                <button
                  type="button"
                  className="ear-level-start"
                  disabled={busyLevel !== null}
                  onClick={() => (active ? onResume(active.run_id) : onStart(lv.level))}
                >
                  {active ? t.practice.resume : t.practice.start}
                </button>
              </div>
            );
          }
          return (
            <button
              key={lv.level}
              type="button"
              className={`ear-level${playable ? "" : " locked"}`}
              disabled={!playable || busyLevel !== null}
              onClick={() => onStart(lv.level)}
            >
              {body}
              <span className={`ear-level-score${done ? " done" : ""}`}>
                {done ? t.practice.score(lv.best ?? 10) : t.practice.locked}
              </span>
            </button>
          );
        })
      )}
    </Screen>
  );
}
