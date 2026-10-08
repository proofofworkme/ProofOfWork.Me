import { DNS_SUBDOMAIN_PAGE_LINK_PREFIX, DNS_SUBDOMAIN_PAGE_LINK_SELF_PAYMENT_SATS,
  normalizeDnsSubdomainPageLinkName } from "../../shared/protocol/dnsSubdomainPages.mjs";
import { dnsOwnershipEpoch, dnsSubdomainAddressIdentity, parseDnsSubdomainName } from "../../shared/protocol/dnsSubdomains.mjs";
import { sameDnsPageEpoch } from "./dnsPageLinkClient.mjs";

const hash = value => typeof value === "string" && /^[0-9a-f]{64}$/u.test(value);
const uint = value => Number.isSafeInteger(value) && value >= 0;
const identity = dnsSubdomainAddressIdentity;
function sameLink(left, right) {
  if (left === null || right === null) return left === right;
  return Boolean(left && right &&
    ["name", "parent", "label", "network", "pageTxid", "txid", "blockHeight", "protocolVout", "recordOrdinal", "status", "confirmed", "active", "valid"]
      .every(key => left[key] === right[key]) && identity(left.ownerAddress) === identity(right.ownerAddress) &&
    sameDnsPageEpoch(left.epoch, right.epoch) && sameDnsPageEpoch(left.child, right.child));
}
function completeCoverage(value, { model, commitment, network, height, checkpoint }) {
  return value?.complete === true && value.model === model &&
    (value.network === undefined || value.network === network) && value.indexedThroughBlock === height &&
    value.checkpointHash === checkpoint && hash(value.witnessSha256) && hash(value[commitment]) &&
    uint(value.activationHeight) && value.activationHeight > 0 && value.activationHeight <= height &&
    value.blockCount === height - value.activationHeight + 1;
}

