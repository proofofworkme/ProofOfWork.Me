#!/usr/bin/python3 -I
"""Verify an existing immutable code copy; never copy or repair source files.

The prior failed preparation remains failed. A fresh retained oneshot performs
only the original hash-pinned PG-readable file census. No SQL, API or code
module activation occurs. Source-copy manifest is published only after stop
and final whole candidate/copy/tool equality. Reviewed utility bytes may be
provided in the typed request, but their SHA is fixed and their main is not run.
"""
import base64, hashlib, json, os, pathlib, re, signal, stat, sys, time, types
P=pathlib.Path
PACKAGE=P('/usr/local/lib/proofofwork-audit30-onhost-math/v2')
UTILITY_SHA='379b387e33d08b421e126edd261f63b801d8326bdf24477e6a1a8c012c0e1988'
INVENTORY_SHA='aae198d18b0f5b347f25022f4c141b546aebf5f62d32e21cd72443ede5edd642'
PRIOR_REQUEST_SHA='c383e578f13a9a01207caca3e25646e0a55df8fdabb8d6a836cbdf2205b7f585'
UNIT='proofofwork-audit30-math-source-readability-v3.service'
PRIOR_UNIT='proofofwork-audit30-math-source-readability-v2.service'
INTENT='source-copy-finalize-v1-intent.json'
FAILED='source-copy-finalize-v1-failed.json'
COMPLETED='source-copy-finalize-v1-completed.json'
STDOUT='source-copy-finalize-v1-readability.stdout'
STDERR='source-copy-finalize-v1-readability.stderr'
INPUT_NAMES=('copied-preflight.json','source-copy-failed.json','source-copy-intent.json','read-copy.mjs')
SHA=re.compile('[a-f0-9]{64}')
PROPERTIES='LoadState,ActiveState,SubState,Type,Transient,ControlGroup,RemainAfterExit,User,Group,InvocationID,MainPID,ExecStart,MemoryMax,MemorySwapMax,CPUQuotaPerSecUSec,TasksMax,RuntimeMaxUSec,TimeoutStartUSec,TimeoutStopUSec,KillMode,Restart,NoNewPrivileges,PrivateTmp,PrivateDevices,PrivateNetwork,RestrictAddressFamilies,ProtectSystem,ProtectHome,ProtectKernelTunables,ProtectKernelModules,ProtectControlGroups,RestrictSUIDSGID,CapabilityBoundingSet,UMask,LimitFSIZE,StandardOutput,StandardError,Result,ExecMainStatus'
C=None;REQUEST_SHA=None;OWNED=None;CLEANUP=None
class Refused(Exception):pass
def need(v,code):
 if not v:raise Refused(code)
