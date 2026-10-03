"""Source-bound local endpoint and command cleanup fixtures; no native access."""
import ast,copy,hashlib,json,os,signal,subprocess,sys,tempfile,threading,time,types,unittest
from pathlib import Path
from unittest.mock import patch
SOURCE=Path('/tmp/pow-audit30-oct3-restore-poststop-observer-v2.py');raw=SOURCE.read_bytes();assert len(raw)==6694 and hashlib.sha256(raw).hexdigest()=='a55a22e74d75c74954954d2cf79827c91f3240065bafb7581c4c5015ef0095ae';M=types.ModuleType('observer');exec(compile(raw,str(SOURCE),'exec'),M.__dict__)
NATIVE=Path('/tmp/pow-audit30-oct3-isolated-restore-native-104500-v1.stdout').read_bytes();assert hashlib.sha256(NATIVE).hexdigest()=='3a53ab1325bf9110445da746452a24865e6069fa9e7fdbe0e28b09af2f1574ba';ACTUAL=json.loads(NATIVE.splitlines()[-1]);assert all(ACTUAL['evidence'][n]['sha256']==h for n,h in M.FILES.items())
GC=dict(LoadState='not-found',ActiveState='inactive',SubState='dead',MainPID='0',InvocationID='',ControlGroup='',Result='success',ExecMainStatus='0')
LOADED=dict(GC,LoadState='loaded',InvocationID='322aeb150b664d7fa8380b8f6c7ed1f1')
FIVE={n:dict(LoadState='loaded',ActiveState='active',SubState='running',MainPID=pid,InvocationID=inv)for n,(pid,inv)in M.LIVE.items()}
class Tests(unittest.TestCase):
 def observe(self,owned,missing=None,five=None,completed=None,cgroup=None):
  values=copy.deepcopy(ACTUAL['evidence']);
  if completed:values['completed.json']['value'].update(completed)
  def absent(p):return p!=missing
  def property(n,fields):return owned if n==M.UNIT else(five or FIVE)[n]
  with patch.object(M.os,'geteuid',return_value=0),patch.object(M.os,'getegid',return_value=0),patch.object(M.os,'uname',return_value=types.SimpleNamespace(nodename='pow-bitcoin-01')),patch.object(M.sys,'argv',['fixture']),patch.object(M.signal,'signal'),patch.object(M.signal,'alarm'),patch.object(M,'public_file',side_effect=lambda n,h:dict(metadata={},sha256=h,value=values[n]['value'])),patch.object(M,'absent',side_effect=absent),patch.object(M,'properties',side_effect=property),patch.object(M,'command',return_value='SYNTHETIC df fixture only'),patch.object(Path,'read_text',return_value=cgroup or ''):return M.main()
 def test_actual_four_hashes_plan_and_completed_public_flags(self):
  self.assertEqual(M.PLAN,ACTUAL['evidence']['completed.json']['value']['planSha256']);self.assertEqual(M.FILES,{n:ACTUAL['evidence'][n]['sha256']for n in M.FILES});self.assertEqual(M.JOB,Path(ACTUAL['job']));self.assertEqual(ACTUAL['returnCode'],0)
 def test_exact_gc_accepts_with_historical_result_qualified(self):
  v=self.observe(GC);self.assertTrue(v['ownedUnitGarbageCollected']);self.assertEqual(v['ownedUnit']['InvocationID'],'');self.assertEqual(v['unitInvocationObservedDuringActualRun'],LOADED['InvocationID']);self.assertFalse(v['pitrCertified']);self.assertFalse(v['livePhysicalPagesCertified'])
 def test_bad_gc_shapes_reject_including_former_accepted_vector(self):
  changes=[dict(ActiveState='failed',SubState='failed',InvocationID='f'*32,ControlGroup='/other-cgroup'),dict(SubState='waiting'),dict(InvocationID='f'*32),dict(ControlGroup='/other-cgroup'),dict(MainPID='1'),dict(LoadState='masked')]
  for change in changes:
   with self.subTest(change=change),self.assertRaises(ValueError):self.observe(dict(GC,**change))
 def test_loaded_exact_invocation_passes_empty_or_fixed_stopped_cgroup(self):
  for cg in ('','/system.slice/'+M.UNIT):self.assertFalse(self.observe(dict(LOADED,ControlGroup=cg))['ownedUnitGarbageCollected'])
 def test_loaded_inactive_dead_zero_own_success_required(self):
  for change in (dict(InvocationID='f'*32),dict(Result='exit-code'),dict(ExecMainStatus='1'),dict(ActiveState='failed',SubState='failed'),dict(SubState='exited'),dict(MainPID='1'),dict(ControlGroup='/other-cgroup')):
   with self.subTest(change=change),self.assertRaises(ValueError):self.observe(dict(LOADED,**change))
 def test_original_pids_and_all_three_socket_paths_absent_required(self):
  for p in [Path('/proc/3106741'),Path('/proc/3106608'),M.JOB/'cluster/postmaster.pid',M.JOB/'socket/.s.PGSQL.55432',M.JOB/'socket/.s.PGSQL.55432.lock']:
   with self.subTest(path=str(p)),self.assertRaises(ValueError):self.observe(GC,missing=p)
 def test_nonempty_fixed_owned_cgroup_refuses(self):
  with self.assertRaisesRegex(ValueError,'CGROUP_NOT_EMPTY'):self.observe(GC,missing=Path('/sys/fs/cgroup/system.slice')/M.UNIT,cgroup='123\n')
 def test_original_five_pid_invocation_or_running_role_drift_refuses(self):
  for change in (dict(MainPID='1'),dict(InvocationID='f'*32),dict(SubState='dead'),dict(ActiveState='failed'),dict(LoadState='not-found')):
   v=copy.deepcopy(FIVE);v[next(iter(v))].update(change)
   with self.subTest(change=change),self.assertRaisesRegex(ValueError,'FIVE_DRIFT'):self.observe(GC,five=v)
 def test_wrong_completion_plan_stopped_status_mutation_refuses(self):
  for change in (dict(planSha256='f'*64),dict(privateClusterStopped=False),dict(status='failed'),dict(productionDatabaseMutation=True),dict(schema='other')):
   with self.subTest(change=change),self.assertRaisesRegex(ValueError,'FIXED_COMPLETION'):self.observe(GC,completed=change)
 def test_properties_duplicate_unknown_missing_refuse(self):
  fields=('LoadState','MainPID');good='LoadState=not-found\nMainPID=0\n'
  with patch.object(M,'command',return_value=good):self.assertEqual(M.properties(M.UNIT,fields),dict(LoadState='not-found',MainPID='0'))
  for wire in ('LoadState=not-found\n',good+'MainPID=1\n',good+'Other=1\n','malformed\n'+good):
   with patch.object(M,'command',return_value=wire),self.assertRaises(ValueError):M.properties(M.UNIT,fields)
 def test_unchanged_helpers_and_declared_only_main_profile_schema_diff(self):
  old=Path('/tmp/pow-audit30-oct3-restore-poststop-observer-v1.py').read_bytes();extract=lambda b:{n.name:ast.dump(n,include_attributes=False)for n in ast.parse(b).body if isinstance(n,ast.FunctionDef)};a,b=extract(old),extract(raw);self.assertEqual(set(a),set(b));self.assertEqual({n for n in a if a[n]!=b[n]},{'main'});self.assertNotIn('systemctl\',\'stop',raw.decode());self.assertNotIn('pg_ctl',raw.decode());self.assertNotIn('psql',raw.decode())
 def test_real_command_alarm_unwinds_blocked_subprocess_and_reaps(self):
  # Exact main-local timeout handler executes through command()'s real
  # subprocess.run; only its literal local helper is started, no native tool.
  tree=ast.parse(raw);main=next(n for n in tree.body if isinstance(n,ast.FunctionDef)and n.name=='main');handler=next(n for n in main.body if isinstance(n,ast.FunctionDef)and n.name=='timeout');namespace={};exec(compile(ast.Module(body=[handler],type_ignores=[]),str(SOURCE),'exec'),namespace);old=signal.signal(signal.SIGALRM,namespace['timeout'])
  try:
   with tempfile.TemporaryDirectory()as td:
    ready=Path(td)/'ready';errors=[]
    def send():
     until=time.monotonic()+2
     while not ready.exists()and time.monotonic()<until:time.sleep(.005)
     if not ready.exists():errors.append('not-ready');return
     os.kill(os.getpid(),signal.SIGALRM)
    thread=threading.Thread(target=send);thread.start()
    try:
     with self.assertRaisesRegex(TimeoutError,'50_SECOND_DEADLINE'):M.command([sys.executable,'-I','-B','-c','import os,pathlib,sys,time;pathlib.Path(sys.argv[1]).write_text(str(os.getpid()));time.sleep(4)',str(ready)])
     thread.join();self.assertEqual(errors,[])
     with self.assertRaises(ProcessLookupError):os.kill(int(ready.read_text()),0)
    finally:thread.join()
  finally:signal.signal(signal.SIGALRM,old)
if __name__=='__main__':unittest.main()
