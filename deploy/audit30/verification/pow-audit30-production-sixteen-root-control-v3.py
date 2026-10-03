#!/usr/bin/python3 -I
"""PROPOSED source-only root control. Actual human receipt required before prepare/run.
Reuses accepted private33c capture/FS helpers and stateless480 observations.
No API/worker/PG restart, timer changes, original evidence edit or auto inverse.
"""
import base64,datetime,fcntl,hashlib,json,os,pwd,re,signal,stat,subprocess,sys,types
from pathlib import Path
BASE=Path('/usr/local/lib/proofofwork-audit30-production-sixteen')
BACKUPS=Path('/data/proofofwork-release-backups')
OLD=Path('/usr/local/lib/proofofwork-audit30-transition-stream/20261003T030000Z')
PRIVATE_PACKAGE=Path('/usr/local/lib/proofofwork-audit30-private-sixteen/20261003T074500Z')
OPS_LOCK=Path('/run/proofofwork-audit29-ops.lock')
NODE=Path('/opt/node-v24.18.0-linux-x64/bin/node');NODE_SHA='41a74efb34cbde5c7632cdac0cf8bd1a14d0b8d73dc1e82755014d9a9ce70f5c'
PG=108;GROUP=112
SHA=re.compile('[0-9a-f]{64}');RUN=re.compile('[0-9]{8}T[0-9]{6}Z')
PINS={'native-caller.mjs':'18323f53e92bd6cf1a4d5945e2f630db6eeb884f065f22bbede07b9515e96e4f','pow-audit30-production-sixteen-adapter-v2.mjs':'bb81dd2ee7fdefed19605fc47ed8bdd309b1bd531fea47fa548c27bdbdeeeb20','pow-audit30-production-sixteen-approval-binding-v2.mjs':'f6f25ef5bfddf534d8b21d65ced4ff0d02b134a7b77114e41a16ac6e1787b286','pow-audit30-private-sixteen-commit-inverse-adapter-v1.mjs':'4e569cfba47b82ead715a2fba8b9f84c5c113f12dbbbb4986dc5fd8921adc498','writer-template.mjs':'2e9a7fb67616e46b3b14d1074dc5206eb280df6868cc249943645b8d8ab685da'}
CAPTURE_SHA='33c3c65c079901022850d4407c4df460b6924196d077061ba86d0d27ef385729';GUARD_SHA='48001283affb80b3b027dcc93831074aee872fbee649fb14482c32b00eb1c76c';PRIVATE_SUPERVISOR_SHA='b1f10c63ac7e0de179215993529708e082073b0fd25bd6d36a4a7200870d4544'
SOURCE_PINS={'pow-audit30-mail-body-repair-rehearsal-v2.mjs':'ea5614fddc0ef7fb696d0159a141b25116fbd6ba2c4b309db171a548b7f8b70c','original-transaction-engine.mjs':'09b3240e45d76278a67053f5fba6009cccce36b00c1b098d38d7435da978dc58','phase4-private-plan.json':'4ac3a8d9b4b79befd36abc590731b1bc8f2e6c83919d5f6427c34c58a6ddba00'}
PRIVATE_PROOF=Path('/data/proofofwork-audit30-inspect-20261003T014100Z/exact-sixteen-readonly-finalization-v1/completed.json')
MANIFEST_SHA='8d5d347aea2d398d75e69631f90b3efdd1c3254cfdbf3864015199b078699c50'
PROJECTION=BACKUPS/'audit30-node-release-38ac6e2bff2a-20261003T042000Z/focused-mail-projection-v5/completed.json'
ENV={'PATH':'/usr/sbin:/usr/bin:/sbin:/bin','LC_ALL':'C','TZ':'UTC'}
ROOT_SOURCE_SHA256=None # supplied only by the exact byte-pinned root bootstrap
GENERATOR="""import fs from 'node:fs';import path from 'node:path';import {pathToFileURL}from'node:url';const [pkg,approvalSHA,operation,priorSHA]=process.argv.slice(1),B=await import(pathToFileURL(path.join(pkg,'pow-audit30-production-sixteen-approval-binding-v2.mjs')).href),P=JSON.parse(fs.readFileSync(path.join(pkg,'phase4-private-plan.json'))),A=fs.readFileSync(path.join(pkg,'human-approval.json')),bound=B.bindApprovedTemplate(fs.readFileSync(path.join(pkg,'writer-template.mjs')),A,approvalSHA,P,{adapterSHA256:'bb81dd2ee7fdefed19605fc47ed8bdd309b1bd531fea47fa548c27bdbdeeeb20',operation,priorAcknowledgedApplyReceiptSHA256:priorSHA==='none'?null:priorSHA});const{validateReviewProofs}=await import(pathToFileURL(path.join(pkg,'pow-audit30-production-sixteen-adapter-v2.mjs')).href);validateReviewProofs(bound.approval,fs.readFileSync(path.join(pkg,'private-committed-inverse-proof.json')),fs.readFileSync(path.join(pkg,'focused-projection-proof.json')));process.stdout.write(JSON.stringify({generatedBase64:bound.generated.toString('base64'),generatedSHA256:bound.generatedSHA256,approvalReceiptSHA256:approvalSHA}));"""
class Interrupted(RuntimeError):pass
def need(v,c):
 if not v:raise ValueError(c)
