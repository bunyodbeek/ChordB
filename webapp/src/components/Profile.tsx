import { useEffect, useState } from "react";

import { api, type EarProgress, type Me, type Settings, type StrumProgress } from "../api";
import { navigate } from "../router";
import { haptic } from "../telegram";
import { t } from "../texts";
import { NotationToggle } from "./NotationToggle";
import { Screen } from "./Screen";
import { PrimaryButton } from "./ui";

interface Props {
  me: Me;
  onChange: (patch: Partial<Settings>) => void;
  onResumeEar: (runId: string) => void;
  onPremium: () => void;
}

function untilText(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
}

export function Profile({ me, onChange, onResumeEar, onPremium }: Props) {
  const name = [me.first_name, me.last_name].filter(Boolean).join(" ");
  const [ear, setEar] = useState<EarProgress | null>(null);
  const [strum, setStrum] = useState<StrumProgress | null>(null);

  useEffect(() => {
    api.ear.progress().then(setEar, () => {});
    api.strum.progress().then(setStrum, () => {});
  }, []);
  const active = ear?.active_run ?? null;

  return (
    <Screen title={t.tabs.profile} bodyClassName="scroll-y padded">
      {/* The plan first: what the user has, and the way to more. */}
      <div className={`plan-status${me.is_premium ? " on" : ""}`}>
        <span className="plan-status-text">
          <span className="plan-status-title">{me.is_premium ? t.premium.title : t.premium.statusFree}</span>
          <span className="plan-status-sub">
            {me.is_premium ? t.premium.active(untilText(me.premium_until)) : t.premium.statusFreeSub}
          </span>
        </span>
        {!me.is_premium && (
          <PrimaryButton
            className="plan-status-get"
            onClick={() => {
              haptic.tap();
              onPremium();
            }}
          >
            {t.premium.get}
          </PrimaryButton>
        )}
      </div>

      <div className="card profile-card">
        {me.photo_url ? (
          <img className="avatar" src={me.photo_url} alt="" />
        ) : (
          <div className="avatar">{me.first_name.slice(0, 1).toUpperCase()}</div>
        )}
        <div>
          <div className="profile-name">{name}</div>
          {me.username && <div className="muted">@{me.username}</div>}
        </div>
      </div>

      {ear && (
        <div className="card" aria-label={t.practice.stats}>
          <div className="card-row">
            <span className="card-label">{t.practice.earLevel}</span>
            <span className="profile-stat">{t.practice.levelShort(ear.max_unlocked_level, ear.level_count)}</span>
          </div>
          <div className="card-row">
            <span className="card-label">{t.practice.perfectRuns}</span>
            <span className="profile-stat">{ear.perfect_runs}</span>
          </div>
          {strum && (
            <>
              <div className="card-row">
                <span className="card-label">{t.practice.strumMastered}</span>
                <span className="profile-stat">
                  {strum.mastered}/{strum.patterns.length}
                </span>
              </div>
              <div className="card-row">
                <span className="card-label">{t.practice.strumTopBpm}</span>
                <span className="profile-stat">{strum.top_bpm ? t.practice.bpm(strum.top_bpm) : "—"}</span>
              </div>
            </>
          )}
          {active && (
            <div className="card-row">
              <span className="muted small">{t.practice.unfinishedRun(active.level, active.answered)}</span>
              <button
                type="button"
                className="button small-button"
                onClick={() => {
                  haptic.tap();
                  onResumeEar(active.run_id);
                }}
              >
                {t.practice.resume}
              </button>
            </div>
          )}
        </div>
      )}

      <div className="card">
        <div className="card-row">
          <span className="card-label">{t.notation}</span>
          <NotationToggle
            value={me.settings.notation ?? "letter"}
            onChange={(notation) => onChange({ notation })}
          />
        </div>
        <label className="card-row">
          <span>
            <span className="card-label">{t.notifications}</span>
            <span className="muted small">{t.notificationsHint}</span>
          </span>
          <input
            type="checkbox"
            className="switch"
            checked={me.settings.notifications_enabled}
            onChange={(e) => {
              haptic.tap();
              onChange({ notifications_enabled: e.target.checked });
            }}
          />
        </label>
      </div>

      {me.is_admin && (
        <button type="button" className="button wide secondary" onClick={() => navigate("/admin")}>
          📊 {t.adminPanel}
        </button>
      )}

    </Screen>
  );
}
