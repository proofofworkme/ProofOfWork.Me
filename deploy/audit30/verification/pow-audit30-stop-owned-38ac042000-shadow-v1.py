#!/usr/bin/env python3
"""Prepare/reconcile only the exact old read-only shadow; execute requires explicit root go."""
import datetime,fcntl,hashlib,json,os,pathlib,pwd,signal,socket,stat,subprocess,sys
RELEASE='38ac6e2bff2a-20261003T042000Z';UNIT='proofofwork-audit29-shadow-'+RELEASE+'.service';INV='8203629fb6ae40ed91dbc7de42c98df0';PID=2885445
ROOT=pathlib.Path('/data/proofofwork-release-backups/audit30-node-release-'+RELEASE);TOOLS=pathlib.Path('/var/tmp/proofofwork-deploy/audit29-tools');NODE='/opt/node-v24.18.0-linux-x64/bin/node';CANDIDATE='/opt/proofofwork-api-stage-'+RELEASE
ENV={'PATH':'/usr/sbin:/usr/bin:/sbin:/bin','LC_ALL':'C','GIT_OPTIONAL_LOCKS':'0','GIT_CONFIG_NOSYSTEM':'1','GIT_CONFIG_GLOBAL':'/dev/null'}
PINS={'attest-node.py':'4bec20fa1e5931636e3bfc84f617f005a7b1b71e752dc7f7c9b8bea23014be38','private-env.py':'99cbe9cd118c63b08480efd28c2ae7c059b5204daef8db08b896a38fc791d515','shadow-entry.mjs':'48da4605178d43d1cfbf7b33aeb45c1a64e9474913d8e51d1513904dd8d4bf4d'}
LIVE={'bitcoind.service':('1324302','64e1fa7be2e2442d8c7f5763f60b85fb'),'electrs.service':('1324320','72418b1c7ab245e4a37685ed868a1084'),'postgresql@16-main.service':('1537429','e0bf545f0ad944e89fe1005577e61b9c'),'proofofwork-api.service':('2103747','208f8bcbecc54afbb7166754f12065c2'),'proofofwork-indexer-worker.service':('2103760','33b3ee25490749db89e0d55fd29d0afb')}
def need(v,m):
 if not v:raise ValueError(m)
def stamp(s):return (s.st_dev,s.st_ino,s.st_mode,s.st_uid,s.st_gid,s.st_nlink,s.st_size,s.st_mtime_ns,s.st_ctime_ns)
def read(p,expected,cap=2*1024**2):
 p=pathlib.Path(p);m=p.lstat();need(p.resolve()==p and stat.S_ISREG(m.st_mode)and m.st_uid==m.st_gid==0 and stat.S_IMODE(m.st_mode)==0o600 and m.st_nlink==1 and m.st_size<=cap,'SOURCE_SHAPE');fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW|os.O_NOATIME)
 try:b=os.read(fd,cap+1);need(len(b)==m.st_size and stamp(os.fstat(fd))==stamp(m)==stamp(p.lstat())and hashlib.sha256(b).hexdigest()==expected,'SOURCE_DRIFT');return b
 finally:os.close(fd)
def call(argv,timeout=20):
 r=subprocess.run(argv,env=ENV,capture_output=True,timeout=timeout);need(r.returncode==0 and not r.stderr and len(r.stdout)<65536,'COMMAND_REFUSED');return r.stdout
def state(u):return dict(x.split('=',1)for x in call(['/usr/bin/systemctl','show',u,'--property=LoadState,ActiveState,MainPID,InvocationID,User,Group,KillMode,RuntimeMaxUSec,Restart,ExecStart']).decode().splitlines()if '='in x)
def validate_unit(s):
 fragment='/usr/bin/python3 -I -B '+str(TOOLS/'private-env.py')+' launch --release-id '+RELEASE+' --mode readonly-shadow --source api'
 need(s.get('LoadState')=='loaded'and s.get('InvocationID')==INV and s.get('User')==s.get('Group')=='root'and s.get('KillMode')=='control-group'and s.get('RuntimeMaxUSec')=='45min'and s.get('Restart')=='no'and fragment in s.get('ExecStart',''),'OWNED_UNIT_CHANGED')
 need(s.get('MainPID')in {str(PID),'0'}and (s.get('MainPID')=='0' or s.get('ActiveState')=='active'),'OWNED_PID_CHANGED')
