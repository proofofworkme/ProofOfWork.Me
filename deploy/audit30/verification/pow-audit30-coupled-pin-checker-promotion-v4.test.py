"""Local source tests only: real file/rename/fsync flow, synthetic root owners.
No production authority is exercised; only local temporary files are mutated.
"""
import copy, hashlib, importlib.util, json, os
from pathlib import Path
import signal, subprocess, sys, tempfile, time, types, unittest
from unittest.mock import patch
P=Path('/tmp/pow-audit30-coupled-pin-checker-promotion-v4.py')
spec=importlib.util.spec_from_file_location('promotion',P);S=importlib.util.module_from_spec(spec);spec.loader.exec_module(S)
IP=Path('/home/sixer/ProofOfWork.Me/deploy/audit30/install-retention.py');I=types.ModuleType('frozen_install');I.__file__=str(IP);exec(compile(IP.read_bytes(),str(IP),'exec'),I.__dict__)
COMPLETION_PINS=dict(planSha256='1'*64,callerSha256='2'*64,approvalReceiptSha256='3'*64,scopeSha256=S.sha(S.canonical(S.SCOPE)),humanApprovalSourceSha256='4'*64)
REAL_LSTAT=Path.lstat;REAL_ID=I.identity;REAL_META=S.stat_meta

def owned_lstat(p,*a,**kw):
    s=REAL_LSTAT(p,*a,**kw);d={n:getattr(s,n)for n in dir(s)if n.startswith('st_')};d['st_uid']=d['st_gid']=0;return types.SimpleNamespace(**d)
def owned_id(s):
    a=list(REAL_ID(s));a[3]=a[4]=0;return tuple(a)
def owned_meta(s):
    d=REAL_META(s);d['uid']=d['gid']=0;return d
