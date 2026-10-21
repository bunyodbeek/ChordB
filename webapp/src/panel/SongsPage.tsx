// Qoʻshiqlar: every song, drafts included. Not in the design specs; built from its parts.
import { api } from "../api";
import { navigate } from "../router";
import { formatChord, type NotationKind } from "../notation";
import { spelled } from "../chords";
import { t } from "../texts";
import { shortDate } from "./format";
import { LoadState, PanelLink, useLoad } from "./ui";

export function SongsPage({ notation }: { notation: NotationKind }) {
  const songs = useLoad(() => api.admin.songs(), []);
  return (
    <>
      <div className="pn-head">
        <h1>{t.panel.songsTitle}</h1>
        <PanelLink to="#/songs/new" className="pn-btn big primary">
          {t.panel.newSong}
        </PanelLink>
      </div>
      <section aria-label={t.panel.songsTitle} className="pn-card pn-table-card">
        <LoadState state={songs}>
          {(list) =>
            list.length === 0 ? (
              <div className="pn-note muted">{t.songs.empty}</div>
            ) : (
              <table className="pn-table">
                <thead>
                  <tr>
                    <th scope="col">{t.panel.songCols.song}</th>
                    <th scope="col">{t.panel.songCols.chords}</th>
                    <th scope="col">{t.panel.songCols.status}</th>
                    <th scope="col">{t.panel.songCols.added}</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((s) => (
                    <tr key={s.id} className="clickable" onClick={() => navigate(`/admin#/songs/${s.id}`)}>
                      <td>
                        <PanelLink to={`#/songs/${s.id}`} className="pn-stack pn-plain">
                          <span className="pn-strong">{s.title}</span>
                          <span className="pn-meta">{s.artist}</span>
                        </PanelLink>
                      </td>
                      <td className="pn-mono">
                        {s.chords_preview.length
                          ? s.chords_preview.map((c) => formatChord(spelled(c), notation)).join(" · ")
                          : <span className="muted">{t.admin.noChords}</span>}
                      </td>
                      <td>
                        <span className="pn-tags">
                          <span className={`pn-pill ${s.is_published ? "premium" : "free"}`}>
                            {s.is_published ? t.admin.published : t.admin.draft}
                          </span>
                          {s.is_premium && <span className="pn-pill pending">{t.songs.premium}</span>}
                        </span>
                      </td>
                      <td className="muted">{shortDate(s.created_at)}</td>
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
