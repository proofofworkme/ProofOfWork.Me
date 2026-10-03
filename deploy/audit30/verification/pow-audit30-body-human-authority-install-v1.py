#!/usr/bin/python3 -I -B
"""Fixed receipt custody install only. No unit, PG, Core, writer or production run."""
import base64,hashlib,json,os,resource,signal,stat,sys,types
from pathlib import Path
BASE=Path('/data/proofofwork-release-backups');AUTH=BASE/'audit30-mail-body-authority-20261003T142900Z'
HELPER_SHA='33c3c65c079901022850d4407c4df460b6924196d077061ba86d0d27ef385729'
FILES={'human-approval.json':(2651,'f37e16a1d9b8c6f52081a7c44d01d8a5142051770d7d16aafe9fcaa9e5354c42'),'direct-human-approval.json':(1404,'184065046a3b6031ca0b47e5e1932321bab2672298a7da1fc9654c6d3a3fec49'),'human-message.txt':(9,'d93213cc5dec29d6c4aaf3178f76597665211100423e41d61d60fd163dfb5dcf')}
class Interrupted(RuntimeError):pass
def need(v,c):
 if not v:raise ValueError(c)
def sha(b):return hashlib.sha256(b).hexdigest()
def pairs(rows):
 d={}
 for k,v in rows:need(k not in d,'DUPLICATE_JSON_KEY');d[k]=v
 return d
def enc(v):return json.dumps(v,sort_keys=True,separators=(',',':')).encode()
def decode(raw):
 need(0<len(raw)<=65536,'TYPED_INSTALL_CAP');v=json.loads(raw,object_pairs_hook=pairs);need(set(v)=={'schema','authorityRunId','captureHelperBase64','files'}and v['schema']=='pow-audit30-body-human-authority-install-v1'and v['authorityRunId']=='20261003T142900Z'and set(v['files'])==set(FILES),'FIXED_AUTHORITY_SCOPE');helper=base64.b64decode(v['captureHelperBase64'],validate=True);need(len(helper)<=32768 and sha(helper)==HELPER_SHA,'EXACT_FS_HELPER_PIN');members={}
 for n,(size,h)in FILES.items():
  r=v['files'][n];need(isinstance(r,dict)and set(r)=={'bytes','sha256','base64'}and type(r['bytes'])is int and r['bytes']==size and r['sha256']==h,'EXACT_APPROVED_MEMBER');b=base64.b64decode(r['base64'],validate=True);need(len(b)==size and sha(b)==h,'EXACT_MEMBER_BYTES');members[n]=b
 a=json.loads(members['human-approval.json'],object_pairs_hook=pairs);need(enc(a)==members['human-approval.json']and len(a)==24 and a['status']=='approved'and a['authority']=='human'and a['humanApprovalEvidenceSHA256']==FILES['direct-human-approval.json'][1]and a['productionDataChangeApproved']is True and a['canonicalReadinessInvalidationApproved']is True,'CANONICAL_ACTUAL_BODY_APPROVAL');need(members['human-message.txt']==b'i approve','ACTUAL_NINE_BYTE_MESSAGE');return helper,members

def directory(p):
 p=Path(p);s=p.lstat();need(p.resolve(strict=True)==p and stat.S_ISDIR(s.st_mode)and s.st_uid==0 and not stat.S_IMODE(s.st_mode)&0o022,'ROOT_CANONICAL_PARENT');return(s.st_dev,s.st_ino,s.st_uid,s.st_gid,stat.S_IMODE(s.st_mode))
def verify(p,b):
 s=p.lstat();need(p.resolve(strict=True)==p and stat.S_ISREG(s.st_mode)and(s.st_uid,s.st_gid,stat.S_IMODE(s.st_mode),s.st_nlink,s.st_size)==(0,0,0o600,1,len(b))and not os.listxattr(p,follow_symlinks=False),'ROOT_PRIVATE_MEMBER');fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW)
 try:
  stamp=lambda x:(x.st_dev,x.st_ino,x.st_mode,x.st_uid,x.st_gid,x.st_nlink,x.st_size,x.st_mtime_ns,x.st_ctime_ns)
  need(stamp(os.fstat(fd))==stamp(s),'AUTHORITY_FD_DRIFT');actual=os.read(fd,len(b)+1);need(actual==b and stamp(os.fstat(fd))==stamp(s)==stamp(p.lstat()),'AUTHORITY_BYTES_DRIFT')
 finally:os.close(fd)
