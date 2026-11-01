import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { transaction, batchVout, recipients, ACTOR } from "../../tests/fixtures/workMailBatch.mjs";
import { canonicalRawProtocolRecordSetFromTransaction } from "../canonical-op-return.mjs";
import { validateWorkMailBatchV1RawTransaction } from "../work-mail-batch-transaction.mjs";
import { workAmoV5CanonicalPayloadCommitment } from "../work-amo-v5.mjs";
import { WORK_MAIL_BATCH_DECLARATION_COMMITMENT_MODEL } from "../work-mail-batch-declaration.mjs";
import { assertCanonicalWorkMailBatchChild, validateWorkMailBatchProjectionEvents, verifiedWorkMailBatchEventIds } from "./work-mail-batch-reader.mjs";

function fixture(count = 2) {
  const tx = transaction({ vector: recipients(count) }), vout = batchVout(tx);
  const authority = validateWorkMailBatchV1RawTransaction({ transaction: tx, protocolVout: vout });
  assert.equal(authority.valid, true);
  const { parsed: batch, mailEnvelope } = authority;
  const raw = canonicalRawProtocolRecordSetFromTransaction(tx).records;
  const wire = raw.find(row => row.protocol === "pwt1"), mail = raw.find(row => row.protocol === "pwm1");
  const position = { blockHeight: 1_000_001, blockHash: "b".repeat(64), blockTransactionIndex: 3, protocolVout: vout, recordOrdinal: 0 };
  const chain = { model: "canonical-work-amo-raw-transition-chain-sha256-v1", payloadBytes: 100, sha256: "c".repeat(64) };
  const batchPayloadCommitment = workAmoV5CanonicalPayloadCommitment({ payload: wire.message });
  const derived = batch.recipients.map((recipient, index) => ({ ...recipient, senderAddress: ACTOR, tokenId: batch.tokenId,
    amountStorageModel: "work-subatoms-v2", amountVersion: "mailbatch1", transferVersion: "mailbatch1", batchRecipientIndex: index,
    batchRecipientCount: batch.recipientCount, batchTotalAmountSubatoms: batch.totalAmountSubatoms, batchPayloadCommitment, mailEnvelope,
    kind: "token-transfer", paidSats: 0, registryMutationFeeSats: 0, chargesTransactionFee: false, claimsEconomicOutputs: false,
    economicDelta: false, rawCandidate: false, containerPosition: position, projectionPosition: { ...position, recordOrdinal: index + 1 },
    parentTransitionChainCommitmentAfter: chain, derivedId: `${tx.txid}:${position.blockHeight}:3:${vout}:${index+1}`, derivedIndex: index }));
  const output = { amountSubatoms: batch.totalAmountSubatoms, totalAmountSubatoms: batch.totalAmountSubatoms,
    recipientCount: batch.recipientCount, recipients: batch.recipients, batchPayloadCommitment, batchRegistryPaymentSats: 546, mailEnvelope,
    projection: { kind: "token-transfer-batch" } };
  const parentRecord = { derived, protocol: "pwt1", rawCandidate: true, outcome: { kind: "pwt1-valid", semanticKind: "token-transfer-batch", valid: true },
    output, position, txid: tx.txid, transitionChainCommitmentAfter: chain, rawWitness: { rawRecordParts: wire.rawRecordParts } };
  const parent = { kind: "token-transfer-batch", protocol: "pwt1", valid: true, confirmed: true, _workAmoV5ReplayBound: true,
    workAmoV5RawCandidate: true, payload: wire.message, senderAddress: ACTOR, txid: tx.txid, tokenId: batch.tokenId,
    amountVersion: "mailbatch1", transferVersion: "mailbatch1", paidSats: 546, mailEnvelope, workAmoV5ReplayOutput: output };
  const children = derived.map(descriptor => ({ ...descriptor, position: descriptor.projectionPosition, derived: true,
    txid: tx.txid, protocol: "pwt1", valid: true, confirmed: true, _workAmoV5ReplayBound: true, workAmoV5RawCandidate: false,
    workAmoV5ReplayOutcome: { kind: "pwt1-valid", valid: true }, workAmoV5ReplayRawWitness: {
      model: "canonical-work-amo-v5-derived-child-v1", descriptor, parentPosition: position, parentProtocol: "pwt1" } }));
  const mailRecord = { txid: tx.txid, protocol: "pwm1", rawCandidate: true, outcome: { valid: true, semanticKind: "mail" },
    position: { ...position, protocolVout: mail.protocolVout }, rawWitness: { rawRecordParts: mail.rawRecordParts },
    output: { recipients: mailEnvelope.recipients.map(({ recipientAddress, amountSats, vout }) => ({ address: recipientAddress, amountSats, outputSats: amountSats, vout })) } };
  const activationContext = { activationHeight: 1_000_001, declaration: { txid: "a".repeat(64), blockHash: "d".repeat(64),
    blockHeight: 1_000_000, blockTransactionIndex: 1, protocolVout: 1, recordOrdinal: 0, registryPaymentVout: 2 },
    evidenceCommitment: { model: WORK_MAIL_BATCH_DECLARATION_COMMITMENT_MODEL, payloadBytes: 1, sha256: "e".repeat(64) } };
  return { transaction: tx, parent, children, parentRecord, mailRecord, activationContext };
}

