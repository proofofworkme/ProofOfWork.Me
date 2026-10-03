#!/usr/bin/python3 -I
"""Fixed public summary of accepted082700 custody proofs; no fullhash/census.
No SQL, unit control, private contents, deletion, pin/config or automatic retry.
"""
import base64,datetime as dt,hashlib,json,os,re,signal,stat,sys,time,types
from pathlib import Path
E=Path('/var/tmp/proofofwork-audit30-retirement-custody-20261003T082700Z')
PACKAGE=Path('/usr/local/lib/proofofwork-audit30-retirement-closure/20261003T082700Z')
UNIT='proofofwork-audit30-retirement-content-20261003T082700Z.service'
CODE_SHA='55ab227a919da3a5e33072089297bf4ed86431d9a23bd3187646d0e7af21433d'
FILES={'completed.json':(614473,'bc3416f7abaed292cbda884a88c20e4d1221e1482d08397f997c7fc6ddf6ed63'),'root-before.json':(1476931,'ec5b3b8b713c6ae91abd5b160991cd3a6de66998b395a77431ab500de67126cb'),'content.json':(1156455,'e52fd70644f9a517c79f5d4c06621284d16026a3f1f7751e0a386d21c9b6d0aa'),'root-after.json':(1476931,'e5716d917950b17125a922a127e1f677b36632dea49ba48ad97369a3d83f4d42'),'content-plan.json':(1805,'3760f0278bbfc57316db547a8539ee072c3dacbd3463d0e1d50e92b592b576d9')}
class Refused(RuntimeError):pass
def need(v,s):
 if not v:raise Refused(s)
def sha(b):return hashlib.sha256(b).hexdigest()
def enc(v):return json.dumps(v,sort_keys=True,separators=(',',':')).encode()
def ident(s):return(s.st_dev,s.st_ino,s.st_mode,s.st_uid,s.st_gid,s.st_nlink,s.st_size,s.st_mtime_ns,s.st_ctime_ns)
def metadata(s):return dict(device=s.st_dev,inode=s.st_ino,mode=stat.S_IMODE(s.st_mode),uid=s.st_uid,gid=s.st_gid,nlink=s.st_nlink,bytes=s.st_size,mtimeNs=s.st_mtime_ns,ctimeNs=s.st_ctime_ns)
def read(p,n,h,gid=0,mode=0o600):
 s=p.lstat();need(p.resolve()==p and stat.S_ISREG(s.st_mode)and(s.st_uid,s.st_gid,stat.S_IMODE(s.st_mode),s.st_nlink,s.st_size)==(0,gid,mode,1,n)and not os.listxattr(p,follow_symlinks=False),'Exact root proof/code authority')
 fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW|os.O_NOATIME)
 with os.fdopen(fd,'rb')as f:need(ident(os.fstat(f.fileno()))==ident(s),'FD identity');b=f.read(n+1);need(ident(os.fstat(f.fileno()))==ident(s),'FD drift')
 need(ident(p.lstat())==ident(s)and len(b)==n and sha(b)==h,'Bound raw bytes/metadata drift');return b,metadata(s)
def pairs(v):
 d={}
 for k,x in v:need(k not in d,'Duplicate key');d[k]=x
 return d
