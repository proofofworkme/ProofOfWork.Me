import assert from "node:assert/strict";
import { test } from "node:test";
import { canonicalTransferFeeProjection, rowsWithCanonicalTransferFees } from "./proof-index-reader.mjs";

const tokenId = "a3d0bc8528f91dfc52400a885bed7e49235396aa82aa9f95db41be629f1d5562";
const registry = "1H1arP2xpam6MZmHt6k1tB83stqVdH6ANK";
const recipient = "18xvbj6mpPpYYjWibcqsXdV7SCwBQNrqMW";
function fixture(old = false) {
  const txid = old ? "7a2436c755719eb2bd53e355b340617896453d075f97aa964767813e5670393d"
    : "2b9991ab3a6f2c3b0de2ea18bf214669cadb44f866b9d0a468311c7211dd96c4";
  const amount = old ? "27420000" : "950000";
  const sender = old ? "1PNdpQUScG1SnzyrsuGdErKWtjtrbWM5TV"
    : "bc1p3qlws3see5qlrrmax7e74hr6qmssjecmnykvvj3ggcles4drdtvqcyag7z";
  const position = { blockHash: old
    ? "00000000000000000000f4d473278fcefab7993a2cf5914f98c25e492fe05045"
    : "00000000000000000001ab7ba52889cc799e3f9fec41ea63e173f9407b9e77ba",
    blockHeight: old ? 963714 : 966026, blockTransactionIndex: old ? 3651 : 478,
    protocolVout: 1, recordOrdinal: 0 };
  const text = `pwt1:send:${tokenId}:${amount}:${recipient}`;
  const payload = { txid, tokenId, amount, network: "livenet", protocol: "pwt1",
    kind: "token-transfer", confirmed: true, valid: true, position, payload: text,
    senderAddress: sender, recipientAddress: recipient, amountSats: 0,
    _workAmoV5ReplayBound: true, workAmoV5RawCandidate: true,
    workAmoV5ReplayOutcome: { kind: "pwt1-valid", valid: true, reasonCode: "" } };
  const projected = { txid, tokenId, amount, position, protocol: "pwt1",
    kind: "token-transfer", valid: true, senderAddress: sender, recipientAddress: recipient,
    parsed: { kind: "send", tokenId, amount, recipientAddress: recipient, payload: text } };
  const evidence = { event_id: old ? 3777356 : 4002964, txid, raw_txid: txid,
    network: "livenet", token_id: tokenId, registry_address: registry,
    block_height: position.blockHeight, block_index: position.blockTransactionIndex,
    block_hash: position.blockHash, op_return_vout: 1, record_ordinal: 0,
    raw_marker: { network: "livenet", height: position.blockHeight,
      blockIndex: position.blockTransactionIndex, blockHash: position.blockHash },
    carrier_output: { scriptPubKey: { hex: `6a4c${Buffer.byteLength(text).toString(16)}${Buffer.from(text).toString("hex")}` } },
    outputs: [{ vout: 0, address: registry, value_sats: "546" }],
    traces: [{ txid, kind: "protocol-record", valid: true, reasonCode: "", position,
      output: { projection: projected }, transitionChainCommitmentAfter: { model: "canonical-work-amo-raw-transition-chain-sha256-v1", payloadBytes: 100, sha256: "a".repeat(64) },
      stateDelta: { baseContributions: [{ field: "tokenTransferFlowSats", value: "546" }],
        economicOutputs: [{ role: "pwt-token-registry", vout: 0, address: registry,
          outputSats: "546", attributedSats: "546" }] } }] };
  return { payload, evidence };
}

test("both observed POWB transfers recover committed fee without altering historical rows or miner fees", () => {
  for (const old of [true, false]) {
    const { payload, evidence } = fixture(old);
    const before = JSON.stringify({ payload, evidence });
    const result = canonicalTransferFeeProjection(payload, evidence);
    assert.equal(result.paidSats, 546);
    assert.equal(result.registryMutationFeeSats, 546);
    assert.equal(result.registryAddress, registry);
    assert.equal(result.amountSats, 0);
    assert.equal(result.amount, payload.amount);
    assert.ok(!Object.hasOwn(result, "minerFeeSats"));
    assert.equal(JSON.stringify({ payload, evidence }), before);
  }
});

