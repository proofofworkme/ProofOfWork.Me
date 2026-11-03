#!/usr/bin/env node
// Use Node 24 and Core 30+ with wallet support. Point POWCAT_REGTEST_SCRATCH
// at the operator-approved scratch filesystem. Never connect to an existing node.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as wait } from "node:timers/promises";
import { Transaction, address as bitcoinAddress, networks } from "bitcoinjs-lib";
import { createPowcatJournal } from "../src/features/powcat/powcatJournal.mjs";
import { encodePowcatManifest, encodePowcatPart, powcatScript, powcatSha256 } from "../src/shared/protocol/powcat1.mjs";
import { buildPowcatMailAttachment, powcatPointerFromAttachment } from "../src/shared/protocol/powcatMail.mjs";
import { createPowcatReader } from "../server/powcat-reader.mjs";
import { canonicalRawProtocolRecordSetFromTransaction } from "../server/canonical-op-return.mjs";
import { parseWorkAmoV5PwmMessages } from "../server/work-amo-v5.mjs";

const scratch = process.env.POWCAT_REGTEST_SCRATCH;
assert(scratch, "Set POWCAT_REGTEST_SCRATCH to an approved test filesystem.");
const directory = await mkdtemp(join(scratch, "powcat-regtest-"));
const portReservation = createServer();
portReservation.listen(0, "127.0.0.1");
await once(portReservation, "listening");
const port = portReservation.address().port;
await new Promise(resolve => portReservation.close(resolve));

