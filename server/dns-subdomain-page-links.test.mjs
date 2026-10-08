import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import * as bitcoin from "bitcoinjs-lib";
import * as childPages from "../src/shared/protocol/dnsSubdomainPages.mjs";
import * as children from "../src/shared/protocol/dnsSubdomains.mjs";
import * as rootPages from "../src/shared/protocol/dnsPages.mjs";
import * as adapter from "./dns-subdomain-page-links.mjs";
import { dnsPageLinkCoreBlockWitness, assertDnsPageLinkRawBlockCoverage, createDnsPageLinkDiscovery } from "./dns-page-link-discovery.mjs";
import { canonicalRawProtocolRecordSetFromTransaction } from "./canonical-op-return.mjs";
import * as raw from "./work-amo-v5-raw.mjs";
import * as work from "./work-amo-v5.mjs";
import { readDnsSubdomainPageLinkSnapshot } from "../src/features/pages/dnsSubdomainPageLinkClient.mjs";
import { createOwnerOutputCommitmentFixture } from "../tests/fixtures/ownerOutputCommitment.mjs";

const OWNER = createOwnerOutputCommitmentFixture().ownerAddress, OTHER = "1F1zepCJ8VPcPoeMt6G4BPKuE3CYAxCKNY";
const height = 20, HASH = "11".repeat(32), PREV = "22".repeat(32), TARGET = "77".repeat(32);
const txid = value => value.toString(16).padStart(64, "0");
const epoch = { txid: txid(1), protocolVout: 1, recordOrdinal: 0 };
const child = { txid: txid(2), protocolVout: 1, recordOrdinal: 0 };
const validAddress = value => [OWNER, OTHER].includes(value);
const rootEvent = (kind = "register", n = 1, blockHeight = 10) => ({ kind, id: "alice", ownerAddress: OWNER,
  receiveAddress: OWNER, txid: txid(n), blockHeight, blockIndex: n, protocolVout: 1, recordOrdinal: 0 });
const childEvent = (action = "create", n = 2, blockHeight = 11) => ({ txid: txid(n), blockHeight, txIndex: n,
  protocolVout: 1, recordOrdinal: 0, subdomainCarrierCount: 1, inputAddresses: [OWNER],
  outputs: [{ vout: 0, address: OWNER, valueSats: "546" }], payload: children.buildDnsSubdomainPayload({
    action, parent: "alice", label: "app", epoch, ...(action === "revoke" ? {} : { resolver: null }),
  }, { validateAddress: validAddress }) });
const pageEvent = (action = "set", n = 3, blockHeight = 12, binding = child, hashTypes = [1]) => {
  const payload = childPages.buildDnsSubdomainPageLinkPayload({ action, parent: "alice", label: "app", epoch, child: binding,
    ...(action === "set" ? { pageTxid: TARGET } : {}) });
  const signed = createOwnerOutputCommitmentFixture({ payload, number: n, hashTypes });
  return { ...signed, payload, blockHeight, txIndex: blockHeight === null ? null : n,
    protocolVout: 1, recordOrdinal: 0, subdomainPageLinkCarrierCount: 1 };
};
const plain = value => JSON.parse(JSON.stringify(value));

const apiSource = await readFile(new URL("./proof-api.mjs", import.meta.url), "utf8");
const helpers = apiSource.slice(apiSource.indexOf("function dnsSubdomainPublicRecord("),
  apiSource.indexOf("async function dnsPayloadWithAdditiveRecords("));
