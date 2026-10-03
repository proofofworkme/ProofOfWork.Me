#!/usr/bin/python3 -I
"""Reuse only an exactly qualified, verified STOPPED NEW audit clone for sample-only streaming.

Never start the sealed logical restore or a live server. Original inspection
receipts/configuration remain byte-bound. New evidence, log and watchdog files
are creation-only; solely the new stream side schema writes in the admitted
private clone. Monitored allocation limits are not a filesystem quota.
"""
import argparse,datetime as dt,hashlib,json,os,pwd,re,signal,stat,struct,sys,time,types
from pathlib import Path
PHASE4_ENGINE='pow-audit30-mail-body-repair-rehearsal-v2.mjs'
PHASE4_ENGINE_SHA='ea5614fddc0ef7fb696d0159a141b25116fbd6ba2c4b309db171a548b7f8b70c'
PRIVATE_PLAN_SHA='4ac3a8d9b4b79befd36abc590731b1bc8f2e6c83919d5f6427c34c58a6ddba00'
MANIFEST_SHA='8d5d347aea2d398d75e69631f90b3efdd1c3254cfdbf3864015199b078699c50'
ORIGINAL_ENGINE_SHA='09b3240e45d76278a67053f5fba6009cccce36b00c1b098d38d7435da978dc58'
CLOSURE_SHA='6ff26ebf45fd6471e3124929128b06ca3cf20c53fdf03b12255029faca62e670'
CLOSURE_QUERY_SHA='602241a7a4f4e90e6288ef02f05d57e1e9f3ded78325f989907300a7bfc99c09'
SCHEMA='pow-audit30-stopped-inspect-stream-followup-plan-v4'
INVENTORY='pow-audit30-stopped-inspect-stream-inventory-v3'
APPROVAL='6821c987b9a5d110fbe9fb2820955b7cbc26dda9faddb67667fc49e892f5c820'
PINS={'pow-audit30-saved-snapshot-inspect-v2.py':'f923766a2dffcfaabd45b3bf4fc4cf975435f2713388ec7930b4d3057fad98ad','restore-latest-logical.py':'26c7656b2e751c6de50122c65f8af73686c2d2674bee8be86a3c5648b7fcc80e','pow-audit30-transition-stream-codec-v2.py':'3fe9dd87f9f5638b02be858b44c535c1431b1af1e8e4f9d60a1afe295f5179f0','pow-audit30-transition-stream-native-v2.py':'523342d30599c793a3503ba1d554fc096fce0be554ae232397c8ea4bcadbbe23'}
PROOFS=('intent.json','completed.json','query-captures.json','phase4-rehearsal-adapter.json','phase4-before-prototype.json','phase5-native-prototype.json','saved-snapshot-fence.json')
CONFIGS=('inspection-postgresql.conf','inspection-hba.conf','inspection-ident.conf')
SHA=re.compile(r'[0-9a-f]{64}\Z');RUN=re.compile(r'\d{8}T\d{6}Z\Z');JOB=re.compile(r'/data/proofofwork-audit30-inspect-(\d{8}T\d{6}Z)\Z');I=None;G=None;N=None
SOURCE_INV_SHA='f30301ca4f4769cfbbd995dc7627580be543e6cddfc1f5b3ff4aba033a48f572'
FAILED_PROOFS=('intent.json','failed.json','phase4-body-rehearsal-v1-failed.json','phase4-body-rehearsal-v1-intent.json','pre-start-copy-equivalence.json','private-start-identity.json','saved-snapshot-fence.json','phase5-row-size-preflight.json','id-before-capture.json','id-after-capture.json','relational-capture.json')
REVIEW_SCHEMA='pow-audit30-exact-before-write-refusal-clone-admission-v1'
RUNTIME=900;PROTO_RUNTIME=120;INCREMENTAL=512*1024**2

def need(ok,msg):
 if not ok:raise ValueError(msg)
def encoded(x):return json.dumps(x,sort_keys=True,separators=(',',':')).encode()
def sha(x):return hashlib.sha256(x).hexdigest()
def identity(s):return(s.st_dev,s.st_ino,s.st_mode,s.st_uid,s.st_gid,s.st_nlink,s.st_size,s.st_mtime_ns,s.st_ctime_ns)
def module(name):
 p=Path(__file__).parent/name;s=p.lstat();need(p.resolve(strict=True)==p and stat.S_ISREG(s.st_mode)and s.st_nlink==1 and not s.st_mode&0o022 and s.st_size<=262144,'Unsafe pinned utility module');fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW)
 with os.fdopen(fd,'rb')as f:need(identity(os.fstat(f.fileno()))==identity(s),'Module open drift');raw=f.read(262145);need(identity(os.fstat(f.fileno()))==identity(s),'Module read drift')
 need(identity(p.lstat())==identity(s)and sha(raw)==PINS[name],'Pinned utility source mismatch');m=types.ModuleType(name);m.__file__=str(p);exec(compile(raw,str(p),'exec'),m.__dict__);return m

def load():
 global I,G,N
 I=module('pow-audit30-saved-snapshot-inspect-v2.py');I.load_guard(Path(__file__).parent/'restore-latest-logical.py');G=I.G;N=module('pow-audit30-transition-stream-native-v2.py');N.load_codec()
def calendar(s):need(isinstance(s,str)and RUN.fullmatch(s),'Run ID');need(dt.datetime.strptime(s,'%Y%m%dT%H%M%SZ').strftime('%Y%m%dT%H%M%SZ')==s,'Run calendar')
def job_identity(job):
 m=JOB.fullmatch(job)if isinstance(job,str)else None;need(m is not None,'Only NEW inspector clone eligible, never logical/live cluster');calendar(m[1]);return m[1]
