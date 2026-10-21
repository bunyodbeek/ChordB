// Small pieces shared by the admin panel's pages.
import { useCallback, useEffect, useState, type ReactNode } from "react";

import { api, type UserBrief } from "../api";
import { navigate } from "../router";
import { t } from "../texts";
import { initials } from "./format";

/** In-panel link (`to` = "#/users/12"): no reload, so Telegram's initData stays. */
export function PanelLink({ to, className, children }: { to: string; className?: string; children: ReactNode }) {
  return (
    <a
      href={`/admin${to}`}
      className={className}
      onClick={(e) => {
        e.preventDefault();
        navigate(`/admin${to}`);
      }}
    >
      {children}
    </a>
  );
}

export function Avatar({ user, size = 36 }: { user: UserBrief; size?: number }) {
  const [broken, setBroken] = useState(false);
  const style = { width: size, height: size, fontSize: Math.round(size * 0.36) };
  if (user.photo_url && !broken) {
    return (
      <img className="pn-avatar" style={style} src={user.photo_url} alt="" onError={() => setBroken(true)} />
    );
  }
  return (
    <span className="pn-avatar" style={style} aria-hidden="true">
      {initials(user)}
    </span>
  );
}

/** The receipt image; it needs the auth header, so it is fetched as a blob. */
export function Receipt({ paymentId, className }: { paymentId: number; className?: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let made: string | null = null;
    setUrl(null);
    setFailed(false);
    api.admin.receipt(paymentId).then(
      (u) => {
        made = u;
        if (cancelled) URL.revokeObjectURL(u);
        else setUrl(u);
      },
      () => !cancelled && setFailed(true),
    );
    return () => {
      cancelled = true;
      if (made) URL.revokeObjectURL(made);
    };
  }, [paymentId]);

  if (failed) return <div className={`pn-receipt-note ${className ?? ""}`}>{t.panel.receiptFailed}</div>;
  if (!url) return <div className={`pn-receipt-note ${className ?? ""}`}>{t.loading}</div>;
  return (
    <a href={url} target="_blank" rel="noreferrer" className={className}>
      <img className="pn-receipt-img" src={url} alt={t.panel.receiptAlt} />
    </a>
  );
}

export function ReceiptModal({ paymentId, onClose }: { paymentId: number; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="pn-modal" onClick={onClose}>
      <div
        className="pn-modal-body"
        role="dialog"
        aria-modal="true"
        aria-label={t.panel.receiptAlt}
        onClick={(e) => e.stopPropagation()}
      >
        <Receipt paymentId={paymentId} />
        <button type="button" className="pn-btn" onClick={onClose}>
          {t.premium.close}
        </button>
      </div>
    </div>
  );
}

export type Loaded<T> = { data: T | null; failed: boolean; reload: () => void };

/** Fetch on mount and whenever `deps` change; reload() fetches again, keeping old data shown. */
export function useLoad<T>(load: () => Promise<T>, deps: unknown[]): Loaded<T> {
  const [data, setData] = useState<T | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    load().then(
      (d) => !cancelled && setData(d),
      () => !cancelled && setFailed(true),
    );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, attempt]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  return { data, failed, reload };
}

/** Loading / failed placeholder for a section; renders children once there is data. */
export function LoadState<T>({
  state,
  children,
}: {
  state: Loaded<T>;
  children: (data: T) => ReactNode;
}) {
  if (state.data !== null) return <>{children(state.data)}</>;
  if (state.failed) {
    return (
      <div className="pn-note">
        <p>{t.loadFailed}</p>
        <button type="button" className="pn-btn" onClick={state.reload}>
          {t.retry}
        </button>
      </div>
    );
  }
  return <div className="pn-note muted">{t.loading}</div>;
}
