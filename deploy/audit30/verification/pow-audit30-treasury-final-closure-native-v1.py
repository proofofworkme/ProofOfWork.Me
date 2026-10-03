#!/usr/bin/python3 -I
"""Minimal0311 successor for remaining2569 + discovered-history proof closure.
Root creation-only final code + immutable parent-chunk copy; all old caches unchanged.
No service/timer/data/pin changes. Process success is never financial completeness.
"""
import base64,datetime as dt,hashlib,json,os,pwd,re,signal,stat,subprocess,sys,time
from pathlib import Path
RETAINED_PROBE_SHA='247be39abf08e927c9e14e82c5fb8ac56b1ee91b1e156cd05b3405148147d052'
OUTPUT_PROPERTY_PROBE_SHA='a38d26740997f039cf44063f27acba75491fc99ff03f87a522e541eb6e1a59bd'
APPROVAL='6821c987b9a5d110fbe9fb2820955b7cbc26dda9faddb67667fc49e892f5c820'
PINS={'collector.py':('6ccffbfa1f83f048ce839e8432f8f70242510c79c5585cb6565e13cc2e7c775b',22596)}
SEED=Path('/data/proofofwork-release-backups/audit30-treasury-parent-chunk1-20261003T083000Z/corpus.json')
SEED_NAME='parent-chunk1-corpus.json';SEED_SHA='9e4736cce51b351926754021f11b23a738a506440fccfe747bbd1dab71e01f89';SEED_BYTES=14436219
META={'device','inode','mode','uid','gid','nlink','bytes','mtimeNs','ctimeNs'}
BASE=Path('/usr/local/lib/proofofwork-audit30-treasury-final-closure');EVIDENCE=Path('/data/proofofwork-release-backups');HOST='pow-bitcoin-01';MAX_OUT=256*1024**2;MAX_ERR=8*1024**2;DEADLINE=1450
PROPS={'Type':'exec','RemainAfterExit':'yes','User':'bitcoin','Group':'bitcoin','CPUQuota':'25%','CPUWeight':'10','IOWeight':'10','Nice':'15','MemoryHigh':'512M','MemoryMax':'1G','MemorySwapMax':'0','TasksMax':'32','RuntimeMaxSec':'22min','TimeoutStopSec':'30s','KillMode':'control-group','Restart':'no','NoNewPrivileges':'yes','UMask':'0077','CapabilityBoundingSet':'','AmbientCapabilities':'','ProtectSystem':'strict','ProtectHome':'yes','PrivateTmp':'yes','PrivateDevices':'yes','PrivateIPC':'yes','PrivateNetwork':'no','RestrictAddressFamilies':'AF_UNIX AF_INET AF_INET6','ReadOnlyPaths':'/etc/bitcoin /data/bitcoin','ReadWritePaths':'','InaccessiblePaths':'/var/lib/postgresql /run/postgresql /data/proofofwork-postgres-tablespaces /etc/proofofwork-api','StandardInput':'null'}
LIVE=('bitcoind.service','electrs.service','postgresql@16-main.service','proofofwork-api.service','proofofwork-indexer-worker.service')
FIELDS=('LoadState','ActiveState','SubState','MainPID','InvocationID','Result','ExecMainCode','ExecMainStatus','User','Group','MemoryMax','MemoryHigh','MemorySwapMax','CPUQuotaPerSecUSec','CPUWeight','IOWeight','Nice','TasksMax','RuntimeMaxUSec','TimeoutStopUSec','KillMode','Restart','NoNewPrivileges','CapabilityBoundingSet','AmbientCapabilities','ProtectSystem','ProtectHome','PrivateTmp','PrivateDevices','PrivateIPC','PrivateNetwork','RestrictAddressFamilies','ReadOnlyPaths','ReadWritePaths','InaccessiblePaths','StandardInput','StandardOutput','StandardError','UMask','ControlGroup','RemainAfterExit','Type','Transient','FragmentPath','DropInPaths','SourcePath')

