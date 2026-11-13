import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {POWCAT_MAX_FILE_BYTES} from "../../shared/protocol/powcat1.mjs";
import {ARTICLE_MAX_BYTES,editorPage,EDITOR_PAGE_UNITS,replacePageSelection,applyPageInput,pageStartForCaret} from "./publishEditorPages.mjs";
test("pages bound visible text and preserve full four megabyte input",()=>{
 for(const body of ["x".repeat(4000000),("x".repeat(79)+"\n").repeat(50000),"😀".repeat(1000000)]) {
  let joined="",start=0,count=0;
  while(start<body.length){const p=editorPage(body,start);assert.ok(p.raw.length<=EDITOR_PAGE_UNITS);assert.ok(p.end>start);joined+=p.raw;start=p.end;count++;}
  assert.equal(createHash("sha256").update(joined).digest("hex"),createHash("sha256").update(body).digest("hex"));assert.ok(count>1);
 }
});
test("page boundaries never divide surrogate pairs or CRLF",()=>{
 for(const ending of ["😀","\r\n"]){const body="x".repeat(16383)+ending+"tail";const a=editorPage(body),b=editorPage(body,a.end);assert.equal(a.raw,"x".repeat(16383));assert.equal(b.raw,ending+"tail");}
});
test("paste retains exact CRLF CR Unicode and surrounding body",()=>{
 const body="before\r\nline\rend😀after",p=editorPage(body);
 const start=p.text.indexOf("line"),r=replacePageSelection(body,p,start,start+4,"A\r\nB\r😀");
 assert.equal(r.body,"before\r\nA\r\nB\r😀\rend😀after");
});
test("ordinary edit preserves untouched raw line endings",()=>{
 const body="a\r\nb\rc\n😀end",p=editorPage(body);
 assert.equal(applyPageInput(body,p,p.text.replace("b","B")).body,"a\r\nB\rc\n😀end");
 assert.equal(applyPageInput(body,p,p.text).body,body);
});
test("middle page edits never replace invisible prefix or suffix",()=>{
 const body="a".repeat(20000)+"\r\n"+"b".repeat(20000),p=editorPage(body,16384);
 const r=replacePageSelection(body,p,5,8,"XYZ");
 assert.equal(r.body,body.slice(0,p.offsets[5])+"XYZ"+body.slice(p.offsets[8]));
});
test("oversize rejects without modifying exact maximum input; stale page rejects",()=>{
 const body="x".repeat(4000000),p=editorPage(body);
 assert.throws(()=>replacePageSelection(body,p,0,0,"y"),/exceeds/);
 assert.equal(replacePageSelection(body,p,0,1,"z").body.length,4000000);
 assert.throws(()=>applyPageInput("changed",p,"a"),/changed/);
});

test("minimal edits preserve complete changed surrogate pairs",()=>{for(const [a,b] of [["😀","😁"],["😀","🨀"]]){const body="a"+a+"z";assert.equal(applyPageInput(body,editorPage(body),"a"+b+"z").body,"a"+b+"z");}});

test("caret page includes insertion end across surrogate and CRLF left-edge boundaries",()=>{
 for(const body of ["😀"+"x".repeat(16383),"\r\n"+"x".repeat(16383),"😀".repeat(999999)+"abc"]) {
  const page=editorPage(body,pageStartForCaret(body,editorPage(""),body.length));
  assert.ok(page.start<=body.length && page.end>=body.length);
  const offset=page.offsets.indexOf(body.length);assert.ok(offset>=0);
  assert.equal(replacePageSelection(body,page,offset,offset,"Z").body,body+"Z");
 }
});

test("editor byte ceiling equals the canonical linked-file ceiling",()=>assert.equal(ARTICLE_MAX_BYTES,POWCAT_MAX_FILE_BYTES));
