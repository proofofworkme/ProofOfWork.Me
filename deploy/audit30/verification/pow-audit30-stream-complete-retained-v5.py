#!/usr/bin/python3 -I
"""Complete only the retained, hash-bound default-envelope private byte prototype.
No body redo, capture, schema/import, original-source start or production mutation.
"""
import argparse,datetime as dt,hashlib,json,os,pwd,re,signal,stat,sys,time,types
from pathlib import Path
APPROVAL='6821c987b9a5d110fbe9fb2820955b7cbc26dda9faddb67667fc49e892f5c820'
OLD=Path('/usr/local/lib/proofofwork-audit30-transition-stream/20261003T030000Z')
JOB=Path('/data/proofofwork-audit30-inspect-20261003T014100Z');SOURCE=Path('/data/proofofwork-audit30-restore-20261002T234651Z')
OLD_UNIT='proofofwork-audit30-transition-stream-20261003T030000Z.service';OLD_INV='37976ccc59d546698d9b1b22b901a1ef'
OLD_PLAN_SHA='1305543f3749c8e2bd7232d9d494f23896e7153c2c761bf23f1ee552425952fe'
PINS={'controller-v7.py':'e9801d372d05c94c40b609749e502ab1eb5e06f4f2561fa08d9c6a25c9313599','restore-latest-logical.py':'26c7656b2e751c6de50122c65f8af73686c2d2674bee8be86a3c5648b7fcc80e','sealed-logical-inventory.json':'f30301ca4f4769cfbbd995dc7627580be543e6cddfc1f5b3ff4aba033a48f572'}
PROOFS={'intent.json':'2422dfe6c6da4b3a1b25666e6a101ab22752334bc33d32f2de85b1672be0e13b','failed.json':'a382644507ab070b2a737f179fb965a3f671d7c661159acea1e147298ffaa503','phase4-body-rehearsal-v2-completed.json':'a0bdd9543178f1ab7972ee0af9140c2d7d052be9c003fafe357e4ce8fd62e058'}
INPUTS=('stream-prototype-plan.json','stream-spools.json','stream-chunks.sqlite','stream-transitions-source.copy','stream-ordered-export.copy','stream-native-reconstructed.copy','stream-local-reconstructed.copy','stream-columns.json','stream-checkpoint.json','stream-samples.json','stream-chunks.copy','stream-parts.copy','stream-capture-meta.copy')
SOURCE_SHA='7cbe1c4753df618c744c8d14cf68e9399ad5d18628a9073bd252f143ebd8180a';SOURCE_BYTES=22662023
PREVIOUS_COMPLETION_WORK=JOB/'stream-completion-v1'
PREVIOUS_COMPLETION_PINS={'failed.json':'a6ad9c4283463883ba36fe02b154b4e72e102aeae070631823b3ff83067028ca','intent.json':'634b5191f61a53642f16e0f10b59275c0c1809b5461fd4522de9233ec0923048'}
PREVIOUS_COMPLETION_PLAN_SHA='20c8f07b1a01ac71bdca6ef57c410839f5eb39254d8677ac7358377441f08279'
PREVIOUS_COMPLETION_CONTROLLER_SHA='3279e56248627c55b3785c3558546de0c0f599c1c17a378c2dbbc6c7cf4c4310'
PREVIOUS_COMPLETION_UNIT='proofofwork-audit30-stream-completion-20261003T063000Z.service'
PREVIOUS_COMPLETION_INV='0c65c9c7f34d4b1094dc95417dea49cb'
SCHEMA='pow-audit30-complete-retained-private-stream-plan-v1';S=None;G=None;I=None;N=None
class CompletionInterrupted(RuntimeError):pass
def need(v,c):
 if not v:raise ValueError(c)