def validate_plan(p):
 keys={'schema','approvalSha256','controllerSha256','host','runId','unit','job','sealedSource','inventory','backupLock','backupWindow','liveServices','envelope','priorAdmission','phase4'};need(isinstance(p,dict)and set(p)==keys and p['schema']==SCHEMA and p['approvalSha256']==APPROVAL and isinstance(p['controllerSha256'],str)and SHA.fullmatch(p['controllerSha256']),'Exact stream plan authority');calendar(p['runId']);job_identity(p['job']);need(p['unit']=='proofofwork-audit30-transition-stream-'+p['runId']+'.service' and re.fullmatch(r'[A-Za-z0-9.-]+',p['host']),'Exact unit/host');need(re.fullmatch(r'/data/proofofwork-audit30-restore-\d{8}T\d{6}Z',p['sealedSource']),'Sealed original scope');calendar(p['sealedSource'].rsplit('-',1)[1]);need(set(p['inventory'])=={'fileName','sha256'}and p['inventory']['fileName']=='stopped-clone-inventory.json'and SHA.fullmatch(p['inventory']['sha256']),'Inventory binding')
 a=p['priorAdmission'];need(isinstance(a,dict) and set(a)=={'kind','fileName','sha256'} and a['kind'] in ('passed-inspection','exact-before-mail-write-trigger-refusal') and a['fileName']=='prior-clone-admission.json' and isinstance(a['sha256'],str) and SHA.fullmatch(a['sha256']),'Exact reviewed prior-clone admission binding');need(p['envelope']==N.C.DEFAULT,'Only unchanged DEFAULT envelope admitted');m=p['backupLock'];need(set(m)==I.META_KEYS and all(type(v)is int and v>=0 for v in m.values())and m['mode']==0o600 and m['nlink']==1,'Exact backup lock');w=p['backupWindow'];need(set(w)=={'preflightAtUtc','nextScheduledAtUtc'} and all(dt.datetime.fromisoformat(v).utcoffset()==dt.timedelta(0)for v in w.values()),'Exact UTC fresh backup window');need(set(p['liveServices'])==set(G.SERVICES),'Five live baselines')
 body=p['phase4'];need(isinstance(body,dict)and set(body)=={'privatePlanSha256','dependencyInventorySha256','pgEntrySha256','node','readinessAdmissionSha256'}and all(isinstance(body[k],str)and SHA.fullmatch(body[k])for k in('privatePlanSha256','dependencyInventorySha256','pgEntrySha256','readinessAdmissionSha256'))and isinstance(body['node'],dict)and set(body['node'])=={'metadata','sha256'}and SHA.fullmatch(body['node']['sha256']),'Exact body/dependency/readiness authority');need(body['privatePlanSha256']==PRIVATE_PLAN_SHA,'Only exact approved sixteen-candidate body plan')
 for row in p['liveServices'].values():need(set(row)=={'MainPID','InvocationID'}and str(row['MainPID']).isdigit()and int(row['MainPID'])>0 and re.fullmatch('[0-9a-f]{32}',row['InvocationID']),'Exact live identity')
 return p

def check_window(plan,now=None):
 # This version only tightens admitted execution:15min whole unit and30min
 # clear timer window. Never stop/delay/mask the ordinary logical backup.
 now=now or dt.datetime.now(dt.timezone.utc);w=plan['backupWindow'];captured=dt.datetime.fromisoformat(w['preflightAtUtc']);deadline=dt.datetime.fromisoformat(w['nextScheduledAtUtc'])
 need(0<=(now-captured).total_seconds()<=900 and(deadline-now).total_seconds()>=1800,'Fresh30-minute clear backup window required for15-minute follow-up')
 service=G.system_properties('proofofwork-postgres-logical-backup.service',['ActiveState']);timer=G.system_properties('proofofwork-postgres-logical-backup.timer',['ActiveState','NextElapseUSecRealtime']);actual=dt.datetime.strptime(timer.get('NextElapseUSecRealtime',''),'%a %Y-%m-%d %H:%M:%S %Z').replace(tzinfo=dt.timezone.utc)
 need(service.get('ActiveState')=='inactive' and timer.get('ActiveState')=='active' and actual==deadline,'Logical backup timer/window authority changed')

def configuration(job):
 return {'inspection-postgresql.conf':("data_directory = '"+str(job/'cluster')+"'\nhba_file = '"+str(job/'inspection-hba.conf')+"'\nident_file = '"+str(job/'inspection-ident.conf')+"'\nlisten_addresses = ''\nport = 55432\nunix_socket_directories = '"+str(job/'socket')+"'\nunix_socket_permissions = 0700\nshared_buffers = '128MB'\nwork_mem = '16MB'\nmaintenance_work_mem = '128MB'\nmax_connections = 10\nmax_worker_processes = 2\nmax_parallel_workers = 0\narchive_mode = off\narchive_command = ''\nrestore_command = ''\nprimary_conninfo = ''\nprimary_slot_name = ''\nshared_preload_libraries = ''\nlogging_collector = off\ntimezone = 'UTC'\ndefault_transaction_read_only = on\n").encode(),'inspection-hba.conf':b'local all postgres trust\nlocal all all reject\nhost all all 0.0.0.0/0 reject\nhost all all ::0/0 reject\n','inspection-ident.conf':b'# No identity mappings\n'}
def files(job,bindings):
 who=pwd.getpwnam('postgres');need(set(bindings)==set(PROOFS),'Exact previous completion proof set');rows={};values={}
 for name,h in bindings.items():
  value,m=I.read_json(job/name,h,limit=8*1024**2);I.valid_meta(m,who.pw_uid,who.pw_gid,'file');rows[name]=dict(metadata=m,sha256=h);values[name]=value
 original=values['intent.json'];original_plan=I.validate_plan(original.get('plan',{}));need(original_plan['job']==str(job) and original_plan['unit']=='proofofwork-audit30-snapshot-inspect-'+job_identity(str(job))+'.service' and original_plan['controllerSha256']==PINS['pow-audit30-saved-snapshot-inspect-v2.py'] and I.digest(original_plan)==original.get('planSha256'),'Exact original admitted inspector plan');done=values['completed.json'];need(done.get('planSha256')==original['planSha256'],'Completion/original plan differs');need(done.get('schema')=='pow-audit30-private-inspection-completed-v1'and done.get('status')=='passed'and all(done.get(k)is True for k in ['privateClusterStopped','sourceClusterUnchanged','liveServicesUnchanged','sourceAndJobRetained'])and done.get('productionDatabaseMutation')is False and done.get('queryCapturesSha256')==bindings['query-captures.json'],'Previous NEW inspection not passed/stopped/source-preserving')
 q=values['query-captures.json'];need(q.get('phase4BodyRehearsal',{}).get('rollbackOnly')is True and q.get('phase5Prototype',{}).get('completeSampleByteReconstruction')is True,'Previous body/eager acceptance missing');need(values['phase4-rehearsal-adapter.json'].get('rollbackOnly')is True and values['phase4-before-prototype.json'].get('savedFenceUnchanged')is True and values['phase5-native-prototype.json'].get('completeSampleByteReconstruction')is True and values['saved-snapshot-fence.json'].get('sourceEqualsCopy')is True,'Independent previous phases/fence absent')
 for name,raw in configuration(job).items():
  m=G.metadata(job/name);I.valid_meta(m,who.pw_uid,who.pw_gid,'file');need(m['bytes']==len(raw)and G.hash_file(job/name)==sha(raw),'Exact isolation configuration differs');rows[name]=dict(metadata=m,sha256=sha(raw))
 return rows,values['saved-snapshot-fence.json']['snapshot'],original_plan['source']

def admission(value):
 need(isinstance(value,dict) and set(value)=={'schema','kind','approvalSha256','job','sealedSource','proofBindings','sealedSourceInventorySha256','priorBodyInverseAccepted','priorEagerPrototypeAccepted'} and value['schema']==REVIEW_SCHEMA and value['approvalSha256']==APPROVAL,'Exact root-reviewed prior admission');job_identity(value['job']);need(value['kind'] in ('passed-inspection','exact-before-mail-write-trigger-refusal') and value['sealedSourceInventorySha256']==SOURCE_INV_SHA,'Only exact verified source inventory');expected=PROOFS if value['kind']=='passed-inspection' else FAILED_PROOFS;need(set(value['proofBindings'])==set(expected) and all(isinstance(h,str)and SHA.fullmatch(h)for h in value['proofBindings'].values()),'Exact prior outcome proof set');need(value['priorBodyInverseAccepted'] is (value['kind']=='passed-inspection') and value['priorEagerPrototypeAccepted'] is (value['kind']=='passed-inspection'),'Previous failure cannot be presented as prior acceptance');return value

