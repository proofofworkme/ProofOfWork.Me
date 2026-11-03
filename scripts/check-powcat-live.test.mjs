import test from "node:test";
import assert from "node:assert/strict";
import { checkInventory, checkExactRecord } from "./check-powcat-live.mjs";

const checkpointHeight = 974337, checkpointHash = "a".repeat(64), txid = "b".repeat(64);
const stats = { parts:"1", publications:"0", network:"livenet", source:"powcat1-discovery-v1", complete:true,
  fromHeight:973975, indexedThroughBlock:checkpointHeight, indexedThroughBlockHash:checkpointHash };
const blockHash = "d".repeat(64), partHash = "f".repeat(64), fileHash = "c".repeat(64);
const record = { kind:"powcat-part", protocol:"powcat1", txid, status:"confirmed", valid:true, canonical:true, blockHash };
const powcat = { partHash, fileHash, count:1, index:0, size:123 };
const witness = { ready:true, checkpointHash, checkpointHeight, confirmedParts:1, confirmedLinkers:0 };
const coverage = { ready:true, checkpointHash, checkpointHeight, linkedFiles:witness,indexVersion:"proof-search-v5-powcat-files" };
function result(kind, count) {
  const search = { coverage, network:"livenet", results:count?[record]:[], pagination:{returned:count,total:count} };
  const log = { network:"livenet", kind, totalCount:count, query:txid,
    indexedThroughBlock:checkpointHeight,indexedThroughBlockHash:checkpointHash,
    linkedFiles:{ source:stats.source,fromHeight:stats.fromHeight,confirmedCount:String(count),confirmedOnly:true,checkpointHash,checkpointHeight },
    items:count?[{...record,confirmed:true,powcat}]:[] };
  return {search,log};
}
test("zero confirmed publications still require typed Log evidence, matching cohort and the exact block", () => {
  const {search,log} = result("powcat-linker", 0);
  const verify = (s,l) => checkInventory("powcat-linker",stats,s,l);
  verify(search,log);
  assert.throws(() => verify(search,{...log,linkedFiles:undefined}));
  assert.throws(() => verify(search,{...log,indexedThroughBlockHash:"e".repeat(64)}));
  assert.throws(() => verify(search,{...log,linkedFiles:{...log.linkedFiles,confirmedOnly:false}}));
  assert.throws(() => verify({...search,coverage:{...coverage,linkedFiles:{...witness,confirmedParts:0}}},log));
});
test("nonempty typed counts must return one valid confirmed row on each surface", () => {
  const {search,log} = result("powcat-part", 1);
  const verify = (s,l) => checkInventory("powcat-part",stats,s,l);
  verify(search,log);
  assert.throws(() => verify({...search,results:[]},log));
  assert.throws(() => verify(search,{...log,items:[]}));
  assert.throws(() => verify(search,{...log,items:[{...record,confirmed:false,status:"pending"}]}));
});
test("exact lookup binds transaction, block, file and chunk identity", () => {
  const {log} = result("powcat-part", 1);
  const detail = {record,coverage,payload:{powcat}};
  checkExactRecord("powcat-part",txid,checkpointHash,detail,log);
  assert.throws(() => checkExactRecord("powcat-part",txid,checkpointHash,detail,{...log,query:""}));
  assert.throws(() => checkExactRecord("powcat-part",txid,checkpointHash,detail,{...log,items:[]}));
  for (const field of ["partHash","fileHash"]) {
    assert.throws(() => checkExactRecord("powcat-part",txid,checkpointHash,detail,{
      ...log,items:[{...log.items[0],powcat:{...powcat,[field]:"9".repeat(64)}}],
    }));
  }
});
