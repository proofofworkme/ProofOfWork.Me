import assert from "node:assert/strict";
import test from "node:test";
import { Transaction } from "bitcoinjs-lib";
import { encodePowcatPart, encodePowcatManifest, powcatScript, powcatSha256 } from "../src/shared/protocol/powcat1.mjs";
import { powcatCandidateOutputs, powcatObservations, reconcilePowcatPending } from "./powcat-index.mjs";
import { proofIndexEventRefsForItem } from "./proof-index-event-relations.mjs";

const hash = "ab".repeat(32), parent = "cd".repeat(32);
const position = { blockHeight: 5, blockHash: hash, blockIndex: 1, blockTime: new Date(6000).toISOString() };
function carrier(payload, extra) {
  const tx = new Transaction();
  tx.addInput(Buffer.alloc(32, 2), 0);
  tx.addOutput(powcatScript(payload), 0n);
  if (extra) tx.addOutput(powcatScript(extra), 0n);
  tx.addOutput(Uint8Array.of(0x51), 29n);
  return { hex: tx.toHex(), txid: tx.getId(), vout: tx.outs.map(o => ({ scriptPubKey: { hex: Buffer.from(o.script).toString("hex") } })) };
}
const bytes = Uint8Array.of(0, 0xff, 0x7f);
const fileHash = powcatSha256(bytes);
const chunk = encodePowcatPart({ fileHash, index: 0, count: 1, bytes });
const part = carrier(chunk);
const linker = carrier(encodePowcatManifest({ fileHash, size: bytes.length, name: "binary.dat", mime: "application/octet-stream", partTxids: [part.txid] }));
async function rpc(method, params) {
  if (method === "getindexinfo") return { txindex: { synced: true, best_block_height: 6 } };
  if (method === "getrawtransaction") return { ...part, blockhash: parent, confirmations: 2 };
  if (method === "getblockheader") return { hash: parent, height: 4, confirmations: 2 };
  if (method === "getblockhash") return params[0] === 4 ? parent : hash;
  throw Error("Unexpected RPC");
}
test("binary part survives non-UTF8 and NUL; change, payload bytes and value stay out of the event", async () => {
  const [e] = await powcatObservations(part, position, rpc);
  assert.equal(e.valid, true);
  assert.equal(e.amountSats, 0);
  assert.equal(e.powcat.size, 3);
  assert.equal(e.powcat.partHash, fileHash);
  assert.equal(e.recipientAddress, undefined);
  assert.equal(e.powcat.bytes, undefined);
  assert.equal((await powcatObservations(carrier(chunk, chunk), position, rpc)).filter(x => x.valid).length, 0);
  const mixed = carrier(chunk, Buffer.from("pwm1:m:Legacy mail"));
  assert.deepEqual((await powcatObservations(mixed, position, rpc)).map(e => [e.kind,e.valid,e.amountSats]),
    [["powcat-part",false,0]]);
  assert.deepEqual(await powcatObservations(carrier(Buffer.from("pwm1:m:powcat1:p")), position, rpc), []);
  assert.equal(powcatCandidateOutputs(carrier(Buffer.from("unrelated-powcat1:p"))).length, 0);
});
test("linker valid only with exact earlier confirmed part and complete txindex at the target", async () => {
  assert.equal((await powcatObservations(linker, null, rpc))[0].valid, false);
  assert.equal((await powcatObservations(linker, position, rpc))[0].valid, true);
  const sameBlock = (method, args) => method === "getblockheader" ? { hash: parent, height: 5, confirmations: 2 } : rpc(method, args);
  await assert.rejects(powcatObservations(linker, position, sameBlock), /position changed/);
  const stale = (method, args) => method === "getindexinfo" ? { txindex: { synced: false } } : rpc(method, args);
  await assert.rejects(powcatObservations(linker, position, stale), /synchronized/);
  const missing = (method, args) => {
    if (method === "getrawtransaction") throw Object.assign(new Error("not found"), { rpcCode: -5 });
    return rpc(method, args);
  };
  assert.equal((await powcatObservations(linker, position, missing))[0].reason, "invalid-dependencies");
  const timeout = (method, args) => method === "getrawtransaction" ? Promise.reject(Error("timeout")) : rpc(method, args);
  await assert.rejects(powcatObservations(linker, position, timeout), /unavailable/);
  const wrongBytes = (method, args) => method === "getrawtransaction" ? {...part, hex:linker.hex,blockhash:parent,confirmations:2} : rpc(method, args);
  await assert.rejects(powcatObservations(linker, position, wrongBytes), /raw TXID differs/);
});
test("pending loss requires a fresh absence from mempool and indexed transaction lookup", async () => {
  const lookups = [], writes = [];
  const db = { query: async (...args) => args[0].startsWith("SELECT") ? { rows: [{txid:part.txid}] } : writes.push(args) };
  const gone = async (method) => {
    lookups.push(method);
    if (method === "getindexinfo") return {txindex:{synced:true,best_block_height:10}};
    if (method === "getblockcount") return 10;
    throw Object.assign(Error("absent"), {code:-5});
  };
  await reconcilePowcatPending(db, "regtest", {[part.txid]:{}}, gone);
  assert.deepEqual(lookups, []);
  await reconcilePowcatPending(db, "regtest", {}, gone);
  assert.deepEqual(lookups, ["getindexinfo","getblockcount","getmempoolentry","getrawtransaction"]);
  assert.equal(writes.length, 1);
});

test("Code can index a linked source TXID and digest without inventing an inline vout or monetary action", () => {
  const refs = proofIndexEventRefsForItem({ protocol: "pwc1", kind: "code-commit", path:"src/data.bin",
    metadata: { v:3, op:"reference", sourceKind:"powcat1", sourceTxid:linker.txid, sha256:fileHash } });
  assert(refs.some(r => r.refType === "source-txid" && r.refValue === linker.txid));
  assert(refs.some(r => r.refType === "source-sha256" && r.refValue === fileHash));
  assert(!refs.some(r => r.refType === "source-vout"));
});
