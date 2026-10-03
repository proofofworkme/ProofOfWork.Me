#!/usr/bin/python3 -I
"""Fixed root-private math evidence allocation/custody; no content exported."""
import hashlib,json,os,signal,stat,sys,time
from pathlib import Path
ROOT=Path('/data/proofofwork-audit30-inspect-20261003T014100Z/stream-completion-v2/onhost-math-completion-v2')
PROOF='3d65f98e03aa341eed849d1506339ccd66af443d6fcf9cf33e794cd4073edcaf'
def enc(v):return json.dumps(v,sort_keys=True,separators=(',',':')).encode()
def meta(s):return dict(device=s.st_dev,inode=s.st_ino,uid=s.st_uid,gid=s.st_gid,mode=stat.S_IMODE(s.st_mode),nlink=s.st_nlink,bytes=s.st_size,mtimeNs=s.st_mtime_ns,ctimeNs=s.st_ctime_ns,allocatedBytes=s.st_blocks*512)
def mounts():
 rows=[]
 for line in Path('/proc/self/mountinfo').read_text().splitlines():
  token=line.split()[4]
  if token==str(ROOT)or token.startswith(str(ROOT)+'/'):rows.append(token)
 return rows
def inventory():
 if ROOT.resolve(strict=True)!=ROOT or mounts():raise ValueError('Canonical unmounted root-private tree required')
 started=time.monotonic();rows=[];total=0;allocated=0;proof=None
 def walk(path,rel):
  nonlocal total,allocated,proof
  if time.monotonic()-started>45 or len(rows)>=256:raise ValueError('Bounded private math tree')
  s=path.lstat();m=meta(s)
  if path.resolve(strict=True)!=path or m['uid']!=0 or m['gid']!=0 or os.listxattr(path,follow_symlinks=False):raise ValueError('Private root identity or xattr drift')
  kind='directory' if stat.S_ISDIR(s.st_mode) else 'file' if stat.S_ISREG(s.st_mode) else None
  if kind is None or(kind=='directory'and m['mode']!=0o700)or(kind=='file'and(m['mode']not in(0o400,0o600)or m['nlink']!=1)):raise ValueError('Exact root-private no-alias custody')
  row=dict(path=rel,kind=kind,metadata=m);rows.append(row);allocated+=m['allocatedBytes']
  if kind=='directory':
   for name in sorted(os.listdir(path)):walk(path/name,name if rel=='.'else rel+'/'+name)
   if meta(path.lstat())!=m:raise ValueError('Directory changed during census')
  else:
   total+=m['bytes']
   if total>64*1024**2:raise ValueError('Private evidence hash byte cap')
   h=hashlib.sha256();fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NOATIME)
   with os.fdopen(fd,'rb')as f:
    if meta(os.fstat(f.fileno()))!=m:raise ValueError('Root evidence FD drift')
    count=0
    while b:=f.read(1024**2):
     count+=len(b);h.update(b)
     if count>m['bytes']or time.monotonic()-started>45:raise ValueError('Root evidence bounded read')
    if count!=m['bytes']or meta(os.fstat(f.fileno()))!=m or meta(path.lstat())!=m:raise ValueError('Root evidence changed during hash')
   row['sha256']=h.hexdigest()
   if rel=='completed.json':proof=row
 walk(ROOT,'.')
 if not proof or proof['sha256']!=PROOF or proof['metadata']['bytes']!=11774 or proof['metadata']['mode']!=0o600:raise ValueError('Same verified arithmetic completion required')
 if mounts():raise ValueError('Mount changed during census')
 return dict(path=str(ROOT),metadata=rows[0]['metadata'],entries=len(rows),regularBytes=total,allocatedBytes=allocated,treeSha256=hashlib.sha256(enc(rows)).hexdigest(),completedSha256=PROOF,completedMetadata=proof['metadata'],nestedMounts=0,noSymlinks=True,noHardlinkedFiles=True,noXattrs=True,rootPrivateOnly=True)
def main():
 if not sys.flags.isolated or(os.geteuid(),os.getegid())!=(0,0)or os.uname().nodename!='pow-bitcoin-01' or len(sys.argv)!=1:raise ValueError('Fixed root hash-only observer')
 signal.signal(signal.SIGALRM,lambda *_:(_ for _ in()).throw(RuntimeError('Math allocation census deadline')));signal.alarm(100)
 first=inventory();second=inventory()
 if first!=second:raise ValueError('Whole root-private evidence changed between censuses')
 signal.alarm(0)
 print(json.dumps(dict(schema='pow-audit30-private-sixteen-root-math-allocation-census-v1',status='passed',rootAccounting=first,wholeTreeHashAndIdentityCheckedTwice=True,unprivileged108TraversalDeniedByRoot700=True,privacyUnchanged=True,excludedFromBudget=False,productionMutation=False,rawPrivateDataExported=False,postgresStarted=False,sqlExecuted=False),sort_keys=True))
if __name__=='__main__':main()