def sha(raw):return hashlib.sha256(raw).hexdigest()
def encoded(v):return json.dumps(v,sort_keys=True,separators=(',',':')).encode()
def pairs(rows):
 d={}
 for k,v in rows:
  need(k not in d,'DUPLICATE_JSON_KEY');d[k]=v
 return d
def json_read(raw):return json.loads(raw,object_pairs_hook=pairs)
def smeta(s):
 return dict(device=s.st_dev,inode=s.st_ino,mode=stat.S_IMODE(s.st_mode),uid=s.st_uid,gid=s.st_gid,bytes=s.st_size,mtimeNs=s.st_mtime_ns,ctimeNs=s.st_ctime_ns,nlink=s.st_nlink)
def meta(p):return smeta(Path(p).lstat())
def immutable(p,cap,uid=0,gid=112,mode=0o440):
 p=Path(p);need(p.is_absolute()and p.resolve(strict=True)==p,'CANONICAL_INPUT');m=meta(p);need(stat.S_ISREG(p.lstat().st_mode)and(m['uid'],m['gid'],m['mode'],m['nlink'])==(uid,gid,mode,1)and m['bytes']<=cap and not os.listxattr(p,follow_symlinks=False),'IMMUTABLE_INPUT_SHAPE');fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW)
 with os.fdopen(fd,'rb')as f:
  need(smeta(os.fstat(f.fileno()))==m,'INPUT_FD_CHANGED');raw=f.read(cap+1);need(smeta(os.fstat(f.fileno()))==m,'INPUT_READ_CHANGED')
 need(meta(p)==m and len(raw)==m['bytes'],'INPUT_BYTES_CHANGED');return raw,m
def read(p,h,cap,uid=0,gid=112,mode=0o440):
 need(isinstance(h,str)and SHA.fullmatch(h),'INPUT_SHA256_REQUIRED');raw,m=immutable(p,cap,uid,gid,mode);need(sha(raw)==h,'INPUT_BYTES_CHANGED');return raw,m
def prepared_read(package,v):
 need(package.resolve(strict=True)==package and (meta(package)['uid'],meta(package)['gid'],meta(package)['mode'])==(0,GROUP,0o750),'IMMUTABLE_PRODUCTION_PACKAGE');raw,_=immutable(package/'prepared.json',65536,0,0,0o600);p=json_read(raw);r,_=immutable(package/'prepared-request.json',262144,0,0,0o600);old=json_read(r);decode(old)
 need(set(p)=={'schema','pgEntrySHA256','generatedWriterSHA256','approvalSHA256','operation','productionUnitLaunched'}and p['schema']=='pow-audit30-production-sixteen-package-prepared-v1'and p['productionUnitLaunched']is False and SHA.fullmatch(p['pgEntrySHA256'])and SHA.fullmatch(p['generatedWriterSHA256']),'PREPARED_RECORD_SHAPE');need(old['mode']=='prepare'and {k:x for k,x in old.items()if k!='mode'}=={k:x for k,x in v.items()if k!='mode'},'EXACT_PREPARED_APPROVAL_AND_OPERATION');need(p['approvalSHA256']==v['approval']['sha256']and p['operation']==v['operation'],'PREPARED_SCOPE');return p

