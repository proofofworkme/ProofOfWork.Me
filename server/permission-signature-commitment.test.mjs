import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as bitcoin from 'bitcoinjs-lib';
import * as ecc from '@bitcoinerlab/secp256k1';
import { encodePermissionRecord } from '../src/shared/protocol/permissions.mjs';
import { verifyPermissionTransaction, replayPermissionTransactions, permissionRecordPayload } from './permissions.mjs';
import { permissionFixture, fixtureKeys, fixtureOwner, fixtureRaw, fixtureCarrier, fixturePolicy, signPermissionFixture } from './permission-test-fixtures.mjs';
const options={network:'livenet',activationHeight:100};
const all=bitcoin.Transaction.SIGHASH_ALL;
function signatureFor(input){const bytes=Buffer.from(input.scriptsig,'hex');return bitcoin.script.signature.decode(bytes.subarray(1,bytes[0]+1));}
function validActualSignature(tx,index=0){
 const input=tx.vin[index],decoded=signatureFor(input),bytes=Buffer.from(input.scriptsig,'hex');
 const publicKey=bytes.subarray(bytes[0]+2);
 return ecc.verify(fixtureRaw(tx).hashForSignature(index,Buffer.from(input.prevout.scriptpubkey,'hex'),decoded.hashType),publicKey,decoded.signature,false);
}
function rebindTxid(tx){tx.txid=fixtureRaw(tx).getId();return tx;}
function changeCapsule(tx){tx.vout[1].scriptpubkey=fixtureCarrier('pwm1:m:'+encodePermissionRecord('grant',{v:1,network:'livenet',label:'Changed terms',policy:{...fixturePolicy,maxTransactionProofs:'9999'}}));return rebindTxid(tx);}
function errors(tx){return verifyPermissionTransaction(tx,options).validationErrors;}
for(const compressed of [true,false])test(`real ${compressed?'compressed':'uncompressed'} owner P2PKH ALL signatures authorize the exact capsule`,()=>{
 const tx=permissionFixture({compressed,inputCount:2});assert.ok(validActualSignature(tx,0)&&validActualSignature(tx,1));
 const record=verifyPermissionTransaction(tx,options);assert.equal(record.valid,true);assert.equal(record.ownerSignatureOutputCommitmentVerified,true);
});
for(const type of [2,3,0x81,0x82,0x83])test(`cryptographically valid sighash ${type.toString(16)} cannot authorize Permission`,()=>{
 const tx=permissionFixture({types:[type]});assert.equal(validActualSignature(tx),true);

 assert.ok(errors(tx).includes('permission-input-signature-sighash-unsupported'));
});
for(const type of [2,3])test(`owner signature with ${type===2?'NONE':'SINGLE'} survives capsule substitution but never applies a grant`,()=>{
 const tx=changeCapsule(permissionFixture({types:[type]}));assert.equal(validActualSignature(tx),true);

 const state=replayPermissionTransactions([tx],options);assert.equal(state.permissions.length,0);assert.equal(state.events.length,1);assert.equal(state.events[0].applied,false);
 const inspected=permissionRecordPayload(tx,options);assert.equal(inspected.record.valid,false);assert.equal(inspected.authorityVerified,false);assert.equal(inspected.currentStatusVerified,false);assert.equal(inspected.record.rawBody.includes('pwperm1:grant:'),true);
});
test('changing a capsule signed with ALL invalidates the actual signature even with its txid rebound',()=>{
 const tx=changeCapsule(permissionFixture());assert.equal(validActualSignature(tx),false);
 assert.ok(errors(tx).includes('permission-input-signature-invalid'));
});
test('every input must commit all outputs, including the second owner input',()=>{
 const tx=permissionFixture({inputCount:2,types:[all,2]});assert.ok(validActualSignature(tx,0)&&validActualSignature(tx,1));
 assert.equal(verifyPermissionTransaction(tx,options).valid,false);assert.ok(errors(tx).includes('permission-input-signature-sighash-unsupported'));
});
for(const [name,script] of [['anyone-can-spend','51'],['P2SH','a914'+'22'.repeat(20)+'87'],['P2WPKH','0014'+'22'.repeat(20)],['P2WSH','0020'+'22'.repeat(32)],['P2TR','5120'+'22'.repeat(32)]])test(`${name} inputs with a claimed owner remain rejected inspectable records`,()=>{
 const tx=permissionFixture();tx.vin[0].prevout.scriptpubkey=script;
 assert.ok(errors(tx).includes('permission-input-spend-path-unsupported'));
 assert.equal(permissionRecordPayload(tx,options).authorityVerified,false);
});
test('public key must match the exact owner P2PKH script and network-derived address',()=>{
 const tx=permissionFixture(),sig=signatureFor(tx.vin[0]);
 tx.vin[0].scriptsig=Buffer.from(bitcoin.script.compile([bitcoin.script.signature.encode(sig.signature,all),fixtureOwner(fixtureKeys[1]).publicKey])).toString('hex');rebindTxid(tx);
 assert.ok(errors(tx).includes('permission-input-public-key-mismatch'));
 const falselyLabelled=permissionFixture();falselyLabelled.vin[0].prevout.scriptpubkey_address=fixtureOwner(fixtureKeys[1]).address;
 falselyLabelled.vout[0].scriptpubkey_address=falselyLabelled.vin[0].prevout.scriptpubkey_address;
 assert.ok(errors(falselyLabelled).includes('permission-input-public-key-mismatch'));
});
test('a claimed self-payment address cannot substitute for its actual output script',()=>{
 const tx=permissionFixture();tx.vout[0].scriptpubkey=fixtureOwner(fixtureKeys[1]).script;signPermissionFixture(tx);
 assert.equal(validActualSignature(tx),true);
 assert.ok(errors(tx).includes('permission-self-payment-insufficient'));
});
for(const [name,mutate] of [
 ['empty signature',tx=>{tx.vin[0].scriptsig='';}],
 ['malformed DER signature',tx=>{const bytes=Buffer.from(tx.vin[0].scriptsig,'hex');bytes[1]=0x31;tx.vin[0].scriptsig=bytes.toString('hex');}],
 ['nonminimal push',tx=>{const bytes=Buffer.from(tx.vin[0].scriptsig,'hex');tx.vin[0].scriptsig=Buffer.concat([Buffer.from([0x4c,bytes[0]]),bytes.subarray(1)]).toString('hex');}],
 ['extra stack item',tx=>{tx.vin[0].scriptsig+='00';}],
 ['witness spend evidence',tx=>{tx.vin[0].witness=['00'];}],
 ])test(`${name} cannot impersonate the supported two-push P2PKH path`,()=>{
 const tx=permissionFixture();mutate(tx);assert.ok(errors(tx).includes('permission-input-signature-unavailable'));
});
test('exact complete transaction fields and txid must bind the verified signature digest',()=>{
 for(const mutate of [tx=>delete tx.version,tx=>delete tx.locktime,tx=>delete tx.vin[0].sequence,tx=>delete tx.vin[0].txid,tx=>{tx.txid='a'.repeat(64);},tx=>{tx.vin[0].vout=1.1;}]){
  const tx=permissionFixture();mutate(tx);assert.ok(errors(tx).includes('permission-signature-transaction-invalid'));
 }
});
test('unsupported replacement and revocation never supersede a valid owner grant',()=>{
 const grant=permissionFixture({nonce:1,height:101});
 const replace=permissionFixture({nonce:2,height:102,index:2,action:'replace',metadata:{grant:grant.txid,parent:grant.txid},types:[2]});
 const revoke=permissionFixture({nonce:3,height:103,index:3,action:'revoke',metadata:{grant:grant.txid,parent:grant.txid},types:[3]});
 const state=replayPermissionTransactions([revoke,replace,grant],options);
 assert.equal(state.permissions.length,1);assert.equal(state.permissions[0].txid,grant.txid);assert.equal(state.permissions[0].status,'active');
 assert.equal(state.events.filter(e=>e.valid).length,1);assert.equal(state.events.filter(e=>!e.valid&&!e.applied).length,2);
});

