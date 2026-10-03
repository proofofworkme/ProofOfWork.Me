#!/usr/bin/env python3
"""One fixed fresh read-only mail projection plus original strict check severity observation."""
import contextlib,datetime,hashlib,io,json,os,pathlib,pwd,re,resource,signal,stat,subprocess,time
ROOT=pathlib.Path('/data/proofofwork-release-backups/audit30-node-release-38ac6e2bff2a-20261003T042000Z');CWD=pathlib.Path('/opt/proofofwork-api-stage-38ac6e2bff2a-20261003T042000Z');TOOLS=pathlib.Path('/var/tmp/proofofwork-deploy/audit29-tools');OUT=pathlib.Path('/data/proofofwork-audit29-verify-output-38ac6e2bff2a-20261003T042000Z-shadow-strict-v1/attempt/receipt.json')
B3='b3c71c2a48ffb59a297c0fa7264fd417b498b0464d34577859c6bb0ee17fb1c9';VERIFY='8a569828272b10abc8848dd01678a1a3b45002acd489802f89b6e056de3e0c1e';PRIVATE='99cbe9cd118c63b08480efd28c2ae7c059b5204daef8db08b896a38fc791d515';NODE='/opt/node-v24.18.0-linux-x64/bin/node';NODE_SHA='41a74efb34cbde5c7632cdac0cf8bd1a14d0b8d73dc1e82755014d9a9ce70f5c';MANIFEST=pathlib.Path('/data/proofofwork-release-backups/audit30-mail-body-census-20261003T011506Z/proposed-body-only-manifest.json');MANIFEST_SHA='8d5d347aea2d398d75e69631f90b3efdd1c3254cfdbf3864015199b078699c50';ENV_SHA='327427c12f187d5b200a9a2323025bd659688e72c3e10faac24545fc514fdb5c';SAVED_SHA='52e0b8b20d939e07f13bd2f1d90be0d8655f11176a0ddce7e57eb1549f8c427c'
FAIL_NAMES={'work-amo-v5-migration','work-amo-v5-usd-quote-head','rendered-mail-projection-semantic-parity'}
JOB=ROOT/'focused-mail-projection-v5';UNIT='proofofwork-audit29-verify-38ac6e2bff2a-20261003T042000Z-shadow-strict-v1.service'
LEAF_PIN='ac37be8c62908ca09e965fa04f219247652f1b52377c51951e14dbcd786a6708'
FINAL_PROOF=pathlib.Path('/data/proofofwork-audit30-inspect-20261003T014100Z/exact-sixteen-readonly-finalization-v1/completed.json')
FINAL_PROOF_SHA='d818545fa493f1032b3b6bfb7b1ba4b8738e3b15968c3f0ed949a0d1bb09bce8'
FINAL_META={'dev':'64514','ino':'11142862','uid':108,'gid':112,'mode':384,'nlink':'1','bytes':'7010','mtimeNs':'1791015261650974438','ctimeNs':'1791015261650974438'}
class Refused(ValueError):pass
def need(v,m):
 if not v:raise Refused(m)