def validate_process(p,uid,gid):
 need(p['pid']==PID and p['uid']==[uid]*4 and p['gid']==[gid]*4 and p['exe']==NODE and p['cwd']==CANDIDATE and p['cgroup']=='0::/system.slice/'+UNIT and p['noNewPrivileges']=='1'and all(int(v,16)==0 for v in p['capabilities']),'OWNED_PROCESS_CHANGED')
 need(p['argvPrefix']==[NODE,'--input-type=module','--eval']and p['argvCount']==4 and p['entrySHA256']==PINS['shadow-entry.mjs']and type(p['startTicks'])is int and p['startTicks']>0,'OWNED_PROCESS_COMMAND_CHANGED')
def identity(pid):
 p=pathlib.Path('/proc')/str(pid);before=(p/'stat').read_text();status=dict(x.split(':',1)for x in (p/'status').read_text().splitlines()if ':'in x);argv=(p/'cmdline').read_bytes().rstrip(b'\0').split(b'\0');after=(p/'stat').read_text();start=lambda s:int(s[s.rfind(')')+2:].split()[19]);need(start(before)==start(after),'PID_REUSED')
 return dict(pid=pid,startTicks=start(before),uid=list(map(int,status['Uid'].split())),gid=list(map(int,status['Gid'].split())),exe=os.readlink(p/'exe'),cwd=os.readlink(p/'cwd'),cgroup=(p/'cgroup').read_text().strip(),noNewPrivileges=status['NoNewPrivs'].strip(),capabilities=[status[k].strip()for k in ['CapEff','CapPrm','CapInh','CapAmb']],argvPrefix=[b.decode()for b in argv[:3]],argvCount=len(argv),entrySHA256=hashlib.sha256(argv[3]).hexdigest()if len(argv)==4 else '')
def validate_stopped_unit(s):
 if s.get('LoadState')=='not-found':
  need(s.get('MainPID','0')=='0'and s.get('ActiveState')=='inactive','OWNED_UNIT_NOT_STOPPED');return
 validate_unit(s);need(s.get('MainPID')=='0'and s.get('ActiveState')in {'inactive','failed'},'OWNED_UNIT_NOT_STOPPED')
def old_process_absent(proc):
 if proc is None:return True
 try:text=(pathlib.Path('/proc')/str(PID)/'stat').read_text()
 except FileNotFoundError:return True
 return int(text[text.rfind(')')+2:].split()[19])!=proc['startTicks']
def live():
 result={u:state(u)for u in LIVE}
 need(all(s.get('ActiveState')=='active'and (s.get('MainPID'),s.get('InvocationID'))==LIVE[u]for u,s in result.items()),'LIVE_IDENTITY_DRIFT');return result