function coverage(activationHeight, commitment) {
  return { complete: true, activationHeight, indexedThroughBlock: height, checkpointHash: HASH,
    blockCount: height - activationHeight + 1, witnessSha256: PREV, [commitment]: TARGET };
}
function apiRuntime({ pages = [pageEvent()], childRecords = [childEvent()], unavailable = false,
  changed = false, activationHeight = 12 } = {}) {
  let childReads = 0;
  const context = vm.createContext({
    ...children, ...childPages,
    DNS_SUBDOMAIN_ACTIVATION_HEIGHT: 11, DNS_SUBDOMAIN_PAGE_LINK_ACTIVATION_HEIGHT: activationHeight,
    discoverDnsSubdomains: async () => ({ events: childRecords, coverage: {
      ...coverage(11, "childSha256"), model: "dns-subdomain-core-raw-block-coverage-v1" } }),
    discoverDnsSubdomainPageLinks: async () => { childReads += 1; if (unavailable) throw new Error("catch-up incomplete");
      return { events: pages, coverage: coverage(activationHeight, "pageLinkSha256") }; },
    bitcoinRpc: async () => ({ height, blockHash: changed ? PREV : HASH }),
    exactCoreTipFromBlockchainInfo: value => value, errorSummary: error => error.message,
    isValidBitcoinAddress: validAddress,
  });
  vm.runInContext(helpers, context);
  return { context, childReads: () => childReads };
}
async function publicRegistry(options = {}, roots = [rootEvent()]) {
  const runtime = apiRuntime(options), state = { _powAuditEvents: roots };
  const base = { network: "livenet", records: [{ id: "alice", network: "livenet", confirmed: true,
    ownerAddress: OWNER, receiveAddress: OWNER }], indexedThroughBlock: height, checkpointHash: HASH,
    coverage: { complete: true }, registryAddress: OTHER };
  const checkpoint = { height, blockHash: HASH };
  const withChildren = await runtime.context.dnsPayloadWithSubdomains(base, state, checkpoint, "livenet");
  const registry = await runtime.context.dnsPayloadWithSubdomainPageLinks(withChildren, state, checkpoint, "livenet");
  return { registry: plain(registry), runtime, state, checkpoint };
}
const lookupBranch = apiSource.slice(apiSource.indexOf("      const childRecords = (registry.subdomains ?? [])"),
  apiSource.indexOf("      const records = (Array.isArray(registry.records)", apiSource.indexOf("      const childRecords = (registry.subdomains ?? [])")));
async function childLookup(registry) {
  let result;
  const context = vm.createContext({ registry, id: "alice", childName: { parent: "alice", label: "app", name: "app.alice.pow" },
    network: "livenet", response: {}, freshRead: true, DNS_REGISTRY_ID: "domains@proofofwork.me",
    FRESH_READ_CACHE_CONTROL: "fresh", EXPENSIVE_READ_CACHE_CONTROL: "cached",
    freshDataUnavailableError: reason => new Error(reason), jsonResponse: (response, status, value) => { assert.equal(status, 200); result = value; },
  });
  await vm.runInContext(`(async () => { ${lookupBranch} })()`, context);
  return plain(result);
}

test("actual API adapter enriches active child CREATE identity and returns independently verifiable child lookup", async () => {
  const { registry } = await publicRegistry({ childRecords: [childEvent(), childEvent("update", 6, 15)] });
  assert.equal(registry.subdomainPageLinkAdmission.ready, true);
  assert.equal(registry.subdomainPageLinkAdmission.protocolPrefix, childPages.DNS_SUBDOMAIN_PAGE_LINK_PREFIX);
  assert.equal(registry.subdomainPageLinkAdmission.authorityModel, childPages.DNS_SUBDOMAIN_PAGE_LINK_AUTHORITY_MODEL);
  assert.equal(registry.subdomainPageLinkAdmission.activationPreviousBlockHash, childPages.DNS_SUBDOMAIN_PAGE_LINK_PREDECESSOR_HASH);
  assert.equal(registry.subdomainPageLinkCoverage.model, "dns-subdomain-page-link-core-raw-block-coverage-v1");
  assert.equal(registry.subdomainPageLinkCoverage.subdomainPageLinkSha256, TARGET);
  assert.deepEqual(registry.subdomains[0].childLifecycle, child);
  assert.equal(registry.subdomains[0].createdAtBlock, 11);
  assert.equal(registry.subdomains[0].updatedTxid, txid(6));
  assert.equal(registry.subdomainPageLinks[0].name, "app.alice.pow");
  const lookup = await childLookup(registry);
  assert.deepEqual(lookup.pageLink, lookup.subdomainPageLink);
  const snapshot = readDnsSubdomainPageLinkSnapshot(lookup, "app.alice.pow", { network: "livenet", validateAddress: validAddress });
  assert.equal(snapshot.pageLink.pageTxid, TARGET);
  assert.deepEqual(snapshot.child.childLifecycle, child);
  assert.equal(snapshot.root.ownershipEpochBlockHeight, 10);
});