def failed_files(job,review,sealed_inventory):
 admission(review);need(review['kind']=='exact-before-mail-write-trigger-refusal' and review['job']==str(job),'Exact failure admission scope');who=pwd.getpwnam('postgres');rows={};v={}
 for name,h in review['proofBindings'].items():
  value,m=I.read_json(job/name,h,limit=8*1024**2);I.valid_meta(m,who.pw_uid,who.pw_gid,'file');rows[name]=dict(metadata=m,sha256=h);v[name]=value
 original=v['intent.json'];p=I.validate_plan(original.get('plan',{}));need(p['job']==str(job) and p['controllerSha256']==PINS['pow-audit30-saved-snapshot-inspect-v2.py'] and p['source']==review['sealedSource'] and p['inventory']['sha256']==SOURCE_INV_SHA and I.digest(p)==original.get('planSha256'),'Exact failed inspector original plan');f=v['failed.json'];need(f.get('schema')=='pow-audit30-private-inspection-failed-v1' and f.get('status')=='failed' and f.get('phase')=='phase4-mail-body-rehearsal' and f.get('errorClass')=='RuntimeError' and f.get('planSha256')==original['planSha256'] and f.get('cleanupErrors')==[] and f.get('privateStopVerified')is True and f.get('productionDatabaseMutation')is False and f.get('sourceUnchangedFullHashVerified')is False and f.get('automaticRetry')is False,'Only documented stopped before-write trigger refusal');b=v['phase4-body-rehearsal-v1-failed.json'];bi=v['phase4-body-rehearsal-v1-intent.json'];need(b.get('schema')=='pow-audit30-private-mail-body-rehearsal-failed-v1' and b.get('status')=='failed' and b.get('phase')=='private-identity' and b.get('errorCode')=='MAIL_WRITE_TRIGGER_REFUSED' and b.get('rollbackAcknowledged')is True and b.get('productionMutation')is False and b.get('automaticRetry')is False and bi.get('schema')=='pow-audit30-private-mail-rehearsal-intent-v1' and bi.get('privateJob')==str(job) and bi.get('rollbackOnly')is True and bi.get('productionMutation')is False and b.get('manifestSHA256')==bi.get('manifestSHA256') and SHA.fullmatch(b.get('manifestSHA256','')),'Exact fixed-engine before-update refusal/rollback proof')
 eq=v['pre-start-copy-equivalence.json'];need(eq.get('sourceInventorySha256')==SOURCE_INV_SHA and eq.get('sourceRecordsSha256')==sealed_inventory['recordsSha256'] and eq.get('sourceRegularBytes')==sealed_inventory['regularBytes'] and eq.get('entries')==sealed_inventory['entries'] and eq.get('fullCopyContentTypeModeOwnerMtimeEquality')is True and eq.get('sourceReadOnly')is True and eq.get('xattrsEmpty')is True and eq.get('copyEquivalenceSha256')==I.copy_equivalence(sealed_inventory['records'],sealed_inventory['records']),'Complete initial copy-equivalence authority missing')
 cp=v['saved-snapshot-fence.json'];need(cp.get('sourceEqualsCopy')is True and cp.get('snapshot')==sealed_inventory['snapshot'],'Actual saved fence/source equality');ident=v['private-start-identity.json'];need(ident.get('settings',{}).get('systemIdentifier')==sealed_inventory['sourceControl']['systemIdentifier'] and ident.get('settings',{}).get('dataDirectory')==str(job/'cluster') and ident.get('settings',{}).get('listenAddresses')=='' and ident.get('settings',{}).get('readOnly')=='on' and ident.get('settings',{}).get('checksums')=='on' and ident.get('settings',{}).get('socket')==str(job/'socket') and ident.get('settings',{}).get('port')=='55432','Actual original private identity missing')
 for name,raw in configuration(job).items():
  m=G.metadata(job/name);I.valid_meta(m,who.pw_uid,who.pw_gid,'file');need(m['bytes']==len(raw)and G.hash_file(job/name)==sha(raw),'Original fixed configuration changed');rows[name]=dict(metadata=m,sha256=sha(raw))
 # Fixed f923/26c source performs only READ ONLY profiles/captures before the
 # fixed09b3 body engine's private-identity refusal. No all-table COPY equality
 # is invented: the earlier complete physical copy + before-write path is
 # separately qualified, while a fresh full stopped tree is required below.
 return rows,cp['snapshot'],p['source']

def outcome_files(job,review,sealed_inventory):
 return files(job,review['proofBindings']) if review['kind']=='passed-inspection' else failed_files(job,review,sealed_inventory)

def physical_copy_changes(source_rows,current_rows):
 # Device/inode/ctime must differ after a real copy. Preserve the exact initial
 # equivalence receipt separately and compare content/type/mode/owner/mtime now.
 before={r['path']:r for r in source_rows};after={r['path']:r for r in current_rows};rows=[]
 runtime_roots={'pg_wal','pg_stat','pg_stat_tmp','pg_xact','pg_subtrans','pg_multixact','pg_notify','pg_snapshots','pg_serial','pg_logical'}
 for rel in sorted(set(before)|set(after)):
  a=before.get(rel);b=after.get(rel)
  def content(r):
   if r is None:return None
   m=r['metadata'];return dict(kind=r['kind'],mode=m['mode'],uid=m['uid'],gid=m['gid'],mtimeNs=m['mtimeNs'],bytes=m['bytes'] if r['kind']=='file' else None,sha256=r.get('sha256'))
  aa=content(a);bb=content(b)
  if aa==bb:continue
  runtime=rel.split('/',1)[0]in runtime_roots or rel in ('global/pg_control','postmaster.opts','global/pg_internal.init') or re.fullmatch(r'base/[0-9]+/pg_internal\.init',rel)is not None
  # New/removed runtime files and parent directory mtimes are exposed explicitly.
  harmless_directory=a is not None and b is not None and a['kind']==b['kind']=='directory'and {k:v for k,v in aa.items()if k!='mtimeNs'}=={k:v for k,v in bb.items()if k!='mtimeNs'}
  same_identity=(aa is None or bb is None or all(aa[k]==bb[k]for k in ('kind','mode','uid','gid')))
  classification='known-pg-runtime-file'if runtime and same_identity else'parent-directory-mtime-only'if harmless_directory else'unexplained-data-or-identity-change'
  rows.append(dict(path=rel,before=aa,after=bb,classification=classification))
 return dict(schema='pow-audit30-post-start-physical-change-census-v1',initialCopyEquivalenceRetained=True,currentCloneBytesEqualOriginalSource=False,changes=rows,changesSha256=sha(encoded(rows)),unexplainedChangeCount=sum(r['classification']=='unexplained-data-or-identity-change'for r in rows),qualification='Expected PG runtime/control/WAL/cache and directory mtimes can differ after prior startup; never substitute this census for logical row parity or a production physical-page certificate.')

