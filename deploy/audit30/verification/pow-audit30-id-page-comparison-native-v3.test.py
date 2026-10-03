"""Local mocked native-custody fixtures: no SSH/SQL/systemctl executed."""
import ast,contextlib,hashlib,importlib.util,io,json,os,pathlib,signal,subprocess,unittest
from unittest.mock import patch
P=pathlib.Path
SOURCE=P('/tmp/pow-audit30-id-page-comparison-native-v3.py').read_text();tree=ast.parse(SOURCE)
CODE=next(ast.literal_eval(x.value)for x in tree.body if isinstance(x,ast.Assign)and any(isinstance(t,ast.Name)and t.id=='code'for t in x.targets))
sp=importlib.util.spec_from_file_location('fixture','/tmp/pow-audit30-id-page-comparison-v3.test.py');f=importlib.util.module_from_spec(sp);sp.loader.exec_module(f)
VALID=P('/tmp/pow-audit30-id-page-comparison-verifier-v3.py').read_bytes();SQL=P('/tmp/pow-audit30-id-page-comparison-v3.sql').read_bytes()
LIVE=[('bitcoind.service','1324302','64e1fa7be2e2442d8c7f5763f60b85fb'),('electrs.service','1324320','72418b1c7ab245e4a37685ed868a1084'),('postgresql@16-main.service','1537429','e0bf545f0ad944e89fe1005577e61b9c'),('proofofwork-api.service','2103747','208f8bcbecc54afbb7166754f12065c2'),('proofofwork-indexer-worker.service','2103760','33b3ee25490749db89e0d55fd29d0afb')]
class Fake:
 def __init__(self,mode='ok'):self.mode=mode;self.commands=[];self.started=False;self.done=False;self.returncode=None;self.communications=0;self.terminated=False;self.stops=[]
 def run(self,argv,**kw):
  self.commands.append(argv)
  if argv[:2]==['/usr/bin/systemctl','show']:
   u=argv[2]
   d={'LoadState':'loaded','ActiveState':'active','MainPID':'0','InvocationID':'a'*32,'Result':'success'}
   for unit,pid,inv in LIVE:
    if u==unit:d.update(MainPID=pid,InvocationID=inv)
   if self.mode=='wrong-live'and u==LIVE[0][0]:d['InvocationID']='f'*32
   if u=='proofofwork-postgres-logical-backup.service':d['ActiveState']='activating'if self.mode=='backup-active'else'inactive'
   if u.startswith('proofofwork-audit30-id-page-comparison-'):
    if not self.started:d={'LoadState':'loaded'if self.mode=='collision'else'not-found','MainPID':'0'}
    else:d.update(ActiveState='inactive'if self.done else'active',MainPID='0'if self.done else'123',InvocationID='b'*32 if self.mode=='changed-inv'and self.communications else'a'*32)
   return subprocess.CompletedProcess(argv,0,('\n'.join(k+'='+v for k,v in d.items())+'\n').encode(),b'')
  if argv[:2]==['/usr/bin/systemctl','stop']:
   self.stops.append(argv[2])
   if self.mode=='stop-failure':raise subprocess.TimeoutExpired(argv,12)
   if self.mode=='repeat-signal':os.kill(os.getpid(),signal.SIGTERM);os.kill(os.getpid(),signal.SIGINT)
   self.done=True;return subprocess.CompletedProcess(argv,0,b'',b'')
  raise AssertionError('unreviewed subprocess')
 def popen(self,argv,**kw):self.commands.append(argv);self.started=True;return self
 def poll(self):return self.returncode
 def communicate(self,input=None,timeout=None):
  self.communications+=1
  if self.mode in('timeout','stop-failure','repeat-signal','changed-inv')and self.communications==1:raise subprocess.TimeoutExpired('fixed-transport',timeout)
  self.done=True;self.returncode=0 if self.mode in('ok','bad-sample','partial')else-15
  values=f.valid()
  if self.mode=='bad-sample':values[1]['headersEqual']=False
  if self.mode=='partial':values=values[:2]
  return ''.join(json.dumps(v)+'\n'for v in values).encode(),b''
 def terminate(self):self.terminated=True;self.done=True;self.returncode=-15
 def kill(self):self.done=True;self.returncode=-9
