import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {execFileSync} from "node:child_process";
import {request as httpsRequest} from "node:https";
import {request as httpRequest} from "node:http";
import {resolve} from "node:path";
import {createIdentityProof,requireIdentityProof,publicIdentityProof} from "./release-identity-proof.mjs";
import {runRemotePublishPreactivation} from "./check-publish-linked-remote.mjs";
import {runActivityFeeFactorLive} from "./check-activity-fee-factor-live.mjs";

const primary="/home/sixer/ProofOfWork.Me";
const github="https://github.com/proofofworkme/ProofOfWork.Me.git";
const buildRoot="/data/proofofwork-ui-builds/stock-064b699-20261114";
const source=buildRoot+"/proofofwork-ui-source-064b6991ae2a-20261114T020148Z";
const anchors=Object.freeze({
 plan:{path:"/data/proofofwork-linked-release-qualification-609d5a1-20261113/plan.json",sha256:"6ca83113503039e2ef7a03f232cb1b59b80804da8cc7f068c6e4c83fe91a5483"},
 qualification:{path:"/data/proofofwork-linked-release-qualification-609d5a1-20261113/qualification-writer-off.json",sha256:"342ea3e50e956edcaf5f57434cd6e51fec64d251def3832c9e43a9934f8e4bf1"},
 nativeV2:{owner:108,path:"/data/proofofwork-search-native-fixture-exact609d5a1-20261113/output/completed.json",sha256:"516b7712365a221bf64a6bb389db56f0b1d97fdf9bffccadabd0406df054bc68"},
 browserV2:{path:"/data/proofofwork-health-fixes-20261111/source-work/linked-growth-mail-incb-qa-20261113/browser-projection-609d5a1/core52-projection.json",sha256:"b344fbb4f069c8b92daaf314f7e68fdc0c68e93e0a3e3336ff42668f7b9c33c7"},
 archive:{path:"/data/proofofwork-release-backups/managed/proofofwork-node-release-92eb5fbdaacf-accepted-overlays-20261113T145615Z.tgz",sha256:"88a26b00aa08523544707481cb55cddae5c947c70d0cc4b15c9228b74027f57d",bytes:117602515},
});
const hosts=Object.freeze({activity:"log",boost:"boost",browser:"browser",code:"code",computer:"computer",desktop:"desktop",dns:"dns",growth:"growth",id:"id",inception:"inception",infinity:"infinity",jobs:"jobs",landing:"www",marketplace:"amo",nft:"computer",pages:"pages",permission:"permission",publish:"publish",search:"search",token:"credit",wallet:"wallet",work:"work"});
const roleByName=Object.freeze({primary:"operator",build:"artifact",uiManifest:"artifact",sourceProvenance:"artifact",renderer:"artifact",runtime:"backend",lifecycle:"artifact",preactivation:"artifact",activity:"artifact",growth:"artifact",nativeV2:"backend",browserV2:"backend"});
const collections=new WeakSet();
const transportEnv=Object.freeze({PATH:"/usr/bin:/bin",HOME:"/nonexistent",GIT_OPTIONAL_LOCKS:"0",GIT_NO_REPLACE_OBJECTS:"1",GIT_CONFIG_GLOBAL:"/dev/null",GIT_CONFIG_NOSYSTEM:"1",GIT_GRAFT_FILE:"/dev/null"});
const sha=raw=>createHash("sha256").update(raw).digest("hex");
const freeze=value=>{if(value&&typeof value==="object"){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
const quote=value=>"'"+value.replaceAll("'","'\\''")+"'";
function exec(command,args,options={}) {
 return execFileSync(command,args,{encoding:"utf8",timeout:45000,maxBuffer:32*1024**2,
  env:{...transportEnv},...options});
}
function git(root,...args){return exec("/usr/bin/git",["--no-replace-objects","-c","core.fsmonitor=false","-c","advice.graftFileDeprecated=false","-C",root,...args]).trim();}
function ssh(machine,program,input,timeout=180000) {
 const node=machine==="node";assert(node||machine==="ui");
 return exec("ssh",["-i",node?"/home/sixer/.ssh/proofofwork_node_ed25519":"/home/sixer/.ssh/proofofwork_me_ed25519",
  "-o","BatchMode=yes","-o","IdentitiesOnly=yes","-o","StrictHostKeyChecking=yes","-o","ConnectTimeout=15",
  node?"powadmin@65.108.122.87":"root@77.42.91.106",
  (node?"sudo -n ":"")+"/usr/bin/python3 -I -B -c "+quote(program)],{input:JSON.stringify(input),timeout});
}
export function parseCollectedJson(raw,limit=16*1024**2) {
 assert.equal(typeof raw,"string");assert(Buffer.byteLength(raw)<=limit,"Oversized collection response");
 const result=JSON.parse(raw);assert(result&&typeof result==="object"&&!Array.isArray(result),"Collection object required");
 // JSON.parse accepts duplicate properties. Scan already syntax-validated JSON
 // solely to reject ambiguous keys, including escaped spellings and nesting.
 let i=0;
 const white=()=>{while(i<raw.length&&/\s/u.test(raw[i]))i++;};
 const string=()=>{const start=i++;while(i<raw.length){if(raw.charCodeAt(i)===92){i+=2;continue;}if(raw.charCodeAt(i++)===34)break;}return JSON.parse(raw.slice(start,i));};
 const scan=depth=>{
  assert(depth<=128,"Collection nesting limit");white();
  if(raw[i]==="{"){i++;white();const seen=new Set();if(raw[i]==="}"){i++;return;}
   while(true){white();const key=string();assert(!seen.has(key),"Duplicate collection JSON key");seen.add(key);white();i++;scan(depth+1);white();if(raw[i++]==="}")return;}
  }
  if(raw[i]==="["){i++;white();if(raw[i]==="]"){i++;return;}while(true){scan(depth+1);white();if(raw[i++]==="]")return;}}
  if(raw[i]==='"'){string();return;}
  while(i<raw.length&&!/[\s,}\]]/u.test(raw[i]))i++;
 };
 scan(0);return result;
}
function httpRead(url,limit=128*1024) {
 // Only hardwired public origins and the exact local preview are admitted.
 const u=new URL(url);
 assert(u.protocol==="https:"&&Object.values(hosts).some(h=>u.origin==="https://"+h+".proofofwork.me") ||
   u.origin==="http://127.0.0.1:4175","Unapproved collection origin");
 assert(u.pathname==="/source-provenance.json" || u.origin==="https://publish.proofofwork.me"&&u.pathname==="/publish-render-provenance.json","Unapproved collection path");
 return new Promise((resolve,reject)=>{
  const req=(u.protocol==="https:"?httpsRequest:httpRequest)(u,{method:"GET",headers:{"Cache-Control":"no-store"},timeout:30000},res=>{
   if(res.statusCode!==200){res.resume();reject(Error("Collection HTTP status "+res.statusCode));return;}
   let length=0;const chunks=[];
   res.on("data",chunk=>{length+=chunk.length;if(length>limit){req.destroy(Error("Oversized HTTP collection"));return;}chunks.push(chunk);});
   res.on("end",()=>resolve(Buffer.concat(chunks).toString("utf8")));res.on("error",reject);
  });req.on("timeout",()=>req.destroy(Error("Collection HTTP timeout")));req.on("error",reject);req.end();
 });
}
export function validatePrimaryObservation(value,ids) {
 assert.equal(value.branch,"main");assert.equal(value.trackedDirty,false);
 assert.equal(value.commit,ids.operator.commit);assert.equal(value.tree,ids.operator.tree);
 assert.equal(value.gitHubCommit,ids.operator.commit,"GitHub main must be the current operator");
 assert.deepEqual(value.preview,{format:"proof-of-work-ui-source-v1",...ids.artifact,trackedDirty:false},"Preview must remain the product artifact, not operator tooling");
 return value;
}
export function assembleCollectedEvidence(ids,rawRows,observedAt) {
 assert.deepEqual(Object.keys(rawRows).sort(),Object.keys(roleByName).sort(),"Incomplete collected roles");
 const evidence={};
 for(const [name,role] of Object.entries(roleByName)){
  const raw=rawRows[name];assert.equal(typeof raw,"string");assert(Buffer.byteLength(raw)<=16*1024**2);
  const when=observedAt[name];assert.equal(new Date(when).toISOString(),when);
  evidence[name]={subject:{role,...ids[role]},observedAt:when,raw,sha256:sha(raw)};
 }
 return {format:"proof-of-work-dual-evidence-v1",identities:ids,evidence};
}
const archivalBackend=Object.freeze({commit:"609d5a10a07a83bb5f1e858e7f6c1d706e741ee1",tree:"cae54e036af5254698c5cd45020b382cb0982052"});
const archivalArtifact=Object.freeze({commit:"064b6991ae2a48e2069baedc767cd918d28ba052",tree:"e6f76332d26f88c3f7df98dc689d013193729c83"});
const archivalDeltaSha="39e886ad82b297c53922f5619c2ae70f06e44ba4d451630d01ca98417a844507";
const archivalKeys=["format","originalRaw","originalSha256","subjectIdentity","executionTimeUnknown","executedAt","freshnessClaim","qualificationSha256","planSha256","applicableArtifact","backendArtifactDeltaSha256"];
export function validateArchivalObservation(name,value,identities) {
 assert(name==="nativeV2"||name==="browserV2","Unknown archival test");
 assert.deepEqual(identities.backend,archivalBackend);assert.deepEqual(identities.artifact,archivalArtifact);
 assert(value&&typeof value==="object"&&!Array.isArray(value));
 assert.deepEqual(Object.keys(value).sort(),[...archivalKeys].sort(),"Exact archival observation fields required");
 assert.equal(value.format,"proof-of-work-archival-test-observation-v1");
 assert.equal(typeof value.originalRaw,"string");assert(Buffer.byteLength(value.originalRaw)<=16*1024**2);
 assert.equal(value.originalSha256,anchors[name].sha256);assert.equal(sha(value.originalRaw),value.originalSha256,"Original archival bytes changed");
 assert.deepEqual(value.subjectIdentity,archivalBackend);assert.deepEqual(value.applicableArtifact,archivalArtifact);
 assert.equal(value.executionTimeUnknown,true);assert.equal(value.executedAt,null);assert.equal(value.freshnessClaim,false);
 assert.equal(value.qualificationSha256,anchors.qualification.sha256);assert.equal(value.planSha256,anchors.plan.sha256);
 assert.equal(value.backendArtifactDeltaSha256,archivalDeltaSha);
 parseCollectedJson(value.originalRaw);return value.originalRaw;
}
export function validateOriginalArchiveCustody(raw,ids) {
 assert.deepEqual(Object.keys(raw).sort(),["browserV2","nativeV2","plan","qualification"]);
 assert.deepEqual(ids.backend,archivalBackend);assert.deepEqual(ids.artifact,archivalArtifact);
 for(const name of Object.keys(raw))assert.equal(sha(raw[name]),anchors[name].sha256,"Pinned original "+name+" changed");
 const plan=parseCollectedJson(raw.plan),qualification=parseCollectedJson(raw.qualification);
 assert.equal(plan.sourceCommit,archivalBackend.commit);
 assert.equal(qualification.commit,archivalBackend.commit);assert.equal(qualification.tree,archivalBackend.tree);
 assert.equal(qualification.planSha256,anchors.plan.sha256);assert.equal(qualification.rootReconciled,true);assert.equal(qualification.activationAllowed,false);
 const result={};
 for(const [name,gate] of [["nativeV2","native-4mb"],["browserV2","browser-ui"]]) {
  const row=qualification.gates[gate];
  assert.equal(row.commit,archivalBackend.commit);assert.equal(row.path,anchors[name].path);
  assert.equal(row.sha256,anchors[name].sha256);assert.equal(row.passed,true);assert.equal(row.exitCode,0);
  const original=parseCollectedJson(raw[name]);
  if(name==="browserV2")assert.deepEqual(original.source,{...archivalBackend,trackedDirty:false},"Original browser execution source differs");
  const value={format:"proof-of-work-archival-test-observation-v1",originalRaw:raw[name],originalSha256:anchors[name].sha256,
   subjectIdentity:{...archivalBackend},executionTimeUnknown:true,executedAt:null,freshnessClaim:false,
   qualificationSha256:anchors.qualification.sha256,planSha256:anchors.plan.sha256,
   applicableArtifact:{...archivalArtifact},backendArtifactDeltaSha256:archivalDeltaSha};
  validateArchivalObservation(name,value,ids);result[name]=value;
 }
 return result;
}
const archiveProgram=String.raw`import hashlib,json,pathlib,stat,sys
r=json.load(sys.stdin);result={}
for name,row in r.items():
 p=pathlib.Path(row['path']);s=p.lstat()
 assert p.is_absolute() and str(p).startswith('/data/') and p.resolve(strict=True)==p
 assert stat.S_ISREG(s.st_mode) and s.st_nlink==1 and s.st_uid==row.get('owner',0) and not s.st_mode&0o022
 assert s.st_size<=32*1024**2
 raw=p.read_bytes();after=p.lstat()
 assert (s.st_dev,s.st_ino,s.st_size,s.st_mtime_ns,s.st_ctime_ns)==(after.st_dev,after.st_ino,after.st_size,after.st_mtime_ns,after.st_ctime_ns)
 assert hashlib.sha256(raw).hexdigest()==row['sha256']
 result[name]=raw.decode()
print(json.dumps(result))
`;
const uiProgram=String.raw`import hashlib,json,pathlib,sys
r=json.load(sys.stdin);scope={'__name__':'read_only_collection','__file__':'/reviewed-artifact/deploy/proofofwork-ui-verified-retention.py'}
assert hashlib.sha256(r['verifier'].encode()).hexdigest()==r['verifierSha256']
exec(compile(r['verifier'],'reviewed-retention-verifier','exec'),scope)
root=pathlib.Path('/var/www');p=root/'.proofofwork-ui-release';before=p.read_bytes()
fields=scope['verified_release'](root,pathlib.Path('/var/backups/proofofwork-ui/releases'))
assert p.read_bytes()==before
print(json.dumps({'manifestRaw':before.decode(),'inventories':{k.split('.')[1]:v for k,v in fields.items() if k.startswith('surface.') and k.endswith('.sha256')}}))
`;
export const nodeGitOwnerProgram=String.raw`import hashlib,os,pathlib,pwd,stat,subprocess
SEALED_CONFIG_SHA256='b31f2ae31192674e0b589c54299ce5137160a5a07581cfffad1f767e69e0a7a1'
SOURCE_GIT_ENV={'PATH':'/usr/bin:/bin','HOME':'/nonexistent','GIT_CONFIG_GLOBAL':'/dev/null','GIT_CONFIG_NOSYSTEM':'1','GIT_NO_REPLACE_OBJECTS':'1','GIT_OPTIONAL_LOCKS':'0','GIT_GRAFT_FILE':'/dev/null'}
SOURCE_GIT_READS={('rev-parse','HEAD'),('rev-parse','HEAD^{tree}'),('status','--porcelain','--untracked-files=all'),('ls-files','-v')}
def source_git_owner(uid,gid):
 name='root' if uid==0 else 'powadmin'
 account=pwd.getpwnam(name)
 assert (uid,gid)==(account.pw_uid,account.pw_gid),'Unexpected source owner'
 return name
def source_git_meta(info,owner,directory):
 assert (info.st_uid,info.st_gid)==owner,'Mixed source ownership'
 assert not info.st_mode&0o022,'Writable source metadata'
 assert (stat.S_ISDIR(info.st_mode) if directory else stat.S_ISREG(info.st_mode)),'Symlink or unexpected source type'
 if not directory:assert info.st_nlink==1,'Aliased Git metadata'
 return (info.st_dev,info.st_ino,info.st_uid,info.st_gid,info.st_mode)
def source_git_config(raw):
 assert hashlib.sha256(raw).hexdigest()==SEALED_CONFIG_SHA256,'Sealed Git config changed'
def source_git_stable(before,after):
 assert before==after,'Source changed during owner-aware Git read'
def source_git_fence(root):
 assert root.is_absolute() and root.resolve(strict=True)==root,'Noncanonical source path'
 info=root.lstat();owner=(info.st_uid,info.st_gid);name=source_git_owner(*owner)
 rows=[(str(root),source_git_meta(info,owner,True))]
 for parent in root.parents:
  assert parent.resolve(strict=True)==parent,'Symlink source ancestor'
  item=parent.lstat();expected=(0,0) if item.st_uid==0 else owner
  rows.append((str(parent),source_git_meta(item,expected,True)))
 gitdir=root/'.git';assert gitdir.resolve(strict=True)==gitdir,'Noncanonical Git directory'
 rows.append((str(gitdir),source_git_meta(gitdir.lstat(),owner,True)))
 for directory,dirs,files in os.walk(gitdir,followlinks=False):
  for leaf in sorted(dirs+files):
   path=pathlib.Path(directory)/leaf;item=path.lstat()
   assert path.resolve(strict=True)==path,'Symlink Git metadata'
   meta=source_git_meta(item,owner,leaf in dirs)
   rows.append((str(path),meta,item.st_size,item.st_mtime_ns,item.st_ctime_ns))
 source_git_config((gitdir/'config').read_bytes())
 for namepart in ('objects/info/alternates','info/grafts','info/attributes'):
  assert not (gitdir/namepart).exists(),'External Git metadata forbidden'
 for path in (root/'scripts',root/'scripts/check-current-growth-live.mjs'):
  assert path.resolve(strict=True)==path,'Symlink source checker'
  rows.append((str(path),source_git_meta(path.lstat(),owner,path.name=='scripts')))
 return (name,tuple(rows))
def source_git(root,*args):
 assert tuple(args) in SOURCE_GIT_READS,'Git operation outside read-only scope'
 before=source_git_fence(root)
 command=['/usr/sbin/runuser','-u',before[0],'--','/usr/bin/env','-i']
 command += [key+'='+value for key,value in SOURCE_GIT_ENV.items()]
 command += ['/usr/bin/git','--no-replace-objects','-c','core.fsmonitor=false','-c','core.untrackedCache=false','-c','advice.graftFileDeprecated=false','-C',str(root),*args]
 result=subprocess.check_output(command,text=True,timeout=30,env=SOURCE_GIT_ENV).strip()
 source_git_stable(before,source_git_fence(root))
 return result
`;
const nodeProgram=String.raw`${nodeGitOwnerProgram}
import hashlib,json,pathlib,stat,subprocess,sys
r=json.load(sys.stdin);root=pathlib.Path(r['source']);receipt=root.parent/'build-receipt.json'
def digest(p):
 assert p.resolve(strict=True)==p and stat.S_ISREG(p.lstat().st_mode)
 with p.open('rb') as f:return hashlib.file_digest(f,'sha256').hexdigest()
def git(*a):return source_git(root,*a)
owner_before=source_git_fence(root)
before=receipt.read_bytes();value=json.loads(before)
assert git('rev-parse','HEAD')==r['artifact']['commit'] and git('rev-parse','HEAD^{tree}')==r['artifact']['tree']
assert not git('status','--porcelain','--untracked-files=all')
assert digest(root/'scripts/check-current-growth-live.mjs')==r['growthSha256']
assert not any(row and (row[0].islower() or row[0]=='S') for row in git('ls-files','-v').splitlines())
sourceArchive=pathlib.Path(str(root)+'.tgz')
surfaces=root.parent/'proofofwork-ui-surfaces-064b6991ae2a-20261114T020148Z.tgz'
runtime={p:digest(pathlib.Path('/opt/proofofwork-api')/p) for p in r['runtimeAfter']}
assert runtime==r['runtimeAfter']
archive=pathlib.Path(r['archive']['path'])
assert archive.stat().st_size==r['archive']['bytes']
archiveSha=digest(archive);assert archiveSha==r['archive']['sha256']
assert receipt.read_bytes()==before
source_git_stable(owner_before,source_git_fence(root))
print(json.dumps({'build':{'receipt':value,'sourceArchiveSha256':digest(sourceArchive),'surfacesArchiveSha256':digest(surfaces),'sourceCommit':git('rev-parse','HEAD'),'sourceTree':git('rev-parse','HEAD^{tree}'),'sourceClean':True},'runtime':{'sourceCommit':r['backend']['commit'],'runtimeAfter':runtime,'archiveSha256':archiveSha,'archiveBaseSourceCommit':'92eb5fbdaacf','acceptedOverlaySourceCommit':r['backend']['commit']}}))
`;
function idsOf(proof){return Object.fromEntries(["artifact","baselineOperator","backend","operator"].map(k=>[k,{...proof[k]}]));}
function assertProofSame(before,after){
 for(const key of ["artifact","baselineOperator","backend","operator","digests"])assert.deepEqual(after[key],before[key],"Proof changed during collection");
}
export async function collectDualReleaseEvidence({proof,archivalEvidence}={}) {
 const p=requireIdentityProof(proof),initial=createIdentityProof({repository:p.repository});
 assertProofSame(p,initial);
 assert(archivalEvidence===undefined || Object.keys(archivalEvidence).length===1&&archivalEvidence.planSha256===anchors.plan.sha256,
  "Caller evidence cannot replace reviewed archival anchors");
 const ids=idsOf(p),started=Date.now(),raw={},observedAt={};
 const put=(name,value)=>{raw[name]=typeof value==="string"?value:JSON.stringify(value);observedAt[name]=new Date().toISOString();};
 // Validate the protected original archive first. Unknown original execution
 // time remains explicit; this new observation makes no test freshness claim.
 const archived=parseCollectedJson(ssh("node",archiveProgram,Object.fromEntries(Object.entries(anchors).filter(([name])=>name!=="archive"))));
 const original=Object.fromEntries(Object.entries(archived).map(([name,value])=>[name,parseCollectedJson(value)]));
 assert.equal(original.plan.sourceCommit,ids.backend.commit);
 assert.equal(p.digests.backendArtifactDeltaSha256,archivalDeltaSha,"Reviewed product equivalence differs");
 const archival=validateOriginalArchiveCustody(archived,ids);
 put("nativeV2",archival.nativeV2);put("browserV2",archival.browserV2);
 const primaryRead=async()=>{
  assert.equal(git(primary,"remote","get-url","origin"),github,"Primary origin differs");
  const remote=exec("/usr/bin/git",["--no-replace-objects","-c","core.fsmonitor=false","-c","advice.graftFileDeprecated=false","ls-remote",github,"refs/heads/main"],{cwd:"/"}).trim().split(/\s+/u);
  assert.equal(remote.length,2);assert.equal(remote[1],"refs/heads/main");
  return {branch:git(primary,"branch","--show-current"),commit:git(primary,"rev-parse","HEAD"),tree:git(primary,"rev-parse","HEAD^{tree}"),
   trackedDirty:git(primary,"status","--porcelain","--untracked-files=no")!=="",gitHubCommit:remote[0],preview:parseCollectedJson(await httpRead("http://127.0.0.1:4175/source-provenance.json"))};
 };
 const primaryBefore=validatePrimaryObservation(await primaryRead(),ids);put("primary",primaryBefore);
 const verifier=exec("/usr/bin/git",["--no-replace-objects","-c","core.fsmonitor=false","-c","advice.graftFileDeprecated=false","-C",p.repository,"show",p.artifact.commit+":deploy/proofofwork-ui-verified-retention.py"]);
 const uiBefore=parseCollectedJson(ssh("ui",uiProgram,{verifier,verifierSha256:sha(verifier)},480000));put("uiManifest",uiBefore.manifestRaw);
 const provenance={};
 for(const [surface,host] of Object.entries(hosts))provenance[surface]={provenance:parseCollectedJson(await httpRead("https://"+host+".proofofwork.me/source-provenance.json")),inventorySha256:uiBefore.inventories[surface]};
 put("sourceProvenance",provenance);
 put("renderer",await httpRead("https://publish.proofofwork.me/publish-render-provenance.json"));
 const growthSha256=sha(exec("/usr/bin/git",["--no-replace-objects","-c","core.fsmonitor=false","-c","advice.graftFileDeprecated=false","-C",p.repository,"show",p.artifact.commit+":scripts/check-current-growth-live.mjs"]));
 const runtimeAfter=Object.fromEntries(original.plan.runtimeManifestTemplate.sources.map(row=>[row.path,row.after]));
 const nodeBefore=parseCollectedJson(ssh("node",nodeProgram,{source,artifact:ids.artifact,backend:ids.backend,runtimeAfter,archive:anchors.archive,growthSha256},240000));put("build",nodeBefore.build);
 const lifecycle=()=>parseCollectedJson(exec("python3",["-I","-B","deploy/ui-retention/lifecycle.py","status","--require-complete"],{cwd:p.repository,timeout:480000}));
 const lifecycleBefore=lifecycle();put("lifecycle",lifecycleBefore);
 const probe=runRemotePublishPreactivation({root:p.repository,identityProof:proof,env:{...transportEnv,POW_PUBLISH_CHECK_MODE:"preactivation",POW_PUBLISH_CHECK_NODE_SOURCE:source}});
 put("preactivation",probe);
 put("runtime",{...nodeBefore.runtime,writerEnabled:false}); // Actual typed probe above proved disabled.
 assert.equal(process.cwd(),p.repository,"Typed activity probe requires exact repository cwd");
 put("activity",await runActivityFeeFactorLive({identityProof:proof}));
 const growthCommand="cd "+quote(source)+" && env -u NODE_OPTIONS -u NODE_PATH /opt/node-v24.18.0-linux-x64/bin/node scripts/check-current-growth-live.mjs";
 put("growth",exec("ssh",["-i","/home/sixer/.ssh/proofofwork_node_ed25519","-o","BatchMode=yes","-o","IdentitiesOnly=yes","-o","StrictHostKeyChecking=yes","-o","ConnectTimeout=15","powadmin@65.108.122.87",growthCommand],{timeout:180000}));
 assert.deepEqual(await primaryRead(),primaryBefore,"Primary changed during collection");
 assert.deepEqual(parseCollectedJson(ssh("ui",uiProgram,{verifier,verifierSha256:sha(verifier)},480000)),uiBefore,"UI changed during collection");
 assert.deepEqual(parseCollectedJson(ssh("node",nodeProgram,{source,artifact:ids.artifact,backend:ids.backend,runtimeAfter,archive:anchors.archive,growthSha256},240000)),nodeBefore,"Node changed during collection");
 const lifecycleAfter=lifecycle();assert.equal(lifecycleAfter.retentionComplete,true);assert.deepEqual(lifecycleAfter.pair,lifecycleBefore.pair);
 assert.deepEqual(parseCollectedJson(ssh("node",archiveProgram,Object.fromEntries(Object.entries(anchors).filter(([name])=>name!=="archive")))),archived,"Archival receipts changed during collection");
 assertProofSame(initial,createIdentityProof({repository:p.repository}));
 assert(Date.now()-started<=900000,"Collection exceeded freshness budget");
 const bundle=assembleCollectedEvidence(ids,raw,observedAt),rawBundle=JSON.stringify(bundle);
 const result=freeze({rawBundle,sha256:sha(rawBundle),identities:ids,collectedAt:new Date().toISOString()});
 collections.add(result);return result;
}
export function requireLiveCollection(value) {
 assert(value&&collections.has(value),"Authentic hardwired live collection required");return value;
}
