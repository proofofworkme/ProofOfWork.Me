import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  boostGrowthObservedAction,
  createBoostGrowthObservation,
  createBoostGrowthObservationLoader,
  withBoostGrowthObservation,
} from "../server/boost-growth.mjs";
import { readBoostGrowthObservation } from "../server/db/boost-growth-reader.mjs";
import { WORK_TOKEN_ID } from "../server/work-units.mjs";
import { address as bitcoinAddress, networks, Transaction } from "bitcoinjs-lib";

const checkpoint = { blockHeight: 970000, blockHash: "b".repeat(64), snapshotId: "fixture-snapshot" };
const address = "bc1qfixture";
const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
const post = `pwb1:post:${encode({ v: 1, text: "Confirmed original", workSignalSubatoms: "999999999999999999999999" })}`;
const opReturn = (text) => {
  const bytes = Buffer.from(text);
  const push = bytes.length <= 75 ? Buffer.from([bytes.length]) : Buffer.from([0x4c, bytes.length]);
  return { value: 0, scriptpubkey: Buffer.concat([Buffer.from([0x6a]), push, bytes]).toString("hex") };
};
const event = (protocol, kind, payload, vout, overrides = {}) => ({
  protocol, kind, raw_payload: payload, op_return_vout: vout,
  record_ordinal: 0, status: "confirmed", valid: true, validation_errors: [],
  payload: {}, ...overrides,
});

function transaction(index = 1, actions = [post]) {
  const txid = index.toString(16).padStart(64, "0");
  const row = {
    txid, status: "confirmed", block_height: 969999, block_hash: "a".repeat(64), block_index: index,
    events: actions.map((payload, i) => event("pwb1", `boost-${boostGrowthObservedAction(payload)}`, payload, i + 1)),
  };
  row.raw_tx = {
    txid, _powBlockIndex: index,
    canonicalBlockScan: { network: "livenet", height: row.block_height, blockHash: row.block_hash },
    vin: [{ prevout: { scriptpubkey_address: address } }],
    vout: [{ value: 546, scriptpubkey_address: address }, ...actions.map(opReturn)],
  };
  return row;
}

function observe(rows) {
  const accumulator = createBoostGrowthObservation(checkpoint);
  rows.forEach((row) => accumulator.addTransaction(row));
  return accumulator.finish();
}

test("confirmed observed records exclude pending, explicit invalid, malformed, and out-of-checkpoint rows", () => {
  const valid = transaction(1);
  valid.events[0].payload.hidden = true;
  const pending = transaction(2); pending.status = "pending";
  const invalid = transaction(3); invalid.events[0].valid = false;
  const malformed = transaction(4); malformed.events[0].raw_payload = "pwb1:post:bad";
  malformed.raw_tx.vout[1] = opReturn(malformed.events[0].raw_payload);
  const future = transaction(5); future.block_height = checkpoint.blockHeight + 1;
  const result = observe([valid, pending, invalid, malformed, future]);
  assert.equal(result.ready, true);
  assert.equal(result.counts.posts, 1);
  assert.equal(result.counts.transactions, 1);
  assert.equal(result.directProofSignalSats, "546");
  assert.equal(result.attachedWorkSubatoms, "0", "JSON-declared WORK must not become attachment authority");
});

test("mixed Mail, Boost and WORK provide exact nonadditive attribution once", () => {
  const row = transaction();
  const amount = "12345678901234567890";
  const work = `pwt1:send3:${WORK_TOKEN_ID}:${amount}:${address}`;
  row.raw_tx.vout.push(opReturn("pwm1:m:Confirmed original"), opReturn(work));
  const mail = event("pwm1", "mail", "pwm1:m:Confirmed original", 2, {
    payload: {
      workAmoV5ReplayOutcome: { valid: true, kind: "pwm1-valid" },
      workAmoV5RawCandidate: true,
      workAmoV5ReplayOutput: { recipients: [{ vout: 0, address, amountSats: "546" }] },
    },
  });
  const transfer = event("pwt1", "token-transfer", work, 3, {
    payload: {
      workAmoV5ReplayOutcome: { valid: true, kind: "pwt1-valid" },
      workAmoV5RawCandidate: true,
      workAmoV5ReplayOutput: { amountSubatoms: amount, tokenId: WORK_TOKEN_ID, recipientAddress: address },
    },
  });
  row.events.push(mail, { ...mail }, transfer, { ...transfer });
  const result = observe([row]);
  assert.equal(result.counts.events, 1);
  assert.equal(result.attributedMailSats, "546");
  assert.equal(result.directProofSignalSats, "546");
  assert.equal(result.attachedWorkSubatoms, amount);
  assert.equal(result.attributedWorkSubatoms, amount);
  const canonical = Object.freeze({
    snapshotId: checkpoint.snapshotId,
    actualValue: Object.freeze({ totalSats: "123.456", networkValueQ8: "12345600000" }),
    workFloor: Object.freeze({ networkValueSats: "123.456" }),
  });
  const enriched = withBoostGrowthObservation(canonical, result);
  assert.strictEqual(enriched.actualValue, canonical.actualValue);
  assert.strictEqual(enriched.workFloor, canonical.workFloor);
  assert.deepEqual(Object.keys(enriched).filter((key) => key !== "boost"), Object.keys(canonical));
});

