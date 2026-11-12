import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import { createHash } from "node:crypto";
const source = readFileSync(new URL("../server/db/proof-index-reader.mjs", import.meta.url), "utf8");
const start = source.indexOf("export async function proofIndexCanonicalActivityPayload(");
const body = source.slice(start, source.indexOf("\nfunction eventHistoryFilters(", start)).replace("export ", "");
const pendingStart = source.indexOf("function pendingLogSnapshotTimeSql(");
const pending = source.slice(pendingStart, source.indexOf("\n}\n", pendingStart) + 3);
const golden = JSON.parse(readFileSync(new URL("./fixtures/activity-fee-factor-contract.json", import.meta.url), "utf8"));
const snapshotTime = "2026-11-12T00:00:00.000Z";
const scenarios = [
 ["live", "livenet", {}],
 ["testnet", "testnet", {}],
 ["confirmed", "livenet", {includePending:false}],
 ["snapshot", "livenet", {snapshotId:"snapshot"}],
 ["snapshot-confirmed", "livenet", {snapshotId:"snapshot",includePending:false}],
 ["membership", "livenet", {snapshotId:"snapshot",eventIds:[2,7,2]}],
 ["replay", "livenet", {includePending:false,replayCheckpointHeight:975515,replayCheckpointHash:"a".repeat(64)}],
];
async function capture(network, options) {
 let query;
 const stop = new Error("capture only");
 const context = vm.createContext({
  WORK_AMO_V5_ACTIVATION_HEIGHT:959621,
  proofIndexPool:()=>({query:async(sql,params)=>{query={sql,params};throw stop;}}),
  PUBLIC_LOG_EVENT_KINDS:new Set(["mail","token-mint"]),
  normalizedLowerText:value=>String(value??"").trim().toLowerCase(),
  rowNumber:(row,key)=>Number(row?.[key]??0),
  ledgerSnapshotMetadata:async()=>({indexed_through_block:975515,generated_at:snapshotTime}),
  canonicalStateMetaFromPool:async()=>({rebuild:{network:"livenet",mode:"pwt-range-replay",status:"active",active:true,complete:false,rangeReplayFromHeight:958383,indexedThroughBlock:975515,indexedThroughBlockHash:"a".repeat(64)}}),
 });
 vm.runInContext(pending+"\n"+body+"\nthis.invoke=proofIndexCanonicalActivityPayload;",context);
 try {await context.invoke(network,options);}catch(error){if(error!==stop)throw error;}
 return query;
}
const sha = value=>createHash("sha256").update(value).digest("hex");
for(const [name,network,options] of scenarios) {
 test("fee factoring preserves dynamic "+name+" query contract",async()=>{
  const {sql,params}=await capture(network,options);
  const selected=sql.slice(sql.indexOf("WITH selected_events"),sql.indexOf("      selected_txids AS"));
  const main=sql.indexOf("\n      SELECT\n        e.payload");
  const projection=sql.slice(main,name==="live" ? sql.indexOf("        CASE WHEN e.status",main) : sql.indexOf("        CASE\n          WHEN e.status = 'confirmed'",sql.indexOf("        e.record_ordinal,",main)));
  assert.equal(sha(name === "live" ? selected.replace("selected_events AS NOT MATERIALIZED (", "selected_events AS (") : selected),golden[name].selected);
  assert.equal(sha(projection),golden[name].projection);
  assert.equal(sha(sql.slice(sql.lastIndexOf("      ORDER BY"))),golden[name].tail);
  assert.deepEqual(JSON.parse(JSON.stringify(params)),golden[name].params);
  if(name!=="live"){
   assert.equal(sha(sql),golden[name].full,"non-live mode SQL must remain byte-for-byte original");
   assert.equal((sql.match(/transaction_fee_evidence AS MATERIALIZED/g)||[]).length,0);
   return;
  }
  assert.equal((sql.match(/transaction_fee_evidence AS MATERIALIZED/g)||[]).length,1);
  assert.equal((sql.match(/jsonb_typeof\(transaction_row.raw_tx\) = 'object'/g)||[]).length,1);
  assert.match(sql,/transaction_fee_admission AS MATERIALIZED/);
  assert.match(sql,/CASE WHEN selected.fee_admitted THEN CASE/);
  assert.match(sql,/GROUP BY qualifying_event.txid/);
  assert.match(sql,/selected_events AS NOT MATERIALIZED/);
  for (const alias of ['e','i','o','qualifying_transaction','transaction_row','canonical_block']) {
   assert.ok(sql.includes(alias+'.network = $1'), 'single-network base restriction '+alias);
  }
  assert.doesNotMatch(sql,/selected\.network|fee_evidence\.network|input_totals\.network|output_totals\.network/);

  assert.match(sql,/qualifying_event.status = 'confirmed'/);
  assert.match(sql,/qualifying_event.block_height IS NULL\s+OR qualifying_event.block_height = qualifying_transaction.block_height/);
  assert.match(sql,/CASE WHEN e.status = 'confirmed' AND \(e.block_height IS NULL OR e.block_height = transaction_row.block_height\) THEN fee_evidence.fee_sats ELSE NULL END AS canonical_miner_fee_sats/);
  if(options.snapshotId){
   assert.equal((sql.match(/transaction_row.updated_at <= \$4::timestamptz/g)||[]).length,2);
   assert.equal((sql.match(/canonical_block.indexed_at <= \$4::timestamptz/g)||[]).length,2);
  }
 });
}
test("invalid membership and replay modes remain rejected before query",async()=>{
 for(const options of [{eventIds:[]},{eventIds:[0]},{eventIds:Array.from({length:501},(_,i)=>i+1)},{snapshotId:"bad id"},{replayCheckpointHeight:975515,replayCheckpointHash:"a".repeat(64)},{includePending:false,replayCheckpointHeight:975515,replayCheckpointHash:"wrong"}]){
  assert.equal(await capture("livenet",options),undefined);
 }
 assert.equal(await capture("testnet",{includePending:false,replayCheckpointHeight:975515,replayCheckpointHash:"a".repeat(64)}),undefined);
});
