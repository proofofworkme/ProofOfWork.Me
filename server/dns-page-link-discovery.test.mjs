import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import {
  assertDnsPageLinkRawBlockCoverage, createDnsPageLinkDiscovery,
  dnsPageLinkCoreBlockWitness, dnsPageLinkCandidates,
  qualifyDnsPageLinkLogPayload, dnsPageLinkLogPayloadHasLinks,
} from "./dns-page-link-discovery.mjs";
import { workAmoV5CanonicalPayloadCommitment as commit } from "./work-amo-v5.mjs";

const HASH = "11".repeat(32), PREV = "22".repeat(32), TXID = "33".repeat(32);
const height = 1_000_000;
function fixture() {
  const part = { payloadHex: Buffer.from("pwdns1:page1:malformed").toString("hex"),
    text: "pwdns1:page1:malformed", decodeValid: true, protocolVout: 1 };
  const raw = { txid: TXID, protocol: "pwdns1", protocolVout: 1, recordOrdinal: 0,
    blockTransactionIndex: 3, rawRecordParts: [part],
    payload: { model: "canonical-raw-protocol-record-v1", rawRecordParts: [part] } };
  const record = { txid: TXID, rawCandidate: true, protocol: "pwdns1",
    position: { blockHeight: height, blockHash: HASH, blockTransactionIndex: 3,
      protocolVout: 1, recordOrdinal: 0 }, rawWitness: raw.payload,
    outcome: { valid: false, reasonCode: "invalid-payload" } };
  const descriptor = commit({ completeFullCoreBlock: true, records: [raw] });
  const row = { height, block_hash: HASH, previous_block_hash: PREV,
    canonical_height_count: 1, complete: true, block_atomic: true, fee_once: true,
    invalid_zero: true, model: "v8", protocol_record_count: 1, raw_protocol_candidate_count: 1,
    payload: { replayRecords: [record], replayDescriptorCommitment: commit([record]),
      blockDescriptorCommitment: descriptor, rawProtocolCandidateCount: 1 } };
  const event = { txid: TXID, payload: part.text, blockHeight: height, txIndex: 3,
    protocolVout: 1, recordOrdinal: 0, inputAddresses: ["owner"],
    outputs: [{ vout: 0, address: "owner", valueSats: 546 }] };
  const core = dnsPageLinkCoreBlockWitness({ records: [raw],
    blockDescriptorCommitment: descriptor, rawProtocolCandidateCount: 1 }, [event]);
  return { row, core, raw, event };
}

function coverageWitness(rows, activationHeight = height, prior = null) {
  let digest = prior ?? createHash("sha256")
    .update(JSON.stringify(["dns-page-link-block-witness-chain-v1", "livenet", activationHeight])).digest("hex");
  for (const row of rows) digest = createHash("sha256")
    .update(JSON.stringify([digest, Number(row.height), row.block_hash,
      row.payload?.blockDescriptorCommitment, row.payload?.replayDescriptorCommitment])).digest("hex");
  return digest;
}

test("discovery includes raw rejected/malformed page-link records and proves their complete bytes and positions", () => {
  const { row, core, raw, event } = fixture();
  assert.equal(dnsPageLinkCandidates([raw]).length, 1);
  assert.deepEqual(assertDnsPageLinkRawBlockCoverage(row, core), [event]);
  for (const mutate of [
    value => { value.payload.replayRecords = []; value.payload.replayDescriptorCommitment = commit([]); value.protocol_record_count = 0; },
    value => { value.payload.replayRecords[0].rawWitness.rawRecordParts[0].text = "omitted";
      value.payload.replayDescriptorCommitment = commit(value.payload.replayRecords); },
    value => { value.payload.blockDescriptorCommitment = commit({ forged: true }); },
    value => { value.payload.replayDescriptorCommitment.sha256 = PREV; },
    value => { value.payload.replayRecords[0].position.blockTransactionIndex = 4;
      value.payload.replayDescriptorCommitment = commit(value.payload.replayRecords); },
    value => { value.raw_protocol_candidate_count = 0; },
  ]) {
    const tampered = structuredClone(row); mutate(tampered);
    assert.throws(() => assertDnsPageLinkRawBlockCoverage(tampered, core), /DNS page-link/u);
  }
});

test("immutable Core verification is reused without accepting a changed index commitment; pending failures stay best effort", async () => {
  const { row, core, event } = fixture(); let coreReads = 0;
  const discovery = createDnsPageLinkDiscovery({
    async readIndex(network, options) { await options.onBlock(row); return {
      complete: true, activationHeight: height, indexedThroughBlock: height,
      checkpointHash: HASH, blockCount: 1, witnessSha256: coverageWitness([row]), pendingTxids: ["missing"] }; },
    async readCoreBlock() { coreReads += 1; return core; },
    async hydratePending() { throw new Error("dropped"); },
  });
  for (let index = 0; index < 2; index += 1) {
    assert.deepEqual((await discovery("livenet", { height, blockHash: HASH }, height)).events, [event]);
  }
  assert.equal(coreReads, 1);
  row.payload.blockDescriptorCommitment.sha256 = PREV;
  await assert.rejects(discovery("livenet", { height, blockHash: HASH }, height), /descriptor/u);
});

