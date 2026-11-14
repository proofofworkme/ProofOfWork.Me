import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const source=readFileSync(new URL("./check-activity-fee-factor-live.mjs",import.meta.url),"utf8");
// Execute only the actual final assertion block, never network/process operations.
const start=source.indexOf("assert.equal(lifecycle.publicationHealthy, true);");
const end=source.indexOf("console.log(JSON.stringify({ ok: true",start);
assert(start>=0&&end>start);
const verify=new Function("assert","lifecycle","commit",source.slice(start,end));
const commit="064b6991ae2a48e2069baedc767cd918d28ba052";
const fixture=()=>({publicationHealthy:true,retentionComplete:true,
 pair:{current:commit.slice(0,12)+"-20261114T020148Z",previous:"e266342ecc35-20261113T010000Z"},
 unfinishedIntents:[],
 verifiedPreservedRelease1042:{releaseId:"1042efea2aa1-20261112T074918Z"},
 verifiedPreservedFallback:{releaseId:"c3969c39c2b2-20261101T051206Z"},
 verifiedCapacityFloor:{rootReserveBytes:8*1024**3,growthReserveBytes:64*1024**2}});
test("verified historical hold survives legitimate rolling previous rotation",()=>verify(assert,fixture(),commit));
for(const [name,change] of [
 ["missing held1042 proof",s=>delete s.verifiedPreservedRelease1042],
 ["wrong held1042",s=>s.verifiedPreservedRelease1042.releaseId="wrong"],
 ["unhealthy publication",s=>s.publicationHealthy=false],
 ["incomplete retention",s=>s.retentionComplete=false],
 ["wrong current commit",s=>s.pair.current="different-release"],
 ["unfinished intent",s=>s.unfinishedIntents=["pending"]],
 ["missing fallback hold",s=>delete s.verifiedPreservedFallback],
 ["changed root reserve",s=>s.verifiedCapacityFloor.rootReserveBytes=0],
 ["changed growth reserve",s=>s.verifiedCapacityFloor.growthReserveBytes=0],
]) test("live retention contract rejects "+name,()=>{const s=fixture();change(s);assert.throws(()=>verify(assert,s,commit));});
test("old previous ID alone cannot substitute for verified preservation",()=>{
 const s=fixture();s.pair.previous="1042efea2aa1-20261112T074918Z";
 delete s.verifiedPreservedRelease1042;assert.throws(()=>verify(assert,s,commit));
});
