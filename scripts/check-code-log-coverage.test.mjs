import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as bitcoin from "bitcoinjs-lib";
import {
  PUBLIC_LOG_EVENT_KINDS, normalizeHistoryEventItem,
} from "../server/db/proof-index-reader.mjs";
import {
  encodeCodeRepository, verifyCodeTransaction,
} from "../src/shared/protocol/codeRepository.mjs";

function isolatedFunction(path, name, dependencies) {
  const text = readFileSync(new URL(path, import.meta.url), "utf8");
  const ast = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const declaration = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.ok(declaration, `Missing actual source function ${name}`);
  const source = declaration.getText(ast).replace(/^export\s+/u, "");
  return vm.runInNewContext(`(${source})`, { ...dependencies, URLSearchParams, Buffer });
}

function workerLogKinds() {
  const path = "../scripts/backfill-proof-indexer.mjs";
  const text = readFileSync(new URL(path, import.meta.url), "utf8");
  const ast = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  for (const statement of ast.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    const declaration = statement.declarationList.declarations.find(node => node.name.getText(ast) === "PUBLIC_LOG_EVENT_KINDS");
    if (declaration) return vm.runInNewContext(declaration.initializer.getText(ast));
  }
  assert.fail("Missing actual worker public Log membership");
}

const readerPath = "../server/db/proof-index-reader.mjs";
const txid = "02da093cb127fe152af0305cccbe12ceaaa52c2a57a151c84cc979e78b8bed98";
const checkpointHash = "a".repeat(64);
const position = { blockHeight: 970493, blockIndex: 3283, blockHash: checkpointHash, recordOrdinal: 0 };
const mail = { ...position, eventId: 4738014, txid, protocol: "pwm1", kind: "mail",
  protocolVout: 1, valid: true, status: "confirmed", amountSats: 546, createdAt: "2026-10-08T00:00:00.000Z" };
const code = { ...position, eventId: 4738015, txid, protocol: "pwc1", kind: "code-repository",
  protocolVout: 2, valid: true, status: "confirmed", amountSats: "0", selfPaymentSats: "546",
  createdAt: mail.createdAt, title: "Audited repository" };

test("Code repository and commit render beside their Mail carrier with exact identity and no new payment", () => {
  const visible = [mail, code].map(item => normalizeHistoryEventItem(item, "livenet", { publicOnly: true }));
  assert.equal(visible.length, 2);
  assert.ok(visible.every(Boolean));
  assert.deepEqual(visible.map(item => item.eventId), [4738014, 4738015]);
  assert.deepEqual(visible.map(item => item.protocolVout), [1, 2]);
  assert.equal(visible[1].txid, txid);
  assert.equal(visible[1].blockHash, checkpointHash);
  assert.equal(visible.reduce((sum, item) => sum + BigInt(item.amountSats), 0n), 546n);
  const commit = normalizeHistoryEventItem({ ...code, kind: "code-commit" }, "livenet", { publicOnly: true });
  assert.equal(commit.kind, "code-commit");
  assert.equal(commit.amountSats, "0");
});

test("Code status remains provisional in mempool and invalid candidates remain outside the public Log", () => {
  const pending = normalizeHistoryEventItem({ ...code, status: "pending", confirmed: true }, "livenet", { publicOnly: true });
  assert.equal(pending.confirmed, false);
  assert.equal(pending.confirmationStatus, "pending");
  assert.ok(pending.tags.includes("Pending"));
  assert.ok(!pending.tags.includes("Confirmed"));
  assert.equal(normalizeHistoryEventItem({ ...code, valid: false }, "livenet", { publicOnly: true }), null);
  assert.equal(normalizeHistoryEventItem({ ...code, kind: "code-unknown" }, "livenet", { publicOnly: true }), null);
  assert.equal(normalizeHistoryEventItem({ ...code, valid: false }, "livenet").valid, false);
});

test("Worker Log fingerprint covers the same Code kinds and changes when same-height pending Code membership changes", async () => {
  const kinds = workerLogKinds();
  assert.deepEqual(Array.from(kinds).sort(), Array.from(PUBLIC_LOG_EVENT_KINDS).sort());
  const pending = { ...code, eventId: 4738016, kind: "code-commit", status: "pending", blockHeight: null };
  let selected = [mail, code, pending]; const reads = [];
  const run = isolatedFunction("../scripts/backfill-proof-indexer.mjs", "publicLogRelationalFingerprint", {
    NETWORK: "livenet", PUBLIC_LOG_EVENT_KINDS: kinds, createHash,
  });
  const client = { async query(sql, params) {
    reads.push({ sql, params });
    assert.ok(params[1].includes("code-repository"));
    assert.ok(params[1].includes("code-commit"));
    return { rows: selected.map(item => ({ event_id: item.eventId, txid: item.txid, protocol: item.protocol,
      kind: item.kind, valid: item.valid, status: item.status, block_height: item.blockHeight,
      payload_hash: createHash("md5").update(JSON.stringify(item)).digest("hex") })) };
  } };
  const before = await run(client);
  assert.equal(before.count, 3); assert.equal(before.pending, 1);
  selected = [mail, code]; const after = await run(client);
  assert.equal(after.count, 2); assert.equal(after.pending, 0);
  assert.notEqual(before.hash, after.hash);
  assert.match(reads[0].sql, /e\.valid = true/u);
  assert.match(reads[0].sql, /e\.kind = ANY\(\$2::text\[\]\)/u);
});

