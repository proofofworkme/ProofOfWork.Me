#!/usr/bin/python3 -I
"""Isolated acceptance fixtures; never invokes the archive engine or live services."""
import argparse,base64,copy,hashlib,importlib.util,json,os,stat,tempfile,unittest,types
from unittest.mock import patch
from pathlib import Path
ROOT=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('adapter',ROOT/'runtime-archive.py')
mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
fixture_spec=importlib.util.spec_from_file_location('replay_fixtures',ROOT/'controller.test.py')
fixtures=importlib.util.module_from_spec(fixture_spec);fixture_spec.loader.exec_module(fixtures)
SOURCE='1'*40;TREE='2'*40;RID=SOURCE[:12]+'-20261025T190000Z'
def encode(v):return (json.dumps(v,sort_keys=True,indent=2)+'\n').encode()
def creation(s):return [s.st_dev,s.st_ino,s.st_uid,s.st_gid,stat.S_IMODE(s.st_mode),s.st_size,s.st_mtime_ns]
class AdapterTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory(prefix='pow-replay-archive-fixture-')
  self.root=Path(self.tmp.name);self.runtime=self.root/'runtime';self.runtime.mkdir()
  self.base=self.root/'backups';self.base.mkdir();self.inner=self.base/('work-batch-replay-'+RID+'-20261025T190001Z');self.inner.mkdir(mode=0o700)
  self.custody=self.base/'new';self.custody.mkdir();self.accepted=self.root/'accepted.json'
  self.prefix={'from':973104,'through':973104,'hash':'3'*64};self.calls=[]
  rows=[];metadata={};journal={}
  for index,name in enumerate(sorted(mod.TARGETS)):
   raw=('candidate '+name).encode();p=self.runtime/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(raw);p.chmod(0o600);s=p.stat()
   rows.append({'path':name,'before':hashlib.sha256(('before '+name).encode()).hexdigest(),'after':mod.sha(raw),'base64':base64.b64encode(raw).decode()})
   metadata[name]={'uid':s.st_uid,'gid':s.st_gid,'mode':0o600}
   journal[name]={'published':True,'candidateSha256':mod.sha(raw),'candidateIdentity':creation(s)}
  self.m={'format':mod.FAMILY,'sourceCommit':SOURCE,'sourceTree':TREE,'releaseId':RID,'baselineHead':'4'*40,'baseSourceCommit':'5'*40,
   'sourceMetadata':metadata,'dependencyMetadata':{},'nodeSha256':'a'*64,'restartConfigurationSha256':'6'*64,'gateway':{},'protectedServices':{},
   'services':['api','worker'],'dependencies':{},'searchHold':{'markerSha256':'0'*64},'sources':rows,
   'replaySourceManifest':{'path':'/tmp/source.json','sha256':'7'*64}}
  self.plan={'format':'proof-of-work-work-batch-replay-rollout-plan-v1','sourceCommit':SOURCE,'releaseId':RID,
   'controllerSha256':mod.sha(b'controller'),'controllerBase64':base64.b64encode(b'controller').decode(),'runtimeManifestTemplate':copy.deepcopy(self.m)}
  self.m['searchHold']['markerSha256']='8'*64
  self.q=fixtures.qualification_fixture(self.m,'after-drain')
  self.prefix=self.q['fixedPrefix']
  qb=copy.deepcopy(self.q);qb['mode']='before-drain'
  self.before=self.ref('qualification-before.json',qb)
  fixtures.cached_extension(qb,self.q,self.before['sha256'])
  self.after=self.ref('qualification-after.json',self.q)
  self.before.update(qualified=True,mode='before-drain',fixedPrefix=self.prefix)
  self.after.update(qualified=True,mode='after-drain',fixedPrefix=self.prefix)
  publication={'fixture':True};praw=encode(publication);(self.inner/'publication-manifest.json').write_bytes(praw)
  sql=b'fixture sql';(self.inner/'publication.sql').write_bytes(sql);(self.inner/'publication.sql').chmod(0o600)
  self.prepared={'manifestPath':str(self.inner/'publication-manifest.json'),'sqlPath':str(self.inner/'publication.sql'),'manifestSha256':mod.sha(praw),'sqlSha256':mod.sha(sql)}
  self.prepared_ref=self.ref('publication-prepared.json',self.prepared);self.prepared_ref.update(manifestSha256=self.prepared['manifestSha256'],sqlSha256=self.prepared['sqlSha256'])
  self.final={'committed':True,'postconditionsVerified':True,'qualificationSha256':self.after['sha256']}
  self.published=self.ref('publication-dispatch.json.result.json',self.final);self.published.update(committed=True,postconditionsVerified=True,manifestSha256=self.prepared['manifestSha256'],qualificationSha256=self.after['sha256'],through=973104,blocks=1)
  self.r={key:copy.deepcopy(self.m[key])for key in ('format','sourceCommit','sourceTree','releaseId','baselineHead','baseSourceCommit','sourceMetadata','dependencyMetadata','restartConfigurationSha256','gateway','protectedServices')}
  self.r.update(manifestSha256=mod.sha(encode(self.m)),rollbackRoot=str(self.inner),installed=True,rolledBack=False,sourceWritesStarted=True,stopRequested=True,completedAt='2026-10-25T19:00:02+00:00',dependencyCount=0,
   servicesAfter={n:{'ActiveState':'active','WorkingDirectory':'/opt/proofofwork-api','MainPID':'123'}for n in self.m['services']},
   sources=[{k:v for k,v in r.items()if k!='base64'}for r in rows],createdHelpers=journal,boundaryBefore=self.before,boundaryAfterDrain=self.after,publicationPrepared=self.prepared_ref,replayPublication=self.published,writesDisabledStatus={'fixtureActiveWritesOff':True})
  self.a={'format':'work-batch-replay-runtime-archive-approval-v1','sourceCommit':SOURCE,'sourceTree':TREE,'releaseId':RID,
   'plan':{'path':str(self.root/'plan.json'),'sha256':mod.sha(encode(self.plan))},
   'inner':{'path':str(self.inner),'manifestSha256':self.r['manifestSha256'],'receiptSha256':mod.sha(encode(self.r))},
   'acceptedSha256':'','previousCompletion':{'path':str(self.base/'previous/completion.json'),'sha256':'c'*64,'archiveSha256':'d'*64},'heldSha256':mod.HELD_SHA}
  self.accepted_value={'format':'pow-accepted-node-source-overlays-v1','baselineHead':self.m['baselineHead'],'baselineTree':'9'*40,
   'overlays':[{'path':r['path'],'sha256':r['before'],'gitMode':'100644','evidence':[{'path':'retained-original','sha256':'e'*64}]}for r in rows]+[{'path':'unrelated','sha256':'f'*64,'gitMode':'100644','evidence':[]}]}
  self.accepted.write_bytes(encode(self.accepted_value));self.a['acceptedSha256']=mod.sha(self.accepted.read_bytes())
  self.controller={'raw':b'controller','validate_manifest':lambda m:None,'repaired_status':lambda status,prefix:status=={'fixtureActiveWritesOff':True},
   'installed_source_fence':lambda *a:self.calls.append('source-fence'),'require_restart_configuration':lambda *a:self.calls.append('config-fence'),
   'require_writes_disabled_status':lambda *a:self.calls.append('status-fence'),'creation_identity':creation,
   'validate_cached_prefix':fixtures.module.validate_cached_prefix,
   'publication_result':lambda final,prepared,q:mod.need(final.get('committed')is True and final.get('postconditionsVerified')is True and final.get('qualificationSha256')==q['sha256'],'Native result invalid')}
  def read(path,expected=None,**kw):
   if path==mod.HELD:return encode({'held':True})
   raw=Path(path).read_bytes();mod.need(expected is None or mod.sha(raw)==expected,'fixture digest mismatch');return raw
  def save(path,raw):
   with Path(path).open('xb')as f:f.write(raw)
  self.engine={'BASE':self.base,'ROOT':self.runtime,'ACCEPTED':self.accepted,'read':read,'encode':encode,'save':save,'sync_dir':lambda *a:None,
   'identity':lambda s:(s.st_dev,s.st_ino,s.st_mode,s.st_uid,s.st_gid,s.st_size,s.st_mtime_ns,s.st_ctime_ns),
   'previous_archive':lambda *a:{'archiveSha256':'d'*64},'inventory':lambda *a:self.calls.append('inventory')}
  self.verify=lambda **kw:(self.calls.append('verify-candidate' if kw else 'verify-published') or {'ok':True,'baselineHead':self.m['baselineHead'],'baselineTree':'9'*40})
  self.sync_inputs()
 def tearDown(self):self.tmp.cleanup()
 def ref(self,name,value):
  raw=encode(value);p=self.inner/name;p.write_bytes(raw);return {'path':str(p),'sha256':mod.sha(raw)}
 def sync_inputs(self):
  (self.inner/'manifest.json').write_bytes(encode(self.m));(self.inner/'receipt.json').write_bytes(encode(self.r))
  self.a['inner']['receiptSha256']=mod.sha(encode(self.r))
 def bundle(self):return mod.validate_bundle(self.a,self.plan,self.m,self.r,self.controller)
 def run_accept(self):
  self.sync_inputs();approval_path=self.root/'approval.json';approval_raw=encode(self.a);approval_path.write_bytes(approval_raw)
  Path(self.a['plan']['path']).write_bytes(encode(self.plan))
  return mod.acceptance(self.engine,self.controller,self.a,self.plan,{'path':str(approval_path),'sha256':mod.sha(approval_raw)})(None,self.custody,self.verify)
 def test_streamed_sql_exact_128mib_boundary_without_large_file(self):
  path=self.root/'large.sql';path.write_bytes(b'fixture');path.chmod(0o600)
  actual=path.stat();size=128*1024**2
  fields={key:getattr(actual,key) for key in ('st_dev','st_ino','st_mode','st_uid','st_gid',
      'st_nlink','st_size','st_mtime_ns','st_ctime_ns')}
  fields['st_size']=size;virtual=types.SimpleNamespace(**fields)
  chunk=b'0'*(1024**2);digest=hashlib.sha256()
  for _ in range(128):digest.update(chunk)
  class Stream:
   def __init__(self,fd):self.fd=fd;self.left=size
   def fileno(self):return self.fd
   def read(self,n):
    amount=min(n,self.left);self.left-=amount
    return chunk[:amount]
   def __enter__(self):return self
   def __exit__(self,*args):os.close(self.fd)
  with patch.object(Path,'lstat',return_value=virtual),patch.object(os,'fstat',return_value=virtual),\
       patch.object(os,'fdopen',side_effect=lambda fd,*args:Stream(fd)):
   mod.verify_sql_artifact(path,digest.hexdigest())
  fields['st_size']=size+1
  with patch.object(Path,'lstat',return_value=types.SimpleNamespace(**fields)):
   with self.assertRaisesRegex(ValueError,'oversized'):
    mod.verify_sql_artifact(path,digest.hexdigest())
 def test_streamed_sql_replacement_and_changed_digest_refuse(self):
  path=self.root/'replace.sql';path.write_bytes(b'old');path.chmod(0o600)
  with self.assertRaisesRegex(ValueError,'digest'):
   mod.verify_sql_artifact(path,'0'*64)
  real_fdopen=os.fdopen;replaced=[]
  class Stream:
   def __init__(self,fd):self.inner=real_fdopen(fd,'rb')
   def fileno(self):return self.inner.fileno()
   def read(self,n):
    data=self.inner.read(n)
    if not replaced:
     foreign=path.with_suffix('.foreign');foreign.write_bytes(b'old');foreign.chmod(0o600)
     replaced.append(foreign.stat().st_ino);os.replace(foreign,path)
    return data
   def __enter__(self):return self
   def __exit__(self,*args):self.inner.close()
  with patch.object(os,'fdopen',side_effect=lambda fd,*args:Stream(fd)):
   with self.assertRaisesRegex(ValueError,'changed'):
    mod.verify_sql_artifact(path,mod.sha(b'old'))
  self.assertEqual(path.stat().st_ino,replaced[0]);self.assertEqual(path.read_bytes(),b'old')
 def test_exact_bundle(self):self.bundle()
 def test_approval_rejects_unknown_scope(self):
  self.a['newPaths']=[]
  with self.assertRaises(ValueError):mod.validate_approval(self.a)
 def test_wrong_source_tree(self):
  self.a['sourceTree']='a'*40
  with self.assertRaises(ValueError):self.bundle()
 def test_wrong_controller(self):
  self.plan['controllerSha256']='0'*64
  with self.assertRaises(ValueError):self.bundle()
 def test_wrong_manifest(self):
  self.m['gateway']={'foreign':True}
  with self.assertRaises(ValueError):self.bundle()
 def test_incomplete_receipt(self):
  for key,value in [('installed',False),('rolledBack',True),('recoveryIncomplete',True),('sourceWritesStarted',False)]:
   with self.subTest(key=key):
    saved=copy.deepcopy(self.r);self.r[key]=value
    with self.assertRaises(ValueError):self.bundle()
    self.r=saved
 def test_missing_or_duplicate_source(self):
  self.r['sources'][-1]=copy.deepcopy(self.r['sources'][0])
  with self.assertRaises(ValueError):self.bundle()
 def test_existing_cannot_be_new(self):
  self.m['sources'][0]['before']=None;self.plan['runtimeManifestTemplate']['sources']=copy.deepcopy(self.m['sources'])
  self.r['sources'][0]['before']=None
  with self.assertRaises(ValueError):self.bundle()
 def test_prefix_movement(self):
  self.r['boundaryAfterDrain']=copy.deepcopy(self.after);self.r['boundaryAfterDrain']['fixedPrefix']={'through':973105}
  with self.assertRaises(ValueError):self.bundle()
 def test_writes_on_status(self):
  self.r['writesDisabledStatus']={'fixtureActiveWritesOff':False}
  with self.assertRaises(ValueError):self.bundle()
 def replace_after(self,q):
  self.q=q;ref=self.ref('qualification-after.json',q)
  self.r['boundaryAfterDrain'].update(ref,qualified=True,mode='after-drain',fixedPrefix=q['fixedPrefix'])
  self.final['qualificationSha256']=ref['sha256']
  native=self.ref('publication-dispatch.json.result.json',self.final)
  self.r['replayPublication'].update(native,qualificationSha256=ref['sha256'],
      through=q['fixedPrefix']['through'],blocks=len(q['blocks']))
 def test_verified_cached_extension_accepted_with_original_prefix_evidence(self):
  prior=json.loads((self.inner/'qualification-before.json').read_text())
  q=fixtures.cached_extension(prior,fixtures.qualification_fixture(self.m,'after-drain',2),self.before['sha256'])
  self.replace_after(q);self.run_accept()
  row=json.loads(self.accepted.read_text())['overlays'][0]
  self.assertIn({'path':str(self.inner/'qualification-before.json'),'sha256':self.before['sha256']},row['evidence'])
 def test_extension_without_cache_revalidation_refuses(self):
  q=fixtures.qualification_fixture(self.m,'after-drain',2)
  q['priorManifestSha256']=self.before['sha256'];self.replace_after(q)
  with self.assertRaises(ValueError):self.run_accept()
  self.assertEqual(mod.sha(self.accepted.read_bytes()),self.a['acceptedSha256'])
 def test_cached_prefix_native_or_relational_drift_refuses(self):
  for field in ('oldNativeSha256','eventRowsSha256'):
   q=copy.deepcopy(self.q)
   if field=='eventRowsSha256':q['blocks'][0]['relationalBindings'][field]='0'*64
   else:q['blocks'][0][field]='0'*64
   self.replace_after(q)
   with self.assertRaises(ValueError):self.run_accept()
   self.assertEqual(mod.sha(self.accepted.read_bytes()),self.a['acceptedSha256'])
 def test_success_preserves_unrelated_and_original_evidence(self):
  self.run_accept();result=json.loads(self.accepted.read_text())
  self.assertEqual(next(x for x in result['overlays']if x['path']=='unrelated'),self.accepted_value['overlays'][-1])
  self.assertEqual(json.loads((self.custody/'source-overlays-before.json').read_text()),self.accepted_value)
  self.assertLess(self.calls.index('inventory'),self.calls.index('verify-candidate'))
  self.assertEqual(self.calls.count('status-fence'),2)
 def test_missing_accepted_overlay(self):
  self.accepted_value['overlays']=self.accepted_value['overlays'][1:];self.accepted.write_bytes(encode(self.accepted_value));self.a['acceptedSha256']=mod.sha(self.accepted.read_bytes())
  with self.assertRaises(ValueError):self.run_accept()
 def test_before_inventory_hash_mismatch(self):
  self.accepted_value['overlays'][0]['sha256']='0'*64;self.accepted.write_bytes(encode(self.accepted_value));self.a['acceptedSha256']=mod.sha(self.accepted.read_bytes())
  with self.assertRaises(ValueError):self.run_accept()
 def test_inventory_executable_mode_drift(self):
  self.accepted_value['overlays'][0]['gitMode']='100755';self.accepted.write_bytes(encode(self.accepted_value));self.a['acceptedSha256']=mod.sha(self.accepted.read_bytes())
  with self.assertRaises(ValueError):self.run_accept()
 def test_foreign_same_bytes_inode(self):
  p=self.runtime/sorted(mod.TARGETS)[0];raw=p.read_bytes();temp=p.with_name(p.name+'.foreign');temp.write_bytes(raw);temp.chmod(0o600);os.replace(temp,p)
  with self.assertRaises(ValueError):self.run_accept()
 def test_native_failure_refuses_before_acceptance(self):
  self.final['committed']=False;self.r['replayPublication']['sha256']=self.ref('publication-dispatch.json.result.json',self.final)['sha256']
  with self.assertRaises(ValueError):self.run_accept()
  self.assertEqual(mod.sha(self.accepted.read_bytes()),self.a['acceptedSha256'])
 def test_changed_qualification_refuses(self):
  (self.inner/'qualification-after.json').write_bytes(b'{}')
  with self.assertRaises(ValueError):self.run_accept()
 def test_evidence_escape_refuses(self):
  self.r['replayPublication']['path']=str(self.root/'foreign.json')
  with self.assertRaises(ValueError):self.run_accept()
 def test_prior_archive_pin_drift(self):
  self.engine['previous_archive']=lambda *a:{'archiveSha256':'0'*64}
  with self.assertRaises(ValueError):self.run_accept()
 def test_held_inventory_refusal_before_acceptance(self):
  self.engine['inventory']=lambda *a:(_ for _ in ()).throw(ValueError('held evidence'))
  with self.assertRaises(ValueError):self.run_accept()
  self.assertEqual(mod.sha(self.accepted.read_bytes()),self.a['acceptedSha256'])
 def test_whole_candidate_verifier_failure(self):
  self.verify=lambda **kw:{'ok':False}
  with self.assertRaises(ValueError):self.run_accept()
  self.assertEqual(mod.sha(self.accepted.read_bytes()),self.a['acceptedSha256'])
 def test_source_drift_during_whole_verification(self):
  def verify(**kw):
   p=self.runtime/sorted(mod.TARGETS)[0];p.write_bytes(b'foreign')
   return {'ok':True,'baselineHead':self.m['baselineHead'],'baselineTree':'9'*40}
  self.verify=verify
  with self.assertRaises(ValueError):self.run_accept()
  self.assertEqual(mod.sha(self.accepted.read_bytes()),self.a['acceptedSha256'])
 def test_acceptance_drift_preserved(self):
  def verify(**kw):
   self.accepted.write_bytes(b'foreign')
   return {'ok':True,'baselineHead':self.m['baselineHead'],'baselineTree':'9'*40}
  self.verify=verify
  with self.assertRaises(ValueError):self.run_accept()
  self.assertEqual(self.accepted.read_bytes(),b'foreign')
 def test_failed_published_verifier_restores_only_owned_inventory(self):
  def verify(**kw):
   if not kw:raise ValueError('failed published verifier')
   return {'ok':True,'baselineHead':self.m['baselineHead'],'baselineTree':'9'*40}
  self.verify=verify
  with self.assertRaises(ValueError):self.run_accept()
  self.assertEqual(mod.sha(self.accepted.read_bytes()),self.a['acceptedSha256'])
 def test_no_archive_retirement_or_service_implementation(self):
  source=(ROOT/'runtime-archive.py').read_text()
  self.assertNotIn('unlink(',source);self.assertNotIn("'tar'",source)
  self.assertNotIn("'systemctl'",source)
  self.assertEqual(source.count("engine['accept_source']="),1)
if __name__=='__main__':unittest.main()
