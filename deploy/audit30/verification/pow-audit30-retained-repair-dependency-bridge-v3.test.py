#!/usr/bin/python3 -I
"""Local source/readonly refusal fixtures. No host/PG/API/Core contacts."""
import ast,base64,copy,hashlib,json,os,signal,subprocess,sys,tempfile,time,types,unittest
from pathlib import Path
from unittest.mock import patch
SOURCE=Path('/tmp/pow-audit30-retained-repair-dependency-bridge-v3.py')
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
 r=dict(schema='pow-audit30-retained-repair-dependency-bridge-request-v3',expectedLive=live,expectedProtection={'files':files,'mask':{'metadata':dict(M.LOCK_EXPECTED),'target':'/dev/null'},'units':units},backupLock=dict(B.CURRENT_BACKUP_LOCK),backupLockObservationSha256=B.LOCK_OBSERVATION_SHA)
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
 def test_source_is_only_stdin_and_schema_successor(self):
  prior=Path('/tmp/pow-audit30-retained-repair-dependency-bridge-v2.py').read_text();current=SOURCE.read_text();candidate=prior.replace('stdin=subprocess.DEVNULL','stdin=0').replace('bridge-request-v2','bridge-request-v3').replace('bridge-result-v2','bridge-result-v3').replace('bridge-refusal-v2','bridge-refusal-v3')
  candidate=candidate.replace(' # from repeated ordinary signals and reap this exact owned child process.\n',' # from repeated ordinary signals and reap this exact owned child process.\n # main consumed the bounded SHA-verified typed stdin to EOF before this call.\n # Inherit that exact fd0; DEVNULL would open /dev/null O_RDWR under the write ban.\n')
  self.assertEqual(current,candidate)
  def defs(s):return {n.name:ast.dump(n,include_attributes=False)for n in ast.parse(s).body if isinstance(n,(ast.FunctionDef,ast.ClassDef))}
  a,b=defs(prior),defs(current)
  self.assertEqual({k:v for k,v in a.items()if k not in('metadata_command','decode','main')},{k:v for k,v in b.items()if k not in('metadata_command','decode','main')})
  self.assertEqual(ast.dump(ast.parse(prior).body[0],include_attributes=False),ast.dump(ast.parse(current).body[0],include_attributes=False))
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
  p=Path('/tmp/pow-audit30-retained-repair-dependency-bridge-transport-preparation-v3.py');c=module(p);self.assertIsNone(c.RP);v=json.loads(Path('/tmp/pow-audit30-retained-repair-dependency-bridge-request-template-v3.json').read_bytes());self.assertIsNone(v['expectedLive']);self.assertIsNone(v['expectedProtection']);self.assertEqual(v['backupLockObservationSha256'],B.LOCK_OBSERVATION_SHA);self.assertEqual(v['backupLock'],B.CURRENT_BACKUP_LOCK)

if __name__=='__main__':unittest.main()
