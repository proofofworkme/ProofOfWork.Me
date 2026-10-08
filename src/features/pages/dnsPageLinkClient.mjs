import { DNS_PAGE_LINK_PREFIX, DNS_PAGE_LINK_SELF_PAYMENT_SATS, dnsPageLinkNameError, normalizeDnsPageLinkName } from "../../shared/protocol/dnsPages.mjs";
import { dnsOwnershipEpoch, dnsSubdomainAddressIdentity } from "../../shared/protocol/dnsSubdomains.mjs";

const hash = value => typeof value === "string" && /^[0-9a-f]{64}$/u.test(value);
const uint = value => Number.isSafeInteger(value) && value >= 0;
export function sameDnsPageEpoch(left, right) {
  const a = dnsOwnershipEpoch(left);
  const b = dnsOwnershipEpoch(right);
  return Boolean(a && b && a.txid === b.txid && a.protocolVout === b.protocolVout && a.recordOrdinal === b.recordOrdinal);
}

function samePageLink(left, right) {
  if (left === null || right === null) return left === right;
  return Boolean(left && right &&
    ["name", "network", "pageTxid", "txid", "blockHeight", "protocolVout", "recordOrdinal", "status", "confirmed", "active", "valid"]
      .every(key => left[key] === right[key]) &&
    dnsSubdomainAddressIdentity(left.ownerAddress) === dnsSubdomainAddressIdentity(right.ownerAddress) &&
    sameDnsPageEpoch(left.epoch, right.epoch) && sameDnsPageEpoch(left.ownershipEpoch, right.ownershipEpoch));
}

