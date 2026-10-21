// Panel — follows docs/design/admin-dashboard.reference.html.
import { useEffect, useRef, useState } from "react";

import { api, type AdminPayment, type AdminStats, type Period } from "../api";
import { confirmDialog } from "../telegram";
import { t } from "../texts";
import { ago, displayName, formatAmount, formatSom, monthName, monthTitle, percent, shortDate } from "./format";
import { Avatar, LoadState, PanelLink, ReceiptModal, useLoad } from "./ui";

const PERIODS: Period[] = ["today", "7d", "30d"];
const BAR_MAX_PX = 140;

interface Props {
  scrollToRequests: boolean;
  onPaymentsChanged: () => void;
}

export function Dashboard({ scrollToRequests, onPaymentsChanged }: Props) {
  const [period, setPeriod] = useState<Period>("7d");
  const stats = useLoad(() => api.admin.stats(period), [period]);
  const requestsRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (scrollToRequests && stats.data) requestsRef.current?.scrollIntoView({ block: "start" });
  }, [scrollToRequests, stats.data]);

  const now = new Date();
  return (
    <>
      <div className="pn-head">
        <div className="pn-head-title">
          <h1>{t.panel.nav.dashboard}</h1>
          <span className="muted">{monthTitle(now)}</span>
        </div>
        <div role="group" aria-label={t.panel.period} className="pn-seg">
          {PERIODS.map((p) => (
            <button key={p} type="button" aria-pressed={p === period} onClick={() => setPeriod(p)}>
              {t.panel.periods[p]}
            </button>
          ))}
        </div>
      </div>

      <LoadState state={stats}>
        {(s) => (
          <>
            <Kpis s={s} />
            <div className="pn-row">
              <NewUsers s={s} />
              <Pending
                s={s}
                onDecided={() => {
                  stats.reload();
                  onPaymentsChanged();
                }}
              />
            </div>
            <div className="pn-row">
              <Funnel s={s} />
              <Requests s={s} sectionRef={requestsRef} />
            </div>
          </>
        )}
      </LoadState>
    </>
  );
}

function Kpis({ s }: { s: AdminStats }) {
  const k = t.panel.kpi;
  const period = t.panel.periodShort[s.period];
  const tiles = [
    { label: k.total, value: s.users_total, sub: k.totalSub(s.users_new, period) },
    { label: k.premium, value: s.premium, sub: k.premiumSub(percent(s.premium, s.users_total)) },
    { label: k.active(period), value: s.active, sub: k.activeSub },
    { label: k.activeFree, value: s.active_free, sub: k.activeFreeSub, accent: true },
    { label: k.revenue(monthName(new Date())), value: s.revenue_month, sub: k.revenueSub },
  ];
  return (
    <section aria-label="Asosiy koʻrsatkichlar" className="pn-kpis">
      {tiles.map((tile) => (
        <div key={tile.label} className={`pn-kpi${tile.accent ? " accent" : ""}`}>
          <span className="pn-kpi-label">{tile.label}</span>
          <span className="pn-kpi-value">{formatAmount(tile.value)}</span>
          <span className="pn-kpi-sub">{tile.sub}</span>
        </div>
      ))}
    </section>
  );
}

function NewUsers({ s }: { s: AdminStats }) {
  const max = Math.max(1, ...s.new_by_day.map((d) => d.count));
  const total = s.new_by_day.reduce((a, d) => a + d.count, 0);
  const last = s.new_by_day.length - 1;
  return (
    <section aria-label={t.panel.newUsers} className="pn-card grow3">
      <div className="pn-card-head">
        <h2>{t.panel.newUsers}</h2>
        <span className="muted small-inline">{t.panel.newTotal(total)}</span>
      </div>
      <div role="img" aria-label={t.panel.newUsersChart} className="pn-bars">
        {s.new_by_day.map((d, i) => {
          const label = i === last || (d.count === max && d.count > 0) ? String(d.count) : "";
          const day = new Date(`${d.day}T12:00:00`);
          return (
            <div key={d.day} className="pn-bar-col" title={t.panel.newUsersTip(shortDate(day), d.count)}>
              <span className="pn-bar-value">{label}</span>
              <div className="pn-bar" style={{ height: Math.round((d.count / max) * BAR_MAX_PX) }} />
            </div>
          );
        })}
      </div>
      <div className="pn-bar-days">
        {s.new_by_day.map((d) => (
          <span key={d.day}>{Number(d.day.slice(8))}</span>
        ))}
      </div>
    </section>
  );
}

