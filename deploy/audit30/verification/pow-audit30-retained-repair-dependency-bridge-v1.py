#!/usr/bin/python3 -I
"""Fixed definitions-only retained repair dependency compatibility observation.
No cluster/runtime/source-verification, SQL/Core, package or capture creation.
"""
import base64,datetime,hashlib,json,os,re,resource,signal,stat,subprocess,sys,time,types
from pathlib import Path
ROOT_SHA='b989a3f2395e7cbf13cb2d3dbd2d258a3fd21867131e41644c094772aba11168'
MANAGED_SHA='ad03e5d02e10018fb7c5dd3c118a7ac876331cad240832c52e4838a4bea0ff2a'
RETIRE_SHA='e35bd34050f4b0b36c9bfbe5b1461e901edd44ed13756cc9e3a2075e28fa2f50'
OLD=Path('/usr/local/lib/proofofwork-audit30-transition-stream/20261003T030000Z')
PRIVATE=Path('/usr/local/lib/proofofwork-audit30-private-sixteen/20261003T074500Z')
COMPLETE=Path('/usr/local/lib/proofofwork-audit30-stream-completion/20261003T064500Z')
JOB=Path('/data/proofofwork-audit30-inspect-20261003T014100Z')
D818=JOB/'exact-sixteen-readonly-finalization-v1/completed.json'
D818_SHA='d818545fa493f1032b3b6bfb7b1ba4b8738e3b15968c3f0ed949a0d1bb09bce8'
D818_META=dict(device=64514,inode=11142862,uid=108,gid=112,mode=0o600,nlink=1,bytes=7010,mtimeNs=1791015261650974438,ctimeNs=1791015261650974438)
NODE=Path('/opt/node-v24.18.0-linux-x64/bin/node')
OLD_FIVE={'bitcoind.service':('1324302','64e1fa7be2e2442d8c7f5763f60b85fb'),'electrs.service':('1324320','72418b1c7ab245e4a37685ed868a1084'),'postgresql@16-main.service':('1537429','e0bf545f0ad944e89fe1005577e61b9c'),'proofofwork-api.service':('2103747','208f8bcbecc54afbb7166754f12065c2'),'proofofwork-indexer-worker.service':('2103760','33b3ee25490749db89e0d55fd29d0afb')}
OLD_NAMES=('controller-v7.py','pow-audit30-saved-snapshot-inspect-v2.py','restore-latest-logical.py','pow-audit30-transition-stream-codec-v2.py','pow-audit30-transition-stream-native-v2.py','stopped-clone-inventory.json','sealed-logical-inventory.json','prior-clone-admission.json','pow-audit30-mail-body-repair-rehearsal-v2.mjs','original-transaction-engine.mjs','phase4-private-plan.json','phase4-pg-dependency-inventory.json','phase4-readiness-admission-v2.json')
FILES=set([str(PRIVATE/n)for n in('controller.py','restore-latest-logical.py')]+[str(COMPLETE/n)for n in('controller.py','restore-latest-logical.py','original-plan.json','sealed-logical-inventory.json')]+[str(OLD/n)for n in OLD_NAMES]+[str(JOB/'stream-completion-v2'/n)for n in('completed.json','intent.json')]+[str(D818),str(NODE)])
REPAIR_FILES=frozenset(FILES)
DEPENDENCIES=OLD/'pg-dependencies';DEADLINE=0;M=None
class BridgeInterrupted(RuntimeError):pass
def need(v,s):
 if not v:raise ValueError(s)
def sha(b):return hashlib.sha256(b).hexdigest()
def encoded(v):return json.dumps(v,sort_keys=True,separators=(',',':')).encode()
def pairs(rows):
 d={}
 for k,v in rows:need(k not in d,'DUPLICATE_TYPED_KEY');d[k]=v
 return d
def path_text(p):
 if isinstance(p,int):return None
 return os.path.abspath(os.fsdecode(p))
def cluster_path(p):
 text=path_text(p)
 return text is not None and any(text==str(Path(j)/kind)or text.startswith(str(Path(j)/kind)+'/')for j in('/data/proofofwork-audit30-restore-20261002T234651Z','/data/proofofwork-audit30-inspect-20261003T005512Z',str(JOB))for kind in('cluster','socket'))
