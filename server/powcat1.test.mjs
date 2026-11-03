import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { opcodes, script, Transaction } from "bitcoinjs-lib";
import {
  encodePowcatManifest, encodePowcatPart, parsePowcatTransaction, powcatScript,
  powcatSha256, resolvePowcatFile, POWCAT_MAX_FILE_BYTES, POWCAT_MAX_PART_BYTES, POWCAT_MAX_PARTS,
} from "../src/shared/protocol/powcat1.mjs";

const blockHash = "be".repeat(32);
const hash = bytes => createHash("sha256").update(bytes).digest("hex");

function txWith(payload, configure = () => {}) {
  const tx = new Transaction();
  tx.addInput(Buffer.alloc(32, 1), 0);
  tx.addOutput(powcatScript(payload), 0n);
  configure(tx);
  return { txid: tx.getId(), hex: tx.toHex() };
}

function publication(size, chunkBytes) {
  const original = Buffer.alloc(size);
  for (let i = 0; i < size; i++) original[i] = i % 256;
  const fileHash = hash(original);
  const count = Math.ceil(size / chunkBytes);
  const store = new Map();
  const partTxids = [];
  for (let index = 0; index < count; index++) {
    const bytes = original.subarray(index * chunkBytes, (index + 1) * chunkBytes);
    const part = txWith(encodePowcatPart({ fileHash, index, count, bytes }));
    partTxids.push(part.txid);
    store.set(part.txid, { hex: part.hex, blockHash, blockHeight: 20 });
  }
  const manifest = { name: "Δ.bin", mime: "application/octet-stream", size, fileHash, partTxids };
  function addRoot(overrides = {}) {
    const root = txWith(encodePowcatManifest({ ...manifest, ...overrides }));
    store.set(root.txid, { hex: root.hex, blockHash: "cd".repeat(32), blockHeight: 21 });
    return root.txid;
  }
  return { original, store, manifest, addRoot, rootTxid: addRoot(),
    resolve: txid => resolvePowcatFile(txid, async id => store.get(id)) };
}

test("part and manifest bytes match independent canonical wire vectors", () => {
  const bytes = Buffer.from([0, 0xff, 0x80]);
  const fileHash = hash(bytes);
  const part = encodePowcatPart({ fileHash, index: 0, count: 1, bytes });
  assert.equal(Buffer.from(part).toString("hex"),
    Buffer.from("powcat1:p").toString("hex") + fileHash + "0001" + fileHash + "00ff80");
  assert.equal(powcatSha256(bytes), fileHash);
  const partTxid = "0123456789abcdef".repeat(4);
  const manifest = encodePowcatManifest({ fileHash, size: 3, name: "á", mime: "x/y", partTxids: [partTxid] });
  assert.equal(Buffer.from(manifest).toString("hex"),
    Buffer.from("powcat1:m").toString("hex") + fileHash + "00000003010203c3a1782f79" + partTxid);
});

test("maximum decimal 4 MB file round trips arbitrary binary and 96,000-byte PUSHDATA4 parts", async () => {
  const { original, resolve, manifest, rootTxid, store } = publication(POWCAT_MAX_FILE_BYTES, POWCAT_MAX_PART_BYTES);
  assert.equal(manifest.partTxids.length, 42);
  assert.equal(Transaction.fromHex(store.get(manifest.partTxids[0]).hex).outs[0].script[1], opcodes.OP_PUSHDATA4);
  const file = await resolve(rootTxid);
  assert.deepEqual(Buffer.from(file.bytes), original);
  assert.deepEqual(file.partTxids, manifest.partTxids);
  assert.equal(file.name, manifest.name);
  assert.equal(file.txid, rootTxid);
});

test("accept all 67 distinct part references at the allowed fanout", async () => {
  const { original, resolve, rootTxid, manifest } = publication(POWCAT_MAX_PARTS, 1);
  assert.equal(manifest.partTxids.length, 67);
  assert.deepEqual(Buffer.from((await resolve(rootTxid)).bytes), original);
});