def sha(raw):return hashlib.sha256(raw).hexdigest()
def encoded(v):return json.dumps(v,sort_keys=True,separators=(',',':')).encode()
def identity(s):return(s.st_dev,s.st_ino,s.st_mode,s.st_uid,s.st_gid,s.st_nlink,s.st_size,s.st_mtime_ns,s.st_ctime_ns)
def module(path,h):
 x=path.lstat();need(path.resolve(strict=True)==path and stat.S_ISREG(x.st_mode)and x.st_uid==0 and x.st_gid==112 and stat.S_IMODE(x.st_mode)==0o440 and x.st_nlink==1 and x.st_size<=262144,'Pinned code custody')
 fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
 with os.fdopen(fd,'rb')as f:need(identity(os.fstat(f.fileno()))==identity(x),'Code FD drift');raw=f.read(262145);need(identity(os.fstat(f.fileno()))==identity(x),'Code read drift')
 need(identity(path.lstat())==identity(x)and sha(raw)==h,'Code path/hash drift');m=types.ModuleType(path.name);m.__file__=str(path);exec(compile(raw,str(path),'exec'),m.__dict__);return m

def load():
 global S,G,I,N
 S=module(OLD/'controller-v7.py',PINS['controller-v7.py']);S.load();I=S.I;N=S.N
 G=module(Path(__file__).parent/'restore-latest-logical.py',PINS['restore-latest-logical.py']);I.G=G;S.G=G

def validate(p):
 keys={'schema','approvalSha256','controllerSha256','host','runId','unit','job','sealedSource','backupLock','backupWindow','liveServices','inputBindings'}
 need(isinstance(p,dict)and set(p)==keys and p['schema']==SCHEMA and p['approvalSha256']==APPROVAL and S.SHA.fullmatch(p['controllerSha256']),'Exact completion authority');S.calendar(p['runId'])
 need(p['unit']=='proofofwork-audit30-stream-completion-'+p['runId']+'.service'and p['host']=='pow-bitcoin-01'and p['job']==str(JOB)and p['sealedSource']==str(SOURCE),'Fixed completion scope')
 need(set(p['inputBindings'])==set(INPUTS),'Complete retained-input bindings')
 for name,r in p['inputBindings'].items():need(set(r)=={'metadata','sha256'}and set(r['metadata'])==I.META_KEYS and all(type(x)is int and x>=0 for x in r['metadata'].values()) and r['metadata']['uid']==108 and r['metadata']['gid']==112 and r['metadata']['mode']==0o600 and r['metadata']['nlink']==1 and 0<=r['metadata']['bytes']<=144*1024**2 and S.SHA.fullmatch(r['sha256']),'Exact retained-input custody')
 need(p['inputBindings']['stream-transitions-source.copy']['sha256']==SOURCE_SHA and p['inputBindings']['stream-transitions-source.copy']['metadata']['bytes']==SOURCE_BYTES,'Frozen complete source capture')
 need(set(p['liveServices'])==set(G.SERVICES),'Five baselines')
 for r in p['liveServices'].values():need(set(r)=={'MainPID','InvocationID'}and str(r['MainPID']).isdigit()and int(r['MainPID'])>0 and re.fullmatch('[0-9a-f]{32}',r['InvocationID']),'Live identity')
 need(set(p['backupLock'])==I.META_KEYS and all(type(x)is int and x>=0 for x in p['backupLock'].values())and p['backupLock']['uid']==108 and p['backupLock']['gid']==112 and p['backupLock']['mode']==0o600 and p['backupLock']['nlink']==1,'Fresh existing lock')
 need(set(p['backupWindow'])=={'preflightAtUtc','nextScheduledAtUtc'}and all(dt.datetime.fromisoformat(x).utcoffset()==dt.timedelta(0)for x in p['backupWindow'].values()),'UTC window');return p

