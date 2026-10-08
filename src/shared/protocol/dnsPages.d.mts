import type { DnsOwnershipEpoch, DnsSubdomainRootEvent } from "./dnsSubdomains.mjs";
export type { DnsOwnershipEpoch } from "./dnsSubdomains.mjs";
export const DNS_PAGE_LINK_PREFIX: "pwdns1:page1:";
export const DNS_PAGE_LINK_SELF_PAYMENT_SATS: 546;
/** Livenet opening 970426; zero remains available only as an explicit replay-disable option. */
export const DNS_PAGE_LINK_ACTIVATION_HEIGHT: number;
export type DnsPageLinkRecord = {
  action: "set"; name: string; epoch: DnsOwnershipEpoch; pageTxid: string;
} | {
  action: "clear"; name: string; epoch: DnsOwnershipEpoch; pageTxid?: never;
};
export type DnsPageLinkOptions = { validateAddress?: (address: string) => boolean };
export type DnsPageLinkEvent = {
  payload: string; txid: string; blockHeight?: number | null; txIndex?: number | null;
  rawPayloadHex?: string; decodeValid?: boolean;
  protocolVout: number; recordOrdinal: number; pageLinkCarrierCount: number;
  inputAddresses: (string | null)[]; hasCoinbaseInput?: boolean;
  outputs: { vout: number; address: string | null; valueSats: number | string | bigint }[];
};
export type DnsPageLinkState = {
  name: string; id: string; pageTxid: string; ownerAddress: string; epoch: DnsOwnershipEpoch;
  txid: string; blockHeight: number; txIndex: number; protocolVout: number; recordOrdinal: number;
  status: "active" | "replaced" | "cleared" | "invalidated";
  invalidatedByTxid?: string; invalidatedAtBlock?: number;
  replacedByTxid?: string; replacedAtBlock?: number; clearedByTxid?: string; clearedAtBlock?: number;
};
export type DnsPageLinkRoot = {
  name: string; id: string; ownerAddress: string; resolverAddress: string;
  ownershipEpoch: DnsOwnershipEpoch; ownershipEpochBlockHeight: number;
};
export type DnsPageLinkHistory = {
  payload: string; rawPayloadHex?: string; decodeValid?: boolean;
  txid: string; blockHeight: number | null; txIndex: number | null; protocolVout: number; recordOrdinal: number;
  record: DnsPageLinkRecord | null; valid: boolean; status: "accepted" | "rejected" | "pending";
  reason: string | null; state?: DnsPageLinkState;
};
export type DnsPageLinkReplay = {
  records: DnsPageLinkState[]; roots: DnsPageLinkRoot[]; history: DnsPageLinkHistory[];
  historicalRecords: DnsPageLinkState[]; pendingEvents: DnsPageLinkHistory[];
};
export function normalizeDnsPageLinkName(value: unknown): string;
export function dnsPageLinkNameError(value: unknown): string;
export function buildDnsPageLinkPayload(record: DnsPageLinkRecord): string;
export function parseDnsPageLinkPayload(payload: unknown): DnsPageLinkRecord | null;
export function dnsPageLinkSelfSendAuthor(event: DnsPageLinkEvent, options?: DnsPageLinkOptions): string | null;
export function replayDnsPageLinks(options?: {
  rootEvents?: DnsSubdomainRootEvent[]; pageLinkEvents?: DnsPageLinkEvent[];
  activationHeight?: number; validateAddress?: (address: string) => boolean;
}): DnsPageLinkReplay;
