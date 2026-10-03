#!/usr/bin/python3 -I
"""Fixed tiny PG-role output property probe; no SQL/Core/application access."""
import hashlib,json,os,pathlib,re,signal,stat,subprocess,sys,time
P=pathlib.Path
UNIT='proofofwork-audit30-output-property-probe-20261003T034500Z.service'
DIRECTORY=P('/var/tmp/proofofwork-audit30-output-property-probe-20261003T034500Z')
OUT=DIRECTORY/'stdout.json';ERR=DIRECTORY/'stderr.txt'
FRAGMENT=P('/run/systemd/transient')/UNIT
CODE='import os,sys,time;time.sleep(0.3);print("{\\"outputPropertyProbe\\":true,\\"uid\\":%d,\\"gid\\":%d}"%(os.getuid(),os.getgid()),flush=True);sys.stderr.write("audit30-output-property-probe\\n");sys.stderr.flush()'
ARGV=['/usr/bin/python3','-I','-B','-c',CODE]
ENV={'PATH':'/usr/sbin:/usr/bin:/sbin:/bin','LC_ALL':'C'}
FIELDS=('LoadState','ActiveState','SubState','Type','Transient','RemainAfterExit','User','Group','MainPID','InvocationID','ControlGroup','Result','ExecMainStatus','FragmentPath','DropInPaths','SourcePath','MemoryMax','MemorySwapMax','CPUQuotaPerSecUSec','TasksMax','RuntimeMaxUSec','TimeoutStartUSec','TimeoutStopUSec','NoNewPrivileges','PrivateNetwork','PrivateTmp','PrivateDevices','RestrictAddressFamilies','ProtectSystem','ProtectHome','CapabilityBoundingSet','AmbientCapabilities','StandardInput','StandardOutput','StandardError','UMask','LimitFSIZE','KillMode','Restart')
PROPS={'Type':'oneshot','RemainAfterExit':'yes','User':'postgres','Group':'postgres','RuntimeMaxSec':'5s','TimeoutStartSec':'5s','TimeoutStopSec':'5s','MemoryMax':'32M','MemorySwapMax':'0','CPUQuota':'10%','TasksMax':'8','NoNewPrivileges':'yes','PrivateNetwork':'yes','RestrictAddressFamilies':'AF_UNIX','ProtectSystem':'strict','ProtectHome':'yes','PrivateTmp':'yes','PrivateDevices':'yes','CapabilityBoundingSet':'','AmbientCapabilities':'','StandardInput':'null','StandardOutput':'file:'+str(OUT),'StandardError':'append:'+str(ERR),'KillMode':'control-group','Restart':'no','UMask':'0077','LimitFSIZE':'2K'}
OWNED=None;LAUNCHED=False;DEADLINE=None
class Refused(Exception):pass
def need(v,m):
 if not v:raise Refused(m)
def sha(raw):return hashlib.sha256(raw).hexdigest()
def encode(v):return json.dumps(v,sort_keys=True,separators=(',',':')).encode()
def pairs(rows):
 d={}
 for k,v in rows:need(k not in d,'DUPLICATE_JSON_KEY');d[k]=v
 return d
def parse(raw):return json.loads(raw,object_pairs_hook=pairs)
def stamp(s):return {'dev':str(s.st_dev),'ino':str(s.st_ino),'mode':stat.S_IMODE(s.st_mode),'uid':s.st_uid,'gid':s.st_gid,'nlink':str(s.st_nlink),'bytes':str(s.st_size),'mtimeNs':str(s.st_mtime_ns),'ctimeNs':str(s.st_ctime_ns)}
def guard():need(time.monotonic()<DEADLINE,'WHOLE_60S_DEADLINE')
def cmd(a,cleanup=False):
 if not cleanup:guard()
 r=subprocess.run(a,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=10,env=ENV,cwd='/');need(r.returncode==0 and len(r.stdout)<=65536 and len(r.stderr)<=65536,'FIXED_COMMAND_REFUSED_'+sha(r.stderr));return r.stdout

