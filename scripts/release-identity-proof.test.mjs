import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,symlinkSync,chmodSync,renameSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve,dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createIdentityProof,requireIdentityProof,publicIdentityProof,readIdentityTree,
 identityTreeDelta,inspectIdentitySource,assertIdentityAncestor,assertIdentityStable } from "./release-identity-proof.mjs";

function fixture(t) {
 const root=mkdtempSync(resolve(tmpdir(),"pow-identity-"));
 t.after(()=>rmSync(root,{recursive:true,force:true}));
 const git=(...args)=>execFileSync("git",args,{cwd:root,encoding:"utf8"}).trim();
 git("init","-q");git("config","user.name","Fixture");git("config","user.email","fixture@example.invalid");
 mkdirSync(resolve(root,"scripts"));
 writeFileSync(resolve(root,"scripts/check.mjs"),'import assert from "node:assert/strict";\n');
 writeFileSync(resolve(root,"package.json"),'{"type":"module"}\n');
 git("add",".");git("commit","-qm","fixture");
 return {root,git,head:git("rev-parse","HEAD"),paths:["scripts/check.mjs","package.json"]};
}
test("tree delta exhaustively rejects unapproved additions, removals, modes, types and blobs",()=>{
 const base=new Map([["product.mjs",{mode:"100644",type:"blob",blob:"a"}]]);
 for(const changed of [
  new Map([...base,["extra.mjs",{mode:"100644",type:"blob",blob:"b"}]]),
  new Map(),
  new Map([["product.mjs",{mode:"100755",type:"blob",blob:"a"}]]),
  new Map([["product.mjs",{mode:"160000",type:"commit",blob:"a"}]]),
  new Map([["product.mjs",{mode:"100644",type:"blob",blob:"b"}]]),
 ]) assert.throws(()=>identityTreeDelta(base,changed,new Set(["scripts/release-identity-proof.mjs"])),/Unapproved/);
 assert.deepEqual(identityTreeDelta(base,new Map(base),new Set()),[]);
});
test("approved delta records full before/after identity, not name-only parity",()=>{
 const old=new Map([["x",{mode:"100644",type:"blob",blob:"a"}]]),next=new Map([["x",{mode:"100755",type:"blob",blob:"b"}]]);
 assert.deepEqual(identityTreeDelta(old,next,new Set(["x"])),[{path:"x",before:old.get("x"),after:next.get("x")}]);
});
test("real Git fixture enforces clean exact closure but preserves unrelated untracked evidence",t=>{
 const f=fixture(t),before=inspectIdentitySource(f.root,f.head,f.paths);
 writeFileSync(resolve(f.root,"untracked.mjs"),'throw Error("not loaded")');
 assert.deepEqual(inspectIdentitySource(f.root,f.head,f.paths),before);
 assert.equal(readIdentityTree(f.root,f.head).size,2);
});
test("dirty tracked source rejects",t=>{
 const f=fixture(t);writeFileSync(resolve(f.root,"scripts/check.mjs"),"changed");
 assert.throws(()=>inspectIdentitySource(f.root,f.head,f.paths),/Tracked source/);
});
test("assume-unchanged cannot hide altered executable bytes",t=>{
 const f=fixture(t);f.git("update-index","--assume-unchanged","scripts/check.mjs");writeFileSync(resolve(f.root,"scripts/check.mjs"),"changed");
 assert.throws(()=>inspectIdentitySource(f.root,f.head,f.paths),/Hidden index flags/);
});
test("assume-unchanged cannot hide executable mode change",t=>{
 const f=fixture(t);f.git("update-index","--assume-unchanged","scripts/check.mjs");chmodSync(resolve(f.root,"scripts/check.mjs"),0o755);
 assert.throws(()=>inspectIdentitySource(f.root,f.head,f.paths),/Hidden index flags/);
});
test("symlinked executable and untracked package scope reject",t=>{
 const f=fixture(t);writeFileSync(resolve(f.root,"scripts/package.json"),'{"type":"module"}');
 assert.throws(()=>inspectIdentitySource(f.root,f.head,f.paths),/Unexpected package scope/);
 rmSync(resolve(f.root,"scripts/package.json"));
 const target=resolve(f.root,"copy.mjs");writeFileSync(target,readFileSync(resolve(f.root,"scripts/check.mjs")));
 f.git("update-index","--assume-unchanged","scripts/check.mjs");rmSync(resolve(f.root,"scripts/check.mjs"));symlinkSync(target,resolve(f.root,"scripts/check.mjs"));
 assert.throws(()=>inspectIdentitySource(f.root,f.head,f.paths),/Symlink|Hidden index flags/);
});
test("untracked executable cannot become closure input",t=>{
 const f=fixture(t);writeFileSync(resolve(f.root,"scripts/extra.mjs"),"");
 assert.throws(()=>inspectIdentitySource(f.root,f.head,[...f.paths,"scripts/extra.mjs"]),/committed regular/);
});
test("concurrent HEAD and second-snapshot changes reject",t=>{
 const f=fixture(t),before=inspectIdentitySource(f.root,f.head,f.paths);
 f.git("commit","--allow-empty","-qm","later");
 assert.throws(()=>inspectIdentitySource(f.root,f.head,f.paths),/HEAD/);
 assert.throws(()=>assertIdentityStable(before,{...before,commit:f.git("rev-parse","HEAD")}),/changed/);
});
test("real divergent ancestry rejects",t=>{
 const f=fixture(t);f.git("checkout","--orphan","other");f.git("commit","-qm","unrelated");
 assert.throws(()=>assertIdentityAncestor(f.root,f.head,f.git("rev-parse","HEAD")));
});
test("fixture repository cannot override pinned production identities",t=>{
 const f=fixture(t);
 assert.throws(()=>createIdentityProof({repository:f.root,artifact:f.head,operator:f.head}),/outside requested/);
});
test("JSON and object forgeries never acquire proof brand",()=>{
 for(const fake of [null,{},Object.freeze({format:"proof-of-work-explicit-release-identities-v1"}),JSON.parse('{"artifact":{}}')]) {
  assert.throws(()=>requireIdentityProof(fake),/Authentic/);
  assert.throws(()=>publicIdentityProof(fake),/Authentic/);
 }
});
// Positive branding requires the actual committed operator, not configurable
// production IDs or a test-only mint. Run this after the qualification commit.
test("actual committed operator produces immutable branded proof",{skip:!process.env.POW_IDENTITY_TEST_REPOSITORY},()=>{
 const proof=createIdentityProof({repository:process.env.POW_IDENTITY_TEST_REPOSITORY});
 assert.equal(requireIdentityProof(proof),proof);
 assert(Object.isFrozen(proof)&&Object.isFrozen(proof.artifact)&&Object.isFrozen(proof.baselineDelta));
 assert.throws(()=>{proof.artifact.commit="bad";},TypeError);
 const copy=publicIdentityProof(proof);
 assert.throws(()=>requireIdentityProof(copy),/Authentic/);
 assert.equal(proof.baselineDelta.length,14);
 assert.equal(proof.baselineOperator.commit,"c7cfa32ae01ae70042bac0539ddf74d816ae474a");
 assert.equal(typeof proof.operator.commit,"string");assert(!Object.hasOwn(proof,"implementation"));
 assert(Array.isArray(proof.operatorDelta));
});