class Fixture(unittest.TestCase):
 def setUp(self):
    self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name).resolve();self.p=self.root/'pin';self.c=self.root/'checker';self.e=self.root/'e';self.e.mkdir();self.p.write_bytes(b'oldpin\n');self.c.write_bytes(b'oldchecker');self.p.chmod(0o644);self.c.chmod(0o755)
    self.patches=[patch.object(Path,'lstat',owned_lstat),patch.object(I,'identity',owned_id),patch.object(S,'stat_meta',owned_meta)]
    for p in self.patches:p.start()
 def tearDown(self):
    for p in reversed(self.patches):p.stop()
    self.tmp.cleanup()
 def args(self):
    before={str(p):dict(bytes=p.read_bytes(),mode=p.stat().st_mode&0o777,identity=I.identity(p.lstat()))for p in(self.p,self.c)}
    new={str(self.p):dict(bytes=b'newpin\n',mode=0o644),str(self.c):dict(bytes=b'newchecker',mode=0o755)};return before,new
 def call(self,check=lambda _:None):
    b,n=self.args();return S.apply_pair(I,b,n,self.e,check,COMPLETION_PINS)
 def test_unknown_preimage_after_long_guard_never_overwritten(self):
    def check(phase):
      if phase=='before-replace':self.p.write_bytes(b'unknown-after-check')
    with self.assertRaisesRegex(ValueError,'after long guards'):self.call(check)
    self.assertEqual(self.p.read_bytes(),b'unknown-after-check');self.assertEqual(self.c.read_bytes(),b'oldchecker');self.assertFalse((self.e/'completed.json').exists());self.assertEqual(json.loads((self.e/'inverse.json').read_bytes())['status'],'no-caller-mutation')
 def test_closed_direct_human_exact_two_scope(self):
    plan=dict(reviewedScopeSha256=S.sha(S.canonical(S.SCOPE)),finalHumanApproval=dict(sourceMessageSha256='a'*64));v=dict(schema='pow-audit30-coupled-pin-checker-direct-human-approval-v1',status='approved',approvalSource='direct-human',operation=S.SCOPE['operation'],callerSha256='b'*64,scopeSha256=plan['reviewedScopeSha256'],humanApprovalSourceSha256='a'*64,approvedAtUtc=S.utc(),replacements=copy.deepcopy(S.SCOPE['replacements']),knownByteFailureInverseApproved=True,noTimerOrHoldChanges=True,automaticDeletion=False,recoveryActivation=False);S.validate_human_value(v,plan,'b'*64)
    for key,new in [('status','prepared'),('approvalSource','operator'),('callerSha256','c'*64),('scopeSha256','c'*64),('humanApprovalSourceSha256','c'*64),('knownByteFailureInverseApproved',False),('automaticDeletion',True),('noTimerOrHoldChanges',False),('recoveryActivation',True)]:
      bad=copy.deepcopy(v);bad[key]=new
      with self.assertRaises(ValueError):S.validate_human_value(bad,plan,'b'*64)
    for mutate in('path','oldSha256','newSha256','mode'):
      bad=copy.deepcopy(v);bad['replacements'][0][mutate]='wrong'
      with self.assertRaises(ValueError):S.validate_human_value(bad,plan,'b'*64)
    bad=copy.deepcopy(v);bad['unexpected']='extra'
    with self.assertRaises(ValueError):S.validate_human_value(bad,plan,'b'*64)
 def test_exact_install_helper_pin(self):self.assertEqual(hashlib.sha256(IP.read_bytes()).hexdigest(),S.INSTALL_SHA)
 def test_success_two_exact_files_and_durable_completion(self):
    self.assertEqual(self.call(),'passed');self.assertEqual(self.p.read_bytes(),b'newpin\n');self.assertEqual(self.c.read_bytes(),b'newchecker');v=json.loads((self.e/'completed.json').read_bytes());self.assertFalse(v['jointAtomicTransaction']);self.assertEqual(len(v['installed']),2);self.assertEqual(v['knownHeldAbsencesUnresolved'],18)
 def test_completed_receipt_exact_consumer_contract_and_raw_pins(self):
    self.call();v=json.loads((self.e/'completed.json').read_bytes())
    for k,x in COMPLETION_PINS.items():self.assertEqual(v[k],x)
    import ast,re
    cp=Path('/tmp/pow-audit30-retire-exact-four-v2.py');raw=cp.read_bytes();self.assertEqual(hashlib.sha256(raw).hexdigest(),'1abba9db552854d37973e3f297010bbd4f6a48a7c340ab673622d5ec1a51815c')
    f=next(n for n in ast.parse(raw).body if isinstance(n,ast.FunctionDef)and n.name=='proofs');nodes=f.body[-4:-1]
    # Execute the frozen consumer's wanted assignment and two exact predicates;
    # no native consumer input reader, proof(), or deletion action is invoked.
    env=dict(promotion=v,PIN=S.PIN,OCT2=Path('/data/proofofwork-postgres-backups/logical')/S.NEW_PIN.decode().strip(),CHECKER=S.CHECKER,OLD_CHECKER_SHA=S.OLD_CHECKER,CHECKER_SHA=S.NEW_CHECKER,SHA=re.compile('[a-f0-9]{64}'),need=S.need)
    exec(compile(ast.Module(body=nodes,type_ignores=[]),str(cp),'exec'),env)
    for k,x in [('status','passed'),('pinAndCheckerCoupled',False),('approvalReceiptSha256',None),('deletionAuthorized',True)]:
      bad=dict(v);bad[k]=x;env['promotion']=bad
      with self.assertRaises((ValueError,TypeError)):exec(compile(ast.Module(body=nodes,type_ignores=[]),str(cp),'exec'),env)
    self.assertFalse(v['jointAtomicTransaction']);self.assertTrue(v['individualAtomicReplacements'])
 def test_completion_pins_required_before_any_replacement(self):
    b,n=self.args()
    for bad in ({},dict(COMPLETION_PINS,scopeSha256='9'*64),dict(COMPLETION_PINS,approvalReceiptSha256='not-hex')):
      with self.assertRaisesRegex(ValueError,'completion pins'):S.apply_pair(I,b,n,self.e,lambda _:None,bad)
    self.assertEqual(self.p.read_bytes(),b'oldpin\n');self.assertEqual(self.c.read_bytes(),b'oldchecker')
 def test_frozen_directory_rejects_actual_sticky_writable_ancestry(self):
    # Root ownership is modeled as elsewhere; the actual temp ancestor mode
    # comes from the filesystem and is neither changed nor waived.
    st=REAL_LSTAT(Path(tempfile.gettempdir()));self.assertTrue(st.st_mode&0o022)
    with self.assertRaises(AssertionError):I.directory(self.e)
 def test_evidence_path_is_inside_exact_reviewed_package_only(self):
    v=json.loads(Path('/tmp/pow-audit30-coupled-pin-checker-promotion-plan-template-v4.json').read_bytes());self.assertEqual(v['evidenceRoot'],v['package']+'/evidence')
    v['finalHumanApproval']=dict(path=v['package']+'/approval.json',sha256='a'*64,sourceMessagePath=v['package']+'/human-approval-message.txt',sourceMessageSha256='b'*64)
    m=dict(device=1,inode=1,mode=0o644,uid=0,gid=0,nlink=1,bytes=1,mtimeNs=1,ctimeNs=1)
    v['installed']={k:dict(m)for k in v['installed']};v['lockMetadata']={k:dict(m,mode=0o600)for k in v['lockMetadata']};v['expectedMonitorProjectionSha256']='c'*64;v['freshFullRead']['sha256']='d'*64;S.validate(v)
    for path in ('/var/tmp/proofofwork-audit30-pin-promotion-'+v['run'],v['package']+'/other',v['package']+'/../evidence'):
      bad=copy.deepcopy(v);bad['evidenceRoot']=path
      with self.assertRaisesRegex(ValueError,'package/evidence'):S.validate(bad)
 def test_second_replace_failure_restores_both(self):
    original=I.replace;n=0
    def fail(p,b,m,t):
      nonlocal n;n+=1
      if n==2:raise OSError('second replacement')
      return original(p,b,m,t)
    with patch.object(I,'replace',fail),self.assertRaises(OSError):self.call()
    self.assertEqual(self.p.read_bytes(),b'oldpin\n');self.assertEqual(self.c.read_bytes(),b'oldchecker');self.assertFalse((self.e/'completed.json').exists());self.assertEqual(json.loads((self.e/'inverse.json').read_bytes())['status'],'reconciled')
 def test_post_rename_failure_is_armed_and_restored(self):
    original=I.replace
    def fail(p,b,m,t):
      original(p,b,m,t)
      if '-restore'not in t:raise OSError('post-rename fsync failure')
    with patch.object(I,'replace',fail),self.assertRaises(OSError):self.call()
    self.assertEqual(self.p.read_bytes(),b'oldpin\n');self.assertEqual(json.loads((self.e/'failed.json').read_bytes())['armed'],[str(self.p)])
 def test_failed_receipt_write_never_preempts_inverse(self):
    orig=I.exclusive
    def ex(p,b,m=0o600):
      if p.name=='failed.json':raise OSError('durable failure blocked')
      return orig(p,b,m)
    def check(phase):
      if phase=='after-pair':raise ValueError('final fence')
    with patch.object(I,'exclusive',ex),self.assertRaisesRegex(ValueError,'final fence'):self.call(check)
    self.assertEqual(self.p.read_bytes(),b'oldpin\n');self.assertEqual(self.c.read_bytes(),b'oldchecker');self.assertEqual(json.loads((self.e/'inverse.json').read_bytes())['cleanupErrors'][0]['stage'],'failure-receipt')
 def test_unknown_postimage_refuses_inverse_and_preserves_first(self):
    def check(phase):
      if phase=='after-pair':self.p.write_bytes(b'unknown');raise ValueError('first')
    with self.assertRaisesRegex(ValueError,'first'):self.call(check)
    self.assertEqual(self.p.read_bytes(),b'unknown');self.assertEqual(json.loads((self.e/'inverse.json').read_bytes())['status'],'qualified-partial')
 def test_preimage_content_drift_refuses_before_replace(self):
    b,n=self.args();self.p.write_bytes(b'drift')
    with self.assertRaises(ValueError):S.apply_pair(I,b,n,self.e,lambda _:None,COMPLETION_PINS)
    self.assertEqual(self.p.read_bytes(),b'drift');self.assertEqual(self.c.read_bytes(),b'oldchecker')
 def test_real_read_positive_stable_bytes(self):self.assertEqual(S.read(self.p,32)[0],b'oldpin\n')
 def test_real_hardlink_refusal(self):
    os.link(self.p,self.root/'alias')
    with self.assertRaises(ValueError):S.read(self.p,32)
 def test_real_symlink_refusal(self):
    q=self.root/'link';q.symlink_to(self.p)
    with self.assertRaises(ValueError):S.read(q,32)
 def test_real_xattr_refusal(self):
    try:os.setxattr(self.p,'user.audit30',b'drift')
    except OSError:self.skipTest('temporary filesystem has no user xattrs')
    with self.assertRaises(ValueError):S.read(self.p,32)
 def test_read_hash_and_size_refuse(self):
    with self.assertRaises(ValueError):S.read(self.p,32,'0'*64)
    with self.assertRaises(ValueError):S.read(self.p,1)
 def test_lock_descriptor_exact_and_second_owner_refuses(self):
    q=self.root/'lock';q.write_bytes(b'');q.chmod(0o600);m=S.meta(q);fd=S.lock(q,m)
    try:
      with self.assertRaises(BlockingIOError):S.lock(q,m)
    finally:os.close(fd)
 def test_lock_path_drift_refuses(self):
    q=self.root/'lock';q.write_bytes(b'');m=S.meta(q);q.unlink();q.write_bytes(b'changed')
    with self.assertRaises(ValueError):S.lock(q,m)
 def test_unknown_monitor_issue_refuses(self):
    with self.assertRaises(ValueError):S.monitor_projection({'role':'node','issues':['pinned-logical-restore-backup-not-protected']})
 def test_known18_monitor_drift_refuses(self):
    h=dict(heldPaths=521,missingHeldPaths=['/held/'+str(i)for i in range(18)],unexpectedRetiredPathsPresent=[],unexpectedRelocatedOriginalPathsPresent=[])
    v=dict(role='node',ok=False,issues=['historical-held-path-missing-or-retirement-invalid'],units={},historicalHeldInventory=h);self.assertEqual(len(S.monitor_projection(v)['historicalHeldInventory']['missingHeldPaths']),18)
    v['historicalHeldInventory']['missingHeldPaths'].append('/new')
    with self.assertRaises(ValueError):S.monitor_projection(v)
 def test_real_signal_inverse_and_handlers_restored(self):
    for sig in(signal.SIGINT,signal.SIGTERM):
      with self.subTest(sig=sig):
        e=self.root/('signal-'+str(sig));e.mkdir();self.e=e;b,n=self.args();old=signal.getsignal(sig)
        def check(phase):
          if phase=='after-pair':os.kill(os.getpid(),sig)
        with self.assertRaises(S.PromotionInterrupted):S.apply_pair(I,b,n,e,check,dict(planSha256="1"*64,callerSha256="2"*64,approvalReceiptSha256="3"*64,scopeSha256=S.sha(S.canonical(S.SCOPE)),humanApprovalSourceSha256="4"*64))
        self.assertEqual(signal.getsignal(sig),old);self.assertEqual(self.p.read_bytes(),b'oldpin\n');self.assertEqual(self.c.read_bytes(),b'oldchecker')
 def test_repeated_signal_ignored_during_inverse(self):
    orig=I.reconcile
    def reconcile(*a):os.kill(os.getpid(),signal.SIGTERM);os.kill(os.getpid(),signal.SIGINT);return orig(*a)
    def check(phase):
      if phase=='after-pair':raise RuntimeError('original')
    with patch.object(I,'reconcile',reconcile),self.assertRaisesRegex(RuntimeError,'original'):self.call(check)
    self.assertEqual(self.p.read_bytes(),b'oldpin\n')
 def test_closed_plan_null_human_approval_unexecutable(self):
    template=Path('/tmp/pow-audit30-coupled-pin-checker-promotion-plan-template-v4.json');v=json.loads(template.read_bytes())
    with self.assertRaisesRegex(ValueError,'Final human approval'):S.validate(v)
 def test_candidate_exact_only_two_literals(self):
    old=Path('/home/sixer/ProofOfWork.Me/scripts/check-retention-protection.py').read_bytes();new=Path('/tmp/pow-audit30-retention-protection-oct2-candidate-v1.py').read_bytes();self.assertEqual(S.sha(old),S.OLD_CHECKER);self.assertEqual(S.sha(new),S.NEW_CHECKER);self.assertEqual(new.replace(b'proof_indexer-20261002T031851Z.dumpset',b'proof_indexer-20260929T031853Z.dumpset').replace(b'20525963614',b'19363782935'),old)
if __name__=='__main__':unittest.main()
