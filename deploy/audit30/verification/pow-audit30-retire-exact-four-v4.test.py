#!/usr/bin/python3 -I
import copy,datetime,hashlib,importlib.util,json,os,signal,stat,tempfile,threading,time,types,unittest
from pathlib import Path
from unittest.mock import patch

def imported(name,path):
 spec=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
P=imported('four','/tmp/pow-audit30-retire-exact-four-v4.py')
H=imported('custody','/tmp/pow-audit30-retirement-cluster-closure-v1.py');P.H=H
class Tests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.base=Path(self.tmp.name);H.DEADLINE=float('inf');H.LAST_CHECK=0
 def tearDown(self):self.tmp.cleanup()
 def plan(self):
  return dict(schema='pow-audit30-retire-exact-four-plan-v1',host=P.HOST,controllerSha256='a'*64,runId='20261003T090000Z',candidatePaths=list(P.TARGETS),proofs={k:{'path':'/root/'+k+'.json','sha256':'a'*64}for k in('rootBefore','content','rootAfter','prerequisiteReview','promotion')},liveFive={k:{}for k in H.LIVE},holdFence={'hold':{},'review':{},'masks':{'proofofwork-node-release-prune.timer':{}},'heldCensus':[]},oct2Fence={'path':str(P.OCT2),'records':[],'fullFileHashes':[]},evidencePath=str(P.EVIDENCE_PARENT/'audit30-exact-four-retirement-20261003T090000Z'))
 def test_plan_exact_scope_not_whole_job_or_oct2(self):
  P.validate_plan(self.plan())
  for value in([*P.TARGETS[:3],str(P.OCT2)],list(P.JOBS)+[str(P.OLD)],list(reversed(P.TARGETS)),[*P.TARGETS,P.TARGETS[0]]):
   p=self.plan();p['candidatePaths']=value
   with self.subTest(value=value),self.assertRaises(P.Refused):P.validate_plan(p)
 def test_plan_calendar_host_scope_expansion_and_evidence_escape(self):
  for k,v in [('runId','20260230T090000Z'),('host','another'),('evidencePath',P.JOBS[0]+'/evidence')]:
   p=self.plan();p[k]=v
   with self.subTest(k=k),self.assertRaises((P.Refused,ValueError)):P.validate_plan(p)
  p=self.plan();p['resume']=True
  with self.assertRaises(P.Refused):P.validate_plan(p)
 def human(self,p):
  return dict(schema='pow-audit30-human-exact-four-retirement-approval-v1',status='approved',approvalSource='direct-human',operation='retire-exact-four',planSha256='a'*64,controllerSha256=p['controllerSha256'],candidatePaths=list(P.TARGETS),coupledPromotionReceiptSha256=p['proofs']['promotion']['sha256'],noAutomaticRetry=True,noTimerOrPinOrServiceChanges=True,jobRootsAndEvidencePreserved=True,retainedOct2Preserved=True,approvedAtUtc='2026-10-03T09:00:00Z')
 def test_separate_human_receipt_not_phase7_approval_or_an_apply_flag(self):
  p=self.plan();a=self.human(p);P.approval(P.encoded(a),'a'*64,p['controllerSha256'],p)
  for k,v in [('approvalSource','operator'),('operation','phase7'),('planSha256','b'*64),('controllerSha256','b'*64),('retainedOct2Preserved',False),('noAutomaticRetry',1),('coupledPromotionReceiptSha256','b'*64)]:
   b=a|{k:v}
   with self.subTest(k=k),self.assertRaises(P.Refused):P.approval(P.encoded(b),'a'*64,p['controllerSha256'],p)
 def fixture_custody(self):
  rows=[];contents=[]
  for root in P.TARGETS:
   meta=dict(path=root,kind='directory',device=1,inode=1,uid=108,gid=112,mode=0o700,nlink=2,bytes=4096,allocatedBytes=4096,mtimeNs=1,ctimeNs=1,xattrs=[])
   f=meta|dict(path=root+'/x',kind='file',inode=2,mode=0o600,nlink=1,bytes=2,allocatedBytes=4096)
   records=[meta,f];hashes=[dict(path=f['path'],metadataSha256=P.sha(P.encoded(f)),sha256=P.sha(b'xy'))];amount=H.allocation(records)
   rows.append(dict(path=root,records=records,metadataSha256=P.sha(P.encoded(records)),**amount));contents.append(dict(path=root,metadataSha256=P.sha(P.encoded(records)),fullFileHashes=hashes,fullFileHashesSha256=P.sha(P.encoded(hashes)),allRegularBytesHashed=True,**amount))
  before=dict(schema='pow-audit30-retirement-root-custody-census-v1',targets=rows,retainedNonClusterEvidence=[],liveFive={},processReaders=dict(completeForObservedLiveProcesses=True,matches=[],candidateReadersObserved=False),privateControls=[{},{},{}],productionMutation=False)
  c=dict(schema='pow-audit30-retirement-content-custody-v1',targets=contents,noAtime=True,deletionAuthorized=False,productionMutation=False)
  return dict(rootBefore=before,content=c,rootAfter=copy.deepcopy(before))
 def test_exact_complete_byte_inventory_passes_local_contract(self):self.assertEqual(len(P.target_rows(self.fixture_custody())),4)
 def test_metadata_changed_hashes_missing_extra_duplicate_or_hardlink_refuse(self):
  mutators=[lambda v:v['rootAfter']['targets'][0].update(metadataSha256='b'*64),lambda v:v['content']['targets'][0].update(allRegularBytesHashed=False),lambda v:v['content']['targets'][0]['fullFileHashes'].append(copy.deepcopy(v['content']['targets'][0]['fullFileHashes'][0])),lambda v:v['rootBefore']['targets'][0]['records'][1].update(nlink=2),lambda v:v['rootBefore']['targets'][0]['records'][1].update(inode=True)]
  for mutate in mutators:
   value=self.fixture_custody();mutate(value)
   with self.subTest(mutate=mutate),self.assertRaises(P.Refused):P.target_rows(value)
 def test_reader_hit_unknown_endpoint_or_reordered_targets_refuse(self):
  for k,v in [('matches',[{'pid':1}]),('completeForObservedLiveProcesses',False),('candidateReadersObserved',True)]:
   value=self.fixture_custody();value['rootBefore']['processReaders'][k]=v
   with self.subTest(k=k),self.assertRaises(P.Refused):P.target_rows(value)
  value=self.fixture_custody();value['content']['targets'].reverse()
  with self.assertRaises(P.Refused):P.target_rows(value)
 def real_row(self):
  root=self.base/'job'/'cluster';root.mkdir(parents=True,mode=0o700);(root/'a').write_bytes(b'a'*3000);(root/'empty').mkdir();(root/'nested').mkdir();(root/'nested'/'b').write_bytes(b'\x00\n b \n');(root.parent/'retained').write_bytes(b'immutable evidence')
  for f in root.rglob('*'):
   f.chmod(0o700 if f.is_dir()else 0o600)
  with patch.object(H,'PG_UID',os.getuid()),patch.object(H,'PG_GID',os.getgid()),patch.object(H,'periodic'):
   records=H.walk(root,b'');hashes=[dict(path=r['path'],sha256=H.read_hash(Path(r['path']),r),metadataSha256=P.sha(P.encoded(r)))for r in records if r['kind']=='file']
  return dict(path=str(root),records=records,fullFileHashes=hashes)
 def delete(self,row,persist=None,heartbeat=None):
  progress=[]
  with patch.object(H,'PG_UID',os.getuid()),patch.object(H,'PG_GID',os.getgid()):P.retire_tree(row,persist or progress.append,heartbeat or(lambda:None))
  return progress
 def test_real_dirfd_unlinks_exact_bytes_preserves_job_and_other_evidence(self):
  row=self.real_row();root=Path(row['path']);progress=self.delete(row)
  self.assertFalse(root.exists());self.assertEqual((root.parent/'retained').read_bytes(),b'immutable evidence');self.assertEqual([r['path']for r in progress][-1],str(root));self.assertEqual(len(progress),len(row['records']));self.assertEqual(sum(r['kind']=='file'for r in progress),2)
 def test_same_length_changed_file_refuses_before_first_unlink(self):
  row=self.real_row();(Path(row['path'])/'a').write_bytes(b'b'*3000);progress=[]
  with self.assertRaises((P.Refused,H.Refused)):self.delete(row,progress.append)
  self.assertTrue((Path(row['path'])/'a').exists());self.assertEqual(progress,[])
 def test_rename_inode_replacement_refuses_and_outside_file_survives(self):
  row=self.real_row();root=Path(row['path']);(root/'a').unlink();(root/'a').write_bytes(b'a'*3000)
  with self.assertRaises((P.Refused,H.Refused)):self.delete(row)
  self.assertEqual((root.parent/'retained').read_bytes(),b'immutable evidence')
 def test_symlink_and_extra_unlisted_directory_member_refuse(self):
  for kind in('symlink','extra'):
   with self.subTest(kind=kind):
    self.tmp.cleanup();self.tmp=tempfile.TemporaryDirectory();self.base=Path(self.tmp.name);row=self.real_row();root=Path(row['path'])
    if kind=='symlink':(root/'a').unlink();(root/'a').symlink_to(root.parent/'retained')
    else:(root/'unlisted').write_bytes(b'extra')
    with self.assertRaises((P.Refused,H.Refused)):self.delete(row)
    self.assertEqual((root.parent/'retained').read_bytes(),b'immutable evidence')
 def test_hardlink_xattr_and_cross_identity_refuse(self):
  row=self.real_row();root=Path(row['path']);os.link(root/'a',self.base/'alias')
  with self.assertRaises((P.Refused,H.Refused)):self.delete(row)
  self.assertTrue((self.base/'alias').exists())
 def test_partial_failure_preserves_exact_removed_prefix_and_no_implicit_retry(self):
  row=self.real_row();progress=[]
  def receipt(value):
   progress.append(value)
   if len(progress)==1:raise RuntimeError('receipt unavailable after one unlink')
  with self.assertRaisesRegex(RuntimeError,'receipt unavailable'):self.delete(row,receipt)
  self.assertEqual(len(progress),1);self.assertFalse(Path(progress[0]['path']).exists());self.assertTrue(Path(row['path']).exists())
  with self.assertRaises((P.Refused,H.Refused)):self.delete(row)
 def test_unexpected_file_created_during_deletion_blocks_empty_dir_removal(self):
  row=self.real_row();root=Path(row['path']);progress=[]
  def persist(value):
   progress.append(value)
   if len(progress)==1:(root/'late').write_bytes(b'late')
  with self.assertRaises((P.Refused,H.Refused)):self.delete(row,persist)
  self.assertTrue((root/'late').exists());self.assertTrue(root.exists())
 def test_signal_midstream_never_deletes_current_file(self):
  row=self.real_row();count=0
  def heartbeat():
   nonlocal count
   count+=1
   if count==3:raise InterruptedError('signal at file read')
  with self.assertRaises(InterruptedError):self.delete(row,heartbeat=heartbeat)
  self.assertTrue(Path(row['path']).exists());self.assertEqual((Path(row['path'])/'a').read_bytes(),b'a'*3000)
 def test_fd_mode_owner_inode_xattr_comparison_stays_strict(self):
  row=self.real_row();record=next(r for r in row['records']if r['kind']=='file');fd=os.open(record['path'],os.O_RDONLY)
  try:
   P.fd_matches(fd,record)
   for k,v in [('inode',record['inode']+1),('uid',record['uid']+1),('mode',0o444),('bytes',record['bytes']+1),('ctimeNs',record['ctimeNs']+1)]:
    with self.subTest(k=k),self.assertRaises(P.Refused):P.fd_matches(fd,record|{k:v})
  finally:os.close(fd)
 def test_durable_oclusive_no_overwrite_and_parent_fsync(self):
  path=self.base/'receipt';P.durable(path,dict(status='partial'));original=path.read_bytes()
  with self.assertRaises(FileExistsError):P.durable(path,dict(status='replaced'))
  self.assertEqual(path.read_bytes(),original);self.assertEqual(stat.S_IMODE(path.stat().st_mode),0o600)
 def test_opslock_postflock_replacement_refuses(self):
  lock=self.base/'lock';lock.write_bytes(b'');lock.chmod(0o600);actual=Path.lstat
  def rootstamp(p):
   v=actual(p);return types.SimpleNamespace(st_dev=v.st_dev,st_ino=v.st_ino,st_mode=v.st_mode,st_uid=0,st_gid=0,st_nlink=v.st_nlink,st_size=v.st_size,st_mtime_ns=v.st_mtime_ns,st_ctime_ns=v.st_ctime_ns)
  def replace(fd,flags):lock.unlink();lock.write_bytes(b'');lock.chmod(0o600)
  realf=os.fstat
  def rootf(fd):
   v=realf(fd);return types.SimpleNamespace(st_dev=v.st_dev,st_ino=v.st_ino,st_mode=v.st_mode,st_uid=0,st_gid=0,st_nlink=v.st_nlink,st_size=v.st_size,st_mtime_ns=v.st_mtime_ns,st_ctime_ns=v.st_ctime_ns)
  with patch.object(P,'LOCK',lock),patch.object(Path,'lstat',rootstamp),patch.object(P.os,'fstat',rootf),patch.object(P.fcntl,'flock',side_effect=replace),self.assertRaisesRegex(P.Refused,'POSTFLOCK'):P.acquire_lock()
 def execution(self,fail=None):
  p=self.plan();out=self.base/'evidence';p['evidencePath']=str(out);raw=P.encoded(p);reads=[];removals=[];seq=[]
  def rootread(path,digest=None,cap=None,mode=None):
   if str(path)=='approval':return P.encoded(self.human(p)|{'planSha256':P.sha(raw)})
   if str(path)==P.__file__:return b'source'
   return Path(path).read_bytes()
  def retire(row,persist,heartbeat):
   removals.append(row['path']);persist(dict(path=row['path']+'/file',kind='file',outcome='unlinked'))
   if fail=='remove':raise InterruptedError('during delete')
   if fail in('blocked-int','blocked-term'):
    heartbeat();os.unlink(self.base/'blocked-sentinel');(self.base/'unexpected-unlink').write_bytes(b'signal swallowed')
  def fresh(*args):
   reads.append(args[3])
   if fail=='preflight':raise P.Refused('unknown reader')
  actual_durable=P.durable;threads=[]
  if fail in('blocked-int','blocked-term'):(self.base/'blocked-sentinel').write_bytes(b'preserve')
  def blocked_periodic():
   marker=self.base/'helper-started'
   def sender():
    deadline=time.monotonic()+3
    while not marker.exists()and time.monotonic()<deadline:time.sleep(.002)
    if marker.exists():os.kill(os.getpid(),signal.SIGINT if fail=='blocked-int'else signal.SIGTERM)
   thread=threading.Thread(target=sender);thread.start();threads.append(thread)
   # Real frozen H.command->subprocess.run->captured pipe/selector wait.
   H.command(['/usr/bin/python3','-I','-c',"from pathlib import Path;import time;Path("+repr(str(marker))+").write_text('ready');time.sleep(2);print('metadata')"])
  def durable_repeated(path,value):
   if path.name=='failed.json'and fail in('blocked-int','blocked-term'):
    os.kill(os.getpid(),signal.SIGINT);os.kill(os.getpid(),signal.SIGTERM)
   return actual_durable(path,value)
  original_lstat=Path.lstat
  def parent_lstat(path):
   v=original_lstat(path)
   if path==self.base:return types.SimpleNamespace(st_mode=v.st_mode,st_uid=0)
   return v
  with patch.object(P.os,'geteuid',return_value=0),patch.object(P.os,'getegid',return_value=0),patch.object(P.os,'uname',return_value=types.SimpleNamespace(nodename=P.HOST)),patch.object(P,'validate_plan',return_value=p),patch.object(P,'root_read',side_effect=rootread),patch.object(P,'sha',side_effect=lambda b:p['controllerSha256']if b==b'source'else hashlib.sha256(b).hexdigest()),patch.object(P,'proofs',return_value=({},[{'path':x}for x in P.TARGETS])),patch.object(P,'acquire_lock',side_effect=lambda:os.open('/dev/null',os.O_RDONLY)),patch.object(P,'EVIDENCE_PARENT',self.base),patch.object(Path,'lstat',parent_lstat),patch.object(P,'fresh',side_effect=fresh),patch.object(P,'check_target'),patch.object(P,'retire_tree',side_effect=retire),patch.object(H,'periodic',side_effect=blocked_periodic if fail in('blocked-int','blocked-term')else lambda:None),patch.object(P,'durable',side_effect=durable_repeated):
   if fail:
    with self.assertRaises((P.Refused,InterruptedError,P.RetirementInterrupted)):P.execute(p,raw,hashlib.sha256(raw).hexdigest(),True,'approval','a'*64)
   else:v=P.execute(p,raw,hashlib.sha256(raw).hexdigest(),True,'approval','a'*64);self.assertEqual(v['completedTargets'],list(P.TARGETS))
  for thread in threads:thread.join(timeout=4);self.assertFalse(thread.is_alive())
  return out,removals
 def test_failed_preflight_writes_zero_mutation_intent_failure(self):
  out,removed=self.execution('preflight');failed=json.loads((out/'failed.json').read_bytes());self.assertEqual(removed,[]);self.assertEqual(failed['completedTargets'],[]);self.assertEqual(failed['entryProgressCount'],0);self.assertTrue((out/'intent.json').exists());self.assertFalse((out/'completed.json').exists())
 def test_orchestration_midtarget_failure_retains_partial_chain_and_no_complete(self):
  out,removed=self.execution('remove');failed=json.loads((out/'failed.json').read_bytes());self.assertEqual(removed,[P.TARGETS[0]]);self.assertEqual(failed['completedTargets'],[]);self.assertEqual(failed['entryProgressCount'],1);self.assertEqual(failed['phase'],'dirfd-retirement');self.assertTrue(failed['partialRetirementRequiresNewExplicitReconciliation']);self.assertFalse((out/'completed.json').exists());last=Path(failed['lastEntryReceipt']['path']);self.assertEqual(hashlib.sha256(last.read_bytes()).hexdigest(),failed['lastEntryReceipt']['sha256'])
 def test_orchestration_exact_four_success_chains_entries_and_finalguards(self):
  out,removed=self.execution();self.assertEqual(removed,list(P.TARGETS));done=json.loads((out/'completed.json').read_bytes());self.assertEqual(done['entryProgressCount'],4);self.assertEqual(done['completedTargets'],list(P.TARGETS));self.assertFalse(done['automaticRetry']);self.assertTrue(done['retainedOct2BytesPreserved']);self.assertTrue(done['jobRootsAndNonclusterEvidencePreserved'])
 def test_actual_sigint_in_frozen_metadata_helper_stops_apply_and_keeps_failure(self):self.blocked_signal('blocked-int')
 def test_actual_sigterm_in_frozen_metadata_helper_stops_apply_and_keeps_failure(self):self.blocked_signal('blocked-term')
 def blocked_signal(self,kind):
  started=time.monotonic();out,removed=self.execution(kind);self.assertLess(time.monotonic()-started,1.5);self.assertTrue((self.base/'helper-started').exists());self.assertFalse((self.base/'unexpected-unlink').exists());self.assertEqual((self.base/'blocked-sentinel').read_bytes(),b'preserve');self.assertEqual(removed,[P.TARGETS[0]]);failed=json.loads((out/'failed.json').read_bytes());self.assertEqual(failed['errorClass'],'RetirementInterrupted');self.assertEqual(failed['entryProgressCount'],1);self.assertEqual(failed['completedTargets'],[]);self.assertFalse((out/'completed.json').exists());self.assertFalse(failed['automaticRetry']);self.assertTrue(failed['partialRetirementRequiresNewExplicitReconciliation']);self.assertTrue((out/'intent.json').exists());self.assertEqual(len(list(out.glob('*-partial.json'))),1)
 def test_all_other_controller_definitions_and_signal_category_unchanged(self):
  import ast
  before=ast.parse(Path('/tmp/pow-audit30-retire-exact-four-v2.py').read_bytes());after=ast.parse(Path(P.__file__).read_bytes())
  def definitions(tree):return {n.name:ast.dump(n,include_attributes=False)for n in tree.body if isinstance(n,(ast.FunctionDef,ast.ClassDef))}
  b,a=definitions(before),definitions(after);self.assertEqual(set(a)-set(b),{'dependency_contract'})
  for k in b:
   if k!='dependency_fence':self.assertEqual(a[k],b[k],k)
  self.assertTrue(issubclass(P.RetirementInterrupted,RuntimeError));self.assertFalse(issubclass(P.RetirementInterrupted,InterruptedError))
 def test_source_no_recursive_rm_no_service_or_pin_control_no_resume(self):
  source=Path(P.__file__).read_text();self.assertNotIn('shutil.rmtree',source);self.assertNotIn("'stop',",source);self.assertNotIn("'start',",source);self.assertNotIn('os.rename(',source);self.assertNotIn('os.chmod(',source);self.assertIn('EVIDENCE_EXISTS_NO_RESUME',source);self.assertIn("signal.signal(number,signal.SIG_IGN)",source)
 def test_saved_custody_source_sha_exact(self):self.assertEqual(hashlib.sha256(Path('/tmp/pow-audit30-retirement-cluster-closure-v1.py').read_bytes()).hexdigest(),P.CUSTODY_SHA)

class DependencyTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.base=Path(self.tmp.name).resolve();self.small=self.base/'proof.json';self.big=self.base/'private-plan.json';self.small.write_bytes(b'p'*7010);self.big.write_bytes(b'x'*6713728);self.small.chmod(0o600);self.big.chmod(0o440)
  self.contract={str(p):dict(sha256=P.sha(p.read_bytes()),bytes=p.stat().st_size,uid=os.getuid(),gid=os.getgid(),mode=stat.S_IMODE(p.stat().st_mode),nlink=1)for p in(self.small,self.big)}
 def tearDown(self):self.tmp.cleanup()
 def row(self,p):
  s=p.lstat();return dict(path=str(p),sha256=P.sha(p.read_bytes()),metadata=dict(device=s.st_dev,inode=s.st_ino,mode=stat.S_IMODE(s.st_mode),uid=s.st_uid,gid=s.st_gid,nlink=s.st_nlink,bytes=s.st_size,mtimeNs=s.st_mtime_ns,ctimeNs=s.st_ctime_ns))
 def review(self):return {'dependencyFiles':[self.row(self.small),self.row(self.big)]}
 def fence(self,v):
  with patch.dict(P.KNOWN_DEPENDENCIES,self.contract,clear=True):P.dependency_fence(v)
 def test_exact_two_source_paths_and_saved_authority_bytes(self):
  expected={
   '/data/proofofwork-audit30-inspect-20261003T014100Z/exact-sixteen-readonly-finalization-v1/completed.json':dict(sha256='d818545fa493f1032b3b6bfb7b1ba4b8738e3b15968c3f0ed949a0d1bb09bce8',bytes=7010,uid=108,gid=112,mode=0o600,nlink=1),
   '/usr/local/lib/proofofwork-audit30-transition-stream/20261003T030000Z/phase4-private-plan.json':dict(sha256='4ac3a8d9b4b79befd36abc590731b1bc8f2e6c83919d5f6427c34c58a6ddba00',bytes=6713728,uid=0,gid=112,mode=0o440,nlink=1)}
  self.assertEqual(P.KNOWN_DEPENDENCIES,expected)
  proof=Path('/tmp/pow-audit30-private-sixteen-readonly-finalization-completed-public-v1.json').read_bytes();self.assertEqual(len(proof),7010);self.assertEqual(P.sha(proof),next(iter(expected.values()))['sha256'])
  staged=json.loads(Path('/tmp/pow-audit30-pg-closure-native-stage-v2.stdout').read_bytes())['privatePlan'];self.assertEqual(staged['metadata']['bytes'],6713728);self.assertEqual(staged['sha256'],list(expected.values())[1]['sha256'])
  source=Path('/tmp/pow-audit30-transition-stream-controller-v7.py').read_text();self.assertIn("m['uid']==0 and m['gid']==who.pw_gid and m['mode']==0o440 and m['nlink']==1",source)
 def known_row(self,path,spec):
  return dict(path=path,sha256=spec['sha256'],metadata=dict(device=64514,inode=20,mtimeNs=100,ctimeNs=100,**{k:v for k,v in spec.items()if k!='sha256'}))
 def test_known_exact_hash_owner_group_mode_nlink_size_only(self):
  for path,spec in P.KNOWN_DEPENDENCIES.items():
   r=self.known_row(path,spec);self.assertEqual(P.dependency_contract(Path(path),r),(spec['bytes'],(spec['uid'],)))
   for k in ('uid','gid','mode','nlink','bytes'):
    bad=copy.deepcopy(r);bad['metadata'][k]+=1
    with self.subTest(path=path,k=k),self.assertRaisesRegex(P.Refused,'KNOWN_DEPENDENCY'):P.dependency_contract(Path(path),bad)
   bad=copy.deepcopy(r);bad['sha256']='0'*64
   with self.assertRaisesRegex(P.Refused,'KNOWN_DEPENDENCY'):P.dependency_contract(Path(path),bad)
   for k in ('inode','device','mtimeNs','ctimeNs'):
    bad=copy.deepcopy(r);bad['metadata'][k]=True
    with self.assertRaisesRegex(P.Refused,'KNOWN_DEPENDENCY'):P.dependency_contract(Path(path),bad)
 def test_sibling_alias_spelling_gets_no_exception(self):
  for path,spec in P.KNOWN_DEPENDENCIES.items():
   for other in(path+'.other',str(Path(path).parent/'..'/Path(path).name),path.replace('014100Z','005512Z')):
    if other==path:continue
    self.assertEqual(P.dependency_contract(Path(other),self.known_row(other,spec)),(4*1024**2,(0,1000)))
 def test_both_known_dependencies_required_and_duplicates_refuse_before_open(self):
  v=self.review()
  for files in(v['dependencyFiles'][:1],v['dependencyFiles'][1:],v['dependencyFiles']+[v['dependencyFiles'][0]]):
   with patch.object(P.os,'open',side_effect=AssertionError('must refuse before opening')),self.assertRaisesRegex(P.Refused,'DEPENDENCY_BOUND'):self.fence({'dependencyFiles':files})
 def test_real_large_dependency_full_read_passes_exact_local_contract(self):self.fence(self.review())
 def test_generic_large_file_limit_is_unchanged(self):
  with patch.dict(P.KNOWN_DEPENDENCIES,{},clear=True),self.assertRaisesRegex(P.Refused,'DEPENDENCY_IDENTITY'):P.dependency_fence({'dependencyFiles':[self.row(self.big)]})
 def test_generic_small_root_or_powadmin_contract_still_passes(self):
  p=self.base/'other';p.write_bytes(b'generic dependency');p.chmod(0o600);v=self.review();v['dependencyFiles'].append(self.row(p));self.fence(v)
 def test_known_content_corruption_with_fresh_metadata_still_refuses(self):
  self.big.chmod(0o600);self.big.write_bytes(b'y'*6713728);self.big.chmod(0o440);v=self.review();v['dependencyFiles'][1]['sha256']=self.contract[str(self.big)]['sha256']
  with self.assertRaisesRegex(P.Refused,'DEPENDENCY_BYTES'):self.fence(v)
 def test_wrong_fresh_inode_or_timestamp_refuses(self):
  for key in('inode','mtimeNs','ctimeNs','device'):
   v=self.review();v['dependencyFiles'][1]['metadata'][key]+=1
   with self.subTest(key=key),self.assertRaisesRegex(P.Refused,'DEPENDENCY_IDENTITY'):self.fence(v)
 def test_real_symlink_hardlink_and_xattr_refuse(self):
  v=self.review();alias=self.base/'alias';os.link(self.big,alias)
  with self.assertRaisesRegex(P.Refused,'DEPENDENCY_IDENTITY'):self.fence(v)
  alias.unlink();self.big.unlink();self.big.symlink_to(self.small)
  with self.assertRaises(P.Refused):self.fence(v)
  self.big.unlink();self.big.write_bytes(b'x'*6713728);self.big.chmod(0o440);v=self.review()
  try:os.setxattr(self.big,'user.audit30',b'drift')
  except OSError:return
  with self.assertRaisesRegex(P.Refused,'DEPENDENCY_IDENTITY'):self.fence(v)
 def test_actual_named_replacement_during_read_refuses(self):
  v=self.review();original=P.os.fdopen
  class Replacing:
   def __init__(this,fd,*args):this.stream=original(fd,*args)
   def __enter__(this):return this
   def __exit__(this,*args):return this.stream.__exit__(*args)
   def fileno(this):return this.stream.fileno()
   def read(this,cap):
    b=this.stream.read(cap)
    if len(b)==6713728:
     replacement=self.base/'new';replacement.write_bytes(b);replacement.chmod(0o440);replacement.replace(self.big)
    return b
  with patch.object(P.os,'fdopen',Replacing),self.assertRaisesRegex(P.Refused,'DEPENDENCY_FD_DRIFT|DEPENDENCY_BYTES'):self.fence(v)
  self.assertEqual(self.big.read_bytes(),b'x'*6713728)
 def test_actual_fd_content_change_during_read_refuses(self):
  v=self.review();original=P.os.fdopen
  class Changing:
   def __init__(this,fd,*args):this.stream=original(fd,*args)
   def __enter__(this):return this
   def __exit__(this,*args):return this.stream.__exit__(*args)
   def fileno(this):return this.stream.fileno()
   def read(this,cap):
    b=this.stream.read(cap)
    if len(b)==6713728:
     self.big.chmod(0o600)
     with self.big.open('r+b')as f:f.write(b'z')
     self.big.chmod(0o440)
    return b
  with patch.object(P.os,'fdopen',Changing),self.assertRaisesRegex(P.Refused,'DEPENDENCY_FD_DRIFT'):self.fence(v)


