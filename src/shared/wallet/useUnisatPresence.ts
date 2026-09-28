import { useEffect, useState } from "react";

/**
 * Detect an injected UniSat provider without waking every second. Late wallet
 * injection is rechecked on page load, focus, visibility, and the user's first
 * interaction with the page.
 */
export function useUnisatPresence() {
  const [present, setPresent] = useState(() => Boolean(window.unisat));

  useEffect(() => {
    const detect = () => setPresent(Boolean(window.unisat));
    const detectWhenVisible = () => {
      if (document.visibilityState === "visible") detect();
    };

    detect();
    window.addEventListener("load", detect);
    window.addEventListener("focus", detectWhenVisible);
    window.addEventListener("pointerdown", detect, true);
    window.addEventListener("keydown", detect, true);
    document.addEventListener("visibilitychange", detectWhenVisible);

    return () => {
      window.removeEventListener("load", detect);
      window.removeEventListener("focus", detectWhenVisible);
      window.removeEventListener("pointerdown", detect, true);
      window.removeEventListener("keydown", detect, true);
      document.removeEventListener("visibilitychange", detectWhenVisible);
    };
  }, []);

  return [present, setPresent] as const;
}