def package(p):
 base=G.canonical_path(Path(__file__).parent);m=G.metadata(base);need(base==Path('/usr/local/lib/proofofwork-audit30-stream-completion')/p['runId']and m['uid']==0 and m['gid']==112 and m['mode']==0o750 and Path(__file__).name=='controller.py','New immutable completion package')
 for name,h in {'controller.py':p['controllerSha256'],'restore-latest-logical.py':PINS['restore-latest-logical.py'],'original-plan.json':OLD_PLAN_SHA,'sealed-logical-inventory.json':PINS['sealed-logical-inventory.json']}.items():
  f=G.canonical_path(base/name);m=G.metadata(f);need(stat.S_ISREG(f.lstat().st_mode)and m['uid']==0 and m['gid']==112 and m['mode']==0o440 and m['nlink']==1,'Immutable member');need(G.hash_file(f,m|{'sha256':h},64*1024**2,no_atime=False)==h,'Member changed')
 original,_=I.read_json(base/'original-plan.json',OLD_PLAN_SHA,root_authority=True);S.validate_plan(original);need(sha(encoded(original))==OLD_PLAN_SHA,'Original canonical plan');S.checked_package(original)
 inv,_=I.read_json(OLD/'stopped-clone-inventory.json',original['inventory']['sha256'],limit=64*1024**2,root_authority=True);S.validate_inventory(inv,original)
 sealed,_=I.read_json(base/'sealed-logical-inventory.json',PINS['sealed-logical-inventory.json'],limit=64*1024**2,root_authority=True);return original,inv,sealed

def previous(original):
 work=JOB/'stream-followup-v1';v={}
 for name,h in PROOFS.items():v[name]=I.read_json(work/name,h,limit=65536)[0]
 f=v['failed.json'];need(f==dict(schema='pow-audit30-private-stream-followup-failed-v1',status='failed',phase='stream-native-prototype',errorClass='RuntimeError',cleanupErrors=[],privateStopVerified=True,intentCreated=True,productionDatabaseMutation=False,automaticRetry=False),'Exact prior failure')
 intent=v['intent.json'];need(intent.get('plan')==original and intent.get('planSha256')==OLD_PLAN_SHA and intent.get('sealedSourceFullHashVerified')is True,'Original intent/source-before proof')
 r=v['phase4-body-rehearsal-v2-completed.json'];private,a=S.body_authority(OLD,original);ids=sorted(t['txid']for t in private['targets'])
 flags={'schema':'pow-audit30-private-mail-body-rehearsal-completed-v2','status':'passed','manifestSHA256':S.MANIFEST_SHA,'engineSHA256':S.PHASE4_ENGINE_SHA,'originalPlanSHA256':S.PRIVATE_PLAN_SHA,'admissionSHA256':original['phase4']['readinessAdmissionSha256'],'canonicalReadinessClosureSHA256':S.CLOSURE_SHA,'manifestTargetCount':16,'selectedCloneTargetCount':16,'missingCloneCandidateCount':0,'missingCloneCandidateTxids':[],'selectedTxids':ids,'exactInverseBodySqlExercised':True,'allFourNativeFingerprintsRestored':True,'rollbackAcknowledged':True,'privateOriginalRowsRestored':True,'allCloneNonbodyAndNontargetRowsUnchanged':True,'namedDeferredConstraintExercised':True,'singleQueuedTransactionObserved':True,'exactOneShardIncrementObserved':True,'productionMutation':False,'productionApplyApproved':False}
 need(len(ids)==16 and all(r.get(k)==x and type(r.get(k))is type(x)for k,x in flags.items()),'All16 prior body acceptance');need(r['readinessEpochAfter']==str(int(r['readinessEpochBefore'])+1)and set(r['baselineNativeFingerprints'])=={'mail','meta','queue','shards'},'Prior four-table/epoch exercise');return r

def previous_completion():
 m=G.metadata(PREVIOUS_COMPLETION_WORK);need(PREVIOUS_COMPLETION_WORK.is_dir()and m['uid']==108 and m['gid']==112 and m['mode']==0o700,'Preserved failed completion namespace')
 v={name:I.read_json(PREVIOUS_COMPLETION_WORK/name,h,limit=65536)[0]for name,h in PREVIOUS_COMPLETION_PINS.items()}
 need(v['failed.json']==dict(schema='pow-audit30-complete-retained-private-stream-failed-v1',status='failed',phase='fresh-side-export',errorClass='RuntimeError',privateStopVerified=True,cleanupErrors=[],productionMutation=False,automaticRetry=False,originalAttemptRemainsFailed=True),'Exact preserved failed completion')
 i=v['intent.json'];p=i.get('plan',{});need(i.get('schema')==SCHEMA and i.get('planSha256')==PREVIOUS_COMPLETION_PLAN_SHA and sha(encoded(p))==PREVIOUS_COMPLETION_PLAN_SHA and p.get('controllerSha256')==PREVIOUS_COMPLETION_CONTROLLER_SHA and p.get('unit')==PREVIOUS_COMPLETION_UNIT and p.get('job')==str(JOB)and p.get('sealedSource')==str(SOURCE)and i.get('sealedSourceFullHashVerifiedBeforeStart')is True and all(i.get(k)is False for k in ('bodyRedo','newSchemaWrite','productionMutation')),'Preserved completion intent/source-before')
 old=G.system_properties(PREVIOUS_COMPLETION_UNIT,['LoadState','ActiveState','MainPID','InvocationID']);need(old==dict(LoadState='loaded',ActiveState='failed',MainPID='0',InvocationID=PREVIOUS_COMPLETION_INV),'Preserved failed completion unit')
 return dict(PREVIOUS_COMPLETION_PINS)

