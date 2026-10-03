import datetime,fcntl,hashlib,json,os,pathlib,re,stat,subprocess,time
from pathlib import Path
EXPECTED={'bytes': 4096, 'ctimeNs': 1790998679134600840, 'device': 64514, 'gid': 112, 'inode': 7471122, 'mode': '0o700', 'mtimeNs': 1790998679132600841, 'nlink': 2, 'uid': 108, 'path': '/data/proofofwork-postgres-backups/logical/proof_indexer-20261003T031852Z.dumpset', 'directory': True, 'regular': False, 'symlink': False, 'dumpHashReverifiedNow': False, 'declaredMemberSha256': {'globals.sql': 'ae3c770e540348966326a1a0da0e2a003ec59918b3ca609de70f9ae302850bfa', 'proof_indexer.dump': '1fd052a6f4aa8b02faeb3c46a3ff186de224a37c276bdfbc780850e9696f08f6'}, 'manifestSha256': '303c15ad27e464abafe2561299d3f5470bc2efb2f873c03f3b924092a21f0683', 'members': [{'bytes': 20878072656, 'ctimeNs': 1790998653465605825, 'device': 64514, 'gid': 112, 'inode': 7471123, 'mode': '0o600', 'mtimeNs': 1790998653465605825, 'nlink': 1, 'uid': 108, 'path': '/data/proofofwork-postgres-backups/logical/proof_indexer-20261003T031852Z.dumpset/proof_indexer.dump', 'directory': False, 'regular': True, 'symlink': False}, {'bytes': 1137, 'ctimeNs': 1790998653636605791, 'device': 64514, 'gid': 112, 'inode': 7471124, 'mode': '0o600', 'mtimeNs': 1790998653636605791, 'nlink': 1, 'uid': 108, 'path': '/data/proofofwork-postgres-backups/logical/proof_indexer-20261003T031852Z.dumpset/globals.sql', 'directory': False, 'regular': True, 'symlink': False}, {'bytes': 163, 'ctimeNs': 1790998667126603136, 'device': 64514, 'gid': 112, 'inode': 7471151, 'mode': '0o600', 'mtimeNs': 1790998667126603136, 'nlink': 1, 'uid': 108, 'path': '/data/proofofwork-postgres-backups/logical/proof_indexer-20261003T031852Z.dumpset/SHA256SUMS', 'directory': False, 'regular': True, 'symlink': False}]}
LOCK_EXPECTED={'bytes': 0, 'ctimeNs': 1790997532936269129, 'device': 64514, 'gid': 112, 'inode': 7471419, 'mode': 384, 'mtimeNs': 1790997532936269129, 'nlink': 1, 'uid': 108}
def identity(p):
 s=Path(p).lstat();assert not stat.S_ISLNK(s.st_mode) and Path(p).resolve(strict=True)==Path(p) and not os.listxattr(p,follow_symlinks=False)
 return dict(device=s.st_dev,inode=s.st_ino,mode=stat.S_IMODE(s.st_mode),uid=s.st_uid,gid=s.st_gid,bytes=s.st_size,mtimeNs=s.st_mtime_ns,ctimeNs=s.st_ctime_ns,nlink=s.st_nlink)
def fd_identity(fd):
 s=os.fstat(fd);assert stat.S_ISREG(s.st_mode)
 return dict(device=s.st_dev,inode=s.st_ino,mode=stat.S_IMODE(s.st_mode),uid=s.st_uid,gid=s.st_gid,bytes=s.st_size,mtimeNs=s.st_mtime_ns,ctimeNs=s.st_ctime_ns,nlink=s.st_nlink)
def match(p,old):
 x=identity(p)
 for k in ('device','inode','uid','gid','bytes','mtimeNs','ctimeNs','nlink'):assert x[k]==old[k], 'backup identity changed'
 assert x['mode']==int(old['mode'],8)
 return x