def decode(v):
 fields={'schema','rootControlSHA256','mode','runId','operation','captureHelperBase64','guardBase64','sourcesBase64','approval','privateProof','projection','priorApply'}
 need(isinstance(v,dict)and set(v)==fields and v['schema']=='pow-audit30-production-sixteen-root-request-v1'and v['mode']in('prepare','run')and v['operation']in('apply','inverse'),'TYPED_EXPLICIT_OPERATION');rid=v['runId'];need(isinstance(rid,str)and RUN.fullmatch(rid)and datetime.datetime.strptime(rid,'%Y%m%dT%H%M%SZ').strftime('%Y%m%dT%H%M%SZ')==rid,'CALENDAR_RUN_ID')
 need(isinstance(v['rootControlSHA256'],str)and SHA.fullmatch(v['rootControlSHA256']),'ROOT_CONTROL_SOURCE_PIN_REQUIRED')
 def source(b,h,cap):
  raw=base64.b64decode(b,validate=True);need(len(raw)<=cap and sha(raw)==h,'SOURCE_BYTES_PIN');return raw
 helper=source(v['captureHelperBase64'],CAPTURE_SHA,32768);guard=source(v['guardBase64'],GUARD_SHA,32768);need(set(v['sourcesBase64'])==set(PINS),'EXACT_CODE_MEMBERS');members={n:source(v['sourcesBase64'][n],h,32768)for n,h in PINS.items()}
 for name in('approval','privateProof','projection'):
  r=v[name];need(isinstance(r,dict)and set(r)=={'path','sha256'}and SHA.fullmatch(r['sha256']),'BOUND_SOURCE_REFERENCE')
 need(v['privateProof']['path']==str(PRIVATE_PROOF)and v['projection']['path']==str(PROJECTION),'EXACT_PRIVATE_AND_FOCUSED_PROOF_PATHS');need(re.fullmatch(r'/data/proofofwork-release-backups/audit30-mail-body-authority-\d{8}T\d{6}Z/human-approval.json',v['approval']['path']),'HUMAN_AUTHORITY_PRIVATE_PATH')
 prior=v['priorApply'];need(prior is None if v['operation']=='apply'else isinstance(prior,dict)and set(prior)=={'path','sha256'}and SHA.fullmatch(prior['sha256'])and re.fullmatch(r'/data/proofofwork-release-backups/audit30-mail-body-production-\d{8}T\d{6}Z-apply/completed.json',prior['path']),'EXPLICIT_INVERSE_ACKNOWLEDGED_APPLY_PATH')
 return helper,guard,members

def helper_module(raw):
 m=types.ModuleType('reviewed_root_capture');m.__file__='/reviewed-capture.py';exec(compile(raw,m.__file__,'exec'),m.__dict__);return m

def guard_module(raw):
 g=types.ModuleType('reviewed_stateless_worker');g.__file__='/reviewed-stateless480.py';exec(compile(raw,g.__file__,'exec'),g.__dict__);return g

def state(g,unit):return g.state(unit)
def baseline(g):
 rows={u:state(g,u)for u in('bitcoind.service','electrs.service','postgresql@16-main.service','proofofwork-api.service','proofofwork-indexer-worker.service')};wanted={'bitcoind.service':('1324302','64e1fa7be2e2442d8c7f5763f60b85fb'),'electrs.service':('1324320','72418b1c7ab245e4a37685ed868a1084'),'postgresql@16-main.service':('1537429','e0bf545f0ad944e89fe1005577e61b9c'),'proofofwork-api.service':('2103747','208f8bcbecc54afbb7166754f12065c2'),'proofofwork-indexer-worker.service':('2103760','33b3ee25490749db89e0d55fd29d0afb')};need(all(rows[u].get('ActiveState')=='active'and(rows[u].get('MainPID'),rows[u].get('InvocationID'))==x for u,x in wanted.items()),'ORIGINAL_LIVE_FIVE_CHANGED');b=state(g,'proofofwork-postgres-logical-backup.service');need(b.get('ActiveState')=='inactive'and b.get('MainPID')=='0','BACKUP_ACTIVE');return rows