def inventory_runtime(job,sealed,unit,host):
 need(re.fullmatch(r'proofofwork-audit30-stream-inventory-\d{8}T\d{6}Z\.service',unit) and os.uname().nodename==host and os.geteuid()==pwd.getpwnam('postgres').pw_uid,'Managed inventory role');need(any(x.split(':',2)[-1]=='/system.slice/'+unit for x in Path('/proc/self/cgroup').read_text().splitlines()),'Inventory cgroup');wanted={**G.UNIT_PROPERTIES,'RuntimeMaxUSec':'15min','MemoryHigh':str(768*1024**2),'MemoryMax':str(1024**3),'CPUQuotaPerSecUSec':'250ms','TasksMax':'32','ReadWritePaths':''};actual=G.system_properties(unit,[*wanted,'ReadOnlyPaths','InaccessiblePaths']);need(all(actual.get(k)==v for k,v in wanted.items()) and set(actual.get('ReadOnlyPaths','').split())=={str(G.BACKUPS),str(job),str(sealed)} and set(actual.get('InaccessiblePaths','').split())==set(G.UNIT_INACCESSIBLE)|{str(job)+'/socket',str(sealed)+'/socket'},'Weakened read-only inventory unit');need(all(os.statvfs(x).f_flag&os.ST_RDONLY for x in [job,sealed]),'Both clone/source mounts must be RO')
 for path in [*G.INACCESSIBLE,str(job)+'/socket',str(sealed)+'/socket']:
  try:os.listdir(path)
  except (PermissionError,FileNotFoundError):continue
  raise ValueError('Inventory production/private socket accessible')

def collect_inventory(job,review,unit,host):
 job=G.canonical_path(job);rid=job_identity(str(job));admission(review);sealed=G.canonical_path(review['sealedSource']);inventory_runtime(job,sealed,unit,host);I.inventory_capacity(job);I.inventory_capacity(sealed);si,_=I.read_json(Path(__file__).parent/'sealed-logical-inventory.json',SOURCE_INV_SHA,limit=64*1024**2,root_authority=True);I.validate_inventory(si);need(si['sourceJob']==str(sealed),'Exact sealed logical source');oldunit='proofofwork-audit30-snapshot-inspect-'+rid+'.service';proofs,cp,sealed_source=outcome_files(job,review,si);need(sealed_source==str(sealed),'Original source admission differs');live={n:G.system_properties(n,['ActiveState','MainPID','InvocationID'])for n in G.SERVICES};need(all(v.get('ActiveState')=='active'and int(v.get('MainPID','0'))>0 for v in live.values()),'Live baseline absent');control=I.source_stopped(job,oldunit);start=time.monotonic();last=start
 def heartbeat():
  nonlocal last
  now=time.monotonic();need(now-start<=900,'Inventory15min deadline')
  if now-last>=5:I.inventory_capacity(job);I.inventory_capacity(sealed);last=now
 who=pwd.getpwnam('postgres');I.verify_source(si,heartbeat,rehash=True);tree=I.inventory_tree(job/'cluster',who.pw_uid,who.pw_gid,heartbeat);need(I.source_stopped(job,oldunit)==control,'Stopped clone changed during inventory');need(outcome_files(job,review,si)==(proofs,cp,str(sealed)),'Previous proofs/config changed during inventory');need(all(G.system_properties(n,['ActiveState','MainPID','InvocationID'])==v for n,v in live.items()),'Live service changed during inventory');inventory_runtime(job,sealed,unit,host);I.inventory_capacity(job);I.inventory_capacity(sealed);I.verify_source(si,heartbeat,rehash=False)
 return dict(schema=INVENTORY,job=str(job),sealedSource=str(sealed),priorAdmission=review,sealedSourceFullHashVerified=True,sealedSourceRecordsSha256=si['recordsSha256'],previousUnit=oldunit,previousProofs=proofs,snapshot=cp,sourceControl=control,postgresUid=who.pw_uid,postgresGid=who.pw_gid,physicalChangesSinceInitialCopy=physical_copy_changes(si['records'],tree['records']),**tree)

def validate_inventory(v,p):
 need(isinstance(v,dict)and set(v)=={'schema','job','sealedSource','priorAdmission','sealedSourceFullHashVerified','sealedSourceRecordsSha256','previousUnit','previousProofs','snapshot','sourceControl','postgresUid','postgresGid','records','recordsSha256','entries','regularBytes','physicalChangesSinceInitialCopy'}and v['schema']==INVENTORY and v['job']==p['job'] and v['sealedSource']==p['sealedSource'] and v['previousUnit']=='proofofwork-audit30-snapshot-inspect-'+job_identity(p['job'])+'.service','Exact stopped clone inventory');need(v['sourceControl'].get('state')=='shut down'and v['sourceControl'].get('checksums')=='1'and re.fullmatch('[0-9]+',v['sourceControl'].get('systemIdentifier','')),'Stopped/checksummed source control');need(v['entries']==len(v['records'])and 0<v['entries']<=I.MAX_ENTRIES and v['recordsSha256']==I.digest(v['records'])and 0<v['regularBytes']<=I.MAX_BYTES,'Full inventory bounds/hash');change=v['physicalChangesSinceInitialCopy'];need(isinstance(change,dict)and change.get('schema')=='pow-audit30-post-start-physical-change-census-v1'and change.get('changesSha256')==sha(encoded(change.get('changes',[])))and change.get('unexplainedChangeCount')==0,'Unexplained physical data/identity drift requires separate proof; no automatic waiver');a=admission(v['priorAdmission']);need(a['kind']==p['priorAdmission']['kind'] and sha(encoded(a))==p['priorAdmission']['sha256'] and v['sealedSourceFullHashVerified']is True and SHA.fullmatch(v['sealedSourceRecordsSha256']),'Exact prior admission/source full hash');need(set(v['previousProofs'])==set(a['proofBindings'])|set(CONFIGS),'Complete proof/config inventories');who=pwd.getpwnam('postgres');need(v['postgresUid']==who.pw_uid and v['postgresGid']==who.pw_gid,'Inventory PG ownership');need(v['snapshot'].get('precisionMarkerStatus')=='complete'and v['snapshot'].get('precisionActivationHeight')=='960601','Snapshot marker complete');return v

