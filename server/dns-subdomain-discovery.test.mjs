import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import {
  assertDnsSubdomainRawBlockCoverage, createDnsSubdomainDiscovery,
  dnsSubdomainCoreBlockWitness, dnsSubdomainCandidates, qualifyDnsSubdomainLogPayload,
} from "./dns-subdomain-discovery.mjs";
import { workAmoV5CanonicalPayloadCommitment as commit } from "./work-amo-v5.mjs";

const HASH = "11".repeat(32), PREV = "22".repeat(32), TXID = "33".repeat(32);
const height = 1_000_000;
function fixture() {
  const part = { payloadHex: Buffer.from("pwdns1:sub1:malformed").toString("hex"),
    text: "pwdns1:sub1:malformed", decodeValid: true, protocolVout: 1 };
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
  const core = dnsSubdomainCoreBlockWitness({ records: [raw],
    blockDescriptorCommitment: descriptor, rawProtocolCandidateCount: 1 }, [event]);
  return { row, core, raw, event };
}

test("discovery includes raw rejected/malformed child records and proves their complete bytes and positions", () => {
  const { row, core, raw, event } = fixture();
  assert.equal(dnsSubdomainCandidates([raw]).length, 1);
  assert.deepEqual(assertDnsSubdomainRawBlockCoverage(row, core), [event]);
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
    assert.throws(() => assertDnsSubdomainRawBlockCoverage(tampered, core), /DNS subdomain/u);
  }
});

