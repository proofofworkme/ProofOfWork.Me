import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {execFileSync} from "node:child_process";
import {collectDualReleaseEvidence,requireLiveCollection,parseCollectedJson,assembleCollectedEvidence,validateArchivalObservation,validatePrimaryObservation,nodeGitOwnerProgram} from "./collect-dual-release-evidence.mjs";
const ids=Object.fromEntries(["artifact","baselineOperator","backend","operator"].map((k,i)=>[k,{commit:String(i).repeat(40),tree:String(i).repeat(40)}]));
const names=["primary","build","uiManifest","sourceProvenance","renderer","runtime","lifecycle","preactivation","activity","growth","nativeV2","browserV2"];
const raw=Object.fromEntries(names.map(n=>[n,"{}"])),times=Object.fromEntries(names.map(n=>[n,"2026-01-01T00:00:00.000Z"]));
test("JSON fake and copied collection never gain live authority",()=>{
 for(const value of [null,{},Object.freeze({rawBundle:"{}",sha256:"0".repeat(64),identities:ids}),JSON.parse('{"rawBundle":"{}"}')])
  assert.throws(()=>requireLiveCollection(value),/Authentic hardwired/);
});
test("unbranded proof refuses before any transport",async()=>{
 await assert.rejects(collectDualReleaseEvidence({proof:{},archivalEvidence:{planSha256:"0".repeat(64)}}),/Authentic in-process/);
});
test("parsers reject malformed, nonobject and oversized responses",()=>{
 for(const value of ["null","[]","false","{",3])assert.throws(()=>parseCollectedJson(value));
 assert.throws(()=>parseCollectedJson('{"a":1}',3),/Oversized/);
 assert.deepEqual(parseCollectedJson('{"a":1}'),{a:1});
});
test("pure assembly is bounded, hashes exact raw bytes and cannot mint brand",()=>{
 const bundle=assembleCollectedEvidence(ids,raw,times);
 assert.equal(bundle.evidence.browserV2.subject.role,"backend");
 assert.equal(bundle.evidence.nativeV2.sha256,createHash("sha256").update("{}").digest("hex"));
 assert.throws(()=>requireLiveCollection(bundle),/Authentic hardwired/);
 for(const bad of [{...raw,extra:"{}"},{...raw,primary:undefined},{...raw,primary:"x".repeat(16*1024**2+1)}])
  assert.throws(()=>assembleCollectedEvidence(ids,bad,times));
 assert.throws(()=>assembleCollectedEvidence(ids,raw,{...times,primary:"bad"}));
});
const actualIds={
 backend:{commit:"609d5a10a07a83bb5f1e858e7f6c1d706e741ee1",tree:"cae54e036af5254698c5cd45020b382cb0982052"},
 artifact:{commit:"064b6991ae2a48e2069baedc767cd918d28ba052",tree:"e6f76332d26f88c3f7df98dc689d013193729c83"},
};
function archivalFixture(name){
 const originalRaw=readFileSync(new URL("./fixtures/dual-release/"+(name==="nativeV2"?"native609.json":"browser609.json"),import.meta.url),"utf8");
 return {format:"proof-of-work-archival-test-observation-v1",originalRaw,
 originalSha256:name==="nativeV2"?"516b7712365a221bf64a6bb389db56f0b1d97fdf9bffccadabd0406df054bc68":"b344fbb4f069c8b92daaf314f7e68fdc0c68e93e0a3e3336ff42668f7b9c33c7",
 subjectIdentity:actualIds.backend,executionTimeUnknown:true,executedAt:null,freshnessClaim:false,
 qualificationSha256:"342ea3e50e956edcaf5f57434cd6e51fec64d251def3832c9e43a9934f8e4bf1",
 planSha256:"6ca83113503039e2ef7a03f232cb1b59b80804da8cc7f068c6e4c83fe91a5483",
 applicableArtifact:actualIds.artifact,backendArtifactDeltaSha256:"39e886ad82b297c53922f5619c2ae70f06e44ba4d451630d01ca98417a844507"};
}
test("original exact receipts remain unchanged with explicit unknown execution time",()=>{
 for(const name of ["nativeV2","browserV2"]){
  const value=archivalFixture(name),original=value.originalRaw;
  assert.equal(validateArchivalObservation(name,value,actualIds),original);
  assert.equal(value.originalRaw,original);assert.throws(()=>requireLiveCollection(value),/Authentic hardwired/);
  assert(!Object.hasOwn(JSON.parse(original),"executedAt"));
  for(const change of [
   {originalRaw:original+" "},{originalSha256:"0".repeat(64)},{freshnessClaim:true},
   {executionTimeUnknown:false},{executedAt:"2026-01-01T00:00:00.000Z"},
   {subjectIdentity:actualIds.artifact},{applicableArtifact:actualIds.backend},
   {backendArtifactDeltaSha256:"0".repeat(64)},{qualificationSha256:"0".repeat(64)},{planSha256:"0".repeat(64)},
   {extra:true},
  ])assert.throws(()=>validateArchivalObservation(name,{...value,...change},actualIds));
  assert.throws(()=>validateArchivalObservation("wrong",value,actualIds));
 }
});
test("transport contract has fixed origins, host keys, bounded calls and no injected runner",()=>{
 const code=readFileSync(new URL("./collect-dual-release-evidence.mjs",import.meta.url),"utf8");
 for(const text of ['StrictHostKeyChecking=yes','BatchMode=yes','IdentitiesOnly=yes','timeout:30000','maxBuffer:32*1024**2','Collection exceeded freshness budget','publish-render-provenance.json','scope[\'verified_release\']','scripts/check-current-growth-live.mjs','growthSha256','Archival receipts changed during collection'])
  assert(code.includes(text),text);
 assert(!/collectDualReleaseEvidence\(\{[^}]*\b(?:run|fetch|transport)\s*[,=]/u.test(code));
 assert(code.indexOf("validateOriginalArchiveCustody(archived")<code.indexOf("const primaryBefore="));
});

test("duplicate and deeply nested JSON cannot become ambiguous evidence",()=>{
 for(const value of ['{"ok":false,"ok":true}','{"a":{"x":1,"x":2}}','{"a":[{"x":1,"x":2}]}'])
  assert.throws(()=>parseCollectedJson(value),/Duplicate/);
 assert.throws(()=>parseCollectedJson('{"a":'+ '['.repeat(129)+'0'+']'.repeat(129)+'}'),/nesting/);
 const special={a:[{},[],{b:"brace } and quote "+String.fromCharCode(34)}]}; assert.deepEqual(parseCollectedJson(JSON.stringify(special)),special);
});

test("current operator main and product-artifact preview remain distinct",()=>{
 const value={branch:"main",trackedDirty:false,commit:ids.operator.commit,tree:ids.operator.tree,gitHubCommit:ids.operator.commit,
  preview:{format:"proof-of-work-ui-source-v1",...ids.artifact,trackedDirty:false}};
 assert.equal(validatePrimaryObservation(value,ids),value);
 for(const mutation of [{commit:ids.baselineOperator.commit},{gitHubCommit:ids.baselineOperator.commit},{tree:ids.artifact.tree},{branch:"candidate"},{trackedDirty:true},
  {preview:{format:"proof-of-work-ui-source-v1",...ids.operator,trackedDirty:false}}])
  assert.throws(()=>validatePrimaryObservation({...value,...mutation},ids));
});

test("owner-aware sealed Git rejects ownership, symlink, config, operation and concurrent substitutions",()=>{
 const suite=String.raw`
import base64,tempfile,types,unittest
from unittest.mock import patch
CONFIG=base64.b64decode("W2NvcmVdCglyZXBvc2l0b3J5Zm9ybWF0dmVyc2lvbiA9IDAKCWZpbGVtb2RlID0gdHJ1ZQoJYmFyZSA9IGZhbHNlCglsb2dhbGxyZWZ1cGRhdGVzID0gdHJ1ZQpbcmVtb3RlICJvcmlnaW4iXQoJdXJsID0gL2RhdGEvcHJvb2ZvZndvcmstaGVhbHRoLWZpeGVzLTIwMjYxMTExL3NvdXJjZS13b3JrL2xpbmtlZC1zdG9jay1pbnZlbnRvcnktcmV1c2UtMjAyNjExMTMKCWZldGNoID0gK3JlZnMvaGVhZHMvKjpyZWZzL3JlbW90ZXMvb3JpZ2luLyoKW2JyYW5jaCAicmVsZWFzZS9zdG9jay1pbnZlbnRvcnktcmV1c2UtMjAyNjExMTMiXQoJcmVtb3RlID0gb3JpZ2luCgltZXJnZSA9IHJlZnMvaGVhZHMvcmVsZWFzZS9zdG9jay1pbnZlbnRvcnktcmV1c2UtMjAyNjExMTMK")
class OwnerGit(unittest.TestCase):
 def test_owner_selection(self):
  with patch.object(pwd,'getpwnam',side_effect=lambda name:types.SimpleNamespace(pw_uid=0 if name=='root' else 1000,pw_gid=0 if name=='root' else 1000)):
   self.assertEqual(source_git_owner(0,0),'root');self.assertEqual(source_git_owner(1000,1000),'powadmin')
   for uid,gid in ((1001,1001),(1000,0),(0,1000)):
    with self.assertRaises(AssertionError):source_git_owner(uid,gid)
 def test_meta_fail_closed(self):
  good=dict(st_dev=1,st_ino=2,st_uid=1000,st_gid=1000,st_mode=stat.S_IFREG|0o600,st_nlink=1)
  source_git_meta(types.SimpleNamespace(**good),(1000,1000),False)
  for change in ({'st_uid':0},{'st_gid':0},{'st_mode':stat.S_IFREG|0o622},{'st_mode':stat.S_IFLNK|0o777},{'st_nlink':2}):
   with self.assertRaises(AssertionError):source_git_meta(types.SimpleNamespace(**{**good,**change}),(1000,1000),False)
 def test_config_pin(self):
  source_git_config(CONFIG)
  for changed in (CONFIG+b'\n[include]\npath=/tmp/evil\n',CONFIG.replace(b'filemode = true',b'filemode = false')):
   with self.assertRaises(AssertionError):source_git_config(changed)
 def test_read_only_owner_argv_and_environment(self):
  root=pathlib.Path('/data/fixture')
  for name in ('root','powadmin'):
   with patch.dict(os.environ,{'LD_PRELOAD':'evil','GIT_CONFIG_COUNT':'5','PATH':'/evil'},clear=False):
    with patch('__main__.source_git_fence',return_value=(name,('fixed',))),patch.object(subprocess,'check_output',return_value='064\n') as run:
     self.assertEqual(source_git(root,'rev-parse','HEAD'),'064')
     command=run.call_args.args[0];self.assertEqual(command[:6],['/usr/sbin/runuser','-u',name,'--','/usr/bin/env','-i'])
     self.assertIn('/usr/bin/git',command);self.assertNotIn('safe.directory',str(command))
     self.assertEqual(run.call_args.kwargs['env'],SOURCE_GIT_ENV);self.assertNotIn('LD_PRELOAD',run.call_args.kwargs['env'])
  with patch.object(subprocess,'check_output') as run:
   with self.assertRaises(AssertionError):source_git(root,'reset','--hard')
   run.assert_not_called()
 def test_concurrent_fence(self):
  with patch('__main__.source_git_fence',side_effect=[('powadmin',('before',)),('powadmin',('after',))]),patch.object(subprocess,'check_output',return_value='064'):
   with self.assertRaises(AssertionError):source_git(pathlib.Path('/data/fixture'),'rev-parse','HEAD')
 def test_filesystem_fences(self):
  with tempfile.TemporaryDirectory() as temporary:
   root=pathlib.Path(temporary)/'source';root.mkdir();(root/'.git').mkdir();(root/'.git/config').write_bytes(CONFIG)
   (root/'scripts').mkdir();(root/'scripts/check-current-growth-live.mjs').write_text('// test')
   actual=pathlib.Path.lstat
   def protected(path):
    result=actual(path)
    if path in root.parents:
     fields={key:getattr(result,key) for key in ('st_dev','st_ino','st_size','st_mtime_ns','st_ctime_ns','st_nlink')}
     return types.SimpleNamespace(**fields,st_uid=0,st_gid=0,st_mode=stat.S_IFDIR|0o755)
    return result
   with patch.object(pwd,'getpwnam',return_value=types.SimpleNamespace(pw_uid=os.getuid(),pw_gid=os.getgid())),patch.object(pathlib.Path,'lstat',protected):
    source_git_fence(root)
    (root/'.git/config').write_bytes(CONFIG+b'# changed')
    with self.assertRaises(AssertionError):source_git_fence(root)
    (root/'.git/config').write_bytes(CONFIG)
    (root/'.git/info').mkdir();(root/'.git/info/attributes').write_text('*.mjs filter=evil')
    with self.assertRaises(AssertionError):source_git_fence(root)
    (root/'.git/info/attributes').unlink()
    (root/'.git').rename(root/'real-git');(root/'.git').symlink_to(root/'real-git',target_is_directory=True)
    with self.assertRaises(AssertionError):source_git_fence(root)
unittest.main()
`;
 const output=execFileSync("/usr/bin/python3",["-I","-B","-c",nodeGitOwnerProgram+"\n"+suite],{encoding:"utf8",timeout:30000});
 assert.equal(typeof output,"string");
});
