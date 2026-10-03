#!/usr/bin/python3 -I
"""Fixed Oct3 logical-root metadata and public rotation classification only.
Never reads dump/globals contents, executes backup code, or creates/controls units.
Declared checksum hashes are not current content verification or restore proof.
"""
import base64,datetime,hashlib,json,os,re,resource,selectors,signal,stat,subprocess,sys,time,types
from pathlib import Path
M_SHA='ad03e5d02e10018fb7c5dd3c118a7ac876331cad240832c52e4838a4bea0ff2a';M_BYTES=24954
ROOT=Path('/data/proofofwork-postgres-backups/logical');OWNER=(108,112)
SCRIPT=Path('/usr/local/sbin/proofofwork-postgres-logical-backup');SCRIPT_SHA='4e5252ed8fcc8ce4ec863d6e027d429f146348f30be23d4eb5fe77cfd013a754'
OLD='proof_indexer-20260929T031853Z.dumpset';OCT2='proof_indexer-20261002T031851Z.dumpset'
NAMES=re.compile(r'proof_indexer-(\d{8}T\d{6}Z)\.dumpset\Z');MEMBERS={'SHA256SUMS','globals.sql','proof_indexer.dump'}
UNIT='proofofwork-audit30-oct2-full-read-20261003T093000Z.service';EVIDENCE=Path('/var/tmp/proofofwork-audit30-pin-promotion-20261003T093000Z-preflight')
JOURNAL_ARGV=['/usr/bin/journalctl','--unit=proofofwork-postgres-logical-backup.service','--since=2026-10-03 00:00:00 UTC','--until=2026-10-04 00:00:00 UTC','--lines=2049','--no-pager','--all','--output=json']
ENV={'PATH':'/usr/sbin:/usr/bin:/sbin:/bin','LC_ALL':'C'};DEADLINE=0
class CensusInterrupted(RuntimeError):pass

def need(v,m):
 if not v:raise ValueError(m)
def sha(b):return hashlib.sha256(b).hexdigest()
def pairs(rows):
 d={}
 for k,v in rows:need(k not in d,'Duplicate census JSON');d[k]=v
 return d
def meta(s):return dict(device=s.st_dev,inode=s.st_ino,uid=s.st_uid,gid=s.st_gid,mode=stat.S_IMODE(s.st_mode),nlink=s.st_nlink,bytes=s.st_size,mtimeNs=s.st_mtime_ns,ctimeNs=s.st_ctime_ns)
def tick():need(time.monotonic()<DEADLINE,'Fixed census90s deadline')
def info(p,owner,mode,directory=False):
 tick();s=p.lstat();need(p.resolve(strict=True)==p and (stat.S_ISDIR(s.st_mode)if directory else stat.S_ISREG(s.st_mode))and(s.st_uid,s.st_gid)==owner and stat.S_IMODE(s.st_mode)==mode and(s.st_nlink>=2 if directory else s.st_nlink==1)and not os.listxattr(p,follow_symlinks=False),'Canonical fixed input authority');return meta(s)
def manifest_read(p):
 m=info(p,OWNER,0o600);need(0<m['bytes']<=256,'Bounded checksum manifest');fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW|os.O_NOATIME)
 with os.fdopen(fd,'rb')as f:
  need(meta(os.fstat(f.fileno()))==m,'Manifest descriptor drift');raw=f.read(257);need(meta(os.fstat(f.fileno()))==m and not os.listxattr(f.fileno()),'Manifest read drift/xattrs')
 need(len(raw)==m['bytes']and info(p,OWNER,0o600)==m,'Manifest path drift');return raw,m

def manifest_value(raw):
 need(raw.endswith(b'\n')and len(raw.splitlines())==2,'Exact two manifest records');out={}
 for line in raw.splitlines():
  m=re.fullmatch(rb'([a-f0-9]{64})  (proof_indexer\.dump|globals\.sql)',line);need(m is not None,'Closed checksum member syntax');name=m[2].decode();need(name not in out,'Duplicate checksum member');out[name]=m[1].decode()
 need(set(out)==MEMBERS-{'SHA256SUMS'},'Exact declared checksum coverage');return out