class ObservedCustodyTests(unittest.TestCase):
 def actual(self):
  raw=Path('/tmp/pow-audit30-retained-repair-dependency-bridge-native-current4-v5.stdout').read_bytes();self.assertEqual(len(raw),60114);self.assertEqual(P.sha(raw),'285dfa1b5349f2408e8366a0341920152588145e22edb43f570f9aa027519090');return json.loads(raw)
 def declared(self):return [{'path':path,'sha256':v['sha256'],'metadata':copy.deepcopy(v['metadata'])}for path,v in P.OBSERVED_CUSTODY_DEPENDENCIES.items()]
 def test_exact_three_observed_paths_and_full_metadata_equal_public_capture(self):
  expected={r['path']:{'sha256':r['sha256'],'metadata':r['metadata']}for r in self.actual()['retirementContractCompatibility']['blocks']};self.assertEqual(P.OBSERVED_CUSTODY_DEPENDENCIES,expected);self.assertEqual(len(expected),3)
  for r in self.declared():self.assertEqual(P.dependency_contract(Path(r['path']),r),(r['metadata']['bytes'],(r['metadata']['uid'],)))
 def test_node_exact_hash_equals_frozen_root_node_constant(self):
  import ast
  path=Path('/tmp/pow-audit30-production-sixteen-root-control-v3.py');raw=path.read_bytes();self.assertEqual(P.sha(raw),'b989a3f2395e7cbf13cb2d3dbd2d258a3fd21867131e41644c094772aba11168');a={n.targets[0].id:ast.literal_eval(n.value)for n in ast.parse(raw).body if isinstance(n,ast.Assign)and len(n.targets)==1 and isinstance(n.targets[0],ast.Name)and isinstance(n.value,ast.Constant)};r=P.OBSERVED_CUSTODY_DEPENDENCIES['/opt/node-v24.18.0-linux-x64/bin/node'];self.assertEqual(r['sha256'],a['NODE_SHA']);self.assertEqual(r['metadata']['mode'],0o755);self.assertEqual(r['metadata']['bytes'],123655872)
 def test_all_nine_metadata_fields_hash_and_bool_drift_refuse(self):
  for row in self.declared():
   for key in row['metadata']:
    for value in(row['metadata'][key]+1,True):
     changed=copy.deepcopy(row);changed['metadata'][key]=value
     with self.subTest(path=row['path'],key=key,value=value),self.assertRaisesRegex(P.Refused,'OBSERVED_CUSTODY_DEPENDENCY_CONTRACT'):P.dependency_contract(Path(row['path']),changed)
   changed=copy.deepcopy(row);changed['sha256']='0'*64
   with self.assertRaisesRegex(P.Refused,'OBSERVED_CUSTODY_DEPENDENCY_CONTRACT'):P.dependency_contract(Path(row['path']),changed)
   for mutation in(lambda r:r['metadata'].pop('inode'),lambda r:r['metadata'].update(extra=0)):
    changed=copy.deepcopy(row);mutation(changed)
    with self.assertRaisesRegex(P.Refused,'OBSERVED_CUSTODY_DEPENDENCY_CONTRACT'):P.dependency_contract(Path(row['path']),changed)
 def test_similar_paths_aliases_siblings_and_other_versions_get_no_exception(self):
  for row in self.declared():
   path=row['path'];others=(path+'.other',str(Path(path).parent/'..'/Path(path).name),path.replace('014100Z','005512Z'),path.replace('v24.18.0','v24.18.1'))
   for other in others:
    if other==path:continue
    changed=copy.deepcopy(row);changed['path']=other;self.assertEqual(P.dependency_contract(Path(other),changed),(4*1024**2,(0,1000)))
 def test_observed_paths_optional_original_two_mandatory_still_exact(self):
  import ast
  old={n.name:ast.dump(n,include_attributes=False)for n in ast.parse(Path('/tmp/pow-audit30-retire-exact-four-v3.py').read_bytes()).body if isinstance(n,(ast.FunctionDef,ast.ClassDef))};new={n.name:ast.dump(n,include_attributes=False)for n in ast.parse(Path(P.__file__).read_bytes()).body if isinstance(n,(ast.FunctionDef,ast.ClassDef))};self.assertEqual(old.keys(),new.keys())
  for name in old:
   if name!='dependency_contract':self.assertEqual(old[name],new[name],name)
  self.assertEqual(len(P.KNOWN_DEPENDENCIES),2);self.assertIn('set(KNOWN_DEPENDENCIES)<=',Path(P.__file__).read_text());self.assertNotIn('set(OBSERVED_CUSTODY_DEPENDENCIES)<=',Path(P.__file__).read_text())
 def test_saved_162_declarations_owner_size_aggregate_compatibility_only(self):
  a=self.actual();d=a['dependency'];prefix=Path('/usr/local/lib/proofofwork-audit30-transition-stream/20261003T030000Z/pg-dependencies');rows=d['files']+[dict(path=str(prefix/r['path']),metadata=r['metadata'],sha256=r['sha256'])for r in d['members']if r['kind']=='file'];self.assertEqual(len(rows),162);total=0
  for r in rows:
   cap,owners=P.dependency_contract(Path(r['path']),r);self.assertIn(r['metadata']['uid'],owners);self.assertLessEqual(r['metadata']['bytes'],cap);total+=r['metadata']['bytes']
  self.assertEqual(total,132695960);self.assertLess(total,192*1024**2);self.assertFalse(a['allDependenciesClosed']);self.assertFalse(a['retirementContractCompatibility']['fullRetirementDependencyAdmissionExecuted'])
 def local_fixture(self):
  tmp=tempfile.TemporaryDirectory();self.addCleanup(tmp.cleanup);p=Path(tmp.name).resolve()/'node';p.write_bytes(b'n'*(4*1024**2+1));p.chmod(0o755);s=p.lstat();m=dict(device=s.st_dev,inode=s.st_ino,mode=stat.S_IMODE(s.st_mode),uid=s.st_uid,gid=s.st_gid,nlink=s.st_nlink,bytes=s.st_size,mtimeNs=s.st_mtime_ns,ctimeNs=s.st_ctime_ns);r=dict(path=str(p),metadata=m,sha256=P.sha(p.read_bytes()));spec={str(p):dict(metadata=copy.deepcopy(m),sha256=r['sha256'])};return p,r,spec
 def test_actual_over_generic_boundary_full_read_exact_exception_passes(self):
  p,r,spec=self.local_fixture()
  with patch.dict(P.KNOWN_DEPENDENCIES,{},clear=True),patch.dict(P.OBSERVED_CUSTODY_DEPENDENCIES,spec,clear=True):P.dependency_fence({'dependencyFiles':[r]})
  with patch.dict(P.KNOWN_DEPENDENCIES,{},clear=True),patch.dict(P.OBSERVED_CUSTODY_DEPENDENCIES,{},clear=True),self.assertRaisesRegex(P.Refused,'DEPENDENCY_IDENTITY'):P.dependency_fence({'dependencyFiles':[r]})
 def test_actual_fresh_metadata_change_cannot_rebind_exception(self):
  p,r,spec=self.local_fixture();p.chmod(0o700);r['metadata']['mode']=0o700;r['metadata']['ctimeNs']=p.lstat().st_ctime_ns
  with patch.dict(P.KNOWN_DEPENDENCIES,{},clear=True),patch.dict(P.OBSERVED_CUSTODY_DEPENDENCIES,spec,clear=True),patch.object(P.os,'open',side_effect=AssertionError('must refuse before open')),self.assertRaisesRegex(P.Refused,'OBSERVED_CUSTODY_DEPENDENCY_CONTRACT'):P.dependency_fence({'dependencyFiles':[r]})
 def test_exact_exception_file_symlink_and_hardlink_still_refuse(self):
  p,r,spec=self.local_fixture();alias=p.parent/'alias';os.link(p,alias)
  with patch.dict(P.KNOWN_DEPENDENCIES,{},clear=True),patch.dict(P.OBSERVED_CUSTODY_DEPENDENCIES,spec,clear=True),self.assertRaisesRegex(P.Refused,'DEPENDENCY_IDENTITY'):P.dependency_fence({'dependencyFiles':[r]})
  alias.unlink();p.unlink();alias.write_bytes(b'preserve');p.symlink_to(alias)
  with patch.dict(P.KNOWN_DEPENDENCIES,{},clear=True),patch.dict(P.OBSERVED_CUSTODY_DEPENDENCIES,spec,clear=True),self.assertRaisesRegex(P.Refused,'DEPENDENCY_IDENTITY'):P.dependency_fence({'dependencyFiles':[r]})
 def test_aggregate_192mib_still_refuses_exact_exception(self):
  # Sparse local test keeps actual allocation small; old full-read behavior and
  # cumulative 192 MiB bound are exercised without permitting this native path.
  tmp=tempfile.TemporaryDirectory();self.addCleanup(tmp.cleanup);p=Path(tmp.name).resolve()/'too-big'
  with p.open('wb')as f:f.truncate(192*1024**2+1)
  p.chmod(0o600);s=p.lstat();m=dict(device=s.st_dev,inode=s.st_ino,mode=stat.S_IMODE(s.st_mode),uid=s.st_uid,gid=s.st_gid,nlink=s.st_nlink,bytes=s.st_size,mtimeNs=s.st_mtime_ns,ctimeNs=s.st_ctime_ns);r=dict(path=str(p),metadata=m,sha256=P.sha(p.read_bytes()));spec={str(p):dict(metadata=m,sha256=r['sha256'])}
  with patch.dict(P.KNOWN_DEPENDENCIES,{},clear=True),patch.dict(P.OBSERVED_CUSTODY_DEPENDENCIES,spec,clear=True),self.assertRaisesRegex(P.Refused,'DEPENDENCY_BYTES'):P.dependency_fence({'dependencyFiles':[r]})

if __name__=='__main__':unittest.main()