def write(name,value):
 fd=os.open(ROOT/name,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
 with os.fdopen(fd,'wb')as f:f.write((json.dumps(value,sort_keys=True)+'\n').encode());f.flush();os.fsync(f.fileno())
 fd=os.open(ROOT,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
 try:os.fsync(fd)
 finally:os.close(fd)
def interrupted(signum,frame):raise RuntimeError('OWNED_SHADOW_STOP_SIGNAL')
def execute():
 signal.signal(signal.SIGTERM,interrupted);signal.signal(signal.SIGINT,interrupted)
 need(os.geteuid()==os.getegid()==0,'ROOT');m=ROOT.lstat();need(ROOT.resolve()==ROOT and m.st_uid==m.st_gid==0 and stat.S_IMODE(m.st_mode)==0o700,'ROOT_SHAPE')
 for name in ['shadow-stop-intent-v1.json','shadow-stop-completed-v1.json','shadow-stop-failed-v1.json']:need(not os.path.lexists(ROOT/name),'EVIDENCE_EXISTS')
 lock=pathlib.Path('/run/proofofwork-audit29-ops.lock');m=lock.lstat();need(lock.resolve()==lock and stat.S_ISREG(m.st_mode)and m.st_uid==m.st_gid==0 and stat.S_IMODE(m.st_mode)==0o600 and m.st_nlink==1,'LOCK_SHAPE');fd=os.open(lock,os.O_RDWR|os.O_NOFOLLOW)
 try:
  need(stamp(os.fstat(fd))==stamp(m),'LOCK_OPEN_DRIFT');fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB);need(stamp(os.fstat(fd))==stamp(m)==stamp(lock.lstat()),'LOCK_POSTFLOCK_DRIFT')
  for name,pin in PINS.items():read(TOOLS/name,pin)
  old=read(ROOT/'old-live.tsv','ecb2f2b7dde7253af35252109aab003666dca54b51ff6c81f719315fb2dc6bf6');candidate=read(ROOT/'candidate.tsv','98343f1ecff80e2b203355a2272df966cc108b0a89890c9d3fabfd5b0b8e084d');attest=['/usr/bin/python3','-I','-B',str(TOOLS/'attest-node.py')]
  need(call(attest+['/opt/proofofwork-api'],180)==old and call(attest+[CANDIDATE],180)==candidate,'ATTESTATION_DRIFT');before=live();shape=state(UNIT);validate_unit(shape);account=pwd.getpwnam('powadmin');proc=None
  if shape['MainPID']!='0':proc=identity(PID);validate_process(proc,account.pw_uid,account.pw_gid)
  write('shadow-stop-intent-v1.json',dict(schema='pow-audit30-exact-owned-readonly-shadow-stop-intent-v1',unit=UNIT,invocationID=INV,mainPID=shape['MainPID'],process=proc,productionStop=False,productionDataMutation=False,timerChanges=False))
  try:
   fresh=state(UNIT);validate_unit(fresh)
   if fresh['MainPID']!='0':need(proc is not None and identity(PID)==proc,'OWNED_PROCESS_DRIFT');call(['/usr/bin/systemctl','stop',UNIT],45)
   stopped=state(UNIT);validate_stopped_unit(stopped);need(old_process_absent(proc),'OWNED_PROCESS_STILL_PRESENT');need(live()==before and call(attest+['/opt/proofofwork-api'],180)==old and call(attest+[CANDIDATE],180)==candidate,'LIVE_OR_SOURCE_CHANGED')
   with socket.socket()as probe:probe.bind(('127.0.0.1',18081))
   result=dict(schema='pow-audit30-exact-owned-readonly-shadow-stop-completed-v1',atUtc=datetime.datetime.now(datetime.timezone.utc).isoformat(),unit=UNIT,invocationID=INV,oldPID=PID,stopped=True,naturallyStoppedBefore=shape['MainPID']=='0',loopback18081AvailableAtCheck=True,liveServicesUnchanged=True,oldCandidateAndLiveAttestationsUnchanged=True,preservedCandidateCacheCaptureAndEvidence=True,productionStop=False,productionDataMutation=False,timerChanges=False,qualification='Only the exact owned read-only transient service was stopped. Candidate, private environment capture, cache and prior failure evidence remain. A subsequent shadow must independently bind18081; this availability check does not reserve the port.')
   write('shadow-stop-completed-v1.json',result);return result
  except BaseException as error:
   signal.signal(signal.SIGTERM,signal.SIG_IGN);signal.signal(signal.SIGINT,signal.SIG_IGN);write('shadow-stop-failed-v1.json',dict(schema='pow-audit30-exact-owned-shadow-stop-failed-v1',errorClass=type(error).__name__,unit=UNIT,invocationID=INV,automaticRetry=False,productionStop=False,productionDataMutation=False,timerChanges=False));raise
 finally:os.close(fd)
if __name__=='__main__':
 if sys.argv[1:]!=['--stop-exact-owned-38ac042000-shadow']:raise SystemExit('Explicit exact-owned action required')
 print(json.dumps(execute(),sort_keys=True))
