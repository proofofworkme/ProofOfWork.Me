#!/usr/bin/python3 -I
"""Fixed bounded root process/unit/operator metadata pointers. No SQL or body/catalog export.
Matches are custody dependencies, never automatic retirement authority. No deletion/start/stop.
"""
import datetime,errno,hashlib,json,os,re,stat,subprocess,sys,time
from pathlib import Path
OLD='/data/proofofwork-postgres-backups/logical/proof_indexer-20260929T031853Z.dumpset'
JOBS=('/data/proofofwork-audit30-restore-20261002T234651Z','/data/proofofwork-audit30-inspect-20261003T005512Z','/data/proofofwork-audit30-inspect-20261003T014100Z')
TOKENS=[OLD,OLD.rsplit('/',1)[-1],*[j+'/cluster'for j in JOBS],*JOBS];PATTERN=re.compile(b'|'.join(re.escape(t.encode())for t in TOKENS))
UNITS=('proofofwork-audit30-logical-restore-20261002T234651Z.service','proofofwork-audit30-inspect-20261003T005512Z.service','proofofwork-audit30-inspect-20261003T014100Z.service')
ROOTS=('/etc/systemd/system','/etc/cron.d','/usr/local/sbin','/usr/local/bin')
EXTENSIONS={'.py','.sh','.mjs','.js','.ts','.sql','.md','.service','.timer','.socket','.mount','.conf'}
DEADLINE=time.monotonic()+75;MAX_BYTES=192*1024**2;MAX_FILE=4*1024**2;MAX_ENTRIES=75000;CONSUMED=0;COUNT=0

def need(v,m):
 if not v:raise ValueError(m)
def sha(b):return hashlib.sha256(b).hexdigest()
def tick():need(time.monotonic()<DEADLINE,'Dependency census deadline')
def meta(p):
 s=p.lstat();return{'device':s.st_dev,'inode':s.st_ino,'mode':oct(stat.S_IMODE(s.st_mode)),'uid':s.st_uid,'gid':s.st_gid,'nlink':s.st_nlink,'bytes':s.st_size,'mtimeNs':s.st_mtime_ns,'ctimeNs':s.st_ctime_ns,'kind':'file'if stat.S_ISREG(s.st_mode)else'directory'if stat.S_ISDIR(s.st_mode)else'symlink'if stat.S_ISLNK(s.st_mode)else'other'}
def read(p,cap):
 global CONSUMED
 tick();a=meta(p);need(a['kind']=='file'and a['bytes']<=cap,'Bounded regular operator input');fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW|os.O_NOATIME)
 with os.fdopen(fd,'rb')as f:
  s=os.fstat(f.fileno());need((s.st_dev,s.st_ino,s.st_size)==(a['device'],a['inode'],a['bytes']),'Input FD changed');b=f.read(cap+1)
 need(len(b)<=cap and meta(p)==a,'Input read/path changed');CONSUMED+=len(b);need(CONSUMED<=MAX_BYTES,'Cumulative operator bytes');return b,a

def matched(raw):return sorted(set(m[0].decode()for m in PATTERN.finditer(raw)))
def proc_scan():
 rows=[];errors=[];disappeared=0;seen=0;fdcount=0
 for p in sorted(Path('/proc').iterdir(),key=lambda x:x.name):
  if not p.name.isdecimal():continue
  tick();seen+=1;need(seen<=10000,'Process count bound');pid=int(p.name)
  for label in('cwd','exe','root'):
   try:v=os.readlink(p/label)
   except FileNotFoundError:disappeared+=1;continue
   except OSError as ex:errors.append({'pid':pid,'surface':label,'errno':ex.errno});continue
   hits=matched(v.encode())
   if hits:rows.append({'pid':pid,'surface':label,'targets':hits,'pointerSha256':sha(v.encode())})
  try:fds=list((p/'fd').iterdir())
  except FileNotFoundError:disappeared+=1;fds=[]
  except OSError as ex:errors.append({'pid':pid,'surface':'fd','errno':ex.errno});fds=[]
  for fd in fds:
   tick();fdcount+=1;need(fdcount<=100000,'FD entry bound')
   try:v=os.readlink(fd)
   except FileNotFoundError:disappeared+=1;continue
   except OSError as ex:errors.append({'pid':pid,'surface':'fd/'+fd.name,'errno':ex.errno});continue
   hits=matched(v.encode())
   if hits:rows.append({'pid':pid,'surface':'fd/'+fd.name,'targets':hits,'pointerSha256':sha(v.encode())})
  for label in('cmdline','maps'):
   try:
    with open(p/label,'rb')as f:b=f.read(1024**2+1)
    need(len(b)<=1024**2,'Process metadata byte bound')
   except FileNotFoundError:disappeared+=1;continue
   except OSError as ex:errors.append({'pid':pid,'surface':label,'errno':ex.errno});continue
   hits=matched(b)
   if hits:rows.append({'pid':pid,'surface':label,'targets':hits,'contentSha256':sha(b)})
 return{'processes':seen,'fdEntries':fdcount,'matchingPointers':rows,'readErrors':errors,'disappearedSurfaces':disappeared,'scope':'No environ, memory, transaction body, private catalog or open-FD contents read.'}

