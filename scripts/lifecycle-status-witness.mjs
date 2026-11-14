// One collection, two full stock lifecycle scans. Not a cached status API.
import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {performance} from "node:perf_hooks";
import {fileURLToPath} from "node:url";
import {resolve} from "node:path";
import {createIdentityProof,requireIdentityProof,publicIdentityProof} from "./release-identity-proof.mjs";
const witnesses=new WeakMap(),activeProofs=new WeakMap();
export function parseStockStatus(raw,limit=8*1024**2) {
 assert.equal(typeof raw,"string");assert(Buffer.byteLength(raw)<=limit,"Oversized collection response");
 const result=JSON.parse(raw);assert(result&&typeof result==="object"&&!Array.isArray(result),"Collection object required");
 // JSON.parse accepts duplicate properties. Scan already syntax-validated JSON
 // solely to reject ambiguous keys, including escaped spellings and nesting.
 let i=0;
 const white=()=>{while(i<raw.length&&/\s/u.test(raw[i]))i++;};
 const string=()=>{const start=i++;while(i<raw.length){if(raw.charCodeAt(i)===92){i+=2;continue;}if(raw.charCodeAt(i++)===34)break;}return JSON.parse(raw.slice(start,i));};
 const scan=depth=>{
  assert(depth<=128,"Collection nesting limit");white();
  if(raw[i]==="{"){i++;white();const seen=new Set();if(raw[i]==="}"){i++;return;}
   while(true){white();const key=string();assert(!seen.has(key),"Duplicate collection JSON key");seen.add(key);white();i++;scan(depth+1);white();if(raw[i++]==="}")return;}
  }
  if(raw[i]==="["){i++;white();if(raw[i]==="]"){i++;return;}while(true){scan(depth+1);white();if(raw[i++]==="]")return;}}
  if(raw[i]==='"'){string();return;}
  while(i<raw.length&&!/[\s,}\]]/u.test(raw[i]))i++;
 };
 scan(0);return result;
}
const root=fileURLToPath(new URL("../",import.meta.url)).replace(/\/$/u,"");
const env={PATH:"/usr/bin:/bin",HOME:"/nonexistent"};
const freeze=value=>{if(value&&typeof value==="object"){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
function identity(proof) {
 const p=requireIdentityProof(proof);
 assert.equal(resolve(p.repository),root);assert.equal(resolve(process.cwd()),root);
 const fresh=createIdentityProof({repository:root});
 const {verifiedAt:oldObservation,...expected}=publicIdentityProof(proof);
 const {verifiedAt:newObservation,...actual}=publicIdentityProof(fresh);
 // Identity proof observation time changes; every source/identity field must not.
 assert.deepEqual(actual,expected,"Lifecycle operator source proof changed");
 return p;
}
function complete(status,proof) {
 assert(status&&typeof status==="object"&&!Array.isArray(status));
 assert.equal(status.ok,true);assert.equal(status.initialized,true);
 assert.equal(status.publicationHealthy,true);assert.equal(status.retentionComplete,true);
 assert.equal(status.pending,null);assert.deepEqual(status.unfinishedIntents,[]);
 assert.equal(typeof status.pair?.current,"string");
 assert(status.pair.current.startsWith(proof.artifact.commit.slice(0,12)+"-"));
 for(const key of ["configSha256","stateSha256"])assert.match(status[key],/^[a-f0-9]{64}$/u);
 assert.deepEqual(status.binding?.config,{path:"/etc/proofofwork-retention/ui-lifecycle.json",sha256:status.configSha256});
 assert.deepEqual(status.binding?.state,{path:"/var/lib/proofofwork-ui-retention/state.json",sha256:status.stateSha256});
 assert.deepEqual(status.binding?.pair,status.pair);assert.deepEqual(status.context?.pair,status.pair);
 assert.match(status.index?.sha256,/^[a-f0-9]{64}$/u);
 assert.equal(status.verifiedPreservedRelease1042?.releaseId,"1042efea2aa1-20261112T074918Z");
 assert.equal(status.verifiedPreservedFallback?.releaseId,"c3969c39c2b2-20261101T051206Z");
 assert.equal(status.verifiedCapacityFloor?.rootReserveBytes,8*1024**3);
 assert.equal(status.verifiedCapacityFloor?.growthReserveBytes,64*1024**2);
 assert.deepEqual(status.binding?.capacityFloor,status.verifiedCapacityFloor);
 return status;
}
function readFullStatus(proof) {
 identity(proof);
 const raw=execFileSync("/usr/bin/python3",["-I","-B","deploy/ui-retention/lifecycle.py","status","--require-complete"],
  {cwd:root,encoding:"utf8",env,timeout:480000,maxBuffer:8*1024**2});
 const status=complete(parseStockStatus(raw),proof);
 identity(proof);
 return freeze(status);
}
function fresh(record) {
 const wall=Date.now()-record.wall,elapsed=performance.now()-record.monotonic;
 assert(wall>=0&&wall<=900000&&elapsed>=0&&elapsed<=900000,"Lifecycle witness expired or clock regressed");
}
function bound(witness,proof,phase) {
 const record=witnesses.get(witness);
 assert(record&&record.proof===proof&&record.phase===phase&&activeProofs.get(proof)===witness,"Authentic unused collection-bound lifecycle witness required");
 requireIdentityProof(proof);fresh(record);return record;
}
export function beginLifecycleCollection(proof) {
 requireIdentityProof(proof);
 const prior=activeProofs.get(proof);if(prior)witnesses.get(prior).phase="superseded";
 activeProofs.delete(proof);
 identity(proof);
 const wall=Date.now(),monotonic=performance.now();
 const status=readFullStatus(proof);
 const witness=Object.freeze({format:"stock-lifecycle-collection-witness-v1"});
 const record={proof,status,wall,monotonic,phase:"ready"};fresh(record);witnesses.set(witness,record);activeProofs.set(proof,witness);
 return Object.freeze({witness,status});
}
export function consumeActivityLifecycle(witness,proof) {
 const record=bound(witness,proof,"ready");
 record.phase="consumed"; // A failed activity cannot replay the witness.
 identity(proof);return record.status;
}
export function finishLifecycleCollection(witness,proof) {
 const record=bound(witness,proof,"consumed");
 record.phase="finished";activeProofs.delete(proof); // Failed/uncertain final scans require a new collection.
 const status=readFullStatus(proof);fresh(record);
 // Stock status contains authenticated context, guards, holds, package/controller
 // bindings, capacity authority and completion history. It has no live observedAt
 // or free-space counter. Do not drop nested timestamps or any unknown field.
 assert.deepEqual(status,record.status,"Full lifecycle evidence changed between independent scans");
 return status;
}
