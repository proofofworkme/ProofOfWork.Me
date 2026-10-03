#!/usr/bin/python3
import datetime,hashlib,json,os,re,stat,subprocess,time
from pathlib import Path
UNIT="proofofwork-audit30-stream-completion-20261003T064500Z.service"
INV="a0a66fc0de4341e892f8cc5bb98a8f13"
PACKAGE=Path("/usr/local/lib/proofofwork-audit30-stream-completion/20261003T064500Z")
JOB=Path("/data/proofofwork-audit30-inspect-20261003T014100Z")
SOURCE=Path("/data/proofofwork-audit30-restore-20261002T234651Z")
FIVE={"bitcoind.service":(1324302,"64e1fa7be2e2442d8c7f5763f60b85fb"),"electrs.service":(1324320,"72418b1c7ab245e4a37685ed868a1084"),"postgresql@16-main.service":(1537429,"e0bf545f0ad944e89fe1005577e61b9c"),"proofofwork-api.service":(2103747,"208f8bcbecc54afbb7166754f12065c2"),"proofofwork-indexer-worker.service":(2103760,"33b3ee25490749db89e0d55fd29d0afb")}
def meta(st):return {"dev":st.st_dev,"inode":st.st_ino,"mode":stat.S_IMODE(st.st_mode),"uid":st.st_uid,"gid":st.st_gid,"nlink":st.st_nlink,"bytes":st.st_size,"mtimeNs":st.st_mtime_ns,"ctimeNs":st.st_ctime_ns}
def pairs(rows):
 d={}
 for k,v in rows:
  if k in d:raise ValueError("Duplicate receipt key")
  d[k]=v
 return d
def fixed_file(path,maximum=65536,fields=()):
 if not os.path.lexists(path):return {"exists":False}
 st=path.lstat();m=meta(st)
 if not stat.S_ISREG(st.st_mode) or st.st_nlink!=1 or st.st_uid not in (0,108) or st.st_size>maximum:raise ValueError("Fixed public receipt custody")
 fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NOATIME)
 try:
  if meta(os.fstat(fd))!=m:raise ValueError("Fixed receipt FD drift")
  raw=b""
  while True:
   b=os.read(fd,65536)
   if not b:break
   raw+=b
   if len(raw)>maximum:raise ValueError("Fixed receipt bound")
  if meta(os.fstat(fd))!=m or meta(path.lstat())!=m:raise ValueError("Fixed receipt drift")
 finally:os.close(fd)
 out={"exists":True,"metadata":m,"sha256":hashlib.sha256(raw).hexdigest()}
 if fields:
  v=json.loads(raw,object_pairs_hook=pairs)
  out["publicFields"]={k:v[k] for k in fields if k in v}
  if "firstReasonSha256" in v:out["publicFields"]["firstReasonSha256"]=v["firstReasonSha256"]
 return out
FIELDS=["LoadState","ActiveState","SubState","MainPID","InvocationID","Result","ExecMainStatus","UnitFileState","NextElapseUSecRealtime"]
def unit(name):
 r=subprocess.run(["/usr/bin/systemctl","show",name,*sum((["-p",x] for x in FIELDS),[])],capture_output=True,timeout=10,env={"PATH":"/usr/bin:/bin","LC_ALL":"C"})
 if r.returncode or len(r.stdout)>16384 or len(r.stderr)>4096:raise ValueError("Fixed systemctl bound")
 return dict(x.split("=",1) for x in r.stdout.decode().splitlines())
