// Premium — premium-sheet-v2.reference.html: why it opened, the perks, two plans, then
// pay to the card and upload the receipt; an admin approves it in the admin panel and
// the bot tells the user. Opened by anything locked: nothing premium is hidden.
import { useEffect, useRef, useState } from "react";

import { api, errorCode, type PaymentInfo, type Plan, type SongSummary } from "../api";
import { formatAmount } from "../panel/format";
import { copyText, haptic } from "../telegram";
import { t } from "../texts";
import { Icon, PrimaryButton, SecondaryButton } from "./ui";

/** What the user tapped: the sheet's subtitle says what premium opens. */
export type PremiumReason =
  | { kind: "song"; song: SongSummary }
  | { kind: "slow" }
  | { kind: "loop" }
  | { kind: "ear"; level: number }
  | { kind: "analyze" }
  | { kind: "strum"; name: string } // a premium strumming pattern in the trainer
  | { kind: "general" };

function why(reason: PremiumReason, premiumSongs: number): string {
  switch (reason.kind) {
    case "song":
      return t.premium.why.song(reason.song.title, Math.max(0, premiumSongs - 1));
    case "slow":
      return t.premium.why.slow;
    case "loop":
      return t.premium.why.loop;
    case "ear":
      return t.premium.why.ear(reason.level);
    case "analyze":
      return t.premium.why.analyze;
    case "strum":
      return t.premium.why.strum(reason.name);
    case "general":
      return t.premium.why.general(premiumSongs);
  }
}

interface Props {
  reason: PremiumReason;
  onClose: () => void;
}

export function PremiumSheet({ reason, onClose }: Props) {
  const [info, setInfo] = useState<PaymentInfo | null>(null);
  const [failed, setFailed] = useState(false);
  const [plan, setPlan] = useState<Plan["id"]>("quarter");
  const [paying, setPaying] = useState(false); // step 2: the card and the receipt
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
  const month = info?.plans.find((p) => p.id === "month");
  const chosen = info?.plans.find((p) => p.id === plan);

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
  } else if (!paying) {
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
        <div className="plan-grid" role="radiogroup" aria-label={t.premium.title}>
          {info.plans.map((p) => {
            const months = Math.round(p.days / 30);
            const off = month && months > 1 ? Math.round((1 - p.price / (month.price * months)) * 100) : 0;
            return (
              <button
                key={p.id}
                type="button"
                role="radio"
                aria-checked={plan === p.id}
                className="plan-card"
                onClick={() => {
                  haptic.tap();
                  setPlan(p.id);
                }}
              >
                {off > 0 && <span className="plan-off">{t.premium.discount(off)}</span>}
                <span className="plan-name">{t.premium.plans[p.id] ?? `${p.days} kun`}</span>
                <span className="plan-price">{formatAmount(p.price)}</span>
                <span className="plan-sub">
                  {months > 1 ? t.premium.perMonth(formatAmount(p.price / months)) : t.premium.som}
                </span>
              </button>
            );
          })}
        </div>
        <PrimaryButton wide disabled={!info.card} onClick={() => setPaying(true)}>
          {t.premium.pay}
        </PrimaryButton>
        <span className="premium-note">{info.card ? t.premium.payNote : t.premium.soon}</span>
      </>
    );
  } else {
    body = (
      <>
        <button type="button" className="link-button premium-back" onClick={() => setPaying(false)}>
          {t.premium.changePlan}
        </button>
        {chosen && (
          <span className="premium-chosen">
            {t.premium.plans[chosen.id] ?? `${chosen.days} kun`} · {formatAmount(chosen.price)} {t.premium.som}
          </span>
        )}
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
        <SecondaryButton wide onClick={() => input.current?.click()}>
          {file ? `✓ ${file.name} · ${t.premium.changeReceipt}` : t.premium.pickReceipt}
        </SecondaryButton>
        {error && (
          <p className="editor-status error" role="alert">
            {error}
          </p>
        )}
        <PrimaryButton wide disabled={!file || progress !== null} onClick={() => void send()}>
          {progress !== null ? t.premium.sending(Math.round(progress * 100)) : t.premium.send}
        </PrimaryButton>
      </>
    );
  }

  return (
    <div className="overlay" onClick={onClose}>
      <section
        className="premium-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="premium-title"
        onClick={(e) => e.stopPropagation()}
      >
        <span className="sheet-handle" aria-hidden="true" />
        <div className="premium-head">
          <span className="premium-head-text">
            <h2 id="premium-title">{t.premium.title}</h2>
            <span>{why(reason, info?.premium_songs ?? 0)}</span>
          </span>
          <button type="button" className="premium-close" aria-label={t.premium.close} onClick={onClose}>
            <Icon size={18} stroke={2.2}>
              <path d="M6 6l12 12M18 6L6 18" />
            </Icon>
          </button>
        </div>
        {!paying && (
          <ul className="premium-perks">
            {t.premium.perkList.map((perk) => (
              <li key={perk}>
                <span className="premium-check" aria-hidden="true">
                  <Icon size={14} stroke={2.6}>
                    <path d="M5 12l5 5L20 7" />
                  </Icon>
                </span>
                {perk}
              </li>
            ))}
          </ul>
        )}
        {body}
      </section>
    </div>
  );
}
