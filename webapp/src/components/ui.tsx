// The design system's shared pieces (docs/design/v5/design-system.reference.html).
// Every screen builds its header, nav, rows, chips and buttons from these.
import type { ButtonHTMLAttributes, ReactNode } from "react";

import type { ChordJson, Difficulty } from "../api";
import { spelled } from "../chords";
import { formatChord, type NotationKind } from "../notation";
import { haptic } from "../telegram";
import { t } from "../texts";

// --- icons (24-unit grid, stroke = currentColor) ---

export function Icon({
  size = 24,
  stroke = 2,
  children,
}: {
  size?: number;
  stroke?: number;
  children: ReactNode;
}) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

export const BackIcon = () => (
  <Icon>
    <path d="M15 5l-7 7 7 7" />
  </Icon>
);

export const ChevronIcon = () => (
  <Icon size={20}>
    <path d="M9 6l6 6-6 6" />
  </Icon>
);

export const LockIcon = ({ size = 14 }: { size?: number }) => (
  <Icon size={size} stroke={2.2}>
    <rect x="5" y="11" width="14" height="9" rx="2" />
    <path d="M8 11V8a4 4 0 0 1 8 0v3" />
  </Icon>
);

export const TunerIcon = ({ size = 22 }: { size?: number }) => (
  <Icon size={size}>
    <path d="M4 16a8 8 0 0 1 16 0" />
    <path d="M12 16l4-5" />
  </Icon>
);

export const SearchIcon = () => (
  <Icon size={22}>
    <circle cx="11" cy="11" r="6" />
    <path d="M20 20l-4.5-4.5" />
  </Icon>
);

/** The ChordB mark (the splash's), 32px: the Asosiy header's lead. */
export const Logo = () => (
  <svg aria-hidden="true" className="logo" width="32" height="32" viewBox="0 0 100 100">
    <defs>
      <clipPath id="logo-c">
        <path d="M85.36 85.36A50 50 0 1 1 85.36 14.64L64.14 35.86A20 20 0 1 0 64.14 64.14Z" />
      </clipPath>
    </defs>
    <rect width="100" height="100" rx="24" fill="#151515" />
    <g clipPath="url(#logo-c)" transform="translate(16 16) scale(0.68)">
      <rect x="0" y="0" width="100" height="11.9" fill="#20FA9B" />
      <rect x="0" y="17.7" width="100" height="11.7" fill="#20FA9B" />
      <rect x="0" y="36.2" width="100" height="10.9" fill="#20FA9B" />
      <rect x="0" y="52.9" width="100" height="47.1" fill="#FFFFFF" />
    </g>
  </svg>
);

/** A song's first chords for a row: "Am F C G", in the user's notation. */
export function previewLine(chords: ChordJson[], notation: NotationKind): string {
  return chords.map((c) => formatChord(spelled(c), notation)).join(" ");
}

// --- AppHeader ---

interface HeaderProps {
  title: ReactNode;
  sub?: ReactNode; // ichki sahifa only: the 12px line under the title
  onBack?: () => void; // given → ichki sahifa (← 44px, title 18); else a tab's (title 20)
  right?: ReactNode;
  lead?: ReactNode; // before the title on a tab page (Asosiy: the logo)
}

export function AppHeader({ title, sub, onBack, right, lead }: HeaderProps) {
  return (
    <header className={`app-header${onBack ? " inner" : ""}`}>
      {onBack && (
        <button type="button" className="icon-button" aria-label={t.back} onClick={onBack}>
          <BackIcon />
        </button>
      )}
      {lead}
      <div className="app-header-title">
        <h1>{title}</h1>
        {sub && <span className="app-header-sub">{sub}</span>}
      </div>
      {right && <div className="app-header-side">{right}</div>}
    </header>
  );
}

// --- BottomNav ---

export type Tab = "home" | "songs" | "practice" | "profile";

const navIcon = (children: ReactNode) => (
  <Icon stroke={1.9}>{children}</Icon>
);

