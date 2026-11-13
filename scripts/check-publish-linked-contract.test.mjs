import { assertLinkedPublishCapability } from "../src/shared/protocol/publishLinkedCapability.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  normalizePublishArticleMetadata, linkedArticlePointerFromRecords,
  publishLinkedArticleBody, publishArticleVerification, publishArticleBodyFromRecords,
} from "../src/shared/protocol/publishArticle.mjs";
import { buildPowcatMailAttachment } from "../src/shared/protocol/powcatMail.mjs";
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const b64 = text => Buffer.from(text).toString("base64url");
const txid = "a".repeat(64);
function fixture(body = "Exact linked article\n") {
  const bytes = Buffer.from(body);
  const article = {v: 2, title: "Linked article", source: "linked-powcat1", size: bytes.length, sha256: hash(bytes), linkerTxid: txid};
  const attachment = buildPowcatMailAttachment({txid, fileHash: article.sha256, name: "article.txt"});
  const records = [
    {prefix: "pwb1:", decodeValid: true, voutIndex: 1, text: `pwb1:post:${b64(JSON.stringify({v: 1, text: article.title, article, proofSignalSats: 546}))}`},
    {prefix: "pwm1:", decodeValid: true, voutIndex: 2, text: `pwm1:a:${b64(attachment.mime)}:${b64(attachment.name)}:139:${attachment.sha256}:0/1:${attachment.data}`},
  ];
  return {article, records, file: {txid, fileHash: article.sha256, size: bytes.length, mime: "text/plain", bytes}};
}
test("linked metadata is explicitly versioned; exact4MB cap never widens inline carrier", () => {
  const {article} = fixture();
  assert.equal(normalizePublishArticleMetadata({...article, size: 4_000_000}).size, 4_000_000);
  assert.equal(normalizePublishArticleMetadata({...article, size: 4_000_001}), null);
  for (const bad of [{...article,v:1}, {...article,source:"same-tx-pwm1-message"}, {...article,linkerTxid:"A".repeat(64)}, {...article,unexpected:true}]) assert.equal(normalizePublishArticleMetadata(bad), null);
  assert.equal(publishArticleVerification(article), "canonical-linked-powcat1-article-v2");
  assert.equal(publishArticleBodyFromRecords([], article, hash), null);
});
test("same-post pointer verifies exact hash, metadata, position, envelope and bounded carrier", () => {
  const {article, records} = fixture();
  assert.deepEqual(linkedArticlePointerFromRecords(records, article, 100_000), {txid,fileHash:article.sha256});
  for (const size of [null,0,100_001,NaN]) assert.equal(linkedArticlePointerFromRecords(records,article,size),null);
  for (const changed of [
    [...records, {...records[1],voutIndex:3}],
    [...records,{prefix:"pwm1:",decodeValid:true,voutIndex:3,text:"pwm1:m:uncommitted body"}],
    [{...records[0],decodeValid:false},records[1]],
    [records[0],{...records[1],voutIndex:1}],
    [records[0],{...records[1],text:records[1].text.replace(":0/1:",":0/2:")}],
    [records[0],{...records[1],text:records[1].text.slice(0,-1)+"!"}],
  ]) assert.equal(linkedArticlePointerFromRecords(changed,article,1000),null);
  assert.equal(linkedArticlePointerFromRecords(records,{...article,sha256:"b".repeat(64)},1000),null);
});
test("resolved body verifies exact UTF8 and does not grant chain authority", () => {
  const {article,file} = fixture("🧪 café\r\n  exact whitespace  ");
  assert.equal(publishLinkedArticleBody(article,file),"🧪 café\r\n  exact whitespace  ");
  for (const changed of [{...file,mime:"text/html"},{...file,txid:"b".repeat(64)},{...file,size:file.size+1},{...file,bytes:Buffer.from("tampered")},{...file,fileHash:"b".repeat(64)}]) assert.equal(publishLinkedArticleBody(article,changed),null);
  for (const body of ["\0bad", "   "]) { const f=fixture(body); assert.equal(publishLinkedArticleBody(f.article,f.file),null); }
  const bytes=Buffer.from([0xc0,0xaf]);
  assert.equal(publishLinkedArticleBody({...article,size:2,sha256:hash(bytes)},{...file,size:2,fileHash:hash(bytes),bytes}),null);
});
test("four million exact UTF8 bytes verify; oversized commitment fails", () => {
  const f=fixture("x".repeat(4_000_000));
  assert.equal(publishLinkedArticleBody(f.article,f.file).length,4_000_000);
  const oversized=fixture("x".repeat(4_000_001));
  assert.equal(publishLinkedArticleBody(oversized.article,oversized.file),null);
});

test("new linked writes require exact current reader/indexer capability, not legacy success",()=>{
 const good={serverTime:new Date().toISOString(),model:"publish-linked-capability-v2",network:"livenet",enabled:true,readerVersion:2,indexerVersion:2,checkpoint:{height:975600,hash:"c".repeat(64)}};
 assert.deepEqual(assertLinkedPublishCapability(good,"livenet"),good.checkpoint);
 for(const bad of [{},{...good,serverTime:new Date(Date.now()-60001).toISOString()},{...good,serverTime:new Date(Date.now()+20000).toISOString()},{...good,serverTime:undefined},{...good,enabled:false},{...good,indexerVersion:1},{...good,readerVersion:1},{...good,checkpoint:{height:0,hash:good.checkpoint.hash}},{...good,network:"testnet"},{...good,checkpoint:{height:1,hash:""}}])assert.throws(()=>assertLinkedPublishCapability(bad,"livenet"));
 assert.throws(()=>assertLinkedPublishCapability(good,"testnet"));
});

test("a leading UTF8 BOM cannot pass by stripping bytes from the committed body",()=>{
 const f=fixture("\uFEFFexact");
 assert.equal(publishLinkedArticleBody(f.article,f.file),null,"existing exact text writer rejects leading BOM; never return a stripped body");
 const middle=fixture("Exact\uFEFFmiddle");assert.equal(publishLinkedArticleBody(middle.article,middle.file),"Exact\uFEFFmiddle");
});
