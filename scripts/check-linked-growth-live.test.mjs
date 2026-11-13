import test from "node:test";
import assert from "node:assert/strict";
import { runLinkedGrowthLive } from "./check-linked-growth-live.mjs";
test("default active check preserves original ordered public gates",()=>{
 const calls=[];const result=runLinkedGrowthLive({env:{PATH:"/bin"},run:(exe,args,opts)=>{calls.push({exe,args,opts});return {status:0};}});
 assert.equal(result.ok,true);
 assert.deepEqual(calls.map(c=>c.args[0]),["scripts/check-publish-linked-live.mjs","scripts/check-current-growth-live.mjs","scripts/check-activity-fee-factor-live.mjs"]);
 assert.ok(calls.every(c=>c.opts.timeout===600_000&&c.opts.stdio==="inherit"));
 assert.ok(calls.every(c=>c.opts.env.GIT_OPTIONAL_LOCKS==="0"));
});
test("explicit preactivation runs remote checker; public children receive no private settings",()=>{
 const env={PATH:"/bin",POW_PUBLISH_CHECK_MODE:"preactivation",POW_PUBLISH_CHECK_NODE_SOURCE:"/data/example"};
 const calls=[];runLinkedGrowthLive({env,run:(exe,args,opts)=>{calls.push({exe,args,opts});return {status:0};}});
 assert.deepEqual(calls.map(c=>c.args[0]),["scripts/check-publish-linked-remote.mjs","scripts/check-current-growth-live.mjs","scripts/check-activity-fee-factor-live.mjs"]);
 assert.deepEqual(calls[0].opts.env,{...env,GIT_OPTIONAL_LOCKS:"0"});
 assert.deepEqual(calls[1].opts.env,{PATH:"/bin",GIT_OPTIONAL_LOCKS:"0"});assert.deepEqual(calls[2].opts.env,calls[1].opts.env);
 assert.equal(env.POW_PUBLISH_CHECK_MODE,"preactivation");
});
for(const failure of [{status:1},{status:null,signal:"SIGTERM"},{error:new Error("timeout")},{}]) {
 test("fails closed on "+JSON.stringify(failure),()=>{
  let calls=0;assert.throws(()=>runLinkedGrowthLive({run:()=>{calls++;return failure;}}),/incomplete/);assert.equal(calls,1);
 });
}
test("Growth failure cannot be hidden by linked success",()=>{
 let calls=0;assert.throws(()=>runLinkedGrowthLive({run:()=>({status:++calls===1?0:1})}),/check-current-growth-live/);assert.equal(calls,2);
});
test("emergency gate failure cannot be hidden by other success",()=>{
 let calls=0;assert.throws(()=>runLinkedGrowthLive({run:()=>({status:++calls===3?1:0})}),/check-activity-fee-factor-live/);assert.equal(calls,3);
});
