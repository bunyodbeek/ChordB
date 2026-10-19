import type { ReactNode } from "react";

import { haptic } from "../telegram";
import { t } from "../texts";

export type Tab = "tuner" | "chords" | "songs" | "profile";

// Icons and layout follow songs-list.reference.html.
const icon = (children: ReactNode) => (
  <svg
    aria-hidden="true"
    width="22"
    height="22"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    {children}
  </svg>
);

const TABS: { id: Tab; icon: ReactNode }[] = [
  {
    id: "tuner",
    icon: icon(
      <>
        <path d="M4 16a8 8 0 0 1 16 0" />
        <path d="M12 16l4-5" />
      </>,
    ),
  },
  {
    id: "chords",
    icon: icon(
      <>
        <rect x="5" y="4" width="14" height="16" rx="2" />
        <path d="M9.5 4v16M14.5 4v16M5 9h14M5 14h14" />
      </>,
    ),
  },
  {
    id: "songs",
    icon: icon(
      <>
        <path d="M9 18V6l10-2v12" />
        <circle cx="7" cy="18" r="2" />
        <circle cx="17" cy="16" r="2" />
      </>,
    ),
  },
  {
    id: "profile",
    icon: icon(
      <>
        <circle cx="12" cy="8" r="3.5" />
        <path d="M5 20c1.2-3.5 4-5 7-5s5.8 1.5 7 5" />
      </>,
    ),
  },
];

export function TabBar({ tab, onChange }: { tab: Tab; onChange: (t: Tab) => void }) {
  return (
    <nav className="tabbar" aria-label="Asosiy menyu">
      {TABS.map(({ id, icon }) => (
        <button
          key={id}
          type="button"
          className={`tab${tab === id ? " active" : ""}`}
          aria-current={tab === id ? "page" : undefined}
          onClick={() => {
            if (tab === id) return;
            haptic.tap();
            onChange(id);
          }}
        >
          {icon}
          {t.tabs[id]}
        </button>
      ))}
    </nav>
  );
}