def allowed_process(args):
 exe,argv,cwd,env=args;need(exe=='/usr/bin/systemctl'and isinstance(argv,list)and len(argv)>=5 and argv[:2]==['/usr/bin/systemctl','show']and argv[3]=='--no-pager'and cwd=='/'and env=={'PATH':'/usr/sbin:/usr/bin:/sbin:/bin','LC_ALL':'C'},'READONLY_FIXED_METADATA_CHILD_ONLY')
 unit=argv[2];fields=tuple(x.removeprefix('--property=')for x in argv[4:]);need(all(x.startswith('--property=')for x in argv[4:]),'FIXED_PROPERTY_ARGS')
 profiles={name:('LoadState','ActiveState','SubState','MainPID','InvocationID')for name in M.LIVE};profiles|=M.PROTECTED_FIELDS_BY_UNIT;profiles['proofofwork-postgres-logical-backup.service']=('LoadState','ActiveState','SubState','MainPID','InvocationID');profiles['proofofwork-postgres-logical-backup.timer']=('LoadState','ActiveState','SubState','UnitFileState','InvocationID','NextElapseUSecRealtime');need(unit in profiles and fields==profiles[unit],'READONLY_FIXED_UNIT_FIELDS')
def metadata_command(argv,cleanup=False):
 # Only the closed systemctl-show profiles above are allowed. Shield cleanup
 # from repeated ordinary signals and reap this exact owned child process.
 env={'PATH':'/usr/sbin:/usr/bin:/sbin:/bin','LC_ALL':'C'};allowed_process(('/usr/bin/systemctl',argv,'/',env));need(not cleanup and time.monotonic()<DEADLINE,'BRIDGE_METADATA_DEADLINE');p=None
 try:
  p=subprocess.Popen(argv,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,env=env,cwd='/',start_new_session=True);out,err=p.communicate(timeout=min(15,max(.01,DEADLINE-time.monotonic())));need(p.returncode==0 and len(out)<=131072 and len(err)<=131072,'FIXED_METADATA_COMMAND_REFUSED');return out
 except BaseException:
  old={s:signal.getsignal(s)for s in(signal.SIGALRM,signal.SIGINT,signal.SIGTERM,signal.SIGHUP)}
  for s in old:signal.signal(s,signal.SIG_IGN)
  try:
   if p is not None:
    if p.poll()is None:
     try:os.killpg(p.pid,signal.SIGKILL)
     except ProcessLookupError:pass
    p.wait(timeout=3)
  finally:
   for s,h in old.items():signal.signal(s,h)
  raise
 finally:
  if p is not None:
   for stream in(p.stdout,p.stderr):stream.close()
def audit(event,args):
 if event=='open':
  path,mode,flags=args;need(not cluster_path(path),'CLUSTER_OR_SOCKET_READ_FORBIDDEN');need(not(type(flags)is int and flags&(os.O_WRONLY|os.O_RDWR|os.O_CREAT|os.O_TRUNC|os.O_APPEND))and not(isinstance(mode,str)and any(x in mode for x in 'wax+')),'ANY_WRITE_OPEN_FORBIDDEN');text=path_text(path)
  if text is not None:
   standard=text.startswith('/usr/lib/python3.12/')or text.startswith('/usr/local/lib/python3.12/')or text in('/etc/passwd','/etc/group','/etc/nsswitch.conf','/dev/null')
   need(standard or text in FILES or text.startswith(str(DEPENDENCIES)+'/'),'FIXED_READ_PATH_ONLY')
 if event in('os.listdir','os.scandir'):need(not cluster_path(args[0])and(path_text(args[0])==str(DEPENDENCIES)or(path_text(args[0])or'').startswith(str(DEPENDENCIES)+'/')),'FIXED_DEPENDENCY_DIRECTORY_ONLY')
 if event=='subprocess.Popen':allowed_process(args)
 if event.startswith(('socket.','sqlite3.'))or event in('os.system','os.exec','os.spawn','os.posix_spawn','os.fork','os.remove','os.rmdir','os.mkdir','os.rename','os.link','os.symlink','os.chmod','os.chown','os.truncate','os.utime','os.setxattr','os.removexattr'):raise ValueError('FORBIDDEN_NONOBSERVATIONAL_OPERATION')
