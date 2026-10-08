import { encodePermissionRecord, normalizePermissionPolicy, permissionPolicyEnv, PERMISSION_ACTIONS, type PermissionAction, type PermissionPolicy, type PermissionMetadata } from "../../shared/protocol/permissions.mjs";
import { encodeTextBase64Url, sha256Hex } from "../../shared/utils/encoding";
import { dataCarrierBytesForPayload } from "../boost/boostWallet";

export type PermissionDraft = {
  action: "grant" | "replace" | "revoke"; grant: string; parent: string; label: string;
  signingEnabled: boolean; allowedActions: PermissionAction[]; maxTransactionProofs: string;
  dailyLimitProofs: string; maxMinerFeeProofs: string; recipientMode: "any" | "self" | "restricted";
  recipients: string; workEnabled: boolean; maxAmountSubatoms: string; minSaleProofs: string;
  maxPurchaseProofs: string; maxOpenListings: string; feeRate: number;
};
export const emptyPermissionDraft: PermissionDraft = {
  action: "grant", grant: "", parent: "", label: "", signingEnabled: true,
  allowedActions: [...PERMISSION_ACTIONS], maxTransactionProofs: "5000", dailyLimitProofs: "30000", maxMinerFeeProofs: "1000",
  recipientMode: "any", recipients: "", workEnabled: false, maxAmountSubatoms: "0", minSaleProofs: "25000",
  maxPurchaseProofs: "25000", maxOpenListings: "1", feeRate: 1,
};
export type PermissionPlan = { draft: PermissionDraft; policy?: PermissionPolicy; metadata: PermissionMetadata; body: string; payloads: string[]; fields: [string, string][]; key: string };
export const PERMISSION_ACTION_LABELS = { grant: "Create permission grant", replace: "Replace permission grant", revoke: "Revoke permission grant" } as const;
const txidPattern = /^[a-f0-9]{64}$/u;
export function policyFromPermissionDraft(draft: PermissionDraft): PermissionPolicy {
  if (!draft.allowedActions.length) throw new Error("Choose at least one allowed action.");
  const recipients = draft.recipients.split(/[\s,;]+/u).filter(Boolean);
  if (draft.recipientMode === "restricted" && !recipients.length) throw new Error("Enter at least one permitted recipient address.");
  if (draft.workEnabled && (!/^(?:0|[1-9][0-9]*)$/u.test(draft.maxOpenListings) || Number(draft.maxOpenListings) > 1000)) throw new Error("Maximum open listings must be a whole number from 0 to 1,000.");
  const policy = normalizePermissionPolicy({ signingEnabled: draft.signingEnabled, allowedActions: draft.allowedActions,
    maxTransactionProofs: draft.maxTransactionProofs, dailyLimitProofs: draft.dailyLimitProofs, maxMinerFeeProofs: draft.maxMinerFeeProofs,
    allowedRecipients: draft.recipientMode === "any" ? null : draft.recipientMode === "self" ? [] : recipients,
    workLimits: draft.workEnabled ? { maxAmountSubatoms: draft.maxAmountSubatoms, minSaleProofs: draft.minSaleProofs,
      maxPurchaseProofs: draft.maxPurchaseProofs, maxOpenListings: Number(draft.maxOpenListings) } : null });
  if (!policy) throw new Error("Permission limits must be exact whole numbers within supported bounds. WORK amount uses integer subatoms.");
  return policy;
}
export function buildPermissionPlan(draft: PermissionDraft): PermissionPlan {
  if (!["grant", "replace", "revoke"].includes(draft.action)) throw new Error("Unsupported permission action.");
  if (draft.action !== "grant" && (!txidPattern.test(draft.grant) || !txidPattern.test(draft.parent))) throw new Error("Select a current confirmed grant before replacing or revoking it.");
  if (draft.action !== "revoke" && (!draft.label.trim() || draft.label !== draft.label.trim() || new TextEncoder().encode(draft.label).length > 200 || /[\u0000-\u001f\u007f-\u009f]/u.test(draft.label))) throw new Error("Enter a trimmed permission label of up to 200 UTF-8 bytes without control characters.");
  const policy = draft.action === "revoke" ? undefined : policyFromPermissionDraft(draft);
  const metadata: PermissionMetadata = draft.action === "grant" ? { v: 1, network: "livenet", label: draft.label, policy }
    : draft.action === "replace" ? { v: 1, network: "livenet", grant: draft.grant, parent: draft.parent, label: draft.label, policy }
    : { v: 1, network: "livenet", grant: draft.grant, parent: draft.parent };
  const body = encodePermissionRecord(draft.action, metadata);
  if (!body) throw new Error("Permission metadata is outside the supported version-one schema.");
  const payloads = [`pwm1:s:${encodeTextBase64Url(PERMISSION_ACTION_LABELS[draft.action])}`, `pwm1:m:${body}`];
  if (payloads.reduce((sum, payload) => sum + dataCarrierBytesForPayload(payload), 0) > 100000) throw new Error("The permission exceeds the on-chain record limit.");
  const fields: [string, string][] = [["Action", PERMISSION_ACTION_LABELS[draft.action]]];
  if (draft.grant) fields.push(["Original grant", draft.grant], ["Reviewed confirmed head", draft.parent]);
  if (policy) fields.push(["Label", draft.label], ["Permission terms", permissionPolicyEnv(policy)], ["Daily reset", "00:00 UTC · spending and reservations survive replacement"], ["Expiry", "None"], ["Named agent", "None"]);
  fields.push(["Autonomous signing", "Closed until isolated controller and UniSat bridge are verified"]);
  return { draft: { ...draft, allowedActions: [...draft.allowedActions] }, policy, metadata, body, payloads, fields,
    key: draft.action === "grant" ? `permission:grant:${sha256Hex(new TextEncoder().encode(body))}` : `permission:root:${draft.grant}:${draft.parent}` };
}
export function permissionDraftFromPolicy(policy: PermissionPolicy, label: string, grant: string, parent: string): PermissionDraft {
  return { ...emptyPermissionDraft, action: "replace", grant, parent, label, signingEnabled: policy.signingEnabled,
    allowedActions: [...policy.allowedActions], maxTransactionProofs: policy.maxTransactionProofs, dailyLimitProofs: policy.dailyLimitProofs,
    maxMinerFeeProofs: policy.maxMinerFeeProofs, recipientMode: policy.allowedRecipients === null ? "any" : policy.allowedRecipients.length ? "restricted" : "self",
    recipients: policy.allowedRecipients?.join("\n") ?? "", workEnabled: policy.workLimits !== null,
    ...(policy.workLimits ? { maxAmountSubatoms: policy.workLimits.maxAmountSubatoms, minSaleProofs: policy.workLimits.minSaleProofs,
      maxPurchaseProofs: policy.workLimits.maxPurchaseProofs, maxOpenListings: String(policy.workLimits.maxOpenListings) } : {}) };
}
export function isPermissionDraft(value: unknown): value is PermissionDraft {
  if (!value || typeof value !== "object") return false;
  const item = value as PermissionDraft;
  return ["grant", "replace", "revoke"].includes(item.action) && ["any", "self", "restricted"].includes(item.recipientMode) &&
    [item.grant, item.parent, item.label, item.maxTransactionProofs, item.dailyLimitProofs, item.maxMinerFeeProofs, item.recipients,
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
