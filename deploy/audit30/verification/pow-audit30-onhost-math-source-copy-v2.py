#!/usr/bin/python3 -I
"""Creation-only code closure preparation, no SSH/SQL/API/private-state reads.
Only fixed attested3399 source files + its entire node_modules may be copied.
Inventory admission and source-copy preparation are separate reviewed requests.
"""
import base64,fcntl,hashlib,json,os,pathlib,pwd,re,selectors,signal,stat,subprocess,sys,time
P=pathlib.Path
CANDIDATE=P('/opt/proofofwork-api-stage-3399d767103e-20261003T020420Z')
BASE=P('/usr/local/lib/proofofwork-audit30-onhost-math');PACKAGE=BASE/'v2';DEST=PACKAGE/'source'
NODE=P('/opt/node-v24.18.0-linux-x64/bin/node');NODE_SHA='41a74efb34cbde5c7632cdac0cf8bd1a14d0b8d73dc1e82755014d9a9ce70f5c'
ATTESTOR=P('/var/tmp/proofofwork-deploy/audit29-tools/attest-node.py');ATTESTOR_SHA='4bec20fa1e5931636e3bfc84f617f005a7b1b71e752dc7f7c9b8bea23014be38'
PUBLISHER=P('/usr/local/sbin/proofofwork-node-release-publish');PUBLISHER_SHA='42ad099555cee0257572dd348a85a9f684005aba4f9c8f8077ea9aa67d68df78'
GRAPH_SHA='347ff2a86dd55f739b193a48ac7030126fe6114c2867b2f971dafc757d75cebe'
ATTESTATION='0ca029e59d44b6be5444d26d6d9af60d432f034f58c617647f2792f5d86c47a6'
PG_UID=108;PG_GID=112;MAX_BYTES=256*1024**2;MAX_FILE=32*1024**2;MAX_ENTRIES=100000
ENV={'PATH':'/usr/bin:/bin','LC_ALL':'C','GIT_OPTIONAL_LOCKS':'0','GIT_CONFIG_NOSYSTEM':'1','GIT_CONFIG_GLOBAL':'/dev/null'}
UNIT='proofofwork-audit30-math-source-readability-v2.service'
COPY_FILES=['package.json','scripts/fixtures/incb-replay-cutover-963781.json','scripts/migrate-work-precision-v2.mjs','server/canonical-op-return.mjs','server/canonical-order.mjs','server/proof-api.mjs','server/sql/proof-indexer-v1.sql','server/work-amo-v5-raw.mjs','server/work-amo-v5.mjs','server/work-amo-v6.mjs','server/work-amo-v7.mjs','server/work-amo-v8-activation-latch.mjs','server/work-amo-v8-declaration.mjs','server/work-amo-v8.mjs','server/work-precision-v2-marker.mjs','server/work-precision-v2-schema.mjs','server/work-units.mjs','server/work-wallet-capacity.mjs','server/work-wallet-capacity.test.mjs','src/shared/protocol/dnsSubdomains.mjs']
MEMBER_PINS={'operator.mjs':'9794e0307d52fd69e495e475c3b234b532752731fb947cee1bfd5968dfdee7e0','source-graph.mjs':'3a7e462db64580ffac9fdbd39c8ef041973239a6d15891d1c00305a6d291255d','original-oracle-v3.mjs':'b1d93c6b9f4cf7f1bd839146581f1a1d202b59ff54fa3364e72f1496cbaaee7d','typescript.cjs':'3ae902c92cc44dace175c0e69e13a4b0899f6983c6121d76b9ab8dd5795e7675','canonical-sample-witness.json':'86ae268a2fe863d43e139964410584140d2ebecbe87af7075d0ecaeb36aca560'}
SHA=re.compile('[a-f0-9]{64}');DEADLINE=None;REQUEST_SHA=None;CLEANUP_STATUS=None
class Refused(Exception):pass
def need(v,code):
 if not v:raise Refused(code)
