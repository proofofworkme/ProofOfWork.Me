#!/usr/bin/python3 -I -B
"""Local-only proposed-controller tests. No native request, human receipt or DB writes."""
import base64,copy,datetime,fcntl,hashlib,importlib.util,io,json,os,stat,tempfile,types,unittest
from pathlib import Path
from unittest.mock import patch
from contextlib import ExitStack
SOURCE=Path('/tmp/pow-audit30-production-sixteen-root-control-v3.py')
spec=importlib.util.spec_from_file_location('candidate_root',SOURCE);M=importlib.util.module_from_spec(spec);spec.loader.exec_module(M)
FILES={'native-caller.mjs':'/tmp/pow-audit30-production-sixteen-native-caller-v2.mjs','pow-audit30-production-sixteen-adapter-v2.mjs':'/tmp/pow-audit30-production-sixteen-adapter-v2.mjs','pow-audit30-production-sixteen-approval-binding-v2.mjs':'/tmp/pow-audit30-production-sixteen-approval-binding-v2.mjs','pow-audit30-private-sixteen-commit-inverse-adapter-v1.mjs':'/tmp/pow-audit30-private-sixteen-commit-inverse-adapter-v1.mjs','writer-template.mjs':'/tmp/pow-audit30-mail-body-exact-sixteen-write-candidate-v1.mjs'}
def request():
 # Only source bytes are real. Authority references are deliberately nonexistent.
 return dict(schema='pow-audit30-production-sixteen-root-request-v1',rootControlSHA256='9'*64,mode='prepare',runId='20261003T080000Z',operation='apply',captureHelperBase64=base64.b64encode(Path('/tmp/pow-audit30-private-sixteen-bootstrap-v2.py').read_bytes()).decode(),guardBase64=base64.b64encode(Path('/tmp/pow-audit30-worker-mail-exclusion-guard-v3.py').read_bytes()).decode(),sourcesBase64={n:base64.b64encode(Path(p).read_bytes()).decode()for n,p in FILES.items()},approval=dict(path='/data/proofofwork-release-backups/audit30-mail-body-authority-20261003T080000Z/human-approval.json',sha256='a'*64),privateProof=dict(path=str(M.PRIVATE_PROOF),sha256='b'*64),projection=dict(path=str(M.PROJECTION),sha256='c'*64),priorApply=None)