test("API child authority refuses unsigned or output-mutable owner evidence while keeping root and child history", async () => {
  for (const mutate of [
    event => { delete event.transactionEvidence; event.authorityVerified = true; },
    event => { event.transactionEvidence.rawTransactionHex = "00"; },
    event => { event.transactionEvidence.prevouts[0].txid = "99".repeat(32); },
    event => { event.txid = "88".repeat(32); },
    event => { event.outputs[0].valueSats = "547"; },
  ]) {
    const event = pageEvent(); mutate(event);
    const { registry } = await publicRegistry({ pages: [event] });
    assert.equal(registry.subdomainPageLinkAdmission.ready, true, "complete discovery is distinct from event authority");
    assert.equal(registry.subdomainPageLinks.length, 0);
    assert.equal(registry.subdomainPageLinkEvents[0].valid, false);
    assert.equal(registry.records[0].ownerAddress, OWNER);
    assert.equal(registry.subdomains[0].name, "app.alice.pow");
  }
  for (const hashType of [2, 3, 0x82, 0x83]) {
    const { registry } = await publicRegistry({ pages: [pageEvent("set", 3, 12, child, [hashType])] });
    assert.equal(registry.subdomainPageLinks.length, 0);
    assert.equal(registry.subdomainPageLinkEvents[0].reason, "owner-output-commitment-unavailable");
  }
  const safeAnyoneCanPay = await publicRegistry({ pages: [pageEvent("set", 3, 12, child, [0x81])] });
  assert.equal(safeAnyoneCanPay.registry.subdomainPageLinks[0].pageTxid, TARGET);
});

test("actual API retains clear/revoke/root-transfer history and never promotes stale pending lifecycle", async () => {
  const cleared = await publicRegistry({ pages: [pageEvent(), pageEvent("clear", 4, 13), pageEvent("set", 5, null)] });
  assert.equal(cleared.registry.subdomainPageLinks.length, 0);
  assert.equal(cleared.registry.subdomainPageLinkHistoricalRecords[0].status, "cleared");
  assert.equal(cleared.registry.subdomainPageLinkPendingEvents[0].confirmed, false);
  const revoked = await publicRegistry({ childRecords: [childEvent(), childEvent("revoke", 4, 13), childEvent("create", 5, 14)],
    pages: [pageEvent(), pageEvent("set", 6, null)] });
  assert.equal(revoked.registry.subdomainPageLinkHistoricalRecords[0].invalidationReason, "subdomain-revoked");
  assert.equal(revoked.registry.subdomainPageLinkPendingEvents[0].reasonCode, "stale-subdomain-lifecycle");
  assert.equal(revoked.registry.subdomainPageLinks.length, 0);
  const transferred = await publicRegistry({ pages: [pageEvent(), pageEvent("set", 6, null)] }, [rootEvent(), rootEvent("transfer", 4, 13)]);
  assert.equal(transferred.registry.subdomainPageLinkHistoricalRecords[0].invalidationReason, "root-ownership-change");
  assert.equal(transferred.registry.subdomainPageLinkPendingEvents[0].reasonCode, "stale-ownership-epoch");
});

test("API child-link activation, upstream coverage and closing Core fence fail closed", async () => {
  for (const options of [{ activationHeight: 0 }, { activationHeight: 21 }, { unavailable: true }]) {
    const { registry } = await publicRegistry(options);
    assert.equal(registry.subdomainPageLinkCoverage.complete, false);
    assert.equal(registry.subdomainPageLinkAdmission.ready, false);
    assert.equal(registry.subdomains[0].subdomainPageLink, null);
    assert.equal(registry.subdomainPageLinks.length, 0);
  }
  const { registry, runtime, state, checkpoint } = await publicRegistry();
  registry.subdomainCoverage.complete = false;
  const reads = runtime.childReads();
  const denied = await runtime.context.dnsPayloadWithSubdomainPageLinks(registry, state, checkpoint, "livenet");
  assert.equal(denied.subdomainPageLinkAdmission.ready, false);
  assert.equal(runtime.childReads(), reads, "incomplete upstream child authority cannot call child-link discovery");
  await assert.rejects(publicRegistry({ changed: true }), /checkpoint changed/iu);
});

