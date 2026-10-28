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
  self.inner=self.base/('work-batch-pending-summary-fix-'+self.rid+'-20261026T220001Z');self.inner.mkdir(mode=0o700)
  self.custody=self.base/'new';self.custody.mkdir();self.accepted=self.root/'accepted.json'
  rows=[];metadata={};journal={}
  for name in sorted(a.TARGETS):
   raw=('after '+name).encode();p=self.runtime/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(raw);p.chmod(0o640)
   rows.append({'path':name,'before':a.V6_API_SHA,'after':a.sha(raw),'base64':base64.b64encode(raw).decode()})
   s=p.lstat();metadata[name]={'uid':s.st_uid,'gid':s.st_gid,'mode':0o640}
   journal[name]={'published':True,'candidateSha256':a.sha(raw),'candidateIdentity':ident(s)}
  self.accepted_value={'format':'pow-accepted-node-source-overlays-v1','baselineHead':'3'*40,'baselineTree':'4'*40,
   'overlays':[{'path':row['path'],'sha256':row['before'],'gitMode':'100644','evidence':[{'path':'historical-original','sha256':'a'*64}]}for row in rows if row['path']not in a.NEW]+[{'path':'server/unchanged-overlay.mjs','sha256':'b'*64,'gitMode':'100644','evidence':[{'path':'unique-history','sha256':'c'*64}]}]}
  self.accepted.write_bytes(encode(self.accepted_value));self.pin=a.sha(self.accepted.read_bytes());handle=patch.object(a,'V6_ACCEPTED_SHA',self.pin);handle.start();self.addCleanup(handle.stop)
  self.authority={'protocol':'work-batch-v1','network':'livenet','active':True,'writeEnabled':True,
   'declarationTxid':'d'*64,'activationHeight':973104,'limits':{'minRecipients':2,'maxRecipients':256,'maxPayloadBytes':65536},'registryFeeProofs':546}
  self.postflight={'format':'work-batch-pending-summary-fix-postflight-v1','qualified':True,'summaryCaughtUp':True,'workBatchReady':True,
   'batchAuthority':self.authority,'tipHeight':973285,'tipHash':'f'*64,'summarySnapshotId':'fresh-summary',
   'summaryCoverage':{key:973285 for key in ('growthSummary','inceptionSummary','infinitySummary','logSummary','marketplaceSummary','tokenSummary','workFloor','workSummary')}}
  self.m={'format':a.FAMILY,'sourceCommit':self.commit,'sourceTree':self.tree,'releaseId':self.rid,'baselineHead':'3'*40,'baseSourceCommit':a.V6_SOURCE,
   'sourceMetadata':metadata,'dependencyMetadata':{},'dependencies':{},'restartConfigurationSha256':'6'*64,
   'gateway':{},'protectedServices':{},'services':['api','worker'],'sources':rows,'searchHold':{'markerSha256':'7'*64,'bindings':{'releaseId':self.rid,'attempt':'initial','files':{'fixture':'binding'}}},
   'patchProvenance':{'format':'fixture-provenance','candidateSha256':rows[0]['after']},
   'batchAuthority':self.authority,'acceptedInventorySha256':self.pin}
  self.plan={'format':'proof-of-work-work-batch-pending-summary-fix-rollout-plan-v1','sourceCommit':self.commit,'sourceTree':self.tree,'releaseId':self.rid,
   'releaseToolSha256':a.sha(b'release'),'rehearsalHelperSha256':a.sha(b'rehearsal'),
   'rolloutSupervisorSha256':a.sha(b'rollout'),'searchHoldControllerSha256':a.sha(b'holder'),
   'searchHoldControllerBase64':base64.b64encode(b'holder').decode(),
   'controllerSha256':a.sha(b'controller'),'controllerBase64':base64.b64encode(b'controller').decode(),'runtimeManifestTemplate':copy.deepcopy(self.m)}
  self.m['searchHold']['markerSha256']='8'*64
  self.r={key:copy.deepcopy(self.m[key])for key in ('format','sourceCommit','sourceTree','releaseId','baselineHead','baseSourceCommit','sourceMetadata','dependencyMetadata','restartConfigurationSha256','gateway','protectedServices','patchProvenance')}
  self.r.update(manifestSha256=a.sha(encode(self.m)),rollbackRoot=str(self.inner),installed=True,rolledBack=False,sourceWritesStarted=True,stopRequested=True,
   completedAt='2026-10-26T22:00:02+00:00',dependencyCount=0,
   servicesAfter={name:{'ActiveState':'active','MainPID':'123','WorkingDirectory':'/opt/proofofwork-api'}for name in self.m['services']},
   sources=[{key:value for key,value in row.items()if key!='base64'}for row in rows],createdHelpers=journal,
   postflight=copy.deepcopy(self.postflight))
  self.approval={'format':'work-batch-pending-summary-fix-runtime-archive-approval-v1','sourceCommit':self.commit,'sourceTree':self.tree,'releaseId':self.rid,
   'plan':{'path':str(self.root/'plan.json'),'sha256':a.sha(encode(self.plan))},'inner':{'path':str(self.inner),'manifestSha256':self.r['manifestSha256'],'receiptSha256':a.sha(encode(self.r))},
   'acceptedSha256':self.pin,'previousCompletion':copy.deepcopy(a.V6_COMPLETION),'heldSha256':a.HELD_SHA}
  families=[{'txid':tx,'height':height,'recipientCount':count,'parentCount':1,'childCount':count,'registryPaymentSats':546,'zeroFeeChildren':True,'minerFeeSats':546}
   for tx,height,count in [('b25e6ae7f963af289ba8cb3edae76ef285d3d124204a0e4cd514df0933938322',973284,12),
    ('69c1720dd6967e9ec035bbe56c5e0fe3b95a00ae721b8312d32f24a520b7b1d5',973567,7)]]
  pending={'txid':'8632e39f90e78df86c7bd998aa806b4cdeb9d4b179a0c41e253da0c3a3b84c43','state':'pending',
   'canonicalPendingTransfers':0,'canonicalPendingParents':0,'identityError':False,'inputCount':189,'uniqueKeys':189,'preservedCount':189,'confirmedFamily':None}
  result={'format':'work-batch-pending-summary-readonly-rehearsal-v1','knownConfirmedFamilies':families,'pendingHistoryProof':pending,
   'ok':True,'publicationAccountingCurrent':True,'published':False,'summaryKeys':sorted(self.postflight['summaryCoverage']),
   'indexedThroughBlock':973575,'indexedThroughBlockHash':'f'*64,'snapshotId':'b'*24}
  self.qualification={'format':'work-batch-pending-summary-rehearsal-qualified-v1','qualified':True,
   'planSha256':self.approval['plan']['sha256'],'sourceCommit':self.commit,'sourceTree':self.tree,'releaseId':self.rid,
   'candidateHashes':{row['path']:row['after']for row in rows},'dependencyHashes':{},
   'rehearsalHelperSha256':a.sha(b'rehearsal'),'adapterHashes':{name:a.sha(name.encode())for name in
    ('api.mjs','worker.mjs','reader.mjs','postgres.mjs','fetch-guard.mjs')},
   'dispatchSha256':'e'*64,'unit':'rehearsal.service','invocationId':'a'*32,
   'nativeProperties':{'LoadState':'loaded','InvocationID':'a'*32,'ExecMainStatus':'0','ExecMainCode':'1','Result':'success','ActiveState':'active','SubState':'exited','MainPID':'0','ProtectSystem':'strict','NoNewPrivileges':'yes','ReadWritePaths':'','User':'powadmin',
    'WorkingDirectory':'/opt/proofofwork-api','MemoryMax':str(2*1024**3),'MemorySwapMax':'0',
    'CPUQuotaPerSecUSec':'1s','RuntimeMaxUSec':'5min','TimeoutStopUSec':'15s','KillMode':'control-group','RemainAfterExit':'yes'},
   'result':{**result,'twoCalls':True,'calls':[copy.deepcopy(result),copy.deepcopy(result)]}}
  self.dispatch={'format':'proof-of-work-work-batch-pending-summary-fix-node-dispatch-receipt-v1',
   'dispatchStatus':'completed','phase':'overlay','exitCode':0,'planSha256':self.approval['plan']['sha256'],'releaseId':self.rid,
   'rehearsal':{'path':str(self.root/'qualification.json'),'sha256':a.sha(encode(self.qualification))},
   'stdout':json.dumps({'format':'proof-of-work-work-batch-pending-summary-fix-rollout-result-v1','releaseId':self.rid,
    'overlay':self.r,'searchRestore':{'ok':True,'phase':'restore',**self.m['searchHold']['bindings']}})}
  self.approval['dispatch']={'path':str(self.root/'outer-dispatch.json'),'sha256':a.sha(encode(self.dispatch))}
  self.controller={'toolHashes':{'release.py':a.sha(b'release'),'rehearsal.py':a.sha(b'rehearsal'),'rollout-node.py':a.sha(b'rollout'),'hold-node-timer.py':a.sha(b'holder')},
   'validate_rehearsal':self.check_rehearsal,'raw':b'controller' ,'validate_manifest':lambda m:None,'creation_identity':ident,
   'installed_source_fence':lambda *args:self.calls.append('source-fence'),'require_restart_configuration':lambda *args:self.calls.append('config-fence'),
   'require_postflight':lambda authority:copy.deepcopy(self.postflight),'validate_postflight':self.check_postflight}
  self.artifacts={name:name.encode()for name in a.REHEARSAL_EVIDENCE}
  self.qualification['evidenceReferences']={name:{'path':str(self.root/name),'sha256':a.sha(raw),'bytes':len(raw)}for name,raw in self.artifacts.items()}
  self.qualification['dispatchSha256']=a.sha(self.artifacts['dispatch.json'])
  self.qualification['stdoutSha256']=a.sha(self.artifacts['stdout'])
  self.refresh_execution_bindings()
  def read(path,expected=None,**kw):
   if path==a.HELD:return encode({'fixtureHeld':True})
   raw=Path(path).read_bytes();a.need(expected is None or a.sha(raw)==expected,'Fixture digest differs');return raw
  def save(path,raw):
   with Path(path).open('xb')as stream:stream.write(raw)
  self.engine={'BASE':self.base,'ROOT':self.runtime,'ACCEPTED':self.accepted,'read':read,'encode':encode,'save':save,'sync_dir':lambda *args:None,
   'identity':lambda s:(s.st_dev,s.st_ino,s.st_mode,s.st_uid,s.st_gid,s.st_size,s.st_mtime_ns,s.st_ctime_ns),
   'previous_archive':lambda *args:{'archiveSha256':a.V6_COMPLETION['archiveSha256']},'inventory':lambda *args:self.calls.append('inventory')}
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
 def check_rehearsal(self,value,pin,manifest,helper):
  spec=importlib.util.spec_from_file_location('fixture_rehearsal_controller',Path(__file__).with_name('scoped-node.py'))
  controller=importlib.util.module_from_spec(spec);spec.loader.exec_module(controller)
  self.calls.append('rehearsal')
  return controller.validate_rehearsal(value,pin,manifest,helper)
 def refresh_execution_bindings(self):
  ref={'path':str(self.root/'qualification.json'),'sha256':a.sha(encode(self.qualification))}
  self.m['rehearsal']={**ref,'planSha256':self.approval['plan']['sha256'],'helperSha256':a.sha(b'rehearsal')}
  self.r['rehearsal']=copy.deepcopy(self.m['rehearsal']);self.r['manifestSha256']=a.sha(encode(self.m))
  self.approval['inner']['manifestSha256']=self.r['manifestSha256'];self.approval['inner']['receiptSha256']=a.sha(encode(self.r))
  self.dispatch['rehearsal']=ref
  self.dispatch['stdout']=json.dumps({'format':'proof-of-work-work-batch-pending-summary-fix-rollout-result-v1',
   'releaseId':self.rid,'rehearsal':ref,'overlay':self.r,
   'searchRestore':{'ok':True,'phase':'restore',**self.m['searchHold']['bindings']}})
  self.approval['dispatch']['sha256']=a.sha(encode(self.dispatch))
 def bundle(self):return a.validate_bundle(self.approval,self.plan,self.m,self.r,self.controller,self.dispatch)
 def run_accept(self):
  for name,raw in self.artifacts.items():(self.root/name).write_bytes(raw)
  (self.root/'qualification.json').write_bytes(encode(self.qualification))
  Path(self.approval['dispatch']['path']).write_bytes(encode(self.dispatch))
  (self.inner/'manifest.json').write_bytes(encode(self.m));(self.inner/'receipt.json').write_bytes(encode(self.r));self.approval['inner']['receiptSha256']=a.sha(encode(self.r))
  reference=self.root/'approval.json';reference.write_bytes(encode(self.approval));Path(self.approval['plan']['path']).write_bytes(encode(self.plan))
  with patch.object(a.subprocess,'check_output',return_value=b''):
   return a.acceptance(self.engine,self.controller,self.approval,self.plan,{'path':str(reference),'sha256':a.sha(reference.read_bytes())})(None,self.custody,self.verify)
 def actual(self,name):
  p=self.runtime/name;s=p.lstat();return {'sha256':a.sha(p.read_bytes()),'metadata':{'uid':s.st_uid,'gid':s.st_gid,'mode':stat.S_IMODE(s.st_mode)},'identity':ident(s)}
 def test_exact_approval_and_bundle(self):a.validate_approval(self.approval);self.assertEqual(set(self.bundle()),a.TARGETS)
 def test_fixed_creation_and_existing_scope(self):self.assertEqual(len(a.NEW),0);self.assertEqual(a.TARGETS,{'server/proof-api.mjs'})
 def test_success_preserves_untouched_overlays_and_all_original_evidence(self):
  self.run_accept();result=json.loads(self.accepted.read_bytes())
  self.assertEqual(next(row for row in result['overlays']if row['path']=='server/unchanged-overlay.mjs'),self.accepted_value['overlays'][-1])
  self.assertEqual(json.loads((self.custody/'source-overlays-before.json').read_bytes()),self.accepted_value)
  self.assertLess(self.calls.index('inventory'),self.calls.index('verify-candidate'))
  self.assertEqual(self.calls.count('source-fence'),2)
  for row in result['overlays']:
   if row['path']in a.TARGETS:
    self.assertEqual(len(row['evidence']),16)
    self.assertTrue(all(self.base in Path(item['path']).parents for item in row['evidence']))
  mapping=json.loads((self.custody/'evidence-origins.json').read_bytes())
  self.assertEqual(len(mapping['copies']),13)
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
   with self.subTest(key=key),self.assertRaises(ValueError):a.extend_inventory(self.m,self.r,data,[],self.actual)
 def test_api_missing_from_accepted_inventory_refuses_even_with_baseline(self):
  data=copy.deepcopy(self.accepted_value);data['overlays'].pop(0)
  with self.assertRaisesRegex(ValueError,'Accepted V6 API'):
   a.extend_inventory(self.m,self.r,data,[],self.actual)
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
 def test_approval_requires_exact_v6_lifecycle(self):
  for key,value in [('acceptedSha256','0'*64),('previousCompletion',{**a.V6_COMPLETION,'sha256':'0'*64})]:
   approval=copy.deepcopy(self.approval);approval[key]=value
   with self.subTest(key=key),self.assertRaisesRegex(ValueError,'V6 acceptance lifecycle'):a.validate_approval(approval)
 def test_committed_rollout_and_holder_pins_required(self):
  for key in ('rolloutSupervisorSha256','searchHoldControllerSha256'):
   original=self.plan[key];self.plan[key]='0'*64
   with self.subTest(key=key),self.assertRaisesRegex(ValueError,'helper differs'):self.bundle()
   self.plan[key]=original
 def test_holder_bytes_cannot_differ_from_committed_pin(self):
  self.plan['searchHoldControllerBase64']=base64.b64encode(b'foreign').decode()
  with self.assertRaisesRegex(ValueError,'helper differs'):self.bundle()
 def test_patch_provenance_must_survive_in_receipt(self):
  self.r['patchProvenance']['candidateSha256']='0'*64
  with self.assertRaisesRegex(ValueError,'patchProvenance'):self.bundle()
 def test_manifest_cannot_admit_another_v6_api_hash(self):
  self.m['sources'][0]['before']='0'*64
  self.plan['runtimeManifestTemplate']=copy.deepcopy(self.m);self.plan['runtimeManifestTemplate'].pop('rehearsal')
  self.r['sources'][0]['before']='0'*64
  with self.assertRaisesRegex(ValueError,'V6 API baseline'):self.bundle()
 def test_pending_or_failed_outer_is_not_archive_authority(self):
  for key,value in [('exitCode',1),('exitCode',None),('exitCode',False),('dispatchStatus','uncertain-interruption'),
      ('planSha256','0'*64),('phase','capture'),('errorClass','TimeoutError')]:
   dispatch={**self.dispatch,key:value}
   with self.subTest(key=key,value=value),self.assertRaisesRegex(ValueError,'dispatcher'):
    a.validate_dispatch(self.approval,self.m,self.r,dispatch)
 def test_missing_or_wrong_actual_inner_in_outer_refuses(self):
  for changed in ({}, {**self.r,'installed':False}):
   outcome=json.loads(self.dispatch['stdout']);outcome['overlay']=changed
   dispatch={**self.dispatch,'stdout':json.dumps(outcome)}
   with self.assertRaisesRegex(ValueError,'restoration'):a.validate_dispatch(self.approval,self.m,self.r,dispatch)
 def test_search_restore_failure_foreign_scope_and_deferred_refuse(self):
  for field,value in [('ok',False),('phase','hold'),('releaseId','foreign'),('files',{})]:
   outcome=json.loads(self.dispatch['stdout']);outcome['searchRestore'][field]=value
   with self.subTest(field=field),self.assertRaisesRegex(ValueError,'restoration'):
    a.validate_dispatch(self.approval,self.m,self.r,{**self.dispatch,'stdout':json.dumps(outcome)})
  outcome=json.loads(self.dispatch['stdout']);outcome['searchRestoreDeferred']=False
  with self.assertRaisesRegex(ValueError,'restoration'):
   a.validate_dispatch(self.approval,self.m,self.r,{**self.dispatch,'stdout':json.dumps(outcome)})
 def test_missing_rehearsal_refuses(self):
  dispatch=copy.deepcopy(self.dispatch);dispatch.pop('rehearsal')
  with self.assertRaisesRegex(ValueError,'rehearsal'):a.validate_dispatch(self.approval,self.m,self.r,dispatch)
 def test_failed_rehearsal_cannot_change_accepted_inventory(self):
  self.qualification['result']['publicationAccountingCurrent']=False;self.refresh_execution_bindings()
  with self.assertRaisesRegex(ValueError,'two-call rehearsal'):self.run_accept()
  self.assertEqual(a.sha(self.accepted.read_bytes()),self.pin)
 def test_published_rehearsal_cannot_change_accepted_inventory(self):
  self.qualification['result']['published']=True;self.refresh_execution_bindings()
  with self.assertRaisesRegex(ValueError,'two-call rehearsal'):self.run_accept()
  self.assertEqual(a.sha(self.accepted.read_bytes()),self.pin)
 def test_rehearsal_candidate_drift_refuses(self):
  self.qualification['candidateHashes']['server/proof-api.mjs']='0'*64;self.refresh_execution_bindings()
  with self.assertRaisesRegex(ValueError,'candidate closure'):self.run_accept()
  self.assertEqual(a.sha(self.accepted.read_bytes()),self.pin)
 def test_rehearsal_evidence_drift_refuses(self):
  original=self.verify
  def verify(**kw):
   (self.root/'qualification.json').write_bytes(b'foreign');return original(**kw)
  self.verify=verify
  with self.assertRaisesRegex(ValueError,'digest differs'):self.run_accept()
  self.assertEqual(a.sha(self.accepted.read_bytes()),self.pin)
 def test_scope_cannot_add_mail_reader_worker_or_new_file(self):
  for name in ('server/work-mail-batch-runtime.mjs','server/db/proof-index-reader.mjs','scripts/backfill-proof-indexer.mjs'):
   rows=copy.deepcopy(self.m['sources']);rows[0]['path']=name
   with self.subTest(name=name),self.assertRaisesRegex(ValueError,'scope'):a.rows_by_path(rows)
 def test_exact_source_tree_required_at_all_layers(self):
  for layer in (self.plan,self.m,self.r):
   saved=layer['sourceTree'];layer['sourceTree']='0'*40
   with self.assertRaises(ValueError):self.bundle()
   layer['sourceTree']=saved
 def test_manifest_and_receipt_rehearsal_binding_cannot_differ(self):
  for layer in (self.m,self.r):
   original=copy.deepcopy(layer['rehearsal']);layer['rehearsal']['sha256']='0'*64
   with self.assertRaises(ValueError):self.bundle()
   layer['rehearsal']=original
 def test_outcome_must_bind_same_rehearsal(self):
  outcome=json.loads(self.dispatch['stdout']);outcome['rehearsal']['sha256']='0'*64
  with self.assertRaisesRegex(ValueError,'restoration'):
   a.validate_dispatch(self.approval,self.m,self.r,{**self.dispatch,'stdout':json.dumps(outcome)})
 def test_two_rehearsal_calls_must_share_checkpoint(self):
  self.qualification['result']['calls'][1]['indexedThroughBlock']=973576;self.refresh_execution_bindings()
  with self.assertRaisesRegex(ValueError,'checkpoint'):self.run_accept()
  self.assertEqual(a.sha(self.accepted.read_bytes()),self.pin)
 def test_all_rehearsal_artifacts_must_be_retained(self):
  self.qualification['evidenceReferences'].pop('stderr');self.refresh_execution_bindings()
  with self.assertRaisesRegex(ValueError,'physical rehearsal'):self.run_accept()
  self.assertEqual(a.sha(self.accepted.read_bytes()),self.pin)
 def test_rehearsal_artifact_cannot_escape_its_exact_directory(self):
  self.qualification['evidenceReferences']['stderr']['path']=str(self.root/'other');self.refresh_execution_bindings()
  with self.assertRaisesRegex(ValueError,'physical rehearsal reference'):self.run_accept()
 def test_rehearsal_artifact_length_refuses(self):
  self.qualification['evidenceReferences']['stderr']['bytes']+=1;self.refresh_execution_bindings()
  with self.assertRaisesRegex(ValueError,'artifact size'):self.run_accept()
 def test_rehearsal_artifact_binding_refuses(self):
  self.qualification['adapterHashes']['worker.mjs']='0'*64;self.refresh_execution_bindings()
  with self.assertRaisesRegex(ValueError,'Adapter evidence digest'):self.run_accept()
 def test_native_rehearsal_dispatch_bytes_drift_refuses(self):
  self.artifacts['dispatch.json']=b'changed'
  with self.assertRaisesRegex(ValueError,'digest differs'):self.run_accept()
  self.assertEqual(a.sha(self.accepted.read_bytes()),self.pin)
 def test_rehearsal_origin_file_drift_after_verification_refuses(self):
  original=self.verify
  def verify(**kw):
   (self.root/'worker.mjs').write_bytes(b'changed');return original(**kw)
  self.verify=verify
  with self.assertRaisesRegex(ValueError,'digest differs'):self.run_accept()
  self.assertEqual(a.sha(self.accepted.read_bytes()),self.pin)
 def test_rehearsal_retained_copy_drift_after_verification_refuses(self):
  original=self.verify
  def verify(**kw):
   (self.custody/'rehearsal-stdout').write_bytes(b'changed');return original(**kw)
  self.verify=verify
  with self.assertRaisesRegex(ValueError,'digest differs'):self.run_accept()
  self.assertEqual(a.sha(self.accepted.read_bytes()),self.pin)
 def test_fake_native_success_is_not_archive_authority(self):
  self.qualification['nativeProperties']['Result']='timeout';self.refresh_execution_bindings()
  with self.assertRaisesRegex(ValueError,'native terminal'):self.run_accept()
  self.assertEqual(a.sha(self.accepted.read_bytes()),self.pin)
 def test_missing_confirmed_family_refuses_archive_acceptance(self):
  self.qualification['result']['calls'][0]['knownConfirmedFamilies'].pop();self.refresh_execution_bindings()
  with self.assertRaisesRegex(ValueError,'confirmed families'):self.run_accept()
  self.assertEqual(a.sha(self.accepted.read_bytes()),self.pin)
 def test_positive_confirmed_child_fee_proof_refuses(self):
  self.qualification['result']['calls'][0]['knownConfirmedFamilies'][0]['zeroFeeChildren']=False;self.refresh_execution_bindings()
  with self.assertRaisesRegex(ValueError,'economic family'):self.run_accept()
  self.assertEqual(a.sha(self.accepted.read_bytes()),self.pin)
 def test_pending_recipient_collapse_refuses_archive_acceptance(self):
  self.qualification['result']['calls'][0]['pendingHistoryProof']['preservedCount']=1;self.refresh_execution_bindings()
  with self.assertRaisesRegex(ValueError,'Pending visibility'):self.run_accept()
  self.assertEqual(a.sha(self.accepted.read_bytes()),self.pin)
 def test_pending_canonical_contamination_refuses_archive_acceptance(self):
  self.qualification['result']['calls'][0]['pendingHistoryProof']['canonicalPendingTransfers']=189;self.refresh_execution_bindings()
  with self.assertRaisesRegex(ValueError,'Pending visibility'):self.run_accept()
  self.assertEqual(a.sha(self.accepted.read_bytes()),self.pin)
if __name__=='__main__':unittest.main()
