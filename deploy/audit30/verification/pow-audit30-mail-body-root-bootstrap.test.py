#!/usr/bin/python3 -I
import base64,copy,datetime as dt,hashlib,importlib.util,json,os,pathlib,tempfile,unittest,subprocess,sys
from unittest import mock
P=pathlib.Path('/tmp/pow-audit30-mail-body-root-bootstrap.py');sp=importlib.util.spec_from_file_location('bootstrap',P);B=importlib.util.module_from_spec(sp);sp.loader.exec_module(B)
FILES={'private-census.py':'/tmp/pow-audit30-mail-body-private-census.py','repair-plan.py':'/tmp/pow-audit30-mail-body-repair-plan.py','mail-body-census.py':'/tmp/pow-audit30-mail-body-census.py','rehearsal-engine.mjs':'/tmp/pow-audit30-mail-body-repair-rehearsal.mjs'}
def request():
 now=dt.datetime.now(dt.timezone.utc);raw=P.read_bytes();who=dict(MainPID='123',InvocationID='a'*32)
 return dict(schema='pow-audit30-private-mail-census-root-request-v1',approvalSha256=B.APPROVAL,runId='20261003T010000Z',host='node',bootstrapSHA256=B.sha(raw),bootstrapBase64=base64.b64encode(raw).decode(),sources={n:dict(sha256=B.sha(pathlib.Path(p).read_bytes()),base64=base64.b64encode(pathlib.Path(p).read_bytes()).decode()) for n,p in FILES.items()},liveServices={n:copy.deepcopy(who) for n in B.SERVICES},binaries={n:dict(path=p,realPath=p,metadata={},sha256='c'*64) for n,p in B.BINARIES.items()},phase7=dict(job='/data/proofofwork-audit30-restore-20261002T235000Z',unit='proofofwork-audit30-logical-restore-20261002T235000Z.service',proofs={n:dict(sha256='d'*64,metadata={}) for n in B.PROOFS}),backupWindow=dict(capturedAtUtc=now.isoformat(),nextScheduledAtUtc=(now+dt.timedelta(hours=2)).isoformat()))
