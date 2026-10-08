import { DNS_SUBDOMAIN_PAGE_LINK_PREFIX } from "../src/shared/protocol/dnsSubdomainPages.mjs";
const prefixHex = Buffer.from(DNS_SUBDOMAIN_PAGE_LINK_PREFIX).toString("hex");
const key = (record) => [record.txid, record.position?.protocolVout ?? record.protocolVout,
  record.position?.recordOrdinal ?? record.recordOrdinal].join(":");
export function dnsSubdomainPageLinkCandidates(records) {
  return records.filter(record => record.protocol === "pwdns1" &&
    record.rawRecordParts?.some(part => String(part.payloadHex ?? "").startsWith(prefixHex)));
}

function subdomainPageLinkHexes(item) {
  return [item?.rawPayloadHex, item?.workAmoV5RawScriptWitness?.payloadHex,
    ...(Array.isArray(item?.payload?.rawRecordParts) ? item.payload.rawRecordParts : []).map(part => part?.payloadHex)]
    .filter(value => typeof value === "string" && value.toLowerCase().startsWith(prefixHex));
}

function subdomainPageLinkItem(item) {
  const text = [item?.payload, item?.rawPayload, item?.protocolPayload, item?.payload?.payload]
    .find(value => typeof value === "string" && value.startsWith(DNS_SUBDOMAIN_PAGE_LINK_PREFIX));
  return Boolean(text || subdomainPageLinkHexes(item).length || String(item?.kind ?? "").startsWith("dns-subdomain-page-link-"));
}

// This qualifies already selected audit/event rows. It does not add public Log
// membership, change pagination, mutate the stored carrier kind/validity, or
// reinterpret any WORK economic marker.
export function qualifyDnsSubdomainPageLinkLogPayload(payload, dns) {
  const collections = ["items", "activity", "events"];
  if (!collections.some(collection => (payload?.[collection] ?? []).some(subdomainPageLinkItem))) return payload;
  const checkpointHeight = payload?.indexedThroughBlock ?? payload?.provenance?.indexedThroughBlock;
  const checkpointHash = payload?.indexedThroughBlockHash ?? payload?.checkpointHash ??
    payload?.provenance?.indexedThroughBlockHash;
  if (dns?.subdomainPageLinkCoverage?.complete !== true || dns?.subdomainPageLinkAdmission?.ready !== true ||
      checkpointHeight !== dns.indexedThroughBlock || checkpointHash !== dns.checkpointHash ||
      dns.subdomainPageLinkCoverage.indexedThroughBlock !== checkpointHeight || dns.subdomainPageLinkCoverage.checkpointHash !== checkpointHash ||
      dns.subdomainPageLinkAdmission.indexedThroughBlock !== checkpointHeight || dns.subdomainPageLinkAdmission.checkpointHash !== checkpointHash) {
    throw new Error("Log DNS subdomain page-link authority is unavailable at the same exact checkpoint.");
  }
  const events = [...dns.subdomainPageLinkEvents, ...dns.subdomainPageLinkPendingEvents];
  const byPosition = new Map(events.map(event => [key(event), event]));
  if (byPosition.size !== events.length) throw new Error("Ambiguous DNS subdomain page-link Log membership.");
  function qualify(item) {
    if (!subdomainPageLinkItem(item)) return item;
    const event = byPosition.get(key(item));
    if (!event || event.blockHeight !== (item.confirmed === true ? item.blockHeight : null) ||
        (item.confirmed === true && event.txIndex !== item.blockIndex)) {
      throw new Error("Log DNS subdomain page-link carrier is absent from exact Core replay.");
    }
    const texts = [item?.payload, item?.rawPayload, item?.protocolPayload, item?.payload?.payload]
      .filter(value => typeof value === "string" && value.startsWith(DNS_SUBDOMAIN_PAGE_LINK_PREFIX));
    const hexes = subdomainPageLinkHexes(item);
    if ((event.decodeValid !== false && texts.some(value => value !== event.payload)) ||
        (typeof event.rawPayloadHex === "string" && hexes.some(value => value.toLowerCase() !== event.rawPayloadHex))) {
      throw new Error("Log DNS subdomain page-link carrier bytes diverge from exact Core replay.");
    }
    const record = event.record;
    const state = event.state;
    const historical = state ? dns.subdomainPageLinkHistoricalRecords.find(value =>
      value.name === state.name && value.txid === state.txid) : null;
    const live = state ? dns.subdomainPageLinks.find(value =>
      value.name === state.name && value.txid === state.txid) : null;
    const status = !event.valid ? "rejected" : historical?.status ?? live?.status ??
      (record?.action === "clear" ? "cleared" : event.confirmed ? "confirmed" : "pending");
    return { ...item,
      protocolValid: event.valid, protocolStatus: event.valid ? event.status : "rejected",
      dnsPageLinkStatus: status, dnsPageLinkAuthority: "complete-root-child-lifecycle-core-replay",
      dnsPageLinkReason: event.reason ?? null, dnsPageLinkReasonCode: event.reason ?? "",
      ...(record ? { dnsPageLinkAction: record.action, name: `${record.label}.${record.parent}.pow`, child: record.child,
        epoch: record.epoch, pageTxid: record.pageTxid } : {}),
      ...(historical ? { invalidatedByTxid: historical.invalidatedByTxid,
        invalidatedAtBlock: historical.invalidatedAtBlock, clearedByTxid: historical.clearedByTxid,
        clearedAtBlock: historical.clearedAtBlock,
        replacedByTxid: historical.replacedByTxid, replacedAtBlock: historical.replacedAtBlock } : {}),
      title: event.valid ? `DNS page ${record?.action === "clear" ? "unlink" : "link"} ${event.confirmed ? "confirmed" : "pending"}` :
        "DNS subdomain page-link action rejected",
      ...(event.valid ? {} : { detail: event.reason,
        description: `Rejected DNS subdomain page-link action: ${event.reason}. Transaction evidence remains inspectable.` }),
    };
  }
  const result = { ...payload };
  for (const collection of collections) if (Array.isArray(payload?.[collection])) result[collection] = payload[collection].map(qualify);
  return result;
}

export function dnsSubdomainPageLinkLogPayloadHasLinks(payload) {
  return ["items", "activity", "events"].some(collection => (payload?.[collection] ?? []).some(subdomainPageLinkItem));
}