def checked_package(p):
 base=G.canonical_path(Path(__file__).parent);who=pwd.getpwnam('postgres');pm=G.metadata(base);need(pm['uid']==0 and pm['gid']==who.pw_gid and pm['mode']==0o750,'Root private immutable package');need(Path(__file__).name=='controller.py','Installed exact controller basename');required={'controller.py':p['controllerSha256'],**PINS,'stopped-clone-inventory.json':p['inventory']['sha256'],'sealed-logical-inventory.json':SOURCE_INV_SHA,'prior-clone-admission.json':p['priorAdmission']['sha256'],PHASE4_ENGINE:PHASE4_ENGINE_SHA,'original-transaction-engine.mjs':ORIGINAL_ENGINE_SHA,'phase4-private-plan.json':p['phase4']['privatePlanSha256'],'phase4-pg-dependency-inventory.json':p['phase4']['dependencyInventorySha256'],'phase4-readiness-admission-v2.json':p['phase4']['readinessAdmissionSha256']}
 for name,h in required.items():
  member=G.canonical_path(base/name);m=G.metadata(member);need(stat.S_ISREG(member.lstat().st_mode)and m['uid']==0 and m['gid']==who.pw_gid and m['mode']==0o440 and m['nlink']==1,'Unsafe package member');need(G.hash_file(member,m|{'sha256':h},360*1024**2 if name=='phase4-private-plan.json'else 64*1024**2,no_atime=False)==h,'Package source/content drift')
 I.verify_pg_dependencies(base,p['phase4']);node=p['phase4']['node'];need(G.hash_file(I.NODE,node['metadata']|{'sha256':node['sha256']},256*1024**2,no_atime=False)==node['sha256'],'Existing Node binary changed');body_authority(base,p);return base

def runtime(p):
 need(os.geteuid()==pwd.getpwnam('postgres').pw_uid and os.uname().nodename==p['host'],'Native postgres service identity');need(any(x.split(':',2)[-1]=='/system.slice/'+p['unit']for x in Path('/proc/self/cgroup').read_text().splitlines()),'Managed stream cgroup');wanted={**G.UNIT_PROPERTIES,'RuntimeMaxUSec':'15min','ReadWritePaths':p['job']};actual=G.system_properties(p['unit'],[*wanted,'ReadOnlyPaths','InaccessiblePaths']);need(all(actual.get(k)==v for k,v in wanted.items()) and set(actual.get('ReadOnlyPaths','').split())=={str(G.BACKUPS),p['sealedSource']}and set(actual.get('InaccessiblePaths','').split())==set(G.UNIT_INACCESSIBLE)|{p['sealedSource']+'/socket'},'Weakened stream managed unit');need(os.statvfs(p['sealedSource']).f_flag&os.ST_RDONLY,'Sealed original RO mount')
 for x in [*G.INACCESSIBLE,p['sealedSource']+'/socket']:
  try:os.listdir(x)
  except (PermissionError,FileNotFoundError):continue
  raise ValueError('Production/sealed socket accessible')
 return actual

def read_plan(path,h,credential):
 p=G.canonical_path(path);m=G.metadata(p);need(stat.S_ISREG(p.lstat().st_mode)and m['uid']==0 and m['mode']==(0o440 if credential else 0o600)and m['nlink']==1 and m['bytes']<=65536 and SHA.fullmatch(h),'Unsafe managed plan');raw=p.read_bytes();need(G.metadata(p)==m and sha(raw)==h,'Plan bytes/metadata drift');value=validate_plan(json.loads(raw,object_pairs_hook=I.pairs))
 if credential:G.validate_managed_credential(p,value['unit'],'stream-plan',Path(__file__).parent/'reviewed-plan.json');need(G.metadata(p)==m and sha(p.read_bytes())==h,'Credential changed after namespace proof')
 return value

def unchanged(v,heartbeat=None,full=False):
 job=Path(v['job']);si,_=I.read_json(Path(__file__).parent/'sealed-logical-inventory.json',SOURCE_INV_SHA,limit=64*1024**2,root_authority=True);rows,cp,sealed=outcome_files(job,v['priorAdmission'],si);need(rows==v['previousProofs']and cp==v['snapshot']and sealed==v['sealedSource'],'Previous evidence/config drift')
 need(physical_copy_changes(si['records'],v['records'])==v['physicalChangesSinceInitialCopy'],'Physical change census source binding differs')
 if full:I.verify_source(si,heartbeat,rehash=True);need(I.source_stopped(job,v['previousUnit'])==v['sourceControl'] and I.inventory_tree(job/'cluster',v['postgresUid'],v['postgresGid'],heartbeat,expected=v['records'])['recordsSha256']==v['recordsSha256'],'Fresh full stopped clone content differs')

def body_authority(package,p):
 private,_=I.read_json(package/'phase4-private-plan.json',p['phase4']['privatePlanSha256'],limit=360*1024**2,root_authority=True)
 a,_=I.read_json(package/'phase4-readiness-admission-v2.json',p['phase4']['readinessAdmissionSha256'],limit=32768,root_authority=True)
 expected=dict(schema='pow-audit30-private-mail-readiness-admission-v2',privateJob=p['job'],evidenceDirectory=p['job']+'/stream-followup-v1',originalPlanSHA256=p['phase4']['privatePlanSha256'],manifestSHA256=private.get('manifestSHA256'),originalEngineSHA256=ORIGINAL_ENGINE_SHA,engineSHA256=PHASE4_ENGINE_SHA,canonicalReadinessSourceSHA256='76f45fb566b70b62946bde9d131d43c69eee5e5f1f428514a29d400e290e1702',canonicalBaseSqlSHA256='830970ee14618a6356b0f7acebe2e188dbdced589c8eb9f1c53677d92ada5987',canonicalAssertionSHA256='f26f85519e8e5023ecb76e1511309cf9b9835536811926bbf335b5e54c412726',closureQuerySHA256=CLOSURE_QUERY_SHA,canonicalAssertionAccepted=True,closureSHA256=CLOSURE_SHA,productionApplyApproved=False,rollbackOnly=True)
 need(a==expected and sha(encoded(a))==p['phase4']['readinessAdmissionSha256'],'Exact actual canonical readiness admission bytes');need(private.get('manifestSHA256')==MANIFEST_SHA and private.get('schema')=='pow-audit30-mail-body-private-rehearsal-plan-v1'and SHA.fullmatch(private.get('manifestSHA256',''))and isinstance(private.get('targets'),list),'Fixed original body plan shape');return private,a

