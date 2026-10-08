import { createHash } from "node:crypto";
import { workAmoV5CanonicalPayloadCommitment } from "./work-amo-v5.mjs";
import { DNS_PAGE_LINK_PREFIX } from "../src/shared/protocol/dnsPages.mjs";

// Complete raw Core block witnesses are independent of child discovery.
const key = (record) => [record.txid, record.position?.protocolVout ?? record.protocolVout,
  record.position?.recordOrdinal ?? record.recordOrdinal].join(":");
const equalCommitment = (left, right) => left?.model === right?.model &&
  left?.sha256 === right?.sha256 && left?.payloadBytes === right?.payloadBytes;
const witness = (value) => workAmoV5CanonicalPayloadCommitment(value);
const prefixHex = Buffer.from(DNS_PAGE_LINK_PREFIX).toString("hex");

// A compact immutable cache entry retains all raw record positions and byte
// commitments, but full transaction/prevout data only for the page-link lane.
export function dnsPageLinkCoreBlockWitness(envelope, pageLinkEvents) {
  return {
    descriptor: { ...envelope.blockDescriptorCommitment },
    rawProtocolCandidateCount: envelope.rawProtocolCandidateCount,
    rawRecords: envelope.records.map(record => ({
      key: key(record), protocol: record.protocol,
      txIndex: record.blockTransactionIndex,
      rawWitness: witness(record.payload),
    })),
    pageLinkEvents,
  };
}

export function assertDnsPageLinkRawBlockCoverage(row, core) {
  const payload = row?.payload;
  const records = payload?.replayRecords;
  if (!Array.isArray(records) ||
      !equalCommitment(witness(records), payload.replayDescriptorCommitment) ||
      !equalCommitment(core?.descriptor, payload.blockDescriptorCommitment) ||
      Number(row.raw_protocol_candidate_count) !== core?.rawProtocolCandidateCount ||
      Number(payload.rawProtocolCandidateCount) !== core?.rawProtocolCandidateCount) {
    throw new Error("DNS page-link raw descriptor does not match complete Core block evidence.");
  }
  const raw = records.filter(record => record?.rawCandidate === true);
  if (raw.length !== core.rawRecords.length || Number(row.protocol_record_count) !== raw.length) {
    throw new Error("DNS page-link raw carrier set is incomplete.");
  }
  const remaining = new Map(core.rawRecords.map(record => [record.key, record]));
  if (remaining.size !== core.rawRecords.length) throw new Error("Ambiguous Core raw carrier positions.");
  for (const record of raw) {
    const expected = remaining.get(key(record));
    if (!expected || record.protocol !== expected.protocol ||
        record.position?.blockHeight !== Number(row.height) ||
        record.position?.blockHash !== row.block_hash ||
        record.position?.blockTransactionIndex !== expected.txIndex ||
        !equalCommitment(witness(record.rawWitness), expected.rawWitness)) {
      throw new Error("DNS page-link indexed raw carrier bytes or position diverge from Core.");
    }
    remaining.delete(key(record));
  }
  if (remaining.size) throw new Error("DNS page-link Core carrier was omitted from the index.");
  return core.pageLinkEvents;
}

export function dnsPageLinkCandidates(records) {
  return records.filter(record => record.protocol === "pwdns1" &&
    record.rawRecordParts?.some(part => String(part.payloadHex ?? "").startsWith(prefixHex)));
}

