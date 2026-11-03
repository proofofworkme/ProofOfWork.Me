import assert from "node:assert/strict";
import { timingSafeEqual } from "node:crypto";
import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { Transaction, opcodes, script } from "bitcoinjs-lib";
import { BROADCAST_HINT_LIMIT, BROADCAST_HINT_MODEL, BROADCAST_HINT_TTL_MS, createBroadcastHints } from "./pending-broadcast-hints.mjs";

function transaction(index, { data = true, witness = false } = {}) {
  const tx = new Transaction();
  const outpoint = Buffer.alloc(32);
  outpoint.writeUInt32LE(index);
  tx.addInput(outpoint, 0);
  const output = data ? script.compile([opcodes.OP_RETURN, Buffer.from("pwm1:m:hint")]) : Buffer.from([opcodes.OP_TRUE]);
  tx.addOutput(output, 0n);
  if (witness) tx.setWitness(0, [Buffer.from([1, 2])]);
  return tx;
}

async function fixture(t, clock = () => Date.now()) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "accepted-broadcast-test-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const warnings = [];
  const options = { directory, now: clock, warn: error => warnings.push(error) };
  return { directory, warnings, options, hints: createBroadcastHints(options) };
}

function accept(hints, tx) {
  return hints.rememberAccepted({ txid: tx.getId(), ok: true }, tx.toHex(), "livenet");
}

test("accepted signed identity survives restart without carrying raw transaction or payment state", async t => {
  const { directory, hints, options } = await fixture(t);
  const tx = transaction(1, { witness: true });
  const wtxid = Buffer.from(tx.getHash(true)).reverse().toString("hex");
  assert.notEqual(wtxid, tx.getId());
  await hints.rememberAccepted({ ok: true, txid: wtxid }, tx.toHex(), "livenet");
  assert.deepEqual((await hints.list()).txids, []);
  await accept(hints, tx);
  const reopened = await createBroadcastHints(options).list();
  assert.deepEqual(reopened, { model: BROADCAST_HINT_MODEL, network: "livenet", txids: [tx.getId()] });
  const [file] = await fs.readdir(directory);
  assert.equal(file, "accepted-broadcast-txids-v1.json");
  const record = JSON.parse(await fs.readFile(path.join(directory, file), "utf8"));
  assert.deepEqual(Object.keys(record).sort(), ["entries", "model", "network"]);
  assert.equal(record.entries[0].length, 2);
  assert.equal(record.entries[0][0], tx.getId());
  assert.equal((await fs.stat(path.join(directory, file))).mode & 0o777, 0o600);
});

test("payments without carriers, wrong network, missing success, invalid/mismatched bytes produce no hint", async t => {
  const { hints } = await fixture(t);
  const tx = transaction(2);
  const payment = transaction(3, {data:false});
  const valid = {ok:true, txid:tx.getId()};
  for (const [result, hex, network] of [
    [valid, tx.toHex(), "testnet4"], [{ok:false, txid:tx.getId()},tx.toHex(),"livenet"],
    [valid,"00","livenet"],[valid,"zz","livenet"],[valid,payment.toHex(),"livenet"],
    [{ok:true, txid:payment.getId()},payment.toHex(),"livenet"],
  ]) await hints.rememberAccepted(result, hex, network);
  assert.deepEqual((await hints.list()).txids, []);
});

test("concurrent submissions stay bounded and deduplicated; retries never refresh order or expiry", async t => {
  let time = 1000;
  const { hints, options } = await fixture(t, () => time);
  const txs = Array.from({ length: BROADCAST_HINT_LIMIT + 3 }, (_, i) => transaction(i + 10));
  await Promise.all(txs.map(tx => { time++; return accept(hints, tx); }));
  const expected = txs.slice(-BROADCAST_HINT_LIMIT).map(tx => tx.getId());
  await accept(hints, txs[3]);
  assert.deepEqual((await createBroadcastHints(options).list()).txids, expected);
  time += BROADCAST_HINT_TTL_MS - 1;
  assert.deepEqual((await hints.list()).txids, [expected.at(-1)]);
  time++;
  assert.deepEqual((await createBroadcastHints(options).list()).txids, []);
});

test("cache failures and unsafe files fall back to bounded in-memory hints", async t => {
  const { directory, options, warnings } = await fixture(t);
  const tx = transaction(4);
  const original = path.join(directory, "preserved");
  await fs.writeFile(original, "kept", { mode:0o600 });
  const link = path.join(directory, "accepted-broadcast-txids-v1.json");
  await fs.symlink(original, link);
  for (const root of [directory, path.join(directory,"missing")]) {
    const hints = createBroadcastHints({ ...options, directory: root });
    await accept(hints, tx);
    assert.deepEqual((await hints.list()).txids, [tx.getId()]);
  }
  assert.ok(warnings.length);
  assert.equal(await fs.readFile(original, "utf8"), "kept");
  assert.equal(await fs.readlink(link), original);
});

