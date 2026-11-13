// IndexedDB avoids localStorage's small UTF-16 quota for four-million-byte text.
// Legacy localStorage drafts are read without deleting or rewriting them.
let database: Promise<IDBDatabase> | undefined;
const writes = new Map<string, Promise<void>>();
function db() {
  if (!database) database = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("proofofwork-publish-drafts", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("drafts");
    request.onsuccess = () => { request.result.onversionchange = () => { request.result.close(); database = undefined; }; resolve(request.result); };
    request.onerror = () => { database = undefined; reject(request.error ?? new Error("Draft storage unavailable.")); };
    request.onblocked = () => { database = undefined; reject(new Error("Close another outdated Publish tab to open draft storage.")); };
  });
  return database;
}
async function stored(key: string): Promise<string | undefined> {
  const database = await db();
  return new Promise((resolve, reject) => {
    const tx = database.transaction("drafts", "readonly");
    const request = tx.objectStore("drafts").get(key);
    tx.oncomplete = () => resolve(request.result);
    tx.onerror = tx.onabort = () => reject(tx.error ?? new Error("Draft read failed."));
  });
}
export async function readPublishDraft(key: string) {
  await writes.get(key)?.catch(() => undefined);
  const raw = await stored(key);
  return raw ?? localStorage.getItem(key);
}
function mutate(key: string, value?: string) {
  const next = (writes.get(key) ?? Promise.resolve()).catch(() => undefined).then(async () => {
    const database = await db();
    await new Promise<void>((resolve, reject) => {
      const tx = database.transaction("drafts", "readwrite");
      if (value === undefined) tx.objectStore("drafts").delete(key);
      else tx.objectStore("drafts").put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = tx.onabort = () => reject(tx.error ?? new Error("Draft save failed."));
    });
  });
  writes.set(key, next);
  void next.finally(() => { if (writes.get(key) === next) writes.delete(key); }).catch(() => undefined);
  return next;
}
export function writePublishDraft(key: string, value: unknown) { return mutate(key, JSON.stringify(value)); }
export async function removePublishDraft(key: string) { await mutate(key); localStorage.removeItem(key); }

// Preserve both drafts when connecting over an existing wallet draft. A quota
// or abort failure in either put rolls back both keys, never half a migration.
export function writePublishDraftPair(firstKey: string, firstValue: unknown, secondKey: string, secondValue: unknown) {
  if (firstKey === secondKey) return Promise.reject(new Error("Draft migration requires distinct scopes."));
  const first = JSON.stringify(firstValue), second = JSON.stringify(secondValue);
  const previous = [writes.get(firstKey), writes.get(secondKey)].filter(Boolean) as Promise<void>[];
  const next = Promise.all(previous.map(value => value.catch(() => undefined))).then(async () => {
    const database = await db();
    await new Promise<void>((resolve, reject) => {
      const tx = database.transaction("drafts", "readwrite");
      tx.oncomplete = () => resolve();
      tx.onerror = tx.onabort = () => reject(tx.error ?? new Error("Draft migration failed."));
      try {
        const store = tx.objectStore("drafts");
        store.put(first, firstKey); store.put(second, secondKey);
      } catch (error) { tx.abort(); reject(error); }
    });
  });
  writes.set(firstKey, next); writes.set(secondKey, next);
  void next.finally(() => {
    if (writes.get(firstKey) === next) writes.delete(firstKey);
    if (writes.get(secondKey) === next) writes.delete(secondKey);
  }).catch(() => undefined);
  return next;
}
