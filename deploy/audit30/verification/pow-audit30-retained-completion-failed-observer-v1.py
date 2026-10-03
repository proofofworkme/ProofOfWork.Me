#!/usr/bin/python3
import datetime,hashlib,json,os,re,stat,subprocess,time
from pathlib import Path
UNIT="proofofwork-audit30-stream-completion-20261003T063000Z.service"
INV="0c65c9c7f34d4b1094dc95417dea49cb"
PACKAGE=Path("/usr/local/lib/proofofwork-audit30-stream-completion/20261003T063000Z")
JOB=Path("/data/proofofwork-audit30-inspect-20261003T014100Z")
SOURCE=Path("/data/proofofwork-audit30-restore-20261002T234651Z")
FIVE={"bitcoind.service":(1324302,"64e1fa7be2e2442d8c7f5763f60b85fb"),"electrs.service":(1324320,"72418b1c7ab245e4a37685ed868a1084"),"postgresql@16-main.service":(1537429,"e0bf545f0ad944e89fe1005577e61b9c"),"proofofwork-api.service":(2103747,"208f8bcbecc54afbb7166754f12065c2"),"proofofwork-indexer-worker.service":(2103760,"33b3ee25490749db89e0d55fd29d0afb")}
def meta(st):return {"dev":st.st_dev,"inode":st.st_ino,"mode":stat.S_IMODE(st.st_mode),"uid":st.st_uid,"gid":st.st_gid,"nlink":st.st_nlink,"bytes":st.st_size,"mtimeNs":st.st_mtime_ns,"ctimeNs":st.st_ctime_ns}
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
  v=json.loads(raw)
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
 if u.get("LoadState")!="loaded" or u.get("InvocationID")!=INV:raise ValueError("Exact owned endpoint identity")
 paths={"rootCapture":PACKAGE/"completion-run-capture.json","rootStderr":PACKAGE/"completion-run-capture.json.stderr","rootFailed":PACKAGE/"completion-run-capture.json.failed.json","intent":JOB/"stream-completion-v1/intent.json","failed":JOB/"stream-completion-v1/failed.json","completed":JOB/"stream-completion-v1/completed.json"}
 fields={"rootFailed":("schema","status","firstErrorClass","observedInvocation","cleanup","channels","automaticRetry","privateClusterStoppedCertifiedByCapture"),"failed":("schema","status","phase","errorClass","privateStopVerified","cleanupErrors","productionMutation","automaticRetry","originalAttemptRemainsFailed")}
 receipts={k:fixed_file(p,1048576 if k in ("rootCapture","rootStderr") else 65536,fields.get(k,())) for k,p in paths.items()}
 phases=("retained-local-byte-equivalence","private-start","retained-context","retained-saved-fence","fresh-side-export","fresh-side-byte-equivalence","retained-native-measurements","capture-marker-jsonb","retained-context-after","retained-fence-after")
 errs={}
 for i in range(1,14):
  for phase in phases:
   p=JOB/"stream-completion-v1"/(str(i).zfill(2)+"-"+phase+".stderr")
   if os.path.lexists(p):errs[p.name]=fixed_file(p,8*1024**2)
 live={k:unit(k) for k in FIVE};same=all(v.get("ActiveState")=="active" and v.get("SubState")=="running" and v.get("MainPID")==str(FIVE[k][0]) and v.get("InvocationID")==FIVE[k][1] for k,v in live.items())
 stop={str(j):{"postmasterPidExists":os.path.lexists(j/"cluster/postmaster.pid"),"privateSocketExists":os.path.lexists(j/"socket/.s.PGSQL.55432")} for j in (JOB,SOURCE)}
 backup=unit("proofofwork-postgres-logical-backup.service");timer=unit("proofofwork-postgres-logical-backup.timer")
 print(json.dumps({"schema":"pow-audit30-retained-completion-failed-endpoint-observer-v1","atUtc":datetime.datetime.now(datetime.timezone.utc).isoformat(),"unit":u,"receipts":receipts,"phaseStderrHashes":errs,"liveFive":live,"liveFiveUnchanged":same,"clusterFileEndpoints":stop,"backup":backup,"timer":timer,"productionMutation":False,"rawPrivateDataExported":False,"continuousReaderExclusionCertified":False,"fullSourceAfterHashCertified":False},sort_keys=True))
if __name__=="__main__":main()