// A child content link requires coherent root ownership, active CREATE identity,
// and both complete child and page-link discovery at one canonical checkpoint.
export function readDnsSubdomainPageLinkSnapshot(value, requestedName, { network, validateAddress } = {}) {
  const query = parseDnsSubdomainName(requestedName);
  if (!query) throw new Error("Enter a child .pow name, such as app.alice.pow.");
  const data = value, height = data?.indexedThroughBlock, checkpoint = data?.checkpointHash;
  const coverage = data?.subdomainPageLinkCoverage, admission = data?.subdomainPageLinkAdmission;
  const validAddress = address => {
    try { return typeof address === "string" && typeof validateAddress === "function" && validateAddress(address) === true; }
    catch { return false; }
  };
  if (admission?.ready === false && typeof admission.reason === "string" && admission.reason.trim()) {
    throw new Error(admission.reason.trim().slice(0, 500));
  }
  if (!data || data.network !== network || data.id !== `${query.label}.${query.parent}` || data.name !== query.name ||
      data.coverage?.complete !== true || !uint(height) || height < 1 || !hash(checkpoint) ||
      !completeCoverage(data.subdomainCoverage, { model: "dns-subdomain-core-raw-block-coverage-v1", commitment: "childSha256", network, height, checkpoint }) ||
      data.subdomainAdmission?.ready !== true ||
      coverage?.network !== network || !completeCoverage(coverage, { model: "dns-subdomain-page-link-core-raw-block-coverage-v1", commitment: "subdomainPageLinkSha256", network, height, checkpoint }) ||
      admission?.ready !== true || admission.network !== network || admission.indexedThroughBlock !== height ||
      admission.checkpointHash !== checkpoint || admission.activationHeight !== coverage.activationHeight ||
      admission.minSelfPaymentSats !== DNS_SUBDOMAIN_PAGE_LINK_SELF_PAYMENT_SATS || admission.protocolPrefix !== DNS_SUBDOMAIN_PAGE_LINK_PREFIX ||
      !Array.isArray(data.records) || !Array.isArray(data.subdomains) || !Array.isArray(data.subdomainEvents) ||
      !Array.isArray(data.subdomainPageLinkEvents) || !Array.isArray(data.subdomainPageLinkPendingEvents) ||
      !Object.hasOwn(data, "subdomainPageLink") ||
      (Object.hasOwn(data, "pageLink") && !sameLink(data.pageLink, data.subdomainPageLink))) {
    throw new Error("Current verified DNS subdomain page-link coverage is unavailable.");
  }
  const root = data.parentRecord, child = data.record;
  if (!root || root.id !== query.parent || root.network !== network || root.confirmed !== true ||
      !validAddress(root.ownerAddress) || !validAddress(root.receiveAddress) || !dnsOwnershipEpoch(root.ownershipEpoch) ||
      !uint(root.ownershipEpochBlockHeight) || root.ownershipEpochBlockHeight < 1 || root.ownershipEpochBlockHeight > height) {
    throw new Error("This child .pow name has no current confirmed root owner.");
  }
  function validChild(row) {
    return row && row.name === query.name && row.parent === query.parent && row.label === query.label &&
      row.network === network && row.confirmed === true && row.status === "active" && row.active === true &&
      validAddress(row.ownerAddress) && identity(row.ownerAddress) === identity(root.ownerAddress) &&
      sameDnsPageEpoch(row.epoch, root.ownershipEpoch) && dnsOwnershipEpoch(row.childLifecycle) &&
      hash(row.createdTxid) && row.createdTxid === row.childLifecycle.txid &&
      uint(row.createdAtBlock) && row.createdAtBlock > root.ownershipEpochBlockHeight && row.createdAtBlock <= height &&
      validAddress(row.receiveAddress) && (row.resolver === null || validAddress(row.resolver)) &&
      identity(row.receiveAddress) === identity(row.resolver ?? root.receiveAddress) &&
      hash(row.updatedTxid ?? row.txid) && hash(row.txid) &&
      (!Object.hasOwn(row, "subdomainPageLink") || sameLink(row.subdomainPageLink, data.subdomainPageLink));
  }
  if (data.routable !== true || data.status !== "confirmed" || !validChild(child) ||
      data.records.length !== 1 || data.subdomains.length !== 1 ||
      !validChild(data.records[0]) || !validChild(data.subdomains[0]) ||
      [data.records[0], data.subdomains[0]].some(row =>
        !sameDnsPageEpoch(row.childLifecycle, child.childLifecycle) || row.createdAtBlock !== child.createdAtBlock ||
        row.txid !== child.txid || row.updatedTxid !== child.updatedTxid ||
        identity(row.receiveAddress) !== identity(child.receiveAddress) || row.resolver !== child.resolver)) {
    throw new Error("The child .pow records do not match its current confirmed lifecycle.");
  }
  const creates = data.subdomainEvents.filter(event => event.valid === true && event.confirmed === true &&
    event.record?.action === "create" && event.record.parent === query.parent && event.record.label === query.label &&
    sameDnsPageEpoch(event, child.childLifecycle) && sameDnsPageEpoch(event.record.epoch, root.ownershipEpoch) &&
    event.blockHeight === child.createdAtBlock);
  if (creates.length !== 1) throw new Error("The child .pow creation identity is unavailable or inconsistent.");
  const link = data.subdomainPageLink;
  if (link !== null && (!link || link.name !== query.name || link.parent !== query.parent || link.label !== query.label ||
      link.network !== network || link.confirmed !== true || link.status !== "active" || link.active !== true || link.valid !== true ||
      !validAddress(link.ownerAddress) || identity(link.ownerAddress) !== identity(root.ownerAddress) ||
      !sameDnsPageEpoch(link.epoch, root.ownershipEpoch) || !sameDnsPageEpoch(link.child, child.childLifecycle) ||
      !hash(link.pageTxid) || !hash(link.txid) || !uint(link.blockHeight) ||
      link.blockHeight <= child.createdAtBlock || link.blockHeight > height || link.blockHeight < coverage.activationHeight ||
      !uint(link.protocolVout) || link.protocolVout > 0xffffffff || !uint(link.recordOrdinal))) {
    throw new Error("The Pages link does not match this child .pow name's current confirmed lifecycle.");
  }
  return { name: query.name, root, child, pageLink: link,
    pageLinkPendingEvents: data.subdomainPageLinkPendingEvents,
    indexedThroughBlock: height, checkpointHash: checkpoint, admission };
}

export function assertDnsSubdomainPageLinkAction(snapshot, request, address, expectedEpoch, expectedChild) {
  if (snapshot.name !== normalizeDnsSubdomainPageLinkName(request.name) ||
      identity(snapshot.root.ownerAddress) !== identity(address)) {
    throw new Error("Only the current confirmed root owner can change its child's Pages link.");
  }
  if (expectedEpoch && !sameDnsPageEpoch(expectedEpoch, snapshot.root.ownershipEpoch)) {
    throw new Error("The root ownership period changed. Prepare and review a new transaction.");
  }
  if (expectedChild && !sameDnsPageEpoch(expectedChild, snapshot.child.childLifecycle)) {
    throw new Error("The subdomain was revoked or recreated. Prepare and review a new transaction.");
  }
  if (request.pageTxid !== null && !hash(request.pageTxid)) throw new Error("Enter a valid confirmed Pages transaction ID.");
  if (request.pageTxid === null && !snapshot.pageLink) throw new Error("This child .pow name has no active Pages link to clear.");
  if (snapshot.pageLinkPendingEvents.some(event => event?.valid === true &&
      (event.name === snapshot.name || (event.record && `${event.record.label}.${event.record.parent}.pow` === snapshot.name)) &&
      sameDnsPageEpoch(event.record?.epoch, snapshot.root.ownershipEpoch) && sameDnsPageEpoch(event.record?.child, snapshot.child.childLifecycle))) {
    throw new Error("A Pages link action is already pending. Wait for confirmation or dropping before another action.");
  }
  return { root: snapshot.root, child: snapshot.child };
}
