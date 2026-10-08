import { createOwnerOutputCommitmentFixture } from "./ownerOutputCommitment.mjs";
import { DNS_SUBDOMAIN_ACTIVATION_HEIGHT, parseDnsSubdomainName } from "../../src/shared/protocol/dnsSubdomains.mjs";
import { DNS_SUBDOMAIN_PAGE_LINK_ACTIVATION_HEIGHT, DNS_SUBDOMAIN_PAGE_LINK_PREFIX,
  DNS_SUBDOMAIN_PAGE_LINK_SELF_PAYMENT_SATS, DNS_SUBDOMAIN_PAGE_LINK_AUTHORITY_MODEL, buildDnsSubdomainPageLinkPayload } from "../../src/shared/protocol/dnsSubdomainPages.mjs";

// Coherent first-party exact lookup: root ownership, active child CREATE and both
// complete coverage commitments share a canonical checkpoint. Tests use the
// production client validator rather than substituting a successful resolver.
export function dnsChildPageSnapshot({ name = "app.alice.pow", pageTxid = "b".repeat(64),
  ownerAddress = createOwnerOutputCommitmentFixture().ownerAddress,
  receiveAddress = "1F1p9UEHuH5KTFR7Zsx93Khdrqhj6t5nFv" } = {}) {
  const { label, parent } = parseDnsSubdomainName(name);
  const network = "livenet", checkpointHash = "a".repeat(64);
  const indexedThroughBlock = DNS_SUBDOMAIN_PAGE_LINK_ACTIVATION_HEIGHT + 2;
  const epoch = { txid: checkpointHash, protocolVout: 1, recordOrdinal: 0 };
  const childLifecycle = { txid: "e".repeat(64), protocolVout: 1, recordOrdinal: 0 };
  const createdAtBlock = DNS_SUBDOMAIN_PAGE_LINK_ACTIVATION_HEIGHT - 1;
  const coverage = (activationHeight, model, commitment) => ({ network, complete: true,
    activationHeight, indexedThroughBlock, checkpointHash, witnessSha256: checkpointHash,
    [commitment]: checkpointHash, blockCount: indexedThroughBlock - activationHeight + 1, model });
  const root = { id: parent, network, confirmed: true, ownerAddress, receiveAddress,
    ownershipEpoch: epoch, ownershipEpochBlockHeight: createdAtBlock - 1 };
  const record = { action: "set", parent, label, epoch, child: childLifecycle, pageTxid };
  const payload = buildDnsSubdomainPageLinkPayload(record);
  const signed = createOwnerOutputCommitmentFixture({ payload, number: 3 });
  const pageLink = { name, parent, label, network, pageTxid, txid: signed.txid, ownerAddress,
    epoch, child: childLifecycle, blockHeight: indexedThroughBlock - 1,
    protocolVout: 1, recordOrdinal: 0, confirmed: true, status: "active", active: true, valid: true };
  const child = { name, parent, label, network, confirmed: true, status: "active", active: true,
    ownerAddress, receiveAddress, resolver: null, epoch, childLifecycle,
    createdTxid: childLifecycle.txid, createdAtBlock, txid: childLifecycle.txid,
    updatedTxid: childLifecycle.txid, subdomainPageLink: pageLink };
  return { network, id: `${label}.${parent}`, name, routable: true, status: "confirmed",
    coverage: { complete: true }, indexedThroughBlock, checkpointHash, parentRecord: root,
    record: child, records: [child], subdomains: [child], pageLink, subdomainPageLink: pageLink,
    subdomainCoverage: coverage(DNS_SUBDOMAIN_ACTIVATION_HEIGHT,
      "dns-subdomain-core-raw-block-coverage-v1", "childSha256"), subdomainAdmission: { ready: true },
    subdomainPageLinkCoverage: coverage(DNS_SUBDOMAIN_PAGE_LINK_ACTIVATION_HEIGHT,
      "dns-subdomain-page-link-core-raw-block-coverage-v1", "subdomainPageLinkSha256"),
    subdomainPageLinkAdmission: { network, ready: true, indexedThroughBlock, checkpointHash,
      activationHeight: DNS_SUBDOMAIN_PAGE_LINK_ACTIVATION_HEIGHT,
      minSelfPaymentSats: DNS_SUBDOMAIN_PAGE_LINK_SELF_PAYMENT_SATS, protocolPrefix: DNS_SUBDOMAIN_PAGE_LINK_PREFIX,
      authorityModel: DNS_SUBDOMAIN_PAGE_LINK_AUTHORITY_MODEL },
    subdomainEvents: [{ ...childLifecycle, name, blockHeight: createdAtBlock, valid: true, confirmed: true,
      record: { action: "create", parent, label, epoch, resolver: null } }],
    subdomainPageLinkEvents: [{ ...signed, payload, record, name, blockHeight: pageLink.blockHeight, txIndex: 3,
      protocolVout: 1, recordOrdinal: 0, subdomainPageLinkCarrierCount: 1, hasCoinbaseInput: false, valid: true, confirmed: true }],
    subdomainPageLinkPendingEvents: [] };
}