def parse(b):return json.loads(b,object_pairs_hook=pairs)
def summarize(v,C):
 done,before,content,after,plan=(v[n]for n in('completed.json','root-before.json','content.json','root-after.json','content-plan.json'))
 need(done['schema']=='pow-audit30-retirement-closure-native-outcome-v1'and done['status']=='passed'and done['failure']is None and done['cleanup']['verified']is True and all(done[k]is False for k in('productionMutation','pinChanged','deletionAuthorized','autoRetry')),'Actual completed custody status')
 r=done['result'];need(r['endpointsEqual']is True and r['custodyOnly']is True and all(r[k]is False for k in('deletionReady','continuousReadersExcluded','recoveryEquivalenceProven','allDependenciesClosed')),'Custody-only scope')
 need(before['schema']==after['schema']=='pow-audit30-retirement-root-custody-census-v1'and content['schema']=='pow-audit30-retirement-content-custody-v1','Exact proof schemas')
 need(content['rootBeforeSha256']==FILES['root-before.json'][1]and content['planSha256']==FILES['content-plan.json'][1]and plan['rootBeforeSha256']==FILES['root-before.json'][1]and plan['unit']==UNIT,'Raw plan lineage')
 for key in('targets','retainedNonClusterEvidence','privateControls','liveFive'):need(before[key]==after[key],'Endpoint evidence/metadata drift')
 need([t['path']for t in before['targets']]==[t['path']for t in content['targets']]==list(C.TARGETS),'Exact ordered four targets')
 targets=[]
 for b,c in zip(before['targets'],content['targets']):
  rows=b['records'];a=C.allocation(rows);files={x['path']:x for x in rows if x['kind']=='file'};hashes=c['fullFileHashes'];need(b['metadataSha256']==c['metadataSha256']==sha(enc(rows)) and all(b[k]==c[k]==a[k]for k in a)and c['allRegularBytesHashed']is True and len(hashes)==len(files)and{h['path']for h in hashes}==set(files)and len({h['path']for h in hashes})==len(hashes),'Full file/hash/counter coverage')
  need(c['fullFileHashesSha256']==sha(enc(hashes))and all(re.fullmatch('[a-f0-9]{64}',h['sha256'])and h['metadataSha256']==sha(enc(files[h['path']]))for h in hashes),'Hash vector lineage')
  targets.append(dict(path=b['path'],entries=a['entries'],regularFileCount=len(files),logicalRegularBytes=a['regularBytes'],allocatedBytes=a['allocatedBytes'],metadataSha256=b['metadataSha256'],fullFileHashesSha256=c['fullFileHashesSha256'],allRegularBytesHashed=True))
 old=content['targets'][-1]['fullFileHashes'];need({Path(x['path']).name:x['sha256']for x in old}=={k:x[1]for k,x in C.MEMBERS.items()},'Exact Sep29 hashes')
 targets[-1]['exactMembers']=[dict(name=k,bytes=n,sha256=h)for k,(n,h)in C.MEMBERS.items()]
 retained=[]
 for row in before['retainedNonClusterEvidence']:
  need(row['allThesePathsMustSurviveAnyClusterOnlyRetirement']is True and row['metadataRecordsSha256']==sha(enc(row['metadataRecords']))and row['fullFileHashesSha256']==sha(enc(row['fullFileHashes'])),'Retained evidence lineage')
  retained.append({k:row[k]for k in('jobRoot','excludedDeletionCandidate','entries','regularBytes','allocatedBytes','metadataRecordsSha256','fullFileHashesSha256','allThesePathsMustSurviveAnyClusterOnlyRetirement')})
 reader_counts=[]
 for row in(before,after):
  p=row['processReaders'];need(p['matches']==[]and p['completeForObservedLiveProcesses']is True,'Stored endpoint reader refusal')
  reader_counts.append({k:p[k]for k in('processes','fdEntries','metadataBytes','mountNamespaces','vanishedProcesses','fdCloseRaces','qualifiedKernelThreads','completeForObservedLiveProcesses','qualification')})
 need(all(r['source7'][k]is True for k in('completeRelativePathsEqual','fullFileBytesEqual','metadataEqual','sourceNeverStartedByThisTool'))and r['source7']['sourceSHA256']=='f30301ca4f4769cfbbd995dc7627580be543e6cddfc1f5b3ff4aba033a48f572','Exact sealed source7 equality')
 return dict(targets=targets,totalTargetAllocatedBytes=sum(t['allocatedBytes']for t in targets),retainedNonClusterEvidence=retained,totalRetainedAllocatedBytes=sum(t['allocatedBytes']for t in retained),storedPrivateControls=before['privateControls'],storedEndpointReaderCounters=reader_counts,endpointsEqual=True,source7=r['source7'],storedLiveFive=before['liveFive'],storedCapacityBefore=before['capacity'],storedCapacityAtContentStop=content['capacity'],storedCapacityAfter=after['capacity'],actualResources=content['actualResources'],ownedInvocation=done['cleanup']['ownedInvocation'],storedOwnedStop=done['cleanup'])