def self_export_command(p,h,fixed):
 expected=Path('/run/credentials')/p['unit']/'completion-plan';need(CREDENTIAL_PATH==str(expected)and G.canonical_path(Path(CREDENTIAL_PATH))==expected,'Exact already validated credential descriptor')
 # Frozen Runner deliberately clears ambient environment. Forward only the
 # parent-helper-validated managed credential directory to this same child.
 return ['/usr/bin/env','CREDENTIALS_DIRECTORY='+str(expected.parent),*fixed,str(Path(__file__)),'--plan',str(expected),'--plan-sha256',h,'--step','export-side']

def inputs(p):
 for name,r in p['inputBindings'].items():need(G.metadata(JOB/name)==r['metadata']and G.hash_file(JOB/name,r['metadata']|{'sha256':r['sha256']},144*1024**2)==r['sha256'],'Retained input drift: '+name)
 proto,_=N.C.small_json(JOB/'stream-prototype-plan.json',p['inputBindings']['stream-prototype-plan.json']['sha256']);base,cols,cp,samples,e,_,_=N.validate(proto);need(proto['admission']is None and proto['profileBinding']is None and e==N.C.DEFAULT and base['privateJob']==str(JOB),'Default-only existing prototype')
 spools,_=N.C.small_json(JOB/'stream-spools.json',p['inputBindings']['stream-spools.json']['sha256'],1024**2);m=N.validate_spools(proto,spools);need(m['sourceSha256']==SOURCE_SHA and m['sourceBytes']==SOURCE_BYTES,'Existing native spools source');return proto,spools,cols

def runtime(p):
 need(os.geteuid()==108 and os.uname().nodename==p['host']and any(x.split(':',2)[-1]=='/system.slice/'+p['unit']for x in Path('/proc/self/cgroup').read_text().splitlines()),'Managed postgres identity')
 wanted={**G.UNIT_PROPERTIES,'RuntimeMaxUSec':'15min','ReadWritePaths':str(JOB)};actual=G.system_properties(p['unit'],[*wanted,'ReadOnlyPaths','InaccessiblePaths']);need(all(actual.get(k)==v for k,v in wanted.items())and set(actual['ReadOnlyPaths'].split())=={str(G.BACKUPS),str(SOURCE)}and set(actual['InaccessiblePaths'].split())==set(G.UNIT_INACCESSIBLE)|{str(SOURCE/'socket')},'Exact unchanged completion hardening');need(os.statvfs(SOURCE).f_flag&os.ST_RDONLY,'Source RO namespace')
 for name in [*G.INACCESSIBLE,str(SOURCE/'socket')]:
  try:os.listdir(name)
  except(PermissionError,FileNotFoundError):continue
  raise ValueError('Forbidden live/sealed socket accessible')

