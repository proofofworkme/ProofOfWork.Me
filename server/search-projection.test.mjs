import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  SEARCH_INDEX_VERSION, buildSearchDocument, exactProofs, searchSha256, searchAttachmentFromCarriers,
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
test('WORK tip observations retain exact token, subatoms and target references without proof conversion',()=>{
  const tokenId='d4e5ebf11d104d6a63fb74e42094364b25a5f7199a09e5c0e71408972466a8b8';
  const targetTxid='c'.repeat(64),amountSubatoms='123456789012345678901234';
  const refs=[{type:'boost',value:targetTxid},{type:'token',value:tokenId}];
  const rawPayload=`pwb1:tip2:${targetTxid}:${tokenId}:${amountSubatoms}`;
  const payload={title:'WORK content tip',tipCurrency:'WORK',tipWorkSubatoms:amountSubatoms,
    tokenId,targetTxid,authorAddress:'bc1qpayer',recipientAddress:'bc1qcontentowner'};
  const doc=buildSearchDocument(source({protocol:'pwb1',kind:'boost-tip',amountSats:'0',payload,refs,rawPayload}),HASH);
  assert.equal(doc.record.amountSats,'0');
  assert.deepEqual(doc.record.refs,refs);
  assert.equal(doc.payload.tipWorkSubatoms,amountSubatoms);
  assert.equal(doc.rawPayload,rawPayload);
  for (const term of [targetTxid,tokenId,amountSubatoms,'WORK','boost-tip','bc1qpayer','bc1qcontentowner'])
    assert.ok(doc.searchText.includes(term),term);
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
test('Code observations index verified carrier bytes and explicitly require repository replay',()=>{
  const file={...attachment('const chainSource = "verified";'),name:'source.txt',mime:'text/plain'};
  const payload={metadata:{v:1,repo:TXID,parent:TXID,op:'put',path:'src/main.mjs',message:'publish source',sha256:file.sha256,size:file.size},path:'src/main.mjs',source:{...file,content:'unverified injected words'}};
  const doc=buildSearchDocument(source({protocol:'pwc1',kind:'code-commit',amountSats:'0',payload,attachmentCarriers:carriers(file)}),HASH);
  assert.equal(doc.record.title,'src/main.mjs');
  assert.equal(doc.record.file.verified,true);
  assert.ok(doc.searchText.includes('chainSource'));
  assert.ok(!doc.searchText.includes('unverified injected words'));
  assert.equal(doc.record.codeAuthority.applied,null);
  assert.equal(doc.record.codeAuthority.requiresRepositoryReplay,true);
  const absent=buildSearchDocument(source({protocol:'pwc1',kind:'code-commit',payload}),HASH);
  assert.equal(absent.record.valid,false);
  assert.ok(!absent.searchText.includes('unverified injected words'));
});
test('zero-byte Code puts are verified without synthesizing a Files carrier',()=>{
  const sha256=searchSha256(Buffer.alloc(0));
  const doc=buildSearchDocument(source({protocol:'pwc1',kind:'code-commit',amountSats:'0',payload:{metadata:{size:0,sha256},source:{name:'source.txt',mime:'text/plain',size:0,sha256,data:''}}}),HASH);
  assert.equal(doc.record.valid,true);
  assert.equal(doc.record.file.verified,true);
  assert.equal(doc.record.file.size,0);
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

test('Page references index source identity without treating supplied text as verified bytes', () => {
  const metadata = { v: 2, repo: TXID, parent: TXID, op: 'reference', path: 'index.html', message: 'Existing page',
    sourceTxid: HASH, sourceKind: 'body', sourceVout: 2, sha256: HASH, size: 20 };
  const doc = buildSearchDocument(source({ protocol: 'pwc1', kind: 'code-commit', amountSats: '0',
    payload: { metadata, path: 'index.html', source: { content: 'unverified injected words', data: 'untrusted' } } }), HASH);
  assert.equal(doc.record.valid, true); assert.equal(doc.record.file, undefined);
  assert.equal(SEARCH_INDEX_VERSION, 'proof-search-v6-linked-publish-content');
  assert.equal(doc.evidence.indexVersion, SEARCH_INDEX_VERSION);
  assert.deepEqual(doc.record.sourceReference, { txid: HASH, kind: 'body', vout: 2, sha256: HASH, size: 20, verified: false });
  assert.equal(doc.record.codeAuthority.requiresRepositoryReplay, true);
  assert.ok(!doc.searchText.includes('unverified injected words'));
  assert.ok(doc.searchText.includes(HASH));
});

test('powcat metadata remains searchable, while every raw carrier and transaction copy omits file bytes', async () => {
  const { Transaction } = await import('bitcoinjs-lib');
  const { encodePowcatPart, encodePowcatManifest, powcatScript, powcatSha256 } = await import('../src/shared/protocol/powcat1.mjs');
  const { compactPowcatSearchSource } = await import('./search-powcat.mjs');
  const bytes=Buffer.alloc(96_000,0xde), fileHash=powcatSha256(bytes);
  const part=encodePowcatPart({fileHash,index:0,count:1,bytes});
  function txFor(payload) {
    const tx=new Transaction();tx.addInput(new Uint8Array(32).fill(5),0);tx.addOutput(powcatScript(payload),0n);return tx;
  }
  const tx=txFor(part), txid=tx.getId(), script=Buffer.from(tx.outs[0].script).toString('hex');
  const base={id:'carrier:'+txid,txid,status:'confirmed',valid:null,canonical:true,vout:0};
  const raw={id:'transaction:'+txid,...base,sourceClass:'transaction',protocol:'transaction',rawHex:tx.toHex(),payload:{hex:tx.toHex(),vout:[{scriptpubkey:script}]}};
  for (const source of [raw, {...base,sourceClass:'script',protocol:'unknown',scriptHex:script,rawHex:script,payload:{scriptHex:script}},
    {...base,sourceClass:'carrier',protocol:'unknown',scriptHex:script,rawPayload:'x'.repeat(120_000),rawHex:Buffer.from(part).toString('hex')},
    {...base,sourceClass:'event',protocol:'powcat1',kind:'powcat-part',valid:true,payload:{powcat:{fileHash,partHash:fileHash,index:0,count:1,size:96000,hex:script}}}]) {
    const doc=buildSearchDocument(source,'d'.repeat(64)), compact=compactPowcatSearchSource(source);
    assert.ok(doc.searchText.includes(fileHash));
    assert.ok(JSON.stringify(doc).length<6000 && JSON.stringify(compact).length<6000);
    assert.ok(!doc.searchText.includes('de'.repeat(64)));
    assert.ok(!doc.record.linkedFile);
  }
  const linker=txFor(encodePowcatManifest({fileHash,name:'test.bin',mime:'application/octet-stream',size:96000,partTxids:[txid]}));
  const link=buildSearchDocument({...base,id:'event:123',txid:linker.getId(),sourceClass:'event',protocol:'powcat1',kind:'powcat-linker',valid:true,
    payload:{powcat:{fileHash,name:'test.bin',mime:'application/octet-stream',size:96000,partTxids:[txid]}}},'c'.repeat(64));
  assert.equal(link.record.linkedFile.txid,linker.getId());assert.equal(link.record.title,'test.bin');
  assert.ok(link.searchText.includes(txid) && link.searchText.includes(fileHash));
  const invalid=buildSearchDocument({...base,sourceClass:'carrier',scriptHex:script.slice(0,-2),rawHex:script},'d'.repeat(64));
  assert.equal(invalid.payload.powcat.kind,'malformed');assert.equal(invalid.record.valid,null);assert.ok(invalid.searchText.length<3000);
});

test('ordinary verified Mail attachment exposes the exact linker and file hash without borrowing target validity', async () => {
  const {buildPowcatMailAttachment}=await import('../src/shared/protocol/powcatMail.mjs');
  const txid='a'.repeat(64),fileHash='b'.repeat(64),attachment=buildPowcatMailAttachment({txid,fileHash,name:'Mail files'});
  const to64=text=>Buffer.from(text).toString('base64url');
  const part=`pwm1:a:${to64(attachment.mime)}:${to64(attachment.name)}:${attachment.size}:${attachment.sha256}:0/1:${attachment.data}`;
  const source={id:'event:pointer',sourceClass:'event',txid:'c'.repeat(64),canonical:true,status:'confirmed',valid:true,protocol:'pwm1',kind:'file',
    payload:{attachment,subject:'Historical Mail subject'},attachmentCarriers:[part]};
  const doc=buildSearchDocument(source,'d'.repeat(64));
  assert.deepEqual(doc.record.linkedFile,{type:'mail-pointer',txid,fileHash,name:attachment.name});
  assert.ok(doc.searchText.includes('Historical Mail subject'));assert.ok(doc.searchText.includes(txid));assert.ok(doc.searchText.includes(fileHash));
  assert.equal(buildSearchDocument({...source,attachmentCarriers:[]},'c'.repeat(64)).record.linkedFile,undefined);
});

test('linked Files coverage requires the exact confirmed Search checkpoint', async () => {
  const {searchPowcatCoverage}=await import('./search-powcat.mjs');
  const state={model:'powcat1-discovery-v1',network:'livenet',fromHeight:973975,anchorHash:'0000000000000000000197a8d7eeab4e20eae8693e7bb933edd89a75031933e3',
    indexedThroughBlock:973979,indexedThroughBlockHash:'a'.repeat(64),complete:true,confirmedParts:0,confirmedLinkers:0};
  const db={query:async()=>({rows:[{value:state}]})};
  assert.equal((await searchPowcatCoverage(db,'livenet',973979,'a'.repeat(64))).ready,true);
  assert.equal((await searchPowcatCoverage(db,'livenet',973978,'a'.repeat(64))).ready,false);
  assert.equal((await searchPowcatCoverage(db,'livenet',973979,'b'.repeat(64))).ready,false);
  state.complete=false; assert.equal((await searchPowcatCoverage(db,'livenet',973979,'a'.repeat(64))).ready,false);
});

test('an observed zero does not certify a generation built before discovery, and stored typed rows must agree', async () => {
  const {qualifiedPowcatSearchCoverage: coverage}=await import('./search-powcat.mjs');
  const linkedFiles={ready:true,checkpointHeight:974000,checkpointHash:'a'.repeat(64),confirmedParts:0,confirmedLinkers:0};
  const zero={linkedFiles,powcatGroups:{}};
  assert.equal(coverage({powcatGroups:{}},zero,[]).ready,false);
  assert.equal(coverage({linkedFiles:{...linkedFiles,checkpointHash:'b'.repeat(64)},powcatGroups:{}},zero,[]).ready,false);
  assert.deepEqual(coverage(zero,zero,[]),{...linkedFiles,typedEvents:0});
  assert.equal(coverage({...zero,linkedFiles:{...linkedFiles,confirmedParts:1}},{...zero,linkedFiles:{...linkedFiles,confirmedParts:1}},[]).ready,false);
  const group='1'.repeat(64), typed={linkedFiles:{...linkedFiles,confirmedLinkers:1},powcatGroups:{'powcat-linker/true':[1,group]}};
  const rows=[{protocol:'powcat1',kind:'powcat-linker',valid:true,status:'confirmed',type:'event',typed_count:1,typed_hash:group}];
  assert.equal(coverage(zero,typed,rows).ready,false);
  assert.equal(coverage(typed,typed,[]).ready,false);
  assert.equal(coverage(typed,typed,[{...rows[0],typed_hash:'2'.repeat(64)}]).ready,false);
  assert.deepEqual(coverage(typed,typed,rows),{...typed.linkedFiles,typedEvents:1});
});
