// Akkordlar — chords-library-v3.reference.html: every chord in a 3-column grid, by type.
import { useEffect, useMemo, useRef, useState } from "react";

import { QUALITIES, prefersFlat, voicing } from "../chords";
import { formatChord, type Chord, type NotationKind, type Quality } from "../notation";
import { haptic, useBackButton } from "../telegram";
import { t } from "../texts";
import { ChordCard } from "./ChordCard";
import { ChordTrySheet } from "./practice/ChordTrySheet";
import { Screen } from "./Screen";
import { SoundStatus } from "./SoundStatus";
import { Chip, SearchIcon } from "./ui";

type Filter = "all" | "major" | "minor" | "seventh" | "barre";
const FILTERS: Filter[] = ["all", "major", "minor", "seventh", "barre"];
const SEVENTHS: Quality[] = ["7", "m7", "maj7"];

// C to B, each root with all its qualities.
const ALL: Chord[] = Array.from({ length: 12 }, (_, root) =>
  QUALITIES.map((quality) => ({ root, quality, flat: prefersFlat(root) })),
).flat();

const KEEP: Record<Filter, (c: Chord) => boolean> = {
  all: () => true,
  major: (c) => c.quality === "maj",
  minor: (c) => c.quality === "min",
  seventh: (c) => SEVENTHS.includes(c.quality),
  barre: (c) => voicing(c).barre !== null,
};

interface Props {
  notation: NotationKind;
  onBack: () => void;
}

export function Chords({ notation, onBack }: Props) {
  useBackButton(onBack);
  const [filter, setFilter] = useState<Filter>("all");
  const [searching, setSearching] = useState(false);
  const [q, setQ] = useState("");
  const [trying, setTrying] = useState<number | null>(null); // "Sinab koʻrish" on this chord
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (searching) input.current?.focus();
  }, [searching]);

  const chords = useMemo(() => {
    // "am" finds Am in either notation; "lya" finds it in solfège.
    const needle = q.trim().toLowerCase();
    return ALL.filter(
      (c) =>
        KEEP[filter](c) &&
        (!needle ||
          formatChord(c, notation).toLowerCase().startsWith(needle) ||
          formatChord(c, "letter").toLowerCase() === needle),
    );
  }, [filter, q, notation]);

  return (
    <Screen
      title={t.tabs.chords}
      onBack={onBack}
      right={
        <button
          type="button"
          className="icon-button"
          aria-label={t.chords.search}
          aria-expanded={searching}
          onClick={() => {
            haptic.tap();
            if (searching) setQ("");
            setSearching(!searching);
          }}
        >
          <SearchIcon />
        </button>
      }
      bodyClassName="chords-body"
    >
      <SoundStatus />

      {searching && (
        <div className="search">
          <label htmlFor="qc" className="sr-only">
            {t.chords.search}
          </label>
          <SearchIcon />
          <input
            ref={input}
            id="qc"
            type="search"
            placeholder={t.chords.searchPlaceholder}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            autoComplete="off"
          />
        </div>
      )}

      <div className="chip-row" role="group" aria-label={t.chords.filtersLabel}>
        {FILTERS.map((f) => (
          <Chip key={f} selected={filter === f} onClick={() => setFilter(f)}>
            {t.chords.filters[f]}
          </Chip>
        ))}
      </div>

      <div className="chord-grid scroll-y">
        {chords.length === 0 ? (
          <p className="chord-grid-empty muted">{t.songs.notFound}</p>
        ) : (
          chords.map((chord, i) => (
            <ChordCard
              key={`${chord.root}${chord.quality}`}
              chord={chord}
              notation={notation}
              onOpen={() => setTrying(i)}
            />
          ))
        )}
      </div>
      {trying !== null && (
        <ChordTrySheet
          chords={chords}
          start={trying}
          caption={(i) => `${i + 1} / ${chords.length}`}
          notation={notation}
          onClose={() => setTrying(null)}
        />
      )}
    </Screen>
  );
}
