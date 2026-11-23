import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Transaction } from "bitcoinjs-lib";
import { DECLARATION_PINS as anchor, verifyReplayDeclaration } from "./qualify.mjs";
import { checkComposition, coreRpc, databaseClient, installedDependencies, openSources, plannedTip, readDatabaseIdentity, replayEvidence, sourceClosure, verifyOriginalRange } from "./preflight.mjs";

const hash = byte => byte.repeat(64);
const [base, candidate, active, composed] = ["a","b","c","d"].map(hash);
const root = fileURLToPath(new URL("../../", import.meta.url)).replace(/\/$/u, "");
const fixture = fileURLToPath(new URL("./fixtures/declaration.json", import.meta.url));
const tip = { height:anchor.blockHeight+1, hash:candidate };
const rows = (...data) => ({ rows:data });
const header = { native_bytes:"15", native_sha256:active, current_main_row_sha256:base, complete:true, block_atomic:true,
  fee_once:true, invalid_zero:true, payload:{__powNativeStorage:{model:"proof-indexer-native-transition-chunks-v1",sha256:active}},
  protocol_record_count:0, raw_protocol_candidate_count:0, transaction_count:0, event_count:0 };

test("source composition preserves the historical overlay and reviewed deltas", () => {
  const check = (old, repo, previous, next) => checkComposition({base:old,repositoryCandidate:repo,active:previous,composed:next});
  check(base,candidate,base,candidate);
  check(base,base,active,active);
  check(base,candidate,active,composed);
  check(null,candidate,null,candidate);
  check(null,null,active,active);
  const newlyImported = {base,repositoryCandidate:candidate,active:null,composed:candidate,activeLoaded:false,composedLoaded:true};
  checkComposition(newlyImported);
  assert.throws(() => checkComposition({...newlyImported,composed:active}), /newly imported tracked source differs/);
  assert.throws(() => check(null,candidate,active,candidate), /new source composition differs/);
  for (const args of [[base,candidate,base,active],[base,base,active,base],[base,candidate,active,active],[null,candidate,null,active],[null,null,active,composed]])
    assert.throws(() => check(...args));
});

test("loaded replay first-party imports and external modules have explicit identities", () => {
  const c = sourceClosure(root, "server/work-amo-v5-raw.mjs");
  assert.match(c.files.get("server/work-amo-v5-raw.mjs"), /^[a-f0-9]{64}$/u);
  assert.ok(c.files.has("server/work-amo-expanded-liquidity.mjs"));
  assert.ok(c.files.has("src/shared/protocol/workAmoExpandedLiquidity.mjs"));
  assert.deepEqual([...new Set([...c.imports.values()].map(a=>a[1]))].sort(), ["@bitcoinerlab/secp256k1","bitcoinjs-lib"]);
  assert.match(installedDependencies([...c.imports.values(),[root,"pg"]]), /^[a-f0-9]{64}$/u);
});

test("foreign source manifests, missing plans and nonlocal endpoints fail before use", async () => {
  await assert.rejects(openSources(fixture, candidate), /source manifest digest differs/);
  assert.deepEqual(plannedTip(String(tip.height),tip.hash),tip);
  for (const [height,blockHash] of [[anchor.blockHeight,base],[anchor.blockHeight+513,base],[String(tip.height)+" ",base],[tip.height,null]])
    assert.throws(() => plannedTip(height,blockHash), /reviewed/);
  assert.throws(() => coreRpc({BITCOIN_RPC_URL:"https://example.invalid/",BITCOIN_RPC_USER:"fixture",BITCOIN_RPC_PASSWORD:"fixture"}), /local Core/);
  assert.throws(() => databaseClient({POW_INDEX_DATABASE_URL:"postgresql://remote.invalid/fixture"}), /local index/);
});

