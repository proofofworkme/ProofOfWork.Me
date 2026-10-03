import copy,importlib.util,json,os,pathlib,stat,tempfile,time,types,unittest
from unittest.mock import patch
sp=importlib.util.spec_from_file_location('P','/tmp/pow-audit30-systemd-output-property-probe-v2.py');P=importlib.util.module_from_spec(sp);sp.loader.exec_module(P)
def fragment():return ('# Transient unit\n[Unit]\nDescription=probe\n[Service]\nStandardInput=null\nStandardOutput='+P.PROPS['StandardOutput']+'\nStandardError='+P.PROPS['StandardError']+'\n').encode()
def identity():return dict(LoadState='loaded',Type='oneshot',Transient='yes',RemainAfterExit='yes',User='postgres',Group='postgres',InvocationID='a'*32,MainPID='1',ControlGroup='/system.slice/'+P.UNIT,ActiveState='activating',SubState='start',Result='success',ExecMainStatus='0')
def manager():return {'type':'o','data':['/org/freedesktop/systemd1/unit/probe']}
def typed():return {'type':'a(sasbttttuii)','data':[[P.ARGV[0],P.ARGV,False,0,0,0,0,0,0,0]]}
class Tests(unittest.TestCase):
 def test_literal_source_no_app_core_sql_or_network(self):
  self.assertEqual(P.ARGV[:4],['/usr/bin/python3','-I','-B','-c'])
  for x in ('bitcoin','psql','open(','socket','urllib','requests','/data/','/etc/'):
   self.assertNotIn(x,P.CODE)
 def test_literal_actual_child_stdout_stderr_and_isolation(self):
  import subprocess
  p=subprocess.run(P.ARGV,capture_output=True,timeout=2);self.assertEqual(p.returncode,0);d=json.loads(p.stdout);self.assertTrue(d['outputPropertyProbe']);self.assertEqual(d['uid'],os.getuid());self.assertEqual(d['gid'],os.getgid());self.assertEqual(p.stderr,b'audit30-output-property-probe\n')
 def test_fragment_exact_service_targets(self):self.assertEqual(P.validate_fragment(fragment()),{k:P.PROPS[k]for k in ('StandardInput','StandardOutput','StandardError')})
 def test_fragment_foreign_output_path(self):
  with self.assertRaises(P.Refused):P.validate_fragment(fragment().replace(str(P.OUT).encode(),b'/tmp/foreign'))
 def test_fragment_duplicate_directive(self):
  with self.assertRaises(P.Refused):P.validate_fragment(fragment()+b'StandardOutput=journal\n')
 def test_fragment_wrong_section(self):
  with self.assertRaises(P.Refused):P.validate_fragment(fragment().replace(b'[Service]',b'[Unit]'))
 def test_fragment_missing_directive(self):
  with self.assertRaises(P.Refused):P.validate_fragment(b'[Service]\nStandardInput=null\n')
 def test_fragment_continuation_refuses(self):
  with self.assertRaises(P.Refused):P.validate_fragment(fragment()+b'Environment=bad\\\n')
 def test_fragment_path_dropin_alias_refuses_before_read(self):
  v=dict(FragmentPath=str(P.FRAGMENT),DropInPaths='',SourcePath='')
  for d in (v|{'FragmentPath':'/tmp/foreign'},v|{'DropInPaths':'/tmp/drop.conf'},v|{'SourcePath':'/tmp/source'}):
   with self.subTest(d=d),patch.object(P,'stable_file')as r,self.assertRaises(P.Refused):P.fragment_proof(d)
   r.assert_not_called()
 def test_actual_enum_is_observed_not_conflated_with_setter_path(self):
  self.assertTrue(P.PROPS['StandardOutput'].startswith('file:'));self.assertTrue(P.PROPS['StandardError'].startswith('append:'));self.assertNotIn('StandardOutput',P.validate_resources.__code__.co_consts)
 def test_identity_running_and_successful_retained(self):
  P.identity(identity());P.identity(identity()|dict(MainPID='0',ControlGroup='',ActiveState='active',SubState='exited'))
 def test_identity_wrong_live_cgroup_or_failed_terminal(self):
  for v in (identity()|{'ControlGroup':''},identity()|dict(MainPID='0',ControlGroup='',ActiveState='failed',SubState='failed'),identity()|{'InvocationID':'b'*32}):
   with self.subTest(v=v),self.assertRaises(P.Refused):P.identity(v,'a'*32)
 def test_typed_exact_argv(self):
  with patch.object(P,'cmd',side_effect=[P.encode(manager()),P.encode(typed())]):self.assertIn('argvSha256',P.typed())
 def test_typed_foreign_command_and_multiple(self):
  for v in (typed()|{'type':'s'},typed()|{'data':[]},typed()|{'data':typed()['data']*2}):
   with self.subTest(v=v),patch.object(P,'cmd',side_effect=[P.encode(manager()),P.encode(v)]),self.assertRaises(P.Refused):P.typed()
  v=typed();v['data'][0][1]=['/bin/sh'];
  with patch.object(P,'cmd',side_effect=[P.encode(manager()),P.encode(v)]),self.assertRaises(P.Refused):P.typed()
 def test_resources_fixed_and_each_drift_refuses(self):
  d=dict(MemoryMax=str(32*1024**2),MemorySwapMax='0',CPUQuotaPerSecUSec='100ms',TasksMax='8',RuntimeMaxUSec='5s',TimeoutStartUSec='5s',TimeoutStopUSec='5s',NoNewPrivileges='yes',PrivateNetwork='yes',PrivateTmp='yes',PrivateDevices='yes',RestrictAddressFamilies='AF_UNIX',ProtectSystem='strict',ProtectHome='yes',CapabilityBoundingSet='',AmbientCapabilities='',UMask='0077',LimitFSIZE='2048',KillMode='control-group',Restart='no',StandardInput='null');P.validate_resources(d)
  for k in d:
   with self.subTest(k=k),self.assertRaises(P.Refused):P.validate_resources(d|{k:'wrong'})
 def test_independent_cleanup_after_whole_deadline(self):
  P.OWNED='a'*32;P.DEADLINE=time.monotonic()-1
  with patch.object(P,'props',side_effect=[identity()|dict(MainPID='0',ControlGroup='',ActiveState='active',SubState='exited'),dict(MainPID='0',LoadState='not-found',InvocationID='')]),patch.object(P,'typed',return_value={'fixed':True}),patch.object(P,'cmd',return_value=b'')as c:
   r=P.owned_stop();self.assertTrue(r['verified']);self.assertEqual(c.call_args.args,(['/usr/bin/systemctl','stop',P.UNIT],True))
 def test_cleanup_recovers_typed_identity_before_ownership(self):
  P.OWNED=None
  with patch.object(P,'props',side_effect=[identity(),dict(MainPID='0',LoadState='not-found',InvocationID='')]),patch.object(P,'typed',return_value={'fixed':True}),patch.object(P,'cmd',return_value=b''):
   self.assertTrue(P.owned_stop()['verified']);self.assertEqual(P.OWNED,'a'*32)
 def test_cleanup_foreign_invocation_never_stops(self):
  P.OWNED='b'*32
  with patch.object(P,'props',return_value=identity()),patch.object(P,'cmd')as c,self.assertRaises(P.Refused):P.owned_stop()
  c.assert_not_called()
 def test_group_other_write_fragment_refuses_before_open(self):
  with tempfile.TemporaryDirectory()as d:
   p=pathlib.Path(d)/'unit.service';p.write_bytes(fragment());s=p.lstat()
   for mode in (0o100622,0o100664,0o100646):
    fake=types.SimpleNamespace(**{n:getattr(s,n)for n in ('st_dev','st_ino','st_nlink','st_size','st_mtime_ns','st_ctime_ns')},st_mode=mode,st_uid=0,st_gid=0)
    with self.subTest(mode=mode),patch.object(pathlib.Path,'lstat',return_value=fake),patch.object(P.os,'open')as opened,self.assertRaises(P.Refused):P.stable_file(p,32768)
    opened.assert_not_called()
 def test_duplicate_request_key_refuses(self):
  with self.assertRaises(P.Refused):P.parse(b'{"schema":1,"schema":2}')
 def test_absence_all_fields_required(self):
  v=dict(LoadState='not-found',ActiveState='inactive',SubState='dead',MainPID='0',InvocationID='');P.require_absent(v)
  for k in v:
   with self.subTest(k=k),self.assertRaises(P.Refused):P.require_absent(v|{k:'bad'})
 def test_creation_only_durable_receipt_real_fs(self):
  with tempfile.TemporaryDirectory()as d:
   p=pathlib.Path(d)/'receipt.json';P.durable(p,{'x':True});self.assertEqual(p.read_bytes(),b'{"x":true}');self.assertEqual(stat.S_IMODE(p.stat().st_mode),0o600)
   with self.assertRaises(FileExistsError):P.durable(p,{'overwrite':True})
if __name__=='__main__':unittest.main()
