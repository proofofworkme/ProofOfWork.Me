#!/usr/bin/python3 -I
"""Fixed hash-only retained prototype census. No SQL, service actions or bytes export."""
import datetime as dt,hashlib,json,os,signal,stat,subprocess,time
from pathlib import Path
JOB=Path('/data/proofofwork-audit30-inspect-20261003T014100Z')
LOCK=Path('/data/proofofwork-postgres-backups/logical/.proofofwork-postgres-logical-backup.lock')
INPUTS=('stream-prototype-plan.json','stream-spools.json','stream-chunks.sqlite','stream-transitions-source.copy','stream-ordered-export.copy','stream-native-reconstructed.copy','stream-local-reconstructed.copy','stream-columns.json','stream-checkpoint.json','stream-samples.json','stream-chunks.copy','stream-parts.copy','stream-capture-meta.copy')
PROOFS={'intent.json':'2422dfe6c6da4b3a1b25666e6a101ab22752334bc33d32f2de85b1672be0e13b','failed.json':'a382644507ab070b2a737f179fb965a3f671d7c661159acea1e147298ffaa503','phase4-body-rehearsal-v2-completed.json':'a0bdd9543178f1ab7972ee0af9140c2d7d052be9c003fafe357e4ce8fd62e058'}
SERVICES=('bitcoind.service','electrs.service','postgresql@16-main.service','proofofwork-api.service','proofofwork-indexer-worker.service')
SOURCE_SHA='7cbe1c4753df618c744c8d14cf68e9399ad5d18628a9073bd252f143ebd8180a';SOURCE_BYTES=22662023
ENV={'PATH':'/usr/bin:/bin','LANG':'C.UTF-8','LC_ALL':'C.UTF-8'}
class CensusInterrupted(RuntimeError):pass
def need(v,c):
 if not v:raise ValueError(c)
def meta(s):return dict(device=s.st_dev,inode=s.st_ino,mode=stat.S_IMODE(s.st_mode),uid=s.st_uid,gid=s.st_gid,bytes=s.st_size,mtimeNs=s.st_mtime_ns,ctimeNs=s.st_ctime_ns,nlink=s.st_nlink)
def read_hash(path,maximum):
 need(path.resolve(strict=True)==path,'Noncanonical fixed path');before=path.lstat();m=meta(before);need(stat.S_ISREG(before.st_mode)and m['uid']==108 and m['gid']==112 and m['mode']==0o600 and m['nlink']==1 and m['bytes']<=maximum,'Retained private file custody');h=hashlib.sha256();fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NOATIME)
 with os.fdopen(fd,'rb')as f:
  need(meta(os.fstat(f.fileno()))==m,'File descriptor drift')
  while raw:=f.read(65536):h.update(raw)
  need(meta(os.fstat(f.fileno()))==m,'File read drift')
 need(meta(path.lstat())==m,'File path drift');return dict(metadata=m,sha256=h.hexdigest())
def show(unit,fields):
 r=subprocess.run(['/usr/bin/systemctl','show',unit,*sum((['-p',x]for x in fields),[])],env=ENV,capture_output=True,timeout=10);need(r.returncode==0 and not r.stderr and len(r.stdout)<=65536,'Fixed systemctl census refused');return dict(line.split('=',1)for line in r.stdout.decode().splitlines()if '='in line)
def main():
 need(os.geteuid()==0 and os.uname().nodename=='pow-bitcoin-01','Fixed root node census');start=time.monotonic();old={x:signal.signal(x,lambda *_:(_ for _ in()).throw(CensusInterrupted('Census interrupted')))for x in(signal.SIGTERM,signal.SIGINT,signal.SIGHUP)};alarm=signal.signal(signal.SIGALRM,lambda *_:(_ for _ in()).throw(TimeoutError('Fixed census120s')));signal.setitimer(signal.ITIMER_REAL,120)
 try:
  before={n:show(n,['ActiveState','MainPID','InvocationID'])for n in SERVICES};need(all(r['ActiveState']=='active'and r['MainPID'].isdigit()and int(r['MainPID'])>0 and len(r['InvocationID'])==32 for r in before.values()),'Five active baselines')
  job=meta(JOB.lstat());need(JOB.resolve(strict=True)==JOB and JOB.is_dir()and job['uid']==108 and job['gid']==112 and job['mode']==0o700,'Fixed private clone directory')
  lock=read_hash(LOCK,0);need(lock['metadata']['bytes']==0,'Existing backup lock')
  bindings={};total=0
  for name in INPUTS:
   size=(JOB/name).lstat().st_size;need(0<=size<=144*1024**2 and total+size<=512*1024**2,'Cumulative fixed input byte bound');bindings[name]=read_hash(JOB/name,144*1024**2);total+=size
  source=bindings['stream-transitions-source.copy'];need(source['sha256']==SOURCE_SHA and source['metadata']['bytes']==SOURCE_BYTES,'Exact complete retained source')
  proofs={}
  for name,h in PROOFS.items():
   r=read_hash(JOB/'stream-followup-v1'/name,65536);need(r['sha256']==h,'Original failure/body proof drift');proofs[name]=r
  backup=show('proofofwork-postgres-logical-backup.service',['ActiveState','MainPID','InvocationID']);timer=show('proofofwork-postgres-logical-backup.timer',['ActiveState','UnitFileState','NextElapseUSecRealtime']);need(backup['ActiveState']=='inactive'and backup['MainPID']=='0'and timer['ActiveState']=='active'and timer['UnitFileState']=='enabled','Scheduled backup inactive without timer changes');next_at=dt.datetime.strptime(timer['NextElapseUSecRealtime'],'%a %Y-%m-%d %H:%M:%S %Z').replace(tzinfo=dt.timezone.utc)
  oldunit=show('proofofwork-audit30-transition-stream-20261003T030000Z.service',['LoadState','ActiveState','MainPID','InvocationID']);need(oldunit==dict(LoadState='loaded',ActiveState='failed',MainPID='0',InvocationID='37976ccc59d546698d9b1b22b901a1ef'),'Preserved failed original unit')
  after={n:show(n,['ActiveState','MainPID','InvocationID'])for n in SERVICES};need(before==after,'Fresh five changed during read');need(read_hash(LOCK,0)==lock,'Existing lock drift');now=dt.datetime.now(dt.timezone.utc)
  print(json.dumps(dict(schema='pow-audit30-retained-completion-input-census-v1',atUtc=now.isoformat(),host='pow-bitcoin-01',status='passed',inputBindings=bindings,originalProofBindings=proofs,backupLock=lock['metadata'],backupWindow=dict(preflightAtUtc=now.isoformat(),nextScheduledAtUtc=next_at.isoformat()),liveServices={n:{k:r[k]for k in ['MainPID','InvocationID']}for n,r in after.items()},originalFailedUnit=oldunit,inputRegularBytes=total,seconds=time.monotonic()-start,sqlExecuted=False,serviceActions=False,rawInputBytesExported=False,privateClusterStarted=False),sort_keys=True))
 finally:
  signal.setitimer(signal.ITIMER_REAL,0);signal.signal(signal.SIGALRM,alarm)
  for x,h in old.items():signal.signal(x,h)
if __name__=='__main__':
 try:main()
 except BaseException as exc:print(json.dumps(dict(status='refused',errorClass=type(exc).__name__,rawDetailsSuppressed=True,sqlExecuted=False,serviceActions=False),sort_keys=True),file=__import__('sys').stderr);raise SystemExit(1)
