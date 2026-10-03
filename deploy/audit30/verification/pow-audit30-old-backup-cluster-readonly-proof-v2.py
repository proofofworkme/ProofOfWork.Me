#!/usr/bin/python3 -I
"""Fixed old dump hash/complete metadata trees and three retained private job allocations.
No lock acquired (never delay scheduled backup), no SQL/start/stop/config/retirement.
Full cluster DATA bytes are not rehashed here; deletion/recovery equivalence stays open.
"""
import datetime,hashlib,json,os,pwd,re,stat,subprocess,sys,time
from pathlib import Path
OLD=Path('/data/proofofwork-postgres-backups/logical/proof_indexer-20260929T031853Z.dumpset')
MEMBERS={'proof_indexer.dump':(19363782935,'6bb26e725f1178f25720eadc46801975b987587578fbf7018203cddc65601031'),'globals.sql':(1137,'ec6fe5b2e0b460e873739e4d0d31e103e38e8142d3695fc2cfb5c2600d1ae7f8'),'SHA256SUMS':(163,'645bc0ced92fcb7383f8dafda3a54d00f960ab24a29021cd8b938b6dd2a74031')}
JOBS=('/data/proofofwork-audit30-restore-20261002T234651Z','/data/proofofwork-audit30-inspect-20261003T005512Z','/data/proofofwork-audit30-inspect-20261003T014100Z')
PIN=Path('/etc/proofofwork-postgres-logical-backup.pins');DEADLINE=time.monotonic()+360;LAST_BACKUP_CHECK=0;BACKUP_BEFORE=None

def need(v,m):
 if not v:raise ValueError(m)
def sha(b):return hashlib.sha256(b).hexdigest()
def encoded(v):return json.dumps(v,sort_keys=True,separators=(',',':')).encode()
def properties(name,fields):
 p=subprocess.run(['/usr/bin/systemctl','show',name,'--no-pager',*['--property='+k for k in fields]],stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=5,env={'PATH':'/usr/sbin:/usr/bin:/sbin:/bin','LC_ALL':'C'});need(p.returncode==0 and len(p.stdout)<=65536 and len(p.stderr)<=65536,'Backup status unavailable');d={}
 for line in p.stdout.decode().splitlines():
  k,sep,v=line.partition('=');need(sep and k not in d,'Malformed backup property');d[k]=v
 need(set(d)==set(fields),'Incomplete backup properties');return d
def quiet_backup(require_window=False):
 state=properties('proofofwork-postgres-logical-backup.service',('LoadState','ActiveState','SubState','MainPID','InvocationID'));need(state['LoadState']=='loaded'and state['ActiveState']=='inactive'and state['MainPID']=='0','Scheduled backup not quiet')
 if require_window:
  timer=properties('proofofwork-postgres-logical-backup.timer',('LoadState','ActiveState','NextElapseUSecRealtime'));need(timer['LoadState']=='loaded'and timer['ActiveState']=='active','Backup timer unavailable');next_=datetime.datetime.strptime(timer['NextElapseUSecRealtime'],'%a %Y-%m-%d %H:%M:%S %Z').replace(tzinfo=datetime.timezone.utc);need((next_-datetime.datetime.now(datetime.timezone.utc)).total_seconds()>420,'Backup clear window less than7min');state['timer']=timer
 return state
def checktime():
 global LAST_BACKUP_CHECK
 need(time.monotonic()<DEADLINE,'Readonly proof deadline')
 if time.monotonic()-LAST_BACKUP_CHECK>=5:quiet_backup();LAST_BACKUP_CHECK=time.monotonic()
def meta(p):
 s=p.lstat();kind='file'if stat.S_ISREG(s.st_mode)else'directory'if stat.S_ISDIR(s.st_mode)else'symlink'if stat.S_ISLNK(s.st_mode)else'other';x={n:sha(os.getxattr(p,n,follow_symlinks=False))for n in sorted(os.listxattr(p,follow_symlinks=False))};return {'path':str(p),'kind':kind,'device':s.st_dev,'inode':s.st_ino,'uid':s.st_uid,'gid':s.st_gid,'mode':oct(stat.S_IMODE(s.st_mode)),'nlink':s.st_nlink,'bytes':s.st_size,'allocatedBytes':s.st_blocks*512,'mtimeNs':s.st_mtime_ns,'ctimeNs':s.st_ctime_ns,'xattrSha256':x,'symlinkTarget':os.readlink(p)if kind=='symlink'else None}
def readhash(p,noatime=False,maxbytes=None):
 before=meta(p);need(before['kind']=='file'and before['nlink']==1 and p.resolve(strict=True)==p and not int(before['mode'],8)&0o022,'Unsafe proof member');need(maxbytes is None or before['bytes']<=maxbytes,'Member byte bound');fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW|(os.O_NOATIME if noatime else 0));h=hashlib.sha256();count=0
 with os.fdopen(fd,'rb')as f:
  while True:
   checktime();b=f.read(1024**2)
   if not b:break
   count+=len(b);need(count<=before['bytes'],'Member grew');h.update(b)
 need(count==before['bytes']and meta(p)==before,'Member identity changed');return before|{'sha256':h.hexdigest()}
def tree(p):
 records=[];pending=[p];count=0
 while pending:
  checktime();q=pending.pop();row=meta(q);need(q.resolve(strict=True)==q,'Unexpected tree alias');need(row['kind']in('file','directory'),'Unexpected tree type');records.append(row);count+=1;need(count<=30000,'Tree entry bound')
  if row['kind']=='directory':pending.extend(sorted(q.iterdir(),key=lambda x:os.fsencode(x.name),reverse=True))
 return sorted(records,key=lambda x:os.fsencode(x['path']))