def result(v,p,w):return dict(schema='pow-audit30-production-exact-sixteen-native-completed-v1',status='committed',operation=v['operation'],approvalReceiptSHA256=v['approval']['sha256'],generatedWriterSHA256=p['generatedWriterSHA256'],manifestSHA256=M.MANIFEST_SHA,targetCount=16,acknowledgedReceiptSHA256='d'*64,workerBeforeReceiptSHA256=w,readinessInvalidationPerCommittedTransaction=1,operationalEpochRewind=False,automaticInverse=False,automaticRetry=False,productionDataMutation=True,rootPostCoreWorkerObservationStillRequired=True)
class Guards(unittest.TestCase):
 def test_only_projection_authority_path_changed(self):
  old=Path('/tmp/pow-audit30-production-sixteen-root-control-v2.py').read_text();self.assertEqual(SOURCE.read_text().replace('focused-mail-projection-v5/completed.json','focused-mail-projection-v4/completed.json'),old);self.assertIn('focused-mail-projection-v5/completed.json',str(M.PROJECTION))
 def test_prior_projection_receipt_path_refused(self):
  v=request();v['projection']['path']=v['projection']['path'].replace('focused-mail-projection-v5/','focused-mail-projection-v4/')
  with self.assertRaisesRegex(ValueError,'EXACT_PRIVATE_AND_FOCUSED_PROOF_PATHS'):M.decode(v)
 def test_exact_source_request(self):
  h,g,code=M.decode(request());self.assertEqual(hashlib.sha256(h).hexdigest(),M.CAPTURE_SHA);self.assertEqual(hashlib.sha256(g).hexdigest(),M.GUARD_SHA);self.assertEqual(set(code),set(M.PINS))
 def test_dependency_bridge_uses_actual_accounting_package_and_definitions_only(self):
  calls=[]
  raw=b"def load():calls.append('load')\ndef completed_lineage():calls.append('lineage');return {'lineage':'validated'}\nclass C:\n @staticmethod\n def package(v):calls.append(('package',v));return ('original172',None,None)\ndef proof_result(*a):raise AssertionError('failed-original verifier must not execute')\ndef execute(*a):raise AssertionError('private writer must not execute')\n"
  original_exec=__builtins__['exec']if isinstance(__builtins__,dict)else __builtins__.exec
  def run(code,env):env['calls']=calls;return original_exec(code,env)
  with patch.object(M,'read',return_value=(raw,{}))as rd,patch('builtins.exec',side_effect=run):m,original=M.dependency_context()
  self.assertEqual(original,'original172');self.assertEqual(calls,['load','lineage',('package',{'lineage':'validated'})]);self.assertEqual(rd.call_args.args[0],Path('/usr/local/lib/proofofwork-audit30-private-sixteen/20261003T074500Z/controller.py'));self.assertEqual(rd.call_args.args[1],'b1f10c63ac7e0de179215993529708e082073b0fd25bd6d36a4a7200870d4544')
 def test_new_proof_path_and_generator_match_successor(self):
  self.assertEqual(str(M.PRIVATE_PROOF),'/data/proofofwork-audit30-inspect-20261003T014100Z/exact-sixteen-readonly-finalization-v1/completed.json');self.assertIn('pow-audit30-production-sixteen-adapter-v2.mjs',M.GENERATOR);self.assertIn(M.PINS['pow-audit30-production-sixteen-adapter-v2.mjs'],M.GENERATOR);self.assertNotIn('proof_result(',M.dependency_context.__code__.co_names)
 def test_no_real_authority_materialized(self):
  self.assertFalse(Path(request()['approval']['path']).exists());self.assertFalse(Path(request()['privateProof']['path']).exists())
 def test_extra_operation_key_refused(self):
  v=request();v['automaticInverse']=True
  with self.assertRaisesRegex(ValueError,'TYPED_EXPLICIT_OPERATION'):M.decode(v)
 def test_tampered_code_refused(self):
  v=request();v['sourcesBase64']['native-caller.mjs']=base64.b64encode(b'not the reviewed source').decode()
  with self.assertRaisesRegex(ValueError,'SOURCE_BYTES_PIN'):M.decode(v)
 def test_missing_dependency_source_refused(self):
  v=request();del v['sourcesBase64']['writer-template.mjs']
  with self.assertRaisesRegex(ValueError,'EXACT_CODE_MEMBERS'):M.decode(v)
 def test_calendar_scope_refused(self):
  v=request();v['runId']='20260230T080000Z'
  with self.assertRaises(ValueError):M.decode(v)
 def test_inverse_requires_explicit_acknowledged_apply(self):
  v=request();v['operation']='inverse'
  with self.assertRaisesRegex(ValueError,'EXPLICIT_INVERSE'):M.decode(v)
  v['priorApply']=dict(path='/data/proofofwork-release-backups/audit30-mail-body-production-20261003T075000Z-apply/completed.json',sha256='d'*64);M.decode(v)
 def test_apply_cannot_carry_inverse_receipt(self):
  v=request();v['priorApply']=dict(path='/arbitrary',sha256='d'*64)
  with self.assertRaisesRegex(ValueError,'EXPLICIT_INVERSE'):M.decode(v)
 def test_private_proof_cannot_come_from_other_clone(self):
  v=request();v['privateProof']['path']=str(M.PRIVATE_PROOF).replace('014100','071500')
  with self.assertRaisesRegex(ValueError,'EXACT_PRIVATE'):M.decode(v)
 def test_duplicate_json_refused(self):
  with self.assertRaisesRegex(ValueError,'DUPLICATE_JSON_KEY'):M.json_read(b'{"operation":"apply","operation":"inverse"}')
 def test_prepared_record_cannot_change_approval_or_operation(self):
  v=request();old=copy.deepcopy(v);v['mode']='run';p=dict(schema='pow-audit30-production-sixteen-package-prepared-v1',pgEntrySHA256='d'*64,generatedWriterSHA256='e'*64,approvalSHA256=v['approval']['sha256'],operation='apply',productionUnitLaunched=False);pkg=M.BASE/v['runId']
  def immutable(path,*a):return M.encoded(p if path.name=='prepared.json'else old),{}
  with patch.object(M.Path,'resolve',lambda p,strict=True:p),patch.object(M,'meta',return_value=dict(uid=0,gid=112,mode=0o750)),patch.object(M,'immutable',side_effect=immutable):
   self.assertEqual(M.prepared_read(pkg,v),p);old['approval']['sha256']='0'*64
   with self.assertRaisesRegex(ValueError,'EXACT_PREPARED'):M.prepared_read(pkg,v)
 def test_prepared_record_cannot_represent_already_launched_unit(self):
  v=request();old=copy.deepcopy(v);v['mode']='run';p=dict(schema='pow-audit30-production-sixteen-package-prepared-v1',pgEntrySHA256='d'*64,generatedWriterSHA256='e'*64,approvalSHA256=v['approval']['sha256'],operation='apply',productionUnitLaunched=True);pkg=M.BASE/v['runId']
  with patch.object(M.Path,'resolve',lambda p,strict=True:p),patch.object(M,'meta',return_value=dict(uid=0,gid=112,mode=0o750)),patch.object(M,'immutable',side_effect=lambda path,*a:(M.encoded(p if path.name=='prepared.json'else old),{})):
   with self.assertRaisesRegex(ValueError,'PREPARED_RECORD_SHAPE'):M.prepared_read(pkg,v)
 def test_native_result_binds_action_and_fence(self):
  v=request();p={'generatedWriterSHA256':'e'*64};r=result(v,p,'f'*64);self.assertEqual(M.native_result(v,p,r,'f'*64),r)
  for key,new in [('operation','inverse'),('workerBeforeReceiptSHA256','0'*64),('manifestSHA256','0'*64),('readinessInvalidationPerCommittedTransaction',2),('targetCount',16.0),('automaticInverse',True),('rootPostCoreWorkerObservationStillRequired',False)]:
   with self.subTest(key=key),self.assertRaisesRegex(ValueError,'EXACT_ACKNOWLEDGED'):M.native_result(v,p,r|{key:new},'f'*64)
 def test_unit_uses_exact_single_operation_and_clean_environment(self):
  v=request();pkg=M.BASE/v['runId'];e=M.BACKUPS/('audit30-mail-body-production-'+v['runId']+'-apply');unit,cmd,argv=M.command(v,pkg,e,'d'*64,'e'*64);self.assertEqual(argv[-2:],['apply','none']);self.assertEqual(argv[0:2],['/usr/bin/env','-i']);self.assertIn('--uid=postgres',cmd);self.assertIn('--gid=postgres',cmd);self.assertEqual(cmd[-len(argv):],argv);props=M.properties(pkg,e);self.assertEqual(props['RuntimeMaxSec'],'120s');self.assertEqual(props['CapabilityBoundingSet'],'');self.assertEqual(props['ReadWritePaths'],str(e));self.assertNotIn('/var/lib/postgresql',props['ReadWritePaths']);self.assertNotIn('/run/postgresql',props['InaccessiblePaths']);self.assertIn('LD_PRELOAD',props['UnsetEnvironment']);self.assertIn('PGPASSWORD',props['UnsetEnvironment'])
 def test_original_five_replacement_refused(self):
  units={'bitcoind.service':('1324302','64e1fa7be2e2442d8c7f5763f60b85fb'),'electrs.service':('1324320','72418b1c7ab245e4a37685ed868a1084'),'postgresql@16-main.service':('1537429','e0bf545f0ad944e89fe1005577e61b9c'),'proofofwork-api.service':('2103747','208f8bcbecc54afbb7166754f12065c2'),'proofofwork-indexer-worker.service':('2103760','33b3ee25490749db89e0d55fd29d0afb')}
  def state(u):return {'ActiveState':'inactive','MainPID':'0'}if u not in units else dict(ActiveState='active',MainPID=units[u][0],InvocationID=units[u][1])
  g=types.SimpleNamespace(state=state);self.assertEqual(len(M.baseline(g)),5);units['proofofwork-api.service']=('2103747','0'*32)
  with self.assertRaisesRegex(ValueError,'ORIGINAL_LIVE_FIVE_CHANGED'):M.baseline(g)
 def test_backup_active_refused(self):
  with patch.object(M,'state',return_value={'ActiveState':'active','MainPID':'123','InvocationID':'1'*32}):
   with self.assertRaises(ValueError):M.baseline(None)
 def test_backup_window_does_not_mask_or_delay_timer(self):
  g=types.SimpleNamespace(state=lambda u:dict(ActiveState='active',SubState='waiting'));s=(datetime.datetime.now(datetime.timezone.utc)+datetime.timedelta(seconds=900)).strftime('%a %Y-%m-%d %H:%M:%S UTC');r=types.SimpleNamespace(returncode=0,stdout=s.encode(),stderr=b'')
  with patch.object(M.subprocess,'run',return_value=r)as call:M.backup_window(g);self.assertEqual(call.call_args.args[0][:2],['/usr/bin/systemctl','show'])
  r.stdout=(datetime.datetime.now(datetime.timezone.utc)+datetime.timedelta(seconds=100)).strftime('%a %Y-%m-%d %H:%M:%S UTC').encode()
  with patch.object(M.subprocess,'run',return_value=r),self.assertRaisesRegex(ValueError,'BACKUP_WINDOW_TOO_SHORT'):M.backup_window(g)
