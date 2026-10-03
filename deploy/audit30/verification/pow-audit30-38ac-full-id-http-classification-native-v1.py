#!/usr/bin/env python3
"""Fixed failed38ac unit journal hashes and fixed-enum classifications; no raw messages."""
import hashlib,json,os,pathlib,shlex,subprocess
CODE=r'''
import datetime,hashlib,json,re,subprocess
UNIT='proofofwork-audit29-shadow-38ac6e2bff2a-20261003T042000Z.service';ENV={'PATH':'/usr/bin:/bin','LC_ALL':'C'}
r=subprocess.run(['/usr/bin/journalctl','--unit='+UNIT,'--since=2026-10-03 04:26:50 UTC','--until=2026-10-03 04:31:35 UTC','--no-pager','--output=json','--lines=120'],env=ENV,capture_output=True,timeout=15)
assert r.returncode==0 and not r.stderr and len(r.stdout)<=1024**2
patterns=['SHADOW','readiness','work-q16-readiness-unavailable','CANONICAL_WALLET_INDEX_UNAVAILABLE','CANONICAL_INDEX_UNAVAILABLE','EADDRINUSE','EACCES','ECONNREFUSED','ETIMEDOUT','AbortError','TimeoutError','error','listening','Listening','Started','Stopping','Stopped','Successfully','Failed','MODULE_NOT_FOUND','ERR_MODULE_NOT_FOUND']
def health_observation(message):
 try:d=json.loads(message)
 except (ValueError,TypeError):return None
 if not isinstance(d,dict)or d.get('event')not in ['http-response-observation','http-response-interrupted-observation']or d.get('route')not in ['/api/v1/internal/id-registry-audit','/api/v1/internal/id-registry-audit-fence']or d.get('method')!='GET':return None
 assert type(d.get('status'))is int and 100<=d['status']<=599 and type(d.get('elapsedMs'))is int and 0<=d['elapsedMs']<=600000
 row=dict(event=d['event'],route=d['route'],method='GET',status=d['status'],elapsedMs=d['elapsedMs'])
 if d['event']=='http-response-interrupted-observation':
  assert type(d.get('headersSent'))is bool;row['headersSent']=d['headersSent']
 return row
rows=[]
health=[]
for line in r.stdout.splitlines():
 d=json.loads(line);m=d.get('MESSAGE','');assert isinstance(m,str)
 h=health_observation(m)
 if h is not None:health.append(dict(h,timestampUsec=d.get('__REALTIME_TIMESTAMP')))
 rows.append(dict(timestampUsec=d.get('__REALTIME_TIMESTAMP'),pid=d.get('_PID'),invocationID=d.get('_SYSTEMD_INVOCATION_ID'),messageBytes=len(m.encode()),messageSHA256=hashlib.sha256(m.encode()).hexdigest(),knownPatterns=[p for p in patterns if p in m]))
print(json.dumps(dict(schema='pow-audit30-id-audit-http-journal-enum-hash-v1',unit=UNIT,atUtc=datetime.datetime.now(datetime.timezone.utc).isoformat(),rows=rows,auditObservations=health,journalBytes=len(r.stdout),journalSHA256=hashlib.sha256(r.stdout).hexdigest(),rawMessagesExported=False,qualification='Fixed120 journal rows only. Exactly two internal audit route finish/close events. HTTP200 is transport success, not CLI fence equality or final semantic parity. No fence preimages were captured by the previous CLI.'),sort_keys=True))
'''
out=pathlib.Path('/tmp/pow-audit30-38ac-full-id-http-classification-native-v1.json');assert not os.path.lexists(out)
argv=['ssh','-i','/home/sixer/.ssh/proofofwork_node_ed25519','-o','BatchMode=yes','-o','IdentitiesOnly=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=10','powadmin@65.108.122.87',shlex.join(['sudo','-n','/usr/bin/python3','-I','-B','-'])]
r=subprocess.run(argv,input=CODE.encode(),capture_output=True,timeout=60)
for suffix,b in [('.stdout',r.stdout),('.stderr',r.stderr)]:
 with pathlib.Path(str(out)+suffix).open('xb')as f:f.write(b);f.flush();os.fsync(f.fileno())
v=dict(schema='pow-audit30-failed-shadow-journal-transport-v1',sourceSHA256=hashlib.sha256(pathlib.Path(__file__).read_bytes()).hexdigest(),returncode=r.returncode,stdoutSHA256=hashlib.sha256(r.stdout).hexdigest(),stderrSHA256=hashlib.sha256(r.stderr).hexdigest(),result=json.loads(r.stdout)if r.returncode==0 else None)
with out.open('xb')as f:f.write((json.dumps(v,sort_keys=True,indent=2)+'\n').encode());f.flush();os.fsync(f.fileno())
print(json.dumps(v,sort_keys=True))