class NativeInterrupted(RuntimeError):pass

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
 need(isinstance(v,dict)and set(v)=={'schema','approvalSha256','mode','runId','packageRequest','packageRequestSha256','seedSource','liveServices','backupWindow'},'Exact request fields');need(v['schema']=='pow-audit30-treasury-final-closure-native-request-v1'and v['approvalSha256']==APPROVAL and v['mode']in('prepare','run'),'Request approval/mode');rid=v['runId'];need(isinstance(rid,str)and re.fullmatch(r'20[0-9]{6}T[0-9]{6}Z',rid),'Safe run ID');need(dt.datetime.strptime(rid,'%Y%m%dT%H%M%SZ').strftime('%Y%m%dT%H%M%SZ')==rid,'Calendar run ID')
 b=v['packageRequest'];need(isinstance(b,dict)and set(b)=={'schema','runId','packagePath','directoryOwner','directoryGroup','directoryMode','members','productionDataMutation','launchRequested'},'Exact package fields');need(b['schema']=='pow-audit30-treasury-final-closure-creation-only-package-request-v1'and b['runId']==rid and b['packagePath']==str(BASE/rid)and b['directoryOwner']=='root'and b['directoryGroup']=='bitcoin'and b['directoryMode']=='0750'and b['productionDataMutation']is False and b['launchRequested']is False,'Package authority');raw=(json.dumps(b,sort_keys=True,indent=2)+'\n').encode();need(sha(raw)==v['packageRequestSha256'],'Package request SHA');need(isinstance(b['members'],list)and len(b['members'])==1,'Exact sole parent source file');files={}
 for row,name in zip(b['members'],PINS):
  need(isinstance(row,dict)and set(row)=={'name','sha256','bytes','mode','rawBase64'}and row['name']==name and(row['sha256'],row['bytes'])==PINS[name]and row['mode']=='0440','Pinned source fields');data=base64.b64decode(row['rawBase64'],validate=True);need((sha(data),len(data))==PINS[name],'Pinned source bytes');files[name]=data
 validate_seed_authority(v);validate_live_authority(v);validate_window_authority(v);return rid,files

def metadata(p):
 s=p.lstat();return dict(device=s.st_dev,inode=s.st_ino,mode=stat.S_IMODE(s.st_mode),uid=s.st_uid,gid=s.st_gid,nlink=s.st_nlink,bytes=s.st_size,mtimeNs=s.st_mtime_ns,ctimeNs=s.st_ctime_ns)
def validate_seed_authority(v):
 r=v['seedSource'];need(isinstance(r,dict)and set(r)=={'path','sha256','bytes','metadata'}and r['path']==str(SEED)and r['sha256']==SEED_SHA and type(r['bytes'])is int and r['bytes']==SEED_BYTES,'Exact saved failed corpus authority');m=r['metadata'];need(isinstance(m,dict)and set(m)==META and all(type(x)is int and x>=0 for x in m.values())and(m['uid'],m['gid'],m['mode'],m['nlink'],m['bytes'])==(0,0,0o600,1,SEED_BYTES),'Exact original corpus metadata')
def seed_read(v):
 validate_seed_authority(v);expected=v['seedSource']['metadata'];s=SEED.lstat();need(SEED.resolve(strict=True)==SEED and stat.S_ISREG(s.st_mode)and metadata(SEED)==expected and not os.listxattr(SEED,follow_symlinks=False),'Original failed corpus path/identity');fd=os.open(SEED,os.O_RDONLY|os.O_NOFOLLOW|os.O_NOATIME)
 with os.fdopen(fd,'rb')as f:
  need(ident(os.fstat(f.fileno()))==ident(s),'Original corpus FD');raw=f.read(SEED_BYTES+1);need(ident(os.fstat(f.fileno()))==ident(s),'Original corpus read drift')
 need(metadata(SEED)==expected and len(raw)==SEED_BYTES and sha(raw)==SEED_SHA,'Original failed corpus byte/path drift');return raw
