import { fetchProofApiJson } from "../../shared/api/proofApiClient";
import type { BitcoinNetwork } from "../../shared/bitcoin/networks";
import { normalizePermissionPolicy, parsePermissionBody, PERMISSION_ACTIVATION_HEIGHT, PERMISSION_ACTIVATION_PREVIOUS_BLOCK_HASH, PERMISSION_MIN_SELF_PAYMENT_PROOFS, PERMISSION_FEE_RATE_ACTIVATION_HEIGHT, PERMISSION_FEE_RATE_ACTIVATION_PREVIOUS_BLOCK_HASH, type PermissionPolicy, type PermissionMetadata } from "../../shared/protocol/permissions.mjs";

export const PERMISSION_TXID = /^[a-f0-9]{64}$/u;
export type PermissionRecord = {
  txid: string; rootTxid: string; headTxid: string; walletAddress: string; label: string;
  status: "active" | "revoked" | "replaced"; policy: PermissionPolicy; blockHeight: number;
  blockHash?: string; blockTime?: number | string | null; currentStatusVerified?: boolean;
};
export type PermissionEvent = {
  txid: string; action: "grant" | "replace" | "revoke" | "invalid"; walletAddress?: string;
  authorAddress?: string; confirmed?: boolean; valid?: boolean; applied?: boolean;
  blockHeight?: number; reason?: string; validationErrors?: string[];
};
export type PermissionCoverage = { complete: boolean; indexedThroughBlock?: number; indexedThroughBlockHash?: string; checkpointHeight?: number; checkpointHash?: string; witnessHash?: string; [key: string]: unknown };
export type PermissionEvidence = { network: BitcoinNetwork; complete: boolean; source?: string; coverage: PermissionCoverage;
  admission: { ready: boolean; writesEnabled?: boolean; autonomousSigningEnabled?: boolean; activationHeight?: number; activationPreviousBlockHash?: string; minimumSelfPaymentProofs?: string; reason?: string | null; reasonCode?: string; [key: string]: unknown };
  budget?: { available: boolean; reason?: string; spentProofs?: string; committedProofs?: string; remainingProofs?: string };
  currentStatusVerified?: boolean; [key: string]: unknown;
};
export type PermissionList = PermissionEvidence & { permissions: PermissionRecord[]; pagination?: { hasMore: boolean; nextCursor?: string | null; total?: number } };
export type PermissionDetail = PermissionEvidence & { permission: PermissionRecord; currentPermission?: PermissionRecord; events: PermissionEvent[]; eventsComplete?: boolean };
export type PermissionInspection = { network: BitcoinNetwork; complete: false; currentStatusVerified: false; authorityVerified: boolean;
  source: "first-party-raw-permission-record"; record: PermissionEvent & { walletAddress: string; metadata: PermissionMetadata; rawBody: string; rootTxid: string; parentTxid: string; selfPaymentProofs: string; valid: boolean; confirmed: boolean; blockHeight: number } };