def backup_window(g):
 t=state(g,'proofofwork-postgres-logical-backup.timer');need(t.get('ActiveState')=='active'and t.get('SubState')=='waiting','BACKUP_TIMER_NOT_WAITING');r=subprocess.run(['/usr/bin/systemctl','show','proofofwork-postgres-logical-backup.timer','--property=NextElapseUSecRealtime','--value'],env=ENV,capture_output=True,timeout=10);need(r.returncode==0 and not r.stderr and len(r.stdout)<=1024,'BACKUP_WINDOW_READ');value=r.stdout.decode('ascii').strip();next_=datetime.datetime.strptime(value,'%a %Y-%m-%d %H:%M:%S UTC').replace(tzinfo=datetime.timezone.utc);need((next_-datetime.datetime.now(datetime.timezone.utc)).total_seconds()>=420,'BACKUP_WINDOW_TOO_SHORT');return next_.isoformat()

def properties(package,evidence):return dict(Type='exec',Restart='no',CPUQuota='50%',MemoryMax=str(2*1024**3),MemorySwapMax='0',TasksMax='32',RuntimeMaxSec='120s',TimeoutStopSec='10s',KillMode='control-group',UMask='0077',NoNewPrivileges='yes',PrivateNetwork='yes',PrivateTmp='yes',PrivateIPC='yes',PrivateDevices='yes',ProtectSystem='strict',ProtectHome='yes',ProtectKernelTunables='yes',ProtectKernelModules='yes',ProtectControlGroups='yes',RestrictAddressFamilies='AF_UNIX',CapabilityBoundingSet='',AmbientCapabilities='',UnsetEnvironment='LD_PRELOAD LD_LIBRARY_PATH NODE_OPTIONS PYTHONPATH PYTHONHOME PGSERVICE PGSERVICEFILE PGPASSWORD PGPASSFILE PGUSER PGDATABASE PGOPTIONS PGHOST PGPORT DATABASE_URL PROOF_INDEX_DATABASE_URL POW_INDEX_DATABASE_URL',ReadWritePaths=str(evidence),ReadOnlyPaths=str(package),InaccessiblePaths='/data/bitcoin /etc/bitcoin /etc/proofofwork-api /opt/proofofwork-api /data/proofofwork-postgres-backups')
def command(v,package,evidence,pgsha,worker_sha):
 unit='proofofwork-audit30-production-sixteen-'+v['runId']+'-'+v['operation']+'.service';argv=[str(NODE),'--max-old-space-size=128',str(package/'native-caller.mjs'),PINS['native-caller.mjs'],v['approval']['sha256'],worker_sha,pgsha,v['operation'],v['priorApply']['sha256']if v['priorApply']else'none'];cmd=['/usr/bin/systemd-run','--unit='+unit.removesuffix('.service'),'--quiet','--wait','--pipe','--uid=postgres','--gid=postgres',*['--property='+k+'='+x for k,x in properties(package,evidence).items()],'/usr/bin/env','-i','PATH=/usr/bin:/bin','LC_ALL=C','TZ=UTC',*argv];return unit,cmd,['/usr/bin/env','-i','PATH=/usr/bin:/bin','LC_ALL=C','TZ=UTC',*argv]

def dependency_context():
 raw,_=read(PRIVATE_PACKAGE/'controller.py',PRIVATE_SUPERVISOR_SHA,65536);m=types.ModuleType('reviewed_private_definitions');m.__file__=str(PRIVATE_PACKAGE/'controller.py');exec(compile(raw,m.__file__,'exec'),m.__dict__);m.load();original=m.C.package(m.completed_lineage())[0];return m,original
def dependency_copy(B,package):
 m,original=dependency_context();B.copy_dependencies(m,package,original);return original['phase4']['pgEntrySha256']
