import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { Transaction, script, opcodes } from "bitcoinjs-lib";
import { encodePowcatPart, encodePowcatManifest, powcatScript, powcatSha256 } from "../src/shared/protocol/powcat1.mjs";
import { buildPowcatMailAttachment } from "../src/shared/protocol/powcatMail.mjs";
import { publishArticleVerification } from "../src/shared/protocol/publishArticle.mjs";
import { createPowcatReader } from "./powcat-reader.mjs";
import { createLinkedWriterCapabilityEndpoint, verifyLinkedArticle, linkedArticleRecord, linkedArticleEvidenceMatches,
  linkedArticleCanonicalProjectionMatches, admitIndexedLinkedArticle, linkedArticleEvidenceForTx } from "./publish-linked.mjs";
import { verifiedMailArticleFields } from "./db/proof-index-reader.mjs";
const H = n => n.toString(16).padStart(64,"0");
function fixture(body = "  Café 東京\r\nExact article.  ") {
  const bytes = Buffer.from(body), fileHash = powcatSha256(bytes), records = new Map();
  function publish(payload, height) {
    const tx = new Transaction(); tx.addInput(Buffer.alloc(32, 1), 0); tx.addOutput(powcatScript(payload), 0n);
    const header = Buffer.alloc(80, height), first = createHash("sha256").update(header).digest();
    const blockhash = createHash("sha256").update(first).digest().reverse().toString("hex");
    records.set(tx.getId(), { txid: tx.getId(), hex: tx.toHex(), blockhash, height, proof: header.toString("hex")+tx.getId() });
    return tx.getId();
  }
  const count = Math.ceil(bytes.length/96000), parts = [];
  for (let index=0; index<count; index++) parts.push(publish(encodePowcatPart({
    fileHash, index, count, bytes: bytes.subarray(index*96000,(index+1)*96000) }),4));
  const root = publish(encodePowcatManifest({fileHash,size:bytes.length,mime:"text/plain",name:"article.txt",partTxids:parts}),5);
  const article = {v:2,title:"Linked article",source:"linked-powcat1",size:bytes.length,sha256:fileHash,linkerTxid:root};
  const attachment = buildPowcatMailAttachment({txid:root,fileHash,name:"article.txt"});
  const enc = text => Buffer.from(text).toString("base64url");
  const outputs = ["pwb1:post:"+enc(JSON.stringify({v:1,text:article.title,article})),
    "pwm1:a:"+enc(attachment.mime)+":"+enc(attachment.name)+":139:"+attachment.sha256+":0/1:"+attachment.data];
  const tx = {txid:H(99),height:6,_powBlockHash:H(6),vout:outputs.map(text=>({
    scriptpubkey:Buffer.from(script.compile([opcodes.OP_RETURN,Buffer.from(text)])).toString("hex"),value:0
  }))};
  async function rpc(method, [value, verbose]) {
    const rows = [...records.values()];
    if (method==="getblockchaininfo") return {chain:"main",blocks:6,bestblockhash:H(6),initialblockdownload:false};
    if (method==="getindexinfo") return {txindex:{synced:true,best_block_height:6}};
    if (method==="gettxoutproof") return records.get(value[0]).proof;
    if (method==="verifytxoutproof") return [rows.find(row=>row.proof===value).txid];
    if (method==="getblockheader") return {hash:value,height:rows.find(row=>row.blockhash===value).height,confirmations:2};
    if (method==="getrawtransaction") return verbose ? {...records.get(value),confirmations:2} : records.get(value).hex;
    if (method==="getblockhash") return value===6?H(6):rows.find(row=>row.height===value)?.blockhash;
    throw new Error("Unexpected RPC "+method);
  }
  const readFile=createPowcatReader({chain:"main",rpc});
  const position={txid:tx.txid,blockHeight:6,blockHash:H(6),protocolVout:0};
  const options={readFile,network:"livenet",blockHashAtHeight:h=>rpc("getblockhash",[h])};
  return {body,tx,article,attachment,root,records,rpc,readFile,position,options,parts};
}
test("canonical linked body uses exact bytes and compact dependency evidence, not stored body",async()=>{
  const f=fixture(), result=await verifyLinkedArticle(f.tx,f.position,f.options);
  assert.equal(result.body,f.body); assert.equal(result.evidence.dependencies.length,2);
  assert.equal(linkedArticleEvidenceMatches(f.article,f.position,result.evidence),true);
  assert.equal("body" in result.evidence,false);
  assert.equal(linkedArticleCanonicalProjectionMatches(f.article,f.position,result.evidence,f.records.get(f.root).hex,true),true);
  assert.equal(linkedArticleCanonicalProjectionMatches(f.article,f.position,result.evidence,f.records.get(f.root).hex,false),false);
});
test("maximum4,000,000 byte body resolves within67parts and certificate remains compact",async()=>{
  const f=fixture("x".repeat(4_000_000)), result=await verifyLinkedArticle(f.tx,f.position,f.options);
  assert.equal(Buffer.byteLength(result.body),4_000_000);assert.equal(f.parts.length,42);
  assert.ok(Buffer.byteLength(JSON.stringify(result.evidence))<12_000);
  assert.throws(()=>fixture("x".repeat(4_000_001)));
});
test("reject wrong network, changed post before/after resolve and invalid dependency ordering",async()=>{
  const f=fixture();
  await assert.rejects(verifyLinkedArticle(f.tx,f.position,{...f.options,network:"testnet"}));
  let calls=0;
  await assert.rejects(verifyLinkedArticle(f.tx,f.position,{...f.options,blockHashAtHeight:async()=>++calls===1?H(6):H(7)}));
  await assert.rejects(verifyLinkedArticle(f.tx,{...f.position,blockHeight:5,blockHash:f.records.get(f.root).blockhash},f.options));
});
test("certificate rejects missing/duplicate/reordered/wrong-context dependencies",async()=>{
  const f=fixture("x".repeat(96001)),{evidence}=await verifyLinkedArticle(f.tx,f.position,f.options);
  for(const mutate of [
    e=>{e.network="testnet"},e=>{e.postTxid=H(3)},e=>{e.protocolVout=4},
    e=>{e.fileHash=H(5)},e=>{e.dependencies=[]},e=>{e.dependencies[1]=null},
    e=>{e.dependencies.push(e.dependencies[1])},e=>{e.dependencies[1].blockHeight=5}
  ]) {const e=structuredClone(evidence);mutate(e);assert.equal(linkedArticleEvidenceMatches(f.article,f.position,e),false);}
  const e=structuredClone(evidence);[e.dependencies[1],e.dependencies[2]]=[e.dependencies[2],e.dependencies[1]];
  assert.equal(linkedArticleCanonicalProjectionMatches(f.article,f.position,e,f.records.get(f.root).hex,true),false);
});
test("raw post pointer mismatch and duplicatebody cannot be promoted by a supplied marker",async()=>{
  const f=fixture(); assert.ok(linkedArticleRecord(f.tx));
  const changed=structuredClone(f.tx);changed.vout.push(changed.vout[1]);assert.equal(linkedArticleRecord(changed),null);
  assert.equal(await verifyLinkedArticle(changed,f.position,f.options),null);
  const bad=structuredClone(f.tx);bad.vout[1].scriptpubkey="6a";assert.equal(linkedArticleRecord(bad),null);
});
test("new indexed admission never mutates inputrawtx or persists full body",async()=>{
  const f=fixture(),before=JSON.stringify(f.tx);
  await admitIndexedLinkedArticle(f.tx,{readFile:f.readFile,rpc:f.rpc,network:"livenet"});
  assert.equal(JSON.stringify(f.tx),before);
  assert.ok(linkedArticleEvidenceForTx(f.tx));
  const pending={...f.tx,height:undefined,_powBlockHash:undefined};
  await admitIndexedLinkedArticle(pending,{readFile:f.readFile,rpc:f.rpc,network:"livenet"});
  assert.equal(linkedArticleEvidenceForTx(pending),null);
});
test("missingroot and temporaryoutage have distinct admission outcomes",async()=>{
  const f=fixture();
  const missing=async(m,a)=>{if(m==="getrawtransaction")throw Object.assign(new Error("absent"),{rpcCode:-5});return f.rpc(m,a)};
  await admitIndexedLinkedArticle(f.tx,{readFile:f.readFile,rpc:missing,network:"livenet"});
  assert.equal(linkedArticleEvidenceForTx(f.tx),null);
  const outage=async(m,a)=>{if(m==="getrawtransaction")throw new Error("offline");return f.rpc(m,a)};
  await assert.rejects(admitIndexedLinkedArticle(f.tx,{readFile:f.readFile,rpc:outage,network:"livenet"}),/offline/u);
});
test("Mail lists expose compact commitments only after canonical dependency and pointer match",async()=>{
  const f=fixture(),{evidence}=await verifyLinkedArticle(f.tx,f.position,f.options);
  const companion={...f.position,kind:"boost-post",confirmed:true,valid:true,text:f.article.title,article:f.article,
    articleVerification:publishArticleVerification(f.article),articleDependencies:evidence,
    articleCanonicalRootHex:f.records.get(f.root).hex,articleDependenciesCanonical:true};
  const message={txid:f.tx.txid,confirmed:true,memo:"File: article.txt.powcat",attachment:f.attachment};
  const result=verifiedMailArticleFields(message,companion);
  assert.deepEqual(result.article,f.article);assert.equal("articleBody" in result,false);assert.equal("memo" in result,false);
  assert.deepEqual(verifiedMailArticleFields(message,{...companion,articleDependenciesCanonical:false}),{});
  assert.deepEqual(verifiedMailArticleFields({...message,attachment:{...f.attachment,data:"bad"}},companion),{});
});

