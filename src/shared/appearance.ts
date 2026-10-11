import { useSyncExternalStore } from "react";

export type AppearancePreference = "light" | "dark" | "system";

const STORAGE_KEY = "proofofwork-me-appearance-v1";
const COOKIE_NAME = "proofofwork_appearance";
const listeners = new Set<() => void>();
let preference: AppearancePreference = "system";
let media: MediaQueryList;
let initialized = false;

function validPreference(value: unknown): value is AppearancePreference {
  return value === "light" || value === "dark" || value === "system";
}

function storedPreference(): AppearancePreference | null {
  // Only a display preference is shared across the public app hosts. It grants
  // no authority and contains no account, wallet, or tracking identifier.
  try {
    const cookie = document.cookie.split("; ").find((entry) => entry.startsWith(`${COOKIE_NAME}=`));
    const value = cookie?.slice(COOKIE_NAME.length + 1);
    if (validPreference(value)) return value;
  } catch { /* Cookies can be disabled independently of local storage. */ }
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    if (validPreference(value)) return value;
  } catch { /* A session-only choice remains available if storage is blocked. */ }
  return null;
}

function applyAppearance() {
  const theme = preference === "system" ? (media.matches ? "dark" : "light") : preference;
  document.documentElement.dataset.appearance = preference;
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  // Both existing media-specific entries use the resolved choice so browser
  // chrome also follows a manual override of the operating-system preference.
  document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((meta) => {
    meta.content = theme === "dark" ? "#212121" : "#f7f7f5";
  });
  listeners.forEach((listener) => listener());
}

export function initializeAppearance() {
  if (initialized) return;
  initialized = true;
  media = window.matchMedia("(prefers-color-scheme: dark)");
  preference = storedPreference() ?? "system";
  applyAppearance();
  media.addEventListener("change", () => {
    if (preference === "system") applyAppearance();
  });
  window.addEventListener("storage", (event) => {
    if (event.key !== STORAGE_KEY && event.key !== null) return;
    preference = storedPreference() ?? "system";
    applyAppearance();
  });
  const refresh = () => {
    const stored = storedPreference();
    if (stored && stored !== preference) {
      preference = stored;
      applyAppearance();
    }
  };
  // Storage events do not cross origins; a returning product tab picks up the
  // suite cookie on focus without polling or resetting any application state.
  window.addEventListener("focus", refresh);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") refresh();
  });
}

export function setAppearancePreference(next: AppearancePreference) {
  preference = next;
  const hostname = window.location.hostname;
  if (window.location.protocol === "https:" &&
      (hostname === "proofofwork.me" || hostname.endsWith(".proofofwork.me"))) {
    try {
      document.cookie = `${COOKIE_NAME}=${next}; Max-Age=31536000; Path=/; Domain=proofofwork.me; Secure; SameSite=Lax`;
    } catch { /* Fall back to origin-local persistence. */ }
  }
  try { localStorage.setItem(STORAGE_KEY, next); } catch { /* Retain this session's choice. */ }
  applyAppearance();
}

export function useAppearancePreference() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    () => preference,
    () => "system" as const,
  );
}
