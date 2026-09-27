import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { postV5H1Fixture } from "./fixtures/post-v5-h1-fixture.mjs";
import { POST_V5_INCB_H1_IMPORT_TARGETS } from "./import-post-v5-incb-h1-summaries.mjs";
import { POST_V5_INCB_ISSUANCE_REPAIR_TARGETS } from "../server/incb-post-v5-repair.mjs";
import { buildIncbRangeReplayWitnessManifest, incbRangeReplayWitnessMetaKey } from "../server/incb-range-replay-witness.mjs";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { SCOPED_INCB_ORACLE_PIN, SCOPED_INCB_ORACLE_MODEL, verifiedScopedIncbOracleSource,
  scopedIncbOracleWrapper, verifiedScopedIncbOracleRow, storedScopedIncbOracle,
  scopedIncbOracleLedgerPayload } from "../server/incb-scoped-oracle.mjs";
import { importScopedIncbOracle } from "./import-scoped-incb-oracle.mjs";
const sha = (v) => createHash("sha256").update(v).digest("hex");
const pin = { txid:"e".repeat(64),snapshotId:"1".repeat(24),height:968124,
  blockHash:"a".repeat(64),closingStateSha256:"b".repeat(64),tokenStateSha256:"c".repeat(64),
  workNetworkValueQ8:"840950469793071163780428513",proofSha256:"d".repeat(64) };
const row = {network:"livenet",snapshot_id:pin.snapshotId,indexed_through_block:pin.height,
  generated_at:"2026-09-27T00:00:00.000Z",source_hashes:{blockScan:pin.blockHash,canonicalSummary:"f".repeat(64)},
  metrics:{},consistency:{ok:true,status:"green",checks:Array.from({length:25},(_,i)=>({name:String(i),ok:true}))},
  payload:{snapshotId:pin.snapshotId,indexedThroughBlock:pin.height,indexedThroughBlockHash:pin.blockHash,
    ok:true,status:"green",summaryRefresh:{mode:"canonical-summary-refresh"},
    totals:{workNetworkValueQ8:pin.workNetworkValueQ8},summaryPayloads:{workFloor:{}},
    workSufficientState:{closingStateCommitment:{sha256:pin.closingStateSha256},tokenStateCommitment:{sha256:pin.tokenStateSha256}}}};
const raw = JSON.stringify(row);pin.sourceRowSha256=sha(raw);
const wrapper = scopedIncbOracleWrapper(raw,pin);
assert.deepEqual(verifiedScopedIncbOracleRow(wrapper,pin),row);
assert.equal(wrapper.payload.model,SCOPED_INCB_ORACLE_MODEL);
assert.equal(wrapper.source_hashes.canonicalSummary,undefined);
assert.equal(wrapper.payload.summaryPayloads,undefined);
assert.equal(wrapper.payload.workAmountStorageModel,undefined);
assert.notEqual(wrapper.consistency.status,"green");
const checkpoint=scopedIncbOracleLedgerPayload(row,pin);
assert.equal(checkpoint.workNetworkValueQ8,pin.workNetworkValueQ8);
assert.equal(checkpoint.issuanceOnlyTxid,pin.txid);
for(const mutate of [
  w=>{w.snapshot_id="2".repeat(24);},w=>{w.payload.targetTxid="f".repeat(64);},
  w=>{w.payload.proofSha256="a".repeat(64);},w=>{w.source_hashes.canonicalSummary="f".repeat(64);},
  w=>{w.payload.sourceRowJson += " ";},w=>{w.generated_at="2026-09-26T00:00:00.000Z";},
  w=>{w.consistency.status="green";},w=>{w.source_hashes.scopedIncbOracle="f".repeat(64);},
]) {const w=structuredClone(wrapper);mutate(w);assert.throws(()=>verifiedScopedIncbOracleRow(w,pin));}
for(const mutate of [r=>{r.consistency.checks[0].ok=false;},r=>{r.payload.totals.workNetworkValueQ8="1";},
  r=>{r.payload.workSufficientState.tokenStateCommitment.sha256="a".repeat(64);},r=>{r.payload.snapshotId="2".repeat(24);}]) {
 const r=structuredClone(row);mutate(r);const text=JSON.stringify(r);
 assert.throws(()=>verifiedScopedIncbOracleSource(text,{...pin,sourceRowSha256:sha(text)}));
}
const transition={closing_state_sha256:pin.closingStateSha256,token_sha256:pin.tokenStateSha256,q8:pin.workNetworkValueQ8};
const client=(rows=[wrapper],transitions=[transition])=>({query:async sql=>({rows:sql.includes("work_amo_block_transitions")?transitions:rows})});
assert.equal((await storedScopedIncbOracle(client(),"livenet",pin)).source.snapshot_id,pin.snapshotId);
assert.equal(await storedScopedIncbOracle(client([]),"livenet",pin),null);
await assert.rejects(storedScopedIncbOracle(client([wrapper,wrapper]),"livenet",pin));
await assert.rejects(storedScopedIncbOracle(client([wrapper],[]),"livenet",pin));
await assert.rejects(storedScopedIncbOracle(client([wrapper],[{...transition,q8:"1"}]),"livenet",pin));
if (!SCOPED_INCB_ORACLE_PIN) {
 assert.throws(()=>scopedIncbOracleWrapper(raw));
 await assert.rejects(importScopedIncbOracle(),/not been approved and pinned/);
}