def body_rehearsal(runner,job,package,p,work,v):
 checked_package(p);before=G.allocation(job);started=time.monotonic();bounded=I.DeadlineRunner(runner,120);private,a=body_authority(package,p);ids=[t['txid']for t in private['targets']];need(ids==sorted(set(ids))and len(ids)<=128 and all(SHA.fullmatch(x)for x in ids),'Original target count/order')
 bounded.run([str(I.NODE),'--max-old-space-size=128',str(package/PHASE4_ENGINE),str(package/'phase4-private-plan.json'),p['phase4']['privatePlanSha256'],str(job),str(package/'pg-dependencies'/'pg'/'lib'/'index.js'),p['phase4']['pgEntrySha256'],'phase4-body-rehearsal-v2',str(package/'phase4-readiness-admission-v2.json'),p['phase4']['readinessAdmissionSha256'],str(work)],'body-readiness-forward-inverse-rehearsal',maximum=1024**2)
 path=work/'phase4-body-rehearsal-v2-completed.json';h=G.hash_file(path,limit=8*1024**2);r,_=I.read_json(path,h,limit=8*1024**2)
 flags=dict(schema='pow-audit30-private-mail-body-rehearsal-completed-v2',status='passed',originalPlanSHA256=p['phase4']['privatePlanSha256'],originalEngineSHA256=ORIGINAL_ENGINE_SHA,engineSHA256=PHASE4_ENGINE_SHA,admissionSHA256=p['phase4']['readinessAdmissionSha256'],canonicalReadinessClosureSHA256=CLOSURE_SHA,manifestSHA256=private['manifestSHA256'],exactInverseBodySqlExercised=True,allFourNativeFingerprintsRestored=True,rollbackAcknowledged=True,privateOriginalRowsRestored=True,allCloneNonbodyAndNontargetRowsUnchanged=True,productionMutation=False,productionApplyApproved=False,cloneSubsetQualified=True,sourceCoreProofConsumedFromCapture=True,newCoreReplayClaimed=False)
 need(all(r.get(k)==x and type(r.get(k))is type(x)for k,x in flags.items()),'Body forward/inverse/rollback acceptance incomplete')
 for k in ('manifestTargetCount','selectedCloneTargetCount','missingCloneCandidateCount'):need(type(r.get(k))is int and 0<=r[k]<=128,'Body result partition count')
 selected=r.get('selectedTxids',[]);missing=r.get('missingCloneCandidateTxids',[]);need(r['manifestTargetCount']==len(ids)==16 and r['selectedCloneTargetCount']==16 and r['missingCloneCandidateCount']==0 and missing==[] and selected==sorted(set(selected))and missing==sorted(set(missing))and len(selected)==r['selectedCloneTargetCount']and len(missing)==r['missingCloneCandidateCount']and not(set(selected)&set(missing))and sorted(selected+missing)==ids,'Exact saved-clone subset partition differs')
 for k in ('namedDeferredConstraintExercised','singleQueuedTransactionObserved','exactOneShardIncrementObserved'):need(r.get(k)is bool(selected),'Actual named queue/shard trigger exercise missing')
 if selected:need(type(r.get('readinessAffectedShard'))is int and 0<=r['readinessAffectedShard']<64 and re.fullmatch('[1-9][0-9]*',r.get('readinessEpochBefore',''))and r.get('readinessEpochAfter')==str(int(r['readinessEpochBefore'])+1),'Exact journal epoch increment differs')
 fingerprints=r.get('baselineNativeFingerprints',{});need(set(fingerprints)=={'mail','meta','queue','shards'},'Four-table fingerprints missing')
 for name,row in fingerprints.items():
  need(set(row)=={'count','logical_bytes','sha256'}and type(row['count'])is int and 0<=row['count']<=20000 and isinstance(row['logical_bytes'],str)and re.fullmatch('[0-9]+',row['logical_bytes'])and int(row['logical_bytes'])<=256*1024**2 and SHA.fullmatch(row['sha256']),'Bounded full native table fingerprint missing')
 need(fingerprints['queue']['count']==0 and fingerprints['shards']['count']==64 and G.query(bounded,job,I.FENCE_SQL,'body-inverse-saved-fence')==v['snapshot'],'Body inverse changed queue/shards/saved fence');need(G.allocation(job)-before<=INCREMENTAL and time.monotonic()-started<=120,'Body rehearsal monitored time/allocation bound');checked_package(p)
 result=dict(receiptFileName=path.name,receiptSha256=h,engineSha256=PHASE4_ENGINE_SHA,originalPlanSha256=p['phase4']['privatePlanSha256'],readinessAdmissionSha256=p['phase4']['readinessAdmissionSha256'],canonicalReadinessClosureSha256=CLOSURE_SHA,selected=r['selectedCloneTargetCount'],missing=r['missingCloneCandidateCount'],exactInverseBodySqlExercised=True,allFourNativeFingerprintsRestored=True,rollbackOnly=True,namedDeferredConstraintExercised=bool(selected),savedFenceUnchanged=True,productionApplyApproved=False,seconds=time.monotonic()-started,incrementalAllocatedBytes=G.allocation(job)-before)
 G.durable(work/'phase4-before-stream-prototype.json',result);return result

def decode_marker(raw,expected_send_sha):
 need(isinstance(raw,bytes)and len(raw)<=2*1024**2 and raw[:19]==b'PGCOPY\n\xff\r\n\x00'+struct.pack('!ii',0,0),'Exact bounded marker COPY header');at=19
 def read(n):
  nonlocal at
  need(n>=0 and at+n<=len(raw),'Marker COPY truncated');b=raw[at:at+n];at+=n;return b
 need(struct.unpack('!h',read(2))[0]==3,'Exact marker three-column row');fields=[]
 for _ in range(3):
  n=struct.unpack('!i',read(4))[0];need(0<=n<=2*1024**2,'Marker field NULL/size');fields.append(read(n))
 need(struct.unpack('!h',read(2))[0]==-1 and at==len(raw),'Marker COPY extra row/bytes');need(fields[0]==b'workPrecisionV2Migration:livenet'and len(fields[2])==8 and len(fields[1])>1 and fields[1][0]==1 and sha(fields[1])==expected_send_sha,'Marker key/timestamp/JSONB version/send SHA');value=json.loads(fields[1][1:],object_pairs_hook=I.pairs);need(isinstance(value,dict),'Complete marker object');return fields[1][1:]

def oracle_artifacts(bounded,job,work,plan,context,v,source,reconstructed,source_sha,columns):
 def write(name,raw):
  path=work/name
  with N.new_file(path)as f:f.write(raw);f.flush();os.fsync(f.fileno())
  return dict(fileName=name,bytes=len(raw),sha256=sha(raw))
 def copy(name,original):
  path,stamp,f=N.C.safe_input(original,N.C.DEFAULT['sourceBytes']);h=hashlib.sha256();count=0
  with f,N.new_file(work/name)as out:
   while True:
    b=f.read(65536)
    if not b:break
    count+=len(b);need(count<=N.C.DEFAULT['sourceBytes'],'Artifact source cap');h.update(b);out.write(b)
   out.flush();os.fsync(out.fileno());N.C.fence(path,stamp,f)
  need(h.hexdigest()==source_sha,'Native oracle artifact copy differs');return dict(fileName=name,bytes=count,sha256=h.hexdigest())
 cp=plan['base']['checkpoint'];rows=[dict(height=r['height'],hash=r['hash'])for r in context['sampleRows']];keys_sha=sha(json.dumps(rows,separators=(',',':')).encode());checkpoint=dict(network='livenet',height=cp['height'],hash=cp['hash'],sourceFenceSha256=plan['base']['sourceFenceSha256'],sampleRowKeysSha256=keys_sha)
 marker_sql=N.sql_guard(plan,True)+"COPY(SELECT key,value,updated_at FROM proof_indexer.meta WHERE key='workPrecisionV2Migration:livenet') TO STDOUT (FORMAT binary);\nCOMMIT;\n"
 raw=bounded.run([*G.psql(job),'-f','-'],'stream-native-marker-capture',stdin=marker_sql.encode(),maximum=2*1024**2);marker=decode_marker(raw,context['markerSha256'])
 bindings=[copy('native.copy',source),copy('native.reconstructed.copy',reconstructed),write('native.columns.json',columns),write('native.checkpoint.json',json.dumps(checkpoint,separators=(',',':')).encode()),write('native.marker.copy',raw),write('native.marker-value.json',marker)]
 record=dict(schema='pow-audit30-stream-native-oracle-inputs-v1',privateJob=str(job),evidenceDirectory=str(work),prefix='native',basePlan=plan['base'],envelope=plan['envelope'],sourceFenceSha256=plan['base']['sourceFenceSha256'],sourceSnapshot=cp,sampleRows=rows,fullColumns=context['columns'],markerJsonbSendSha256=context['markerSha256'],sourceSha256=source_sha,reconstructedSha256=source_sha,fullByteEquality=True,bindings=bindings,precisionPins='Separate source-reviewed immutable-marker/arithmetic operator; not invented by codec',mathAccepted=False,allHistoricalReplay=False)
 bindings.append(write('native.context.json',encoded(record)));return record|{'contextBinding':bindings[-1]}

