import assert from "node:assert/strict";

const base = process.env.POW_API_BASE || "https://computer.proofofwork.me";
const batchTxid = "a4061d7a0b6051b0f1e44b706606951c168a80e94d3e877aadc95ee95a97d13a";

async function read(host, path) {
  const url = new URL(path, process.env.POW_API_BASE || `https://${host}.proofofwork.me`);
  const response = await fetch(url, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(60_000) });
  assert.equal(response.status, 200, `${url.host}${url.pathname} returned ${response.status}`);
  return response.json();
}

const health = await read("computer", "/health");
assert.equal(health.ready, true);
const tipHash = health.checks.node.bestBlockHash;
const snapshot = health.checks.index.summarySnapshot;
assert.equal(snapshot.ok, true);
assert.equal(snapshot.blockHash, tipHash);
assert.equal(Object.keys(snapshot.coverageByKey).length, 8);
assert.ok(Object.values(snapshot.coverageByKey).every(height => height === health.tipHeight));

function checkTip(payload) {
  assert.equal(payload.indexedThroughBlock, health.tipHeight);
  assert.equal(payload.indexedThroughBlockHash, tipHash);
  assert.equal(payload.derivedFromSnapshotId || payload.snapshotId, snapshot.snapshotId);
}

for (const [host, route] of [["log", "log"], ["growth", "growth"], ["work", "work"],
  ["amo", "marketplace"], ["credit", "token"], ["computer", "log"]]) {
  const summary = await read(host, `/api/v1/${route}-summary?network=livenet&fresh=1&compact=1`);
  checkTip(summary);
  if (route === "log") continue;
  const token = route === "token" ? summary : summary.token;
  assert.deepEqual(token.transferBatches, [], `${host} copied full batch history into its preview`);
  assert.equal(token.collectionHasMore.transferBatches, true, host);
}

// The confirmed incident transaction has one paid parent and 161 zero-fee recipients.
const params = new URLSearchParams({ network: "livenet", q: batchTxid, limit: "257", snapshot: snapshot.snapshotId });
const page = await read("log", `/api/v1/log-history?${params}`);
checkTip(page);
const records = page.items.filter(row => row.txid === batchTxid);
assert.equal(records.length, 162);
assert.ok(records.every(row => row.txid === batchTxid && row.blockHeight === 974404 && row.confirmed === true));
const parents = records.filter(row => row.kind === "token-transfer-batch");
assert.equal(parents.length, 1);
const [parent] = parents;
assert.equal(parent.paidSats, 546);
assert.equal(parent.batchRegistryPaymentSats, 546);
assert.equal(parent.amountSubatoms, "12509700000000");
assert.equal(parent.recipients.length, 161);
const children = records.filter(row => row.kind === "token-transfer");
assert.equal(children.length, 161);
assert.equal(new Set(children.map(row => row.batchRecipientIndex)).size, 161);
for (const child of children) {
  const recipient = parent.recipients[child.batchRecipientIndex];
  assert.equal(recipient.recipientAddress, child.recipientAddress);
  assert.equal(recipient.amountSubatoms, child.amountSubatoms);
  assert.equal(child.economicDelta, false);
  assert.equal(child.registryMutationFeeSats, 0);
  assert.equal(child.minerFeeSats, 0);
}
const after = await read("computer", "/health");
assert.equal(after.ready, true);
assert.equal(after.checks.node.bestBlockHash, tipHash, "Core advanced during verification. Repeat at a stable checkpoint.");
console.log(JSON.stringify({ ok: true, base, tipHeight: health.tipHeight, snapshotId: snapshot.snapshotId, batchTxid, recipients: children.length }));
