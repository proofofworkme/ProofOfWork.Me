import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import { pendingDecisionFixture } from "../tests/fixtures/workMailBatch.mjs";
import { canonicalRawProtocolRecordSetFromTransaction } from "../server/canonical-op-return.mjs";
import { validateWorkMailBatchV1PendingDecision } from "../server/work-mail-batch-transaction.mjs";
import { validateWorkBatchV1PendingDecision } from "../server/work-batch-transaction.mjs";
import { assertNoSealedWorkMailBatchAuthority } from "../server/db/work-mail-batch-discovery.mjs";
import { workAmoV5CanonicalPayloadCommitment } from "../server/work-amo-v5.mjs";
import {
  WORK_MAIL_BATCH_ACTIVATION_META_KEY, WORK_MAIL_BATCH_DECLARATION_COMMITMENT_MODEL,
  normalizeWorkMailBatchDeclarationPins, validateWorkMailBatchActivationMarker,
  workMailBatchActivationMarkerFromTransition,
} from "../server/work-mail-batch-declaration.mjs";

const source = readFileSync(new URL("./backfill-proof-indexer.mjs", import.meta.url), "utf8");
function extract(name, next, globals = {}) {
  const start = source.indexOf(`function ${name}(`);
  const end = source.indexOf(`\n${next}`, start);
  assert.ok(start >= 0 && end > start);
  const prefix = source.slice(start - 6, start) === "async " ? "async " : "";
  return new vm.Script(`${prefix}${source.slice(start, end)}\n${name}`).runInContext(vm.createContext(globals));
}

test("pending writer validates every Mail batch child and independently resolves ordinary PWM", async () => {
  const fixture = pendingDecisionFixture(), tx = fixture.transaction;
  const records = canonicalRawProtocolRecordSetFromTransaction(tx).records;
  const mail = fixture.items[0], items = fixture.items.slice(1);
  let companions = [{ item: mail, sourceLabel: "mail" }];
  const globals = {
    normalizedLowerText: value => String(value ?? "").trim().toLowerCase(),
    boundedMapWithConcurrency: (values, _concurrency, callback) => Promise.all(values.map(callback)),
    freshRawTransactionFromCore: async txid => txid === tx.txid ? tx : null,
    transactionHasConfirmedBlockEvidence: () => false,
    transactionWithInputPrevouts: async value => value,
    canonicalRawProtocolRecordSetFromTransaction, validateWorkMailBatchV1PendingDecision,
    validateWorkBatchV1PendingDecision: () => { throw new Error("Mail reached the standalone validator"); },
    protocolMessagesFromTx: () => records.map(record => ({ prefix: `${record.protocol}:`, text: record.message })),
    preparedProtocolItemsForTx: async () => companions,
    PENDING_ONLY_BACKFILL: false,
    pendingWorkMintAttemptCount: () => 0,
    sourceLabelForProtocolItem: item => item.kind === "token-transfer-batch" ? "token-transfer-batches" : "token-transfers",
    pendingWorkMintDecision: () => null,
    pendingTransactionWriteItem: () => null,
    pendingProtocolTransactionObservation: txid => ({ txid }),
  };
  globals.assertWorkQ16PendingStatefulCompanionIsolation = extract("assertWorkQ16PendingStatefulCompanionIsolation", "function pendingWorkMintOutcomeItems", globals);
  globals.assertWorkQ16PendingCompanionCoverage = extract("assertWorkQ16PendingCompanionCoverage", "async function preparedWorkQ16PendingStageDecisions", globals);
  const prepare = extract("preparedWorkQ16PendingStageDecisions", "async function clearWorkQ16PendingStageDecision", globals);
  const result = await prepare({ decisions: [{ txid: tx.txid, items }] });
  assert.equal(result[0].prepared.length, 3);
  assert.equal(result[0].prepared[0].sourceLabel, "token-transfer-batches");
  assert.equal(result[0].prepared[2].item.recordOrdinal, 2);
  assert.equal(result[0].companionPrepared[0].item, mail);
  for (const changed of [items.slice(0, -1), [items[0], items[1], items[1]],
    [items[0], { ...items[1], mailEnvelope: {} }, items[2]],
    [items[0], { ...items[1], containerPosition: { protocolVout: 0, recordOrdinal: 0 } }, items[2]]]) {
    await assert.rejects(() => prepare({ decisions: [{ txid: tx.txid, items: changed }] }), /complete signed carrier/u);
  }
  companions = [];
  await assert.rejects(() => prepare({ decisions: [{ txid: tx.txid, items }] }), /pwm1 evidence was not resolved/u);
  assert.equal(validateWorkMailBatchV1PendingDecision({ items: [{ protocol: "pwt1", kind: "token-transfer-batch", transferVersion: "batch1", valid: true }] }).applicable, false);
  assert.equal(typeof validateWorkBatchV1PendingDecision, "function");
});