def sha(raw):return hashlib.sha256(raw).hexdigest()
def encode(v):return json.dumps(v,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()
def pairs(rows):
 d={}
 for k,v in rows:
  need(k not in d,'FINALIZE_DUPLICATE_JSON_KEY');d[k]=v
 return d
def parse(raw):return json.loads(raw,object_pairs_hook=pairs)
def absent(p):return not p.exists() and not p.is_symlink()
def load_utility(raw):
 need(isinstance(raw,bytes) and sha(raw)==UTILITY_SHA,'FINALIZE_EXACT_REVIEWED_UTILITY')
 m=types.ModuleType('audit30_reviewed_source_copy_utility');m.__file__='<hash-pinned-source-copy-v3>'
 exec(compile(raw,m.__file__,'exec'),m.__dict__)
 need(m.UNIT==PRIOR_UNIT and m.PACKAGE==PACKAGE and m.PG_UID==108 and m.PG_GID==112,'FINALIZE_UTILITY_SCOPE')
 m.UNIT=UNIT;m.UNIT_PROPERTIES=PROPERTIES
 return m
def validate_request(r):
 keys={'schema','sourceInventorySHA256','utilityBase64','inputs','nodeMetadata','attestorMetadata','publisherMetadata'}
 need(isinstance(r,dict) and set(r)==keys and r.get('schema')=='pow-audit30-source-copy-finalize-request-v1','FINALIZE_REQUEST_SCHEMA')
 need(r['sourceInventorySHA256']==INVENTORY_SHA,'FINALIZE_EXACT_REVIEWED_INVENTORY')
 need(isinstance(r['utilityBase64'],str) and len(r['utilityBase64'])<100000,'FINALIZE_UTILITY_CAP')
 try:utility=base64.b64decode(r['utilityBase64'],validate=True)
 except (ValueError,TypeError):raise Refused('FINALIZE_UTILITY_ENCODING')
 need(sha(utility)==UTILITY_SHA,'FINALIZE_EXACT_REVIEWED_UTILITY')
 need(isinstance(r['inputs'],dict) and set(r['inputs'])==set(INPUT_NAMES),'FINALIZE_INPUT_NAMES')
 for name,v in r['inputs'].items():
  need(isinstance(v,dict) and set(v)=={'sha256','metadata'} and isinstance(v['sha256'],str) and SHA.fullmatch(v['sha256']),'FINALIZE_INPUT_PIN')
  validate_metadata(v['metadata'])
 for name in ('nodeMetadata','attestorMetadata','publisherMetadata'):validate_metadata(r[name])
 return utility
def validate_metadata(m):
 need(isinstance(m,dict) and set(m)=={'dev','ino','uid','gid','mode','nlink','bytes','mtimeNs','ctimeNs'},'FINALIZE_METADATA_SHAPE')
 for n in ('dev','ino','nlink','bytes','mtimeNs','ctimeNs'):need(isinstance(m[n],str) and re.fullmatch('0|[1-9][0-9]*',m[n]),'FINALIZE_METADATA_INTEGER')
 for n in ('uid','gid','mode'):need(type(m[n]) is int and m[n]>=0,'FINALIZE_METADATA_INTEGER')
 need(m['nlink']=='1','FINALIZE_METADATA_LINK_COUNT')
def read_owned(name,digest,metadata,mode,gid,limit):
 p=PACKAGE/name;raw=C.read_file(p,limit,digest,metadata)
 need((metadata['uid'],metadata['gid'],metadata['mode'])==(0,gid,mode),'FINALIZE_INPUT_OWNER')
 return raw
def validate_prior_failure(v):
 need(isinstance(v,dict) and set(v)=={'status','mode','code','requestSHA256','automaticRetry','productionMutation','partialPrivateArtifactsPreserved','nativeReadabilityCleanup'},'FINALIZE_PRIOR_FAILURE_SCHEMA')
 need(v['status']=='failed' and v['mode']=='prepare' and v['code']=='COPY_READABILITY_STARTED_IDENTITY' and v['requestSHA256']==PRIOR_REQUEST_SHA and v['automaticRetry'] is False and v['productionMutation'] is False and v['partialPrivateArtifactsPreserved'] is True,'FINALIZE_PRIOR_FAILURE_BINDING')
 n=v['nativeReadabilityCleanup']
 need(isinstance(n,dict) and set(n)=={'attempted','ownedInvocation','unitAlreadyAbsent','unitStopVerified'} and n['attempted'] is True and n['unitAlreadyAbsent'] is True and n['unitStopVerified'] is True and re.fullmatch('[a-f0-9]{32}',n['ownedInvocation'] or ''),'FINALIZE_PRIOR_STOP_PROOF')
def inventory_projection(inv):return {k:inv[k] for k in ('entries','entryCount','regularBytes')}
def exact_children(root,rows):
 known={r['path'] for r in rows}
 for r in rows:
  if r['kind']!='directory':continue
  C.guard();p=root if r['path']=='.' else root/r['path'];prefix='' if r['path']=='.' else r['path']+'/'
  expected={n[len(prefix):] for n in known if n.startswith(prefix) and n!=r['path'] and '/' not in n[len(prefix):]}
  need(set(os.listdir(p))==expected,'FINALIZE_COPY_UNADMITTED_CHILD')
def validate_copied(copied,original):
 need(isinstance(copied,dict) and set(copied)=={'entries','entryCount','regularBytes'} and copied['entryCount']==original['entryCount']==len(copied['entries']) and copied['regularBytes']==original['regularBytes'],'FINALIZE_COPY_COUNTS')
 expected=original['entries'];rows=copied['entries']
 need([r['path'] for r in rows]==[r['path'] for r in expected],'FINALIZE_COPY_ORDER_SCOPE')
 for r,s in zip(rows,expected):
  need({k:v for k,v in r.items() if k!='metadata'}=={k:v for k,v in s.items() if k!='metadata'},'FINALIZE_COPY_SOURCE_BYTES')
  m=r['metadata'];need(m['uid']==0 and m['gid']==112,'FINALIZE_COPY_OWNER')
  if r['kind']=='file':need(m['mode']==0o440 and m['nlink']=='1','FINALIZE_COPY_FILE_MODE')
  elif r['kind']=='directory':need(m['mode']==0o750,'FINALIZE_COPY_DIRECTORY_MODE')
  else:need(r['kind']=='symlink' and m['mode']==0o777 and m['nlink']=='1','FINALIZE_COPY_LINK_MODE')
 return copied
def initial_fence(r):
 C.check_tools(r);C.reserve();C.package_fence()
 need(sha(C.attest())==C.ATTESTATION,'FINALIZE_INITIAL_WHOLE_ATTESTATION')
 p=PACKAGE/'source-inventory.json';s=p.lstat();need((s.st_uid,s.st_gid,stat.S_IMODE(s.st_mode))==(0,0,0o600),'FINALIZE_INVENTORY_OWNER')
 invraw=C.read_file(p,32*1024**2,INVENTORY_SHA);inv=parse(invraw)
 need(inv['schema']=='pow-audit30-onhost-source-inventory-v1' and inv['candidateRoot']==str(C.CANDIDATE) and inv['candidateAttestationSHA256']==C.ATTESTATION and inv['staticGraphSHA256']==C.GRAPH_SHA and inv['privateRawStateCopied'] is False,'FINALIZE_INVENTORY_AUTHORITY')
 old=r['inputs'];raws={}
 for name in INPUT_NAMES:
  limit=32*1024**2 if name=='copied-preflight.json' else 65536
  mode,gid=(0o440,112) if name in ('copied-preflight.json','read-copy.mjs') else (0o600,0)
  raws[name]=read_owned(name,old[name]['sha256'],old[name]['metadata'],mode,gid,limit)
 validate_prior_failure(parse(raws['source-copy-failed.json']))
 need(parse(raws['source-copy-intent.json'])=={'requestSHA256':PRIOR_REQUEST_SHA,'sourceInventorySHA256':INVENTORY_SHA,'sourceDestination':str(C.DEST),'candidateAttestationSHA256':C.ATTESTATION},'FINALIZE_PRIOR_INTENT')
 need(raws['read-copy.mjs']==C.READABILITY.encode(),'FINALIZE_ORIGINAL_READABILITY_BYTES')
 copied=validate_copied(parse(raws['copied-preflight.json']),inv)
 need(C.inventory_tree(C.CANDIDATE)==inventory_projection(inv),'FINALIZE_CANDIDATE_INVENTORY_DRIFT')
 need(C.inventory_tree(C.DEST)==copied,'FINALIZE_EXISTING_COPY_DRIFT')
 exact_children(C.DEST,copied['entries'])
 need(sha(C.attest())==C.ATTESTATION,'FINALIZE_INITIAL_FINAL_ATTESTATION')
 return inv,copied
def show():return C.parse_shape(C.run_checked(['/usr/bin/systemctl','show',UNIT,'--property='+PROPERTIES],10,65536))
def require_absent(u):
 need(u.get('LoadState')=='not-found' and u.get('MainPID')=='0' and u.get('InvocationID')=='' and u.get('ActiveState')=='inactive' and u.get('SubState')=='dead','FINALIZE_NEW_UNIT_COLLISION')
 return u
def cleanup_show():return C.parse_shape(C.cleanup_capture(['/usr/bin/systemctl','show',UNIT,'--property='+PROPERTIES]))
def identity(u,invocation=None):
 C.validate_readability_identity(u,invocation)
 need(u.get('LoadState')=='loaded' and u.get('Type')=='oneshot' and u.get('Transient')=='yes' and u.get('ControlGroup')=='/system.slice/'+UNIT,'FINALIZE_READABILITY_NOT_OWNED')
 return u
def typed_identity(manager,value):
 need(isinstance(manager,dict) and set(manager)=={'type','data'} and manager['type']=='o' and isinstance(manager['data'],list) and len(manager['data'])==1 and isinstance(manager['data'][0],str) and re.fullmatch('/org/freedesktop/systemd1/unit/[A-Za-z0-9_]+',manager['data'][0]),'FINALIZE_TYPED_UNIT_OBJECT')
 need(isinstance(value,dict) and set(value)=={'type','data'} and value['type']=='a(sasbttttuii)' and isinstance(value['data'],list) and len(value['data'])==1,'FINALIZE_TYPED_SINGLE_EXECSTART')
 entry=value['data'][0];fixed=args();expected=fixed[fixed.index('/usr/bin/env'):]
 need(isinstance(entry,list) and len(entry)==10 and entry[0]==expected[0] and entry[1]==expected and entry[2] is False and all(type(n) is int and n>=0 for n in entry[3:]),'FINALIZE_TYPED_EXACT_EXECSTART')
 return {'objectPath':manager['data'][0],'argvSHA256':sha(encode(expected))}
def typed_start():
 manager=parse(C.run_checked(['/usr/bin/busctl','--system','--json=short','call','org.freedesktop.systemd1','/org/freedesktop/systemd1','org.freedesktop.systemd1.Manager','GetUnit','s',UNIT],10,65536))
 need(isinstance(manager,dict) and isinstance(manager.get('data'),list) and len(manager['data'])==1 and isinstance(manager['data'][0],str) and re.fullmatch('/org/freedesktop/systemd1/unit/[A-Za-z0-9_]+',manager['data'][0]),'FINALIZE_TYPED_UNIT_OBJECT')
 value=parse(C.run_checked(['/usr/bin/busctl','--system','--json=short','get-property','org.freedesktop.systemd1',manager['data'][0],'org.freedesktop.systemd1.Service','ExecStart'],10,65536))
 return typed_identity(manager,value)
def shape(u,invocation=None,complete=False):
 identity(u,invocation);C.validate_readability_shape(u,invocation)
 fixed={'Type':'oneshot','RemainAfterExit':'yes','TimeoutStartUSec':'2min','TimeoutStopUSec':'10s','KillMode':'control-group','PrivateTmp':'yes','PrivateDevices':'yes','RestrictAddressFamilies':'AF_UNIX','ProtectSystem':'strict','ProtectHome':'yes','ProtectKernelTunables':'yes','ProtectKernelModules':'yes','ProtectControlGroups':'yes','RestrictSUIDSGID':'yes','UMask':'0077','LimitFSIZE':'65536','StandardOutput':'file:'+str(PACKAGE/STDOUT),'StandardError':'file:'+str(PACKAGE/STDERR)}
 need(all(u.get(k)==v for k,v in fixed.items()),'FINALIZE_READABILITY_ACTUAL_HARDENING')
 if complete:need(u.get('ActiveState')=='active' and u.get('SubState')=='exited' and u.get('MainPID')=='0' and u.get('Result')=='success' and u.get('ExecMainStatus')=='0','FINALIZE_RETAINED_ONESHOT_NOT_SUCCESS')
 return u
def args():
 return ['/usr/bin/systemd-run','--quiet','--no-block','--unit='+UNIT,'--property=Type=oneshot','--property=RemainAfterExit=yes','--property=User=postgres','--property=Group=postgres','--property=TimeoutStartSec=120s','--property=RuntimeMaxSec=120s','--property=MemoryMax=1G','--property=MemorySwapMax=0','--property=CPUQuota=50%','--property=TasksMax=32','--property=TimeoutStopSec=10s','--property=KillMode=control-group','--property=Restart=no','--property=NoNewPrivileges=yes','--property=PrivateTmp=yes','--property=PrivateDevices=yes','--property=PrivateNetwork=yes','--property=RestrictAddressFamilies=AF_UNIX','--property=ProtectSystem=strict','--property=ProtectHome=yes','--property=ProtectKernelTunables=yes','--property=ProtectKernelModules=yes','--property=ProtectControlGroups=yes','--property=RestrictSUIDSGID=yes','--property=CapabilityBoundingSet=','--property=UMask=0077','--property=LimitFSIZE=64K','--property=StandardOutput=file:'+str(PACKAGE/STDOUT),'--property=StandardError=file:'+str(PACKAGE/STDERR),'/usr/bin/env','-i','PATH=/usr/bin:/bin','LC_ALL=C',str(C.NODE),str(PACKAGE/'read-copy.mjs')]
def stop_owned():
 global CLEANUP
 need(OWNED is not None,'FINALIZE_NO_OWNED_INVOCATION')
 CLEANUP={'attempted':True,'ownedInvocation':OWNED,'unitStopVerified':False}
 CLEANUP=C.owned_stop(OWNED)
 return CLEANUP
def readability(copied):
 global OWNED
 require_absent(show())
 for n in (STDOUT,STDERR):C.newfile(PACKAGE/n,b'',0o600,0,0)
 capture_stamps={n:C.stamp((PACKAGE/n).lstat()) for n in (STDOUT,STDERR)}
 need(C.run_checked(args(),10,65536)==b'','FINALIZE_LAUNCH_UNEXPECTED_OUTPUT')
 deadline=time.monotonic()+135;observed=None;typed=None
 while True:
  C.guard();need(time.monotonic()<deadline,'FINALIZE_READABILITY_135S_DEADLINE')
  u=show()
  if u.get('LoadState')=='loaded' and u.get('InvocationID'):
   identity(u,OWNED);typed=typed_start();OWNED=u['InvocationID'];observed=shape(u,OWNED)
   if u.get('ActiveState')=='active' and u.get('SubState')=='exited':u=shape(u,OWNED,True);break
   need(u.get('ActiveState')=='activating' and u.get('SubState')=='start','FINALIZE_READABILITY_FAILED_STATE')
  else:need(OWNED is None,'FINALIZE_RETAINED_UNIT_DISAPPEARED')
  for n in (STDOUT,STDERR):capture_shape(n,capture_stamps[n])
  time.sleep(.1)
 raw=capture_read(STDOUT,capture_stamps[STDOUT]);err=capture_read(STDERR,capture_stamps[STDERR]);need(not err,'FINALIZE_READABILITY_STDERR')
 receipt=parse(raw);need(receipt=={'uid':108,'gid':112,'entries':copied['entryCount'],'allSourceAndDependenciesReadable':True},'FINALIZE_READABILITY_STDOUT')
 stop=stop_owned()
 return {'unit':UNIT,'InvocationID':OWNED,'receipt':receipt,'stdoutSHA256':sha(raw),'actualRetainedUnitProperties':u,'typedExecStart':typed,'observedDuringStart':observed is not None,'ownedStop':stop,'remainAfterExitStopped':True}
def capture_shape(name,initial):
 p=PACKAGE/name;s=p.lstat();m=C.stamp(s)
 need(stat.S_ISREG(s.st_mode) and not C.xattrs(p) and s.st_size<=65536 and (s.st_uid,s.st_gid,stat.S_IMODE(s.st_mode),s.st_nlink)==(0,0,0o600,1),'FINALIZE_CAPTURE_SHAPE')
 need(all(m[k]==initial[k] for k in ('dev','ino','uid','gid','mode','nlink')),'FINALIZE_CAPTURE_IDENTITY_DRIFT')
 return m
def capture_read(name,initial):
 m=capture_shape(name,initial);return C.read_file(PACKAGE/name,65536,metadata=m)
def execute(r):
 inv,copied=initial_fence(r)
 for n in (INTENT,FAILED,COMPLETED,STDOUT,STDERR,'source-copy-manifest.json','source-copy-completed.json'):need(absent(PACKAGE/n),'FINALIZE_EVIDENCE_COLLISION')
 absence=require_absent(show())
 # No mutation precedes the fully pinned existing-tree proof and collision gate.
 C.newfile(PACKAGE/INTENT,encode({'schema':'pow-audit30-source-copy-finalize-intent-v1','requestSHA256':REQUEST_SHA,'priorRequestSHA256':PRIOR_REQUEST_SHA,'priorFailureSHA256':r['inputs']['source-copy-failed.json']['sha256'],'sourceInventorySHA256':INVENTORY_SHA,'copiedPreflightSHA256':r['inputs']['copied-preflight.json']['sha256'],'utilitySHA256':UTILITY_SHA,'unit':UNIT,'argvSHA256':sha(encode(args())),'prelaunchUnitAbsence':absence,'sourceTreeNotModified':True}),0o600,0,0)
 native=readability(copied)
 final_inv,final_copy=initial_fence(r);need(final_inv==inv and final_copy==copied,'FINALIZE_FINAL_INPUT_DRIFT')
 manifest={'schema':'pow-audit30-onhost-math-source-copy-v1','candidateRoot':str(C.CANDIDATE),'sourceRoot':str(C.DEST),'candidateAttestationSHA256':C.ATTESTATION,'attestationBeforeSHA256':C.ATTESTATION,'attestationAfterSHA256':C.ATTESTATION,'sourceInventorySHA256':INVENTORY_SHA,'staticGraphSHA256':C.GRAPH_SHA,**copied,'sourceBytesExact':True,'candidateUnchanged':True,'nativeReadabilityPassed':True,'privateRawStateCopied':False}
 raw=encode(manifest);C.newfile(PACKAGE/'source-copy-manifest.json',raw)
 completed={'schema':'pow-audit30-source-copy-finalize-completed-v1','status':'completed','requestSHA256':REQUEST_SHA,'priorRequestSHA256':PRIOR_REQUEST_SHA,'priorFailureSHA256':r['inputs']['source-copy-failed.json']['sha256'],'priorAttemptRemainsFailed':True,'sourceCopyManifestSHA256':sha(raw),'sourceInventorySHA256':INVENTORY_SHA,'copiedPreflightSHA256':r['inputs']['copied-preflight.json']['sha256'],'nativeReadability':native,'sourceTreeNotModified':True,'candidateUnchanged':True,'productionMutation':False,'privateRawStateCopied':False}
 C.newfile(PACKAGE/COMPLETED,encode(completed),0o600,0,0)
 return {k:v for k,v in completed.items() if k!='nativeReadability'}|{'nativeReadabilityPassed':True,'InvocationID':native['InvocationID'],'unitStopVerified':native['ownedStop']['unitStopVerified'],'entryCount':copied['entryCount'],'regularBytes':copied['regularBytes']}
def failure_cleanup():
 global CLEANUP
 for s in (signal.SIGTERM,signal.SIGINT,signal.SIGHUP):signal.signal(s,signal.SIG_IGN)
 signal.setitimer(signal.ITIMER_REAL,0)
 if OWNED:
  try:stop_owned()
  except BaseException as e:CLEANUP={'attempted':True,'ownedInvocation':OWNED,'unitStopVerified':False,'errorClass':type(e).__name__,'code':str(e) if isinstance(e,(Refused,C.Refused)) else 'FINALIZE_CLEANUP_REFUSED'}
def main():
 global C,REQUEST_SHA
 need(len(sys.argv)==2 and SHA.fullmatch(sys.argv[1]) and os.geteuid()==os.getegid()==0,'FINALIZE_ROOT_FIXED_ARGV')
 old_alarm=signal.getsignal(signal.SIGALRM);old_signals={s:signal.getsignal(s) for s in (signal.SIGTERM,signal.SIGINT,signal.SIGHUP)}
 def expired(signum,frame):raise TimeoutError('FINALIZE_WHOLE_900S_DEADLINE')
 def interrupted(signum,frame):raise InterruptedError('FINALIZE_SIGNAL_INTERRUPTED')
 signal.signal(signal.SIGALRM,expired);signal.setitimer(signal.ITIMER_REAL,900)
 for s in old_signals:signal.signal(s,interrupted)
 r=None
 try:
  raw=sys.stdin.buffer.read(1024**2+1);need(len(raw)<=1024**2 and sha(raw)==sys.argv[1],'FINALIZE_REQUEST_RAW_SHA');REQUEST_SHA=sha(raw);r=parse(raw);utility=validate_request(r);C=load_utility(utility);C.DEADLINE=time.monotonic()+900
  try:return execute(r)
  except BaseException as e:
   failure_cleanup()
   try:C.newfile(PACKAGE/FAILED,encode({'schema':'pow-audit30-source-copy-finalize-failed-v1','status':'failed','requestSHA256':REQUEST_SHA,'code':str(e) if isinstance(e,(Refused,C.Refused)) else type(e).__name__,'nativeReadabilityCleanup':CLEANUP,'priorAttemptRemainsFailed':True,'sourceTreeNotModified':True,'productionMutation':False,'automaticRetry':False}),0o600,0,0)
   except BaseException:pass
   raise
 finally:
  signal.setitimer(signal.ITIMER_REAL,0);signal.signal(signal.SIGALRM,old_alarm)
  for s,h in old_signals.items():signal.signal(s,h)
if __name__=='__main__':
 try:result=main()
 except BaseException as e:
  print(json.dumps({'status':'refused','code':str(e) if isinstance(e,Refused) or (C and isinstance(e,C.Refused)) else type(e).__name__,'productionMutation':False,'priorAttemptRemainsFailed':True}));sys.exit(1)
 print(json.dumps(result))