const full=postV5H1Fixture(POST_V5_INCB_H1_IMPORT_TARGETS[1],1);
while(full.row.consistency.checks.length<25) full.row.consistency.checks.push({name:"fixture-"+full.row.consistency.checks.length,ok:true});
full.row.payload.checks=structuredClone(full.row.consistency.checks);
const source={network:full.row.network,snapshot_id:full.row.snapshotId,generated_at:full.row.generatedAt,
  indexed_through_block:full.row.indexedThroughBlock,source_hashes:full.row.sourceHashes,
  metrics:full.row.metrics,consistency:full.row.consistency,payload:full.row.payload};
const sourceText=JSON.stringify(source),artifactText=sourceText+"\n";
const importPin={...full.witness,txid:POST_V5_INCB_ISSUANCE_REPAIR_TARGETS[1].txid,
  bondBlockHash:POST_V5_INCB_ISSUANCE_REPAIR_TARGETS[1].blockHash,sourceRowSha256:sha(sourceText),
  sourceArtifactSha256:sha(artifactText),closingStateSha256:source.payload.workSufficientState.closingStateCommitment.sha256,
  tokenStateSha256:source.payload.workSufficientState.tokenStateCommitment.sha256,
  sourceCommit:"1".repeat(40),sourceArchiveSha256:"2".repeat(64)};
const manifest=buildIncbRangeReplayWitnessManifest({bindingId:sha("binding"),createdAt:"2026-09-20T00:00:00.000Z",
  entries:[],network:"livenet",rangeReplayFromHeight:958383,throughHash:sha("witness"),throughHeight:968125});
const rebuild={network:"livenet",active:false,complete:true,status:"complete",mode:"pwt-range-replay",
  completedAt:"2026-09-27T00:00:00.000Z",rangeReplayFromHeight:958383,indexedThroughBlock:968200,indexedThroughBlockHash:sha("tip"),
  verifierBinding:{model:"proof-indexer-pwt-range-replay-verifier-binding-v1",network:"livenet",rangeReplayFromHeight:958383,
    bindingId:sha("binding"),witnessSetHash:manifest.commitment.hash,witnessSetMetaKey:incbRangeReplayWitnessMetaKey("livenet",sha("binding")),
    witnessCount:0,witnessPreserveCount:0,witnessedThroughBlock:968125,witnessedThroughBlockHash:sha("witness")},
  incbRangeReplayVerification:{verified:true,witnessSetHash:manifest.commitment.hash,witnessCount:0,witnessPreserveCount:0,
    consumedPreserveCount:0,rederivedWitnessCount:0}};
// The test witness tip is the target block, so its independent hash must agree.
rebuild.verifierBinding.witnessedThroughBlockHash=importPin.bondBlockHash;
const validManifest=buildIncbRangeReplayWitnessManifest({bindingId:sha("binding"),createdAt:"2026-09-20T00:00:00.000Z",
  entries:[],network:"livenet",rangeReplayFromHeight:958383,throughHash:importPin.bondBlockHash,throughHeight:968125});
rebuild.verifierBinding.witnessSetHash=validManifest.commitment.hash;
rebuild.incbRangeReplayVerification.witnessSetHash=validManifest.commitment.hash;
const proof={model:"canonical-incb-scoped-replay-proof-v1",txid:importPin.txid,sourceRowSha256:importPin.sourceRowSha256,
  sourceCommit:importPin.sourceCommit,sourceArchiveSha256:importPin.sourceArchiveSha256,rebuild,witnessManifest:validManifest};