def validate_live_authority(v):
 rows=v['liveServices'];need(isinstance(rows,dict)and set(rows)==set(LIVE),'Exact fresh five authority')
 for d in rows.values():need(isinstance(d,dict)and set(d)=={'LoadState','ActiveState','SubState','MainPID','InvocationID'}and d['LoadState']=='loaded'and d['ActiveState']=='active'and d['SubState']=='running'and isinstance(d['MainPID'],str)and d['MainPID'].isdigit()and int(d['MainPID'])>0 and isinstance(d['InvocationID'],str)and re.fullmatch('[0-9a-f]{32}',d['InvocationID']),'Fresh five tuple shape')
def validate_window_authority(v):
 w=v['backupWindow'];need(isinstance(w,dict)and set(w)=={'observedAtUtc','nextBackupUtc'},'Exact backup window fields')
 for n in w:need(isinstance(w[n],str)and dt.datetime.fromisoformat(w[n]).utcoffset()==dt.timedelta(0),'UTC backup window')
def check_window(o,v,admission=True):
 validate_window_authority(v);w=v['backupWindow'];now=dt.datetime.now(dt.timezone.utc);observed=dt.datetime.fromisoformat(w['observedAtUtc']);next_=dt.datetime.fromisoformat(w['nextBackupUtc']);need((not admission or 0<=(now-observed).total_seconds()<=900)and(next_-now).total_seconds()>=(1800 if admission else 30),'Fresh clear30min backup window')
 service=o.command(['/usr/bin/systemctl','show','proofofwork-postgres-logical-backup.service','--property=ActiveState','--value']).decode().strip();timer=o.command(['/usr/bin/systemctl','show','proofofwork-postgres-logical-backup.timer','--property=ActiveState','--property=NextElapseUSecRealtime']).decode();d=dict(x.split('=',1)for x in timer.splitlines());need(set(d)=={'ActiveState','NextElapseUSecRealtime'}and service=='inactive'and d['ActiveState']=='active'and dt.datetime.strptime(d['NextElapseUSecRealtime'],'%a %Y-%m-%d %H:%M:%S %Z').replace(tzinfo=dt.timezone.utc)==next_,'Routine backup service/timer changed');return dict(service=service,timer=d,observedAtUtc=utc())

def package_proof(p,gid):
 canonical_dir(p,mode=0o750);need(p.lstat().st_gid==gid and sorted(x.name for x in p.iterdir())==sorted([*PINS,SEED_NAME]),'Exact immutable package members');out={}
 for name,(h,n)in {**PINS,SEED_NAME:(SEED_SHA,SEED_BYTES)}.items():
  raw,s=read_file(p/name,n);need(s.st_uid==0 and s.st_gid==gid and stat.S_IMODE(s.st_mode)==0o440 and sha(raw)==h and len(raw)==n,'Package source ownership/bytes');out[name]={'sha256':h,'bytes':n,'metadata':list(ident(s))}
 return out

