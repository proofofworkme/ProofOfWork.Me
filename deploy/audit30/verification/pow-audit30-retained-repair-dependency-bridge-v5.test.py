#!/usr/bin/python3 -I
"""Local source/readonly refusal fixtures. No host/PG/API/Core contacts."""
import ast,base64,copy,hashlib,json,os,signal,subprocess,sys,tempfile,time,types,unittest
from pathlib import Path
from unittest.mock import patch
SOURCE=Path('/tmp/pow-audit30-retained-repair-dependency-bridge-v5.py')
def module(p):
 m=types.ModuleType('fixture_'+p.name);m.__file__=str(p);exec(compile(p.read_bytes(),str(p),'exec'),m.__dict__);return m
B=module(SOURCE)
M=module(Path('/tmp/pow-audit30-oct2-full-read-native-v2.py'))
D=module(Path('/tmp/pow-audit30-retire-exact-four-v3.py'))
META=dict(B.D818_META)
def request():
 files={str(p):{'metadata':dict(M.LOCK_EXPECTED),'sha256':M.FIXED_HASHES.get(str(p),'a'*64)}for p in M.STATIC}
 units={name:{k:''for k in fields}for name,fields in M.PROTECTED_FIELDS_BY_UNIT.items()}
 live={n:dict(LoadState='loaded',ActiveState='active',SubState='running',MainPID=p,InvocationID=i)for n,(p,i)in B.OLD_FIVE.items()}
 units[B.MONITOR]=dict(LoadState='loaded',ActiveState='failed',SubState='failed',MainPID='0',InvocationID='a'*32,UnitFileState='static')
 r=dict(schema='pow-audit30-retained-repair-dependency-bridge-request-v5',refreshMonitorAtObservationStart=True,expectedLive=live,expectedProtection={'files':files,'mask':{'metadata':dict(M.LOCK_EXPECTED),'target':'/dev/null'},'units':units},backupLock=dict(B.CURRENT_BACKUP_LOCK),backupLockObservationSha256=B.LOCK_OBSERVATION_SHA)
 for name,path,pin in(('root',Path('/tmp/pow-audit30-production-sixteen-root-control-v3.py'),B.ROOT_SHA),('managed',Path('/tmp/pow-audit30-oct2-full-read-native-v2.py'),B.MANAGED_SHA),('retirement',Path('/tmp/pow-audit30-retire-exact-four-v3.py'),B.RETIRE_SHA)):
  raw=path.read_bytes();assert hashlib.sha256(raw).hexdigest()==pin;r[name+'Base64']=base64.b64encode(raw).decode();r[name+'ControlSha256'if name=='root'else name+'Sha256']=pin
 return r
def argv(unit=None,fields=None):
 return ['/usr/bin/systemctl','show',unit or M.LIVE[0],'--no-pager',*['--property='+f for f in(fields or('LoadState','ActiveState','SubState','MainPID','InvocationID'))]]
