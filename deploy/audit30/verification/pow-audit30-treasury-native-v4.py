#!/usr/bin/python3 -I
"""Root creation-only code staging and bounded owned treasury read-only unit.
No service/timer/data/pin changes. Process success is never financial completeness.
"""
import base64,datetime as dt,hashlib,json,os,pwd,re,signal,stat,subprocess,sys,time
from pathlib import Path
RETAINED_PROBE_SHA='247be39abf08e927c9e14e82c5fb8ac56b1ee91b1e156cd05b3405148147d052'
APPROVAL='6821c987b9a5d110fbe9fb2820955b7cbc26dda9faddb67667fc49e892f5c820'
PINS={'collector.py':('b60a0c359104001422c086f8e2df8c4eb9852eca7876fe1f153ff34807eac197', 23960),'ledger-corpus-v2.py':('c37fb22836172254baaa8d2da125ff97fa25d7c955a0afa4c6b72accbe29cef7',34250)}
BASE=Path('/usr/local/lib/proofofwork-audit30-treasury-address');EVIDENCE=Path('/data/proofofwork-release-backups');HOST='pow-bitcoin-01';MAX_OUT=256*1024**2;MAX_ERR=8*1024**2;DEADLINE=1450
PROPS={'Type':'exec','RemainAfterExit':'yes','User':'bitcoin','Group':'bitcoin','CPUQuota':'25%','CPUWeight':'10','IOWeight':'10','Nice':'15','MemoryHigh':'512M','MemoryMax':'1G','MemorySwapMax':'0','TasksMax':'32','RuntimeMaxSec':'22min','TimeoutStopSec':'30s','KillMode':'control-group','Restart':'no','NoNewPrivileges':'yes','UMask':'0077','CapabilityBoundingSet':'','AmbientCapabilities':'','ProtectSystem':'strict','ProtectHome':'yes','PrivateTmp':'yes','PrivateDevices':'yes','PrivateIPC':'yes','PrivateNetwork':'no','RestrictAddressFamilies':'AF_UNIX AF_INET AF_INET6','ReadOnlyPaths':'/etc/bitcoin /data/bitcoin','ReadWritePaths':'','InaccessiblePaths':'/var/lib/postgresql /run/postgresql /data/proofofwork-postgres-tablespaces /etc/proofofwork-api','StandardInput':'null'}
LIVE=('bitcoind.service','electrs.service','postgresql@16-main.service','proofofwork-api.service','proofofwork-indexer-worker.service')
FIELDS=('LoadState','ActiveState','SubState','MainPID','InvocationID','Result','ExecMainCode','ExecMainStatus','User','Group','MemoryMax','MemoryHigh','MemorySwapMax','CPUQuotaPerSecUSec','CPUWeight','IOWeight','Nice','TasksMax','RuntimeMaxUSec','TimeoutStopUSec','KillMode','Restart','NoNewPrivileges','CapabilityBoundingSet','AmbientCapabilities','ProtectSystem','ProtectHome','PrivateTmp','PrivateDevices','PrivateIPC','PrivateNetwork','RestrictAddressFamilies','ReadOnlyPaths','ReadWritePaths','InaccessiblePaths','StandardInput','StandardOutput','StandardError','UMask','ControlGroup','RemainAfterExit','Type','Transient')

def need(v,m):
 if not v:raise ValueError(m)
def sha(v):return hashlib.sha256(v).hexdigest()
def utc():return dt.datetime.now(dt.timezone.utc).isoformat()
def ident(s):return(s.st_dev,s.st_ino,s.st_mode,s.st_uid,s.st_gid,s.st_nlink,s.st_size,s.st_mtime_ns,s.st_ctime_ns)
def pairs(a):
 d={}
 for k,v in a:need(k not in d,'Duplicate input key');d[k]=v
 return d