function assertRecord(value: PermissionRecord) {
  if (!value || !PERMISSION_TXID.test(value.txid) || !PERMISSION_TXID.test(value.rootTxid) || !PERMISSION_TXID.test(value.headTxid) ||
    typeof value.walletAddress !== "string" || !value.walletAddress || typeof value.label !== "string" ||
    !["active", "revoked", "replaced"].includes(value.status) || !Number.isSafeInteger(value.blockHeight) || value.blockHeight < 0 || !normalizePermissionPolicy(value.policy)) {
    throw new Error("Permission wallet, terms, or history evidence is incomplete.");
  }
}
export function permissionCheckpoint(value: PermissionEvidence) {
  return { height: value.coverage.indexedThroughBlock ?? value.coverage.checkpointHeight,
    hash: value.coverage.indexedThroughBlockHash ?? value.coverage.checkpointHash };
}
export function hasVerifiedPermissionHistory(value: PermissionEvidence) {
  const checkpoint = permissionCheckpoint(value);
  return value.complete === true && value.source === "proof-indexer-exact-canonical-permission-replay" && value.coverage?.complete === true && value.currentStatusVerified !== false &&
    Number.isSafeInteger(checkpoint.height) && Number(checkpoint.height) >= 0 && typeof checkpoint.hash === "string" && PERMISSION_TXID.test(checkpoint.hash);
}
export function permissionPublicationReady(value: PermissionEvidence, version = 1) {
  const checkpoint = permissionCheckpoint(value);
  const rateReady = version === 1 || (version === 2 && PERMISSION_FEE_RATE_ACTIVATION_HEIGHT > 0 && Number.isSafeInteger(checkpoint.height) && Number(checkpoint.height) >= PERMISSION_FEE_RATE_ACTIVATION_HEIGHT && Array.isArray(value.admission.supportedRecordVersions) && value.admission.supportedRecordVersions.includes(2) && value.admission.feeRatePolicyReady === true &&
    value.admission.feeRateActivationHeight === PERMISSION_FEE_RATE_ACTIVATION_HEIGHT && value.admission.feeRateActivationPreviousBlockHash === PERMISSION_FEE_RATE_ACTIVATION_PREVIOUS_BLOCK_HASH);
  return rateReady && hasVerifiedPermissionHistory(value) && PERMISSION_ACTIVATION_HEIGHT > 0 && value.admission.ready === true && value.admission.writesEnabled === true &&
    value.admission.activationHeight === PERMISSION_ACTIVATION_HEIGHT && value.coverage.activationHeight === PERMISSION_ACTIVATION_HEIGHT &&
    value.admission.activationPreviousBlockHash === PERMISSION_ACTIVATION_PREVIOUS_BLOCK_HASH && value.admission.minimumSelfPaymentProofs === PERMISSION_MIN_SELF_PAYMENT_PROOFS &&
    value.admission.autonomousSigningEnabled === false;
}
function assertEvidence(value: PermissionEvidence, network: BitcoinNetwork, requireComplete: boolean) {
  if (!value || value.network !== network || typeof value.complete !== "boolean" || !value.coverage || typeof value.coverage.complete !== "boolean" ||
    !value.admission || typeof value.admission.ready !== "boolean" || (requireComplete && !hasVerifiedPermissionHistory(value))) throw new Error("Complete confirmed Permission evidence is unavailable. Refresh before continuing.");
}
export async function fetchPermissions(network: BitcoinNetwork, params: { address?: string; fresh?: boolean; cursor?: string; signal?: AbortSignal } = {}) {
  const query = new URLSearchParams({ limit: "30" });
  if (params.address) query.set("address", params.address);
  if (params.fresh) query.set("fresh", "1");
  if (params.cursor) query.set("cursor", params.cursor);
  const value = await fetchProofApiJson<PermissionList>(`/api/v1/permissions?${query}`, network, { signal: params.signal });
  assertEvidence(value, network, true);
  if (!Array.isArray(value.permissions) || (value.pagination?.hasMore && !value.pagination.nextCursor)) throw new Error("Complete permission inventory is unavailable.");
  value.permissions.forEach(assertRecord);
  if (new Set(value.permissions.map(item => item.rootTxid)).size !== value.permissions.length) throw new Error("Permission inventory contains duplicate roots.");
  return value;
}
export async function fetchPermission(network: BitcoinNetwork, permission: string, params: { fresh?: boolean; signal?: AbortSignal; requireComplete?: boolean } = {}) {
  if (!PERMISSION_TXID.test(permission)) throw new Error("Enter a 64-character lowercase permission transaction ID.");
  const query = new URLSearchParams({ permission });
  if (params.fresh) query.set("fresh", "1");
  const value = await fetchProofApiJson<PermissionDetail>(`/api/v1/permission?${query}`, network, { signal: params.signal });
  assertEvidence(value, network, params.requireComplete ?? false); assertRecord(value.permission);
  if (value.permission.txid !== permission || !Array.isArray(value.events)) throw new Error("Returned permission evidence differs from the requested transaction.");
  if (value.currentPermission) {
    assertRecord(value.currentPermission);
    if (value.currentPermission.rootTxid !== value.permission.rootTxid || value.currentPermission.walletAddress !== value.permission.walletAddress) throw new Error("Permission history has inconsistent wallet authority.");
  }
  if (hasVerifiedPermissionHistory(value) && (value.currentStatusVerified !== true || value.eventsComplete !== true || !value.currentPermission)) throw new Error("The complete current permission lifecycle is unavailable.");
  for (const event of value.events) if (!event || !PERMISSION_TXID.test(event.txid) || !["grant", "replace", "revoke", "invalid"].includes(event.action) || (event.applied && (!event.valid || event.confirmed === false))) throw new Error("Permission lifecycle evidence is incomplete.");
  return value;
}
export async function fetchPermissionInspection(network: BitcoinNetwork, txid: string, params: { signal?: AbortSignal } = {}) {
  if (!PERMISSION_TXID.test(txid)) throw new Error("Enter a 64-character lowercase permission transaction ID.");
  const query = new URLSearchParams({ txid, inspect: "1" });
  const value = await fetchProofApiJson<PermissionInspection>(`/api/v1/permission?${query}`, network, { signal: params.signal });
  if (value.network !== network || value.complete !== false || value.currentStatusVerified !== false || value.source !== "first-party-raw-permission-record" ||
    typeof value.authorityVerified !== "boolean" || value.record?.txid !== txid || typeof value.record.walletAddress !== "string" ||
    !Number.isSafeInteger(value.record.blockHeight) || !value.record.confirmed || typeof value.record.valid !== "boolean" ||
    !Array.isArray(value.record.validationErrors) || typeof value.record.rawBody !== "string") throw new Error("Confirmed raw permission evidence is unavailable.");
  const parsed = parsePermissionBody(value.record.rawBody);
  if (!parsed || parsed.action !== value.record.action || JSON.stringify(parsed.metadata) !== JSON.stringify(value.record.metadata) ||
    (value.authorityVerified && (!value.record.valid || !value.record.walletAddress))) throw new Error("Raw permission terms or authorizing-wallet evidence are inconsistent.");
  return value;
}