test("discovery refuses empty or foreign checkpoint coverage", async () => {
  for (const coverage of [null, { complete: false }, { complete: true, activationHeight: height,
    indexedThroughBlock: height, checkpointHash: PREV, blockCount: 1 }]) {
    const discovery = createDnsPageLinkDiscovery({ readIndex: async () => coverage,
      readCoreBlock: async () => null, hydratePending: async () => [] });
    await assert.rejects(discovery("livenet", { height, blockHash: HASH }, height), /coverage/u);
  }
});

const readerSource = await readFile(new URL("./db/proof-index-reader.mjs", import.meta.url), "utf8");
const functionSource = readerSource.slice(readerSource.indexOf("export async function proofIndexDnsPageLinkDiscovery("),
  readerSource.indexOf("export async function proofIndexDnsSubdomainDiscovery("))
  .replace("export async function", "async function");
function readerRuntime({ rows, scans, anchors = [{ block_hash: HASH }] }) {
  let scanIndex = 0; let released = false; let pendingReads = 0;
  const client = { async query(sql) {
    if (sql.includes("dns_page_link_verified_prefix_anchor")) return { rows: anchors };
    if (sql.includes("dns_page_link_raw_block_coverage")) return { rows };
    if (sql.includes("dns_page_link_pending_candidates")) { pendingReads += 1; return { rows: [] }; }
    return { rows: [] };
  }, release() { released = true; } };
  const context = vm.createContext({ proofIndexPool: () => ({ connect: async () => client }),
    latestProofIndexScanMetadata: async () => scans[Math.min(scanIndex++, scans.length - 1)],
    normalizedLowerText: value => String(value ?? "").toLowerCase(),
    createHash,
    WORK_AMO_V5_ACTIVATION_HEIGHT: 959621, WORK_AMO_V5_BLOCK_SEQUENCER_MODEL: "v5", WORK_AMO_V8_BLOCK_SEQUENCER_MODEL: "v8" });
  // Inject Node hashing explicitly; the reader stays read-only in the mocked SQL transaction.
  return { context, client, released: () => released, pendingReads: () => pendingReads };
}
function scan() { return { indexed_through_block: height, payload: { complete: true, tipHeight: height,
  indexedThroughBlockHash: HASH }, consistency: { ok: true, status: "block-scan-current" } }; }

test("reader proves contiguous unique blocks and exact current checkpoint, including its closing fence", async () => {
  const { row } = fixture();
  for (const fault of ["none", "gap", "duplicate", "hash", "transition", "scan", "closing"]) {
    const rows = [structuredClone(row)], scans = [scan(), scan()];
    if (fault === "gap") rows.length = 0;
    if (fault === "duplicate") rows[0].canonical_height_count = 2;
    if (fault === "hash") rows[0].block_hash = PREV;
    if (fault === "transition") rows[0].complete = false;
    if (fault === "scan") scans[0].payload.complete = false;
    if (fault === "closing") scans[1].payload.indexedThroughBlockHash = PREV;
    const runtime = readerRuntime({ rows, scans }); runtime.context.createHash = createHash;
    vm.runInContext(functionSource, runtime.context);
    const call = runtime.context.proofIndexDnsPageLinkDiscovery("livenet", { activationHeight: height,
      expectedHeight: height, expectedHash: HASH, onBlock: async () => {} });
    if (fault === "none") assert.equal((await call).complete, true);
    else await assert.rejects(call, /DNS page-link/u);
    assert.equal(runtime.released(), true);
  }
});

const bitcoin = await import("bitcoinjs-lib");
const { workAmoV5RawBlockDiscoveryEnvelope } = await import("./work-amo-v5-raw.mjs");
function actualCoreEnvelope() {
  const tx = new bitcoin.Transaction();
  const coinbase = Buffer.from("0401020304", "hex");
  tx.addInput(Buffer.alloc(32), 0xffffffff, 0xffffffff, coinbase);
  tx.addOutput(Buffer.from("51", "hex"), 0n);
  const carrier = bitcoin.script.compile([bitcoin.opcodes.OP_RETURN,
    Buffer.from("pwdns1:page1:malformed", "utf8")]);
  tx.addOutput(carrier, 0n);
  const raw = { txid: tx.getId(), hex: tx.toHex(), vin: [{ coinbase: coinbase.toString("hex") }],
    vout: [{ scriptpubkey: "51", value: 0 }, { scriptpubkey: Buffer.from(carrier).toString("hex"), value: 0 }] };
  const header = Buffer.alloc(80);
  header.writeInt32LE(1); Buffer.from(PREV, "hex").reverse().copy(header, 4);
  Buffer.from(raw.txid, "hex").reverse().copy(header, 36);
  header.writeUInt32LE(1_700_000_000, 68); header.writeUInt32LE(0x1d00ffff, 72);
  const blockHash = Buffer.from(createHash("sha256").update(createHash("sha256").update(header).digest()).digest()).reverse().toString("hex");
  return { envelope: workAmoV5RawBlockDiscoveryEnvelope({ blockTransactions: [raw],
    blockHeaderHex: header.toString("hex"), blockHash, blockHeight: height, previousBlockHash: PREV }), blockHash };
}