// A lookup's active content link and owner must belong to the same complete,
// current canonical snapshot. Missing collections never mean an empty state.
export function readDnsPageLinkSnapshot(value, requestedName, { network, validateAddress } = {}) {
  const id = normalizeDnsPageLinkName(requestedName);
  if (dnsPageLinkNameError(id)) throw new Error("Enter a valid root .pow name.");
  const name = `${id}.pow`;
  const data = value;
  const coverage = data?.pageLinkCoverage;
  const admission = data?.pageLinkAdmission;
  const height = data?.indexedThroughBlock;
  const checkpoint = data?.checkpointHash;
  const validAddress = address => {
    try { return typeof address === "string" && typeof validateAddress === "function" && validateAddress(address) === true; }
    catch { return false; }
  };
  if (admission?.ready === false && typeof admission.reason === "string" && admission.reason.trim()) {
    throw new Error(admission.reason.trim().slice(0, 500));
  }
  if (!data || data.network !== network || data.id !== id || data.name !== name ||
      data.coverage?.complete !== true || !uint(height) || height < 1 || !hash(checkpoint) ||
      coverage?.complete !== true || coverage.model !== "dns-page-link-core-raw-block-coverage-v1" ||
      coverage.network !== network || coverage.indexedThroughBlock !== height || coverage.checkpointHash !== checkpoint ||
      !hash(coverage.witnessSha256) || !hash(coverage.pageLinkSha256) ||
      !uint(coverage.activationHeight) || coverage.activationHeight < 1 || coverage.activationHeight > height ||
      coverage.blockCount !== height - coverage.activationHeight + 1 ||
      admission?.ready !== true || admission.network !== network || admission.indexedThroughBlock !== height ||
      admission.checkpointHash !== checkpoint || admission.activationHeight !== coverage.activationHeight ||
      admission.minSelfPaymentSats !== DNS_PAGE_LINK_SELF_PAYMENT_SATS || admission.protocolPrefix !== DNS_PAGE_LINK_PREFIX ||
      !Array.isArray(data.records) || !Array.isArray(data.pageLinkEvents) || !Array.isArray(data.pageLinkPendingEvents) ||
      !Object.hasOwn(data, "pageLink")) {
    throw new Error("Current verified DNS page-link coverage is unavailable.");
  }
  const root = data.record;
  const confirmedRows = data.records.filter(record => record?.confirmed === true && record.id === id);
  if (data.routable !== true || data.status !== "confirmed" || !root || root.id !== id || root.network !== network ||
      root.confirmed !== true || !validAddress(root.ownerAddress) || !validAddress(root.receiveAddress) ||
      !dnsOwnershipEpoch(root.ownershipEpoch) || !uint(root.ownershipEpochBlockHeight) ||
      root.ownershipEpochBlockHeight < 1 || root.ownershipEpochBlockHeight > height ||
      confirmedRows.length !== 1) {
    throw new Error("This .pow name has no current confirmed owner.");
  }
  const row = confirmedRows[0];
  if (row.network !== network || !validAddress(row.ownerAddress) || !validAddress(row.receiveAddress) ||
      dnsSubdomainAddressIdentity(row.ownerAddress) !== dnsSubdomainAddressIdentity(root.ownerAddress) ||
      dnsSubdomainAddressIdentity(row.receiveAddress) !== dnsSubdomainAddressIdentity(root.receiveAddress) ||
      !sameDnsPageEpoch(row.ownershipEpoch, root.ownershipEpoch) ||
      row.ownershipEpochBlockHeight !== root.ownershipEpochBlockHeight ||
      [root, row].some(record => Object.hasOwn(record, "pageLink") && !samePageLink(record.pageLink, data.pageLink))) {
    throw new Error("Current DNS owner and page-link records disagree.");
  }
  const link = data.pageLink;
  if (link !== null && (!link || link.name !== name || link.network !== network ||
      link.confirmed !== true || link.status !== "active" || link.active !== true || link.valid !== true ||
      !validAddress(link.ownerAddress) || dnsSubdomainAddressIdentity(link.ownerAddress) !== dnsSubdomainAddressIdentity(root.ownerAddress) ||
      !sameDnsPageEpoch(link.epoch, root.ownershipEpoch) || !sameDnsPageEpoch(link.ownershipEpoch, root.ownershipEpoch) ||
      !hash(link.pageTxid) || !hash(link.txid) || !uint(link.blockHeight) ||
      link.blockHeight <= root.ownershipEpochBlockHeight || link.blockHeight > height || link.blockHeight < coverage.activationHeight ||
      !uint(link.protocolVout) || link.protocolVout > 0xffffffff || !uint(link.recordOrdinal))) {
    throw new Error("The Pages link does not match this .pow name's current confirmed ownership.");
  }
  return { name, root, pageLink: link, pageLinkPendingEvents: data.pageLinkPendingEvents,
    indexedThroughBlock: height, checkpointHash: checkpoint, admission };
}

export function assertDnsPageLinkAction(snapshot, request, address, expectedEpoch) {
  if (snapshot.name !== `${normalizeDnsPageLinkName(request.name)}.pow` ||
      dnsSubdomainAddressIdentity(snapshot.root.ownerAddress) !== dnsSubdomainAddressIdentity(address)) {
    throw new Error("Only the current confirmed .pow owner can change its Pages link.");
  }
  if (expectedEpoch && !sameDnsPageEpoch(expectedEpoch, snapshot.root.ownershipEpoch)) {
    throw new Error("The .pow ownership period changed. Prepare and review a new transaction.");
  }
  if (request.pageTxid !== null && !hash(request.pageTxid)) throw new Error("Enter a valid confirmed Pages transaction ID.");
  if (request.pageTxid === null && !snapshot.pageLink) throw new Error("This .pow name has no active Pages link to clear.");
  if (snapshot.pageLinkPendingEvents.some(event => event?.valid === true &&
      (event.name === snapshot.name || event.record?.name === normalizeDnsPageLinkName(request.name)))) {
    throw new Error("A Pages link action is already pending. Wait for confirmation or dropping before another action.");
  }
  return snapshot.root;
}
