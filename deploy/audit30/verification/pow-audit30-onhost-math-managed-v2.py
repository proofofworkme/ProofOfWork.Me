#!/usr/bin/python3 -I
"""Proposed fixed managed arithmetic acceptance, only after stopped stream proof.

Runs no SQL/Core/PG service. The sole PG-role child is the frozen9794 file-only
operator. Source-copy and all previous attempts remain immutable. All actual
input pins require a separately root-reviewed request; this draft is not an
execution plan and has never been invoked natively.
"""
import base64,hashlib,json,os,pathlib,re,signal,stat,sys,time,types
P=pathlib.Path
PACKAGE=P('/usr/local/lib/proofofwork-audit30-onhost-math/v2')
JOB=P('/data/proofofwork-audit30-inspect-20261003T014100Z');STREAM=JOB/'stream-followup-v1';WORK=STREAM/'onhost-math-v2'
UNIT='proofofwork-audit30-onhost-sampled-math-v2.service'
UTILITY_SHA='379b387e33d08b421e126edd261f63b801d8326bdf24477e6a1a8c012c0e1988'
OUTPUT_PROBE_SHA='a38d26740997f039cf44063f27acba75491fc99ff03f87a522e541eb6e1a59bd'
OPERATOR_SHA='9794e0307d52fd69e495e475c3b234b532752731fb947cee1bfd5968dfdee7e0'
SOURCE_FENCE_SHA='d9c08752be9e8e7c8d9ce4409b20496783901f116becbb26e205904dc676564b'
SOURCE_INV_SHA='f30301ca4f4769cfbbd995dc7627580be543e6cddfc1f5b3ff4aba033a48f572'
NODE=P('/opt/node-v24.18.0-linux-x64/bin/node')
LIVE=('bitcoind.service','electrs.service','postgresql@16-main.service','proofofwork-api.service','proofofwork-indexer-worker.service')
INPUT_SUFFIXES=('.copy','.reconstructed.copy','.columns.json','.checkpoint.json','.marker.copy','.marker-value.json','.context.json')
SOURCE_COMPLETION='source-copy-finalize-v3-completed.json' # pending versioned finalizer source/native gate
FIELDS='LoadState,ActiveState,SubState,Type,Transient,ControlGroup,User,Group,InvocationID,MainPID,RemainAfterExit,Result,ExecMainStatus,MemoryMax,MemorySwapMax,CPUQuotaPerSecUSec,TasksMax,RuntimeMaxUSec,TimeoutStopUSec,Restart,KillMode,NoNewPrivileges,PrivateNetwork,PrivateTmp,PrivateDevices,PrivateIPC,RestrictAddressFamilies,ProtectSystem,ProtectHome,CapabilityBoundingSet,AmbientCapabilities,StandardInput,StandardOutput,StandardError,UMask,LimitFSIZE,ReadOnlyPaths,ReadWritePaths,InaccessiblePaths,FragmentPath,DropInPaths,SourcePath'
C=None;OWNED=None;LAUNCHED=False;WORK_CREATED=False;REQUEST_SHA=None;PROBE_SHA=None
class Refused(Exception):pass
def need(v,code):
 if not v:raise Refused(code)
