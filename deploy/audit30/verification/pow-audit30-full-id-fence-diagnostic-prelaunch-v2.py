import datetime,hashlib,json,os,pathlib,shlex,subprocess
UNIT='proofofwork-audit30-candidate-full-ids-38ac6e2bff2a-20261003T042000Z-fence-diagnostic-v2.service'
CODE=r'''import datetime,json,subprocess
ENV={'PATH':'/usr/bin:/bin','LC_ALL':'C'}
def state(u):
 r=subprocess.run(['/usr/bin/systemctl','show',u,'--property=LoadState,ActiveState,SubState,MainPID,InvocationID,Result'],env=ENV,capture_output=True,timeout=10)
 assert r.returncode==0 and not r.stderr and len(r.stdout)<65536
 return dict(v.split('=',1)for v in r.stdout.decode().splitlines()if '='in v)
units=['bitcoind.service','electrs.service','postgresql@16-main.service','proofofwork-api.service','proofofwork-indexer-worker.service']
expected=[('1324302','64e1fa7be2e2442d8c7f5763f60b85fb'),('1324320','72418b1c7ab245e4a37685ed868a1084'),('1537429','e0bf545f0ad944e89fe1005577e61b9c'),('2103747','208f8bcbecc54afbb7166754f12065c2'),('2103760','33b3ee25490749db89e0d55fd29d0afb')]
observed={u:state(u)for u in units};audit=state(UNIT);backup=state('proofofwork-postgres-logical-backup.service');shadow=state(SHADOW_UNIT)
assert all(observed[u]['MainPID']==p and observed[u]['InvocationID']==i and observed[u]['ActiveState']=='active' for u,(p,i)in zip(units,expected))
assert audit['LoadState']=='not-found' and audit['MainPID']=='0'
assert backup['ActiveState']=='inactive' and backup['MainPID']=='0' and backup['Result']=='success'
assert datetime.datetime.now(datetime.timezone.utc) < datetime.datetime(2026,10,3,4,56,8,tzinfo=datetime.timezone.utc)
assert shadow['ActiveState']=='active' and shadow['InvocationID']==SHADOW_INVOCATION and shadow['MainPID']==SHADOW_PID
print(json.dumps(dict(schema='pow-audit30-full-id-native-prelaunch-observation-v1',atUtc=datetime.datetime.now(datetime.timezone.utc).isoformat(),unit=UNIT,audit=audit,shadow=shadow,backup=backup,liveServices=observed,liveFiveUnchanged=True,newAuditUnitAbsent=True,productionMutation=False,timerChanges=False),sort_keys=True))
'''
ready_raw=pathlib.Path('/tmp/pow-audit30-node-shadow-prepared-38ac-v2.json').read_bytes();assert hashlib.sha256(ready_raw).hexdigest()=='81e8698bcb1302d44b1d89aed2325f3323c473a59a38137a21985a7d8d7252f9';ready=json.loads(ready_raw)['result'];assert ready['ok'] and ready['liveServicesUnchanged'] and not ready['productionStop'];out=pathlib.Path('/tmp/pow-audit30-full-id-fence-diagnostic-prelaunch-v2.json')
for q in [out,pathlib.Path('/tmp/pow-audit30-candidate-full-id-cli-fence-diagnostic-v2-native-v1.json'),pathlib.Path('/tmp/pow-audit30-candidate-full-id-cli-fence-diagnostic-v2-native-v1.json.stdout'),pathlib.Path('/tmp/pow-audit30-candidate-full-id-cli-fence-diagnostic-v2-native-v1.json.stderr')]:assert not os.path.lexists(q)
code='UNIT='+repr(UNIT)+'\nSHADOW_UNIT='+repr(ready['unit'])+'\nSHADOW_INVOCATION='+repr(ready['invocationID'])+'\nSHADOW_PID='+repr(str(ready['mainPID']))+'\n'+CODE
argv=['ssh','-i','/home/sixer/.ssh/proofofwork_node_ed25519','-o','BatchMode=yes','-o','IdentitiesOnly=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=10','powadmin@65.108.122.87',shlex.join(['sudo','-n','/usr/bin/python3','-I','-B','-'])]
r=subprocess.run(argv,input=code.encode(),capture_output=True,timeout=90)
assert r.returncode==0 and not r.stderr and len(r.stdout)<65536
v=json.loads(r.stdout);v['sourceSHA256']=hashlib.sha256(pathlib.Path(__file__).read_bytes()).hexdigest()
with out.open('xb')as f:f.write((json.dumps(v,sort_keys=True,indent=2)+'\n').encode());f.flush();os.fsync(f.fileno())
print(json.dumps(v,sort_keys=True))
