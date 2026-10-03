#!/usr/bin/python3 -I
"""Fixed read-only old logical dump/member and private-job metadata proof.
No SQL/private PG/Core/service configuration/pin/retirement changes.
Only its exact newly admitted audit unit and evidence may be created/stopped.
"""
import base64,datetime,hashlib,json,os,re,signal,stat,subprocess,sys,time
from pathlib import Path
SOURCE_SHA='e04fb72a039826bc090f7dafd6d9fd347b5a45b688427b74a651cedf83bdaf40'
APPROVAL='6821c987b9a5d110fbe9fb2820955b7cbc26dda9faddb67667fc49e892f5c820'
RID='20261003T035500Z';UNIT='proofofwork-audit30-old-retirement-proof-'+RID+'.service';DIRECTORY=Path('/var/tmp/proofofwork-audit30-old-retirement-proof-'+RID);OUT=DIRECTORY/'proof.json';ERR=DIRECTORY/'stderr.log';HOST='pow-bitcoin-01'
JOBS=('/data/proofofwork-audit30-restore-20261002T234651Z','/data/proofofwork-audit30-inspect-20261003T005512Z','/data/proofofwork-audit30-inspect-20261003T014100Z')
RO=('/data/proofofwork-postgres-backups/logical',*JOBS,'/etc/proofofwork-postgres-logical-backup.pins');DENIED=('/var/lib/postgresql','/run/postgresql','/data/proofofwork-postgres-tablespaces','/etc/proofofwork-api','/data/bitcoin')
LIVE=('bitcoind.service','electrs.service','postgresql@16-main.service','proofofwork-api.service','proofofwork-indexer-worker.service')
FIELDS=('LoadState','ActiveState','SubState','MainPID','InvocationID','Type','Transient','RemainAfterExit','User','Group','ControlGroup','Result','ExecMainStatus','CPUQuotaPerSecUSec','CPUWeight','IOWeight','Nice','MemoryHigh','MemoryMax','MemorySwapMax','TasksMax','RuntimeMaxUSec','TimeoutStopUSec','KillMode','Restart','NoNewPrivileges','CapabilityBoundingSet','AmbientCapabilities','ProtectSystem','ProtectHome','PrivateTmp','PrivateDevices','PrivateIPC','PrivateNetwork','RestrictAddressFamilies','ReadOnlyPaths','ReadWritePaths','InaccessiblePaths','StandardInput','StandardOutput','StandardError','LimitFSIZE','UMask','FragmentPath','DropInPaths','SourcePath')
PROPS={'Type':'exec','RemainAfterExit':'yes','User':'postgres','Group':'postgres','CPUQuota':'25%','CPUWeight':'10','IOWeight':'10','Nice':'15','MemoryHigh':'96M','MemoryMax':'128M','MemorySwapMax':'0','TasksMax':'16','RuntimeMaxSec':'6min','TimeoutStopSec':'30s','KillMode':'control-group','Restart':'no','NoNewPrivileges':'yes','CapabilityBoundingSet':'','AmbientCapabilities':'','ProtectSystem':'strict','ProtectHome':'yes','PrivateTmp':'yes','PrivateDevices':'yes','PrivateIPC':'yes','PrivateNetwork':'yes','RestrictAddressFamilies':'AF_UNIX','ReadOnlyPaths':' '.join(RO),'ReadWritePaths':'','InaccessiblePaths':' '.join(DENIED),'StandardInput':'null','StandardOutput':'append:'+str(OUT),'StandardError':'append:'+str(ERR),'LimitFSIZE':'32M','UMask':'0077'}
DEADLINE=0;OWNED=None;LAUNCHED=False;ARGV=None

def need(v,m):
 if not v:raise ValueError(m)
def sha(b):return hashlib.sha256(b).hexdigest()
def encoded(v):return json.dumps(v,sort_keys=True,separators=(',',':')).encode()
def pairs(rows):
 d={}
 for k,v in rows:need(k not in d,'Duplicate key');d[k]=v
 return d
def parse(b):return json.loads(b,object_pairs_hook=pairs)
def metadata(s):return {'dev':s.st_dev,'ino':s.st_ino,'uid':s.st_uid,'gid':s.st_gid,'mode':stat.S_IMODE(s.st_mode),'nlink':s.st_nlink,'bytes':s.st_size,'mtimeNs':s.st_mtime_ns,'ctimeNs':s.st_ctime_ns}
def durable(path,value):
 raw=encoded(value);fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
 with os.fdopen(fd,'wb')as f:f.write(raw);f.flush();os.fsync(f.fileno())
 fd=os.open(path.parent,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW);os.fsync(fd);os.close(fd)
 return {'path':str(path),'bytes':len(raw),'sha256':sha(raw)}
