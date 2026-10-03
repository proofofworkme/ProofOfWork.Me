#!/usr/bin/python3 -I
"""Creation only. Actual human authority and a fresh exact plan are required.
No promotion, deletion, SQL, RPC, unit or timer control is invoked here.
"""
import base64, datetime, hashlib, json, os, resource, signal, stat, sys, types
from pathlib import Path

BASE=Path('/usr/local/lib/proofofwork-audit30-pin-promotion')
CONTROLLER_SHA='dfa403996e776a8ed192a024848b06f71b5fa041a24bf5b9687ff04ce3714535'
CANDIDATE_SHA='795f1308b74ddc69a022ce7e1413fb4698a82e6cfb14265931d1951ee603c908'
INSTALL_SHA='cd9c266e938d22949c9f0c6a48853933d9bcbb58368071b2da4027f13411eaa5'
FIXED={'promotion.py':(25752,CONTROLLER_SHA),'retention-checker-oct3-dual-pin.py':(20718,CANDIDATE_SHA),'install-retention.py':(12913,INSTALL_SHA)}
CAPS={**{k:v[0]for k,v in FIXED.items()},'approval.json':65536,'human-approval-message.txt':65536,'plan.json':131072}
REQUEST_CAP=524288
class PackageInterrupted(RuntimeError):pass
def need(value,label):
 if not value:raise ValueError(label)
def sha(raw):return hashlib.sha256(raw).hexdigest()
def canonical(value):return json.dumps(value,sort_keys=True,separators=(',',':')).encode()
def pairs(rows):
 value={}
 for k,v in rows:need(k not in value,'Duplicate JSON key');value[k]=v
 return value
