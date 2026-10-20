import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { test } from "node:test";
import {
  canonicalMintPaymentProjection,
  rowsWithCanonicalMintPayments,
} from "./proof-index-reader.mjs";
import { WORK_TOKEN_ID } from "../work-units.mjs";
import { WORK_AMO_V5_POWB_TOKEN_ID, WORK_AMO_V5_INCB_TOKEN_ID } from "../work-amo-v5.mjs";

const recorded = JSON.parse(readFileSync(new URL(
  "../../scripts/fixtures/canonical-ordi-mint-payment-972028.json", import.meta.url,
)));
const fixture = () => structuredClone(recorded);
const row = (input = fixture()) => ({
  event_id: input.evidence.event_id, status: "confirmed", payload: input.payload,
});
const copyTraceOutput = (input) => {
  input.payload.workAmoV5ReplayOutput = structuredClone(input.evidence.traces[0].output);
};

// This is the actual block 972028 mint that left the display summary 555 proofs
// below the committed transition. Its 654-proof change goes to the same address.
test("observed ORDI mint recovers exactly its committed 555-proof payment without rewriting history", () => {
  const input = fixture();
  const before = JSON.stringify(input);
  const projected = canonicalMintPaymentProjection(input.payload, input.evidence);
  assert.equal(projected.paidSats, 555);
  assert.equal(projected.proofPaymentSats, 555);
  assert.equal(projected.registryAddress, input.evidence.registry_address);
  assert.equal(projected.amountSats, 0);
  assert.equal(projected.amount, "1000");
  assert.equal(projected.txid, "80324e829c5213135a53da8934261a88c981a92d642943e1a4e31c2414866916");
  assert.equal(JSON.stringify(input), before);
  const { paidSats, proofPaymentSats, registryAddress, ...preserved } = projected;
  assert.deepEqual(preserved, input.payload);
  assert.equal(input.evidence.outputs.find((output) => output.vout === 2).value_sats, "654");
});

test("attribution excludes overpayment and after-carrier change and can span multiple earlier outputs", () => {
  const input = fixture();
  const trace = input.evidence.traces[0];
  input.payload.protocolVout = input.payload.position.protocolVout = 2;
  input.evidence.op_return_vout = 2;
  trace.position.protocolVout = trace.output.projection.position.protocolVout = 2;
  const registry = input.evidence.registry_address;
  input.evidence.outputs = [
    { vout: 0, address: registry, value_sats: "300" },
    { vout: 1, address: registry, value_sats: "1000" },
    { vout: 3, address: registry, value_sats: "654" },
  ];
  trace.stateDelta.economicOutputs = [
    { role: "pwt-token-registry", vout: 0, address: registry, outputSats: "300", attributedSats: "300" },
    { role: "pwt-token-registry", vout: 1, address: registry, outputSats: "1000", attributedSats: "255" },
  ];
  copyTraceOutput(input);
  assert.equal(canonicalMintPaymentProjection(input.payload, input.evidence).paidSats, 555);
});

test("existing consistent aliases are checked and contradictory aliases fail closed", () => {
  for (const value of [0, "0", 555, "555"]) {
    const input = fixture();
    input.payload.paidSats = value;
    input.payload.proofPaymentSats = value;
    assert.equal(canonicalMintPaymentProjection(input.payload, input.evidence).paidSats, 555);
  }
  for (const field of ["paidSats", "proofPaymentSats", "amountSats"]) {
    for (const value of [546, "556", -1, "555.1", "NaN", Number.MAX_SAFE_INTEGER + 1]) {
      const input = fixture();
      input.payload[field] = value;
      assert.throws(() => canonicalMintPaymentProjection(input.payload, input.evidence), /attribution/);
    }
  }
});