COPY_PACKAGE=pathlib.Path('/usr/local/lib/proofofwork-audit30-onhost-math/v2');COPY=COPY_PACKAGE/'source';COPY_MANIFEST_SHA='e904b0379dd6c80f68eebbb556b5bd5caa8619aa79df89f03ed16ebbeb6db977';COPY_COMPLETION_SHA='dc9e158445be2a176ef683ae7b3b5df40a44480f77ef9a57def85826d0225ff1';COPY_ATTEST='0ca029e59d44b6be5444d26d6d9af60d432f034f58c617647f2792f5d86c47a6'
COPY_MEMBERS={'node_modules/pg/lib/index.js':'3fad6e6d3d976edbabe0cbc9e1d39f4340bcb719bbbb186a0d3a24f3dbd4a94c'}
COPY_DIRS={'.','node_modules','node_modules/pg','node_modules/pg/lib'}
MODULE_PACKAGE=pathlib.Path('/usr/local/lib/proofofwork-audit30-mail-projection-focused-v5');MODULE_MEMBERS={'server/db/postgres.mjs':'2b959860e0513907447459c1b196bfaaf81fba5131bfa050e528f911c18e616c','server/proof-index-mail-projection.mjs':'bc3c4efa87e3a9b7c0918d340d5626ca08491d7c6695f8951ce2c817c88f900c'}
def stamp(s):return {'dev':str(s.st_dev),'ino':str(s.st_ino),'uid':s.st_uid,'gid':s.st_gid,'mode':stat.S_IMODE(s.st_mode),'nlink':str(s.st_nlink),'bytes':str(s.st_size),'mtimeNs':str(s.st_mtime_ns),'ctimeNs':str(s.st_ctime_ns)}
def finalization_binding(h):
 p=FINAL_PROOF;need(p.resolve()==p and stamp(p.lstat())==FINAL_META,'FINAL_PRIVATE_PROOF_METADATA');raw=h['read'](p,108,limit=65536,expected=FINAL_PROOF_SHA,mode=0o600,group=112);need(stamp(p.lstat())==FINAL_META and hashlib.sha256(raw).hexdigest()==FINAL_PROOF_SHA,'FINAL_PRIVATE_PROOF_DRIFT');v=json.loads(raw);need(v.get('schema')=='pow-audit30-private-sixteen-readonly-finalization-completed-v1'and v.get('status')=='passed'and v.get('originalAttemptRemainsFailed')is True and all(v.get(k)is False for k in('writerInvoked','applyInvoked','inverseInvoked')),'FINAL_PRIVATE_PROOF_SCHEMA');return {'path':str(p),'sha256':FINAL_PROOF_SHA,'metadata':FINAL_META,'originalAttemptRemainsFailed':True}
def copy_scope(m,c):
 need(isinstance(m,dict)and m.get('schema')=='pow-audit30-onhost-math-source-copy-v1'and m.get('candidateRoot')=='/opt/proofofwork-api-stage-3399d767103e-20261003T020420Z'and m.get('sourceRoot')==str(COPY)and m.get('candidateAttestationSHA256')==m.get('attestationBeforeSHA256')==m.get('attestationAfterSHA256')==COPY_ATTEST and m.get('entryCount')==6141 and m.get('regularBytes')==164382510 and len(m.get('entries',[]))==6141 and all(m.get(k)is True for k in('sourceBytesExact','candidateUnchanged','nativeReadabilityPassed'))and m.get('privateRawStateCopied')is False,'COPY_MANIFEST_SCOPE')
 need(c.get('schema')=='pow-audit30-source-copy-finalize-completed-v3'and c.get('status')=='completed'and c.get('sourceCopyManifestSHA256')==COPY_MANIFEST_SHA and c.get('priorAttemptRemainsFailed')is True and c.get('sourceTreeNotModified')is True and c.get('candidateUnchanged')is True and c.get('productionMutation')is False and c.get('privateRawStateCopied')is False,'COPY_COMPLETION_SCOPE')
 n=c.get('nativeReadability',{});need(n.get('receipt')=={'uid':108,'gid':112,'entries':6141,'allSourceAndDependenciesReadable':True}and n.get('unit')=='proofofwork-audit30-math-source-readability-v4.service'and n.get('InvocationID')=='fcea4496dea54ecb9b3f314b9746ce1e'and n.get('ownedStop',{}).get('unitStopVerified')is True and n.get('remainAfterExitStopped')is True,'COPY_PRIOR_READABILITY_STOP')
 rows={}
 for r in m['entries']:
  name=r.get('path');need(isinstance(name,str)and (name=='.'or (not name.startswith('/')and str(pathlib.PurePosixPath(name))==name and '..'not in pathlib.PurePosixPath(name).parts))and name not in rows,'COPY_ENTRY_SCOPE');rows[name]=r
 for name in COPY_DIRS:need(rows.get(name,{}).get('kind')=='directory'and rows[name]['metadata']['uid']==0 and rows[name]['metadata']['gid']==112 and rows[name]['metadata']['mode']==0o750,'COPY_DIRECTORY_CONTRACT')
 for name,pin in COPY_MEMBERS.items():need(rows.get(name,{}).get('kind')=='file'and rows[name].get('sha256')==pin and rows[name]['metadata']['uid']==0 and rows[name]['metadata']['gid']==112 and rows[name]['metadata']['mode']==0o440 and rows[name]['metadata']['nlink']=='1','COPY_MEMBER_CONTRACT')
 need(not (set(MODULE_MEMBERS)&set(rows)),'COPY_API_MODULE_ABSENCE_CONTRACT');return rows
