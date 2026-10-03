import os,json,hashlib,stat,resource
from pathlib import Path
resource.setrlimit(resource.RLIMIT_AS,(512*1024**2,512*1024**2));resource.setrlimit(resource.RLIMIT_CPU,(30,30))
p=Path('/data/proofofwork-release-backups/audit30-treasury-address-20261003T031100Z/corpus.json');s=p.lstat();assert p.resolve()==p and stat.S_ISREG(s.st_mode)and s.st_uid==0 and s.st_nlink==1 and stat.S_IMODE(s.st_mode)==0o600 and s.st_size==17672203
fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW|os.O_NOATIME)
with os.fdopen(fd,'rb')as f:raw=f.read(17672204);assert os.fstat(f.fileno()).st_mtime_ns==s.st_mtime_ns
assert len(raw)==s.st_size and hashlib.sha256(raw).hexdigest()=='8eeb467bf3468734beee934d884148b7045ed28803045a2b66ac51ca0f1e2596'
v=json.loads(raw);a=[]
for address,d in v['discovery'].items():
 rows=d['unspent'];assert all(type(r['value'])is int and r['value']>=0 for r in rows)
 a.append(dict(address=address,historyRows=len(d['history']),confirmedHistoryRows=sum(r['height']>0 for r in d['history']),pendingHistoryRows=sum(r['height']<=0 for r in d['history']),unspentRows=len(rows),confirmedUnspentRows=sum(r['height']>0 for r in rows),unspentProofs=sum(r['value']for r in rows),zeroValueUnspentRows=sum(r['value']==0 for r in rows),indexReportedBalance=d['balance']))
print(json.dumps(dict(schema='pow-audit30-treasury-failed-discovery-scalar-summary-v1',storedCorpusSha256=hashlib.sha256(raw).hexdigest(),discovery=a,noNewCoreCalls=True,noCurrentCanonicalBalanceClaim=True,productionMutation=False),sort_keys=True))