def measurement(runner,proto,spools):
 sql=N.measurements_sql(proto).encode();raw=runner.run([*G.psql(JOB),'-f','-'],'retained-native-measurements',stdin=sql,maximum=1024**2)
 v=json.loads(raw,object_pairs_hook=I.pairs)
 keys={'sourceSha256','sourceBytes','partCount','chunkCount','uniqueChunkBytes','schemaTotalBytes','relations','fullSourceHashVerifiedExternally'}
 need(isinstance(v,dict)and set(v)==keys and v['sourceSha256']==SOURCE_SHA and v['sourceBytes']==SOURCE_BYTES and all(type(v[k])is int and v[k]>0 for k in ('sourceBytes','partCount','chunkCount','uniqueChunkBytes','schemaTotalBytes'))and v['partCount']==spools['meta']['partCount']and v['chunkCount']<=v['partCount']and v['uniqueChunkBytes']<=SOURCE_BYTES and v['schemaTotalBytes']<=N.C.DEFAULT['nativeRelationBytes']and v['fullSourceHashVerifiedExternally']is False,'Measured retained native relation')
 rows=v['relations'];need(isinstance(rows,list)and len(rows)==3 and [r.get('name')for r in rows]==['capture','chunks','parts'],'Exact three native relations')
 for r in rows:
  need(set(r)=={'name','heapBytes','indexesBytes','tableWithToastBytes','totalBytes'}and all(type(r[k])is int and r[k]>=0 for k in ('heapBytes','indexesBytes','tableWithToastBytes','totalBytes'))and r['heapBytes']<=r['tableWithToastBytes']and r['tableWithToastBytes']+r['indexesBytes']==r['totalBytes'],'Native relation physical counters')
 need(sum(r['totalBytes']for r in rows)==v['schemaTotalBytes'],'Native relation total differs')
 return v,sha(sql)

def budget(before,started):
 delta=G.allocation(JOB)-before;seconds=time.monotonic()-started
 need(0<=delta<=512*1024**2 and 0<=seconds<=120,'Retained native monitored allocation/time bound')
 return dict(incrementalAllocatedBytes=delta,seconds=seconds)

def oracle_artifacts(bounded,work,plan,context,v,source,reconstructed,columns):
 """Reuse the one freshly verified final reconstruction; never recopy it."""
 def write(name,raw):
  path=work/name
  with N.new_file(path)as f:f.write(raw);f.flush();os.fsync(f.fileno())
  N.C.sync_parent(path);return dict(fileName=name,bytes=len(raw),sha256=sha(raw))
 def binding(path):
  m=G.metadata(path);need(path.resolve(strict=True)==path and stat.S_ISREG(path.lstat().st_mode)and m['uid']==108 and m['gid']==112 and m['mode']==0o600 and m['nlink']==1 and m['bytes']==SOURCE_BYTES,'Final native COPY custody')
  need(G.hash_file(path,m|{'sha256':SOURCE_SHA},N.C.DEFAULT['sourceBytes'])==SOURCE_SHA,'Final native COPY hash');N.C.sync_parent(path)
  return dict(fileName=path.name,bytes=m['bytes'],sha256=SOURCE_SHA)
 def copy(name,original):
  path,stamp,f=N.C.safe_input(original,N.C.DEFAULT['sourceBytes']);h=hashlib.sha256();count=0
  with f,N.new_file(work/name)as out:
   while True:
    b=f.read(65536)
    if not b:break
    count+=len(b);need(count<=N.C.DEFAULT['sourceBytes'],'Artifact source cap');h.update(b);out.write(b)
   out.flush();os.fsync(out.fileno());N.C.fence(path,stamp,f)
  need(h.hexdigest()==SOURCE_SHA and count==SOURCE_BYTES,'Oracle COPY differs');N.C.sync_parent(work/name)
  return dict(fileName=name,bytes=count,sha256=h.hexdigest())
 need(reconstructed==work/'native.reconstructed.copy','Single final reconstruction path')
 cp=plan['base']['checkpoint'];rows=[dict(height=r['height'],hash=r['hash'])for r in context['sampleRows']];keys_sha=sha(json.dumps(rows,separators=(',',':')).encode());checkpoint=dict(network='livenet',height=cp['height'],hash=cp['hash'],sourceFenceSha256=plan['base']['sourceFenceSha256'],sampleRowKeysSha256=keys_sha)
 marker_sql=N.sql_guard(plan,True)+"COPY(SELECT key,value,updated_at FROM proof_indexer.meta WHERE key='workPrecisionV2Migration:livenet') TO STDOUT (FORMAT binary);\nCOMMIT;\n"
 raw=bounded.run([*G.psql(JOB),'-f','-'],'retained-native-marker-capture',stdin=marker_sql.encode(),maximum=2*1024**2);marker=S.decode_marker(raw,context['markerSha256'])
 bindings=[copy('native.copy',source),binding(reconstructed),write('native.columns.json',columns),write('native.checkpoint.json',json.dumps(checkpoint,separators=(',',':')).encode()),write('native.marker.copy',raw),write('native.marker-value.json',marker)]
 record=dict(schema='pow-audit30-stream-native-oracle-inputs-v1',privateJob=str(JOB),evidenceDirectory=str(work),prefix='native',basePlan=plan['base'],envelope=plan['envelope'],sourceFenceSha256=plan['base']['sourceFenceSha256'],sourceSnapshot=cp,sampleRows=rows,fullColumns=context['columns'],markerJsonbSendSha256=context['markerSha256'],sourceSha256=SOURCE_SHA,reconstructedSha256=SOURCE_SHA,fullByteEquality=True,bindings=bindings,precisionPins='Separate source-reviewed immutable-marker/arithmetic operator; not invented by codec',mathAccepted=False,allHistoricalReplay=False)
 bindings.append(write('native.context.json',encoded(record)));return record|{'contextBinding':bindings[-1]}

