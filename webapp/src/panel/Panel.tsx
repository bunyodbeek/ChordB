// Admin panel (/admin) — follows docs/design/admin-*.reference.html. Opened from the bot's
// /admin command, best in Telegram Desktop; the same initData auth as the Mini App.
import { useCallback, useEffect, useState, type ReactNode } from "react";

import { api, type Me } from "../api";
import { ChordEditor } from "../components/admin/ChordEditor";
import { navigate, parseHash, useHash } from "../router";
import { hideSplash } from "../splash";
import { getInitData, requestFullscreen } from "../telegram";
import { t } from "../texts";
import { Dashboard } from "./Dashboard";
import "./panel.css";
import { SongPage } from "./SongPage";
import { SongsPage } from "./SongsPage";
import { FILTERS, Users } from "./Users";

type NavId = "dashboard" | "payments" | "users" | "songs" | "requests";

export default function Panel() {
  const [me, setMe] = useState<Me | null | "denied" | "failed">(null);
  const [pending, setPending] = useState(0);

  useEffect(() => {
    requestFullscreen();
    if (!getInitData()) {
      void hideSplash().then(() => setMe("denied"));
      return;
    }
    api.me().then(
      async (m) => {
        await hideSplash();
        setMe(m.is_admin ? m : "denied");
      },
      async () => {
        await hideSplash();
        setMe("failed");
      },
    );
  }, []);

  // The sidebar badge; pages call this after deciding a payment.
  const refreshPending = useCallback(() => {
    api.admin.payments().then(
      (p) => setPending(p.length),
      () => {},
    );
  }, []);
  useEffect(() => {
    if (me && typeof me === "object") refreshPending();
  }, [me, refreshPending]);

  if (me === null) return <div className="center muted">{t.loading}</div>;
  if (me === "denied" || me === "failed") {
    return (
      <div className="center">
        <p className="message">{me === "denied" ? t.panel.denied : t.loadFailed}</p>
        <button type="button" className="button" onClick={() => navigate("/")}>
          {t.panel.toApp}
        </button>
      </div>
    );
  }
  return <Shell me={me} pending={pending} onPaymentsChanged={refreshPending} />;
}

function Shell({ me, pending, onPaymentsChanged }: { me: Me; pending: number; onPaymentsChanged: () => void }) {
  const { parts, query } = parseHash(useHash());
  const notation = me.settings.notation ?? "letter";

  let active: NavId = "dashboard";
  let page: ReactNode;
  switch (parts[0]) {
    case "users": {
      const filter = FILTERS.find((f) => f === query.get("filter")) ?? "all";
      active = filter === "pending" ? "payments" : "users";
      page = (
        <Users
          selectedId={parts[1] ? Number(parts[1]) : null}
          filter={filter}
          onPaymentsChanged={onPaymentsChanged}
        />
      );
      break;
    }
    case "songs":
      active = "songs";
      if (!parts[1]) page = <SongsPage notation={notation} />;
      else if (parts[2] === "editor") {
        const id = Number(parts[1]);
        page = (
          <div className="pn-editor">
            <ChordEditor key={id} songId={id} notation={notation} onBack={() => navigate(`/admin#/songs/${id}`)} />
          </div>
        );
      } else {
        const id = parts[1] === "new" ? null : Number(parts[1]);
        page = (
          <SongPage
            key={parts[1] + query.toString()}
            songId={id}
            notation={notation}
            prefill={{ youtube: query.get("yt"), title: query.get("title") }}
          />
        );
      }
      break;
    default:
      active = parts[0] === "requests" ? "requests" : "dashboard";
      page = (
        <Dashboard
          scrollToRequests={parts[0] === "requests"}
          onPaymentsChanged={onPaymentsChanged}
        />
      );
  }

  return (
    <div className="pn-root">
      <aside className="pn-side">
        <div className="pn-brand">
          <Logo />
          <div>
            <span className="pn-brand-name">ChordB</span>
            <span className="pn-brand-sub">{t.adminPanel}</span>
          </div>
        </div>
        <nav aria-label={t.panel.navLabel} className="pn-nav">
          <NavLink id="dashboard" active={active} href="#/" icon={<IconGrid />} />
          <NavLink
            id="payments"
            active={active}
            href="#/users?filter=pending"
            icon={<IconCard />}
            badge={pending}
          />
          <NavLink id="users" active={active} href="#/users" icon={<IconUsers />} />
          <NavLink id="songs" active={active} href="#/songs" icon={<IconNote />} />
          <NavLink id="requests" active={active} href="#/requests" icon={<IconSearch />} />
        </nav>
        <button type="button" className="pn-to-app" onClick={() => navigate("/")}>
          {t.panel.toApp}
        </button>
      </aside>
      <main className="pn-main">{page}</main>
    </div>
  );
}

function NavLink({
  id,
  active,
  href,
  icon,
  badge = 0,
}: {
  id: NavId;
  active: NavId;
  href: string;
  icon: ReactNode;
  badge?: number;
}) {
  return (
    <a
      href={`/admin${href}`}
      className="pn-nav-link"
      aria-current={id === active ? "page" : undefined}
      onClick={(e) => {
        e.preventDefault();
        navigate(`/admin${href}`);
        window.scrollTo(0, 0);
      }}
    >
      {icon}
      <span className="pn-nav-label">{t.panel.nav[id]}</span>
      {badge > 0 && <span className="pn-badge">{badge}</span>}
    </a>
  );
}

function Logo() {
  return (
    <svg role="img" aria-label="ChordB" width="32" height="32" viewBox="0 0 100 100">
      <defs>
        <clipPath id="pn-logo">
          <path d="M85.36 85.36A50 50 0 1 1 85.36 14.64L64.14 35.86A20 20 0 1 0 64.14 64.14Z" />
        </clipPath>
      </defs>
      <g clipPath="url(#pn-logo)">
        <rect x="0" y="0" width="100" height="11.9" fill="var(--blue)" />
        <rect x="0" y="17.7" width="100" height="11.7" fill="var(--blue)" />
        <rect x="0" y="35.2" width="100" height="11.9" fill="var(--blue)" />
        <rect x="0" y="52.9" width="100" height="47.1" fill="var(--text)" />
      </g>
    </svg>
  );
}

const iconProps = {
  "aria-hidden": true,
  width: 18,
  height: 18,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.9,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

const IconGrid = () => (
  <svg {...iconProps}>
    <rect x="4" y="4" width="7" height="7" rx="1.5" />
    <rect x="13" y="4" width="7" height="7" rx="1.5" />
    <rect x="4" y="13" width="7" height="7" rx="1.5" />
    <rect x="13" y="13" width="7" height="7" rx="1.5" />
  </svg>
);
const IconCard = () => (
  <svg {...iconProps}>
    <rect x="3" y="6" width="18" height="13" rx="2" />
    <path d="M3 10h18" />
  </svg>
);
const IconUsers = () => (
  <svg {...iconProps}>
    <circle cx="9" cy="8" r="3.5" />
    <path d="M2.5 20c1-3.3 3.6-5 6.5-5s5.5 1.7 6.5 5" />
    <path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 15c2 .6 3.2 2.3 3.6 5" />
  </svg>
);
const IconNote = () => (
  <svg {...iconProps}>
    <path d="M9 18V6l10-2v12" />
    <circle cx="7" cy="18" r="2" />
    <circle cx="17" cy="16" r="2" />
  </svg>
);
const IconSearch = () => (
  <svg {...iconProps}>
    <circle cx="11" cy="11" r="6" />
    <path d="M20 20l-4.5-4.5" />
  </svg>
);