def sha(raw):return hashlib.sha256(raw).hexdigest()
def encoded(v):return json.dumps(v,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()
def pairs(rows):
 d={}
 for k,v in rows:need(k not in d,'MATH_OUTER_DUPLICATE_JSON');d[k]=v
 return d
def parse(raw):return json.loads(raw,object_pairs_hook=pairs)
def digest(v):return sha(encoded(v))
def hash_shape(v):return isinstance(v,str)and re.fullmatch('[a-f0-9]{64}',v)is not None

def load_utility(raw):
 need(sha(raw)==UTILITY_SHA,'MATH_OUTER_UTILITY_PIN');m=types.ModuleType('reviewed_source_custody');m.__file__='<reviewed379b>'
 exec(compile(raw,m.__file__,'exec'),m.__dict__);need(m.PACKAGE==PACKAGE and m.PG_UID==108 and m.PG_GID==112,'MATH_OUTER_UTILITY_SCOPE');return m

def request(r):
 keys={'schema','utilityBase64','sourceCopyCompletionSha256','sourceCopyManifestSha256','streamCompletedSha256','streamIntentSha256','outputPropertyProbeSha256','mathPlanBase64','mathPlanSha256','nodeMetadata','attestorMetadata','publisherMetadata','liveFive'}
 need(isinstance(r,dict)and set(r)==keys and r['schema']=='pow-audit30-onhost-math-managed-request-v2','MATH_OUTER_REQUEST_SHAPE')
 for k in ('sourceCopyCompletionSha256','sourceCopyManifestSha256','streamCompletedSha256','streamIntentSha256','outputPropertyProbeSha256','mathPlanSha256'):need(hash_shape(r[k]),'MATH_OUTER_REQUEST_PIN')
 try:u=base64.b64decode(r['utilityBase64'],validate=True);p=base64.b64decode(r['mathPlanBase64'],validate=True)
 except (ValueError,TypeError):raise Refused('MATH_OUTER_REQUEST_BASE64')
 need(len(u)<=100000 and sha(u)==UTILITY_SHA and 0<len(p)<=128*1024 and sha(p)==r['mathPlanSha256'],'MATH_OUTER_EXACT_REQUEST_BYTES');plan=parse(p);need(encoded(plan)==p,'MATH_OUTER_PLAN_CANONICAL_NO_LF')
 need(plan.get('schema')=='pow-audit30-saved-transition-onhost-math-plan-v2' and plan.get('operatorSHA256')==OPERATOR_SHA and plan.get('privateJob')==str(JOB) and plan.get('evidenceDirectory')==str(STREAM) and plan.get('sourceCopyManifestSHA256')==r['sourceCopyManifestSha256'],'MATH_OUTER_PLAN_SCOPE')
 need(set(plan.get('inputs',{}))==set(INPUT_SUFFIXES),'MATH_OUTER_INPUT_NAMES')
 for suffix,b in plan['inputs'].items():
  cap=64*1024**2 if suffix in ('.copy','.reconstructed.copy')else 2*1024**2 if suffix in ('.marker.copy','.marker-value.json')else 1024**2
  need(isinstance(b,dict)and set(b)=={'bytes','sha256'}and type(b['bytes'])is int and 0<b['bytes']<=cap and hash_shape(b['sha256']),'MATH_OUTER_INPUT_CAP')
 need(plan['inputs']['.copy']==plan['inputs']['.reconstructed.copy'] and plan.get('historicalPlan',{}).get('sourceFenceSha256')==SOURCE_FENCE_SHA,'MATH_OUTER_EQUAL_COPY_FENCE')
 need(r['outputPropertyProbeSha256']==OUTPUT_PROBE_SHA,'MATH_OUTER_NATIVE_OUTPUT_PROBE_PIN')
 need(set(r['liveFive'])==set(LIVE),'MATH_OUTER_LIVE_SCOPE')
 for v in r['liveFive'].values():need(set(v)=={'MainPID','InvocationID'}and isinstance(v['MainPID'],str)and re.fullmatch('[1-9][0-9]*',v['MainPID'])and re.fullmatch('[a-f0-9]{32}',v['InvocationID']),'MATH_OUTER_LIVE_IDENTITY')
 return u,p,plan

def read(p,h,cap,uid,gid,mode):
 m=p.lstat();need(p.resolve()==p and stat.S_ISREG(m.st_mode)and m.st_nlink==1 and (m.st_uid,m.st_gid,stat.S_IMODE(m.st_mode))==(uid,gid,mode)and not C.xattrs(p),'MATH_OUTER_FIXED_FILE_AUTHORITY');return C.read_file(p,cap,h,C.stamp(m))
def metadata_dir(p,uid,gid,mode):
 m=p.lstat();need(p.resolve()==p and stat.S_ISDIR(m.st_mode)and(m.st_uid,m.st_gid,stat.S_IMODE(m.st_mode))==(uid,gid,mode)and not C.xattrs(p),'MATH_OUTER_DIRECTORY_AUTHORITY');return {k:C.stamp(m)[k]for k in('dev','ino','uid','gid','mode')}
def absent(p):return not p.exists()and not p.is_symlink()

def live(r):
 out={}
 for u in LIVE:
  v=C.parse_shape(C.run_checked(['/usr/bin/systemctl','show',u,'--property=LoadState,ActiveState,MainPID,InvocationID'],10,65536));need(v.get('LoadState')=='loaded'and v.get('ActiveState')=='active'and {k:v.get(k)for k in('MainPID','InvocationID')}==r[u],'MATH_OUTER_LIVE_CHANGED');out[u]=v
 return out

def stopped():
 cluster=JOB/'cluster';metadata_dir(cluster,108,112,0o700);metadata_dir(JOB/'socket',108,112,0o700)
 need(absent(cluster/'postmaster.pid')and absent(JOB/'socket'/'.s.PGSQL.55432')and absent(JOB/'socket'/'.s.PGSQL.55432.lock'),'MATH_OUTER_PRIVATE_PG_SOCKET_OR_PID')
 # No new SQL/server command is issued. Census only process arguments for this
 # exact private data/socket path; neither args nor other process data exported.
 for proc in P('/proc').iterdir():
  if not proc.name.isdigit():continue
  try:a=(proc/'cmdline').read_bytes().split(b'\0')
  except (FileNotFoundError,ProcessLookupError,PermissionError):continue
  need(str(cluster).encode()not in a and str(JOB/'socket').encode()not in a,'MATH_OUTER_PRIVATE_PG_PROCESS_ALIVE')
 return True

def validate_source_completion(v,r):
 need(v.get('schema')=='pow-audit30-source-copy-finalize-completed-v3'and v.get('status')=='completed'and v.get('sourceCopyManifestSHA256')==r['sourceCopyManifestSha256']and all(v.get(k)is True for k in ('priorAttemptRemainsFailed','sourceTreeNotModified','candidateUnchanged'))and v.get('productionMutation')is False and v.get('privateRawStateCopied')is False and v.get('outputPropertyProbeSHA256')==OUTPUT_PROBE_SHA,'MATH_OUTER_SOURCE_COPY_NOT_COMPLETED')
 n=v.get('nativeReadability',{});need(n.get('ownedStop',{}).get('unitStopVerified')is True and n.get('receipt')=={'uid':108,'gid':112,'entries':6141,'allSourceAndDependenciesReadable':True},'MATH_OUTER_SOURCE_COPY_READABILITY_UNSTOPPED')

def validate_stream(v,intent):
 need(v.get('schema')=='pow-audit30-private-stream-followup-completed-v1'and v.get('status')=='passed'and v.get('planSha256')==digest(intent.get('plan'))and intent.get('planSha256')==v['planSha256'],'MATH_OUTER_STREAM_CANONICAL_INTENT')
 need(all(v.get(k)is True for k in ('previousInspectionEvidenceUnchanged','sealedSourceFullHashVerifiedBeforeStart','sealedSourceFullHashVerifiedAtStop','sourceContextAndSavedFenceUnchanged','fullNativeByteEquality','privateClusterStopped','liveServicesUnchanged','bodyAccepted'))and all(v.get(k)is False for k in ('productionDatabaseMutation','sealedSourceStarted','mathAccepted','allHistoricalReplay')),'MATH_OUTER_STREAM_NOT_GREEN_STOPPED')
 need(intent['plan'].get('job')==str(JOB)and intent['plan'].get('controllerSha256')=='e9801d372d05c94c40b609749e502ab1eb5e06f4f2561fa08d9c6a25c9313599','MATH_OUTER_EXACT_STREAM_CONTROLLER')
 body=v.get('bodyRehearsal',{});need(body.get('rollbackOnly')is True and body.get('allFourNativeFingerprintsRestored')is True and body.get('productionApplyApproved')is False and body.get('selected')==16 and body.get('missing')==0,'MATH_OUTER_BODY_INVERSE_NOT_RESTORED')

def fence(r,plan):
 C.check_tools(r);C.reserve();C.package_fence();need(sha(C.attest())==C.ATTESTATION,'MATH_OUTER_WHOLE_CANDIDATE');before=live(r['liveFive']);stopped()
 source=parse(read(PACKAGE/SOURCE_COMPLETION,r['sourceCopyCompletionSha256'],65536,0,0,0o600));validate_source_completion(source,r)
 manifest=parse(read(PACKAGE/'source-copy-manifest.json',r['sourceCopyManifestSha256'],32*1024**2,0,112,0o440));need(manifest.get('candidateAttestationSHA256')==C.ATTESTATION and manifest.get('sourceInventorySHA256')=='aae198d18b0f5b347f25022f4c141b546aebf5f62d32e21cd72443ede5edd642','MATH_OUTER_COPY_MANIFEST_FENCE')
 copied={k:manifest[k]for k in('entries','entryCount','regularBytes')};need(C.inventory_tree(C.DEST)==copied,'MATH_OUTER_COPIED_TREE_DRIFT')
 done=parse(read(STREAM/'completed.json',r['streamCompletedSha256'],8*1024**2,108,112,0o600));intent=parse(read(STREAM/'intent.json',r['streamIntentSha256'],8*1024**2,108,112,0o600));validate_stream(done,intent)
 metadata_dir(STREAM,108,112,0o700)
 for suffix,b in plan['inputs'].items():need(len(read(STREAM/('native'+suffix),b['sha256'],b['bytes'],108,112,0o600))==b['bytes'],'MATH_OUTER_CAPTURE_EXACT_BYTES')
 read(PACKAGE/'operator.mjs',OPERATOR_SHA,128*1024,0,112,0o440)
 need(sha(C.attest())==C.ATTESTATION,'MATH_OUTER_POST_FENCE_CANDIDATE');C.check_tools(r);return {'live':before,'copy':digest(copied),'stream':r['streamCompletedSha256'],'sourceCompletion':r['sourceCopyCompletionSha256']}

def command(plan_sha):return ['/usr/bin/env','-i','PATH=/usr/bin:/bin','LC_ALL=C','TZ=UTC',str(NODE),str(PACKAGE/'operator.mjs'),str(PACKAGE/'math-plan.json'),plan_sha]
def properties():
 return {'Type':'exec','RemainAfterExit':'yes','User':'postgres','Group':'postgres','RuntimeMaxSec':'120s','TimeoutStopSec':'10s','MemoryMax':'2G','MemorySwapMax':'0','CPUQuota':'50%','TasksMax':'32','Restart':'no','KillMode':'control-group','NoNewPrivileges':'yes','PrivateNetwork':'yes','PrivateTmp':'yes','PrivateDevices':'yes','PrivateIPC':'yes','RestrictAddressFamilies':'AF_UNIX','ProtectSystem':'strict','ProtectHome':'yes','CapabilityBoundingSet':'','AmbientCapabilities':'','StandardInput':'null','StandardOutput':'file:'+str(WORK/'stdout.json'),'StandardError':'file:'+str(WORK/'stderr.json'),'UMask':'0077','LimitFSIZE':'64K','ReadOnlyPaths':str(PACKAGE)+' '+str(JOB),'ReadWritePaths':'','InaccessiblePaths':'/data/bitcoin /run/postgresql /var/lib/postgresql /etc/bitcoin /etc/proofofwork-api /opt/proofofwork-api'}

def show(cleanup=False):
 argv=['/usr/bin/systemctl','show',UNIT,'--property='+FIELDS]
 raw=C.cleanup_capture(argv)if cleanup else C.run_checked(argv,10,65536)
 return C.parse_shape(raw)
def no_unit(v):need(v.get('LoadState')=='not-found'and v.get('ActiveState')=='inactive'and v.get('SubState')=='dead'and v.get('MainPID')=='0'and v.get('InvocationID')=='','MATH_OUTER_UNIT_COLLISION')
def typed(plan_sha,cleanup=False):
 run=C.run_checked if not cleanup else cleanup_read
 m=parse(run(['/usr/bin/busctl','--system','--json=short','call','org.freedesktop.systemd1','/org/freedesktop/systemd1','org.freedesktop.systemd1.Manager','GetUnit','s',UNIT],10,65536));need(m.get('type')=='o'and isinstance(m.get('data'),list)and len(m['data'])==1 and isinstance(m['data'][0],str)and re.fullmatch('/org/freedesktop/systemd1/unit/[A-Za-z0-9_]+',m['data'][0]),'MATH_OUTER_TYPED_OBJECT')
 e=parse(run(['/usr/bin/busctl','--system','--json=short','get-property','org.freedesktop.systemd1',m['data'][0],'org.freedesktop.systemd1.Service','ExecStart'],10,65536));a=command(plan_sha);need(e.get('type')=='a(sasbttttuii)'and isinstance(e.get('data'),list)and len(e['data'])==1 and isinstance(e['data'][0],list)and len(e['data'][0])==10 and e['data'][0][0]==a[0]and e['data'][0][1]==a and e['data'][0][2]is False,'MATH_OUTER_TYPED_FIXED_NODE');return {'objectPath':m['data'][0],'argvSha256':digest(a)}
def identity(v,cleanup=False):
 fixed=v.get('ControlGroup')=='/system.slice/'+UNIT;terminal=v.get('ControlGroup')==''and v.get('MainPID')=='0'and v.get('ActiveState')=='active'and v.get('SubState')=='exited'and v.get('Result')=='success'and v.get('ExecMainStatus')=='0'
 failed_owned=cleanup and OWNED is not None and v.get('InvocationID')==OWNED and v.get('ControlGroup')==''and v.get('MainPID')=='0'and v.get('ActiveState')=='failed'and v.get('SubState')=='failed'
 need(v.get('LoadState')=='loaded'and v.get('Type')=='exec'and v.get('Transient')=='yes'and v.get('RemainAfterExit')=='yes'and v.get('User')==v.get('Group')=='postgres'and re.fullmatch('[a-f0-9]{32}',v.get('InvocationID',''))and(OWNED is None or v['InvocationID']==OWNED)and(fixed or terminal or failed_owned),'MATH_OUTER_UNIT_NOT_OWNED')

def actual(v):
 expected={'MemoryMax':str(2*1024**3),'MemorySwapMax':'0','CPUQuotaPerSecUSec':'500ms','TasksMax':'32','RuntimeMaxUSec':'2min','TimeoutStopUSec':'10s','Restart':'no','KillMode':'control-group','NoNewPrivileges':'yes','PrivateNetwork':'yes','PrivateTmp':'yes','PrivateDevices':'yes','PrivateIPC':'yes','RestrictAddressFamilies':'AF_UNIX','ProtectSystem':'strict','ProtectHome':'yes','CapabilityBoundingSet':'','AmbientCapabilities':'','StandardInput':'null','StandardOutput':'file','StandardError':'file','UMask':'0077','LimitFSIZE':'65536','ReadOnlyPaths':properties()['ReadOnlyPaths'],'ReadWritePaths':'','InaccessiblePaths':properties()['InaccessiblePaths']}
 need(all(v.get(k)==x for k,x in expected.items()),'MATH_OUTER_ACTUAL_HARDENING')

def output_fragment(v):
 p=P('/run/systemd/transient')/UNIT;need(v.get('FragmentPath')==str(p)and v.get('DropInPaths')==v.get('SourcePath')=='','MATH_OUTER_FRAGMENT_SCOPE');m=p.lstat();need(p.resolve()==p and stat.S_ISREG(m.st_mode)and m.st_uid==m.st_gid==0 and m.st_nlink==1 and not(stat.S_IMODE(m.st_mode)&0o022)and not C.xattrs(p),'MATH_OUTER_FRAGMENT_AUTHORITY');raw=C.read_file(p,32768,metadata=C.stamp(m));section='';found={};want={k:properties()[k]for k in('StandardInput','StandardOutput','StandardError')}
 for line in raw.decode().splitlines():
  line=line.strip()
  if not line or line.startswith(('#',';')):continue
  need(not line.endswith('\\'),'MATH_OUTER_FRAGMENT_CONTINUATION')
  if line.startswith('['):need(line.endswith(']'),'MATH_OUTER_FRAGMENT_SECTION');section=line[1:-1];continue
  k,sep,val=line.partition('=')
  if k in want:need(sep and section=='Service'and k not in found and val==want[k],'MATH_OUTER_FRAGMENT_OUTPUT');found[k]=val
 need(found==want,'MATH_OUTER_FRAGMENT_MISSING_OUTPUT');return {'sha256':sha(raw),'metadata':C.stamp(m),'selectedOutputDirectives':found}

def cleanup_read(argv,timeout=20,cap=65536):
 allowed=(argv[:5]==['/usr/bin/busctl','--system','--json=short','call','org.freedesktop.systemd1']and argv[5:]==['/org/freedesktop/systemd1','org.freedesktop.systemd1.Manager','GetUnit','s',UNIT])or(len(argv)==8 and argv[:5]==['/usr/bin/busctl','--system','--json=short','get-property','org.freedesktop.systemd1']and re.fullmatch('/org/freedesktop/systemd1/unit/[A-Za-z0-9_]+',argv[5])and argv[6:]==['org.freedesktop.systemd1.Service','ExecStart'])
 need(allowed,'MATH_OUTER_FIXED_CLEANUP_READ');p=C.subprocess.run(argv,env=C.ENV,stdin=C.subprocess.DEVNULL,capture_output=True,timeout=20);need(p.returncode==0 and not p.stderr and len(p.stdout)<=cap,'MATH_OUTER_CLEANUP_DBUS_REFUSED');return p.stdout

def stop(plan_sha):
 global OWNED
 v=show(True)
 if v.get('LoadState')=='not-found':no_unit(v);return {'verified':True,'alreadyAbsent':True,'ownedInvocation':OWNED}
 identity(v,True);t=typed(plan_sha,True)
 if OWNED is None:OWNED=v['InvocationID']
 C.cleanup_capture(['/usr/bin/systemctl','stop',UNIT]);after=show(True);need(after.get('MainPID')=='0'and((after.get('LoadState')=='not-found'and after.get('InvocationID')=='')or(after.get('InvocationID')==OWNED and after.get('ActiveState')in('inactive','failed'))),'MATH_OUTER_STOP_REFUSED');return {'verified':True,'ownedInvocation':OWNED,'typedCommand':t,'after':after}

def validate_result(v,plan):
 need(v.get('schema')=='pow-audit30-onhost-sampled-historical-math-result-v1'and v.get('status')=='passed'and v.get('sourceCopyManifestSHA256')==plan['sourceCopyManifestSHA256']and v.get('rows')==3 and v.get('sampleHeights')==[960600,960601,969526]and v.get('nativeUid')==108 and v.get('nativeGid')==112 and v.get('sourceFenceSHA256')==SOURCE_FENCE_SHA and v.get('productionMutation')is False,'MATH_OUTER_RESULT_SCOPE')
 flags=('sourceCopyFullyVerifiedBeforeAndAfter','allColumnBytesExact','storedDeclarationAndMarkerBound','exactV6ToV8SoleTokenOpeningRebind','holderConversionBigIntExact','markerBeforeAfterAndRelicCommitmentsExact','publicOutputContainsOnlyCountsHashesNumbersAndFixedEnums')
 need(all(v.get(k)is True for k in flags)and v.get('sourceSha256')==plan['inputs']['.copy']['sha256']and v.get('reconstructedSha256')==v['sourceSha256'],'MATH_OUTER_MATH_PREDICATES')
 need(isinstance(v.get('numericVerification'),list)and len(v['numericVerification'])==3 and [r.get('height')for r in v['numericVerification']]==[960600,960601,969526],'MATH_OUTER_NUMERIC_ROWS');return v

def execute(r,rawplan,plan):
 global OWNED,LAUNCHED,WORK_CREATED
 before=fence(r,plan);no_unit(show());need(absent(WORK)and absent(PACKAGE/'math-plan.json'),'MATH_OUTER_CREATION_COLLISION');os.mkdir(WORK,0o700);WORK_CREATED=True;fd=os.open(STREAM,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW);os.fsync(fd);os.close(fd)
 C.newfile(PACKAGE/'math-plan.json',rawplan,0o440,0,112);C.newfile(WORK/'intent.json',encoded({'schema':'pow-audit30-onhost-math-managed-intent-v2','requestSha256':REQUEST_SHA,'mathPlanSha256':r['mathPlanSha256'],'outputPropertyProbeSha256':PROBE_SHA,'before':before,'productionDataMutation':False}),0o600,0,0)
 captures={}
 for name in ('stdout.json','stderr.json'):C.newfile(WORK/name,b'',0o600,0,0);captures[name]=C.stamp((WORK/name).lstat())
 props=properties();argv=['/usr/bin/systemd-run','--quiet','--no-block','--unit='+UNIT,*['--property='+k+'='+x for k,x in props.items()],'--',*command(r['mathPlanSha256'])];LAUNCHED=True;need(C.run_checked(argv,10,65536)==b'','MATH_OUTER_LAUNCH_OUTPUT')
 count=0
 while True:
  C.guard();v=show();identity(v);t=typed(r['mathPlanSha256']);OWNED=v['InvocationID'];actual(v);frag=output_fragment(v);count+=1;need(count<=280,'MATH_OUTER_OBSERVER_COUNT')
  if v.get('ActiveState')=='active'and v.get('SubState')=='exited'and v.get('MainPID')=='0':need(v.get('Result')=='success'and v.get('ExecMainStatus')=='0','MATH_OUTER_NODE_FAILED');break
  need(v.get('ActiveState')=='active'and v.get('SubState')=='running'and int(v.get('MainPID','0'))>0,'MATH_OUTER_NODE_STATE');time.sleep(.5)
 out=read(WORK/'stdout.json',None,65536,0,0,0o600);err=read(WORK/'stderr.json',None,65536,0,0,0o600)
 for name in captures:need(all(C.stamp((WORK/name).lstat())[k]==captures[name][k]for k in('dev','ino','uid','gid','mode','nlink')),'MATH_OUTER_CAPTURE_REPLACED')
 need(not err,'MATH_OUTER_NODE_STDERR');result=validate_result(parse(out),plan);cleanup=stop(r['mathPlanSha256']);after=fence(r,plan);need(before==after,'MATH_OUTER_FINAL_CUSTODY_DRIFT');read(PACKAGE/'math-plan.json',r['mathPlanSha256'],128*1024,0,112,0o440)
 done={'schema':'pow-audit30-onhost-math-managed-completed-v2','status':'passed','requestSha256':REQUEST_SHA,'mathPlanSha256':r['mathPlanSha256'],'resultSha256':sha(out),'result':result,'actualRetainedUnit':v,'typedCommand':t,'outputFragment':frag,'outputPropertyProbeSha256':PROBE_SHA,'cleanup':cleanup,'wholeCandidateUnchanged':True,'privateClusterStillStopped':True,'productionMutation':False,'privatePayloadExported':False,'qualification':'Three saved full-state rows plus immutable marker and separate Core headers only. No skipped interval/raw-event/full-genesis or production-data-repair claim.'};C.newfile(WORK/'completed.json',encoded(done),0o600,0,0);return done

def main():
 global C,REQUEST_SHA,PROBE_SHA
 need(os.geteuid()==os.getegid()==0 and sys.flags.isolated and len(sys.argv)==2 and hash_shape(sys.argv[1])and os.uname().nodename=='pow-bitcoin-01','MATH_OUTER_ROOT_FIXED_ARGV');old={s:signal.getsignal(s)for s in(signal.SIGTERM,signal.SIGINT,signal.SIGHUP,signal.SIGALRM)}
 def interrupt(s,f):raise InterruptedError('MATH_OUTER_SIGNAL_OR_600S_DEADLINE')
 for s in old:signal.signal(s,interrupt)
 signal.setitimer(signal.ITIMER_REAL,600);r=None
 try:
  raw=sys.stdin.buffer.read(1024**2+1);need(len(raw)<=1024**2 and sha(raw)==sys.argv[1],'MATH_OUTER_RAW_REQUEST');REQUEST_SHA=sha(raw);r=parse(raw);u,p,plan=request(r);C=load_utility(u);C.UNIT=UNIT;C.UNIT_PROPERTIES=FIELDS;C.DEADLINE=time.monotonic()+600;PROBE_SHA=r['outputPropertyProbeSha256']
  try:return execute(r,p,plan)
  except BaseException as e:
   signal.setitimer(signal.ITIMER_REAL,0)
   for s in(signal.SIGTERM,signal.SIGINT,signal.SIGHUP):signal.signal(s,signal.SIG_IGN)
   cleanup=None
   if LAUNCHED:
    try:cleanup=stop(r['mathPlanSha256'])
    except BaseException as ex:cleanup={'verified':False,'errorClass':type(ex).__name__,'code':str(ex)if isinstance(ex,(Refused,C.Refused))else'MATH_OUTER_CLEANUP_FAILED'}
   if WORK_CREATED:
    try:C.newfile(WORK/'failed.json',encoded({'schema':'pow-audit30-onhost-math-managed-failed-v2','status':'failed','requestSha256':REQUEST_SHA,'errorClass':type(e).__name__,'code':str(e)if isinstance(e,(Refused,C.Refused))else'MATH_OUTER_UNEXPECTED_FAILURE','cleanup':cleanup,'automaticRetry':False,'productionMutation':False}),0o600,0,0)
    except BaseException:pass
   raise
 finally:
  signal.setitimer(signal.ITIMER_REAL,0)
  for s,h in old.items():signal.signal(s,h)
if __name__=='__main__':
 try:r=main()
 except BaseException as e:print(json.dumps({'status':'refused','code':str(e)if isinstance(e,Refused)else type(e).__name__,'productionMutation':False}));sys.exit(1)
 print(json.dumps(r,sort_keys=True))
