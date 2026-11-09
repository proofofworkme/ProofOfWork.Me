import assert from "node:assert/strict";

const incidentBatches = [
  "0bb04cc303f1ac2b68db93fd769f3b3dbd4368b5472030148b0956899302785e",
  "2ba09b2fd5ec3b38b32350530868e43ac9a8fcc55b6ff95d06986e0a4143333f",
  "4d73d28338baab56c9295e365d24bc8c536477855d3a5ba290aac35cb49ff653",
  "5773d2baa8248ff723085e914a35accc1989b005bd54c9ac3332977dec7da168",
];
async function read(host, path) {
  const url = new URL(path, process.env.POW_API_BASE || `https://${host}.proofofwork.me`);
  const response = await fetch(url, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(120_000) });
  assert.equal(response.status, 200, `${url.host}${url.pathname} returned ${response.status}`);
  return response.json();
}
const health = await read("computer", "/health");
const { bestBlockHash: hash, tipHeight: height } = health.checks.node;
const summary = health.checks.index.summarySnapshot;
assert.equal(health.ready, true);
assert.equal(summary.ok, true);
assert.equal(summary.blockHash, hash);
assert.equal(Object.keys(summary.coverageByKey).length, 8);
assert.ok(Object.values(summary.coverageByKey).every(h => h === height));
for (const txid of incidentBatches) {
  const params = new URLSearchParams({ network: "livenet", q: txid, snapshot: summary.snapshotId, limit: "257" });
  const history = await read("log", "/api/v1/log-history?" + params);
  assert.equal(history.snapshotId, summary.snapshotId);
  assert.equal(history.items.length, 257);
  assert.ok(history.items.every(item => item.txid === txid && item.blockHeight === 974919 && item.confirmed));
  const parents = history.items.filter(item => item.kind === "token-transfer-batch");
  assert.equal(parents.length, 1);
  const [parent] = parents;
  assert.equal(parent.paidSats, 546);
  assert.equal(parent.recipients.length, 256);
  const children = history.items.filter(item => item.kind === "token-transfer");
  assert.equal(children.length, 256);
  assert.equal(new Set(children.map(item => item.batchRecipientIndex)).size, 256);
  for (const child of children) {
    const expected = parent.recipients[child.batchRecipientIndex];
    assert.equal(child.recipientAddress, expected.recipientAddress);
    assert.equal(child.amountSubatoms, expected.amountSubatoms);
    assert.equal(child.economicDelta, false);
    assert.equal(child.minerFeeSats, 0);
    assert.equal(child.registryMutationFeeSats, 0);
  }
}
const readers = {};
for (const [product, path, collection] of [
  ["permission", "permissions", "permissions"], ["code", "code-repositories", "repositories"], ["jobs", "jobs", "jobs"],
]) {
  for (const host of process.env.POW_API_BASE ? [product] : [product, "computer"]) {
    const page = await read(host, `/api/v1/${path}?network=livenet&limit=30`);
    assert.equal(page.complete, true);
    assert.equal(page.indexedThroughBlockHash, hash);
    assert.equal(page.indexedThroughBlock, height);
    assert.ok(Array.isArray(page[collection]) && page[collection].length > 0);
    if (readers[product]) assert.equal(page.snapshotId, readers[product].snapshotId);
    readers[product] = { snapshotId: page.snapshotId, count: page[collection].length };
  }
}
const closing = await read("computer", "/health");
assert.equal(closing.ready, true);
assert.equal(closing.checks.node.bestBlockHash, hash, "Core advanced during verification. Repeat at a stable tip.");
console.log(JSON.stringify({ ok: true, height, hash, snapshotId: summary.snapshotId, parents: 4, recipients: 1024, readers }));