root=Path(EXPECTED['path']);assert root.resolve()==root
assert os.geteuid()==108
match(root,EXPECTED)
lockpath=Path('/data/proofofwork-postgres-backups/logical/.proofofwork-postgres-logical-backup.lock')
assert identity(lockpath)==LOCK_EXPECTED
fd=os.open(lockpath,os.O_RDONLY|os.O_NOFOLLOW)
try:
 assert fd_identity(fd)==LOCK_EXPECTED
 fcntl.flock(fd,fcntl.LOCK_SH|fcntl.LOCK_NB)
 assert fd_identity(fd)==identity(lockpath)==LOCK_EXPECTED
 members={}
 rawglobals=None;rawchecks=None
 for old in EXPECTED['members']:
  p=Path(old['path']);assert p.resolve()==p and p.parent==root
  before=match(p,old);h=hashlib.sha256();total=0;chunks=[]
  f=os.open(p,os.O_RDONLY|os.O_NOFOLLOW|os.O_NOATIME)
  try:
   assert fd_identity(f)==before
   while b:=os.read(f,1024*1024):
    total+=len(b);assert total<=before['bytes'];h.update(b)
    if p.name!='proof_indexer.dump':chunks.append(b)
   assert total==before['bytes'] and fd_identity(f)==before and identity(p)==before
  finally:os.close(f)
  digest=h.hexdigest()
  if p.name in EXPECTED['declaredMemberSha256']:assert digest==EXPECTED['declaredMemberSha256'][p.name]
  else:assert digest==EXPECTED['manifestSha256']
  members[p.name]={**before,'sha256':digest}
  if p.name=='globals.sql':rawglobals=b''.join(chunks).decode()
  if p.name=='SHA256SUMS':rawchecks=b''.join(chunks).decode()
 toc=subprocess.run(['/usr/lib/postgresql/16/bin/pg_restore','--list',str(root/'proof_indexer.dump')],capture_output=True,check=True,timeout=180)
 assert not toc.stderr and len(toc.stdout)<1024*1024
 entries=sum(bool(re.match(rb'^\d+;',l)) for l in toc.stdout.splitlines())
 assert 0<entries<=10000
 counts={}
 for line in rawglobals.splitlines():
  line=line.strip()
  if not line or line.startswith('--'):continue
  if line.startswith('CREATE ROLE '):kind='CREATE ROLE'
  elif line.startswith('ALTER ROLE '):kind='ALTER ROLE'
  elif line.startswith('GRANT '):kind='GRANT'
  elif line.startswith('CREATE TABLESPACE '):kind='CREATE TABLESPACE'
  elif line.startswith('ALTER TABLESPACE '):kind='ALTER TABLESPACE'
  elif line.startswith('SET '):kind='SET'
  elif line.startswith('SELECT pg_catalog.set_config('):kind='SET_CONFIG'
  elif line.startswith('\\restrict '):kind='RESTRICT_CONTROL'
  elif line.startswith('\\unrestrict '):kind='UNRESTRICT_CONTROL'
  else:kind='OTHER_REFUSE_UNTIL_REVIEWED'
  counts[kind]=counts.get(kind,0)+1
 assert identity(root)==match(root,EXPECTED) and all(identity(root/name)=={k:v for k,v in row.items()if k!='sha256'}for name,row in members.items())
 assert fd_identity(fd)==identity(lockpath)==LOCK_EXPECTED
 out={'schema':'pow-audit30-latest-backup-full-read-v1','atUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'backup':{'path':str(root),'directory':identity(root),'members':members},'backupLock':identity(lockpath),'toc':{'sha256':hashlib.sha256(toc.stdout).hexdigest(),'bytes':len(toc.stdout),'entries':entries,'text':toc.stdout.decode()},'checksumManifest':rawchecks,'globalsStatementCategoryCounts':counts,'globalsContentsEmitted':False,'fullDumpHashReverified':True,'productionDataMutation':False,'qualification':'Exact Oct3 survivor member identities/all3 content hashes and first discovered full bounded TOC verified under the exact existing shared-lock FD/path fence, bounded read-only transient service; no prior Oct2 catalog/hash or restore equivalence borrowed. No SQL execution, credential values or globals statements emitted.'}
 print(json.dumps(out,sort_keys=True))
finally:os.close(fd)
