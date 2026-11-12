import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync("src/App.tsx", "utf8");
const ast = ts.createSourceFile("App.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const transpile = text => ts.transpileModule(text, {compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
}}).outputText;
function declaration(name) {
  return ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
}
const helperNode = declaration("publicLogActivityStats");
assert(helperNode);
const normalize = new Function(transpile(helperNode.getText(ast)) + "; return publicLogActivityStats;")();
const fixture = () => ({
  snapshotId: "af346fbda0a190ecda049074",
  stats: {total:33141, confirmed:32881, pending:259, dataBytes:7920472},
  consistency: {ok:true, checks:[{name:"canonical-activity-count-matches-public-log",ok:true,
    details:{ledgerActivityCount:33141,canonicalActivityCount:33140,publicLogActivityCount:33140,
      supplementalActivityCount:1,ledgerConfirmedActivityCount:32881,
      canonicalConfirmedActivityCount:32881,publicLogConfirmedActivityCount:32881,
      supplementalConfirmedActivityCount:0}}]},
});
test("authenticated supplemental ledger count normalizes only public display total", () => {
  const payload=fixture(), before=structuredClone(payload);
  assert.deepEqual(normalize(payload), {...payload.stats,total:33140});
  assert.deepEqual(payload,before);
  assert.equal(normalize(payload).confirmed+normalize(payload).pending,33140);
  assert.equal(payload.consistency.checks[0].details.supplementalActivityCount,1);
});
test("proven confirmed supplements are excluded consistently from public counts", () => {
  const payload=fixture(); const d=payload.consistency.checks[0].details;
  payload.stats.confirmed=32882;d.ledgerConfirmedActivityCount=32882;
  d.supplementalConfirmedActivityCount=1;
  const before=structuredClone(payload);
  assert.deepEqual(normalize(payload),{...payload.stats,total:33140,confirmed:32881});
  assert.equal(normalize(payload).confirmed+normalize(payload).pending,33140);
  assert.deepEqual(payload,before);
});
test("zero supplemental and verified empty global Log retain exact totals", () => {
  const payload=fixture(); const d=payload.consistency.checks[0].details;
  d.ledgerActivityCount=33140;d.supplementalActivityCount=0;payload.stats.total=33140;
  assert.equal(normalize(payload).total,33140);
  for(const k of Object.keys(d))d[k]=0;
  payload.stats={total:0,confirmed:0,pending:0};
  assert.deepEqual(normalize(payload),payload.stats);
});
test("missing, partial, failed or inconsistent proof never invents a public total", () => {
  for(const mutate of [
    p=>delete p.snapshotId,p=>delete p.consistency,p=>p.consistency.ok=false,
    p=>p.consistency.checks[0].ok=false,p=>p.consistency.checks.push(p.consistency.checks[0]),
    p=>p.consistency.checks[0].details.publicLogActivityCount="33140",
    p=>p.consistency.checks[0].details.publicLogActivityCount=-1,
    p=>p.consistency.checks[0].details.canonicalActivityCount=33139,
    p=>p.consistency.checks[0].details.ledgerActivityCount=33142,
    p=>p.consistency.checks[0].details.supplementalActivityCount=2,
    p=>p.consistency.checks[0].details.supplementalConfirmedActivityCount=1,
    p=>p.consistency.checks[0].details.ledgerConfirmedActivityCount=32880,
    p=>p.consistency.checks[0].details.ledgerConfirmedActivityCount="32881",
    p=>{p.stats.confirmed=32882;p.consistency.checks[0].details.ledgerConfirmedActivityCount=32882;},

    p=>p.consistency.checks[0].details.canonicalConfirmedActivityCount=32880,
    p=>delete p.stats.pending,p=>p.stats.pending=260,
  ]) {const p=fixture(); mutate(p);assert.equal(normalize(p),p.stats);}
  assert.equal(normalize({}),undefined);
});

// Execute the actual workspace scope/count expressions, not a copied algorithm.
const workspace=declaration("ActivityWorkspace");
const names=["stats","resultsVerified","readStateLabel","totalCount","countedItems",
  "pageCountsOnly","pendingCount","confirmedCount"];
const statements=names.map(name=>{
  const node=workspace.body.statements.find(statement=>ts.isVariableStatement(statement)&&
    statement.declarationList.declarations.some(d=>ts.isIdentifier(d.name)&&d.name.text===name));
  assert(node,name);return node.getText(ast);
}).join("\n");
const scope=(args={})=>{
  const bindings={matchingProfile:undefined,normalizedQuery:"",useServerPage:true,
    activityStats:{...normalize(fixture()),snapshotId:"snap"},activityHistoryPage:{snapshotId:"snap"},
    activityPage:{totalCount:33140,items:[{confirmed:false,confirmationStatus:"pending"}]},
    items:[],busy:false,readError:"",...args};
  return new Function(...Object.keys(bindings),transpile(statements)+
    ";return {stats,resultsVerified,readStateLabel,totalCount,pageCountsOnly,pendingCount,confirmedCount};")(...Object.values(bindings));
};
test("unfiltered overview agrees with public pagination and both status counts",()=>{
  const result=scope(); assert.equal(result.totalCount,33140);
  assert.equal(result.pendingCount,259);assert.equal(result.confirmedCount,32881);
  assert.equal(result.pageCountsOnly,false);
});
test("filtered and profile views never borrow global or ledger count",()=>{
  for(const args of [{normalizedQuery:"txid"},{matchingProfile:{address:"wallet"}}]){
    const result=scope({...args,activityPage:{totalCount:7,items:[{confirmed:true}]}});
    assert.equal(result.stats,undefined);assert.equal(result.totalCount,7);
    assert.equal(result.pageCountsOnly,true);assert.equal(result.confirmedCount,1);
  }
});
test("snapshot mismatch and unavailable views retain page-only and unknown semantics",()=>{
  const mismatch=scope({activityHistoryPage:{snapshotId:"other"},
    activityPage:{totalCount:8,items:[{confirmed:false,confirmationStatus:"pending"}]}});
  assert.equal(mismatch.stats,undefined);assert.equal(mismatch.totalCount,8);
  assert.equal(mismatch.pageCountsOnly,true);assert.equal(mismatch.pendingCount,1);
  const unavailable=scope({useServerPage:false,activityStats:undefined,readError:"offline"});
  assert.equal(unavailable.resultsVerified,false);assert.equal(unavailable.readStateLabel,"Unavailable");
});
test("payload application uses proof-normalized stats, not a page count",()=>{
  assert.match(source,/normalizeActivityStats\(publicLogActivityStats\(payload\), activity\)/u);
  assert.doesNotMatch(helperNode.getText(ast),/activityHistoryPage|page\.totalCount/u);
});
