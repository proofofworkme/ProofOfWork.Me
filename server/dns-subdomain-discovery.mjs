import { createHash } from "node:crypto";
import { workAmoV5CanonicalPayloadCommitment } from "./work-amo-v5.mjs";
import { DNS_SUBDOMAIN_PREFIX } from "../src/shared/protocol/dnsSubdomains.mjs";

const key = (record) => [record.txid, record.position?.protocolVout ?? record.protocolVout,
  record.position?.recordOrdinal ?? record.recordOrdinal].join(":");
const equalCommitment = (left, right) => left?.model === right?.model &&
  left?.sha256 === right?.sha256 && left?.payloadBytes === right?.payloadBytes;
const witness = (value) => workAmoV5CanonicalPayloadCommitment(value);
const prefixHex = Buffer.from(DNS_SUBDOMAIN_PREFIX).toString("hex");

// A compact immutable cache entry retains all raw record positions and byte
// commitments, but full transaction/prevout data only for the child lane.
export function dnsSubdomainCoreBlockWitness(envelope, childEvents) {
  return {
    descriptor: { ...envelope.blockDescriptorCommitment },
    rawProtocolCandidateCount: envelope.rawProtocolCandidateCount,
    rawRecords: envelope.records.map(record => ({
      key: key(record), protocol: record.protocol,
      txIndex: record.blockTransactionIndex,
      rawWitness: witness(record.payload),
    })),
    childEvents,
  };
}

export function assertDnsSubdomainRawBlockCoverage(row, core) {
  const payload = row?.payload;
  const records = payload?.replayRecords;
  if (!Array.isArray(records) ||
      !equalCommitment(witness(records), payload.replayDescriptorCommitment) ||
      !equalCommitment(core?.descriptor, payload.blockDescriptorCommitment) ||
      Number(row.raw_protocol_candidate_count) !== core?.rawProtocolCandidateCount ||
      Number(payload.rawProtocolCandidateCount) !== core?.rawProtocolCandidateCount) {
    throw new Error("DNS subdomain raw descriptor does not match complete Core block evidence.");
  }
  const raw = records.filter(record => record?.rawCandidate === true);
  if (raw.length !== core.rawRecords.length || Number(row.protocol_record_count) !== raw.length) {
    throw new Error("DNS subdomain raw carrier set is incomplete.");
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
      throw new Error("DNS subdomain indexed raw carrier bytes or position diverge from Core.");
    }
    remaining.delete(key(record));
  }
  if (remaining.size) throw new Error("DNS subdomain Core carrier was omitted from the index.");
  return core.childEvents;
}

export function dnsSubdomainCandidates(records) {
  return records.filter(record => record.protocol === "pwdns1" &&
    record.rawRecordParts?.some(part => String(part.payloadHex ?? "").startsWith(prefixHex)));
}

export function createDnsSubdomainDiscovery({ readIndex, readCoreBlock, readCoreHash, hydratePending,
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
          throw new Error("DNS subdomain immutable verification cache reached its byte budget.");
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
      if (now() > deadline) throw new Error("DNS subdomain verification exceeded its read budget; retry to continue verified catch-up.");
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
        const children = assertDnsSubdomainRawBlockCoverage(row, core);
        withinBudget();
        projectionBytes += Buffer.byteLength(JSON.stringify(children));
        if (projectionBytes > maxProjectionBytes) throw new Error("DNS subdomain projection reached its byte budget.");
        confirmed.push(...children);
      },
    });
    if (coverage?.complete !== true || coverage.indexedThroughBlock !== checkpoint.height ||
        coverage.checkpointHash !== checkpoint.blockHash || coverage.activationHeight !== activationHeight ||
        coverage.blockCount !== checkpoint.height - activationHeight + 1) {
      throw new Error("DNS subdomain discovery lacks exact checkpoint coverage.");
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
        const children = await hydratePending(txid, network);
        const bytes = Buffer.byteLength(JSON.stringify(children));
        if (projectionBytes + bytes <= maxProjectionBytes) { pending.push(...children); projectionBytes += bytes; }
      } catch { /* best effort */ }
    }
    const childSha256 = createHash("sha256").update(JSON.stringify(confirmed)).digest("hex");
    return { events: [...confirmed, ...pending], coverage: { ...coverage,
      pendingTxids: undefined, model: "dns-subdomain-core-raw-block-coverage-v1", childSha256 } };
  }
  return async function discover(network, checkpoint, activationHeight) {
    const scope = `${network}:${activationHeight}:${checkpoint.height}:${checkpoint.blockHash}`;
    if (!checkpointReads.has(scope)) checkpointReads.set(scope,
      read(network, checkpoint, activationHeight).finally(() => checkpointReads.delete(scope)));
    return checkpointReads.get(scope);
  };
}

