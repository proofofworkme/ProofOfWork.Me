import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const ast=ts.createSourceFile('App.tsx',await readFile('src/App.tsx','utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
let decl; function visit(n){if(ts.isFunctionDeclaration(n)&&n.name?.text==='loadLogHistoryPage')decl=n;ts.forEachChild(n,visit);}visit(ast);assert.ok(decl);
const code=ts.transpileModule(decl.getText(ast),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
class ProofApiRequestError extends Error{constructor(code){super(code);this.code=code;}}
const mismatch=()=>new ProofApiRequestError('CANONICAL_LOG_HISTORY_STABLE_SNAPSHOT_MISMATCH');
async function run({secondError,headId='new',cancel=false,ordinary=false,changeQuery=false,firstPage=false,lateQuery=false,lateGeneration=false,oldCacheTransient=false}={}){
 const calls=[],accepted=[],errors=[],heads=[];
 const env={AbortController,AbortSignal,ProofApiRequestError,
 activityHistoryReadControllerRef:{current:undefined},activityLoadingOwnerRef:{current:undefined},activityProfileRef:{current:undefined},activityQueryRef:{current:'query'},activityHistoryGenerationRef:{current:0},activitySearchGenerationRef:{current:0},activeWorkspaceStatusKeyRef:{current:'log'},network:'livenet',ACTIVITY_FEED_PAGE_SIZE:50,nextProofApiReadAttempt:()=>1,activityHistoryCacheKey:JSON.stringify,
 fetchGlobalActivityHistoryPage:async(_,params)=>{calls.push(params);if(calls.length===1)throw ordinary?new Error('unavailable'):mismatch();if(lateQuery)env.activityQueryRef.current='changed';if(lateGeneration)env.activityHistoryGenerationRef.current++;if(oldCacheTransient)throw new Error('transient');if(secondError)throw mismatch();return {page:0,snapshotId:params.snapshotId,totalCount:1,items:[{id:'new'}]};},
 loadLogHead:async(...args)=>{heads.push(args);if(cancel)env.activityHistoryReadControllerRef.current.abort();if(changeQuery)env.activityQueryRef.current='changed';return headId?{snapshotId:headId}:undefined;},
 clearLastGoodReadWarning(){},acceptActivityHistoryPage:(key,p)=>{accepted.push({key:JSON.parse(key),p});return p;},activityHistoryPagesRef:{current:new Map()},isTransientProofApiReadError:()=>oldCacheTransient,showLastGoodReadWarning:()=>oldCacheTransient,setStatusForWorkspace(){},setActivityLoading(){},setActivityHistoryReading(){},setActivityHistoryReadError:e=>errors.push(e),errorMessage:String};
 if(oldCacheTransient)env.activityHistoryPagesRef.current.set(JSON.stringify({kind:'history',pageIndex:3,pageSize:50,query:'query',snapshotId:'old'}),{page:3,snapshotId:'old',items:[{id:'old'}]});
 const load=new Function(...Object.keys(env),`${code};return loadLogHistoryPage`)(...Object.values(env));
 await load(3,false,'query',{snapshotId:firstPage?undefined:'old'});return {calls,accepted,errors,heads};
}
const ok=await run();assert.equal(ok.calls.length,2);assert.equal(ok.heads.length,1);assert.equal(ok.calls[1].pageIndex,0);assert.equal(ok.calls[1].snapshotId,'new');assert.equal(ok.calls[1].fresh,true);assert.equal(ok.calls[1].query,'query');assert.equal(ok.accepted[0].key.snapshotId,'new');assert.equal(ok.accepted[0].key.pageIndex,0);
for(const opt of [{headId:'old'},{headId:null},{cancel:true},{changeQuery:true},{ordinary:true},{firstPage:true}]){const r=await run(opt);assert.equal(r.calls.length,1);assert.equal(r.accepted.length,0);}
const repeated=await run({secondError:true});assert.equal(repeated.calls.length,2);assert.equal(repeated.heads.length,1);assert.equal(repeated.accepted.length,0);assert.match(repeated.errors.at(-1),/SNAPSHOT_MISMATCH/);
for(const opt of [{lateQuery:true},{lateGeneration:true},{oldCacheTransient:true}]){const r=await run(opt);assert.equal(r.calls.length,2);assert.equal(r.accepted.length,0);}
console.log('11 Log snapshot recovery cases passed; actual App function executed');