ENV={'PATH':'/usr/sbin:/usr/bin:/sbin:/bin','LC_ALL':'C'}
def value(files=None,members=None):return {'files':files or[],'members':members or[]}
class BridgeTests(unittest.TestCase):
 def setUp(self):B.M=M
 def test_actual_exact_inert_sources(self):
  v,r,d=B.decode(B.encoded(request()));self.assertEqual(r.__name__,'reviewed_b989_root');self.assertEqual(d.__name__,'reviewed_e35_contract');self.assertEqual(r.PRIVATE_SUPERVISOR_SHA,'b1f10c63ac7e0de179215993529708e082073b0fd25bd6d36a4a7200870d4544');self.assertIsNone(d.H)
 def test_null_fresh_authority_refuses(self):
  r=request();r['expectedLive']=None
  with self.assertRaisesRegex(ValueError,'FRESH_ORIGINAL'):B.decode(B.encoded(r))
 def test_original_worker_replacement_refuses(self):
  r=request();r['expectedLive'][M.LIVE[-1]]['MainPID']='999'
  with self.assertRaisesRegex(ValueError,'ORIGINAL_FIVE'):B.decode(B.encoded(r))
 def test_source_byte_tamper_refuses(self):
  r=request();r['rootBase64']=base64.b64encode(b'print("not executed")').decode()
  with self.assertRaisesRegex(ValueError,'EXACT_INERT_SOURCE'):B.decode(B.encoded(r))
 def test_duplicate_and_extra_typed_keys_refuse(self):
  with self.assertRaisesRegex(ValueError,'DUPLICATE'):B.decode(b'{"schema":1,"schema":2}')
  r=request();r['arbitraryPath']='/tmp'
  with self.assertRaisesRegex(ValueError,'CLOSED_FIXED'):B.decode(B.encoded(r))
 def test_actual_timer_has_five_fields(self):
  r=request();B.decode(B.encoded(r));r['expectedProtection']['units'][M.PRUNE]['MainPID']='0'
  with self.assertRaisesRegex(ValueError,'PER_UNIT'):B.decode(B.encoded(r))
 def test_boolean_metadata_and_other_pin_refuse(self):
  for change in('bool','pin'):
   r=request();row=r['expectedProtection']['files'][str(M.PIN)];row['metadata']['uid']=True if change=='bool'else 0;row['sha256']='a'*64 if change=='pin'else M.FIXED_HASHES[str(M.PIN)]
   with self.assertRaisesRegex(ValueError,'PROTECTION_FILE'):B.decode(B.encoded(r))
 def test_backup_lock_shape_refuses(self):
  r=request();r['backupLock']['ino']+=1
  with self.assertRaisesRegex(ValueError,'BACKUP_LOCK'):B.decode(B.encoded(r))
 def test_exact_metadata_command_profiles(self):
  for n,fs in M.PROTECTED_FIELDS_BY_UNIT.items():B.allowed_process(('/usr/bin/systemctl',argv(n,fs),'/',ENV))
  for n in M.LIVE:B.allowed_process(('/usr/bin/systemctl',argv(n),'/',ENV))
 def test_other_commands_units_fields_env_refuse(self):
  cases=[('/usr/bin/psql',argv(),'/',ENV),('/usr/bin/systemctl',['/usr/bin/systemctl','stop',M.LIVE[0],'--no-pager','--property=LoadState'],'/',ENV),('/usr/bin/systemctl',argv('arbitrary.service'),'/',ENV),('/usr/bin/systemctl',argv(M.PRUNE,M.PROTECTED_FIELDS), '/',ENV),('/usr/bin/systemctl',argv(),'/',dict(ENV,PGPASSWORD='refused'))]
  for case in cases:
   with self.subTest(case=case),self.assertRaises(ValueError):B.allowed_process(case)
 def test_exact_dependency_read_allowed(self):B.audit('open',(str(B.D818),'r',os.O_RDONLY));B.audit('os.listdir',(str(B.DEPENDENCIES),))
 def test_any_write_or_unknown_read_refuses(self):
  for row in((str(B.D818),'w',os.O_WRONLY|os.O_TRUNC),('/etc/proofofwork-api/env','r',0),(str(B.DEPENDENCIES/'x'),'r+',os.O_RDWR)):
   with self.subTest(row=row),self.assertRaises(ValueError):B.audit('open',row)
 def test_cluster_and_socket_metadata_read_refused(self):
  for p in(B.JOB/'cluster',B.JOB/'socket'/'a',Path('/data/proofofwork-audit30-restore-20261002T234651Z/cluster/global/pg_control')):
   with self.assertRaises(ValueError):B.audit('open',(str(p),'r',0))
   with self.assertRaises(ValueError):B.stat_guard(lambda *_:self.fail('stat called'))(p)
 def test_network_sqlite_mutation_forbidden(self):
  for event in('socket.connect','sqlite3.connect','os.mkdir','os.remove','os.chmod','os.fork','os.posix_spawn'):
   with self.subTest(event=event),self.assertRaises(ValueError):B.audit(event,())
 def test_real_audit_write_refusal_leaves_sentinel(self):
  with tempfile.TemporaryDirectory()as t:
   p=Path(t)/'sentinel';p.write_bytes(b'original');code='import sys,types\nm=types.ModuleType("inert");exec(compile(open('+repr(str(SOURCE))+',"rb").read(),"bridge","exec"),m.__dict__)\nsys.addaudithook(m.audit)\ntry:open('+repr(str(p))+',"wb").write(b"changed")\nexcept ValueError:print("refused")\n'
   r=subprocess.run([sys.executable,'-I','-B','-c',code],capture_output=True,timeout=3);self.assertEqual(r.returncode,0,r.stderr);self.assertEqual(r.stdout,b'refused\n');self.assertEqual(p.read_bytes(),b'original')
 def test_172_root_members_pass_generic_owner(self):
  rows=[dict(path='file'+str(i),kind='file',metadata=META|dict(uid=0,mode=0o440,bytes=1),sha256='a'*64)for i in range(172)];v=B.compatibility(D,value(members=rows));self.assertTrue(v['genericInstalled172OwnersCompatible']);self.assertEqual(v['blocks'],[]);self.assertEqual(v['testedFiles'],172)
 def test_pg_owned_saved_receipt_blocks_generic(self):
  f=dict(path=str(B.JOB/'stream-completion-v2/completed.json'),metadata=META|dict(bytes=10029),sha256='a'*64);v=B.compatibility(D,value(files=[f]));self.assertEqual(v['blocks'][0]['reason'],'GENERIC_OWNER_REFUSED')
 def test_known_two_dependencies_pass_exact_contract(self):
  rows=[]
  for path,pin in D.KNOWN_DEPENDENCIES.items():rows.append(dict(path=path,metadata=META|{k:v for k,v in pin.items()if k!='sha256'},sha256=pin['sha256']))
  self.assertEqual(B.compatibility(D,value(files=rows))['blocks'],[])
 def test_known_hash_owner_size_alias_drift_refuses(self):
  path,pin=next(iter(D.KNOWN_DEPENDENCIES.items()));base=dict(path=path,metadata=META|{k:v for k,v in pin.items()if k!='sha256'},sha256=pin['sha256'])
  for kind in('sha','uid','size','alias'):
   f=copy.deepcopy(base)
   if kind=='sha':f['sha256']='a'*64
   elif kind=='uid':f['metadata']['uid']=1000
   elif kind=='size':f['metadata']['bytes']+=1
   else:f['path']='/alias/completed.json'
   self.assertTrue(B.compatibility(D,value(files=[f]))['blocks'])
 def test_fixed_node_over_four_mib_blocks_without_waiver(self):
  f=dict(path=str(B.NODE),metadata=META|dict(uid=0,bytes=100_000_000,mode=0o755),sha256='a'*64);self.assertEqual(B.compatibility(D,value(files=[f]))['blocks'][0]['reason'],'GENERIC_SIZE_REFUSED')
 def test_aggregate_cap_remains(self):
  rows=[dict(path='/file'+str(i),metadata=META|dict(uid=0,bytes=4*1024**2),sha256='a'*64)for i in range(49)];self.assertEqual(B.compatibility(D,value(files=rows))['blocks'][-1]['reason'],'AGGREGATE192MIB_REFUSED')
 def test_context_only_named_chain_and_original_verifier(self):
  calls=[];sourceS=module(Path('/tmp/pow-audit30-transition-stream-controller-v7.py'));sourceC=module(Path('/tmp/pow-audit30-stream-complete-retained-v5.py'));sourceP=module(Path('/tmp/pow-audit30-private-sixteen-supervisor-v3.py'));sourceR=module(Path('/tmp/pow-audit30-production-sixteen-root-control-v3.py'))
  original=dict(inventory={'sha256':'a'*64},priorAdmission={'sha256':'b'*64},phase4=dict(privatePlanSha256=sourceS.PRIVATE_PLAN_SHA,dependencyInventorySha256='c'*64,readinessAdmissionSha256='d'*64,pgEntrySha256='e'*64))
  manifest=dict(entries=172,regularBytes=443205,records=[dict(path=str(i),kind='directory',metadata=META|dict(uid=0,mode=0o750))for i in range(172)])
  def verify(base,authority):calls.append(('verify',base,authority));return manifest
  def forbidden(*a,**kw):self.fail('Forbidden runtime/source/cluster function reached')
  I=types.SimpleNamespace(verify_pg_dependencies=verify,verify_source=forbidden);C=types.SimpleNamespace(OLD=B.OLD,OLD_PLAN_SHA=sourceC.OLD_PLAN_SHA,PINS=sourceC.PINS,previous=forbidden);S=types.SimpleNamespace(PINS=sourceS.PINS,PHASE4_ENGINE=sourceS.PHASE4_ENGINE,PHASE4_ENGINE_SHA=sourceS.PHASE4_ENGINE_SHA,ORIGINAL_ENGINE_SHA=sourceS.ORIGINAL_ENGINE_SHA,clone_stopped=forbidden);m=types.SimpleNamespace(I=I,C=C,S=S,G=object(),GUARD_SHA=sourceP.GUARD_SHA,COMPLETION_SHA=sourceP.COMPLETION_SHA,COMPLETION_PINS=sourceP.COMPLETION_PINS,runtime=forbidden)
  R=types.SimpleNamespace(dependency_context=lambda:(calls.append(('context',))or(m,original)),PRIVATE_SUPERVISOR_SHA=sourceR.PRIVATE_SUPERVISOR_SHA,NODE_SHA=sourceR.NODE_SHA,main=forbidden)
  def observed(g,p,h):return dict(path=str(p),metadata=META if p==B.D818 else META|dict(uid=0,mode=0o440),sha256=h)
  with patch.object(B,'observed_file',side_effect=observed):r=B.context(R)
  self.assertEqual(len(r['files']),23);self.assertEqual(calls,[('context',),('verify',B.OLD,original['phase4'])]);self.assertEqual({r['path']for r in r['files']},B.REPAIR_FILES)
 def test_root_context_actual_source_has_only_saved_lineage(self):
  tree=ast.parse(Path('/tmp/pow-audit30-production-sixteen-root-control-v3.py').read_bytes());f=next(n for n in tree.body if isinstance(n,ast.FunctionDef)and n.name=='dependency_context');calls=[ast.unparse(n.func)for n in ast.walk(f)if isinstance(n,ast.Call)]
  self.assertEqual(set(calls),{'read','types.ModuleType','str','exec','compile','m.load','m.C.package','m.completed_lineage'});self.assertNotIn('main',calls)
 def test_input_alarm_precedes_stdin_and_bound(self):
  s=SOURCE.read_text();self.assertLess(s.index('signal.setitimer(signal.ITIMER_REAL,60)'),s.index('sys.stdin.buffer.read(131073)'));self.assertIn('384*1024**2,384*1024**2',s);self.assertIn("'allDependenciesClosed':False",s);self.assertIn("'allUnknownOrSkippedDependenciesResolved':False",s)
 def test_fixed_command_failure_reaps_mocked_child(self):
  class P:
   pid=123;stdout=types.SimpleNamespace(close=lambda:None);stderr=types.SimpleNamespace(close=lambda:None)
   def communicate(self,**_):raise B.BridgeInterrupted('first')
   def poll(self):return None
   def wait(self,timeout):self.waited=timeout
  p=P();B.DEADLINE=time.monotonic()+30
  with patch.object(B.subprocess,'Popen',return_value=p),patch.object(B.os,'killpg')as kill:
   with self.assertRaisesRegex(B.BridgeInterrupted,'first'):B.metadata_command(argv())
  kill.assert_called_once_with(123,signal.SIGKILL);self.assertEqual(p.waited,3)
 def test_real_blocked_child_signals_and_repeated_cleanup(self):
  for sig in(signal.SIGINT,signal.SIGTERM):
   code='''import os,signal,subprocess,sys,threading,time,types
m=types.ModuleType('inert');exec(compile(open(SOURCE,'rb').read(),'bridge','exec'),m.__dict__)
m.M=types.SimpleNamespace(LIVE=('bitcoind.service',),PROTECTED_FIELDS_BY_UNIT={})
real=subprocess.Popen;owned=[]
def fake(*a,**kw):
 p=real([sys.executable,'-I','-B','-c','import time;time.sleep(30)'],stdout=subprocess.PIPE,stderr=subprocess.PIPE,start_new_session=True);owned.append(p);wait=p.wait
 def slow(timeout):time.sleep(.06);return wait(timeout=timeout)
 p.wait=slow;return p
m.subprocess.Popen=fake;m.DEADLINE=time.monotonic()+2
def interrupted(*_):raise m.BridgeInterrupted('real-signal')
signal.signal(SIG,interrupted)
def sender():
 time.sleep(.1);os.kill(os.getpid(),SIG);time.sleep(.02);os.kill(os.getpid(),SIG)
threading.Thread(target=sender).start()
try:m.metadata_command(['/usr/bin/systemctl','show','bitcoind.service','--no-pager','--property=LoadState','--property=ActiveState','--property=SubState','--property=MainPID','--property=InvocationID'])
except m.BridgeInterrupted:
 assert owned and owned[0].returncode is not None
 try:os.waitpid(owned[0].pid,os.WNOHANG)
 except ChildProcessError:pass
 else:raise AssertionError('child not reaped')
 print('interrupted-and-owned-reaped')
else:raise AssertionError('signal swallowed')
'''.replace('SOURCE',repr(str(SOURCE))).replace('SIG,','signal.'+signal.Signals(sig).name+',').replace(',SIG)',',signal.'+signal.Signals(sig).name+')')
   r=subprocess.run([sys.executable,'-I','-B','-c',code],capture_output=True,timeout=4);self.assertEqual(r.returncode,0,r.stderr);self.assertEqual(r.stdout,b'interrupted-and-owned-reaped\n')
 def test_actual07824_lock_authority_and_only_timestamp_difference(self):
  p=Path('/tmp/pow-audit30-logical-backup-journal-refusal-diagnostic-native-v1.stdout');raw=p.read_bytes();self.assertEqual(hashlib.sha256(raw).hexdigest(),B.LOCK_OBSERVATION_SHA);v=json.loads(raw);rows=[r for r in v['logicalRoot']['otherEntries']if r['name']=='.proofofwork-postgres-logical-backup.lock'];self.assertEqual(len(rows),1);m={('dev'if k=='device'else'ino'if k=='inode'else k):x for k,x in rows[0]['metadata'].items()};self.assertEqual(m,B.CURRENT_BACKUP_LOCK);self.assertEqual({k:x for k,x in m.items()if k not in('mtimeNs','ctimeNs')},{k:x for k,x in M.LOCK_EXPECTED.items()if k not in('mtimeNs','ctimeNs')})
 def test_old_timestamp_is_not_fresh_authority(self):
  r=request();r['backupLock']=dict(M.LOCK_EXPECTED)
  with self.assertRaisesRegex(ValueError,'CURRENT_OBSERVED_BACKUP_LOCK'):B.decode(B.encoded(r))
 def test_each_timestamp_drift_refuses(self):
  for key in('mtimeNs','ctimeNs'):
   r=request();r['backupLock'][key]+=1
   with self.assertRaisesRegex(ValueError,'CURRENT_OBSERVED_BACKUP_LOCK'):B.decode(B.encoded(r))
 def test_observation_pin_and_boolean_lock_refuse(self):
  for kind in('observation','bool'):
   r=request()
   if kind=='observation':r['backupLockObservationSha256']='a'*64
   else:r['backupLock']['nlink']=True
   with self.assertRaisesRegex(ValueError,'CURRENT_OBSERVED_BACKUP_LOCK'):B.decode(B.encoded(r))

