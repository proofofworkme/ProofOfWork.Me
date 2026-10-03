#!/usr/bin/python3 -I
"""Bounded read-only final inspector inputs. No SQL/service changes or files."""
import datetime as dt,hashlib,json,os,pwd,stat,subprocess,time
from pathlib import Path
SERVICES=('bitcoind.service', 'electrs.service', 'postgresql@16-main.service', 'proofofwork-api.service', 'proofofwork-indexer-worker.service')
LOCK=Path('/data/proofofwork-postgres-backups/logical/.proofofwork-postgres-logical-backup.lock')
NODE=Path('/opt/node-v24.18.0-linux-x64/bin/node')
def meta(p):
 s=Path(p).lstat();return dict(device=s.st_dev,inode=s.st_ino,mode=stat.S_IMODE(s.st_mode),uid=s.st_uid,gid=s.st_gid,bytes=s.st_size,mtimeNs=s.st_mtime_ns,ctimeNs=s.st_ctime_ns,nlink=s.st_nlink)
def properties(unit,names):
 r=subprocess.run(['/usr/bin/systemctl','show',unit,*sum([['-p',n] for n in names],[])],capture_output=True,text=True,timeout=10)
 if r.returncode or r.stderr or len(r.stdout)>65536:raise ValueError('Unit query refused')
 values={}
 for line in r.stdout.splitlines():
  k,v=line.split('=',1)
  if k in values:raise ValueError('Duplicate unit property')
  values[k]=v
 if set(values)!=set(names):raise ValueError('Missing unit property')
 return values
def main():
 if os.geteuid()!=0 or not __import__('sys').flags.isolated:raise ValueError('Root isolated read-only collector')
 started=time.monotonic();who=pwd.getpwnam('postgres');m=meta(LOCK)
 if LOCK.resolve(strict=True)!=LOCK or not stat.S_ISREG(LOCK.lstat().st_mode) or m['mode']!=0o600 or m['uid']!=who.pw_uid or m['gid']!=who.pw_gid or m['nlink']!=1:raise ValueError('Existing logical lock identity')
 live={}
 for name in SERVICES:
  row=properties(name,['LoadState','ActiveState','MainPID','InvocationID'])
  if row['LoadState']!='loaded' or row['ActiveState']!='active' or not row['MainPID'].isdigit() or int(row['MainPID'])<=0 or len(row['InvocationID'])!=32 or any(c not in '0123456789abcdef' for c in row['InvocationID']):raise ValueError('Live identity unavailable')
  live[name]={k:row[k] for k in ('MainPID','InvocationID')}
 backup=properties('proofofwork-postgres-logical-backup.service',['LoadState','ActiveState']);timer=properties('proofofwork-postgres-logical-backup.timer',['LoadState','ActiveState','NextElapseUSecRealtime'])
 if backup!={'LoadState':'loaded','ActiveState':'inactive'} or timer['LoadState']!='loaded' or timer['ActiveState']!='active':raise ValueError('Backup window unavailable')
 next_=dt.datetime.strptime(timer['NextElapseUSecRealtime'],'%a %Y-%m-%d %H:%M:%S %Z').replace(tzinfo=dt.timezone.utc)
 n=meta(NODE)
 if NODE.resolve(strict=True)!=NODE or not stat.S_ISREG(NODE.lstat().st_mode) or n['uid']!=0 or n['mode']!=0o755 or n['nlink']!=1 or n['bytes']>256*1024**2:raise ValueError('Existing Node authority')
 h=hashlib.sha256();fd=os.open(NODE,os.O_RDONLY|os.O_NOFOLLOW|os.O_NOATIME)
 with os.fdopen(fd,'rb') as f:
  s=os.fstat(f.fileno())
  if (s.st_dev,s.st_ino)!=(n['device'],n['inode']):raise ValueError('Node FD identity')
  while b:=f.read(1024**2):
   h.update(b)
   if time.monotonic()-started>120:raise TimeoutError('Read-only preflight deadline')
 if meta(NODE)!=n or meta(LOCK)!=m:raise ValueError('Input changed')
 for name,row in live.items():
  actual=properties(name,['MainPID','InvocationID'])
  if actual!=row:raise ValueError('Live service changed during collection')
 cap={}
 for p in ['/','/data']:
  v=os.statvfs(p);cap[p]=dict(availableBytes=v.f_bavail*v.f_frsize,availableInodes=v.f_favail)
 now=dt.datetime.now(dt.timezone.utc)
 if (next_-now).total_seconds()<75*60 or cap['/']['availableBytes']<10*1024**3 or cap['/data']['availableBytes']<180*1024**3:raise ValueError('75min/10GiB/180GiB preflight reserve refusal')
 print(json.dumps(dict(schema='pow-audit30-inspector-final-preflight-v1',host=os.uname().nodename,atUtc=now.isoformat(),backupLock=m,backupWindow=dict(preflightAtUtc=now.isoformat(),nextScheduledAtUtc=next_.isoformat()),liveServices=live,node=dict(metadata=n,sha256=h.hexdigest()),capacity=cap,productionMutation=False,seconds=time.monotonic()-started),sort_keys=True))
if __name__=='__main__':main()
