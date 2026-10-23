// Complete authority projections are shared across address scopes. Keys bind
// both the canonical checkpoint and the reader's mutable indexed-source fence.
export function notificationProjectionCache({ maxEntries = 2, maxBytes = 32 * 1024 * 1024, ttlMs = 60_000, now = Date.now } = {}) {
  const entries = new Map();
  let bytes = 0;
  function remove(key) { const entry = entries.get(key); if (entry) bytes -= entry.bytes ?? 0; entries.delete(key); }
  return async function read(key, load) {
    const existing = entries.get(key);
    if (existing && (!existing.value || existing.expiresAt > now())) return existing.promise;
    if (existing) remove(key);
    for (const [oldKey, entry] of entries) if (entry.value && entry.expiresAt <= now()) remove(oldKey);
    while (entries.size >= maxEntries) {
      const oldest = [...entries].find(([, entry]) => entry.value);
      if (!oldest) throw Object.assign(new Error("Notification authority reads are busy; retry shortly."), { statusCode: 503 });
      remove(oldest[0]);
    }
    const entry = { bytes: 0 };
    const promise = Promise.resolve().then(load).then(value => {
      const size = Buffer.byteLength(JSON.stringify(value, (_key, item) => item instanceof Map ? [...item] : item));
      if (size > maxBytes) throw Object.assign(new Error("Notification authority exceeds its complete projection budget."), { statusCode: 503 });
      while (bytes + size > maxBytes) {
        const oldest = [...entries].find(([oldKey, item]) => oldKey !== key && item.value);
        if (!oldest) break;
        remove(oldest[0]);
      }
      entry.value = value; entry.bytes = size; entry.expiresAt = now() + ttlMs; bytes += size;
      return value;
    }).catch(error => { remove(key); throw error; });
    entry.promise = promise; entries.set(key, entry); return promise;
  };
}