def dir_fsync(p):
 fd=os.open(p,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
 try:os.fsync(fd)
 finally:os.close(fd)
def durable(p,v):
 raw=(json.dumps(v,sort_keys=True,separators=(',',':'))+'\n').encode();fd=os.open(p,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
 with os.fdopen(fd,'wb')as f:f.write(raw);f.flush();os.fsync(f.fileno())
 dir_fsync(p.parent);return {'path':str(p),'sha256':sha(raw),'bytes':len(raw)}
def read_file(p,limit):
 s=p.lstat();need(p.resolve(strict=True)==p and stat.S_ISREG(s.st_mode)and s.st_nlink==1 and s.st_size<=limit and not s.st_mode&0o022,'Unsafe bounded file')
 fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW)
 with os.fdopen(fd,'rb')as f:need(ident(os.fstat(f.fileno()))==ident(s),'File open changed');raw=f.read(limit+1);need(ident(os.fstat(f.fileno()))==ident(s),'File read changed')
 need(ident(p.lstat())==ident(s)and len(raw)<=limit,'File path drift');return raw,s

def canonical_dir(p,uid=0,mode=None):
 s=p.lstat();need(p.resolve(strict=True)==p and stat.S_ISDIR(s.st_mode)and s.st_uid==uid and not s.st_mode&0o022 and(mode is None or stat.S_IMODE(s.st_mode)==mode),'Unsafe canonical parent');return s

def validate_request(v):
 need(isinstance(v,dict)and set(v)=={'schema','approvalSha256','mode','runId','packageRequest','packageRequestSha256'},'Exact request fields');need(v['schema']=='pow-audit30-treasury-address-native-request-v1'and v['approvalSha256']==APPROVAL and v['mode']in('prepare','run'),'Request approval/mode');rid=v['runId'];need(isinstance(rid,str)and re.fullmatch(r'20[0-9]{6}T[0-9]{6}Z',rid),'Safe run ID');need(dt.datetime.strptime(rid,'%Y%m%dT%H%M%SZ').strftime('%Y%m%dT%H%M%SZ')==rid,'Calendar run ID')
 b=v['packageRequest'];need(isinstance(b,dict)and set(b)=={'schema','runId','packagePath','directoryOwner','directoryGroup','directoryMode','members','productionDataMutation','launchRequested'},'Exact package fields');need(b['schema']=='pow-audit30-treasury-address-creation-only-package-request-v1'and b['runId']==rid and b['packagePath']==str(BASE/rid)and b['directoryOwner']=='root'and b['directoryGroup']=='bitcoin'and b['directoryMode']=='0750'and b['productionDataMutation']is False and b['launchRequested']is False,'Package authority');raw=(json.dumps(b,sort_keys=True,indent=2)+'\n').encode();need(sha(raw)==v['packageRequestSha256'],'Package request SHA');need(isinstance(b['members'],list)and len(b['members'])==2,'Exact two source files');files={}
 for row,name in zip(b['members'],PINS):
  need(isinstance(row,dict)and set(row)=={'name','sha256','bytes','mode','rawBase64'}and row['name']==name and(row['sha256'],row['bytes'])==PINS[name]and row['mode']=='0440','Pinned source fields');data=base64.b64decode(row['rawBase64'],validate=True);need((sha(data),len(data))==PINS[name],'Pinned source bytes');files[name]=data
 return rid,files

def package_proof(p,gid):
 canonical_dir(p,mode=0o750);need(p.lstat().st_gid==gid and sorted(x.name for x in p.iterdir())==sorted(PINS),'Exact immutable package members');out={}
 for name,(h,n)in PINS.items():
  raw,s=read_file(p/name,n);need(s.st_uid==0 and s.st_gid==gid and stat.S_IMODE(s.st_mode)==0o440 and sha(raw)==h and len(raw)==n,'Package source ownership/bytes');out[name]={'sha256':h,'bytes':n,'metadata':list(ident(s))}
 return out

def prepare(v):
 rid,files=validate_request(v);gid=pwd.getpwnam('bitcoin').pw_gid;canonical_dir(BASE.parent)
 if not BASE.exists():os.mkdir(BASE,0o755);os.chmod(BASE,0o755);dir_fsync(BASE.parent)
 canonical_dir(BASE);p=BASE/rid;need(not p.exists()and not p.is_symlink(),'Package already exists');os.mkdir(p,0o750);os.chown(p,0,gid);os.chmod(p,0o750);dir_fsync(BASE)
 for n,raw in files.items():
  fd=os.open(p/n,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o440)
  with os.fdopen(fd,'wb')as f:os.fchown(f.fileno(),0,gid);os.fchmod(f.fileno(),0o440);f.write(raw);f.flush();os.fsync(f.fileno())
 dir_fsync(p);proof=package_proof(p,gid);return {'schema':'pow-audit30-treasury-package-prepared-v1','atUtc':utc(),'runId':rid,'packagePath':str(p),'package':proof,'productionDataMutation':False,'nativeUnitLaunched':False}

class Observer:
 def __init__(self,unit,evidence,deadline,expected_argv=None):self.unit=unit;self.evidence=evidence;self.deadline=deadline;self.expected_argv=expected_argv;self.owned=None;self.last=None;self.snapshots=[]
 def command(self,args,cleanup=False):
  timeout=20 if cleanup else min(20,max(.01,self.deadline-time.monotonic()));p=subprocess.Popen(args,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,start_new_session=True,env={'PATH':'/usr/sbin:/usr/bin:/sbin:/bin','LC_ALL':'C'},cwd='/')
  try:out,err=p.communicate(timeout=timeout)
  except BaseException:
   if p.poll()is None:
    try:os.killpg(p.pid,signal.SIGKILL)
    except ProcessLookupError:pass
   p.communicate(timeout=10);raise
  need(len(out)<=131072 and len(err)<=131072,'Managed command output bound');need(p.returncode==0,'Managed command refused sha='+sha(err));return out
 def show(self,cleanup=False):
  out=self.command(['/usr/bin/systemctl','show',self.unit,'--no-pager',*['--property='+f for f in FIELDS]],cleanup);d={}
  for line in out.decode().splitlines():
   k,sep,v=line.partition('=');need(sep and k not in d,'Malformed unit snapshot');d[k]=v
  need(set(d)==set(FIELDS),'Unit properties missing');return d
 def typed_start(self,cleanup=False):
  manager=json.loads(self.command(['/usr/bin/busctl','--system','--json=short','call','org.freedesktop.systemd1','/org/freedesktop/systemd1','org.freedesktop.systemd1.Manager','GetUnit','s',self.unit],cleanup),object_pairs_hook=pairs)
  need(isinstance(manager,dict)and manager.get('type')=='o'and isinstance(manager.get('data'),list)and len(manager['data'])==1 and isinstance(manager['data'][0],str)and re.fullmatch(r'/org/freedesktop/systemd1/unit/[A-Za-z0-9_]+',manager['data'][0]),'Typed unit object')
  value=json.loads(self.command(['/usr/bin/busctl','--system','--json=short','get-property','org.freedesktop.systemd1',manager['data'][0],'org.freedesktop.systemd1.Service','ExecStart'],cleanup),object_pairs_hook=pairs)
  need(isinstance(value,dict)and value.get('type')=='a(sasbttttuii)'and isinstance(value.get('data'),list)and len(value['data'])==1,'Typed single ExecStart')
  entry=value['data'][0];need(isinstance(entry,list)and len(entry)==10 and isinstance(self.expected_argv,list)and entry[0]==self.expected_argv[0]and entry[1]==self.expected_argv and entry[2]is False and all(type(n)is int for n in entry[3:]),'Exact fixed ExecStart argv')
  return {'objectPath':manager['data'][0],'argvSha256':sha(json.dumps(entry[1],separators=(',',':')).encode()),'fixedCodeSha256':sha(entry[1][-1].encode())}
 def identity(self,d):
  inv=d['InvocationID'];fixed=d['ControlGroup']=='/system.slice/'+self.unit
  retained=(d['ControlGroup']=='' and d['MainPID']=='0' and d['ActiveState']=='active' and d['SubState']=='exited' and d['Result']=='success' and d['ExecMainStatus']=='0')
  need(d['LoadState']=='loaded' and re.fullmatch('[0-9a-f]{32}',inv) and d['MainPID'].isdigit() and (fixed or retained) and d['Type']=='exec' and d['Transient']=='yes' and d['RemainAfterExit']=='yes' and d['User']=='bitcoin' and d['Group']=='bitcoin','Exact owned unit identity')
  if self.owned is not None:need(self.owned==inv,'Owned unit invocation changed')
  return inv
 def observe(self,cleanup=False):
  d=self.show(cleanup);inv=self.identity(d);start=self.typed_start(cleanup)
  if self.owned is None:self.owned=inv
  self.last=d;self.snapshots.append({'atUtc':utc(),'properties':d,'typedExecStart':start});need(len(self.snapshots)<=1600,'Observer snapshot count bound');validate_properties(d,self.evidence);return d
 def stop_owned(self):
  if not self.owned:return {'attempted':False,'reason':'no-owned-invocation'}
  d=self.show(True);self.identity(d);typed=self.typed_start(True);self.command(['/usr/bin/systemctl','stop',self.unit],True);after=self.show(True);need((after['LoadState']=='not-found'and after['InvocationID']==''and after['MainPID']=='0')or(after['InvocationID']==self.owned and after['MainPID']=='0'and after['ActiveState']in('inactive','failed')),'Owned unit did not stop');return {'attempted':True,'before':d,'typedExecStart':typed,'after':after}

def validate_properties(d,e):
 expected={'User':'bitcoin','Group':'bitcoin','MemoryMax':str(1024**3),'MemoryHigh':str(512*1024**2),'MemorySwapMax':'0','CPUQuotaPerSecUSec':'250ms','CPUWeight':'10','IOWeight':'10','Nice':'15','TasksMax':'32','RuntimeMaxUSec':'22min','TimeoutStopUSec':'30s','KillMode':'control-group','Restart':'no','NoNewPrivileges':'yes','CapabilityBoundingSet':'','AmbientCapabilities':'','ProtectSystem':'strict','ProtectHome':'yes','PrivateTmp':'yes','PrivateDevices':'yes','PrivateIPC':'yes','PrivateNetwork':'no','ReadOnlyPaths':'/etc/bitcoin /data/bitcoin','ReadWritePaths':'','InaccessiblePaths':'/var/lib/postgresql /run/postgresql /data/proofofwork-postgres-tablespaces /etc/proofofwork-api','StandardInput':'null','StandardOutput':'append:'+str(e/'corpus.json'),'StandardError':'append:'+str(e/'stderr.log'),'UMask':'0077','RemainAfterExit':'yes'}
 for k,v in expected.items():need(d[k]==v,'Managed property drift '+k)
 need(set(d['RestrictAddressFamilies'].split())=={'AF_UNIX','AF_INET','AF_INET6'},'Managed address families')

def live_snapshot(o):
 out={}
 for u in LIVE:
  raw=o.command(['/usr/bin/systemctl','show',u,'--no-pager','--property=LoadState','--property=ActiveState','--property=SubState','--property=MainPID','--property=InvocationID']);row=dict(line.split('=',1)for line in raw.decode().splitlines());need(set(row)=={'LoadState','ActiveState','SubState','MainPID','InvocationID'}and row['LoadState']=='loaded'and row['ActiveState']=='active'and row['SubState']=='running'and row['MainPID'].isdigit()and int(row['MainPID'])>0 and re.fullmatch('[0-9a-f]{32}',row['InvocationID']),'Live identity unavailable');out[u]=row
 return out

def fixed_argv(p):
 code='import os,resource;resource.setrlimit(resource.RLIMIT_FSIZE,('+str(MAX_OUT)+','+str(MAX_OUT)+'));os.execv("/usr/bin/python3",["/usr/bin/python3","-I","-B",'+repr(str(p/'collector.py'))+'])'
 return ['/usr/bin/python3','-I','-B','-c',code]
def require_absent(o):
 fields=('LoadState','ActiveState','SubState','MainPID','InvocationID');raw=o.command(['/usr/bin/systemctl','show',o.unit,'--no-pager',*['--property='+f for f in fields]]);d={}
 for line in raw.decode().splitlines():
  k,sep,v=line.partition('=');need(sep and k not in d,'Malformed absence snapshot');d[k]=v
 need(set(d)==set(fields)and d['LoadState']=='not-found'and d['ActiveState']=='inactive'and d['SubState']=='dead'and d['MainPID']=='0'and d['InvocationID']=='','Preexisting audit unit');return d

def capture_proof(p,bound):
 raw,s=read_file(p,bound);need(s.st_uid==s.st_gid==0 and stat.S_IMODE(s.st_mode)==0o600,'Capture authority');return {'path':str(p),'bytes':len(raw),'sha256':sha(raw),'metadata':list(ident(s))},raw

def run(v):
 rid,_=validate_request(v);gid=pwd.getpwnam('bitcoin').pw_gid;p=BASE/rid;proof=package_proof(p,gid);canonical_dir(EVIDENCE);e=EVIDENCE/('audit30-treasury-address-'+rid);need(not e.exists()and not e.is_symlink(),'Evidence exists');o=Observer('proofofwork-audit30-treasury-address-'+rid+'.service',e,time.monotonic()+DEADLINE,fixed_argv(p));absence=require_absent(o);before=live_snapshot(o);os.mkdir(e,0o700);dir_fsync(EVIDENCE);intent={'schema':'pow-audit30-treasury-native-intent-v1','atUtc':utc(),'runId':rid,'approvalSha256':APPROVAL,'package':proof,'liveBefore':before,'prelaunchUnitAbsence':absence,'retainedUnitProbeSha256':RETAINED_PROBE_SHA,'productionDataMutation':False};durable(e/'intent.json',intent)
 for name in('corpus.json','stderr.log'):
  fd=os.open(e/name,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600);os.fsync(fd);os.close(fd)
 dir_fsync(e);old={};failure=None;cleanup=None;captured=None;after=None;ready=False;launch_attempted=False
 def interrupted(s,f):raise InterruptedError('operator-signal-'+str(s))
 for s in(signal.SIGTERM,signal.SIGINT,signal.SIGHUP):old[s]=signal.signal(s,interrupted)
 try:
  props=PROPS|{'StandardOutput':'append:'+str(e/'corpus.json'),'StandardError':'append:'+str(e/'stderr.log')};args=['/usr/bin/systemd-run','--quiet','--no-block','--unit='+o.unit]
  for k,val in props.items():args.extend(['--property',k+'='+val])
  # RLIMIT_FSIZE bounds each open capture at256MiB, including inherited stdout.
  args+=['--',*o.expected_argv];launch_attempted=True;o.command(args)
  while True:
   need(time.monotonic()<o.deadline,'Native transport deadline');d=o.observe();need((e/'corpus.json').stat().st_size<=MAX_OUT and(e/'stderr.log').stat().st_size<=MAX_ERR,'Capture bound')
   if d['ActiveState']in('inactive','failed')or(d['ActiveState']=='active'and d['SubState']=='exited'and d['MainPID']=='0'):break
   time.sleep(1)
  need(d['MainPID']=='0'and d['Result']=='success'and d['ExecMainStatus']=='0','Native collector exit refusal');need(package_proof(p,gid)==proof,'Package drift after capture');after=live_snapshot(o);need(after==before,'Live authority changed during readonly census');out,raw=capture_proof(e/'corpus.json',MAX_OUT);err,_=capture_proof(e/'stderr.log',MAX_ERR);need(err['bytes']==0,'Native collector stderr');value=json.loads(raw,object_pairs_hook=pairs);need(value.get('schema')=='pow-audit30-treasury-address-corpus-v1'and value.get('productionMutation')is False and value.get('financialReconciliationComplete')is False and value.get('obligationReconciliationComplete')is False and value.get('may9OperatorConfirmedPaid')is True and value.get('may9TransactionIDsRequested')is False,'Corpus safety/qualification');captured={'stdout':out,'stderr':err,'coverage':value.get('coverage'),'status':value.get('status'),'oracle':value.get('oracle')};ready=True
 except BaseException as ex:failure={'errorClass':type(ex).__name__,'privateReasonSha256':sha(str(ex).encode())}
 finally:
  for s in old:signal.signal(s,signal.SIG_IGN)
  signal.alarm(0)
  try:
   if o.owned is None and launch_attempted:
    try:o.observe(True)
    except BaseException as ex:
     if o.owned is None:cleanup={'ownershipUnavailable':True,'errorClass':type(ex).__name__,'privateReasonSha256':sha(str(ex).encode())}
   if o.owned:
    try:cleanup=o.stop_owned()
    except BaseException as ex:
     cleanup={'errorClass':type(ex).__name__,'privateReasonSha256':sha(str(ex).encode())}
     if failure is None:failure={'errorClass':type(ex).__name__,'privateReasonSha256':sha(str(ex).encode()),'phase':'owned-cleanup'};ready=False
   if after is None:
    try:after=live_snapshot(o)
    except BaseException as ex:after={'unavailable':True,'errorClass':type(ex).__name__,'reasonSha256':sha(str(ex).encode())}
   capture_files={}
   for name,bound in(('corpus.json',MAX_OUT),('stderr.log',MAX_ERR)):
    try:capture_files[name]=capture_proof(e/name,bound)[0]
    except BaseException as ex:capture_files[name]={'path':str(e/name),'boundedHashAccepted':False,'errorClass':type(ex).__name__,'privateReasonSha256':sha(str(ex).encode())}
   receipt={'captureFiles':capture_files,'schema':'pow-audit30-treasury-native-outcome-v1','atUtc':utc(),'runId':rid,'transportAccepted':ready,'result':captured,'failure':failure,'cleanup':cleanup,'unitSnapshots':o.snapshots,'liveBefore':before,'liveAfter':after,'retainedUnitProbeSha256':RETAINED_PROBE_SHA,'productionDataMutation':False,'financialReconciliationComplete':False,'may9TransactionIDsRequested':False,'autoRetry':False};binding=durable(e/('completed.json'if ready else'failed.json'),receipt)
  finally:
   for s,h in old.items():signal.signal(s,h)
 need(failure is None,'Native failed receipt='+binding['sha256']);return {'schema':'pow-audit30-treasury-native-completed-reference-v1','receipt':binding,'resultStatus':captured['status'],'financialReconciliationComplete':False,'nativeUnitStopped':True}

def main():
 need(os.geteuid()==0 and sys.flags.isolated and len(sys.argv)==1 and os.uname().nodename==HOST,'Exact isolated root host');
 def timeout(s,f):raise TimeoutError('Root bootstrap wall deadline')
 previous=signal.signal(signal.SIGALRM,timeout);signal.alarm(DEADLINE+30)
 try:
  raw=sys.stdin.buffer.read(1024**2+1);need(len(raw)<=1024**2,'Request bound');v=json.loads(raw,object_pairs_hook=pairs);validate_request(v);out=prepare(v)if v['mode']=='prepare'else run(v);print(json.dumps(out,sort_keys=True,separators=(',',':')))
 finally:signal.alarm(0);signal.signal(signal.SIGALRM,previous)
if __name__=='__main__':
 try:main()
 except BaseException as ex:print(json.dumps({'schema':'pow-audit30-treasury-native-refusal-v1','errorClass':type(ex).__name__,'privateReasonSha256':sha(str(ex).encode()),'productionDataMutation':False}),file=sys.stderr);raise SystemExit(1)
