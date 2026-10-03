import ast,hashlib,os,pathlib,selectors,signal,subprocess,sys,tempfile,time,unittest
SRC=pathlib.Path('/tmp/pow-audit30-node-stage-04e685-v1.py').read_text(); module=ast.parse(SRC); REMOTE=next(n.value.value for n in module.body if isinstance(n,ast.Assign)and any(isinstance(t,ast.Name)and t.id=='REMOTE'for t in n.targets)); tree=ast.parse(REMOTE)
FUN=ast.Module(body=[n for n in tree.body if isinstance(n,ast.FunctionDef)and n.name in {'bounded_stage','stop_owned'}],type_ignores=[])
class Tests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.root=pathlib.Path(self.tmp.name);self.stops=[];self.calls=0
  def shape(unit):
   self.calls+=1
   return {'LoadState':'not-found'}if self.calls==1 else {'LoadState':'loaded','InvocationID':'c'*32,'User':'root','Group':'root','ExecStart':str(self.root/'stage.sh'),'MainPID':'0'}
  self.oldsignals={s:signal.getsignal(s)for s in [signal.SIGTERM,signal.SIGINT]}
  self.ns=dict(os=os,subprocess=subprocess,selectors=selectors,signal=signal,cleanup_errors=[],time=time,root=self.root,ENV={'PATH':'/usr/bin:/bin'},unit_shape=shape,sync=lambda p:None)
  exec(compile(FUN,'<reviewed-stage-functions>','exec'),self.ns);self.ns['stop_owned']=lambda u,i:self.stops.append((u,i))
 def tearDown(self):
  for s,h in self.oldsignals.items():signal.signal(s,h)
  self.tmp.cleanup()
 def paths(self):return [self.root/'stdout',self.root/'stderr']
 def run_stage(self,code,**kwargs):return self.ns['bounded_stage']([sys.executable,'-I','-B','-c',code],self.paths(),'owned.service',**kwargs)
 def test_success_bytes(self):
  status,counts,inv=self.run_stage('import sys;sys.stdout.write("abc");sys.stderr.write("de")');self.assertEqual((status,counts),(0,[3,2]));self.assertEqual(self.paths()[0].read_bytes(),b'abc');self.assertEqual(self.stops,[])
 def test_failure_stops_owned(self):
  status,_,_=self.run_stage('import sys;print("failed");sys.exit(1)');self.assertEqual(status,1);self.assertEqual(self.stops,[('owned.service','c'*32)])
 def test_log_cap_refuses_and_stops(self):
  with self.assertRaisesRegex(AssertionError,'STAGE_LOG_CAP'):self.run_stage('import os;os.write(1,b"x"*33)',limit=32)
  self.assertEqual(len(self.stops),1);self.assertLessEqual(self.paths()[0].stat().st_size,32)
 def test_deadline_stops_and_reaps(self):
  with self.assertRaisesRegex(AssertionError,'STAGE_TRANSPORT_DEADLINE'):self.run_stage('import time;time.sleep(5)',timeout=.01)
  self.assertEqual(len(self.stops),1)
 def test_existing_unit_refuses_before_files(self):
  self.ns['unit_shape']=lambda u:{'LoadState':'loaded'}
  with self.assertRaisesRegex(AssertionError,'STAGE_UNIT_ALREADY_EXISTS'):self.run_stage('pass')
  self.assertTrue(all(not p.exists()for p in self.paths()))
 def test_changed_unit_refuses(self):
  self.ns['unit_shape']=lambda u:{'LoadState':'not-found'}if self.calls==0 and self._increment() else {'LoadState':'loaded','InvocationID':'c'*32,'User':'other','Group':'root','ExecStart':str(self.root/'stage.sh')}
  with self.assertRaisesRegex(AssertionError,'STAGE_UNIT_IDENTITY_CHANGED'):self.run_stage('import time;time.sleep(.2)')
 def _increment(self):self.calls+=1;return True
 def test_output_collision_preserved(self):
  self.paths()[0].write_bytes(b'old')
  with self.assertRaises(FileExistsError):self.run_stage('print("new")')
  self.assertEqual(self.paths()[0].read_bytes(),b'old')
 def test_stop_failure_still_reaps_and_ignores_repeated_signal(self):
  processes=[]
  class P:
   PIPE=subprocess.PIPE;TimeoutExpired=subprocess.TimeoutExpired
   @staticmethod
   def Popen(*a,**k):p=subprocess.Popen(*a,**k);processes.append(p);return p
  self.ns['subprocess']=P
  def refuse(unit,inv):
   os.kill(os.getpid(),signal.SIGTERM);os.kill(os.getpid(),signal.SIGINT);raise RuntimeError('stop-proof-refusal')
  self.ns['stop_owned']=refuse
  with self.assertRaisesRegex(AssertionError,'STAGE_LOG_CAP'):self.run_stage('import os,time;os.write(1,b"x"*33);time.sleep(5)',limit=32)
  self.assertIsNotNone(processes[0].poll());self.assertEqual(self.ns['cleanup_errors'],[{'action':'owned-unit-stop','errorClass':'RuntimeError'}]);self.assertEqual(signal.getsignal(signal.SIGTERM),signal.SIG_IGN)
 def test_stop_refuses_changed_invocation(self):
  exec(compile(ast.Module(body=[n for n in tree.body if isinstance(n,ast.FunctionDef)and n.name=='stop_owned'],type_ignores=[]),'<stop>','exec'),self.ns)
  self.ns['unit_shape']=lambda u:{'LoadState':'loaded','InvocationID':'a'*32,'User':'root','Group':'root','ExecStart':str(self.root/'stage.sh')};self.ns['subprocess']=type('P',(),{'run':lambda *a,**k:self.fail('must not stop')})
  with self.assertRaisesRegex(AssertionError,'STAGE_UNIT_IDENTITY_CHANGED'):self.ns['stop_owned']('owned.service','c'*32)
 def test_stage_shell_has_only_two_scope_substitutions(self):
  old=pathlib.Path('/tmp/audit28-stage-node.sh').read_bytes();self.assertEqual(hashlib.sha256(old).hexdigest(),'bfa59cca9f18d0ba43b4972cf5de38a3abb43aa188f3f7772e2c0c012bb2575a');new=old.decode().replace('proofofwork-audit28-source-','proofofwork-audit5-source-').replace('proofofwork-audit28-node-work-','proofofwork-audit5-node-work-').encode();self.assertEqual(hashlib.sha256(new).hexdigest(),'4733a2c7d5d4cee4a957b7acb1569a9dfc5fa85022fab4988f50049436b101e8')
 def test_source_binds_and_preserves_no_cutover(self):
  self.assertIn("'release.py':'09afe5ddd243a796ea9c830b0041924747eb77a3803a3cfe56a3279cd24bf670'",REMOTE);self.assertIn("signal.signal(signal.SIGTERM,interrupted)",REMOTE);self.assertNotIn('node-cutover',REMOTE);self.assertIn('cutover=False',REMOTE)
 def test_postlock_identity_is_fenced(self):
  self.assertIn("fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB);assert stamp(os.fstat(fd))==stamp(v)==stamp(lock.lstat())",REMOTE)
if __name__=='__main__':unittest.main()
