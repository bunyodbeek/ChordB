// Takliflar: chord fixes users suggested in the player for catalog songs. Not in the
// design specs; built from the panel's parts. Accept changes the song at once.
import { useState } from "react";

import { api, type ChordSuggestion } from "../api";
import { spelled } from "../chords";
import { formatChord, type NotationKind } from "../notation";
import { formatTime } from "../timeline";
import { t } from "../texts";
import { ago, displayName } from "./format";
import { LoadState, PanelLink, useLoad } from "./ui";

const TIMES_SHOWN = 4;

export function SuggestionsPage({ notation }: { notation: NotationKind }) {
  const [attempt, setAttempt] = useState(0);
  const list = useLoad(() => api.admin.suggestions(), [attempt]);
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const name = (c: ChordSuggestion["old_chord"]) => formatChord(spelled(c), notation);

  const decide = async (s: ChordSuggestion, decision: "accept" | "reject") => {
    setBusy(s.id);
    setError(null);
    try {
      await api.admin.decide(s.id, decision);
      setAttempt((n) => n + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <div className="pn-head">
        <div className="pn-head-title">
          <h1>{t.panel.suggestionsTitle}</h1>
          <span className="pn-meta">{t.panel.suggestionsHint}</span>
        </div>
      </div>
      {error && (
        <p className="pn-status error" role="status">
          {error}
        </p>
      )}
      <section aria-label={t.panel.suggestionsTitle} className="pn-card pn-table-card">
        <LoadState state={list}>
          {(items) =>
            items.length === 0 ? (
              <div className="pn-note muted">{t.panel.noSuggestions}</div>
            ) : (
              <table className="pn-table">
                <thead>
                  <tr>
                    <th scope="col">{t.panel.suggestionCols.song}</th>
                    <th scope="col">{t.panel.suggestionCols.change}</th>
                    <th scope="col">{t.panel.suggestionCols.where}</th>
                    <th scope="col">{t.panel.suggestionCols.who}</th>
                    <th scope="col">{t.panel.suggestionCols.when}</th>
                    <th scope="col" />
                  </tr>
                </thead>
                <tbody>
                  {items.map((s) => (
                    <tr key={s.id}>
                      <td>
                        <PanelLink to={`#/songs/${s.song_id}`} className="pn-stack pn-plain">
                          <span className="pn-strong">{s.song_title}</span>
                          <span className="pn-meta">{s.song_artist}</span>
                        </PanelLink>
                      </td>
                      <td className="pn-mono pn-strong">
                        {name(s.old_chord)} → {name(s.new_chord)}
                      </td>
                      <td className="pn-mono">
                        {s.times.slice(0, TIMES_SHOWN).map(formatTime).join(", ")}
                        {s.times.length > TIMES_SHOWN && ` ${t.panel.moreTimes(s.times.length - TIMES_SHOWN)}`}
                      </td>
                      <td>{displayName(s.user)}</td>
                      <td className="muted">{ago(s.created_at)}</td>
                      <td>
                        <span className="pn-actions">
                          <button
                            type="button"
                            className="pn-btn small primary"
                            disabled={busy === s.id}
                            onClick={() => void decide(s, "accept")}
                          >
                            {t.panel.acceptSuggestion}
                          </button>
                          <button
                            type="button"
                            className="pn-btn small danger"
                            disabled={busy === s.id}
                            onClick={() => void decide(s, "reject")}
                          >
                            {t.panel.rejectSuggestion}
                          </button>
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          }
        </LoadState>
      </section>
    </>
  );
}
