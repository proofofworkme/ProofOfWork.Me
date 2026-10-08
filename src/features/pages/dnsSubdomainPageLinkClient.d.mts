import type { DnsOwnershipEpoch } from "../../shared/protocol/dnsSubdomainPages.mjs";
import type { DnsPageLinkRoot } from "./dnsPageLinkClient.mjs";
export type DnsSubdomainPageClientChild = {
  name: string; parent: string; label: string; network: string; confirmed: true; active: true; status: "active";
  ownerAddress: string; receiveAddress: string; resolver: string | null; epoch: DnsOwnershipEpoch;
  childLifecycle: DnsOwnershipEpoch; createdTxid: string; createdAtBlock: number; txid: string; updatedTxid?: string;
};
export type DnsSubdomainPageActiveLink = {
  name: string; parent: string; label: string; network: string; pageTxid: string; txid: string;
  ownerAddress: string; epoch: DnsOwnershipEpoch; child: DnsOwnershipEpoch;
  blockHeight: number; protocolVout: number; recordOrdinal: number; confirmed: true; status: "active"; active: true; valid: true;
};
export type DnsSubdomainPageClientPending = {
  valid?: boolean; name?: string; record?: { parent: string; label: string; epoch: DnsOwnershipEpoch; child: DnsOwnershipEpoch } | null;
};
export type DnsSubdomainPageLinkSnapshot = {
  name: string; root: DnsPageLinkRoot; child: DnsSubdomainPageClientChild; pageLink: DnsSubdomainPageActiveLink | null;
  pageLinkPendingEvents: DnsSubdomainPageClientPending[]; indexedThroughBlock: number; checkpointHash: string;
  admission: { ready: true; activationHeight: number; minSelfPaymentSats: number; protocolPrefix: string };
};
export function readDnsSubdomainPageLinkSnapshot(value: unknown, requestedName: string,
  options: { network: string; validateAddress: (address: string) => boolean }): DnsSubdomainPageLinkSnapshot;
export function assertDnsSubdomainPageLinkAction(snapshot: DnsSubdomainPageLinkSnapshot,
  request: { name: string; pageTxid: string | null }, address: string, expectedEpoch?: DnsOwnershipEpoch,
  expectedChild?: DnsOwnershipEpoch): { root: DnsPageLinkRoot; child: DnsSubdomainPageClientChild };