function readerFixture(count = 2) {
  const f = fixture(count);
  const evidence = { parent_event_id: "10", parent_payload: f.parent, parent_records: [f.parentRecord], mail_records: [f.mailRecord],
    transaction: f.transaction, carrier_output: f.transaction.vout[batchVout(f.transaction)], activation_context: f.activationContext,
    siblings: f.children.map((payload, index) => ({ event_id: String(11 + index), payload, position: payload.position })) };
  // PostgreSQL JSON has distinct nested objects, even where the fixture builder
  // reused an object. Do not hide repeated work behind reference equality.
  return JSON.parse(JSON.stringify({ evidence, requested: [
    { event_id: 10, payload: f.parent }, ...f.children.map((payload, index) => ({ event_id: 11 + index, payload })),
  ] }));
}

async function measuredReader() {
  const url = new URL("./work-mail-batch-reader.mjs", import.meta.url);
  const source = readFileSync(url, "utf8")
    .replace(/from "(\.[^"]+)"/gu, (_match, path) => `from ${JSON.stringify(new URL(path, url).href)}`)
    .replace("parseWorkMailBatchPayload,", "parseWorkMailBatchPayload as originalParseWorkMailBatchPayload,") + `
      let countedMailBatchParses = 0;
      function parseWorkMailBatchPayload(...args) { countedMailBatchParses++; return originalParseWorkMailBatchPayload(...args); }
      export function mailBatchParseCount() { return countedMailBatchParses; }
    `;
  // Import into the same realm so deep equality retains its real prototype
  // checks for the PWM recipient objects constructed inside the implementation.
  const measured = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
  return { reader: measured.verifiedWorkMailBatchEventIds, counts: { get parses() { return measured.mailBatchParseCount(); } } };
}

test("sealed Mail attachments bind the exact PWM parent, ordered payments and every WORK child", () => {
  assert.equal(validateWorkMailBatchProjectionEvents(fixture()).valid, true);
  for (const mutate of [ f => f.children.pop(), f => f.children.push(f.children[0]),
    f => { f.children[0].amountSubatoms = "1"; }, f => { f.children[0].paidSats = 546; },
    f => { f.children[0].mailEnvelope = {}; }, f => { f.mailRecord.outcome.valid = false; },
    f => { f.mailRecord.position.protocolVout++; }, f => { f.mailRecord.rawWitness.rawRecordParts[0].text += "different"; },
    f => { f.parentRecord.rawWitness.rawRecordParts[0].text += "different"; },
    f => { f.mailRecord.output.recipients.pop(); }, f => { f.activationContext = null; },
    f => { f.children[1].parentTransitionChainCommitmentAfter = { ...f.children[1].parentTransitionChainCommitmentAfter, sha256: "f".repeat(64) }; } ]) {
    const f = structuredClone(fixture()); mutate(f); assert.equal(validateWorkMailBatchProjectionEvents(f).valid, false, String(mutate));
  }
});

test("reader checks the complete accepted set even when a page requests only one recipient", async () => {
  const f = fixture();
  const evidence = { parent_event_id: "10", parent_payload: f.parent, parent_records: [f.parentRecord], mail_records: [f.mailRecord],
    transaction: f.transaction, carrier_output: f.transaction.vout[batchVout(f.transaction)], activation_context: f.activationContext,
    siblings: f.children.map((payload, index) => ({ event_id: String(11 + index), payload, position: payload.position })) };
  const pool = data => ({ query: async (sql, params) => {
    assert.match(sql, /canonical_work_mail_batch_parent_evidence/u); assert.match(sql, /transition.complete = true/u);
    assert.match(sql, /block.canonical = true/u); assert.match(sql, /workMailBatchV1/u); assert.equal(params[0], "livenet");
    return { rows: data };
  } });
  const requested = [{ event_id: 11, payload: f.children[0] }];
  assert.deepEqual([...await verifiedWorkMailBatchEventIds(pool([evidence]), requested)], [11]);
  const missing = structuredClone(evidence); missing.siblings.pop();
  await assert.rejects(() => verifiedWorkMailBatchEventIds(pool([missing]), requested));
  await assert.rejects(() => verifiedWorkMailBatchEventIds(pool([]), requested));
  await assert.rejects(() => verifiedWorkMailBatchEventIds(pool([evidence]), requested, "testnet"));
  assert.deepEqual([...await verifiedWorkMailBatchEventIds(pool([]), [{ payload: { transferVersion: "batch1" } }])], []);
});

test("a maximum Mail batch qualifies each independent carrier envelope once across all read chunks", async () => {
  const { evidence, requested } = readerFixture(256);
  const { reader, counts } = await measuredReader();
  let queries = 0;
  const result = await reader({ query: async (_sql, params) => {
    queries++; assert.equal(params[1].length, 100);
    return { rows: [evidence] };
  } }, requested);
  assert.equal(result.size, 257);
  assert.equal(queries, 1, "complete family evidence is not reread for later requested children");
  assert.equal(counts.parses, 2, "the transaction and relational carrier envelopes are each parsed once");
});