def sha(b):return hashlib.sha256(b).hexdigest()
def encode(v):return json.dumps(v,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()
def pairs(rows):
 d={}
 for k,v in rows:
  need(k not in d,'DUPLICATE_JSON_KEY');d[k]=v
 return d
def parse(b):return json.loads(b,object_pairs_hook=pairs)
def guard():
 if DEADLINE is not None:need(time.monotonic()<DEADLINE,'COPY_900S_DEADLINE')
def stamp(s):return {'dev':str(s.st_dev),'ino':str(s.st_ino),'uid':s.st_uid,'gid':s.st_gid,'mode':stat.S_IMODE(s.st_mode),'nlink':str(s.st_nlink),'bytes':str(s.st_size),'mtimeNs':str(s.st_mtime_ns),'ctimeNs':str(s.st_ctime_ns)}
def fsyncdir(p):
 fd=os.open(p,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
 try:os.fsync(fd)
 finally:os.close(fd)
def noalias(p):need(p.is_absolute() and p.resolve(strict=True)==p,'COPY_PATH_ALIAS');return p
def xattrs(p):return os.listxattr(p,follow_symlinks=False)
def read_file(p,limit=MAX_FILE,expected=None,metadata=None):
 guard();noalias(p);before=p.lstat();need(stat.S_ISREG(before.st_mode) and before.st_nlink==1 and 0<=before.st_size<=limit and not xattrs(p),'COPY_SOURCE_FILE_SHAPE')
 if metadata is not None:need(stamp(before)==metadata,'COPY_SOURCE_METADATA_DRIFT')
 fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW|os.O_NOATIME);chunks=[]
 try:
  need(stamp(os.fstat(fd))==stamp(before),'COPY_SOURCE_FD_DRIFT');count=0
  while True:
   guard();b=os.read(fd,1024*1024)
   if not b:break
   count+=len(b);need(count<=limit,'COPY_SOURCE_FILE_CAP');chunks.append(b)
  raw=b''.join(chunks);need(stamp(os.fstat(fd))==stamp(before)==stamp(p.lstat()),'COPY_SOURCE_READ_DRIFT')
  if expected is not None:need(sha(raw)==expected,'COPY_SOURCE_DIGEST_DRIFT')
  return raw
 finally:os.close(fd)
def newfile(p,raw,mode=0o440,uid=0,gid=PG_GID):
 fd=os.open(p,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,mode)
 try:
  view=memoryview(raw)
  while view:view=view[os.write(fd,view):]
  os.fchown(fd,uid,gid);os.fchmod(fd,mode);os.fsync(fd)
 finally:os.close(fd)
 fsyncdir(p.parent)
def newdir(p,uid=0,gid=PG_GID):
 p.mkdir(mode=0o750);os.chown(p,uid,gid);os.chmod(p,0o750);fsyncdir(p.parent)
def reserve(additional=0):
 s=os.statvfs('/');need(s.f_bavail*s.f_frsize>=10*1024**3+additional,'COPY_ROOT_10GIB_RESERVE')
def scoped_path(name):
 need(isinstance(name,str) and name and len(name)<4096 and '\x00' not in name and '\\' not in name and not name.startswith('/') and pathlib.PurePosixPath(name).as_posix()==name and all(x not in ('..','.git','.env','.env.local') for x in name.split('/')),'COPY_MEMBER_PATH')
 return name
def inventory_tree(root,files=COPY_FILES):
 guard();noalias(root);need(root.is_dir(),'COPY_SOURCE_ROOT');paths={'.','node_modules'}
 for n in files:
  scoped_path(n);paths.add(n);parent=pathlib.PurePosixPath(n).parent
  while str(parent)!='.':paths.add(str(parent));parent=parent.parent
 rows={};bytes_=0;source_uid=root.lstat().st_uid
 def visit(name,recursive=False):
  nonlocal bytes_
  guard();scoped_path(name);need(len(rows)<MAX_ENTRIES,'COPY_ENTRY_CAP');p=root if name=='.' else root/name;before=p.lstat();need(not xattrs(p),'COPY_SOURCE_XATTR');kind='file' if stat.S_ISREG(before.st_mode) else 'directory' if stat.S_ISDIR(before.st_mode) else 'symlink' if stat.S_ISLNK(before.st_mode) else 'other';need(kind!='other','COPY_SOURCE_KIND');need(before.st_uid==source_uid,'COPY_SOURCE_OWNER');r={'path':name,'kind':kind,'metadata':stamp(before)}
  if kind=='file':
   need(before.st_nlink==1 and not before.st_mode&0o002 and before.st_size<=MAX_FILE,'COPY_SOURCE_FILE_UNSAFE');raw=read_file(p,MAX_FILE,metadata=r['metadata']);r['sha256']=sha(raw);bytes_+=len(raw);need(bytes_<=MAX_BYTES,'COPY_TOTAL_256MIB_CAP')
  elif kind=='symlink':
   need(name.startswith('node_modules/') and before.st_nlink==1,'COPY_SOURCE_SYMLINK_SCOPE');target=os.readlink(p);need(target and not target.startswith('/') and '\x00' not in target and '\\' not in target,'COPY_SYMLINK_TARGET');resolved=p.resolve(strict=True);need(resolved.is_relative_to(root/'node_modules') and resolved!=root/'node_modules','COPY_SYMLINK_ESCAPE');r['target']=target
  else:
   noalias(p);need(not before.st_mode&0o002,'COPY_SOURCE_DIRECTORY_UNSAFE')
  rows[name]=r
  if recursive and kind=='directory':
   for child in sorted(os.listdir(p)):visit(name+'/'+child,True)
  need(stamp(before)==stamp(p.lstat()),'COPY_SOURCE_CENSUS_DRIFT')
 for name in sorted(paths):visit(name,name=='node_modules')
 result=[rows[n] for n in sorted(rows)];need(all(n in rows and rows[n]['kind']=='file' for n in files),'COPY_SOURCE_REQUIRED_FILES')
 for r in result:
  if r['kind']=='symlink':
   t=os.path.normpath(os.path.join(os.path.dirname(r['path']),r['target']));need(t in rows and t.startswith('node_modules/'),'COPY_SYMLINK_UNADMITTED_TARGET')
 return {'entries':result,'entryCount':len(result),'regularBytes':bytes_}
def tool_checked(path,digest,limit,expected):
 raw=read_file(path,limit,expected=digest,metadata=expected);s=path.lstat();need(s.st_uid==0 and not s.st_mode&0o022,'COPY_TOOL_OWNER');return raw
def run_checked(argv,timeout,cap,observer=None):
 guard();proc=subprocess.Popen(argv,env=ENV,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,start_new_session=True);sel=selectors.DefaultSelector();out=bytearray();err=bytearray();end=time.monotonic()+timeout
 try:
  for pipe,label in ((proc.stdout,0),(proc.stderr,1)):os.set_blocking(pipe.fileno(),False);sel.register(pipe,selectors.EVENT_READ,label)
  while sel.get_map():
   guard();need(time.monotonic()<end,'COPY_COMMAND_DEADLINE')
   if observer:observer()
   for key,_ in sel.select(.1):
    b=os.read(key.fileobj.fileno(),65536)
    if not b:sel.unregister(key.fileobj);continue
    target=out if key.data==0 else err;target.extend(b);need(len(target)<=(cap if key.data==0 else 65536),'COPY_COMMAND_OUTPUT_CAP')
  code=proc.wait(timeout=max(.01,end-time.monotonic()));need(code==0 and not err,'COPY_COMMAND_REFUSED');guard();return bytes(out)
 except BaseException:
  try:os.killpg(proc.pid,signal.SIGKILL)
  except ProcessLookupError:pass
  proc.wait(timeout=10);raise
 finally:
  sel.close();proc.stdout.close();proc.stderr.close()
def attest():return run_checked(['/usr/bin/python3','-I','-B',str(ATTESTOR),str(CANDIDATE)],180,8*1024**2)
def package_fence():
 noalias(PACKAGE);s=PACKAGE.lstat();need(stat.S_ISDIR(s.st_mode) and (s.st_uid,s.st_gid,stat.S_IMODE(s.st_mode))==(0,PG_GID,0o750) and not xattrs(PACKAGE),'COPY_PACKAGE_SHAPE')
 for n,h in MEMBER_PINS.items():
  p=PACKAGE/n;read_file(p,12*1024**2,h);a=p.lstat();need((a.st_uid,a.st_gid,stat.S_IMODE(a.st_mode))==(0,PG_GID,0o440),'COPY_PACKAGE_MEMBER_OWNER')
 original=read_file(PACKAGE/'original-oracle-v3.mjs',65536,MEMBER_PINS['original-oracle-v3.mjs']);need(original.count(b'/home/sixer/ProofOfWork.Me')==10,'COPY_ORACLE_ROOT_LITERAL_COUNT');relocated=original.replace(b"import ts from '/home/sixer/ProofOfWork.Me/node_modules/typescript/lib/typescript.js';",b"import ts from './typescript.cjs';").replace(b'/home/sixer/ProofOfWork.Me',str(DEST).encode());need(read_file(PACKAGE/'oracle-relocated-v3.mjs',65536)==relocated,'COPY_ORACLE_LITERAL_RELOCATION')
def validate_request(r):
 need(isinstance(r,dict) and r.get('schema')=='pow-audit30-math-source-copy-request-v1' and r.get('mode') in ('inventory','prepare'),'COPY_REQUEST_SCHEMA');keys={'schema','mode','candidateRoot','candidateAttestationSHA256','nodeMetadata','attestorMetadata','publisherMetadata'}|({'members'} if r['mode']=='inventory' else {'sourceInventorySHA256'})
 need(set(r)==keys and r['candidateRoot']==str(CANDIDATE) and r['candidateAttestationSHA256']==ATTESTATION,'COPY_REQUEST_SCOPE')
 for k in ('nodeMetadata','attestorMetadata','publisherMetadata'):need(isinstance(r[k],dict) and set(r[k])==set(stamp(os.stat('/'))),'COPY_REQUEST_TOOL_METADATA')
 if r['mode']=='prepare':need(isinstance(r['sourceInventorySHA256'],str) and SHA.fullmatch(r['sourceInventorySHA256']),'COPY_REQUEST_INVENTORY_SHA')
 else:
  need(isinstance(r['members'],dict) and set(r['members'])==set(MEMBER_PINS),'COPY_REQUEST_CODE_MEMBERS')
  total=0
  for n in MEMBER_PINS:
   raw=base64.b64decode(r['members'][n],validate=True);total+=len(raw);need(sha(raw)==MEMBER_PINS[n] and 0<len(raw)<=12*1024**2,'COPY_REQUEST_CODE_BYTES')
  need(total<=16*1024**2,'COPY_CODE_PACKAGE_CAP')
 return r
def check_tools(r):
 need(pwd.getpwnam('postgres').pw_uid==PG_UID and pwd.getpwnam('postgres').pw_gid==PG_GID,'COPY_NATIVE_PG_ROLE')
 tool_checked(NODE,NODE_SHA,128*1024**2,r['nodeMetadata']);tool_checked(ATTESTOR,ATTESTOR_SHA,65536,r['attestorMetadata']);tool_checked(PUBLISHER,PUBLISHER_SHA,512*1024,r['publisherMetadata'])
def install_code(r):
 need(not PACKAGE.exists() and not PACKAGE.is_symlink(),'COPY_PACKAGE_COLLISION');noalias(BASE.parent);reserve(16*1024**2)
 if BASE.exists():
  noalias(BASE);s=BASE.lstat();need(s.st_uid==0 and stat.S_ISDIR(s.st_mode) and not s.st_mode&0o022 and not xattrs(BASE),'COPY_BASE_OWNER')
 else:newdir(BASE)
 newdir(PACKAGE)
 for n in MEMBER_PINS:newfile(PACKAGE/n,base64.b64decode(r['members'][n],validate=True))
 original=base64.b64decode(r['members']['original-oracle-v3.mjs']);relocated=original.replace(b"import ts from '/home/sixer/ProofOfWork.Me/node_modules/typescript/lib/typescript.js';",b"import ts from './typescript.cjs';").replace(b'/home/sixer/ProofOfWork.Me',str(DEST).encode());newfile(PACKAGE/'oracle-relocated-v3.mjs',relocated);package_fence()
def copy_tree(source,dest,inventory,uid=0,gid=PG_GID):
 need(not dest.exists() and not dest.is_symlink(),'COPY_DESTINATION_COLLISION');reserve(inventory['regularBytes']+64*1024**2);rows=inventory['entries'];newdir(dest,uid,gid)
 for r in rows:
  guard();name=r['path'];p=source if name=='.' else source/name;target=dest if name=='.' else dest/name;need(stamp(p.lstat())==r['metadata'],'COPY_PRECOPY_SOURCE_DRIFT')
  if name=='.':continue
  if r['kind']=='directory':newdir(target,uid,gid)
  elif r['kind']=='file':newfile(target,read_file(p,MAX_FILE,r['sha256'],r['metadata']),0o440,uid,gid)
  else:
   need(os.readlink(p)==r['target'],'COPY_PRECOPY_LINK_DRIFT');os.symlink(r['target'],target);os.lchown(target,uid,gid);fsyncdir(target.parent)
  need(stamp(p.lstat())==r['metadata'],'COPY_POSTCOPY_SOURCE_DRIFT')
 result=[]
 for r in rows:
  p=dest if r['path']=='.' else dest/r['path'];q=dict(r);q['metadata']=stamp(p.lstat());result.append(q)
 return {'entries':result,'entryCount':len(result),'regularBytes':inventory['regularBytes']}
READABILITY="""import fs from'node:fs';import crypto from'node:crypto';const root='/usr/local/lib/proofofwork-audit30-onhost-math/v2/source';if(process.getuid()!==108||process.getgid()!==112)throw Error('ROLE');const want=JSON.parse(fs.readFileSync('/usr/local/lib/proofofwork-audit30-onhost-math/v2/copied-preflight.json'));const sha=b=>crypto.createHash('sha256').update(b).digest('hex');let n=0;for(const r of want.entries){const p=r.path==='.'?root:root+'/'+r.path;const s=fs.lstatSync(p);if(s.uid!==0||s.gid!==112)throw Error('OWNER');if(r.kind==='file'){if((s.mode&511)!==288||s.nlink!==1||sha(fs.readFileSync(p))!==r.sha256)throw Error('BYTES');}else if(r.kind==='directory'){if((s.mode&511)!==488||fs.realpathSync(p)!==p)throw Error('DIR');fs.readdirSync(p);}else{if(fs.readlinkSync(p)!==r.target||!fs.realpathSync(p).startsWith(root+'/node_modules/'))throw Error('LINK');}n++;}process.stdout.write(JSON.stringify({uid:process.getuid(),gid:process.getgid(),entries:n,allSourceAndDependenciesReadable:true})+'\\n');"""
UNIT_PROPERTIES='LoadState,User,Group,InvocationID,MainPID,ExecStart,MemoryMax,MemorySwapMax,CPUQuotaPerSecUSec,TasksMax,RuntimeMaxUSec,Restart,NoNewPrivileges,PrivateNetwork,CapabilityBoundingSet,Result,ExecMainStatus'
def parse_shape(raw):
 lines=[x.split('=',1) for x in raw.decode().splitlines() if '=' in x];need(len({r[0] for r in lines})==len(lines),'COPY_DUPLICATE_UNIT_PROPERTY');return dict(lines)
def unit_shape():
 return parse_shape(run_checked(['/usr/bin/systemctl','show',UNIT,'--property='+UNIT_PROPERTIES],10,65536))
def cleanup_capture(argv):
 # This independent 20-second path is available solely for owned unit stop/show.
 allowed=[['/usr/bin/systemctl','show',UNIT,'--property='+UNIT_PROPERTIES],['/usr/bin/systemctl','stop',UNIT]]
 need(argv in allowed,'COPY_CLEANUP_FIXED_COMMAND');proc=subprocess.Popen(argv,env=ENV,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,start_new_session=True);sel=selectors.DefaultSelector();out=bytearray();err=bytearray();end=time.monotonic()+20
 try:
  for pipe,label in ((proc.stdout,0),(proc.stderr,1)):os.set_blocking(pipe.fileno(),False);sel.register(pipe,selectors.EVENT_READ,label)
  while sel.get_map():
   need(time.monotonic()<end,'COPY_CLEANUP_20S_DEADLINE')
   for key,_ in sel.select(.1):
    b=os.read(key.fileobj.fileno(),65536)
    if not b:sel.unregister(key.fileobj);continue
    target=out if key.data==0 else err;target.extend(b);need(len(target)<=65536,'COPY_CLEANUP_OUTPUT_CAP')
  code=proc.wait(timeout=max(.01,end-time.monotonic()));need(code==0 and not err,'COPY_CLEANUP_COMMAND_REFUSED');return bytes(out)
 except BaseException:
  try:os.killpg(proc.pid,signal.SIGKILL)
  except ProcessLookupError:pass
  proc.wait(timeout=10);raise
 finally:sel.close();proc.stdout.close();proc.stderr.close()
def validate_readability_shape(u,invocation=None,stopped=False):
 need(u.get('User')=='postgres' and u.get('Group')=='postgres' and str(NODE) in u.get('ExecStart','') and str(PACKAGE/'read-copy.mjs') in u.get('ExecStart','') and re.fullmatch('[a-f0-9]{32}',u.get('InvocationID','')),'COPY_READABILITY_STARTED_IDENTITY')
 if invocation:need(u['InvocationID']==invocation,'COPY_READABILITY_INVOCATION_DRIFT')
 need(u.get('MemoryMax')=='1073741824' and u.get('MemorySwapMax')=='0' and u.get('CPUQuotaPerSecUSec')=='500ms' and u.get('TasksMax')=='32' and u.get('RuntimeMaxUSec') in ('2min','120s') and u.get('Restart')=='no' and u.get('NoNewPrivileges')=='yes' and u.get('PrivateNetwork')=='yes' and u.get('CapabilityBoundingSet')=='','COPY_READABILITY_ACTUAL_RESOURCE_SHAPE')
 if stopped:need(u.get('MainPID')=='0' and u.get('Result')=='success' and u.get('ExecMainStatus')=='0','COPY_READABILITY_UNIT_NOT_STOPPED')
 return u
def owned_stop(invocation):
 u=parse_shape(cleanup_capture(['/usr/bin/systemctl','show',UNIT,'--property='+UNIT_PROPERTIES]))
 if u.get('LoadState')=='not-found':return {'attempted':True,'ownedInvocation':invocation,'unitAlreadyAbsent':True,'unitStopVerified':True}
 need(invocation and u.get('InvocationID')==invocation and u.get('User')=='postgres' and u.get('Group')=='postgres' and str(NODE) in u.get('ExecStart','') and str(PACKAGE/'read-copy.mjs') in u.get('ExecStart',''),'COPY_READABILITY_STOP_IDENTITY');cleanup_capture(['/usr/bin/systemctl','stop',UNIT]);after=parse_shape(cleanup_capture(['/usr/bin/systemctl','show',UNIT,'--property='+UNIT_PROPERTIES]));need(after.get('LoadState')=='not-found' or (after.get('InvocationID')==invocation and after.get('MainPID')=='0'),'COPY_READABILITY_STILL_RUNNING');return {'attempted':True,'ownedInvocation':invocation,'unitStopVerified':True}
def native_readability(copied):
 global CLEANUP_STATUS
 need(unit_shape().get('LoadState')=='not-found','COPY_READABILITY_UNIT_COLLISION');newfile(PACKAGE/'copied-preflight.json',encode(copied));newfile(PACKAGE/'read-copy.mjs',READABILITY.encode());read_file(PACKAGE/'read-copy.mjs',65536,sha(READABILITY.encode()))
 args=['/usr/bin/systemd-run','--quiet','--wait','--pipe','--unit='+UNIT,'--property=User=postgres','--property=Group=postgres','--property=RuntimeMaxSec=120s','--property=MemoryMax=1G','--property=MemorySwapMax=0','--property=CPUQuota=50%','--property=TasksMax=32','--property=TimeoutStopSec=10s','--property=KillMode=control-group','--property=Restart=no','--property=NoNewPrivileges=yes','--property=PrivateTmp=yes','--property=PrivateDevices=yes','--property=PrivateNetwork=yes','--property=RestrictAddressFamilies=AF_UNIX','--property=ProtectSystem=strict','--property=ProtectHome=yes','--property=ProtectKernelTunables=yes','--property=ProtectKernelModules=yes','--property=ProtectControlGroups=yes','--property=RestrictSUIDSGID=yes','--property=CapabilityBoundingSet=','--property=UMask=0077','/usr/bin/env','-i','PATH=/usr/bin:/bin','LC_ALL=C',str(NODE),str(PACKAGE/'read-copy.mjs')]
 newfile(PACKAGE/'readability-intent.json',encode({'unit':UNIT,'argvSHA256':sha(encode(args)),'uid':PG_UID,'gid':PG_GID}),0o600,0,0)
 owned=[]
 def observe():
  if owned:return
  u=unit_shape()
  if u.get('LoadState')!='not-found' and u.get('InvocationID'):
   validate_readability_shape(u);owned.append(u['InvocationID'])
 try:
  raw=run_checked(args,135,65536,observe);observe();read_file(PACKAGE/'read-copy.mjs',65536,sha(READABILITY.encode()));v=parse(raw);need(v=={'uid':PG_UID,'gid':PG_GID,'entries':copied['entryCount'],'allSourceAndDependenciesReadable':True},'COPY_READABILITY_RECEIPT');u=validate_readability_shape(unit_shape(),owned[0] if owned else None,stopped=True);return {'receipt':v,'stdoutSha256':sha(raw),'InvocationID':u['InvocationID'],'actualUnitProperties':u}
 except BaseException:
  for s in (signal.SIGTERM,signal.SIGINT,signal.SIGHUP):signal.signal(s,signal.SIG_IGN)
  signal.setitimer(signal.ITIMER_REAL,0)
  CLEANUP_STATUS={'attempted':bool(owned),'unitStopVerified':False,'ownedInvocation':owned[0] if owned else None}
  if owned:
   try:CLEANUP_STATUS=owned_stop(owned[0])
   except BaseException as e:CLEANUP_STATUS['cleanupError']=str(e) if isinstance(e,Refused) else type(e).__name__
  raise
def execute(r):
 check_tools(r);reserve();need(sha(attest())==ATTESTATION,'COPY_INITIAL_WHOLE_ATTESTATION')
 if r['mode']=='inventory':install_code(r)
 package_fence();graphraw=run_checked([str(NODE),str(PACKAGE/'source-graph.mjs')],60,1024**2);g=parse(graphraw);need(sha(graphraw)==GRAPH_SHA,'COPY_EXACT_STATIC_GRAPH');need(g['candidateCodeExecuted'] is False and g['readOnlyFiles']==COPY_FILES and len(g['runtimeFiles'])==14 and g['allExternalPackagesCopiedAsWholeNodeModules'] is True,'COPY_STATIC_RUNTIME_CLOSURE');inv=inventory_tree(CANDIDATE);need(sha(attest())==ATTESTATION,'COPY_INVENTORY_WHOLE_ATTESTATION');check_tools(r)
 full={'schema':'pow-audit30-onhost-source-inventory-v1','candidateRoot':str(CANDIDATE),'candidateAttestationSHA256':ATTESTATION,'staticGraphSHA256':sha(graphraw),'staticGraph':g,**inv,'sourceBytesCap':MAX_BYTES,'sourceFileCap':MAX_FILE,'sourceEntryCap':MAX_ENTRIES,'rootReserveBytes':10*1024**3,'privateRawStateCopied':False}
 if r['mode']=='inventory':newfile(PACKAGE/'source-inventory.json',encode(full),0o600,0,0);return {'status':'inventoried','sourceInventorySHA256':sha(encode(full)),'entryCount':inv['entryCount'],'regularBytes':inv['regularBytes'],'sourceFiles':g['readOnlyFiles'],'runtimeFiles':g['runtimeFiles'],'candidateUnchanged':True,'productionMutation':False,'sourceCopyNotYetCreated':True}
 old=read_file(PACKAGE/'source-inventory.json',32*1024**2,r['sourceInventorySHA256']);need(parse(old)==full,'COPY_REVIEWED_INVENTORY_DRIFT');need(not DEST.exists() and not DEST.is_symlink(),'COPY_DESTINATION_COLLISION');newfile(PACKAGE/'source-copy-intent.json',encode({'requestSHA256':REQUEST_SHA,'sourceInventorySHA256':sha(old),'sourceDestination':str(DEST),'candidateAttestationSHA256':ATTESTATION}),0o600,0,0)
 copied=copy_tree(CANDIDATE,DEST,inv);need(inventory_tree(CANDIDATE)==inv,'COPY_SOURCE_POSTCOPY_METADATA');need(sha(attest())==ATTESTATION,'COPY_AFTER_WHOLE_ATTESTATION');readability=native_readability(copied);package_fence();need(inventory_tree(CANDIDATE)==inv and sha(attest())==ATTESTATION,'COPY_FINAL_WHOLE_ATTESTATION');check_tools(r)
 for row in copied['entries']:
  p=DEST if row['path']=='.' else DEST/row['path'];need(stamp(p.lstat())==row['metadata'],'COPY_DESTINATION_METADATA_DRIFT')
  if row['kind']=='file':read_file(p,MAX_FILE,row['sha256'],row['metadata'])
 manifest={'schema':'pow-audit30-onhost-math-source-copy-v1','candidateRoot':str(CANDIDATE),'sourceRoot':str(DEST),'candidateAttestationSHA256':ATTESTATION,'attestationBeforeSHA256':ATTESTATION,'attestationAfterSHA256':ATTESTATION,'sourceInventorySHA256':sha(old),'staticGraphSHA256':sha(graphraw),**copied,'sourceBytesExact':True,'candidateUnchanged':True,'nativeReadabilityPassed':True,'privateRawStateCopied':False};raw=encode(manifest);newfile(PACKAGE/'source-copy-manifest.json',raw);newfile(PACKAGE/'source-copy-completed.json',encode({'status':'completed','sourceCopyManifestSHA256':sha(raw),'nativeReadability':readability,'sourceInventorySHA256':sha(old),'sourceBytesExact':True,'candidateUnchanged':True,'productionMutation':False}),0o600,0,0)
 return {'status':'completed','sourceCopyManifestSHA256':sha(raw),'sourceInventorySHA256':sha(old),'entryCount':copied['entryCount'],'regularBytes':copied['regularBytes'],'nativeUid':PG_UID,'nativeGid':PG_GID,'nativeReadabilityPassed':True,'candidateUnchanged':True,'productionMutation':False,'privateRawStateCopied':False}
def arm_wall_deadline(seconds=900):
 old=signal.getsignal(signal.SIGALRM)
 def expired(signum,frame):raise TimeoutError('COPY_WHOLE_900S_DEADLINE')
 signal.signal(signal.SIGALRM,expired);signal.setitimer(signal.ITIMER_REAL,seconds);return old
def main():
 global DEADLINE,REQUEST_SHA
 need(len(sys.argv)==2 and SHA.fullmatch(sys.argv[1]) and os.geteuid()==os.getegid()==0,'COPY_ROOT_FIXED_ARGV');DEADLINE=time.monotonic()+900;old_alarm=arm_wall_deadline();r=None
 def interrupted(signum,frame):raise InterruptedError('COPY_SIGNAL_INTERRUPTED')
 for s in (signal.SIGTERM,signal.SIGINT,signal.SIGHUP):signal.signal(s,interrupted)
 try:
  raw=sys.stdin.buffer.read(24*1024**2+1);need(len(raw)<=24*1024**2 and sha(raw)==sys.argv[1],'COPY_REQUEST_RAW_SHA');r=validate_request(parse(raw));REQUEST_SHA=sha(raw)
  try:return execute(r)
  except BaseException as e:
   for s in (signal.SIGTERM,signal.SIGINT,signal.SIGHUP):signal.signal(s,signal.SIG_IGN)
   signal.setitimer(signal.ITIMER_REAL,0)
   if PACKAGE.exists() and PACKAGE.resolve()==PACKAGE:
    path=PACKAGE/('source-copy-failed.json' if r['mode']=='prepare' else 'source-inventory-failed.json')
    try:newfile(path,encode({'status':'failed','mode':r['mode'],'code':str(e) if isinstance(e,Refused) else type(e).__name__,'requestSHA256':REQUEST_SHA,'automaticRetry':False,'productionMutation':False,'partialPrivateArtifactsPreserved':True,'nativeReadabilityCleanup':CLEANUP_STATUS}),0o600,0,0)
    except BaseException:pass
   raise
 finally:signal.setitimer(signal.ITIMER_REAL,0);signal.signal(signal.SIGALRM,old_alarm)
if __name__=='__main__':
 try:result=main()
 except BaseException as e:
  print(json.dumps({'status':'refused','code':str(e) if isinstance(e,Refused) else type(e).__name__,'productionMutation':False,'partialPrivateArtifactsPreserved':True}));sys.exit(1)
 print(json.dumps(result))