def root_census():
 root=info(ROOT,OWNER,0o700,True);names=sorted(os.listdir(ROOT));need(len(names)<=64,'Logical-root entry cap');rows={};other=[]
 for name in names:
  tick();p=ROOT/name;m=NAMES.fullmatch(name)
  if m is None:
   s=p.lstat();need(not stat.S_ISLNK(s.st_mode)and s.st_dev==root['device'],'Root scratch alias refused');other.append({'name':name,'kind':'directory'if stat.S_ISDIR(s.st_mode)else'file'if stat.S_ISREG(s.st_mode)else'other','metadata':meta(s)});continue
  need(datetime.datetime.strptime(m[1],'%Y%m%dT%H%M%SZ').strftime('%Y%m%dT%H%M%SZ')==m[1],'Calendar completed-set name');d=info(p,OWNER,0o700,True);need(d['device']==root['device']and d['nlink']==2,'Same-volume flat completed set');children=sorted(os.listdir(p));need(set(children)==MEMBERS and len(children)==3,'Exact complete-set three members');members={}
  for child in children:
   mm=info(p/child,OWNER,0o600);need(mm['device']==root['device']and mm['bytes']>0,'Same-volume nonempty member');members[child]={'metadata':mm}
  raw,mm=manifest_read(p/'SHA256SUMS');need(mm==members['SHA256SUMS']['metadata'],'Manifest/member identity differs');declared=manifest_value(raw)
  for child,h in declared.items():members[child]['declaredSha256']=h
  members['SHA256SUMS']['sha256']=sha(raw)
  need(info(p,OWNER,0o700,True)==d and sorted(os.listdir(p))==children,'Completed-set endpoint drift');rows[name]={'path':str(p),'metadata':d,'members':members,'dumpAndGlobalsContentHashedNow':False,'restoreCatalogReadNow':False}
 need(info(ROOT,OWNER,0o700,True)==root and sorted(os.listdir(ROOT))==names,'Logical-root endpoint drift');need(rows,'No complete logical set found')
 return {'root':{'path':str(ROOT),'metadata':root},'completeSets':rows,'otherEntries':other,'otherEntryContentsRead':False,'latestCompleteByCalendarName':max(rows),'oldPinnedSetPresent':OLD in rows,'oct2SetPresent':OCT2 in rows,'selectionQualification':'Calendar basename order only; no completeness beyond exact three-member metadata and manifest syntax, content hash verification, pg_restore catalog or isolated restore equivalence.'}

def captured(argv,cap,timeout):
 tick();p=subprocess.Popen(argv,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,start_new_session=True,env=ENV,cwd='/');sel=selectors.DefaultSelector();streams={'stdout':bytearray(),'stderr':bytearray()};end=min(DEADLINE,time.monotonic()+timeout);old={}
 try:
  for f,n in((p.stdout,'stdout'),(p.stderr,'stderr')):os.set_blocking(f.fileno(),False);sel.register(f,selectors.EVENT_READ,n)
  while sel.get_map():
   need(time.monotonic()<end,'Fixed journal command absolute deadline')
   for k,_ in sel.select(min(.1,max(.001,end-time.monotonic()))):
    b=os.read(k.fd,65536)
    if not b:sel.unregister(k.fileobj);continue
    streams[k.data].extend(b);need(len(streams[k.data])<=(cap if k.data=='stdout'else 65536),'Fixed journal channel cap')
  code=p.wait(timeout=min(2,max(.001,end-time.monotonic())));return code,bytes(streams['stdout']),bytes(streams['stderr'])
 finally:
  # Cleanup cannot be interrupted while preserving the original refusal.
  for n in(signal.SIGINT,signal.SIGTERM,signal.SIGHUP,signal.SIGALRM):old[n]=signal.signal(n,signal.SIG_IGN)
  try:
   if p.poll()is None:
    try:os.killpg(p.pid,signal.SIGKILL)
    except ProcessLookupError:pass
   p.wait(timeout=5)
  finally:
   sel.close();p.stdout.close();p.stderr.close()
   for n,h in old.items():signal.signal(n,h)

