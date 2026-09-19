import fs from 'node:fs';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
const dir=process.argv[2];
const receipt=JSON.parse(fs.readFileSync(dir+'/receipt.json'));assert.equal(receipt.ok,true);
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const payloads=receipt.receipts.filter(r=>r.kind==='http').map(r=>{
 assert.match(r.file,/^\d+-http\.json\.gz$/);const b=zlib.gunzipSync(fs.readFileSync(dir+'/'+r.file));assert.equal(sha(b),r.sha256);return {request:r.request,body:JSON.parse(b)};
});
const registry=payloads.find(p=>new URL(p.request,'http://localhost').pathname==='/api/v1/registry' && Array.isArray(p.body.records))?.body;assert.ok(registry);
const owners=registry.records.filter(r=>r.confirmed===true).map(r=>[r.id.trim().toLowerCase().replace(/^@/u,'').replace(/@proofofwork\.me$/u,'').trim(),r.ownerAddress]);owners.sort(([a],[b])=>Buffer.compare(Buffer.from(a),Buffer.from(b)));assert.equal(new Set(owners.map(r=>r[0])).size,owners.length);
const boosts=payloads.filter(p=>new URL(p.request,'http://localhost').pathname==='/api/v1/boost');assert.ok(boosts.length>=2);
for(const {body} of boosts){assert.equal(body.indexedThroughBlock,registry.indexedThroughBlock);assert.equal(body.indexedThroughBlockHash,registry.indexedThroughBlockHash);const p=body.provenance.identityRegistry;assert.equal(p.model,'boost-current-confirmed-id-owners-v1');assert.equal(p.registrySnapshotId,registry.snapshotId);assert.equal(p.snapshotId,body.snapshotId);assert.equal(p.confirmedOwnerCount,owners.length);assert.equal(p.ownersSha256,sha(JSON.stringify(owners)));assert.deepEqual(body.provenance.applicationRejectedIdentityClaims,[]);}
console.log(JSON.stringify({ok:true,probe:dir,checkpoint:{height:registry.indexedThroughBlock,hash:registry.indexedThroughBlockHash},confirmedOwners:owners.length,ownersSha256:sha(JSON.stringify(owners)),boostResponses:boosts.length,registrySnapshotId:registry.snapshotId,boostSnapshotIds:[...new Set(boosts.map(p=>p.body.snapshotId))],qualification:'Receipt-bound registry/Boost consistency; canonical ID ownership independently checked by strict ID lifecycle audit.'},null,2));
