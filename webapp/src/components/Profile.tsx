import type { Me, Settings } from "../api";
import { haptic } from "../telegram";
import { t } from "../texts";
import { NotationToggle } from "./NotationToggle";

interface Props {
  me: Me;
  onChange: (patch: Partial<Settings>) => void;
}

export function Profile({ me, onChange }: Props) {
  const name = [me.first_name, me.last_name].filter(Boolean).join(" ");

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
    </div>
  );
}