def current(C,summary,raw_plan):
 five=C.live();need(five==summary['storedLiveFive'],'Current fresh-five differs');backup=C.quiet(False)
 timer=C.properties('proofofwork-postgres-logical-backup.timer',('LoadState','ActiveState','SubState','InvocationID','UnitFileState','NextElapseUSecRealtime'));need(timer['LoadState']=='loaded'and timer['ActiveState']=='active'and timer['SubState']=='waiting'and timer['UnitFileState']=='enabled','Current timer guard')
 state=C.properties(UNIT,('LoadState','ActiveState','SubState','MainPID','InvocationID','Type','Transient','User','Group','RemainAfterExit'));need(state['MainPID']=='0','Current managed reader still running')
 typed=None
 if state['LoadState']=='not-found':need(state['ActiveState']=='inactive'and state['SubState']=='dead'and not state['InvocationID'],'GC stopped shape')
 else:
  need(state['LoadState']=='loaded'and state['InvocationID']==summary['ownedInvocation']and state['ActiveState']in('inactive','failed')and state['Type']=='exec'and state['Transient']=='yes'and state['User']==state['Group']=='postgres'and state['RemainAfterExit']=='yes','Exact owned stopped reader')
  obj='/org/freedesktop/systemd1/unit/'+''.join(ch if ch.isascii()and ch.isalnum()else'_'+format(ord(ch),'02x')for ch in UNIT)
  o=parse(C.command(['/usr/bin/busctl','--system','--json=short','call','org.freedesktop.systemd1','/org/freedesktop/systemd1','org.freedesktop.systemd1.Manager','GetUnit','s',UNIT]));need(o=={'type':'o','data':[obj]},'Typed stopped object')
  x=parse(C.command(['/usr/bin/busctl','--system','--json=short','get-property','org.freedesktop.systemd1',obj,'org.freedesktop.systemd1.Service','ExecStart']));argv=['/usr/bin/python3','-I','-B',str(PACKAGE/'input-adapter.py'),base64.b64encode(raw_plan).decode(),FILES['content-plan.json'][1]];need(x['type']=='a(sasbttttuii)'and len(x['data'])==1 and x['data'][0][:3]==[argv[0],argv,False],'Typed owned stopped command');typed=dict(objectPath=obj,argvSha256=sha(enc(argv)))
 controls=C.controls();need(len(controls)==len(summary['storedPrivateControls'])==3,'Exact current three controls');
 for now,old in zip(controls,summary['storedPrivateControls']):
  need(all(now[k]==old[k]for k in('target','unit','controlMetadata','controlFields')),'Current stopped control bytes/identity differ')
  if now['properties']['LoadState']!='not-found':need(now['properties']['InvocationID']==old['properties']['InvocationID'],'Original private unit invocation drift')
 absences=[]
 for job in C.JOBS:
  paths=[Path(job)/'cluster/postmaster.pid',Path(job)/'socket/.s.PGSQL.55432',Path(job)/'socket/.s.PGSQL.55432.lock'];need(not any(os.path.lexists(p)for p in paths),'Private PID/socket endpoint remains');absences.append(dict(jobRoot=job,privatePidSocketAbsent=True))
 need(C.live()==five,'Five changed during reader');C.quiet(False)
 return dict(liveFive=five,backup=backup,timer=timer,currentOwnedUnit=state,currentOwnedCommand=typed,currentOwnedStopped=True,garbageCollectedUnitHistoricalResourcesNotReobserved=state['LoadState']=='not-found',currentPrivateControls=controls,privatePidSocketEndpoints=absences,capacity=C.capacity(),observationalOnly=True,continuousReadersExcluded=False)
def main():
 need(sys.flags.isolated and len(sys.argv)==1 and os.geteuid()==os.getegid()==0 and os.uname().nodename=='pow-bitcoin-01','Exact root read-only invocation')
 old={n:signal.getsignal(n)for n in(signal.SIGINT,signal.SIGTERM,signal.SIGHUP,signal.SIGALRM)}
 def interrupted(*_):raise Refused('Read-only deadline/signal')
 for n in old:signal.signal(n,interrupted)
 signal.alarm(90)
 try:
  code,cm=read(PACKAGE/'collector.py',26767,CODE_SHA,112,0o440);C=types.ModuleType('frozen55ab');C.__file__=str(PACKAGE/'collector.py');exec(compile(code,C.__file__,'exec'),C.__dict__);C.DEADLINE=time.monotonic()+90
  values={};bindings={};raw_plan=None
  for name,(n,h)in FILES.items():
   b,m=read(E/name,n,h);values[name]=parse(b);bindings[name]=dict(path=str(E/name),bytes=n,sha256=h,metadata=m)
   if name=='content-plan.json':raw_plan=b
  summary=summarize(values,C);fresh=current(C,summary,raw_plan)
  for name,row in bindings.items():need(metadata((E/name).lstat())==row['metadata'],'Final raw proof custody drift')
  need(metadata((PACKAGE/'collector.py').lstat())==cm,'Collector source metadata drift')
  print(json.dumps(dict(schema='pow-audit30-retirement-custody-public-summary-v1',status='passed',atUtc=dt.datetime.now(dt.timezone.utc).isoformat(),proofBindings=bindings,summary=summary,current=fresh,custodyOnly=True,deletionReady=False,allDependenciesClosed=False,recoveryEquivalenceProven=False,continuousReadersExcluded=False,newFullHashPerformed=False,fullCensusExported=False,sqlExecuted=False,productionMutation=False,pinChanged=False,automaticRetry=False),sort_keys=True))
 finally:
  signal.alarm(0)
  for n,h in old.items():signal.signal(n,h)
if __name__=='__main__':main()
