import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { Transaction } from "bitcoinjs-lib";
import { encodePowcatPart, encodePowcatManifest, powcatScript, powcatSha256 } from "../src/shared/protocol/powcat1.mjs";
import { createPowcatReader, powcatDownloadHeaders } from "./powcat-reader.mjs";

function fixture() {
  const bytes = Buffer.from([0, 0xff, 0xfe]);
  const fileHash = powcatSha256(bytes);
  const records = new Map();
  function publish(payload, height) {
    const tx = new Transaction();
    tx.addInput(Buffer.alloc(32, 1), 0);
    tx.addOutput(powcatScript(payload), 0n);
    const header = Buffer.alloc(80, height);
    const digest = createHash("sha256").update(header).digest();
    const blockhash = createHash("sha256").update(digest).digest().reverse().toString("hex");
    records.set(tx.getId(), { txid: tx.getId(), hex: tx.toHex(), blockhash, height, proof: header.toString("hex") + "01" });
    return tx.getId();
  }
  const part = publish(encodePowcatPart({ fileHash, index: 0, count: 1, bytes }), 4);
  const manifest = { fileHash, name: "x.html", mime: "text/html", partTxids: [part], size: bytes.length };
  const root = publish(encodePowcatManifest(manifest), 5);
  async function rpc(method, [value]) {
    const rows = [...records.values()];
    if (method === "getblockchaininfo") return { chain: "regtest", blocks: 5, bestblockhash: records.get(root).blockhash, initialblockdownload: false };
    if (method === "gettxoutproof") return records.get(value[0]).proof;
    if (method === "verifytxoutproof") return [rows.find(row => row.proof === value).txid];
    if (method === "getblockheader") return { hash: value, height: rows.find(row => row.blockhash === value).height, confirmations: 1 };
    if (method === "getrawtransaction") return records.get(value).hex;
    if (method === "getblockhash") return rows.find(row => row.height === value)?.blockhash;
    throw new Error("Unexpected RPC");
  }
  return { bytes, root, part, rpc, records };
}

test("serve exact binary content as a forced download after confirming the pinned checkpoint", async () => {
  const { bytes, root, rpc, records } = fixture();
  const file = await createPowcatReader({ chain: "regtest", rpc })(root);
  assert.deepEqual(Buffer.from(file.bytes), bytes);
  assert.equal(file.blockHeight, 5);
  assert.equal(file.blockHash, records.get(root).blockhash);
  const headers = powcatDownloadHeaders({ ...file, name: "Δ (file).html" });
  assert.equal(headers["Content-Type"], "application/octet-stream");
  assert.equal(headers["X-Content-Type-Options"], "nosniff");
  assert.equal(headers["Cache-Control"], "no-store");
  assert.match(headers["Content-Disposition"], /attachment;.*UTF-8''%CE%94%20%28file%29.html/u);
});

test("reject wrong chain, unproved membership, or a displaced dependency/checkpoint", async () => {
  const { root, rpc } = fixture();
  for (const [fault, result] of [
    ["getblockchaininfo", { chain: "main", blocks: 0 }],
    ["verifytxoutproof", []], ["getblockhash", "ff".repeat(32)],
  ]) {
    const read = createPowcatReader({ chain: "regtest", rpc: (m, args) => m === fault ? result : rpc(m, args) });
    await assert.rejects(read(root), err => [409, 503].includes(err.statusCode));
  }
  const read = createPowcatReader({ chain: "regtest", rpc: (method, args) => {
    if (method === "verifytxoutproof") throw Object.assign(new Error(), { code: -5 });
    return rpc(method, args);
  } });
  await assert.rejects(read(root), { statusCode: 409 });
});

test("bound concurrent reads, aborts and recovery after a failed request", async () => {
  const { root, rpc } = fixture();
  let resume;
  const wait = new Promise(resolve => { resume = resolve; });
  const read = createPowcatReader({ chain: "regtest", maxConcurrent: 1, rpc: async (m, args) => {
    await wait;
    return rpc(m, args);
  } });
  const controller = new AbortController();
  const first = read(root, { signal: controller.signal });
  await assert.rejects(read(root), { statusCode: 429 });
  controller.abort();
  resume();
  await assert.rejects(first, { statusCode: 503 });
  assert.equal((await read(root)).txid, root);
});