def copy_bindings(h):
 p=COPY_PACKAGE;s=p.lstat();need(p.resolve()==p and stat.S_ISDIR(s.st_mode)and(s.st_uid,s.st_gid,stat.S_IMODE(s.st_mode))==(0,112,0o750)and not os.listxattr(p),'COPY_PACKAGE_AUTHORITY');package=stamp(s)
 raw=h['read'](p/'source-copy-manifest.json',0,limit=4*1024**2,expected=COPY_MANIFEST_SHA,mode=0o440,group=112);done=h['read'](p/'source-copy-finalize-v3-completed.json',0,limit=16384,expected=COPY_COMPLETION_SHA,mode=0o600,group=0);rows=copy_scope(json.loads(raw),json.loads(done));observed={}
 for name in sorted(COPY_DIRS|set(COPY_MEMBERS)):
  target=COPY if name=='.'else COPY/name;s=target.lstat();need(target.resolve()==target and stamp(s)==rows[name]['metadata']and not os.listxattr(target),'COPY_SELECTED_IDENTITY')
  if name in COPY_MEMBERS:
   need(stat.S_ISREG(s.st_mode),'COPY_SELECTED_FILE');h['read'](target,0,limit=1024**2,expected=COPY_MEMBERS[name],mode=0o440,group=112)
  else:need(stat.S_ISDIR(s.st_mode),'COPY_SELECTED_DIRECTORY')
  need(stamp(target.lstat())==rows[name]['metadata'],'COPY_SELECTED_DRIFT');observed[name]=stamp(s)
 need(stamp(p.lstat())==package,'COPY_PACKAGE_DRIFT');return {'manifestSHA256':COPY_MANIFEST_SHA,'completionSHA256':COPY_COMPLETION_SHA,'priorNativeWholeTreeReadableEntries':6141,'priorNativeStopped':True,'freshSelectedMembers':COPY_MEMBERS,'freshSelectedMetadata':observed,'packageMetadata':package,'freshWholeTreeRehashed':False}