def command(argv,cleanup=False):
 need(cleanup or time.monotonic()<DEADLINE,'Root whole420s deadline');r=subprocess.run(argv,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=15 if cleanup else min(15,max(.01,DEADLINE-time.monotonic())),env={'PATH':'/usr/sbin:/usr/bin:/sbin:/bin','LC_ALL':'C'},cwd='/');need(r.returncode==0 and len(r.stdout)<=131072 and len(r.stderr)<=131072,'Fixed command refused '+sha(r.stderr));return r.stdout

def show(unit,fields,cleanup=False):
 b=command(['/usr/bin/systemctl','show',unit,'--no-pager',*['--property='+k for k in fields]],cleanup);d={}
 for line in b.decode().splitlines():
  k,sep,v=line.partition('=');need(sep and k not in d,'Unit property shape');d[k]=v
 need(set(d)==set(fields),'Unit fields missing');return d

def absent(v):need(v['LoadState']=='not-found'and v['ActiveState']=='inactive'and v['SubState']=='dead'and v['MainPID']=='0'and v['InvocationID']=='','Preexisting audit unit')
def identity(v,owned=None,cleanup=False):
 fixed=v['ControlGroup']=='/system.slice/'+UNIT;empty=v['ControlGroup']==''and v['MainPID']=='0'and v['ActiveState']=='active'and v['SubState']=='exited'and v['Result']=='success'and v['ExecMainStatus']=='0'
 failed=cleanup and owned is not None and v['ControlGroup']==''and v['MainPID']=='0'and v['ActiveState']=='failed'and v['SubState']=='failed'
 need(v['LoadState']=='loaded'and v['Type']=='exec'and v['Transient']=='yes'and v['RemainAfterExit']=='yes'and v['User']==v['Group']=='postgres'and v['MainPID'].isdigit()and re.fullmatch('[a-f0-9]{32}',v['InvocationID'])and(owned is None or v['InvocationID']==owned)and(fixed or empty or failed),'Exact owned audit unit identity')

def typed(cleanup=False):
 m=parse(command(['/usr/bin/busctl','--system','--json=short','call','org.freedesktop.systemd1','/org/freedesktop/systemd1','org.freedesktop.systemd1.Manager','GetUnit','s',UNIT],cleanup));need(isinstance(m,dict)and set(m)=={'type','data'}and m['type']=='o'and isinstance(m['data'],list)and len(m['data'])==1 and isinstance(m['data'][0],str)and re.fullmatch('/org/freedesktop/systemd1/unit/[A-Za-z0-9_]+',m['data'][0]),'Typed manager unit object');v=parse(command(['/usr/bin/busctl','--system','--json=short','get-property','org.freedesktop.systemd1',m['data'][0],'org.freedesktop.systemd1.Service','ExecStart'],cleanup));need(isinstance(v,dict)and set(v)=={'type','data'}and v['type']=='a(sasbttttuii)'and isinstance(v['data'],list)and len(v['data'])==1,'Typed single ExecStart');e=v['data'][0];need(isinstance(e,list)and len(e)==10 and e[0]==ARGV[0]and e[1]==ARGV and e[2]is False and all(type(n)is int and n>=0 for n in e[3:]),'Fixed exact nativePG collector command');return {'objectPath':m['data'][0],'argvSha256':sha(encoded(ARGV))}

def validate_resources(v):
 expected={'CPUQuotaPerSecUSec':'250ms','CPUWeight':'10','IOWeight':'10','Nice':'15','MemoryHigh':str(96*1024**2),'MemoryMax':str(128*1024**2),'MemorySwapMax':'0','TasksMax':'16','RuntimeMaxUSec':'6min','TimeoutStopUSec':'30s','LimitFSIZE':str(32*1024**2)}
 expected|={k:PROPS[k]for k in('KillMode','Restart','NoNewPrivileges','CapabilityBoundingSet','AmbientCapabilities','ProtectSystem','ProtectHome','PrivateTmp','PrivateDevices','PrivateIPC','PrivateNetwork','RestrictAddressFamilies','ReadOnlyPaths','ReadWritePaths','InaccessiblePaths','StandardInput','UMask')}
 expected|={'StandardOutput':'append','StandardError':'append'}
 need(all(v[k]==x for k,x in expected.items()),'Actual fixed resource/namespace/output enum drift')

def read_file(path,cap,initial=None):
 s=path.lstat();m=metadata(s);need(path.resolve(strict=True)==path and stat.S_ISREG(s.st_mode)and s.st_uid==s.st_gid==0 and s.st_nlink==1 and not s.st_mode&0o022 and not os.listxattr(path,follow_symlinks=False)and s.st_size<=cap,'Fixed root regular proof file')
 if initial is not None:need(all(m[k]==initial[k]for k in('dev','ino','uid','gid','mode','nlink')),'Capture inode/authority drift')
 fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NOATIME)
 with os.fdopen(fd,'rb')as f:need(metadata(os.fstat(f.fileno()))==m,'Read FD mismatch');b=f.read(cap+1);need(metadata(os.fstat(f.fileno()))==m,'Read FD changed')
 need(metadata(path.lstat())==m and len(b)==s.st_size,'Read path changed');return b,m