test("balance replay qualifies both complete batch families without weakening the legacy validator", async () => {
  const old = { event_id: 1, kind: "token-transfer-batch", payload: { transferVersion: "batch1" } };
  const parent = { event_id: 2, kind: "token-transfer-batch", payload: { transferVersion: "mailbatch1" } };
  const child = { event_id: 3, kind: "token-transfer", payload: { amountVersion: "mailbatch1", batchRecipientIndex: 0 } };
  const malformed = { event_id: 4, kind: "token-transfer-batch", payload: { payload: "pwt1:mailbatch1:bad" } };
  let refuse = false;
  const qualify = extract("verifiedWorkBatchFamilyEventIds", "async function rebuildConfirmedCreditBalancesFromCanonicalEvents", {
    NETWORK: "livenet",
    verifiedWorkBatchEventIds: async (_client, rows, network) => {
      assert.equal(network, "livenet"); assert.deepEqual(Array.from(rows), [old]); return new Set([1]);
    },
    verifiedWorkMailBatchEventIds: async (_client, rows) => {
      assert.deepEqual(Array.from(rows), [parent, child, malformed]);
      if (refuse) throw new Error("Incomplete Mail parent");
      return new Set([2, 3]);
    },
  });
  assert.deepEqual(Array.from(await qualify({}, [old, parent, child, malformed])), [1, 2, 3]);
  refuse = true;
  await assert.rejects(() => qualify({}, [old, parent, child, malformed]), /Incomplete Mail parent/u);
});

test("new marker commits at exact D+1, remains immutable, and missing authority cannot downgrade history", async () => {
  const HEIGHT = 1_200_000, priorHash = "21".repeat(32);
  const context = { activationHeight: HEIGHT,
    declaration: { txid: "31".repeat(32), blockHash: priorHash, blockHeight: HEIGHT - 1,
      blockTransactionIndex: 1, protocolVout: 1, recordOrdinal: 0, registryPaymentVout: 0 },
    evidenceCommitment: { model: WORK_MAIL_BATCH_DECLARATION_COMMITMENT_MODEL, payloadBytes: 1, sha256: "32".repeat(32) } };
  const payload = { network: "livenet", complete: true, blockAtomic: true, feeOnce: true, invalidZero: true,
    blockHeight: HEIGHT, blockHash: "ab".repeat(32), previousBlockHash: priorHash, workMailBatchV1: context,
    transitionChainCommitment: { model: "canonical-work-amo-raw-transition-chain-sha256-v1", payloadBytes: 100, sha256: "cd".repeat(32) } };
  const persist = extract("persistWorkMailBatchActivationMarker", "async function persistWorkAmoV5BlockTransition", {
    NETWORK: "livenet", WORK_MAIL_BATCH_ACTIVATION_META_KEY, assertNoSealedWorkMailBatchAuthority,
    normalizeWorkMailBatchDeclarationPins, validateWorkMailBatchActivationMarker,
    workMailBatchActivationMarkerFromTransition, workAmoV5CanonicalPayloadCommitment,
  });
  const wrap = value => ({ blockHeight: value.blockHeight, blockHash: value.blockHash, previousBlockHash: value.previousBlockHash, payload: value });
  const client = (saved = null, prior = []) => ({ saved, inserts: 0, async query(sql, params) {
    if (sql.includes("work_mail_batch_missing_marker_sealed_head")) {
      assert.equal(params[0], "livenet"); assert.match(sql, /transition.block_height < \$2/u);
      return { rows: prior.filter(row => row.block_height < params[1]) };
    }
    assert.equal(params[0], WORK_MAIL_BATCH_ACTIVATION_META_KEY);
    if (sql.startsWith("INSERT")) { this.inserts++; this.saved ??= JSON.parse(params[1]); return { rows: [] }; }
    if (params.length === 2 && JSON.stringify(this.saved) !== params[1]) return { rows: [] };
    return { rows: this.saved ? [{ value: this.saved }] : [] };
  } });
  const db = client();
  assert.equal(await persist(db, wrap({ ...payload, workMailBatchV1: undefined })), null);
  const marker = await persist(db, wrap(payload));
  assert.equal(validateWorkMailBatchActivationMarker(marker).valid, true);
  await persist(db, wrap(payload)); assert.equal(db.inserts, 1);
  const later = { ...payload, blockHeight: HEIGHT + 1, previousBlockHash: payload.blockHash, blockHash: "ef".repeat(32) };
  await persist(db, wrap(later));
  await assert.rejects(() => persist(db, wrap({ ...later, workMailBatchV1: undefined })), /omitted active/u);
  await assert.rejects(() => persist(client(), wrap(later)), /missing after the exact D\+1/u);
  await assert.rejects(() => persist(client({ ...marker, activationHeight: HEIGHT + 1 }), wrap(later)), /malformed/u);
  await assert.rejects(() => persist(db, wrap({ ...later, workMailBatchV1: { ...context,
    evidenceCommitment: { ...context.evidenceCommitment, sha256: "99".repeat(32) } } })), /conflicts with immutable/u);
  await assert.rejects(() => persist(db, wrap({ ...payload, blockHash: "88".repeat(32) })), /conflicts with immutable/u);
  const seal = { block_height: HEIGHT, block_hash: payload.blockHash, canonical_block_hash: payload.blockHash,
    complete: true, block_atomic: true, fee_once: true, invalid_zero: true, has_batch_context: true };
  const withoutContext = wrap({ ...later, workMailBatchV1: undefined });
  await assert.rejects(() => persist(client(null, [seal]), withoutContext), /marker is missing/u);
  await assert.rejects(() => persist(client(null, [{ ...seal, canonical_block_hash: null }]), withoutContext), /orphaned/u);
  assert.equal(await persist(client(null, [{ ...seal, has_batch_context: false }]), withoutContext), null);
  const blockFunction = source.slice(source.indexOf("async function persistWorkAmoV5BlockTransition("));
  assert.ok(blockFunction.indexOf("await persistWorkMailBatchActivationMarker(client, transition)") >
    blockFunction.indexOf("if (exact.rows.length !== 1)"));
});
