import { useCallback, useEffect, useState } from "react";

import { playChord } from "../audio/player";
import { formatChord, parseChord, type NotationKind } from "../notation";
import { SONGS, chordsOf, songChord, type Song } from "../songs";
import { haptic, useBackButton } from "../telegram";
import { t } from "../texts";
import { ChordCard } from "./ChordCard";
import { SoundStatus } from "./SoundStatus";

export function Songs({ notation }: { notation: NotationKind }) {
  const [open, setOpen] = useState<Song | null>(null);
  // Stable so Telegram's back button isn't re-registered on every render.
  const close = useCallback(() => setOpen(null), []);

  useEffect(() => window.scrollTo(0, 0), [open]);

  if (open) return <SongView song={open} notation={notation} onBack={close} />;

  const list = (kind: Song["kind"]) =>
    SONGS.filter((s) => s.kind === kind).map((s) => (
      <button
        key={s.id}
        className="card song-item"
        onClick={() => {
          haptic.tap();
          setOpen(s);
        }}
      >
        <span className="song-title">{s.title}</span>
        <span className="muted small">
          {s.author} · {formatChord(parseChord(s.key), notation)} · {t.levels[s.level]}
        </span>
        <span className="song-chips">
          {chordsOf(s).map((sym) => (
            <span key={sym} className="mini-chip">
              {formatChord(parseChord(sym), notation)}
            </span>
          ))}
        </span>
      </button>
    ));

  return (
    <div className="page">
      <header className="page-header">
        <h1>{t.tabs.songs}</h1>
      </header>
      <h2 className="section-title">{t.songsHeading}</h2>
      {list("song")}
      <h2 className="section-title">{t.progressionsHeading}</h2>
      {list("progression")}
    </div>
  );
}

function SongView({
  song,
  notation,
  onBack,
}: {
  song: Song;
  notation: NotationKind;
  onBack: () => void;
}) {
  const [shift, setShift] = useState(0);
  useBackButton(onBack);

  const name = (sym: string) => formatChord(songChord(sym, shift), notation);
  const play = (sym: string) => {
    haptic.tap();
    void playChord(songChord(sym, shift)).catch(() => {});
  };
  const transposeBy = (d: number) => {
    haptic.tap();
    setShift((s) => ((s + d + 17) % 12) - 5); // keep within -5..+6
  };

  return (
    <div className="page">
      <button className="back-link" onClick={onBack}>
        ‹ {t.back}
      </button>
      <header className="page-header">
        <h1>{song.title}</h1>
        <div className="subtitle">
          {song.author} · {song.meter} · {t.levels[song.level]}
        </div>
      </header>

      <div className="card transpose">
        <span className="card-label">{t.key}</span>
        <div className="stepper">
          <button aria-label="-1" onClick={() => transposeBy(-1)}>
            −
          </button>
          <span>
            {name(song.key)}
            {shift !== 0 && (
              <span className="muted shift">
                {" "}
                ({shift > 0 ? "+" : ""}
                {shift})
              </span>
            )}
          </span>
          <button aria-label="+1" onClick={() => transposeBy(1)}>
            +
          </button>
        </div>
      </div>

      <h2 className="section-title">{t.chordsUsed}</h2>
      <SoundStatus />
      <div className="chord-strip">
        {chordsOf(song).map((sym) => (
          <ChordCard key={sym} chord={songChord(sym, shift)} notation={notation} compact />
        ))}
      </div>

      {song.sections.map((section, i) => (
        <section key={i}>
          <h2 className="section-title">{section.name}</h2>
          <div className={`bars${notation === "solfege" ? " wide" : ""}`}>
            {section.bars.map((bar, j) => (
              <div key={j} className="bar">
                {bar.split(" ").map((sym, k) => (
                  <button key={k} className="bar-chord" onClick={() => play(sym)}>
                    {name(sym)}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </section>
      ))}
      <p className="muted small bars-hint">{t.barsHint}</p>
    </div>
  );
}
