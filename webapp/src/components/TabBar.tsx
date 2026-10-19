import type { ReactNode } from "react";

import { haptic } from "../telegram";
import { t } from "../texts";

export type Tab = "tuner" | "chords" | "songs" | "profile";

const icon = (children: ReactNode) => (
  <svg
    viewBox="0 0 24 24"
    width="22"
    height="22"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {children}
  </svg>
);

const TABS: { id: Tab; icon: ReactNode }[] = [
  {
    id: "tuner",
    icon: icon(
      <>
        <path d="M4 17a8 8 0 1 1 16 0" />
        <path d="M12 17l3.5-5" />
      </>,
    ),
  },
  {
    id: "chords",
    icon: icon(
      <>
        <rect x="4" y="4" width="16" height="16" rx="2" />
        <path d="M4 9.3h16M4 14.6h16M9.3 4v16M14.6 4v16" />
      </>,
    ),
  },
  {
    id: "songs",
    icon: icon(
      <>
        <path d="M9 18V5l11-2v13" />
        <circle cx="6" cy="18" r="3" />
        <circle cx="17" cy="16" r="3" />
      </>,
    ),
  },
  {
    id: "profile",
    icon: icon(
      <>
        <circle cx="12" cy="8" r="4" />
        <path d="M4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5" />
      </>,
    ),
  },
];

export function TabBar({ tab, onChange }: { tab: Tab; onChange: (t: Tab) => void }) {
  return (
    <nav className="tabbar">
      {TABS.map(({ id, icon }) => (
        <button
          key={id}
          className={`tab${tab === id ? " active" : ""}`}
          aria-current={tab === id ? "page" : undefined}
          onClick={() => {
            if (tab === id) return;
            haptic.tap();
            onChange(id);
          }}
        >
          {icon}
          <span>{t.tabs[id]}</span>
        </button>
      ))}
    </nav>
  );
}