class StdinAuditRegressionTests(unittest.TestCase):
 def test_prior_guard_and_metadata_functions_are_exact(self):
  prior=Path('/tmp/pow-audit30-retained-repair-dependency-bridge-v3.py').read_text();current=SOURCE.read_text()
  def defs(s):return {n.name:ast.dump(n,include_attributes=False)for n in ast.parse(s).body if isinstance(n,(ast.FunctionDef,ast.ClassDef))}
  a,b=defs(prior),defs(current);changed={'validate_authority','decode','main','idle_monitor','refresh_monitor'}
  self.assertEqual({k:v for k,v in a.items()if k not in changed},{k:v for k,v in b.items()if k not in changed})
  self.assertEqual(set(b)-set(a),{'idle_monitor','refresh_monitor'});self.assertEqual(a['metadata_command'],b['metadata_command'])
  for k in('ROOT_SHA','MANAGED_SHA','RETIRE_SHA','CURRENT_BACKUP_LOCK','LOCK_OBSERVATION_SHA','OLD_FIVE','OLD_NAMES','D818_META','D818_SHA'):
   def literal(t):return next(ast.dump(n.value,include_attributes=False)for n in ast.parse(t).body if isinstance(n,ast.Assign)and any(isinstance(x,ast.Name)and x.id==k for x in n.targets))
   self.assertEqual(literal(prior),literal(current))
 def test_real_v2_devnull_refuses_before_child(self):
  code="""import sys,time,types
m=types.ModuleType('inert');exec(compile(open(SOURCE,'rb').read(),'bridge','exec'),m.__dict__)
m.M=types.SimpleNamespace(LIVE=('bitcoind.service',),PROTECTED_FIELDS_BY_UNIT={});m.DEADLINE=time.monotonic()+2
seen=[]
def hook(event,args):
 if event=='open' and args[0]=='/dev/null':seen.append(('devnull',args[2]))
 if event=='subprocess.Popen':seen.append(('spawn',None))
 m.audit(event,args)
sys.addaudithook(hook)
try:m.metadata_command(['/usr/bin/systemctl','show','bitcoind.service','--no-pager','--property=LoadState','--property=ActiveState','--property=SubState','--property=MainPID','--property=InvocationID'])
except ValueError as e:
 assert str(e)=='ANY_WRITE_OPEN_FORBIDDEN' and seen==[('devnull',524290)],seen
 print('exact-devnull-write-refusal-before-spawn')
else:raise AssertionError('old refusal missing')
""".replace('SOURCE',repr('/tmp/pow-audit30-retained-repair-dependency-bridge-v2.py'))
  r=subprocess.run([sys.executable,'-I','-B','-c',code],input=b'',capture_output=True,timeout=4);self.assertEqual(r.returncode,0,r.stderr);self.assertEqual(r.stdout,b'exact-devnull-write-refusal-before-spawn\n')
 def test_real_metadata_child_inherits_only_eof_under_same_open_guard(self):
  code="""import os,sys,time,types,hashlib
m=types.ModuleType('inert');exec(compile(open(SOURCE,'rb').read(),'bridge','exec'),m.__dict__)
raw=sys.stdin.buffer.read(131073);assert raw==b'public-typed-request\\n' and len(raw)<=131072 and hashlib.sha256(raw).hexdigest()==PIN
m.M=types.SimpleNamespace(LIVE=('bitcoind.service',),PROTECTED_FIELDS_BY_UNIT={});m.DEADLINE=time.monotonic()+3
original_allowed=m.allowed_process;real=m.subprocess.Popen;child=[sys.executable,'-I','-B','-c','import sys;raw=sys.stdin.buffer.read();assert raw==b\\"\\";print(\\"child-saw-only-eof\\")']
def local_only_process(args):
 if args[0]==sys.executable:
  assert args[1]==child and args[2]=='/' and args[3]=={'PATH':'/usr/sbin:/usr/bin:/sbin:/bin','LC_ALL':'C'}
 else:original_allowed(args)
m.allowed_process=local_only_process
seen=[]
def hook(event,args):
 if event=='open' and args[0]=='/dev/null':seen.append(args[2])
 m.audit(event,args)
def fixture_child(argv,**kw):
 assert kw['stdin']==0 and argv[0]=='/usr/bin/systemctl'
 return real(child,**kw)
m.subprocess.Popen=fixture_child;sys.addaudithook(hook)
argv=['/usr/bin/systemctl','show','bitcoind.service','--no-pager','--property=LoadState','--property=ActiveState','--property=SubState','--property=MainPID','--property=InvocationID']
for _ in range(2):assert m.metadata_command(argv)==b'child-saw-only-eof\\n'
assert seen==[]
try:os.open('/dev/null',os.O_RDWR)
except ValueError as e:assert str(e)=='ANY_WRITE_OPEN_FORBIDDEN'
else:raise AssertionError('write guard weakened')
print('two-real-owned-metadata-children-eof-no-devnull-write')
""".replace('SOURCE',repr(str(SOURCE))).replace('PIN',repr(hashlib.sha256(b'public-typed-request\n').hexdigest()))
  r=subprocess.run([sys.executable,'-I','-B','-c',code],input=b'public-typed-request\n',capture_output=True,timeout=5);self.assertEqual(r.returncode,0,r.stderr);self.assertEqual(r.stdout,b'two-real-owned-metadata-children-eof-no-devnull-write\n')
 def test_main_consumes_and_pins_bounded_input_before_audit_and_metadata(self):
  tree=ast.parse(SOURCE.read_bytes());main=next(n for n in tree.body if isinstance(n,ast.FunctionDef)and n.name=='main');s=ast.get_source_segment(SOURCE.read_text(),main)
  self.assertLess(s.index('raw=sys.stdin.buffer.read(131073)'),s.index('sys.addaudithook(audit)'));self.assertLess(s.index("len(raw)<=131072 and sha(raw)==sys.argv[1]"),s.index('before=M.live()'))
  self.assertNotIn('DEVNULL',ast.get_source_segment(SOURCE.read_text(),next(n for n in tree.body if isinstance(n,ast.FunctionDef)and n.name=='metadata_command')).split('try:',1)[1])
 def test_bound_template_and_caller_remain_unexecutable(self):
  p=Path('/tmp/pow-audit30-retained-repair-dependency-bridge-transport-preparation-v5.py');c=module(p);self.assertIsNone(c.RP);v=json.loads(Path('/tmp/pow-audit30-retained-repair-dependency-bridge-request-template-v5.json').read_bytes());self.assertIsNone(v['expectedLive']);self.assertIsNone(v['expectedProtection']);self.assertEqual(v['backupLockObservationSha256'],B.LOCK_OBSERVATION_SHA);self.assertEqual(v['backupLock'],B.CURRENT_BACKUP_LOCK)