def fragment(v):
 p=Path('/run/systemd/transient')/UNIT;need(v['FragmentPath']==str(p)and v['DropInPaths']==v['SourcePath']=='','Exact root transient fragment');raw,m=read_file(p,65536);section='';found={};want={k:PROPS[k]for k in('StandardInput','StandardOutput','StandardError')}
 for line in raw.decode().splitlines():
  line=line.strip()
  if not line or line.startswith(('#',';')):continue
  need(not line.endswith('\\'),'Continuation refused')
  if line.startswith('['):need(line.endswith(']'),'Section malformed');section=line[1:-1];continue
  k,sep,value=line.partition('=')
  if k in want:need(sep and section=='Service'and k not in found and value==want[k],'Exact output directive drift');found[k]=value
 need(found==want,'Output directives missing');return {'path':str(p),'sha256':sha(raw),'metadata':m,'selectedDirectives':found}

def live():
 out={}
 for name in LIVE:
  v=show(name,('LoadState','ActiveState','SubState','MainPID','InvocationID'));need(v['LoadState']=='loaded'and v['ActiveState']=='active'and v['SubState']=='running'and v['MainPID'].isdigit()and int(v['MainPID'])>0 and re.fullmatch('[a-f0-9]{32}',v['InvocationID']),'Live baseline unavailable');out[name]=v
 return out

def quiet():
 s=show('proofofwork-postgres-logical-backup.service',('LoadState','ActiveState','SubState','MainPID','InvocationID'));need(s['LoadState']=='loaded'and s['ActiveState']=='inactive'and s['MainPID']=='0','Backup active');t=show('proofofwork-postgres-logical-backup.timer',('LoadState','ActiveState','NextElapseUSecRealtime'));need(t['LoadState']=='loaded'and t['ActiveState']=='active','Backup timer unavailable');next_=datetime.datetime.strptime(t['NextElapseUSecRealtime'],'%a %Y-%m-%d %H:%M:%S %Z').replace(tzinfo=datetime.timezone.utc);need((next_-datetime.datetime.now(datetime.timezone.utc)).total_seconds()>420,'Backup window shorter than7min');return {'service':s,'timer':t}

def owned_stop():
 global OWNED
 v=show(UNIT,FIELDS,True)
 if v['LoadState']=='not-found':absent(v);return {'verified':True,'alreadyAbsent':True,'ownedInvocation':OWNED}
 identity(v,OWNED,True);t=typed(True)
 if OWNED is None:OWNED=v['InvocationID']
 command(['/usr/bin/systemctl','stop',UNIT],True);after=show(UNIT,FIELDS,True);need(after['MainPID']=='0'and((after['LoadState']=='not-found'and after['InvocationID']=='')or(after['InvocationID']==OWNED and after['ActiveState']in('inactive','failed'))),'Owned unit stop unverified');return {'verified':True,'ownedInvocation':OWNED,'before':v,'typed':t,'after':after}

