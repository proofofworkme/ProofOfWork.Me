import test from "node:test";
import assert from "node:assert/strict";
import { runLinkedGrowthLive } from "./check-linked-growth-live.mjs";
test("all retained checks run sequentially; preactivation settings stay only with linked check",()=>{
 const env={PATH:"/bin",POW_PUBLISH_CHECK_MODE:"preactivation",POW_PUBLISH_CHECK_ORIGIN:"http://127.0.0.1:8081",POW_INTERNAL_VERIFIER_TOKEN:"test-only-not-secret"};
 const calls=[];const result=runLinkedGrowthLive({env,run:(exe,args,opts)=>{calls.push({exe,args,opts});return {status:0};}});
 assert.equal(result.ok,true);assert.equal(calls.length,3);
 assert.deepEqual(calls.map(c=>c.args[0]),["scripts/check-publish-linked-live.mjs","scripts/check-current-growth-live.mjs","scripts/check-activity-fee-factor-live.mjs"]);
 assert.deepEqual(calls[0].opts.env,env);
 assert.deepEqual(calls[1].opts.env,{PATH:"/bin"});
 assert.deepEqual(calls[2].opts.env,{PATH:"/bin"});
 assert.equal(env.POW_PUBLISH_CHECK_MODE,"preactivation");
 assert.ok(calls.every(c=>c.opts.timeout===600_000&&c.opts.stdio==="inherit"));
});
for(const failure of [{status:1},{status:null,signal:"SIGTERM"},{error:new Error("timeout")},{}]) {
 test("fails closed on "+JSON.stringify(failure),()=>{
  let calls=0;
  assert.throws(()=>runLinkedGrowthLive({run:()=>{calls++;return failure;}}),/incomplete/);
  assert.equal(calls,1);
 });
}
test("Growth failure cannot be hidden by successful linked gate",()=>{
 let calls=0;assert.throws(()=>runLinkedGrowthLive({run:()=>({status:++calls===1?0:1})}),/check-current-growth-live/);
 assert.equal(calls,2);
});

test("retained emergency gate failure cannot be hidden by linked and Growth success",()=>{
 let calls=0;assert.throws(()=>runLinkedGrowthLive({run:()=>({status:++calls===3?1:0})}),/check-activity-fee-factor-live/);
 assert.equal(calls,3);
});