def package_fence(v,package,prepared):
 for n,h in PINS.items():read(package/n,h,32768)
 for n,h in SOURCE_PINS.items():read(package/n,h,16*1024**2)
 read(package/'human-approval.json',v['approval']['sha256'],32768);read(package/'private-committed-inverse-proof.json',v['privateProof']['sha256'],1048576);read(package/'focused-projection-proof.json',v['projection']['sha256'],65536);read(package/'approved-writer.mjs',prepared['generatedWriterSHA256'],32768)
 if v['priorApply']:read(package/'acknowledged-apply.json',v['priorApply']['sha256'],65536)
 m,original=dependency_context();m.dependency_fence(package,original);need(original['phase4']['pgEntrySha256']==prepared['pgEntrySHA256'],'PG_ENTRY_PROVENANCE_DRIFT')

def generated(B,package,v):
 r=subprocess.run([str(NODE),'--input-type=module','-e',GENERATOR,str(package),v['approval']['sha256'],v['operation'],v['priorApply']['sha256']if v['priorApply']else'none'],env=ENV,capture_output=True,timeout=20);need(r.returncode==0 and not r.stderr and len(r.stdout)<=65536,'APPROVED_TEMPLATE_GENERATION_REFUSED');q=json_read(r.stdout);need(set(q)=={'generatedBase64','generatedSHA256','approvalReceiptSHA256'}and q['approvalReceiptSHA256']==v['approval']['sha256'],'GENERATOR_SCOPE');raw=base64.b64decode(q['generatedBase64'],validate=True);need(len(raw)<=32768 and sha(raw)==q['generatedSHA256'],'GENERATED_WRITER_PIN');template,_=read(package/'writer-template.mjs',PINS['writer-template.mjs'],32768);changed=("export const LIVE_APPROVAL_PIN='"+v['approval']['sha256']+"';").encode();need(raw.count(changed)==1 and raw.replace(changed,b'export const LIVE_APPROVAL_PIN=null;')==template,'ONLY_HUMAN_APPROVAL_CONSTANT_CHANGED');return raw,q['generatedSHA256']

def acquire_ops():
 need(OPS_LOCK.resolve(strict=True)==OPS_LOCK,'CANONICAL_OPS_LOCK');m=meta(OPS_LOCK);need(stat.S_ISREG(OPS_LOCK.lstat().st_mode)and(m['uid'],m['gid'],m['mode'],m['nlink'])==(0,0,0o600,1),'OPS_LOCK_SHAPE');fd=os.open(OPS_LOCK,os.O_RDONLY|os.O_NOFOLLOW)
 try:
  need(smeta(os.fstat(fd))==m,'OPS_LOCK_FD_CHANGED');fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB);need(smeta(os.fstat(fd))==m==meta(OPS_LOCK),'OPS_LOCK_REPLACED_AFTER_FLOCK');return fd
 except BaseException:os.close(fd);raise
def native_result(v,prepared,result,worker_sha):
 keys={'schema','status','operation','approvalReceiptSHA256','generatedWriterSHA256','manifestSHA256','targetCount','acknowledgedReceiptSHA256','workerBeforeReceiptSHA256','readinessInvalidationPerCommittedTransaction','operationalEpochRewind','automaticInverse','automaticRetry','productionDataMutation','rootPostCoreWorkerObservationStillRequired'}
 need(isinstance(result,dict)and set(result)==keys and result['schema']=='pow-audit30-production-exact-sixteen-native-completed-v1'and result['status']=='committed'and result['operation']==v['operation']and result['approvalReceiptSHA256']==v['approval']['sha256']and result['generatedWriterSHA256']==prepared['generatedWriterSHA256']and result['manifestSHA256']==MANIFEST_SHA and type(result['targetCount'])is int and result['targetCount']==16 and result['workerBeforeReceiptSHA256']==worker_sha and isinstance(result['acknowledgedReceiptSHA256'],str)and SHA.fullmatch(result['acknowledgedReceiptSHA256'])and type(result['readinessInvalidationPerCommittedTransaction'])is int and result['readinessInvalidationPerCommittedTransaction']==1 and all(result[k]is False for k in('operationalEpochRewind','automaticRetry','automaticInverse'))and all(result[k]is True for k in('productionDataMutation','rootPostCoreWorkerObservationStillRequired')),'EXACT_ACKNOWLEDGED_NATIVE_RESULT');return result

