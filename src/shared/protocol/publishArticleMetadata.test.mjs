import test from "node:test";
import assert from "node:assert/strict";
import * as pure from "./publishArticleMetadata.mjs";
import * as canonical from "./publishArticle.mjs";
import {POWCAT_MAX_FILE_BYTES as protocolLimit} from "./powcat1.mjs";
import {POWCAT_MAX_FILE_BYTES as sharedLimit} from "./powcatLimits.mjs";

test("canonical Publish exports are the same pure metadata functions and constants",()=>{
 for(const key of Object.keys(pure)) assert.equal(canonical[key],pure[key],key);
 assert.equal(protocolLimit,sharedLimit);assert.equal(sharedLimit,4000000);
});
test("metadata preserves exact UTF-8 rejection and v1/v2 size boundaries",()=>{
 for(const body of ["\uFEFFtext","\u0000","\uD800","\uDC00"])assert.equal(pure.publishArticleBodyBytes(body),null);
 for(const body of ["text\r\nmore\r","😀","café"])assert.deepEqual(pure.publishArticleBodyBytes(body),new TextEncoder().encode(body));
 for(const v of [1,2]) {
  const base={v,title:"Original",source:v===1?pure.PUBLISH_ARTICLE_SOURCE:pure.PUBLISH_LINKED_ARTICLE_SOURCE,size:1,sha256:"a".repeat(64),...(v===2?{linkerTxid:"b".repeat(64)}:{})};
  const limit=v===1?100000:sharedLimit;
  for(const size of [1,limit]) assert.ok(pure.normalizePublishArticleMetadata({...base,size}));
  for(const size of [0,-1,1.5,limit+1,NaN,Infinity])assert.equal(pure.normalizePublishArticleMetadata({...base,size}),null);
  for(const change of [{extra:true},{sha256:"A".repeat(64)},{title:"x".repeat(141)},{title:"\uFEFFtitle"},{title:"\uD800"}])assert.equal(pure.normalizePublishArticleMetadata({...base,...change}),null);
  assert.equal(pure.publishArticleVerification(base),v===1?pure.PUBLISH_ARTICLE_VERIFICATION:pure.PUBLISH_LINKED_ARTICLE_VERIFICATION);
 }
});
