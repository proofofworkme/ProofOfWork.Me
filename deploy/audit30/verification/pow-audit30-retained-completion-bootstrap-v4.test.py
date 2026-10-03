#!/usr/bin/python3 -I
import base64,copy,hashlib,importlib.util,json,os,signal,subprocess,sys,tempfile,time,types,unittest
from pathlib import Path
from unittest.mock import patch
P=Path('/tmp/pow-audit30-retained-completion-bootstrap-v4.py');sp=importlib.util.spec_from_file_location('bootstrap',P);B=importlib.util.module_from_spec(sp);sp.loader.exec_module(B)
class Tests(unittest.TestCase):
 def setUp(self):self.tmp=tempfile.TemporaryDirectory();self.base=Path(self.tmp.name);self.r=json.loads(Path('/tmp/pow-audit30-retained-completion-prepare-request-062000-v1.json').read_bytes())
 def tearDown(self):self.tmp.cleanup()
 def test_exact_prepare_run_code_and_canonical_plan_bindings(self):
  for mode in ['prepare','run']:
   r=copy.deepcopy(self.r);r['mode']=mode;code,raw,p=B.decode_request(r);self.assertEqual(hashlib.sha256(code).hexdigest(),B.CONTROLLER_SHA);self.assertEqual(hashlib.sha256(raw).hexdigest(),r['planSha256']);self.assertEqual(p['job'],str(B.JOB));self.assertEqual(p['sealedSource'],str(B.SOURCE))
 def test_extra_scope_wrong_host_mode_source_or_plan_hash_refuse(self):
  for key,value in [('approvalSha256','0'*64),('host','another'),('mode','delete'),('runId','20261303T062000Z'),('planSha256','0'*64),('controllerBase64',base64.b64encode(b'raise RuntimeError("sentinel")').decode())]:
   r=copy.deepcopy(self.r);r[key]=value
   with self.subTest(key=key),self.assertRaises(ValueError):B.decode_request(r)
  r=copy.deepcopy(self.r);r['extra']=True
  with self.assertRaises(ValueError):B.decode_request(r)
 def test_noncanonical_plan_and_wrong_unit_recomputed_sha_refuse(self):
  plan=json.loads(base64.b64decode(self.r['planBase64']))
  for raw in [json.dumps(plan).encode(),B.encoded(plan|{'unit':'postgresql@16-main.service'}),B.encoded(plan|{'controllerSha256':'0'*64})]:
   r=copy.deepcopy(self.r);r['planBase64']=base64.b64encode(raw).decode();r['planSha256']=hashlib.sha256(raw).hexdigest()
   with self.assertRaises(ValueError):B.decode_request(r)
 def test_unit_caps_and_loadcredential_exact_unchanged_guards(self):
  package=B.BASE/self.r['runId'];p=B.properties(package);self.assertEqual(p['MemoryMax'],str(8*1024**3));self.assertEqual(p['RuntimeMaxSec'],'15min');self.assertEqual(p['ReadWritePaths'],str(B.JOB));self.assertEqual(p['LoadCredential'],'completion-plan:'+str(package/'reviewed-plan.json'));self.assertEqual(p['PrivateNetwork'],'yes');self.assertEqual(p['ProtectSystem'],'strict');self.assertIn(str(B.SOURCE/'socket'),p['InaccessiblePaths']);self.assertIn('-/data/proofofwork-postgres-backups/physical',p['InaccessiblePaths']);self.assertNotIn(str(B.SOURCE),p['ReadWritePaths'])
 def test_actual_constructed_command_names_fixed_uid_guard_and_credential(self):
  package=B.BASE/self.r['runId'];unit='proofofwork-audit30-stream-completion-'+self.r['runId']+'.service';cmd,argv=B.command(unit,package,self.r['planSha256']);self.assertEqual(argv,['/usr/bin/python3','-I','-B',str(package/'controller.py'),'--plan','/run/credentials/'+unit+'/completion-plan','--plan-sha256',self.r['planSha256']]);self.assertEqual(cmd[-len(argv):],argv);self.assertIn('--uid=postgres',cmd);self.assertIn('--gid=postgres',cmd);self.assertIn('--property=LoadCredential=completion-plan:'+str(package/'reviewed-plan.json'),cmd);self.assertIn('--wait',cmd);self.assertIn('--pipe',cmd)
 def typed(self,change=None):
  unit='proofofwork-audit30-stream-completion-20261003T062000Z.service';argv=['/usr/bin/python3','-I','-B','/fixed/controller.py'];d=dict(LoadState='loaded',User='postgres',Group='postgres',Type='exec',Transient='yes',MainPID='12',InvocationID='b'*32,ControlGroup='/system.slice/'+unit);path='/org/freedesktop/systemd1/unit/'+''.join(c if c.isascii()and c.isalnum()else '_'+format(ord(c),'02x')for c in unit);obj={'type':'o','data':[path]};entry=[argv[0],copy.deepcopy(argv),False,1,200,0,0,12,0,0];start={'type':'a(sasbttttuii)','data':[entry]}
  if change:change(d,obj,start)
  results=[('\n'.join(k+'='+v for k,v in d.items())+'\n').encode(),json.dumps(obj).encode(),json.dumps(start).encode()]
  with patch.object(B,'fixed_command',side_effect=results):return B.owned_unit(unit,argv,100,None)
 def test_exact_typed_exec_identity_owns_only_fresh_admitted_command(self):self.assertEqual(self.typed(),'b'*32)
 def test_wrong_getunit_object_command_role_cgroup_or_oldstart_refuse(self):
  for action in [lambda d,o,s:d.update(User='root'),lambda d,o,s:d.update(ControlGroup=''),lambda d,o,s:o.update(data=['/org/freedesktop/systemd1/unit/other']),lambda d,o,s:s['data'][0][1].append('--unreviewed'),lambda d,o,s:s['data'][0].__setitem__(4,99),lambda d,o,s:s['data'][0].__setitem__(2,True)]:
   with self.assertRaises(ValueError):self.typed(action)
 def test_typed_start_pending_never_adopted(self):
  with self.assertRaises(B.NotReady):self.typed(lambda d,o,s:s['data'][0].__setitem__(4,0))
 def test_loaded_preexisting_unit_absence_refuses_without_stop(self):
  with patch.object(B.subprocess,'run',return_value=types.SimpleNamespace(returncode=0,stderr='',stdout='loaded\n'))as run,self.assertRaises(ValueError):B.unit_new('fixed.service')
  self.assertEqual(run.call_count,1);self.assertNotIn('stop',run.call_args.args[0])
 def test_source_member_fullhash_metadata_weak_link_and_changed_bytes_refuse(self):
  f=self.base/'source';f.write_bytes(b'exact');f.chmod(0o600);m=B.metadata(f);h=hashlib.sha256(b'exact').hexdigest();self.assertEqual(B.read_bound(f,m,h,5,os.getuid(),os.getgid(),0o600),b'exact');f.write_bytes(b'wrong')
  with self.assertRaises(ValueError):B.read_bound(f,m,h,5,os.getuid(),os.getgid(),0o600)
  m=B.metadata(f);f.chmod(0o644)
  with self.assertRaises(ValueError):B.read_bound(f,m,h,5,os.getuid(),os.getgid(),0o600)
 def test_symlink_read_and_capture_collision_refuse_before_child(self):
  f=self.base/'file';f.write_bytes(b'exact');f.chmod(0o600);link=self.base/'link';link.symlink_to(f)
  with self.assertRaises(ValueError):B.read_bound(link,B.metadata(link),hashlib.sha256(b'exact').hexdigest(),5,os.getuid(),os.getgid(),0o600)
  capture=self.base/'capture';capture.write_bytes(b'preserved')
  with patch.object(B.subprocess,'Popen')as popen,self.assertRaises(FileExistsError):B.capture_unit([],capture,'fixed.service',1,1,[])
  popen.assert_not_called();self.assertEqual(capture.read_bytes(),b'preserved')
 def test_terminal_requires_observed_invocation_and_same_owned_or_gc_endpoint(self):
  d=dict(LoadState='not-found',ActiveState='inactive',SubState='dead',MainPID='0',InvocationID='',User='',Group='',Type='',Transient='')
  raw=('\n'.join(k+'='+v for k,v in d.items())+'\n').encode()
  with patch.object(B,'fixed_command',return_value=raw):
   self.assertTrue(B.terminal_unit('fixed.service','b'*32)['qualifiedGarbageCollected'])
   with self.assertRaises(ValueError):B.terminal_unit('fixed.service',None)
  for key,value in [('MainPID','12'),('LoadState','loaded'),('InvocationID','c'*32)]:
   bad=d|{key:value};raw=('\n'.join(k+'='+v for k,v in bad.items())+'\n').encode()
   with self.subTest(key=key),patch.object(B,'fixed_command',return_value=raw),self.assertRaises(ValueError):B.terminal_unit('fixed.service','b'*32)
 def test_real_capture_returns_observed_invocation_wait_and_terminal_qualification(self):
  output=self.base/'success';argv=[sys.executable,'-I','-B','-c','print("complete",flush=True)']
  with patch.object(B,'owned_unit',return_value='b'*32),patch.object(B,'terminal_unit',return_value={'endpoint':'stopped'}):r=B.capture_unit(argv,output,'fixed.service',5,1024,argv)
  self.assertEqual(r['observedInvocation'],'b'*32);self.assertEqual(r['systemdWaitExitCode'],0);self.assertTrue(r['rootWaitSucceeded']);self.assertTrue(r['unitStoppedAtEndpoint']);self.assertFalse(r['privateClusterStoppedCertifiedByCapture']);self.assertEqual(output.read_bytes(),b'complete\n')
 def test_owned_cleanup_refusal_is_retained_without_replacing_first_failure(self):
  output=self.base/'failed';argv=[sys.executable,'-I','-B','-c','import sys;sys.exit(2)']
  with patch.object(B,'owned_unit',return_value='b'*32),patch.object(B.subprocess,'run',return_value=types.SimpleNamespace(returncode=1)),self.assertRaisesRegex(RuntimeError,'Private unit refused'):B.capture_unit(argv,output,'fixed.service',5,1024,argv)
  r=json.loads(Path(str(output)+'.failed.json').read_bytes());self.assertEqual(r['firstErrorClass'],'RuntimeError');self.assertEqual(r['observedInvocation'],'b'*32);self.assertTrue(r['cleanup']['attempted']);self.assertFalse(r['cleanup']['unitStoppedAtEndpoint']);self.assertEqual(r['cleanup']['errors'],[{'phase':'owned-unit-stop','errorClass':'RuntimeError'}])
 def test_real_signal_preserves_partial_masks_cleanup_and_reaps_own_client(self):
  ready=self.base/'ready';pid=self.base/'pid';out=self.base/'capture';code='import os,time;from pathlib import Path;Path('+repr(str(pid))+').write_text(str(os.getpid()));print("partial",flush=True);Path('+repr(str(ready))+').write_text("ready");time.sleep(30)';killer_code='import os,time,signal;from pathlib import Path;p=Path('+repr(str(ready))+');end=time.monotonic()+3\nwhile not p.exists()and time.monotonic()<end:time.sleep(.005)\nassert p.exists();os.kill('+str(os.getpid())+',signal.SIGINT)';killer=subprocess.Popen([sys.executable,'-I','-B','-c',killer_code]);old={s:signal.getsignal(s)for s in(signal.SIGINT,signal.SIGTERM,signal.SIGHUP)}
  def handler(*a):raise B.BootstrapInterrupted('fixture signal')
  for s in old:signal.signal(s,handler)
  stop=[]
  def run(argv,**kw):stop.append(argv);os.kill(os.getpid(),signal.SIGTERM);os.kill(os.getpid(),signal.SIGHUP);return types.SimpleNamespace(returncode=0)
  try:
   with patch.object(B,'owned_unit',return_value='b'*32),patch.object(B.subprocess,'run',side_effect=run),patch.object(B,'terminal_unit',return_value={'endpoint':'stopped'}),self.assertRaises(B.BootstrapInterrupted):B.capture_unit([sys.executable,'-I','-B','-c',code],out,'fixed.service',5,1024,[])
  finally:
   for s,h in old.items():signal.signal(s,h)
  self.assertEqual(killer.wait(timeout=2),0);self.assertEqual(out.read_bytes(),b'partial\n');self.assertEqual(stop,[['/usr/bin/systemctl','stop','fixed.service']]);failure=json.loads(Path(str(out)+'.failed.json').read_bytes());self.assertEqual(failure['firstErrorClass'],'BootstrapInterrupted');self.assertEqual(failure['observedInvocation'],'b'*32);self.assertTrue(failure['cleanup']['unitStoppedAtEndpoint']);self.assertEqual(failure['cleanup']['errors'],[])
  with self.assertRaises(ProcessLookupError):os.kill(int(pid.read_text()),0)
if __name__=='__main__':unittest.main()
