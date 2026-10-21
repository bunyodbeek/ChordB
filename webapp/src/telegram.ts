// Thin typed wrapper over window.Telegram.WebApp (loaded by index.html).
// Outside Telegram the script still defines WebApp, but initData is empty.
import { useEffect } from "react";

type Haptic = "light" | "medium" | "heavy" | "rigid" | "soft";
type Notify = "error" | "success" | "warning";

interface TelegramWebApp {
  initData: string;
  version: string;
  platform: string;
  colorScheme: "light" | "dark";
  ready(): void;
  expand(): void;
  initDataUnsafe?: { start_param?: string };
  isVersionAtLeast(version: string): boolean;
  disableVerticalSwipes?(): void;
  requestFullscreen?(): void;
  openLink?(url: string): void;
  showConfirm?(message: string, callback: (ok: boolean) => void): void;
  setHeaderColor?(color: string): void;
  setBackgroundColor?(color: string): void;
  setBottomBarColor?(color: string): void;
  requestWriteAccess?(callback: (granted: boolean) => void): void;
  BackButton?: {
    show(): void;
    hide(): void;
    onClick(cb: () => void): void;
    offClick(cb: () => void): void;
  };
  HapticFeedback?: {
    impactOccurred(style: Haptic): void;
    notificationOccurred(type: Notify): void;
    selectionChanged(): void;
  };
}

declare global {
  interface Window {
    Telegram?: { WebApp: TelegramWebApp };
  }
}

const tg = window.Telegram?.WebApp;

/** initData to authenticate with: the real one in Telegram, the dev one in a browser. */
export function getInitData(): string {
  return tg?.initData || import.meta.env.VITE_DEV_INIT_DATA || "";
}

export const inTelegram = Boolean(tg?.initData);

/** The startapp parameter: from Telegram for t.me links, else ?startapp= in the URL. */
export function startParam(): string | null {
  return (
    tg?.initDataUnsafe?.start_param ||
    new URLSearchParams(location.search).get("startapp") ||
    null
  );
}

export function initTelegram(): void {
  // The app has its own palette (styles.css); only light vs dark follows Telegram,
  // or the system in a plain browser.
  const dark = inTelegram
    ? tg!.colorScheme === "dark"
    : window.matchMedia("(prefers-color-scheme: dark)").matches;
  document.documentElement.dataset.theme = dark ? "dark" : "light";

  // ready() and expand() already ran in index.html, with the splash's colours.
  if (!tg) return;
  // Stop a downward swipe on the tuner from closing the app (Bot API 7.7+).
  if (tg.isVersionAtLeast("7.7")) tg.disableVerticalSwipes?.();
}

/**
 * Telegram's header, background and bottom bar in the app's colours (the white app bar
 * and tab bar, the page background); splash.ts calls it as the splash fades.
 */
export function setAppChrome(): void {
  if (!tg) return;
  const dark = document.documentElement.dataset.theme === "dark";
  const bar = dark ? "#1e1e21" : "#ffffff"; // keep in sync with --card
  const bg = dark ? "#141416" : "#f4f5f2"; // and --bg
  if (tg.isVersionAtLeast("6.1")) {
    tg.setHeaderColor?.(bar);
    tg.setBackgroundColor?.(bg);
  }
  if (tg.isVersionAtLeast("7.10")) tg.setBottomBarColor?.(bar);
}

/** requestWriteAccess exists from Bot API 6.9, and only means something inside Telegram. */
export const canRequestWriteAccess = Boolean(
  inTelegram && tg?.requestWriteAccess && tg.isVersionAtLeast("6.9"),
);

/** Ask permission for the bot to message the user. Check canRequestWriteAccess first. */
export function requestWriteAccess(): Promise<boolean> {
  return new Promise((resolve) => tg!.requestWriteAccess!(resolve));
}

/** Show Telegram's native back button (top-left) while the calling screen is mounted. */
export function useBackButton(onBack: () => void): void {
  useEffect(() => {
    const bb = inTelegram && tg!.isVersionAtLeast("6.1") ? tg!.BackButton : undefined;
    if (!bb) return;
    bb.onClick(onBack);
    bb.show();
    return () => {
      bb.offClick(onBack);
      bb.hide();
    };
  }, [onBack]);
}

/** Yes/no question: Telegram's native popup inside Telegram, the browser's outside. */
export function confirmDialog(message: string): Promise<boolean> {
  return new Promise((resolve) => {
    if (inTelegram && tg?.showConfirm && tg.isVersionAtLeast("6.2")) tg.showConfirm(message, resolve);
    else resolve(window.confirm(message));
  });
}

/** Open an external link (Telegram's in-app browser inside Telegram). */
export function openLink(url: string): void {
  if (inTelegram && tg?.openLink) tg.openLink(url);
  else window.open(url, "_blank", "noopener");
}

/** Telegram Desktop / macOS / Web: a window with room for the admin panel. */
export const onDesktop = inTelegram && ["tdesktop", "macos", "weba", "webk"].includes(tg!.platform);

/** Full-window Mini App (Bot API 8.0+), for the admin panel on desktop. */
export function requestFullscreen(): void {
  if (onDesktop && tg!.isVersionAtLeast("8.0")) tg!.requestFullscreen?.();
}

/** Copy to the clipboard; false when the WebView refuses. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Older WebViews: the select-and-copy fallback.
    const area = document.createElement("textarea");
    area.value = text;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  }
}

export const haptic = {
  tap: () => tg?.HapticFeedback?.selectionChanged(),
  success: () => tg?.HapticFeedback?.notificationOccurred("success"),
};
