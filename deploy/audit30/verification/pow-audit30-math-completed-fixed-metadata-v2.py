#!/usr/bin/python3 -I
"""Fixed public completion custody only; no arithmetic or unit action."""
import hashlib,json,os,pathlib,stat,sys
p=pathlib.Path('/data/proofofwork-audit30-inspect-20261003T014100Z/stream-completion-v2/onhost-math-completion-v2/completed.json')
expected='3d65f98e03aa341eed849d1506339ccd66af443d6fcf9cf33e794cd4073edcaf'
def stamp(s):return dict(device=s.st_dev,inode=s.st_ino,mode=stat.S_IMODE(s.st_mode),uid=s.st_uid,gid=s.st_gid,bytes=s.st_size,mtimeNs=s.st_mtime_ns,ctimeNs=s.st_ctime_ns,nlink=s.st_nlink)
def need(v):
 if not v:raise ValueError('FIXED_PUBLIC_MATH_COMPLETION_CUSTODY')
need(sys.flags.isolated and os.geteuid()==os.getegid()==0 and os.uname().nodename=='pow-bitcoin-01')
need(p.resolve(strict=True)==p and not os.listxattr(p,follow_symlinks=False));s=p.lstat();m=stamp(s)
need(stat.S_ISREG(s.st_mode)and(s.st_uid,s.st_gid,stat.S_IMODE(s.st_mode),s.st_nlink,s.st_size)==(0,0,0o600,1,11774))
fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW|os.O_NOATIME)
with os.fdopen(fd,'rb')as f:
 need(stamp(os.fstat(f.fileno()))==m);raw=f.read(65537);need(stamp(os.fstat(f.fileno()))==m)
need(stamp(p.lstat())==m and hashlib.sha256(raw).hexdigest()==expected);v=json.loads(raw)
need(v.get('schema')=='pow-audit30-onhost-math-managed-completed-completion-v2'and v.get('status')=='passed'and v.get('cleanup',{}).get('verified')is True and v.get('privateClusterStillStopped')is True and v.get('privatePayloadExported')is False)
print(json.dumps(dict(schema='pow-audit30-fixed-public-math-completion-custody-v2',path=str(p),metadata=m,sha256=expected,bytes=len(raw),status=v['status'],actualCompletedBytesHashBound=True,unitOrDatabaseAction=False,privatePayloadExported=False),sort_keys=True))