def stat_guard(original):
 def guarded(path,*a,**kw):need(not cluster_path(path),'CLUSTER_METADATA_FORBIDDEN');return original(path,*a,**kw)
 return guarded
def inert(raw,name,file):
 m=types.ModuleType(name);m.__file__=file;exec(compile(raw,file,'exec'),m.__dict__);return m
def validate_authority(v,m):
 live=v['expectedLive'];need(isinstance(live,dict)and set(live)==set(OLD_FIVE)==set(m.LIVE),'FRESH_ORIGINAL_FIVE_REQUIRED')
 for name,row in live.items():need(isinstance(row,dict)and set(row)=={'LoadState','ActiveState','SubState','MainPID','InvocationID'}and row['LoadState']=='loaded'and row['ActiveState']=='active'and row['SubState']=='running'and(row['MainPID'],row['InvocationID'])==OLD_FIVE[name],'ORIGINAL_FIVE_TYPED_IDENTITY')
 p=v['expectedProtection'];need(isinstance(p,dict)and set(p)=={'files','mask','units'}and isinstance(p['files'],dict)and set(p['files'])==set(map(str,m.STATIC))and isinstance(p['units'],dict)and set(p['units'])==set(m.PROTECTED),'FRESH_PROTECTION_REQUIRED')
 for name,row in p['files'].items():need(isinstance(row,dict)and set(row)=={'metadata','sha256'}and isinstance(row['metadata'],dict)and set(row['metadata'])==set(m.LOCK_EXPECTED)and all(type(n)is int and n>=0 for n in row['metadata'].values())and isinstance(row['sha256'],str)and re.fullmatch('[a-f0-9]{64}',row['sha256'])and(name not in m.FIXED_HASHES or row['sha256']==m.FIXED_HASHES[name]),'EXACT_PROTECTION_FILE')
 need(isinstance(p['mask'],dict)and set(p['mask'])=={'metadata','target'}and p['mask']['target']=='/dev/null'and isinstance(p['mask']['metadata'],dict)and set(p['mask']['metadata'])==set(m.LOCK_EXPECTED)and all(type(n)is int and n>=0 for n in p['mask']['metadata'].values()),'EXACT_ROOT_MASK')
 for name,row in p['units'].items():need(isinstance(row,dict)and set(row)==set(m.PROTECTED_FIELDS_BY_UNIT[name])and all(isinstance(x,str)for x in row.values()),'EXACT_PER_UNIT_FIELDS')
 need(v['backupLock']==m.LOCK_EXPECTED,'ORIGINAL_BACKUP_LOCK_REQUIRED')
def decode(raw):
 global M
 v=json.loads(raw,object_pairs_hook=pairs);keys={'schema','rootControlSha256','rootBase64','managedSha256','managedBase64','retirementSha256','retirementBase64','expectedLive','expectedProtection','backupLock'};need(isinstance(v,dict)and set(v)==keys and v['schema']=='pow-audit30-retained-repair-dependency-bridge-request-v1','CLOSED_FIXED_REQUEST')
 loaded=[]
 for name,pin,size in(('root',ROOT_SHA,22040),('managed',MANAGED_SHA,24954),('retirement',RETIRE_SHA,27456)):
  need(v[name+'ControlSha256'if name=='root'else name+'Sha256']==pin,'FIXED_SOURCE_SHA');b=base64.b64decode(v[name+'Base64'],validate=True);need(len(b)==size and sha(b)==pin,'EXACT_INERT_SOURCE_BYTES');loaded.append(b)
 root,managed,retired=loaded;M=inert(managed,'reviewed_ad03_metadata','/reviewed/ad03.py');validate_authority(v,M);R=inert(root,'reviewed_b989_root','/reviewed/root-v3.py');D=inert(retired,'reviewed_e35_contract','/reviewed/retire-v3.py');return v,R,D
def backup_lock(m):
 path=m.LOCK;s=path.lstat();need(path.resolve(strict=True)==path and stat.S_ISREG(s.st_mode)and m.metadata(s)==m.LOCK_EXPECTED and not os.listxattr(path,follow_symlinks=False),'UNCHANGED_BACKUP_LOCK');return m.metadata(s)
