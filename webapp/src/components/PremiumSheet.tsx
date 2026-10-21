// Buying premium: pick a plan, pay to the card, upload the receipt; an admin approves it
// in the admin panel and the bot tells the user. Opened from a locked song or the profile.
import { useEffect, useRef, useState } from "react";

import { api, errorCode, type PaymentInfo, type Plan, type SongSummary } from "../api";
import { formatSom } from "../panel/format";
import { copyText, haptic } from "../telegram";
import { t } from "../texts";

interface Props {
  song?: SongSummary; // the locked song that opened the sheet
  onClose: () => void;
}

export function PremiumSheet({ song, onClose }: Props) {
  const [info, setInfo] = useState<PaymentInfo | null>(null);
  const [failed, setFailed] = useState(false);
  const [plan, setPlan] = useState<Plan["id"]>("month");
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void api.event("premium_viewed");
    api.payments.info().then(setInfo, () => setFailed(true));
  }, []);

  const send = async () => {
    if (!file) return;
    setError(null);
    setProgress(0);
    try {
      const payment = await api.payments.create(plan, file, setProgress);
      haptic.success();
      setInfo((i) => (i ? { ...i, latest: payment } : i));
    } catch (e) {
      const code = errorCode(e);
      setError(t.premium.errors[code ?? ""] ?? t.premium.errors.generic);
    } finally {
      setProgress(null);
    }
  };

  const latest = info?.latest ?? null;
  let body;
  if (failed) {
    body = <p className="muted">{t.loadFailed}</p>;
  } else if (!info) {
    body = <p className="muted">{t.loading}</p>;
  } else if (latest?.status === "pending") {
    body = (
      <div className="premium-pending">
        <span className="premium-pending-title">⏳ {t.premium.pendingTitle}</span>
        <p className="muted">{t.premium.pendingText}</p>
      </div>
    );
  } else if (!info.card) {
    body = <p className="muted">{t.premium.soon}</p>;
  } else {
    body = (
      <>
        {latest?.status === "rejected" && (
          <p className="premium-rejected">
            {t.premium.rejected}
            {latest.note && (
              <>
                <br />
                {t.premium.reason(latest.note)}
              </>
            )}
          </p>
        )}
        <div className="premium-plans" role="radiogroup">
          {info.plans.map((p) => (
            <button
              key={p.id}
              type="button"
              role="radio"
              aria-checked={plan === p.id}
              className="premium-plan"
              onClick={() => setPlan(p.id)}
            >
              <span className="premium-plan-name">{t.premium.plans[p.id] ?? `${p.days} kun`}</span>
              <span className="premium-plan-price">{formatSom(p.price)}</span>
            </button>
          ))}
        </div>

        <span className="premium-step">{t.premium.step1}</span>
        <div className="premium-card">
          <span className="premium-card-text">
            <span className="premium-card-number">{info.card}</span>
            {info.card_holder && <span className="muted">{info.card_holder}</span>}
          </span>
          <button
            type="button"
            className="premium-copy"
            onClick={async () => {
              if (await copyText(info.card.replace(/\s/g, ""))) {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }
            }}
          >
            {copied ? t.premium.copied : t.premium.copy}
          </button>
        </div>

        <span className="premium-step">{t.premium.step2}</span>
        <input
          ref={input}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null);
            setError(null);
          }}
        />
        <button type="button" className="button wide secondary" onClick={() => input.current?.click()}>
          {file ? `✓ ${file.name} · ${t.premium.changeReceipt}` : t.premium.pickReceipt}
        </button>
        {error && (
          <p className="editor-status error" role="alert">
            {error}
          </p>
        )}
        <button
          type="button"
          className="button wide"
          disabled={!file || progress !== null}
          onClick={() => void send()}
        >
          {progress !== null ? t.premium.sending(Math.round(progress * 100)) : t.premium.send}
        </button>
      </>
    );
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="premium-title"
        onClick={(e) => e.stopPropagation()}
      >
        <span className="tag premium">{t.songs.premium}</span>
        <h2 id="premium-title">{song ? t.songs.premiumTitle : t.premium.title}</h2>
        {song && (
          <p className="sheet-song">
            {song.title} · <span className="muted">{song.artist}</span>
          </p>
        )}
        <p className="muted">{song ? `${t.premium.locked} ${t.premium.perks}` : t.premium.perks}</p>
        {body}
        <button type="button" className="button wide secondary" onClick={onClose}>
          {t.premium.close}
        </button>
      </div>
    </div>
  );
}