test("Log qualifies child name/lifecycle separately while preserving stored admission and fee-once economics", async () => {
  assert.equal(typeof adapter.dnsSubdomainPageLinkLogPayloadHasLinks, "function");
  const { registry: dns } = await publicRegistry();
  const action = pageEvent(), stored = { txid: action.txid, blockHeight: action.blockHeight, blockIndex: action.txIndex,
    protocolVout: 1, recordOrdinal: 0, confirmed: true, valid: false, kind: "protocol-event-invalid",
    payload: action.payload, amountSats: 0, minerFeeSats: 0, frozenNetworkValueSats: 0,
    reasonCode: "work-amo-v5-raw-pwdns-invalid", stateDelta: { economicOutputs: [] } };
  const payload = { indexedThroughBlock: height, checkpointHash: HASH, totalCount: 7, offset: 4, hasMore: true,
    items: [stored], activity: [stored], events: [stored] };
  const qualified = adapter.qualifyDnsSubdomainPageLinkLogPayload(payload, dns);
  for (const collection of ["items", "activity", "events"]) {
    const row = qualified[collection][0];
    assert.equal(row.name, "app.alice.pow"); assert.deepEqual(row.child, child); assert.deepEqual(row.epoch, epoch);
    assert.equal(row.dnsPageLinkAuthority, "complete-root-child-lifecycle-core-replay");
    assert.equal(row.protocolValid, true); assert.equal(row.protocolStatus, "accepted");
    assert.equal(row.dnsPageLinkStatus, "active"); assert.equal(row.pageTxid, TARGET);
    for (const key of ["valid", "kind", "reasonCode", "amountSats", "minerFeeSats", "frozenNetworkValueSats"]) assert.equal(row[key], stored[key]);
    assert.deepEqual(row.stateDelta, stored.stateDelta);
  }
  assert.equal(qualified.totalCount, 7); assert.equal(qualified.offset, 4); assert.equal(qualified.hasMore, true);
  assert.equal(stored.protocolValid, undefined, "qualification never mutates stored projection authority");
  assert.equal(adapter.qualifyDnsSubdomainPageLinkLogPayload({ items: [{ payload: "pwm1:m:ordinary" }] }, null).items.length, 1);
});

test("Log needs exact child carrier checkpoint, position, raw bytes and unique replay membership", async () => {
  const { registry } = await publicRegistry();
  const event = registry.subdomainPageLinkEvents[0];
  const payload = { indexedThroughBlock: height, checkpointHash: HASH, items: [{
    txid: event.txid, blockHeight: event.blockHeight, blockIndex: event.txIndex, protocolVout: 1,
    recordOrdinal: 0, confirmed: true, payload: event.payload }] };
  for (const mutate of [
    (value, dns) => { dns.checkpointHash = PREV; },
    (value, dns) => { dns.subdomainPageLinkCoverage.complete = false; },
    (value, dns) => { dns.subdomainPageLinkAdmission.ready = false; },
    (value, dns) => { delete dns.subdomainPageLinkAdmission.authorityModel; },
    (value, dns) => { dns.subdomainPageLinkAdmission.authorityModel = "input-address-only-v1"; },
    (value, dns) => { dns.subdomainPageLinkCoverage.indexedThroughBlock = 19; },
    (value, dns) => { dns.subdomainPageLinkEvents = []; },
    (value, dns) => { dns.subdomainPageLinkEvents.push(dns.subdomainPageLinkEvents[0]); },
    value => { value.items[0].blockIndex = 9; }, value => { value.items[0].protocolVout = 2; },
    value => { value.items[0].payload += "changed"; },
  ]) {
    const value = structuredClone(payload), dns = structuredClone(registry); mutate(value, dns);
    assert.throws(() => adapter.qualifyDnsSubdomainPageLinkLogPayload(value, dns), /Log/iu);
  }
  const malformed = structuredClone(registry), rawPayloadHex = Buffer.concat([Buffer.from(childPages.DNS_SUBDOMAIN_PAGE_LINK_PREFIX), Buffer.from([0xff])]).toString("hex");
  Object.assign(malformed.subdomainPageLinkEvents[0], { payload: childPages.DNS_SUBDOMAIN_PAGE_LINK_PREFIX,
    rawPayloadHex, decodeValid: false, record: null, state: undefined, valid: false, reason: "invalid-payload" });
  const invalid = structuredClone(payload); invalid.items[0].payload = { rawRecordParts: [{ payloadHex: rawPayloadHex }] };
  assert.equal(adapter.dnsSubdomainPageLinkLogPayloadHasLinks(invalid), true);
  assert.equal(adapter.qualifyDnsSubdomainPageLinkLogPayload(invalid, malformed).items[0].dnsPageLinkReasonCode, "invalid-payload");
  invalid.items[0].payload.rawRecordParts[0].payloadHex += "00";
  assert.throws(() => adapter.qualifyDnsSubdomainPageLinkLogPayload(invalid, malformed), /bytes/iu);
});

