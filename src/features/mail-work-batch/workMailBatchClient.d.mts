export type WorkMailBatchStatus = { protocol: "work-mail-batch-v1"; network: "livenet"; active: boolean; writeEnabled: boolean; ready: boolean; reasonCode: string | null; declarationTxid: string | null; activationHeight: number | null; checkedTipHeight: number; checkedTipHash: string; registryFeeProofs: 546; limits: { minRecipients: 1; maxRecipients: 256; maxPayloadBytes: 65536 } };
export type MailRoute = { address: string; role: "To" | "CC"; label: string; id?: string };
export type WorkMailAttachmentPlan = { mode: "none" | "legacy" | "mailbatch1"; status?: WorkMailBatchStatus; payloads: string[]; registryFeeProofs: number; totalAmountSubatoms: string; recipientCount: number; feeLabel: string };
export const LEGACY_MAIL_WORK_MAX_RECIPIENTS: 10;
export function readWorkMailBatchStatus(value: unknown): WorkMailBatchStatus;
export function workMailAttachmentMode(value: unknown, previous?: WorkMailBatchStatus): { mode: "legacy" | "mailbatch1"; status: WorkMailBatchStatus };
export function canonicalMailRecipients(to: Array<{ paymentAddress: string; isId: boolean; displayRecipient: string; id?: string }>, cc: Array<{ paymentAddress: string; isId: boolean; displayRecipient: string; id?: string }>, network?: string): MailRoute[];
export function assertSameMailRoutes(previous: MailRoute[], fresh: MailRoute[]): void;
export function planWorkMailAttachment(options: { recipients: MailRoute[]; amountSubatoms: string; status?: unknown; previousStatus?: WorkMailBatchStatus; legacyPayload?: (address: string) => string; socialMode?: boolean; message?: string; parentTxid?: string; hasAttachment?: boolean }): WorkMailAttachmentPlan;