test("Core declaration and authority parent are decoded from published raw bytes", async () => {
  const data = JSON.parse(readFileSync(fixture));
  const parentId = Transaction.fromHex(data.prevoutTransactionHex).getId();
  const block = {hash:anchor.blockHash, height:anchor.blockHeight, tx:Array(anchor.blockTransactionIndex+1).fill(base)};
  block.tx[anchor.blockTransactionIndex]=anchor.txid;
  const at = {txid:anchor.txid, blockHeight:anchor.blockHeight, blockHash:anchor.blockHash, blockIndex:anchor.blockTransactionIndex};
  let offset = 0;
  const client = {query:async (sql,args) => {assert.match(sql,/t.status='confirmed'/u); assert.deepEqual(args,[anchor.txid]); return rows({...at,blockIndex:at.blockIndex+offset});}};
  const calls = [];
  const rpc = async (method,args) => {
    calls.push([method,args]);
    if (method==="getblockhash") return anchor.blockHash;
    if (method==="getblock") return block;
    if (args[0]===anchor.txid) return {txid:anchor.txid,hex:data.transactionHex,confirmations:1,blockhash:anchor.blockHash};
    assert.deepEqual(args,[parentId,true]);
    return {txid:parentId,hex:data.prevoutTransactionHex,confirmations:5,blockhash:base};
  };
  const adapter = replayEvidence({client,rpc});
  assert.equal(verifyReplayDeclaration(await adapter.readDeclarationEvidence()).txid,anchor.txid);
  assert.deepEqual(calls.map(c=>c[0]),["getrawtransaction","getrawtransaction","getblockhash","getblock"]);
  offset = 1;
  assert.throws(() => verifyReplayDeclaration({}), /declaration bytes/);
  const shifted = await adapter.readDeclarationEvidence();
  assert.throws(() => verifyReplayDeclaration(shifted), /canonical declaration or indexed position differs/);
});

test("fresh checkpoint requires the exact complete canonical rebuild and service tip", async () => {
  const rebuild={network:"livenet",complete:true,active:false,status:"complete",indexedThroughBlock:tip.height,indexedThroughBlockHash:tip.hash};
  const indexed={height:tip.height,block_hash:tip.hash,rebuild};
  const core={chain:"main",blocks:tip.height,bestblockhash:tip.hash,initialblockdownload:false};
  const adapter=replayEvidence({freshClient:{query:async()=>rows(indexed)},rpc:async()=>core});
  assert.deepEqual(await adapter.readTip(),tip);
  core.bestblockhash=active;
  await assert.rejects(adapter.readTip(), /Core\/index tip differs/);
  core.bestblockhash=tip.hash; indexed.rebuild.active=true;
  await assert.rejects(adapter.readTip(), /index checkpoint incomplete/);
});

test("oversized or governed suffix rows fail before native decode", async () => {
  for (const changed of [{native_bytes:String(128*1024*1024+1)},{event_count:1},{raw_protocol_candidate_count:1},{transaction_count:1},{protocol_record_count:1025}]) {
    const queries=[];
    const client={query:async sql=>{queries.push(sql);return rows({...header,...changed});}};
    await assert.rejects(replayEvidence({client}).readTransition(tip.height,tip.hash));
    assert.equal(queries.length,1);
    assert.doesNotMatch(queries[0], /read_work_transition_payload_v1/);
  }
});

test("fresh final range detects changes to native seals and relational evidence", async () => {
  const relations={recordCount:0,eventCount:0,recordRowsSha256:base,eventRowsSha256:base};
  const q={anchor:{height:anchor.blockHeight,hash:anchor.blockHash,oldNativeSha256:active,currentMainRowSha256:base},
    blocks:[{height:tip.height,hash:tip.hash,oldNativeSha256:active,currentMainRowSha256:base,relationalBindings:relations}]};
  const current={...header}, bindings={...relations};
  const client={query:async sql=>rows(sql.startsWith("WITH")?bindings:current)};
  await verifyOriginalRange(client,q);
  current.native_sha256 = candidate;
  await assert.rejects(verifyOriginalRange(client,q), /native evidence changed/);
  current.native_sha256=active; bindings.eventCount=1;
  await assert.rejects(verifyOriginalRange(client,q), /relational evidence changed/);
});

test("unprivileged sessions prove their same backend to the local postgres peer", async () => {
  const api={name:"fixture",role:"readonly",backend_pid:123,port:"5432",server_address:"127.0.0.1",server_port:5432,
    postmaster_started_us:"1000",backend_started_us:"2000"};
  const peer={databaseName:"fixture",port:5432,unixSocketDirectories:"/var/run/postgresql",postmasterStartedUs:"1000",
    systemIdentifier:"23456",apiBackend:{pid:123,databaseName:"fixture",role:"readonly",startedUs:"2000",clientAddress:"127.0.0.1"}};
  const read={query:async sql=>{assert.doesNotMatch(sql,/pg_control_system/);return rows(api);}};
  assert.deepEqual(await readDatabaseIdentity(read,async()=>peer),{databaseName:"fixture",systemIdentifier:"23456",port:5432,
    unixSocketDirectories:"/var/run/postgresql",postmasterStartedUs:"1000"});
  peer.apiBackend.startedUs="3000";
  await assert.rejects(readDatabaseIdentity(read,async()=>peer), /database-peer-backend-mismatch/);
});