test("missing, duplicated, reorged and mismatched raw or economic witnesses fail closed", () => {
  const mutations = [
    ({ evidence }) => { evidence.traces = []; },
    ({ evidence }) => { evidence.traces.push(structuredClone(evidence.traces[0])); },
    ({ evidence }) => { evidence.block_hash = "b".repeat(64); },
    ({ evidence }) => { evidence.block_height++; },
    ...["block_height", "block_index", "op_return_vout", "record_ordinal"].flatMap((key) =>
      [null, undefined, "", false].map((value) => ({ evidence }) => { evidence[key] = value; })),
    ({ evidence }) => { evidence.raw_marker.blockHash = "b".repeat(64); },
    ({ evidence }) => { evidence.raw_marker.height++; },
    ({ evidence }) => { evidence.raw_txid = "b".repeat(64); },
    ({ evidence }) => { evidence.mint_price_sats = "546"; },
    ({ evidence }) => { evidence.mint_amount = "1001"; },
    ({ evidence }) => { evidence.registry_address = "1H1arP2xpam6MZmHt6k1tB83stqVdH6ANK"; },
    ({ evidence }) => { evidence.carrier_output = { scriptPubKey: { hex: "6a0100" } }; },
    ({ evidence }) => { evidence.outputs[0].value_sats = "554"; },
    ({ evidence }) => { evidence.outputs.push(structuredClone(evidence.outputs[0])); },
    ({ evidence }) => { evidence.traces[0].stateDelta.economicOutputs.push(structuredClone(evidence.traces[0].stateDelta.economicOutputs[0])); },
    ({ evidence }) => { evidence.traces[0].stateDelta.economicOutputs[0].attributedSats = "-555"; },
    ({ evidence }) => { evidence.traces[0].stateDelta.economicOutputs[0].vout = 2; },
    ({ evidence }) => { evidence.traces[0].stateDelta.economicOutputs[0].role = "pwt-seller"; },
    ({ evidence }) => { evidence.traces[0].stateDelta.baseContributions[0].field = "tokenTransferFlowSats"; },
    ({ evidence }) => { evidence.traces[0].stateDelta.baseContributions[0].value = "556"; },
    ({ evidence }) => { evidence.traces[0].stateDelta.baseContributions.push({ field: "tokenMintFlowSats", value: "555" }); },
    ({ evidence }) => { evidence.traces[0].position.recordOrdinal++; },
    ({ evidence }) => { evidence.traces[0].output.projection.parsed.amount = 1001; },
    ({ evidence }) => { evidence.traces[0].output.projection.recipientAddress = "1H1arP2xpam6MZmHt6k1tB83stqVdH6ANK"; },
    ({ payload }) => { payload.workAmoV5ReplayOutput.amount = "1001"; },
    ({ payload }) => { delete payload.workAmoV5ReplayOutput; },
    ({ payload }) => { payload.registryAddress = "1H1arP2xpam6MZmHt6k1tB83stqVdH6ANK"; },
    ({ payload }) => { payload.recipientAddress = "1H1arP2xpam6MZmHt6k1tB83stqVdH6ANK"; },
    ({ payload }) => { payload.minterAddress = "1H1arP2xpam6MZmHt6k1tB83stqVdH6ANK"; },
    ({ payload }) => { payload.blockHeight++; },
    ({ payload }) => { payload.confirmed = false; },
    ({ payload }) => { payload.valid = false; },
    ({ payload }) => { payload.workAmoV5ReplayOutcome.valid = false; },
    ({ payload }) => { payload.amount = "1e3"; },
  ];
  for (const mutate of mutations) {
    const input = fixture();
    mutate(input);
    assert.throws(() => canonicalMintPaymentProjection(input.payload, input.evidence), /attribution/);
  }
});