def sync_dir(p):
 fd=os.open(p,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
 try:os.fsync(fd)
 finally:os.close(fd)
def fresh_modules(h,owner):
 observed={};raw={}
 for name,pin in MODULE_MEMBERS.items():
  p=CWD/name;s=stamp(p.lstat());raw[name]=h['read'](p,owner,limit=1024**2,expected=pin);need(stamp(p.lstat())==s,'CANDIDATE_MODULE_METADATA_DRIFT');observed[name]=s
 return raw,observed
def prepare_modules(raw):
 p=MODULE_PACKAGE;need(not os.path.lexists(p),'MODULE_PACKAGE_EXISTS');parent=p.parent;s=parent.lstat();need(parent.resolve()==parent and stat.S_ISDIR(s.st_mode)and s.st_uid==0 and not s.st_mode&0o022,'MODULE_PARENT_AUTHORITY')
 for d in[p,p/'server',p/'server/db']:
  d.mkdir(mode=0o750);os.chown(d,0,112);os.chmod(d,0o750);sync_dir(d);sync_dir(d.parent)
 for name,pin in MODULE_MEMBERS.items():
  b=raw[name];need(len(b)<=1024**2 and hashlib.sha256(b).hexdigest()==pin,'MODULE_SOURCE_BYTES');fd=os.open(p/name,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o440)
  try:
   os.fchown(fd,0,112);os.fchmod(fd,0o440);view=memoryview(b)
   while view:view=view[os.write(fd,view):]
   os.fsync(fd)
  finally:os.close(fd)
  sync_dir((p/name).parent)
 link=p/'node_modules';link.symlink_to(COPY/'node_modules',target_is_directory=True);os.lchown(link,0,112);sync_dir(p);sync_dir(parent)
def module_bindings(h):
 p=MODULE_PACKAGE;observed={};expected={'.':['node_modules','server'],'server':['db','proof-index-mail-projection.mjs'],'server/db':['postgres.mjs']}
 for name,children in expected.items():
  d=p if name=='.'else p/name;s=d.lstat();need(d.resolve()==d and stat.S_ISDIR(s.st_mode)and(s.st_uid,s.st_gid,stat.S_IMODE(s.st_mode))==(0,112,0o750)and not os.listxattr(d)and sorted(os.listdir(d))==children,'MODULE_DIRECTORY_CONTRACT');observed[name]=stamp(s)
 for name,pin in MODULE_MEMBERS.items():
  f=p/name;s=stamp(f.lstat());h['read'](f,0,limit=1024**2,expected=pin,mode=0o440,group=112);need(stamp(f.lstat())==s and not os.listxattr(f),'MODULE_FILE_DRIFT');observed[name]=s
 link=p/'node_modules';s=link.lstat();need(stat.S_ISLNK(s.st_mode)and(s.st_uid,s.st_gid,s.st_nlink)==(0,112,1)and os.readlink(link)==str(COPY/'node_modules')and link.resolve()==COPY/'node_modules'and not os.listxattr(link,follow_symlinks=False),'MODULE_DEPENDENCY_LINK');observed['node_modules']={'metadata':stamp(s),'target':os.readlink(link)}
 return {'package':str(p),'exactFileSHA256':MODULE_MEMBERS,'entries':observed,'sourceBytesPreserved':True,'existingDependencyTreeModified':False}

def child_failure(raw):
 try:v=json.loads(raw)
 except (ValueError,TypeError,UnicodeDecodeError):return {'code':'UNCLASSIFIED_CHILD_FAILURE'}
 if not isinstance(v,dict)or set(v)!={'schema','code','errorClass'}or v['schema']!='pow-audit30-focused-mail-leaf-refused-v4'or v['errorClass']not in ('Error','TypeError','RangeError','AggregateError'):return {'code':'UNCLASSIFIED_CHILD_FAILURE'}
 allowed={'SUMMARY_SHAPE','COUNT','HASH','SAMPLE','MISMATCH_SHAPE','DUPLICATE_SAMPLE','NOT_READONLY','ROW_BOUND','NATIVE_PG_IDENTITY','DB_IDENTITY_SCOPE','42501','57014','55P03','25P02','53300','08001','08006','3D000','28P01','ENOENT','EACCES','ECONNREFUSED','UNCLASSIFIED_CHILD_FAILURE'}
 return v if v.get('code')in allowed else {'code':'UNCLASSIFIED_CHILD_FAILURE'}

def load(raw,name):
 n={'__name__':'_focused_readonly','__file__':name};exec(compile(raw,name,'exec'),n);return n
def severity(v):
 need(v.get('format')=='audit29-candidate-readonly-v1' and v.get('mode')=='shadow' and v.get('failure')=='STRICT_GATE_FAILED','SAVED_SCOPE');rows=v['gateReceipts']['parity']['checks'];need(len(rows)==102,'SAVED_COUNT');failed=[r for r in rows if r['ok']is not True];need(len(failed)==3 and {r['name']for r in failed}==FAIL_NAMES and all(r['severity']in ['warning','error']for r in failed),'SAVED_FAILURE_SCOPE');return {'failed':[{'name':r['name'],'severity':r['severity'],'ok':False}for r in failed],'blockingErrorCount':sum(r['severity']=='error'for r in failed),'historicalWarningCount':sum(r['severity']=='warning'for r in failed),'workAmoV5ReadinessRequiredByQuoteSeverity':next(r['severity']=='error'for r in failed if r['name']=='work-amo-v5-usd-quote-head'),'qualification':'Original saved strict attempt check severities; quote-required boolean is inferred from the byte-pinned parity source conditional, not a fresh environment census.'}
def save(a,name,v):
 p=JOB/name;fd=os.open(p,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
 with os.fdopen(fd,'wb')as f:f.write((json.dumps(v,sort_keys=True)+'\n').encode());f.flush();os.fsync(f.fileno())
 fd=os.open(JOB,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
 try:os.fsync(fd)
 finally:os.close(fd)
def main(leaf):
 need(os.getuid()==os.geteuid()==os.getgid()==os.getegid()==0,'ROOT');os.umask(0o077)
 p=ROOT/'strict-native-tools-v1'/'assembly.py';s=p.lstat();need(p.resolve()==p and stat.S_ISREG(s.st_mode) and s.st_uid==s.st_gid==0 and stat.S_IMODE(s.st_mode)==0o600 and s.st_nlink==1 and s.st_size<32768,'B3_SHAPE');raw=p.read_bytes();need(hashlib.sha256(raw).hexdigest()==B3,'B3_PIN');a=load(raw,str(p));before=a['live']();timer=a['timer_shape']();need(a['state'](UNIT).get('MainPID','0')=='0','STRICT_RUNNING');b=a['state']('proofofwork-postgres-logical-backup.service');need(b['ActiveState']=='inactive'and b['MainPID']=='0'and b['Result']=='success','BACKUP_ACTIVE');need(not os.path.lexists(JOB),'OUTPUT_EXISTS');need(not os.path.lexists(MODULE_PACKAGE),'MODULE_PACKAGE_EXISTS')
 h=load(a['read'](TOOLS/'private-verify.py',expected=VERIFY),str(TOOLS/'private-verify.py'));original=load(a['read'](TOOLS/'private-env.py',expected=PRIVATE),str(TOOLS/'private-env.py'));account=pwd.getpwnam('powadmin');need(account.pw_uid>0 and account.pw_gid>0,'ACCOUNT');source_identity=original['proc_identity']('api',account)
 saved=h['read'](OUT,account.pw_uid,limit=4*1024**2,mode=0o600,group=account.pw_gid);need(hashlib.sha256(saved).hexdigest()==SAVED_SHA,'SAVED_RECEIPT_PIN');severities=severity(json.loads(saved))
 manifest=a['read'](MANIFEST,65536,MANIFEST_SHA);m=json.loads(manifest);known=[t['txid']for t in m['targets']];need(m['network']=='livenet'and m['targetCount']==len(known)==16 and len(set(known))==16 and all(re.fullmatch('[0-9a-f]{64}',t)for t in known),'TARGET_SCOPE')
 h['read'](CWD/'scripts/check-proof-indexer-parity.mjs',account.pw_uid,expected='450e5361ae5ecdd8dde6e434723366e3d4cc1cafae4675e9e7760c3d1cac90ac');h['read'](pathlib.Path(NODE),limit=128*1024**2,expected=NODE_SHA,group=0)
 blob=pathlib.Path('/proc/'+str(source_identity['pid'])+'/environ').read_bytes();need(len(blob)==5009 and hashlib.sha256(blob).hexdigest()==ENV_SHA,'CURRENT_ENV_PIN');database_account=pwd.getpwnam('postgres');need((database_account.pw_uid,database_account.pw_gid)==(108,112),'NATIVE_PG_ACCOUNT');env={b'PATH':b'/opt/node-v24.18.0-linux-x64/bin:/usr/bin:/bin',b'LC_ALL':b'C',b'TZ':b'UTC',b'NETWORK':b'livenet',b'NODE_DISABLE_COMPILE_CACHE':b'1',b'POW_INDEX_DATABASE_URL':b'postgresql:///proof_indexer?host=%2Fvar%2Frun%2Fpostgresql&port=5432&user=postgres',b'POW_INDEX_DB_STATEMENT_TIMEOUT_MS':b'20000',b'POW_INDEX_DB_POOL_MAX':b'1',b'POW_INDEX_DB_APP_NAME':b'audit30-focused-mail-readonly',b'POW_INDEX_DB_CONNECT_TIMEOUT_MS':b'10000'};need(original['proc_identity']('api',account)==source_identity,'API_IDENTITY_CHANGED');finalproof=finalization_binding(h);graph=copy_bindings(h);module_raw,source_module_metadata=fresh_modules(h,account.pw_uid)
 JOB.mkdir(mode=0o700);fd=os.open(ROOT,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW);os.fsync(fd);os.close(fd);need(hashlib.sha256(leaf).hexdigest()==LEAF_PIN,'LEAF_PIN');save(a,'intent.json',{'schema':'pow-audit30-focused-mail-readonly-intent-v4','leafSHA256':LEAF_PIN,'savedStrictReceiptSHA256':SAVED_SHA,'knownSixteenManifestSHA256':MANIFEST_SHA,'directDatabaseWrites':False,'apiRequests':0,'coreRequests':0,'sourceCopy':graph,'candidateModuleMetadata':source_module_metadata,'newModulePackage':str(MODULE_PACKAGE),'privateReadOnlyClosure':finalproof})
 code=leaf+b'\ntry{const result=await run('+json.dumps(known).encode()+b');console.log(JSON.stringify(result));}catch(e){const allowed=new Set(["SUMMARY_SHAPE","COUNT","HASH","SAMPLE","MISMATCH_SHAPE","DUPLICATE_SAMPLE","NOT_READONLY","ROW_BOUND","NATIVE_PG_IDENTITY","DB_IDENTITY_SCOPE","42501","57014","55P03","25P02","53300","08001","08006","3D000","28P01","ENOENT","EACCES","ECONNREFUSED"]);const code=allowed.has(e?.code)?e.code:allowed.has(e?.message)?e.message:"UNCLASSIFIED_CHILD_FAILURE";const errorClass=["Error","TypeError","RangeError","AggregateError"].includes(e?.constructor?.name)?e.constructor.name:"Error";console.error(JSON.stringify({schema:"pow-audit30-focused-mail-leaf-refused-v4",code,errorClass}));process.exitCode=1;}\n';p=None;start=time.monotonic();stdout=b'';stderr=b'';stage='MODULE_PREPARATION'
 def interrupted(s,f):raise RuntimeError('FOCUSED_READ_SIGNAL')
 signal.signal(signal.SIGTERM,interrupted);signal.signal(signal.SIGINT,interrupted)
 try:
  prepare_modules(module_raw);modules=module_bindings(h);stage='CHILD_LAUNCH'
  def limits():resource.setrlimit(resource.RLIMIT_CORE,(0,0));resource.setrlimit(resource.RLIMIT_FSIZE,(1024**2,1024**2))
  p=subprocess.Popen([NODE,'--max-old-space-size=256','--input-type=module','-'],cwd=MODULE_PACKAGE,env=env,user=database_account.pw_uid,group=database_account.pw_gid,extra_groups=[],umask=0o077,preexec_fn=limits,start_new_session=True,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
  stage='CHILD_COMMUNICATE';stdout,stderr=p.communicate(code,timeout=90);stage='CHILD_VALIDATE';need(len(stdout)<=65536 and len(stderr)<=65536,'OUTPUT_CAP');need(p.returncode==0 and not stderr,'FOCUSED_LEAF_REFUSED');value=json.loads(stdout);need(set(value)=={'parity','readOnly','snapshotSHA256','population','nativeUid','nativeGid','moduleGraphReadableBeforeDatabase','productionDatabaseIdentity'}and value['readOnly']is True and value['nativeUid']==108 and value['nativeGid']==112 and value['moduleGraphReadableBeforeDatabase']is True,'LEAF_SCOPE');stage='POSTREAD_GUARDS';need(finalization_binding(h)==finalproof,'FINAL_PRIVATE_PROOF_AFTER_DRIFT');need(copy_bindings(h)==graph,'COPY_FINAL_DRIFT');need(module_bindings(h)==modules,'MODULE_FINAL_DRIFT');need(fresh_modules(h,account.pw_uid)==(module_raw,source_module_metadata),'CANDIDATE_MODULE_FINAL_DRIFT');need(a['live']()==before and a['timer_shape']()==timer and original['proc_identity']('api',account)==source_identity,'LIVE_DRIFT');need(hashlib.sha256(pathlib.Path('/proc/'+str(source_identity['pid'])+'/environ').read_bytes()).hexdigest()==ENV_SHA,'FINAL_ENV_DRIFT')
  result={'schema':'pow-audit30-focused-mail-readonly-completed-v4','atUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'sourceCopy':graph,'privateReadOnlyClosure':finalproof,'newModulePackage':modules,'candidateModuleMetadata':source_module_metadata,'savedStrictCheckSeverities':severities,'savedStrictReceiptSHA256':SAVED_SHA,'freshMailProjection':value,'knownSixteenManifestSHA256':MANIFEST_SHA,'seconds':round(time.monotonic()-start,3),'childExitCode':p.returncode,'childStopped':True,'stdoutBytes':len(stdout),'stdoutSHA256':hashlib.sha256(stdout).hexdigest(),'stderrBytes':len(stderr),'stderrSHA256':hashlib.sha256(stderr).hexdigest(),'liveFiveUnchanged':True,'timerUnchanged':True,'privateContentsExported':False,'directDatabaseWrites':False,'apiRequests':0,'coreRequests':0,'automaticRetry':False,'qualification':'Fresh RR, not strict capture/Core replay. Prior6141 hash proof; fresh pg/fourdirs, not whole-tree rehash. Two exact new modules+confined link preserve original bytes/permissions. Actual108:112 imports precede DB.256MiB caps client only; PG20s/3s/work8MiB/temp32MiB.'};save(a,'completed.json',result);print(json.dumps(result,sort_keys=True));return 0
 except BaseException as e:
  signal.signal(signal.SIGTERM,signal.SIG_IGN);signal.signal(signal.SIGINT,signal.SIG_IGN);cleanup=[]
  if p is not None:
   try:os.killpg(p.pid,signal.SIGKILL)
   except ProcessLookupError:pass
   except BaseException as c:cleanup.append(type(c).__name__)
   try:p.wait(timeout=5)
   except BaseException as c:cleanup.append(type(c).__name__)
  save(a,'failed.json',{'schema':'pow-audit30-focused-mail-readonly-failed-v4','stage':stage,'errorClass':type(e).__name__,'guardCode':str(e)if isinstance(e,Refused)else None,'childExitCode':None if p is None else p.returncode,'childFailure':child_failure(stderr),'stdoutBytes':len(stdout),'stdoutSHA256':hashlib.sha256(stdout).hexdigest(),'stderrBytes':len(stderr),'stderrSHA256':hashlib.sha256(stderr).hexdigest(),'cleanupErrors':cleanup,'automaticRetry':False,'directDatabaseWrites':False});raise
 finally:
  if p is not None:
   for stream in[p.stdin,p.stdout,p.stderr]:
    if stream is not None:stream.close()
