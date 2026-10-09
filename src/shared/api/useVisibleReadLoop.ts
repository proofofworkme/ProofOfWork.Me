/** Own automatic display reads. Transaction preflights do not use this loop. */
export function createVisibleReadLoop(
  read: (signal: AbortSignal) => Promise<unknown>,
  intervalMs?: number,
) {
  let stopped = false;
  let active: AbortController | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let resumePending = false;
  let startedAt = -Infinity;
  const visible = () => document.visibilityState === "visible";
  const clearTimer = () => { clearTimeout(timer); timer = undefined; };

  const run = () => {
    if (stopped || !visible()) return;
    if (active) {
      if (active.signal.aborted) resumePending = true;
      return;
    }
    clearTimer();
    resumePending = false;
    startedAt = Date.now();
    const controller = new AbortController();
    active = controller;
    void Promise.resolve().then(() => {
      controller.signal.throwIfAborted();
      return read(controller.signal);
    }).catch(() => {
      // Callers own unavailable/last-verified state; cancellation adds no error.
    }).finally(() => {
      // A fail-fast group can settle before its sibling requests/retries.
      // The cycle owns those consumers even after its main promise settles.
      controller.abort(new DOMException("Display read cycle finished.", "AbortError"));
      if (active !== controller) return;
      active = undefined;
      if (stopped || !visible()) return;
      if (resumePending) run();
      else if (intervalMs !== undefined) timer = setTimeout(run, intervalMs);
    });
  };
  const visibilityChanged = () => {
    clearTimer();
    if (visible()) run();
    else {
      resumePending = false;
      active?.abort(new DOMException("Display is hidden.", "AbortError"));
    }
  };
  const focused = () => {
    // A visibility event and its focus event represent one return to the app.
    if (Date.now() - startedAt >= 1_000) run();
  };
  document.addEventListener("visibilitychange", visibilityChanged);
  window.addEventListener("focus", focused);
  run();
  return () => {
    stopped = true;
    resumePending = false;
    clearTimer();
    active?.abort(new DOMException("Display read scope changed.", "AbortError"));
    document.removeEventListener("visibilitychange", visibilityChanged);
    window.removeEventListener("focus", focused);
  };
}

/** Cancel delayed follow-up work with its originating workspace/read cycle. */
export function waitForDisplayRead(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) { reject(signal.reason); return; }
    const onAbort = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/** Provider read RPCs cannot be cancelled; discard their obsolete completion. */
export function consumeDisplayRead<T>(promise: Promise<T>, signal?: AbortSignal) {
  if (!signal) return promise;
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then((value) => {
      signal.removeEventListener("abort", onAbort);
      if (signal.aborted) reject(signal.reason);
      else resolve(value);
    }, (error: unknown) => {
      signal.removeEventListener("abort", onAbort);
      reject(signal.aborted ? signal.reason : error);
    });
    if (signal.aborted) onAbort();
  });
}
