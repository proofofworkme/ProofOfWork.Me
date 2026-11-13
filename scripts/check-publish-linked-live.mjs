#!/usr/bin/env node
// Read-only release smoke. Does not sign, upload, or fabricate a v2 article.
import { assertLinkedPublishCapability } from "../src/shared/protocol/publishLinkedCapability.mjs";
import { normalizePublishArticleMetadata, publishArticleVerification, publishArticleBodyBytes } from "../src/shared/protocol/publishArticleMetadata.mjs";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

const hash=value=>typeof value==="string" && /^[0-9a-f]{64}$/u.test(value);
export function publishCheckConfiguration(env=process.env) {
  const mode=env.POW_PUBLISH_CHECK_MODE ?? "active";
  if(!["active","preactivation"].includes(mode)) throw new Error("Expected active or preactivation check mode.");
  const origin=env.POW_PUBLISH_CHECK_ORIGIN ?? (mode==="active"?"https://publish.proofofwork.me":"http://127.0.0.1:8081");
  if(mode==="active") {
    if(!/^https:\/\/(?:publish|computer)\.proofofwork\.me$/u.test(origin)) throw new Error("Expected canonical first-party origin.");
    return {mode,origin,headers:{}};
  }
  const url=new URL(origin),token=String(env.POW_INTERNAL_VERIFIER_TOKEN??"").trim();
  if(url.protocol!=="http:" || !["127.0.0.1","[::1]"].includes(url.hostname) ||
      url.username || url.password || url.pathname!=="/" || url.search || url.hash || token.length<32)
    throw new Error("Preactivation requires literal loopback HTTP and the existing internal verifier token.");
  return {mode,origin:url.origin,headers:{"x-pow-internal-verifier":token}};
}
export function assertPublishPreactivation(value,now=Date.now()) {
  const time=Date.parse(value?.serverTime),source=value?.sourceIdentity,search=value?.search,storage=search?.storage;
  const reserve=256*1024**2+4_000_000;
  if(value?.model!=="publish-linked-preactivation-v1" || value.network!=="livenet" ||
      value.ready!==true || value.enabled!==false || value.writesEnabled!==false || value.reason!==null ||
      !Number.isFinite(time) || now-time>60_000 || time-now>10_000 ||
      !Number.isFinite(value.elapsedMs) || value.elapsedMs<0 || value.elapsedMs>5500 ||
      value.readerVersion!==2 || value.indexerVersion!==2 ||
      !Number.isSafeInteger(value.checkpoint?.height) || value.checkpoint.height<1 || !hash(value.checkpoint.hash) ||
      source?.model!=="publish-linked-source-closure-v1" || !hash(source.sha256) ||
      !/^[1-9]\d*$/u.test(source.files??"") || !/^[1-9]\d*$/u.test(source.bytes??"") ||
      search?.model!=="linked-publish-content-search-v1" || search.indexVersion!=="proof-search-v6-linked-publish-content" ||
      search.ready!==true || search.fullBodySearch!==true || !hash(search.parserIdentity) ||
      search.checkpoint?.height!==value.checkpoint.height || search.checkpoint?.hash!==value.checkpoint.hash ||
      storage?.model!==search.model ||
      ![storage.retainedBytes,storage.maxRetainedBytes,storage.physicalBytes,storage.maxPhysicalBytes,storage.minFreeBytes]
        .every(n=>Number.isSafeInteger(n)&&n>=0) ||
      storage.retainedBytes+reserve>storage.maxRetainedBytes || storage.physicalBytes+reserve*2>storage.maxPhysicalBytes ||
      typeof storage.freeBytes!=="string" || !/^(0|[1-9]\d*)$/u.test(storage.freeBytes) ||
      BigInt(storage.freeBytes)<BigInt(storage.minFreeBytes+512*1024**2+reserve))
    throw new Error("Disabled-writer preactivation readiness is not fully verified.");
  return value;
}
export async function runPublishLinkedLiveCheck({env=process.env,fetchImpl=fetch}={}) {
 const {mode,origin,headers}=publishCheckConfiguration(env);
 const result={mode,scope:"read-only capability and existing article smoke; no new signing or publication",checks:[],newLinkedWriteVerified:false};
 async function get(path,max=26_000_000,privateRead=false) {
  const response=await fetchImpl(origin+path,{signal:AbortSignal.timeout(120_000),cache:"no-store",redirect:"error",headers:privateRead?headers:{}});
  if(!response.ok||!response.body)throw new Error(`Read unavailable: ${response.status}`);
  const chunks=[];let total=0;for await(const bytes of response.body){total+=bytes.length;if(total>max)throw new Error("Response bound exceeded");chunks.push(bytes)}
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
 }
 try {
  const start=performance.now();
  const capability=mode==="preactivation"
    ? await get("/api/v1/internal/publish-linked-readiness?network=livenet&fresh=1",65_536,true)
    : await get("/api/v1/boost?capabilities=linked-articles-v2&fresh=1",65_536);
  const elapsedMs=Math.round((performance.now()-start)*1000)/1000;
  if(mode==="preactivation") {
    assertPublishPreactivation(capability);
    result.checks.push({name:"disabled-writer reader/indexer/Search/capacity readiness",pass:true,checkpoint:capability.checkpoint,
      sourceIdentity:capability.sourceIdentity,search:capability.search,probeElapsedMs:capability.elapsedMs,requestElapsedMs:elapsedMs});
    const publicCapability=await get("/api/v1/boost?capabilities=linked-articles-v2&fresh=1",65_536);
    if(publicCapability.model!=="publish-linked-capability-v2" || publicCapability.network!=="livenet" || publicCapability.enabled!==false)
      throw new Error("Writer must remain disabled after preactivation.");
    result.checks.push({name:"public writer remains disabled",pass:true});
  } else {
    assertLinkedPublishCapability(capability,"livenet");
    result.checks.push({name:"current linked reader/indexer write capability",pass:true,checkpoint:capability.checkpoint,requestElapsedMs:elapsedMs});
  }
  const feed=await get("/api/v1/boost?format=article&limit=1&fresh=1");
  if(feed.complete!==true||feed.network!=="livenet"||!Array.isArray(feed.items))throw new Error("Article feed is incomplete");
  result.checks.push({name:"complete article feed",pass:true});
  const post=feed.items.find(x=>x.kind==="boost-post"&&x.article);
  if(post){const detail=await get(`/api/v1/boost?detail=${post.txid}&fresh=1`),item=detail.post,article=normalizePublishArticleMetadata(item?.article),bytes=publishArticleBodyBytes(item?.articleBody);
    if(detail.complete!==true||item?.txid!==post.txid||item.confirmed!==true||!article||item.articleVerification!==publishArticleVerification(article)||!bytes||bytes.length!==article.size||createHash("sha256").update(bytes).digest("hex")!==article.sha256)throw new Error("Existing article detail proof mismatch");
    result.checks.push({name:"existing article exact body",pass:true,version:article.v,txid:post.txid});
  } else result.checks.push({name:"existing article detail",pass:null,reason:"No article on first page; not verified"});
  result.completedAt=new Date().toISOString();
 } catch(error) {result.error=String(error.message);}
 return result;
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
 try {const result=await runPublishLinkedLiveCheck();console.log(JSON.stringify(result,null,2));if(result.error)process.exitCode=1;}
 catch(error){console.error(String(error.message));process.exitCode=1;}
}