def main():
 need(sys.flags.isolated and os.getuid()==os.geteuid()==os.getgid()==os.getegid()==0 and os.uname().nodename=='pow-bitcoin-01','FIXED_ROOT_NATIVE_HOST');os.umask(0o077);os.environ.clear();os.environ.update(ENV);raw=sys.stdin.buffer.read(262145);need(len(raw)<=262144,'TYPED_REQUEST_BOUND');v=json_read(raw);helper,guard,members=decode(v);need(v['rootControlSHA256']==ROOT_SOURCE_SHA256,'EXECUTED_ROOT_CONTROL_SOURCE_PIN');B=helper_module(helper);g=guard_module(guard);pg=pwd.getpwnam('postgres');need((pg.pw_uid,pg.pw_gid)==(PG,GROUP),'EXACT_PG_ROLE');B.capacity(False);read(NODE,NODE_SHA,256*1024**2,0,0,0o755);before=baseline(g);backup_window(g);unit='proofofwork-audit30-production-sixteen-'+v['runId']+'-'+v['operation']+'.service';B.unit_new(unit)
 package=BASE/v['runId'];evidence=BACKUPS/('audit30-mail-body-production-'+v['runId']+'-'+v['operation']);approval_parent=Path(v['approval']['path']).parent;need(approval_parent.resolve(strict=True)==approval_parent and(meta(approval_parent)['uid'],meta(approval_parent)['mode'])==(0,0o700),'HUMAN_AUTHORITY_ROOT_PRIVATE');approval,am=read(v['approval']['path'],v['approval']['sha256'],32768,0,0,0o600);private,pm=read(PRIVATE_PROOF,v['privateProof']['sha256'],1048576,PG,GROUP,0o600);projection,fm=read(PROJECTION,v['projection']['sha256'],65536,0,0,0o600);prior=None
 if v['priorApply']:prior,_=read(v['priorApply']['path'],v['priorApply']['sha256'],65536,PG,GROUP,0o600)
 if v['mode']=='prepare':
  need(not os.path.lexists(package)and not os.path.lexists(evidence),'EXCLUSIVE_NEW_OPERATION_NAMESPACE')
  if not BASE.exists():B.newdir(BASE,0,GROUP,0o750)
  need(BASE.resolve(strict=True)==BASE and(meta(BASE)['uid'],meta(BASE)['gid'],meta(BASE)['mode'])==(0,GROUP,0o750),'IMMUTABLE_PRODUCTION_PACKAGE_PARENT');B.newdir(package,0,GROUP,0o750)
  for n,b in members.items():B.create(package/n,b,0o440,GROUP)
  for n,h in SOURCE_PINS.items():b,_=read(OLD/n,h,16*1024**2);B.create(package/n,b,0o440,GROUP)
  for n,b in [('human-approval.json',approval),('private-committed-inverse-proof.json',private),('focused-projection-proof.json',projection)]:B.create(package/n,b,0o440,GROUP)
  if prior is not None:B.create(package/'acknowledged-apply.json',prior,0o440,GROUP)
  pgsha=dependency_copy(B,package);approved,writer_sha=generated(B,package,v);B.create(package/'approved-writer.mjs',approved,0o440,GROUP);B.create(package/'prepared-request.json',raw,0o600,0);B.create(package/'prepared.json',encoded(dict(schema='pow-audit30-production-sixteen-package-prepared-v1',pgEntrySHA256=pgsha,generatedWriterSHA256=writer_sha,approvalSHA256=v['approval']['sha256'],operation=v['operation'],productionUnitLaunched=False)),0o600,0)
  need(read(v['approval']['path'],v['approval']['sha256'],32768,0,0,0o600)[1]==am and read(PRIVATE_PROOF,v['privateProof']['sha256'],1048576,PG,GROUP,0o600)[1]==pm and read(PROJECTION,v['projection']['sha256'],65536,0,0,0o600)[1]==fm and baseline(g)==before,'SOURCE_OR_LIVE_PREPARE_DRIFT');print(json.dumps(dict(status='prepared',package=str(package),productionUnitLaunched=False,productionDataMutation=False,automaticRetry=False),sort_keys=True));return
 prepared=prepared_read(package,v);package_fence(v,package,prepared);need(not os.path.lexists(evidence),'NO_RETRY_EVIDENCE_PREFIX');lock=acquire_ops()
 try:
  B.newdir(evidence,PG,GROUP,0o700);B.record(package/'root-intent.json',dict(schema='pow-audit30-production-sixteen-root-intent-v1',operation=v['operation'],rootControlSHA256=ROOT_SOURCE_SHA256,humanApprovalSHA256=v['approval']['sha256'],automaticRetry=False,strictAcceptedPrerequisite=False));worker_before=g.execute(v['runId']);workerraw=(json.dumps(worker_before,sort_keys=True)+'\n').encode();worker_sha=sha(workerraw);B.create(package/'root-worker-before.json',workerraw,0o440,GROUP);unit,cmd,argv=command(v,package,evidence,prepared['pgEntrySHA256'],worker_sha);need(baseline(g)==before,'LIVE_BEFORE_NATIVE_CHANGED');backup_window(g);capture=B.capture_unit(cmd,package/'root-native-capture.json',unit,150,65536,argv)
  captureraw,_=immutable(package/'root-native-capture.json',65536,0,0,0o600);result=native_result(v,prepared,json_read(captureraw),worker_sha);read(evidence/'completed.json',result['acknowledgedReceiptSHA256'],65536,PG,GROUP,0o600)
  postrid=(datetime.datetime.strptime(v['runId'],'%Y%m%dT%H%M%SZ')+datetime.timedelta(seconds=1)).strftime('%Y%m%dT%H%M%SZ');worker_after=g.execute(postrid);package_fence(v,package,prepared);backup_window(g);need(baseline(g)==before and read(v['approval']['path'],v['approval']['sha256'],32768,0,0,0o600)[1]==am and read(PRIVATE_PROOF,v['privateProof']['sha256'],1048576,PG,GROUP,0o600)[1]==pm and read(PROJECTION,v['projection']['sha256'],65536,0,0,0o600)[1]==fm,'LIVE_OR_AUTHORITY_AFTER_DRIFT');read(NODE,NODE_SHA,256*1024**2,0,0,0o755);B.record(package/'root-completed.json',dict(schema='pow-audit30-production-sixteen-root-completed-v1',operation=v['operation'],humanApprovalSHA256=v['approval']['sha256'],nativeResult=result,ownedCapture=capture,workerBeforeSHA256=worker_sha,workerAfter=worker_after,liveFiveUnchanged=True,sourceApprovalProofsUnchanged=True,productionDataMutation=True,automaticRetry=False,automaticInverse=False,strictRerunStillRequired=True));print(json.dumps(dict(status='committed',operation=v['operation'],ownedUnitStopped=True,rootCompletedPath=str(package/'root-completed.json'),approvalSHA256=v['approval']['sha256'],automaticRetry=False,strictRerunStillRequired=True),sort_keys=True))
 except BaseException as e:
  for s in(signal.SIGTERM,signal.SIGINT,signal.SIGHUP):signal.signal(s,signal.SIG_IGN)
  try:B.record(package/'root-failed.json',dict(schema='pow-audit30-production-sixteen-root-failed-v1',errorClass=type(e).__name__,productionCommitOutcomeMustBeReconciled=True,automaticRetry=False,automaticInverse=False,sourceAndAllEvidenceRetained=True))
  except BaseException as r:raise RuntimeError('Failure custody unavailable:'+type(r).__name__)from e
  raise
 finally:os.close(lock)
if __name__=='__main__':
 old={s:signal.signal(s,lambda *_:(_ for _ in()).throw(Interrupted('Root production control interrupted')))for s in(signal.SIGTERM,signal.SIGINT,signal.SIGHUP)}
 try:main()
 except BaseException as e:print(json.dumps(dict(status='refused',errorClass=type(e).__name__,privateDetailsSuppressed=True,productionCommitOutcomeRequiresEvidenceReconciliation=True,automaticRetry=False,automaticInverse=False),sort_keys=True),file=sys.stderr);sys.exit(1)
