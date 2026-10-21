// Foydalanuvchilar — follows docs/design/admin-users.reference.html.
import { useEffect, useState } from "react";

import { api, type AdminUserDetail, type AdminUserRow, type AdminUsers, type UserFilter } from "../api";
import { navigate } from "../router";
import { confirmDialog } from "../telegram";
import { t } from "../texts";
import { ago, displayName, formatSom, fullDate, historyLine, shortDate, userStatus } from "./format";
import { Avatar, LoadState, Receipt, useLoad } from "./ui";

export const FILTERS: UserFilter[] = ["all", "premium", "active_free", "pending", "blocked"];
const DURATIONS = [7, 30, 90, 365];
const SEARCH_DELAY_MS = 300;

/** The filter and the selected user live in the URL: #/users/12?filter=premium. */
export function usersHref(filter: UserFilter, id: number | null = null): string {
  return `#/users${id === null ? "" : `/${id}`}${filter === "all" ? "" : `?filter=${filter}`}`;
}

interface Props {
  selectedId: number | null;
  filter: UserFilter;
  onPaymentsChanged: () => void;
}

export function Users({ selectedId, filter, onPaymentsChanged }: Props) {
  const [q, setQ] = useState("");
  const [list, setList] = useState<AdminUsers | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const ctrl = new AbortController();
    setFailed(false);
    const timer = setTimeout(
      () =>
        api.admin.users(filter, q, 0, ctrl.signal).then(setList, (e) => {
          if (!ctrl.signal.aborted) setFailed(true);
          return e;
        }),
      q ? SEARCH_DELAY_MS : 0,
    );
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [filter, q, attempt]);

  const more = async () => {
    if (!list) return;
    const next = await api.admin.users(filter, q, list.items.length);
    setList({ ...next, items: [...list.items, ...next.items] });
  };

  const select = (u: AdminUserRow) => navigate(`/admin${usersHref(filter, u.id)}`);
  const changed = () => {
    setAttempt((n) => n + 1);
    onPaymentsChanged();
  };

  const revokeRow = async (u: AdminUserRow) => {
    if (!(await confirmDialog(t.panel.revokeConfirm(displayName(u))))) return;
    try {
      await api.admin.revoke(u.id);
      changed();
    } catch {
      setFailed(true);
    }
  };

  return (
    <>
      <div className="pn-head">
        <h1>{t.panel.usersTitle}</h1>
        <div className="pn-search">
          <label htmlFor="pn-user-search" className="visually-hidden">
            {t.panel.usersSearchLabel}
          </label>
          <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="11" cy="11" r="6" />
            <path d="M20 20l-4.5-4.5" />
          </svg>
          <input
            id="pn-user-search"
            type="search"
            className="pn-input"
            placeholder={t.panel.usersSearch}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
      </div>

      <div role="tablist" aria-label={t.panel.filterLabel} className="pn-tabs">
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            role="tab"
            aria-selected={f === filter}
            onClick={() => navigate(`/admin${usersHref(f, selectedId)}`)}
          >
            {t.panel.filters[f]}
            <span className="pn-tab-n">{list?.counts[f] ?? "…"}</span>
          </button>
        ))}
      </div>

      <div className="pn-row top">
        <section aria-label={t.panel.usersTitle} className="pn-card pn-table-card grow3">
          {failed && !list ? (
            <div className="pn-note">
              <p>{t.loadFailed}</p>
              <button type="button" className="pn-btn" onClick={() => setAttempt((n) => n + 1)}>
                {t.retry}
              </button>
            </div>
          ) : !list ? (
            <div className="pn-note muted">{t.loading}</div>
          ) : list.items.length === 0 ? (
            <div className="pn-note muted">{t.panel.noUsers}</div>
          ) : (
            <>
              <table className="pn-table">
                <thead>
                  <tr>
                    <th scope="col">{t.panel.cols.user}</th>
                    <th scope="col">{t.panel.cols.joined}</th>
                    <th scope="col">{t.panel.cols.seen}</th>
                    <th scope="col">{t.panel.cols.status}</th>
                    <th scope="col" className="right">
                      {t.panel.cols.action}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {list.items.map((u) => (
                    <UserRow
                      key={u.id}
                      u={u}
                      selected={u.id === selectedId}
                      onSelect={() => select(u)}
                      onRevoke={() => void revokeRow(u)}
                    />
                  ))}
                </tbody>
              </table>
              {list.items.length < list.total && (
                <button type="button" className="pn-btn pn-more" onClick={() => void more()}>
                  {t.panel.more}
                </button>
              )}
            </>
          )}
        </section>

        <section aria-label={t.panel.cols.user} className="pn-card grow1 pn-detail">
          {selectedId === null ? (
            <p className="muted pn-empty">{t.panel.pickUser}</p>
          ) : (
            <UserDetail key={selectedId} id={selectedId} onChanged={changed} />
          )}
        </section>
      </div>
    </>
  );
}

function UserRow({
  u,
  selected,
  onSelect,
  onRevoke,
}: {
  u: AdminUserRow;
  selected: boolean;
  onSelect: () => void;
  onRevoke: () => void;
}) {
  const status = userStatus(u);
  const a = t.panel.actions;
  let action;
  if (u.pending_payment) {
    action = (
      <button type="button" className="pn-btn small primary" onClick={onSelect}>
        {a.review}
      </button>
    );
  } else if (u.has_premium) {
    action = (
      <button type="button" className="pn-btn small danger" onClick={onRevoke}>
        {a.revoke}
      </button>
    );
  } else {
    action = (
      <button type="button" className="pn-btn small soft-outline" onClick={onSelect}>
        {a.grant}
      </button>
    );
  }
  return (
    <tr className={selected ? "selected" : ""}>
      <td>
        <button type="button" className="pn-user-cell" onClick={onSelect}>
          <Avatar user={u} />
          <span className="pn-stack">
            <span className="pn-strong">{displayName(u)}</span>
            <span className="pn-meta">{u.username ? `@${u.username}` : "—"}</span>
          </span>
        </button>
      </td>
      <td className="muted">{shortDate(u.created_at)}</td>
      <td className="muted">{ago(u.last_seen_at)}</td>
      <td>
        <span className={`pn-pill ${status.tone}`}>{status.label}</span>
      </td>
      <td className="right">{action}</td>
    </tr>
  );
}