def execute(p,h):
 runtime(p);original,inv,sealed=package(p);jm=G.metadata(JOB);need(JOB.is_dir()and jm['uid']==108 and jm['gid']==112 and jm['mode']==0o700,'Existing clone privacy');S.check_window(p);G.check_live(p);body=previous(original);previous_completion();proto,spools,cols=inputs(p);control=S.clone_stopped(JOB,inv['previousUnit'],True)
 old=G.system_properties(OLD_UNIT,['LoadState','ActiveState','MainPID','InvocationID']);need(old==dict(LoadState='loaded',ActiveState='failed',MainPID='0',InvocationID=OLD_INV),'Preserved original failed unit')
 S.unchanged(inv);G.storage_sample(JOB);work=JOB/'stream-completion-v2';need(not os.path.lexists(work)and not os.path.lexists(JOB/'stream-completion-v2-postgres.log'),'Exclusive completion namespace');lock=I.acquire_backup_lock(p['backupLock'],pwd.getpwnam('postgres'));watch=None;pid=None;start=False;phase='admission';started=time.monotonic();oldhandlers={s:signal.signal(s,lambda *_:(_ for _ in()).throw(CompletionInterrupted('Managed completion interrupted')))for s in(signal.SIGINT,signal.SIGTERM,signal.SIGHUP)}
 try:
  work.mkdir(mode=0o700);N.C.sync_parent(work);watch=G.Watchdog(work,sample=lambda _:G.storage_sample(JOB));watch.start();runner=I.DeadlineRunner(I.BoundedRunner(work,watch,started),900)
  def heartbeat():watch.assert_alive();need(time.monotonic()-started<=900,'Completion15min deadline')
  I.verify_source(sealed,heartbeat,rehash=True);S.unchanged(inv);runtime(p);G.check_live(p);S.check_window(p);G.durable(work/'intent.json',dict(schema=SCHEMA,plan=p,planSha256=h,priorFailureSha256=PROOFS['failed.json'],priorBodySha256=PROOFS['phase4-body-rehearsal-v2-completed.json'],priorCompletionFailureSha256=PREVIOUS_COMPLETION_PINS['failed.json'],priorCompletionIntentSha256=PREVIOUS_COMPLETION_PINS['intent.json'],sealedSourceFullHashVerifiedBeforeStart=True,bodyRedo=False,newSchemaWrite=False,productionMutation=False))
  phase='retained-local-byte-equivalence';bounded=I.DeadlineRunner(runner,120);fixed=['/usr/bin/prlimit','--as=1073741824','--cpu=120','--','/usr/bin/python3','-I','-B'];raw=bounded.run([*fixed,str(OLD/'pow-audit30-transition-stream-codec-v2.py'),'verify','--store',str(JOB/'stream-chunks.sqlite'),'--source',str(JOB/'stream-transitions-source.copy')],phase,maximum=1024**2);local=json.loads(raw,object_pairs_hook=I.pairs);need(local.get('byteForByteSourceCompared')is True and local.get('sourceSha256')==SOURCE_SHA and local.get('sourceBytes')==SOURCE_BYTES,'Complete retained local bytes recheck')
  phase='private-start';start=True;runner.run([str(G.BIN/'pg_ctl'),'-D',str(JOB/'cluster'),'-o','-c config_file='+str(JOB/'inspection-postgresql.conf'),'-l',str(JOB/'stream-completion-v2-postgres.log'),'-w','-t','30','start'],phase,timeout=40);pid=G.private_postmaster(JOB)
  phase='retained-context';native_started=time.monotonic();allocation_before=G.allocation(JOB);bounded=I.DeadlineRunner(runner,120);ctx=G.query(bounded,JOB,I.PROTOTYPE_CONTEXT_SQL,phase);expected=dict(columns=proto['base']['columns'],sampleRows=proto['base']['sampleRows'],markerSha256=proto['base']['precisionMarkerJsonbSendSha256'],originalTriggers=proto['originalTriggers']);need(ctx==expected and G.query(bounded,JOB,I.FENCE_SQL,'retained-saved-fence')==inv['snapshot'],'Retained context/fence differs')
  phase='fresh-side-export';raw=bounded.run(self_export_command(p,h,fixed),phase,maximum=1024**2);fresh=json.loads(raw,object_pairs_hook=I.pairs);need(fresh.get('status')=='private-stream-captured'and fresh.get('stderrBytes')==0,'Fresh readonly side export failed');phase='fresh-side-byte-equivalence';out=work/'native.reconstructed.copy';raw=bounded.run([*fixed,str(OLD/'pow-audit30-transition-stream-native-v2.py'),'verify-export','--plan',str(JOB/'stream-prototype-plan.json'),'--plan-sha256',p['inputBindings']['stream-prototype-plan.json']['sha256'],'--spools',str(JOB/'stream-spools.json'),'--spools-sha256',p['inputBindings']['stream-spools.json']['sha256'],'--source',str(JOB/'stream-transitions-source.copy'),'--export',str(work/'current-side-ordered-export.copy'),'--output',str(out)],phase,maximum=1024**2);eq=json.loads(raw,object_pairs_hook=I.pairs);need(eq.get('fullByteEquality')is True and eq.get('sourceSha256')==SOURCE_SHA and eq.get('sourceBytes')==SOURCE_BYTES and eq.get('mathAccepted')is False,'Fresh complete side bytes recheck');phase='retained-native-measurements';measured,sqlsha=measurement(bounded,proto,spools);phase='seven-oracle-artifacts';artifacts=oracle_artifacts(bounded,work,proto,ctx,inv,JOB/'stream-transitions-source.copy',out,cols);need(G.query(bounded,JOB,I.PROTOTYPE_CONTEXT_SQL,'retained-context-after')==ctx and G.query(bounded,JOB,I.FENCE_SQL,'retained-fence-after')==inv['snapshot'],'Original context/fence changed')
  native_delta=budget(allocation_before,native_started);phase='private-stop';G.stop_private(JOB,pid);pid=None;aftercontrol=S.clone_stopped(JOB,inv['previousUnit'],True);need(aftercontrol['systemIdentifier']==control['systemIdentifier'],'Stopped system ID changed');I.verify_source(sealed,heartbeat,rehash=True);S.unchanged(inv);previous(original);previous_completion();inputs(p);G.check_live(p);runtime(p);package(p);need(G.metadata(G.LOCK)==p['backupLock'],'Lock pathname drift');S.check_window(p);heartbeat();storage=G.storage_sample(JOB);need(G.allocation(JOB)-allocation_before<=512*1024**2,'Completion incremental allocation');watch.stop();watch=None
  G.durable(work/'completed.json',dict(schema='pow-audit30-complete-retained-private-stream-completed-v1',status='passed',planSha256=h,priorFailureSha256=PROOFS['failed.json'],priorIntentSha256=PROOFS['intent.json'],priorBodySha256=PROOFS['phase4-body-rehearsal-v2-completed.json'],priorCompletionFailureSha256=PREVIOUS_COMPLETION_PINS['failed.json'],priorCompletionIntentSha256=PREVIOUS_COMPLETION_PINS['intent.json'],priorCompletionRemainsFailed=True,originalAttemptRemainsFailed=True,bodyAll16Accepted=True,bodyRedo=False,newSchemaWrite=False,freshCurrentSideByteEquality=True,measurementSqlSha256=sqlsha,measurements=measured,byteEquivalence=eq,oracleInputs=artifacts,fullNativeByteEquality=True,privateClusterStopped=True,liveServicesUnchanged=True,sealedSourceFullHashVerifiedBeforeStart=True,sealedSourceFullHashVerifiedAtStop=True,productionMutation=False,sealedSourceStarted=False,mathAccepted=False,allHistoricalReplay=False,incrementalAllocatedBytes=native_delta['incrementalAllocatedBytes'],nativeSeconds=native_delta['seconds'],wholeSeconds=time.monotonic()-started,backupWindowRecheckedAtStop=True,storage=storage))
 except BaseException as exc:
  for s in oldhandlers:signal.signal(s,signal.SIG_IGN)
  errors=[];stopped=not start
  if start:
   try:G.stop_private(JOB,pid);stopped=True
   except BaseException as e:errors.append(dict(phase='private-stop',errorClass=type(e).__name__))
  if watch:
   try:watch.stop()
   except BaseException as e:errors.append(dict(phase='watchdog-stop',errorClass=type(e).__name__))
  if work.is_dir():
   try:G.durable(work/'failed.json',dict(schema='pow-audit30-complete-retained-private-stream-failed-v1',status='failed',phase=phase,errorClass=type(exc).__name__,privateStopVerified=stopped,cleanupErrors=errors,productionMutation=False,automaticRetry=False,originalAttemptRemainsFailed=True))
   except BaseException as receipt_error:raise RuntimeError('Completion failure receipt unavailable: '+type(exc).__name__+'/'+type(receipt_error).__name__)from exc
  raise
 finally:
  os.close(lock)
  for s,handler in oldhandlers.items():signal.signal(s,handler)