def props(cleanup=False):
 d={}
 for line in cmd(['/usr/bin/systemctl','show',UNIT,'--no-pager','--property='+','.join(FIELDS)],cleanup).decode().splitlines():
  k,sep,v=line.partition('=');need(sep and k not in d,'UNIT_PROPERTY_SHAPE');d[k]=v
 need(set(d)==set(FIELDS),'UNIT_PROPERTY_MISSING');return d

def typed(cleanup=False):
 m=parse(cmd(['/usr/bin/busctl','--system','--json=short','call','org.freedesktop.systemd1','/org/freedesktop/systemd1','org.freedesktop.systemd1.Manager','GetUnit','s',UNIT],cleanup));need(isinstance(m,dict) and set(m)=={'type','data'} and m['type']=='o' and isinstance(m['data'],list) and len(m['data'])==1 and isinstance(m['data'][0],str) and re.fullmatch('/org/freedesktop/systemd1/unit/[A-Za-z0-9_]+',m['data'][0]),'TYPED_MANAGER')
 e=parse(cmd(['/usr/bin/busctl','--system','--json=short','get-property','org.freedesktop.systemd1',m['data'][0],'org.freedesktop.systemd1.Service','ExecStart'],cleanup));need(isinstance(e,dict) and set(e)=={'type','data'} and e['type']=='a(sasbttttuii)' and isinstance(e['data'],list) and len(e['data'])==1,'TYPED_SINGLE_EXECSTART');v=e['data'][0];need(isinstance(v,list) and len(v)==10 and v[0]==ARGV[0] and v[1]==ARGV and v[2] is False and all(type(n)is int and n>=0 for n in v[3:]),'TYPED_LITERAL_ARGV');return {'objectPath':m['data'][0],'argvSha256':sha(encode(ARGV))}

def identity(v,owned=None):
 fixed=v.get('ControlGroup')=='/system.slice/'+UNIT
 retained=v.get('ControlGroup')=='' and v.get('MainPID')=='0' and v.get('ActiveState')=='active' and v.get('SubState')=='exited' and v.get('Result')=='success' and v.get('ExecMainStatus')=='0'
 need(v.get('LoadState')=='loaded' and v.get('Type')=='oneshot' and v.get('Transient')=='yes' and v.get('RemainAfterExit')=='yes' and v.get('User')==v.get('Group')=='postgres' and re.fullmatch('[0-9a-f]{32}',v.get('InvocationID','')) and (owned is None or v['InvocationID']==owned) and (fixed or retained),'OWNED_IDENTITY')

def validate_resources(v):
 expected={'MemoryMax':str(32*1024**2),'MemorySwapMax':'0','CPUQuotaPerSecUSec':'100ms','TasksMax':'8','RuntimeMaxUSec':'5s','TimeoutStartUSec':'5s','TimeoutStopUSec':'5s','NoNewPrivileges':'yes','PrivateNetwork':'yes','PrivateTmp':'yes','PrivateDevices':'yes','RestrictAddressFamilies':'AF_UNIX','ProtectSystem':'strict','ProtectHome':'yes','CapabilityBoundingSet':'','AmbientCapabilities':'','UMask':'0077','LimitFSIZE':'2048','KillMode':'control-group','Restart':'no','StandardInput':'null'}
 need(all(v.get(k)==x for k,x in expected.items()),'ACTUAL_RESOURCE_OR_NAMESPACE_DRIFT')

def validate_fragment(raw):
 # Unknown manager-generated directives remain internal. Output selection
 # must have exactly one expected occurrence, in the Service section.
 text=raw.decode('utf-8');section='';found={};want={'StandardInput':'null','StandardOutput':PROPS['StandardOutput'],'StandardError':PROPS['StandardError']}
 for line in text.splitlines():
  line=line.strip()
  if not line or line.startswith(('#',';')):continue
  need(not line.endswith('\\'),'FRAGMENT_CONTINUATION_REFUSED')
  if line.startswith('['):need(line.endswith(']'),'FRAGMENT_SECTION_SHAPE');section=line[1:-1];continue
  k,sep,val=line.partition('=')
  if k in want:
   need(sep and section=='Service' and k not in found and val==want[k],'FRAGMENT_OUTPUT_DIRECTIVE_DRIFT');found[k]=val
 need(found==want,'FRAGMENT_OUTPUT_DIRECTIVE_MISSING')
 return found

