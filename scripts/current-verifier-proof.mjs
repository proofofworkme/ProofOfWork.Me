// Explicit verifier-only compatibility identity; never a historical artifact proof.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {readFileSync,lstatSync,realpathSync,readdirSync,readlinkSync} from 'node:fs';
import {resolve,relative,join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
export const currentVerifierArtifact=Object.freeze({commit:'1996225ce530802588da7385695d3b39103e0974',tree:'146bde58f79971333d79eff21f2dd152393f1345'});
export const currentVerifierAllowedDelta=Object.freeze([
 'release-impact.json',
 'scripts/retirement-evidence.mjs','scripts/retirement-current-reader.test.mjs',
 'scripts/retirement-current-evidence.py','scripts/check-retirement-current-repair.test.py',
 'scripts/check-activity-fee-factor-live.mjs','scripts/current-verifier-proof.mjs',
 'scripts/current-verifier-proof.test.mjs','scripts/check-pay-compatibility-live.mjs',
 'scripts/check-pay-compatibility-live.test.mjs',
]);
const brands=new WeakMap(),SHA=/^[a-f0-9]{64}$/,COMMIT=/^[a-f0-9]{40}$/;
const moduleRoot=resolve(fileURLToPath(new URL('../',import.meta.url)));
const env={PATH:'/usr/bin:/bin',HOME:'/nonexistent',LC_ALL:'C',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_NO_REPLACE_OBJECTS:'1',GIT_GRAFT_FILE:'/dev/null',GIT_OPTIONAL_LOCKS:'0'};
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const canonical=value=>JSON.stringify(value);
const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
function git(root,...args){return execFileSync('/usr/bin/git',['--no-replace-objects','-c','core.fsmonitor=false','-c','advice.graftFileDeprecated=false','-C',root,...args],{env,timeout:30000,maxBuffer:16*1024**2});}
const text=(root,...args)=>git(root,...args).toString().trim();
function rootPath(value){assert.equal(typeof value,'string');assert.equal(resolve(value),value,'Absolute normalized repository required');assert.equal(realpathSync(value),value,'Repository symlink forbidden');return value;}
function clean(root,commit,tree){
 rootPath(root);assert.equal(realpathSync(text(root,'rev-parse','--show-toplevel')),root,'Exact Git top-level required');assert(COMMIT.test(commit)&&COMMIT.test(tree));
 assert.equal(text(root,'rev-parse','HEAD'),commit);assert.equal(text(root,'rev-parse','HEAD^{tree}'),tree);
 assert.equal(text(root,'rev-parse','--is-shallow-repository'),'false','Shallow identity forbidden');
 assert.equal(text(root,'for-each-ref','--format=%(refname)','refs/replace'),'','Git replacement refs forbidden');
 assert.equal(text(root,'status','--porcelain=v1','--untracked-files=no'),'','Tracked source must be clean');
 assert.equal(text(root,'ls-files','--others','--','scripts','deploy','src','server'),'','Untracked executable closure files forbidden');
 const graft=resolve(root,text(root,'rev-parse','--git-path','info/grafts'));
 try {assert.equal(readFileSync(graft).length,0,'Git grafts forbidden');} catch(e){if(e.code!=='ENOENT')throw e;}
}
// Every repository file potentially executed by these verifiers is byte-compared
// with its committed blob. This includes undeclared local imports, Python helpers,
// package manifests and tests; sparse omission of this closure is not allowed.
function closure(root,commit){
 const entries=git(root,'ls-tree','-r','-z',commit,'--','scripts','deploy','server','src','package.json','package-lock.json','release-impact.json').toString().split('\0').filter(Boolean).sort();
 assert(entries.length>0&&entries.length<=12000);const rows=[];let total=0;
 const ids=entries.map(e=>{const m=/^(100644|100755) blob ([a-f0-9]{40})\t(.+)$/.exec(e);assert(m,'Nonregular executable closure entry');return m[2];});
 const batch=execFileSync('/usr/bin/git',['--no-replace-objects','-C',root,'cat-file','--batch'],{input:ids.join('\n')+'\n',env,timeout:30000,maxBuffer:160*1024**2});let offset=0;const blobs=[];
 for(const id of ids){const end=batch.indexOf(10,offset);assert(end>=0);const header=batch.subarray(offset,end).toString().split(' ');assert.equal(header[0],id);assert.equal(header[1],'blob');const size=Number(header[2]);assert(Number.isSafeInteger(size)&&size>=0);offset=end+1;blobs.push(batch.subarray(offset,offset+size));offset+=size;assert.equal(batch[offset++],10);}assert.equal(offset,batch.length);
 let blobIndex=0;
 for(const entry of entries){const m=/^(100644|100755) blob ([a-f0-9]{40})\t(.+)$/.exec(entry);assert(m,'Nonregular executable closure entry');const p=join(root,m[3]);assert.equal(realpathSync(p),p,'Closure symlink forbidden');const st=lstatSync(p);assert(st.isFile()&&st.nlink===1,'Closure file identity differs');const raw=readFileSync(p);total+=raw.length;assert(total<=128*1024**2);const committed=blobs[blobIndex++];assert(raw.equals(committed),'Executing closure differs: '+m[3]);rows.push([m[3],m[1],sha(raw)]);}
 return {sha256:sha(canonical(rows)),files:rows.length,bytes:total};
}
function dependencies(artifact,verifier){
 const root=realpathSync(join(artifact,'node_modules'));assert.equal(realpathSync(join(verifier,'node_modules')),root,'Both checkouts must use same existing dependencies');
 const visited=new Set(),rows=[];let bytes=0,count=0;
 function packageAt(from,name){
  const req=createRequire(join(from,'package.json'));let entry=req.resolve(name),dir=dirname(realpathSync(entry));
  assert(dir.startsWith(root+'/'),'External dependency escaped existing node_modules');
  for(;;){try{const raw=readFileSync(join(dir,'package.json')),pkg=JSON.parse(raw);if(pkg.name===name)return {dir,pkg};}catch(e){if(e.code!=='ENOENT'&&!(e instanceof SyntaxError))throw e;}const parent=dirname(dir);assert(parent!==dir&&parent.startsWith(root),'Dependency package boundary missing');dir=parent;}
 }
 function add(from,name){const {dir,pkg}=packageAt(from,name);if(visited.has(dir))return;visited.add(dir);assert(visited.size<=128);
  function walk(d){for(const n of readdirSync(d).sort()){if(n==='node_modules')continue;const p=join(d,n),r=relative(root,p),st=lstatSync(p);assert(++count<=20000);if(st.isSymbolicLink()){assert.fail('Dependency symlinks require explicit reviewed target closure');}else if(st.isDirectory())walk(p);else{assert(st.isFile());bytes+=st.size;assert(bytes<=128*1024**2);rows.push([r,sha(readFileSync(p))]);}}}
  walk(dir);for(const dep of Object.keys(pkg.dependencies??{}).sort())add(dir,dep);
 }
 // BitcoinJS is the only external import in the unchanged local Pay checker
 // closure. Include complete packages and their declared transitive dependencies,
 // rather than unrelated installed node_modules. Native remote runtime dependencies
 // remain bound by the unchanged 16-file/runtime and activation checks.
 add(artifact,'bitcoinjs-lib');assert.equal(createRequire(join(artifact,'package.json')).resolve('bitcoinjs-lib'),createRequire(join(verifier,'package.json')).resolve('bitcoinjs-lib'));
 rows.sort((a,b)=>a[0].localeCompare(b[0]));return {root,sha256:sha(canonical(rows)),packages:visited.size,entries:count,bytes};
}
function observe(spec){
 const {artifactRepository:artifact,verifierRepository:verifier,expectedVerifier:expected}=spec;
 assert.equal(verifier,moduleRoot,'Verifier must execute from its exact checkout');assert.notEqual(artifact,verifier);
 assert.deepEqual(Object.keys(expected).sort(),['closureSha256','commit','dependenciesSha256','nodeSha256','tree']);
 assert(COMMIT.test(expected.commit)&&COMMIT.test(expected.tree));for(const k of ['closureSha256','dependenciesSha256','nodeSha256'])assert(SHA.test(expected[k]));
 clean(artifact,currentVerifierArtifact.commit,currentVerifierArtifact.tree);clean(verifier,expected.commit,expected.tree);
 assert.notEqual(expected.commit,currentVerifierArtifact.commit,'Committed verifier successor required');
 git(verifier,'merge-base','--is-ancestor',currentVerifierArtifact.commit,expected.commit);
 const delta=text(verifier,'diff','--name-only','--no-renames',currentVerifierArtifact.commit,expected.commit).split('\n').filter(Boolean).sort();
 assert(delta.length>0&&delta.every(p=>currentVerifierAllowedDelta.includes(p)),'Unapproved verifier source delta');
 for(const p of delta){assert(/^(100644|100755) blob /.test(text(verifier,'ls-tree',expected.commit,'--',p)),'Verifier delta deletion/symlink forbidden');}
 const v=closure(verifier,expected.commit),a=closure(artifact,currentVerifierArtifact.commit);assert.equal(v.sha256,expected.closureSha256,'Unreviewed verifier closure');
 const dep=dependencies(artifact,verifier);assert.equal(dep.sha256,expected.dependenciesSha256,'Unreviewed installed dependencies');
 const node=realpathSync(process.execPath);assert.equal(sha(readFileSync(node)),expected.nodeSha256,'Unreviewed Node executable');
 return freeze({format:'current-verifier-compatibility-proof-v1',artifact:{repository:artifact,...currentVerifierArtifact,closureSha256:a.sha256},verifier:{repository:verifier,commit:expected.commit,tree:expected.tree,closureSha256:v.sha256},delta,dependencies:dep,node:{path:node,sha256:expected.nodeSha256}});
}
export function createCurrentVerifierProof(spec){const frozen=freeze(structuredClone(spec)),observation=observe(frozen),proof=Object.freeze({format:'current-verifier-compatibility-proof-v1'});brands.set(proof,{spec:frozen,observation});return proof;}
export function validateCurrentVerifierProof(proof,{repository,artifactCommit,artifactTree}={}){const record=brands.get(proof);assert(record,'Authentic current verifier proof required');const fresh=observe(record.spec);assert.deepEqual(fresh,record.observation,'Verifier identity changed');if(repository!==undefined)assert.equal(repository,fresh.verifier.repository);if(artifactCommit!==undefined)assert.equal(artifactCommit,fresh.artifact.commit);if(artifactTree!==undefined)assert.equal(artifactTree,fresh.artifact.tree);return fresh;}
export function publicCurrentVerifierProof(proof){return structuredClone(validateCurrentVerifierProof(proof));}

// Preparation-only inventory: this does not mint an authenticated proof.
export function inspectCurrentVerifierClosure(repository,commit){return closure(rootPath(repository),commit);}
export function inspectCurrentVerifierDependencies(artifactRepository,verifierRepository){return dependencies(rootPath(artifactRepository),rootPath(verifierRepository));}
