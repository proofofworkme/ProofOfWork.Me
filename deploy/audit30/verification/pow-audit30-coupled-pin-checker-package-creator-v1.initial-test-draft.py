#!/usr/bin/python3 -I
"""Synthetic in-memory authority and temporary user-owned filesystem fixtures.
These fixtures are not an actual human approval or native package admission.
"""
import ast,base64,copy,datetime,hashlib,importlib.util,json,os,signal,stat,subprocess,sys,tempfile,threading,time,types,unittest
from pathlib import Path
from unittest.mock import patch
SOURCE=Path('/tmp/pow-audit30-coupled-pin-checker-package-creator-v1.py')
def imported(name,path):
 spec=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
P=imported('creator',SOURCE)
IP=Path('/home/sixer/ProofOfWork.Me/deploy/audit30/install-retention.py')
I=imported('exact_installer',IP)
def request():
 plan=json.loads(Path('/tmp/pow-audit30-coupled-pin-checker-observed-review-plan-v6.json').read_bytes());message=b'SYNTHETIC LOCAL TEST ONLY; no actual human authority.'
 approval=dict(schema='pow-audit30-coupled-pin-checker-direct-human-approval-v1',status='approved',approvalSource='direct-human',operation='exact-coupled-pin-checker-promotion',callerSha256=P.CONTROLLER_SHA,scopeSha256=plan['reviewedScopeSha256'],humanApprovalSourceSha256=P.sha(message),approvedAtUtc=datetime.datetime.now(datetime.timezone.utc).isoformat(),replacements=[dict(path='/etc/proofofwork-postgres-logical-backup.pins',oldSha256='821b5bbfecee75ffb3c4565d3867eb62ac33e65eeb83c0e603c08aa478ff957b',newSha256='22f66cac8419985c544d4b41c6ea9cd400fc99805c588694a9a619a3f120d09b',mode=0o644,uid=0,gid=0),dict(path='/usr/local/sbin/proofofwork-retention-protection',oldSha256='da5d1336ce857acc571ba0849c2b0150ef5fc6dfdacf80e65b9f1d3611c48e8a',newSha256=P.CANDIDATE_SHA,mode=0o755,uid=0,gid=0)],knownByteFailureInverseApproved=True,noTimerOrHoldChanges=True,automaticDeletion=False,recoveryActivation=False)
 ar=P.canonical(approval);plan['finalHumanApproval']=dict(path=plan['package']+'/approval.json',sha256=P.sha(ar),sourceMessagePath=plan['package']+'/human-approval-message.txt',sourceMessageSha256=P.sha(message))
 bodies={'promotion.py':Path('/tmp/pow-audit30-coupled-pin-checker-promotion-v6.py').read_bytes(),'retention-checker-oct3-dual-pin.py':Path('/tmp/pow-audit30-retention-protection-oct3-dual-pin-candidate-v1.py').read_bytes(),'install-retention.py':IP.read_bytes(),'approval.json':ar,'human-approval-message.txt':message,'plan.json':P.canonical(plan)}
 return dict(schema='pow-audit30-coupled-pin-checker-package-request-v1',host='pow-bitcoin-01',files={n:dict(bytes=len(b),sha256=P.sha(b),base64=base64.b64encode(b).decode())for n,b in bodies.items()},planSha256=P.sha(bodies['plan.json']),baseMetadata=None)
def body(r,name):return base64.b64decode(r['files'][name]['base64'])
def changed(r,name,b):
 r['files'][name]=dict(bytes=len(b),sha256=P.sha(b),base64=base64.b64encode(b).decode())
 if name=='plan.json':r['planSha256']=P.sha(b)
 return r