class MonitorRefreshTests(unittest.TestCase):
 def decoded(self):
  r=json.loads(Path('/tmp/pow-audit30-retained-repair-dependency-bridge-request-current2-v3.json').read_bytes());r['schema']='pow-audit30-retained-repair-dependency-bridge-request-v5';r['refreshMonitorAtObservationStart']=True;return B.decode(B.encoded(r))[0]
 def monitor(self,inv='b'*32):return dict(LoadState='loaded',ActiveState='failed',SubState='failed',MainPID='0',InvocationID=inv,UnitFileState='static')
 def protected_fixture(self,v,monitors,change=None):
  # Invoke the unchanged actual ad03 protection predicate over local public fixtures.
  from contextlib import ExitStack
  import stat
  m=B.M;p=copy.deepcopy(v['expectedProtection']);raws={}
  for path in m.STATIC:
   raw=b'proof_indexer-20260929T031853Z.dumpset\n'if path==m.PIN else('fixed-public-file:'+str(path)).encode();meta=dict(p['files'][str(path)]['metadata']);meta['mode']=0o755 if path in(m.CHECKER,m.STATIC[4])else 0o600 if path==m.STATIC[2]else 0o644;meta['bytes']=len(raw);p['files'][str(path)]={'metadata':meta,'sha256':hashlib.sha256(raw).hexdigest()};raws[path]=(raw,meta)
  class Parent:
   def resolve(self,strict):return self
  class Mask:
   parent=Parent()
   def lstat(self):return types.SimpleNamespace(st_mode=stat.S_IFLNK|0o777,st_uid=0,st_gid=0)
  mask=Mask();count=[]
  def read(path,cap):
   raw,meta=raws[path];meta=dict(meta)
   if change=='static'and path==m.STATIC[2]:raw+=b'drift'
   return raw,meta
  def show(name,fields):
   if name==B.MONITOR:
    i=len(count);count.append(name);return dict(monitors[min(i,len(monitors)-1)])
   row=dict(p['units'][name])
   if change=='wal'and name=='pg_receivewal@16-main.service':row['InvocationID']='c'*32
   if change=='prune'and name==m.PRUNE:row['UnitFileState']='enabled'
   return row
  stack=ExitStack();stack.enter_context(patch.object(m,'read_file',side_effect=read));stack.enter_context(patch.object(m,'MASK',mask));stack.enter_context(patch.object(m,'metadata',return_value=p['mask']['metadata']));stack.enter_context(patch.object(m.os,'readlink',return_value='/dev/null'));stack.enter_context(patch.object(m.os,'listxattr',return_value=[]));stack.enter_context(patch.object(m,'show',side_effect=show))
  return v|{'expectedProtection':p},stack,count
 def test_explicit_refresh_flag_only_true(self):
  for val in(False,1,None):
   r=request();r['refreshMonitorAtObservationStart']=val
   with self.assertRaisesRegex(ValueError,'EXPLICIT_ONCE'):B.decode(B.encoded(r))
  r=request();del r['refreshMonitorAtObservationStart']
  with self.assertRaisesRegex(ValueError,'CLOSED_FIXED'):B.decode(B.encoded(r))
 def test_external_monitor_must_be_idle_static_mainzero(self):
  for key,val in(('ActiveState','active'),('SubState','running'),('MainPID','12'),('UnitFileState','enabled'),('LoadState','not-found'),('InvocationID','bad')):
   r=request();r['expectedProtection']['units'][B.MONITOR][key]=val
   with self.subTest(key=key),self.assertRaisesRegex(ValueError,'IDLE_STATIC_MONITOR'):B.decode(B.encoded(r))
 def test_stale_prior_idle_refresh_once_passes_unchanged_protection(self):
  v=self.decoded();old=copy.deepcopy(v);fresh=self.monitor();v,stack,count=self.protected_fixture(v,[fresh,fresh,fresh])
  with stack:
   bound,proof=B.refresh_monitor(v);self.assertEqual(count,[B.MONITOR]);before=B.M.protection(bound['expectedProtection']);after=B.M.protection(bound['expectedProtection']);self.assertEqual(before,after)
  self.assertEqual(count,[B.MONITOR]*3);self.assertEqual(proof['externalExpected'],old['expectedProtection']['units'][B.MONITOR]);self.assertEqual(proof['capturedAtObservationStart'],fresh);self.assertEqual(proof['capturedSha256'],B.sha(B.encoded(fresh)));self.assertEqual(v['expectedProtection']['units'][B.MONITOR],old['expectedProtection']['units'][B.MONITOR])
  for name in('pg_receivewal@16-main.service',B.M.PRUNE):self.assertEqual(bound['expectedProtection']['units'][name],v['expectedProtection']['units'][name])
  self.assertEqual(bound['expectedLive'],old['expectedLive']);self.assertEqual(bound['backupLock'],old['backupLock'])
 def test_current_running_monitor_refuses_without_dependency_read(self):
  v=self.decoded();running=self.monitor()|dict(ActiveState='active',SubState='running',MainPID='123')
  with patch.object(B.M,'show',return_value=running)as show,patch.object(B,'context',side_effect=AssertionError('dependencies reached')):
   with self.assertRaisesRegex(ValueError,'IDLE_STATIC_MONITOR'):B.refresh_monitor(v)
  show.assert_called_once_with(B.MONITOR,B.M.PROTECTED_FIELDS_BY_UNIT[B.MONITOR])
 def test_static_wal_prune_drift_still_refuses(self):
  for change in('static','wal','prune'):
   v=self.decoded();fresh=self.monitor();v,stack,count=self.protected_fixture(v,[fresh,fresh],change)
   with self.subTest(change=change),stack:
    bound,_=B.refresh_monitor(v)
    with self.assertRaisesRegex(ValueError,'Installed protection|Protection unit drift'):B.M.protection(bound['expectedProtection'])
 def test_midrun_invocation_drift_is_not_refreshed(self):
  v=self.decoded();fresh=self.monitor();later=self.monitor('d'*32);v,stack,count=self.protected_fixture(v,[fresh,fresh,later])
  with stack:
   bound,_=B.refresh_monitor(v);B.M.protection(bound['expectedProtection'])
   with self.assertRaisesRegex(ValueError,'Protection unit drift'):B.M.protection(bound['expectedProtection'])
  self.assertEqual(count,[B.MONITOR]*3);self.assertEqual(bound['expectedProtection']['units'][B.MONITOR],fresh)
 def test_main_has_one_initial_refresh_and_exact_final_protection(self):
  main=next(n for n in ast.parse(SOURCE.read_bytes()).body if isinstance(n,ast.FunctionDef)and n.name=='main');calls=[n for n in ast.walk(main)if isinstance(n,ast.Call)and isinstance(n.func,ast.Name)and n.func.id=='refresh_monitor'];self.assertEqual(len(calls),1);text=ast.get_source_segment(SOURCE.read_text(),main);self.assertLess(text.index('refresh_monitor(v)'),text.index('protected=M.protection'));self.assertIn("M.protection(v['expectedProtection'])==protected",text);self.assertEqual(text.count('context(R)'),2)


