import unittest,importlib.util,pathlib,json,copy,subprocess,sys,tempfile,time,os,signal
from unittest.mock import patch
SOURCE=pathlib.Path('/tmp/pow-audit30-coupled-promotion-state-observer-v1.py')
spec=importlib.util.spec_from_file_location('observer',SOURCE);O=importlib.util.module_from_spec(spec);spec.loader.exec_module(O);O.M=O.load_v5()
REQ=json.loads(pathlib.Path('/tmp/pow-audit30-coupled-promotion-state-observer-request-v1.json').read_bytes());EXPECTED=REQ['expected']
def states():
 out=copy.deepcopy(EXPECTED['units'])
 for n in O.M.LIVE+(O.M.BACKUP_SERVICE,):out[n]['UnitFileState']='enabled'
 return out
def wire(ss):
 def run(argv,**kw):return subprocess.CompletedProcess(argv,0,''.join(k+'='+ss[argv[2]][k]+'\n'for k in O.M.PROPERTIES_BY_UNIT[argv[2]]).encode(),b'')
 return run
PROJ={'role':'node','ok':False,'issues':['historical-held-path-missing-or-retirement-invalid'],'units':{},'historicalHeldInventory':{'heldPaths':521,'missingHeldPaths':['known-'+str(i)for i in range(18)],'unexpectedRetiredPathsPresent':[],'unexpectedRelocatedOriginalPathsPresent':[]}}
class Tests(unittest.TestCase):
 def test_frozen_source_and_no_main_execution(self):
  self.assertEqual(O.M.__name__,'frozen_promotion_v5');self.assertFalse(O.M.__name__=='__main__');self.assertEqual(O.M.sha(__import__('base64').b64decode(O.V5_B64)),O.V5_SHA)
 def test_exact_current2_request(self):self.assertEqual(O.validate_request(REQ),EXPECTED)
 def test_request_context_tampering_refuses(self):
  r=copy.deepcopy(REQ);r['contextBinding']['sha256']='0'*64
  with self.assertRaises(O.ObserverRefused):O.validate_request(r)
 def test_request_expected_tampering_refuses(self):
  r=copy.deepcopy(REQ);r['expected']['units']['bitcoind.service']['MainPID']='1'
  with self.assertRaises(O.ObserverRefused):O.validate_request(r)
 def test_exact_perunit_wire_observes_missing_fields(self):
  with patch.object(O.M.subprocess,'run',wire(states())):v=O.M.unit_states()
  O.states_check(v,EXPECTED['units']);self.assertIn('UnitFileState',v['bitcoind.service']);self.assertNotIn('MainPID',v[O.M.BACKUP_TIMER]);self.assertNotIn('MainPID',v[O.M.PRUNE])
 def test_missing_duplicate_unknown_wire_each_refuses(self):
  for suffix in ('missing','duplicate','unknown'):
   def run(argv,**kw):
    row=states()[argv[2]];raw=''.join(k+'='+row[k]+'\n'for k in O.M.PROPERTIES_BY_UNIT[argv[2]])
    if suffix=='missing':raw=raw.replace('UnitFileState=enabled\n','')
    elif suffix=='duplicate':raw+='LoadState=loaded\n'
    else:raw+='Invented=wrong\n'
    return subprocess.CompletedProcess(argv,0,raw.encode(),b'')
   with self.subTest(suffix=suffix),patch.object(O.M.subprocess,'run',run),self.assertRaises(ValueError):O.M.unit_states()
 def test_external_pid_drift_refuses(self):
  s=states();s['bitcoind.service']['MainPID']='1'
  with self.assertRaises(O.ObserverRefused):O.states_check(s,EXPECTED['units'])
 def test_monitor_only_fresh_operational_tuple(self):
  s=states();s[O.M.MONITOR]['InvocationID']='a'*32;s[O.M.MONITOR]['ActiveState']='inactive';s[O.M.MONITOR]['SubState']='dead';O.states_check(s,EXPECTED['units'])
  for k,v in [('MainPID','42'),('ActiveState','active'),('UnitFileState','enabled')]:
   bad=copy.deepcopy(s);bad[O.M.MONITOR][k]=v
   with self.subTest(k=k),self.assertRaises(O.ObserverRefused):O.states_check(bad,EXPECTED['units'])
 def test_monitor_known18_projection(self):self.assertEqual(O.M.monitor_projection(PROJ),PROJ)
 def test_monitor_duplicate_or_new_issue_refuses(self):
  for mutate in [lambda v:v['historicalHeldInventory']['missingHeldPaths'].append('new'),lambda v:v['historicalHeldInventory']['missingHeldPaths'].__setitem__(0,'known-1'),lambda v:v['issues'].append('newissue')]:
   v=copy.deepcopy(PROJ);mutate(v)
   with self.assertRaises(ValueError):O.M.monitor_projection(v)
 def test_no_command_or_option_expansion(self):
  for argv in [['/usr/bin/systemctl','stop','x'],['/usr/bin/python3','-I','-B','/tmp/other.py'],['/usr/bin/systemctl','show','bitcoind.service','-p','MainPID']]:
   with self.assertRaises(O.ObserverRefused):O.frozen_run(argv,env=O.M.ENV,stdin=subprocess.DEVNULL,capture_output=True,timeout=5)
 def test_static_authority_and_known_lock_drift_refuse(self):
  def fake(p,limit=0,expected=None):
   if str(p)in EXPECTED['files']:
    r=EXPECTED['files'][str(p)];b=O.M.OLD_PIN if p==O.M.PIN else str(p).encode();return b,copy.deepcopy(r['metadata'])
   m=copy.deepcopy(EXPECTED['backupLockMetadata']);m.update(uid=0,gid=0)
   if p==O.M.BACKUP_LOCK:m=copy.deepcopy(EXPECTED['backupLockMetadata'])
   return b'',m
  def digest(b):
   if b==O.M.OLD_PIN:return O.M.sha_original(b)
   return EXPECTED['files'][b.decode()]['sha256']
  O.M.sha_original=O.M.sha
  with patch.object(O.M,'read',fake),patch.object(O.M,'sha',digest),patch.object(O.M,'mask_state',return_value=EXPECTED['mask']):snap=O.file_snapshot(EXPECTED)
  self.assertEqual(set(snap['lockMetadata']),{str(O.M.OPS),str(O.M.BACKUP_LOCK)})
  def drift(p,limit=0,expected=None):
   b,m=fake(p,limit,expected)
   if p==O.M.CHECKER:m['inode']+=1
   return b,m
  with patch.object(O.M,'read',drift),patch.object(O.M,'sha',digest),patch.object(O.M,'mask_state',return_value=EXPECTED['mask']),self.assertRaises(O.ObserverRefused):O.file_snapshot(EXPECTED)
 def test_actual_literal_child_timeout_reaps_and_closes(self):
  with tempfile.TemporaryDirectory()as d:
   pid=pathlib.Path(d)/'pid';code='import os,time,pathlib;pathlib.Path('+repr(str(pid))+').write_text(str(os.getpid()));time.sleep(30)'
   with self.assertRaises(subprocess.TimeoutExpired):O.run_child([sys.executable,'-I','-B','-c',code],.12)
   n=int(pid.read_text())
   with self.assertRaises(ProcessLookupError):os.kill(n,0)
 def test_actual_signal_and_repeated_cleanup_reap(self):
  with tempfile.TemporaryDirectory()as d:
   pid=pathlib.Path(d)/'child';ready=pathlib.Path(d)/'ready';result=pathlib.Path(d)/'result'
   child='import os,time,pathlib;pathlib.Path('+repr(str(pid))+').write_text(str(os.getpid()));pathlib.Path('+repr(str(ready))+').touch();time.sleep(30)'
   code='import importlib.util,signal,pathlib,sys,json,os; s=importlib.util.spec_from_file_location("o",'+repr(str(SOURCE))+');o=importlib.util.module_from_spec(s);s.loader.exec_module(o)\n'
   code+='def h(n,f):raise o.ObserverInterrupted("literal signal")\nsignal.signal(signal.SIGTERM,h);signal.signal(signal.SIGINT,h)\n'
   code+='try:o.run_child([sys.executable,"-I","-B","-c",'+repr(child)+'],10)\nexcept o.ObserverInterrupted:pathlib.Path('+repr(str(result))+').write_text("refused-and-reaped")\n'
   p=subprocess.Popen([sys.executable,'-I','-B','-Werror','-c',code],stdout=subprocess.PIPE,stderr=subprocess.PIPE)
   try:
    deadline=time.monotonic()+3
    while not ready.exists()and time.monotonic()<deadline:time.sleep(.01)
    self.assertTrue(ready.exists());p.send_signal(signal.SIGTERM);p.send_signal(signal.SIGINT);out,err=p.communicate(timeout=3);self.assertEqual(p.returncode,0,err);self.assertEqual(result.read_text(),'refused-and-reaped');self.assertEqual(err,b'')
    with self.assertRaises(ProcessLookupError):os.kill(int(pid.read_text()),0)
   finally:
    if p.poll()is None:p.kill();p.wait()
 def test_child_cap_refuses(self):
  with self.assertRaises(O.ObserverRefused):O.run_child([sys.executable,'-I','-B','-c','print("x"*65536)'],2)
if __name__=='__main__':unittest.main()