class Tests(unittest.TestCase):
 def test_exact_code_sources_and_closed_positive_inert_decode(self):
  v,files,plan,M,installer=P.decode(P.canonical(request()));self.assertEqual(set(files),set(P.CAPS));self.assertEqual(M.__name__,'inert_reviewed_v6');self.assertEqual(installer.__name__,'inert_reviewed_install');self.assertEqual(M.NEW_PIN,M.OLD_PIN+b'proof_indexer-20261003T031852Z.dumpset\n');self.assertEqual(len(files['promotion.py']),25752)
 def test_absent_human_approval_refuses_before_creation(self):
  r=request();p=json.loads(body(r,'plan.json'));p['finalHumanApproval']=None;changed(r,'plan.json',P.canonical(p))
  with patch.object(Path,'mkdir',side_effect=AssertionError('must not create')),self.assertRaisesRegex(ValueError,'Final human'):P.decode(P.canonical(r))
 def test_wrong_scope_self_or_message_sha_refuses(self):
  for k in('scopeSha256','callerSha256','humanApprovalSourceSha256'):
   r=request();a=json.loads(body(r,'approval.json'));a[k]='0'*64;changed(r,'approval.json',P.canonical(a));p=json.loads(body(r,'plan.json'));p['finalHumanApproval']['sha256']=r['files']['approval.json']['sha256'];changed(r,'plan.json',P.canonical(p))
   with self.subTest(k=k),self.assertRaises(ValueError):P.decode(P.canonical(r))
  r=request();changed(r,'human-approval-message.txt',b'changed synthetic message')
  with self.assertRaisesRegex(ValueError,'raw pins'):P.decode(P.canonical(r))
 def test_canonical_plan_and_declared_raw_hash_required(self):
  r=request();changed(r,'plan.json',body(r,'plan.json')+b'\n')
  with self.assertRaisesRegex(ValueError,'Canonical compact'):P.decode(P.canonical(r))
  r=request();r['planSha256']='0'*64
  with self.assertRaisesRegex(ValueError,'plan pin'):P.decode(P.canonical(r))
 def test_foreign_code_file_or_payload_change_refuses(self):
  for name in P.FIXED:
   r=request();changed(r,name,body(r,name)[:-1]+b' ')
   with self.subTest(name=name),self.assertRaisesRegex(ValueError,'reviewed code'):P.decode(P.canonical(r))
  r=request();r['files']['.env']=r['files'].pop('approval.json')
  with self.assertRaisesRegex(ValueError,'six-member'):P.decode(P.canonical(r))
 def test_private_or_extra_nested_plan_fields_refuse(self):
  for mutation in(lambda p:next(iter(p['static'].values())).update(body='not a permitted field'),lambda p:p['mask'].update(extra='not a permitted field')):
   r=request();p=json.loads(body(r,'plan.json'));mutation(p);changed(r,'plan.json',P.canonical(p))
   with self.assertRaisesRegex(ValueError,'Closed public'):P.decode(P.canonical(r))
 def test_missing_restore_receipt_hash_or_metadata_refuses(self):
  for key in('restoreProofSha256','restoreProofMetadata'):
   r=request();p=json.loads(body(r,'plan.json'));p[key].pop('offline-page-check.json');changed(r,'plan.json',P.canonical(p))
   with self.assertRaises(ValueError):P.decode(P.canonical(r))
 def test_unbounded_base64_duplicate_json_wal_and_empty_message_refuse(self):
  r=request();r['files']['approval.json']['base64']='A'*(4*((P.CAPS['approval.json']+2)//3)+1)
  with self.assertRaisesRegex(ValueError,'bounded member'):P.decode(P.canonical(r))
  with self.assertRaisesRegex(ValueError,'Duplicate JSON'):P.decode(b'{"schema":1,"schema":2}')
  r=request();p=json.loads(body(r,'plan.json'));p['units']['pg_receivewal@16-main.service']['MainPID']='1';changed(r,'plan.json',P.canonical(p))
  with self.assertRaisesRegex(ValueError,'WAL receiver'):P.decode(P.canonical(r))
  r=request();changed(r,'human-approval-message.txt',b' ')
  with self.assertRaisesRegex(ValueError,'UTF8'):P.decode(P.canonical(r))
 def test_original_backup_freshness_checker_rejects_901s(self):
  F=imported('reviewed_v6_tests','/tmp/pow-audit30-coupled-pin-checker-promotion-v6.test.py');f=F.Fixture();p,v,read,meta=f.backup_fixture();v['atUtc']=(datetime.datetime.now(datetime.timezone.utc)-datetime.timedelta(seconds=901)).isoformat();p['freshFullRead']['sha256']=F.S.sha(F.S.canonical(v))
  with self.assertRaisesRegex(ValueError,'Fresh full-read'):f.check_fixture(p,read,meta)
 def test_source_never_calls_promotion_and_starts_alarm_before_stdin(self):
  t=ast.parse(SOURCE.read_bytes());calls=[n for n in ast.walk(t)if isinstance(n,ast.Call)];self.assertFalse(any(isinstance(n.func,ast.Attribute)and n.func.attr in('execute','apply_pair','main')for n in calls));main=next(n for n in t.body if isinstance(n,ast.FunctionDef)and n.name=='main');s=ast.get_source_segment(SOURCE.read_text(),main);self.assertLess(s.index('signal.setitimer'),s.index('sys.stdin.buffer.read'));self.assertLess(s.index('resource.setrlimit'),s.index('sys.stdin.buffer.read'));self.assertIn('os.geteuid()==os.getegid()==0',s)
 def test_installer_directory_real_sticky_ancestor_refusal(self):
  with self.assertRaises(AssertionError):I.directory(Path('/tmp'))
 def test_real_exclusive_create_mode_no_overwrite_or_link_acceptance(self):
  with tempfile.TemporaryDirectory()as d:
   p=Path(d).resolve()/'input';I.exclusive(p,b'unchanged');P.verify_file(p,b'unchanged',(os.getuid(),os.getgid()))
   with self.assertRaises(FileExistsError):I.exclusive(p,b'changed')
   self.assertEqual(p.read_bytes(),b'unchanged');alias=p.parent/'hardlink';os.link(p,alias)
   with self.assertRaisesRegex(ValueError,'authority'):P.verify_file(p,b'unchanged',(os.getuid(),os.getgid()))
   alias.unlink();p.unlink();p.symlink_to(alias)
   with self.assertRaises((ValueError,FileNotFoundError)):P.verify_file(p,b'unchanged',(os.getuid(),os.getgid()))

def local_create(root,fail=None,blocked=None):
 """Exercise filesystem custody only, with explicit synthetic admission/owners."""
 v,files,plan,M,_=P.decode(P.canonical(request()));P.BASE=root;plan=copy.deepcopy(plan);plan['package']=str(root/plan['run']);plan['evidenceRoot']=plan['package']+'/evidence';root.mkdir(mode=0o700);v['baseMetadata']=M.meta(root)
 for name in('OPS','BACKUP_LOCK'):
  path=root.parent/name;path.write_bytes(b'');setattr(M,name,path)
 M.lock=lambda p,m:os.open(p,os.O_RDONLY);installer=types.SimpleNamespace(directory=lambda p:None,exclusive=I.exclusive);verify=P.verify_file;calls=0
 def observed(_M,_plan):
  nonlocal calls;calls+=1
  if calls==3 and fail=='post':raise ValueError('synthetic post-creation admission refusal')
  if calls==3 and blocked is not None:blocked()
  return {'syntheticOnly':True}
 def exclusive(p,b):
  if fail=='partial'and p.name=='install-retention.py':raise OSError('synthetic third-member refusal')
  if p.name=='failed.json'and blocked is not None:
   for _ in range(3):os.kill(os.getpid(),blocked.signal);time.sleep(.01)
  return I.exclusive(p,b)
 installer.exclusive=exclusive
 with patch.object(P,'admission',observed),patch.object(P,'verify_file',lambda p,b:verify(p,b,(os.getuid(),os.getgid()))):return P.create(v,files,plan,M,installer,'a'*64)
class LocalCustody(unittest.TestCase):
 def test_actual_six_member_creation_and_evidence_absent(self):
  with tempfile.TemporaryDirectory()as d:
   r=local_create(Path(d).resolve()/'package-base');self.assertFalse(r['promotionExecuted']);self.assertEqual(len(r['members']),6);self.assertEqual(set(os.listdir(r['package'])),set(P.CAPS));self.assertFalse((Path(r['package'])/'evidence').exists());self.assertTrue((Path(r['creationEvidence'])/'intent.json').exists());self.assertTrue((Path(r['creationEvidence'])/'completed.json').exists())
 def test_real_partial_and_postguard_failures_are_durable_no_retry(self):
  for phase in('partial','post'):
   with tempfile.TemporaryDirectory()as d:
    root=Path(d).resolve()/'package-base'
    with self.subTest(phase=phase),self.assertRaises((ValueError,OSError)):local_create(root,phase)
    evidence=next(root.glob('*.creation'));v=json.loads((evidence/'failed.json').read_bytes());self.assertFalse(v['automaticRetry']);self.assertFalse(v['promotionExecuted']);self.assertTrue(v['partialPackageRequiresExplicitReview']);self.assertTrue((evidence/'intent.json').exists());self.assertFalse((evidence/'completed.json').exists());package=next(p for p in root.iterdir()if p.is_dir()and not p.name.endswith('.creation'));self.assertGreater(len(list(package.iterdir())),0)
 def test_actual_sigint_terminate_blocked_child_and_keep_custody(self):self.signal_case(signal.SIGINT)
 def test_actual_sigterm_terminate_blocked_child_and_keep_custody(self):self.signal_case(signal.SIGTERM)
 def signal_case(self,number):
  code=r'''
import importlib.util,json,os,signal,subprocess,sys,tempfile,threading,time
from pathlib import Path
p='/tmp/pow-audit30-coupled-pin-checker-package-creator-v1.test.py';s=importlib.util.spec_from_file_location('fixtures',p);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);number=int(sys.argv[1])
with tempfile.TemporaryDirectory()as d:
 root=Path(d).resolve()/'base';marker=Path(d)/'child'
 def blocked():subprocess.run([sys.executable,'-I','-B','-c','from pathlib import Path;import os,time;Path('+repr(str(marker))+').write_text(str(os.getpid()));time.sleep(20)'],capture_output=True,timeout=5)
 blocked.signal=number
 def interrupt():
  for _ in range(300):
   if marker.exists():os.kill(os.getpid(),number);return
   time.sleep(.005)
 threading.Thread(target=interrupt,daemon=True).start()
 try:m.local_create(root,blocked=blocked)
 except m.P.PackageInterrupted:pass
 else:raise AssertionError('signal ignored')
 pid=int(marker.read_text())
 try:os.kill(pid,0)
 except ProcessLookupError:pass
 else:raise AssertionError('owned metadata child remains')
 audit=next(root.glob('*.creation'));v=json.loads((audit/'failed.json').read_bytes());assert v['errorClass']=='PackageInterrupted'and v['automaticRetry']is False and not(audit/'completed.json').exists();print('owned-child-reaped-custody-retained')
'''
  r=subprocess.run([sys.executable,'-I','-B','-c',code,str(number)],capture_output=True,timeout=8);self.assertEqual(r.returncode,0,r.stderr);self.assertEqual(r.stdout,b'owned-child-reaped-custody-retained\n')
if __name__=='__main__':unittest.main()