def prepare(v):
 rid,files=validate_request(v);original=seed_read(v);prior=prior_authority();gid=pwd.getpwnam('bitcoin').pw_gid;canonical_dir(BASE.parent)
 if not BASE.exists():os.mkdir(BASE,0o755);os.chmod(BASE,0o755);dir_fsync(BASE.parent)
 canonical_dir(BASE);p=BASE/rid;need(not p.exists()and not p.is_symlink(),'Package already exists');selected=selection_authority(p,original,files['collector.py']);os.mkdir(p,0o750);os.chown(p,0,gid);os.chmod(p,0o750);dir_fsync(BASE)
 for n,raw in {**files,SEED_NAME:original}.items():
  fd=os.open(p/n,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o440)
  with os.fdopen(fd,'wb')as f:os.fchown(f.fileno(),0,gid);os.fchmod(f.fileno(),0o440);f.write(raw);f.flush();os.fsync(f.fileno())
 dir_fsync(p);proof=package_proof(p,gid);need(seed_read(v)==original and prior_authority()==prior and selection_authority(p,original)==selected,'Prior inputs changed during preparation');return {'schema':'pow-audit30-treasury-package-prepared-v1','atUtc':utc(),'runId':rid,'packagePath':str(p),'package':proof,'productionDataMutation':False,'nativeUnitLaunched':False,'selectedParentSetSha256':selected['selectedSha256'],'selectedParentCount':2569,'originalFailedCorpusUnchanged':True,'priorPackageProof':{'metadata':selected['priorPackageMetadata'],'files':selected['priorPackageFiles']},'inputRawDeltaOriginalUnchanged':True,'inputRawDeltaSha256':SEED_SHA}

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
 def identity(self,d,cleanup=False):
  inv=d['InvocationID'];fixed=d['ControlGroup']=='/system.slice/'+self.unit
  retained=(d['ControlGroup']=='' and d['MainPID']=='0' and d['ActiveState']=='active' and d['SubState']=='exited' and d['Result']=='success' and d['ExecMainStatus']=='0')
  failed_owned=(cleanup and self.owned is not None and d['InvocationID']==self.owned and d['ControlGroup']=='' and d['MainPID']=='0' and d['ActiveState']=='failed' and d['SubState']=='failed')
  need(d['LoadState']=='loaded' and re.fullmatch('[0-9a-f]{32}',inv) and d['MainPID'].isdigit() and (fixed or retained or failed_owned) and d['Type']=='exec' and d['Transient']=='yes' and d['RemainAfterExit']=='yes' and d['User']=='bitcoin' and d['Group']=='bitcoin','Exact owned unit identity')
  if self.owned is not None:need(self.owned==inv,'Owned unit invocation changed')
  return inv
 def output_proof(self,d):
  path=Path('/run/systemd/transient')/self.unit;need(d['FragmentPath']==str(path)and d['DropInPaths']==d['SourcePath']=='','Exact fixed transient fragment authority');canonical_dir(path.parent);raw,s=read_file(path,65536);need(s.st_uid==s.st_gid==0 and not os.listxattr(path,follow_symlinks=False),'Root output-fragment authority');section='';found={};want={'StandardInput':'null','StandardOutput':'append:'+str(self.evidence/'corpus.json'),'StandardError':'append:'+str(self.evidence/'stderr.log')}
  for line in raw.decode().splitlines():
   line=line.strip()
   if not line or line.startswith(('#',';')):continue
   need(not line.endswith('\\'),'Transient fragment continuation refused')
   if line.startswith('['):need(line.endswith(']'),'Fragment section shape');section=line[1:-1];continue
   k,sep,value=line.partition('=')
   if k in want:need(sep and section=='Service'and k not in found and value==want[k],'Exact transient output directive drift');found[k]=value
  need(found==want,'Output directives missing');return {'path':str(path),'sha256':sha(raw),'bytes':len(raw),'metadata':list(ident(s)),'selectedOutputDirectives':found,'actualOutputPropertyProbeSha256':OUTPUT_PROPERTY_PROBE_SHA}
 def observe(self,cleanup=False):
  d=self.show(cleanup);inv=self.identity(d,cleanup);start=self.typed_start(cleanup)
  if self.owned is None:self.owned=inv
  self.last=d;self.snapshots.append({'atUtc':utc(),'properties':d,'typedExecStart':start});need(len(self.snapshots)<=1600,'Observer snapshot count bound');validate_properties(d,self.evidence);self.snapshots[-1]['outputFragment']=self.output_proof(d);return d
 def stop_owned(self):
  if not self.owned:return {'attempted':False,'reason':'no-owned-invocation'}
  d=self.show(True);self.identity(d,True);typed=self.typed_start(True);self.command(['/usr/bin/systemctl','stop',self.unit],True);after=self.show(True);need((after['LoadState']=='not-found'and after['InvocationID']==''and after['MainPID']=='0')or(after['InvocationID']==self.owned and after['MainPID']=='0'and after['ActiveState']in('inactive','failed')),'Owned unit did not stop');return {'attempted':True,'before':d,'typedExecStart':typed,'after':after}

