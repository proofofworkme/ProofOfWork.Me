import assert from "node:assert/strict";
import test from "node:test";
import { checkRawQualification, parsePublicationArgs } from "./publish-cli.mjs";
import { rehearsalWindow } from "./publish.mjs";
import { qualifyExpandedLiquidityReplay } from "./qualify.mjs";
import { scenario } from "./fixtures/replay.mjs";

test("publication CLI requires an explicit mode, evidence digests, and the current Search hold for publication", () => {
  const source = "a".repeat(64), qualification = "b".repeat(64), hold = "c".repeat(64);
  const args = ["/private/source",source,"/private/qualification",qualification,"/private/receipt"];
  assert.equal(parsePublicationArgs(["publish",...args,hold]).holdSha,hold);
  for (const mode of ["rehearse","verify"]) assert.equal(parsePublicationArgs([mode,...args]).mode,mode);
  for (const invalid of [[...args],["publish",...args],["verify",...args,hold],
    ["publish",...args,"bad"],["rehearse","relative",...args.slice(1)]]) {
    assert.throws(()=>parsePublicationArgs(invalid),/Use MODE/u);
  }
});

test("publication fence checks declared transaction, prevout and exact serialized bytes of every qualified block", async () => {
  const {options} = scenario();
  const q = await qualifyExpandedLiquidityReplay(options);
  await checkRawQualification(q,options);
  const changedBlock = q.blocks.at(-1);
  await assert.rejects(checkRawQualification(q,{...options,readRawBlock:async hash =>
    hash === changedBlock.hash ? "00".repeat(changedBlock.rawBlockBytes) : options.readRawBlock(hash)}), /block bytes differ/u);
  const lostPrevout = {...await options.readDeclarationEvidence(),prevoutTransactionHex:"00"};
  await assert.rejects(checkRawQualification(q,{...options,readDeclarationEvidence:async()=>lostPrevout}));
});


test("raw evidence reads remain bounded to two blocks and both finish before a rejection", async () => {
  const {options} = scenario();
  const q = await qualifyExpandedLiquidityReplay(options);
  const blocks = [...q.blocks, ...q.blocks, ...q.blocks];
  let started = 0, active = 0, high = 0, corrupt = false;
  const readRawBlock = async hash => {
    const i = ++started;
    high = Math.max(high, ++active);
    await new Promise(resolve => setImmediate(resolve));
    active--;
    return corrupt && i === 1 ? "00" : options.readRawBlock(hash);
  };
  const check = () => checkRawQualification({...q,blocks}, {...options,readRawBlock});
  await check();
  assert.equal(started, 6);
  assert.equal(high, 2);
  corrupt = true;
  started = 0;
  await assert.rejects(check(), /block bytes differ/u);
  assert.equal(started, 2);
  assert.equal(active, 0);
});

test("rehearsal budgets every statement and idle period against one monotonic deadline", async () => {
  let clock = 10;
  const queries = [];
  const backend = {query:async (sql, params) => { queries.push([sql,params]); }};
  const w = rehearsalWindow(backend, () => clock);
  await w.client.query("first");
  clock += 1_199_995;
  await w.client.query("second");
  assert.deepEqual(queries.filter(([sql]) => sql.includes("set_config")).map(([,params]) => params), [["1200000ms"],["5ms"]]);
  assert.match(queries[0][0], /idle_in_transaction_session_timeout/u);
  clock += 5;
  await assert.rejects(w.client.query("third"), /deadline exceeded/u);
  assert.equal(queries.length, 4);
});
