// Quloq testi — game-ear-test.reference.html. One server run: ten questions, each played
// with the guitar sound in the voicing the server sent (real barre shapes). The options
// stay disabled until the chord has sounded; the server says whether a choice is right,
// and the card then shows the right chord's diagram. A resumed run continues after the
// questions already answered.
import { useCallback, useEffect, useState } from "react";

import { api, ApiError, type EarAnswer, type EarFinish, type EarRun } from "../../api";
import { playFrets, playSequence, preload } from "../../audio/player";
import type { NotationKind } from "../../notation";
import { chordsLabel, EAR_QUESTIONS, earOptionLabel } from "../../practice";
import { haptic, useBackButton } from "../../telegram";
import { t } from "../../texts";
import { ChordDiagram } from "../ChordDiagram";
import { Screen } from "../Screen";

type Answered = EarAnswer & { choice: string };

interface Props {
  run: EarRun;
  notation: NotationKind;
  onFinished: (result: EarFinish) => void;
  onExpired: () => void; // 410: the run is gone, back to the levels
  onBack: () => void;
}

export function EarTestGame({ run, notation, onFinished, onExpired, onBack }: Props) {
  useBackButton(onBack);
  const [answers, setAnswers] = useState<Answered[]>(() =>
    run.answered.map((a) => ({ choice: a.choice, correct: a.correct, correct_answer: a.correct_answer, played: a.played })),
  );
  const [q, setQ] = useState(() => Math.min(run.answered.length, EAR_QUESTIONS - 1));
  const [heard, setHeard] = useState(false);
  const [soundFailed, setSoundFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const question = run.questions[q];
  const answer = answers[q] ?? null;
  const score = answers.filter((a) => a.correct).length;

  useEffect(() => {
    preload().catch(() => {});
  }, []);

  const play = useCallback(() => {
    const v = question.voicing;
    (v.length > 1 ? playSequence(v) : playFrets(v[0])).then(
      () => {
        setHeard(true);
        setSoundFailed(false);
      },
      () => setSoundFailed(true),
    );
  }, [question]);

  // Each new question plays by itself once; answers wait until it has sounded.
  useEffect(() => {
    if (answers[q]) return; // a resumed run that stopped after answering
    setHeard(false);
    play();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const finish = useCallback(() => {
    setBusy(true);
    setError(null);
    api.ear.finish(run.run_id).then(onFinished, (e) => {
      setBusy(false);
      if (e instanceof ApiError && e.status === 410) onExpired();
      else setError(t.practice.runFailed);
    });
  }, [run.run_id, onFinished, onExpired]);

  // Everything answered already (a run resumed at the very end): straight to the result.
  useEffect(() => {
    if (run.answered.length >= EAR_QUESTIONS) finish();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pick = (choice: string) => {
    if (answer || busy || !heard) return;
    setBusy(true);
    setError(null);
    api.ear.answer(run.run_id, question.question_id, choice).then(
      (r) => {
        setBusy(false);
        setAnswers((a) => [...a, { ...r, choice }]);
        if (r.correct) {
          haptic.success();
          play(); // the right chord once more, now with its diagram
        } else {
          haptic.error();
        }
      },
      (e) => {
        setBusy(false);
        if (e instanceof ApiError && e.status === 410) onExpired();
        else setError(t.practice.runFailed);
      },
    );
  };

  const next = () => {
    haptic.tap();
    if (q + 1 >= EAR_QUESTIONS) finish();
    else setQ(q + 1);
  };

  const right = <span className="ear-score">{t.practice.score(score)}</span>;
  const progression = run.kind === "progression";
  const optionById = (id: string) => question.options.find((o) => o.id === id);
  const label = (id: string) => {
    const o = optionById(id);
    return o ? earOptionLabel(o, notation) : id;
  };

  let card;
  if (!answer) {
    card = (
      <div className="ear-card">
        <button type="button" className="ear-play" aria-label={t.practice.listen} onClick={play}>
          <svg aria-hidden="true" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M11 5L6 9H3v6h3l5 4V5z" fill="currentColor" />
            <path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" />
          </svg>
        </button>
        <span className="ear-which">{progression ? t.practice.whichProgression : t.practice.which}</span>
        {soundFailed && <span className="ear-sound-failed">{t.soundFailed}</span>}
        <button type="button" className="ear-again" onClick={play}>
          {t.practice.again2}
        </button>
      </div>
    );
  } else {
    const name = chordsLabel(answer.played, notation);
    const tone = answer.correct ? "ok" : "bad";
    card = (
      <div className={`ear-card reveal ${tone}`} aria-live="polite">
        <span className={`ear-reveal-name${progression ? " small" : ""}`}>{name}</span>
        {progression ? (
          <div className="ear-reveal-row">
            {question.voicing.map((frets, i) => (
              <ChordDiagram
                key={i}
                frets={frets}
                label={t.player.diagram(chordsLabel([answer.played[i]], notation))}
                size="md"
                tone={answer.correct ? "green" : "accent"}
              />
            ))}
          </div>
        ) : (
          <ChordDiagram
            frets={question.voicing[0]}
            label={t.player.diagram(name)}
            size="lg"
            tone={answer.correct ? "green" : "accent"}
            fingers
          />
        )}
        {answer.correct ? (
          <span className="ear-verdict ok">{t.practice.right}</span>
        ) : (
          <span className="ear-verdict bad">
            {/* A progression is too long to repeat: the red option below shows the pick. */}
            {progression ? t.practice.wrong : t.practice.youSaid(label(answer.choice))} ·{" "}
            <button type="button" className="ear-listen-right" onClick={play}>
              {progression ? t.practice.listenAgain : t.practice.listenTo(name)}
            </button>
          </span>
        )}
      </div>
    );
  }

  return (
    <Screen title={t.practice.earTitle} onBack={onBack} right={right} bodyClassName="game-body ear-body">
      <div className="ear-dots" aria-label={t.practice.questions}>
        {Array.from({ length: EAR_QUESTIONS }, (_, i) => (
          <span
            key={i}
            className={`ear-dot${i < answers.length ? (answers[i].correct ? " ok" : " bad") : i === q ? " now" : ""}`}
          />
        ))}
      </div>
      <span className="ear-label">{t.practice.question(q + 1, run.kind)}</span>

      {card}

      <div className={`ear-options${progression ? " wide" : ""}${!heard && !answer ? " waiting" : ""}`}>
        {question.options.map((o) => {
          const name = earOptionLabel(o, notation);
          const isAnswer = answer !== null && o.id === answer.correct_answer;
          const isPicked = answer !== null && o.id === answer.choice;
          const state = isAnswer ? " ok" : isPicked ? " bad" : "";
          return (
            <button
              key={o.id}
              type="button"
              className={`ear-option${state}`}
              aria-label={t.practice.chordAria(name)}
              disabled={!heard || busy || (answer !== null && !isAnswer && !isPicked)}
              onClick={() => pick(o.id)}
            >
              <span className={`ear-option-name${progression || notation === "solfege" ? " small" : ""}`}>{name}</span>
            </button>
          );
        })}
      </div>

      {error && (
        <p className="editor-status error" role="alert">
          {error}
        </p>
      )}

      {answer !== null && (
        <button type="button" className="ear-next" disabled={busy} onClick={next}>
          {q + 1 >= EAR_QUESTIONS ? t.practice.finish : t.practice.next}
        </button>
      )}
    </Screen>
  );
}
