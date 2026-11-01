import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { payments } from "bitcoinjs-lib";
import { WORK_TOKEN_ID } from "../work-units.mjs";

// Run the actual reader and all of its normalization/pagination functions.
// Only the PostgreSQL connection is substituted; fixtures are raw relational
// event rows, with no activity titles, descriptions or address aliases.
const readerUrl = new URL("./proof-index-reader.mjs", import.meta.url);
const require = createRequire(readerUrl);
const source = readFileSync(readerUrl, "utf8");
assert.equal(source.split("function proofIndexPool() {").length, 2);
const isolatedSource = source
  .replace(/from (["'])([^"']+)\1/gu, (_match, quote, specifier) => {
    const resolved = specifier.startsWith(".") ? new URL(specifier, readerUrl).href
      : specifier.startsWith("node:") ? specifier : pathToFileURL(require.resolve(specifier)).href;
    return `from ${quote}${resolved}${quote}`;
  })
  .replace("function proofIndexPool() {", "function proofIndexPool() {\n  if (historyTestPool) return historyTestPool;")
  + "\nlet historyTestPool; export function setHistoryTestPool(pool) { historyTestPool = pool; }\n"
  + "export { exactHistoryEventItemsFromRows };\n";
const reader = await import(`data:text/javascript;base64,${Buffer.from(isolatedSource).toString("base64")}`);
const TXID = "b25" + "a".repeat(61), HASH = "b".repeat(64);
const TIME = "2026-10-31T12:00:00.000Z", SNAPSHOT = "verified-transfer-history";
const address = index => {
  const hash = Buffer.alloc(20); hash.writeUInt32BE(index + 1);
  return payments.p2pkh({ hash }).address;
};
const sender = address(100), registry = address(101);

function fixture(count = 12) {
  const base = { tokenId: WORK_TOKEN_ID, ticker: "WORK", txid: TXID, protocol: "pwt1",
    network: "livenet", confirmed: true, valid: true, senderAddress: sender,
    amountStorageModel: "work-subatoms-v2", decimals: 16, unitScale: "10000000000000000",
    amountVersion: "batch1", transferVersion: "batch1", createdAt: TIME,
    blockHeight: 974041, blockIndex: 3, blockHash: HASH, protocolVout: 12 };
  const parent = { ...base, kind: "token-transfer-batch", recipientCount: count,
    registryAddress: registry, amount: "0.12", amountSubatoms: String(BigInt(count) * 100000000000000n),
    totalAmountSubatoms: String(BigInt(count) * 100000000000000n),
    paidSats: 546, registryMutationFeeSats: 546, minerFeeSats: 1000, recordOrdinal: 0,
    payload: "pwt1:batch1:retained-wire-evidence", recipients: Array.from({ length: count }, (_, index) =>
      ({ recipientAddress: address(index), amountSubatoms: "100000000000000" })) };
  const children = parent.recipients.map((recipient, index) => ({ ...base, ...recipient,
    kind: "token-transfer", amount: "0.01", batchRecipientIndex: index, batchRecipientCount: count,
    batchTotalAmountSubatoms: parent.totalAmountSubatoms, recordOrdinal: index + 1,
    paidSats: 0, registryMutationFeeSats: 0, minerFeeSats: 0, canonicalMinerFeeSats: 1000,
    amountSats: 0, derived: true, rawCandidate: false, economicDelta: false,
    chargesTransactionFee: false, claimsEconomicOutputs: false,
    workAmoV5ReplayRawWitness: { model: "canonical-work-amo-v5-derived-child-v1", descriptor: recipient },
    parentTransitionChainCommitmentAfter: { model: "retained-commitment", sha256: "c".repeat(64) } }));
  return [parent, ...children].map((payload, index) => ({ payload,
    event_id: 5056403 + index, txid: TXID, protocol: "pwt1", kind: payload.kind,
    status: "confirmed", event_time: TIME, block_time: TIME, created_at: TIME,
    block_height: 974041, block_index: 3, op_return_vout: 12, record_ordinal: index,
    transaction_status: "confirmed", transaction_block_height: 974041,
    transaction_block_index: 3, block_hash: HASH, canonical_block_hash: HASH,
    canonical_position_required: true })).reverse();
}

async function history(rows, options = {}) {
  const calls = [];
  reader.setHistoryTestPool({ async query(sql, params) {
    calls.push({ sql, params });
    if (sql.includes("FROM proof_indexer.ledger_snapshots")) return { rows: [{
      snapshot_id: SNAPSHOT, indexed_through_block: 974068, generated_at: TIME, log_summary_indexed_at: TIME,
    }] };
    assert.match(sql, /WITH matched_events AS/u);
    assert.match(sql, /e\.valid = true/u);
    assert.match(sql, /e\.updated_at <= \$4::timestamptz/u);
    assert.match(sql, /canonical_event_block\.canonical = true/u);
    assert.equal(params.at(-2), TXID);
    return { rows: rows.slice(0, params.at(-1)) };
  } });
  const page = await reader.proofIndexLogHistoryPayload("livenet", "", new URLSearchParams({
    q: TXID, snapshot: SNAPSHOT, limit: "50", ...options,
  }), { currentRelational: true, includePending: false });
  assert.equal(calls.length, 2);
  assert.equal(page.snapshotId, SNAPSHOT);
  return page;
}

test("actual exact Log history projects all 12 raw recipients and their economic parent", async () => {
  const rows = fixture(), before = JSON.stringify(rows);
  const page = await history(rows);
  assert.equal(page.totalCount, 13);
  assert.deepEqual(page.items.map(item => item.eventId), rows.map(row => row.event_id));
  const children = page.items.filter(item => item.kind === "token-transfer");
  assert.equal(children.length, 12);
  for (const item of children) {
    const raw = rows.find(row => row.event_id === item.eventId).payload;
    assert.equal(item.title, "Credit transfer");
    assert.equal(item.actor, sender); assert.equal(item.counterparty, raw.recipientAddress);
    assert.match(item.description, /^0\.01 WORK transferred from /u);
    assert.ok(item.description.includes(raw.recipientAddress.slice(0, 8)));
    assert.ok(item.description.includes(raw.recipientAddress.slice(-8)));
    assert.ok(item.detail.endsWith(`Recipient ${raw.batchRecipientIndex + 1} of 12`));
    assert.ok(item.tags.includes("0.01 WORK"));
    for (const field of ["amount", "amountSubatoms", "paidSats", "registryMutationFeeSats", "minerFeeSats",
      "canonicalMinerFeeSats", "amountSats", "recordOrdinal", "protocolVout", "economicDelta",
      "chargesTransactionFee", "claimsEconomicOutputs", "workAmoV5ReplayRawWitness", "parentTransitionChainCommitmentAfter"]) {
      assert.deepEqual(item[field], raw[field], field);
    }
  }
  const parent = page.items.find(item => item.kind === "token-transfer-batch");
  assert.equal(parent.title, "WORK batch transfer");
  assert.match(parent.description, /^0\.12 WORK transferred .* to 12 recipients in one atomic transfer\.$/u);
  assert.equal(parent.actor, sender); assert.equal(parent.counterparty, registry);
  assert.equal(parent.paidSats, 546); assert.equal(parent.minerFeeSats, 1000);
  assert.equal(JSON.stringify(rows), before);
  // The canonical membership reader used by bounded unfiltered pages shares
  // the same actual row normalization, rather than a rich-item test stub.
  assert.deepEqual(reader.exactHistoryEventItemsFromRows(rows, "livenet"), page.items);
});

test("actual Log history preserves Q16 precision below one atom and above Number's exact integer range", async () => {
  for (const [subatoms, amount] of [["1", "0.0000000000000001"],
    ["900719925474099312345678901", "90071992547.4099312345678901"]]) {
    const [row] = fixture();
    Object.assign(row.payload, { amountSubatoms: subatoms, amount });
    const [item] = (await history([row])).items;
    assert.ok(item.description.startsWith(`${amount} WORK transferred`));
    assert.ok(item.tags.includes(`${amount} WORK`));
    assert.equal(item.amountSubatoms, subatoms); assert.equal(item.amount, amount);
  }
});

test("legacy Q8, non-WORK units and pending status retain their own meaning", async () => {
  const [row] = fixture();
  delete row.payload.amountSubatoms;
  Object.assign(row.payload, { amount: "0.00000777", amountAtoms: "777", amountStorageModel: "work-atoms-v1",
    decimals: 8, unitScale: "100000000", amountVersion: "send", transferVersion: "send" });
  assert.match((await history([row])).items[0].description, /^0\.00000777 WORK transferred/u);
  Object.assign(row.payload, { tokenId: "d".repeat(64), ticker: "POWB", amount: "900719925474099312345" });
  assert.match((await history([row])).items[0].description, /^900719925474099312345 POWB transferred/u);
  const pending = reader.normalizeHistoryEventItem({ ...row.payload, status: "pending" }, "livenet");
  assert.equal(pending.title, "Credit transfer pending");
  assert.equal(pending.confirmed, false); assert.ok(pending.tags.includes("Pending"));
});

test("existing rich copy, incomplete amounts and encrypted Mail are never replaced with invented details", () => {
  const raw = fixture()[0].payload;
  const rich = reader.normalizeHistoryEventItem({ ...raw, title: "Existing title", description: "Existing description",
    detail: "Existing detail", actor: sender, counterparty: raw.recipientAddress, tags: ["Custom"] }, "livenet");
  assert.equal(rich.title, "Existing title"); assert.equal(rich.description, "Existing description");
  assert.equal(rich.detail, "Existing detail"); assert.ok(rich.tags.includes("Custom"));
  const incomplete = { ...raw, amountSubatoms: undefined, amount: undefined };
  const generic = reader.normalizeHistoryEventItem(incomplete, "livenet");
  assert.equal(generic.title, "Token Transfer confirmed");
  assert.ok(!generic.tags.includes("0 WORK"));
  const encrypted = { ...raw, kind: "mail", title: "Encrypted mail", description: "Encrypted content",
    ciphertext: "unchanged-encrypted-payload", mailEnvelope: { encrypted: true }, detail: "Private message" };
  const mail = reader.normalizeHistoryEventItem(encrypted, "livenet");
  for (const field of ["title", "description", "detail", "ciphertext", "mailEnvelope"]) {
    assert.deepEqual(mail[field], encrypted[field]);
  }
  assert.equal(mail.actor, undefined); assert.equal(mail.counterparty, undefined);
  assert.equal(reader.normalizeHistoryEventItem({ ...raw, valid: false }, "livenet", { publicOnly: true }), null);
});