test("complete serialized Core block proof independently prevents omitted page-link carriers", () => {
  const { envelope, blockHash } = actualCoreEnvelope();
  assert.equal(envelope.records.length, 1);
  const raw = envelope.records[0];
  const record = { txid: raw.txid, rawCandidate: true, protocol: raw.protocol,
    position: { blockHeight: height, blockHash, blockTransactionIndex: raw.blockTransactionIndex,
      protocolVout: raw.protocolVout, recordOrdinal: raw.recordOrdinal }, rawWitness: raw.payload };
  const row = { height, block_hash: blockHash, protocol_record_count: 1,
    raw_protocol_candidate_count: envelope.rawProtocolCandidateCount,
    payload: { replayRecords: [record], replayDescriptorCommitment: commit([record]),
      blockDescriptorCommitment: envelope.blockDescriptorCommitment,
      rawProtocolCandidateCount: envelope.rawProtocolCandidateCount } };
  const core = dnsPageLinkCoreBlockWitness(envelope, []);
  assert.deepEqual(assertDnsPageLinkRawBlockCoverage(row, core), []);
  row.payload.replayRecords = []; row.payload.replayDescriptorCommitment = commit([]);
  row.protocol_record_count = 0;
  assert.throws(() => assertDnsPageLinkRawBlockCoverage(row, core), /incomplete/u);
});

const apiSource = await readFile(new URL("./proof-api.mjs", import.meta.url), "utf8");
const apiHelperSource = apiSource.slice(apiSource.indexOf("function dnsAcceptedRootEvents("),
  apiSource.indexOf("async function dnsPayloadWithAdditiveRecords("));
const shared = await import("../src/shared/protocol/dnsPages.mjs");
function apiRuntime({ discovery, unavailable = false, changed = false, activationHeight = height - 10 } = {}) {
  const context = vm.createContext({ DNS_PAGE_LINK_ACTIVATION_HEIGHT: activationHeight,
    DNS_PAGE_LINK_SELF_PAYMENT_SATS: 546, DNS_PAGE_LINK_PREFIX: shared.DNS_PAGE_LINK_PREFIX,
    replayDnsPageLinks: shared.replayDnsPageLinks,
    discoverDnsPageLinks: async () => { if (unavailable) throw new Error("index incomplete"); return discovery; },
    isValidBitcoinAddress: address => ["alice", "bob", "resolver"].includes(address),
    bitcoinRpc: async () => ({ height, blockHash: changed ? PREV : HASH }),
    exactCoreTipFromBlockchainInfo: value => value, errorSummary: error => error.message,
  });
  vm.runInContext(apiHelperSource, context); return context;
}
function acceptedRoot(kind, offset, owner = "alice") {
  return { kind, id: "alice", ownerAddress: owner, receiveAddress: "resolver",
    txid: offset.toString(16).padStart(64, "0"), blockHeight: height - 10 + offset,
    blockIndex: 0, protocolVout: 1, recordOrdinal: 0 };
}
function pageEvent(root, offset, action = "set") {
  return { txid: (offset + 100).toString(16).padStart(64, "0"), blockHeight: height - 10 + offset,
    txIndex: 1, protocolVout: 1, recordOrdinal: 0, pageLinkCarrierCount: 1,
    payload: shared.buildDnsPageLinkPayload({ action, name: "alice",
      epoch: { txid: root.txid, protocolVout: 1, recordOrdinal: 0 },
      ...(action === "set" ? { pageTxid: TXID } : {}) }),
    inputAddresses: ["alice"], outputs: [{ vout: 0, address: "alice", valueSats: 546 }] };
}
const apiPayload = () => ({ network: "livenet", records: [{ id: "alice", network: "livenet", confirmed: true,
  ownerAddress: "alice", receiveAddress: "resolver" }], indexedThroughBlock: height, checkpointHash: HASH,
  coverage: { complete: true } });
const apiCoverage = () => ({ complete: true, activationHeight: height - 10, indexedThroughBlock: height,
  checkpointHash: HASH, blockCount: 11, witnessSha256: PREV, pageLinkSha256: TXID,
  model: "dns-page-link-core-raw-block-coverage-v1" });

