// An automatically analysed song in the song player: the YouTube embed for links,
// the user's own file (<audio>, object URL) for uploads.
import { useEffect, useMemo, useState } from "react";

import { analysisTimeline, analysisTitle, localFileUrl, rememberFile } from "../analysis";
import { api, type AnalysisDetail } from "../api";
import { keyOf } from "../harmony";
import type { NotationKind } from "../notation";
import { useBackButton } from "../telegram";
import type { PresetId } from "../tuning";
import { t } from "../texts";
import { Player, PlayerLoading, defaultStrum, type PlayerLocks, type PlayerModel } from "./SongPlayer";

interface Props {
  analysisId: number;
  notation: NotationKind;
  onBack: () => void;
  onOpenTuner: (preset: PresetId) => void;
  locks: PlayerLocks;
}

export function AnalysisPlayer({ analysisId, notation, onBack, onOpenTuner, locks }: Props) {
  useBackButton(onBack);
  const [analysis, setAnalysis] = useState<AnalysisDetail | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [fileUrl, setFileUrl] = useState(() => localFileUrl(analysisId));

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    api.analyze.get(analysisId).then(
      (a) => !cancelled && setAnalysis(a),
      () => !cancelled && setFailed(true),
    );
    return () => {
      cancelled = true;
    };
  }, [analysisId, attempt]);

  const model = useMemo<PlayerModel | null>(() => {
    if (!analysis || analysis.status !== "done") return null;
    const youtube = analysis.source === "youtube" && analysis.youtube_id;
    const id = analysis.id;
    return {
      title: analysisTitle(analysis),
      artist: null, // taken from the YouTube title when it has one
      source: youtube ? "YouTube" : t.analyze.upload,
      capo: 0, // the easiest capo is only marked in the Kapo sheet, never put on by itself
      key: keyOf(analysis.key),
      tag: { label: t.analyze.auto, className: "auto" },
      note: t.analyze.autoNote,
      ...analysisTimeline(analysis),
      media: youtube ? { kind: "youtube", id: youtube } : { kind: "file", url: fileUrl },
      youtubeId: youtube || null,
      startSec: 0,
      fileName: youtube ? undefined : analysis.source_ref,
      onPickFile: (file) => setFileUrl(rememberFile(analysisId, file)),
      altTuning: analysis.alt_tuning,
      onOpenTuner,
      // Pop on the beat tracker's beats (DEFAULT_BPM without them).
      strum: defaultStrum(analysis.bpm, analysis.beats),
      storageKey: `analysis:${id}`,
      settings: analysis.settings,
      onSettings: (s) => void api.saveSettings("analysis", id, s),
      // The user's own song: fixed at once, as overrides (the cached result stays).
      editMode: "fix",
      onChordEdit: async (events, chord) => {
        const next = await api.analyze.fixEvents(id, events.map((index) => ({ index, ...chord })));
        setAnalysis(next);
        return t.edit.saved;
      },
    };
  }, [analysis, analysisId, fileUrl, onOpenTuner]);

  if (!model) {
    return <PlayerLoading failed={failed} onRetry={() => setAttempt((n) => n + 1)} onBack={onBack} />;
  }
  return (
    // A newly picked file remounts the player: fresh <audio>, loop and position.
    <Player key={fileUrl ?? "none"} model={model} notation={notation} onBack={onBack} locks={locks} />
  );
}