def observed_file(G,path,pin):
 p=Path(path);meta=G.metadata(p);need(p.resolve(strict=True)==p and stat.S_ISREG(p.lstat().st_mode)and meta['nlink']==1 and meta['uid']in(0,108)and not meta['mode']&0o022 and not os.listxattr(p,follow_symlinks=False),'FIXED_DEPENDENCY_CUSTODY');need(G.hash_file(p,meta|{'sha256':pin},256*1024**2,no_atime=False)==pin,'FIXED_DEPENDENCY_HASH');return {'path':str(p),'metadata':meta,'sha256':pin}
def context(R):
 m,original=R.dependency_context();I=m.I;manifest=I.verify_pg_dependencies(m.C.OLD,original['phase4']);need(manifest['entries']==172 and manifest['regularBytes']==443205 and all(r['metadata']['uid']==0 and r['metadata']['gid']==112 and r['metadata']['mode']==(0o440 if r['kind']=='file'else 0o750)for r in manifest['records']),'EXACT_INSTALLED_172_ROOT_OWNER_PROFILE')
 pins={PRIVATE/'controller.py':R.PRIVATE_SUPERVISOR_SHA,PRIVATE/'restore-latest-logical.py':m.GUARD_SHA,COMPLETE/'controller.py':m.COMPLETION_SHA,COMPLETE/'restore-latest-logical.py':m.GUARD_SHA,COMPLETE/'original-plan.json':m.C.OLD_PLAN_SHA,COMPLETE/'sealed-logical-inventory.json':m.C.PINS['sealed-logical-inventory.json'],OLD/'controller-v7.py':m.C.PINS['controller-v7.py'],**{OLD/n:h for n,h in m.S.PINS.items()},OLD/'stopped-clone-inventory.json':original['inventory']['sha256'],OLD/'sealed-logical-inventory.json':m.C.PINS['sealed-logical-inventory.json'],OLD/'prior-clone-admission.json':original['priorAdmission']['sha256'],OLD/m.S.PHASE4_ENGINE:m.S.PHASE4_ENGINE_SHA,OLD/'original-transaction-engine.mjs':m.S.ORIGINAL_ENGINE_SHA,OLD/'phase4-private-plan.json':original['phase4']['privatePlanSha256'],OLD/'phase4-pg-dependency-inventory.json':original['phase4']['dependencyInventorySha256'],OLD/'phase4-readiness-admission-v2.json':original['phase4']['readinessAdmissionSha256'],**{JOB/'stream-completion-v2'/n:h for n,h in m.COMPLETION_PINS.items()},D818:D818_SHA,NODE:R.NODE_SHA}
 need(set(map(str,pins))==REPAIR_FILES,'FIXED_DEPENDENCY_FILE_MEMBERSHIP');files=[observed_file(m.G,p,h)for p,h in sorted(pins.items(),key=lambda row:str(row[0]))];need(next(r['metadata']for r in files if r['path']==str(D818))==D818_META,'D818_EXACT_SAVED_METADATA');return {'entries':172,'regularBytes':443205,'pgEntrySha256':original['phase4']['pgEntrySha256'],'dependencyInventorySha256':original['phase4']['dependencyInventorySha256'],'installedManifestSha256':sha(encoded(manifest)),'members':manifest['records'],'files':files}
def compatibility(D,value):
 blocks=[];rows=value['files']+[{'path':str(DEPENDENCIES/r['path']),'metadata':r['metadata'],'sha256':r['sha256']}for r in value['members']if r['kind']=='file'];total=0
 for r in rows:
  try:
   cap,owners=D.dependency_contract(Path(r['path']),r);total+=r['metadata']['bytes'];reason='GENERIC_OWNER_REFUSED'if r['metadata']['uid']not in owners else'GENERIC_SIZE_REFUSED'if r['metadata']['bytes']>cap else None
  except ValueError:reason='KNOWN_DEPENDENCY_CONTRACT_REFUSED'
  if reason:blocks.append({'path':r['path'],'reason':reason,'metadata':r['metadata'],'sha256':r['sha256']})
 if total>192*1024**2:blocks.append({'path':None,'reason':'AGGREGATE192MIB_REFUSED','bytes':total})
 return {'testedFiles':len(rows),'uniqueLogicalBytes':total,'genericInstalled172OwnersCompatible':all(r['metadata']['uid']in(0,1000)for r in value['members']if r['kind']=='file'),'blocks':blocks,'fullRetirementDependencyAdmissionExecuted':False}