test("paid record observations cannot claim verified registry payments or sales", () => {
  const like = `pwb1:like:${"a".repeat(64)}`;
  const buy = `pwb1:buy5:${"b".repeat(64)}:${address}`;
  const row = transaction(1, [like, buy]);
  row.events[1].kind = "boost-buy";
  const result = observe([row]);
  assert.equal(result.counts.likes, 1);
  assert.equal(result.counts.sales, 1);
  assert.equal(result.counts.socialActions, 1);
  assert.equal(result.ready, true);
  assert.equal(result.economicMetricsVerified, false);
  assert.equal(result.directProofSignalSats, null);
  assert.equal(result.registryFeeSats, null);
  assert.equal(result.saleVolumeSats, null);
  assert.ok(result.metricReasons.saleVolumeSats);
});

test("missing WORK projection or raw evidence returns unavailable metrics instead of zero", () => {
  const row = transaction();
  row.raw_tx.vout.push(opReturn(`pwt1:send3:${WORK_TOKEN_ID}:123:${address}`));
  assert.equal(observe([row]).attachedWorkSubatoms, null);
  const missing = transaction(); delete missing.raw_tx;
  const result = observe([missing]);
  assert.equal(result.counts.posts, 1);
  assert.equal(result.directProofSignalSats, null);
  assert.equal(result.attributedMailSats, null);
});

test("raw Boost carriers missing from the index prevent a complete observation", () => {
  const row = transaction();
  row.raw_tx.vout.push(opReturn(post));
  assert.throws(() => observe([row]), /raw Boost carrier has no exact indexed outcome/u);
});

test("wrong-kind or mismatched WORK rows cannot produce a verified zero", () => {
  const payload = `pwt1:send3:${WORK_TOKEN_ID}:123:${address}`;
  for (const overrides of [
    { kind: "token-mint" },
    { raw_payload: `pwt1:send3:${WORK_TOKEN_ID}:456:${address}` },
  ]) {
    const row = transaction();
    row.raw_tx.vout.push(opReturn(payload));
    row.events.push(event("pwt1", "token-transfer", payload, 2, overrides));
    const result = observe([row]);
    assert.equal(result.attachedWorkSubatoms, null);
    assert.equal(result.economicMetricsVerified, false);
  }
  const invalid = transaction();
  invalid.raw_tx.vout.push(opReturn(payload));
  invalid.events.push(event("pwt1", "token-event-invalid", payload, 2, {
    valid: false,
    payload: { valid: false, workAmoV5ReplayOutcome: { valid: false, kind: "pwt1-invalid" } },
  }));
  assert.equal(observe([invalid]).attachedWorkSubatoms, "0");
});

test("same payment output referenced by multiple original records is observed once", () => {
  const result = observe([transaction(1, [post, post])]);
  assert.equal(result.counts.posts, 2);
  assert.equal(result.counts.transactions, 1);
  assert.equal(result.directProofSignalSats, "546");
});

function coreTransaction() {
  const row = transaction();
  const wire = new Transaction();
  wire.addInput(Buffer.alloc(32, 1), 0);
  const paymentScript = "0014" + "1".repeat(40);
  const paymentAddress = bitcoinAddress.fromOutputScript(Buffer.from(paymentScript, "hex"), networks.bitcoin);
  wire.addOutput(Buffer.from(paymentScript, "hex"), 546n);
  wire.addOutput(Buffer.from(row.raw_tx.vout[1].scriptpubkey, "hex"), 0n);
  row.txid = wire.getId();
  row.raw_tx.txid = row.txid;
  row.raw_tx.hex = wire.toHex();
  row.raw_tx.vin[0].prevout = { value: 0.00025546, valueSats: 25546, scriptPubKey: { hex: paymentScript, address: paymentAddress } };
  row.raw_tx.vout = [
    { n: 0, value: 0.00000546, scriptPubKey: { hex: paymentScript, address: paymentAddress } },
    { n: 1, value: 0, scriptPubKey: { hex: Buffer.from(wire.outs[1].script).toString("hex") } },
  ];
  return row;
}

test("Core coin-denominated JSON derives exact proof amounts only from its wire witness", () => {
  const row = coreTransaction();
  assert.equal(observe([row]).directProofSignalSats, "546");
  row.raw_tx.vout[0].value = 999999999999999.123;
  assert.equal(observe([row]).directProofSignalSats, "546", "JSON numeric value is not arithmetic authority");
  row.raw_tx.vout[0].scriptPubKey.address = "bc1qmislabeledoutput";
  row.raw_tx.vin[0].prevout.scriptPubKey.address = "bc1qmislabeledprevout";
  assert.equal(observe([row]).directProofSignalSats, "546", "Addresses derive from scripts, not JSON address labels");
  const missing = coreTransaction(); delete missing.raw_tx.hex;
  assert.equal(observe([missing]).directProofSignalSats, null);
  const wrongScript = coreTransaction(); wrongScript.raw_tx.vout[0].scriptPubKey.hex = "51";
  assert.equal(observe([wrongScript]).directProofSignalSats, null);
  const wrongTxid = coreTransaction(); wrongTxid.raw_tx.hex = new Transaction().toHex();
  assert.equal(observe([wrongTxid]).directProofSignalSats, null);
});

