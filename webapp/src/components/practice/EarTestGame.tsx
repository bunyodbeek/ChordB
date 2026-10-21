// Quloq testi — game-ear-test.reference.html. Ten chords played with the guitar sound;
// pick the one you heard from four (level 1: major or minor). The score is saved.
import { useEffect, useMemo, useState } from "react";

import { api } from "../../api";
import { playChord, preload } from "../../audio/player";
import { spelled } from "../../chords";
import { formatChord, type Chord, type NotationKind } from "../../notation";
import { EAR_QUESTIONS, earQuestions, rng, toJson } from "../../practice";
import { haptic, useBackButton } from "../../telegram";
import { t } from "../../texts";
import { Screen } from "../Screen";
import { GameResult } from "./GameResult";

interface Answer {
  chord: Chord;
  picked: Chord;
  correct: boolean;
}

const same = (a: Chord, b: Chord) => a.root === b.root && a.quality === b.quality;

interface Props {
  best: number;
  notation: NotationKind;
  onBack: () => void;
}

export function EarTestGame({ best, notation, onBack }: Props) {
  useBackButton(onBack);
  const [seed, setSeed] = useState(() => Date.now());
  const questions = useMemo(() => earQuestions(rng(seed)), [seed]);
  const [q, setQ] = useState(0);
  const [answers, setAnswers] = useState<Answer[]>([]);
  const [done, setDone] = useState(false);
  const [result, setResult] = useState<{ best: number; newBest: boolean } | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);

  const question = questions[q];
  const picked = answers[q]?.picked ?? null;
  const score = answers.filter((a) => a.correct).length;

  useEffect(() => {
    void api.event("game_start", "ear_test");
    preload().catch(() => {});
  }, []);

  const play = () => void playChord(spelled(question.answer)).catch(() => {});
  // Each new question plays its chord once by itself.
  useEffect(() => {
    if (!done) play();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, seed, done]);

  const pick = (c: Chord) => {
    if (picked) return;
    const correct = same(c, question.answer);
    if (correct) haptic.success();
    else haptic.error();
    setAnswers((a) => [...a, { chord: question.answer, picked: c, correct }]);
  };

  const finish = () => {
    setDone(true);
    api.practice
      .result("ear_test", score, {
        level: 1,
        answers: answers.map((a) => ({ chord: toJson(a.chord), picked: toJson(a.picked), correct: a.correct })),
      })
      .then(
        (r) => setResult({ best: r.best, newBest: r.new_best }),
        () => setSaveFailed(true),
      );
  };

  const next = () => {
    haptic.tap();
    if (q + 1 >= EAR_QUESTIONS) finish();
    else setQ(q + 1);
  };

  const again = () => {
    setSeed(Date.now());
    setQ(0);
    setAnswers([]);
    setDone(false);
    setResult(null);
    setSaveFailed(false);
  };

  const right = <span className="ear-score">{t.practice.score(score)}</span>;

  if (done) {
    return (
      <Screen title={t.practice.earTitle} right={right} bodyClassName="game-body">
        <GameResult
          title={t.practice.earTitle}
          score={t.practice.score(score)}
          caption={t.practice.earSub}
          best={result ? result.best : best || null}
          newBest={result?.newBest ?? false}
          failed={saveFailed}
          shareText={t.practice.shareEar(score)}
          onAgain={again}
          onDone={onBack}
        />
      </Screen>
    );
  }

  return (
    <Screen title={t.practice.earTitle} right={right} bodyClassName="game-body ear-body">
      <div className="ear-dots" aria-label={t.practice.questions}>
        {Array.from({ length: EAR_QUESTIONS }, (_, i) => (
          <span
            key={i}
            className={`ear-dot${i < answers.length ? (answers[i].correct ? " ok" : " bad") : i === q ? " now" : ""}`}
          />
        ))}
      </div>
      <span className="ear-label">{t.practice.question(q + 1)}</span>

      <div className="ear-card">
        <button type="button" className="ear-play" aria-label={t.practice.listen} onClick={play}>
          <svg aria-hidden="true" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M11 5L6 9H3v6h3l5 4V5z" fill="currentColor" />
            <path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" />
          </svg>
        </button>
        <span className="ear-which">{t.practice.which}</span>
        <button type="button" className="ear-again" onClick={play}>
          {t.practice.again2}
        </button>
      </div>

      <div className="ear-options">
        {question.options.map((o) => {
          const label = formatChord(spelled(o), notation);
          const isAnswer = same(o, question.answer);
          const isPicked = picked !== null && same(o, picked);
          const state = picked === null ? "" : isAnswer ? " ok" : isPicked ? " bad" : "";
          const note =
            picked !== null && isAnswer
              ? t.practice.rightNote
              : isPicked
                ? t.practice.wrongNote
                : o.quality === "min"
                  ? "minor"
                  : "major";
          return (
            <button
              key={`${o.root}:${o.quality}`}
              type="button"
              className={`ear-option${state}`}
              aria-label={t.practice.chordAria(label)}
              disabled={picked !== null && !isAnswer && !isPicked}
              onClick={() => pick(o)}
            >
              <span className="ear-option-name">{label}</span>
              <span className="ear-option-note">{note}</span>
            </button>
          );
        })}
      </div>

      {picked !== null && (
        <button type="button" className="ear-next" onClick={next}>
          {q + 1 >= EAR_QUESTIONS ? t.practice.finish : t.practice.next}
        </button>
      )}
    </Screen>
  );
}
