import hashlib,json,pathlib,shlex,subprocess,os
sql=pathlib.Path('/tmp/pow-audit30-id-original-page-profile-v1.sql').read_bytes();assert hashlib.sha256(sql).hexdigest()=='fb2ee7903222ab1a6322f069c38c9b42ec1fcd3c4282dc4e1cb59c499ba8daa0'
code=r'''
import hashlib,json,subprocess,time,re,datetime
E={'PATH':'/usr/sbin:/usr/bin:/sbin:/bin','LC_ALL':'C','TZ':'UTC'}
def state(u):
 r=subprocess.run(['/usr/bin/systemctl','show',u,'--property=LoadState,ActiveState,MainPID,InvocationID'],env=E,capture_output=True,timeout=10);assert r.returncode==0 and not r.stderr;return dict(x.split('=',1)for x in r.stdout.decode().splitlines()if '='in x)
units=['bitcoind.service','electrs.service','postgresql@16-main.service','proofofwork-api.service','proofofwork-indexer-worker.service'];before={u:state(u)for u in units};assert all(x['ActiveState']=='active'and int(x['MainPID'])>0 for x in before.values());unit='proofofwork-audit30-id-original-page-profile-20261003T032000Z.service';assert state(unit)['LoadState']=='not-found'
props=['User=postgres','Group=postgres','NoNewPrivileges=yes','PrivateNetwork=yes','PrivateTmp=yes','PrivateDevices=yes','PrivateIPC=yes','ProtectSystem=strict','ProtectHome=yes','CapabilityBoundingSet=','AmbientCapabilities=','RestrictAddressFamilies=AF_UNIX','RuntimeMaxSec=90s','TimeoutStopSec=5s','KillMode=control-group','MemoryMax=2G','MemorySwapMax=0','CPUQuota=50%','TasksMax=16','UMask=0077','UnsetEnvironment=LD_PRELOAD LD_LIBRARY_PATH PGSERVICE PGSERVICEFILE PGPASSWORD PGPASSFILE PGUSER PGDATABASE PGOPTIONS']
argv=['/usr/bin/systemd-run','--quiet','--wait','--pipe','--unit='+unit,'--service-type=exec',*['--property='+p for p in props],'/usr/bin/env','-i','PATH=/usr/lib/postgresql/16/bin:/usr/bin:/bin','LC_ALL=C','TZ=UTC','PGHOST=/var/run/postgresql','PGPORT=5432','PGDATABASE=proof_indexer','PGOPTIONS=-c default_transaction_read_only=on -c statement_timeout=20000 -c lock_timeout=3000 -c idle_in_transaction_session_timeout=15000','/usr/lib/postgresql/16/bin/psql','-X','-q','-t','-A','-v','ON_ERROR_STOP=1','-d','proof_indexer']
start=time.monotonic();r=subprocess.run(argv,input=SQL,env=E,capture_output=True,timeout=105);assert len(r.stdout)<128*1024 and len(r.stderr)<65536;assert state(unit).get('MainPID','0')=='0';assert before=={u:state(u)for u in units}
values=[]
if r.returncode==0:
 decoder=json.JSONDecoder();text=r.stdout.decode();offset=0
 while offset<len(text):
  while offset<len(text)and text[offset].isspace():offset+=1
  if offset==len(text):break
  v,n=decoder.raw_decode(text,offset);values.append(v);offset=n
print(json.dumps({'schema':'pow-audit30-id-original-page-profile-native-v1','atUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'returncode':r.returncode,'seconds':round(time.monotonic()-start,3),'sqlSHA256':hashlib.sha256(SQL).hexdigest(),'values':values,'stdoutBytes':len(r.stdout),'stdoutSHA256':hashlib.sha256(r.stdout).hexdigest(),'stderrBytes':len(r.stderr),'stderrSHA256':hashlib.sha256(r.stderr).hexdigest(),'liveServicesUnchanged':True,'sqlStopped':True,'productionDataMutation':False,'qualification':'At most three transition rows in each of two source-identical initial-pass keyset pages (activation/latest PWID). EXPLAIN includes plan execution and excludes wire payload serialization; no payload/carrier/SQL parameters exported. This is not whole historical replay, cache-cold cost, or initial-vs-final observed running-request attribution.'},sort_keys=True))
'''
ssh=['ssh','-i','/home/sixer/.ssh/proofofwork_node_ed25519','-o','BatchMode=yes','-o','IdentitiesOnly=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=10','powadmin@65.108.122.87',shlex.join(['sudo','-n','/usr/bin/python3','-I','-B','-'])];r=subprocess.run(ssh,input=('SQL='+repr(sql)+'\n'+code).encode(),capture_output=True,timeout=130)
p=pathlib.Path('/tmp/pow-audit30-id-original-page-profile-native-v1.json')
for ext,b in [('.stdout',r.stdout),('.stderr',r.stderr)]:
 with pathlib.Path(str(p)+ext).open('xb')as f:f.write(b);f.flush();os.fsync(f.fileno())
d={'transportReturncode':r.returncode,'sourceSHA256':hashlib.sha256(pathlib.Path(__file__).read_bytes()).hexdigest(),'result':json.loads(r.stdout)if r.returncode==0 else None,'stderrBytes':len(r.stderr),'stderrSHA256':hashlib.sha256(r.stderr).hexdigest()}
with p.open('xb')as f:f.write((json.dumps(d,sort_keys=True,indent=2)+'\n').encode());f.flush();os.fsync(f.fileno())
print(json.dumps(d,sort_keys=True))