function database(rows, { incomplete = false, hash = checkpoint.blockHash } = {}) {
  const calls = [];
  let released = false;
  const client = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (sql.includes("SELECT block_hash")) return { rows: [{ block_hash: hash }] };
      if (sql.includes("AS incomplete")) return { rows: [{ incomplete }] };
      if (sql.includes("WITH boost_transactions")) {
        return { rows: rows.filter((row) => row.txid > params[2]).slice(0, params[3]) };
      }
      return { rows: [] };
    },
    release() { released = true; },
  };
  return { pool: { async connect() { return client; } }, calls, released: () => released };
}
const loadSnapshot = async () => ({
  snapshot_id: checkpoint.snapshotId, indexed_through_block: checkpoint.blockHeight,
  payload: { indexedThroughBlockHash: checkpoint.blockHash },
});

test("reader consumes all history beyond feed limits inside one read-only checkpoint", async () => {
  const rows = Array.from({ length: 231 }, (_, i) => transaction(i + 1));
  const db = database(rows);
  const result = await readBoostGrowthObservation(db.pool, "livenet", checkpoint, loadSnapshot);
  assert.equal(result.counts.posts, 231);
  assert.equal(result.directProofSignalSats, String(231 * 546));
  assert.equal(result.complete, true);
  assert.equal(db.calls.filter(({ sql }) => sql.includes("WITH boost_transactions")).length, 10);
  assert.ok(db.calls[0].sql.includes("REPEATABLE READ READ ONLY"));
  assert.ok(db.calls.some(({ sql }) => sql === "COMMIT"));
  assert.equal(db.released(), true);
});

test("checkpoint conflict and missing carrier outcomes fail closed with no partial metrics", async () => {
  for (const options of [{ incomplete: true }, { hash: "c".repeat(64) }]) {
    const db = database([transaction()], options);
    const result = await readBoostGrowthObservation(db.pool, "livenet", checkpoint, loadSnapshot);
    assert.equal(result.ready, false);
    assert.equal(result.complete, false);
    assert.equal(result.counts, null);
    assert.equal(result.directProofSignalSats, null);
    assert.ok(db.calls.some(({ sql }) => sql === "ROLLBACK"));
    assert.equal(db.released(), true);
  }
  const db = database([transaction()]);
  const result = await readBoostGrowthObservation(db.pool, "livenet", checkpoint, async () => ({
    ...(await loadSnapshot()), snapshot_id: "another-snapshot",
  }));
  assert.equal(result.ready, false);
});

test("optional loader bounds waiting, coalesces one scan, and caches only the exact checkpoint", async () => {
  const pending = [];
  const loader = createBoostGrowthObservationLoader(async (_network, requested) => new Promise((resolve) => {
    pending.push({ resolve, checkpoint: requested });
  }), { waitMs: 5 });
  const first = loader("livenet", checkpoint);
  const second = loader("livenet", checkpoint);
  const other = { ...checkpoint, blockHeight: checkpoint.blockHeight + 1, blockHash: "c".repeat(64) };
  assert.equal((await loader("livenet", other)).ready, false);
  assert.equal((await first).ready, false);
  assert.equal((await second).ready, false);
  assert.equal(pending.length, 1);
  const expected = observe([transaction()]);
  pending[0].resolve(expected);
  await new Promise((resolve) => setImmediate(resolve));
  assert.strictEqual(await loader("livenet", checkpoint), expected);
  const next = loader("livenet", other);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(pending.length, 2);
  pending[1].resolve({ ...expected, checkpoint: other });
  assert.equal((await next).checkpoint.blockHash, other.blockHash);
});

test("late pool acquisition is released after its bounded wait", async () => {
  let deliver;
  let released = false;
  const pool = { connect: () => new Promise((resolve) => { deliver = resolve; }) };
  const result = await readBoostGrowthObservation(pool, "livenet", checkpoint, loadSnapshot);
  assert.equal(result.ready, false);
  deliver({ release() { released = true; } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(released, true);
});

test("Boost observation is separate from canonical value skips and replay delta", async () => {
  const api = await readFile(new URL("../server/proof-api.mjs", import.meta.url), "utf8");
  const raw = await readFile(new URL("../server/work-amo-v5-raw.mjs", import.meta.url), "utf8");
  assert.match(api, /if \(BOOST_EVENT_KINDS\.has\(kind\)\) \{\s*continue;/u);
  assert.match(raw, /function evaluatePwb\(\)[\s\S]*?stateDelta: emptyStateDelta\(\)/u);
});