def stable_file(p,cap,expected=None):
 s=p.lstat();need(p.resolve()==p and stat.S_ISREG(s.st_mode) and s.st_nlink==1 and s.st_uid==s.st_gid==0 and not(stat.S_IMODE(s.st_mode)&0o022) and s.st_size<=cap and not os.listxattr(p,follow_symlinks=False),'FIXED_FILE_SHAPE');m=stamp(s)
 if expected is not None:need({k:m[k] for k in ('dev','ino','mode','uid','gid','nlink')}=={k:expected[k] for k in ('dev','ino','mode','uid','gid','nlink')},'CAPTURE_IDENTITY_DRIFT')
 fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW|os.O_NOATIME)
 try:
  need(stamp(os.fstat(fd))==m,'FIXED_FILE_OPEN_DRIFT');raw=os.read(fd,cap+1);need(len(raw)==s.st_size and stamp(os.fstat(fd))==m==stamp(p.lstat()),'FIXED_FILE_READ_DRIFT');return raw,m
 finally:os.close(fd)

def fragment_proof(v):
 need(v['FragmentPath']==str(FRAGMENT) and v['DropInPaths']==v['SourcePath']=='','FIXED_TRANSIENT_FRAGMENT_PATH');raw,m=stable_file(FRAGMENT,32768);directives=validate_fragment(raw);return {'path':str(FRAGMENT),'sha256':sha(raw),'bytes':len(raw),'metadata':m,'selectedOutputDirectives':directives}