export function createDnsPageLinkDiscovery({ readIndex, readCoreBlock, readCoreHash, hydratePending,
  maxCacheBytes = 128 * 1024 * 1024, maxProjectionBytes = 64 * 1024 * 1024,
  readBudgetMs = 25_000, now = () => Date.now(),
}) {
  const verifiedBlocks = new Map();
  const inFlight = new Map();
  const checkpointReads = new Map();
  const verifiedPrefixes = new Map();
  let cacheBytes = 0;
  async function blockWitness(row) {
    const blockKey = `${row.height}:${row.block_hash}`;
    if (verifiedBlocks.has(blockKey)) return verifiedBlocks.get(blockKey);
    if (!inFlight.has(blockKey)) {
      const task = readCoreBlock(row).then(core => {
        const bytes = Buffer.byteLength(JSON.stringify(core));
        if (cacheBytes + bytes > maxCacheBytes) {
          throw new Error("DNS page-link immutable verification cache reached its byte budget.");
        }
        verifiedBlocks.set(blockKey, core);
        cacheBytes += bytes;
        return core;
      }).finally(() => inFlight.delete(blockKey));
      inFlight.set(blockKey, task);
    }
    return inFlight.get(blockKey);
  }
  async function read(network, checkpoint, activationHeight) {
    const deadline = now() + readBudgetMs;
    const withinBudget = () => {
      if (now() > deadline) throw new Error("DNS page-link verification exceeded its read budget; retry to continue verified catch-up.");
    };
    const prefixScope = `${network}:${activationHeight}`;
    let prefix = verifiedPrefixes.get(prefixScope);
    if (prefix && (prefix.height > checkpoint.height || typeof readCoreHash !== "function" ||
        await readCoreHash(prefix.height, network) !== prefix.blockHash)) {
      verifiedPrefixes.delete(prefixScope);
      prefix = null;
    }
    withinBudget();
    const confirmed = prefix ? [...prefix.events] : [];
    let projectionBytes = prefix?.projectionBytes ?? 0;
    const coverage = await readIndex(network, {
      activationHeight, expectedHeight: checkpoint.height, expectedHash: checkpoint.blockHash,
      ...(prefix ? { fromHeight: prefix.height + 1,
        verifiedPrefix: { height: prefix.height, blockHash: prefix.blockHash,
          witnessSha256: prefix.witnessSha256 } } : {}),
      async onBlock(row) {
        withinBudget();
        const core = await blockWitness(row);
        const pageLinks = assertDnsPageLinkRawBlockCoverage(row, core);
        withinBudget();
        projectionBytes += Buffer.byteLength(JSON.stringify(pageLinks));
        if (projectionBytes > maxProjectionBytes) throw new Error("DNS page-link projection reached its byte budget.");
        confirmed.push(...pageLinks);
      },
    });
    if (coverage?.complete !== true || coverage.indexedThroughBlock !== checkpoint.height ||
        coverage.checkpointHash !== checkpoint.blockHash || coverage.activationHeight !== activationHeight ||
        coverage.blockCount !== checkpoint.height - activationHeight + 1) {
      throw new Error("DNS page-link discovery lacks exact checkpoint coverage.");
    }
    withinBudget();
    const previousPrefix = verifiedPrefixes.get(prefixScope);
    if (typeof readCoreHash === "function" && (!previousPrefix || previousPrefix.height <= checkpoint.height)) {
      verifiedPrefixes.set(prefixScope, { height: checkpoint.height, blockHash: checkpoint.blockHash,
        witnessSha256: coverage.witnessSha256, projectionBytes, events: [...confirmed] });
    }
    const pending = [];
    for (const txid of coverage.pendingTxids ?? []) {
      if (now() > deadline) break;
      // Mempool disappearance or replacement never invalidates confirmed
      // coverage, and an unavailable pending carrier never becomes authority.
      try {
        const pageLinks = await hydratePending(txid, network);
        const bytes = Buffer.byteLength(JSON.stringify(pageLinks));
        if (projectionBytes + bytes <= maxProjectionBytes) { pending.push(...pageLinks); projectionBytes += bytes; }
      } catch { /* best effort */ }
    }
    const pageLinkSha256 = createHash("sha256").update(JSON.stringify(confirmed)).digest("hex");
    return { events: [...confirmed, ...pending], coverage: { ...coverage,
      pendingTxids: undefined, model: "dns-page-link-core-raw-block-coverage-v1", pageLinkSha256 } };
  }
  return async function discover(network, checkpoint, activationHeight) {
    const scope = `${network}:${activationHeight}:${checkpoint.height}:${checkpoint.blockHash}`;
    if (!checkpointReads.has(scope)) checkpointReads.set(scope,
      read(network, checkpoint, activationHeight).finally(() => checkpointReads.delete(scope)));
    return checkpointReads.get(scope);
  };
}

function pageLinkHexes(item) {
  return [item?.rawPayloadHex, item?.workAmoV5RawScriptWitness?.payloadHex,
    ...(Array.isArray(item?.payload?.rawRecordParts) ? item.payload.rawRecordParts : []).map(part => part?.payloadHex)]
    .filter(value => typeof value === "string" && value.toLowerCase().startsWith(prefixHex));
}

function pageLinkItem(item) {
  const text = [item?.payload, item?.rawPayload, item?.protocolPayload, item?.payload?.payload]
    .find(value => typeof value === "string" && value.startsWith(DNS_PAGE_LINK_PREFIX));
  return Boolean(text || pageLinkHexes(item).length || String(item?.kind ?? "").startsWith("dns-page-link-"));
}

