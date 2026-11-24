import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Block, Transaction, opcodes, script } from "bitcoinjs-lib";
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

test("oversized frames and inconsistent governed counts fail before native decode", async () => {
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
  let physical = true;
  const client={query:async sql=>rows(sql.startsWith("WITH") ? bindings :
    sql.includes(" AS verified") ? {verified:physical} : current)};
  await verifyOriginalRange(client,q);
  physical=false;
  await assert.rejects(verifyOriginalRange(client,q), /physical frame changed/);
  physical=true;
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

import { canonicalRawProtocolRecordSetFromTransaction } from "../../server/canonical-op-return.mjs";
import { scenario } from "./fixtures/replay.mjs";
import { GOVERNED_RELATIONAL_BINDINGS_SQL, expectedRelationalRows, readRelationalEvidence, verifyRelationalEvidence } from "./relations.mjs";

function occupiedRelations(type) {
  const fixture = scenario({occupied:type});
  const height = anchor.blockHeight + 1;
  const blockHash = fixture.hashes.get(height);
  const block = Block.fromHex(fixture.blocks.get(blockHash));
  const tx = block.transactions[1];
  const prevoutValue = tx.ins.reduce((sum,input) => {
    const parent = Transaction.fromHex(fixture.parents.get(Buffer.from(input.hash).reverse().toString("hex")));
    return sum + BigInt(parent.outs[input.index].value);
  }, 0n);
  const fee = prevoutValue - tx.outs.reduce((sum,output) => sum + BigInt(output.value), 0n);
  const vout = tx.outs.map(output => ({scriptpubkey:Buffer.from(output.script).toString("hex"),value:Number(output.value)}));
  const parsed = canonicalRawProtocolRecordSetFromTransaction({vout}).records;
  const canonical = {height,hash:blockHash,replayRecords:fixture.rows.get(height).decoded.replayRecords,
    records:parsed.map(record => ({...record,txid:tx.getId(),tx:{vout},transactionMinerFeeSats:fee.toString(),
      position:{blockHash,blockHeight:height,blockTransactionIndex:1,protocolVout:record.protocolVout,recordOrdinal:0}}))};
  return {canonical,evidence:fixture.relations.get(height)};
}

test("occupied relational fingerprints require every physical PWM part and replayed Boost/file event", () => {
  const {canonical,evidence} = occupiedRelations(true);
  assert.equal(canonical.records.length,2);
  assert.equal(evidence.records.length,3);
  assert.deepEqual(evidence.events.map(row => row.kind).sort(),["boost-post","file"]);
  assert.deepEqual(verifyRelationalEvidence({...evidence,records:evidence.records.toReversed(),
    events:evidence.events.toReversed()},canonical),evidence.bindings);
  const mutations = [
    row => { row.records[0].vout++; },
    row => { row.records[0].outputIndex++; },
    row => { row.records[0].blockIndex++; },
    row => { row.records[0].dataBytes++; },
    row => { row.records[0].payloadHex = "00"; },
    row => { row.records[0].payloadText += "x"; },
    row => { row.records[1] = row.records[0]; },
    row => { row.records.pop(); row.bindings.recordCount--; },
    row => { row.events[1] = row.events[0]; },
    row => { row.events[0].blockHeight++; },
    row => { row.events[0].ordinal++; },
    row => { row.events[0].feeSats = "0"; },
    row => { row.events[0].amountSats = "0"; },
    row => { row.events[1].dataBytes++; },
    row => { row.events[0].txid = active; },
    row => { row.events[0].kind = "boost-event"; },
    row => { row.events[0].rawCandidate = false; },
    row => { row.events[0].rawWitness = {}; },
    row => { row.events[0].replayOutput = {}; },
    row => { row.events[1].rawPayload = row.records[2].payloadText; },
    row => { row.events[1].valid = false; },
    row => { row.events[1].outcome.reasonCode = "unexpected"; },
    row => { row.events[1].validationErrors = ["unexpected"]; },
    row => { row.events[1].bound = false; },
  ];
  for (const mutate of mutations) {
    const changed = structuredClone(evidence);
    mutate(changed);
    assert.throws(() => verifyRelationalEvidence(changed,canonical),/governed relational rows differ/);
  }
  assert.throws(() => verifyRelationalEvidence(evidence.bindings,canonical),/records count/);
});

test("derived rows bind each recipient to its parent carrier, fee and exact ordinal", () => {
  const {canonical,evidence} = occupiedRelations("two-recipient-bond");
  assert.deepEqual(evidence.events.map(row => row.kind),["infinity-bond","token-mint","token-mint"]);
  assert.deepEqual(verifyRelationalEvidence(evidence,canonical),evidence.bindings);
  for (const mutate of [
    row => { row.events[1].derivedId = row.events[2].derivedId; },
    row => { row.events[1].rawWitness = row.events[2].rawWitness; },
    row => { row.events[1].rawPayload = row.events[0].rawPayload; },
    row => { row.events[1].amountSats = "546"; },
    row => { row.events[2].feeSats = "0"; },
    row => { row.events.pop(); row.bindings.eventCount--; },
  ]) {
    const changed = structuredClone(evidence);
    mutate(changed);
    assert.throws(() => verifyRelationalEvidence(changed,canonical),/governed relational rows differ/);
  }
});

test("occupied SQL evidence reads both projection and complete row/transaction bindings under the same snapshot", async () => {
  const {canonical,evidence} = occupiedRelations(true);
  const queries = [];
  const client = {query:async (sql,args) => {
    assert.deepEqual(args,[canonical.height,canonical.hash]);
    queries.push(sql);
    return rows(sql === GOVERNED_RELATIONAL_BINDINGS_SQL ? evidence.bindings :
      {records:evidence.records,events:evidence.events});
  }};
  assert.deepEqual(await readRelationalEvidence(client,canonical.height,canonical.hash),evidence);
  assert.equal(queries.length,2);
  assert.match(queries[0],/amo-governed-relational-row-v2/);
  assert.match(queries[0],/txid,block_index,fee,doc/);
  assert.match(queries[1],/workAmoV5ReplayRawWitness/);
  const empty = scenario().options;
  const bindings = await empty.readRelations(anchor.blockHeight+1,canonical.hash);
  const queriesEmpty = [];
  const emptyRows = await readRelationalEvidence({query:async sql => {queriesEmpty.push(sql); return rows(bindings);}},
    canonical.height,canonical.hash);
  assert.deepEqual(queriesEmpty,[GOVERNED_RELATIONAL_BINDINGS_SQL]);
  assert.deepEqual(verifyRelationalEvidence(emptyRows,{...canonical,records:[],replayRecords:[]}),bindings);
  assert.deepEqual(verifyRelationalEvidence(bindings,{...canonical,records:[],replayRecords:[]}),bindings);
  assert.throws(() => verifyRelationalEvidence({...bindings,recordRowsSha256:base},
    {...canonical,records:[],replayRecords:[]}),/record bindings/);
});

test("governed accounting uses the DNS carrier payment and preserves rejected reporting amounts", () => {
  const height = anchor.blockHeight + 1, position = {blockHash:candidate,blockHeight:height,
    blockTransactionIndex:3,protocolVout:1,recordOrdinal:0};
  function control(message, semanticKind, valid) {
    const output = {scriptpubkey:Buffer.from(script.compile([opcodes.OP_RETURN,Buffer.from(message)])).toString("hex"),value:0};
    const tx = {vout:[{value:1023,scriptpubkey:"0014" + "ab".repeat(20)},output]};
    const [record] = canonicalRawProtocolRecordSetFromTransaction(tx).records;
    const raw = {...record,tx,txid:base,position,transactionMinerFeeSats:"41"};
    const outcome = {kind:raw.protocol + (valid ? "-valid" : "-invalid"),valid,reasonCode:valid ? "" : "refused"};
    const descriptor = {txid:base,position,protocol:raw.protocol,rawCandidate:true,rawWitness:record.payload,
      output:{projection:{kind:semanticKind}},outcome:{...outcome,semanticKind},transactionMinerFeeSats:"41",
      stateDelta:{economicOutputs:[]}};
    const canonical = {height,hash:candidate,records:[raw],replayRecords:[descriptor]};
    const expected = expectedRelationalRows(canonical);
    const bindings = {recordCount:1,eventCount:1,recordRowsSha256:base,eventRowsSha256:composed};
    return {canonical,evidence:{...expected,bindings}};
  }
  const dns = control("pwdns1:r1:Zm9v:example:root","dns-register",true);
  assert.equal(dns.evidence.events[0].amountSats,"1023");
  assert.equal(dns.evidence.events[0].dataBytes,Buffer.byteLength(dns.canonical.records[0].message));
  dns.evidence.events[0].amountSats = "1000";
  assert.throws(() => verifyRelationalEvidence(dns.evidence,dns.canonical),/relational rows differ/);

  const rejected = control("pwt1:unknown","token-event-invalid",false);
  const row = rejected.evidence.events[0];
  // PostgreSQL has already checked that this non-consensus scalar equals its
  // normalized source in the complete original row, bound by eventRowsSha256.
  row.amountSats = "0";
  assert.equal(row.kind,"token-event-invalid");
  assert.deepEqual(verifyRelationalEvidence(rejected.evidence,rejected.canonical),rejected.evidence.bindings);
  row.amountSats = null;
  assert.throws(() => verifyRelationalEvidence(rejected.evidence,rejected.canonical),/relational rows differ/);
  rejected.canonical.replayRecords[0].output.projection.kind = "token-transfer";
  assert.throws(() => verifyRelationalEvidence(rejected.evidence,rejected.canonical),/kind lacks its replay projection/);
});
