import { encodePermissionRecord, normalizePermissionPolicy, permissionPolicyEnv, PERMISSION_ACTIONS, type PermissionAction, type PermissionPolicy, type PermissionMetadata } from "../../shared/protocol/permissions.mjs";
import { encodeTextBase64Url, sha256Hex } from "../../shared/utils/encoding";
import { dataCarrierBytesForPayload } from "../boost/boostWallet";

export type PermissionDraft = {
  action: "grant" | "replace" | "revoke"; grant: string; parent: string; label: string;
  signingEnabled: boolean; allowedActions: PermissionAction[]; maxTransactionProofs: string;
  dailyLimitProofs: string; recipientMode: "any" | "self" | "restricted";
  recipients: string; workEnabled: boolean; maxAmountSubatoms: string; minSaleProofs: string;
  maxPurchaseProofs: string; maxOpenListings: string; feeRate: number;
  feePolicyVersion?: 2; minerFeeRateProofsPerVbyte?: string; maxMinerFeeProofs?: string;
  legacyMaxMinerFeeProofs?: string; recoveryKey?: string;
};
export const emptyPermissionDraft: PermissionDraft = {
  action: "grant", grant: "", parent: "", label: "", signingEnabled: true,
  allowedActions: [...PERMISSION_ACTIONS], maxTransactionProofs: "5000", dailyLimitProofs: "30000",
  feePolicyVersion: 2, minerFeeRateProofsPerVbyte: "1",
  recipientMode: "any", recipients: "", workEnabled: false, maxAmountSubatoms: "0", minSaleProofs: "25000",
  maxPurchaseProofs: "25000", maxOpenListings: "1", feeRate: 1,
};
export type PermissionPlan = { draft: PermissionDraft; policy?: PermissionPolicy; metadata: PermissionMetadata; body: string; payloads: string[]; fields: [string, string][]; key: string };
export const PERMISSION_ACTION_LABELS = { grant: "Create permission grant", replace: "Replace permission grant", revoke: "Revoke permission grant" } as const;
const txidPattern = /^[a-f0-9]{64}$/u;
const recoveryKeyPattern = /^permission:(?:grant:[a-f0-9]{64}|root:[a-f0-9]{64}:[a-f0-9]{64})$/u;
function validPermissionLabel(value: string) {
  return Boolean(value.trim()) && value === value.trim() && new TextEncoder().encode(value).length <= 200 && !/[\u0000-\u001f\u007f-\u009f]/u.test(value);
}
function canonicalDraftRate(value: string) {
  if (!/^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,8})?$/u.test(value)) return value;
  return value.includes(".") ? value.replace(/0+$/u, "").replace(/\.$/u, "") : value;
}
function normalizedDraftPolicy(draft: PermissionDraft, feeTerms: { maxMinerFeeProofs: string } | { minerFeeRateProofsPerVbyte: string }) {
  if (!draft.allowedActions.length) throw new Error("Choose at least one allowed action.");
  const recipients = draft.recipients.split(/[\s,;]+/u).filter(Boolean);
  if (draft.recipientMode === "restricted" && !recipients.length) throw new Error("Enter at least one permitted recipient address.");
  if (draft.workEnabled && (!/^(?:0|[1-9][0-9]*)$/u.test(draft.maxOpenListings) || Number(draft.maxOpenListings) > 1000)) throw new Error("Maximum open listings must be a whole number from 0 to 1,000.");
  return normalizePermissionPolicy({ signingEnabled: draft.signingEnabled, allowedActions: draft.allowedActions,
    maxTransactionProofs: draft.maxTransactionProofs, dailyLimitProofs: draft.dailyLimitProofs, ...feeTerms,
    allowedRecipients: draft.recipientMode === "any" ? null : draft.recipientMode === "self" ? [] : recipients,
    workLimits: draft.workEnabled ? { maxAmountSubatoms: draft.maxAmountSubatoms, minSaleProofs: draft.minSaleProofs,
      maxPurchaseProofs: draft.maxPurchaseProofs, maxOpenListings: Number(draft.maxOpenListings) } : null });
}
export function legacyPermissionDraftRecoveryKey(draft: PermissionDraft): string | undefined {
  if (draft.feePolicyVersion !== undefined || typeof draft.maxMinerFeeProofs !== "string") return;
  if (draft.action !== "grant") return txidPattern.test(draft.grant) && txidPattern.test(draft.parent) ? `permission:root:${draft.grant}:${draft.parent}` : undefined;
  if (!validPermissionLabel(draft.label)) return;
  try {
    const policy = normalizedDraftPolicy(draft, { maxMinerFeeProofs: draft.maxMinerFeeProofs });
    if (!policy) return;
    const body = encodePermissionRecord("grant", { v: 1, network: "livenet", label: draft.label, policy });
    return body ? `permission:grant:${sha256Hex(new TextEncoder().encode(body))}` : undefined;
  } catch { return; }
}
export function permissionDraftWithRecoveryKey(draft: PermissionDraft): PermissionDraft {
  const recoveryKey = draft.recoveryKey ?? legacyPermissionDraftRecoveryKey(draft);
  return recoveryKey ? { ...draft, recoveryKey } : draft;
}
export function permissionDraftWithFeeRate(draft: PermissionDraft, value: string): PermissionDraft {
  const { maxMinerFeeProofs, ...retained } = permissionDraftWithRecoveryKey(draft);
  return { ...retained, feePolicyVersion: 2, minerFeeRateProofsPerVbyte: value,
    ...(typeof maxMinerFeeProofs === "string" ? { legacyMaxMinerFeeProofs: maxMinerFeeProofs } : {}) };
}
export function policyFromPermissionDraft(draft: PermissionDraft): PermissionPolicy {
  if (draft.feePolicyVersion !== 2 || !draft.minerFeeRateProofsPerVbyte) throw new Error("Choose an agent transaction fee rate to upgrade this legacy draft before publication. Its historical total miner-fee cap is not a fee rate.");
  const policy = normalizedDraftPolicy(draft, { minerFeeRateProofsPerVbyte: canonicalDraftRate(draft.minerFeeRateProofsPerVbyte) });
  if (!policy) throw new Error("Choose an agent fee rate of at least 0.1 proofs/vB with up to eight decimal places. Other permission limits must be exact whole numbers; WORK amount uses integer subatoms.");
  return policy;
}
export function buildPermissionPlan(draft: PermissionDraft): PermissionPlan {
  if (!["grant", "replace", "revoke"].includes(draft.action)) throw new Error("Unsupported permission action.");
  if (draft.action !== "grant" && (!txidPattern.test(draft.grant) || !txidPattern.test(draft.parent))) throw new Error("Select a current confirmed grant before replacing or revoking it.");
  if (draft.action !== "revoke" && !validPermissionLabel(draft.label)) throw new Error("Enter a trimmed permission label of up to 200 UTF-8 bytes without control characters.");
  const policy = draft.action === "revoke" ? undefined : policyFromPermissionDraft(draft);
  const metadata: PermissionMetadata = draft.action === "grant" ? { v: 2, network: "livenet", label: draft.label, policy }
    : draft.action === "replace" ? { v: 2, network: "livenet", grant: draft.grant, parent: draft.parent, label: draft.label, policy }
    : { v: 2, network: "livenet", grant: draft.grant, parent: draft.parent };
  const body = encodePermissionRecord(draft.action, metadata);
  if (!body) throw new Error("Permission metadata is outside the supported schema.");
  const payloads = [`pwm1:s:${encodeTextBase64Url(PERMISSION_ACTION_LABELS[draft.action])}`, `pwm1:m:${body}`];
  if (payloads.reduce((sum, payload) => sum + dataCarrierBytesForPayload(payload), 0) > 100000) throw new Error("The permission exceeds the on-chain record limit.");
  const fields: [string, string][] = [["Action", PERMISSION_ACTION_LABELS[draft.action]]];
  if (draft.grant) fields.push(["Original grant", draft.grant], ["Reviewed confirmed head", draft.parent]);
  if (policy) fields.push(["Label", draft.label], ["Permission terms", permissionPolicyEnv(policy)], ["Agent transaction fee rate", `${"minerFeeRateProofsPerVbyte" in policy ? policy.minerFeeRateProofsPerVbyte : "Unavailable"} proofs/vB · construction rate, rounded upward to whole proofs`], ["Daily reset", "00:00 UTC · spending and reservations survive replacement"], ["Expiry", "None"], ["Named agent", "None"]);
  fields.push(["Autonomous signing", "Closed until isolated controller and UniSat bridge are verified"]);
  return { draft: { ...draft, allowedActions: [...draft.allowedActions] }, policy, metadata, body, payloads, fields,
    key: draft.action === "grant" ? `permission:grant:${sha256Hex(new TextEncoder().encode(body))}` : `permission:root:${draft.grant}:${draft.parent}` };
}
export function permissionDraftFromPolicy(policy: PermissionPolicy, label: string, grant: string, parent: string): PermissionDraft {
  return { ...emptyPermissionDraft, action: "replace", grant, parent, label, signingEnabled: policy.signingEnabled,
    allowedActions: [...policy.allowedActions], maxTransactionProofs: policy.maxTransactionProofs, dailyLimitProofs: policy.dailyLimitProofs,
    minerFeeRateProofsPerVbyte: "minerFeeRateProofsPerVbyte" in policy ? policy.minerFeeRateProofsPerVbyte : "",
    ...("maxMinerFeeProofs" in policy ? { legacyMaxMinerFeeProofs: policy.maxMinerFeeProofs } : {}),
    recipientMode: policy.allowedRecipients === null ? "any" : policy.allowedRecipients.length ? "restricted" : "self",
    recipients: policy.allowedRecipients?.join("\n") ?? "", workEnabled: policy.workLimits !== null,
    ...(policy.workLimits ? { maxAmountSubatoms: policy.workLimits.maxAmountSubatoms, minSaleProofs: policy.workLimits.minSaleProofs,
      maxPurchaseProofs: policy.workLimits.maxPurchaseProofs, maxOpenListings: String(policy.workLimits.maxOpenListings) } : {}) };
}
export function isPermissionDraft(value: unknown): value is PermissionDraft {
  if (!value || typeof value !== "object") return false;
  const item = value as PermissionDraft;
  const rateShape = item.feePolicyVersion === 2 ? typeof item.minerFeeRateProofsPerVbyte === "string" && item.maxMinerFeeProofs === undefined
    : item.feePolicyVersion === undefined && typeof item.maxMinerFeeProofs === "string" && item.minerFeeRateProofsPerVbyte === undefined;
  return rateShape && (item.legacyMaxMinerFeeProofs === undefined || typeof item.legacyMaxMinerFeeProofs === "string") &&
    (item.recoveryKey === undefined || (typeof item.recoveryKey === "string" && recoveryKeyPattern.test(item.recoveryKey))) &&
    ["grant", "replace", "revoke"].includes(item.action) && ["any", "self", "restricted"].includes(item.recipientMode) &&
    [item.grant, item.parent, item.label, item.maxTransactionProofs, item.dailyLimitProofs, item.recipients,
      item.maxAmountSubatoms, item.minSaleProofs, item.maxPurchaseProofs, item.maxOpenListings].every(field => typeof field === "string") &&
    typeof item.signingEnabled === "boolean" && typeof item.workEnabled === "boolean" && Number.isFinite(item.feeRate) &&
    Array.isArray(item.allowedActions) && item.allowedActions.every(action => PERMISSION_ACTIONS.includes(action));
}
export function persistPermissionDraft(storage: Storage, key: string, draft: PermissionDraft) {
  const encoded = JSON.stringify(draft); storage.setItem(key, encoded);
  if (storage.getItem(key) !== encoded) throw new Error("Permission draft autosave could not be verified. Copy the fields before leaving.");
}
export function permissionDraftFields(draft: PermissionDraft): [string, string][] { return [["Permission draft", JSON.stringify(draft)]]; }
export function restorePermissionDraft(fields: [string, string][]): PermissionDraft | undefined {
  try { const value: unknown = JSON.parse(Object.fromEntries(fields)["Permission draft"] ?? "null"); return isPermissionDraft(value) ? value : undefined; } catch { return; }
}
