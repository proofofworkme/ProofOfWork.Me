#!/usr/bin/python3 -I
import copy,datetime,hashlib,importlib.util,json,os,signal,stat,tempfile,threading,time,types,unittest
from pathlib import Path
from unittest.mock import patch

def imported(name,path):
 spec=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
P=imported('four','/tmp/pow-audit30-retire-exact-four-v2.py')
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
 def test_only_signal_exception_type_changed_and_cannot_be_selector_eintr(self):
  old=Path('/tmp/pow-audit30-retire-exact-four-v1.py').read_text();new=Path(P.__file__).read_text().replace('class RetirementInterrupted(RuntimeError):pass\n','').replace("raise RetirementInterrupted('EXACT_FOUR_INTERRUPTED')","raise InterruptedError('EXACT_FOUR_INTERRUPTED')");self.assertEqual(new,old);self.assertTrue(issubclass(P.RetirementInterrupted,RuntimeError));self.assertFalse(issubclass(P.RetirementInterrupted,InterruptedError))
 def test_source_no_recursive_rm_no_service_or_pin_control_no_resume(self):
  source=Path(P.__file__).read_text();self.assertNotIn('shutil.rmtree',source);self.assertNotIn("'stop',",source);self.assertNotIn("'start',",source);self.assertNotIn('os.rename(',source);self.assertNotIn('os.chmod(',source);self.assertIn('EVIDENCE_EXISTS_NO_RESUME',source);self.assertIn("signal.signal(number,signal.SIG_IGN)",source)
 def test_saved_custody_source_sha_exact(self):self.assertEqual(hashlib.sha256(Path('/tmp/pow-audit30-retirement-cluster-closure-v1.py').read_bytes()).hexdigest(),P.CUSTODY_SHA)
if __name__=='__main__':unittest.main()
