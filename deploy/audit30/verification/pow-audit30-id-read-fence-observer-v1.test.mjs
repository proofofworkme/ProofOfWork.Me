import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import test from 'node:test';
const original = fs.readFileSync('/home/sixer/ProofOfWork.Me/scripts/audit-id-registry.mjs', 'utf8');
const observer = fs.readFileSync('/tmp/pow-audit30-id-read-fence-observer-v1.mjs', 'utf8');
const body = original.slice(original.indexOf('async function fetchJson('), original.indexOf('\nasync function fetchAddressTransactionsPage'));
const replacement = `    return response.json().then((audit30Payload) => {
      audit30ObserveReadFence(url, config, audit30Payload);
      return audit30Payload;
    });`;
const modified = body.replace('    return response.json();', replacement);
const url = 'http://127.0.0.1:18081/api/v1/internal/id-registry-audit?network=livenet';
const final = 'http://127.0.0.1:18081/api/v1/internal/id-registry-audit-fence?network=livenet';
const config = { production:true, apiBase:'http://127.0.0.1:18081', internalVerifierToken:'x'.repeat(32), timeoutMs:1000, coverageTimeoutMs:600000, retries:0, retryDelayMs:0 };
function fence() {
 const f={indexScanSnapshotId:'private-snapshot-id',indexScanStatus:'block-scan-current'};
 for (const k of ['checkpointHash','confirmedTxidsSha256','electrumCheckpointHash','electrumHeaderSha256','pendingMempoolTimeSha256','pendingTxidsSha256','registryProjectionSha256','relationalRowsSha256','snapshotSha256','transitionSha256','fenceSha256']) f[k]='a'.repeat(64);
 for (const k of ['checkpointHeight','confirmedTxidCount','electrumCheckpointHeight','pendingTxidCount','transitionCount']) f[k]=42;
 return f;
}
function load({payload={network:'livenet',coverage:{readFence:fence()}},failure=null,status=200,emitFailure=false, source=modified}={}) {
 const log=[],counts={fetch:0,json:0,sleep:0};
 const response={ok:status===200,status,json(){counts.json++;return failure ? Promise.reject(failure):Promise.resolve(payload);}};
 const transport=async()=>{counts.fetch++;return response;};
 const context=vm.createContext({createHash,Buffer,URL,performance,AbortSignal,console:{log(x){if(emitFailure)throw new Error('observer output failure');log.push(x);}},fetch:transport,
 fetchLoopbackAuditCoverageResponse:transport,sleep:async()=>{counts.sleep++;},isLoopbackApiBase:()=>true,hasExactOrigin:()=>true,
 isExactLoopbackAuditCoverageUrl(value,c){const u=new URL(value);return c.production===true&&u.origin===c.apiBase&&u.search==='?network=livenet'&&[new URL(url).pathname,new URL(final).pathname].includes(u.pathname);}});
 const funcs=new vm.Script(observer+'\n'+source+'\n({fetchJson,audit30SafeReadFenceObservation,audit30ObserveReadFence})').runInContext(context);
 return { ...funcs,counts,log,payload };
}
test('existing JSON resolution occurs once and exact original payload identity returned',async()=>{const x=load();assert.equal(await x.fetchJson(url,config,0,600000),x.payload);assert.deepEqual(x.counts,{fetch:1,json:1,sleep:0});assert.equal(x.log.length,1);});
test('original parse rejection identity and no retry are preserved even generic retry setting',async()=>{const error=new TypeError('original parse failure');for(const retries of [0,2])for(const source of [body,modified]){const x=load({failure:error,source});await assert.rejects(x.fetchJson(url,{...config,retries},0,600000),e=>e===error);assert.deepEqual(x.counts,{fetch:1,json:1,sleep:0});assert.equal(x.log.length,0);}});
test('non-OK transport error retains original message, no JSON/observation parse',async()=>{for(const source of [body,modified]){const x=load({status:503,source});await assert.rejects(x.fetchJson(url,config,0,600000),{message:url+' returned 503'});assert.equal(x.counts.json,0);assert.equal(x.log.length,0);}});
test('observer output error never replaces payload',async()=>{const x=load({emitFailure:true});assert.equal(await x.fetchJson(url,config,0,600000),x.payload);});
test('only exactly two approved route reads observed, arbitrary response fields omitted',async()=>{const x=load();await x.fetchJson('http://127.0.0.1:18081/api/v1/address/private/txs/chain?network=livenet',config);await x.fetchJson(url,config);await x.fetchJson(final,config);await x.fetchJson(url,config);assert.equal(x.log.length,2);for(const raw of x.log){assert.ok(Buffer.byteLength(raw)<8192);assert.ok(!raw.includes('private-snapshot-id'));assert.ok(!raw.includes('internalVerifierToken'));}});
test('missing fence yields bounded missing shape without changing later original error',async()=>{const x=load({payload:{network:'livenet',password:'private',memo:'private'}});assert.equal(await x.fetchJson(url,config),x.payload);const row=JSON.parse(x.log[0].slice('POW_AUDIT30_READ_FENCE '.length));assert.equal(row.shape,'missing');assert.ok(!x.log[0].includes('private'));});
test('all exact hashes and integers are captured plus only snapshot digest/length',()=>{const x=load();const row=x.audit30SafeReadFenceObservation(url,config,x.payload);assert.equal(row.kind,'coverage');assert.equal(row.fields.checkpointHeight,42);assert.equal(row.fields.fenceSha256,'a'.repeat(64));assert.equal(row.fields.indexScanSnapshotIdSha256,createHash('sha256').update('private-snapshot-id').digest('hex'));assert.equal(row.fields.indexScanSnapshotIdBytes,19);assert.equal(row.invalidFields.length,0);assert.ok(!JSON.stringify(row).includes('private-snapshot-id'));});
test('final route reads direct or nested fence without merging unrelated fields',()=>{for(const nested of [true,false]){const p={network:'livenet',...(nested?{coverage:{readFence:fence()}}:{readFence:fence()})};const x=load({payload:p});const row=x.audit30SafeReadFenceObservation(final,config,p);assert.equal(row.kind,'final-fence');assert.equal(row.invalidFields.length,0);}});
test('malformed strings/counts/status only fixed field names, no raw content',()=>{const f=fence();f.checkpointHash='private';f.pendingTxidCount='private';f.indexScanStatus='private';f.indexScanSnapshotId='private'.repeat(4097);const x=load({payload:{network:'livenet',coverage:{readFence:f}}});const row=x.audit30SafeReadFenceObservation(url,config,x.payload);assert.deepEqual(Array.from(row.invalidFields).sort(),['checkpointHash','indexScanSnapshotId','indexScanStatus','pendingTxidCount']);assert.ok(!JSON.stringify(row).includes('private'));});
test('negative/fractional/unsafe integer and upper-case hash values not exported',()=>{const f=fence();f.checkpointHeight=-1;f.confirmedTxidCount=1.2;f.pendingTxidCount=Number.MAX_SAFE_INTEGER+1;f.fenceSha256='A'.repeat(64);const x=load({payload:{network:'livenet',coverage:{readFence:f}}});assert.equal(x.audit30SafeReadFenceObservation(url,config,x.payload).invalidFields.length,4);});
test('private unrelated properties never emitted',()=>{const p={network:'livenet',password:'secret',privateBody:'secret',coverage:{readFence:{...fence(),memo:'secret',address:'secret',data:'secret'}}};const x=load({payload:p});assert.ok(!JSON.stringify(x.audit30SafeReadFenceObservation(url,config,p)).includes('secret'));});
test('source only replaces exactly one return and original comparator/deadlines unchanged',()=>{assert.equal(original.split('    return response.json();').length,2);assert.equal(modified.replace(replacement,'    return response.json();'),body);assert.ok(original.includes('before.readFence.fenceSha256 !== afterFence.fenceSha256'));assert.ok(original.includes('timeoutMs > 600_000'));assert.equal(observer.includes('fetch('),false);});