test("attributed fee is independent of output overpayment and unrelated payments", () => {
  const { payload, evidence } = fixture();
  evidence.traces[0].stateDelta.economicOutputs[0].outputSats = "1092";
  evidence.outputs[0].value_sats = "1092";
  evidence.outputs.push({ vout: 4, address: registry, value_sats: "100000" });
  assert.equal(canonicalTransferFeeProjection(payload, evidence).paidSats, 546);
});

test("missing, duplicated, mismatched and conflicting evidence fails closed", () => {
  const mutations = [
    ({ evidence }) => { evidence.traces = []; },
    ({ evidence }) => { evidence.traces.push(structuredClone(evidence.traces[0])); },
    ({ evidence }) => { evidence.traces[0].position = { ...evidence.traces[0].position, recordOrdinal: 1 }; },
    ({ evidence }) => { evidence.raw_marker = { ...evidence.raw_marker, height: 966025 }; },
    ({ evidence }) => { evidence.raw_txid = "b".repeat(64); },
    ({ evidence }) => { evidence.registry_address = recipient; },
    ({ evidence }) => { evidence.outputs[0].value_sats = "545"; },
    ({ evidence }) => { evidence.traces[0].stateDelta.economicOutputs.push(structuredClone(evidence.traces[0].stateDelta.economicOutputs[0])); },
    ({ evidence }) => { evidence.traces[0].stateDelta.baseContributions[0].value = "1092"; },
    ({ evidence }) => { evidence.traces[0].stateDelta.economicOutputs[0].attributedSats = "-546"; },
    ({ evidence }) => { evidence.carrier_output = { scriptPubKey: { hex: "6a0100" } }; },
    ({ evidence }) => { evidence.traces[0].output.projection = { ...evidence.traces[0].output.projection, recipientAddress: registry }; },
    ({ payload }) => { payload.registryMutationFeeSats = 547; },
    ({ payload }) => { payload.paidSats = "NaN"; },
    ({ payload }) => { payload.confirmed = false; },
    ({ payload }) => { payload.valid = false; },
  ];
  for (const mutate of mutations) {
    const input = fixture();
    mutate(input);
    assert.throws(() => canonicalTransferFeeProjection(input.payload, input.evidence), /attribution/);
  }
});

test("only missing-fee candidates trigger one batched SELECT; complete and pending rows remain untouched", async () => {
  const first = fixture(true), second = fixture();
  const rows = [first, second].map(({ payload, evidence }) => ({ event_id: evidence.event_id, status: "confirmed", payload }));
  const complete = { event_id: 4, status: "confirmed", payload: { ...first.payload, paidSats: 546 } };
  const pending = { event_id: 5, status: "pending", payload: { ...first.payload, confirmed: false } };
  rows.push(complete, pending);
  let calls = 0;
  const pool = { async query(sql, args) {
    calls++;
    assert.match(sql, /canonical_transfer_registry_attribution/);
    assert.match(sql, /transition.complete = true/);
    assert.match(sql, /block.canonical = true/);
    assert.deepEqual(args, ["livenet", [3777356, 4002964]]);
    return { rows: [first.evidence, second.evidence] };
  } };
  const result = await rowsWithCanonicalTransferFees(pool, rows, "livenet");
  assert.equal(calls, 1);
  assert.deepEqual(result.slice(0, 2).map((r) => r.payload.paidSats), [546, 546]);
  assert.equal(result[2], complete);
  assert.equal(result[3], pending);
  assert.equal(await rowsWithCanonicalTransferFees(pool, [complete, pending], "livenet").then((r) => r.length), 2);
  assert.equal(calls, 1);
});
