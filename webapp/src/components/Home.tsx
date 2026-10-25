// Asosiy — home.reference.html: today's recommendation, the Tuner and Akkordlar tiles,
// popular songs, and (for free users) the premium card. Data: GET /api/home.
import { useCallback, useEffect, useState } from "react";

import { api, type HomeData, type SongSummary } from "../api";
import { QUALITIES } from "../chords";
import type { NotationKind } from "../notation";
import { formatSom } from "../panel/format";
import { haptic } from "../telegram";
import { t } from "../texts";
import { Screen } from "./Screen";
import { ChevronIcon, Icon, LockIcon, Logo, SongRow, TunerIcon, previewLine } from "./ui";

interface Props {
  firstName: string;
  isPremium: boolean;
  notation: NotationKind;
  onOpenTuner: () => void;
  onOpenChords: () => void;
  onOpenSong: (song: SongSummary) => void; // a locked one opens the premium sheet
  onAllSongs: () => void;
  onPremium: () => void;
}

// Kept across tab switches: coming back shows the last answer at once, then refreshes.
let cached: HomeData | null = null;

export function Home({
  firstName,
  isPremium,
  notation,
  onOpenTuner,
  onOpenChords,
  onOpenSong,
  onAllSongs,
  onPremium,
}: Props) {
  const [data, setData] = useState<HomeData | null>(cached);
  const [failed, setFailed] = useState(false);

  const load = useCallback(() => {
    setFailed(false);
    api.home().then(
      (d) => {
        cached = d;
        setData(d);
      },
      () => setFailed(true),
    );
  }, []);
  useEffect(load, [load]);

  const tap = (go: () => void) => () => {
    haptic.tap();
    go();
  };
  const rec = data?.recommended;

  return (
    <Screen
      title="ChordB"
      sub={t.home.greeting(firstName)}
      lead={<Logo />}
      right={
        data && (
          <span className="streak-chip" role="img" aria-label={t.home.streakAria(data.streak)}>
            <Icon size={16}>
              <path d="M12 3c1 4 5 5 5 10a5 5 0 0 1-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-3-1-5 1-9z" />
            </Icon>
            {data.streak}
          </span>
        )
      }
      className="home"
      bodyClassName="home-body scroll-y"
    >
      {rec && (
        <section className="home-hero">
          <span className="home-hero-label">{t.home.recommended}</span>
          <span className="home-hero-title">{rec.title}</span>
          <span className="home-hero-meta">
            {rec.artist}
            {rec.chords_preview.length > 0 && (
              <>
                {" · "}
                <span className="mono">{previewLine(rec.chords_preview, notation)}</span>
              </>
            )}
            {" · "}
            {t.songs.levels[rec.difficulty]}
          </span>
          <button type="button" className="home-hero-start" onClick={tap(() => onOpenSong(rec))}>
            <Icon size={16}>
              <path d="M8 5v14l11-7z" fill="currentColor" stroke="none" />
            </Icon>
            {t.home.start}
          </button>
        </section>
      )}

      <div className="home-tiles">
        <button type="button" className="home-tile" onClick={tap(onOpenTuner)}>
          <span className="home-tile-icon green">
            <TunerIcon size={24} />
          </span>
          <span className="home-tile-text">
            <span className="home-tile-title">{t.home.tuner}</span>
            <span className="home-tile-sub">{t.home.tunerSub}</span>
          </span>
        </button>
        <button type="button" className="home-tile" onClick={tap(onOpenChords)}>
          <span className="home-tile-icon blue">
            <Icon>
              <rect x="5" y="4" width="14" height="16" rx="2" />
              <path d="M9.5 4v16M14.5 4v16M5 9h14M5 14h14" />
            </Icon>
          </span>
          <span className="home-tile-text">
            <span className="home-tile-title">{t.tabs.chords}</span>
            <span className="home-tile-sub">{t.home.chordsSub(12 * QUALITIES.length)}</span>
          </span>
        </button>
      </div>

      {failed && !data && (
        <p className="home-note">
          {t.loadFailed}{" "}
          <button type="button" className="link-button" onClick={load}>
            {t.retry}
          </button>
        </p>
      )}

      {data && data.popular.length > 0 && (
        <>
          <div className="home-section-head">
            <h2>{t.home.popular}</h2>
            <button type="button" className="link-button" onClick={tap(onAllSongs)}>
              {t.home.all}
            </button>
          </div>
          {data.popular.map((s) => (
            <SongRow
              key={s.id}
              id={s.id}
              title={s.title}
              artist={s.artist}
              difficulty={s.difficulty}
              chords={previewLine(s.chords_preview, notation)}
              locked={s.locked}
              onClick={tap(() => onOpenSong(s))}
            />
          ))}
        </>
      )}

      {data && !isPremium && (
        <button type="button" className="home-premium" onClick={tap(onPremium)}>
          <span className="home-premium-icon">
            <LockIcon size={18} />
          </span>
          <span className="home-premium-text">
            <span className="home-premium-title">{t.home.premiumTitle}</span>
            <span className="home-premium-sub">
              {t.home.premiumSub(formatSom(data.premium_price_month))}
            </span>
          </span>
          <ChevronIcon />
        </button>
      )}
    </Screen>
  );
}
