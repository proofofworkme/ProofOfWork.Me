import os,stat,json,hashlib,subprocess,datetime
from pathlib import Path
p=Path('/data/proofofwork-release-backups/audit30-treasury-address-20261003T031100Z/failed.json');s=p.lstat();assert os.geteuid()==0 and p.resolve()==p and stat.S_ISREG(s.st_mode) and s.st_uid==0 and stat.S_IMODE(s.st_mode)==0o600 and s.st_nlink==1 and s.st_size<=1048576
f=os.open(p,os.O_RDONLY|os.O_NOFOLLOW|os.O_NOATIME)
try:
 raw=os.read(f,1048577);assert len(raw)==s.st_size and os.fstat(f).st_mtime_ns==s.st_mtime_ns
finally:os.close(f)
v=json.loads(raw);assert v['schema']=='pow-audit30-treasury-native-outcome-v1' and v['runId']=='20261003T031100Z'
fields=('LoadState','ActiveState','SubState','MainPID','InvocationID','Result','ExecMainStatus','User','Group');r=subprocess.run(['/usr/bin/systemctl','show','proofofwork-audit30-treasury-address-20261003T031100Z.service',*[f'-p{x}'for x in fields]],capture_output=True,timeout=10);assert r.returncode==0 and len(r.stdout)<16384
out={'schema':'pow-audit30-treasury-failed-receipt-observation-v1','atUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'rawReceiptBytes':len(raw),'rawReceiptSha256':hashlib.sha256(raw).hexdigest(),'observedUnit':dict(x.split('=',1)for x in r.stdout.decode().splitlines()),'productionMutation':False,'rawCorpusOrStderrExported':False}
for k in ('transportAccepted','failure','cleanup','captureFiles','liveBefore','liveAfter','retainedUnitProbeSha256','outputPropertyProbeSha256'):out[k]=v.get(k)
out['snapshotCount']=len(v.get('unitSnapshots',[]));out['lastSnapshot']=v.get('unitSnapshots',[None])[-1];print(json.dumps(out,sort_keys=True))