const proofText=JSON.stringify(proof);importPin.proofSha256=sha(proofText);
const hashes=new Map([[importPin.height,importPin.blockHash],[importPin.height+1,importPin.bondBlockHash],[968200,sha("tip")]]);
const directory=await mkdtemp(join(tmpdir(),"incb-scoped-test-"));
try {
 const artifactPath=join(directory,"source.ndjson"),proofPath=join(directory,"proof.json");
 await writeFile(artifactPath,artifactText);await writeFile(proofPath,proofText);
 let stored=[],working=[],fault=false,wrongTransition=false;const queries=[];
 const db={release(){},async query(sql,args=[]) {
  const q=sql.replace(/\s+/g," ").trim();queries.push(q);
  if(q.startsWith("BEGIN")){working=structuredClone(stored);return {rows:[]};}
  if(q==="ROLLBACK"){working=structuredClone(stored);return {rows:[]};}
  if(q==="COMMIT"){stored=structuredClone(working);return {rows:[]};}
  if(q.startsWith("SET ") || q.startsWith("LOCK "))return {rows:[]};
  if(q.includes("FROM proof_indexer.meta"))return {rows:[{key:"canonical:rebuild",value:{network:"livenet",active:false,complete:true,
    status:"complete",completedAt:rebuild.completedAt,indexedThroughBlock:968200,indexedThroughBlockHash:sha("tip")}},
    ...(fault?[{key:"canonical:fault",value:{network:"livenet",active:true}}]:[])]};
  if(q.includes("AS eligible"))return {rows:[{eligible:true}]};
  if(q.startsWith("INSERT INTO proof_indexer.ledger_snapshots")){working.push({network:args[0],snapshot_id:args[1],generated_at:args[2],indexed_through_block:args[3],
    source_hashes:JSON.parse(args[4]),metrics:JSON.parse(args[5]),consistency:JSON.parse(args[6]),payload:JSON.parse(args[7])});return {rows:[],rowCount:1};}
  if(q.includes("FROM proof_indexer.work_amo_block_transitions"))return {rows:[{closing_state_sha256:importPin.closingStateSha256,
    token_sha256:importPin.tokenStateSha256,q8:wrongTransition?"1":importPin.workNetworkValueQ8}]};
  if(q.includes("FROM proof_indexer.ledger_snapshots"))return {rows:structuredClone(working)};
  throw new Error("unexpected scoped import query: "+q.slice(0,80));
 }};
 const options={artifactPath,proofPath,pin:importPin,pool:{connect:async()=>db},rpc:async h=>hashes.get(h)};
 const dry=await importScopedIncbOracle(options);assert.equal(dry.state,"ready");assert.equal(stored.length,0);assert.equal(queries.at(-1),"ROLLBACK");
 await assert.rejects(importScopedIncbOracle({...options,apply:true}),/apply environment/);
 fault=true;await assert.rejects(importScopedIncbOracle(options),/active canonical fault/);assert.equal(stored.length,0);fault=false;
 wrongTransition=true;await assert.rejects(importScopedIncbOracle(options),/approved independent replay proof/);assert.equal(stored.length,0);wrongTransition=false;
 const applied=await importScopedIncbOracle({...options,apply:true,env:{POW_IMPORT_SCOPED_INCB_ORACLE_APPLY:"1"}});
 assert.equal(applied.inserted,1);assert.equal(stored.length,1);assert.equal(applied.publicSummaryAdmitted,false);
 const repeat=await importScopedIncbOracle({...options,apply:true,env:{POW_IMPORT_SCOPED_INCB_ORACLE_APPLY:"1"}});
 assert.equal(repeat.state,"already-applied");assert.equal(repeat.inserted,0);assert.equal(stored.length,1);
 assert.ok(queries.every(q=>! /^(UPDATE|DELETE)\b/.test(q)),"existing history must never be updated or deleted");
 stored[0].payload.targetTxid="0".repeat(64);await assert.rejects(importScopedIncbOracle(options),/approved independent replay proof/);
 await writeFile(proofPath,proofText+" ");await assert.rejects(importScopedIncbOracle(options),/digest mismatch/);
} finally {await rm(directory,{recursive:true,force:true});}
console.log("Scoped INCB oracle isolation, provenance, rollback and idempotency checks passed.");
