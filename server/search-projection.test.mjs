import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildSearchDocument, exactProofs, searchSha256, searchAttachmentFromCarriers,
  verifiedSearchAttachment, verifiedSearchFileText, sameCanonicalSearchWitness,
  verifySearchCheckpoint, readSearchSources,
} from './search-projection.mjs';
import {
  normalizeSearchRequest, encodeSearchCursor, decodeSearchCursor,
  searchQueryFingerprint, searchPayload,
} from './db/search-reader.mjs';

const TXID='a'.repeat(64),HASH='b'.repeat(64);
function source(changes={}) {
  return {id:'event:1',sourceClass:'event',txid:TXID,protocol:'pwdns1',kind:'register',status:'confirmed',valid:true,
    canonical:true,amountSats:'9007199254740993',blockHeight:969829,blockHash:HASH,blockIndex:2,
    timestamp:'2026-10-04T00:00:00Z',participants:[{address:'bc1qrecipient',role:'owner',powid:'sixer'}],
    refs:[{type:'name',value:'search.pow'}],payload:{name:'search.pow'},...changes};
}
function attachment(text='export const evidence = "café 東京";') {
  const bytes=Buffer.from(text);
  return {name:'evidence.mjs',mime:'application/javascript',size:bytes.length,sha256:searchSha256(bytes),data:bytes.toString('base64url')};
}
function carriers(file) {
  const prefix=`pwm1:a:${Buffer.from(file.mime).toString('base64url')}:${Buffer.from(file.name).toString('base64url')}:${file.size}:${file.sha256}:`;
  const half=Math.floor(file.data.length/2);
  return [`${prefix}0/2:${file.data.slice(0,half)}`,`${prefix}1/2:${file.data.slice(half)}`];
}