def journal_classification(raw):
 lines=raw.splitlines();need(len(lines)<2049,'Oct3 journal entry selection may be truncated');actions=[];counts={};unrecognized=[]
 for line in lines:
  tick();v=json.loads(line,object_pairs_hook=pairs);need(isinstance(v,dict)and isinstance(v.get('MESSAGE'),str)and isinstance(v.get('__REALTIME_TIMESTAMP'),str)and re.fullmatch(r'[0-9]{1,20}',v['__REALTIME_TIMESTAMP']),'Closed journal record framing');msg=v['MESSAGE'];timestamp=int(v['__REALTIME_TIMESTAMP']);need(1790985600000000<=timestamp<1791072000000000,'Fixed Oct3 journal timestamp');inv=v.get('_SYSTEMD_INVOCATION_ID');need(inv is None or isinstance(inv,str)and re.fullmatch(r'[a-f0-9]{32}',inv),'Journal invocation shape')
  row={'atRealtimeUsec':timestamp,'invocationId':inv,'messageSha256':sha(msg.encode())};kind='other-message-hash-only'
  m=re.fullmatch(r'backup_retention_(kept|deleted) candidate=('+re.escape(str(ROOT))+r'/proof_indexer-[0-9]{8}T[0-9]{6}Z\.dumpset) bytes=([0-9]{1,16}) verified_sha256=true restore_catalog=true',msg)
  review=re.fullmatch(r'backup_retention_review candidate=('+re.escape(str(ROOT))+r'/proof_indexer-[0-9]{8}T[0-9]{6}Z\.dumpset) reason=(operator-pin-or-unavailable-policy|identity-changed|verification-failed(?: predicate=[A-Za-z0-9:._-]+ members=[^\r\n]{1,2048})?) action=preserve',msg)
  if m:
   kind='backup-retention-'+m[1];name=Path(m[2]).name;stamp=NAMES.fullmatch(name)[1];datetime.datetime.strptime(stamp,'%Y%m%dT%H%M%SZ');row|={'action':m[1],'candidate':m[2],'reportedBytes':int(m[3]),'journalReportsVerifiedSha256':True,'journalReportsRestoreCatalog':True};actions.append(row)
  elif review:
   kind='backup-retention-preserve';row|={'action':'preserve','candidate':review[1],'reasonClass':review[2].split(' ')[0]};actions.append(row)
  elif msg.startswith('backup_retention_'):
   kind='unrecognized-retention-message-hash-only';unrecognized.append(row)
  counts[kind]=counts.get(kind,0)+1
 return {'argv':JOURNAL_ARGV,'capturedJournalSha256':sha(raw),'capturedJournalBytes':len(raw),'records':len(lines),'maximumRecords':2048,'range':'2026-10-03T00:00:00Z through2026-10-04T00:00:00Z','recordLimitReached':False,'classifiedCounts':counts,'publicRotationActions':actions,'unrecognizedRetentionMessages':unrecognized,'rawJournalMessagesExported':False,'recognizedRetentionMessageCoverageCompleteWithinCapturedSelection':not unrecognized,'fullBackupJournalHistoryCertified':False,'qualification':'Bounded fixed-unit Oct3 journal selection; records may already be missing from journal retention. Reported checksums/catalog flags are historical action statements, not independent current content verification.'}

def load(r):
 need(isinstance(r,dict)and set(r)=={'schema','managedSourceSha256','managedSourceBase64','expectedLive','expectedProtection'}and r['schema']=='pow-audit30-logical-backup-rotation-readonly-request-v1'and r['managedSourceSha256']==M_SHA,'Closed fixed inert source request');b=base64.b64decode(r['managedSourceBase64'],validate=True);need(len(b)==M_BYTES and sha(b)==M_SHA,'Exact managed public definitions');m=types.ModuleType('frozen-ad03-inert');m.__file__='raw-pinned-ad03-inert';exec(compile(b,m.__file__,'exec'),m.__dict__)
 need(isinstance(r['expectedLive'],dict)and set(r['expectedLive'])==set(m.LIVE),'Closed original five')
 for row in r['expectedLive'].values():need(isinstance(row,dict)and set(row)=={'LoadState','ActiveState','SubState','MainPID','InvocationID'}and all(isinstance(v,str)for v in row.values()),'Exact original five fields')
 ep=r['expectedProtection'];need(isinstance(ep,dict)and set(ep)=={'files','mask','units'}and isinstance(ep['files'],dict)and set(ep['files'])==set(map(str,m.STATIC))and isinstance(ep['units'],dict)and set(ep['units'])==set(m.PROTECTED),'Closed old protection paths/units')
 for name,row in ep['units'].items():need(isinstance(row,dict)and set(row)==set(m.PROTECTED_FIELDS_BY_UNIT[name])and all(isinstance(v,str)for v in row.values()),'Exact old protection unit profile')
 return m

def missing_oct2():
 p=ROOT/OCT2
 try:s=p.lstat()
 except FileNotFoundError as e:
  need(e.errno==2 and e.filename==str(p),'Fixed Oct2 absence framing');return {'path':str(p),'exists':False,'errorClass':'FileNotFoundError','errno':2,'reasonSha256':sha(str(e).encode())}
 return {'path':str(p),'exists':True,'metadata':meta(s)}

def audit_endpoint(m):
 unit=m.show(UNIT,('LoadState','ActiveState','SubState','MainPID','InvocationID'));evidence={'path':str(EVIDENCE),'exists':os.path.lexists(EVIDENCE)}
 if evidence['exists']:
  es=EVIDENCE.lstat();need(EVIDENCE.resolve(strict=True)==EVIDENCE and stat.S_ISDIR(es.st_mode)and es.st_uid==es.st_gid==0 and stat.S_IMODE(es.st_mode)==0o700,'Known evidence directory authority');names=sorted(os.listdir(EVIDENCE));need(len(names)<=8,'Known evidence child cap');evidence|={'metadata':meta(es),'children':[{'name':n,'metadata':meta((EVIDENCE/n).lstat())}for n in names]}
 evidence['fixedPaths']={name:{'path':str(EVIDENCE/name),'exists':os.path.lexists(EVIDENCE/name)}for name in ('intent.json','full-read.json','stderr.log','completed.json','failed.json')}
 return {'unit':UNIT,'properties':unit,'evidence':evidence}

