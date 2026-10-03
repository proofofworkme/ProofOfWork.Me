#!/usr/bin/python3 -I
import ast,base64,copy,hashlib,json,os,signal,subprocess,time,types,unittest
from pathlib import Path
from unittest.mock import patch
P=Path('/tmp/pow-audit30-physical-sizing-failure-observer-v1.py');D=types.ModuleType('observer_tests');exec(compile(P.read_bytes(),str(P),'exec'),D.__dict__)
RAW=Path('/tmp/pow-audit30-production-physical-sizing-request-v3.json').read_bytes();R,D.M,LEAF=D.N.decode(RAW)
def props():
 v={k:''for k in D.M.FIELDS};v.update(LoadState='loaded',ActiveState='failed',SubState='failed',MainPID='0',InvocationID='a'*32,User='postgres',Group='postgres',Type='exec',Transient='yes',RemainAfterExit='yes',Result='exit-code',ExecMainStatus='1');return v
def value():return {'schema':'pow-audit30-production-physical-sizing-native-outcome-v2','status':'failed','requestSha256':D.REQUEST_SHA,'managedSha256':D.N.MANAGED_SHA,'leafSha256':D.N.LEAF_SHA,'unit':D.N.UNIT,'failure':{'errorClass':'ValueError','reasonSha256':D.sha(b'SIZING_LEAF_FAILED')},'cleanup':{'verified':True,'alreadyAbsent':True,'ownedInvocation':'a'*32},'resourceSnapshots':[],'result':None,'productionMutation':False,'recoveryActivation':False,'automaticRetry':False}
class Tests(unittest.TestCase):
 def test_exact_native_request(self):self.assertEqual(D.sha(RAW),D.REQUEST_SHA);self.assertEqual(D.sha(base64.b64decode(D.NATIVE_BASE64)),D.NATIVE_SHA);self.assertEqual(D.sha(LEAF),D.N.LEAF_SHA)
 def test_saved_failure_closed(self):self.assertEqual(D.outcome(value())['failure']['errorClass'],'ValueError')
 def test_unexpected_result_refuses(self):
  v=value();v['result']={'private':'must never export'}
  with self.assertRaisesRegex(ValueError,'NO_RESULT'):D.outcome(v)
 def test_wrong_request_refuses(self):
  v=value();v['requestSha256']='0'*64
  with self.assertRaises(ValueError):D.outcome(v)
 def test_extra_saved_field_refuses(self):
  v=value();v['secret']='never export'
  with self.assertRaises(ValueError):D.outcome(v)
 def test_cleanup_refusal_preserved(self):
  v=value();v['cleanup']={'verified':False,'errorClass':'RuntimeError','reasonSha256':'1'*64};self.assertFalse(D.outcome(v)['cleanup']['verified'])
 def test_cleanup_extra_refuses(self):
  v=value();v['cleanup']['extra']='private'
  with self.assertRaises(ValueError):D.outcome(v)
 def test_closed_leaf_stderr(self):
  b=json.dumps({'schema':'pow-audit30-production-physical-sizing-refusal-v1','errorClass':'ValueError','reasonSha256':'2'*64,'productionMutation':False}).encode();v=D.stderr_summary(b);self.assertEqual(v['jsonGuard'],'CLOSED_LEAF_REFUSAL');self.assertNotIn('raw',v)
 def test_unknown_stderr_never_exported(self):
  b=b'password=secret /private/path';v=D.stderr_summary(b);self.assertEqual(v['jsonGuard'],'NOT_SINGLE_CLOSED_JSON');self.assertNotIn('secret',json.dumps(v))
 def test_unexpected_stderr_json_not_exported(self):
  v=D.stderr_summary(b'{"body":"secret"}');self.assertEqual(v['jsonGuard'],'UNEXPECTED_JSON_SHAPE');self.assertNotIn('secret',json.dumps(v))
 def test_failure_names_from_exact_source(self):self.assertEqual(D.source_guards(base64.b64decode(D.NATIVE_BASE64))[D.sha(b'SIZING_LEAF_FAILED')],'SIZING_LEAF_FAILED');self.assertNotIn(D.sha(b'unknown secret'),D.source_guards(LEAF))
 def test_property_projection_closed(self):
  p=props();p['StandardError']='secret';v=D.properties(p);self.assertNotIn('secret',json.dumps(v));p['unexpected']='no'
  with self.assertRaises(ValueError):D.properties(p)
 def test_resource_snapshot_closed(self):
  v=value();v['resourceSnapshots']=[{'atUtc':'2026-10-03T10:18:00+00:00','properties':props(),'typed':{'objectPath':'/org/freedesktop/systemd1/unit/fixed','argvSha256':D.sha(D.N.encoded(D.M.ARGV))},'fragment':{'path':'/run/systemd/transient/'+D.N.UNIT,'sha256':'3'*64,'metadata':{},'selectedDirectives':{}}}];self.assertEqual(D.outcome(v)['resourceSnapshotCount'],1);v['resourceSnapshots'][0]['typed']['argvSha256']='0'*64
  with self.assertRaises(ValueError):D.outcome(v)
 def test_no_control_or_sql_call(self):
  tree=ast.parse(P.read_bytes());calls=[ast.unparse(x.func)for x in ast.walk(tree)if isinstance(x,ast.Call)];self.assertFalse(any(x in calls for x in('M.owned_stop','M.durable','N.main','M.typed','M.backup_metadata')));self.assertNotIn('flock',P.read_text());self.assertNotIn('systemctl\',\'stop',P.read_text())
 def test_wrong_metadata_command_refuses(self):
  D.DEADLINE=time.monotonic()+60
  with self.assertRaisesRegex(ValueError,'ONLY_FIXED'):D.command(['/usr/bin/systemctl','stop',D.N.UNIT])
 def test_real_child_signal_cleanup(self):
  real=subprocess.Popen;children=[];old=signal.getsignal(signal.SIGALRM)
  def spawn(*a,**k):
   p=real(['/usr/bin/python3','-I','-B','-c','import time;time.sleep(20)'],**k);children.append(p);return p
  def stop(*_):raise D.ObservationInterrupted('REAL_SIGNAL')
  D.DEADLINE=time.monotonic()+60;signal.signal(signal.SIGALRM,stop);signal.setitimer(signal.ITIMER_REAL,.04)
  try:
   with patch.object(D.subprocess,'Popen',spawn):
    with self.assertRaisesRegex(D.ObservationInterrupted,'REAL_SIGNAL'):D.command(['/usr/bin/systemctl','show',D.N.UNIT,'--no-pager','--property=MainPID'])
   self.assertIsNotNone(children[0].poll())
  finally:signal.setitimer(signal.ITIMER_REAL,0);signal.signal(signal.SIGALRM,old)
 def test_main_wrong_role_before_read(self):
  with patch.object(D.os,'geteuid',return_value=1000),patch.object(D.os,'getegid',return_value=1000):
   with self.assertRaisesRegex(ValueError,'FIXED_ISOLATED'):D.main()
if __name__=='__main__':unittest.main()
