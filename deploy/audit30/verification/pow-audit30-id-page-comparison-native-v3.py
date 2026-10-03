"""Proposed readonly comparative native transport. Do not execute without root GO."""
import hashlib,json,pathlib,shlex,subprocess,os
P=pathlib.Path
SQL=P('/tmp/pow-audit30-id-page-comparison-v3.sql').read_bytes();assert hashlib.sha256(SQL).hexdigest()=='096871903b2eb5128055f9d0ad6d9efa6d93943562758515e19a2d50fb3393a8'
VALIDATOR=P('/tmp/pow-audit30-id-page-comparison-verifier-v3.py').read_bytes()
VERIFY_SHA=hashlib.sha256(VALIDATOR).hexdigest();assert VERIFY_SHA=='ac77cafe427f16cf45a521b6c747340ab1a8684e9888de0d895e19dc5e664126'
# Validate only reviewed bytes in the private root process, no import reopening.
code=r'''
import hashlib,json,subprocess,time,datetime,signal
E={'PATH':'/usr/sbin:/usr/bin:/sbin:/bin','LC_ALL':'C','TZ':'UTC'}
def state(u):
 r=subprocess.run(['/usr/bin/systemctl','show',u,'--property=LoadState,ActiveState,MainPID,InvocationID,Result'],env=E,capture_output=True,timeout=10)
 assert r.returncode==0 and not r.stderr
 return dict(x.split('=',1)for x in r.stdout.decode().splitlines()if '='in x)
assert hashlib.sha256(VALIDATOR).hexdigest()==VERIFY_SHA
ns={};exec(compile(VALIDATOR,'reviewed-pure-validator','exec'),ns)
units=['bitcoind.service','electrs.service','postgresql@16-main.service','proofofwork-api.service','proofofwork-indexer-worker.service']
expected=[('1324302','64e1fa7be2e2442d8c7f5763f60b85fb'),('1324320','72418b1c7ab245e4a37685ed868a1084'),('1537429','e0bf545f0ad944e89fe1005577e61b9c'),('2103747','208f8bcbecc54afbb7166754f12065c2'),('2103760','33b3ee25490749db89e0d55fd29d0afb')]
before={u:state(u)for u in units}
assert all(before[u]['LoadState']=='loaded'and before[u]['ActiveState']=='active'and(before[u]['MainPID'],before[u]['InvocationID'])==pin for u,pin in zip(units,expected))
backup=state('proofofwork-postgres-logical-backup.service')
assert backup['LoadState']=='loaded'and backup['ActiveState']=='inactive'and backup['MainPID']=='0'and backup['Result']=='success'
unit='proofofwork-audit30-id-page-comparison-20261003T035700Z.service';assert state(unit)['LoadState']=='not-found'
props=['User=postgres','Group=postgres','NoNewPrivileges=yes','PrivateNetwork=yes','PrivateTmp=yes','PrivateDevices=yes','PrivateIPC=yes','ProtectSystem=strict','ProtectHome=yes','CapabilityBoundingSet=','AmbientCapabilities=','RestrictAddressFamilies=AF_UNIX','RuntimeMaxSec=180s','TimeoutStopSec=5s','KillMode=control-group','MemoryMax=2G','MemorySwapMax=0','CPUQuota=50%','TasksMax=16','UMask=0077','UnsetEnvironment=LD_PRELOAD LD_LIBRARY_PATH PGSERVICE PGSERVICEFILE PGPASSWORD PGPASSFILE PGUSER PGDATABASE PGOPTIONS']
argv=['/usr/bin/systemd-run','--quiet','--wait','--pipe','--unit='+unit,'--service-type=exec',*['--property='+p for p in props],'/usr/bin/env','-i','PATH=/usr/lib/postgresql/16/bin:/usr/bin:/bin','LC_ALL=C','TZ=UTC','PGHOST=/var/run/postgresql','PGPORT=5432','PGDATABASE=proof_indexer','PGOPTIONS=-c default_transaction_read_only=on -c statement_timeout=20000 -c lock_timeout=3000 -c idle_in_transaction_session_timeout=15000','/usr/lib/postgresql/16/bin/psql','-X','-q','-t','-A','-v','ON_ERROR_STOP=1','-d','proof_indexer']
def interrupt(signum,frame):raise InterruptedError('ordinary signal')
signal.signal(signal.SIGINT,interrupt);signal.signal(signal.SIGTERM,interrupt)
start=time.monotonic();p=subprocess.Popen(argv,env=E,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE);owned_inv=None;stdout=b'';stderr=b'';failure=None;cleanup=[];returncode=None
try:
 for _ in range(20):
  s=state(unit)
  if s.get('InvocationID'):owned_inv=s['InvocationID'];break
  if p.poll()is not None:break
  time.sleep(.1)
 assert owned_inv is not None
 stdout,stderr=p.communicate(input=SQL,timeout=195);returncode=p.returncode
except BaseException as exc:
 failure=type(exc).__name__
 # Ordinary repeated interruptions cannot skip separately attempted custody.
 signal.signal(signal.SIGINT,signal.SIG_IGN);signal.signal(signal.SIGTERM,signal.SIG_IGN)
 try:
  s=state(unit)
  if int(s.get('MainPID','0'))>0:
   assert owned_inv is not None and s.get('InvocationID')==owned_inv
   r=subprocess.run(['/usr/bin/systemctl','stop',unit],env=E,capture_output=True,timeout=12);assert r.returncode==0
 except BaseException as e:cleanup.append('owned-stop:'+type(e).__name__)
 try:
  if p.poll()is None:p.terminate()
  stdout,stderr=p.communicate(timeout=8);returncode=p.returncode
 except BaseException as e:
  cleanup.append('transport-reap:'+type(e).__name__)
  try:p.kill();stdout,stderr=p.communicate(timeout=5);returncode=p.returncode
  except BaseException as e:cleanup.append('transport-kill:'+type(e).__name__)
assert len(stdout)<256*1024 and len(stderr)<65536
stopped=state(unit).get('MainPID','0')=='0';live_unchanged=before=={u:state(u)for u in units}
values=[];parse_error=None
try:
 decoder=json.JSONDecoder();text=stdout.decode();offset=0
 while offset<len(text):
  while offset<len(text)and text[offset].isspace():offset+=1
  if offset==len(text):break
  v,n=decoder.raw_decode(text,offset);values.append(v);offset=n
except BaseException as e:parse_error=type(e).__name__
validation=None;validation_error=None
if returncode==0 and failure is None and parse_error is None and stopped and live_unchanged:
 try:validation=ns['validate_comparisons'](values)
 except BaseException as e:validation_error=str(e)
result={'schema':'pow-audit30-id-page-comparison-native-v1','atUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'ok':validation is not None and not cleanup,'returncode':returncode,'failureClass':failure,'cleanupErrors':cleanup,'seconds':round(time.monotonic()-start,3),'sqlSHA256':hashlib.sha256(SQL).hexdigest(),'validatorSHA256':VERIFY_SHA,'values':values,'parseErrorClass':parse_error,'validation':validation,'validationError':validation_error,'stdoutBytes':len(stdout),'stdoutSHA256':hashlib.sha256(stdout).hexdigest(),'stderrBytes':len(stderr),'stderrSHA256':hashlib.sha256(stderr).hexdigest(),'liveServicesUnchanged':live_unchanged,'sqlStopped':stopped,'ownedInvocationId':owned_inv,'backupInactiveBefore':True,'productionDataMutation':False,'qualification':'Bounded same-snapshot six healthy LIMIT3 row/header/payload comparisons and two activation EXPLAIN plans only. No wire payloads, carriers or private SQL parameters are exported. LIMIT3 bounds returned rows, not pre-LIMIT server scan/projection cost. The existing production PostgreSQL backend is governed by readonly RR, per-statement20s, lock3s, work_mem8MB and temp_file_limit32MB; systemd180s/2G/50% caps the psql client only, not that existing backend. EXPLAIN excludes wire serialization, and this is not cache-cold cost, whole audit replay or corrupt duplicate-schema equivalence. Any timeout, partial output, gap or duplicate refuses sample acceptance.'}
print(json.dumps(result,sort_keys=True))
'''
p=P('/tmp/pow-audit30-id-page-comparison-native-v1.json')
for target in[p,P(str(p)+'.stdout'),P(str(p)+'.stderr')]:assert not target.exists()
ssh=['ssh','-i','/home/sixer/.ssh/proofofwork_node_ed25519','-o','BatchMode=yes','-o','IdentitiesOnly=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=10','powadmin@65.108.122.87',shlex.join(['sudo','-n','/usr/bin/python3','-I','-B','-'])]
r=subprocess.run(ssh,input=('SQL='+repr(SQL)+'\nVALIDATOR='+repr(VALIDATOR)+'\nVERIFY_SHA='+repr(VERIFY_SHA)+'\n'+code).encode(),capture_output=True,timeout=220)
for ext,b in[('.stdout',r.stdout),('.stderr',r.stderr)]:
 with P(str(p)+ext).open('xb')as f:f.write(b);f.flush();os.fsync(f.fileno())
d={'transportReturncode':r.returncode,'sourceSHA256':hashlib.sha256(P(__file__).read_bytes()).hexdigest(),'result':json.loads(r.stdout)if r.returncode==0 else None,'stderrBytes':len(r.stderr),'stderrSHA256':hashlib.sha256(r.stderr).hexdigest()}
with p.open('xb')as f:f.write((json.dumps(d,sort_keys=True,indent=2)+'\n').encode());f.flush();os.fsync(f.fileno())
fd=os.open(str(p.parent),os.O_RDONLY|os.O_DIRECTORY)
try:os.fsync(fd)
finally:os.close(fd)
print(json.dumps(d,sort_keys=True))