test("listing a fresh cache is read-only; untrusted cache directories are never written", async t => {
  const {directory, hints, options} = await fixture(t);
  assert.deepEqual((await hints.list()).txids, []);
  assert.deepEqual(await fs.readdir(directory), []);
  const real = path.join(directory,"real");
  const alias = path.join(directory,"alias");
  await fs.mkdir(real, {mode:0o700});
  await fs.symlink(real,alias);
  const tx=transaction(9);
  const symlinked=createBroadcastHints({...options,directory:alias});
  await accept(symlinked,tx);
  await fs.chmod(real,0o770);
  const writable=createBroadcastHints({...options,directory:real});
  await accept(writable,tx);
  assert.deepEqual(await fs.readdir(real), []);
  assert.deepEqual((await symlinked.list()).txids, [tx.getId()]);
  assert.deepEqual((await writable.list()).txids, [tx.getId()]);
});

const apiSource = await fs.readFile(new URL("./proof-api.mjs", import.meta.url), "utf8");
function apiFunction(name) {
  const start = apiSource.search(new RegExp("(?:async )?function " + name + "\\("));
  assert.ok(start >= 0);
  const end = apiSource.indexOf("\n}", start);
  return apiSource.slice(start, end + 2);
}

for (const [name, source] of [["broadcastNodePayload","node"],["broadcastSlipstreamPayload","slipstream"]]) {
  test(source + " broadcasts schedule verified hints only after acceptance without waiting for storage", async t => {
    const { hints } = await fixture(t);
    const tx = transaction(5);
    const receipt = { ok:true, source, txid:tx.getId() };
    let reject = false, note, failHint = false;
    const warnings = [];
    const submit = async () => { if (reject) throw new Error("submission rejected"); return receipt; };
    let stored;
    const pendingBroadcastHints = { rememberAccepted(...args) {
      note = args;
      if (failHint) throw new Error("discovery unavailable");
      stored = hints.rememberAccepted(...args);
      return new Promise(() => {}); // Stalled storage cannot hold the HTTP response.
    } };
    const fn = new Function("pendingBroadcastHints", "submit", "txHex", "errorSummary", "console",
      "const readJsonRequestBody=async()=>({txHex}), BROADCAST_BODY_TIMEOUT_MS=1000;"
      + "const assertWorkMarketplaceBroadcastAllowed=async()=>{}, assertNoUnexpectedListingAnchorSpend=async()=>{},"
      + " cachePendingTokenTransactionByTxid=async()=>{}, submitSlipstreamTransaction=submit, submitNodeTransaction=submit;"
      + apiFunction("noteAcceptedBroadcast") + "\n" + apiFunction(name) + "\nreturn " + name
    )(pendingBroadcastHints, submit, tx.toHex(), error => error.message, {error: (...args) => warnings.push(args)});
    assert.equal(await fn({}, "livenet"), receipt);
    await stored;
    assert.deepEqual(note, [receipt, tx.toHex(), "livenet"]);
    assert.deepEqual((await hints.list()).txids, [tx.getId()]);
    failHint = true;
    assert.equal(await fn({}, "livenet"), receipt);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(warnings[0].at(-1), "discovery unavailable");
    note = null; reject = true;
    await assert.rejects(fn({}, "livenet"), /submission rejected/);
    assert.equal(note, null);
  });
}

test("hint route requires the existing verifier token and loopback Host/peer; no public or testnet reads", async () => {
  const start = apiSource.indexOf('    if (url.pathname === "/api/v1/internal/pending-discovery-hints")');
  const end = apiSource.indexOf("\n    if (", start + 5);
  assert.ok(start > 0 && end > start);
  const token = "a".repeat(64);
  const handle = new Function("INTERNAL_VERIFIER_TOKEN", "timingSafeEqual",
    apiFunction("internalVerifierRequestAllowed") + "\nreturn async function(request, url, pendingBroadcastHints) {"
    + "let row; const response={}, jsonResponse=(_,status,body,cache)=>row={status,body,cache},"
    + " errorResponse=(_,status)=>row={status}; async function run(){\n"
    + apiSource.slice(start,end) + "\n} await run();return row;}"
  )(token, timingSafeEqual);
  const list = { list: async () => ({ model: BROADCAST_HINT_MODEL, network:"livenet",txids:[] }) };
  for (const [host,peer,key,method,network,status] of [
    ["127.0.0.1","127.0.0.1",token,"GET","livenet",200],
    ["computer.proofofwork.me","127.0.0.1",token,"GET","livenet",404],
    ["127.0.0.1","10.0.0.1",token,"GET","livenet",404], ["127.0.0.1","127.0.0.1","", "GET","livenet",404],
    ["127.0.0.1","127.0.0.1",token,"POST","livenet",404], ["127.0.0.1","127.0.0.1",token,"GET","testnet",400],
  ]) {
    const got = await handle({method, headers:{host,"x-pow-internal-verifier":key},socket:{remoteAddress:peer}},
      new URL("http://localhost/api/v1/internal/pending-discovery-hints?network="+network),list);
    assert.equal(got.status,status);
    if (status===200) assert.equal(got.cache,"no-store");
  }
});
