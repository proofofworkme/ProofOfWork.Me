type InFlightEntry<T> = {
  controller: AbortController;
  consumers: number;
  promise: Promise<T>;
  settled: boolean;
};

/** Coalesce overlapping reads while keeping consumer cancellation independent. */
export function createInFlightRequestPool<T>() {
  const entries = new Map<string, InFlightEntry<T>>();

  function request(
    key: string,
    consumerSignal: AbortSignal,
    load: (signal: AbortSignal) => Promise<T>,
  ) {
    if (consumerSignal.aborted) {
      return Promise.reject(
        consumerSignal.reason ?? new DOMException("Aborted", "AbortError"),
      );
    }

    let entry = entries.get(key);
    if (!entry) {
      const controller = new AbortController();
      const created: InFlightEntry<T> = {
        controller,
        consumers: 0,
        promise: Promise.resolve(undefined as T),
        settled: false,
      };
      entries.set(key, created);
      created.promise = Promise.resolve()
        .then(() => load(controller.signal))
        .then(
          (value) => {
            created.settled = true;
            if (entries.get(key) === created) entries.delete(key);
            return value;
          },
          (error: unknown) => {
            created.settled = true;
            if (entries.get(key) === created) entries.delete(key);
            throw error;
          },
        );
      entry = created;
    }

    const shared = entry;
    shared.consumers += 1;

    return new Promise<T>((resolve, reject) => {
      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        shared.consumers = Math.max(0, shared.consumers - 1);
        if (shared.consumers === 0 && !shared.settled) {
          if (entries.get(key) === shared) entries.delete(key);
          shared.controller.abort();
        }
      };
      const onAbort = () => {
        release();
        reject(
          consumerSignal.reason ?? new DOMException("Aborted", "AbortError"),
        );
      };
      const onSettled = () => consumerSignal.removeEventListener("abort", onAbort);

      consumerSignal.addEventListener("abort", onAbort, { once: true });
      if (consumerSignal.aborted) {
        onAbort();
        return;
      }

      shared.promise.then(
        (value) => {
          onSettled();
          if (consumerSignal.aborted) {
            onAbort();
            return;
          }
          release();
          resolve(value);
        },
        (error: unknown) => {
          onSettled();
          if (consumerSignal.aborted) {
            onAbort();
            return;
          }
          release();
          reject(error);
        },
      );
    });
  }

  return { request };
}