test("native-bound mint reads use one bounded evidence query and preserve unrelated rows", async () => {
  const input = fixture();
  const other = [
    { event_id: 1, status: "pending", payload: { ...input.payload, confirmed: false } },
    { event_id: 2, status: "confirmed", payload: { ...input.payload, _workAmoV5ReplayBound: false } },
    ...[WORK_TOKEN_ID, WORK_AMO_V5_POWB_TOKEN_ID, WORK_AMO_V5_INCB_TOKEN_ID].map((tokenId, index) => ({
      event_id: 3 + index, status: "confirmed", payload: { ...input.payload, tokenId },
    })),
  ];
  let calls = 0;
  const pool = { async query(sql, args) {
    calls++;
    assert.deepEqual(args, ["livenet", [input.evidence.event_id]]);
    for (const guard of [
      "canonical_mint_payment_attribution", "block.canonical = true", "tx.status = 'confirmed'",
      "transition.block_hash = tx.block_hash", "transition.previous_block_hash = block.previous_block_hash",
      "transition.complete = true", "transition.block_atomic = true", "transition.fee_once = true",
      "transition.invalid_zero = true", "e.valid = true", "e.kind = 'token-mint'", "LIMIT 2",
    ]) assert.ok(sql.includes(guard), guard);
    return { rows: [input.evidence] };
  } };
  const result = await rowsWithCanonicalMintPayments(pool, [row(input), ...other], "livenet");
  assert.equal(calls, 1);
  assert.equal(result[0].payload.paidSats, 555);
  other.forEach((item, index) => assert.equal(result[index + 1], item));
  assert.equal(await rowsWithCanonicalMintPayments(pool, other, "livenet"), other);
  assert.equal(calls, 1);
  const complete = row(input);
  complete.payload.paidSats = 555;
  assert.equal((await rowsWithCanonicalMintPayments(pool, [complete], "livenet"))[0].payload.proofPaymentSats, 555);
  assert.equal(calls, 2, "even existing aliases require their exact native mint evidence");
});

test("absent or duplicate canonical query results never become zero or guessed payments", async () => {
  const input = fixture();
  for (const evidenceRows of [[], [input.evidence, input.evidence]]) {
    const pool = { async query() { return { rows: evidenceRows }; } };
    await assert.rejects(rowsWithCanonicalMintPayments(pool, [row(input)], "livenet"), /attribution/);
  }
  const pool = { async query() { throw new Error("checkpoint read unavailable"); } };
  await assert.rejects(rowsWithCanonicalMintPayments(pool, [row(input)], "livenet"), /checkpoint read unavailable/);
});

function readerFunction(name) {
  const source = readFileSync(new URL("./proof-index-reader.mjs", import.meta.url), "utf8");
  const start = source.indexOf(`async function ${name}(`);
  assert.ok(start >= 0);
  const next = /\n(?:export )?(?:async )?function /u.exec(source.slice(start + 1));
  return source.slice(start, next ? start + 1 + next.index : source.length);
}

test("both full-state mint rows and paged mint history receive the same payment projection", async () => {
  const input = fixture();
  const pool = { async query(sql) {
    if (sql.includes("canonical_mint_payment_attribution")) return { rows: [input.evidence] };
    if (sql.includes("count(*)")) return { rows: [{ total_count: 1, indexed_through_block: 972028 }] };
    return { rows: [row(input)] };
  } };
  const context = vm.createContext({
    rowsWithCanonicalMintPayments,
    tokenMintEventQueryParts: () => ({ candidateCte: "", cte: "", params: ["livenet"] }),
    canonicalTokenMintCandidateRows: (rows) => rows,
    tokenMintSortSql: () => "event_id",
    tokenMintFromEventPayload: (payload) => payload,
    tokenAmountIsPositive: (payload) => Number(payload.amount) > 0,
    objectRecord: (value) => value,
    rowNumber: (value, field) => Number(value?.[field] ?? 0),
    historyCursor: (snapshot, start) => `${snapshot}:${start}`,
    dateIso: (value) => value,
  });
  vm.runInContext(`${readerFunction("proofIndexTokenMintRows")}\n${readerFunction("exactTokenMintHistoryPage")}`, context);
  const pagination = { limit: 20, offset: 0, query: "" };
  const full = await context.proofIndexTokenMintRows(pool, "livenet", "all", new URLSearchParams(), pagination);
  const history = await context.exactTokenMintHistoryPage(pool, "livenet", "all", new URLSearchParams(), pagination, {});
  assert.equal(full[0].payload.paidSats, 555);
  assert.equal(history.items[0].paidSats, 555);
  assert.equal(history.items[0].proofPaymentSats, 555);
});
