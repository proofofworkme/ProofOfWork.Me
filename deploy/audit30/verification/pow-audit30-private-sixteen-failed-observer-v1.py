#!/usr/bin/python3
import datetime,hashlib,json,os,re,stat,subprocess
from pathlib import Path
UNIT='proofofwork-audit30-private-sixteen-20261003T071500Z.service'
PACKAGE=Path('/usr/local/lib/proofofwork-audit30-private-sixteen/20261003T071500Z')
JOB=Path('/data/proofofwork-audit30-inspect-20261003T014100Z')
SOURCE=Path('/data/proofofwork-audit30-restore-20261002T234651Z')
FIVE={'bitcoind.service':(1324302,'64e1fa7be2e2442d8c7f5763f60b85fb'),'electrs.service':(1324320,'72418b1c7ab245e4a37685ed868a1084'),'postgresql@16-main.service':(1537429,'e0bf545f0ad944e89fe1005577e61b9c'),'proofofwork-api.service':(2103747,'208f8bcbecc54afbb7166754f12065c2'),'proofofwork-indexer-worker.service':(2103760,'33b3ee25490749db89e0d55fd29d0afb')}
def meta(s):return dict(device=s.st_dev,inode=s.st_ino,mode=stat.S_IMODE(s.st_mode),uid=s.st_uid,gid=s.st_gid,nlink=s.st_nlink,bytes=s.st_size,mtimeNs=s.st_mtime_ns,ctimeNs=s.st_ctime_ns)
def pairs(rows):
 d={}
 for k,v in rows:
  if k in d:raise ValueError('Duplicate public receipt key')
  d[k]=v
 return d
def fixed_file(path,maximum=65536,fields=()):
 if not os.path.lexists(path):return {'exists':False}
 if path.resolve(strict=True)!=path:raise ValueError('Canonical fixed receipt required')
 s=path.lstat();m=meta(s)
 if not stat.S_ISREG(s.st_mode)or s.st_nlink!=1 or s.st_uid not in(0,108)or s.st_gid not in(0,112)or stat.S_IMODE(s.st_mode)not in(0o440,0o600)or s.st_size>maximum:raise ValueError('Fixed public receipt custody')
 fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NOATIME)
 try:
  if meta(os.fstat(fd))!=m:raise ValueError('Receipt FD drift')
  raw=b''
  while True:
   b=os.read(fd,65536)
   if not b:break
   raw+=b
   if len(raw)>maximum:raise ValueError('Receipt bound')
  if meta(os.fstat(fd))!=m or meta(path.lstat())!=m:raise ValueError('Receipt changed')
 finally:os.close(fd)
 out={'exists':True,'metadata':m,'sha256':hashlib.sha256(raw).hexdigest()}
 if fields:
  v=json.loads(raw,object_pairs_hook=pairs);out['publicFields']={k:v[k]for k in fields if k in v}
  if 'firstReasonSha256'in v:out['publicFields']['firstReasonSha256']=v['firstReasonSha256']
 return out
FIELDS=['LoadState','ActiveState','SubState','MainPID','InvocationID','Result','ExecMainStatus','UnitFileState','NextElapseUSecRealtime']
def unit(name):
 r=subprocess.run(['/usr/bin/systemctl','show',name,*sum((['-p',x]for x in FIELDS),[])],capture_output=True,timeout=10,env={'PATH':'/usr/bin:/bin','LC_ALL':'C'})
 if r.returncode or len(r.stdout)>16384 or len(r.stderr)>4096:raise ValueError('Fixed systemctl bound')
 return dict(x.split('=',1)for x in r.stdout.decode().splitlines())
def postgres_endpoints():
 found=[]
 for p in Path('/proc').iterdir():
  if not p.name.isdigit():continue
  try:
   if os.readlink(p/'exe')!='/usr/lib/postgresql/16/bin/postgres':continue
   with open(p/'cmdline','rb')as f:raw=f.read(65537)
   if len(raw)>65536:raise ValueError('Postgres command bound')
   args=raw.split(b'\0');named=[str(n)for n in(JOB,SOURCE)if str(n/'cluster').encode()in args]
   if named:found.append({'pid':int(p.name),'clusters':named,'argvSha256':hashlib.sha256(raw).hexdigest()})
  except FileNotFoundError:continue
 return found
