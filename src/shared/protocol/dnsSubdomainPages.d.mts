import type { DnsOwnershipEpoch, DnsSubdomainRootEvent } from "./dnsSubdomains.mjs";
import type { DnsPageLinkRoot } from "./dnsPages.mjs";
export type { DnsOwnershipEpoch } from "./dnsSubdomains.mjs";
export const DNS_SUBDOMAIN_PAGE_LINK_PREFIX: "pwdns1:subpage1:";
export const DNS_SUBDOMAIN_PAGE_LINK_SELF_PAYMENT_SATS: 546;
/** Livenet opening 970499; zero explicitly disables replay admission. */
export const DNS_SUBDOMAIN_PAGE_LINK_ACTIVATION_HEIGHT: number;
export const DNS_SUBDOMAIN_PAGE_LINK_PREDECESSOR_HASH: "00000000000000000001683a72df9a22322b2117aab9a1b264c5284045702d51";
export type DnsSubdomainPageLinkRecord = {
  action: "set"; parent: string; label: string; epoch: DnsOwnershipEpoch; child: DnsOwnershipEpoch; pageTxid: string;
} | {
  action: "clear"; parent: string; label: string; epoch: DnsOwnershipEpoch; child: DnsOwnershipEpoch; pageTxid?: never;
};
/** Complete accepted sub1 history with its original canonical position. */
export type DnsSubdomainPageAcceptedChildEvent = {
  action: "create" | "update"; parent: string; label: string; epoch: DnsOwnershipEpoch; resolver: string | null;
  txid: string; blockHeight: number; txIndex: number; protocolVout: number; recordOrdinal: number;
} | {
  action: "revoke"; parent: string; label: string; epoch: DnsOwnershipEpoch; resolver?: never;
  txid: string; blockHeight: number; txIndex: number; protocolVout: number; recordOrdinal: number;
};
export type DnsSubdomainPageLinkEvent = {
  payload: string; txid: string; blockHeight?: number | null; txIndex?: number | null;
  rawPayloadHex?: string; decodeValid?: boolean;
  protocolVout: number; recordOrdinal: number; subdomainPageLinkCarrierCount: number;
  inputAddresses: (string | null)[]; hasCoinbaseInput?: boolean;
  outputs: { vout: number; address: string | null; valueSats: number | string | bigint }[];
};
export type DnsSubdomainPageLinkState = {
  name: string; parent: string; label: string; pageTxid: string; ownerAddress: string;
  epoch: DnsOwnershipEpoch; child: DnsOwnershipEpoch;
  txid: string; blockHeight: number; txIndex: number; protocolVout: number; recordOrdinal: number;
  status: "active" | "replaced" | "cleared" | "invalidated";
  invalidationReason?: "root-ownership-change" | "subdomain-revoked";
  invalidatedByTxid?: string; invalidatedAtBlock?: number;
  replacedByTxid?: string; replacedAtBlock?: number; clearedByTxid?: string; clearedAtBlock?: number;
};
export type DnsSubdomainPageLinkChild = {
  name: string; parent: string; label: string; ownerAddress: string; epoch: DnsOwnershipEpoch;
  childLifecycle: DnsOwnershipEpoch; createdAtBlock: number; resolverOverride: string | null; resolverAddress: string;
  txid: string; blockHeight: number; txIndex: number; protocolVout: number; recordOrdinal: number; status: "active";
};
export type DnsSubdomainPageLinkHistory = {
  payload: string; rawPayloadHex?: string; decodeValid?: boolean;
  txid: string; blockHeight: number | null; txIndex: number | null; protocolVout: number; recordOrdinal: number;
  record: DnsSubdomainPageLinkRecord | null; valid: boolean; status: "accepted" | "rejected" | "pending";
  reason: string | null; state?: DnsSubdomainPageLinkState;
};
export type DnsSubdomainPageLinkReplay = {
  records: DnsSubdomainPageLinkState[]; roots: DnsPageLinkRoot[]; children: DnsSubdomainPageLinkChild[];
  history: DnsSubdomainPageLinkHistory[]; historicalRecords: DnsSubdomainPageLinkState[];
  pendingEvents: DnsSubdomainPageLinkHistory[];
};
export function normalizeDnsSubdomainPageLinkName(value: unknown): string;
export function dnsSubdomainPageLinkNameError(value: unknown): string;
export function buildDnsSubdomainPageLinkPayload(record: DnsSubdomainPageLinkRecord): string;
export function parseDnsSubdomainPageLinkPayload(payload: unknown): DnsSubdomainPageLinkRecord | null;
export function dnsSubdomainPageLinkSelfSendAuthor(event: DnsSubdomainPageLinkEvent, options?: { validateAddress?: (address: string) => boolean }): string | null;
export function replayDnsSubdomainPageLinks(options?: {
  rootEvents?: DnsSubdomainRootEvent[]; subdomainEvents?: DnsSubdomainPageAcceptedChildEvent[];
  pageLinkEvents?: DnsSubdomainPageLinkEvent[]; activationHeight?: number; validateAddress?: (address: string) => boolean;
}): DnsSubdomainPageLinkReplay;
