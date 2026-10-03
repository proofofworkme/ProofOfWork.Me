import hashlib,json,os,pathlib,shlex,subprocess
UNIT='proofofwork-audit30-candidate-full-ids-38ac6e2bff2a-20261003T042000Z-fence-diagnostic-v2.service'
CODE=r'''import datetime,json,subprocess
ENV={'PATH':'/usr/bin:/bin','LC_ALL':'C'}
def state(u):
 r=subprocess.run(['/usr/bin/systemctl','show',u,'--property=LoadState,ActiveState,SubState,MainPID,InvocationID,Result,ExecMainStatus,CPUUsageNSec,MemoryPeak'],env=ENV,capture_output=True,timeout=10)
 assert r.returncode==0 and not r.stderr and len(r.stdout)<65536
 return dict(v.split('=',1)for v in r.stdout.decode().splitlines()if '='in v)
units=['bitcoind.service','electrs.service','postgresql@16-main.service','proofofwork-api.service','proofofwork-indexer-worker.service']
expected=[('1324302','64e1fa7be2e2442d8c7f5763f60b85fb'),('1324320','72418b1c7ab245e4a37685ed868a1084'),('1537429','e0bf545f0ad944e89fe1005577e61b9c'),('2103747','208f8bcbecc54afbb7166754f12065c2'),('2103760','33b3ee25490749db89e0d55fd29d0afb')]
observed={u:state(u)for u in units};audit=state(UNIT)
assert all(observed[u]['MainPID']==p and observed[u]['InvocationID']==i and observed[u]['ActiveState']=='active' for u,(p,i)in zip(units,expected))
assert audit['MainPID']=='0' and audit['ActiveState']in ['inactive','failed']
assert (audit['LoadState']=='not-found'and audit['InvocationID']=='')or(audit['LoadState']=='loaded'and len(audit['InvocationID'])==32)
print(json.dumps(dict(schema='pow-audit30-full-id-native-stop-observation-v2',atUtc=datetime.datetime.now(datetime.timezone.utc).isoformat(),unit=UNIT,audit=audit,liveServices=observed,liveFiveUnchanged=True,actualAuditStopped=True,productionMutation=False,timerChanges=False),sort_keys=True))
'''
raw=pathlib.Path('/tmp/pow-audit30-candidate-full-id-cli-fence-diagnostic-v2-native-v1.json').read_bytes();receipt=json.loads(raw);assert receipt['unit']==UNIT and receipt['sourceSHA256']=='217950fae9d8c81afe40ac779593d0595a66a9c64b70a8b263028af2b5917354' and receipt['auditScriptSHA256']=='d7bbe914e3db45fcebac174dc182146f988547fb8d94ffa65f8286cebd50a825'
out=pathlib.Path('/tmp/pow-audit30-full-id-fence-diagnostic-stopped-read-v1.json');assert not os.path.lexists(out)
code='UNIT='+repr(UNIT)+'\n'+CODE
argv=['ssh','-i','/home/sixer/.ssh/proofofwork_node_ed25519','-o','BatchMode=yes','-o','IdentitiesOnly=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=10','powadmin@65.108.122.87',shlex.join(['sudo','-n','/usr/bin/python3','-I','-B','-'])]
r=subprocess.run(argv,input=code.encode(),capture_output=True,timeout=90)
assert r.returncode==0 and not r.stderr and len(r.stdout)<65536
v=json.loads(r.stdout);v['sourceSHA256']=hashlib.sha256(pathlib.Path(__file__).read_bytes()).hexdigest();v['auditReceiptSHA256']=hashlib.sha256(raw).hexdigest();v['auditComplete']=receipt['complete'];v['auditReturncode']=receipt['returncode']
err=pathlib.Path('/tmp/pow-audit30-candidate-full-id-cli-fence-diagnostic-v2-native-v1.json.stderr').read_bytes();assert hashlib.sha256(err).hexdigest()==receipt['stderrSHA256']
v['failureClassification']={k:s.encode()in err for k,s in [('timeoutError','TimeoutError'),('operationAbortedDueToTimeout','operation was aborted due to timeout'),('implicitHeadersTimeout','UND_ERR_HEADERS_TIMEOUT'),('canonicalReplayDisagreement','storedCoreReplayDisagreement'),('tipChanged','tip changed'),('readFenceChanged','read fence'),('coverageFenceChanged','ID registry coverage changed during the audit read.')]};v['stderrBytes']=len(err);v['stderrSHA256']=hashlib.sha256(err).hexdigest()
with out.open('xb')as f:f.write((json.dumps(v,sort_keys=True,indent=2)+'\n').encode());f.flush();os.fsync(f.fileno())
print(json.dumps(v,sort_keys=True))