test("API publishes active page-link evidence and root epoch independently of child discovery", async () => {
  const root = acceptedRoot("register", 1), event = pageEvent(root, 2);
  const runtime = apiRuntime({ discovery: { events: [event], coverage: apiCoverage() } });
  const result = await runtime.dnsPayloadWithPageLinks(apiPayload(), { _powAuditEvents: [root] }, { height, blockHash: HASH }, "livenet");
  assert.equal(result.pageLinkAdmission.ready, true); assert.equal(result.pageLinkCoverage.network, "livenet");
  assert.equal(result.pageLinkCoverage.checkpointHash, result.checkpointHash);
  assert.equal(result.pageLinkAdmission.protocolPrefix, shared.DNS_PAGE_LINK_PREFIX);
  const record = result.records[0], link = record.pageLink;
  assert.equal(link.name, "alice.pow"); assert.equal(link.pageTxid, TXID);
  assert.equal(link.confirmed, true); assert.equal(link.active, true); assert.equal(link.valid, true);
  assert.deepEqual(link.ownershipEpoch, record.ownershipEpoch);
  assert.equal(record.ownershipEpochBlockHeight, root.blockHeight);
  assert.equal(result.pageLinkEvents[0].kind, "dns-page-link-set");
  assert.equal(result.pageLinkEvents[0].id, "alice");
  assert.equal(result.pageLinkHistoricalRecords.length, 0);
});

test("API retains cleared and invalidated evidence, pending remains separate from active links", async () => {
  const root = acceptedRoot("register", 1), event = pageEvent(root, 2);
  const clear = pageEvent(root, 3, "clear"), pending = { ...pageEvent(root, 4), blockHeight: null, txIndex: null };
  for (const [events, roots, status] of [
    [[event, clear, pending], [root], "cleared"],
    [[event, pending], [root, acceptedRoot("transfer", 3, "bob")], "invalidated"],
  ]) {
    const result = await apiRuntime({ discovery: { events, coverage: apiCoverage() } })
      .dnsPayloadWithPageLinks(apiPayload(), { _powAuditEvents: roots }, { height, blockHash: HASH }, "livenet");
    assert.equal(result.records[0].pageLink, null); assert.equal(result.pageLinks.length, 0);
    assert.equal(result.pageLinkHistoricalRecords[0].status, status);
    assert.equal(result.pageLinkPendingEvents.length, 1); assert.equal(result.pageLinkPendingEvents[0].confirmed, false);
  }
});

test("API activation and unavailable coverage fail closed without claiming empty verified routing", async () => {
  const root = acceptedRoot("register", 1);
  for (const options of [{ activationHeight: 0 }, { unavailable: true }]) {
    const result = await apiRuntime(options).dnsPayloadWithPageLinks(apiPayload(), { _powAuditEvents: [root] }, { height, blockHash: HASH }, "livenet");
    assert.equal(result.records[0].pageLink, null); assert.equal(result.pageLinkCoverage.complete, false);
    assert.equal(result.pageLinkAdmission.ready, false); assert.match(result.pageLinkAdmission.reason, /not configured|unavailable/u);
    assert.equal(result.records[0].ownershipEpoch.txid, root.txid);
  }
  await assert.rejects(apiRuntime({ changed: true, activationHeight: 0 })
    .dnsPayloadWithPageLinks(apiPayload(), { _powAuditEvents: [root] }, { height, blockHash: HASH }, "livenet"), /checkpoint changed/u);
});