test("Actual narrow Log txid query includes both Code kinds and retains its snapshot and validity fences", async () => {
  const reads = [];
  const run = isolatedFunction(readerPath, "proofIndexLogHistoryPayload", {
    PUBLIC_LOG_EVENT_KINDS,
    WORK_AMO_V5_ACTIVATION_HEIGHT: 959621,
    proofIndexPool: () => ({ async query(sql, params) {
      reads.push({ sql, params });
      assert.ok(params[1].includes("code-repository"));
      assert.ok(params[1].includes("code-commit"));
      return { rows: [mail, code].filter(item => params[1].includes(item.kind)) };
    } }),
    proofIndexLogHistoryReadEligibility: () => ({ pagination: { limit: 5, offset: 0, query: txid, snapshotId: "verified" } }),
    normalizedTxid: value => /^[0-9a-f]{64}$/u.test(value) ? value : "",
    ledgerSnapshotMetadata: async () => ({ snapshot_id: "verified", indexed_through_block: 970633,
      generated_at: "2026-10-09T09:00:00.000Z" }),
    indexedThroughBlockFromItems: () => 970493,
    dateIso: value => value,
    rowNumber: (row, key) => Number(row?.[key]) || 0,
    normalizeHistoryEventRows: (rows, network, options) => rows.map(row => normalizeHistoryEventItem(row, network, options)),
    logHistoryPageFromItems: options => ({ items: options.items, totalCount: options.items.length, snapshotId: options.snapshot.snapshot_id }),
  });
  const result = await run("livenet", "", new URLSearchParams({ q: txid }), { includePending: false });
  assert.deepEqual(result.items.map(item => item.eventId), [4738014, 4738015]);
  assert.equal(result.snapshotId, "verified");
  assert.equal(reads.length, 1);
  assert.match(reads[0].sql, /WITH matched_events AS/u);
  assert.match(reads[0].sql, /proof_indexer\.event_refs/u);
  assert.match(reads[0].sql, /e\.valid = true/u);
  assert.match(reads[0].sql, /e\.status = 'confirmed'/u);
  assert.match(reads[0].sql, /e\.updated_at <= \$4::timestamptz/u);
  assert.match(reads[0].sql, /canonical_event_block\.canonical = true/u);
  assert.equal(reads[0].params[2], 970633);
  assert.equal(reads[0].params[4], txid);
});

test("Actual Code ingestion preserves the carrier payment separately and adds zero economic amount", () => {
  const owner = "bc1qfwytlzyr3ym3enz2eutwtjsf9kkf6uqkjydk3e";
  const carrier = encodeCodeRepository({ v: 1, name: "Audit", description: "Exact Code visibility" });
  const opReturn = text => ({ value: 0, scriptpubkey: Buffer.from(bitcoin.script.compile([
    bitcoin.opcodes.OP_RETURN, Buffer.from(text),
  ])).toString("hex") });
  const payment = { value: 546, scriptpubkey: Buffer.from(bitcoin.address.toOutputScript(owner)).toString("hex") };
  const tx = { txid, vin: [{ prevout: payment }], vout: [payment, opReturn("pwm1:m:Repository"), opReturn(carrier)] };
  const run = isolatedFunction("../scripts/backfill-proof-indexer.mjs", "protocolItemsFromTx", {
    bitcoin, NETWORK: "livenet", createHash, verifyCodeTransaction,
    // Core amount decoding is outside this fixture; values here are exact proofs.
    exactCodeOutputProofs: item => String(item.value),
    baseProtocolItem: () => ({ ...position, confirmed: true, txid }),
  });
  const items = run(tx, { prefix: "pwc1:", text: carrier, voutIndex: 2 });
  assert.equal(items.length, 1);
  assert.equal(items[0].valid, true);
  assert.equal(items[0].kind, "code-repository");
  assert.equal(items[0].protocolVout, 2);
  assert.equal(items[0].amountSats, "0");
  assert.equal(items[0].selfPaymentSats, "546");
  assert.equal(items[0].dataBytes, 0);
});