def operator_scan():
 global COUNT
 roots=[Path(x)for x in ROOTS]+[Path('/etc/crontab'),Path('/etc/proofofwork-postgres-logical-backup.pins')]
 roots+=sorted(Path('/usr/local/lib').glob('proofofwork*'));roots+=sorted(Path('/opt').glob('proofofwork-api*'))
 files=[];links=[];skipped=[];errors=[];visited=set()
 for root in roots:
  if not root.exists()and not root.is_symlink():skipped.append({'path':str(root),'reason':'absent-root'});continue
  pending=[root]
  while pending:
   tick();p=pending.pop();s=meta(p);COUNT+=1;need(COUNT<=MAX_ENTRIES,'Operator entry count');key=(s['device'],s['inode'],s['kind'])
   if key in visited:continue
   visited.add(key)
   if s['kind']=='symlink':
    v=os.readlink(p);hits=matched(v.encode())
    if hits:links.append({'path':str(p),'metadata':s,'targets':hits,'pointerSha256':sha(v.encode())})
    continue
   if s['kind']=='directory':
    if p.name in('.git','node_modules','pg-dependencies','source')and str(p).startswith('/usr/local/lib/proofofwork-audit30-onhost-math'):
     skipped.append({'path':str(p),'reason':'pure-math-code-copy-not-recovery-input'});continue
    if p.name in('.git','node_modules','pg-dependencies'):skipped.append({'path':str(p),'reason':'dependency-or-git-metadata-not-content-scanned'});continue
    try:pending.extend(sorted(p.iterdir(),key=lambda x:os.fsencode(x.name),reverse=True))
    except OSError as ex:errors.append({'path':str(p),'errno':ex.errno})
    continue
   # Catalog/body/private role/credential evidence must never be read/exported.
   allowed=p.suffix in EXTENSIONS or p.name in('reviewed-plan.json','proofofwork-postgres-logical-backup.pins','crontab')
   if s['kind']!='file'or not allowed or p.name.startswith('globals')or 'catalog-private'in p.name or 'private-plan'in p.name:
    skipped.append({'path':str(p),'reason':'non-public-operator-content-not-read'});continue
   if s['bytes']>MAX_FILE:skipped.append({'path':str(p),'reason':'per-file-byte-bound','bytes':s['bytes']});continue
   try:b,a=read(p,MAX_FILE)
   except OSError as ex:errors.append({'path':str(p),'errno':ex.errno});continue
   hits=matched(b);files.append({'path':str(p),'metadata':a,'sha256':sha(b),'targets':hits,'matchingLineSha256':[sha(line)for line in b.splitlines()if PATTERN.search(line)],'classification':'protected-active-backup-pin'if str(p)=='/etc/proofofwork-postgres-logical-backup.pins'else'operator-or-source-reference-needs-semantic-review'if hits else'no-fixed-token-match'})
 return{'roots':[str(p)for p in roots],'entries':COUNT,'consumedBytes':CONSUMED,'regularFiles':files,'matchingSymlinkPointers':links,'skipped':skipped,'readErrors':errors,'universalDependencyCompleteness':False,'qualification':'Fixed installed operator/config/public source text scopes only; dynamic path construction, unreadable/skipped sources, external schedulers, private metadata and historical recovery contracts need separate semantic closure. No blanket no-reference/removal claim.'}

def cluster_states():
 out=[]
 for job,unit in zip(JOBS,UNITS):
  tick();p=subprocess.run(['/usr/bin/systemctl','show',unit,'--no-pager','--property=LoadState','--property=ActiveState','--property=SubState','--property=MainPID','--property=InvocationID'],stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=5);need(p.returncode==0 and len(p.stdout)<=65536 and len(p.stderr)<=65536,'Private unit metadata bound');state=dict(line.split('=',1)for line in p.stdout.decode().splitlines());control=Path(job)/'cluster/global/pg_control';before=meta(control);p=subprocess.run(['/usr/lib/postgresql/16/bin/pg_controldata',job+'/cluster'],stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=5,env={'PATH':'/usr/sbin:/usr/bin:/sbin:/bin','LC_ALL':'C'});need(p.returncode==0 and len(p.stdout)<=65536 and len(p.stderr)<=65536 and meta(control)==before,'Private stopped control read');values=dict(line.split(':',1)for line in p.stdout.decode().splitlines()if ':'in line);wanted={k:values[k].strip()for k in('pg_control version number','Catalog version number','Database system identifier','Database cluster state','Data page checksum version')};out.append({'job':job,'unit':unit,'unitState':state,'controlMetadata':before,'controlFields':wanted,'postmasterPidExists':(Path(job)/'cluster/postmaster.pid').exists(),'stoppedAcceptedHere':False,'qualification':'Full process scan and exact prior failure/completion/config/backup/source-byte proof must be compared before any retirement; a missing unit alone is not stop proof.'})
 return out

def main():
 need(os.geteuid()==0 and sys.flags.isolated and len(sys.argv)==1 and os.uname().nodename=='pow-bitcoin-01','Fixed isolated root readonly census');print(json.dumps({'schema':'pow-audit30-retirement-dependency-readonly-census-v1','atUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'tokens':TOKENS,'processes':proc_scan(),'operators':operator_scan(),'privateClusterStates':cluster_states(),'productionMutation':False,'catalogOrBodyExport':False,'deletionAuthorized':False,'universalDependencyCompleteness':False},sort_keys=True,separators=(',',':')))
if __name__=='__main__':
 try:main()
 except BaseException as ex:print(json.dumps({'schema':'pow-audit30-retirement-dependency-readonly-refusal-v1','errorClass':type(ex).__name__,'reasonSha256':sha(str(ex).encode()),'productionMutation':False}),file=sys.stderr);raise SystemExit(1)
