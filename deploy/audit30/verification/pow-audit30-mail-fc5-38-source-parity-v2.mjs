import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import ts from '/home/sixer/ProofOfWork.Me/node_modules/typescript/lib/typescript.js';
const root='/home/sixer/ProofOfWork.Me',commit='fc5bd0eee0a66e5f0706e8491632351484ac211b';
const archive=JSON.parse(readFileSync(0,'utf8'));assert.equal(archive.commit,commit);assert.deepEqual(Object.keys(archive.blobs).sort(),['server/db/postgres.mjs','server/db/proof-index-reader.mjs','server/proof-api.mjs']);
const specs={
 'server/proof-api.mjs':['mailPayload','indexedMailPayload','livenetAddressMailRequiresProofIndex','repairMailPayloadBodies','repairPendingMailWorkAttachments','mailPayloadWithIndexedEventOverlay','mailPayloadWithPendingRecentOverlay','mailPayloadWithRecentOverlay','mergeMailPayloads','mergeMailMessageLists','mergeRepairedMailMessage','mailActivityItemFromMailMessage','mailActivityItemsFromMailPayload','nodeMailPayload','recentNodeMailPayload','recentAddressMailTransactions','reconcileMailPayloadStatuses','fetchTransactionWithSourceFallback','fetchPendingMailTransactionFromFirstParty','cachePendingTokenTransaction'],
 'server/db/proof-index-reader.mjs':['proofIndexAddressMailPayload','mailMemoFromEvent','addressMailRowPayloads','proofIndexPool','proofIndexEventHistoryPayload'],
};
const bindings=[],rows=[];
for(const[file,names]of Object.entries(specs)){
 const old=Buffer.from(archive.blobs[file],'base64'),current=readFileSync(`${root}/${file}`);
 bindings.push({file,oldFullSha256:createHash('sha256').update(old).digest('hex'),currentFullSha256:createHash('sha256').update(current).digest('hex')});
 const trees=[old,current].map(raw=>ts.createSourceFile(file,raw.toString(),ts.ScriptTarget.Latest,true,ts.ScriptKind.JS));
 for(const name of names){const texts=trees.map(tree=>{const node=tree.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name);assert.ok(node,name);return node.getText(tree);});assert.equal(texts[0],texts[1],`${file}:${name}`);rows.push({file,function:name,sha256:createHash('sha256').update(texts[1]).digest('hex')});}
}
const dbOld=Buffer.from(archive.blobs['server/db/postgres.mjs'],'base64'),dbCurrent=readFileSync(`${root}/server/db/postgres.mjs`);assert.deepEqual(dbOld,dbCurrent);
console.log(JSON.stringify({schema:'pow-audit30-mail-fc5-to38-source-parity-v2',oldCommit:commit,currentSourceCommit:'38ac6e2bff2ac16890724e5213346ef8a3ebd186',functionsEqual:rows.length,rows,bindings,poolSourceIdentical:true,poolSourceSha256:createHash('sha256').update(dbCurrent).digest('hex'),nativeCalls:0,qualification:'Exact source parity for closed25 mail API/reader functions. Runtime role privileges are not inferred; the pool reads its configured credential URI and does not set default_transaction_read_only.'}));