def native_sample(runner,job,package,v,work):
 bounded=I.DeadlineRunner(runner,PROTO_RUNTIME);started=time.monotonic();allocation=G.allocation(job);context=G.query(bounded,job,I.PROTOTYPE_CONTEXT_SQL,'stream-source-context');cp=v['snapshot'];rows=context['sampleRows'];base=dict(schema='pow-audit30-private-transition-prototype-plan-v1',privateJob=str(job),privateSocket=str(job/'socket'),privatePort=55432,sourceDatabase='proof_indexer',network='livenet',checkpoint=dict(height=cp['canonicalBlock']['height'],hash=cp['canonicalBlock']['hash'],transitionHeight=cp['transitionMaxHeight'],transitionHash=cp['transitionMaxHash']),sourceFenceSha256=v['previousProofs']['saved-snapshot-fence.json']['sha256'],sampleRows=rows,columns=context['columns'],precisionMarkerJsonbSendSha256=context['markerSha256']);plan=dict(schema=N.PLAN_SCHEMA,base=base,originalTriggers=context['originalTriggers'],envelope=N.C.DEFAULT,admission=None,profileBinding=None);b,cols,checkpoint,samples,e,_,_=N.validate(plan)
 def write(name,raw):
  with N.new_file(job/name)as f:f.write(raw);f.flush();os.fsync(f.fileno())
  return G.hash_file(job/name,limit=65536)
 pin=write('stream-prototype-plan.json',encoded(plan));columns_sha=write('stream-columns.json',cols);checkpoint_sha=write('stream-checkpoint.json',checkpoint);samples_sha=write('stream-samples.json',samples);fixed=['/usr/bin/prlimit','--as=1073741824','--cpu=120','--','/usr/bin/python3','-I','-B'];driver=package/'pow-audit30-transition-stream-native-v2.py';codec=package/'pow-audit30-transition-stream-codec-v2.py';source=job/'stream-transitions-source.copy';store=job/'stream-chunks.sqlite';spools=job/'stream-spools.json'
 def driver_run(mode,out,phase,*extra):return bounded.run([*fixed,str(driver),mode,'--plan',str(job/'stream-prototype-plan.json'),'--plan-sha256',pin,'--output',str(out),*extra],phase,maximum=1024**2)
 raw=driver_run('capture',source,'stream-binary-capture');capture=json.loads(raw,object_pairs_hook=I.pairs);need(capture.get('status')=='private-stream-captured'and capture.get('bytes',0)<=e['sourceBytes'],'Complete native capture required');source_sha=G.hash_file(source,limit=e['sourceBytes']);need(source_sha==capture['sha256'],'Capture SHA differs')
 bounded.run([*fixed,str(codec),'build','--source',str(source),'--source-sha256',source_sha,'--columns',str(job/'stream-columns.json'),'--columns-sha256',columns_sha,'--checkpoint',str(job/'stream-checkpoint.json'),'--checkpoint-sha256',checkpoint_sha,'--samples',str(job/'stream-samples.json'),'--samples-sha256',samples_sha,'--store',str(store),'--output',str(job/'stream-local-reconstructed.copy')],'stream-local-codec',maximum=1024**2)
 need(G.hash_file(job/'stream-local-reconstructed.copy',limit=e['sourceBytes'])==source_sha,'Local full reconstruction differs');driver_run('prepare-spools',spools,'stream-binary-spools','--store',str(store),'--store-sha256',G.hash_file(store,limit=e['storeBytes']));spool_sha=G.hash_file(spools,limit=1024**2);side=job/'stream-side.sql';driver_run('emit-side',side,'stream-emit-side','--spools',str(spools),'--spools-sha256',spool_sha);need(G.metadata(side)['bytes']<=65536,'Native SQL small bound');bounded.run([*G.psql(job),'-f',str(side)],'stream-native-side',maximum=1024**2)
 export=job/'stream-ordered-export.copy';driver_run('export',export,'stream-ordered-export','--spools',str(spools),'--spools-sha256',spool_sha);raw=driver_run('verify-export',job/'stream-native-reconstructed.copy','stream-full-native-equivalence','--spools',str(spools),'--spools-sha256',spool_sha,'--source',str(source),'--export',str(export));equivalence=json.loads(raw,object_pairs_hook=I.pairs);need(equivalence.get('fullByteEquality')is True and equivalence.get('sourceSha256')==source_sha and equivalence.get('mathAccepted')is False,'Full native stream acceptance missing')
 measurements=G.query(bounded,job,N.measurements_sql(plan),'stream-native-measurements');need(measurements.get('sourceSha256')==source_sha and measurements.get('sourceBytes')==capture['bytes']and type(measurements.get('schemaTotalBytes'))is int and 0<measurements['schemaTotalBytes']<=e['nativeRelationBytes'],'Actual native physical measurement differs');after=G.query(bounded,job,I.PROTOTYPE_CONTEXT_SQL,'stream-original-context-after');need(after==context and G.query(bounded,job,I.FENCE_SQL,'stream-snapshot-after')==cp,'Original sample/trigger/marker/fence changed');artifacts=oracle_artifacts(bounded,job,work,plan,context,v,source,job/'stream-native-reconstructed.copy',source_sha,cols);need(G.allocation(job)-allocation<=INCREMENTAL and time.monotonic()-started<=PROTO_RUNTIME,'Prototype allocation/time bound');return dict(sourceSha256=source_sha,sourceBytes=capture['bytes'],planSha256=pin,spoolsSha256=spool_sha,fullByteEquality=True,framing=equivalence['framing'],measurements=measurements,incrementalAllocatedBytes=G.allocation(job)-allocation,seconds=time.monotonic()-started,mathAccepted=False,allHistoricalReplay=False,oracleInputs=artifacts,sideSchema=N.SCHEMA,sourceContextAndSavedFenceUnchanged=True)

