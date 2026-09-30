import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
const source = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('App.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function declaration(name) {
  let found;
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = node.getText(ast);
    ts.forEachChild(node, visit);
  }
  visit(ast); assert.ok(found); return ts.transpileModule(found, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
}
function fixture(fetchSummary) {
  const budget = new AbortController(); let watch; let cleared = false;
  const context = {
    AbortController, DOMException,
    AbortSignal: { timeout(ms) { assert.equal(ms,120000); return budget.signal; }, any: AbortSignal.any },
    network:'livenet',address:'wallet',activeWorkspaceStatusKeyRef:{current:'amo'},marketplaceReadContextRef:{current:'livenet:wallet'},
    setInterval(fn) { watch=fn;return 1; }, clearInterval() { cleared=true; },
    setTimeout(fn) { fn(); },
    fetchMarketplaceSummary: fetchSummary,
    tokenStateWithCurrentCompleteMarketplaceListings: async (token,fresh,progress,signal) => {signal.throwIfAborted();return token;},
  };
  const run = vm.runInNewContext(declaration('fetchCompleteMarketplaceSnapshot')+'\nfetchCompleteMarketplaceSnapshot',context);
  return {run,budget,context,watch:()=>watch(),cleared:()=>cleared};
}
test('refused snapshots retry once under the same overall deadline',async()=>{
  const signals=[];const f=fixture(async(fresh,signal)=>{signals.push(signal);throw Error('checkpoint refused');});
  await assert.rejects(f.run(false),/checkpoint refused/);
  assert.equal(signals.length,2);assert.equal(signals[0],signals[1]);assert.equal(f.cleared(),true);
});
test('deadline cancels an in-flight request without a new retry or partial snapshot',async()=>{
  let calls=0;const f=fixture(async(fresh,signal)=>{calls++;return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));});
  const result=f.run(false);f.budget.abort(new DOMException('budget exhausted','TimeoutError'));
  await assert.rejects(result,/budget exhausted/);assert.equal(calls,1);assert.equal(f.cleared(),true);
});
test('wallet/workspace change cancels the old snapshot request',async()=>{
  const f=fixture(async(fresh,signal)=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true})));
  const result=f.run(false);f.context.marketplaceReadContextRef.current='livenet:other-wallet';f.watch();
  await assert.rejects(result,/workspace changed/);assert.equal(f.cleared(),true);
});
test('complete listing pagination passes its overall deadline to the API and stops on cancellation',async()=>{
  const budget=new AbortController();let signal;
  const context={AbortSignal:{timeout:()=>budget.signal,any:AbortSignal.any},MAX_TOKEN_HISTORY_PAGES:100,TOKEN_HISTORY_PAGE_SIZE:100,
    fetchTokenHistoryPage:async(network,kind,options)=>{signal=options.signal;budget.abort(new DOMException('cancelled','AbortError'));throw signal.reason;}};
  const run=vm.runInNewContext(declaration('fetchCompleteTokenListings')+'\nfetchCompleteTokenListings',context);
  await assert.rejects(run('livenet'),/cancelled/);assert.equal(signal,budget.signal);
});
test('AMO summary forwards caller cancellation into the real API client call',async()=>{
  const controller=new AbortController();let seen;
  const context={URLSearchParams,fetchProofApiJson:async(path,network,options)=>{seen=options.signal;throw Error('fixture stop');}};
  const run=vm.runInNewContext(declaration('fetchMarketplaceSummary')+'\nfetchMarketplaceSummary',context);
  await assert.rejects(run(false,controller.signal),/fixture stop/);assert.equal(seen,controller.signal);
});
test('fresh book verification cannot join a non-fresh request',async()=>{
  const existing=Promise.resolve({id:'older'});let options;
  const context={completeMarketplaceListingHistoryRef:{current:undefined},completeMarketplaceListingHistoryInFlightRef:{current:existing},
    fetchCompleteTokenListings:async(network,input)=>{options=input;return {id:'fresh'};},completeTokenListingHistoryMatchesState:()=>true};
  const run=vm.runInNewContext(declaration('currentCompleteGlobalTokenListings')+'\ncurrentCompleteGlobalTokenListings',context);
  const result=await run({},true);assert.equal(result.id,'fresh');assert.equal(options.fresh,true);
  assert.equal(context.completeMarketplaceListingHistoryInFlightRef.current,existing);
});
test('caller-bound book verification keeps a separate cancellation lifetime',async()=>{
  const controller=new AbortController();let options;
  const existing=new Promise(()=>{});
  const context={completeMarketplaceListingHistoryRef:{current:undefined},completeMarketplaceListingHistoryInFlightRef:{current:existing},
    fetchCompleteTokenListings:async(network,input)=>{options=input;return {id:'own'};},completeTokenListingHistoryMatchesState:()=>true};
  const run=vm.runInNewContext(declaration('currentCompleteGlobalTokenListings')+'\ncurrentCompleteGlobalTokenListings',context);
  assert.equal((await run({},false,undefined,controller.signal)).id,'own');assert.equal(options.signal,controller.signal);
  assert.equal(context.completeMarketplaceListingHistoryInFlightRef.current,existing);
});
test('cancelled caller cannot receive a cached complete book',async()=>{
  const controller=new AbortController();controller.abort(new DOMException('old context','AbortError'));
  const context={completeMarketplaceListingHistoryRef:{current:{indexedAt:'same'}},completeMarketplaceListingHistoryInFlightRef:{current:null},completeTokenListingHistoryMatchesState:()=>true};
  const run=vm.runInNewContext(declaration('currentCompleteGlobalTokenListings')+'\ncurrentCompleteGlobalTokenListings',context);
  await assert.rejects(run({indexedAt:'same'},false,undefined,controller.signal),/old context/);
});
test('listing history forwards its cancellation signal through to the API client',async()=>{
  const controller=new AbortController();let seen;
  const context={URLSearchParams,DATA_PAGE_SIZE:100,fetchProofApiJson:async(path,network,options)=>{seen=options.signal;throw Error('fixture stop');}};
  const run=vm.runInNewContext(declaration('fetchTokenHistoryPage')+'\nfetchTokenHistoryPage',context);
  await assert.rejects(run('livenet','listings',{signal:controller.signal}),/fixture stop/);assert.equal(seen,controller.signal);
});
test('wallet hydration shares its deadline with pending-seal reads and never saves cancelled data',async()=>{
  const budget=new AbortController();let pendingSignal;let cleared=false;
  const context={AbortController,DOMException,AbortSignal:{timeout:()=>budget.signal,any:AbortSignal.any},
    activeWorkspaceStatusKeyRef:{current:'wallet'},marketplaceReadContextRef:{current:'livenet:wallet'},setInterval:()=>1,clearInterval:()=>{cleared=true;},
    currentCompleteGlobalTokenListings:async(state,fresh,progress,signal)=>{signal.throwIfAborted();return {items:[]};},
    fetchPendingTokenListingSealsForAddress:async(address,network,signal)=>{pendingSignal=signal;return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));},
    savePendingTokenListingSeals:()=>assert.fail('cancelled data saved')};
  const run=vm.runInNewContext(declaration('fetchWalletOwnedTokenListings')+'\nfetchWalletOwnedTokenListings',context);
  const result=run('wallet','token',{});await new Promise(resolve=>setImmediate(resolve));assert.ok(pendingSignal);
  budget.abort(new DOMException('wallet budget exhausted','TimeoutError'));
  await assert.rejects(result,/wallet budget exhausted/);assert.equal(cleared,true);
});
test('wallet hydration cancels when its wallet or workspace becomes obsolete',async()=>{
  let watch;let cleared=false;
  const context={AbortController,DOMException,AbortSignal,
    activeWorkspaceStatusKeyRef:{current:'wallet'},marketplaceReadContextRef:{current:'livenet:wallet'},setInterval:fn=>{watch=fn;return 1;},clearInterval:()=>{cleared=true;},
    currentCompleteGlobalTokenListings:async(state,fresh,progress,signal)=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}))};
  const run=vm.runInNewContext(declaration('fetchWalletOwnedTokenListings')+'\nfetchWalletOwnedTokenListings',context);
  const result=run('wallet','token',{});context.marketplaceReadContextRef.current='livenet:other';watch();
  await assert.rejects(result,/context changed/);assert.equal(cleared,true);
});
test('AMO rejects a summary completed after wallet change before the polling interval fires',async()=>{
  let f;f=fixture(async()=>{f.context.marketplaceReadContextRef.current='livenet:other';return {token:{}};});
  f.context.tokenStateWithCurrentCompleteMarketplaceListings=()=>assert.fail('obsolete summary hydrated');
  await assert.rejects(f.run(false),/workspace changed/);
});
test('wallet rejects a book completed after wallet change without starting pending reads',async()=>{
  const context={AbortController,DOMException,AbortSignal,activeWorkspaceStatusKeyRef:{current:'wallet'},marketplaceReadContextRef:{current:'livenet:wallet'},setInterval:()=>1,clearInterval:()=>{},
    currentCompleteGlobalTokenListings:async()=>{context.marketplaceReadContextRef.current='livenet:other';return {items:[]};},
    fetchPendingTokenListingSealsForAddress:()=>assert.fail('obsolete pending read started')};
  const run=vm.runInNewContext(declaration('fetchWalletOwnedTokenListings')+'\nfetchWalletOwnedTokenListings',context);
  await assert.rejects(run('wallet','token',{}),/context changed/);
});
test('wallet rejects pending reads completed after context change before saving or publishing',async()=>{
  const context={AbortController,DOMException,AbortSignal,activeWorkspaceStatusKeyRef:{current:'wallet'},marketplaceReadContextRef:{current:'livenet:wallet'},setInterval:()=>1,clearInterval:()=>{},
    currentCompleteGlobalTokenListings:async()=>({items:[]}),
    fetchPendingTokenListingSealsForAddress:async()=>{context.marketplaceReadContextRef.current='livenet:other';return [];},
    savePendingTokenListingSeals:()=>assert.fail('obsolete data saved')};
  const run=vm.runInNewContext(declaration('fetchWalletOwnedTokenListings')+'\nfetchWalletOwnedTokenListings',context);
  await assert.rejects(run('wallet','token',{}),/context changed/);
});