class FixedCodecImportRegressionTests(unittest.TestCase):
 def frozen_closure(self):
  paths=[('/tmp/pow-audit30-private-sixteen-supervisor-v3.py','b1f10c63ac7e0de179215993529708e082073b0fd25bd6d36a4a7200870d4544'),('/tmp/pow-audit30-stream-complete-retained-v5.py','ecb2b237b93ebd0bde96e5d7d690abbda5b9fa92aaeb0fea47c23e169acf4e8e'),('/tmp/pow-audit30-transition-stream-controller-v7.py','e9801d372d05c94c40b609749e502ab1eb5e06f4f2561fa08d9c6a25c9313599'),('/tmp/pow-audit30-saved-snapshot-inspect-v2.py','f923766a2dffcfaabd45b3bf4fc4cf975435f2713388ec7930b4d3057fad98ad'),('/home/sixer/ProofOfWork.Me/deploy/audit30/restore-latest-logical.py','26c7656b2e751c6de50122c65f8af73686c2d2674bee8be86a3c5648b7fcc80e'),('/tmp/pow-audit30-transition-stream-native-v2.py','523342d30599c793a3503ba1d554fc096fce0be554ae232397c8ea4bcadbbe23'),('/tmp/pow-audit30-transition-stream-codec-v2.py','3fe9dd87f9f5638b02be858b44c535c1431b1af1e8e4f9d60a1afe295f5179f0')]
  rows=[]
  for p,pin in paths:
   raw=Path(p).read_bytes();self.assertEqual(hashlib.sha256(raw).hexdigest(),pin);rows.append((p,raw.decode()))
  return rows
 def test_v4_reproduces_stdlib_directory_refusal_without_runtime(self):
  prior=Path('/tmp/pow-audit30-retained-repair-dependency-bridge-v4.py').read_text();r=request();r['schema']=r['schema'].replace('-v5','-v4');code="""import sys,types,json
bridge,request,body=json.loads(sys.stdin.buffer.read());m=types.ModuleType('inert_bridge');exec(compile(bridge,'bridge','exec'),m.__dict__);m.decode(request.encode());seen=[]
def hook(event,args):
 if event in('os.listdir','os.scandir'):seen.append(str(args[0]))
 m.audit(event,args)
sys.addaudithook(hook)
for name,source in body:
 p=types.ModuleType('inert'+str(len(source)));p.__file__=name
 try:exec(compile(source,name,'exec'),p.__dict__)
 except ValueError as e:
  assert str(e)=='FIXED_DEPENDENCY_DIRECTORY_ONLY' and seen==['/usr/lib/python3.12/sqlite3'],seen
  assert name.endswith('transition-stream-codec-v2.py');print('exact-v4-sqlite3-definition-import-refusal');break
else:raise AssertionError('missing old refusal')
"""
  v=[prior,B.encoded(r).decode(),self.frozen_closure()];out=subprocess.run([sys.executable,'-I','-B','-c',code],input=json.dumps(v).encode(),capture_output=True,timeout=5);self.assertEqual(out.returncode,0,out.stderr);self.assertEqual(out.stdout,b'exact-v4-sqlite3-definition-import-refusal\n')
 def test_v5_real_fixed_preload_all_definitions_and_bans(self):
  code="""import sys,types,json,ast,os,socket
bridge,request,body,database=json.loads(sys.stdin.buffer.read());m=types.ModuleType('inert_bridge');exec(compile(bridge,'bridge','exec'),m.__dict__);m.decode(request.encode());tree=ast.parse(bridge);main=next(n for n in tree.body if isinstance(n,ast.FunctionDef)and n.name=='main');nodes=[n for n in main.body if isinstance(n,ast.Import)];assert len(nodes)==1 and ast.unparse(nodes[0])=='import sqlite3';exec(compile(ast.Module(body=nodes,type_ignores=[]),'exact-main-preload','exec'),m.__dict__);seen=[]
def hook(event,args):
 if event in('os.listdir','os.scandir'):seen.append(str(args[0]))
 m.audit(event,args)
sys.addaudithook(hook)
for name,source in body:
 p=types.ModuleType('inert'+str(len(source)));p.__file__=name;exec(compile(source,name,'exec'),p.__dict__)
assert seen==[],seen
for target in(':memory:',database):
 try:m.sqlite3.connect(target)
 except ValueError as e:assert str(e)=='FORBIDDEN_NONOBSERVATIONAL_OPERATION'
 else:raise AssertionError('SQLite connection reached')
try:open(database,'wb')
except ValueError as e:assert str(e)=='ANY_WRITE_OPEN_FORBIDDEN'
else:raise AssertionError('DB file write reached')
try:open('/data/proofofwork-audit30-inspect-20261003T014100Z/cluster/global/pg_control','rb')
except ValueError as e:assert str(e)=='CLUSTER_OR_SOCKET_READ_FORBIDDEN'
else:raise AssertionError('cluster read reached')
for p in('/usr/lib/python3.12','/usr/lib/python3.12/sqlite3'):
 try:os.listdir(p)
 except ValueError as e:assert str(e)=='FIXED_DEPENDENCY_DIRECTORY_ONLY'
 else:raise AssertionError('general stdlib scan allowed')
try:socket.socket()
except ValueError as e:assert str(e)=='FORBIDDEN_NONOBSERVATIONAL_OPERATION'
else:raise AssertionError('socket created')
print('seven-inert-definitions-pass-connect-write-cluster-directory-socket-bans-retained')
"""
  with tempfile.TemporaryDirectory()as tmp:
   db=Path(tmp)/'database-sentinel';db.write_bytes(b'unchanged');v=[SOURCE.read_text(),B.encoded(request()).decode(),self.frozen_closure(),str(db)];out=subprocess.run([sys.executable,'-I','-B','-c',code],input=json.dumps(v).encode(),capture_output=True,timeout=5);self.assertEqual(out.returncode,0,out.stderr);self.assertEqual(out.stdout,b'seven-inert-definitions-pass-connect-write-cluster-directory-socket-bans-retained\n');self.assertEqual(db.read_bytes(),b'unchanged')
 def test_preload_only_after_bounded_stdin_and_before_unchanged_audit(self):
  tree=ast.parse(SOURCE.read_bytes());main=next(n for n in tree.body if isinstance(n,ast.FunctionDef)and n.name=='main');im=[n for n in ast.walk(main)if isinstance(n,ast.Import)];self.assertEqual(len(im),1);self.assertEqual(ast.unparse(im[0]),'import sqlite3');text=ast.get_source_segment(SOURCE.read_text(),main);self.assertLess(text.index('signal.setitimer'),text.index('import sqlite3'));self.assertLess(text.index('resource.setrlimit'),text.index('import sqlite3'));self.assertLess(text.index('v,R,D=decode(raw)'),text.index('import sqlite3'));self.assertLess(text.index('import sqlite3'),text.index('sys.addaudithook(audit)'));self.assertNotIn('sqlite3.connect',SOURCE.read_text())
 def test_v4_to_v5_only_fixed_preload_and_schema(self):
  prior=Path('/tmp/pow-audit30-retained-repair-dependency-bridge-v4.py').read_text();current=SOURCE.read_text();insertion=' # The exact pinned codec imports sqlite3 definitions. Prime only that fixed\n # stdlib package under the deadline before the directory audit; connections\n # remain forbidden afterward. No additional directory read is authorized.\n import sqlite3\n';wanted=prior.replace('bridge-request-v4','bridge-request-v5').replace('bridge-result-v4','bridge-result-v5').replace('bridge-refusal-v4','bridge-refusal-v5').replace(' FILES.update(map(str,M.STATIC));',insertion+' FILES.update(map(str,M.STATIC));');self.assertEqual(current,wanted)
  def defs(x):return {n.name:ast.dump(n,include_attributes=False)for n in ast.parse(x).body if isinstance(n,(ast.FunctionDef,ast.ClassDef))}
  a,b=defs(prior),defs(current);self.assertEqual({k:v for k,v in a.items()if k not in('decode','main')},{k:v for k,v in b.items()if k not in('decode','main')});self.assertEqual(a['audit'],b['audit'])

if __name__=='__main__':unittest.main()