def validate_properties(d,e):
 expected={'User':'bitcoin','Group':'bitcoin','MemoryMax':str(1024**3),'MemoryHigh':str(512*1024**2),'MemorySwapMax':'0','CPUQuotaPerSecUSec':'250ms','CPUWeight':'10','IOWeight':'10','Nice':'15','TasksMax':'32','RuntimeMaxUSec':'22min','TimeoutStopUSec':'30s','KillMode':'control-group','Restart':'no','NoNewPrivileges':'yes','CapabilityBoundingSet':'','AmbientCapabilities':'','ProtectSystem':'strict','ProtectHome':'yes','PrivateTmp':'yes','PrivateDevices':'yes','PrivateIPC':'yes','PrivateNetwork':'no','ReadOnlyPaths':'/etc/bitcoin /data/bitcoin','ReadWritePaths':'','InaccessiblePaths':'/var/lib/postgresql /run/postgresql /data/proofofwork-postgres-tablespaces /etc/proofofwork-api','StandardInput':'null','StandardOutput':'append','StandardError':'append','UMask':'0077','RemainAfterExit':'yes'}
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
def prior_authority():
 # Exact3 previous authorities stay private/on-host and immutable. Reuse the
 # accepted root NOATIME/NOFOLLOW reader and temporary constants only.
 rows=[
  ('originalFailedCorpus',Path('/data/proofofwork-release-backups/audit30-treasury-address-20261003T031100Z/corpus.json'),'8eeb467bf3468734beee934d884148b7045ed28803045a2b66ac51ca0f1e2596',dict(device=64514,inode=76809529,uid=0,gid=0,mode=0o600,nlink=1,bytes=17672203,mtimeNs=1791009664395750415,ctimeNs=1791009664395750415)),
  ('originalTargetDelta',Path('/data/proofofwork-release-backups/audit30-treasury-missing-raw-20261003T080000Z/corpus.json'),'e5e2b45bc4156bb1e018809ed047a336fb55183c6934c3836c345a5d1231caaf',dict(device=64514,inode=76809542,uid=0,gid=0,mode=0o600,nlink=1,bytes=17722465,mtimeNs=1791013573152941767,ctimeNs=1791013573152941767)),
  ('acceptedParentCompletion',Path('/data/proofofwork-release-backups/audit30-treasury-parent-chunk1-20261003T083000Z/completed.json'),'bfcdfbf4ae20ec16076e9648f70b956125e12ed6b3cb095573a2702996df54a8',dict(device=64514,inode=76809549,uid=0,gid=0,mode=0o600,nlink=1,bytes=184511,mtimeNs=1791016133090995223,ctimeNs=1791016133090995223))]
 global SEED,SEED_SHA,SEED_BYTES
 saved=(SEED,SEED_SHA,SEED_BYTES);out={}
 try:
  for label,p,h,m in rows:
   SEED,SEED_SHA,SEED_BYTES=p,h,m['bytes'];raw=seed_read({'seedSource':dict(path=str(p),sha256=h,bytes=m['bytes'],metadata=m)});out[label]=dict(path=str(p),sha256=sha(raw),metadata=m)
 finally:SEED,SEED_SHA,SEED_BYTES=saved
 return out

