// An automatically analysed song in the song player: the YouTube embed for links,
// the user's own file (<audio>, object URL) for uploads.
import { useEffect, useMemo, useState } from "react";

import { analysisTimeline, analysisTitle, localFileUrl, rememberFile } from "../analysis";
import { api, type AnalysisDetail } from "../api";
import type { NotationKind } from "../notation";
import { useBackButton } from "../telegram";
import { t } from "../texts";
import { BrowserBack, Player, PlayerLoading, type PlayerModel } from "./SongPlayer";

interface Props {
  analysisId: number;
  notation: NotationKind;
  onBack: () => void;
}

export function AnalysisPlayer({ analysisId, notation, onBack }: Props) {
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
    return {
      title: analysisTitle(analysis),
      subtitle: youtube ? "YouTube" : t.analyze.upload,
      key: analysis.key,
      capo: 0,
      tag: { label: t.analyze.auto, className: "auto" },
      note: t.analyze.autoNote,
      ...analysisTimeline(analysis),
      media: youtube ? { kind: "youtube", id: youtube } : { kind: "file", url: fileUrl },
      youtubeId: youtube || null,
      startSec: 0,
      fileName: youtube ? undefined : analysis.source_ref,
      onPickFile: (file) => setFileUrl(rememberFile(analysisId, file)),
    };
  }, [analysis, analysisId, fileUrl]);

  if (!model) {
    return <PlayerLoading failed={failed} onRetry={() => setAttempt((n) => n + 1)} />;
  }
  return (
    <>
      <BrowserBack onBack={onBack} />
      {/* A newly picked file remounts the player: fresh <audio>, loop and position. */}
      <Player key={fileUrl ?? "none"} model={model} notation={notation} />
    </>
  );
}