test("reject impossible sizes, duplicate references, excess fanout and invalid metadata", () => {
  const { manifest } = publication(10, 5);
  const bad = [
    { size: 0 }, { size: 1 }, { size: POWCAT_MAX_PART_BYTES * 2 + 1 }, { size: POWCAT_MAX_FILE_BYTES + 1 },
    { partTxids: [manifest.partTxids[0], manifest.partTxids[0]] },
    { partTxids: Array.from({ length: 68 }, (_, i) => hash(String(i))) }, { partTxids: [] },
    { name: "a/b" }, { name: ".." }, { name: "x\u0000" }, { name: "\ud800" }, { name: "Δ".repeat(128) },
    { mime: "text/html; bad" }, { fileHash: "broken" },
  ];
  for (const item of bad) assert.throws(() => encodePowcatManifest({ ...manifest, ...item }));
  for (const bytes of [new Uint8Array(0), new Uint8Array(POWCAT_MAX_PART_BYTES + 1)]) {
    assert.throws(() => encodePowcatPart({ fileHash: manifest.fileHash, count: 1, index: 0, bytes }));
  }
});

test("reject altered pushes, hashes, trailing data, multiple OP_RETURNs, a nonzero carrier or overweight transaction", () => {
  const bytes = Buffer.from([3]);
  const input = encodePowcatPart({ fileHash: hash(bytes), index: 0, count: 1, bytes });
  function rejects(payload, configure) {
    const { hex, txid } = txWith(payload, configure);
    assert.throws(() => parsePowcatTransaction(hex, txid));
  }
  const corrupted = Buffer.from(input);
  corrupted[corrupted.length - 1] ^= 1;
  rejects(corrupted);
  rejects(input, tx => { tx.outs[0].value = 1n; });
  rejects(input, tx => { tx.addOutput(Uint8Array.of(opcodes.OP_RETURN), 0n); });
  rejects(input, tx => { tx.outs[0].script = script.compile([opcodes.OP_RETURN, input.slice(0, 71), input.slice(71)]); });
  rejects(input, tx => { tx.outs[0].script = Buffer.concat([Buffer.from([opcodes.OP_RETURN, opcodes.OP_PUSHDATA2, input.length, 0]), input]); });
  rejects(input, tx => { tx.ins[0].script = Buffer.alloc(100000); });
  const { manifest } = publication(1, 1);
  const root = encodePowcatManifest(manifest);
  rejects(Buffer.concat([root, Buffer.from([0])]));
  rejects(root.subarray(0, root.length - 1));
  const tx = txWith(input);
  assert.throws(() => parsePowcatTransaction(tx.hex, "ab".repeat(32)), /TXID mismatch/);
  // Nonminimal CompactSize input counts deserialize to the same transaction
  // object. The byte stream must still match the canonical serialization.
  const overlong = tx.hex.slice(0, 8) + "fd0100" + tx.hex.slice(10);
  assert.throws(() => parsePowcatTransaction(overlong, tx.txid));
});

test("a root resolves only exact confirmed earlier siblings, their order, count, commitment and bytes", async () => {
  const { rootTxid, manifest, resolve, store, addRoot } = publication(11, 6);
  const [first, last] = manifest.partTxids;
  await assert.rejects(resolve(first), /not a manifest/);
  await assert.rejects(resolve(addRoot({ partTxids: [last, first] })), /part does not match/);
  await assert.rejects(resolve(addRoot({ partTxids: [first], size: 6 })), /part does not match/);
  await assert.rejects(resolve(addRoot({ fileHash: "ee".repeat(32) })), /part does not match/);
  await assert.rejects(resolve(addRoot({ size: 12 })), /file size or hash mismatch/);
  await assert.rejects(resolve(addRoot({ size: 10 })), /exceed declared/);
  await assert.rejects(resolve(addRoot({ partTxids: [rootTxid, last] })), /earlier block/);
  // Fabricate internally consistent parts that lie about their collective hash.
  const forged = [Buffer.from("first"), Buffer.from("second")].map((bytes, index) => {
    const part = txWith(encodePowcatPart({ fileHash: manifest.fileHash, index, count: 2, bytes }));
    store.set(part.txid, { hex: part.hex, blockHash, blockHeight: 20 });
    return part.txid;
  });
  await assert.rejects(resolve(addRoot({ partTxids: forged })), /file size or hash mismatch/);
  const evidence = store.get(first);
  store.set(first, { ...evidence, confirmed: false });
  await assert.rejects(resolve(rootTxid), /confirmed inclusion/);
  store.set(first, { ...evidence, blockHeight: 21 });
  await assert.rejects(resolve(rootTxid), /earlier block/);
  store.set(first, { ...evidence, hex: store.get(last).hex });
  await assert.rejects(resolve(rootTxid), /TXID mismatch/);
  store.delete(first);
  await assert.rejects(resolve(rootTxid), /confirmed inclusion/);
});
