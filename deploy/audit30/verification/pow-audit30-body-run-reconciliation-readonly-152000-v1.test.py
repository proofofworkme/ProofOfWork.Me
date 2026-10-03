import ast,hashlib,importlib.util,json,unittest
from pathlib import Path
from unittest.mock import patch
P=Path('/tmp/pow-audit30-body-run-reconciliation-readonly-152000-v1.py');s=importlib.util.spec_from_file_location('O',P);O=importlib.util.module_from_spec(s);s.loader.exec_module(O)
RAW=Path('/tmp/pow-audit30-body-run-envelope-20261003T152000Z-v1.json').read_bytes()
class Tests(unittest.TestCase):
 def test_exact_source_and_request(self):
  R,v,c=O.load(RAW);self.assertEqual(R.ROOT_SOURCE_SHA256,O.ROOT_SHA);self.assertEqual(v['runId'],O.RUN);self.assertEqual(v['mode'],'run');self.assertEqual(R.sha(RAW),O.REQUEST_SHA)
 def test_no_mutator_entry(self):
  R,_,_=O.load(RAW)
  for n in ('main','acquire_ops','dependency_copy','generated'):
   with self.assertRaisesRegex(RuntimeError,'FORBIDDEN_ENTRY'):getattr(R,n)()
 def test_bad_source_refuses(self):
  with self.assertRaisesRegex(ValueError,'EXACT_FAILED_RUN_ENVELOPE'):O.load(RAW+b' ')
 def test_public_projection_omits_records(self):
  v={'schema':'known','status':'committed','operation':'apply','bodyOnly':True,'targetCount':16,'orderedTargetTxids':['private'],'targets':[{'oldBody':'secret'}],'expectedDatabaseIdentity':{'private':'secret'},'error':'private error'}
  self.assertEqual(O.safe(v),{'schema':'known','status':'committed','operation':'apply','bodyOnly':True,'targetCount':16})
 def test_unsafe_public_values(self):
  for v in ({'errorClass':'raw secret /path'},{'targetCount':True},{'bodyOnly':'yes'},{'manifestSHA256':'bad'}):
   with self.assertRaises(ValueError):O.safe(v)
 def test_closed_guard_and_unknown(self):
  def denied():raise ValueError('INPUT_BYTES_CHANGED')
  v=O.fence('current',denied,{'INPUT_BYTES_CHANGED'});self.assertEqual(v['closedSourceGuard'],'INPUT_BYTES_CHANGED');self.assertFalse(v['passed'])
  def other():raise ValueError('private arbitrary details')
  v=O.fence('current',other,set());self.assertIsNone(v['closedSourceGuard']);self.assertNotIn('private',json.dumps(v))
 def test_interrupt_not_converted_to_observation(self):
  def stop():raise O.Interrupted('stop')
  with self.assertRaises(O.Interrupted):O.fence('current',stop,set())
 def test_no_write_database_control_calls_in_observer(self):
  a=ast.parse(P.read_text());calls=[]
  for n in ast.walk(a):
   if isinstance(n,ast.Call):
    f=n.func
    if isinstance(f,ast.Attribute):calls.append(f.attr)
  for banned in ('main','execute','capture_unit','connect','acquire_ops','create','record','newdir','flock','unlink','chmod','chown','mkdir'):self.assertNotIn(banned,calls)
  self.assertNotIn('selected-preimages.json',O.ROOT_FILES+O.NATIVE_FILES)
 def test_actual_timer_profile_has_no_invented_pid_or_cgroup(self):
  class Pipe:
   def close(self):pass
  class Child:
   stdout=Pipe();stderr=Pipe();returncode=0
   def communicate(self,timeout):return b'LoadState=loaded\nActiveState=active\nSubState=waiting\nInvocationID=abc\nUnitFileState=enabled\nNextElapseUSecRealtime=Sat 2026-10-03 23:00:00 UTC\n',b''
   def poll(self):return 0
  with patch.object(O.subprocess,'Popen',return_value=Child()) as launch:
   v=O.unit(O.TIMER);self.assertNotIn('MainPID',v);self.assertNotIn('ControlGroup',v);self.assertNotIn('--property=MainPID',launch.call_args.args[0])
 def test_actual_metadata_child_cleanup(self):
  class Pipe:
   def close(self):pass
  class Child:
   pid=123;stdout=Pipe();stderr=Pipe();returncode=None
   def communicate(self,timeout):raise O.Interrupted('operator')
   def poll(self):return None
   def wait(self,timeout):self.returncode=-9
  child=Child()
  with patch.object(O.subprocess,'Popen',return_value=child) as launch,patch.object(O.os,'killpg') as kill:
   with self.assertRaises(O.Interrupted):O.unit(O.UNIT)
   self.assertEqual(launch.call_args.kwargs['stdin'],0);kill.assert_called_once_with(123,O.signal.SIGKILL);self.assertEqual(child.returncode,-9)
if __name__=='__main__':unittest.main()