function Pending({ s, onDecided }: { s: AdminStats; onDecided: () => void }) {
  const [receipt, setReceipt] = useState<number | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);

  const decide = async (p: AdminPayment, approve: boolean) => {
    const name = displayName(p.user);
    if (!approve && !(await confirmDialog(`${t.panel.rejectAria(name)}?`))) return;
    setBusy(p.id);
    setFailed(false);
    try {
      if (approve) await api.admin.approve(p.id, null, "");
      else await api.admin.reject(p.id, "");
      onDecided();
    } catch {
      setFailed(true);
    } finally {
      setBusy(null);
    }
  };

  return (
    <section aria-label={t.panel.pendingTitle} className="pn-card grow2">
      <div className="pn-card-head">
        <h2>
          {t.panel.pendingTitle}
          {s.pending_count > 0 && <span className="pn-count">{s.pending_count}</span>}
        </h2>
        <PanelLink to="#/users?filter=pending" className="pn-link">
          {t.panel.all}
        </PanelLink>
      </div>
      {s.pending.length === 0 ? (
        <p className="muted pn-empty">{t.panel.noPending}</p>
      ) : (
        s.pending.map((p) => {
          const name = displayName(p.user);
          return (
            <div key={p.id} className="pn-pay">
              <PanelLink to={`#/users/${p.user.id}`} className="pn-pay-who">
                <Avatar user={p.user} size={40} />
                <span className="pn-stack">
                  <span className="pn-strong">{name}</span>
                  <span className="pn-meta">
                    {t.premium.plans[p.plan] ?? `${p.days} kun`} · {formatSom(p.amount)} · {ago(p.created_at)}
                  </span>
                </span>
              </PanelLink>
              <button type="button" className="pn-btn small" onClick={() => setReceipt(p.id)}>
                {t.panel.receipt}
              </button>
              <button
                type="button"
                className="pn-icon-btn ok"
                aria-label={t.panel.approveAria(name)}
                disabled={busy === p.id}
                onClick={() => void decide(p, true)}
              >
                <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12l5 5 9-10" />
                </svg>
              </button>
              <button
                type="button"
                className="pn-icon-btn no"
                aria-label={t.panel.rejectAria(name)}
                disabled={busy === p.id}
                onClick={() => void decide(p, false)}
              >
                <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>
          );
        })
      )}
      {failed && (
        <p className="pn-error" role="alert">
          {t.panel.failed}
        </p>
      )}
      {receipt !== null && <ReceiptModal paymentId={receipt} onClose={() => setReceipt(null)} />}
    </section>
  );
}

function Funnel({ s }: { s: AdminStats }) {
  const top = s.funnel[0]?.users ?? 0;
  return (
    <section aria-label={t.panel.funnel(t.panel.periodShort[s.period])} className="pn-card grow3">
      <div className="pn-stack">
        <h2>{t.panel.funnel(t.panel.periodShort[s.period])}</h2>
        <span className="muted small-inline">{t.panel.funnelHint}</span>
      </div>
      {s.funnel.map((f) => {
        const pct = top ? Math.max(1, Math.round((f.users / top) * 100)) : 0;
        return (
          <div key={f.step} className="pn-funnel-row">
            <span>{t.panel.funnelSteps[f.step]}</span>
            <div className="pn-funnel-track">
              <div className="pn-funnel-fill" style={{ width: `${pct}%` }} />
            </div>
            <span className="pn-funnel-n">
              {formatAmount(f.users)} <span className="muted">· {percent(f.users, top)}</span>
            </span>
          </div>
        );
      })}
    </section>
  );
}

function Requests({ s, sectionRef }: { s: AdminStats; sectionRef: React.RefObject<HTMLElement | null> }) {
  return (
    <section ref={sectionRef} aria-label={t.panel.requestsTitle} className="pn-card grow2 pn-anchor">
      <div className="pn-stack">
        <h2>{t.panel.requestsTitle}</h2>
        <span className="muted small-inline">{t.panel.requestsHint}</span>
      </div>
      {s.requests.length === 0 ? (
        <p className="muted pn-empty">{t.panel.noRequests}</p>
      ) : (
        s.requests.map((r) => {
          const q = new URLSearchParams();
          if (r.youtube_id) q.set("yt", r.youtube_id);
          q.set("title", r.title);
          return (
            <div key={`${r.youtube_id ?? ""}:${r.title}`} className="pn-request">
              <span className="pn-request-n">{r.users}×</span>
              <span className="pn-stack grow">
                <span className="pn-strong">{r.title}</span>
                <span className="pn-meta">{t.panel.requestSource(r.searches, r.analyses)}</span>
              </span>
              <PanelLink to={`#/songs/new?${q}`} className="pn-btn soft small">
                {t.panel.add}
              </PanelLink>
            </div>
          );
        })
      )}
    </section>
  );
}