def execute(p,h):
 package=checked_package(p);job=G.canonical_path(p['job']);who=pwd.getpwnam('postgres');jm=G.metadata(job);need(jm['uid']==who.pw_uid and jm['gid']==who.pw_gid and jm['mode']==0o700 and job.is_dir(),'Existing admitted clone privacy');runtime(p);check_window(p);G.check_live(p);v,_=I.read_json(package/'stopped-clone-inventory.json',p['inventory']['sha256'],limit=64*1024**2,root_authority=True);validate_inventory(v,p);G.storage_sample(job);watch=None;pid=None;start_attempted=False;phase='admission';started=time.monotonic();work=job/'stream-followup-v1';need(not os.path.lexists(work) and not os.path.lexists(job/'stream-postgres.log') and not any(x.name.startswith('stream-')for x in job.iterdir()),'Previous stream evidence exists; reuse refused');lock=I.acquire_backup_lock(p['backupLock'],who)
 def interrupted(*_):raise InterruptedError('Managed stream follow-up interrupted')
 previous={s:signal.signal(s,interrupted)for s in [signal.SIGTERM,signal.SIGINT,signal.SIGHUP]};intent=False
 try:
  work.mkdir(mode=0o700);N.C.sync_parent(work);watch=G.Watchdog(work,sample=lambda _:G.storage_sample(job));watch.start();runner=I.BoundedRunner(work,watch,started)
  def heartbeat():watch.assert_alive();need(time.monotonic()-started<=RUNTIME,'Stream whole15min deadline')
  unchanged(v,heartbeat,full=True);runtime(p);G.check_live(p);check_window(p);G.storage_sample(job);G.durable(work/'intent.json',dict(schema=SCHEMA,planSha256=h,plan=p,previousInspectionImmutable=True,previousInspectionStatus='passed'if v['priorAdmission']['kind']=='passed-inspection'else'failed',sealedSourceFullHashVerified=True,sealedLogicalSourceStartAllowed=False,productionDatabaseMutation=False));intent=True
  phase='private-start';start_attempted=True;runner.run([str(G.BIN/'pg_ctl'),'-D',str(job/'cluster'),'-o','-c config_file='+str(job/'inspection-postgresql.conf'),'-l',str(job/'stream-postgres.log'),'-w','-t','30','start'],phase,timeout=40);pid=G.private_postmaster(job)
  phase='private-identity';value=G.query(runner,job,"SELECT jsonb_build_object('dataDirectory',current_setting('data_directory'),'socket',current_setting('unix_socket_directories'),'listenAddresses',current_setting('listen_addresses'),'port',current_setting('port'),'checksums',current_setting('data_checksums'),'readOnly',current_setting('default_transaction_read_only'),'systemIdentifier',(SELECT system_identifier::text FROM pg_control_system()),'tablespaces',(SELECT count(*) FROM pg_tablespace WHERE pg_tablespace_location(oid)<>''));",phase,'postgres');expected=dict(dataDirectory=str(job/'cluster'),socket=str(job/'socket'),listenAddresses='',port='55432',checksums='on',readOnly='on',systemIdentifier=v['sourceControl']['systemIdentifier'],tablespaces=0);need(value==expected and G.query(runner,job,I.FENCE_SQL,'stream-saved-fence')==v['snapshot'],'Private identity/saved fence differs');G.durable(work/'private-identity.json',dict(settings=value,privatePostmasterIdentity=pid))
  phase='phase4-body-readiness-rehearsal';body=body_rehearsal(runner,job,package,p,work,v);phase='stream-native-prototype';result=native_sample(runner,job,package,v,work);G.durable(work/'native-byte-equivalence.json',result);phase='private-stop';G.stop_private(job,pid);pid=None;stopped_control=I.source_stopped(job,v['previousUnit']);si,_=I.read_json(package/'sealed-logical-inventory.json',SOURCE_INV_SHA,limit=64*1024**2,root_authority=True);I.verify_source(si,heartbeat,rehash=True);need(stopped_control['systemIdentifier']==v['sourceControl']['systemIdentifier'],'Stopped private system ID changed');unchanged(v);G.check_live(p);runtime(p);checked_package(p);need(G.metadata(G.LOCK)==p['backupLock'],'Lock pathname changed');storage=G.storage_sample(job);watch.stop();watch=None
  G.durable(work/'completed.json',dict(schema='pow-audit30-private-stream-followup-completed-v1',status='passed',planSha256=h,previousInspectionEvidenceUnchanged=True,previousInspectionStatus='passed'if v['priorAdmission']['kind']=='passed-inspection'else'failed',previousBodyInverseAccepted=v['priorAdmission']['priorBodyInverseAccepted'],previousEagerPrototypeAccepted=v['priorAdmission']['priorEagerPrototypeAccepted'],sealedSourceFullHashVerifiedBeforeStart=True,sealedSourceFullHashVerifiedAtStop=True,sourceContextAndSavedFenceUnchanged=True,fullNativeByteEquality=True,privateClusterStopped=True,liveServicesUnchanged=True,productionDatabaseMutation=False,sealedSourceStarted=False,mathAccepted=False,allHistoricalReplay=False,resultSha256=G.hash_file(work/'native-byte-equivalence.json'),bodyRehearsal=body,bodyAccepted=True,storage=storage))
 except BaseException as exc:
  for s in previous:signal.signal(s,signal.SIG_IGN)
  errors=[];stopped=False
  if start_attempted:
   try:G.stop_private(job,pid);stopped=True
   except BaseException as e:errors.append(dict(phase='private-stop',errorClass=type(e).__name__))
  if watch:
   try:watch.stop()
   except BaseException as e:errors.append(dict(phase='watchdog-stop',errorClass=type(e).__name__))
  if work.is_dir():G.durable(work/'failed.json',dict(schema='pow-audit30-private-stream-followup-failed-v1',status='failed',phase=phase,errorClass=type(exc).__name__,cleanupErrors=errors,privateStopVerified=stopped,intentCreated=intent,productionDatabaseMutation=False,automaticRetry=False))
  raise
 finally:
  for s,handler in previous.items():signal.signal(s,handler)
  os.close(lock)

def main():
 os.umask(0o077);load();a=argparse.ArgumentParser(description=__doc__);a.add_argument('mode',choices=['inventory','validate-plan','run']);a.add_argument('--job');a.add_argument('--bindings');a.add_argument('--bindings-sha256');a.add_argument('--unit');a.add_argument('--host');a.add_argument('--plan');a.add_argument('--plan-sha256');p=a.parse_args()
 if p.mode=='inventory':
  b,_=I.read_json(p.bindings,p.bindings_sha256,limit=65536,root_authority=True);need(sha(encoded(b))==p.bindings_sha256,'Prior admission must use canonical compact raw bytes');sys.stdout.buffer.write(encoded(collect_inventory(p.job,b,p.unit,p.host)));return
 value=read_plan(p.plan,p.plan_sha256,p.mode=='run')
 if p.mode=='run':execute(value,p.plan_sha256)
 else:print(json.dumps(dict(status='valid-proposal',productionExecuted=False,planSha256=p.plan_sha256),sort_keys=True))
if __name__=='__main__':
 try:main()
 except BaseException as exc:print(json.dumps(dict(status='refused',errorClass=type(exc).__name__,details='Private follow-up refused; stage is preserved without sensitive bytes'),sort_keys=True),file=sys.stderr);sys.exit(1)
