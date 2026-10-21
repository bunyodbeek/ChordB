// The end of a game: a share card with the score, the personal best, "Yana" and share.
import type { ReactNode } from "react";

import { share } from "../../telegram";
import { t } from "../../texts";

interface Props {
  title: string; // the game
  score: ReactNode; // "18" or "8/10"
  caption: string; // under the score
  best: number | null; // null while the result is being saved
  newBest: boolean;
  failed: boolean; // the result couldn't be saved
  shareText: string;
  onAgain: () => void;
  onDone: () => void;
}

export function GameResult({ title, score, caption, best, newBest, failed, shareText, onAgain, onDone }: Props) {
  return (
    <div className="result-body">
      <div className="share-card" aria-label={t.practice.resultTitle}>
        <span className="share-brand">
          Chord<b>B</b> · {title}
        </span>
        <span className="share-score">{score}</span>
        <span className="share-caption">{caption}</span>
        {newBest && <span className="share-best new">{t.practice.newBest}</span>}
        {!newBest && best !== null && <span className="share-best">{t.practice.bestWas(best)}</span>}
      </div>
      {failed && (
        <p className="editor-status error" role="alert">
          {t.practice.saveFailed}
        </p>
      )}
      <div className="result-actions">
        <button type="button" className="button wide" onClick={onAgain}>
          {t.practice.yana}
        </button>
        <button type="button" className="button wide secondary" onClick={() => share(shareText)}>
          {t.practice.share}
        </button>
        <button type="button" className="result-link" onClick={onDone}>
          {t.practice.toHub}
        </button>
      </div>
    </div>
  );
}
