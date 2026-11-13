import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import ts from "typescript";
const source = await fs.readFile(new URL("../src/features/publish/publishDraftStore.ts", import.meta.url), "utf8");
let sequence=0;
function fixture() {
  const values=new Map(), legacy=new Map();
  const state={quota:false,abort:false,unavailable:false};
  globalThis.localStorage={getItem:key=>legacy.get(key)??null,removeItem:key=>legacy.delete(key)};
  globalThis.indexedDB={open() {
    if(state.unavailable) throw new Error("IndexedDB unavailable");
    const request={};
    request.result={close(){},transaction() {
      let pending=[],scheduled=false,aborted=false,putCount=0;
      const tx={error:null,abort(){aborted=true;schedule()}};
      function schedule(){if(scheduled)return;scheduled=true;queueMicrotask(()=>{
        if(aborted||state.abort){tx.error=new Error("Aborted");tx.onabort?.();return}
        for(const action of pending)action();tx.oncomplete?.();
      })}
      tx.objectStore=()=>({
        get(key){const q={};queueMicrotask(()=>{q.result=values.get(key);tx.oncomplete?.()});return q},
        put(value,key){if(state.quota||(state.failSecondPut&&++putCount===2))throw new Error("Quota exceeded");pending.push(()=>values.set(key,value));schedule();},
        delete(key){pending.push(()=>values.delete(key));schedule()},
      });return tx;
    }};
    queueMicrotask(()=>request.onsuccess?.());return request;
  }};
  return {values,legacy,state};
}
async function module() {
  const code=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(code+`\n// fixture${sequence++}`).toString("base64")}`);
}
test("draft store preserves legacy and stores4MB without duplicating localStorage",async()=>{
  const f=fixture(),m=await module();f.legacy.set("wallet",JSON.stringify({body:"legacy"}));
  assert.equal(JSON.parse(await m.readPublishDraft("wallet")).body,"legacy");
  await m.writePublishDraft("wallet",{body:"x".repeat(4_000_000)});
  assert.equal(JSON.parse(await m.readPublishDraft("wallet")).body.length,4_000_000);
  assert.equal(JSON.parse(f.legacy.get("wallet")).body,"legacy");
});
test("quota and abort preserve the previous draft and reject success",async()=>{
  const f=fixture(),m=await module();await m.writePublishDraft("wallet",{body:"saved"});
  for(const fault of ["quota","abort"]){f.state[fault]=true;await assert.rejects(m.writePublishDraft("wallet",{body:"lost"}));f.state[fault]=false;
    assert.equal(JSON.parse(await m.readPublishDraft("wallet")).body,"saved");}
  await m.writePublishDraft("wallet",{body:"recovered"});assert.equal(JSON.parse(await m.readPublishDraft("wallet")).body,"recovered");
});
test("queued writes and account scopes preserve newest exact values",async()=>{
  fixture();const m=await module();await Promise.all([m.writePublishDraft("one",{body:"old"}),m.writePublishDraft("one",{body:"new"}),m.writePublishDraft("two",{body:"other"})]);
  assert.equal(JSON.parse(await m.readPublishDraft("one")).body,"new");assert.equal(JSON.parse(await m.readPublishDraft("two")).body,"other");
});
test("unavailable storage never erases legacy evidence or pretends success",async()=>{
  const f=fixture(),m=await module();f.legacy.set("wallet","retained");f.state.unavailable=true;
  await assert.rejects(m.readPublishDraft("wallet"));await assert.rejects(m.writePublishDraft("wallet",{body:"new"}));assert.equal(f.legacy.get("wallet"),"retained");
});

test("guest-wallet collision migration is atomic on second-put failure and reload",async()=>{
 const f=fixture(),m=await module();await m.writePublishDraft("guest",{body:"guest original"});await m.writePublishDraft("wallet",{body:"wallet original"});
 f.state.failSecondPut=true;
 await assert.rejects(m.writePublishDraftPair("guest",{body:"wallet original"},"wallet",{body:"guest original"}));
 f.state.failSecondPut=false;
 const reloaded=await module();
 assert.equal(JSON.parse(await reloaded.readPublishDraft("guest")).body,"guest original");
 assert.equal(JSON.parse(await reloaded.readPublishDraft("wallet")).body,"wallet original");
 await reloaded.writePublishDraftPair("guest",{body:"wallet original"},"wallet",{body:"guest original"});
 assert.equal(JSON.parse(await reloaded.readPublishDraft("guest")).body,"wallet original");
 assert.equal(JSON.parse(await reloaded.readPublishDraft("wallet")).body,"guest original");
});