test('missing input evidence cannot satisfy owner signature commitment verification',()=>{
 const tx=permissionFixture();tx.vin=[];
 const record=verifyPermissionTransaction(tx,options);assert.equal(record.valid,false);assert.equal(record.ownerSignatureOutputCommitmentVerified,false);
 assert.ok(record.validationErrors.includes('permission-input-authority-unavailable'));assert.ok(record.validationErrors.includes('permission-input-signature-unavailable'));
});

test('canonical high-S DER ALL remains valid owner authority under consensus signature semantics',()=>{
 const tx=permissionFixture(),decoded=signatureFor(tx.vin[0]),bytes=Buffer.from(tx.vin[0].scriptsig,'hex');
 const compact=Buffer.from(decoded.signature),order=BigInt('0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141');
 const highS=order-BigInt('0x'+compact.subarray(32).toString('hex'));
 Buffer.from(highS.toString(16).padStart(64,'0'),'hex').copy(compact,32);
 tx.vin[0].scriptsig=Buffer.from(bitcoin.script.compile([bitcoin.script.signature.encode(compact,all),bytes.subarray(bytes[0]+2)])).toString('hex');rebindTxid(tx);
 assert.equal(validActualSignature(tx),true);assert.equal(verifyPermissionTransaction(tx,options).valid,true);
});