test("canonical root and executable ancestor symlinks reject",t=>{
 const f=fixture(t),alias=f.root+"-alias";
 symlinkSync(f.root,alias);t.after(()=>rmSync(alias,{force:true}));
 assert.throws(()=>inspectIdentitySource(alias,f.head,f.paths),/canonical/);
 renameSync(resolve(f.root,"scripts"),resolve(f.root,"real-scripts"));
 symlinkSync(resolve(f.root,"real-scripts"),resolve(f.root,"scripts"));
 assert.throws(()=>inspectIdentitySource(f.root,f.head,f.paths),/Tracked source|Symlink/);
});
test("skip-worktree cannot conceal product changes outside executable closure",t=>{
 const f=fixture(t);writeFileSync(resolve(f.root,"product.txt"),"original");
 f.git("add",".");f.git("commit","-qm","product");
 f.git("update-index","--skip-worktree","product.txt");writeFileSync(resolve(f.root,"product.txt"),"hidden");
 assert.throws(()=>inspectIdentitySource(f.root,f.git("rev-parse","HEAD"),f.paths),/Hidden index flags/);
});

test("Git identity reads ignore inherited executable, object and config overrides",t=>{
 const f=fixture(t),keys=["PATH","HOME","GIT_DIR","GIT_WORK_TREE","GIT_OBJECT_DIRECTORY","GIT_ALTERNATE_OBJECT_DIRECTORIES","GIT_CONFIG_COUNT","GIT_CONFIG_KEY_0","GIT_CONFIG_VALUE_0","GIT_CONFIG_GLOBAL"];
 const prior=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
 try{
  for(const key of keys)process.env[key]="/nonexistent-attacker";
  process.env.GIT_CONFIG_COUNT="1";process.env.GIT_CONFIG_KEY_0="core.fsmonitor";process.env.GIT_CONFIG_VALUE_0="/nonexistent-attacker";
  assert.equal(inspectIdentitySource(f.root,f.head,f.paths).commit,f.head);
 }finally{for(const key of keys)if(prior[key]===undefined)delete process.env[key];else process.env[key]=prior[key];}
});

test("unchanged lifecycle executor is bound and a hidden mode substitution refuses",t=>{
 const code=readFileSync(new URL("./release-identity-proof.mjs",import.meta.url),"utf8");
 assert(code.slice(code.indexOf("const closurePaths ="),code.indexOf("const proofs")).includes('"deploy/ui-retention/lifecycle.py"'));
 const f=fixture(t),name="deploy/ui-retention/lifecycle.py";
 mkdirSync(dirname(resolve(f.root,name)),{recursive:true});writeFileSync(resolve(f.root,name),"# fixture");
 f.git("add",".");f.git("commit","-qm","lifecycle");const head=f.git("rev-parse","HEAD");
 f.git("config","core.filemode","false");chmodSync(resolve(f.root,name),0o755);
 assert.throws(()=>inspectIdentitySource(f.root,head,[...f.paths,name]),/mode differs/);
});

test("activity runtime profile and monitor inputs remain inside the committed closure",()=>{
 const code=readFileSync(new URL("./release-identity-proof.mjs",import.meta.url),"utf8");
 const closure=code.slice(code.indexOf("const closurePaths ="),code.indexOf("const proofs"));
 for(const path of ["deploy/audit-remediation/profile.py","deploy/activity-fee-factor/profile.py","deploy/linked-publish/profile.py","deploy/proofofwork-postgres-query-health.sh"])
  assert(closure.includes(JSON.stringify(path)),path);
});