class Tests(unittest.TestCase):
 def execute(self,mode):
  fake=Fake(mode);buf=io.StringIO();prior={s:signal.getsignal(s)for s in(signal.SIGINT,signal.SIGTERM)}
  try:
   with patch('subprocess.run',fake.run),patch('subprocess.Popen',fake.popen),contextlib.redirect_stdout(buf):exec(compile(CODE,'reviewed-mocked-native','exec'),{'SQL':SQL,'VALIDATOR':VALID,'VERIFY_SHA':hashlib.sha256(VALID).hexdigest()})
  finally:
   for s,h in prior.items():signal.signal(s,h)
  return fake,json.loads(buf.getvalue())
 def test_fixed_success(self):fake,d=self.execute('ok');self.assertTrue(d['ok']);self.assertTrue(d['sqlStopped']);self.assertTrue(d['liveServicesUnchanged']);self.assertFalse(fake.stops)
 def test_wrong_live_refuses_before_spawn(self):self.assertRaises(AssertionError,self.execute,'wrong-live')
 def test_backup_active_refuses_before_spawn(self):self.assertRaises(AssertionError,self.execute,'backup-active')
 def test_existing_unit_refuses_before_spawn(self):self.assertRaises(AssertionError,self.execute,'collision')
 def test_bad_sample_not_green(self):fake,d=self.execute('bad-sample');self.assertFalse(d['ok']);self.assertIn('headersEqual',d['validationError'])
 def test_partial_not_green(self):fake,d=self.execute('partial');self.assertFalse(d['ok']);self.assertIn('incomplete',d['validationError'])
 def test_timeout_stops_only_owned_child_and_reaps(self):fake,d=self.execute('timeout');self.assertFalse(d['ok']);self.assertEqual(len(fake.stops),1);self.assertTrue(fake.stops[0].startswith('proofofwork-audit30-id-page-comparison-'));self.assertEqual(fake.communications,2);self.assertTrue(d['sqlStopped'])
 def test_stop_failure_still_reaps_transport(self):fake,d=self.execute('stop-failure');self.assertFalse(d['ok']);self.assertEqual(fake.communications,2);self.assertTrue(fake.terminated);self.assertTrue(d['cleanupErrors'])
 def test_repeated_ordinary_signals_cannot_skip_cleanup(self):fake,d=self.execute('repeat-signal');self.assertFalse(d['ok']);self.assertEqual(fake.communications,2);self.assertTrue(d['sqlStopped'])
 def test_changed_invocation_never_stopped(self):fake,d=self.execute('changed-inv');self.assertFalse(d['ok']);self.assertFalse(fake.stops);self.assertEqual(fake.communications,2);self.assertIn('owned-stop:AssertionError',d['cleanupErrors'])
 def test_fixed_privilege_environment_and_deadlines(self):
  fake,d=self.execute('ok');cmd=next(x for x in fake.commands if x[0]=='/usr/bin/systemd-run')
  for p in['User=postgres','CapabilityBoundingSet=','AmbientCapabilities=','PrivateNetwork=yes','RuntimeMaxSec=180s','MemoryMax=2G','CPUQuota=50%']:self.assertIn('--property='+p,cmd)
  self.assertIn('/usr/bin/env',cmd);self.assertIn('-i',cmd);self.assertIn('/usr/lib/postgresql/16/bin/psql',cmd);self.assertIn('-X',cmd);self.assertIn('server scan/projection cost',d['qualification']);self.assertIn('client only',d['qualification'])
if __name__=='__main__':unittest.main()