function childItem(item) {
  const raw = typeof item?.payload === "string" ? item.payload :
    item?.rawPayload ?? item?.protocolPayload ?? item?.payload?.payload ?? "";
  return String(item?.kind ?? "").startsWith("dns-subdomain-") ||
    String(raw).startsWith(DNS_SUBDOMAIN_PREFIX);
}

export function qualifyDnsSubdomainLogPayload(payload, dns) {
  const collections = ["items", "activity", "events"];
  if (!collections.some(collection => (payload?.[collection] ?? []).some(childItem))) return payload;
  const checkpointHeight = payload?.indexedThroughBlock ?? payload?.provenance?.indexedThroughBlock;
  const checkpointHash = payload?.indexedThroughBlockHash ?? payload?.checkpointHash ??
    payload?.provenance?.indexedThroughBlockHash;
  if (dns?.subdomainCoverage?.complete !== true || dns?.subdomainAdmission?.ready !== true ||
      checkpointHeight !== dns.indexedThroughBlock || checkpointHash !== dns.checkpointHash) {
    throw new Error("Log DNS subdomain authority is unavailable at the same exact checkpoint.");
  }
  const events = [...dns.subdomainEvents, ...dns.subdomainPendingEvents];
  const byPosition = new Map(events.map(event => [key(event), event]));
  if (byPosition.size !== events.length) throw new Error("Ambiguous DNS subdomain Log membership.");
  function qualify(item) {
    if (!childItem(item)) return item;
    const event = byPosition.get(key(item));
    if (!event || event.blockHeight !== (item.confirmed === true ? item.blockHeight : null) ||
        (item.confirmed === true && event.txIndex !== item.blockIndex)) {
      throw new Error("Log DNS subdomain carrier is absent from exact Core replay.");
    }
    const record = event.record;
    const state = event.state;
    const historical = state ? dns.subdomainHistoricalRecords.find(value =>
      value.name === state.name && value.createdTxid === state.createdTxid) : null;
    const live = state ? dns.subdomains.find(value =>
      value.name === state.name && value.createdTxid === state.createdTxid) : null;
    const dnsStatus = !event.valid ? "rejected" : historical?.status ?? live?.status ??
      (record?.action === "revoke" ? "revoked" : event.confirmed ? "confirmed" : "pending");
    return { ...item,
      protocolValid: event.valid,
      protocolStatus: event.valid ? event.status : "rejected",
      dnsSubdomainStatus: dnsStatus,
      dnsSubdomainAuthority: "complete-root-epoch-core-replay",
      reason: event.reason ?? undefined, reasonCode: event.reason ?? "",
      ...(record ? { kind: `dns-subdomain-${record.action}`, action: record.action,
        name: `${record.label}.${record.parent}.pow`, epoch: record.epoch } : {}),
      ...(historical ? { invalidatedByTxid: historical.invalidatedByTxid,
        invalidatedAtBlock: historical.invalidatedAtBlock, revokedAtBlock: historical.revokedAtBlock } : {}),
      title: event.valid ? `DNS subdomain ${record?.action ?? "event"} ${event.confirmed ? "confirmed" : "pending"}` :
        `DNS subdomain ${record?.action ?? "event"} rejected`,
      ...(event.valid ? {} : { detail: event.reason,
        description: `Rejected DNS subdomain action: ${event.reason}. Confirmed transaction history remains inspectable.` }),
    };
  }
  const result = { ...payload };
  for (const collection of collections) {
    if (Array.isArray(payload?.[collection])) result[collection] = payload[collection].map(qualify);
  }
  return result;
}

export function dnsSubdomainLogPayloadHasChildren(payload) {
  return ["items", "activity", "events"].some(collection =>
    (payload?.[collection] ?? []).some(childItem));
}
