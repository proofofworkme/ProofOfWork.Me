#!/usr/bin/python3 -I
"""Fixed public operator/config supplement; hash-only results, no mutation."""
import datetime,hashlib,json,os,pathlib,re,resource,signal,stat,sys
P=pathlib.Path
NAMES=('api-observation-health','bitcoin-rpc-bridge-ready','node-release-exchange','node-release-health','node-release-publish','node-storage-health','postgres-logical-backup','postgres-logical-backup-state','postgres-logical-backup.pre-audit23-20260923','postgres-query-health','release-prune','retention-protection','storage-trend','summary-route-health')
PATHS=tuple('/usr/local/sbin/proofofwork-'+n for n in NAMES)+('/opt/proofofwork-api/deploy/Caddyfile','/opt/proofofwork-api/deploy/electrs-network.toml','/opt/proofofwork-api/deploy/mempool-log-rotation.override.yml')
OLD='/data/proofofwork-postgres-backups/logical/proof_indexer-20260929T031853Z.dumpset'
JOBS=('/data/proofofwork-audit30-restore-20261002T234651Z','/data/proofofwork-audit30-inspect-20261003T005512Z','/data/proofofwork-audit30-inspect-20261003T014100Z')
TOKENS=(OLD,OLD.rsplit('/',1)[-1],*(j+'/cluster' for j in JOBS),*JOBS)
RX=re.compile(b'|'.join(re.escape(t.encode()) for t in TOKENS))
def need(v):
 if not v:raise ValueError('FIXED_PUBLIC_SUPPLEMENT_REFUSED')
def sha(b):return hashlib.sha256(b).hexdigest()
def meta(s):return dict(device=s.st_dev,inode=s.st_ino,mode=stat.S_IMODE(s.st_mode),uid=s.st_uid,gid=s.st_gid,nlink=s.st_nlink,bytes=s.st_size,mtimeNs=s.st_mtime_ns,ctimeNs=s.st_ctime_ns)
def read(p):
 need(p.resolve(strict=True)==p and not os.listxattr(p,follow_symlinks=False));s=p.lstat();m=meta(s);need(stat.S_ISREG(s.st_mode) and s.st_uid in (0,1000) and s.st_nlink==1 and s.st_size<=4*1024**2 and not stat.S_IMODE(s.st_mode)&0o022)
 fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW|os.O_NOATIME)
 with os.fdopen(fd,'rb') as f:
  need(meta(os.fstat(f.fileno()))==m);raw=f.read(4*1024**2+1);need(meta(os.fstat(f.fileno()))==m)
 need(meta(p.lstat())==m and len(raw)==s.st_size);return raw,m
def main():
 need(sys.flags.isolated and len(sys.argv)==1 and os.geteuid()==os.getegid()==0 and os.uname().nodename=='pow-bitcoin-01');resource.setrlimit(resource.RLIMIT_AS,(128*1024**2,128*1024**2));resource.setrlimit(resource.RLIMIT_CPU,(10,10));signal.signal(signal.SIGALRM,lambda *_:(_ for _ in()).throw(TimeoutError()));signal.alarm(30)
 rows=[];total=0
 for name in PATHS:
  raw,m=read(P(name));total+=len(raw);need(total<=32*1024**2)
  rows.append(dict(path=name,metadata=m,sha256=sha(raw),targets=sorted(set(x[0].decode() for x in RX.finditer(raw))),matchingLineSha256=[sha(line) for line in raw.splitlines() if RX.search(line)]))
 signal.alarm(0);print(json.dumps(dict(schema='pow-audit30-fixed-public-retirement-supplement-v1',atUtc=datetime.datetime.now(datetime.timezone.utc).isoformat(),fixedFileCount=len(rows),consumedBytes=total,rows=rows,sourceContentExported=False,rpcCalls=0,sqlCalls=0,productionMutation=False,deletionAuthorized=False,universalDependencyCompleteness=False,qualification='Supplement for fourteen extensionless installed public operators and three explicit public deployment configurations skipped by the prior491-file scan. Exact token matches require semantic review; no-match does not cover dynamic paths, private metadata, historical contracts or future readers.'),sort_keys=True))
if __name__=='__main__':
 try:main()
 except BaseException as e:print(json.dumps(dict(status='refused',errorClass=type(e).__name__,rawDetailsSuppressed=True,productionMutation=False)),file=sys.stderr);raise SystemExit(1)
