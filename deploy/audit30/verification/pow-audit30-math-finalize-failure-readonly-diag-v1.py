import datetime,hashlib,json,os,stat,subprocess,sys
from pathlib import Path
BASE=Path('/usr/local/lib/proofofwork-audit30-onhost-math/v2')
ORIGINAL={'source-copy-failed.json':'9fbe4a4930765b1eb20820aaa043aa87405c6b59f00c09ecb008beda2e79d6a6','source-copy-intent.json':'74d12ace78e3f224c537c583f824d209efbeea9d55ee623d8f4dab034e5d5136','copied-preflight.json':'cd6a98eaf9a9e796a095779980ff2655c0792d1a82bf26ca90c0883fc7a53a4e','read-copy.mjs':'9273e05bef60e8e85a13502ccd9ab139b13a4c5546b27e843777b073f1823ce0'}
NEW=('source-copy-finalize-v2-intent.json','source-copy-finalize-v2-failed.json','source-copy-finalize-v2-completed.json','source-copy-finalize-v2-readability.stdout','source-copy-finalize-v2-readability.stderr','source-copy-manifest.json')
def identity(s):return dict(dev=s.st_dev,ino=s.st_ino,uid=s.st_uid,gid=s.st_gid,mode=stat.S_IMODE(s.st_mode),nlink=s.st_nlink,bytes=s.st_size,mtimeNs=s.st_mtime_ns,ctimeNs=s.st_ctime_ns)
def need(v,m):
 if not v:raise ValueError(m)
def read(name):
 p=BASE/name
 if not os.path.lexists(p):return {'path':str(p),'exists':False},None
 s=p.lstat();need(p.resolve(strict=True)==p and stat.S_ISREG(s.st_mode)and s.st_uid==0 and s.st_nlink==1 and not s.st_mode&0o022 and s.st_size<=4*1024**2,'Fixed regular code-only receipt scope');before=identity(s);fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW|os.O_NOATIME)
 with os.fdopen(fd,'rb')as f:
  need(identity(os.fstat(f.fileno()))==before,'FD mismatch');b=f.read(4*1024**2+1);need(identity(os.fstat(f.fileno()))==before,'Read mismatch')
 need(identity(p.lstat())==before and len(b)==s.st_size,'Path mismatch');return {'path':str(p),'exists':True,'metadata':before,'sha256':hashlib.sha256(b).hexdigest()},b
need(os.geteuid()==0 and sys.flags.isolated and len(sys.argv)==1 and os.uname().nodename=='pow-bitcoin-01','Root fixed readonly role')
need(BASE.resolve(strict=True)==BASE and BASE.lstat().st_uid==0 and stat.S_IMODE(BASE.lstat().st_mode)==0o750,'Fixed immutable code package')
rows=[];failure=None
for name in (*ORIGINAL,*NEW):
 r,b=read(name);rows.append(r)
 if name in ORIGINAL:need(r.get('sha256')==ORIGINAL[name],'Original code custody changed')
 if name=='source-copy-finalize-v2-failed.json'and b is not None:
  v=json.loads(b);keys={'schema','status','requestSHA256','code','nativeReadabilityCleanup','priorAttemptRemainsFailed','sourceTreeNotModified','productionMutation','automaticRetry'};need(set(v)==keys and v['schema']=='pow-audit30-source-copy-finalize-failed-v2'and v['status']=='failed'and v['requestSHA256']=='6ec56daa857bba47bf817b1598b2f4a8df9eadaa6d8a0f6bc628982462b81bcf'and v['code']=='FINALIZE_READABILITY_ACTUAL_HARDENING'and v['priorAttemptRemainsFailed']is True and v['sourceTreeNotModified']is True and v['productionMutation']is False and v['automaticRetry']is False,'Exact public failure shape');c=v['nativeReadabilityCleanup'];need(isinstance(c,dict)and set(c)<={'attempted','ownedInvocation','unitStopVerified','unitAlreadyAbsent','errorClass','code','ownershipUnavailable'}and all(isinstance(x,(bool,str,type(None)))for x in c.values()),'Sanitized cleanup shape');failure=v
unit='proofofwork-audit30-math-source-readability-v3.service';p=subprocess.run(['/usr/bin/systemctl','show',unit,'--no-pager','--property=LoadState','--property=ActiveState','--property=SubState','--property=MainPID','--property=InvocationID','--property=ControlGroup','--property=Type','--property=StandardOutput','--property=StandardOutputFile','--property=StandardError','--property=StandardErrorFile','--property=Result','--property=ExecMainStatus','--property=FragmentPath','--property=DropInPaths','--property=SourcePath'],stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=10);need(p.returncode==0 and len(p.stdout)<=65536 and len(p.stderr)<=65536,'Unit metadata bound');u=dict(line.split('=',1)for line in p.stdout.decode().splitlines())
print(json.dumps(dict(schema='pow-audit30-math-finalize-failure-readonly-diagnostic-v1',atUtc=datetime.datetime.now(datetime.timezone.utc).isoformat(),files=rows,originalFourCustodyEqual=True,newFailure=failure,currentUnit=u,qualification='Current unit metadata after owned cleanup may be garbage-collected defaults, not actual resource/hardening success or the historical mismatch. Only exact failed receipt records cleanup.',productionDataMutation=False,coreSqlPrivateCatalogBodyRead=False),sort_keys=True,separators=(',',':')))
