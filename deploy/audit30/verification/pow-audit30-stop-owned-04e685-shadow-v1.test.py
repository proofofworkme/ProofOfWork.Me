import ast,hashlib,json,os,pathlib,signal,sys,unittest
p=pathlib.Path('/tmp/pow-audit30-stop-owned-04e685-shadow-v1.py');ns={'__name__':'_test'};exec(compile(p.read_bytes(),str(p),'exec'),ns)
class Tests(unittest.TestCase):
 def unit(self):return {'LoadState':'loaded','ActiveState':'active','MainPID':str(ns['PID']),'InvocationID':ns['INV'],'User':'root','Group':'root','KillMode':'control-group','RuntimeMaxUSec':'45min','Restart':'no','ExecStart':'argv[]=/usr/bin/python3 -I -B '+str(ns['TOOLS']/'private-env.py')+' launch --release-id '+ns['RELEASE']+' --mode readonly-shadow --source api ;'}
 def process(self):return dict(pid=ns['PID'],startTicks=123,uid=[1001]*4,gid=[1001]*4,exe=ns['NODE'],cwd=ns['CANDIDATE'],cgroup='0::/system.slice/'+ns['UNIT'],noNewPrivileges='1',capabilities=['0']*4,argvPrefix=[ns['NODE'],'--input-type=module','--eval'],argvCount=4,entrySHA256=ns['PINS']['shadow-entry.mjs'])
 def test_exact_active_identity(self):ns['validate_unit'](self.unit());ns['validate_process'](self.process(),1001,1001)
 def test_naturally_stopped_same_unit(self):u=self.unit();u.update(MainPID='0',ActiveState='failed');ns['validate_unit'](u)
 def test_post_stop_gc_not_found_allowed(self):ns['validate_stopped_unit']({'LoadState':'not-found','ActiveState':'inactive','MainPID':'0'})
 def test_post_stop_gc_cannot_hide_running_pid(self):self.assertRaisesRegex(ValueError,'OWNED_UNIT_NOT_STOPPED',ns['validate_stopped_unit'],{'LoadState':'not-found','ActiveState':'inactive','MainPID':'9'})
 def test_post_stop_changed_invocation_refused(self):u=self.unit();u.update(MainPID='0',ActiveState='inactive',InvocationID='a'*32);self.assertRaisesRegex(ValueError,'OWNED_UNIT_CHANGED',ns['validate_stopped_unit'],u)
 def test_changed_invocation_refused(self):u=self.unit();u['InvocationID']='a'*32;self.assertRaisesRegex(ValueError,'OWNED_UNIT_CHANGED',ns['validate_unit'],u)
 def test_changed_pid_refused(self):u=self.unit();u['MainPID']='1';self.assertRaisesRegex(ValueError,'OWNED_PID_CHANGED',ns['validate_unit'],u)
 def test_live_production_path_refused(self):p=self.process();p['cwd']='/opt/proofofwork-api';self.assertRaisesRegex(ValueError,'OWNED_PROCESS_CHANGED',ns['validate_process'],p,1001,1001)
 def test_changed_unit_command_refused(self):u=self.unit();u['ExecStart']=u['ExecStart'].replace('readonly-shadow','bootstrap-api');self.assertRaisesRegex(ValueError,'OWNED_UNIT_CHANGED',ns['validate_unit'],u)
 def test_auto_restart_refused(self):u=self.unit();u['Restart']='always';self.assertRaisesRegex(ValueError,'OWNED_UNIT_CHANGED',ns['validate_unit'],u)
 def test_changed_user_or_groups_refused(self):
  for k in ['User','Group']:
   u=self.unit();u[k]='powadmin';self.assertRaisesRegex(ValueError,'OWNED_UNIT_CHANGED',ns['validate_unit'],u)
  for k in ['uid','gid']:
   p=self.process();p[k]=[0]*4;self.assertRaisesRegex(ValueError,'OWNED_PROCESS_CHANGED',ns['validate_process'],p,1001,1001)
 def test_changed_cgroup_refused(self):p=self.process();p['cgroup']='0::/system.slice/proofofwork-api.service';self.assertRaisesRegex(ValueError,'OWNED_PROCESS_CHANGED',ns['validate_process'],p,1001,1001)
 def test_changed_entry_source_refused(self):p=self.process();p['entrySHA256']='a'*64;self.assertRaisesRegex(ValueError,'OWNED_PROCESS_COMMAND_CHANGED',ns['validate_process'],p,1001,1001)
 def test_extra_argv_refused(self):p=self.process();p['argvCount']=5;self.assertRaisesRegex(ValueError,'OWNED_PROCESS_COMMAND_CHANGED',ns['validate_process'],p,1001,1001)
 def test_changed_privilege_refused(self):
  p=self.process();p['capabilities'][0]='80';self.assertRaisesRegex(ValueError,'OWNED_PROCESS_CHANGED',ns['validate_process'],p,1001,1001)
  p=self.process();p['noNewPrivileges']='0';self.assertRaisesRegex(ValueError,'OWNED_PROCESS_CHANGED',ns['validate_process'],p,1001,1001)
 def test_actual_own_python_identity_refused(self):p=ns['identity'](os.getpid());self.assertRaisesRegex(ValueError,'OWNED_PROCESS_CHANGED',ns['validate_process'],p,os.getuid(),os.getgid())
 def test_signal_handler_raises(self):self.assertRaisesRegex(RuntimeError,'OWNED_SHADOW_STOP_SIGNAL',ns['interrupted'],signal.SIGTERM,None)
 def test_only_exact_stop_and_no_deletion(self):
  source=p.read_text();t=ast.parse(source);calls=[n for n in ast.walk(t)if isinstance(n,ast.Call)and isinstance(n.func,ast.Name)and n.func.id=='call' and n.args and isinstance(n.args[0],ast.List)]
  stop=[n for n in calls if any(isinstance(a,ast.Constant)and a.value=='stop'for a in n.args[0].elts)];self.assertEqual(len(stop),1);self.assertEqual(stop[0].args[0].elts[-1].id,'UNIT')
  self.assertNotIn('unlink(',source);self.assertNotIn('rmtree(',source);self.assertIn('LOCK_POSTFLOCK_DRIFT',source);self.assertIn('automaticRetry=False',source)
if __name__=='__main__':unittest.main()
