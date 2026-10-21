import { useState } from "react";

import type { Me, Settings } from "../api";
import { navigate } from "../router";
import { haptic } from "../telegram";
import { t } from "../texts";
import { NotationToggle } from "./NotationToggle";
import { PremiumSheet } from "./PremiumSheet";

interface Props {
  me: Me;
  onChange: (patch: Partial<Settings>) => void;
}

function untilText(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
}

export function Profile({ me, onChange }: Props) {
  const name = [me.first_name, me.last_name].filter(Boolean).join(" ");
  const [sheet, setSheet] = useState(false);

  return (
    <div className="page">
      <header className="page-header">
        <h1>{t.tabs.profile}</h1>
      </header>

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
    </div>
  );
}
