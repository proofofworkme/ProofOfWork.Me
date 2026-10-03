#!/usr/bin/python3 -I
"""Pure local filesystem/admission tests; no PostgreSQL, SSH or service calls."""
import copy
import datetime as dt
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import signal
import struct
import subprocess
import tempfile
import time
from types import SimpleNamespace
import unittest
from unittest.mock import patch

PATH=Path('/tmp/pow-audit30-saved-snapshot-inspect-v2.py')
spec=importlib.util.spec_from_file_location('inspection',PATH)
I=importlib.util.module_from_spec(spec);spec.loader.exec_module(I)
I.load_guard(Path('/home/sixer/ProofOfWork.Me/deploy/audit30/restore-latest-logical.py'))

class InspectorTests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.base=Path(self.temp.name)
  self.source=self.base/'source';self.source.mkdir(mode=0o700)
  (self.source/'base').mkdir(mode=0o700)
  (self.source/'pg_tblspc').mkdir(mode=0o700)
  for name,raw in [('PG_VERSION',b'16\n'),('postgresql.auto.conf',b'# harmless\n'),('base/123',b'\x00\xff\n'+b'pages'*1000)]:
   p=self.source/name;p.write_bytes(raw);p.chmod(0o600)
  self.uid=os.getuid();self.gid=os.getgid()
 def tearDown(self):self.temp.cleanup()
 def tree(self):return I.inventory_tree(self.source,self.uid,self.gid)
 def inventory(self):
  tree=self.tree();meta=(self.source/'PG_VERSION');m=I.G.metadata(meta)
  return dict(schema=I.INVENTORY_SCHEMA,sourceJob='/data/proofofwork-audit30-restore-20261003T010000Z',sourceUnit='proofofwork-audit30-logical-restore-20261003T010000Z.service',postgresUid=self.uid,postgresGid=self.gid,
   receiptBindings={x:dict(metadata=m,sha256='a'*64) for x in ['completed.json','table-row-parity.json','offline-page-check.json','saved-snapshot-fence.json']},
   sourceControl=dict(systemIdentifier='12345',controlOutputSha256='a'*64,state='shut down',checksums='1',unit=dict(LoadState='loaded',ActiveState='inactive',MainPID='0',SubState='dead')),
   snapshot=dict(canonicalBlock=dict(height=1000000,hash='a'*64),confirmedTransactionMaxHeight=1000000,transitionMaxHeight=1000000,transitionMaxHash='b'*64,precisionMarkerStatus='complete',precisionActivationHeight='960601'),**tree)
 def plan(self):
  now=dt.datetime.now(dt.timezone.utc)
  lock=self.base/'backup.lock'
  if not lock.exists():lock.touch(mode=0o600)
  return dict(schema=I.SCHEMA,approvalSha256=I.APPROVAL_SHA,controllerSha256='c'*64,guardSha256=I.GUARD_SHA,host='node',runId='20261003T020000Z',unit='proofofwork-audit30-snapshot-inspect-20261003T020000Z.service',job='/data/proofofwork-audit30-inspect-20261003T020000Z',source='/data/proofofwork-audit30-restore-20261003T010000Z',inventory=dict(fileName='cluster-inventory.json',sha256='a'*64),backupLock=I.G.metadata(lock),backupWindow=dict(preflightAtUtc=now.isoformat(),nextScheduledAtUtc=(now+dt.timedelta(minutes=90)).isoformat()),liveServices={n:dict(MainPID='10',InvocationID='a'*32) for n in I.G.SERVICES},idPage=dict(afterHeight=999990,throughHeight=1000000,limit=2,precisionActivationHeight=960601),phase4=dict(privatePlanSha256='a'*64,dependencyInventorySha256='b'*64,pgEntrySha256='c'*64,node=dict(metadata=I.G.metadata(lock)|{'mode':0o755,'uid':0},sha256='d'*64)))
 def test_full_binary_copy_preserves_content_mode_owner_mtime(self):
  expected=self.tree();target=self.base/'target';target.mkdir(mode=0o700)
  copied=I.inventory_tree(self.source,self.uid,self.gid,expected=expected['records'],copy_to=target)
  actual=I.inventory_tree(target,self.uid,self.gid)
  self.assertEqual(copied,expected);self.assertTrue(I.copy_equivalence(expected['records'],actual['records']))
  self.assertEqual((target/'base/123').read_bytes(),(self.source/'base/123').read_bytes())
  self.assertNotEqual((target/'base/123').stat().st_ino,(self.source/'base/123').stat().st_ino)
 def test_source_content_change_refuses_and_never_changes_source(self):
  expected=self.tree();p=self.source/'base/123';p.write_bytes(b'new');target=self.base/'target';target.mkdir(mode=0o700)
  with self.assertRaisesRegex(ValueError,'inventory differs'):I.inventory_tree(self.source,self.uid,self.gid,expected=expected['records'],copy_to=target)
  self.assertEqual(p.read_bytes(),b'new')
 def test_source_symlink_refused(self):
  (self.source/'alias').symlink_to('base/123')
  with self.assertRaises(ValueError):self.tree()
 def test_source_hardlink_refused(self):
  os.link(self.source/'base/123',self.source/'hard')
  with self.assertRaises(ValueError):self.tree()
 def test_source_special_file_refused(self):
  os.mkfifo(self.source/'fifo',0o600)
  with self.assertRaises(ValueError):self.tree()
 def test_source_weak_file_mode_refused(self):
  (self.source/'base/123').chmod(0o644)
  with self.assertRaises(ValueError):self.tree()
 def test_source_xattr_refused(self):
  os.setxattr(self.source/'base/123','user.inspector',b'evidence')
  with self.assertRaises(ValueError):self.tree()
 def test_entry_bound_refusal(self):
  with patch.object(I,'MAX_ENTRIES',2):
   with self.assertRaisesRegex(ValueError,'entry bound'):self.tree()
 def test_total_byte_bound_refusal(self):
  with patch.object(I,'MAX_BYTES',10):
   with self.assertRaisesRegex(ValueError,'byte bound'):self.tree()
 def test_no_overwrite_copy_target(self):
  target=self.base/'target';target.mkdir(mode=0o700);(target/'keep').write_bytes(b'evidence')
  with self.assertRaises(ValueError):I.inventory_tree(self.source,self.uid,self.gid,copy_to=target)
  self.assertEqual((target/'keep').read_bytes(),b'evidence')
 def test_copy_target_symlink_refused(self):
  target=self.base/'alias';target.symlink_to(self.source,target_is_directory=True)
  with self.assertRaises(ValueError):I.inventory_tree(self.source,self.uid,self.gid,copy_to=target)
 def test_midread_source_metadata_change_refuses(self):
  seen=0
  def heartbeat():
   nonlocal seen
   seen+=1
   if seen==7:os.utime(self.source/'base/123',ns=(1,1))
  with self.assertRaises(ValueError):I.inventory_tree(self.source,self.uid,self.gid,heartbeat=heartbeat,expected=self.tree()['records'])
 def test_valid_inventory(self):self.assertEqual(I.validate_inventory(self.inventory())['entries'],6)
 def test_duplicate_missing_parent_and_wrong_order_inventory(self):
  for variant in ('duplicate','missing-parent','reversed'):
   inv=self.inventory()
   if variant=='duplicate':inv['records'].append(copy.deepcopy(inv['records'][0]))
   elif variant=='missing-parent':inv['records']=[r for r in inv['records'] if r['path']!='base']
   else:inv['records'].reverse()
   inv['recordsSha256']=I.digest(inv['records']);inv['entries']=len(inv['records'])
   with self.subTest(variant=variant),self.assertRaises(ValueError):I.validate_inventory(inv)
 def test_stopped_checksum_snapshot_required(self):
  for group,key,value in [('sourceControl','state','in production'),('sourceControl','checksums','0'),('snapshot','precisionMarkerStatus','pending'),('snapshot','transitionMaxHeight',1000001)]:
   inv=self.inventory();inv[group][key]=value
   with self.subTest(key=key),self.assertRaises(ValueError):I.validate_inventory(inv)
 def test_receipt_bindings_complete(self):
  inv=self.inventory();del inv['receiptBindings']['offline-page-check.json']
  with self.assertRaises(ValueError):I.validate_inventory(inv)
 def test_valid_plan(self):self.assertEqual(I.validate_plan(self.plan())['idPage']['limit'],2)
 def test_wrong_job_unit_guard_approval_and_source(self):
  for key,value in [('job','/var/lib/postgresql/16/main'),('unit','postgresql.service'),('guardSha256','0'*64),('approvalSha256','0'*64),('source','/var/lib/postgresql/16/main')]:
   plan=self.plan();plan[key]=value
   with self.subTest(key=key),self.assertRaises(ValueError):I.validate_plan(plan)
 def test_unbounded_or_wrong_query_parameters(self):
  for key,value in [('limit',101),('afterHeight',True),('throughHeight',1003000),('precisionActivationHeight',0)]:
   plan=self.plan();plan['idPage'][key]=value
   with self.subTest(key=key),self.assertRaises(ValueError):I.validate_plan(plan)
 def test_exact_before_after_sql_binding_5_parameters(self):
  for file in ['/tmp/pow-audit30-phase6-local-counted-diagnostic-v2-exact-id-transition-page.sql','/tmp/pow-audit30-phase6-id-read-projection-after-v1.sql']:
   raw=Path(file).read_bytes();got=I.bind_id_sql(raw,self.plan()['idPage'])
   self.assertIn(b'READ ONLY',got);self.assertIn(b'= 960601',got);self.assertNotIn(b'$1',got)
   with self.assertRaises(ValueError):I.bind_id_sql(raw+b'\nSELECT 1;',self.plan()['idPage'])
   with self.assertRaises(ValueError):I.bind_id_sql(raw,self.plan()['idPage']|{'limit':'1; SELECT pg_sleep(9)'})
 def test_copy_equivalence_rejects_content_mode_owner_mtime(self):
  rows=self.tree()['records']
  for key,val in [('sha256','f'*64),('mode',0o644),('uid',999999),('mtimeNs',0)]:
   changed=copy.deepcopy(rows);r=next(r for r in changed if r['kind']=='file')
   if key=='sha256':r[key]=val
   else:r['metadata'][key]=val
   with self.subTest(key=key),self.assertRaises(ValueError):I.copy_equivalence(rows,changed)
 def test_capture_total_bound_and_exclusive_evidence(self):
  class Runner:
   def run(self,*args,**kw):kw['sink'](b'1234');kw['sink'](b'5678')
  with patch.object(I,'MAX_CAPTURE',6):
   with self.assertRaises(ValueError):I.capture(Runner(),self.base,b'SELECT 1','sample')
  self.assertEqual((self.base/'sample.copy').read_bytes(),b'1234\n')
  with self.assertRaises(FileExistsError):I.capture(Runner(),self.base,b'SELECT 1','sample')
 def test_bounded_runner_uses_own60minute_deadline(self):
  class Runner:
   def __init__(self,*args):pass
   def run(self,*args,**kw):return kw['timeout']
  with patch.object(I.G,'Runner',Runner):
   runner=I.BoundedRunner(self.base,None,time.monotonic()-3590)
   self.assertLess(runner.run(['true'],timeout=7200),11)
   runner.started=time.monotonic()-3601
   with self.assertRaises(TimeoutError):runner.run(['true'])
 def test_clear_window75_minutes_and_current_schedule(self):
  plan=self.plan();now=dt.datetime.now(dt.timezone.utc).replace(microsecond=0);deadline=now+dt.timedelta(minutes=75)
  plan['backupWindow']=dict(preflightAtUtc=now.isoformat(),nextScheduledAtUtc=deadline.isoformat())
  def props(name,fields):
   return dict(ActiveState='inactive') if name.endswith('.service') else dict(ActiveState='active',NextElapseUSecRealtime=deadline.strftime('%a %Y-%m-%d %H:%M:%S UTC'))
  with patch.object(I.G,'system_properties',props):
   I.check_window(plan,now)
   with self.assertRaises(ValueError):I.check_window(plan,now+dt.timedelta(seconds=1))
 def test_guard_hash_refusal_before_import(self):
  fake=self.base/'guard.py';fake.write_text('raise RuntimeError("executed")')
  with self.assertRaisesRegex(ValueError,'Frozen guard'):I.load_guard(fake)
 def test_actual_fresh_guard_atime_advance_is_not_identity_drift(self):
  path=self.base/'copied-guard.py';path.write_bytes(Path('/home/sixer/ProofOfWork.Me/deploy/audit30/restore-latest-logical.py').read_bytes());path.chmod(0o440)
  os.utime(path,ns=(1,path.stat().st_mtime_ns));before=path.stat()
  loaded=I.load_guard(path)
  self.assertEqual(loaded.__file__,str(path));self.assertGreater(path.stat().st_atime_ns,before.st_atime_ns);self.assertEqual(path.stat().st_mtime_ns,before.st_mtime_ns)
  # Restore the canonical guard path used by other fixtures/native helpers.
  I.load_guard(Path('/home/sixer/ProofOfWork.Me/deploy/audit30/restore-latest-logical.py'))
 def test_guard_metadata_drift_during_verified_read_refuses(self):
  path=self.base/'copied-guard.py';path.write_bytes(Path('/home/sixer/ProofOfWork.Me/deploy/audit30/restore-latest-logical.py').read_bytes());path.chmod(0o440)
  original=Path.read_bytes
  def drift(p):
   raw=original(p)
   if p==path:p.chmod(0o400)
   return raw
  with patch.object(Path,'read_bytes',drift),self.assertRaisesRegex(ValueError,'Frozen guard'):I.load_guard(path)
 def test_actual_runtime_boundaries_and_refusals(self):
  plan=self.plan();plan['host']=os.uname().nodename
  desired={**I.G.UNIT_PROPERTIES,'RuntimeMaxUSec':'1h','ReadWritePaths':plan['job'],'ReadOnlyPaths':str(I.G.BACKUPS)+' '+plan['source'],'InaccessiblePaths':' '.join([*I.G.UNIT_INACCESSIBLE,plan['source']+'/socket'])}
  original=Path.read_text
  def read(path,*args,**kw):return '0::/system.slice/'+plan['unit']+'\n' if path==Path('/proc/self/cgroup') else original(path,*args,**kw)
  with patch.object(I.pwd,'getpwnam',return_value=SimpleNamespace(pw_uid=os.geteuid())),patch.object(Path,'read_text',read),patch.object(I.os,'listdir',side_effect=PermissionError),patch.object(I.os,'statvfs',return_value=SimpleNamespace(f_flag=os.ST_RDONLY)):
   with patch.object(I.G,'system_properties',return_value=desired):I.check_runtime(plan)
   for key,value in [('RuntimeMaxUSec','2h'),('PrivateNetwork','no'),('ReadOnlyPaths',str(I.G.BACKUPS)),('InaccessiblePaths',' '.join(I.G.UNIT_INACCESSIBLE)),('ReadWritePaths',plan['job']+' '+plan['source'])]:
    weaker=desired|{key:value}
    with self.subTest(key=key),patch.object(I.G,'system_properties',return_value=weaker),self.assertRaises(ValueError):I.check_runtime(plan)
   with patch.object(I.G,'system_properties',return_value=desired),patch.object(I.os,'statvfs',return_value=SimpleNamespace(f_flag=0)),self.assertRaises(ValueError):I.check_runtime(plan)
 def test_source_controls_refuse_running_before_any_command(self):
  job=self.base/'job';job.mkdir();self.source.rename(job/'cluster');(job/'cluster'/'postmaster.pid').write_text('123\n')
  with patch.object(I.G,'command',side_effect=AssertionError('must not run')):
   with self.assertRaises(ValueError):I.source_stopped(job,'private.service')
 def test_watcher_sigkill_interrupts_foreground_work(self):
  job=self.base/'watch';job.mkdir();w=I.G.Watchdog(job,sample=lambda _:dict(ok=True),interval=.01);w.start()
  try:
   time.sleep(.03);os.kill(w.pid,signal.SIGKILL);time.sleep(.03)
   with self.assertRaises(ValueError):w.assert_alive()
   with self.assertRaises(ValueError):w.stop()
  finally:
   if w.pid:
    try:os.kill(w.pid,signal.SIGKILL);os.waitpid(w.pid,0)
    except ProcessLookupError:pass
 def test_failure_cleanup_ignores_repeated_signals_and_preserves_both_errors(self):
  plan=self.plan();job=self.base/'job';job.mkdir(mode=0o700);plan['job']=str(job)
  inv=self.inventory();inv['sourceJob']=plan['source'];calls=[]
  class Watcher:
   def __init__(self,*args,**kwargs):pass
   def start(self):pass
   def stop(self):
    calls.append('watcher');os.kill(os.getpid(),signal.SIGTERM);raise ValueError('watch failure')
  def fail_copy(*args,**kw):raise ValueError('original copy failure')
  def fail_stop(*args,**kw):
   calls.append('private');os.kill(os.getpid(),signal.SIGTERM);os.kill(os.getpid(),signal.SIGHUP);raise RuntimeError('stop failure')
  with patch.object(I,'checked_package',return_value=self.base),patch.object(I,'check_runtime'),patch.object(I,'check_window'),patch.object(I.G,'check_live'),patch.object(I,'read_json',return_value=(inv,{})),patch.object(I,'validate_inventory'),patch.object(I,'verify_source'),patch.object(I.G,'storage_sample',return_value={}),patch.object(I.pwd,'getpwnam',return_value=SimpleNamespace(pw_uid=self.uid,pw_gid=self.gid)),patch.object(I.G,'Watchdog',Watcher),patch.object(I,'inventory_tree',fail_copy),patch.object(I.G,'stop_private',fail_stop),patch.object(I.G,'LOCK',self.base/'backup.lock'):
   before=signal.getsignal(signal.SIGTERM)
   with self.assertRaisesRegex(ValueError,'original copy failure'):I.execute(plan,'a'*64)
   self.assertEqual(signal.getsignal(signal.SIGTERM),before)
  result=json.loads((job/'failed.json').read_bytes())
  self.assertEqual(calls,['private','watcher']);self.assertEqual(result['errorClass'],'ValueError');self.assertEqual(len(result['cleanupErrors']),2)
  self.assertFalse(result['privateStopVerified']);self.assertFalse((job/'completed.json').exists());self.assertTrue((job/'intent.json').exists())
 def test_native_hex_reconstruction_and_tamper_refusal(self):
  raw=b'\0\xff\n'+b'chain-readable'*10;p=self.base/'hex';p.write_bytes(raw.hex().encode()+b'\n');p.chmod(0o600)
  sha=hashlib.sha256(raw).hexdigest();self.assertEqual(I.verify_hex_reconstruction(p,sha,len(raw)),sha)
  p.write_bytes(b'z'*len(raw)*2+b'\n')
  with self.assertRaises(ValueError):I.verify_hex_reconstruction(p,sha,len(raw))
  p.write_bytes(raw.hex().encode()+b'\n\n')
  with self.assertRaises(ValueError):I.verify_hex_reconstruction(p,sha,len(raw))
 def test_native_deadline_wraps_all_queries_and_children(self):
  class Runner:
   def run(self,*a,**kw):return kw['timeout']
  r=I.DeadlineRunner(Runner(),.01)
  self.assertLessEqual(r.run(['true'],timeout=600),.01);time.sleep(.02)
  with self.assertRaises(TimeoutError):r.run(['true'])
 def prototype_case(self,tamper=None):
  inv=self.inventory();cp=inv['snapshot'];rows=[dict(height=960600,hash='a'*64),dict(height=960601,hash='b'*64),dict(height=cp['transitionMaxHeight'],hash=cp['transitionMaxHash'])]
  cols=[dict(name='network',typeOid=25,typeName='text'),dict(name='block_height',typeOid=23,typeName='integer'),dict(name='payload',typeOid=3802,typeName='jsonb')]
  context=dict(columns=cols,sampleRows=rows,markerSha256='e'*64,originalTriggers=[dict(name='work_amo_block_transitions_immutable',enabled='O')])
  raw=bytearray(b'PGCOPY\n\xff\r\n\x00'+struct.pack('!II',0,0))
  for r in rows:
   fields=[b'livenet',struct.pack('!i',r['height']),b'\x01{"syntheticOnly":true}'];raw+=struct.pack('!h',3)
   for f in fields:raw+=struct.pack('!i',len(f))+f
  raw=bytes(raw+struct.pack('!h',-1));sha=hashlib.sha256(raw).hexdigest()
  job=self.base/'proto';job.mkdir(mode=0o700)
  # The emitter deliberately permits only exact production-like job names;
  # this fixture patches no emitter validation and uses generated plan only
  # through its tested pure SQL functions, never starts PostgreSQL.
  es=importlib.util.spec_from_file_location('proto_emitter','/tmp/pow-audit30-transition-private-sql-v2.py');E=importlib.util.module_from_spec(es);es.loader.exec_module(E)
  calls=[]
  class Runner:
   def run(self,argv,phase,**kw):
    calls.append(phase)
    if phase in ('phase5-source-context','phase5-original-context-after'):
     got=copy.deepcopy(context)
     if tamper=='original-context' and phase.endswith('-after'):got['markerSha256']='f'*64
     return I.encoded(got)
    if phase=='phase5-snapshot-after':return I.encoded(cp)
    proto=json.loads((job/'phase5-prototype-plan.json').read_bytes())
    if phase.startswith('phase5-emit-'):
     admitted=copy.deepcopy(proto);admitted['privateJob']='/data/proofofwork-audit30-inspect-20261003T020000Z';admitted['privateSocket']=admitted['privateJob']+'/socket'
     text=E.capture(admitted) if phase=='phase5-emit-capture' else E.side(admitted,job/'phase5-chunks.sqlite')
     output=job/('phase5-capture.sql' if phase=='phase5-emit-capture' else 'phase5-side.sql');output.write_text(text);output.chmod(0o600);return b'emit-only\n'
    if phase=='phase5-native-capture':
     admitted=copy.deepcopy(proto);admitted['privateJob']='/data/proofofwork-audit30-inspect-20261003T020000Z';admitted['privateSocket']=admitted['privateJob']+'/socket';colraw,pin,index=E.validate(admitted)
     for name,data in [('transitions-source.copy',raw),('precision-marker-source.copy',b'private-marker'),('precision-marker-value.json',b'{"status":"complete"}\n'),('capture-context.json',I.encoded(context)),('columns.json',colraw+b'\n'),('checkpoint.json',pin+b'\n')]:
      p=job/name;p.write_bytes(data);p.chmod(0o600)
     return b''
    if phase=='phase5-build-side':
     got=subprocess.run(argv,capture_output=True,timeout=kw['timeout'])
     if got.returncode:raise RuntimeError(got.stderr.decode())
     return got.stdout
    if phase=='phase5-native-side':
     result=dict(sourceBytes=len(raw),sourceSha256=sha,reconstructedBytes=len(raw),reconstructedSha256='f'*64 if tamper=='reconstruction' else sha,schemaTotalBytes=128*1024**2+1 if tamper=='storage' else 8192)
     for name,data in [('side-store-measurements.json',I.encoded(result)),('side-reconstructed.hex',raw.hex().encode()+b'\n')]:
      p=job/name;p.write_bytes(data);p.chmod(0o600)
     return b''
    raise AssertionError('Unexpected command '+phase)
  with patch.object(I.G,'allocation',return_value=4096):
   result=I.native_prototype(Runner(),job,Path('/tmp'),inv)
  return result,job,calls
 def test_actual_local_builder_and_emitter_native_pipeline_mock(self):
  result,job,calls=self.prototype_case()
  self.assertTrue(result['completeSampleByteReconstruction']);self.assertFalse(result['historicalArithmeticAccepted']);self.assertIn('phase5-native-side',calls)
  receipt=json.loads((job/'phase5-native-prototype.json').read_bytes());self.assertTrue(receipt['newPrivateSideSchemaOnly']);self.assertFalse(receipt['productionMigrationApproved'])
 def test_native_pipeline_malformed_reconstruction_storage_and_context_refuse(self):
  for kind in ('reconstruction','storage','original-context'):
   with self.subTest(kind=kind),self.assertRaises(ValueError):self.prototype_case(kind)
   # Partial evidence remains; each attempt gets a new job.
   (self.base/'proto').rename(self.base/('preserved-'+kind))
 def test_lock_fd_and_fresh_path_bind_before_intent(self):
  plan=self.plan();lock=self.base/'backup.lock';who=SimpleNamespace(pw_uid=self.uid,pw_gid=self.gid)
  with patch.object(I.G,'LOCK',lock):
   fd=I.acquire_backup_lock(plan['backupLock'],who);os.close(fd)
   original=os.open
   def replaced(path,*args,**kw):
    if Path(path)==lock:
     lock.rename(self.base/'original-backup.lock');new=original(lock,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600);os.close(new)
    return original(path,*args,**kw)
   with patch.object(I.os,'open',replaced),self.assertRaisesRegex(ValueError,'lock identity differs'):I.acquire_backup_lock(plan['backupLock'],who)
  self.assertFalse((self.base/'intent.json').exists());self.assertEqual((self.base/'original-backup.lock').read_bytes(),b'')
 def test_native_size_preflight_measures_full_oversize_without_truncation(self):
  inv=self.inventory();rows=[dict(height=x,hash=inv['snapshot']['transitionMaxHash'] if x==1000000 else 'a'*64,recordSendBytes=80_623_886,payloadStoredBytes=1024) for x in [960600,960601,1000000]]
  class Runner:
   def run(self,argv,phase,**kw):
    self.sql=kw['stdin'];return I.encoded(dict(rows=rows))
  runner=Runner();result=I.native_size_preflight(runner,self.base,inv)
  self.assertIn(b'record_send(t)',runner.sql);self.assertIn(b'READ ONLY',runner.sql);self.assertFalse(result['eligibleForExactFullSample']);self.assertFalse(result['sourceValuesTruncated']);self.assertEqual(result['recordSendConservativeSourceBytes'],sum(r['recordSendBytes']+32 for r in rows))
 def test_id_size_profile_and_explain_force_original_serialization(self):
  raw=Path('/tmp/pow-audit30-phase6-local-counted-diagnostic-v2-exact-id-transition-page.sql').read_bytes();statements=[]
  class Runner:
   def run(self,argv,phase,**kw):
    statements.append(kw['stdin'])
    if phase.endswith('explain'):return I.encoded([dict(Plan={'Node Type':'Aggregate'},**{'Execution Time':321.2})])
    return I.encoded(dict(rows=1,totalJsonBytes='80623886',maximumRowJsonBytes='80623886',rowSizes=[dict(height=1000000,hash='a'*64,serializedBytes=80623886)]))
  result=I.id_size_profile(Runner(),self.base,raw,self.plan()['idPage'],'before')
  self.assertEqual(result['totalJsonBytes'],'80623886');self.assertEqual(len(statements),2)
  for sql in statements:self.assertIn(b'octet_length(row_to_json(q)::text)',sql);self.assertIn(b'READ ONLY',sql);self.assertNotIn(b'$1',sql)
  self.assertIn(b'EXPLAIN (ANALYZE,BUFFERS',statements[1]);self.assertFalse((self.base/'before.copy').exists());self.assertTrue((self.base/'before-size-explain-profile.json').exists())

 def dependency_case(self,change=None):
  package=self.base/'dep-package';package.mkdir(mode=0o750);base=package/'pg-dependencies';base.mkdir(mode=0o750)
  for rel in ('pg','pg/lib','pg/node_modules','pg/node_modules/pg-protocol'):(base/rel).mkdir(mode=0o750)
  (base/'pg/lib/index.js').write_bytes(b"module.exports = require('pg-protocol');\n");(base/'pg/lib/index.js').chmod(0o440)
  (base/'pg/node_modules/pg-protocol/index.js').write_bytes(b"module.exports = {};\n");(base/'pg/node_modules/pg-protocol/index.js').chmod(0o440)
  original=I.G.metadata
  def metadata(path):return original(path)|{'uid':0,'gid':self.gid}
  with patch.object(I.G,'metadata',metadata),patch.object(I.pwd,'getpwnam',return_value=SimpleNamespace(pw_gid=self.gid)):
   inventory=I.collect_pg_dependencies(base)
   authority=dict(dependencyInventorySha256='a'*64,pgEntrySha256=hashlib.sha256((base/'pg/lib/index.js').read_bytes()).hexdigest())
   if change=='unlisted':(base/'unlisted.js').write_bytes(b'extra')
   if change=='content':
    (base/'pg/lib/index.js').chmod(0o640);(base/'pg/lib/index.js').write_bytes(b'changed');(base/'pg/lib/index.js').chmod(0o440)
   if change=='symlink':
    (base/'pg/node_modules/pg-protocol/index.js').unlink();(base/'pg/node_modules/pg-protocol/index.js').symlink_to(base/'pg/lib/index.js')
   if change=='wrong-entry':authority['pgEntrySha256']='f'*64
   with patch.object(I,'read_json',return_value=(inventory,{})):return I.verify_pg_dependencies(package,authority)
 def test_full_pg_dependency_closure_uses_real_file_hashes(self):
  result=self.dependency_case();self.assertEqual(result['entries'],7);self.assertEqual(result['regularBytes'],62)
 def test_pg_dependency_unlisted_content_symlink_entry_refuse(self):
  for change in ('unlisted','content','symlink','wrong-entry'):
   with self.subTest(change=change),self.assertRaises(ValueError):self.dependency_case(change)
   (self.base/'dep-package').rename(self.base/('retained-deps-'+change))
 def body_case(self,change=None):
  job=self.base/'body-job';job.mkdir(mode=0o700);package=self.base/'body-package';package.mkdir(mode=0o750)
  targets=['1'*64,'2'*64];private=dict(schema='pow-audit30-mail-body-private-rehearsal-plan-v1',manifestSHA256='e'*64,targets=[dict(txid=t) for t in targets])
  receipt=dict(schema='pow-audit30-private-mail-body-rehearsal-completed-v1',status='passed',exactInverseBodySqlExercised=True,rollbackAcknowledged=True,privateOriginalRowsRestored=True,allCloneNonbodyAndNontargetRowsUnchanged=True,productionMutation=False,cloneSubsetQualified=True,newCoreReplayClaimed=False,manifestSHA256=private['manifestSHA256'],manifestTargetCount=2,selectedCloneTargetCount=1,missingCloneCandidateCount=1,selectedTxids=targets[:1],missingCloneCandidateTxids=targets[1:],baselineNativeMailFingerprint=dict(count=3,logical_bytes='1024',sha256='f'*64))
  if change=='rollback':receipt['rollbackAcknowledged']=False
  if change=='manifest':receipt['manifestSHA256']='d'*64
  if change=='partition':receipt['missingCloneCandidateTxids']=targets[:1]
  if change=='new-replay':receipt['newCoreReplayClaimed']=True
  if change=='bytes':receipt['baselineNativeMailFingerprint']['logical_bytes']=str(256*1024**2+1)
  class Runner:
   def run(_runner,argv,phase,**kw):
    self.body_argv=argv;I.G.durable(job/'phase4-body-rehearsal-v1-completed.json',receipt);return b''
  original=I.read_json
  def read(path,*args,**kwargs):return (private,{}) if Path(path).name=='phase4-private-plan.json' else original(path,*args,**kwargs)
  with patch.object(I,'checked_package',return_value=package),patch.object(I,'read_json',side_effect=read),patch.object(I.G,'allocation',return_value=1024):
   return I.mail_body_rehearsal(Runner(),job,package,self.plan())
 def test_phase4_native_argv_rollback_and_saved_subset_binding(self):
  result=self.body_case();self.assertTrue(result['rollbackOnly']);self.assertEqual(result['selected'],1);self.assertEqual(result['missing'],1)
  self.assertEqual(self.body_argv[0:2],[str(I.NODE),'--max-old-space-size=128']);self.assertEqual(self.body_argv[-1],'phase4-body-rehearsal-v1');self.assertEqual(Path(self.body_argv[-3]),self.base/'body-package/pg-dependencies/pg/lib/index.js')
  self.assertTrue((self.base/'body-job/phase4-rehearsal-adapter.json').exists())
 def test_phase4_false_rollback_manifest_partition_replay_and_size_refuse(self):
  for change in ('rollback','manifest','partition','new-replay','bytes'):
   with self.subTest(change=change),self.assertRaises(ValueError):self.body_case(change)
   self.assertFalse((self.base/'body-job/phase4-rehearsal-adapter.json').exists())
   (self.base/'body-job').rename(self.base/('retained-body-'+change));(self.base/'body-package').rename(self.base/('retained-package-'+change))

 def test_context_oid_cast_has_exact_pg_integer_metadata(self):
  self.assertIn("'typeOid',atttypid::integer,",I.PROTOTYPE_CONTEXT_SQL)
  self.assertNotIn("'typeOid',atttypid,",I.PROTOTYPE_CONTEXT_SQL)
 def test_body_inverse_receipt_survives_prototype_failure(self):
  job=self.base/'ordered-job';job.mkdir(mode=0o700);phases=[];inv=self.inventory();body=dict(rollbackOnly=True,selected=1,missing=1);seen=[]
  def inverse(*args):seen.append('inverse');return body
  def proto(*args):
   seen.append('prototype');self.assertTrue((job/'phase4-before-prototype.json').exists());raise ValueError('export refusal')
  with patch.object(I,'mail_body_rehearsal',inverse),patch.object(I.G,'query',return_value=inv['snapshot']),patch.object(I,'native_prototype',proto),self.assertRaisesRegex(ValueError,'export refusal'):
   I.native_rehearsals(None,job,self.base,self.plan(),inv,dict(eligibleForExactFullSample=True),[],phases.append)
  self.assertEqual(seen,['inverse','prototype']);self.assertEqual(phases,['phase4-mail-body-rehearsal','phase5-native-prototype']);receipt=json.loads((job/'phase4-before-prototype.json').read_bytes());self.assertEqual(receipt['phase4BodyRehearsal'],body);self.assertTrue(receipt['savedFenceUnchanged']);self.assertFalse(receipt['phase5PrototypeAttempted'])
 def test_inverse_failure_or_fence_drift_prevents_prototype(self):
  for wrong in ('inverse','fence'):
   job=self.base/('ordered-'+wrong);job.mkdir(mode=0o700);inv=self.inventory()
   with patch.object(I,'mail_body_rehearsal',side_effect=ValueError('inverse refusal') if wrong=='inverse' else None,return_value=dict(rollbackOnly=True)),patch.object(I.G,'query',return_value={} if wrong=='fence' else inv['snapshot']),patch.object(I,'native_prototype',side_effect=AssertionError('must not prototype')),self.assertRaises(ValueError):
    I.native_rehearsals(None,job,self.base,self.plan(),inv,dict(eligibleForExactFullSample=True),[],lambda _:None)
   self.assertFalse((job/'phase4-before-prototype.json').exists())

if __name__=='__main__':unittest.main()