test("missing or pending part is invalid without blocking canonical admission; temporary transport remains unavailable",async()=>{
  for(const pending of [false,true]){
    const f=fixture();
    const rpc=async(m,a)=>{
      if(m==="getrawtransaction" && a[0]===f.parts[0]){
        if(pending)return {...f.records.get(a[0]),blockhash:undefined,confirmations:0};
        throw Object.assign(new Error("absent"),{rpcCode:-5});
      }
      return f.rpc(m,a);
    };
    await admitIndexedLinkedArticle(f.tx,{rpc,network:"livenet"});
    assert.equal(linkedArticleEvidenceForTx(f.tx),null);
  }
  const f=fixture();
  const rpc=async(m,a)=>{if(m==="getrawtransaction"&&a[0]===f.parts[0])throw new Error("offline");return f.rpc(m,a)};
  await assert.rejects(admitIndexedLinkedArticle(f.tx,{rpc,network:"livenet"}));
});

test("exact production indexer parser requires private admission evidence and stores no full body",async()=>{
  const {readFile}=await import("node:fs/promises"),{default:vm}=await import("node:vm");
  const protocol=await import("../src/shared/protocol/publishArticle.mjs");
  const {decodeCanonicalOpReturnOutput}=await import("./canonical-op-return.mjs");
  const source=await readFile(new URL("../scripts/backfill-proof-indexer.mjs",import.meta.url),"utf8");
  const start=source.indexOf("function boostPostItemFromJson("),end=source.indexOf("\nfunction boostItemFromMessage(",start);
  const records=tx=>tx.vout.map((o,voutIndex)=>({...decodeCanonicalOpReturnOutput(o),voutIndex}));
  const context=vm.createContext({...protocol,createHash,linkedArticleEvidenceForTx,linkedArticleEvidenceMatches,
    BOOST_ACTION_REGISTRY_FEE_SATS:546,BOOST_POST_MAX_CHARS:140,
    baseProtocolItem:(tx,m,kind)=>({txid:tx.txid,kind,blockHeight:tx.height,blockHash:tx._powBlockHash,protocolVout:m.voutIndex}),
    senderAddressFromTx:()=>"author",boostText:v=>String(v??"").trim(),boostMediaPointer:v=>v??null,
    boostTxidText:()=>"",boostSignalSats:()=>546,canonicalWorkSubatomsText:()=>"0",
    boostSelfSend:()=>true,protocolMessagesFromTx:records,invalidProtocolItem:(item,reason)=>({...item,valid:false,reason}),
    validBoostSocialItem:item=>({...item,valid:true})});
  vm.runInContext(source.slice(start,end)+"\nthis.parse=boostPostItemFromJson;",context);
  const f=fixture(),post={v:1,text:f.article.title,article:f.article};
  assert.equal(context.parse(f.tx,records(f.tx)[0],"post",post).valid,false);
  await admitIndexedLinkedArticle(f.tx,{rpc:f.rpc,network:"livenet"});
  const parsed=context.parse(f.tx,records(f.tx)[0],"post",post);
  assert.equal(parsed.valid,true);assert.equal(parsed.articleVerification,publishArticleVerification(f.article));
  assert.deepEqual(parsed.articleDependencies,linkedArticleEvidenceForTx(f.tx));
  assert.equal("articleBody" in parsed,false);
  const forged={...f.tx,articleDependencies:parsed.articleDependencies};
  assert.equal(context.parse(forged,records(forged)[0],"post",post).valid,false);
});

