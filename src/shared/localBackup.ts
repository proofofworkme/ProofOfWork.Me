export const BACKUP_KEYS = {
  sent: "proofofwork.sent.v5", preferences: "proofofwork.mailPrefs.v1",
  contacts: "proofofwork.contacts.v1", folders: "proofofwork.customFolders.v1",
  draftPrefix: "proofofwork.draft.v1",
};
export function isBackupStorageKey(key: string) {
  return Object.values(BACKUP_KEYS).filter(value => value !== BACKUP_KEYS.draftPrefix).includes(key) || key.startsWith(`${BACKUP_KEYS.draftPrefix}:`);
}
export type BackupData = Record<string, string>;
export type RestorePlan = { data: BackupData; previous: Record<string, string | null> };
type LocalStorageAccess = Pick<Storage, "length" | "key" | "getItem" | "setItem" | "removeItem">;

function currentSnapshot(storage: LocalStorageAccess): Record<string, string | null> {
  const snapshot: Record<string, string | null> = {};
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index);
    if (key && isBackupStorageKey(key)) snapshot[key] = storage.getItem(key);
  }
  return snapshot;
}
export function prepareLocalRestore(storage: LocalStorageAccess, data: BackupData): RestorePlan {
  if (Object.keys(data).some(key => !isBackupStorageKey(key))) throw new Error("Unsupported restore key.");
  const previous = currentSnapshot(storage);
  Object.keys(data).forEach(key => { previous[key] ??= null; });
  return { data: { ...data }, previous };
}
export class LocalRestoreError extends Error {
  constructor(message: string, readonly unrecoveredKeys: string[] = []) { super(message); }
}
export function applyLocalRestore(storage: LocalStorageAccess, plan: RestorePlan) {
  const current = currentSnapshot(storage);
  const keys = new Set([...Object.keys(current), ...Object.keys(plan.previous)]);
  if ([...keys].some(key => (current[key] ?? null) !== (plan.previous[key] ?? null))) {
    throw new LocalRestoreError("Local data changed after this preview. Choose the backup again to review current replacements.");
  }
  const attempted: string[] = [];
  try {
    for (const [key, value] of Object.entries(plan.data)) {
      if (!isBackupStorageKey(key)) throw new Error("Unsupported restore key.");
      attempted.push(key);
      storage.setItem(key, value);
    }
  } catch {
    const unrecoveredKeys: string[] = [];
    for (const key of attempted.reverse()) {
      try {
        const before = plan.previous[key];
        if (before === null || before === undefined) storage.removeItem(key);
        else storage.setItem(key, before);
      } catch { unrecoveredKeys.push(key); }
    }
    throw new LocalRestoreError(unrecoveredKeys.length
      ? `Restore failed; recovery is incomplete for: ${unrecoveredKeys.join(", ")}. Keep this backup and export current local data before another restore.`
      : "Restore failed. Previous local data was recovered; no groups were restored.", unrecoveredKeys);
  }
}
export function backupGroupLabel(key: string) {
  if (key === BACKUP_KEYS.sent) return "Sent / outbox tracking";
  if (key === BACKUP_KEYS.preferences) return "Mail preferences and memberships";
  if (key === BACKUP_KEYS.contacts) return "Contacts";
  if (key === BACKUP_KEYS.folders) return "Custom folders";
  return `Draft · ${key.slice(BACKUP_KEYS.draftPrefix.length + 1)}`;
}
export function backupEntryCount(value: string | null | undefined): string {
  if (value == null) return "Absent";
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return `${parsed.length} record${parsed.length === 1 ? "" : "s"}`;
    if (parsed && typeof parsed === "object") {
      const count = Object.keys(parsed).length;
      return `${count} field${count === 1 ? "" : "s"}`;
    }
    return "Unrecognized data";
  } catch { return "Unreadable data"; }
}
