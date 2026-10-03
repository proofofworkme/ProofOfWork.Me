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
test('same-network account change preserves an in-flight public snapshot',async()=>{
  let finish;let seen;
  const f=fixture(async(fresh,signal)=>{seen=signal;return new Promise(resolve=>{finish=resolve;});});
  const result=f.run(false);f.context.marketplaceReadContextRef.current='livenet:other-wallet';f.watch();
  assert.equal(seen.aborted,false);finish({token:{}});
  assert.ok((await result).token);assert.equal(f.cleared(),true);
});
for (const change of ['network','workspace']) test(`${change} change cancels an in-flight public snapshot`,async()=>{
  const f=fixture(async(fresh,signal)=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true})));
  const result=f.run(false);
  if(change==='network')f.context.marketplaceReadContextRef.current='testnet:wallet';
  else f.context.activeWorkspaceStatusKeyRef.current='wallet';
  f.watch();await assert.rejects(result,/workspace changed/);assert.equal(f.cleared(),true);
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
test('public AMO accepts a summary after a same-network account change before polling',async()=>{
  let f;f=fixture(async()=>{f.context.marketplaceReadContextRef.current='livenet:other';return {token:{}};});
  assert.ok((await f.run(false)).token);
});
for(const change of ['network','workspace'])test(`AMO refuses a summary completed after ${change} change before polling`,async()=>{
  let f;f=fixture(async()=>{
    if(change==='network')f.context.marketplaceReadContextRef.current='testnet:wallet';
    else f.context.activeWorkspaceStatusKeyRef.current='wallet';
    return {token:{}};
  });
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

const WORK='d4e5ebf11d104d6a63fb74e42094364b25a5f7199a09e5c0e71408972466a8b8';
const INCB='3cb25745f937f2b4e5508e5400189fe8fe679cd8e84bfa1e9176d70c9761f15d';
const POWB='a3d0bc8528f91dfc52400a885bed7e49235396aa82aa9f95db41be629f1d5562';
const HASH='a'.repeat(64),SNAP='b'.repeat(64),AT='2026-10-02T20:00:00.000Z';
const summary={indexedAt:AT,indexedThroughBlock:969620,indexedThroughBlockHash:HASH};
function listing(tokenId,index=1){return {network:'livenet',confirmed:true,tokenId,listingId:index.toString(16).padStart(64,'0')};}
function history(items){return {...summary,items,totalCount:items.length,snapshotId:SNAP};}
function bind(context,name){return vm.runInNewContext(declaration(name)+`\n${name}`,context);}
function bondContext(fetchBook){
  const context={completeBondListingHistoryRef:{current:new Map()},completeBondListingHistoryInFlightRef:{current:new Map()},fetchCompleteTokenListings:fetchBook};
  context.completeTokenListingHistoryMatchesCheckpoint=bind(context,'completeTokenListingHistoryMatchesCheckpoint');
  context.completeTokenListingHistoryMatchesState=bind(context,'completeTokenListingHistoryMatchesState');
  context.currentCompleteBondTokenListings=bind(context,'currentCompleteBondTokenListings');
  return context;
}
function paginationFixture(items,mutate=()=>{}){
  const requests=[];
  const context={AbortSignal,MAX_TOKEN_HISTORY_PAGES:100,TOKEN_HISTORY_PAGE_SIZE:100,listingDisplayProjectionFingerprint:()=>SNAP,
    fetchTokenHistoryPage:async(network,kind,options)=>{
      requests.push(options);const selected=options.tokenScope?items.filter(item=>item.tokenId===options.tokenScope):items;
      const start=Number(options.cursor??0),end=Math.min(selected.length,start+100),n=selected.length;
      const page={...summary,snapshotId:SNAP,totalCount:n,items:selected.slice(start,end),start,end,limit:100,page:Math.floor(start/100),pageCount:Math.max(1,Math.ceil(n/100)),hasMore:end<n,nextCursor:end<n?String(end):'',cursor:options.cursor??'',kind,network,
        source:'proof-indexer-complete-core-reconciled-token-listings',
        listingAuthority:{model:'proof-token-market-core-gettxout-v1',includeMempool:true,checkpoint:{height:summary.indexedThroughBlock,blockHash:HASH},checkedOutpointsSha256:SNAP,checkedListingCount:n,inputListingCount:n,outputListingCount:n,spentListingCount:0,unspentListingCount:n},
        listingProjection:{model:'proof-token-market-cutover-after-core-v1',membershipSha256:SNAP,activeListingCount:n,coreUnspentListingCount:n,excludedByProtocolCount:0}};
      mutate(page,requests.length,options);return page;
    }};
  return {context,requests,run:bind(context,'fetchCompleteTokenListings')};
}
test('the actual bond loader reads one scoped page instead of the eleven-page whole book',async()=>{
  const book=Array.from({length:1008},(_,i)=>listing(WORK,i+1)).concat(listing(INCB,1009));
  const broad=paginationFixture(book),narrow=paginationFixture(book);
  const whole=await broad.run('livenet');assert.equal(broad.requests.length,11);
  const context=bondContext(narrow.run);
  context.tokenStateWithCompleteTokenListings=(state,h)=>({...state,listings:h.items,totalCounts:{listings:h.totalCount}});
  context.tokenStateWithCompleteTokenBondListings=bind(context,'tokenStateWithCompleteTokenBondListings');
  const result=await bind(context,'tokenStateWithCurrentCompleteBondListings')(summary,INCB);
  assert.equal(narrow.requests.length,1);assert.equal(narrow.requests[0].tokenScope,INCB);
  assert.equal(JSON.stringify(result.listings),JSON.stringify(whole.items.filter(item=>item.tokenId===INCB)));
  assert.equal(result.totalCounts.listings,1);
});
test('every scoped page rejects another token before reporting that page as verified',async()=>{
  const items=Array.from({length:101},(_,i)=>listing(INCB,i+1));const progress=[];
  const f=paginationFixture(items,(page,index)=>{if(index===2)page.items[0]={...page.items[0],tokenId:WORK};});
  await assert.rejects(f.run('livenet',{tokenScope:INCB,onVerifiedPage:value=>progress.push(value)}),/lacks exact checkpoint evidence/);
  assert.equal(f.requests.length,2);assert.equal(progress.length,1);assert.equal(progress[0].complete,false);assert.equal(progress[0].items.length,100);
});
for(const failure of ['Core authority','checkpoint drift','duplicate listing'])test(`scoped pagination retains its ${failure} refusal`,async()=>{
  const f=paginationFixture(Array.from({length:101},(_,i)=>listing(INCB,i+1)),(page,index)=>{
    if(failure==='Core authority')page.listingAuthority.includeMempool=false;
    else if(index===2&&failure==='checkpoint drift'){page.indexedThroughBlockHash='c'.repeat(64);page.listingAuthority.checkpoint.blockHash=page.indexedThroughBlockHash;}
    else if(index===2&&failure==='duplicate listing')page.items[0].listingId=listing(INCB).listingId;
  });
  await assert.rejects(f.run('livenet',{tokenScope:INCB}),/lacks exact checkpoint evidence|changed checkpoints|repeated listing/);
});
test('a final page received after cancellation cannot publish verified progress or a complete book',async()=>{
  const controller=new AbortController();let progress=0;
  const f=paginationFixture([listing(INCB)],()=>controller.abort(new DOMException('late page','AbortError')));
  await assert.rejects(f.run('livenet',{tokenScope:INCB,signal:controller.signal,onVerifiedPage:()=>{progress++;}}),/late page/);
  assert.equal(progress,0);
});
test('bond book caches and concurrent reads are isolated by asset scope',async()=>{
  const calls=[];const pending=new Map();
  const context=bondContext(async(network,options)=>{assert.equal(network,'livenet');calls.push(options.tokenScope);return new Promise(resolve=>pending.set(options.tokenScope,resolve));});
  const a=context.currentCompleteBondTokenListings(summary,INCB),a2=context.currentCompleteBondTokenListings(summary,INCB),b=context.currentCompleteBondTokenListings(summary,POWB);
  assert.deepEqual(calls,[INCB,POWB]);pending.get(INCB)(history([listing(INCB)]));pending.get(POWB)(history([listing(POWB)]));
  const [first,joined,other]=await Promise.all([a,a2,b]);assert.equal(first,joined);assert.equal(other.items[0].tokenId,POWB);
  assert.equal(context.completeBondListingHistoryInFlightRef.current.size,0);
  assert.equal(await context.currentCompleteBondTokenListings(summary,INCB),first);assert.equal(calls.length,2);
});
test('bond caching rechecks a new summary observation and refuses a changed checkpoint',async()=>{
  let calls=0;const context=bondContext(async()=>{calls++;return history([listing(INCB)]);});
  await context.currentCompleteBondTokenListings(summary,INCB);
  await context.currentCompleteBondTokenListings({...summary,indexedAt:'2026-10-02T20:00:01.000Z'},INCB);
  assert.equal(calls,2);
  await assert.rejects(context.currentCompleteBondTokenListings({...summary,indexedThroughBlockHash:'c'.repeat(64)},INCB),/indexed summary snapshot/);
  assert.equal(calls,3);assert.equal(context.completeBondListingHistoryRef.current.get(`livenet:${INCB}`).indexedThroughBlockHash,HASH);
});
for(const lifetime of ['fresh','caller-bound'])test(`${lifetime} bond reads cannot join or clear another in-flight request`,async()=>{
  const existing=new Promise(()=>{}),controller=new AbortController();let options;
  const context=bondContext(async(network,input)=>{options=input;return history([listing(INCB)]);});
  context.completeBondListingHistoryInFlightRef.current.set(`livenet:${INCB}`,existing);
  const result=await context.currentCompleteBondTokenListings(summary,INCB,lifetime==='fresh',undefined,lifetime==='caller-bound'?controller.signal:undefined);
  assert.equal(result.items[0].tokenId,INCB);assert.equal(options.fresh,lifetime==='fresh');assert.equal(options.signal,lifetime==='caller-bound'?controller.signal:undefined);
  assert.equal(context.completeBondListingHistoryInFlightRef.current.get(`livenet:${INCB}`),existing);
});
test('cancelled callers cannot receive retained bond books or populate the bond cache',async()=>{
  const controller=new AbortController();const context=bondContext(async()=>{controller.abort(new DOMException('obsolete bond read','AbortError'));return history([listing(INCB)]);});
  await assert.rejects(context.currentCompleteBondTokenListings(summary,INCB,false,undefined,controller.signal),/obsolete bond read/);
  assert.equal(context.completeBondListingHistoryRef.current.size,0);
  context.completeBondListingHistoryRef.current.set(`livenet:${INCB}`,history([listing(INCB)]));
  await assert.rejects(context.currentCompleteBondTokenListings(summary,INCB,false,undefined,controller.signal),/obsolete bond read/);
});
test('a mixed-asset complete history cannot enter the dedicated bond cache',async()=>{
  const context=bondContext(async()=>history([listing(INCB),listing(WORK,2)]));
  await assert.rejects(context.currentCompleteBondTokenListings(summary,INCB),/asset and indexed summary/);
  assert.equal(context.completeBondListingHistoryRef.current.size,0);assert.equal(context.completeBondListingHistoryInFlightRef.current.size,0);
});
function standaloneFixture(){
  const budget=new AbortController(),calls=[],pending=new Map(),applied=[],watches=[],errors=[],statuses=[];
  const context={network:'livenet',AbortController,DOMException,AbortSignal:{timeout:ms=>{assert.equal(ms,120000);return budget.signal;},any:AbortSignal.any},
    INFINITY_BOND_UI:{tokenId:POWB},INCEPTION_BOND_UI:{tokenId:INCB},
    completeListingBookLoadInFlightRef:{current:new Map()},acceptedBondSummariesRef:{current:new Map([[INCB,{...summary,token:{...summary}}],[POWB,{...summary,token:{...summary}}]])},acceptedMarketplaceSnapshotRef:{current:{...summary,token:{...summary}}},
    activeWorkspaceStatusKeyRef:{current:'bond'},marketplaceReadContextRef:{current:'livenet:wallet'},setInterval:fn=>{watches.push(fn);return watches.length;},clearInterval:()=>{},
    setCompleteListingBookLoading:()=>{},setCompleteListingBookError:value=>{if(value)errors.push(value);},setInfinitySummary:()=>{},setStatusForWorkspace:(key,value)=>statuses.push({key,value}),setTokenMarketHistoryRefreshNonce:()=>{},
    tokenStateScopeKey:input=>`livenet:${input.tokenScope}`,applyTokenState:(value,{scopeKey})=>{applied.push(scopeKey);return value;},errorMessage:String,
    tokenStateWithCurrentCompleteBondListings:async(state,scope,fresh,progress,signal)=>{calls.push({scope,signal});return new Promise(resolve=>pending.set(scope,()=>resolve({...state,listingBookComplete:true})));},
    tokenStateWithCurrentCompleteMarketplaceListings:()=>assert.fail('bond fetched global book')};
  return {context,budget,calls,pending,applied,watches,errors,statuses,run:bind(context,'loadCompleteTokenListingBook')};
}
test('standalone complete bond loads cannot join another asset scope',async()=>{
  const f=standaloneFixture();const a=f.run(INCB),a2=f.run(INCB),b=f.run(POWB);
  assert.deepEqual(f.calls.map(call=>call.scope),[INCB,POWB]);assert.equal(f.context.completeListingBookLoadInFlightRef.current.size,2);
  f.pending.get(INCB)();f.pending.get(POWB)();await Promise.all([a,a2,b]);
  assert.deepEqual(f.applied,[`livenet:${INCB}`,`livenet:${POWB}`]);assert.equal(f.context.completeListingBookLoadInFlightRef.current.size,0);
});
for(const change of ['same-network account','network','workspace','deadline'])test(`standalone bond completion fences a ${change} change`,async()=>{
  const f=standaloneFixture(),result=f.run(INCB);assert.ok(f.calls[0].signal);
  if(change==='same-network account')f.context.marketplaceReadContextRef.current='livenet:other';
  else if(change==='network')f.context.marketplaceReadContextRef.current='testnet:wallet';
  else if(change==='workspace')f.context.activeWorkspaceStatusKeyRef.current='wallet';
  else f.budget.abort(new DOMException('overall history budget','TimeoutError'));
  f.pending.get(INCB)();await result;
  assert.equal(f.applied.length,change==='same-network account'?1:0);
  if(change==='network'||change==='workspace'){
    assert.equal(f.errors.length,0);assert.equal(f.statuses.length,0);
  }
  assert.equal(f.context.completeListingBookLoadInFlightRef.current.size,0);
});
test('an immediate workspace switch starts its own same-asset read before the old poll fires',async()=>{
  const f=standaloneFixture(),old=f.run(INCB),finishOld=f.pending.get(INCB);
  f.context.activeWorkspaceStatusKeyRef.current='other-bond-workspace';
  const current=f.run(INCB),finishCurrent=f.pending.get(INCB);
  assert.equal(f.calls.length,2);assert.notEqual(f.calls[0].signal,f.calls[1].signal);
  assert.equal(f.context.completeListingBookLoadInFlightRef.current.size,2);
  finishOld();await old;
  assert.equal(f.calls[0].signal.aborted,true);assert.equal(f.calls[1].signal.aborted,false);
  assert.equal(f.applied.length,0);assert.equal(f.errors.length,0);assert.equal(f.statuses.length,0);
  finishCurrent();await current;
  assert.deepEqual(f.applied,[`livenet:${INCB}`]);assert.equal(f.context.completeListingBookLoadInFlightRef.current.size,0);
  assert.equal(f.statuses.length,1);assert.equal(f.statuses[0].key,'other-bond-workspace');
});