test("concurrent article reads share one verification; completed bytes are never cached",async()=>{
  const {createCoalescedLinkedFileReader}=await import("./publish-linked.mjs");
  let finish,calls=0;const pending=new Promise(resolve=>{finish=resolve});
  const read=createCoalescedLinkedFileReader(async()=>{calls++;await pending;return {bytes:new Uint8Array(4_000_000)};},{maxConcurrent:1,maxWaiters:2});
  const a=read(H(1)),b=read(H(1));
  await assert.rejects(read(H(1)),{statusCode:429});await assert.rejects(read(H(2)),{statusCode:429});
  finish();const [one,two]=await Promise.all([a,b]);assert.equal(calls,1);assert.equal(one,two);
  await read(H(1));assert.equal(calls,2,"new request must recheck canonical dependencies");
});

test("timed out resolver retains concurrency slot until ignored abort actually settles",async()=>{
  const {createCoalescedLinkedFileReader}=await import("./publish-linked.mjs");
  let finish;const pending=new Promise(resolve=>{finish=resolve});
  const read=createCoalescedLinkedFileReader(()=>pending,{maxConcurrent:1,timeoutMs:5});
  await assert.rejects(read(H(1)),{statusCode:503});
  await assert.rejects(read(H(2)),{statusCode:429});
  finish({});await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(await read(H(2)),{});
});

