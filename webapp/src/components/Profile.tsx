import { useEffect, useState } from "react";

import { api, type EarProgress, type Me, type Settings } from "../api";
import { navigate } from "../router";
import { haptic } from "../telegram";
import { t } from "../texts";
import { NotationToggle } from "./NotationToggle";
import { PremiumSheet } from "./PremiumSheet";
import { Screen } from "./Screen";

interface Props {
  me: Me;
  onChange: (patch: Partial<Settings>) => void;
  onResumeEar: (runId: string) => void;
}

function untilText(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
}

export function Profile({ me, onChange, onResumeEar }: Props) {
  const name = [me.first_name, me.last_name].filter(Boolean).join(" ");
  const [sheet, setSheet] = useState(false);
  const [ear, setEar] = useState<EarProgress | null>(null);

  useEffect(() => {
    api.ear.progress().then(setEar, () => {});
  }, []);
  const active = ear?.active_run ?? null;

  return (
    <Screen title={t.tabs.profile} bodyClassName="scroll-y padded">
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

      <div className="card">
        <div className="card-row">
          <span>
            <span className="card-label">{t.premium.title}</span>
            <span className="muted small">
              {me.is_premium ? t.premium.active(untilText(me.premium_until)) : t.premium.free}
            </span>
          </span>
          {!me.is_premium && (
            <button type="button" className="button small-button" onClick={() => setSheet(true)}>
              {t.premium.get}
            </button>
          )}
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

      {sheet && <PremiumSheet onClose={() => setSheet(false)} />}
    </Screen>
  );
}