class RealFilesystem(unittest.TestCase):
 def setUp(self):self.t=tempfile.TemporaryDirectory();self.d=Path(self.t.name)
 def tearDown(self):self.t.cleanup()
 def file(self,name,raw=b'public fixture'):
  p=self.d/name;p.write_bytes(raw);p.chmod(0o600);return p
 def test_real_bounded_read_and_atime_change_allowed(self):
  p=self.file('input');os.utime(p,ns=(1,p.stat().st_mtime_ns));raw,m=M.read(p,M.sha(p.read_bytes()),100,os.getuid(),os.getgid(),0o600);self.assertEqual(raw,b'public fixture');self.assertNotIn('atimeNs',m)
 def test_real_symlink_and_hardlink_refused(self):
  p=self.file('input');s=self.d/'link';s.symlink_to(p)
  with self.assertRaisesRegex(ValueError,'CANONICAL_INPUT'):M.read(s,M.sha(p.read_bytes()),100,os.getuid(),os.getgid(),0o600)
  os.link(p,self.d/'hard')
  with self.assertRaisesRegex(ValueError,'IMMUTABLE_INPUT_SHAPE'):M.read(p,M.sha(p.read_bytes()),100,os.getuid(),os.getgid(),0o600)
 def test_real_digest_and_size_refuse(self):
  p=self.file('input')
  with self.assertRaisesRegex(ValueError,'INPUT_BYTES_CHANGED'):M.read(p,'0'*64,100,os.getuid(),os.getgid(),0o600)
  with self.assertRaisesRegex(ValueError,'IMMUTABLE_INPUT_SHAPE'):M.read(p,M.sha(p.read_bytes()),1,os.getuid(),os.getgid(),0o600)
 def test_real_group_write_refused(self):
  p=self.file('input');p.chmod(0o660)
  with self.assertRaisesRegex(ValueError,'IMMUTABLE_INPUT_SHAPE'):M.read(p,M.sha(p.read_bytes()),100,os.getuid(),os.getgid(),0o600)
 def test_content_replacement_during_read_refused(self):
  p=self.file('input');original=os.fstat;n=0
  def fstat(fd):
   nonlocal n
   n+=1
   if n==2:p.write_bytes(b'replacement text')
   return original(fd)
  with patch.object(M.os,'fstat',side_effect=fstat),self.assertRaisesRegex(ValueError,'INPUT_READ_CHANGED'):M.read(p,M.sha(p.read_bytes()),100,os.getuid(),os.getgid(),0o600)
 def test_lock_replacement_after_flock_refuses_and_closes_fd(self):
  p=self.file('ops');real_meta=M.meta;real_fstat=M.os.fstat;closed=[];actual_close=os.close;flock=fcntl.flock
  def adjusted(p):m=real_meta(p);return m|{'uid':0,'gid':0}
  def adjusted_s(s):return M.smeta(s)|{'uid':0,'gid':0}
  def swap(fd,flags):flock(fd,flags);p.unlink();self.file('ops',b'changed')
  def close(fd):closed.append(fd);actual_close(fd)
  original_smeta=M.smeta
  with patch.object(M,'OPS_LOCK',p),patch.object(M,'meta',side_effect=adjusted),patch.object(M,'smeta',side_effect=lambda s:original_smeta(s)|{'uid':0,'gid':0}),patch.object(M.fcntl,'flock',side_effect=swap),patch.object(M.os,'close',side_effect=close):
   with self.assertRaisesRegex(ValueError,'OPS_LOCK_REPLACED_AFTER_FLOCK'):M.acquire_ops()
  self.assertEqual(len(closed),1)
 def test_existing_lock_content_is_never_modified(self):
  p=self.file('ops');old=p.read_bytes();real_meta=M.meta;original_smeta=M.smeta
  with patch.object(M,'OPS_LOCK',p),patch.object(M,'meta',side_effect=lambda p:real_meta(p)|{'uid':0,'gid':0}),patch.object(M,'smeta',side_effect=lambda s:original_smeta(s)|{'uid':0,'gid':0}):fd=M.acquire_ops();os.close(fd)
  self.assertEqual(p.read_bytes(),old)