test("Growth counts one linked article/post, requires canonical dependencies, never counts body as another transfer",async()=>{
  const {createBoostGrowthObservation}=await import("./boost-growth.mjs");
  const {decodeCanonicalOpReturnOutput}=await import("./canonical-op-return.mjs");
  const f=fixture(),{evidence}=await verifyLinkedArticle(f.tx,f.position,f.options);
  const event={protocol:"pwb1",kind:"boost-post",status:"confirmed",valid:true,validation_errors:[],
    op_return_vout:0,record_ordinal:0,raw_payload:decodeCanonicalOpReturnOutput(f.tx.vout[0]).text,
    payload:{article:f.article,articleDependencies:evidence},linked_article_root_raw_hex:f.records.get(f.root).hex,
    linked_article_dependencies_canonical:true};
  const row={txid:f.tx.txid,status:"confirmed",block_height:6,block_hash:H(6),block_index:0,
    raw_tx:{...f.tx,_powBlockIndex:0,canonicalBlockScan:{network:"livenet",height:6,blockHash:H(6)}},events:[event]};
  const checkpoint={blockHeight:6,blockHash:H(6)};
  const observer=createBoostGrowthObservation(checkpoint);observer.addTransaction(row);
  const result=observer.finish();assert.equal(result.counts.articles,1);assert.equal(result.counts.posts,1);
  assert.equal(result.counts.transactions,1);assert.equal(result.counts.transfers,0);
  assert.throws(()=>observer.addTransaction(row),/Duplicate/u);
  const detached=structuredClone(row);detached.events[0].linked_article_dependencies_canonical=false;
  assert.throws(()=>createBoostGrowthObservation(checkpoint).addTransaction(detached),/article body evidence/u);
});

test("disabling our v2 writer preserves canonical existing-v2 reads and evidence validation",async()=>{
 const f=fixture(),before=await verifyLinkedArticle(f.tx,f.position,f.options);
 let calls=0;const unexpected=async()=>{calls++;throw new Error("Disabled writer must not probe.");};
 const endpoint=createLinkedWriterCapabilityEndpoint({enabled:()=>false,readMarker:unexpected,readHealth:unexpected,
  readSearch:unexpected,blockHashAtHeight:unexpected,readSource:unexpected,loadedSource:()=>({model:"fixture"})});
 assert.equal((await endpoint({network:"livenet",fresh:true})).enabled,false);assert.equal(calls,0);
 const after=await verifyLinkedArticle(f.tx,f.position,f.options);
 assert.equal(after.body,f.body);assert.deepEqual(after.evidence,before.evidence);
 assert.equal(linkedArticleCanonicalProjectionMatches(f.article,f.position,after.evidence,f.records.get(f.root).hex,true),true);
});