def allocation(rows):return{'entries':len(rows),'regularFileBytes':sum(r['bytes']for r in rows if r['kind']=='file'),'allocatedBytes':sum(r['allocatedBytes']for r in rows),'sharedHardlinkFiles':[r['path']for r in rows if r['kind']=='file'and r['nlink']!=1]}
def main():
 global BACKUP_BEFORE
 need(sys.flags.isolated and len(sys.argv)==1 and os.geteuid()==pwd.getpwnam('postgres').pw_uid,'Native isolated postgres only');BACKUP_BEFORE=quiet_backup(True);before=meta(OLD);need(before['kind']=='directory'and OLD.resolve(strict=True)==OLD and before['uid']==108 and before['gid']==112 and before['mode']=='0o700'and before['nlink']==2,'Old exact directory authority');need(sorted(p.name for p in OLD.iterdir())==sorted(MEMBERS),'Old exact complete member set');files={}
 for n,(size,h)in MEMBERS.items():
  row=readhash(OLD/n,True);need(row['uid']==108 and row['gid']==112 and row['mode']=='0o600'and row['bytes']==size and row['sha256']==h,'Old exact byte/member proof');files[n]=row
 manifest=(OLD/'SHA256SUMS').read_bytes();need(manifest==(MEMBERS['proof_indexer.dump'][1]+'  proof_indexer.dump\n'+MEMBERS['globals.sql'][1]+'  globals.sql\n').encode(),'Exact named manifest');need(meta(OLD)==before and sorted(p.name for p in OLD.iterdir())==sorted(MEMBERS),'Old full tree changed');p=subprocess.run(['/usr/lib/postgresql/16/bin/pg_restore','--list',str(OLD/'proof_indexer.dump')],stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=min(45,max(1,DEADLINE-time.monotonic())),env={'PATH':'/usr/sbin:/usr/bin:/sbin:/bin','LC_ALL':'C'},cwd='/');need(p.returncode==0 and len(p.stdout)<=1024**2 and len(p.stderr)<=65536,'Old bounded dump catalogue');toc={'bytes':len(p.stdout),'sha256':sha(p.stdout),'entries':sum(bool(line.strip())and not line.startswith(b';')for line in p.stdout.splitlines()),'stderrBytes':len(p.stderr),'stderrSha256':sha(p.stderr),'restored':False};pin=readhash(PIN,False,4096);need(pin['uid']==0 and pin['gid']==0 and pin['mode']=='0o644','Pin authority');pinraw=PIN.read_bytes();need(len(pinraw)<=4096,'Pin byte bound');pinnedOld=OLD.name.encode()in pinraw.splitlines();jobs=[]
 for text in JOBS:
  job=Path(text);a=tree(job);b=tree(job);need(a==b,'Retained private job tree changed during census');cluster=[r for r in a if r['path']==str(job/'cluster')or r['path'].startswith(str(job/'cluster')+'/')];evidence=[r for r in a if r not in cluster];jobs.append({'path':text,'wholeJob':allocation(a),'cluster':allocation(cluster),'retainedEvidenceAndOther':allocation(evidence),'metadataRecordsSha256':sha(encoded(a)),'metadataRecords':a,'allClusterBytesHashVerifiedNow':False,'sourceStoppedControlAndReadersVerifiedHere':False,'deletionAuthorized':False})
 root=os.statvfs('/');data=os.statvfs('/data');print(json.dumps({'schema':'pow-audit30-old-backup-cluster-readonly-proof-v2','atUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'oldCandidate':{'directory':before,'members':files,'allocatedBytes':before['allocatedBytes']+sum(r['allocatedBytes']for r in files.values()),'fullMemberHashesReverified':True,'catalog':toc,'pinnedOldNow':pinnedOld},'pin':pin,'jobs':jobs,'rootAvailableBytes':root.f_bavail*root.f_frsize,'dataAvailableBytes':data.f_bavail*data.f_frsize,'backupStatusBefore':BACKUP_BEFORE,'backupStatusAfter':quiet_backup(),'backupLockAcquired':False,'backupTimerChanged':False,'productionMutation':False,'deletionAuthorized':False,'qualifications':['Old dump/manifest/global bytes and complete member metadata proved. Historical isolated restore acceptance remains separate preserved evidence; pg_restore --list is catalogue validation, not restore validation.','Three whole-job/cluster-only/evidence allocations are fenced full metadata censuses, not fresh full data hashing or proof of stopped/no-readers/recovery equivalence. No private job deletion admitted.','No lock was acquired or created; initial loaded/inactive/PID0 plus >7min scheduled clearwindow required and every5s status rechecked. A manual concurrent backup is detected with bounded polling latency, no lock-delay or scheduling claim. Hashing is read-only and unit IO/CPU capped. Pin is still protected; no pin change or child retirement admission inferred.']},sort_keys=True,separators=(',',':')))
if __name__=='__main__':
 try:main()
 except BaseException as ex:print(json.dumps({'schema':'pow-audit30-old-backup-cluster-readonly-refusal-v2','errorClass':type(ex).__name__,'reasonSha256':sha(str(ex).encode()),'productionMutation':False}),file=sys.stderr);raise SystemExit(1)