test("immutable Core verification is reused without accepting a changed index commitment; pending failures stay best effort", async () => {
  const { row, core, event } = fixture(); let coreReads = 0;
  const discovery = createDnsSubdomainDiscovery({
    async readIndex(network, options) { await options.onBlock(row); return {
      complete: true, activationHeight: height, indexedThroughBlock: height,
      checkpointHash: HASH, blockCount: 1, pendingTxids: ["missing"] }; },
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
    const discovery = createDnsSubdomainDiscovery({ readIndex: async () => coverage,
      readCoreBlock: async () => null, hydratePending: async () => [] });
    await assert.rejects(discovery("livenet", { height, blockHash: HASH }, height), /coverage/u);
  }
});

function logFixture() {
  const event = { txid: TXID, blockHeight: height, txIndex: 3, protocolVout: 1,
    recordOrdinal: 0, confirmed: true, valid: true, status: "accepted", reason: null,
    record: { action: "create", parent: "alice", label: "abc", epoch: { txid: PREV, protocolVout: 1, recordOrdinal: 0 } },
    state: { name: "abc.alice.pow", createdTxid: TXID } };
  const item = { txid: TXID, blockHeight: height, blockIndex: 3, protocolVout: 1,
    recordOrdinal: 0, confirmed: true, valid: true, kind: "dns-subdomain-create" };
  return { event, item, payload: { indexedThroughBlock: height, indexedThroughBlockHash: HASH, items: [item] },
    dns: { indexedThroughBlock: height, checkpointHash: HASH, subdomainCoverage: { complete: true },
      subdomainAdmission: { ready: true }, subdomainEvents: [event], subdomainPendingEvents: [],
      subdomainHistoricalRecords: [], subdomains: [{ name: "abc.alice.pow", createdTxid: TXID, status: "active" }] } };
}

test("Log labels protocol authority independently of economics-neutral persisted admission", () => {
  const { payload, dns, event } = logFixture();
  const live = qualifyDnsSubdomainLogPayload(payload, dns).items[0];
  assert.equal(live.protocolValid, true); assert.equal(live.dnsSubdomainStatus, "active");
  for (const reason of ["unauthorized-owner", "stale-ownership-epoch"]) {
    event.valid = false; event.reason = reason; event.status = "rejected";
    const rejected = qualifyDnsSubdomainLogPayload(payload, dns).items[0];
    assert.equal(rejected.valid, true, "persisted carrier admission remains immutable");
    assert.equal(rejected.protocolValid, false); assert.equal(rejected.protocolStatus, "rejected");
    assert.match(rejected.title, /rejected/u); assert.equal(rejected.reasonCode, reason);
  }
});

test("valid historical child occurrence remains valid after its parent ownership period ends", () => {
  const { payload, dns } = logFixture();
  dns.subdomains = [];
  dns.subdomainHistoricalRecords = [{ name: "abc.alice.pow", createdTxid: TXID,
    status: "invalidated", invalidatedByTxid: PREV, invalidatedAtBlock: height + 1 }];
  const result = qualifyDnsSubdomainLogPayload(payload, dns).items[0];
  assert.equal(result.protocolValid, true); assert.equal(result.dnsSubdomainStatus, "invalidated");
  assert.equal(result.invalidatedByTxid, PREV);
});

test("Log refuses unmatched checkpoint, unavailable replay, and missing carrier membership", () => {
  for (const mutate of [
    dns => { dns.checkpointHash = PREV; },
    dns => { dns.subdomainCoverage.complete = false; },
    dns => { dns.subdomainAdmission.ready = false; },
    dns => { dns.subdomainEvents = []; },
    dns => { dns.subdomainEvents[0].txIndex = 4; },
  ]) {
    const { payload, dns } = logFixture(); mutate(dns);
    assert.throws(() => qualifyDnsSubdomainLogPayload(payload, dns), /Log/u);
  }
});

const readerSource = await readFile(new URL("./db/proof-index-reader.mjs", import.meta.url), "utf8");
const functionSource = readerSource.slice(readerSource.indexOf("export async function proofIndexDnsSubdomainDiscovery("),
  readerSource.indexOf("export async function proofIndexCanonicalCheckpointPayload("))
  .replace("export async function", "async function");
function readerRuntime({ rows, scans, anchors = [{ block_hash: HASH }] }) {
  let scanIndex = 0; let released = false; let pendingReads = 0;
  const client = { async query(sql) {
    if (sql.includes("dns_subdomain_verified_prefix_anchor")) return { rows: anchors };
    if (sql.includes("dns_subdomain_raw_block_coverage")) return { rows };
    if (sql.includes("dns_subdomain_pending_candidates")) { pendingReads += 1; return { rows: [] }; }
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
const { createHash } = await import("node:crypto");
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
    const call = runtime.context.proofIndexDnsSubdomainDiscovery("livenet", { activationHeight: height,
      expectedHeight: height, expectedHash: HASH, onBlock: async () => {} });
    if (fault === "none") assert.equal((await call).complete, true);
    else await assert.rejects(call, /DNS subdomain/u);
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
    Buffer.from("pwdns1:sub1:malformed", "utf8")]);
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

test("complete serialized Core block proof independently prevents omitted child carriers", () => {
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
  const core = dnsSubdomainCoreBlockWitness(envelope, []);
  assert.deepEqual(assertDnsSubdomainRawBlockCoverage(row, core), []);
  row.payload.replayRecords = []; row.payload.replayDescriptorCommitment = commit([]);
  row.protocol_record_count = 0;
  assert.throws(() => assertDnsSubdomainRawBlockCoverage(row, core), /incomplete/u);
});

const apiSource = await readFile(new URL("./proof-api.mjs", import.meta.url), "utf8");
const apiHelperSource = apiSource.slice(apiSource.indexOf("function dnsSubdomainPublicRecord("),
  apiSource.indexOf("async function dnsRegistryPayload("));
const shared = await import("../src/shared/protocol/dnsSubdomains.mjs");
function apiRuntime({ discovery, unavailable = false, checkpointChanged = false } = {}) {
  const context = vm.createContext({ DNS_SUBDOMAIN_ACTIVATION_HEIGHT: height - 10,
    DNS_SUBDOMAIN_SELF_PAYMENT_SATS: 546, DNS_SUBDOMAIN_PREFIX: shared.DNS_SUBDOMAIN_PREFIX,
    replayDnsSubdomains: shared.replayDnsSubdomains,
    discoverDnsSubdomains: async () => { if (unavailable) throw new Error("index incomplete"); return discovery; },
    isValidBitcoinAddress: address => ["alice", "bob", "resolver", "second"].includes(address),
    bitcoinRpc: async () => ({ height, blockHash: checkpointChanged ? PREV : HASH }),
    exactCoreTipFromBlockchainInfo: value => value,
    errorSummary: error => error.message,
  });
  vm.runInContext(apiHelperSource, context);
  return context;
}
function rootEvent(kind, offset, owner = "alice", resolver = "resolver") {
  return { kind, id: "alice", ownerAddress: owner, receiveAddress: resolver,
    txid: offset.toString(16).padStart(64, "0"), blockHeight: height - 10 + offset,
    blockIndex: 0, protocolVout: 1, recordOrdinal: 0 };
}
function childEvent(epoch, offset, actor = "alice") {
  return { txid: (offset + 100).toString(16).padStart(64, "0"), blockHeight: height - 10 + offset,
    txIndex: 1, protocolVout: 1, recordOrdinal: 0, subdomainCarrierCount: 1,
    payload: shared.buildDnsSubdomainPayload({ action: "create", parent: "alice", label: "abc", epoch,
      resolver: null }, { validateAddress: () => true }), inputAddresses: [actor],
    outputs: [{ vout: 0, address: actor, valueSats: 546 }] };
}

test("API adapter exposes current parent epoch, inherited child resolution and transfer invalidation", async () => {
  const registration = rootEvent("register", 1);
  const epoch = shared.dnsOwnershipEpoch(registration);
  const event = childEvent(epoch, 2);
  const state = { _powAuditEvents: [registration, rootEvent("update", 3, "alice", "second")] };
  const payload = { stats: { total: 1 }, records: [{ id: "alice", confirmed: true, ownerAddress: "alice" }] };
  const runtime = apiRuntime({ discovery: { events: [event], coverage: { complete: true } } });
  let result = await runtime.dnsPayloadWithSubdomains(payload, state, { height, blockHash: HASH }, "livenet");
  assert.equal(result.subdomains[0].receiveAddress, "second");
  assert.equal(result.subdomains[0].inherited, true);
  assert.deepEqual(JSON.parse(JSON.stringify(result.records[0].ownershipEpoch)), epoch);
  assert.equal(result.subdomainAdmission.ready, true); assert.equal(result.stats.total, 1);
  state._powAuditEvents.push(rootEvent("transfer", 4, "bob", "bob"));
  result = await runtime.dnsPayloadWithSubdomains(payload, state, { height, blockHash: HASH }, "livenet");
  assert.equal(result.subdomains.length, 0);
  assert.equal(result.subdomainHistoricalRecords[0].status, "invalidated");
  assert.equal(result.subdomainHistoricalRecords[0].ownerAddress, "alice");
  assert.equal(result.subdomainHistoricalRecords[0].currentOwnerAddress, "bob");
  assert.equal(result.subdomainEvents[0].currentOwnerAddress, "bob");
  assert.notDeepEqual(JSON.parse(JSON.stringify(result.records[0].ownershipEpoch)), epoch);
});

test("API adapter keeps incomplete child coverage unknown and refuses checkpoint changes", async () => {
  const state = { _powAuditEvents: [rootEvent("register", 1)] };
  const payload = { stats: { total: 1 }, records: [{ id: "alice", confirmed: true }] };
  const runtime = apiRuntime({ unavailable: true });
  const result = await runtime.dnsPayloadWithSubdomains(payload, state, { height, blockHash: HASH }, "livenet");
  assert.equal(result.subdomainAdmission.ready, false); assert.equal(result.subdomainCoverage.complete, false);
  assert.equal(result.subdomainStats.active, null); assert.equal(result.stats.total, 1);
  const changed = apiRuntime({ unavailable: true, checkpointChanged: true });
  await assert.rejects(changed.dnsPayloadWithSubdomains(payload, state, { height, blockHash: HASH }, "livenet"), /checkpoint changed/u);
});

test("verified prefix rebinds Core and index anchors and reads only the new tail", async () => {
  const { row, core, event } = fixture(); let coreReads = 0, hashes = 0;
  const starts = [];
  const discovery = createDnsSubdomainDiscovery({
    async readIndex(network, options) {
      starts.push(options.fromHeight ?? options.activationHeight);
      if (!options.verifiedPrefix) await options.onBlock(row);
      else {
        assert.equal(options.verifiedPrefix.blockHash, HASH);
        assert.equal(options.verifiedPrefix.witnessSha256, PREV);
      }
      return { complete: true, activationHeight: height, indexedThroughBlock: height,
        checkpointHash: HASH, blockCount: 1, witnessSha256: PREV, pendingTxids: [] };
    },
    async readCoreHash() { hashes += 1; return HASH; },
    async readCoreBlock() { coreReads += 1; return core; }, hydratePending: async () => [],
  });
  assert.deepEqual((await discovery("livenet", { height, blockHash: HASH }, height)).events, [event]);
  // Changing DB projection bytes cannot replace the independent Core-derived
  // retained child set once the immutable prefix remains canonical.
  row.payload.replayRecords = [];
  assert.deepEqual((await discovery("livenet", { height, blockHash: HASH }, height)).events, [event]);
  assert.deepEqual(starts, [height, height + 1]); assert.equal(hashes, 1); assert.equal(coreReads, 1);
});

test("a reorg discards the retained prefix and independently verifies the replacement block", async () => {
  const { row, core } = fixture(); let activeHash = HASH, coreReads = 0;
  const discovery = createDnsSubdomainDiscovery({
    async readIndex(network, options) {
      assert.equal(options.verifiedPrefix, undefined);
      await options.onBlock(row);
      return { complete: true, activationHeight: height, indexedThroughBlock: height,
        checkpointHash: activeHash, blockCount: 1, witnessSha256: HASH, pendingTxids: [] };
    },
    readCoreHash: async () => activeHash,
    async readCoreBlock() { coreReads += 1; return core; }, hydratePending: async () => [],
  });
  await discovery("livenet", { height, blockHash: HASH }, height);
  activeHash = PREV; row.block_hash = PREV;
  row.payload.replayRecords[0].position.blockHash = PREV;
  row.payload.replayDescriptorCommitment = commit(row.payload.replayRecords);
  await discovery("livenet", { height, blockHash: PREV }, height);
  assert.equal(coreReads, 2);
});

test("byte and time limits fail closed while a later retry can continue independently verified catch-up", async () => {
  for (const limits of [{ maxCacheBytes: 1 }, { maxProjectionBytes: 1 }]) {
    const { row, core } = fixture();
    const discovery = createDnsSubdomainDiscovery({ ...limits,
      async readIndex(network, options) { await options.onBlock(row); return null; },
      readCoreBlock: async () => core, hydratePending: async () => [] });
    await assert.rejects(discovery("livenet", { height, blockHash: HASH }, height), /byte budget/u);
  }
  const { row, core } = fixture(); let clock = 0, coreReads = 0;
  const discovery = createDnsSubdomainDiscovery({ readBudgetMs: 25, now: () => clock,
    async readIndex(network, options) { await options.onBlock(row); return {
      complete: true, activationHeight: height, indexedThroughBlock: height,
      checkpointHash: HASH, blockCount: 1, pendingTxids: [] }; },
    async readCoreBlock() { coreReads += 1; clock = 30; return core; }, hydratePending: async () => [] });
  await assert.rejects(discovery("livenet", { height, blockHash: HASH }, height), /read budget/u);
  clock = 0;
  assert.equal((await discovery("livenet", { height, blockHash: HASH }, height)).coverage.complete, true);
  assert.equal(coreReads, 1, "partial catch-up retains only independently verified block proofs");
});

const backfillSource = await readFile(new URL("../scripts/backfill-proof-indexer.mjs", import.meta.url), "utf8");
const backfillHelper = backfillSource.slice(backfillSource.indexOf("function protocolItemsFromTx("),
  backfillSource.indexOf("\nfunction ", backfillSource.indexOf("function protocolItemsFromTx(") + 1));
const { parseWorkAmoV5RawPwdnsRecord, isWorkAmoV5LivenetAddress } = await import("./work-amo-v5.mjs");
const { canonicalRawProtocolRecordSetFromTransaction } = await import("./canonical-op-return.mjs");
test("indexer adapter binds exact txid/ordinal and all input evidence for the neutral self-message carrier", () => {
  const owner = "1F1p9UEHuH5KTFR7Zsx93Khdrqhj6t5nFv";
  const payload = shared.buildDnsSubdomainPayload({ action: "create", parent: "alice", label: "abc",
    epoch: { txid: PREV, protocolVout: 1, recordOrdinal: 0 }, resolver: null },
    { validateAddress: isWorkAmoV5LivenetAddress });
  const script = Buffer.from(bitcoin.script.compile([bitcoin.opcodes.OP_RETURN, Buffer.from(payload)]));
  const tx = { txid: TXID, vin: [{ prevout: { scriptpubkey_address: owner } }],
    vout: [{ scriptpubkey_address: owner, value: 546 }, { scriptpubkey: script.toString("hex"), value: 0 }] };
  const context = vm.createContext({ Buffer, DNS_SUBDOMAIN_ACTIVATION_HEIGHT: height,
    DNS_SUBDOMAIN_PREFIX: shared.DNS_SUBDOMAIN_PREFIX, dnsSubdomainSelfSendAuthor: shared.dnsSubdomainSelfSendAuthor,
    parseWorkAmoV5RawPwdnsRecord, isWorkAmoV5LivenetAddress, canonicalRawProtocolRecordSetFromTransaction,
    baseProtocolItem: (tx, message, kind) => ({ txid: tx.txid, protocolVout: 1, recordOrdinal: 0,
      blockHeight: height, confirmed: true, kind, recipients: [{ vout: 0, address: owner, amountSats: "546" }] }),
    invalidProtocolItem: (item, reason) => ({ ...item, valid: false, reason }),
  });
  vm.runInContext(backfillHelper, context);
  const [event] = context.protocolItemsFromTx(tx, { prefix: "pwdns1:", text: payload });
  assert.equal(event.valid, true); assert.equal(event.authorAddress, owner);
  tx.vin.push({ prevout: null });
  assert.equal(context.protocolItemsFromTx(tx, { prefix: "pwdns1:", text: payload })[0].valid, false);
});


test("reader rejects a missing, duplicate or reorganized verified prefix anchor", async () => {
  for (const anchors of [[{ block_hash: HASH }], [], [{ block_hash: PREV }],
    [{ block_hash: HASH }, { block_hash: PREV }]]) {
    const runtime = readerRuntime({ rows: [], scans: [scan(), scan()], anchors });
    vm.runInContext(functionSource, runtime.context);
    const call = runtime.context.proofIndexDnsSubdomainDiscovery("livenet", { activationHeight: height,
      fromHeight: height + 1, verifiedPrefix: { height, blockHash: HASH, witnessSha256: PREV },
      expectedHeight: height, expectedHash: HASH, onBlock: async () => { throw new Error("no new tail"); } });
    if (anchors.length === 1 && anchors[0].block_hash === HASH) assert.equal((await call).witnessSha256, PREV);
    else await assert.rejects(call, /verified prefix/u);
    assert.equal(runtime.released(), true);
  }
});