class RootSequence(unittest.TestCase):
 def flow(self,fail=None):
  v=request();v['mode']='run';pkg=M.BASE/v['runId'];events=[];records={};prepared=dict(pgEntrySHA256='d'*64,generatedWriterSHA256='e'*64);nodeResult={};g=types.SimpleNamespace()
  def execute(rid):
   events.append(('guard',rid))
   if fail=='after-guard'and len([e for e in events if e[0]=='guard'])==2:raise ValueError('AFTER_GUARD_REFUSED')
   return dict(atUtc='test',ok=True)
  g.execute=execute
  class B:
   @staticmethod
   def capacity(v):events.append(('capacity',v))
   @staticmethod
   def unit_new(u):events.append(('unit-new',u))
   @staticmethod
   def newdir(p,*a):events.append(('new-evidence',str(p)))
   @staticmethod
   def record(p,v):records[p.name]=v;events.append(('record',p.name))
   @staticmethod
   def create(p,raw,*a):events.append(('worker-proof',p.name));nodeResult.update(result(v,prepared,M.sha(raw)))
   @staticmethod
   def capture_unit(*a):
    events.append(('capture',a[2]))
    if fail=='capture':raise InterruptedError('owned mock refusal')
    return dict(unitStoppedAtEndpoint=True)
  def read(p,*a,**k):return b'{}',{'fixture':str(p)}
  def immutable(p,*a,**k):return M.encoded(nodeResult),{'fixture':str(p)}
  originalenv=dict(os.environ)
  patches=[patch.object(M,'ROOT_SOURCE_SHA256','9'*64),patch.object(M.sys,'stdin',types.SimpleNamespace(buffer=io.BytesIO(M.encoded(v)))),patch.object(M.os,'getuid',return_value=0),patch.object(M.os,'geteuid',return_value=0),patch.object(M.os,'getgid',return_value=0),patch.object(M.os,'getegid',return_value=0),patch.object(M.os,'uname',return_value=types.SimpleNamespace(nodename='pow-bitcoin-01')),patch.object(M.pwd,'getpwnam',return_value=types.SimpleNamespace(pw_uid=108,pw_gid=112)),patch.object(M,'helper_module',return_value=B),patch.object(M,'guard_module',return_value=g),patch.object(M,'read',side_effect=read),patch.object(M,'immutable',side_effect=immutable),patch.object(M,'baseline',return_value={'same':'five'}),patch.object(M,'backup_window',return_value='future'),patch.object(M.Path,'resolve',lambda p,strict=True:p),patch.object(M,'meta',return_value=dict(uid=0,gid=0,mode=0o700)),patch.object(M,'prepared_read',return_value=prepared),patch.object(M,'package_fence',side_effect=lambda *a:events.append(('source-fence','same'))),patch.object(M.os.path,'lexists',return_value=False),patch.object(M,'acquire_ops',return_value=987),patch.object(M.os,'close',side_effect=lambda fd:events.append(('close',fd))),patch.object(M.signal,'signal',side_effect=lambda *a:events.append(('mask-signal',a[0]))),patch.dict(M.os.environ,originalenv,clear=True),patch('sys.stdout',new=io.StringIO())]
  with ExitStack() as stack:
   for item in patches:stack.enter_context(item)
   if fail:
    with self.assertRaises((ValueError,InterruptedError)):M.main()
   else:M.main()
  return events,records
 def test_one_guard_native_one_guard_order_and_no_inverse(self):
  e,r=self.flow();selected=[x[0]for x in e if x[0]in('guard','capture')];self.assertEqual(selected,['guard','capture','guard']);self.assertEqual(r['root-completed.json']['operation'],'apply');self.assertTrue(r['root-completed.json']['strictRerunStillRequired']);self.assertFalse(r['root-completed.json']['automaticInverse']);self.assertEqual(e[-1],('close',987))
 def test_capture_failure_keeps_failure_and_does_not_retry(self):
  e,r=self.flow('capture');self.assertEqual(len([x for x in e if x[0]=='capture']),1);self.assertEqual(len([x for x in e if x[0]=='guard']),1);self.assertTrue(r['root-failed.json']['productionCommitOutcomeMustBeReconciled']);self.assertNotIn('root-completed.json',r);self.assertEqual(len([x for x in e if x[0]=='mask-signal']),3);self.assertEqual(e[-1],('close',987))
 def test_acknowledged_commit_then_after_guard_refusal_is_reconciliation_not_retry(self):
  e,r=self.flow('after-guard');self.assertEqual(len([x for x in e if x[0]=='capture']),1);self.assertNotIn('root-completed.json',r);self.assertFalse(r['root-failed.json']['automaticRetry']);self.assertFalse(r['root-failed.json']['automaticInverse']);self.assertEqual(e[-1],('close',987))
if __name__=='__main__':unittest.main()