const TABS: { id: Tab; icon: ReactNode }[] = [
  { id: "home", icon: navIcon(<path d="M4 11l8-7 8 7v9a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z" />) },
  {
    id: "songs",
    icon: navIcon(
      <>
        <path d="M9 18V6l10-2v12" />
        <circle cx="7" cy="18" r="2" />
        <circle cx="17" cy="16" r="2" />
      </>,
    ),
  },
  {
    id: "practice",
    icon: navIcon(
      <>
        <circle cx="12" cy="12" r="8" />
        <circle cx="12" cy="12" r="4" />
        <circle cx="12" cy="12" r="0.5" fill="currentColor" />
      </>,
    ),
  },
  {
    id: "profile",
    icon: navIcon(
      <>
        <circle cx="12" cy="8" r="3.5" />
        <path d="M5 20c1.2-3.5 4-5 7-5s5.8 1.5 7 5" />
      </>,
    ),
  },
];

/** `tab` is the highlighted one; tapping it again still calls onChange (back to its root). */
export function BottomNav({ tab, onChange }: { tab: Tab; onChange: (t: Tab) => void }) {
  return (
    <nav className="bottom-nav" aria-label={t.navLabel}>
      {TABS.map(({ id, icon }) => (
        <button
          key={id}
          type="button"
          className={`nav-tab${tab === id ? " active" : ""}`}
          aria-current={tab === id ? "page" : undefined}
          onClick={() => {
            haptic.tap();
            onChange(id);
          }}
        >
          <span className="nav-pill">{icon}</span>
          {t.tabs[id]}
        </button>
      ))}
    </nav>
  );
}

// --- buttons ---

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { wide?: boolean };

export function PrimaryButton({ wide, className = "", type = "button", ...rest }: ButtonProps) {
  return <button type={type} className={`btn-primary${wide ? " wide" : ""} ${className}`} {...rest} />;
}

export function SecondaryButton({ wide, className = "", type = "button", ...rest }: ButtonProps) {
  return <button type={type} className={`btn-secondary${wide ? " wide" : ""} ${className}`} {...rest} />;
}

// --- chips and badges ---

export function Chip({
  selected,
  locked = false,
  onClick,
  children,
}: {
  selected: boolean;
  locked?: boolean; // a premium filter: shown with a small lock
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className="ui-chip"
      aria-pressed={selected}
      onClick={() => {
        haptic.tap();
        onClick();
      }}
    >
      {children}
      {locked && <LockIcon size={12} />}
    </button>
  );
}

export function DifficultyBadge({ level }: { level: Difficulty }) {
  return <span className={`difficulty ${level}`}>{t.songs.levels[level]}</span>;
}

export function LockBadge() {
  return (
    <span className="lock-badge" role="img" aria-label={t.songs.premium}>
      <LockIcon />
    </span>
  );
}

// --- SongRow ---

// The tile's colour only tells rows apart; it follows the id so it never jumps.
const TILE_COLORS = ["#2F5BFF", "#15171A", "#12805C", "#8A5300", "#B42318", "#5B3FD9", "#0E7490"];

export function SongRow({
  id,
  title,
  artist,
  difficulty,
  chords,
  locked,
  onClick,
}: {
  id: number;
  title: string;
  artist: string;
  difficulty: Difficulty;
  chords?: string; // "Am F C G", already in the user's notation
  locked: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button" className="song-row-v3" onClick={onClick}>
      <span
        className="song-row-tile"
        aria-hidden="true"
        style={{ background: TILE_COLORS[id % TILE_COLORS.length] }}
      >
        {title.trim().charAt(0).toUpperCase()}
      </span>
      <span className="song-row-text">
        <span className="song-row-title">{title}</span>
        <span className="song-row-meta">
          <DifficultyBadge level={difficulty} />
          <span>{artist}</span>
          {chords && <span className="mono">· {chords}</span>}
        </span>
      </span>
      <span className="song-row-end">{locked ? <LockBadge /> : <ChevronIcon />}</span>
    </button>
  );
}
