export type PermissionAction = 'mail.send' | 'boost.post' | 'amo.listwork' | 'amo.sealwork' | 'amo.buywork' | 'publish.article';
export type PermissionRecordAction = 'grant' | 'replace' | 'revoke';
export interface PermissionWorkLimits { maxAmountSubatoms: string; minSaleProofs: string; maxPurchaseProofs: string; maxOpenListings: number }
export interface PermissionPolicy { signingEnabled: boolean; allowedActions: PermissionAction[]; maxTransactionProofs: string; dailyLimitProofs: string; maxMinerFeeProofs: string; allowedRecipients: string[] | null; workLimits: PermissionWorkLimits | null }
export interface PermissionMetadata { v: 1; network: 'livenet'; grant?: string; parent?: string; label?: string; policy?: PermissionPolicy }
export const PERMISSION_BODY_PREFIX: string;
export const PERMISSION_VERSION: number;
export const PERMISSION_ACTIVATION_HEIGHT: number;
export const PERMISSION_ACTIVATION_PREVIOUS_BLOCK_HASH: string;
export const PERMISSION_MAX_METADATA_BYTES: number;
export const PERMISSION_MIN_SELF_PAYMENT_PROOFS: string;
export const PERMISSION_ACTIONS: readonly PermissionAction[];
export const PERMISSION_WORK_ASSET: string;
export function normalizePermissionPolicy(value: unknown): PermissionPolicy | null;
export function encodePermissionRecord(action: PermissionRecordAction, value: PermissionMetadata): string;
export function parsePermissionBody(body: string): { action: PermissionRecordAction; metadata: PermissionMetadata } | null;
export function permissionPolicyEnv(value: PermissionPolicy): string;