def selection_authority(p,parent_raw,source=None):
 import types
 if source is None:raw,_=read_file(p/'collector.py',22596)
 else:raw=source
 need(isinstance(raw,bytes)and(sha(raw),len(raw))==PINS['collector.py'],'Final collector source')
 m=types.ModuleType('reviewed_final_definitions');m.__file__=str(p/'collector.py');exec(compile(raw,m.__file__,'exec'),m.__dict__);ds=canonical_dir(m.OLD,mode=0o750);need(ds.st_gid==988 and set(x.name for x in m.OLD.iterdir())==set(m.OLD_PINS)and not os.listxattr(m.OLD,follow_symlinks=False),'Exact preceding2member package');stamp=ident(ds);priorfiles={};raws={}
 for name,(h,n,ino,ns)in m.OLD_PINS.items():
  data,st=read_file(m.OLD/name,n);need(sha(data)==h and len(data)==n and ident(st)==(64512,ino,stat.S_IFREG|0o440,0,988,1,n,ns,ns)and not os.listxattr(m.OLD/name,follow_symlinks=False),'Preceding2member source custody');raws[name]=data;priorfiles[name]=list(ident(st))
 m.P0=types.ModuleType('frozen19a1');m.P0.__file__=str(m.OLD/'collector.py');exec(compile(raws['collector.py'],m.P0.__file__,'exec'),m.P0.__dict__);seed,oldstamp,oldproof=m.P0.load();m.R,m.T,m.L=m.P0.R,m.P0.T,m.P0.L;need(len(parent_raw)==SEED_BYTES and sha(parent_raw)==SEED_SHA,'Original parent delta bytes');origins,cache,missing=m.load_cache(seed,json.loads(raws['completed-raw-target-delta.json'],object_pairs_hook=pairs),json.loads(parent_raw,object_pairs_hook=pairs));groups,heights=m.groups_for(origins,cache);need(ident(m.OLD.lstat())==stamp and all(list(ident((m.OLD/k).lstat()))==v for k,v in priorfiles.items()),'Prior selection final path fence')
 return dict(selected=missing,selectedSha256=m.set_sha(missing),priorPackageMetadata=list(stamp),priorPackageFiles=priorfiles,originalPackageMetadata=list(oldstamp),originalPackageFiles={k:list(v)for k,v in oldproof.items()},targetSetSha256=m.R.TARGET_SET_SHA,targetCount=len(origins),blockGroups=len(groups),proofBatches=sum((len(v)+63)//64 for v in groups.values()),expectedHeights=heights)

def validate_delta(value,selected):
 rows=value.get('newParents');c=value.get('coverage',{});wanted=sha(json.dumps(selected['selected'],separators=(',',':')).encode())
 need(isinstance(rows,dict)and len(rows)==2569 and sorted(rows)==selected['selected']and wanted==selected['selectedSha256']and all(type(c.get(k))is int for k in('requestedParents','acquiredParents','remainingParents','targetCount','canonicalTargetProofs','blockGroups','batchProofs','derivedUnspentCount','coreCalls','coreBytes','electrsCalls','electrsBytes'))and(c['requestedParents'],c['acquiredParents'],c['remainingParents'],c['targetCount'],c['canonicalTargetProofs'],c['blockGroups'],c['batchProofs'])==(2569,2569,0,10232,10232,567,644)and c['coreCalls']==6132+2*c['derivedUnspentCount']<=10000 and 0<=c['derivedUnspentCount']and 0<=c['coreBytes']<=MAX_OUT and c['electrsCalls']==20 and 0<=c['electrsBytes']<=32*1024**2 and c.get('openingPrefixCoreCalls')==3 and c.get('closingReservedCoreCalls')==571,'Complete bounded parent/canonical/outpoint coverage')
 need(value.get('schema')=='pow-audit30-treasury-final-discovered-history-closure-v1'and value.get('status')=='discovered-history-closure-complete-with-closing-fences'and value.get('seedCorpusSha256')=='8eeb467bf3468734beee934d884148b7045ed28803045a2b66ac51ca0f1e2596'and value.get('sourceTargetRawDeltaSha256')=='e5e2b45bc4156bb1e018809ed047a336fb55183c6934c3836c345a5d1231caaf'and value.get('sourceParentChunk1Sha256')==SEED_SHA and value.get('requestedParentCount')==2569 and value.get('requestedParentSetSha256')==wanted and value.get('unionHistoryTargetCount')==10232 and value.get('unionHistoryTargetSetSha256')==selected['targetSetSha256']and value.get('closingFencesAccepted')is True and value.get('captureFailures')==[]and value.get('may9OperatorSettlementPreserved')is True and all(value.get(k)is True for k in('parentValuesComplete','targetCanonicalMembershipComplete','knownHistoryFeeAndDirectSpendCoverageAccepted','derivedUnspentCoreChecksComplete','knownHistoryBalanceComparisonAccepted'))and all(value.get(k)is False for k in('productionMutation','financialReconciliationComplete','obligationReconciliationComplete','independentWholeChainAddressHistoryComplete','signingEligibilityVerified','automaticNextChunk','automaticRetry','nextChunkAuthorized','may9TransactionIDsRequested')),'Final source scope/qualifications')
 # Independent root offline recheck of the native partialMerkle/header/parser
 # values. No new RPC, source adapter, fee model or corpus rewrite.
 import types
 path=Path('/usr/local/lib/proofofwork-audit30-treasury-raw-targets/20261003T080000Z/ledger-corpus-v2.py');raw,_=read_file(path,34250);need(sha(raw)=='c37fb22836172254baaa8d2da125ff97fa25d7c955a0afa4c6b72accbe29cef7','Root frozen parser source');L=types.ModuleType('root_c37');exec(compile(raw,str(path),'exec'),L.__dict__)
 for txid,t in rows.items():
  p=L.parse_raw(t['rawHex']);need(p['txid']==txid==t['txid']and p['inputs']==t['inputs']and p['outputs']==t['outputs']and p['rawBytesSha256']==t['rawBytesSha256'],'Root final parent raw parser')
 blocks=value.get('blocks');proofs=value.get('membershipProofs');need(isinstance(blocks,dict)and set(blocks)==set(selected['expectedHeights'])and isinstance(proofs,dict)and len(proofs)==644,'Root full historical block/proof set');seen=set()
 for block,b in blocks.items():need(type(b.get('height'))is int and b['height']==selected['expectedHeights'][block]and L.header_proof(b['headerHex'])==block==b.get('canonicalHashAtCapture')==b.get('canonicalHashAfter'),'Root historical canonical/header fences')
 for key,p in proofs.items():
  ids=p.get('targetTxids');core=p.get('coreVerifiedTxids');need(isinstance(ids,list)and 0<len(ids)<=64 and ids==sorted(set(ids))and all(L.TXID.fullmatch(t)for t in ids)and isinstance(core,list)and len(core)==len(set(core))and sorted(core)==ids and not seen.intersection(ids),'Root exact unique batch target/Core set');ind=L.merkle_inclusion(p['proofHex']);block=p.get('blockHash');need(block in blocks and ind['blockHash']==block and len(ind['matchedTxids'])==len(set(ind['matchedTxids']))and sorted(ind['matchedTxids'])==ids and p['proofHex'][:160]==blocks[block]['headerHex'],'Root offlineMerkle/header body');seen.update(ids)
 need(len(seen)==10232 and sha(json.dumps(sorted(seen),separators=(',',':')).encode())==selected['targetSetSha256'],'Root full10232 target proof closure');fee=value.get('feeSummary');need(isinstance(fee,dict)and fee.get('targetCount')==10232 and type(fee.get('coinbaseCount'))is int and 0<=fee['coinbaseCount']<=10232 and type(fee.get('nonCoinbaseFeeProofs'))is int and fee['nonCoinbaseFeeProofs']>=0 and re.fullmatch('[0-9a-f]{64}',fee.get('feeRowsSha256',''))and fee.get('requiredParentCount')==22264 and fee.get('uniquePrevoutCount')==32516,'Root exact scoped integer-fee summary');need(value.get('balanceSnapshot')==value.get('chainBefore'),'Root declared opening balance snapshot');return value

def run(v):
 rid,_=validate_request(v);original=seed_read(v);prior=prior_authority();gid=pwd.getpwnam('bitcoin').pw_gid;p=BASE/rid;proof=package_proof(p,gid);selected=selection_authority(p,original);canonical_dir(EVIDENCE);e=EVIDENCE/('audit30-treasury-final-closure-'+rid);need(not e.exists()and not e.is_symlink(),'Evidence exists');o=Observer('proofofwork-audit30-treasury-final-closure-'+rid+'.service',e,time.monotonic()+DEADLINE,fixed_argv(p));absence=require_absent(o);before=live_snapshot(o);need(before==v['liveServices'],'Fresh admitted live five changed');window_before=check_window(o,v);os.mkdir(e,0o700);dir_fsync(EVIDENCE);intent={'schema':'pow-audit30-treasury-native-intent-v1','atUtc':utc(),'runId':rid,'approvalSha256':APPROVAL,'package':proof,'selectedParentSetSha256':selected['selectedSha256'],'selectedParentCount':2569,'allMissingParents':2569,'futureChunksAuthorized':False,'priorPackageProof':{'metadata':selected['priorPackageMetadata'],'files':selected['priorPackageFiles']},'originalFailedCorpusProof':prior,'liveBefore':before,'prelaunchUnitAbsence':absence,'inputRawDeltaSha256':SEED_SHA,'seedCorpusOriginalMetadata':v['seedSource']['metadata'],'backupWindowBefore':window_before,'retainedUnitProbeSha256':RETAINED_PROBE_SHA,'outputPropertyProbeSha256':OUTPUT_PROPERTY_PROBE_SHA,'productionDataMutation':False};durable(e/'intent.json',intent)
 for name in('corpus.json','stderr.log'):
  fd=os.open(e/name,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600);os.fsync(fd);os.close(fd)
 dir_fsync(e);old={};failure=None;cleanup=None;captured=None;after=None;ready=False;launch_attempted=False;window_after=None;seed_unchanged=False
 def interrupted(s,f):raise NativeInterrupted('operator-signal-'+str(s))
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
  need(d['MainPID']=='0'and d['Result']=='success'and d['ExecMainStatus']=='0','Native collector exit refusal');need(package_proof(p,gid)==proof,'Package drift after capture');after=live_snapshot(o);need(after==before,'Live authority changed during readonly census');window_after=check_window(o,v,False);need(seed_read(v)==original,'Original failed corpus changed during raw acquisition');seed_unchanged=True;out,raw=capture_proof(e/'corpus.json',MAX_OUT);err,_=capture_proof(e/'stderr.log',MAX_ERR);need(err['bytes']==0,'Native collector stderr');value=validate_delta(json.loads(raw,object_pairs_hook=pairs),selected);captured={'stdout':out,'stderr':err,'coverage':value.get('coverage'),'status':value.get('status'),'closingFencesAccepted':value['closingFencesAccepted'],'feeSummary':value['feeSummary'],'scopedVerification':{k:value[k]for k in('parentValuesComplete','targetCanonicalMembershipComplete','knownHistoryFeeAndDirectSpendCoverageAccepted','derivedUnspentCoreChecksComplete','knownHistoryBalanceComparisonAccepted')}};ready=True
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
   try:
    seed_unchanged=(seed_read(v)==original and prior_authority()==prior and selection_authority(p,original)==selected);need(seed_unchanged,'All prior inputs changed before outcome')
   except BaseException as ex:
    seed_unchanged=False
    if failure is None:failure={'errorClass':type(ex).__name__,'privateReasonSha256':sha(str(ex).encode()),'phase':'original-seed-final-fence'};ready=False
   receipt={'captureFiles':capture_files,'originalFailedCorpusAndPriorPackageUnchanged':seed_unchanged,'selectedParentSetSha256':selected['selectedSha256'],'selectedParentCount':2569,'remainingParentsAfterComplete':0,'futureChunksAuthorized':False,'inputRawDeltaOriginalUnchanged':seed_unchanged,'inputRawDeltaSha256':SEED_SHA,'backupWindowBefore':window_before,'backupWindowAfter':window_after,'schema':'pow-audit30-treasury-native-outcome-v1','atUtc':utc(),'runId':rid,'transportAccepted':ready,'result':captured,'failure':failure,'cleanup':cleanup,'unitSnapshots':o.snapshots,'liveBefore':before,'liveAfter':after,'retainedUnitProbeSha256':RETAINED_PROBE_SHA,'outputPropertyProbeSha256':OUTPUT_PROPERTY_PROBE_SHA,'productionDataMutation':False,'financialReconciliationComplete':False,'may9TransactionIDsRequested':False,'automaticNextChunk':False,'autoRetry':False};binding=durable(e/('completed.json'if ready else'failed.json'),receipt)
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