def main():
 global ARGV,DEADLINE,LAUNCHED,OWNED
 need(os.geteuid()==os.getegid()==0 and sys.flags.isolated and len(sys.argv)==2 and re.fullmatch('[a-f0-9]{64}',sys.argv[1])and os.uname().nodename==HOST,'Fixed isolated root role');DEADLINE=time.monotonic()+420;raw=sys.stdin.buffer.read(65537);need(len(raw)<=65536 and sha(raw)==sys.argv[1],'Exact typed request raw SHA');r=parse(raw);need(set(r)=={'schema','approvalSha256','sourceSha256','sourceBase64','unit','directory'}and r['schema']=='pow-audit30-old-retirement-readonly-native-request-v1'and r['approvalSha256']==APPROVAL and r['sourceSha256']==SOURCE_SHA and r['unit']==UNIT and r['directory']==str(DIRECTORY),'Exact readonly scope');source=base64.b64decode(r['sourceBase64'],validate=True);need(sha(source)==SOURCE_SHA,'Exact e04 original source bytes')
 prefix='import os\nfor _p in '+repr(RO)+':\n if not os.statvfs(_p).f_flag & os.ST_RDONLY: raise ValueError("Required actual readonly mount")\nfor _p in '+repr(DENIED)+':\n try: os.listdir(_p)\n except (PermissionError,FileNotFoundError): continue\n raise ValueError("Live namespace accessible")\n'
 ARGV=['/usr/bin/python3','-I','-B','-c',prefix+source.decode()];absence=show(UNIT,FIELDS);absent(absence);backup=quiet();before=live();need(not os.path.lexists(DIRECTORY)and DIRECTORY.parent.resolve()==DIRECTORY.parent,'New private evidence collision');os.mkdir(DIRECTORY,0o700);durable(DIRECTORY/'intent.json',{'schema':r['schema'],'requestSha256':sha(raw),'sourceSha256':SOURCE_SHA,'unit':UNIT,'argvSha256':sha(encoded(ARGV)),'prelaunchUnitAbsence':absence,'backupBefore':backup,'liveBefore':before,'productionMutation':False});stamps={}
 for p in(OUT,ERR):fd=os.open(p,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600);os.fsync(fd);os.close(fd);stamps[p.name]=metadata(p.lstat())
 old={s:signal.getsignal(s)for s in(signal.SIGTERM,signal.SIGINT,signal.SIGHUP,signal.SIGALRM)}
 def interrupted(s,f):raise InterruptedError('Readonly native420s deadline/signal')
 for s in old:signal.signal(s,interrupted)
 signal.setitimer(signal.ITIMER_REAL,420);failure=None;cleanup=None;observed=[];result=None
 try:
  args=['/usr/bin/systemd-run','--quiet','--no-block','--unit='+UNIT,*['--property='+k+'='+v for k,v in PROPS.items()],'--',*ARGV];LAUNCHED=True;need(command(args)==b'','Unexpected launch output')
  while True:
   v=show(UNIT,FIELDS);identity(v,OWNED);t=typed();OWNED=v['InvocationID'];validate_resources(v);f=fragment(v);observed.append({'atUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'properties':v,'typed':t,'fragment':f});need(len(observed)<=500,'Resource snapshots bound');need(OUT.stat().st_size<=32*1024**2 and ERR.stat().st_size<=1024**2,'Native file capture bound')
   if v['MainPID']=='0'and v['ActiveState']=='active'and v['SubState']=='exited':need(v['Result']=='success'and v['ExecMainStatus']=='0','Collector failed');break
   time.sleep(1)
  proof,pm=read_file(OUT,32*1024**2,stamps[OUT.name]);err,em=read_file(ERR,1024**2,stamps[ERR.name]);need(not err,'Collector stderr');value=parse(proof);need(value.get('schema')=='pow-audit30-old-backup-cluster-readonly-proof-v2'and value.get('productionMutation')is False and value.get('deletionAuthorized')is False and value.get('backupLockAcquired')is False and value.get('backupTimerChanged')is False and value['oldCandidate']['fullMemberHashesReverified']is True,'Exact proof qualification');after=live();need(after==before,'Live service changed during readonly proof');quiet();result={'proofFile':{'path':str(OUT),'sha256':sha(proof),'metadata':pm},'stderr':{'path':str(ERR),'sha256':sha(err),'metadata':em},'allCoveredDumpMemberHashesMatch':True,'clusterMetadataOnlyNoDeletionAdmitted':True,'liveBeforeAfterEqual':True}
 except BaseException as ex:failure={'errorClass':type(ex).__name__,'reasonSha256':sha(str(ex).encode())}
 finally:
  signal.setitimer(signal.ITIMER_REAL,0)
  for s in(signal.SIGTERM,signal.SIGINT,signal.SIGHUP):signal.signal(s,signal.SIG_IGN)
  try:
   if LAUNCHED:cleanup=owned_stop()
  except BaseException as ex:cleanup={'verified':False,'errorClass':type(ex).__name__,'reasonSha256':sha(str(ex).encode())}
  outcome={'schema':'pow-audit30-old-retirement-native-outcome-v1','status':'passed'if failure is None and cleanup and cleanup['verified']else'failed','requestSha256':sha(raw),'sourceSha256':SOURCE_SHA,'unit':UNIT,'failure':failure,'cleanup':cleanup,'actualResourceSnapshots':observed,'result':result,'productionMutation':False,'pinChanged':False,'deletionAuthorized':False,'autoRetry':False};binding=durable(DIRECTORY/('completed.json'if outcome['status']=='passed'else'failed.json'),outcome)
  for s,h in old.items():signal.signal(s,h)
 need(outcome['status']=='passed','Readonly proof failed with durable evidence');return {'schema':outcome['schema'],'status':outcome['status'],'outcome':binding,'result':result,'unitStopVerified':True,'productionMutation':False,'deletionAuthorized':False}
if __name__=='__main__':
 try:v=main()
 except BaseException as ex:print(json.dumps({'schema':'pow-audit30-old-retirement-native-refusal-v1','errorClass':type(ex).__name__,'reasonSha256':sha(str(ex).encode()),'productionMutation':False}),file=sys.stderr);raise SystemExit(1)
 print(json.dumps(v,sort_keys=True,separators=(',',':')))
