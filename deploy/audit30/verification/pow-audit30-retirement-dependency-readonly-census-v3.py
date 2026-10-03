#!/usr/bin/python3 -I
"""Fixed bounded root process/unit/operator metadata pointers. No SQL or body/catalog export.
Matches are custody dependencies, never automatic retirement authority. No deletion/start/stop.
"""
import datetime,errno,hashlib,json,os,re,stat,subprocess,sys,time
from pathlib import Path
OLD='/data/proofofwork-postgres-backups/logical/proof_indexer-20260929T031853Z.dumpset'
JOBS=('/data/proofofwork-audit30-restore-20261002T234651Z','/data/proofofwork-audit30-inspect-20261003T005512Z','/data/proofofwork-audit30-inspect-20261003T014100Z')
TOKENS=[OLD,OLD.rsplit('/',1)[-1],*[j+'/cluster'for j in JOBS],*JOBS];PATTERN=re.compile(b'|'.join(re.escape(t.encode())for t in TOKENS))
UNITS=('proofofwork-audit30-logical-restore-20261002T234651Z.service','proofofwork-audit30-snapshot-inspect-20261003T005512Z.service','proofofwork-audit30-snapshot-inspect-20261003T014100Z.service')
ROOTS=('/etc/systemd/system','/etc/cron.d','/usr/local/sbin','/usr/local/bin')
EXTENSIONS={'.py','.sh','.mjs','.js','.ts','.sql','.md','.service','.timer','.socket','.mount','.conf'}
DOCS=('SOUL.md','README.md','PROOFOFWORK_IDS.md','PROOFOFWORK_DNS.md','MARKETPLACE.md','OP_RETURN_INFRASTRUCTURE.md','MAIL_ORGANIZATION.md','REPOSITORY_HYGIENE.md','AGENTS.md')
EXCLUDED_DIRS={'.git','node_modules','pg-dependencies','dist','build','public','assets','artifacts','.next','coverage'}
ROOT_PROGRESS=[];ACTIVE_ROOT=None
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

APP_ROOT=re.compile(r'/opt/proofofwork-api(?:-stage-[0-9a-f]{12}-20[0-9]{6}T[0-9]{6}Z)?\Z')
LIVE_SOURCE_UNITS=('proofofwork-api.service','proofofwork-indexer-worker.service')

def application_root(text):
 p=Path(text)
 if not p.is_absolute() or len(p.parts)<3:return None
 candidate=str(Path(*p.parts[:3]))
 if not APP_ROOT.fullmatch(candidate):return None
 if '-stage-'in candidate:
  stamp=candidate.rsplit('-',1)[1]
  need(datetime.datetime.strptime(stamp,'%Y%m%dT%H%M%SZ').strftime('%Y%m%dT%H%M%SZ')==stamp,'Calendar live source root')
 return Path(candidate)

def unit_properties(raw,fields):
 value={}
 for line in raw.decode().splitlines():
  key,sep,item=line.partition('=');need(sep and key not in value,'Malformed/duplicate fixed unit metadata');value[key]=item
 need(set(value)==set(fields),'Fixed unit metadata fields');return value

def runtime_applications():
 apps={Path('/opt/proofofwork-api')};bindings=[]
 for unit in LIVE_SOURCE_UNITS:
  tick();fields=('LoadState','ActiveState','SubState','MainPID','InvocationID')
  p=subprocess.run(['/usr/bin/systemctl','show',unit,'--no-pager',*['--property='+x for x in fields]],stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=5)
  need(p.returncode==0 and not p.stderr and len(p.stdout)<=65536,'Fixed live-source unit read')
  state=unit_properties(p.stdout,fields)
  need(set(state)==set(fields)and state['LoadState']=='loaded'and state['ActiveState']=='active'and state['SubState']=='running'and re.fullmatch('[1-9][0-9]*',state['MainPID'])and re.fullmatch('[0-9a-f]{32}',state['InvocationID']),'Loaded live-source identity')
  proc=Path('/proc')/state['MainPID'];cwd=os.readlink(proc/'cwd')
  with open(proc/'cmdline','rb')as f:argv=f.read(65537)
  need(len(argv)<=65536 and argv.endswith(b'\x00'),'Live-source argv metadata bound')
  candidates=[]
  for value in [cwd,*[x.decode('utf-8',errors='strict')for x in argv.split(b'\x00')if x]]:
   root=application_root(value)
   if root is not None:
    need(root.resolve(strict=True)==root and root.is_dir(),'Canonical live-source app root');apps.add(root);candidates.append(str(root))
  need(candidates,'No exact live application source pointer')
  bindings.append({'unit':unit,'properties':state,'cwdSha256':sha(cwd.encode()),'argvSha256':sha(argv),'applicationRoots':sorted(set(candidates))})
 return sorted(apps),bindings

