import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {buildReaderModel,verifiedReaderPage,READER_PAGE_UNITS} from "./publishReaderPage.mjs";
test("bounded verified pages reconstruct all4MB shapes and links without byte loss",()=>{
 for(const body of ["x".repeat(4000000),("x".repeat(79)+"\n").repeat(50000),"😀".repeat(1000000),("abc.pow PROOFOFWORK.ME text\r\n").repeat(160000).slice(0,4000000)]) {
  const model=buildReaderModel(body);let start=0,raw="",links=[];
  while(start<body.length){const p=verifiedReaderPage(model,start);assert.ok(p.end>start&&p.end-p.start<=READER_PAGE_UNITS);assert.equal(p.segments.map(s=>s.text).join(""),p.raw);raw+=p.raw;links.push(...p.segments.filter(s=>s.kind==="dns").map(s=>[s.start,s.end,s.value]));start=p.end;}
  assert.equal(createHash("sha256").update(raw).digest("hex"),createHash("sha256").update(body).digest("hex"));
  assert.deepEqual(links,model.segments.filter(s=>s.kind==="dns").map(s=>[s.start,s.end,s.value]));
 }
});
test("DNS token straddling page boundary stays whole on following page",()=>{
 const body="x ".repeat(8190)+"abc.pow next",model=buildReaderModel(body),a=verifiedReaderPage(model),b=verifiedReaderPage(model,a.end);
 assert.equal(a.end,16380);assert.equal(b.segments[0].text,"abc.pow");assert.equal(b.segments[0].kind,"dns");
 assert.equal(verifiedReaderPage(model,16383).start,16380);
});
test("full source lexical context preserves fenced and URL literals across pages",()=>{
 const body="```\n"+"x".repeat(16390)+"\nabc.pow\n```\nhttps://abc.pow/path literal@abc.pow real.pow";
 const model=buildReaderModel(body);let start=0,links=[];
 while(start<body.length){const p=verifiedReaderPage(model,start);links.push(...p.segments.filter(s=>s.kind==="dns").map(s=>s.text));start=p.end;}
 assert.deepEqual(links,["real.pow"]);
});
test("surrogate pairs and CRLF are never divided and empty page terminates",()=>{
 for(const pair of ["😀","\r\n"]){const body="x".repeat(16383)+pair+"tail",m=buildReaderModel(body),a=verifiedReaderPage(m),b=verifiedReaderPage(m,a.end);assert.equal(a.end,16383);assert.equal(a.raw+b.raw,body);}
 assert.deepEqual(verifiedReaderPage(buildReaderModel("")).raw,"");
});
