"""Local source tests only: real file/rename/fsync flow, synthetic root owners.
No production authority is exercised; only local temporary files are mutated.
"""
import copy, hashlib, importlib.util, json, os
from pathlib import Path
import signal, subprocess, sys, tempfile, time, types, unittest
from unittest.mock import patch
P=Path('/tmp/pow-audit30-coupled-pin-checker-promotion-v5.py')
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
 def test_completed_receipt_predicate_shape_only_not_old_consumer_loader_admission(self):
    self.call();v=json.loads((self.e/'completed.json').read_bytes())
    for k,x in COMPLETION_PINS.items():self.assertEqual(v[k],x)
    import ast,re
    cp=Path('/tmp/pow-audit30-retire-exact-four-v2.py');raw=cp.read_bytes();self.assertEqual(hashlib.sha256(raw).hexdigest(),'1abba9db552854d37973e3f297010bbd4f6a48a7c340ab673622d5ec1a51815c')
    f=next(n for n in ast.parse(raw).body if isinstance(n,ast.FunctionDef)and n.name=='proofs');nodes=f.body[-4:-1]
    # Execute the frozen consumer's wanted assignment and two exact predicates;
    # no native consumer input reader, proof(), or deletion action is invoked.
    # OCT2/CHECKER_SHA are synthetic variables for this predicate fragment only;
    # the frozen consumer's Oct2 source bindings do NOT admit the new Oct3 caller.
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
    v=json.loads(Path('/tmp/pow-audit30-coupled-pin-checker-promotion-plan-template-v5.json').read_bytes());self.assertEqual(v['evidenceRoot'],v['package']+'/evidence')
    v['finalHumanApproval']=dict(path=v['package']+'/approval.json',sha256='a'*64,sourceMessagePath=v['package']+'/human-approval-message.txt',sourceMessageSha256='b'*64)
    m=dict(device=1,inode=1,mode=0o644,uid=0,gid=0,nlink=1,bytes=1,mtimeNs=1,ctimeNs=1)
    v['installed']={k:dict(m)for k in v['installed']};v['lockMetadata']={k:dict(m,mode=0o600)for k in v['lockMetadata']};v['expectedMonitorProjectionSha256']='c'*64;v['freshFullRead']['sha256']='d'*64;v['units']=self.states();v['restoreProofSha256']={n:'e'*64 for n in S.RESTORE_FILES};S.validate(v)
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
    template=Path('/tmp/pow-audit30-coupled-pin-checker-promotion-plan-template-v5.json');v=json.loads(template.read_bytes())
    with self.assertRaisesRegex(ValueError,'Final human approval'):S.validate(v)
 def test_candidate_exact_only_two_literals(self):
    old=Path('/home/sixer/ProofOfWork.Me/scripts/check-retention-protection.py').read_bytes();new=Path('/tmp/pow-audit30-retention-protection-oct3-candidate-v1.py').read_bytes();self.assertEqual(S.sha(old),S.OLD_CHECKER);self.assertEqual(S.sha(new),S.NEW_CHECKER);self.assertEqual(new.replace(b'proof_indexer-20261003T031852Z.dumpset',b'proof_indexer-20260929T031853Z.dumpset').replace(b'20878072656',b'19363782935'),old)


 def accepted(self):
    p=Path('/tmp/pow-audit30-oct3-full-read-native-102500-v1.stdout');b=p.read_bytes();self.assertEqual(S.sha(b),'db8f00d8c61aa4aa6d9ed4ad13d7a6b5b67faf160d925526f869d5859d9a1147');return json.loads(b)['result']
 def states(self):
    # Only timer and protected-service rows below are captured native rows.
    # UnitFileState for backup/live services is synthetic, since the public
    # baseline source's five-field profile did not collect that property.
    r=self.accepted();v={n:dict(LoadState='loaded',ActiveState='active',SubState='running',MainPID='1',InvocationID='a'*32,UnitFileState='enabled')for n in S.LIVE}
    v[S.BACKUP_SERVICE]=dict(r['backupBefore']['service'],UnitFileState='static');v[S.BACKUP_TIMER]=r['backupBefore']['timer'];v.update(r['protectionBefore']['units']);return v
 def ready_plan(self):
    v=json.loads(Path('/tmp/pow-audit30-coupled-pin-checker-promotion-plan-template-v5.json').read_bytes());v['finalHumanApproval']=dict(path=v['package']+'/approval.json',sha256='a'*64,sourceMessagePath=v['package']+'/human-approval-message.txt',sourceMessageSha256='b'*64)
    m=dict(device=1,inode=1,mode=0o644,uid=0,gid=0,nlink=1,bytes=1,mtimeNs=1,ctimeNs=1);v['installed']={k:dict(m)for k in v['installed']};v['lockMetadata']={k:dict(m,mode=0o600)for k in v['lockMetadata']};v['expectedMonitorProjectionSha256']='c'*64;v['freshFullRead']['sha256']='d'*64;v['units']=self.states();v['restoreProofSha256']={n:'e'*64 for n in S.RESTORE_FILES};return v
 def wire(self,v):return ''.join(k+'='+x+'\n'for k,x in v.items()).encode()
 def test_captured_timer_shapes_fix_original_missing_mainpid_contract(self):
    states=self.states();self.assertNotIn('MainPID',states[S.BACKUP_TIMER]);self.assertNotIn('MainPID',states[S.PRUNE]);self.assertEqual(len(S.PROPERTIES_BY_UNIT[S.BACKUP_TIMER]),6);self.assertEqual(len(S.PROPERTIES_BY_UNIT[S.PRUNE]),5)
    calls=[]
    def run(a,**kw):calls.append(a);return types.SimpleNamespace(returncode=0,stdout=self.wire(states[a[2]]),stderr=b'')
    with patch.object(S.subprocess,'run',run):self.assertEqual(S.unit_states(),states)
    for a in calls:
      self.assertEqual(a[3:],[x for k in S.PROPERTIES_BY_UNIT[a[2]]for x in ('-p',k)])
      if a[2].endswith('.timer'):self.assertNotIn('MainPID',a)
    # Execute original frozen V4 observer with these same captured timer rows.
    old=types.ModuleType('old');exec(compile(Path('/tmp/pow-audit30-coupled-pin-checker-promotion-v4.py').read_bytes(),'old','exec'),old.__dict__)
    with patch.object(old.subprocess,'run',run),self.assertRaisesRegex(ValueError,'properties incomplete'):old.unit_states()
 def test_wire_missing_unknown_duplicate_and_malformed_refuse(self):
    states=self.states()
    for label,change in [('missing',lambda b:b.splitlines(keepends=True)[1:]),('unknown',lambda b:[b,b'Unexpected=value\n']),('duplicate',lambda b:[b,b'LoadState=masked\n']),('timer_pid',lambda b:[b,b'MainPID=0\n']),('malformed',lambda b:[b,b'not-a-property\n'])]:
      with self.subTest(label=label):
        def run(a,**kw):
          b=self.wire(states[a[2]])
          if a[2]==S.PRUNE:b=b''.join(change(b))
          return types.SimpleNamespace(returncode=0,stdout=b,stderr=b'')
        with patch.object(S.subprocess,'run',run),self.assertRaises(ValueError):S.unit_states()
 def test_service_mainpid_remains_required(self):
    states=self.states();states[S.LIVE[0]].pop('MainPID')
    with patch.object(S.subprocess,'run',lambda a,**kw:types.SimpleNamespace(returncode=0,stdout=self.wire(states[a[2]]),stderr=b'')),self.assertRaisesRegex(ValueError,'incomplete'):S.unit_states()
 def test_captured_prune_exact_masked_idle_and_profile_negatives(self):
    states=self.states();S.state_require(states,copy.deepcopy(states))
    for k,x in [('LoadState','loaded'),('ActiveState','active'),('SubState','waiting'),('InvocationID','b'*32),('UnitFileState','enabled')]:
      bad=copy.deepcopy(states);bad[S.PRUNE][k]=x
      with self.assertRaisesRegex(ValueError,'Persistent prune'):S.state_require(bad,copy.deepcopy(bad))
    for n in (S.PRUNE,S.BACKUP_TIMER):
      for extra in ('MainPID','Unexpected'):
        bad=copy.deepcopy(states);bad[n][extra]='0'
        with self.assertRaisesRegex(ValueError,'per-unit state fields'):S.state_require(bad,copy.deepcopy(bad))
 def test_planned_exact_profiles_reject_missing_extra_or_typed_property(self):
    v=self.ready_plan();S.validate(v)
    for n in (S.PRUNE,S.BACKUP_TIMER,S.LIVE[0]):
      for change in ('missing','extra','type'):
        bad=copy.deepcopy(v);row=bad['units'][n]
        if change=='missing':row.pop('LoadState')
        elif change=='extra':row['unknown']='x'
        else:row['LoadState']=None
        with self.assertRaisesRegex(ValueError,'per-unit planned'):S.validate(bad)
 def test_four_future_restore_hashes_are_null_and_refused(self):
    t=json.loads(Path('/tmp/pow-audit30-coupled-pin-checker-promotion-plan-template-v5.json').read_bytes());self.assertEqual(t['restoreProofSha256'],{n:None for n in S.RESTORE_FILES});self.assertEqual(t['restoreProofMetadata'],{n:None for n in S.RESTORE_FILES});v=self.ready_plan();v['restoreProofSha256']=t['restoreProofSha256']
    with self.assertRaisesRegex(ValueError,'restore-equivalence'):S.validate(v)
    for badhashes in ({},dict(v['restoreProofSha256'],unexpected='e'*64),{n:'not-hex'for n in S.RESTORE_FILES}):
      v['restoreProofSha256']=badhashes
      with self.assertRaisesRegex(ValueError,'restore-equivalence'):S.validate(v)
 def test_survivor_members_toc_and_restore_plan_pins_exact_accepted_authority(self):
    r=self.accepted();planb=Path('/tmp/pow-audit30-oct3-logical-restore-plan-v1.json').read_bytes();self.assertEqual(S.sha(planb),S.RESTORE_PLAN_SHA);plan=json.loads(planb)
    self.assertEqual(str(S.BACKUP),plan['backup']['path']);self.assertEqual(str(S.SOURCE_JOB),plan['job']);self.assertEqual(S.MEMBERS['proof_indexer.dump'][0],20878072656)
    for n,(size,h)in S.MEMBERS.items():self.assertEqual(size,r['inputsBefore']['members'][n]['bytes']);self.assertEqual(h,plan['backup']['members'][n]['sha256'])
    self.assertEqual(S.sha(r['checksumManifest'].encode()),S.MEMBERS['SHA256SUMS'][1]);self.assertEqual(r['toc']['entries'],197);self.assertEqual(r['toc']['sha256'],'f4dc249de036377ec96f8f15eeff26b4ff12dd9f2f6dd8ea541847e7310eb19b')
 def backup_fixture(self,completed=None):
    r=self.accepted();convert=lambda m:{('device'if k=='dev'else'inode'if k=='ino'else k):x for k,x in m.items()};directory=convert(r['inputsBefore']['directory']);members={n:dict(convert(m),sha256=S.MEMBERS[n][1])for n,m in r['inputsBefore']['members'].items()};fmeta=dict(device=1,inode=2,mode=0o600,uid=0,gid=0,nlink=1,bytes=1,mtimeNs=1,ctimeNs=1)
    value=dict(schema='pow-audit30-latest-backup-full-read-v1',atUtc=S.utc(),backup=dict(path=str(S.BACKUP),directory=directory,members=members),toc=copy.deepcopy(r['toc']),fullDumpHashReverified=True,productionDataMutation=False,globalsContentsEmitted=False)
    c=dict(schema='pow-audit30-isolated-logical-restore-completed-v1',planSha256=S.RESTORE_PLAN_SHA,status='passed',roleOwnerAclRestoration=True,allTableRowHashParity=True,amcheckPassed=True,offlinePrivatePageChecksPassed=True,privateClusterStopped=True,liveServicesUnchanged=True,productionDatabaseMutation=False)
    if completed:c.update(completed)
    data={n:(S.canonical(c)if n=='completed.json'else b'{}')for n in S.RESTORE_FILES};proofmeta={n:dict(fmeta,uid=108,gid=112,bytes=len(b))for n,b in data.items()};p=self.ready_plan();p['freshFullRead']=dict(path=p['freshFullRead']['path'],sha256=S.sha(S.canonical(value)),metadata=fmeta);p['restoreProofMetadata']=proofmeta;p['restoreProofSha256']={n:S.sha(b)for n,b in data.items()}
    def read(path,limit,expected=None):
      if path==Path(p['freshFullRead']['path']):b,m=S.canonical(value),fmeta
      else:self.assertEqual(path.parent,S.SOURCE_JOB);b,m=data[path.name],proofmeta[path.name]
      self.assertEqual(expected,S.sha(b));self.assertLessEqual(len(b),limit);return b,m
    def meta(path):return directory if path==S.BACKUP else{k:x for k,x in members[path.name].items()if k!='sha256'}
    return p,value,read,meta
 def check_fixture(self,p,read,meta):
    with patch.object(S,'read',read),patch.object(S,'meta',meta),patch.object(S.os,'listxattr',lambda _:[]),patch.object(S.os,'listdir',lambda _:list(S.MEMBERS)),patch.object(Path,'resolve',lambda p,*a,**kw:p),patch.object(Path,'is_dir',lambda _:True),patch.object(Path,'lstat',lambda _:types.SimpleNamespace(st_mode=0o100600)):return S.backup_check(p)
 def test_future_completed_receipt_exact_new_plan_and_flags_required(self):
    p,v,read,meta=self.backup_fixture();self.assertEqual(self.check_fixture(p,read,meta)['restoreHashes'],p['restoreProofSha256'])
    for change in (dict(planSha256='c69c00000000000000000000000000000000000000000000000000000000012a15'),dict(status='failed'),dict(privateClusterStopped=False),dict(productionDatabaseMutation=True),dict(allTableRowHashParity=False)):
      p,v,read,meta=self.backup_fixture(change)
      with self.assertRaisesRegex(ValueError,'complete isolated Oct3'):self.check_fixture(p,read,meta)
 def test_old_oct2_toc_or_member_path_cannot_admit_oct3(self):
    p,v,read,meta=self.backup_fixture();v['toc']['sha256']='626dae7576e0f5a9c31229b320cca6d009e6dc3c5826fc9a2ff138602739da30';p['freshFullRead']['sha256']=S.sha(S.canonical(v))
    with self.assertRaisesRegex(ValueError,'TOC'):self.check_fixture(p,read,meta)
    p,v,read,meta=self.backup_fixture();v['backup']['path']='/data/proofofwork-postgres-backups/logical/proof_indexer-20261002T031851Z.dumpset';p['freshFullRead']['sha256']=S.sha(S.canonical(v))
    with self.assertRaisesRegex(ValueError,'complete tree'):self.check_fixture(p,read,meta)
 def test_other_guard_functions_ast_equal_v4_and_execute_filename_only(self):
    import ast
    old=ast.parse(Path('/tmp/pow-audit30-coupled-pin-checker-promotion-v4.py').read_bytes());new=ast.parse(P.read_bytes());func=lambda tree:{n.name:ast.dump(n,include_attributes=False)for n in tree.body if isinstance(n,(ast.FunctionDef,ast.ClassDef))};a,b=func(old),func(new);self.assertEqual(set(a),set(b));changed={n for n in a if a[n]!=b[n]};self.assertEqual(changed,{'validate','unit_states','state_require','backup_check','execute'})
    for n in set(a)-changed:self.assertEqual(a[n],b[n])
    eold=next(n for n in old.body if isinstance(n,ast.FunctionDef)and n.name=='execute');restored=P.read_text().replace('retention-checker-oct3.py','retention-checker-oct2.py');enew=next(n for n in ast.parse(restored).body if isinstance(n,ast.FunctionDef)and n.name=='execute');self.assertEqual(ast.dump(eold,include_attributes=False),ast.dump(enew,include_attributes=False))
if __name__=='__main__':unittest.main()