class Test(unittest.TestCase):
 def test_exact_frozen_request_valid(self):B.validate(request())
 def test_changed_source_and_unapproved_source_names_refuse(self):
  for mutate in [lambda r:r['sources']['repair-plan.py'].update(base64=base64.b64encode(b'different').decode()),lambda r:r['sources'].update(evil=dict(sha256='a'*64,base64=''))]:
   r=request();mutate(r)
   with self.assertRaises(ValueError):B.validate(r)
 def test_wrong_approval_host_run_id_or_live_set_refuses(self):
  for mutate in [lambda r:r.update(approvalSha256='f'*64),lambda r:r.update(runId='../bad'),lambda r:r.update(host='node;cmd'),lambda r:r['liveServices'].pop(B.SERVICES[0]),lambda r:r['liveServices'][B.SERVICES[0]].update(MainPID='0')]:
   r=request();mutate(r)
   with self.assertRaises(ValueError):B.validate(r)
 def test_phase7_wrong_scope_unit_missingproof_refuses(self):
  for mutate in [lambda r:r['phase7'].update(job='/var/lib/postgresql'),lambda r:r['phase7'].update(unit='postgresql@16-main.service'),lambda r:r['phase7']['proofs'].pop('completed.json')]:
   r=request();mutate(r)
   with self.assertRaises(ValueError):B.validate(r)
 def test_existing_binary_roles_fixed_and_loader_cannot_substitute(self):
  r=request();r['binaries']['python']['path']='/tmp/other'
  with self.assertRaises(ValueError):B.validate(r)
 def test_duplicate_json_authority_refuses(self):
  with self.assertRaisesRegex(ValueError,'DUPLICATE_JSON_KEY'):B.parse(b'{"a":1,"a":2}')
 def test_read_atime_is_ignored_but_source_bytes_pinned(self):
  with tempfile.TemporaryDirectory() as d:
   p=pathlib.Path(d)/'source';p.write_bytes(b'exact');p.chmod(0o600);os.utime(p,ns=(1,p.stat().st_mtime_ns));m=B.meta(p.stat());raw,after=B.stable_read(p,20,B.sha(b'exact'),m,mode=0o600);self.assertEqual(raw,b'exact');self.assertEqual(after,m);self.assertEqual(p.stat().st_atime_ns,1)
   p.write_bytes(b'wrong')
   with self.assertRaises(ValueError):B.stable_read(p,20,B.sha(b'exact'),m,mode=0o600)
 def test_no_symlink_source_or_path_escape(self):
  with tempfile.TemporaryDirectory() as d:
   p=pathlib.Path(d)/'source';p.write_bytes(b'exact');q=pathlib.Path(d)/'link';q.symlink_to(p)
   with self.assertRaisesRegex(ValueError,'PATH_SYMLINK'):B.stable_read(q,20)
 def test_descriptor_mode_metadata_diff_refuses(self):
  with tempfile.TemporaryDirectory() as d:
   p=pathlib.Path(d)/'s';p.write_bytes(b'exact');p.chmod(0o600);m=B.meta(p.stat());p.chmod(0o400)
   with self.assertRaises(ValueError):B.stable_read(p,20,expected_meta=m)
 def test_runtime_window_backup_or_schedule_change_refuses(self):
  r=request();deadline=dt.datetime.fromisoformat(r['backupWindow']['nextScheduledAtUtc']);baseline=dict(ActiveState='inactive',SubState='dead',MainPID='0');timer=dict(ActiveState='active',NextElapseUSecRealtime=deadline.strftime('%a %Y-%m-%d %H:%M:%S UTC'))
  r['backupWindow']['nextScheduledAtUtc']=deadline.replace(microsecond=0).isoformat()
  with mock.patch.object(B,'props',side_effect=[baseline,timer]):B.watch_window(r)
  for values in [[dict(ActiveState='active',SubState='running',MainPID='1'),timer],[baseline,dict(timer,ActiveState='inactive')],[baseline,dict(timer,NextElapseUSecRealtime='Sat 2026-10-03 04:00:00 UTC')]]:
   with mock.patch.object(B,'props',side_effect=values),self.assertRaises(ValueError):B.watch_window(r)
 def test_install_checks_admission_before_creating_package_or_evidence(self):
  with mock.patch.object(B,'admission',side_effect=ValueError('LIVE_SERVICE_DRIFT')),mock.patch.object(B,'new_dir') as mkdir:
   with self.assertRaisesRegex(ValueError,'LIVE_SERVICE_DRIFT'):B.install(request(),b'{}')
   mkdir.assert_not_called()
 def test_install_collision_refuses_without_overwriting(self):
  with mock.patch.object(B,'admission',return_value={}),mock.patch.object(B.os.path,'lexists',return_value=True),mock.patch.object(B,'new_dir') as mkdir:
   with self.assertRaisesRegex(ValueError,'SCOPE_ALREADY_EXISTS'):B.install(request(),b'{}')
   mkdir.assert_not_called()
 def test_namespace_unit_is_root_bounded_readonly_except_new_private_job(self):
  source=P.read_text();self.assertIn("--property=ProtectSystem=strict",source);self.assertIn("--property=ReadWritePaths='+str(job)",source);self.assertIn("--property=CPUQuota=50%",source);self.assertIn("--property=MemoryMax=2G",source);self.assertIn("--property=RuntimeMaxSec=930s",source);self.assertIn("PrivateNetwork='no'",source);self.assertNotIn('CapabilityBoundingSet=',source);self.assertNotIn("systemctl','stop",source);self.assertNotIn("systemctl','restart",source)
 def test_sql_and_core_source_are_exact_pinned_readonly(self):
  self.assertEqual(B.PINS['mail-body-census.py'],'818aaf4207ac5f5c627211eec21ed3991f6fd3a8400cce909c64c6be053ce61c');self.assertEqual(B.ENV['PGHOST'],'/run/postgresql');self.assertIn('default_transaction_read_only=on',B.ENV['PGOPTIONS']);self.assertEqual(set(B.ENV)&{'PGPASSWORD','PGSERVICE','PGPASSFILE','LD_PRELOAD','PYTHONPATH'},set())
 def test_parent_sync_uses_real_directory_fd(self):
  with tempfile.TemporaryDirectory() as d:
   calls=[];real=B.os.fsync
   def fsync(fd):calls.append(os.readlink('/proc/self/fd/'+str(fd)));real(fd)
   with mock.patch.object(B.os,'fsync',side_effect=fsync):B.sync_dir(d)
   self.assertEqual(calls,[d])
 def test_unit_launch_status_stderr_tolerated_only_when_explicit(self):
  import sys
  argv=[sys.executable,'-I','-B','-c','import sys;sys.stderr.write("Running as unit synthetic.service.\\n")']
  self.assertEqual(B.bounded(argv,5,allow_status_stderr=True),b'')
  with self.assertRaisesRegex(ValueError,'COMMAND_REFUSED'):B.bounded(argv,5)
 def test_native_sql_failure_cleanup_is_durable_before_exit(self):
  with tempfile.TemporaryDirectory() as d:
   package=pathlib.Path(d)/'pkg';job=pathlib.Path(d)/'job';written={};r=request();proof=dict(unit='proofofwork-audit30-mail-sql-'+r['runId']+'.service',stopped=True)
   with mock.patch.object(B,'checked_runtime',return_value=(package,job)),mock.patch.object(B,'admission',return_value={}),mock.patch.object(B,'durable',side_effect=lambda p,v:written.update({p.name:v})),mock.patch.object(B,'file_child',side_effect=ValueError('CHILD_REFUSED')),mock.patch.object(B,'stop_native_sql',return_value=proof)as stopped:
    with self.assertRaisesRegex(ValueError,'CHILD_REFUSED'):B.run(r,b'{}')
   stopped.assert_called_once_with(r,package,job);self.assertIn('failed.json',written);self.assertIn('sql-subunit-final.json',written);self.assertNotIn('completed.json',written);self.assertTrue(written['sql-subunit-final.json']['stopped'])
 def test_native_sql_unknown_stop_never_creates_completed(self):
  written={};r=request()
  with mock.patch.object(B,'checked_runtime',return_value=(pathlib.Path('/tmp/pkg'),pathlib.Path('/tmp/job'))),mock.patch.object(B,'admission',return_value={}),mock.patch.object(B,'durable',side_effect=lambda p,v:written.update({p.name:v})),mock.patch.object(B,'file_child',side_effect=ValueError('CHILD_REFUSED')),mock.patch.object(B,'stop_native_sql',side_effect=ValueError('SQL_CHILD_CHANGED')):
   with self.assertRaisesRegex(ValueError,'SQL_CHILD_CHANGED'):B.run(r,b'{}')
  self.assertIn('failed.json',written);self.assertFalse(written['sql-subunit-stop-failed.json']['stopped']);self.assertNotIn('completed.json',written)
 def test_parent_sigkill_cleanup_is_bound_by_native_child_dependencies(self):
  import importlib.util
  path=pathlib.Path(FILES['private-census.py']);sp=importlib.util.spec_from_file_location('wrapper',path);w=importlib.util.module_from_spec(sp);sp.loader.exec_module(w);c=w.SqlControl('/data/proofofwork-release-backups/audit30-mail-body-census-20261003T020000Z/preimages.jsonl');argv=c.argv()
  self.assertIn('--property=BindsTo='+c.parent,argv);self.assertIn('--property=After='+c.parent,argv);self.assertIn('--property=Requisite='+c.parent,argv);self.assertIn('--property=RuntimeMaxSec=75s',argv);self.assertTrue(c.parent.startswith('proofofwork-audit30-mail-census-'));self.assertNotIn('postgresql@16-main.service',argv)
 def test_actual_cli_validate_success_exit0_one_valid_json(self):
  r=request();raw=B.encoded(r);done=subprocess.run([sys.executable,'-I','-B',str(P),'validate-request','--request-sha256',B.sha(raw)],input=raw,capture_output=True,timeout=5)
  self.assertEqual(done.returncode,0);result=json.loads(done.stdout);self.assertEqual(result['status'],'valid');self.assertFalse(result['productionExecuted']);self.assertEqual(done.stderr,b'')
 def test_actual_cli_bad_request_exit1_refusal_only(self):
  r=request();r['approvalSha256']='f'*64;raw=B.encoded(r);done=subprocess.run([sys.executable,'-I','-B',str(P),'validate-request','--request-sha256',B.sha(raw)],input=raw,capture_output=True,timeout=5)
  self.assertEqual(done.returncode,1);result=json.loads(done.stdout);self.assertEqual(result['status'],'refused');self.assertEqual(result['code'],'REQUEST_AUTHORITY')
if __name__=='__main__':unittest.main()