def selected_roots(libraries,applications,historical=()):
 roots=[Path(x)for x in ROOTS]+[Path('/etc/crontab'),Path('/etc/proofofwork-postgres-logical-backup.pins')]+libraries;excluded=[]
 for app in applications:
  if app.is_symlink():roots.append(app);continue
  if not app.is_dir():excluded.append({'path':str(app),'reason':'application-root-not-directory'});continue
  names={'server','scripts','deploy',*DOCS}
  roots.extend(app/n for n in ('server','scripts','deploy',*DOCS))
  for child in sorted(app.iterdir(),key=lambda x:os.fsencode(x.name)):
   if child.name not in names:excluded.append({'path':str(child),'reason':'outside-fixed-application-public-source-scope'})
 for app in historical:
  if app not in applications:excluded.append({'path':str(app),'reason':'historical-staged-application-not-active-content-unscanned','metadata':meta(app)})
 return roots,excluded

def operator_scan():
 global COUNT,ACTIVE_ROOT
 active_apps,source_before=runtime_applications()
 roots,excluded_apps=selected_roots(sorted(Path('/usr/local/lib').glob('proofofwork*')),active_apps,sorted(Path('/opt').glob('proofofwork-api-stage-*')))
 files=[];links=[];skipped=[];errors=[];visited=set()
 for root in roots:
  ACTIVE_ROOT=str(root);bytes_before=CONSUMED;count_before=COUNT
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
    if p.name in EXCLUDED_DIRS:skipped.append({'path':str(p),'reason':'dependency-or-git-metadata-not-content-scanned'});continue
    try:pending.extend(sorted(p.iterdir(),key=lambda x:os.fsencode(x.name),reverse=True))
    except OSError as ex:errors.append({'path':str(p),'errno':ex.errno})
    continue
   # Root-owned reviewed plans remain metadata-only; never read embedded private bodies.
   if p.name=='reviewed-plan.json':skipped.append({'path':str(p),'metadata':s,'reason':'reviewed-plan-public-metadata-only-content-unscanned'});continue
   # Catalog/body/private role/credential evidence must never be read/exported.
   allowed=p.suffix in EXTENSIONS or p.name in('reviewed-plan.json','proofofwork-postgres-logical-backup.pins','crontab')
   if s['kind']!='file'or not allowed or p.name.startswith('globals')or 'catalog-private'in p.name or 'private-plan'in p.name:
    skipped.append({'path':str(p),'reason':'non-public-operator-content-not-read'});continue
   if s['bytes']>MAX_FILE:skipped.append({'path':str(p),'reason':'per-file-byte-bound','bytes':s['bytes']});continue
   try:b,a=read(p,MAX_FILE)
   except OSError as ex:errors.append({'path':str(p),'errno':ex.errno});continue
   hits=matched(b);files.append({'path':str(p),'metadata':a,'sha256':sha(b),'targets':hits,'matchingLineSha256':[sha(line)for line in b.splitlines()if PATTERN.search(line)],'classification':'protected-active-backup-pin'if str(p)=='/etc/proofofwork-postgres-logical-backup.pins'else'operator-or-source-reference-needs-semantic-review'if hits else'no-fixed-token-match'})
  ROOT_PROGRESS.append({'root':str(root),'entriesVisited':COUNT-count_before,'regularBytesConsumed':CONSUMED-bytes_before})
 ACTIVE_ROOT=None
 active_after,source_after=runtime_applications();need(active_after==active_apps and source_after==source_before,'Live-source roots changed during census')
 return{'rootProgress':ROOT_PROGRESS,'liveApplicationSourceBindings':source_before,'liveApplicationSourceBindingsUnchanged':True,'excludedApplicationChildren':excluded_apps,'bounds':{'cumulativeBytes':MAX_BYTES,'perFileBytes':MAX_FILE,'entries':MAX_ENTRIES,'seconds':75},'roots':[str(p)for p in roots],'entries':COUNT,'consumedBytes':CONSUMED,'regularFiles':files,'matchingSymlinkPointers':links,'skipped':skipped,'readErrors':errors,'universalDependencyCompleteness':False,'qualification':'Fixed installed operator/config roots and exact live API/worker application pointers plus canonical /opt/proofofwork-api only. Historical staged source trees are metadata-only exclusions, never no-reference proofs. Generated/frontend/artifact/dependency trees and reviewed-plan content excluded explicitly; dynamic path construction, unreadable/skipped sources, external schedulers, private metadata and historical recovery contracts need separate semantic closure. No blanket no-reference/removal claim.'}