def main():
 if os.geteuid()!=0 or not __import__('sys').flags.isolated or os.uname().nodename!='pow-bitcoin-01':raise ValueError('Fixed root node')
 authority={}
 for name,h in [('controller.py','891a14878e9496ff83acb53c547c0c3a23a733389e27fc7a00489b6a335495fe'),('reviewed-plan.json','2c07afdb38c84aca9b26384267bc09d617ea26cc55055d14dd40c16417793239'),('restore-latest-logical.py','26c7656b2e751c6de50122c65f8af73686c2d2674bee8be86a3c5648b7fcc80e')]:
  r=fixed_file(PACKAGE/name)
  if not r['exists']or r['metadata']['uid']!=0 or r['sha256']!=h:raise ValueError('Exact installed authority changed')
  authority[name]=r
 paths={'rootCapture':PACKAGE/'private-sixteen-run-capture.json','rootStderr':PACKAGE/'private-sixteen-run-capture.json.stderr','rootFailed':PACKAGE/'private-sixteen-run-capture.json.failed.json','intent':JOB/'exact-sixteen-write-proof-v1/supervisor-intent.json','failed':JOB/'exact-sixteen-write-proof-v1/supervisor-failed.json','completed':JOB/'exact-sixteen-write-proof-v1/supervisor-completed.json'}
 fields={'rootFailed':('schema','status','firstErrorClass','observedInvocation','cleanup','channels','automaticRetry','privateClusterStoppedCertifiedByCapture'),'failed':('schema','status','phase','errorClass','privateStopVerified','cleanupErrors','productionMutation','automaticRetry','acknowledgedApplyMayRemain','unknownCommitRequiresExplicitReconciliation')}
 receipts={k:fixed_file(p,8*1024**2 if k in('rootCapture','rootStderr')else 65536,fields.get(k,()))for k,p in paths.items()}
 known=receipts['rootFailed'].get('publicFields',{}).get('observedInvocation');u=unit(UNIT)
 gc=u.get('LoadState')=='not-found'and u.get('MainPID')=='0'and u.get('ActiveState')=='inactive'and not u.get('InvocationID')
 retained=u.get('LoadState')=='loaded'and u.get('MainPID')=='0'and u.get('ActiveState')in('inactive','failed')and isinstance(known,str)and re.fullmatch('[0-9a-f]{32}',known)and u.get('InvocationID')==known
 if not gc and not retained:raise ValueError('Known stopped or qualified GC endpoint required')
 stderr_fields={}
 if receipts['rootStderr']['exists']and receipts['rootStderr']['metadata']['bytes']<=65536:
  raw=paths['rootStderr'].read_bytes()
  if hashlib.sha256(raw).hexdigest()!=receipts['rootStderr']['sha256']:raise ValueError('Root stderr drift')
  try:v=json.loads(raw,object_pairs_hook=pairs)
  except(ValueError,UnicodeError):v=None
  allowed={'status','errorClass','rawDetailsSuppressed','productionMutation','automaticRetry'}
  if isinstance(v,dict)and set(v)<=allowed and v.get('status')=='refused'and isinstance(v.get('errorClass'),str)and re.fullmatch('[A-Za-z][A-Za-z0-9]{0,63}',v['errorClass'])and all(type(v[k])is bool for k in set(v)-{'status','errorClass'}):stderr_fields=v
 live={k:unit(k)for k in FIVE};same=all(v.get('ActiveState')=='active'and v.get('SubState')=='running'and v.get('MainPID')==str(FIVE[k][0])and v.get('InvocationID')==FIVE[k][1]for k,v in live.items())
 stops={str(j):{'postmasterPidExists':os.path.lexists(j/'cluster/postmaster.pid'),'privateSocketExists':os.path.lexists(j/'socket/.s.PGSQL.55432')}for j in(JOB,SOURCE)};procs=postgres_endpoints()
 backup=unit('proofofwork-postgres-logical-backup.service');timer=unit('proofofwork-postgres-logical-backup.timer')
 for name,r in authority.items():
  if fixed_file(PACKAGE/name)!=r:raise ValueError('Authority changed during observer')
 for k,r in receipts.items():
  if fixed_file(paths[k],8*1024**2 if k in('rootCapture','rootStderr')else 65536,fields.get(k,()))!=r:raise ValueError('Receipt changed during observer')
 print(json.dumps({'schema':'pow-audit30-private-sixteen-failed-endpoint-observer-v1','atUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'expectedBootstrapSourceSha256':'33c3c65c079901022850d4407c4df460b6924196d077061ba86d0d27ef385729','installedAuthority':authority,'unit':u,'observedInvocation':known,'qualifiedGarbageCollected':gc,'receipts':receipts,'actualChildPublicRefusal':stderr_fields,'applyCommitIntentExists':os.path.lexists(JOB/'exact-sixteen-write-proof-v1/apply-commit-intent.json'),'applyCompletedExists':os.path.lexists(JOB/'exact-sixteen-write-proof-v1/apply-completed.json'),'inverseCompletedExists':os.path.lexists(JOB/'exact-sixteen-write-proof-v1/inverse-completed.json'),'liveFive':live,'liveFiveUnchanged':same,'clusterFileEndpoints':stops,'privatePostgresProcesses':procs,'noPrivatePostgresAtEndpoint':not procs and not any(v for row in stops.values()for v in row.values()),'backup':backup,'timer':timer,'productionMutation':False,'rawPrivateDataExported':False,'continuousReaderExclusionCertified':False,'fullSourceAfterHashCertified':False},sort_keys=True))
if __name__=='__main__':main()