def decode(raw):
 value=json.loads(raw,object_pairs_hook=pairs);need(isinstance(value,dict)and set(value)=={'schema','host','files','planSha256','baseMetadata'}and value['schema']=='pow-audit30-coupled-pin-checker-package-request-v1'and value['host']=='pow-bitcoin-01','Exact creator request')
 need(isinstance(value['files'],dict)and set(value['files'])==set(CAPS),'Exact six-member package')
 files={};total=0
 for name,cap in CAPS.items():
  row=value['files'][name];need(isinstance(row,dict)and set(row)=={'bytes','sha256','base64'}and type(row['bytes'])is int and 0<row['bytes']<=cap and isinstance(row['sha256'],str)and len(row['sha256'])==64 and all(c in '0123456789abcdef'for c in row['sha256'])and isinstance(row['base64'],str)and len(row['base64'])<=4*((cap+2)//3),'Exact bounded member')
  body=base64.b64decode(row['base64'],validate=True);need(len(body)==row['bytes']and sha(body)==row['sha256'],'Member bytes/hash');total+=len(body);files[name]=body
  if name in FIXED:need((len(body),sha(body))==FIXED[name],'Exact reviewed code bytes')
 need(total<=262144 and isinstance(value['planSha256'],str)and sha(files['plan.json'])==value['planSha256'],'Bounded canonical plan pin')
 M=types.ModuleType('inert_reviewed_v6');M.__file__='<bound-promotion-v6>';exec(compile(files['promotion.py'],M.__file__,'exec'),M.__dict__)
 I=types.ModuleType('inert_reviewed_install');I.__file__='<bound-install-retention>';exec(compile(files['install-retention.py'],I.__file__,'exec'),I.__dict__)
 plan=json.loads(files['plan.json'],object_pairs_hook=pairs);need(canonical(plan)==files['plan.json'],'Canonical compact approved plan');M.validate(plan)
 for row in list(plan['static'].values()):need(isinstance(row,dict)and set(row)=={'sha256','metadata'}and M.HEX.fullmatch(row['sha256']or''),'Closed public static plan row')
 for meta in [*(r['metadata']for r in plan['static'].values()),plan['freshFullRead']['metadata'],*plan['restoreProofMetadata'].values()]:need(isinstance(meta,dict)and set(meta)==M.META_KEYS and all(type(x)is int and x>=0 for x in meta.values()),'Closed public metadata only')
 need(isinstance(plan['mask'],dict)and set(plan['mask'])=={'metadata','target'}and plan['mask']['target']=='/dev/null'and set(plan['mask']['metadata'])==M.META_KEYS and all(type(x)is int and x>=0 for x in plan['mask']['metadata'].values()),'Closed public mask only')
 need(all(len(x)<=256 and '\x00'not in x for row in plan['units'].values()for x in row.values()),'Bounded public unit values')
 wal=plan['units']['pg_receivewal@16-main.service'];need(wal['ActiveState']=='inactive'and wal['SubState']=='dead'and wal['MainPID']=='0'and wal['UnitFileState']=='disabled','WAL receiver remains inactive')
 approval=json.loads(files['approval.json'],object_pairs_hook=pairs);need(canonical(approval)==files['approval.json'],'Canonical direct-human receipt');M.validate_human_value(approval,plan,CONTROLLER_SHA)
 message=files['human-approval-message.txt'];need(message.decode('utf-8').strip()and b'\x00'not in message,'Exact nonempty UTF8 human message');a=plan['finalHumanApproval'];need(a['sha256']==sha(files['approval.json'])and a['sourceMessageSha256']==sha(message),'Actual human receipt/message raw pins')
 m=value['baseMetadata'];need(m is None or isinstance(m,dict)and set(m)==M.META_KEYS and all(type(x)is int and x>=0 for x in m.values()),'Chosen base metadata')
 return value,files,plan,M,I
def syncdir(path):
 fd=os.open(path,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
 try:os.fsync(fd)
 finally:os.close(fd)
def new_directory(path):
 path.mkdir(mode=0o700);syncdir(path.parent)
def verify_file(path,body,owner=(0,0)):
 s=path.lstat();before=(s.st_dev,s.st_ino,s.st_mode,s.st_uid,s.st_gid,s.st_nlink,s.st_size,s.st_mtime_ns,s.st_ctime_ns)
 need(path.resolve(strict=True)==path and stat.S_ISREG(s.st_mode)and(s.st_uid,s.st_gid)==owner and stat.S_IMODE(s.st_mode)==0o600 and s.st_nlink==1 and s.st_size==len(body)and not os.listxattr(path,follow_symlinks=False),'Created file authority')
 fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NOATIME)
 with os.fdopen(fd,'rb')as f:
  def same():
   a=os.fstat(f.fileno());return(a.st_dev,a.st_ino,a.st_mode,a.st_uid,a.st_gid,a.st_nlink,a.st_size,a.st_mtime_ns,a.st_ctime_ns)==before
  need(same(),'Created file descriptor');read=f.read(len(body)+1);need(same()and not os.listxattr(f.fileno()),'Created file descriptor drift')
 a=path.lstat();need((a.st_dev,a.st_ino,a.st_mode,a.st_uid,a.st_gid,a.st_nlink,a.st_size,a.st_mtime_ns,a.st_ctime_ns)==before and read==body,'Created file bytes/path drift')
 return dict(path=str(path),bytes=len(body),sha256=sha(read),mode=0o600,uid=owner[0],gid=owner[1],nlink=1)
def directory_identity(path):
 s=path.lstat();return(s.st_dev,s.st_ino,s.st_uid,s.st_gid,stat.S_IMODE(s.st_mode))
def admission(M,plan):
 for path in(M.PIN,M.CHECKER):
  need(M.meta(path)==plan['installed'][str(path)],'Installed metadata drift')
  digest=sha(M.OLD_PIN)if path==M.PIN else M.OLD_CHECKER
  body,meta=M.read(path,32768,digest);need(meta['uid']==meta['gid']==0 and meta['mode']==(0o644 if path==M.PIN else 0o755),'Original installed owner/mode')
  if path==M.PIN:need(body==M.OLD_PIN,'Sep29 remains protected')
 M.static_check(plan);states=M.unit_states();M.state_require(states,plan['units']);need(states[M.MONITOR]['MainPID']=='0'and states[M.MONITOR]['ActiveState']in('inactive','failed'),'Idle monitor required');authority=M.backup_check(plan)
 for path in(M.OPS,M.BACKUP_LOCK):need(M.meta(path)==plan['lockMetadata'][str(path)],'Current lock metadata drift')
 return authority
def create(value,files,plan,M,I,request_sha):
 package=Path(plan['package']);audit=BASE/(plan['run']+'.creation');I.directory(BASE.parent)
 if os.path.lexists(BASE):
  I.directory(BASE);need(M.meta(BASE)==value['baseMetadata'],'Chosen base directory drift')
 else:need(value['baseMetadata']is None,'Chosen base unexpectedly absent')
 need(not os.path.lexists(package)and not os.path.lexists(audit),'Creation path exists; no retry/resume')
 admission(M,plan);fds=[];written=[];started=False;handlers={n:signal.getsignal(n)for n in(signal.SIGINT,signal.SIGTERM,signal.SIGHUP)}
 def interrupted(n,_f):raise PackageInterrupted('Package creation interrupted '+str(n))
 for n in handlers:signal.signal(n,interrupted)
 try:
  for path in(M.OPS,M.BACKUP_LOCK):fds.append(M.lock(path,plan['lockMetadata'][str(path)]))
  admission(M,plan)
  if value['baseMetadata']is None:
   need(not os.path.lexists(BASE),'Absent chosen base appeared');new_directory(BASE)
  else:need(M.meta(BASE)==value['baseMetadata'],'Chosen base changed before creation')
  I.directory(BASE);base_identity=directory_identity(BASE);new_directory(audit);started=True;audit_identity=directory_identity(audit);I.directory(audit)
  I.exclusive(audit/'intent.json',canonical(dict(schema='pow-audit30-coupled-package-creation-intent-v1',requestSha256=request_sha,planSha256=value['planSha256'],controllerSha256=CONTROLLER_SHA,approvalReceiptSha256=sha(files['approval.json']),sourceMessageSha256=sha(files['human-approval-message.txt']),package=str(package),members=[dict(name=n,bytes=len(b),sha256=sha(b))for n,b in files.items()],promotionExecuted=False,automaticRetry=False)))
  new_directory(package);package_identity=directory_identity(package)
  for name,body in files.items():
   need(directory_identity(BASE)==base_identity and directory_identity(package)==package_identity,'Creator parent authority drift');I.directory(package);I.exclusive(package/name,body);written.append(name);verify_file(package/name,body)
  need(set(os.listdir(package))==set(CAPS)and not os.path.lexists(package/'evidence'),'Exact immutable six files; promotion evidence absent');I.directory(package)
  authority=admission(M,plan);need(directory_identity(BASE)==base_identity and directory_identity(package)==package_identity,'Creator final parent drift')
  need(set(os.listdir(package))==set(CAPS)and not os.path.lexists(package/'evidence'),'Final six-member package drift');records=[verify_file(package/name,body)for name,body in files.items()]
  syncdir(package);syncdir(BASE)
  result=dict(schema='pow-audit30-coupled-package-creation-completed-v1',status='prepared-only',requestSha256=request_sha,planSha256=value['planSha256'],controllerSha256=CONTROLLER_SHA,package=str(package),members=records,creationEvidence=str(audit),promotionExecuted=False,productionDataMutation=False,deletionAuthorized=False,automaticRetry=False,authorityAtReturn=authority,nextCommand=['/usr/bin/python3','-I','-B',str(package/'promotion.py'),'--plan',str(package/'plan.json'),'--plan-sha256',value['planSha256'],'--self-sha256',CONTROLLER_SHA])
  need(directory_identity(audit)==audit_identity,'Creation custody directory drift');I.directory(audit);I.exclusive(audit/'completed.json',canonical(result));return result
 except BaseException as first:
  for n in handlers:signal.signal(n,signal.SIG_IGN)
  signal.setitimer(signal.ITIMER_REAL,0)
  if started:
   try:
    need(directory_identity(audit)==audit_identity,'Failure custody directory drift');I.directory(audit);I.exclusive(audit/'failed.json',canonical(dict(schema='pow-audit30-coupled-package-creation-failed-v1',errorClass=type(first).__name__,reasonSha256=sha(str(first).encode()),requestSha256=request_sha,package=str(package),writtenMembers=written,promotionExecuted=False,automaticRetry=False,partialPackageRequiresExplicitReview=True)))
   except BaseException:pass
  raise
 finally:
  for fd in fds:os.close(fd)
  for n,h in handlers.items():signal.signal(n,h)
def main():
 need(sys.flags.isolated and sys.dont_write_bytecode and os.geteuid()==os.getegid()==0 and os.uname().nodename=='pow-bitcoin-01'and len(sys.argv)==2,'Fixed isolated root creator')
 def interrupted(_n,_f):raise PackageInterrupted('Creator whole120-second deadline')
 signal.signal(signal.SIGALRM,interrupted);signal.setitimer(signal.ITIMER_REAL,120);resource.setrlimit(resource.RLIMIT_AS,(128*1024**2,128*1024**2));resource.setrlimit(resource.RLIMIT_CPU,(60,60));os.umask(0o077)
 raw=sys.stdin.buffer.read(REQUEST_CAP+1);need(len(raw)<=REQUEST_CAP and sha(raw)==sys.argv[1],'Typed creator stdin/raw SHA');value,files,plan,M,I=decode(raw)
 result=create(value,files,plan,M,I,sha(raw));need(len(canonical(result))<=65536,'Closed creator output cap');signal.setitimer(signal.ITIMER_REAL,0);return result
if __name__=='__main__':
 try:print(json.dumps(main(),sort_keys=True,separators=(',',':')))
 except BaseException as e:print(json.dumps(dict(schema='pow-audit30-coupled-package-creation-refusal-v1',errorClass=type(e).__name__,reasonSha256=sha(str(e).encode()),promotionExecuted=False)),file=sys.stderr);raise SystemExit(1)
