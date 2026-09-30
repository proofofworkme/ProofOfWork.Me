export const ACTION_RECEIPTS_KEY = "proofofwork-action-receipts-v1";
export type ActionReceipt = {
  txid: string; address: string; network: "livenet" | "testnet" | "testnet4";
  title: string; key: string; createdAt: string;
  status: "unknown" | "pending" | "confirmed" | "dropped";
  fields: [string, string][];
};

// These local receipts aid recovery; they never establish ownership or balances.
export function readActionReceipts(storage: Storage): ActionReceipt[] {
  const raw = storage.getItem(ACTION_RECEIPTS_KEY);
  if (!raw) return [];
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed) || parsed.some(item => !item ||
    !/^[a-f0-9]{64}$/.test(item.txid) || typeof item.address !== "string" ||
    !["livenet", "testnet", "testnet4"].includes(item.network) ||
    !["unknown", "pending", "confirmed", "dropped"].includes(item.status) ||
    typeof item.title !== "string" || typeof item.key !== "string" ||
    typeof item.createdAt !== "string" || !Array.isArray(item.fields) ||
    item.fields.some((field: unknown) => !Array.isArray(field) || field.length !== 2 || field.some(value => typeof value !== "string")))) {
    throw new Error("Local transaction recovery records are unreadable. Preserve them before repairing local storage.");
  }
  return parsed;
}
export function saveActionReceipt(storage: Storage, receipt: ActionReceipt): ActionReceipt[] {
  const current = readActionReceipts(storage);
  const next = [receipt, ...current.filter(item => item.txid !== receipt.txid || item.network !== receipt.network)];
  storage.setItem(ACTION_RECEIPTS_KEY, JSON.stringify(next));
  if (storage.getItem(ACTION_RECEIPTS_KEY) !== JSON.stringify(next)) throw new Error("Transaction recovery record could not be saved. No broadcast was attempted.");
  return next;
}
