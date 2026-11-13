// Read-only post-deployment check. Does not activate capabilities or write data.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
const commit=execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim();
async function read(url,max=8*1024*1024) {
  const response=await fetch(url,{redirect:"error",cache:"no-store",signal:AbortSignal.timeout(30_000)});
  assert.equal(response.status,200,`${url}: ${response.status}`);
  let bytes=0;const chunks=[];
  for await(const chunk of response.body) { bytes+=chunk.length;assert.ok(bytes<=max,"Verification response too large");chunks.push(chunk); }
  return Buffer.concat(chunks).toString("utf8");
}
const verified=[];
for(const host of ["growth","computer"]) {
  const base=`https://${host}.proofofwork.me`;
  const source=JSON.parse(await read(base+"/source-provenance.json",65536));
  assert.equal(source.commit,commit);assert.equal(source.trackedDirty,false);
  const html=await read(base+"/",1024*1024);
  const entry=/<script[^>]+type="module"[^>]+src="(\/assets\/[A-Za-z0-9_-]+\.js)"/u.exec(html)?.[1];
  assert.ok(entry,"Missing application entry");
  const bootstrap=await read(base+entry);
  const refs=[...bootstrap.matchAll(/["'](?:\.\/|assets\/)(App-[A-Za-z0-9_-]+\.js)["']/gu)].map(m=>m[1]);
  assert.ok(refs.length>0,"No App module reference");
  const app=await read(base+"/assets/"+[...new Set(refs)][0]);
  assert.ok(app.includes("2026-11-12-products-v2"),"Missing current-product model");
  assert.ok(app.includes("Current products"),"Missing selector label");
  assert.ok(app.includes("October comparison"),"Historical comparison was lost");
  assert.ok(app.includes("Illustrative fee rate") && app.includes("historical assumption was 0.00001"),"Material fee scenario change is not disclosed");
  verified.push(host);
}
// A display model must not replace the canonical live value served to WORK.
const base="https://growth.proofofwork.me";
let parity=false;
for(let attempt=0;attempt<3&&!parity;attempt++) {
  const [growth,work]=await Promise.all(["growth-summary","work-floor"].map(path=>read(`${base}/api/v1/${path}?network=livenet`).then(JSON.parse)));
  if(growth.snapshotId!==work.snapshotId) continue;
  assert.ok(growth.snapshotId,"Missing canonical snapshot");
  assert.equal(growth.indexedThroughBlockHash,work.indexedThroughBlockHash);
  const left=growth.actualValue,right=work.actualValue;
  assert.ok(left&&right,"Missing canonical value payload");
  for(const key of ["liveNetworkValueQ8","liveTotalQ8"]) {
    assert.match(String(left[key]),/^\d+$/u,`Missing exact ${key}`);
    assert.equal(String(left[key]),String(right[key]),`Canonical ${key} diverged`);
  }
  parity=true;
}
assert.ok(parity,"No common canonical snapshot across bounded checks; retry when caught up");
console.log(JSON.stringify({ok:true,commit,verified,canonicalParity:true,scope:"public current-product scenario bundles, historical selector and exact current WORK/Growth value parity"}));