// Reuse the root lane's serialized transaction/block fixtures so parity is
// measured against the same actual sequencer and fee-once opening state.
const rawFixtureSource = await readFile(new URL("../scripts/check-dns-page-links-raw.test.mjs", import.meta.url), "utf8");
const fixtures = rawFixtureSource.slice(rawFixtureSource.indexOf("const ACTOR ="), rawFixtureSource.indexOf('test("page1'));
const rawContext = vm.createContext({ assert, Buffer, createHash, bitcoin,
  ...raw, ...work, ...rootPages, canonicalRawProtocolRecordSetFromTransaction });
vm.runInContext(fixtures, rawContext);
const serialized = messages => rawContext.block([rawContext.transaction(messages)], childPages.DNS_SUBDOMAIN_PAGE_LINK_ACTIVATION_HEIGHT);

const childEnvelopeSource = apiSource.slice(apiSource.indexOf("function dnsSubdomainPageLinkEnvelope("),
  apiSource.indexOf("const discoverPermissions =", apiSource.indexOf("function dnsSubdomainPageLinkEnvelope(")));
const canonicalPrevoutSource = apiSource.slice(apiSource.indexOf("function transactionHasCompleteCanonicalPrevouts("),
  apiSource.indexOf("function transactionMinerFeeSats("));
function normalizedRawTransaction(tx, confirmed = true) {
  const value = structuredClone(tx), decoded = bitcoin.Transaction.fromHex(value.hex);
  value._powCanonicalRpcHydration = true;
  value.status = { confirmed };
  value.vout = value.vout.map(output => ({ ...output, value: Number(output.value),
    scriptpubkey_address: output.scriptpubkey_address ?? "" }));
  value.vin = value.vin.map((input, index) => ({ ...input,
    prevout: { ...input.prevout, value: Number(input.prevout.value) }, sequence: decoded.ins[index].sequence,
    scriptsig: Buffer.from(decoded.ins[index].script).toString("hex") }));
  return value;
}
function envelopeRuntime(context, overrides = {}) {
  const runtime = vm.createContext({ Buffer, bitcoin,
    DNS_SUBDOMAIN_PAGE_LINK_PREFIX: childPages.DNS_SUBDOMAIN_PAGE_LINK_PREFIX,
    dnsSubdomainPageLinkCandidates: adapter.dnsSubdomainPageLinkCandidates, canonicalRawProtocolRecordSetFromTransaction,
    transactionConfirmed: tx => tx.status?.confirmed === true, transactionTxid: tx => tx.txid,
    transactionBlockHeight: tx => tx.status?.block_height ?? context.blockHeight,
    transactionBlockHash: tx => tx.status?.block_hash, transactionBlockIndex: tx => tx._powBlockIndex ?? 1,
    createDnsPageLinkDiscovery: options => options, ...overrides });
  vm.runInContext(canonicalPrevoutSource + childEnvelopeSource +
    "\nglobalThis.childDiscoveryOptions = discoverDnsSubdomainPageLinks;", runtime);
  return runtime;
}