def require_absent(v):need(v['LoadState']=='not-found' and v['ActiveState']=='inactive' and v['SubState']=='dead' and v['MainPID']=='0' and v['InvocationID']=='','PREEXISTING_UNIT')
def durable(p,v):
 fd=os.open(p,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
 try:raw=encode(v);os.write(fd,raw);os.fsync(fd)
 finally:os.close(fd)
 fd=os.open(p.parent,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
 try:os.fsync(fd)
 finally:os.close(fd)
def owned_stop():
 global OWNED
 before=props(True)
 if before['LoadState']=='not-found':require_absent(before);return {'verified':True,'alreadyAbsent':True,'ownedInvocation':OWNED}
 identity(before,OWNED);t=typed(True)
 if OWNED is None:OWNED=before['InvocationID']
 cmd(['/usr/bin/systemctl','stop',UNIT],True);after=props(True);need(after['MainPID']=='0' and ((after['LoadState']=='not-found' and after['InvocationID']=='') or (after['InvocationID']==OWNED and after['ActiveState']in('inactive','failed'))),'OWNED_STOP_UNVERIFIED');return {'verified':True,'ownedInvocation':OWNED,'before':before,'typedCommand':t,'after':after}

def main():
 global OWNED,LAUNCHED,DEADLINE
 need(os.geteuid()==os.getegid()==0 and sys.flags.isolated and len(sys.argv)==2 and re.fullmatch('[a-f0-9]{64}',sys.argv[1]) and os.uname().nodename=='pow-bitcoin-01','FIXED_ISOLATED_ROOT_HOST')
 old={s:signal.getsignal(s)for s in(signal.SIGTERM,signal.SIGINT,signal.SIGHUP,signal.SIGALRM)}
 def interrupt(s,f):raise InterruptedError('PROBE_SIGNAL_OR_60S_DEADLINE')
 for s in old:signal.signal(s,interrupt)
 signal.setitimer(signal.ITIMER_REAL,60);DEADLINE=time.monotonic()+60
 result=None;error=None;cleanup=None;rows=[];captures={};started=False
 try:
  raw=sys.stdin.buffer.read(1025);need(len(raw)<=1024 and sha(raw)==sys.argv[1],'TYPED_REQUEST_RAW_SHA');need(parse(raw)=={'schema':'pow-audit30-systemd-output-property-probe-request-v1','unit':UNIT,'directory':str(DIRECTORY)},'TYPED_FIXED_REQUEST')
  initial=props();require_absent(initial);need(not DIRECTORY.exists() and not DIRECTORY.is_symlink() and DIRECTORY.parent.resolve()==DIRECTORY.parent,'EVIDENCE_COLLISION_OR_PARENT_ALIAS');os.mkdir(DIRECTORY,0o700);started=True
  fd=os.open(DIRECTORY.parent,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW);os.fsync(fd);os.close(fd)
  for p in (OUT,ERR):
   fd=os.open(p,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600);os.fsync(fd);os.close(fd);captures[p.name]=stamp(p.lstat())
  durable(DIRECTORY/'intent.json',{'requestSha256':sha(raw),'unit':UNIT,'argvSha256':sha(encode(ARGV)),'productionDataAccess':False})
  args=['/usr/bin/systemd-run','--quiet','--no-block','--unit='+UNIT,*['--property='+k+'='+x for k,x in PROPS.items()],'--',*ARGV];LAUNCHED=True;need(cmd(args)==b'','LAUNCH_UNEXPECTED_OUTPUT')
  while True:
   guard();v=props();identity(v,OWNED);t=typed();OWNED=v['InvocationID'];validate_resources(v);f=fragment_proof(v);rows.append({'properties':v,'typedCommand':t,'fragment':f});need(len(rows)<=160,'OBSERVATION_CAP')
   if v['MainPID']=='0' and v['ActiveState']=='active' and v['SubState']=='exited':need(v['Result']=='success' and v['ExecMainStatus']=='0','LITERAL_CHILD_FAILED');break
   need(v['ActiveState']=='activating' and v['SubState']=='start','LITERAL_CHILD_NOT_RUNNING');time.sleep(.05)
  out,om=stable_file(OUT,2048,captures[OUT.name]);err,em=stable_file(ERR,2048,captures[ERR.name]);need(parse(out)=={'outputPropertyProbe':True,'uid':108,'gid':112} and err==b'audit30-output-property-probe\n','LITERAL_OUTPUT_DRIFT');result={'schema':'pow-audit30-systemd-output-property-probe-v1','unit':UNIT,'requestSha256':sha(raw),'observations':rows,'output':{'stdout':{'sha256':sha(out),'metadata':om,'uid':108,'gid':112},'stderr':{'sha256':sha(err),'metadata':em}},'observedEnumValues':{'StandardOutput':v['StandardOutput'],'StandardError':v['StandardError']},'fragmentPathProof':f,'productionDataAccess':False,'coreCalls':0,'sqlCalls':0,'appStateAccess':False,'liveUnitActions':False}
 except BaseException as ex:error={'errorClass':type(ex).__name__,'code':str(ex)if isinstance(ex,Refused)else'UNEXPECTED_FAILURE'}
 finally:
  signal.setitimer(signal.ITIMER_REAL,0)
  for s in (signal.SIGTERM,signal.SIGINT,signal.SIGHUP):signal.signal(s,signal.SIG_IGN)
  try:
   if LAUNCHED:cleanup=owned_stop()
  except BaseException as ex:cleanup={'verified':False,'errorClass':type(ex).__name__,'code':str(ex)if isinstance(ex,Refused)else'CLEANUP_FAILED'}
  if started:
   outcome={'status':'passed'if error is None and cleanup and cleanup['verified']else'failed','result':result,'failure':error,'cleanup':cleanup,'automaticRetry':False,'productionDataAccess':False}
   durable(DIRECTORY/('completed.json'if outcome['status']=='passed'else'failed.json'),outcome)
  for s,h in old.items():signal.signal(s,h)
 need(error is None and cleanup and cleanup['verified'],'PROBE_FAILED_WITH_PRESERVED_EVIDENCE');return result|{'cleanup':cleanup}
if __name__=='__main__':
 try:r=main()
 except BaseException as e:print(json.dumps({'status':'refused','code':str(e)if isinstance(e,Refused)else type(e).__name__,'productionDataAccess':False}));sys.exit(1)
 print(json.dumps(r,sort_keys=True))