// This qualifies already selected audit/event rows. It does not add public Log
// membership, change pagination, mutate the stored carrier kind/validity, or
// reinterpret any WORK economic marker.
export function qualifyDnsPageLinkLogPayload(payload, dns) {
  const collections = ["items", "activity", "events"];
  if (!collections.some(collection => (payload?.[collection] ?? []).some(pageLinkItem))) return payload;
  const checkpointHeight = payload?.indexedThroughBlock ?? payload?.provenance?.indexedThroughBlock;
  const checkpointHash = payload?.indexedThroughBlockHash ?? payload?.checkpointHash ??
    payload?.provenance?.indexedThroughBlockHash;
  if (dns?.pageLinkCoverage?.complete !== true || dns?.pageLinkAdmission?.ready !== true ||
      checkpointHeight !== dns.indexedThroughBlock || checkpointHash !== dns.checkpointHash ||
      dns.pageLinkCoverage.indexedThroughBlock !== checkpointHeight || dns.pageLinkCoverage.checkpointHash !== checkpointHash ||
      dns.pageLinkAdmission.indexedThroughBlock !== checkpointHeight || dns.pageLinkAdmission.checkpointHash !== checkpointHash) {
    throw new Error("Log DNS page-link authority is unavailable at the same exact checkpoint.");
  }
  const events = [...dns.pageLinkEvents, ...dns.pageLinkPendingEvents];
  const byPosition = new Map(events.map(event => [key(event), event]));
  if (byPosition.size !== events.length) throw new Error("Ambiguous DNS page-link Log membership.");
  function qualify(item) {
    if (!pageLinkItem(item)) return item;
    const event = byPosition.get(key(item));
    if (!event || event.blockHeight !== (item.confirmed === true ? item.blockHeight : null) ||
        (item.confirmed === true && event.txIndex !== item.blockIndex)) {
      throw new Error("Log DNS page-link carrier is absent from exact Core replay.");
    }
    const texts = [item?.payload, item?.rawPayload, item?.protocolPayload, item?.payload?.payload]
      .filter(value => typeof value === "string" && value.startsWith(DNS_PAGE_LINK_PREFIX));
    const hexes = pageLinkHexes(item);
    if ((event.decodeValid !== false && texts.some(value => value !== event.payload)) ||
        (typeof event.rawPayloadHex === "string" && hexes.some(value => value.toLowerCase() !== event.rawPayloadHex))) {
      throw new Error("Log DNS page-link carrier bytes diverge from exact Core replay.");
    }
    const record = event.record;
    const state = event.state;
    const historical = state ? dns.pageLinkHistoricalRecords.find(value =>
      value.name === state.name && value.txid === state.txid) : null;
    const live = state ? dns.pageLinks.find(value =>
      value.name === state.name && value.txid === state.txid) : null;
    const status = !event.valid ? "rejected" : historical?.status ?? live?.status ??
      (record?.action === "clear" ? "cleared" : event.confirmed ? "confirmed" : "pending");
    return { ...item,
      protocolValid: event.valid, protocolStatus: event.valid ? event.status : "rejected",
      dnsPageLinkStatus: status, dnsPageLinkAuthority: "complete-root-epoch-core-replay",
      dnsPageLinkReason: event.reason ?? null, dnsPageLinkReasonCode: event.reason ?? "",
      ...(record ? { dnsPageLinkAction: record.action, name: `${record.name}.pow`,
        epoch: record.epoch, pageTxid: record.pageTxid } : {}),
      ...(historical ? { invalidatedByTxid: historical.invalidatedByTxid,
        invalidatedAtBlock: historical.invalidatedAtBlock, clearedByTxid: historical.clearedByTxid,
        clearedAtBlock: historical.clearedAtBlock,
        replacedByTxid: historical.replacedByTxid, replacedAtBlock: historical.replacedAtBlock } : {}),
      title: event.valid ? `DNS page ${record?.action === "clear" ? "unlink" : "link"} ${event.confirmed ? "confirmed" : "pending"}` :
        "DNS page-link action rejected",
      ...(event.valid ? {} : { detail: event.reason,
        description: `Rejected DNS page-link action: ${event.reason}. Transaction evidence remains inspectable.` }),
    };
  }
  const result = { ...payload };
  for (const collection of collections) if (Array.isArray(payload?.[collection])) result[collection] = payload[collection].map(qualify);
  return result;
}

export function dnsPageLinkLogPayloadHasLinks(payload) {
  return ["items", "activity", "events"].some(collection => (payload?.[collection] ?? []).some(pageLinkItem));
}