CREDENTIAL_PATH=None

def export_side(p):
 runtime(p);original,inv,sealed=package(p);previous(original);previous_completion();proto,spools,cols=inputs(p)
 work=G.canonical_path(JOB/'stream-completion-v2');m=G.metadata(work);need(m['uid']==108 and m['gid']==112 and m['mode']==0o700 and work.is_dir(),'Exact created private evidence directory')
 maximum=SOURCE_BYTES+22*spools['meta']['partCount']+21
 return N.stream_child([*G.psql(JOB),'-f','-'],N.export_sql(proto).encode(),work/'current-side-ordered-export.copy',maximum,120)

def main():
 global CREDENTIAL_PATH
 os.umask(0o077);load();a=argparse.ArgumentParser();a.add_argument('--plan',required=True);a.add_argument('--plan-sha256',required=True);a.add_argument('--step',choices=['complete','export-side'],default='complete');args=a.parse_args();path=G.canonical_path(args.plan);CREDENTIAL_PATH=str(path);m=G.metadata(path);need(m['uid']==0 and m['mode']==0o440 and m['nlink']==1 and m['bytes']<=65536,'Managed credential custody');raw=path.read_bytes();need(G.metadata(path)==m and sha(raw)==args.plan_sha256,'Credential bytes');p=validate(json.loads(raw,object_pairs_hook=I.pairs));G.validate_managed_credential(path,p['unit'],'completion-plan',Path(__file__).parent/'reviewed-plan.json');need(G.metadata(path)==m and sha(path.read_bytes())==args.plan_sha256,'Credential after namespace drift')
 if args.step=='export-side':print(json.dumps(export_side(p),sort_keys=True))
 else:execute(p,args.plan_sha256)
if __name__=='__main__':
 try:main()
 except BaseException as exc:print(json.dumps(dict(status='refused',errorClass=type(exc).__name__,rawDetailsSuppressed=True,productionMutation=False),sort_keys=True),file=sys.stderr);sys.exit(1)
