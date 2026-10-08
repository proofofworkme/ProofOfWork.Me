import type { DnsOwnershipEpoch } from "../../shared/protocol/dnsPages.mjs";
export type DnsPageLinkRoot = { id: string; network: string; confirmed: true; ownerAddress: string; receiveAddress: string; ownershipEpoch: DnsOwnershipEpoch; ownershipEpochBlockHeight: number };
export type DnsPageActiveLink = { name: string; network: string; pageTxid: string; txid: string; ownerAddress: string; epoch: DnsOwnershipEpoch; ownershipEpoch: DnsOwnershipEpoch; blockHeight: number; protocolVout: number; recordOrdinal: number; confirmed: true; status: "active"; active: true; valid: true };
export type DnsPageLinkSnapshot = { name: string; root: DnsPageLinkRoot; pageLink: DnsPageActiveLink | null; pageLinkPendingEvents: Array<{ valid?: boolean; name?: string; record?: { name?: string } | null }>; indexedThroughBlock: number; checkpointHash: string; admission: { ready: true; activationHeight: number; minSelfPaymentSats: number; protocolPrefix: string } };
export function sameDnsPageEpoch(left: unknown, right: unknown): boolean;
export function readDnsPageLinkSnapshot(value: unknown, requestedName: string, options: { network: string; validateAddress: (address: string) => boolean }): DnsPageLinkSnapshot;
export function assertDnsPageLinkAction(snapshot: DnsPageLinkSnapshot, request: { name: string; pageTxid: string | null }, address: string, expectedEpoch?: DnsOwnershipEpoch): DnsPageLinkRoot;
