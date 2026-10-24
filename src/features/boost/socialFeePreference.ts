import { useCallback, useEffect, useRef, useState } from "react";

const STORAGE_KEY = "proofofwork.social-fee.v1";
const COOKIE_NAME = "proofofwork_social_fee_v1";
const CHANGE_EVENT = "proofofwork-social-fee-change";
const PRODUCT_HOSTS = new Set(["boost.proofofwork.me", "publish.proofofwork.me", "computer.proofofwork.me"]);
type FeePreference = { rate: number; updatedAt: number };
let sessionPreference: FeePreference | undefined;

export function validSocialFeeRate(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0.1 &&
    Number(value.toFixed(8)) === value;
}

export function socialFeeRateFromInput(value: string): number | undefined {
  const text = value.trim();
  if (!/^(?:\d+(?:\.\d{0,8})?|\.\d{1,8})$/u.test(text)) return undefined;
  const rate = Number(text);
  return validSocialFeeRate(rate) ? rate : undefined;
}

function sharedCookieHost() {
  return typeof window !== "undefined" && window.location.protocol === "https:" &&
    PRODUCT_HOSTS.has(window.location.hostname);
}

function parsePreference(raw: string | null | undefined): FeePreference | undefined {
  if (!raw) return undefined;
  try {
    const value = JSON.parse(raw);
    if (validSocialFeeRate(value?.rate) && Number.isSafeInteger(value.updatedAt) &&
        value.updatedAt > 0 && value.updatedAt <= Date.now() + 60_000) return value;
  } catch { /* An invalid preference never becomes a transaction setting. */ }
  return undefined;
}

function currentPreference(): FeePreference | undefined {
  let latest = sessionPreference;
  const consider = (candidate: FeePreference | undefined) => {
    if (candidate && (!latest || candidate.updatedAt > latest.updatedAt)) latest = candidate;
  };
  if (typeof window === "undefined") return latest;
  try { consider(parsePreference(window.localStorage.getItem(STORAGE_KEY))); }
  catch { /* Storage failure leaves the session choice usable. */ }
  if (sharedCookieHost()) {
    try {
      const entry = document.cookie.split(";").map(value => value.trim())
        .find(value => value.startsWith(`${COOKIE_NAME}=`));
      consider(parsePreference(entry ? decodeURIComponent(entry.slice(COOKIE_NAME.length + 1)) : undefined));
    } catch { /* Cookies can be blocked independently of local storage. */ }
  }
  if (latest) sessionPreference = latest;
  return latest;
}

export function readSocialFeeRatePreference(): number {
  return currentPreference()?.rate ?? 1;
}

export function writeSocialFeeRatePreference(rate: number): boolean {
  if (!validSocialFeeRate(rate)) return false;
  const previous = currentPreference();
  sessionPreference = { rate, updatedAt: Math.max(Date.now(), (previous?.updatedAt ?? 0) + 1) };
  const raw = JSON.stringify(sessionPreference);
  if (typeof window === "undefined") return true;
  try { window.localStorage.setItem(STORAGE_KEY, raw); }
  catch { /* Retain this session's explicit choice. */ }
  if (sharedCookieHost()) {
    try {
      // Only a construction preference crosses these product hosts. No wallet,
      // draft, transaction, or signing authority is stored in this cookie.
      document.cookie = `${COOKIE_NAME}=${encodeURIComponent(raw)}; Max-Age=31536000; Path=/; Domain=proofofwork.me; Secure; SameSite=Lax`;
    } catch { /* Origin storage or the session choice remains available. */ }
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
  return true;
}

export function useSocialFeeRate({ locked = false }: { locked?: boolean } = {}) {
  const [feeRate, setFeeRate] = useState(readSocialFeeRatePreference);
  const lockedRef = useRef(locked);
  lockedRef.current = locked;
  useEffect(() => {
    const refresh = () => { if (!lockedRef.current) setFeeRate(readSocialFeeRatePreference()); };
    const onStorage = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY || event.key === null) refresh();
    };
    const onVisibility = () => { if (document.visibilityState === "visible") refresh(); };
    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", refresh);
    window.addEventListener(CHANGE_EVENT, refresh);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", refresh);
      window.removeEventListener(CHANGE_EVENT, refresh);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);
  useEffect(() => {
    if (!locked) setFeeRate(readSocialFeeRatePreference());
  }, [locked]);
  const chooseFeeRate = useCallback((next: number) => {
    // Incomplete editing stays local; only an accepted rate is remembered.
    setFeeRate(next);
    writeSocialFeeRatePreference(next);
  }, []);
  return [feeRate, chooseFeeRate] as const;
}
