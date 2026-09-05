// A generation guard is still necessary when a transport or cached promise
// ignores cancellation. All payload/status/busy writes must check ownership.
export function createBoostReadLifecycle() {
  let generation = 0;
  let active: AbortController | undefined;
  return {
    begin() {
      active?.abort();
      const controller = new AbortController();
      active = controller;
      const request = ++generation;
      return { signal: controller.signal, current: () => request === generation && !controller.signal.aborted };
    },
    cancel() {
      generation += 1;
      active?.abort();
      active = undefined;
    },
  };
}
