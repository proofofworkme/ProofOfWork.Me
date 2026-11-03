import assert from "node:assert/strict";

const txid = "f2a4543e7a18ce1a6ed232c35a3ac03d99be05e603b738c2daf9865b01adb3f3";
const base = process.env.POW_API_BASE || "https://computer.proofofwork.me";
async function read(path, host = base) {
  const response = await fetch(new URL(path, host), {
    cache: "no-store", redirect: "error", signal: AbortSignal.timeout(45_000),
  });
  assert.equal(response.status, 200, path);
  return response.json();
}

const before = await read("/health");
assert.equal(before.ready, true);
const tip = before.checks.node;
const snapshot = before.checks.index.summarySnapshot;
assert.equal(snapshot.ok, true);
assert.equal(snapshot.blockHash, tip.bestBlockHash);
const log = process.env.POW_API_BASE || "https://log.proofofwork.me";
const summary = await read("/api/v1/log-summary?network=livenet&fresh=1", log);
assert.equal(summary.snapshotId, snapshot.snapshotId);
assert.equal(summary.indexedThroughBlockHash, tip.bestBlockHash);
const [status, history] = await Promise.all([
  read(`/api/v1/tx/${txid}/status?network=livenet`),
  read(`/api/v1/log-history?network=livenet&q=${txid}&limit=20&snapshot=${snapshot.snapshotId}`, log),
]);
assert.equal(status.status, "confirmed");
assert.equal(status.blockHeight, 974414);
assert.equal(history.snapshotId, summary.snapshotId);
const mail = history.items.filter(row => row.txid === txid && row.kind === "mail");
assert.equal(mail.length, 1);
assert.equal(mail[0].confirmed, true);
assert.equal(mail[0].blockHash, status.blockHash);
assert.equal(mail[0].protocolVout, 11);
assert.equal(mail[0].memo, "rf");
assert.deepEqual(mail[0].recipients.map(({ vout, amountSats }) => [vout, String(amountSats)]),
  Array.from({ length: 11 }, (_, index) => [index, "1034"]));
assert.equal(String(mail[0].amountSats), "11374");
const after = await read("/health");
assert.equal(after.ready, true);
assert.equal(after.checks.index.summarySnapshot.snapshotId, snapshot.snapshotId,
  "The published observation changed during verification. Repeat at a stable checkpoint.");
console.log(JSON.stringify({ ok: true, snapshotId: snapshot.snapshotId, height: tip.tipHeight,
  pendingPublicActions: summary.stats.pending, txid, confirmedMailActions: mail.length, recipients: mail[0].recipients.length }));