test("Core child envelopes bind raw spend diagnostics and preserve exact ordered prevout evidence", () => {
  const context = rawContext.block([rawContext.transaction([pageEvent().payload], { secondActor: OTHER })],
    childPages.DNS_SUBDOMAIN_PAGE_LINK_ACTIVATION_HEIGHT);
  const transaction = normalizedRawTransaction(context.blockTransactions[1]);
  const candidate = adapter.dnsSubdomainPageLinkCandidates(raw.workAmoV5RawBlockDiscoveryEnvelope(context).records)[0];
  const runtime = envelopeRuntime(context);
  const event = runtime.dnsSubdomainPageLinkEnvelope(candidate, transaction);
  assert.deepEqual(plain(event.transactionEvidence), { rawTransactionHex: transaction.hex,
    prevouts: transaction.vin.map(input => ({ txid: input.txid, vout: input.vout,
      scriptPubKeyHex: input.prevout.scriptpubkey, valueSats: String(input.prevout.value) })) });
  assert.equal(event.outputs[1].address, null, "Core empty OP_RETURN address is normalized to exact null");
  assert.equal(Object.hasOwn(event, "authorityVerified"), false);
  for (const mutate of [
    tx => { delete tx.hex; }, tx => { tx._powCanonicalRpcHydration = false; },
    tx => { tx.txid = "99".repeat(32); }, tx => { tx.vin[0].txid = "99".repeat(32); },
    tx => { tx.vin.reverse(); }, tx => { tx.vin[0].vout = 1; }, tx => { tx.vin[0].sequence -= 1; },
    tx => { tx.vin[0].scriptsig = "51"; }, tx => { tx.vout[0].value = "547"; },
    tx => { tx.vout[0].scriptpubkey = "51"; }, tx => { delete tx.vin[0].prevout; },
    tx => { tx.vin[0].prevout.value = "0546"; }, tx => { tx.vin[0].prevout.value = 1.5; },
    tx => { tx.vin[0].prevout.scriptpubkey = "abc"; }, tx => { tx.vin[0].is_coinbase = true; },
  ]) {
    const changed = structuredClone(transaction); mutate(changed);
    assert.throws(() => runtime.dnsSubdomainPageLinkEnvelope(candidate, changed), /Core/iu);
  }
});

test("an actual signed Core-shaped child envelope authorizes the API lookup without diagnostic shortcuts", async () => {
  const signed = pageEvent(), decoded = bitcoin.Transaction.fromHex(signed.transactionEvidence.rawTransactionHex);
  const transaction = { txid: signed.txid, hex: signed.transactionEvidence.rawTransactionHex,
    _powCanonicalRpcHydration: true, _powBlockIndex: 3, status: { confirmed: true, block_height: 12 },
    vin: decoded.ins.map((input, index) => ({ txid: signed.transactionEvidence.prevouts[index].txid,
      vout: input.index, sequence: input.sequence, scriptsig: Buffer.from(input.script).toString("hex"),
      prevout: { scriptpubkey: signed.transactionEvidence.prevouts[index].scriptPubKeyHex,
        scriptpubkey_address: OWNER, value: Number(signed.transactionEvidence.prevouts[index].valueSats) } })),
    vout: decoded.outs.map((output, index) => ({ scriptpubkey: Buffer.from(output.script).toString("hex"),
      scriptpubkey_address: signed.outputs[index].address ?? "", value: Number(output.value) })),
  };
  const candidate = adapter.dnsSubdomainPageLinkCandidates(canonicalRawProtocolRecordSetFromTransaction(transaction).records)[0];
  const runtime = envelopeRuntime({ blockHeight: 12 });
  const event = plain(runtime.dnsSubdomainPageLinkEnvelope(candidate, transaction));
  assert.equal(event.outputs[1].address, null);
  assert.deepEqual(event.transactionEvidence.prevouts, signed.transactionEvidence.prevouts);
  const { registry } = await publicRegistry({ pages: [event] });
  assert.equal(registry.subdomainPageLinkEvents[0].valid, true);
  const lookup = await childLookup(registry);
  assert.equal(readDnsSubdomainPageLinkSnapshot(lookup, "app.alice.pow", { network: "livenet", validateAddress: validAddress }).pageLink.pageTxid, TARGET);
});

