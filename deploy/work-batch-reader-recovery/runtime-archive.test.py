#!/usr/bin/python3 -I
"""Offline acceptance fixtures; never runs the archive engine or live services."""
import base64,copy,importlib.util,json,os,stat,tempfile,types,unittest
from pathlib import Path
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('reader_archive',Path(__file__).with_name('runtime-archive.py'))
a=importlib.util.module_from_spec(spec);spec.loader.exec_module(a)
def encode(value):return (json.dumps(value,sort_keys=True,indent=2)+'\n').encode()
def ident(s):return [s.st_dev,s.st_ino,s.st_uid,s.st_gid,stat.S_IMODE(s.st_mode),s.st_size,s.st_mtime_ns]
class ArchiveTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory(prefix='reader-archive-fixture-');self.addCleanup(self.tmp.cleanup)
  self.root=Path(self.tmp.name);self.runtime=self.root/'runtime';self.runtime.mkdir()
  self.base=self.root/'backups';self.base.mkdir();self.calls=[]
  self.commit='1'*40;self.tree='2'*40;self.rid=self.commit[:12]+'-20261026T220000Z'
  self.inner=self.base/('work-batch-reader-recovery-'+self.rid+'-20261026T220001Z');self.inner.mkdir(mode=0o700)
  self.custody=self.base/'new';self.custody.mkdir();self.accepted=self.root/'accepted.json'
  rows=[];metadata={};journal={}
  for name in sorted(a.TARGETS):
   raw=('after '+name).encode();p=self.runtime/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(raw);p.chmod(0o640)
   rows.append({'path':name,'before':None if name in a.NEW else a.sha(('before '+name).encode()),'after':a.sha(raw),'base64':base64.b64encode(raw).decode()})
   s=p.lstat();metadata[name]={'uid':s.st_uid,'gid':s.st_gid,'mode':0o640}
   journal[name]={'published':True,'candidateSha256':a.sha(raw),'candidateIdentity':ident(s)}
  self.accepted_value={'format':'pow-accepted-node-source-overlays-v1','baselineHead':'3'*40,'baselineTree':'4'*40,
   'overlays':[{'path':row['path'],'sha256':row['before'],'gitMode':'100644','evidence':[{'path':'historical-original','sha256':'a'*64}]}for row in rows if row['path']not in a.NEW]+[{'path':'server/unchanged-overlay.mjs','sha256':'b'*64,'gitMode':'100644','evidence':[{'path':'unique-history','sha256':'c'*64}]}]}
  self.accepted.write_bytes(encode(self.accepted_value));self.pin=a.sha(self.accepted.read_bytes())
  self.authority={'protocol':'work-batch-v1','network':'livenet','active':True,'writeEnabled':True,
   'declarationTxid':'d'*64,'activationHeight':973104,'limits':{'minRecipients':2,'maxRecipients':256,'maxPayloadBytes':65536},'registryFeeProofs':546}
  self.postflight={'format':'work-batch-reader-recovery-postflight-v1','qualified':True,'summaryCaughtUp':True,'workBatchReady':True,
   'batchAuthority':self.authority,'tipHeight':973285,'tipHash':'f'*64,'summarySnapshotId':'fresh-summary',
   'summaryCoverage':{key:973285 for key in ('growthSummary','inceptionSummary','infinitySummary','logSummary','marketplaceSummary','tokenSummary','workFloor','workSummary')}}
  self.m={'format':a.FAMILY,'sourceCommit':self.commit,'releaseId':self.rid,'baselineHead':'3'*40,'baseSourceCommit':'5'*40,
   'sourceMetadata':metadata,'dependencyMetadata':{},'dependencies':{},'restartConfigurationSha256':'6'*64,
   'gateway':{},'protectedServices':{},'services':['api','worker'],'sources':rows,'searchHold':{'markerSha256':'7'*64},
   'batchAuthority':self.authority,'acceptedInventorySha256':self.pin}
  prior_row=copy.deepcopy(next(row for row in rows if row['path']=='server/db/proof-index-reader.mjs'))
  prior_row['after']=prior_row['before'];prior_row['before']=a.sha(b'original accepted reader')
  self.predecessor={'manifest':{'sources':[prior_row]}}
  next(row for row in self.accepted_value['overlays']if row['path']==prior_row['path'])['sha256']=prior_row['before']
  self.accepted.write_bytes(encode(self.accepted_value));self.pin=a.sha(self.accepted.read_bytes());self.m['acceptedInventorySha256']=self.pin
  self.predecessor_bytes={key:encode({'historical':key})for key in ('plan','manifest','receipt','dispatch')}
  self.m['predecessor']={key:{'path':str(self.root/('old-'+key+'.json')),'sha256':a.sha(raw)}for key,raw in self.predecessor_bytes.items()}
  self.m['searchHold']['bindings']={'releaseId':'old-release','attempt':'initial','files':{}}
  self.plan={'format':'proof-of-work-work-batch-reader-recovery-rollout-plan-v1','sourceCommit':self.commit,'releaseId':self.rid,
   'controllerSha256':a.sha(b'controller'),'controllerBase64':base64.b64encode(b'controller').decode(),'runtimeManifestTemplate':copy.deepcopy(self.m)}
  self.m['searchHold']['markerSha256']='8'*64
  self.r={key:copy.deepcopy(self.m[key])for key in ('format','sourceCommit','releaseId','baselineHead','baseSourceCommit','sourceMetadata','dependencyMetadata','restartConfigurationSha256','gateway','protectedServices','predecessor')}
  self.r.update(manifestSha256=a.sha(encode(self.m)),rollbackRoot=str(self.inner),installed=True,rolledBack=False,sourceWritesStarted=True,stopRequested=True,
   completedAt='2026-10-26T22:00:02+00:00',dependencyCount=0,
   servicesAfter={name:{'ActiveState':'active','MainPID':'123','WorkingDirectory':'/opt/proofofwork-api'}for name in self.m['services']},
   sources=[{key:value for key,value in row.items()if key!='base64'}for row in rows],createdHelpers=journal,
   postflight=copy.deepcopy(self.postflight))
  self.qualification={'format':'work-batch-summary-rehearsal-qualified-v1','qualified':True,
   'planSha256':a.sha(encode(self.plan)),'sourceCommit':self.commit,'releaseId':self.rid,
   'candidateHashes':{row['path']:row['after']for row in rows},'predecessor':self.m['predecessor'],
   'unit':'pow-batch-summary-rehearsal-'+self.rid+'.service','invocationId':'c'*32,
   'dispatchSha256':'d'*64,'stdoutSha256':'e'*64,'adapterHashes':{name:'f'*64 for name in ('api.mjs','postgres.mjs','fetch-guard.mjs')},
   'result':{'format':'work-batch-summary-readonly-rehearsal-v1','ok':True,'published':False,
    'indexedThroughBlock':973285,'indexedThroughBlockHash':'f'*64,'snapshotId':'2'*24,
    'summaryKeys':sorted(self.postflight['summaryCoverage'])}}
  self.dispatch={'format':'proof-of-work-work-batch-reader-recovery-node-dispatch-receipt-v1','dispatchStatus':'completed','exitCode':0,
   'rehearsal':{'path':str(self.root/'qualification.json'),'sha256':a.sha(encode(self.qualification))},
   'planSha256':a.sha(encode(self.plan)),'releaseId':self.rid,'stdout':json.dumps({'format':'proof-of-work-work-batch-reader-recovery-rollout-result-v1',
   'releaseId':self.rid,'overlay':self.r,'searchRestore':{'ok':True,'phase':'restore',**self.m['searchHold']['bindings']}})}
  self.approval={'dispatch':{'path':str(self.root/'dispatch.json'),'sha256':a.sha(encode(self.dispatch))},'format':'work-batch-reader-recovery-runtime-archive-approval-v1','sourceCommit':self.commit,'sourceTree':self.tree,'releaseId':self.rid,
   'plan':{'path':str(self.root/'plan.json'),'sha256':a.sha(encode(self.plan))},'inner':{'path':str(self.inner),'manifestSha256':self.r['manifestSha256'],'receiptSha256':a.sha(encode(self.r))},
   'acceptedSha256':self.pin,'previousCompletion':{'path':str(self.base/'previous/completion.json'),'sha256':'c'*64,'archiveSha256':'d'*64},'heldSha256':a.HELD_SHA}
  self.controller={'predecessor_fence':lambda *args,**kwargs:self.predecessor,'raw':b'controller','validate_manifest':lambda m:None,'creation_identity':ident,
   'installed_source_fence':lambda *args:self.calls.append('source-fence'),'require_restart_configuration':lambda *args:self.calls.append('config-fence'),
   'require_postflight':lambda authority:copy.deepcopy(self.postflight),'validate_postflight':self.check_postflight,
   'validate_rehearsal':self.check_rehearsal}
  def read(path,expected=None,**kw):
   if path==a.HELD:return encode({'fixtureHeld':True})
   raw=Path(path).read_bytes();a.need(expected is None or a.sha(raw)==expected,'Fixture digest differs');return raw
  def save(path,raw):
   with Path(path).open('xb')as stream:stream.write(raw)
  self.engine={'BASE':self.base,'ROOT':self.runtime,'ACCEPTED':self.accepted,'read':read,'encode':encode,'save':save,'sync_dir':lambda *args:None,
   'identity':lambda s:(s.st_dev,s.st_ino,s.st_mode,s.st_uid,s.st_gid,s.st_size,s.st_mtime_ns,s.st_ctime_ns),
   'previous_archive':lambda *args:{'archiveSha256':'d'*64},'inventory':lambda *args:self.calls.append('inventory')}
  self.verify=lambda **kw:(self.calls.append('verify-candidate'if kw else 'verify-published')or{'ok':True,'baselineHead':'3'*40,'baselineTree':'4'*40})
  original=Path.lstat
  def root_dirs(path,*args,**kwargs):
   info=original(path,*args,**kwargs)
   if (path==self.root or self.root in path.parents)and stat.S_ISDIR(info.st_mode):
    fields={k:getattr(info,k)for k in dir(info)if k.startswith('st_')};fields.update(st_uid=0,st_gid=0);return types.SimpleNamespace(**fields)
   return info
  handle=patch.object(Path,'lstat',root_dirs);handle.start();self.addCleanup(handle.stop)
 def check_postflight(self,value,authority):
  spec=importlib.util.spec_from_file_location('fixture_reader_controller',Path(__file__).with_name('scoped-node.py'))
  controller=importlib.util.module_from_spec(spec);spec.loader.exec_module(controller)
  return controller.validate_postflight(value,authority)
 def check_rehearsal(self,value,plan,pin):
  spec=importlib.util.spec_from_file_location('fixture_rehearsal_controller',Path(__file__).with_name('scoped-node.py'))
  controller=importlib.util.module_from_spec(spec);spec.loader.exec_module(controller)
  return controller.validate_rehearsal(value,plan,pin)
 def bundle(self):return a.validate_bundle(self.approval,self.plan,self.m,self.r,self.controller)
 def run_accept(self):
  (self.root/'qualification.json').write_bytes(encode(self.qualification))
  for key,raw in self.predecessor_bytes.items():Path(self.m['predecessor'][key]['path']).write_bytes(raw)
  Path(self.approval['dispatch']['path']).write_bytes(encode(self.dispatch))
  (self.inner/'manifest.json').write_bytes(encode(self.m));(self.inner/'receipt.json').write_bytes(encode(self.r));self.approval['inner']['receiptSha256']=a.sha(encode(self.r))
  reference=self.root/'approval.json';reference.write_bytes(encode(self.approval));Path(self.approval['plan']['path']).write_bytes(encode(self.plan))
  with patch.object(a.subprocess,'check_output',return_value=b''):
   return a.acceptance(self.engine,self.controller,self.approval,self.plan,{'path':str(reference),'sha256':a.sha(reference.read_bytes())})(None,self.custody,self.verify)
 def actual(self,name):
  p=self.runtime/name;s=p.lstat();return {'sha256':a.sha(p.read_bytes()),'metadata':{'uid':s.st_uid,'gid':s.st_gid,'mode':stat.S_IMODE(s.st_mode)},'identity':ident(s)}
 def test_exact_approval_and_bundle(self):a.validate_approval(self.approval);self.assertEqual(set(self.bundle()),a.TARGETS)
 def test_fixed_creation_and_existing_scope(self):self.assertEqual(len(a.NEW),0);self.assertEqual(a.TARGETS,{'server/db/proof-index-reader.mjs','server/proof-api.mjs'})
 def test_success_preserves_untouched_overlays_and_all_original_evidence(self):
  self.run_accept();result=json.loads(self.accepted.read_bytes())
  self.assertEqual(next(row for row in result['overlays']if row['path']=='server/unchanged-overlay.mjs'),self.accepted_value['overlays'][-1])
  self.assertEqual(json.loads((self.custody/'source-overlays-before.json').read_bytes()),self.accepted_value)
  self.assertLess(self.calls.index('inventory'),self.calls.index('verify-candidate'))
  self.assertEqual(self.calls.count('source-fence'),2)
  for row in result['overlays']:
   if row['path']in a.TARGETS:
    self.assertEqual(len(row['evidence']),11)
    self.assertTrue(all(self.base in Path(item['path']).parents for item in row['evidence']))
  mapping=json.loads((self.custody/'evidence-origins.json').read_bytes())
  self.assertEqual(len(mapping['copies']),8)
  for item in mapping['copies']:
   self.assertEqual(Path(item['origin']['path']).read_bytes(),Path(item['retained']['path']).read_bytes())
   self.assertEqual(item['origin']['sha256'],item['retained']['sha256'])
 def test_retained_copies_pass_actual_verifier_custody_rule_and_original_paths_refuse(self):
  self.run_accept()
  source=Path(__file__).resolve().parents[1]/'node-overlay-source-health.py'
  namespace={'__name__':'offline_source_verifier','__file__':str(source)}
  exec(compile(source.read_bytes(),str(source),'exec'),namespace)
  candidate=json.loads(self.accepted.read_bytes())
  candidate['overlays']=[row for row in candidate['overlays']if row['path']in a.TARGETS]
  manifest=self.custody/'verifier-fixture.json';manifest.write_bytes(encode(candidate))
  self.runtime.chmod(0o750);manifest.chmod(0o600)
  for row in candidate['overlays']:
   for item in row['evidence']:Path(item['path']).chmod(0o600)
  # Git identity is synthetic; the unchanged verifier reads actual source/evidence files.
  others=b''.join(name.encode()+b'\0'for name in sorted(a.TARGETS))
  def git(root,*args):
   if args==('rev-parse','HEAD'):return b'3'*40+b'\n'
   if args==('rev-parse','HEAD^{tree}'):return b'4'*40+b'\n'
   if args==('ls-tree','-rz','--full-tree','HEAD'):return b''
   if args==('ls-files','--others','--exclude-standard','-z'):return others
   if args==('ls-files','--others','--ignored','--exclude-standard','-z'):return b''
   raise AssertionError(args)
  namespace['git']=git
  with patch.object(namespace['subprocess'],'run',return_value=types.SimpleNamespace(returncode=1)):
   self.assertTrue(namespace['verify'](self.runtime,manifest,self.base,os.getuid())['ok'])
   candidate['overlays'][0]['evidence'][0]['path']=str(self.root/'approval.json')
   manifest.write_bytes(encode(candidate))
   with self.assertRaisesRegex(ValueError,'Evidence escapes retained release custody'):
    namespace['verify'](self.runtime,manifest,self.base,os.getuid())
 def test_original_or_retained_evidence_drift_during_candidate_verification_refuses(self):
  original=self.verify
  def verify(**kw):
   (self.root/'plan.json').write_bytes(b'foreign')
   return original(**kw)
  self.verify=verify
  with self.assertRaisesRegex(ValueError,'digest differs'):self.run_accept()
  self.assertEqual(a.sha(self.accepted.read_bytes()),self.pin)
 def test_retained_evidence_drift_during_candidate_verification_refuses(self):
  original=self.verify
  def verify(**kw):
   (self.custody/'archive-approval.json').write_bytes(b'foreign')
   return original(**kw)
  self.verify=verify
  with self.assertRaisesRegex(ValueError,'digest differs'):self.run_accept()
  self.assertEqual(a.sha(self.accepted.read_bytes()),self.pin)
 def test_existing_retained_evidence_is_never_overwritten(self):
  path=self.custody/'archive-approval.json';path.write_bytes(b'foreign')
  with self.assertRaises(FileExistsError):self.run_accept()
  self.assertEqual(path.read_bytes(),b'foreign')
  self.assertEqual(a.sha(self.accepted.read_bytes()),self.pin)
 def test_unknown_approval_fields_refuse(self):
  self.approval['newPaths']=[]
  with self.assertRaises(ValueError):a.validate_approval(self.approval)
 def test_missing_rehearsal_refuses_dispatch(self):
  self.dispatch.pop('rehearsal')
  with self.assertRaisesRegex(ValueError,'rehearsal'):a.validate_dispatch(self.approval,self.m,self.r,self.dispatch)
 def test_rehearsal_bound_to_wrong_sources_refuses_acceptance(self):
  self.qualification['candidateHashes']['server/proof-api.mjs']='0'*64
  self.dispatch['rehearsal']['sha256']=a.sha(encode(self.qualification))
  self.approval['dispatch']['sha256']=a.sha(encode(self.dispatch))
  with self.assertRaisesRegex(ValueError,'Rehearsal source'):self.run_accept()
  self.assertEqual(a.sha(self.accepted.read_bytes()),self.pin)
 def test_wrong_plan_controller(self):
  self.plan['controllerSha256']='0'*64
  with self.assertRaises(ValueError):self.bundle()
 def test_changed_manifest(self):
  self.m['gateway']={'foreign':True}
  with self.assertRaises(ValueError):self.bundle()
 def test_incomplete_or_forward_only_receipt_refuses(self):
  for key,value in [('installed',False),('rolledBack',True),('recoveryIncomplete',True),('sourceWritesStarted',False),('forwardRecoveryRequired',True)]:
   before=copy.deepcopy(self.r);self.r[key]=value
   with self.subTest(key=key),self.assertRaises(ValueError):self.bundle()
   self.r=before
 def test_missing_scope_or_publication_journal(self):
  self.r['createdHelpers'].pop(next(iter(a.TARGETS)))
  with self.assertRaises(ValueError):self.bundle()
 def test_missing_canonical_postflight_refuses(self):
  self.r['postflight']['summaryCaughtUp']=False
  with self.assertRaises(ValueError):self.bundle()
 def test_batch_authority_change_refuses_acceptance(self):
  self.r['postflight']['batchAuthority']={**self.authority,'declarationTxid':'0'*64}
  with self.assertRaises(ValueError):self.bundle()
 def test_stale_summary_coverage_refuses_acceptance(self):
  self.r['postflight']['summaryCoverage']['workSummary']=973283
  with self.assertRaises(ValueError):self.bundle()
 def test_before_hash_or_mode_drift(self):
  for key,value in [('sha256','0'*64),('gitMode','100755')]:
   data=copy.deepcopy(self.accepted_value);data['overlays'][0][key]=value
   with self.subTest(key=key),self.assertRaises(ValueError):a.extend_inventory(self.m,self.r,data,[],self.actual,lambda name:None,self.predecessor)
 def test_existing_not_in_inventory_requires_exact_baseline_blob_and_mode(self):
  data=copy.deepcopy(self.accepted_value);removed=data['overlays'].pop(0)
  baseline=lambda name:{'sha256':removed['sha256'],'gitMode':removed['gitMode']}if name==removed['path']else None
  a.extend_inventory(self.m,self.r,data,[],self.actual,baseline,self.predecessor)
  with self.assertRaises(ValueError):a.extend_inventory(self.m,self.r,data,[],self.actual,lambda name:None,self.predecessor)
  with self.assertRaises(ValueError):a.extend_inventory(self.m,self.r,data,[],self.actual,lambda name:{'sha256':removed['sha256'],'gitMode':'100755'}if name==removed['path']else None,self.predecessor)
 def test_creation_only_or_other_source_scope_refuses(self):
  self.m['sources'][0]['before']=None
  with self.assertRaises(ValueError):self.bundle()
 def test_foreign_same_bytes_inode_refuses(self):
  p=self.runtime/next(iter(a.TARGETS));replacement=p.with_name('foreign');replacement.write_bytes(p.read_bytes());replacement.chmod(0o640);os.replace(replacement,p)
  with self.assertRaises(ValueError):self.run_accept()
 def test_original_inventory_drift_refuses(self):
  self.accepted.write_bytes(b'{}')
  with self.assertRaises(ValueError):self.run_accept()
 def test_previous_archive_drift_refuses(self):
  self.engine['previous_archive']=lambda *args:{'archiveSha256':'0'*64}
  with self.assertRaises(ValueError):self.run_accept()
 def test_held_evidence_refuses_before_inventory_publication(self):
  self.engine['inventory']=lambda *args:(_ for _ in()).throw(ValueError('held'))
  with self.assertRaisesRegex(ValueError,'held'):self.run_accept()
  self.assertEqual(a.sha(self.accepted.read_bytes()),self.pin)
 def test_whole_candidate_failure_preserves_accepted_inventory(self):
  self.verify=lambda **kw:{'ok':False}
  with self.assertRaises(ValueError):self.run_accept()
  self.assertEqual(a.sha(self.accepted.read_bytes()),self.pin)
 def test_source_replacement_during_whole_verifier_refuses(self):
  def verify(**kw):
   p=self.runtime/next(iter(a.TARGETS));p.write_bytes(b'foreign');return {'ok':True,'baselineHead':'3'*40,'baselineTree':'4'*40}
  self.verify=verify
  with self.assertRaises(ValueError):self.run_accept()
  self.assertEqual(a.sha(self.accepted.read_bytes()),self.pin)
 def test_published_verifier_failure_restores_exact_inventory(self):
  self.verify=lambda **kw:{'ok':bool(kw),'baselineHead':'3'*40,'baselineTree':'4'*40}
  with self.assertRaises(ValueError):self.run_accept()
  self.assertEqual(a.sha(self.accepted.read_bytes()),self.pin)
 def test_actual_configuration_drift_refuses(self):
  self.controller['require_restart_configuration']=lambda *args:(_ for _ in()).throw(ValueError('configuration'))
  with self.assertRaises(ValueError):self.run_accept()
  self.assertEqual(a.sha(self.accepted.read_bytes()),self.pin)
 def test_duplicate_json_fields_refuse(self):
  with self.assertRaises(ValueError):a.strict_json(b'{"a":1,"a":2}')
 def test_engine_byte_pin_still_matches_unmodified_canonical_source(self):
  self.assertEqual(a.sha(a.ENGINE.read_bytes()),a.ENGINE_SHA)
 def test_intermediate_reader_is_not_falsely_treated_as_accepted(self):
  data=copy.deepcopy(self.accepted_value)
  row=next(row for row in data['overlays']if row['path']=='server/db/proof-index-reader.mjs')
  row['sha256']=self.predecessor['manifest']['sources'][0]['after']
  with self.assertRaisesRegex(ValueError,'Accepted before hash'):
   a.extend_inventory(self.m,self.r,data,[],self.actual,lambda name:None,self.predecessor)
 def test_three_generation_reader_acceptance_preserves_original_before_evidence(self):
  name='server/db/proof-index-reader.mjs';prior=self.predecessor['manifest']['sources'][0]
  current=next(row for row in self.m['sources']if row['path']==name)
  self.assertEqual(current['before'],prior['after'])
  self.assertEqual(len({prior['before'],prior['after'],current['after']}),3)
  self.run_accept();accepted=json.loads(self.accepted.read_bytes())
  self.assertEqual(next(row for row in accepted['overlays']if row['path']==name)['sha256'],current['after'])
  before=json.loads((self.custody/'source-overlays-before.json').read_bytes())
  self.assertEqual(next(row for row in before['overlays']if row['path']==name)['sha256'],prior['before'])
 def test_intermediate_reader_rehearsal_cannot_authorize_new_reader_acceptance(self):
  name='server/db/proof-index-reader.mjs'
  self.qualification['candidateHashes'][name]=self.predecessor['manifest']['sources'][0]['after']
  self.dispatch['rehearsal']['sha256']=a.sha(encode(self.qualification))
  self.approval['dispatch']['sha256']=a.sha(encode(self.dispatch))
  with self.assertRaisesRegex(ValueError,'Rehearsal source'):self.run_accept()
  self.assertEqual(a.sha(self.accepted.read_bytes()),self.pin)
 def test_broken_predecessor_after_chain_refuses(self):
  prior=copy.deepcopy(self.predecessor);prior['manifest']['sources'][0]['after']='0'*64
  with self.assertRaisesRegex(ValueError,'byte chain'):
   a.extend_inventory(self.m,self.r,self.accepted_value,[],self.actual,lambda name:None,prior)
 def test_expanded_predecessor_scope_refuses(self):
  prior=copy.deepcopy(self.predecessor);prior['manifest']['sources'].append(prior['manifest']['sources'][0])
  with self.assertRaisesRegex(ValueError,'predecessor acceptance scope'):
   a.extend_inventory(self.m,self.r,self.accepted_value,[],self.actual,lambda name:None,prior)
 def second_failure(self):
  original=copy.deepcopy(self.predecessor)
  rows=[]
  for current in self.m['sources']:
   row=copy.deepcopy(current);row['after']=current['before']
   rows.append(row)
  original['contract']={}
  for key in ('plan','manifest','receipt','dispatch'):
   path=self.root/('first-failure-'+key+'.json');raw=encode({'firstFailure':key})
   path.write_bytes(raw);original['contract'][key]={'path':str(path),'sha256':a.sha(raw)}
  qpath=self.root/'first-recovery-rehearsal.json';qraw=encode({'previousRehearsal':'qualified-history-only'})
  qpath.write_bytes(qraw)
  self.predecessor={'manifest':{'sources':rows},'ancestors':[original],
   'contract':copy.deepcopy(self.m['predecessor']),
   'dispatch':{'rehearsal':{'path':str(qpath),'sha256':a.sha(qraw)}}}
 def test_two_failed_attempts_preserve_all_generations_and_rehearsal_custody(self):
  self.second_failure();self.run_accept()
  accepted=json.loads(self.accepted.read_bytes())
  mapping=json.loads((self.custody/'evidence-origins.json').read_bytes())
  self.assertEqual(len(mapping['copies']),13)
  for copy_row in mapping['copies']:
   self.assertEqual(Path(copy_row['origin']['path']).read_bytes(),Path(copy_row['retained']['path']).read_bytes())
  self.assertTrue((self.custody/'predecessor-1-summary-rehearsal-qualified.json').exists())
  for row in accepted['overlays']:
   if row['path']in a.TARGETS:
    self.assertEqual(len(row['evidence']),16)
    self.assertTrue(all(self.base in Path(ref['path']).parents for ref in row['evidence']))
  self.assertEqual(json.loads((self.custody/'source-overlays-before.json').read_bytes()),self.accepted_value)
 def test_four_generation_reader_and_three_generation_api_never_accept_intermediate_hashes(self):
  self.second_failure()
  for current,prior in zip(self.m['sources'],self.predecessor['manifest']['sources']):
   self.assertEqual(current['path'],prior['path'])
   prior['after']=a.sha(('second failed '+current['path']).encode());current['before']=prior['after']
  result,_=a.extend_inventory(self.m,self.r,self.accepted_value,[],self.actual,lambda name:None,self.predecessor)
  for current in self.m['sources']:
   self.assertEqual(next(row for row in result['overlays']if row['path']==current['path'])['sha256'],current['after'])
  wrong=copy.deepcopy(self.accepted_value)
  next(row for row in wrong['overlays']if row['path']=='server/proof-api.mjs')['sha256']=self.predecessor['manifest']['sources'][1]['after']
  with self.assertRaisesRegex(ValueError,'Accepted before hash'):
   a.extend_inventory(self.m,self.r,wrong,[],self.actual,lambda name:None,self.predecessor)
 def test_missing_nested_or_extra_ancestor_refuses_acceptance(self):
  self.second_failure();self.predecessor['ancestors'].append(copy.deepcopy(self.predecessor['ancestors'][0]))
  with self.assertRaisesRegex(ValueError,'Expanded predecessor lineage'):
   a.extend_inventory(self.m,self.r,self.accepted_value,[],self.actual,lambda name:None,self.predecessor)
 def test_broken_nested_reader_chain_refuses_acceptance(self):
  self.second_failure();self.predecessor['ancestors'][0]['manifest']['sources'][0]['after']='0'*64
  with self.assertRaisesRegex(ValueError,'byte chain'):
   a.extend_inventory(self.m,self.r,self.accepted_value,[],self.actual,lambda name:None,self.predecessor)
 def test_nested_evidence_changed_during_acceptance_refuses(self):
  self.second_failure();ref=self.predecessor['ancestors'][0]['contract']['receipt']
  Path(ref['path']).write_bytes(b'foreign')
  with self.assertRaisesRegex(ValueError,'digest differs'):self.run_accept()
  self.assertEqual(a.sha(self.accepted.read_bytes()),self.pin)
 def test_missing_search_restore_refuses_successful_inner_receipt(self):
  dispatch=copy.deepcopy(self.dispatch);outcome=json.loads(dispatch['stdout']);outcome.pop('searchRestore');dispatch['stdout']=json.dumps(outcome)
  with self.assertRaisesRegex(ValueError,'Search restoration'):a.validate_dispatch(self.approval,self.m,self.r,dispatch)
 def test_failed_outer_dispatch_is_not_archive_authority(self):
  for key,value in [('exitCode',1),('dispatchStatus','refused'),('planSha256','0'*64)]:
   dispatch={**self.dispatch,key:value}
   with self.subTest(key=key),self.assertRaisesRegex(ValueError,'dispatcher'):
    a.validate_dispatch(self.approval,self.m,self.r,dispatch)
if __name__=='__main__':unittest.main()
