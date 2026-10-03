#!/usr/bin/python3
import datetime,hashlib,json,os,re,stat,subprocess
from pathlib import Path
UNIT='proofofwork-audit30-private-sixteen-20261003T080600Z.service'
PACKAGE=Path('/usr/local/lib/proofofwork-audit30-private-sixteen/20261003T080600Z')
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
  if path.name=='completed.json':validate_completed(v)
  if 'firstReasonSha256'in v:out['publicFields']['firstReasonSha256']=v['firstReasonSha256']
 return out

COMPLETED_KEYS=('schema', 'status', 'planSha256', 'adapterProof', 'currentReadOnlyState', 'reconciliationReceiptSha256', 'savedReceiptBindings', 'originalFailureBindings', 'originalAttemptRemainsFailed', 'writerInvoked', 'applyInvoked', 'inverseInvoked', 'crossTransactionFullMailFingerprintRestored', 'streamCompletedSha256', 'mathCompletedSha256', 'sealedSourceFullHashVerifiedBeforeStart', 'sealedSourceFullHashVerifiedAtStop', 'privateClusterStopped', 'offlinePrivatePagesChecked', 'liveServicesUnchanged', 'backupWindowRecheckedAtStop', 'productionMutation', 'sealedSourceStarted', 'sourceAndAllEvidenceRetained', 'automaticRetry', 'operationalReadinessTwoLegitimateInvalidations', 'operationalEpochRewind', 'wholeSeconds', 'storage', 'rootPrivateMathAccounting', 'rootPrivateMathFullAllocationCharged')
def validate_completed(v):
 if not isinstance(v,dict)or set(v)!=set(COMPLETED_KEYS)or v['schema']!='pow-audit30-private-sixteen-readonly-finalization-completed-v1'or v['status']!='passed'or v['planSha256']!='bc8803c60e4f1cb2615bf6e6258ec10b04ff7c40a9a2f951dc4bafb42056acdc':raise ValueError('Exact public completion schema/plan')
 true=('originalAttemptRemainsFailed','crossTransactionFullMailFingerprintRestored','sealedSourceFullHashVerifiedBeforeStart','sealedSourceFullHashVerifiedAtStop','privateClusterStopped','offlinePrivatePagesChecked','liveServicesUnchanged','backupWindowRecheckedAtStop','sourceAndAllEvidenceRetained','operationalReadinessTwoLegitimateInvalidations','rootPrivateMathFullAllocationCharged')
 false=('writerInvoked','applyInvoked','inverseInvoked','productionMutation','sealedSourceStarted','automaticRetry','operationalEpochRewind')
 if not all(v[k]is True for k in true)or not all(v[k]is False for k in false):raise ValueError('Exact readonly closure flags')
 if v['reconciliationReceiptSha256']!='79d4eb412b9c34825c3c88758088fdd5f5a29eeb9844d158036b0168990b4901'or v['streamCompletedSha256']!='974e16cfb288e19e7320fa87687d32cff65b2a58296b4e94893ddbdfaea3c841'or v['mathCompletedSha256']!='3d65f98e03aa341eed849d1506339ccd66af443d6fcf9cf33e794cd4073edcaf':raise ValueError('Exact prior public receipt bindings')

 for k,h in {'savedReceiptBindings': '4ba3af3350c4b465fa323295d1d7914fb784ebbb287ba5afc0365e141a02b237', 'originalFailureBindings': '69fd04513845477875cc7e122c800ad54899dec2e236fd623f4f27a6481ea15b', 'rootPrivateMathAccounting': '37602ad2c0812991ab2a42dcf1972e8c682a40ef8ca64716a999dfcf86d51c41'}.items():
  if hashlib.sha256(json.dumps(v[k],sort_keys=True,separators=(',',':')).encode()).hexdigest()!=h:raise ValueError('Exact public metadata binding')
 if hashlib.sha256(json.dumps(v['adapterProof'],sort_keys=True,separators=(',',':')).encode()).hexdigest()!='84fb37833d7c326f689beeb6d8552dbb921beda147114e7bf844a5b2d2d2594d':raise ValueError('Exact saved16 acknowledged adapter proof')
 c=v['currentReadOnlyState']
 if not isinstance(c,dict)or set(c)!={'currentCompleteMailFingerprint','currentJournalFingerprint','samePrivateDatabaseIdentity','explicitReadOnlyTransaction','currentSavedFence'}or c['samePrivateDatabaseIdentity']is not True or c['explicitReadOnlyTransaction']is not True:raise ValueError('Exact readonly fingerprint state')
 expected={'count':619,'logical_bytes':'1798351','sha256':'2075b8261fdd5f09b2c04370dcd0014c0d25e240f249966baf66a9952696e181'}
 if c['currentCompleteMailFingerprint']!=expected:raise ValueError('Exact saved all-network mailbox fingerprint')
 if c['currentSavedFence']!={'canonicalBlock': {'hash': '00000000000000000001c495201991943ae88860aeaca7db34c37e210e765ee0', 'height': 969526}, 'confirmedTransactionMaxHeight': 969511, 'precisionActivationHeight': '960601', 'precisionMarkerStatus': 'complete', 'transitionMaxHash': '00000000000000000001c495201991943ae88860aeaca7db34c37e210e765ee0', 'transitionMaxHeight': 969526}:raise ValueError('Exact immutable saved snapshot fence')
 j=c['currentJournalFingerprint']
 if not isinstance(j,dict)or set(j)!={'queue','shards','meta'}:raise ValueError('Exact journal shape')
 for f in j.values():
  if not isinstance(f,dict)or set(f)!={'count','logical_bytes','sha256'}or type(f['count'])is not int or not 0<=f['count']<=20000 or not isinstance(f['logical_bytes'],str)or not re.fullmatch('0|[1-9][0-9]*',f['logical_bytes'])or not re.fullmatch('[0-9a-f]{64}',f['sha256']):raise ValueError('Public journal fingerprint only')
 if type(v['wholeSeconds'])not in(int,float)or not 0<=v['wholeSeconds']<=900:raise ValueError('Bounded completion seconds')

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
 sealed_path=Path('/usr/local/lib/proofofwork-audit30-snapshot-inspect/20261003T005512Z/cluster-inventory.json');sealed=fixed_file(sealed_path,1048576)
 if not sealed['exists']or sealed['metadata']['uid']!=0 or sealed['metadata']['bytes']!=440008 or sealed['sha256']!='f30301ca4f4769cfbbd995dc7627580be543e6cddfc1f5b3ff4aba033a48f572':raise ValueError('Exact public source inventory binding')
 authority={}
 for name,h in [('controller.py','526444998a823cdc889473238642f42ea6355bb699027d014fab3951de45834b'),('reviewed-plan.json','bc8803c60e4f1cb2615bf6e6258ec10b04ff7c40a9a2f951dc4bafb42056acdc'),('restore-latest-logical.py','26c7656b2e751c6de50122c65f8af73686c2d2674bee8be86a3c5648b7fcc80e')]:
  r=fixed_file(PACKAGE/name)
  if not r['exists']or r['metadata']['uid']!=0 or r['sha256']!=h:raise ValueError('Exact installed authority changed')
  authority[name]=r
 paths={'rootCapture':PACKAGE/'readonly-finalization-run-capture.json','rootStderr':PACKAGE/'readonly-finalization-run-capture.json.stderr','rootFailed':PACKAGE/'readonly-finalization-run-capture.json.failed.json','intent':JOB/'exact-sixteen-readonly-finalization-v1/intent.json','failed':JOB/'exact-sixteen-readonly-finalization-v1/failed.json','completed':JOB/'exact-sixteen-readonly-finalization-v1/completed.json'}
 fields={'rootFailed':('schema','status','firstErrorClass','observedInvocation','cleanup','channels','automaticRetry','privateClusterStoppedCertifiedByCapture'),'failed':('schema','status','phase','errorClass','privateStopVerified','cleanupErrors','productionMutation','automaticRetry','acknowledgedApplyMayRemain','unknownCommitRequiresExplicitReconciliation')}
 fields['completed']=COMPLETED_KEYS
 receipts={k:fixed_file(p,8*1024**2 if k in('rootCapture','rootStderr')else 65536,fields.get(k,()))for k,p in paths.items()}
 if not receipts['completed']['exists']or receipts['failed']['exists']or receipts['rootFailed']['exists']:raise ValueError('Completion required without finalization failure')
 known='74017fb2e8fe456bb44cc0cfd99f73bf';u=unit(UNIT)
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
 if fixed_file(sealed_path,1048576)!=sealed:raise ValueError('Original inventory changed during endpoint read')
 for name,r in authority.items():
  if fixed_file(PACKAGE/name)!=r:raise ValueError('Authority changed during observer')
 for k,r in receipts.items():
  if fixed_file(paths[k],8*1024**2 if k in('rootCapture','rootStderr')else 65536,fields.get(k,()))!=r:raise ValueError('Receipt changed during observer')
 print(json.dumps({'schema':'pow-audit30-private-sixteen-readonly-finalization-public-endpoint-v4','atUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'expectedBootstrapSourceSha256':'cc2bdba21bc9fb0c2b00f1b04e3fe197b43521eab63b364bbbb5cd5d2634273e','installedAuthority':authority,'sealedInventoryBinding':dict(path=str(sealed_path),**sealed),'unit':u,'observedInvocation':known,'qualifiedGarbageCollected':gc,'receipts':receipts,'actualChildPublicRefusal':stderr_fields,'applyCommitIntentExists':os.path.lexists(JOB/'exact-sixteen-write-proof-v1/apply-commit-intent.json'),'applyCompletedExists':os.path.lexists(JOB/'exact-sixteen-write-proof-v1/apply-completed.json'),'inverseCompletedExists':os.path.lexists(JOB/'exact-sixteen-write-proof-v1/inverse-completed.json'),'liveFive':live,'liveFiveUnchanged':same,'clusterFileEndpoints':stops,'privatePostgresProcesses':procs,'noPrivatePostgresAtEndpoint':not procs and not any(v for row in stops.values()for v in row.values()),'backup':backup,'timer':timer,'productionMutation':False,'rawPrivateDataExported':False,'continuousReaderExclusionCertified':False,'fullSourceAfterHashIndependentlyRecomputedByObserver':False,'completionClaimsSourceFullHashes':True,'originalFailedAttemptRetained':os.path.lexists(JOB/'exact-sixteen-write-proof-v1/supervisor-failed.json'),'originalSupervisorCompletedExists':os.path.lexists(JOB/'exact-sixteen-write-proof-v1/supervisor-completed.json')},sort_keys=True))
if __name__=='__main__':main()