const proc = spawn(process.env.BITCOIND || "bitcoind", [
  "-regtest=1", `-datadir=${directory}`, "-conf=/dev/null", "-listen=0", "-connect=0", "-discover=0",
  "-listenonion=0", "-dnsseed=0", "-server=1", "-rpcbind=127.0.0.1", "-rpcallowip=127.0.0.1",
  `-rpcport=${port}`, "-txindex=1", "-acceptnonstdtxn=0", "-dbcache=32", "-maxmempool=24",
  "-par=1", "-printtoconsole=0", "-persistmempool=0",
], { stdio: ["ignore", "ignore", "pipe"] });
let startupError = "";
proc.stderr.on("data", chunk => { startupError = (startupError + chunk).slice(-1000); });
const stopped = new Promise(resolve => {
  proc.once("error", error => { startupError = error.message; resolve(); });
  proc.once("exit", resolve);
});
const killOwnedCore = () => { if (proc.exitCode === null) proc.kill("SIGTERM"); };
process.once("SIGTERM", killOwnedCore);
process.once("SIGINT", killOwnedCore);
let cookie;
async function rpc(method, params = [], wallet = false) {
  const response = await fetch(`http://127.0.0.1:${port}/${wallet ? "wallet/powcat-regtest" : ""}`, {
    method: "POST", signal: AbortSignal.timeout(15_000),
    headers: { Authorization: `Basic ${cookie}`, "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const reply = await response.json();
  if (!response.ok || reply.error) {
    throw Object.assign(new Error(`${method}: ${reply.error?.message ?? response.status}`), { code: reply.error?.code });
  }
  return reply.result;
}

// The same production journal runs against a transactional disk store. Closing
// and reopening SQLite discards all in-process state between publisher sessions.
function openJournal(address) {
  const db = new DatabaseSync(join(directory, "journal.db"));
  db.exec("CREATE TABLE IF NOT EXISTS records (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  const get = db.prepare("SELECT value FROM records WHERE key=?");
  const set = db.prepare("INSERT OR REPLACE INTO records VALUES (?,?)");
  const remove = db.prepare("DELETE FROM records WHERE key=?");
  function read(key) { const row = get.get(key); return row && JSON.parse(row.value); }
  const journal = createPowcatJournal("regtest", address, {
    read,
    update(key, edit) {
      db.exec("BEGIN IMMEDIATE");
      try {
        const result = edit(read(key), (id, value) => set.run(id, JSON.stringify(value)), id => remove.run(id));
        db.exec("COMMIT");
        return result;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
  });
  return { journal, close: () => db.close() };
}

let disk;
try {
  const deadline = Date.now() + 30_000;
  for (;;) {
    try {
      cookie = (await readFile(join(directory, "regtest", ".cookie"))).toString("base64");
      assert.equal((await rpc("getblockchaininfo")).chain, "regtest");
      break;
    } catch (error) {
      if (startupError || proc.exitCode !== null || Date.now() > deadline) throw new Error(`Test node unavailable: ${startupError || error.message}`);
      await wait(100);
    }
  }
  const nodeVersion = (await rpc("getnetworkinfo")).version;
  assert(nodeVersion >= 300000, "Core 30 or later is required for standard relay.");
  await rpc("createwallet", ["powcat-regtest"]);
  const address = await rpc("getnewaddress", ["", "bech32"], true);
  const recipient = await rpc("getnewaddress", ["", "bech32"], true);
  const mine = (n = 1) => rpc("generatetoaddress", [n, address]);
  await mine(160);
  const coins = await rpc("listunspent", [101], true);
  assert(coins.length >= 46, "Independent confirmed funding is required.");
  const usedInputs = new Set();
  async function sign(outputs, fee) {
    const coin = coins.pop();
    const prevout = `${coin.txid}:${coin.vout}`;
    assert(!usedInputs.has(prevout));
    usedInputs.add(prevout);
    const tx = new Transaction();
    tx.version = 2;
    tx.addInput(Buffer.from(coin.txid, "hex").reverse(), coin.vout, 0xfffffffd);
    let value = BigInt(Math.round(coin.amount * 100_000_000)) - BigInt(fee);
    for (const output of outputs) {
      tx.addOutput(output.script, output.value);
      value -= output.value;
    }
    tx.addOutput(bitcoinAddress.toOutputScript(address, networks.regtest), value);
    const result = await rpc("signrawtransactionwithwallet", [tx.toHex()], true);
    assert.equal(result.complete, true);
    const signed = Transaction.fromHex(result.hex);
    assert(signed.weight() <= 400_000);
    const [admission] = await rpc("testmempoolaccept", [[result.hex]]);
    assert.equal(admission.allowed, true, admission["reject-reason"]);
    return { hex: result.hex, txid: signed.getId(), fee, outpoints: [prevout] };
  }
  const dataOutput = payload => ({ script: powcatScript(payload), value: 0n });
  const broadcast = async receipt => assert.equal(await rpc("sendrawtransaction", [receipt.hex]), receipt.txid);
  const readFileFromCore = createPowcatReader({ rpc, chain: "regtest" });
  const bytes = randomBytes(4_000_000);
  const identity = { fileHash: powcatSha256(bytes), size: bytes.length, partSize: 96_000, name: "full-regtest.bin", mime: "application/octet-stream" };
  const { fileHash, partSize } = identity;
  const count = Math.ceil(bytes.length / partSize);
  assert.equal(count, 42);
  disk = openJournal(address);
  await disk.journal.begin(identity);
  const partTxids = [];
  for (let index = 0; index < count; index++) {
    const part = encodePowcatPart({ fileHash, index, count, bytes: bytes.subarray(index * partSize, (index + 1) * partSize) });
    const signed = await sign([dataOutput(part)], 100_000);
    await disk.journal.saveSigned(fileHash, index, signed);
    partTxids.push(signed.txid);
    if (index === 20) {
      // Crash after durable signing, before broadcast. Existing mempool parts
      // and the absent signed part are all recovered without a second signature.
      disk.close();
      disk = openJournal(address);
      const resumed = await disk.journal.begin(identity);
      assert.deepEqual(Object.values(resumed.receipts).map(row => row.txid), partTxids);
      const mempool = new Set(await rpc("getrawmempool"));
      assert(partTxids.slice(0, -1).every(txid => mempool.has(txid)));
      assert(!mempool.has(signed.txid));
      await assert.rejects(() => rpc("getrawtransaction", [signed.txid]), { code: -5 });
      const funding = signed.outpoints[0].split(":");
      assert((await rpc("gettxout", [funding[0], Number(funding[1]), true])).confirmations > 0);
      const changedWitness = Transaction.fromHex(signed.hex);
      changedWitness.ins[0].witness[0][0] ^= 1;
      assert.equal(changedWitness.getId(), signed.txid);
      await assert.rejects(() => disk.journal.saveSigned(fileHash, index, { ...signed, hex: changedWitness.toHex() }),
        /different signed transaction/u);
      assert.equal((await disk.journal.reservedInputs()).length, index + 1);
      assert.equal(await disk.journal.raw(fileHash, index), signed.hex);
      await broadcast({ txid: signed.txid, hex: await disk.journal.raw(fileHash, index) });
    } else {
      await broadcast(signed);
    }
  }
  assert.equal((await rpc("getrawmempool")).length, count);
  const chunkBlocks = [];
  while ((await rpc("getrawmempool")).length) {
    assert(chunkBlocks.length < 8, "Chunk mining failed to make bounded progress.");
    chunkBlocks.push(...await mine());
  }
  assert(chunkBlocks.length >= 5);
  const manifest = encodePowcatManifest({ ...identity, partTxids });
  async function publishLinker() {
    const signed = await sign([dataOutput(manifest)], 3_000);
    await disk.journal.saveSigned(fileHash, "manifest", signed);
    await broadcast(signed);
    await assert.rejects(() => readFileFromCore(signed.txid), { statusCode: 409 });
    await mine();
    const file = await readFileFromCore(signed.txid);
    assert.equal(file.size, 4_000_000);
    assert.equal(file.fileHash, fileHash);
    assert.deepEqual(file.partTxids, partTxids);
    assert(Buffer.from(file.bytes).equals(bytes));
    return signed;
  }
  const original = await publishLinker();
  await disk.journal.finish(fileHash);
  assert.equal(await disk.journal.read(), null);

  // Disconnect a part's block and the linker. Then mine the disconnected
  // pieces alongside the original linker: they confirm, but strict earlier
  // inclusion fails, so recovery must sign a new linker for the same bytes.
  const lastPartBlock = chunkBlocks.at(-1);
  const lastParts = (await rpc("getblock", [lastPartBlock, 1])).tx.slice(1);
  assert(lastParts.length > 0);
  await rpc("invalidateblock", [lastPartBlock]);
  await assert.rejects(() => readFileFromCore(original.txid), { statusCode: 409 });
  disk.close();
  disk = openJournal(address);
  assert.equal((await disk.journal.lastPublished()).receipts.manifest.txid, original.txid);
  await disk.journal.begin(identity);
  assert.equal(await disk.journal.raw(fileHash, "manifest"), original.hex);
  await rpc("generateblock", [address, [...lastParts, original.txid]]);
  await assert.rejects(() => readFileFromCore(original.txid), { statusCode: 422 });
  await disk.journal.supersedeLinker(fileHash, original.txid);
  const replacement = await publishLinker();
  assert.notEqual(replacement.txid, original.txid);
  const restored = await disk.journal.read();
  assert.equal(restored.supersededLinkers[0].txid, original.txid);
  assert.deepEqual(partTxids.map((_, i) => restored.receipts[i].txid), partTxids);

  // Pay an ordinary Mail recipient exactly once. Decode its confirmed output
  // scripts through the canonical record and Mail parsers that back the API.
  const attachment = buildPowcatMailAttachment({ ...identity, txid: replacement.txid });
  const b64 = value => Buffer.from(value, "utf8").toString("base64url");
  const envelope = `pwm1:a:${b64(attachment.mime)}:${b64(attachment.name)}:${attachment.size}:${attachment.sha256}:0/1:${attachment.data}`;
  const pay = { script: bitcoinAddress.toOutputScript(recipient, networks.regtest), value: 546n };
  const mail = await sign([pay, dataOutput(Buffer.from("pwm1:m:Linked file")), dataOutput(Buffer.from(envelope))], 1_000);
  await broadcast(mail);
  await mine();
  const delivery = await rpc("getrawtransaction", [mail.txid, 1]);
  assert(delivery.confirmations >= 1);
  const { records } = canonicalRawProtocolRecordSetFromTransaction(delivery);
  assert.equal(records.length, 1);
  assert.equal(records[0].protocolVout, 1);
  assert.equal(records[0].rawDecodeValid, true);
  const recipientPayments = delivery.vout.slice(0, records[0].protocolVout);
  assert.deepEqual(recipientPayments.map(output => [output.scriptPubKey.address, Math.round(output.value * 100_000_000)]), [[recipient, 546]]);
  const message = parseWorkAmoV5PwmMessages(records[0].rawRecordParts.map(part => part.text));
  assert.equal(message.kind, "file");
  assert.equal(message.memo, "Linked file");
  assert.equal(message.contributionField, "driveFlowSats");
  assert.deepEqual(message.attachment, attachment);
  const pointer = powcatPointerFromAttachment(message.attachment);
  assert.deepEqual(pointer, { txid: replacement.txid, fileHash });
  const fromInbox = await readFileFromCore(pointer.txid);
  assert.equal(fromInbox.fileHash, pointer.fileHash);
  assert(Buffer.from(fromInbox.bytes).equals(bytes));
  await disk.journal.finish(fileHash);
  console.log(JSON.stringify({ regtest: true, nodeVersion, bytes: bytes.length, fileHash, partCount: count, chunkBlocks: chunkBlocks.length,
    interruptedStage: 20, originalLinker: original.txid, recoveredLinker: replacement.txid, delivery: mail.txid,
    recipientProofs: 546, confirmedReassembledBytes: fromInbox.bytes.length }));
} finally {
  disk?.close();
  killOwnedCore();
  const timeout = setTimeout(() => proc.kill("SIGKILL"), 10_000);
  try { await stopped; } finally { clearTimeout(timeout); }
  await rm(directory, { recursive: true, force: true });
  process.off("SIGTERM", killOwnedCore);
  process.off("SIGINT", killOwnedCore);
}