test('every record identity, position, participant, name and exact proof quantity is searchable',()=>{
  const doc=buildSearchDocument(source(),HASH);
  for (const term of [TXID,HASH,'pwdns1','register','9007199254740993','969829','bc1qrecipient','sixer','search.pow']) assert.ok(doc.searchText.includes(term),term);
  assert.equal(doc.record.amountSats,'9007199254740993');
  assert.throws(()=>exactProofs('1e+21'));
  assert.throws(()=>exactProofs('1.5'));
  assert.throws(()=>exactProofs(-1));
  assert.throws(()=>exactProofs(Number.MAX_SAFE_INTEGER+1));
});
test('file text enters the index only after size and exact checksum verification',()=>{
  const file=attachment();
  const doc=buildSearchDocument(source({protocol:'pwm1',kind:'file',payload:{attachment:file}}),HASH);
  assert.equal(doc.record.file.verified,true);
  assert.ok(doc.searchText.includes('café 東京'));
  const invalid=buildSearchDocument(source({payload:{attachment:{...file,sha256:'c'.repeat(64)}}}),HASH);
  assert.equal(invalid.record.valid,false);
  assert.equal(invalid.record.file,undefined);
  assert.ok(invalid.record.validationErrors.includes('search-attachment-bytes-unverified'));
  assert.equal(verifiedSearchAttachment({...file,size:file.size+1}),null);
  const conflicting=buildSearchDocument(source({payload:{attachment:{...file,name:'other.mjs',data:undefined}},attachmentCarriers:carriers(file)}),HASH);
  assert.equal(conflicting.record.valid,false);
});
test('chunk reconstruction rejects duplicate, missing, conflicting and noncanonical encoding',()=>{
  const file=attachment(),parts=carriers(file);
  assert.equal(verifiedSearchFileText(searchAttachmentFromCarriers(parts)),Buffer.from(file.data,'base64url').toString());
  assert.equal(searchAttachmentFromCarriers([parts[0],parts[0]]),null);
  assert.equal(searchAttachmentFromCarriers(parts.slice(0,1)),null);
  assert.equal(searchAttachmentFromCarriers([parts[0],parts[1].replace(file.sha256,'d'.repeat(64))]),null);
  assert.equal(verifiedSearchAttachment({...file,data:file.data+'='}),null);
});
test('binary, invalid UTF-8 and NUL files do not become searchable text',()=>{
  assert.equal(verifiedSearchFileText(verifiedSearchAttachment(attachment('a\u0000b'))),'');
  const bytes=Buffer.from([0xff,0xfe]);
  assert.equal(verifiedSearchFileText(verifiedSearchAttachment({...attachment(),size:2,sha256:searchSha256(bytes),data:bytes.toString('base64url')})),'');
  assert.equal(verifiedSearchFileText(verifiedSearchAttachment({...attachment(),name:'image.png',mime:'image/png'})),'');
});
test('raw carriers remain unclassified instead of receiving semantic validation',()=>{
  const doc=buildSearchDocument(source({id:`carrier:${TXID}:1:0`,sourceClass:'carrier',kind:'raw-carrier',valid:null,rawPayload:'pwid1:list2:history'}),HASH);
  assert.equal(doc.record.valid,null);
  assert.ok(doc.searchText.includes('list2'));
});
test('checkpoint proof is fail-closed and cannot be replaced by caller metadata',async()=>{
  await verifySearchCheckpoint(async height=>{assert.equal(height,969829);return HASH;},'livenet',969829,HASH);
  await assert.rejects(()=>verifySearchCheckpoint(undefined,'livenet',969829,HASH),/unavailable/);
  await assert.rejects(()=>verifySearchCheckpoint(async()=>TXID,'livenet',969829,HASH),/no longer matches/);
  const witness={canonicalHash:HASH,confirmed:1,confirmedRecords:1,missingRawTransactions:0};
  assert.equal(sameCanonicalSearchWitness(witness,{...witness,confirmedRecords:2}),false);
});
test('bounded source reads select keys before constructing byte envelopes',async()=>{
  const calls=[];
  const result=await readSearchSources({query:async(sql,args)=>{calls.push({sql,args});return calls.length===1?{rowCount:1,rows:[{id:'event:1'}]}:{rows:[{id:'event:1'}]};}},'livenet',969829,'event:0',1);
  assert.equal(calls.length,2);
  assert.ok(calls[0].sql.includes('LIMIT $4'));
  assert.ok(!calls[0].sql.includes('jsonb_build_object'));
  assert.deepEqual(calls[1].args[2],['event:1']);
  assert.equal(result.length,1);
});
test('cursor preserves exact query inventory and rejects malformed offsets and encodings',()=>{
  const query=normalizeSearchRequest('livenet',new URLSearchParams({q:'search',limit:'2'}));
  const cursor={runId:'run',offset:2,queryHash:searchQueryFingerprint(query),sourceHash:HASH,checkpointHash:HASH};
  assert.deepEqual(decodeSearchCursor(encodeSearchCursor(cursor)),cursor);
  assert.throws(()=>decodeSearchCursor(encodeSearchCursor({...cursor,offset:-1})),/Invalid Search cursor/);
  assert.throws(()=>decodeSearchCursor(encodeSearchCursor(cursor)+'='),/Invalid Search cursor/);
  assert.throws(()=>normalizeSearchRequest('livenet',new URLSearchParams({limit:'51'})),/limit/);
});
test('pruned generations return an expired cursor conflict rather than a false building state',async()=>{
  const query=normalizeSearchRequest('livenet',new URLSearchParams({q:'search'}));
  const params=new URLSearchParams({q:'search',cursor:encodeSearchCursor({runId:'expired',offset:1,queryHash:searchQueryFingerprint(query),sourceHash:HASH,checkpointHash:HASH})});
  const client={query:async()=>({rows:[],rowCount:0}),release(){}};
  await assert.rejects(()=>searchPayload('livenet',params,{pool:{connect:async()=>client}}),error=>error.statusCode===409&&error.details.code==='SEARCH_CURSOR_EXPIRED');
});
test('unconfigured or disconnected databases report Search unavailable',async()=>{
  await assert.rejects(()=>searchPayload('livenet',new URLSearchParams(),{pool:{connect:async()=>{throw new Error('private connection diagnostics');}}}),error=>error.statusCode===503&&!error.message.includes('private'));
});
