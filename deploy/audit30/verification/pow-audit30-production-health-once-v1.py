#!/usr/bin/env python3
"""Fixed single production health GET; hashes and reviewed public predicates only."""
import hashlib,json,os,pathlib,shlex,subprocess
CODE=r'''
import datetime,hashlib,http.client,json,math,pathlib,re,signal,time,urllib.request,urllib.error
URL='http://127.0.0.1:8081/health';CAP=1024**2
BOOL_PATHS=['ok','ready','available','checks.addressIndex.ok','checks.addressIndex.timedOut','checks.backend.ok','checks.backend.timedOut','checks.database.ok','checks.database.canonicalMetaOk','checks.database.required','checks.database.timedOut','checks.disk.ok','checks.disk.root.ok','checks.disk.cache.ok','checks.electrum.ok','checks.electrum.atTip','checks.electrum.configured','checks.electrum.timedOut','checks.index.ok','checks.index.available','checks.index.complete','checks.index.checkpointCanonical','checks.index.canonicalState.ok','checks.index.canonicalState.fault.active','checks.index.summarySnapshot.ok','checks.node.ok','checks.node.initialBlockDownload','checks.node.pruned','checks.node.txindexSynced','checks.worker.ok','checks.worker.proofReady','checks.worker.containment.active','checks.worker.pendingEvents.ok','checks.worker.pendingEvents.required','checks.worker.pendingEvents.status.ok','checks.worker.pendingEvents.status.unavailable','checks.worker.pendingEvents.status.unavailableValid']
NUMBER_PATHS=['indexedThroughBlock','tipHeight','lagBlocks','checks.addressIndex.itemCount','checks.disk.root.availableBytes','checks.disk.root.totalBytes','checks.disk.cache.availableBytes','checks.disk.cache.totalBytes','checks.index.aheadBlocks','checks.index.indexedThroughBlock','checks.index.lagBlocks','checks.index.scanTipHeight','checks.index.readModels.confirmedIds.count','checks.index.readModels.confirmedTransfers.count','checks.electrum.headerHeight','checks.node.tipHeight','checks.node.headers','checks.node.txindexHeight','checks.worker.ageMs','checks.worker.maxAgeMs','checks.worker.consecutiveFailures','checks.worker.containment.checkpointHeight','checks.worker.containment.failingBlockHeight','checks.worker.containment.repeatCount','checks.worker.pendingEvents.globalUnresolved','checks.worker.pendingEvents.q16PendingUnresolved','checks.worker.pendingEvents.status.checked','checks.worker.pendingEvents.status.deferred','checks.worker.pendingEvents.status.errors','checks.worker.pendingEvents.status.q16ParentDeferred','checks.worker.pendingEvents.status.staleCandidates']
HASH_PATHS=['checks.node.bestBlockHash','checks.index.checkpointHash','checks.index.canonicalCheckpointHash','checks.electrum.headerHash','checks.worker.containment.checkpointHash','checks.worker.containment.fingerprint']
REASON_PATHS=['checks.worker.error','checks.worker.phase','checks.worker.proofSource','checks.worker.containment.reason','checks.index.stopReason','checks.index.canonicalState.rebuild.status','checks.index.canonicalState.fault.reason','checks.addressIndex.error','checks.electrum.error']
ENUMS={'idle','running','confirmed','pending','best-effort-pending','complete','ready','unavailable','block-scan','mempool-scan','authoritative-block-scan-checkpoint-v1','canonical-worker-exact-tip-proof-v1'}
def value(p,path):
 for k in path.split('.'):
  if not isinstance(p,dict)or k not in p:return None
  p=p[k]
 return p

def sanitize(p):
 assert isinstance(p,dict)
 out=dict(booleans={},numbers={},hashes={},reasonDigests={})
 for key in BOOL_PATHS:
  v=value(p,key);assert v is None or type(v)is bool;out['booleans'][key]=v
 for key in NUMBER_PATHS:
  v=value(p,key);assert v is None or(type(v)is int and abs(v)<=2**53-1);out['numbers'][key]=v
 for key in HASH_PATHS:
  v=value(p,key);assert v is None or isinstance(v,str)
  out['hashes'][key]=v if isinstance(v,str)and re.fullmatch('[0-9a-f]{64}',v)else None
 for key in REASON_PATHS:
  v=value(p,key)
  if v is None:out['reasonDigests'][key]=None;continue
  assert isinstance(v,str)and len(v.encode())<=4096
  out['reasonDigests'][key]=dict(bytes=len(v.encode()),sha256=hashlib.sha256(v.encode()).hexdigest(),enum=v if v in ENUMS else None)
 return out
class NoRedirect(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,req,fp,code,msg,headers,newurl):return None

def timedout(signum,frame):raise TimeoutError('HEALTH_TOTAL_30S')
start=time.monotonic();raw=b'';row=dict(schema='pow-audit30-production-health-single-observation-v1',atUtc=datetime.datetime.now(datetime.timezone.utc).isoformat(),requestMaximumSeconds=30,bodyMaximumBytes=CAP,productionMutation=False,timerChanges=False)
signal.signal(signal.SIGALRM,timedout);signal.setitimer(signal.ITIMER_REAL,30)
try:
 opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),NoRedirect())
 try:response=opener.open(URL,timeout=30)
 except urllib.error.HTTPError as e:response=e
 with response:
  row['status']=response.status
  parts=[];size=0
  while True:
   b=response.read(min(65536,CAP+1-size));size+=len(b);assert size<=CAP,'HEALTH_BODY_CAP'
   if not b:break
   parts.append(b)
  raw=b''.join(parts)
 row['bodyBytes']=len(raw);row['bodySHA256']=hashlib.sha256(raw).hexdigest();row['predicates']=sanitize(json.loads(raw))
except Exception as e:
 row['errorClass']=type(e).__name__;row['bodyBytes']=len(raw);row['bodySHA256']=hashlib.sha256(raw).hexdigest()
finally:signal.setitimer(signal.ITIMER_REAL,0)
row['seconds']=round(time.monotonic()-start,3);print(json.dumps(row,sort_keys=True))
'''
def main():
 out=pathlib.Path('/tmp/pow-audit30-production-health-once-native-v1.json')
 for q in [out,pathlib.Path(str(out)+'.stdout'),pathlib.Path(str(out)+'.stderr')]:assert not os.path.lexists(q)
 argv=['ssh','-i','/home/sixer/.ssh/proofofwork_node_ed25519','-o','BatchMode=yes','-o','IdentitiesOnly=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=10','powadmin@65.108.122.87',shlex.join(['sudo','-n','/usr/bin/python3','-I','-B','-'])]
 r=subprocess.run(argv,input=CODE.encode(),capture_output=True,timeout=45)
 for suffix,b in [('.stdout',r.stdout),('.stderr',r.stderr)]:
  with pathlib.Path(str(out)+suffix).open('xb')as f:f.write(b);f.flush();os.fsync(f.fileno())
 v=dict(schema='pow-audit30-production-health-single-transport-v1',sourceSHA256=hashlib.sha256(pathlib.Path(__file__).read_bytes()).hexdigest(),returncode=r.returncode,stdoutSHA256=hashlib.sha256(r.stdout).hexdigest(),stderrSHA256=hashlib.sha256(r.stderr).hexdigest(),result=json.loads(r.stdout)if r.returncode==0 else None)
 with out.open('xb')as f:f.write((json.dumps(v,sort_keys=True,indent=2)+'\n').encode());f.flush();os.fsync(f.fileno())
 print(json.dumps(v,sort_keys=True));return r.returncode
if __name__=='__main__':raise SystemExit(main())
