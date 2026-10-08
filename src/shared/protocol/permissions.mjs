/** Permission v1 is public policy data. It never supplies a wallet credential. */
export const PERMISSION_BODY_PREFIX = "pwperm1:";
export const PERMISSION_VERSION = 1;
// First admission is pinned to an independently reviewed Core parent. No wallet operation established this boundary.
export const PERMISSION_ACTIVATION_HEIGHT = 970_492;
export const PERMISSION_ACTIVATION_PREVIOUS_BLOCK_HASH = "00000000000000000000c4a4a4121cb0fece4308ecee0003de2da0e5bdc7a3d1";
export const PERMISSION_MAX_METADATA_BYTES = 8_192;
export const PERMISSION_MIN_SELF_PAYMENT_PROOFS = "546";
export const PERMISSION_ACTIONS = Object.freeze([
  "mail.send", "boost.post", "amo.listwork", "amo.sealwork", "amo.buywork", "publish.article",
]);
export const PERMISSION_WORK_ASSET = "d4e5ebf11d104d6a63fb74e42094364b25a5f7199a09e5c0e71408972466a8b8";
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const TXID = /^[0-9a-f]{64}$/u;
const PROOFS_MAX = 2_100_000_000_000_000n;
const WORK_MAX = 210_000_000_000_000_000_000_000n;
const record = value => value !== null && typeof value === "object" && !Array.isArray(value);
const keys = (value, names) => record(value) && Object.keys(value).length === names.length && names.every(name => Object.hasOwn(value, name));
const bounded = (value, maximum) => typeof value === "string" && /^(?:0|[1-9]\d*)$/u.test(value) && value.length <= 30 && BigInt(value) <= maximum;
function addresses(value) {
  if (value === null) return null;
  if (!Array.isArray(value) || value.length > 100 || value.some(address => typeof address !== "string" ||
      !/^(?:[13][1-9A-HJ-NP-Za-km-z]{25,34}|bc1[a-z0-9]{11,87})$/u.test(address)) || new Set(value).size !== value.length) return undefined;
  return [...value].sort();
}
export function normalizePermissionPolicy(value) {
  if (!keys(value, ["signingEnabled", "allowedActions", "maxTransactionProofs", "dailyLimitProofs", "maxMinerFeeProofs", "allowedRecipients", "workLimits"]) ||
      typeof value.signingEnabled !== "boolean" || !Array.isArray(value.allowedActions) ||
      value.allowedActions.some(action => !PERMISSION_ACTIONS.includes(action)) || new Set(value.allowedActions).size !== value.allowedActions.length ||
      !bounded(value.maxTransactionProofs, PROOFS_MAX) || !bounded(value.dailyLimitProofs, PROOFS_MAX) || !bounded(value.maxMinerFeeProofs, PROOFS_MAX) ||
      BigInt(value.maxTransactionProofs) > BigInt(value.dailyLimitProofs) || BigInt(value.maxMinerFeeProofs) > BigInt(value.maxTransactionProofs)) return null;
  const allowedRecipients = addresses(value.allowedRecipients);
  if (allowedRecipients === undefined) return null;
  let workLimits = null;
  if (value.workLimits !== null) {
    const work = value.workLimits;
    if (!keys(work, ["maxAmountSubatoms", "minSaleProofs", "maxPurchaseProofs", "maxOpenListings"]) ||
        !bounded(work.maxAmountSubatoms, WORK_MAX) || !bounded(work.minSaleProofs, PROOFS_MAX) || !bounded(work.maxPurchaseProofs, PROOFS_MAX) ||
        !Number.isSafeInteger(work.maxOpenListings) || work.maxOpenListings < 0 || work.maxOpenListings > 1000) return null;
    workLimits = { maxAmountSubatoms: work.maxAmountSubatoms, minSaleProofs: work.minSaleProofs,
      maxPurchaseProofs: work.maxPurchaseProofs, maxOpenListings: work.maxOpenListings };
  }
  return { signingEnabled: value.signingEnabled, allowedActions: [...value.allowedActions].sort(),
    maxTransactionProofs: value.maxTransactionProofs, dailyLimitProofs: value.dailyLimitProofs,
    maxMinerFeeProofs: value.maxMinerFeeProofs, allowedRecipients, workLimits };
}
function normalizeMetadata(action, value) {
  const names = ["v", "network", ...(action === "grant" ? [] : ["grant", "parent"]), ...(action === "revoke" ? [] : ["label", "policy"])];
  if (!["grant", "replace", "revoke"].includes(action) || !keys(value, names) || value.v !== 1 || value.network !== "livenet" ||
      (action !== "grant" && (!TXID.test(value.grant) || !TXID.test(value.parent)))) return null;
  const base = { v: 1, network: "livenet", ...(action === "grant" ? {} : { grant: value.grant, parent: value.parent }) };
  if (action === "revoke") return base;
  if (typeof value.label !== "string" || encoder.encode(value.label).length > 200 || value.label.trim() !== value.label || /[\u0000-\u001f\u007f-\u009f]/u.test(value.label)) return null;
  try { if (decoder.decode(encoder.encode(value.label)) !== value.label) return null; } catch { return null; }
  const policy = normalizePermissionPolicy(value.policy);
  return policy ? { ...base, label: value.label, policy } : null;
}
function b64(bytes) {
  let binary = ""; for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/u, "");
}
export function encodePermissionRecord(action, value) {
  const metadata = normalizeMetadata(action, value);
  if (!metadata) throw new Error("Invalid Permission v1 metadata.");
  const bytes = encoder.encode(JSON.stringify(metadata));
  if (bytes.length > PERMISSION_MAX_METADATA_BYTES) throw new Error("Permission metadata exceeds its byte budget.");
  return `${PERMISSION_BODY_PREFIX}${action}:${b64(bytes)}`;
}
/** Exact canonical UTF-8 JSON, closed keys, sorted sets, decimal strings and base64url. */
export function parsePermissionBody(body) {
  if (typeof body !== "string") return null;
  const match = /^pwperm1:(grant|replace|revoke):([A-Za-z0-9_-]+)$/u.exec(body);
  if (!match || match[2].length > Math.ceil(PERMISSION_MAX_METADATA_BYTES * 4 / 3)) return null;
  try {
    const binary = atob(match[2].replace(/-/gu, "+").replace(/_/gu, "/"));
    const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
    if (bytes.length > PERMISSION_MAX_METADATA_BYTES || b64(bytes) !== match[2]) return null;
    const json = decoder.decode(bytes), metadata = normalizeMetadata(match[1], JSON.parse(json));
    return metadata && JSON.stringify(metadata) === json ? { action: match[1], metadata } : null;
  } catch { return null; }
}
/** Display/export data only. Never evaluate or shell-source public records. */
export function permissionPolicyEnv(value) {
  const policy = normalizePermissionPolicy(value);
  if (!policy) throw new Error("Invalid Permission v1 policy.");
  return [
    `AGENT_SIGNING_ENABLED=${policy.signingEnabled}`,
    `AGENT_ALLOWED_ACTIONS=${policy.allowedActions.join(",")}`,
    `AGENT_MAX_TRANSACTION_PROOFS=${policy.maxTransactionProofs}`,
    `AGENT_DAILY_LIMIT_PROOFS=${policy.dailyLimitProofs}`,
    `AGENT_MAX_MINER_FEE_PROOFS=${policy.maxMinerFeeProofs}`,
    "AGENT_DAILY_RESET=UTC",
    `AGENT_ALLOWED_RECIPIENTS=${policy.allowedRecipients === null ? "any" : policy.allowedRecipients.length ? policy.allowedRecipients.join(",") : "self"}`,
    `AGENT_WORK_LIMITS=${JSON.stringify(policy.workLimits)}`,
  ].join("\n");
}