function UserDetail({ id, onChanged }: { id: number; onChanged: () => void }) {
  const state = useLoad(() => api.admin.user(id), [id]);
  const [detail, setDetail] = useState<AdminUserDetail | null>(null);
  useEffect(() => setDetail(state.data), [state.data]);

  return (
    <LoadState state={state}>
      {() => (detail ? <DetailBody d={detail} onUpdate={(d) => { setDetail(d); onChanged(); }} /> : null)}
    </LoadState>
  );
}

function DetailBody({ d, onUpdate }: { d: AdminUserDetail; onUpdate: (d: AdminUserDetail) => void }) {
  const u = d.user;
  const pending = d.pending;
  const [days, setDays] = useState<number | null>(pending?.days ?? 30);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => setDays(pending?.days ?? 30), [pending?.id, pending?.days]);

  const run = async (call: () => Promise<AdminUserDetail>) => {
    setBusy(true);
    setFailed(false);
    try {
      onUpdate(await call());
      setNote("");
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  const status = userStatus(u);
  return (
    <>
      <div className="pn-detail-head">
        <Avatar user={u} size={48} />
        <div className="pn-stack">
          <span className="pn-detail-name">{displayName(u)}</span>
          <span className="pn-meta">
            {u.username ? `@${u.username} · ` : ""}ID {u.telegram_id}
          </span>
        </div>
      </div>
      <span className={`pn-pill ${status.tone} self-start`}>{status.label}</span>

      <div className="pn-mini-stats">
        <div>
          <span className="pn-mono-n">{d.stats.active_days}</span>
          <span className="pn-meta">{t.panel.stats.days}</span>
        </div>
        <div>
          <span className="pn-mono-n">{d.stats.songs}</span>
          <span className="pn-meta">{t.panel.stats.songs}</span>
        </div>
        <div>
          <span className="pn-mono-n">{d.stats.analyses}</span>
          <span className="pn-meta">{t.panel.stats.analyses}</span>
        </div>
      </div>

      {pending && (
        <div className="pn-pending-box">
          <span className="pn-strong">{t.panel.pendingBox}</span>
          <span className="pn-pending-meta">
            {t.panel.pendingMeta(pending.days, formatSom(pending.amount), ago(pending.created_at))}
          </span>
          <Receipt paymentId={pending.id} className="pn-receipt" />
        </div>
      )}

      <fieldset className="pn-fieldset">
        <legend>{t.panel.duration}</legend>
        <div className="pn-durations">
          {DURATIONS.map((n) => (
            <button
              key={n}
              type="button"
              aria-pressed={days === n}
              className="pn-choice"
              onClick={() => setDays(n)}
            >
              {t.panel.durations[n]}
            </button>
          ))}
          {!pending && (
            <button
              type="button"
              aria-pressed={days === null}
              className="pn-choice"
              onClick={() => setDays(null)}
            >
              {t.panel.forever}
            </button>
          )}
        </div>
      </fieldset>

      <label htmlFor="pn-note" className="pn-strong">
        {t.panel.note}
      </label>
      <textarea
        id="pn-note"
        rows={2}
        className="pn-input pn-textarea"
        placeholder={t.panel.notePlaceholder}
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />

      {pending ? (
        <div className="pn-actions">
          <button
            type="button"
            className="pn-btn big success grow"
            disabled={busy}
            onClick={() => void run(() => api.admin.approve(pending.id, days, note))}
          >
            {t.panel.approve}
          </button>
          <button
            type="button"
            className="pn-btn big danger"
            disabled={busy}
            onClick={() => void run(() => api.admin.reject(pending.id, note))}
          >
            {t.panel.reject}
          </button>
        </div>
      ) : (
        <div className="pn-actions">
          <button
            type="button"
            className="pn-btn big primary grow"
            disabled={busy}
            onClick={() => void run(() => api.admin.grant(u.id, days, note))}
          >
            {t.panel.grant}
          </button>
          {u.has_premium && (
            <button
              type="button"
              className="pn-btn big danger"
              disabled={busy}
              onClick={async () => {
                if (await confirmDialog(t.panel.revokeConfirm(displayName(u)))) {
                  void run(() => api.admin.revoke(u.id));
                }
              }}
            >
              {t.panel.revoke}
            </button>
          )}
        </div>
      )}
      {failed && (
        <p className="pn-error" role="alert">
          {t.panel.failed}
        </p>
      )}
      <span className="pn-meta">{t.panel.botNotice}</span>

      <div className="pn-history">
        <span className="pn-strong">{t.panel.history}</span>
        {d.history.length === 0 ? (
          <span className="pn-meta">{t.panel.noHistory}</span>
        ) : (
          d.history.map((h, i) => (
            <span key={i} className="pn-meta" title={fullDate(h.created_at)}>
              {shortDate(h.created_at)} · {historyLine(h)}
              {h.note ? ` — ${h.note}` : ""}
            </span>
          ))
        )}
      </div>
    </>
  );
}