def cluster_states():
 out=[]
 for job,unit in zip(JOBS,UNITS):
  tick();p=subprocess.run(['/usr/bin/systemctl','show',unit,'--no-pager','--property=LoadState','--property=ActiveState','--property=SubState','--property=MainPID','--property=InvocationID'],stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=5);need(p.returncode==0 and len(p.stdout)<=65536 and len(p.stderr)<=65536,'Private unit metadata bound');state=dict(line.split('=',1)for line in p.stdout.decode().splitlines());control=Path(job)/'cluster/global/pg_control';before=meta(control);p=subprocess.run(['/usr/lib/postgresql/16/bin/pg_controldata',job+'/cluster'],stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=5,env={'PATH':'/usr/sbin:/usr/bin:/sbin:/bin','LC_ALL':'C'});need(p.returncode==0 and len(p.stdout)<=65536 and len(p.stderr)<=65536 and meta(control)==before,'Private stopped control read');values=dict(line.split(':',1)for line in p.stdout.decode().splitlines()if ':'in line);wanted={k:values[k].strip()for k in('pg_control version number','Catalog version number','Database system identifier','Database cluster state','Data page checksum version')};out.append({'job':job,'unit':unit,'unitState':state,'controlMetadata':before,'controlFields':wanted,'postmasterPidExists':(Path(job)/'cluster/postmaster.pid').exists(),'stoppedAcceptedHere':False,'qualification':'Full process scan and exact prior failure/completion/config/backup/source-byte proof must be compared before any retirement; a missing unit alone is not stop proof.'})
 return out

def main():
 need(os.geteuid()==0 and sys.flags.isolated and len(sys.argv)==1 and os.uname().nodename=='pow-bitcoin-01','Fixed isolated root readonly census');print(json.dumps({'schema':'pow-audit30-retirement-dependency-readonly-census-v3','atUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'tokens':TOKENS,'processes':proc_scan(),'operators':operator_scan(),'privateClusterStates':cluster_states(),'productionMutation':False,'catalogOrBodyExport':False,'deletionAuthorized':False,'universalDependencyCompleteness':False},sort_keys=True,separators=(',',':')))
if __name__=='__main__':
 try:main()
 except BaseException as ex:print(json.dumps({'schema':'pow-audit30-retirement-dependency-readonly-refusal-v3','errorClass':type(ex).__name__,'reasonSha256':sha(str(ex).encode()),'completedRootProgress':ROOT_PROGRESS,'activeRoot':ACTIVE_ROOT,'consumedBytes':CONSUMED,'entryCount':COUNT,'productionMutation':False}),file=sys.stderr);raise SystemExit(1)
