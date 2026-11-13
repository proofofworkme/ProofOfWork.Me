"""Creation-mode regression; native mode creates only synthetic source evidence."""
import hashlib,json,os,runpy,stat,subprocess,sys,tempfile,unittest,uuid
from pathlib import Path
S=runpy.run_path(str(Path(__file__).with_name('stage.py')))
class Modes(unittest.TestCase):
 def test_private_umask_restored_on_success_and_failure(self):
  old=os.umask(0o077)
  try:
   with tempfile.TemporaryDirectory() as tmp:
    p=Path(tmp)/'new'
    with S['source_creation_modes']():p.mkdir(mode=0o755)
    self.assertEqual(stat.S_IMODE(p.stat().st_mode),0o755)
    self.assertEqual(os.umask(0o077),0o077)
    with self.assertRaises(FileExistsError):
     with S['source_creation_modes']():p.mkdir(mode=0o755)
    self.assertEqual(os.umask(0o077),0o077)
  finally:os.umask(old)
 def test_new_stage_namespace(self):
  self.assertEqual(str(S['STAGES']),'/data/proofofwork-linked-publish-stage-v2')
def native():
 assert os.geteuid()==0 and sys.flags.isolated
 old=os.umask(0o077)
 root=Path('/data')/('proofofwork-stage-modes-fixture-'+uuid.uuid4().hex)
 raw=b'export const marker="public-source-only";\n'
 try:
  for p in (root,root/'nested',root/'nested'/'source'):S['create_stage_directory'](p)
  target=root/'nested'/'source'/'fixture.mjs';S['write'](target,raw)
  # Exercise the complete production stage_sources wiring with synthetic source
  # only. Never point this fixture at the live stage root or production runtime.
  fake=root/'synthetic-runtime';S['create_stage_directory'](fake)
  S['create_stage_directory'](fake/'node_modules')
  node=root/'synthetic-node';S['write'](node,b'node-digest-fixture')
  public={'nested/deep/fixture.mjs':raw,'package.json':b'{"type":"module"}\n'}
  extra={name:('public extra '+name+'\n').encode() for name in S['EXTRA']}
  digest=lambda value:hashlib.sha256(value).hexdigest()
  safe=lambda path:public[str(path.relative_to(fake))] if path.is_relative_to(fake) else path.read_bytes()
  namespace={'ROOT':fake,'ROOT_JSON':{'package.json'},
   'validate_manifest':lambda manifest:{'nested/deep/fixture.mjs':raw},
   'fence':lambda *args:None,'metadata_fence':lambda *args:None,
   'dependency_closure':lambda *args:set(public),'safe_read':lambda path,*args:safe(path),'sha':digest}
  release={'controller':lambda:b'synthetic-controller','source_fence':lambda commit:None,
   'engine':{'namespace':lambda code:namespace,'git':lambda action,ref:extra[ref.split(':',1)[1]]}}
  manifest={'sourceMetadata':{},'nodeSha256':digest(node.read_bytes()),'dependencies':{'package.json':digest(public['package.json'])}}
  plan={'runtimeManifestTemplate':manifest,'sourceCommit':'a'*40}
  g=S['stage_sources'].__globals__;saved=(g['STAGES'],g['NODE'])
  g['STAGES']=root/'synthetic-stages';g['NODE']=node
  try:
   stage=S['stage_sources'](release,plan,'b'*64)
   assert S['stage_sources'](release,plan,'b'*64)==stage
   proof=json.loads((stage/'stage.json').read_bytes())
   assert proof['sourceHashes']=={name:digest(value) for name,value in {**public,**extra}.items()}
   assert (stage/'node_modules').is_symlink() and os.readlink(stage/'node_modules')==str(fake/'node_modules')
   for name,value in {**public,**extra}.items():assert (stage/name).read_bytes()==value
   # A restrictive preexisting stage is rejected without mode repair.
   bad=g['STAGES']/('c'*64);bad.mkdir(mode=0o755)
   try:S['stage_sources'](release,plan,'c'*64)
   except (ValueError,FileNotFoundError):pass
   else:raise AssertionError('Private existing stage accepted')
   assert stat.S_IMODE(bad.stat().st_mode)==0o700
   restrictive=root/'private-stage-root';restrictive.mkdir(mode=0o755);g['STAGES']=restrictive
   try:S['stage_sources'](release,plan,'d'*64)
   except ValueError:pass
   else:raise AssertionError('Private stage root accepted')
   assert stat.S_IMODE(restrictive.stat().st_mode)==0o700
   target=stage/'nested/deep/fixture.mjs'
  finally:g['STAGES'],g['NODE']=saved

  private=root/'private-sentinel';private.write_bytes(b'synthetic-private-not-a-secret')
  private_dir=root/'private-dir';private_dir.mkdir(mode=0o755)
  link=root/'source-link';link.symlink_to(target)
  assert stat.S_IMODE(private.stat().st_mode)==0o600
  for p in (root,root/'nested',root/'nested'/'source'):S['stage_directory'](p)
  S['source_file'](target)
  for operation in (lambda:S['write'](target,b'wrong'),lambda:S['create_stage_directory'](private),
   lambda:S['create_stage_directory'](private_dir),lambda:S['source_file'](private),lambda:S['source_file'](link)):
   try:operation()
   except (ValueError,FileExistsError):pass
   else:raise AssertionError('Existing artifact accepted')
  assert target.read_bytes()==raw and stat.S_IMODE(private.stat().st_mode)==0o600
  assert stat.S_IMODE(private_dir.stat().st_mode)==0o700 and link.is_symlink()
  assert os.umask(0o077)==0o077
  js="""const fs=require('node:fs'),crypto=require('node:crypto');
const [file,priv,stage]=process.argv.slice(1);const bytes=fs.readFileSync(file);
const proof=JSON.parse(fs.readFileSync(stage+'/stage.json'));
for(const [name,sha] of Object.entries(proof.sourceHashes)){const p=stage+'/'+name;
if(crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')!==sha)throw Error('Source bytes differ');
for(let item=p;item.length>=stage.length;item=require('node:path').dirname(item)){
const meta=fs.statSync(item);if(meta.uid!==0||meta.gid!==0||(meta.mode&0o022))throw Error('Unsafe owner/mode');
try{fs.accessSync(item,fs.constants.W_OK);throw Error('Writable closure');}catch(e){if(e.code!=='EACCES')throw e;}}}
if(process.getuid()===0)throw Error('Root child');
for(const path of [file,require('node:path').dirname(file)]){try{fs.accessSync(path,fs.constants.W_OK);throw Error('Writable');}catch(e){if(e.code!=='EACCES')throw e;}}
try{fs.readFileSync(priv);throw Error('Private readable');}catch(e){if(e.code!=='EACCES')throw e;}
console.log(JSON.stringify({ok:true,uid:process.getuid(),sha256:crypto.createHash('sha256').update(bytes).digest('hex')}));"""
  cmd=['systemd-run','--quiet','--pipe','--wait','--collect','--service-type=exec','--unit=pow-stage-modes-'+root.name[-12:],
   '--property=User=powadmin','--property=Group=powadmin','--property=NoNewPrivileges=true','--property=ProtectSystem=strict',
   '--property=ProtectHome=true','--property=PrivateTmp=true','--property=PrivateDevices=true','--property=CapabilityBoundingSet=',
   '--property=RuntimeMaxSec=30','--property=MemoryMax=128M','--property=MemorySwapMax=0','--property=CPUQuota=100%',
   '--property=WorkingDirectory='+str(target.parent),str(S['NODE']),'-e',js,str(target),str(private),str(stage)]
  result=subprocess.run(cmd,check=True,capture_output=True,text=True,timeout=45)
  proof=json.loads(result.stdout);assert proof['ok'] and proof['sha256']==hashlib.sha256(raw).hexdigest()
  print(json.dumps({'ok':True,'fixture':str(root),'child':proof,'callerUmask':'077','syntheticOnly':True,'fullStageSourcesVerified':True,'exactReuseVerified':True,'restrictiveExistingRejected':True}))
 finally:os.umask(old)
if __name__=='__main__':
 if sys.argv[1:]==['--native-root']:native()
 else:unittest.main()
