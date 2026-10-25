// Quloq testi natijasi — ear-result.reference.html: the score with ten dots, the chords
// mixed up (both playable), then "Keyingi daraja" after 10/10, else "Qayta urinish".
import type { EarFinish, EarKind, EarLevel, EarSide } from "../../api";
import { playFrets, playSequence } from "../../audio/player";
import type { NotationKind } from "../../notation";
import { chordsLabel, EAR_QUESTIONS, mistakeTip } from "../../practice";
import { haptic, useBackButton } from "../../telegram";
import { t } from "../../texts";
import { Screen } from "../Screen";

interface Props {
  result: EarFinish;
  kind: EarKind;
  levels: EarLevel[];
  wasUnlocked: number; // max_unlocked_level before this run
  busy: boolean;
  error: string | null;
  notation: NotationKind;
  onNext: () => void;
  onAgain: () => void;
  onLevels: () => void;
}

export function EarResult({ result, kind, levels, wasUnlocked, busy, error, notation, onNext, onAgain, onLevels }: Props) {
  useBackButton(onLevels);
  const { score, perfect, mistakes } = result;
  const wrong = new Set(mistakes.map((m) => m.question_id));
  const opened = result.unlocked_level !== null && result.unlocked_level > wasUnlocked ? result.unlocked_level : null;
  const openedTitle = levels.find((l) => l.level === opened)?.title ?? "";
  const last = result.level >= levels.length;

  const headline = perfect
    ? opened
      ? t.practice.unlocked(opened, openedTitle)
      : last
        ? t.practice.allDone
        : t.practice.perfectAgain
    : score === EAR_QUESTIONS - 1
      ? t.practice.close
      : t.practice.tryAgainHead;

  const name = (s: EarSide) => chordsLabel(s.chords, notation);
  // Level 1's answers are a quality: "Siz Major dedingiz, aslida Minor edi".
  const said = (s: EarSide) => (kind === "quality" ? (t.practice.qualities[s.id] ?? s.id) : name(s));
  const hear = (s: EarSide) => {
    haptic.tap();
    const v = s.voicing;
    void (v.length > 1 ? playSequence(v) : playFrets(v[0])).catch(() => {});
  };

  const primary = perfect && !last ? t.practice.nextLevel : t.practice.tryAgain;

  return (
    <Screen
      title={t.practice.resultTitle}
      onBack={onLevels}
      right={<span className="ear-result-level">{t.practice.levelN(result.level)}</span>}
      bodyClassName="ear-result-body"
      after={
        <div className="ear-result-actions">
          {error && (
            <p className="editor-status error" role="alert">
              {error}
            </p>
          )}
          <button type="button" className="ear-result-primary" disabled={busy} onClick={perfect && !last ? onNext : onAgain}>
            {primary}
          </button>
          <button type="button" className="ear-result-secondary" onClick={onLevels}>
            {t.practice.levels}
          </button>
        </div>
      }
    >
      <section className={`ear-hero${perfect ? " perfect" : ""}`} aria-label={t.practice.scoreLabel}>
        <span className="ear-hero-score">
          {score}
          <span className="ear-hero-of">/{EAR_QUESTIONS}</span>
        </span>
        <div className="ear-hero-dots" aria-hidden="true">
          {Array.from({ length: EAR_QUESTIONS }, (_, i) => (
            <span key={i} className={wrong.has(i) ? "bad" : "ok"} />
          ))}
        </div>
        <span className="ear-hero-head">{headline}</span>
        <span className="ear-hero-sub">{perfect ? t.practice.perfectSub : t.practice.needPerfect}</span>
      </section>

      {mistakes.length > 0 && (
        <section className="ear-mistakes" aria-label={t.practice.mistakes}>
          <h2>{t.practice.mistakes}</h2>
          {mistakes.map((m) => (
            <div key={m.question_id} className={`ear-mistake${kind === "progression" ? " stacked" : ""}`}>
              <span className="ear-mistake-text">
                <span className="ear-mistake-pair">
                  {name(m.asked)} ↔ {name(m.answered)}
                </span>
                <span className="ear-mistake-said">{t.practice.mistake(said(m.answered), said(m.asked))}</span>
              </span>
              <span className="ear-mistake-play">
                {[m.asked, m.answered].map((s, i) => (
                  <button key={i} type="button" aria-label={t.practice.chordAria(name(s))} onClick={() => hear(s)}>
                    ▶ {kind === "progression" ? i + 1 : name(s)}
                  </button>
                ))}
              </span>
            </div>
          ))}
          <span className="ear-mistakes-tip">{t.practice.tips[mistakeTip(kind, mistakes)]}</span>
        </section>
      )}
    </Screen>
  );
}