def chosen_protection(m,r):
 expected=json.loads(json.dumps(r['expectedProtection']));mon='proofofwork-retention-protection.service';current=m.show(mon,m.PROTECTED_FIELDS_BY_UNIT[mon]);need(set(current)==set(m.PROTECTED_FIELDS_BY_UNIT[mon])and all(isinstance(v,str)for v in current.values())and current['LoadState']=='loaded'and current['MainPID']=='0'and(current['ActiveState'],current['SubState'])in(('inactive','dead'),('failed','failed'))and current['UnitFileState']==expected['units'][mon]['UnitFileState']=='static'and(current['InvocationID']==''or re.fullmatch('[a-f0-9]{32}',current['InvocationID'])),'Fresh idle static monitor role');expected['units'][mon]=current;protected=m.protection(expected)
 return expected,protected

def collect(m,r):
 before=m.live();need(before==r['expectedLive'],'Expected five drift');window=m.quiet();expected,protected=chosen_protection(m,r);script,sm=m.read_file(SCRIPT,32768);need(sha(script)==SCRIPT_SHA,'Installed backup script exact authority');tree=root_census();oct2=missing_oct2();need(oct2['exists']==tree['oct2SetPresent'],'Oct2 absence/census disagreement');endpoint=audit_endpoint(m)
 code,raw,err=captured(JOURNAL_ARGV,4*1024**2,20);need(code==0 and not err,'Fixed journal read refusal');journal=journal_classification(raw);script2,sm2=m.read_file(SCRIPT,32768);need(script2==script and sm2==sm,'Installed backup script endpoint drift');need(root_census()==tree,'Full logical metadata census endpoint drift');need(m.live()==before and m.quiet()==window and m.protection(expected)==protected,'Five/window/protection endpoint drift');need(audit_endpoint(m)==endpoint and missing_oct2()==oct2,'Oct2 absence/unit/evidence endpoint drift')
 return {'schema':'pow-audit30-logical-backup-rotation-readonly-v1','atUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'logicalRoot':tree,'installedBackupScript':{'path':str(SCRIPT),'sha256':SCRIPT_SHA,'metadata':sm},'oct2AttemptEndpoint':endpoint,'oct2PathEndpoint':oct2,'protection':protected,'monitorOperationalBaselineObservedAtChosenAction':True,'oct3Journal':journal,'live':before,'backupWindow':window,'protectedBeforeAfterEqual':True,'metadataBeforeAfterEqual':True,'productionMutation':False,'unitCreationOrControlPerformed':False,'sqlExecuted':False,'backupLockAcquired':False,'dumpOrGlobalsContentsRead':False,'currentDumpContentVerified':False,'isolatedLatestRestoreVerified':False,'pinOrCheckerChanged':False,'deletionAuthorized':False,'automaticRetry':False,'qualification':'Current fixed logical-root metadata/declared checksums plus retained public rotation statements only. Missing Oct2 invalidates its prospective promotion. Preserve Sep29 pin and all audit source/clones; this read neither approves a latest replacement nor proves current fullhash/TOC/restore equivalence.'}

def main():
 global DEADLINE
 need(os.geteuid()==os.getegid()==0 and sys.flags.isolated and len(sys.argv)==1 and os.uname().nodename=='pow-bitcoin-01','Fixed isolated root census role');resource.setrlimit(resource.RLIMIT_AS,(128*1024**2,128*1024**2));resource.setrlimit(resource.RLIMIT_CPU,(30,30));DEADLINE=time.monotonic()+90;old={}
 def interrupted(n,f):raise CensusInterrupted('Fixed90s census deadline/signal')
 for n in(signal.SIGINT,signal.SIGTERM,signal.SIGHUP,signal.SIGALRM):old[n]=signal.signal(n,interrupted)
 signal.setitimer(signal.ITIMER_REAL,90)
 try:
  raw=sys.stdin.buffer.read(65537);need(len(raw)<=65536,'Census typed byte cap');r=json.loads(raw,object_pairs_hook=pairs);m=load(r);m.DEADLINE=DEADLINE;result=json.dumps(collect(m,r),sort_keys=True,separators=(',',':'));need(len(result.encode())<=65536,'Closed public result64KiB cap');print(result)
 finally:
  signal.setitimer(signal.ITIMER_REAL,0)
  for n,h in old.items():signal.signal(n,h)
if __name__=='__main__':
 try:main()
 except BaseException as e:print(json.dumps({'schema':'pow-audit30-logical-backup-rotation-readonly-refused-v1','errorClass':type(e).__name__,'reasonSha256':sha(str(e).encode()),'productionMutation':False,'automaticRetry':False}),file=sys.stderr);raise SystemExit(1)