test("full DNS response preserves Pages authority when child history is unavailable", async () => {
  const source = apiSource.slice(apiSource.indexOf("async function dnsPayloadWithAdditiveRecords("),
    apiSource.indexOf("async function dnsRegistryPayload("));
  assert.match(apiSource, /return dnsPayloadWithAdditiveRecords\(\{/u, "the existing canonical root read uses the additive merge");
  const runtime = vm.createContext({
    dnsRegistryRootRead: async () => ({ payload: apiPayload(), state: {}, checkpoint: { height, blockHash: HASH } }),
    dnsPayloadWithSubdomains: async payload => ({ ...payload, subdomainAdmission: { ready: false }, subdomains: [] }),
    dnsPayloadWithPageLinks: async payload => ({ ...payload, pageLinkAdmission: { ready: true }, pageLinks: [{ name: "alice.pow", pageTxid: TXID }] }),
    dnsPayloadWithSubdomainPageLinks: async payload => ({ ...payload, subdomainPageLinkAdmission: { ready: false } }),
  });
  vm.runInContext(source, runtime);
  const result = await runtime.dnsPayloadWithAdditiveRecords(apiPayload(), {}, { height, blockHash: HASH }, "livenet");
  assert.equal(result.subdomainAdmission.ready, false); assert.equal(result.pageLinkAdmission.ready, true);
  assert.equal(result.pageLinks[0].pageTxid, TXID);
});

function logFixture() {
  const payload = shared.buildDnsPageLinkPayload({ action: "set", name: "alice", epoch: {
    txid: PREV, protocolVout: 1, recordOrdinal: 0 }, pageTxid: HASH });
  const event = { txid: TXID, blockHeight: height, txIndex: 3, protocolVout: 1, recordOrdinal: 0,
    confirmed: true, valid: true, status: "accepted", reason: null, payload,
    record: shared.parseDnsPageLinkPayload(payload), state: { name: "alice.pow", txid: TXID } };
  const item = { txid: TXID, blockHeight: height, blockIndex: 3, protocolVout: 1, recordOrdinal: 0,
    confirmed: true, valid: false, kind: "protocol-event-invalid", payload,
    reasonCode: "work-amo-v5-raw-pwdns-invalid", amountSats: 0, minerFeeSats: 0,
    frozenNetworkValueSats: 0, stateDelta: { economicOutputs: [] } };
  const checkpoint = { indexedThroughBlock: height, checkpointHash: HASH };
  return { event, item, payload: { ...checkpoint, indexedThroughBlockHash: HASH,
    totalCount: 1, offset: 0, hasMore: false, items: [item] }, dns: { ...checkpoint,
      pageLinkCoverage: { ...checkpoint, complete: true }, pageLinkAdmission: { ...checkpoint, ready: true },
      pageLinkEvents: [event], pageLinkPendingEvents: [], pageLinkHistoricalRecords: [],
      pageLinks: [{ name: "alice.pow", txid: TXID, status: "active" }] } };
}

test("Log qualification preserves stored carrier admission, kind, economic markers, and public membership", () => {
  const { payload, dns, item } = logFixture();
  assert.equal(dnsPageLinkLogPayloadHasLinks(payload), true);
  const qualified = qualifyDnsPageLinkLogPayload(payload, dns);
  const row = qualified.items[0];
  assert.equal(row.protocolValid, true); assert.equal(row.protocolStatus, "accepted");
  assert.equal(row.dnsPageLinkStatus, "active"); assert.equal(row.dnsPageLinkAction, "set");
  assert.equal(row.kind, item.kind); assert.equal(row.valid, false);
  assert.equal(row.reasonCode, item.reasonCode); assert.equal(row.amountSats, 0); assert.equal(row.minerFeeSats, 0);
  assert.equal(row.frozenNetworkValueSats, 0); assert.deepEqual(row.stateDelta, item.stateDelta);
  assert.equal(qualified.totalCount, payload.totalCount); assert.equal(qualified.items.length, payload.items.length);
  assert.equal(qualified.hasMore, payload.hasMore); assert.equal(qualified.offset, payload.offset);
  assert.equal(item.protocolValid, undefined, "stored input is not mutated");
  const ordinary = { ...payload, items: [{ ...item, payload: "pwm1:m:ordinary", kind: "mail", valid: true }] };
  assert.equal(qualifyDnsPageLinkLogPayload(ordinary, null), ordinary);
});

test("Log distinguishes accepted historical links, rejected attempts, and pending visibility", async () => {
  for (const status of ["invalidated", "cleared", "replaced"]) {
    const { payload, dns } = logFixture(); dns.pageLinks = [];
    dns.pageLinkHistoricalRecords = [{ name: "alice.pow", txid: TXID, status,
      invalidatedByTxid: PREV, invalidatedAtBlock: height + 1,
      clearedByTxid: HASH, clearedAtBlock: height + 1 }];
    const row = qualifyDnsPageLinkLogPayload(payload, dns).items[0];
    assert.equal(row.protocolValid, true); assert.equal(row.dnsPageLinkStatus, status);
    assert.equal(row.invalidatedByTxid, PREV);
    assert.equal(row.clearedByTxid, HASH);
  }
  const root = acceptedRoot("register", 1), set = pageEvent(root, 2), clear = pageEvent(root, 3, "clear");
  const replayed = await apiRuntime({ discovery: { events: [set, clear], coverage: apiCoverage() } })
    .dnsPayloadWithPageLinks(apiPayload(), { _powAuditEvents: [root] }, { height, blockHash: HASH }, "livenet");
  const setLog = { indexedThroughBlock: height, checkpointHash: HASH, items: [{ txid: set.txid,
    protocolVout: set.protocolVout, recordOrdinal: set.recordOrdinal, confirmed: true,
    blockHeight: set.blockHeight, blockIndex: set.txIndex, payload: set.payload, valid: false }] };
  const clearedSet = qualifyDnsPageLinkLogPayload(setLog, replayed).items[0];
  assert.equal(clearedSet.dnsPageLinkStatus, "cleared");
  assert.equal(clearedSet.clearedByTxid, clear.txid);

  const rejected = logFixture(); rejected.event.valid = false; rejected.event.reason = "unauthorized-owner";
  const invalid = qualifyDnsPageLinkLogPayload(rejected.payload, rejected.dns).items[0];
  assert.equal(invalid.protocolValid, false); assert.equal(invalid.dnsPageLinkStatus, "rejected");
  assert.equal(invalid.dnsPageLinkReasonCode, "unauthorized-owner");
  assert.equal(invalid.reasonCode, "work-amo-v5-raw-pwdns-invalid");
  const pending = logFixture(); pending.event.blockHeight = null; pending.event.txIndex = null;
  pending.event.confirmed = false; pending.event.status = "pending"; delete pending.event.state;
  pending.item.confirmed = false; delete pending.item.blockHeight; delete pending.item.blockIndex;
  pending.dns.pageLinkEvents = []; pending.dns.pageLinkPendingEvents = [pending.event]; pending.dns.pageLinks = [];
  assert.equal(qualifyDnsPageLinkLogPayload(pending.payload, pending.dns).items[0].dnsPageLinkStatus, "pending");
});

test("Log binds page-link qualification to complete exact-checkpoint byte and position membership", () => {
  for (const mutate of [
    value => { value.dns.checkpointHash = PREV; },
    value => { value.dns.pageLinkCoverage.complete = false; },
    value => { value.dns.pageLinkCoverage.checkpointHash = PREV; },
    value => { value.dns.pageLinkAdmission.ready = false; },
    value => { value.dns.pageLinkEvents = []; },
    value => { value.dns.pageLinkEvents.push({ ...value.event }); },
    value => { value.event.txIndex = 4; },
    value => { value.item.protocolVout = 2; },
    value => { value.item.payload += "mutated"; },
  ]) {
    const value = logFixture(); mutate(value);
    assert.throws(() => qualifyDnsPageLinkLogPayload(value.payload, value.dns), /Log/u);
  }
  const malformed = logFixture();
  malformed.item.payload = "pwdns1:";
  const raw = Buffer.concat([Buffer.from(shared.DNS_PAGE_LINK_PREFIX), Buffer.from([0xff])]).toString("hex");
  malformed.item.workAmoV5RawScriptWitness = { payloadHex: raw, decodeValid: false };
  malformed.event.payload = shared.DNS_PAGE_LINK_PREFIX; malformed.event.rawPayloadHex = raw;
  malformed.event.decodeValid = false; malformed.event.record = null; malformed.event.state = undefined;
  malformed.event.valid = false; malformed.event.reason = "invalid-payload";
  assert.equal(dnsPageLinkLogPayloadHasLinks(malformed.payload), true);
  assert.equal(qualifyDnsPageLinkLogPayload(malformed.payload, malformed.dns).items[0].dnsPageLinkReasonCode, "invalid-payload");
  malformed.item.workAmoV5RawScriptWitness.payloadHex += "00";
  assert.throws(() => qualifyDnsPageLinkLogPayload(malformed.payload, malformed.dns), /bytes/u);

  const nested = logFixture();
  const nestedRaw = Buffer.from(nested.item.payload).toString("hex");
  nested.event.rawPayloadHex = nestedRaw;
  nested.item.payload = { rawRecordParts: [{ payloadHex: nestedRaw }] };
  assert.equal(dnsPageLinkLogPayloadHasLinks(nested.payload), true);
  assert.equal(qualifyDnsPageLinkLogPayload(nested.payload, nested.dns).items[0].protocolValid, true);
  nested.item.payload.rawRecordParts[0].payloadHex += "00";
  assert.throws(() => qualifyDnsPageLinkLogPayload(nested.payload, nested.dns), /bytes/u);
});

function chainFixture(count = 3) {
  const chain = [];
  for (let offset = 0; offset < count; offset += 1) {
    const { row, raw, event } = fixture();
    row.height = height + offset;
    row.block_hash = (offset + 50).toString(16).padStart(64, "0");
    row.previous_block_hash = chain.at(-1)?.row.block_hash ?? PREV;
    raw.txid = event.txid = (offset + 60).toString(16).padStart(64, "0");
    event.blockHeight = row.height;
    const record = row.payload.replayRecords[0];
    record.txid = raw.txid;
    record.position.blockHeight = row.height;
    record.position.blockHash = row.block_hash;
    row.payload.replayDescriptorCommitment = commit([record]);
    row.payload.blockDescriptorCommitment = commit({ completeFullCoreBlock: true, records: [raw] });
    const core = dnsPageLinkCoreBlockWitness({ records: [raw], rawProtocolCandidateCount: 1,
      blockDescriptorCommitment: row.payload.blockDescriptorCommitment }, [event]);
    chain.push({ row, core, event });
  }
  return chain;
}
function chainReader(chain, starts = [], coverageFault = value => value) {
  return async (network, options) => {
    starts.push(options.fromHeight ?? options.activationHeight);
    const selected = chain.filter(value => value.row.height <= options.expectedHeight);
    if (options.verifiedPrefix) {
      const prefixRows = selected.filter(value => value.row.height < options.fromHeight).map(value => value.row);
      assert.equal(options.verifiedPrefix.blockHash, prefixRows.at(-1).block_hash);
      assert.equal(options.verifiedPrefix.witnessSha256, coverageWitness(prefixRows));
    }
    for (const value of selected) if (value.row.height >= (options.fromHeight ?? options.activationHeight)) {
      await options.onBlock(value.row);
    }
    return coverageFault({ complete: true, activationHeight: options.activationHeight,
      indexedThroughBlock: options.expectedHeight, checkpointHash: options.expectedHash,
      blockCount: options.expectedHeight - options.activationHeight + 1,
      witnessSha256: coverageWitness(selected.map(value => value.row)), pendingTxids: ["pending"] });
  };
}

test("each slow verified block advances catch-up, while routing stays unavailable until exact closure", async () => {
  const chain = chainFixture(), starts = [];
  let clock = 0, coreReads = 0, pendingReads = 0;
  const discovery = createDnsPageLinkDiscovery({ readBudgetMs: 25, now: () => clock,
    readIndex: chainReader(chain, starts),
    readCoreHash: async value => chain.find(item => item.row.height === value)?.row.block_hash,
    async readCoreBlock(row) { coreReads += 1; clock += 30;
      return chain.find(value => value.row.height === Number(row.height)).core; },
    async hydratePending() { pendingReads += 1; return []; },
  });
  const checkpoint = { height: chain.at(-1).row.height, blockHash: chain.at(-1).row.block_hash };
  for (let offset = 0; offset < chain.length; offset += 1) {
    clock = 0;
    await assert.rejects(discovery("livenet", checkpoint, height), error => {
      assert.equal(error.code, "DNS_DISCOVERY_CATCH_UP");
      assert.equal(error.progress.verifiedThroughBlock, height + offset);
      assert.equal(error.progress.targetHeight, checkpoint.height);
      return true;
    });
    assert.equal(pendingReads, 0, "pending hydration cannot hide incomplete confirmed coverage");
  }
  clock = 0;
  const result = await discovery("livenet", checkpoint, height);
  assert.deepEqual(result.events, chain.map(value => value.event));
  assert.equal(result.coverage.complete, true);
  assert.equal(result.coverage.witnessSha256, coverageWitness(chain.map(value => value.row)));
  assert.equal(coreReads, chain.length);
  assert.deepEqual(starts, [height, height + 1, height + 2, height + 3]);
});

test("catch-up carries a verified prefix forward when the current checkpoint advances", async () => {
  const chain = chainFixture(), starts = [];
  let clock = 0, slow = true;
  const discovery = createDnsPageLinkDiscovery({ readBudgetMs: 25, now: () => clock,
    readIndex: chainReader(chain, starts),
    readCoreHash: async value => chain.find(item => item.row.height === value)?.row.block_hash,
    async readCoreBlock(row) { clock += slow ? 30 : 1;
      return chain.find(value => value.row.height === Number(row.height)).core; }, hydratePending: async () => [],
  });
  await assert.rejects(discovery("livenet", { height: height + 1, blockHash: chain[1].row.block_hash }, height), /read budget/u);
  clock = 0; slow = false;
  const result = await discovery("livenet", { height: height + 2, blockHash: chain[2].row.block_hash }, height);
  assert.equal(result.events.length, 3); assert.deepEqual(starts, [height, height + 1]);
  assert.equal(discovery.progress("livenet", height).targetHeight, height + 2);
});

test("a reorg drops partial catch-up evidence before independently verifying the replacement", async () => {
  const chain = chainFixture(), starts = [];
  let clock = 0, slow = true, coreReads = 0;
  const discovery = createDnsPageLinkDiscovery({ readBudgetMs: 25, now: () => clock,
    readIndex: chainReader(chain, starts),
    readCoreHash: async value => chain.find(item => item.row.height === value)?.row.block_hash,
    async readCoreBlock(row) { coreReads += 1; clock += slow ? 30 : 1;
      return chain.find(value => value.row.height === Number(row.height)).core; }, hydratePending: async () => [],
  });
  const checkpoint = { height: height + 2, blockHash: chain[2].row.block_hash };
  await assert.rejects(discovery("livenet", checkpoint, height), /read budget/u);
  chain[0].row.block_hash = HASH;
  chain[0].row.payload.replayRecords[0].position.blockHash = HASH;
  chain[0].row.payload.replayDescriptorCommitment = commit(chain[0].row.payload.replayRecords);
  chain[0].event.txid = "99".repeat(32);
  chain[1].row.previous_block_hash = HASH;
  clock = 0; slow = false;
  const result = await discovery("livenet", checkpoint, height);
  assert.deepEqual(starts, [height, height]); assert.equal(coreReads, 4);
  assert.equal(result.events[0].txid, "99".repeat(32));
});

test("a partial prefix never skips a gap, fork, raw mismatch, or forged closing witness", async () => {
  for (const fault of ["gap", "fork", "raw", "witness", "closing"]) {
    const chain = chainFixture();
    if (fault === "gap") chain[1].row.height += 1;
    if (fault === "fork") chain[1].row.previous_block_hash = HASH;
    if (fault === "raw") chain[1].row.payload.blockDescriptorCommitment.sha256 = PREV;
    const discovery = createDnsPageLinkDiscovery({
      readIndex: chainReader(chain, [], value => fault === "witness" ? { ...value, witnessSha256: PREV } :
        fault === "closing" ? { ...value, complete: false } : value),
      readCoreHash: async value => chain.find(item => item.row.height === value)?.row.block_hash,
      readCoreBlock: async row => chain.find(value => value.row.height === Number(row.height)).core,
      hydratePending: async () => [],
    });
    await assert.rejects(discovery("livenet", { height: height + 2, blockHash: chain[2].row.block_hash }, height),
      /gap|fork|descriptor|coverage/u);
    const progress = discovery.progress("livenet", height);
    assert.equal(progress.verifiedThroughBlock, ["witness", "closing"].includes(fault) ? height + 2 : height);
  }
});

test("bounded immutable LRU eviction permits catch-up and reconstructs an evicted witness", async () => {
  const chain = chainFixture(2);
  const maxCacheBytes = Math.max(...chain.map(value => Buffer.byteLength(JSON.stringify(value.core))));
  let coreReads = 0;
  const discovery = createDnsPageLinkDiscovery({ maxCacheBytes,
    readIndex: chainReader(chain),
    readCoreHash: async value => chain.find(item => item.row.height === value)?.row.block_hash,
    async readCoreBlock(row) { coreReads += 1; return chain.find(value => value.row.height === Number(row.height)).core; },
    hydratePending: async () => [],
  });
  await discovery("livenet", { height: height + 1, blockHash: chain[1].row.block_hash }, height);
  await discovery("livenet", { height, blockHash: chain[0].row.block_hash }, height);
  assert.equal(coreReads, 3, "eviction is a performance loss, never a coverage or byte-limit bypass");
});

test("projection overflow retains only the earlier fully verified contiguous prefix", async () => {
  const chain = chainFixture(2);
  const maxProjectionBytes = Buffer.byteLength(JSON.stringify([chain[0].event]));
  const discovery = createDnsPageLinkDiscovery({ maxProjectionBytes,
    readIndex: chainReader(chain),
    readCoreHash: async value => chain.find(item => item.row.height === value)?.row.block_hash,
    readCoreBlock: async row => chain.find(value => value.row.height === Number(row.height)).core,
    hydratePending: async () => [],
  });
  await assert.rejects(discovery("livenet", { height: height + 1, blockHash: chain[1].row.block_hash }, height), /byte budget/u);
  assert.equal(discovery.progress("livenet", height).verifiedThroughBlock, height);
});


test("resumable Core prefix matches the actual read-only index reader rolling witness", async () => {
  const chain = chainFixture(), starts = [], runtimes = [];
  let clock = 0;
  const discovery = createDnsPageLinkDiscovery({ readBudgetMs: 25, now: () => clock,
    async readIndex(network, options) {
      const start = options.fromHeight ?? options.activationHeight;
      starts.push(start);
      const checkpointScan = { indexed_through_block: options.expectedHeight,
        payload: { complete: true, tipHeight: options.expectedHeight,
          indexedThroughBlockHash: options.expectedHash }, consistency: { ok: true, status: "block-scan-current" } };
      const runtime = readerRuntime({ rows: chain.filter(value => value.row.height >= start).map(value => value.row),
        scans: [checkpointScan, checkpointScan],
        anchors: [{ block_hash: options.verifiedPrefix?.blockHash ?? HASH }] });
      runtimes.push(runtime);
      vm.runInContext(functionSource, runtime.context);
      return runtime.context.proofIndexDnsPageLinkDiscovery(network, options);
    },
    readCoreHash: async value => chain.find(item => item.row.height === value)?.row.block_hash,
    async readCoreBlock(row) { clock += 30; return chain.find(value => value.row.height === Number(row.height)).core; },
    hydratePending: async () => [],
  });
  const checkpoint = { height: height + 2, blockHash: chain[2].row.block_hash };
  for (let attempt = 0; attempt < 3; attempt += 1) {
    clock = 0;
    await assert.rejects(discovery("livenet", checkpoint, height), /read budget/u);
    assert.equal(runtimes.at(-1).released(), true);
    assert.equal(runtimes.at(-1).pendingReads(), 0);
  }
  clock = 0;
  const result = await discovery("livenet", checkpoint, height);
  assert.equal(result.coverage.witnessSha256, coverageWitness(chain.map(value => value.row)));
  assert.deepEqual(result.events, chain.map(value => value.event));
  assert.deepEqual(starts, [height, height + 1, height + 2, height + 3]);
  assert.equal(runtimes.at(-1).released(), true);
});