def main():
 if os.geteuid()!=0 or os.uname().nodename!="pow-bitcoin-01":raise ValueError("Fixed root node")
 u=unit(UNIT)
 if not (u.get("MainPID")=="0" and ((u.get("LoadState")=="loaded" and u.get("InvocationID")==INV and u.get("ActiveState") in ("inactive","failed")) or (u.get("LoadState")=="not-found" and u.get("ActiveState")=="inactive"))):raise ValueError("Exact owned/qualified GC endpoint identity")
 paths={"intent":JOB/"stream-completion-v2/intent.json","completed":JOB/"stream-completion-v2/completed.json","failed":JOB/"stream-completion-v2/failed.json"}
 fields={"completed":("schema","status","planSha256","priorFailureSha256","priorIntentSha256","priorBodySha256","priorCompletionFailureSha256","priorCompletionIntentSha256","priorCompletionRemainsFailed","originalAttemptRemainsFailed","bodyAll16Accepted","bodyRedo","newSchemaWrite","freshCurrentSideByteEquality","measurementSqlSha256","measurements","fullNativeByteEquality","privateClusterStopped","liveServicesUnchanged","sealedSourceFullHashVerifiedBeforeStart","sealedSourceFullHashVerifiedAtStop","productionMutation","sealedSourceStarted","mathAccepted","allHistoricalReplay","incrementalAllocatedBytes","nativeSeconds","wholeSeconds","backupWindowRecheckedAtStop"),"failed":("schema","status","phase","errorClass","privateStopVerified","cleanupErrors","productionMutation","automaticRetry","originalAttemptRemainsFailed")}
 receipts={k:fixed_file(p,65536,fields.get(k,())) for k,p in paths.items()}
 if not receipts['completed']['exists'] or receipts['failed']['exists']:raise ValueError("Expected passed completion only")
 done=receipts['completed']['publicFields']
 if done.get('schema')!='pow-audit30-complete-retained-private-stream-completed-v1' or done.get('status')!='passed' or done.get('planSha256')!='66a9ea0b9045df377fa5d6c00d83f4556f9b90bff357cf80ace5cc9210472dac':raise ValueError('Fixed completed source authority')
 truekeys=('priorCompletionRemainsFailed','originalAttemptRemainsFailed','bodyAll16Accepted','freshCurrentSideByteEquality','fullNativeByteEquality','privateClusterStopped','liveServicesUnchanged','sealedSourceFullHashVerifiedBeforeStart','sealedSourceFullHashVerifiedAtStop','backupWindowRecheckedAtStop')
 falsekeys=('bodyRedo','newSchemaWrite','productionMutation','sealedSourceStarted','mathAccepted','allHistoricalReplay')
 hashkeys=('planSha256','priorFailureSha256','priorIntentSha256','priorBodySha256','priorCompletionFailureSha256','priorCompletionIntentSha256','measurementSqlSha256')
 if not all(done.get(k)is True for k in truekeys)or not all(done.get(k)is False for k in falsekeys)or not all(isinstance(done.get(k),str)and re.fullmatch('[0-9a-f]{64}',done[k])for k in hashkeys)or not all(type(done.get(k))in(int,float)and 0<=done[k]<=900 for k in ('nativeSeconds','wholeSeconds'))or type(done.get('incrementalAllocatedBytes'))is not int or not 0<=done['incrementalAllocatedBytes']<=512*1024**2:raise ValueError('Closed completed scalar flags')
 m=done.get('measurements');keys={'sourceSha256','sourceBytes','partCount','chunkCount','uniqueChunkBytes','schemaTotalBytes','relations','fullSourceHashVerifiedExternally'}
 if not isinstance(m,dict)or set(m)!=keys or m['sourceSha256']!='7cbe1c4753df618c744c8d14cf68e9399ad5d18628a9073bd252f143ebd8180a' or m['sourceBytes']!=22662023 or not all(type(m[k])is int and m[k]>=0 for k in ('sourceBytes','partCount','chunkCount','uniqueChunkBytes','schemaTotalBytes')) or m['fullSourceHashVerifiedExternally']is not False:raise ValueError('Closed public measurement shape')
 if not isinstance(m['relations'],list)or [x.get('name')for x in m['relations']]!=['capture','chunks','parts'] or not all(set(x)=={'name','heapBytes','indexesBytes','tableWithToastBytes','totalBytes'}and all(type(x[k])is int and x[k]>=0 for k in ('heapBytes','indexesBytes','tableWithToastBytes','totalBytes'))for x in m['relations']):raise ValueError('Closed relation counters')
 names=('native.copy','native.reconstructed.copy','native.columns.json','native.checkpoint.json','native.marker.copy','native.marker-value.json','native.context.json');artifacts={};total=0
 for n in names:
  cap=64*1024**2 if n in ('native.copy','native.reconstructed.copy')else 2*1024**2 if n in ('native.marker.copy','native.marker-value.json')else 1024**2
  r=fixed_file(JOB/'stream-completion-v2'/n,cap)
  if not r['exists']or not (r['metadata']['uid']==108 and r['metadata']['gid']==112 and r['metadata']['mode']==0o600):raise ValueError('Exact private oracle file custody')
  total+=r['metadata']['bytes']
  if total>128*1024**2:raise ValueError('Seven file aggregate bound')
  artifacts[n]=r
 if artifacts['native.copy']['sha256']!=artifacts['native.reconstructed.copy']['sha256']or artifacts['native.copy']['metadata']['bytes']!=22662023:raise ValueError('Complete native copies differ')
 live={k:unit(k) for k in FIVE};same=all(v.get("ActiveState")=="active" and v.get("SubState")=="running" and v.get("MainPID")==str(FIVE[k][0]) and v.get("InvocationID")==FIVE[k][1] for k,v in live.items())
 stop={str(j):{"postmasterPidExists":os.path.lexists(j/"cluster/postmaster.pid"),"privateSocketExists":os.path.lexists(j/"socket/.s.PGSQL.55432")} for j in (JOB,SOURCE)}
 backup=unit("proofofwork-postgres-logical-backup.service");timer=unit("proofofwork-postgres-logical-backup.timer")
 print(json.dumps({"schema":"pow-audit30-retained-completion-completed-endpoint-observer-v1","atUtc":datetime.datetime.now(datetime.timezone.utc).isoformat(),"unit":u,"receipts":receipts,"oracleFileHashes":artifacts,"sevenFileRegularBytes":total,"liveFive":live,"liveFiveUnchanged":same,"clusterFileEndpoints":stop,"backup":backup,"timer":timer,"productionMutation":False,"rawPrivateDataExported":False,"continuousReaderExclusionCertified":False,"fullSourceAfterHashCertified":False},sort_keys=True))
if __name__=="__main__":main()