test("confirmed child Core witness retains signature evidence only at the exact indexed block position", async () => {
  const context = serialized([pageEvent().payload]);
  const transaction = normalizedRawTransaction(context.blockTransactions[1]);
  transaction.status = { confirmed: true, block_height: context.blockHeight, block_hash: context.blockHash };
  const row = { height: context.blockHeight, block_hash: context.blockHash, previous_block_hash: context.previousBlockHash };
  let hydrated = transaction;
  const runtime = envelopeRuntime(context, {
    workAmoV5RawBlockDiscoveryEnvelope: raw.workAmoV5RawBlockDiscoveryEnvelope,
    dnsPageLinkCoreBlockWitness,
    canonicalVerifierCurrentBlock: async (...args) => {
      assert.deepEqual(plain(args), ["livenet", context.blockHeight, context.previousBlockHash, context.blockHash]);
      return { ...context, transactions: [hydrated] };
    },
  });
  const witness = await runtime.childDiscoveryOptions.readCoreBlock(row);
  assert.equal(witness.pageLinkEvents.length, 1);
  assert.equal(witness.pageLinkEvents[0].transactionEvidence.rawTransactionHex, transaction.hex);
  assert.equal(witness.pageLinkEvents[0].txIndex, 1);
  for (const mutate of [
    tx => { tx._powCanonicalRpcHydration = false; }, tx => { tx.status.block_hash = "99".repeat(32); },
    tx => { tx.status.block_height -= 1; }, tx => { tx._powBlockIndex = 2; },
    tx => { delete tx.vin[0].prevout; }, tx => { tx.hex = "00"; },
  ]) {
    hydrated = structuredClone(transaction); mutate(hydrated);
    await assert.rejects(runtime.childDiscoveryOptions.readCoreBlock(row), /Core/iu);
  }
});

test("pending child discovery requests exact raw Core hydration and never invents confirmed evidence", async () => {
  const context = serialized([pageEvent().payload]);
  const pending = normalizedRawTransaction(context.blockTransactions[1], false), calls = [];
  const runtime = envelopeRuntime(context, {
    fetchTransactionFromBitcoinRpc: async (...args) => { calls.push(args); return pending; },
    bitcoinRpc: async (method, params) => { assert.equal(method, "getmempoolentry"); assert.deepEqual(plain(params), [pending.txid]); return { ok: true }; },
  });
  const events = await runtime.childDiscoveryOptions.hydratePending(pending.txid, "livenet");
  assert.deepEqual(plain(calls[0]), [pending.txid, "livenet", { bypassCache: true, cacheResult: false,
    requireCanonicalPrevouts: true, includeRawHex: true }]);
  assert.equal(events.length, 1);
  assert.equal(events[0].blockHeight, null); assert.equal(events[0].txIndex, null);
  assert.equal(events[0].transactionEvidence.rawTransactionHex, pending.hex);
  pending.status.confirmed = true;
  assert.deepEqual(plain(await runtime.childDiscoveryOptions.hydratePending(pending.txid, "livenet")), []);
});