test("cached later-chunk Mail requests still require exact payloads and unique identities", async () => {
  const { evidence, requested } = readerFixture(128);
  let queries = 0;
  const pool = { query: async () => { queries++; return { rows: [evidence] }; } };
  const changed = JSON.parse(JSON.stringify(requested));
  changed.at(-1).payload.amountSubatoms = "1";
  await assert.rejects(() => verifiedWorkMailBatchEventIds(pool, changed), /read differs/u);
  assert.equal(queries, 1);
  queries = 0;
  await assert.rejects(() => verifiedWorkMailBatchEventIds(pool, [...requested, requested[0]]), /unique event identity/u);
  assert.equal(queries, 0, "a duplicate across chunks must fail before any family reuse");
});

test("Mail family reuse never crosses calls or replaces relational position and PWM authority checks", async () => {
  const { evidence, requested } = readerFixture(3);
  let queries = 0, current = evidence;
  const pool = { query: async () => { queries++; return { rows: [current] }; } };
  await verifiedWorkMailBatchEventIds(pool, [requested[1]]);
  for (const mutate of [
    row => { row.siblings.at(-1).position.recordOrdinal++; },
    row => { row.mail_records[0].outcome.valid = false; },
    row => { row.activation_context = null; },
    row => { row.siblings.at(-1).payload.mailEnvelope.recipients[0].amountSats = "1"; },
    row => { row.siblings.at(-1).event_id = row.siblings[0].event_id; },
  ]) {
    current = JSON.parse(JSON.stringify(evidence)); mutate(current);
    await assert.rejects(() => verifiedWorkMailBatchEventIds(pool, [requested[1]]), undefined, String(mutate));
  }
  assert.equal(queries, 6, "each read reloads and qualifies its full off-page family");
});

test("the standalone Mail child assertion fully revalidates parent and carrier evidence", () => {
  const { evidence, requested } = readerFixture();
  const child = requested[1].payload;
  assert.equal(assertCanonicalWorkMailBatchChild(child, { ...evidence, child_position: evidence.siblings[0].position }), true);
  for (const mutate of [
    row => { row.parent_payload.workAmoV5ReplayOutput.recipientCount++; },
    row => { row.parent_records[0].output.recipients[1].amountSubatoms = "1"; },
    row => { row.parent_records[0].transitionChainCommitmentAfter.sha256 = "invalid"; },
    row => { row.carrier_output = { scriptpubkey: "6a", value: "0" }; },
  ]) {
    const changed = JSON.parse(JSON.stringify(evidence)); mutate(changed);
    assert.throws(() => assertCanonicalWorkMailBatchChild(child, { ...changed, child_position: changed.siblings[0].position }));
  }
});

test("address Mail reader qualifies a retained parent even when every child row is missing", async () => {
  const f = fixture();
  const source = readFileSync(new URL("./proof-index-reader.mjs", import.meta.url), "utf8");
  const start = source.indexOf("export async function proofIndexAddressMailPayload(");
  const end = source.indexOf("\nasync function notificationAdditiveDnsMatches(", start);
  assert.ok(start >= 0 && end > start);
  let calls = 0, renders = 0;
  const pool = { async query(sql, params) {
    calls++;
    if (calls === 1) {
      assert.match(sql, /canonical_work_mail_batch_parents AS/u);
      assert.match(sql, /parent\.kind = 'token-transfer-batch'/u);
      assert.match(sql, /canonical_work_mail_batch_parents\.parent_candidates AS mail_batch_parents/u);
      return { rows: [{ attached_credit_events: [], mail_batch_candidates: null,
        mail_batch_parents: [{ event_id: "10", payload: f.parent }] }] };
    }
    assert.equal(calls, 2);
    assert.match(sql, /canonical_work_mail_batch_parent_evidence/u);
    assert.deepEqual(Array.from(params[1]), [10]);
    return { rows: [{ parent_event_id: "10", parent_payload: f.parent, parent_records: [f.parentRecord],
      mail_records: [f.mailRecord], transaction: f.transaction, activation_context: f.activationContext,
      carrier_output: f.transaction.vout[batchVout(f.transaction)], siblings: [] }] };
  } };
  const read = new vm.Script(`${source.slice(start, end).replace(/^export /u, "")}\nproofIndexAddressMailPayload`)
    .runInContext(vm.createContext({ proofIndexPool: () => pool, normalizedAddress: value => value,
      WORK_AMO_V5_ACTIVATION_HEIGHT: 948000, ADDRESS_MAIL_EVENT_KINDS: ["mail", "reply", "file"],
      WORK_TOKEN_ID: f.parent.tokenId, verifiedWorkMailBatchEventIds,
      addressMailRowPayloads: () => { renders++; return []; } }));
  await assert.rejects(() => read("livenet", ACTOR), /recipient set is incomplete/u);
  assert.equal(calls, 2);
  assert.equal(renders, 0, "unqualified parent cannot become Mail without its accepted WORK set");
});
