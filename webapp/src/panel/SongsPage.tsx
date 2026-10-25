// Qoʻshiqlar: every song, drafts included. Not in the design specs; built from its parts.
import { api } from "../api";
import { navigate } from "../router";
import { formatChord, type NotationKind } from "../notation";
import { spelled } from "../chords";
import { t } from "../texts";
import { shortDate } from "./format";
import { LoadState, PanelLink, useLoad } from "./ui";

/** The video's thumbnail, so a wrong YouTube id is seen at a glance. */
export function VideoThumb({ id, title }: { id: string; title: string }) {
  return (
    <img
      className="pn-thumb"
      src={`https://i.ytimg.com/vi/${id}/mqdefault.jpg`}
      alt={t.panel.videoPreview(title)}
      width={96}
      height={54}
      loading="lazy"
    />
  );
}

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
          {(list) => {
            // The same video under several songs is almost always a wrong id.
            const uses = new Map<string, number>();
            for (const s of list) uses.set(s.youtube_id, (uses.get(s.youtube_id) ?? 0) + 1);
            return list.length === 0 ? (
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
                        <span className="pn-song-cell">
                          <VideoThumb id={s.youtube_id} title={s.title} />
                          <PanelLink to={`#/songs/${s.id}`} className="pn-stack pn-plain">
                            <span className="pn-strong">{s.title}</span>
                            <span className="pn-meta">{s.artist}</span>
                            <span className="pn-meta pn-mono">{s.youtube_id}</span>
                            {(uses.get(s.youtube_id) ?? 0) > 1 && (
                              <span className="pn-pill pending">
                                {t.panel.duplicateVideo((uses.get(s.youtube_id) ?? 1) - 1)}
                              </span>
                            )}
                          </PanelLink>
                        </span>
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
            );
          }}
        </LoadState>
      </section>
    </>
  );
}