def main():
 global DEADLINE
 need(sys.flags.isolated and sys.dont_write_bytecode and os.geteuid()==os.getegid()==0 and os.uname().nodename=='pow-bitcoin-01'and len(sys.argv)==2 and re.fullmatch('[a-f0-9]{64}',sys.argv[1]),'FIXED_ROOT_ISOLATED_BRIDGE')
 def interrupted(*_):raise BridgeInterrupted('BRIDGE60_DEADLINE_OR_SIGNAL')
 for sig in(signal.SIGALRM,signal.SIGINT,signal.SIGTERM,signal.SIGHUP):signal.signal(sig,interrupted)
 signal.setitimer(signal.ITIMER_REAL,60);DEADLINE=time.monotonic()+60;resource.setrlimit(resource.RLIMIT_AS,(384*1024**2,384*1024**2));raw=sys.stdin.buffer.read(131073);need(len(raw)<=131072 and sha(raw)==sys.argv[1],'TYPED_STDIN_RAW_SHA');v,R,D=decode(raw);M.DEADLINE=DEADLINE
 FILES.update(map(str,M.STATIC));FILES.add(str(M.LOCK));sys.addaudithook(audit);os.stat=stat_guard(os.stat);os.lstat=stat_guard(os.lstat)
 M.command=metadata_command;before=M.live();need(before==v['expectedLive'],'ORIGINAL_FIVE_DRIFT');quiet=M.quiet();protected=M.protection(v['expectedProtection']);lock=backup_lock(M);a=context(R);b=context(R);need(a==b,'RETAINED_DEPENDENCY_ENDPOINT_DRIFT');need(M.live()==before and M.quiet()==quiet and M.protection(v['expectedProtection'])==protected and backup_lock(M)==lock,'ORIGINAL_METADATA_ENDPOINT_DRIFT');result={'schema':'pow-audit30-retained-repair-dependency-bridge-result-v1','status':'observed-fixed-retained-dependency-compatibility','atUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'requestSha256':sha(raw),'sourcePins':{'rootControlSha256':ROOT_SHA,'managedSha256':MANAGED_SHA,'retirementSha256':RETIRE_SHA},'dependency':a,'retirementContractCompatibility':compatibility(D,a),'originalFiveUnchanged':True,'backupLockUnchanged':True,'protectionUnchanged':True,'backupBeforeAfter':quiet,'sqlExecuted':False,'coreRequests':0,'clusterPathsRead':False,'privateCaptureExported':False,'creationPerformed':False,'productionMutation':False,'deletionAuthorized':False,'recoveryEquivalenceProven':False,'allUnknownOrSkippedDependenciesResolved':False,'allDependenciesClosed':False,'qualifications':['Exactly the named saved-code/proof path and original172 verifier. No Root.main/private runtime/previous/clone-stopped/sealed-source verifier or private PG activation.','Package/files observed twice; job-root or cluster membership is not frozen or certified. This is not a universal dependency scan or future exclusion guarantee.','Oct2 existence/retention/restore equivalence is outside this bridge; no survivor or retirement-ready claim. Three clusters, Sep29 pin and all evidence remain untouched.']};need(time.monotonic()<DEADLINE and len(encoded(result))<65536,'BRIDGE_RETURN_DEADLINE_OR_PUBLIC_CAP');signal.setitimer(signal.ITIMER_REAL,0);return result
if __name__=='__main__':
 try:v=main()
 except BaseException as e:print(json.dumps({'schema':'pow-audit30-retained-repair-dependency-bridge-refusal-v1','errorClass':type(e).__name__,'reasonSha256':sha(str(e).encode()),'productionMutation':False}),file=sys.stderr);raise SystemExit(1)
 print(json.dumps(v,sort_keys=True,separators=(',',':')))