test("unknown subpage1 remains serialized raw discovery evidence without creating WORK authority", async () => {
  const invalidUtf8 = Buffer.concat([Buffer.from(childPages.DNS_SUBDOMAIN_PAGE_LINK_PREFIX), Buffer.from([0xff])]);
  const context = serialized([pageEvent().payload, childPages.DNS_SUBDOMAIN_PAGE_LINK_PREFIX + "malformed", invalidUtf8]);
  const envelope = raw.workAmoV5RawBlockDiscoveryEnvelope(context);
  const candidates = adapter.dnsSubdomainPageLinkCandidates(envelope.records);
  assert.equal(candidates.length, 3); assert.equal(candidates[2].rawRecordParts[0].decodeValid, false);
  assert.equal(work.parseWorkAmoV5RawPwdnsRecord(pageEvent().payload), null);
  const records = rawContext.rawRecords(context), commit = work.workAmoV5CanonicalPayloadCommitment;
  const row = { height: context.blockHeight, block_hash: context.blockHash,
    protocol_record_count: records.length, raw_protocol_candidate_count: envelope.rawProtocolCandidateCount,
    payload: { replayRecords: records.map(record => ({ ...record, rawCandidate: true, rawWitness: record.payload })),
      blockDescriptorCommitment: envelope.blockDescriptorCommitment, rawProtocolCandidateCount: envelope.rawProtocolCandidateCount } };
  row.payload.replayDescriptorCommitment = commit(row.payload.replayRecords);
  const envelopeContext = envelopeRuntime(context);
  const transaction = normalizedRawTransaction(context.blockTransactions[1]);
  const events = candidates.map(record => envelopeContext.dnsSubdomainPageLinkEnvelope(record, transaction));
  assert.equal(events[0].subdomainPageLinkCarrierCount, 3);
  assert.equal(events[2].decodeValid, false); assert.equal(events[2].payload, childPages.DNS_SUBDOMAIN_PAGE_LINK_PREFIX);
  const core = dnsPageLinkCoreBlockWitness(envelope, events);
  assert.deepEqual(assertDnsPageLinkRawBlockCoverage(row, core), events);
  const witnessSha256 = createHash("sha256").update(JSON.stringify([createHash("sha256")
    .update(JSON.stringify(["dns-page-link-block-witness-chain-v1", "livenet", context.blockHeight])).digest("hex"),
    context.blockHeight, context.blockHash, row.payload.blockDescriptorCommitment, row.payload.replayDescriptorCommitment])).digest("hex");
  const discovery = createDnsPageLinkDiscovery({ readIndex: async (network, options) => {
    await options.onBlock(row); return { complete: true, activationHeight: context.blockHeight,
      indexedThroughBlock: context.blockHeight, checkpointHash: context.blockHash, blockCount: 1, witnessSha256, pendingTxids: [] };
  }, readCoreBlock: async () => core, hydratePending: async () => [] });
  assert.equal((await discovery("livenet", { height: context.blockHeight, blockHash: context.blockHash }, context.blockHeight)).events.length, 3);
  row.payload.replayRecords.pop(); row.payload.replayDescriptorCommitment = commit(row.payload.replayRecords); row.protocol_record_count -= 1;
  assert.throws(() => assertDnsPageLinkRawBlockCoverage(row, core), /incomplete/iu);
  assert.throws(() => rawContext.replay(context, { records: records.slice(0, 2) }), /record-set|parity/iu);
});

test("subpage1 preserves single ordinary Mail economic contribution and one miner fee", () => {
  const independent = rawContext.replay(serialized([pageEvent().payload]));
  const opening = rawContext.openingState(childPages.DNS_SUBDOMAIN_PAGE_LINK_ACTIVATION_HEIGHT);
  assert.equal(independent.events.length, 1); assert.equal(independent.events[0].valid, false);
  assert.deepEqual(plain(independent.economicState.baseState), plain(opening.openingEconomicState.baseState));
  assert.equal(independent.economicState.networkValueQ8, opening.openingEconomicState.networkValueQ8);
  const combined = rawContext.replay(serialized([pageEvent().payload, "pwm1:m:Child Pages link"]));
  const mail = rawContext.replay(serialized(["pwm1:m:Child Pages link"]));
  const combinedEconomics = plain(combined.economicState), mailEconomics = plain(mail.economicState);
  // Different carrier bytes yield different blocks; their economic state is
  // equal after excluding only that independently verified block identity.
  delete combinedEconomics.throughBlockHash; delete mailEconomics.throughBlockHash;
  assert.deepEqual(combinedEconomics, mailEconomics);
  assert.equal(combined.economicState.baseState.mailFlowSats, "546");
  assert.equal(combined.economicState.creditFixedQ8, "1100000000");
  assert.equal(combined.feeTransitions.length, 1);
  for (const name of ["workState", "idState", "genericState"]) assert.deepEqual(plain(combined[name]), plain(mail[name]));
});
