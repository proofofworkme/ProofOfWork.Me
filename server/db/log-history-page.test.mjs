import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { payments, script } from "bitcoinjs-lib";
import { rowsWithCanonicalTransferFees } from "./proof-index-reader.mjs";
import { buildWorkBatchPayload, parseWorkBatchPayload, WORK_BATCH_TOKEN_ID } from "../../src/shared/protocol/workBatch.mjs";

const source = readFileSync(new URL("./proof-index-reader.mjs", import.meta.url), "utf8");
const begin = source.indexOf("async function canonicalLogHistoryPageFromRelationalIds(");
const end = source.indexOf("\nexport async function proofIndexLogHistoryPayload(", begin);
assert.ok(begin >= 0 && end > begin);
const implementation = source.slice(begin, end);
const TIME = "2026-10-31T12:00:00.000Z";
const GENESIS = Date.parse("2009-01-03T18:15:05.000Z");
const plain = value => JSON.parse(JSON.stringify(value));

function harness({ total = 27_145, ids, offset = 0, limit = 20, fallback = [], mutate, qualify, indexedAt = TIME } = {}) {
  const selected = ids ?? Array.from({ length: Math.min(limit, Math.max(0, total - offset)) }, (_, i) => total - offset - i);
  const calls = { queries: [], canonical: [] };
  const pool = { async query(sql, params) {
    calls.queries.push({ sql, params });
    if (sql.includes("canonical_log_history_ordering_metadata")) return { rows: fallback };
    assert.match(sql, /canonical_log_history_page_ids/u);
    assert.doesNotMatch(sql, /SELECT\s+e\.payload\s*[,\n]/u);
    assert.match(sql, /event_tx\.updated_at <= \$\d+::timestamptz/u);
    assert.match(sql, /date_trunc\('milliseconds', display_time\) DESC, txid DESC/u);
    return { rows: [{ total_count: String(total), latest_event_block: 974041,
      fallback_time_count: String(fallback.length), event_ids: selected.map(String) }] };
  } };
  const context = vm.createContext({
    rowNumber: (row, key) => Number(row?.[key]) || 0,
    dateIso: value => new Date(value).toISOString(),
    plausibleBitcoinEventTime: (...values) => values.find(value => value != null && value !== "" && Date.parse(value) >= GENESIS),
    compareHistoryItems: (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || String(b.txid).localeCompare(String(a.txid)),
    historyCursor: (snapshot, start) => `${snapshot}:${start}`,
    proofIndexCanonicalActivityPayload: async (network, options) => {
      calls.canonical.push({ network, options: plain(options) });
      await qualify?.(Array.from(options.eventIds));
      const activity = Array.from(options.eventIds, eventId => ({ eventId, confirmed: true, createdAt: TIME }));
      const result = { activity, snapshotId: "snapshot", indexedThroughBlock: 974041,
        membershipRestricted: true, membershipEventIds: Array.from(options.eventIds),
        canonicalMinerFeeCoverage: { complete: true, source: "proof-indexer-normalized-input-output-totals",
          confirmedEvents: activity.length, coveredConfirmedEvents: activity.length,
          missingConfirmedEvents: 0, missingConfirmedTransactions: 0, missingConfirmedTxids: [] } };
      mutate?.(result);
      return result;
    },
  });
  vm.runInContext(implementation, context);
  return { calls, run: () => context.canonicalLogHistoryPageFromRelationalIds(pool, "livenet",
    { offset, limit, query: "", snapshotId: "snapshot" },
    { snapshot_id: "snapshot", indexed_through_block: 974041, generated_at: TIME, log_summary_indexed_at: indexedAt },
    { conditions: ["e.network = $1", "e.valid = true", "e.updated_at <= $2::timestamptz", "e.block_height <= $3"],
      params: ["livenet", TIME, 974041], includePending: false }) };
}

test("a 27k-event Log hydrates only the requested page and retains full snapshot totals", async () => {
  for (const offset of [0, 20, 27140, 27160]) {
    const h = harness({ offset }); const page = await h.run();
    assert.equal(page.totalCount, 27145); assert.equal(page.snapshotTotalCount, 27145);
    assert.equal(page.start, Math.min(offset, 27145));
    assert.equal(page.items.length, Math.min(20, Math.max(0, 27145 - offset)));
    assert.equal(page.pageCount, 1358);
    assert.equal(h.calls.canonical.length, offset >= 27145 ? 0 : 1);
    if (h.calls.canonical.length) {
      assert.ok(h.calls.canonical[0].options.eventIds.length <= 20);
      assert.equal(h.calls.canonical[0].options.snapshotId, "snapshot");
      assert.equal(h.calls.canonical[0].options.includePending, false);
    }
  }
});

test("invalid historical summary timestamps retain the caller's generated-at fence", async () => {
  const h = harness({ indexedAt: "invalid" });
  const page = await h.run();
  assert.equal(page.indexedAt, TIME);
  assert.equal(h.calls.queries[0].params.at(-3), TIME);
});

for (const [name, mutate] of Object.entries({
  "missing row": page => page.activity.pop(),
  "collapsed child": page => { page.activity[1] = page.activity[0]; },
  "changed order": page => page.activity.reverse(),
  "wrong snapshot": page => { page.snapshotId = "other"; },
  "wrong height": page => { page.indexedThroughBlock--; },
  "unbound membership": page => { page.membershipRestricted = false; },
  "missing fee": page => { page.canonicalMinerFeeCoverage.complete = false; },
  "lost transaction fee": page => { page.canonicalMinerFeeCoverage.missingConfirmedTransactions = 1; },
  "unexpected pending row": page => { page.activity[0].confirmed = false; },
})) test(`pinned page refuses ${name}`, async () => {
  await assert.rejects(harness({ mutate }).run(), /verified snapshot membership/u);
});

test("invalid or duplicate selected identities fail before payload hydration", async () => {
  for (const ids of [[1, 1], [0, 2], [1], [1, "invalid"]]) {
    const h = harness({ total: 2, ids });
    await assert.rejects(h.run(), /membership is incomplete/u);
    assert.equal(h.calls.canonical.length, 0);
  }
});

test("historical timestamp fallbacks retain their exact order without loading ledger payloads", async () => {
  const fallback = [
    { event_id: 3, txid: "c", event_time: "1970-01-01T00:00:00Z", payload_timestamp: TIME, created_at: TIME },
    { event_id: 2, txid: "b", event_time: "1970-01-01T00:00:00Z", payload_block_time: "2026-11-01T00:00:00Z", created_at: TIME },
    { event_id: 1, txid: "a", event_time: TIME, created_at: TIME },
  ];
  const h = harness({ total: 3, fallback, limit: 2 }); const page = await h.run();
  assert.deepEqual(plain(page.items.map(item => item.eventId)), [2, 3]);
  assert.equal(h.calls.queries.length, 2);
  assert.match(h.calls.queries[1].sql, /e\.payload->'blockTime'/u);
  assert.doesNotMatch(h.calls.queries[1].sql, /SELECT\s+e\.payload\s*[,\n]/u);
});

function batchFixture(count = 256) {
  const address = i => {
    const hash = Buffer.alloc(20); hash.writeUInt32BE(i + 1, 0);
    return payments.p2pkh({ hash }).address;
  };
  const senderAddress = address(count + 1), txid = "a".repeat(64);
  const wire = buildWorkBatchPayload(Array.from({ length: count }, (_, i) => [address(i), String(i + 1)]));
  const batch = parseWorkBatchPayload(wire);
  const parentPosition = { blockHeight: 974041, blockHash: "b".repeat(64), blockTransactionIndex: 3, protocolVout: 1, recordOrdinal: 0 };
  const commitment = { model: "canonical-work-amo-raw-transition-chain-sha256-v1", payloadBytes: 100, sha256: "c".repeat(64) };
  const batchPayloadCommitment = { model: "canonical-work-amo-payload-sha256-v1", payloadBytes: wire.length, sha256: "d".repeat(64) };
  const derived = batch.recipients.map((recipient, index) => ({ ...recipient, senderAddress,
    tokenId: WORK_BATCH_TOKEN_ID, amountStorageModel: "work-subatoms-v2", amountVersion: "batch1", transferVersion: "batch1",
    batchRecipientIndex: index, batchRecipientCount: count, batchTotalAmountSubatoms: batch.totalAmountSubatoms,
    batchPayloadCommitment, kind: "token-transfer", paidSats: 0, registryMutationFeeSats: 0,
    chargesTransactionFee: false, claimsEconomicOutputs: false, economicDelta: false, rawCandidate: false,
    containerPosition: parentPosition, projectionPosition: { ...parentPosition, recordOrdinal: index + 1 },
    parentTransitionChainCommitmentAfter: commitment, derivedId: `${txid}:${index + 1}`, derivedIndex: index }));
  const output = { amountSubatoms: batch.totalAmountSubatoms, totalAmountSubatoms: batch.totalAmountSubatoms,
    recipientCount: count, recipients: batch.recipients, batchPayloadCommitment, projection: { kind: "token-transfer-batch" } };
  const parent = { kind: "token-transfer-batch", protocol: "pwt1", valid: true, confirmed: true,
    _workAmoV5ReplayBound: true, workAmoV5RawCandidate: true, payload: wire, senderAddress, txid,
    workAmoV5ReplayOutput: output, indexedFrom: "token-transfer-batches" };
  const children = derived.map(descriptor => ({ ...descriptor, position: descriptor.projectionPosition,
    derived: true, txid, protocol: "pwt1", valid: true, confirmed: true, _workAmoV5ReplayBound: true,
    workAmoV5RawCandidate: false, workAmoV5ReplayOutcome: { kind: "pwt1-valid", valid: true },
    workAmoV5ReplayRawWitness: { model: "canonical-work-amo-v5-derived-child-v1", descriptor,
      parentPosition, parentProtocol: "pwt1" }, indexedFrom: "token-transfers" }));
  const evidence = { parent_event_id: "1", parent_payload: parent,
    parent_records: [{ derived, rawCandidate: true, outcome: { kind: "pwt1-valid", semanticKind: "token-transfer-batch", valid: true },
      output, position: parentPosition, txid, transitionChainCommitmentAfter: commitment }],
    carrier_output: { value: 0, scriptpubkey: Buffer.from(script.compile([106, Buffer.from(wire)])).toString("hex") },
    siblings: children.map((payload, i) => ({ event_id: String(i + 2), payload, position: payload.position })) };
  const rows = [parent, ...children].map((payload, i) => ({ event_id: i + 1, status: "confirmed", payload }));
  return { rows, evidence };
}

test("pages crossing a 256-recipient carrier still qualify every sibling and the parent", async () => {
  for (const offset of [0, 20, 240, 256]) {
    const f = batchFixture(); let expanded = 0;
    const h = harness({ total: 257, offset, qualify: async ids => {
      await rowsWithCanonicalTransferFees({ query: async (sql, args) => {
        assert.match(sql, /canonical_work_batch_parent_evidence/u);
        assert.deepEqual(args[1], ids); expanded += f.evidence.siblings.length;
        return { rows: [f.evidence] };
      } }, ids.map(id => f.rows[id - 1]), "livenet");
    } });
    const page = await h.run(); assert.equal(expanded, 256);
    assert.equal(page.items.length, Math.min(20, 257 - offset));
  }
});

test("a missing or changed off-page sibling still refuses a one-recipient page", async () => {
  for (const change of [f => f.evidence.siblings.pop(), f => { f.evidence.siblings[0].payload.amountSubatoms = "999"; }]) {
    const f = batchFixture(); change(f);
    const h = harness({ total: 257, limit: 1, qualify: ids => rowsWithCanonicalTransferFees(
      { query: async () => ({ rows: [f.evidence] }) }, ids.map(id => f.rows[id - 1]), "livenet") });
    await assert.rejects(h.run(), /incomplete|accepted parent descriptor/u);
  }
});

test("public unfiltered history selects bounded identities while the canonical ledger reader stays complete", () => {
  const history = source.slice(end, source.indexOf("\nexport async function proofIndexTokenMarketSummaryOverlayPayload", end));
  assert.match(history, /return canonicalLogHistoryPageFromRelationalIds\(pool, network, pagination, snapshot/u);
  assert.doesNotMatch(history, /const canonicalPage = await proofIndexCanonicalActivityPayload\(network, \{\s*includePending,/u);
});