def install(raw):
 helper,members=decode(raw);m=types.ModuleType('frozen_custody_helpers');m.__file__='/reviewed/33c.py';exec(compile(helper,m.__file__,'exec'),m.__dict__);parent=directory(BASE);need(not os.path.lexists(AUTH),'AUTHORITY_ALREADY_EXISTS');owned=None
 try:
  # Defer ordinary operator signals only across new-dir identity/intent custody.
  previous=signal.pthread_sigmask(signal.SIG_BLOCK,{signal.SIGINT,signal.SIGTERM,signal.SIGHUP})
  try:
   m.newdir(AUTH,0,0,0o700);owned=directory(AUTH);m.record(AUTH/'install-intent.json',{'schema':'pow-audit30-body-human-authority-install-intent-v1','files':{n:{'bytes':len(b),'sha256':sha(b)}for n,b in members.items()},'nativeProductionAction':False,'automaticRetry':False})
  finally:signal.pthread_sigmask(signal.SIG_SETMASK,previous)
  # Approval is last, after exact provenance bytes have durable custody.
  for n in ['direct-human-approval.json','human-message.txt','human-approval.json']:m.create(AUTH/n,members[n],0o600,0);verify(AUTH/n,members[n])
  need(directory(BASE)==parent and directory(AUTH)==owned and set(os.listdir(AUTH))==set(FILES)|{'install-intent.json'},'AUTHORITY_SCOPE_OR_PARENT_DRIFT');m.record(AUTH/'install-completed.json',{'schema':'pow-audit30-body-human-authority-install-completed-v1','status':'installed','approvalPath':str(AUTH/'human-approval.json'),'approvalSHA256':FILES['human-approval.json'][1],'humanEvidenceSHA256':FILES['direct-human-approval.json'][1],'actualMessageSHA256':FILES['human-message.txt'][1],'nativeProductionAction':False,'automaticRetry':False});print(json.dumps({'status':'installed','approvalPath':str(AUTH/'human-approval.json'),'approvalSHA256':FILES['human-approval.json'][1],'nativeProductionAction':False},sort_keys=True))
 except BaseException as e:
  for s in [signal.SIGINT,signal.SIGTERM,signal.SIGHUP]:signal.signal(s,signal.SIG_IGN)
  if owned is not None and directory(AUTH)==owned:m.record(AUTH/'install-failed.json',{'schema':'pow-audit30-body-human-authority-install-failed-v1','errorClass':type(e).__name__,'partialAuthorityRetained':True,'automaticRetry':False,'nativeProductionAction':False})
  raise

def main():
 need(sys.flags.isolated and os.getuid()==os.geteuid()==os.getgid()==os.getegid()==0 and os.uname().nodename=='pow-bitcoin-01','FIXED_ROOT_HOST');os.umask(0o077);os.environ.clear();os.environ.update(PATH='/usr/bin:/bin',LC_ALL='C',TZ='UTC');resource.setrlimit(resource.RLIMIT_AS,(128*1024**2,128*1024**2));resource.setrlimit(resource.RLIMIT_CPU,(15,15));signal.alarm(30);install(sys.stdin.buffer.read(65537))
if __name__=='__main__':
 for s in [signal.SIGINT,signal.SIGTERM,signal.SIGHUP,signal.SIGALRM]:signal.signal(s,lambda *_:(_ for _ in()).throw(Interrupted('Authority install interrupted')))
 try:main()
 except BaseException as e:print(json.dumps({'status':'refused','errorClass':type(e).__name__,'partialAuthorityRequiresExplicitObservation':True,'automaticRetry':False,'nativeProductionAction':False},sort_keys=True),file=sys.stderr);sys.exit(1)
