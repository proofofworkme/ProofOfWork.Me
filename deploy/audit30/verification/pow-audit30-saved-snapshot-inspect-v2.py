#!/usr/bin/python3 -I
"""Audit30 stopped saved-snapshot copy and bounded private READ ONLY inspection.

No production connection or service change. A completed isolated restore is
read-only and never restarted; only a new exact job may be copied/started.
All allocations/evidence remain retained. Limits are monitored with sampling
and shutdown latency, not an enforced filesystem quota.
"""
import argparse
import datetime as dt
import fcntl
import hashlib
import json
import os
from pathlib import Path
import pwd
import re
import signal
import stat
import sys
import time
import types

GUARD_SHA='26c7656b2e751c6de50122c65f8af73686c2d2674bee8be86a3c5648b7fcc80e'
APPROVAL_SHA='6821c987b9a5d110fbe9fb2820955b7cbc26dda9faddb67667fc49e892f5c820'
QUERY_PINS={
 'id-before.sql':'b1ccffd27b8330a36f3b072a38c3d66300b31efedde85cdb70b3cb707722d2c0',
 'id-after.sql':'f983ca088f07faeb29d23c46be0e8004ec843f2ed47718fecab0788bb6a1aa47',
 'relational.sql':'635d81afcfdb31c9ad491e32bbaa32607d75f23707d7634ab4d4a7dde9971caa'}
PROTOTYPE_PINS={
 'pow-audit30-transition-private-sql-v3.py':'86e69c9cd6f0b9efe5699d969e197f2e0afcd2efc9e414799baf8cb65ef64cc6',
 'pow-audit30-transition-chunk-prototype.py':'4c08151c0d3cfb5757c0056fef8facf578e57e023bc1bc29f49fdaf7c5e34e9a'}
PHASE4_ENGINE='pow-audit30-mail-body-repair-rehearsal.mjs'
PHASE4_ENGINE_SHA='09b3240e45d76278a67053f5fba6009cccce36b00c1b098d38d7435da978dc58'
NODE=Path('/opt/node-v24.18.0-linux-x64/bin/node')
SCHEMA='pow-audit30-saved-snapshot-inspection-plan-v1'
INVENTORY_SCHEMA='pow-audit30-stopped-cluster-inventory-v1'
RUNTIME=3600
CLEAR_WINDOW=4500
MAX_BYTES=80*1024**3
MAX_ENTRIES=100000
MAX_CAPTURE=64*1024**2
META_KEYS={'device','inode','mode','uid','gid','bytes','mtimeNs','ctimeNs','nlink'}
SHA=re.compile(r'[0-9a-f]{64}\Z')
RUN=re.compile(r'[0-9]{8}T[0-9]{6}Z\Z')
G=None

FENCE_SQL="""SELECT jsonb_build_object(
 'canonicalBlock',(SELECT jsonb_build_object('height',height,'hash',block_hash) FROM proof_indexer.blocks WHERE network='livenet' AND canonical ORDER BY height DESC LIMIT 1),
 'confirmedTransactionMaxHeight',(SELECT max(block_height) FROM proof_indexer.transactions WHERE network='livenet' AND status='confirmed'),
 'transitionMaxHeight',(SELECT max(block_height) FROM proof_indexer.work_amo_block_transitions WHERE network='livenet'),
 'transitionMaxHash',(SELECT block_hash FROM proof_indexer.work_amo_block_transitions WHERE network='livenet' ORDER BY block_height DESC LIMIT 1),
 'precisionMarkerStatus',(SELECT value->>'status' FROM proof_indexer.meta WHERE key='workPrecisionV2Migration:livenet'),
 'precisionActivationHeight',(SELECT value->>'activationHeight' FROM proof_indexer.meta WHERE key='workPrecisionV2Migration:livenet'));"""
SAMPLE_SQL="""BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout='120s'; SET LOCAL lock_timeout='3s'; SET LOCAL temp_file_limit='64MB';
COPY (SELECT network,block_height,block_hash,previous_block_hash,
 opening_state_sha256,closing_state_sha256,opening_network_value_q8::text,
 closing_network_value_q8::text,raw_protocol_candidate_count,payload
 FROM proof_indexer.work_amo_block_transitions WHERE network='livenet'
 ORDER BY block_height DESC LIMIT 4) TO STDOUT;
COMMIT;"""
PROTOTYPE_CONTEXT_SQL="""SELECT jsonb_build_object(
 'columns',(SELECT jsonb_agg(jsonb_build_object('name',attname,'typeOid',atttypid::integer,'typeName',format_type(atttypid,atttypmod)) ORDER BY attnum) FROM pg_attribute WHERE attrelid='proof_indexer.work_amo_block_transitions'::regclass AND attnum>0 AND NOT attisdropped),
 'sampleRows',(SELECT jsonb_agg(jsonb_build_object('height',block_height,'hash',block_hash) ORDER BY block_height) FROM proof_indexer.work_amo_block_transitions WHERE network='livenet' AND block_height IN (960600,960601,(SELECT max(block_height) FROM proof_indexer.work_amo_block_transitions WHERE network='livenet'))),
 'markerSha256',(SELECT encode(sha256(jsonb_send(value)),'hex') FROM proof_indexer.meta WHERE key='workPrecisionV2Migration:livenet'),
 'originalTriggers',(SELECT jsonb_agg(jsonb_build_object('table',tgrelid::regclass::text,'name',tgname,'enabled',tgenabled,'definition',pg_get_triggerdef(oid),'functionDefinition',pg_get_functiondef(tgfoid)) ORDER BY tgrelid::regclass::text,tgname) FROM pg_trigger WHERE (tgrelid='proof_indexer.work_amo_block_transitions'::regclass AND tgname='work_amo_block_transitions_immutable') OR (tgrelid='proof_indexer.meta'::regclass AND tgname='work_precision_v2_marker_immutable')));"""

def encoded(x):return json.dumps(x,sort_keys=True,separators=(',',':')).encode()
def digest(x):return hashlib.sha256(encoded(x)).hexdigest()
def utc():return dt.datetime.now(dt.timezone.utc).isoformat()
def pairs(rows):
 out={}
 for k,v in rows:
  if k in out:raise ValueError('Duplicate JSON key')
  out[k]=v
 return out

def load_guard(path=None):
 global G
 path=Path(path) if path else Path(__file__).parent/'restore-latest-logical.py'
 if path.resolve(strict=True)!=path or path.is_symlink():raise ValueError('Noncanonical guard')
 identity=lambda s:(s.st_dev,s.st_ino,s.st_mode,s.st_uid,s.st_gid,s.st_nlink,s.st_size,s.st_mtime_ns,s.st_ctime_ns)
 before=identity(path.stat())
 raw=path.read_bytes()
 if len(raw)>1024**2 or hashlib.sha256(raw).hexdigest()!=GUARD_SHA or identity(path.stat())!=before:raise ValueError('Frozen guard bytes changed')
 # Execute exactly the verified bytes, rather than reopening a module path.
 G=types.ModuleType('audit30_frozen_guard');G.__file__=str(path)
 exec(compile(raw,str(path),'exec'),G.__dict__)
 if hashlib.sha256(path.read_bytes()).hexdigest()!=GUARD_SHA or identity(path.stat())!=before:raise ValueError('Guard changed during import')
 return G

def read_json(path,sha,limit=64*1024**2,root_authority=False):
 p=G.canonical_path(path);m=G.metadata(p)
 if not stat.S_ISREG(p.lstat().st_mode) or m['nlink']!=1 or m['mode']&0o7022 or m['bytes']>limit or not SHA.fullmatch(sha):raise ValueError('Unsafe bounded JSON')
 if root_authority and (m['uid']!=0 or m['gid']!=pwd.getpwnam('postgres').pw_gid or m['mode']!=0o440):raise ValueError('Unsafe private root authority')
 # Root-owned package is immutable in the strict unit. PG lacks CAP_FOWNER.
 if G.hash_file(p,m|{'sha256':sha},limit,no_atime=not root_authority)!=sha:raise ValueError('JSON binding changed')
 raw=p.read_bytes()
 if G.metadata(p)!=m or hashlib.sha256(raw).hexdigest()!=sha:raise ValueError('JSON read changed')
 return json.loads(raw,object_pairs_hook=pairs),m

def safe_rel(value):
 if value=='.':return value
 if not isinstance(value,str) or not value or value.startswith('/') or any(x in ('','.', '..') for x in value.split('/')) or '\\' in value or '\x00' in value:raise ValueError('Unsafe inventory relative path')
 return value

def valid_meta(m,uid,gid,kind):
 if set(m)!=META_KEYS or any(type(m[k]) is not int or m[k]<0 for k in META_KEYS):raise ValueError('Malformed identity tuple')
 if m['uid']!=uid or m['gid']!=gid or m['mode']!=(0o700 if kind=='directory' else 0o600) or (kind=='file' and m['nlink']!=1):raise ValueError('Unsafe cluster identity')

def source_stopped(source,unit):
 cluster=G.canonical_path(Path(source)/'cluster')
 for name in ('postmaster.pid','standby.signal','recovery.signal','backup_label','tablespace_map'):
  if os.path.lexists(cluster/name):raise ValueError('Source is running or has recovery/tablespace state')
 if os.path.lexists(Path(source)/'socket'/'.s.PGSQL.55432'):raise ValueError('Sealed source socket remains')
 if (cluster/'pg_tblspc').is_symlink() or not (cluster/'pg_tblspc').is_dir() or list((cluster/'pg_tblspc').iterdir()):raise ValueError('Source has tablespace dependencies')
 p=G.system_properties(unit,['LoadState','ActiveState','MainPID','SubState'])
 if set(p)!={'LoadState','ActiveState','MainPID','SubState'} or p['LoadState'] not in ('loaded','not-found') or p.get('ActiveState')!='inactive' or p.get('SubState')!='dead' or p.get('MainPID')!='0':raise ValueError('Source restore unit is not explicitly stopped/qualified absent')
 # An inactive unit alone cannot rule out an independently launched server.
 count=0
 for proc in Path('/proc').iterdir():
  if not proc.name.isdigit():continue
  count+=1
  if count>32768:raise ValueError('Source process census bound')
  try:
   with (proc/'cmdline').open('rb') as f:raw=f.read(1024**2+1)
   if len(raw)>1024**2:raise ValueError('Source process command bound')
   argv=raw.split(b'\0')
  except (FileNotFoundError,ProcessLookupError):continue
  except PermissionError:raise ValueError('Source process census inaccessible')
  if any(argv[i:i+2]==[b'-D',str(cluster).encode()] for i in range(len(argv)-1)):raise ValueError('Source postmaster process remains')
 raw=G.command([str(G.BIN/'pg_controldata'),str(cluster)],maximum=65536,timeout=30)
 lines={k.strip():v.strip() for row in raw.decode().splitlines() if ':' in row for k,v in [row.split(':',1)]}
 if lines.get('Database cluster state')!='shut down' or lines.get('Data page checksum version')!='1' or not re.fullmatch(r'[0-9]+',lines.get('Database system identifier','')):raise ValueError('Source is not stopped checksummed PG16 data')
 version=cluster/'PG_VERSION'
 if version.is_symlink() or version.stat().st_size!=3 or version.read_bytes()!=b'16\n':raise ValueError('Source PostgreSQL major differs')
 auto=cluster/'postgresql.auto.conf'
 if auto.is_symlink() or auto.stat().st_size>65536 or any(line.strip() and not line.lstrip().startswith('#') for line in auto.read_text().splitlines()):raise ValueError('Source automatic settings can override isolation')
 return dict(systemIdentifier=lines['Database system identifier'],controlOutputSha256=hashlib.sha256(raw).hexdigest(),state=lines['Database cluster state'],checksums='1',unit=p)

def inventory_tree(cluster,uid,gid,heartbeat=None,expected=None,copy_to=None):
 cluster=G.canonical_path(cluster);base_dev=cluster.stat().st_dev
 if copy_to is not None:
  copy_to=G.canonical_path(copy_to)
  if any(copy_to.iterdir()) or copy_to.stat().st_dev!=base_dev:raise ValueError('Copy target must be empty same-filesystem directory')
 rows=[];total=0;expected_map={r['path']:r for r in expected} if expected is not None else None
 def visit(p,rel):
  nonlocal total
  if heartbeat:heartbeat()
  safe_rel(rel);before=G.metadata(p);s=p.lstat()
  kind='directory' if stat.S_ISDIR(s.st_mode) else 'file' if stat.S_ISREG(s.st_mode) else None
  if not kind or s.st_dev!=base_dev or os.listxattr(p,follow_symlinks=False):raise ValueError('Source symlink/special/mount/xattr refused')
  valid_meta(before,uid,gid,kind)
  if len(rows)>=MAX_ENTRIES:raise ValueError('Cluster entry bound')
  row=dict(path=rel,kind=kind,metadata=before)
  if kind=='file':
   total+=before['bytes']
   if total>MAX_BYTES:raise ValueError('Cluster byte bound')
   h=hashlib.sha256();target=None
   fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW|os.O_NOATIME)
   with os.fdopen(fd,'rb') as src:
    if G.metadata(p)!=before:raise ValueError('Source file changed before read')
    if copy_to is not None:
     target=copy_to/rel;outfd=os.open(target,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
     dst=os.fdopen(outfd,'wb')
    try:
     while raw:=src.read(1024**2):
      if heartbeat:heartbeat()
      h.update(raw)
      if target is not None:dst.write(raw)
     if target is not None:dst.flush();os.fsync(dst.fileno())
    finally:
     if target is not None:dst.close()
   row['sha256']=h.hexdigest()
   if target is not None:
    os.utime(target,ns=(before['mtimeNs'],before['mtimeNs']),follow_symlinks=False)
    syncfd=os.open(target,os.O_RDONLY|os.O_NOFOLLOW)
    try:os.fsync(syncfd)
    finally:os.close(syncfd)
    tm=G.metadata(target);valid_meta(tm,uid,gid,'file')
    if tm['bytes']!=before['bytes'] or tm['mtimeNs']!=before['mtimeNs'] or os.listxattr(target,follow_symlinks=False):raise ValueError('Copied file metadata differs')
  rows.append(row)
  if expected_map is not None and expected_map.get(rel)!=row:raise ValueError('Frozen source inventory differs')
  if kind=='directory':
   names=sorted(os.listdir(p))
   if copy_to is not None and rel!='.':(copy_to/rel).mkdir(mode=0o700)
   for name in names:visit(p/name,name if rel=='.' else rel+'/'+name)
   if sorted(os.listdir(p))!=names:raise ValueError('Source directory inventory changed')
   if copy_to is not None:
    dest=copy_to if rel=='.' else copy_to/rel
    os.utime(dest,ns=(before['mtimeNs'],before['mtimeNs']),follow_symlinks=False)
    syncfd=os.open(dest,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
    try:os.fsync(syncfd)
    finally:os.close(syncfd)
  if G.metadata(p)!=before:raise ValueError('Source metadata changed during traversal')
 visit(cluster,'.')
 rows.sort(key=lambda r:r['path'])
 # A file already read can change while a later sibling is processed. Fence
 # the whole completed tree, rather than only each file's local read window.
 for row in rows:
  p=cluster if row['path']=='.' else cluster/row['path']
  if G.metadata(p)!=row['metadata'] or os.listxattr(p,follow_symlinks=False):raise ValueError('Source whole-tree metadata changed')
 if expected_map is not None and set(expected_map)!={r['path'] for r in rows}:raise ValueError('Source inventory cardinality changed')
 return dict(records=rows,regularBytes=total,entries=len(rows),recordsSha256=digest(rows))

def validate_inventory(value):
 wanted={'schema','sourceJob','sourceUnit','postgresUid','postgresGid','receiptBindings','sourceControl','snapshot','records','regularBytes','entries','recordsSha256'}
 if set(value)!=wanted or value['schema']!=INVENTORY_SCHEMA or not re.fullmatch(r'/data/proofofwork-audit30-restore-[0-9]{8}T[0-9]{6}Z',value['sourceJob']) or value['sourceUnit']!='proofofwork-audit30-logical-restore-'+value['sourceJob'].rsplit('-',1)[1]+'.service':raise ValueError('Wrong stopped inventory scope')
 dt.datetime.strptime(value['sourceJob'].rsplit('-',1)[1],'%Y%m%dT%H%M%SZ')
 if type(value['postgresUid']) is not int or type(value['postgresGid']) is not int:raise ValueError('Wrong cluster owner')
 if set(value['receiptBindings'])!={'completed.json','table-row-parity.json','offline-page-check.json','saved-snapshot-fence.json'}:raise ValueError('Missing completed source proofs')
 for name,r in value['receiptBindings'].items():
  if set(r)!={'metadata','sha256'} or not SHA.fullmatch(r['sha256']):raise ValueError('Malformed proof binding')
  valid_meta(r['metadata'],value['postgresUid'],value['postgresGid'],'file')
 rows=value['records']
 if not isinstance(rows,list) or not 1<=len(rows)<=MAX_ENTRIES or value['entries']!=len(rows) or rows!=sorted(rows,key=lambda r:r['path']) or len({r['path'] for r in rows})!=len(rows):raise ValueError('Malformed ordered tree inventory')
 bypath={}
 for row in rows:
  if row.get('kind') not in ('file','directory') or set(row)!=({'path','kind','metadata','sha256'} if row.get('kind')=='file' else {'path','kind','metadata'}):raise ValueError('Invalid tree row')
  safe_rel(row['path']);valid_meta(row['metadata'],value['postgresUid'],value['postgresGid'],row['kind'])
  if row['kind']=='file' and not SHA.fullmatch(row['sha256']):raise ValueError('Invalid tree content digest')
  bypath[row['path']]=row
 if bypath.get('.',{}).get('kind')!='directory' or any(r['path']!='.' and bypath.get(str(Path(r['path']).parent),{}).get('kind')!='directory' for r in rows):raise ValueError('Tree parent/type closure missing')
 total=sum(r['metadata']['bytes'] for r in rows if r['kind']=='file')
 if value['regularBytes']!=total or total>MAX_BYTES or digest(rows)!=value['recordsSha256']:raise ValueError('Tree byte/digest closure failed')
 control=value['sourceControl']
 if not isinstance(control,dict) or set(control)!={'systemIdentifier','controlOutputSha256','state','checksums','unit'} or control.get('state')!='shut down' or control.get('checksums')!='1' or not re.fullmatch(r'[0-9]+',control.get('systemIdentifier','')) or not SHA.fullmatch(control['controlOutputSha256']) or control['unit'] not in [dict(LoadState=x,ActiveState='inactive',MainPID='0',SubState='dead') for x in ('loaded','not-found')]:raise ValueError('Stopped source control binding missing')
 snapshot=value['snapshot']
 if not isinstance(snapshot,dict) or set(snapshot)!={'canonicalBlock','confirmedTransactionMaxHeight','transitionMaxHeight','transitionMaxHash','precisionMarkerStatus','precisionActivationHeight'} or snapshot.get('precisionMarkerStatus')!='complete' or snapshot.get('precisionActivationHeight')!='960601':raise ValueError('Source snapshot era missing')
 block=snapshot['canonicalBlock']
 if not isinstance(block,dict) or set(block)!={'height','hash'} or type(block['height']) is not int or block['height']<960601 or not SHA.fullmatch(block['hash']) or type(snapshot['transitionMaxHeight']) is not int or not 960601<=snapshot['transitionMaxHeight']<=block['height'] or not SHA.fullmatch(snapshot['transitionMaxHash']) or type(snapshot['confirmedTransactionMaxHeight']) is not int or not 1<=snapshot['confirmedTransactionMaxHeight']<=block['height']:raise ValueError('Invalid saved checkpoint identity')
 return value

def inventory_capacity(source):
 used=G.allocation(source);data=os.statvfs('/data');root=os.statvfs('/')
 if used>MAX_BYTES or data.f_bavail*data.f_frsize<G.DATA_FLOOR or root.f_bavail*root.f_frsize<G.ROOT_FLOOR:raise ValueError('Read-only inventory capacity reserve refused')
 return dict(sourceJobAllocatedBytes=used,dataAvailableBytes=data.f_bavail*data.f_frsize,rootAvailableBytes=root.f_bavail*root.f_frsize)

def check_inventory_runtime(source,unit,host):
 if not re.fullmatch(r'proofofwork-audit30-snapshot-inventory-[0-9]{8}T[0-9]{6}Z\.service',unit) or os.uname().nodename!=host or os.geteuid()!=pwd.getpwnam('postgres').pw_uid:raise ValueError('Unmanaged read-only inventory identity')
 if not any(row.split(':',2)[-1]=='/system.slice/'+unit for row in Path('/proc/self/cgroup').read_text().splitlines()):raise ValueError('Inventory managed cgroup differs')
 wanted={**G.UNIT_PROPERTIES,'RuntimeMaxUSec':'15min','MemoryHigh':str(768*1024**2),'MemoryMax':str(1024**3),'CPUQuotaPerSecUSec':'250ms','TasksMax':'32','ReadWritePaths':''}
 actual=G.system_properties(unit,[*wanted,'ReadOnlyPaths','InaccessiblePaths'])
 if any(actual.get(k)!=v for k,v in wanted.items()) or set(actual.get('ReadOnlyPaths','').split())!={str(G.BACKUPS),str(source)} or set(actual.get('InaccessiblePaths','').split())!=set(G.UNIT_INACCESSIBLE)|{str(source)+'/socket'}:raise ValueError('Weakened read-only inventory unit')
 if not os.statvfs(source).f_flag&os.ST_RDONLY:raise ValueError('Inventory source mount is not readonly')
 for p in [*G.INACCESSIBLE,str(source)+'/socket']:
  try:os.listdir(p)
  except (PermissionError,FileNotFoundError):continue
  raise ValueError('Inventory production/source socket access')
 return actual

def collect_inventory(source,bindings):
 source=G.canonical_path(source);who=pwd.getpwnam('postgres')
 if not re.fullmatch(r'/data/proofofwork-audit30-restore-[0-9]{8}T[0-9]{6}Z',str(source)):raise ValueError('Only isolated completed restore can be inventoried')
 dt.datetime.strptime(source.name.rsplit('-',1)[1],'%Y%m%dT%H%M%SZ')
 source_unit='proofofwork-audit30-logical-restore-'+source.name.rsplit('-',1)[1]+'.service'
 proofs={};values={};started=time.monotonic();live={}
 for name in G.SERVICES:
  actual=G.system_properties(name,['ActiveState','MainPID','InvocationID'])
  if set(actual)!={'ActiveState','MainPID','InvocationID'} or actual['ActiveState']!='active' or not actual['MainPID'].isdigit() or int(actual['MainPID'])<=0 or not re.fullmatch(r'[0-9a-f]{32}',actual['InvocationID']):raise ValueError('Inventory live baseline unavailable')
  live[name]=actual
 inventory_capacity(source)
 last_sample=started
 def heartbeat():
  nonlocal last_sample
  now=time.monotonic()
  if now-started>900:raise TimeoutError('Read-only inventory 15-minute deadline')
  if now-last_sample>=5:inventory_capacity(source);last_sample=now
 for name,sha in bindings.items():
  value,m=read_json(source/name,sha,limit=8*1024**2)
  valid_meta(m,who.pw_uid,who.pw_gid,'file');proofs[name]=dict(metadata=m,sha256=sha);values[name]=value
 done=values['completed.json']
 if done.get('schema')!='pow-audit30-isolated-logical-restore-completed-v1' or done.get('status')!='passed' or any(done.get(k) is not True for k in ('allTableRowHashParity','amcheckPassed','offlinePrivatePageChecksPassed','privateClusterStopped','liveServicesUnchanged')) or done.get('productionDatabaseMutation') is not False:raise ValueError('Source restore completion is not verified')
 if values['table-row-parity.json'].get('allMatched') is not True or values['offline-page-check.json'].get('returnCode')!=0:raise ValueError('Source parity/page proof is not passed')
 control=source_stopped(source,source_unit);snapshot=values['saved-snapshot-fence.json']['snapshot']
 tree=inventory_tree(source/'cluster',who.pw_uid,who.pw_gid,heartbeat)
 if source_stopped(source,source_unit)!=control:raise ValueError('Source shutdown control changed')
 for name,b in proofs.items():
  if G.hash_file(source/name,b['metadata']|{'sha256':b['sha256']})!=b['sha256']:raise ValueError('Source proof changed')
 heartbeat();inventory_capacity(source)
 if any(G.system_properties(name,['ActiveState','MainPID','InvocationID'])!=actual for name,actual in live.items()):raise ValueError('Live service changed during read-only inventory')
 return validate_inventory(dict(schema=INVENTORY_SCHEMA,sourceJob=str(source),sourceUnit=source_unit,postgresUid=who.pw_uid,postgresGid=who.pw_gid,receiptBindings=proofs,sourceControl=control,snapshot=snapshot,**tree))

def validate_plan(plan):
 keys={'schema','approvalSha256','controllerSha256','guardSha256','host','runId','unit','job','source','inventory','backupLock','backupWindow','liveServices','idPage','phase4'}
 if set(plan)!=keys or plan['schema']!=SCHEMA or plan['approvalSha256']!=APPROVAL_SHA or plan['guardSha256']!=GUARD_SHA or not SHA.fullmatch(plan['controllerSha256']):raise ValueError('Inspection authority mismatch')
 rid=plan['runId']
 if not isinstance(rid,str) or not RUN.fullmatch(rid):raise ValueError('Invalid run ID')
 dt.datetime.strptime(rid,'%Y%m%dT%H%M%SZ')
 if plan['job']!='/data/proofofwork-audit30-inspect-'+rid or plan['unit']!='proofofwork-audit30-snapshot-inspect-'+rid+'.service' or not re.fullmatch(r'[A-Za-z0-9.-]+',plan['host']):raise ValueError('Wrong private inspection identity')
 if not re.fullmatch(r'/data/proofofwork-audit30-restore-[0-9]{8}T[0-9]{6}Z',plan['source']):raise ValueError('Source must be isolated completed restore')
 dt.datetime.strptime(plan['source'].rsplit('-',1)[1],'%Y%m%dT%H%M%SZ')
 if set(plan['inventory'])!={'fileName','sha256'} or plan['inventory']['fileName']!='cluster-inventory.json' or not SHA.fullmatch(plan['inventory']['sha256']):raise ValueError('Inventory package binding differs')
 lock=plan['backupLock']
 if set(lock)!=META_KEYS or any(type(lock[k]) is not int or lock[k]<0 for k in META_KEYS) or lock['mode']!=0o600 or lock['nlink']!=1:raise ValueError('Invalid existing backup lock identity')
 w=plan['backupWindow']
 if set(w)!={'preflightAtUtc','nextScheduledAtUtc'} or any(dt.datetime.fromisoformat(x).utcoffset()!=dt.timedelta(0) for x in w.values()):raise ValueError('Invalid UTC backup window')
 if set(plan['liveServices'])!=set(G.SERVICES):raise ValueError('Wrong live authorities')
 for row in plan['liveServices'].values():
  if set(row)!={'MainPID','InvocationID'} or not str(row['MainPID']).isdigit() or int(row['MainPID'])<=0 or not re.fullmatch(r'[0-9a-f]{32}',row['InvocationID']):raise ValueError('Wrong live identity')
 validate_page(plan['idPage'])
 body=plan['phase4']
 if set(body)!={'privatePlanSha256','dependencyInventorySha256','pgEntrySha256','node'} or any(not SHA.fullmatch(body[k]) for k in ('privatePlanSha256','dependencyInventorySha256','pgEntrySha256')) or set(body['node'])!={'metadata','sha256'} or not SHA.fullmatch(body['node']['sha256']):raise ValueError('Phase4 fixed input/dependency authority missing')
 n=body['node']['metadata']
 if set(n)!=META_KEYS or any(type(n[k]) is not int or n[k]<0 for k in META_KEYS) or n['uid']!=0 or n['mode']!=0o755 or n['nlink']!=1:raise ValueError('Unsafe existing exact Node executable')
 return plan

def validate_page(page):
 if not isinstance(page,dict) or set(page)!={'afterHeight','throughHeight','limit','precisionActivationHeight'} or any(type(v) is not int for v in page.values()) or not 960600<=page['afterHeight']<page['throughHeight'] or page['throughHeight']-page['afterHeight']>2000 or not 1<=page['limit']<=2 or page['precisionActivationHeight']!=960601:raise ValueError('Unbounded/wrong ID query page')
 return page

def check_window(plan,now=None):
 now=now or dt.datetime.now(dt.timezone.utc);w=plan['backupWindow']
 captured=dt.datetime.fromisoformat(w['preflightAtUtc']);deadline=dt.datetime.fromisoformat(w['nextScheduledAtUtc'])
 if not 0<=(now-captured).total_seconds()<=900 or (deadline-now).total_seconds()<CLEAR_WINDOW:raise ValueError('Fresh 75-minute clear backup window required')
 service=G.system_properties('proofofwork-postgres-logical-backup.service',['ActiveState'])
 timer=G.system_properties('proofofwork-postgres-logical-backup.timer',['ActiveState','NextElapseUSecRealtime'])
 actual=dt.datetime.strptime(timer.get('NextElapseUSecRealtime',''),'%a %Y-%m-%d %H:%M:%S %Z').replace(tzinfo=dt.timezone.utc)
 if service.get('ActiveState')!='inactive' or timer.get('ActiveState')!='active' or actual!=deadline:raise ValueError('Logical backup window authority changed')

def check_runtime(plan):
 if os.geteuid()!=pwd.getpwnam('postgres').pw_uid or os.uname().nodename!=plan['host']:raise ValueError('Wrong private execution identity')
 if not any(row.split(':',2)[-1]=='/system.slice/'+plan['unit'] for row in Path('/proc/self/cgroup').read_text().splitlines()):raise ValueError('Unmanaged private inspector')
 wanted={**G.UNIT_PROPERTIES,'RuntimeMaxUSec':'1h','ReadWritePaths':plan['job']}
 actual=G.system_properties(plan['unit'],[*wanted,'ReadOnlyPaths','InaccessiblePaths'])
 if any(actual.get(k)!=v for k,v in wanted.items()) or set(actual.get('ReadOnlyPaths','').split())!={str(G.BACKUPS),plan['source']} or set(actual.get('InaccessiblePaths','').split())!=set(G.UNIT_INACCESSIBLE)|{plan['source']+'/socket'}:raise ValueError('Weakened inspection unit/source namespace')
 for p in [*G.INACCESSIBLE,plan['source']+'/socket']:
  try:os.listdir(p)
  except (PermissionError,FileNotFoundError):continue
  raise ValueError('Production/source socket path is accessible')
 # Namespace readonly source is an actual boundary, not a unit property claim.
 v=os.statvfs(plan['source'])
 if not v.f_flag & os.ST_RDONLY:raise ValueError('Sealed source is not on a readonly mount')
 return actual

def checked_package(plan):
 package=G.canonical_path(Path(__file__).parent);pm=G.metadata(package)
 if pm['uid']!=0 or pm['gid']!=pwd.getpwnam('postgres').pw_gid or pm['mode']!=0o750:raise ValueError('Unsafe private package')
 required={'controller.py':plan['controllerSha256'],'restore-latest-logical.py':GUARD_SHA,**QUERY_PINS,**PROTOTYPE_PINS,PHASE4_ENGINE:PHASE4_ENGINE_SHA,'phase4-private-plan.json':plan['phase4']['privatePlanSha256'],'phase4-pg-dependency-inventory.json':plan['phase4']['dependencyInventorySha256'],'cluster-inventory.json':plan['inventory']['sha256']}
 if Path(__file__).name!='controller.py':raise ValueError('Installed controller path differs')
 for name,sha in required.items():
  p=G.canonical_path(package/name);m=G.metadata(p)
  if m['uid']!=0 or m['gid']!=pwd.getpwnam('postgres').pw_gid or m['mode']!=0o440 or m['nlink']!=1 or not stat.S_ISREG(p.lstat().st_mode):raise ValueError('Unsafe private package member')
  if G.hash_file(p,m|{'sha256':sha},360*1024**2 if name=='phase4-private-plan.json' else 64*1024**2,no_atime=False)!=sha:raise ValueError('Package source bytes changed')
 verify_pg_dependencies(package,plan['phase4'])
 n=plan['phase4']['node']
 if G.hash_file(NODE,n['metadata']|{'sha256':n['sha256']},256*1024**2,no_atime=False)!=n['sha256']:raise ValueError('Existing Node binary changed')
 return package

def verify_pg_dependencies(package,authority):
 manifest,_=read_json(package/'phase4-pg-dependency-inventory.json',authority['dependencyInventorySha256'],root_authority=True)
 if set(manifest)!={'schema','records','regularBytes','entries'} or manifest['schema']!='pow-audit30-private-pg-dependency-inventory-v1' or not isinstance(manifest['records'],list) or not 1<=len(manifest['records'])<=10000 or manifest['entries']!=len(manifest['records']):raise ValueError('Malformed fixed PG dependency manifest')
 rows=manifest['records'];by_path={}
 if rows!=sorted(rows,key=lambda r:r['path']) or len({r['path'] for r in rows})!=len(rows):raise ValueError('PG dependency ordering/duplicates')
 base=G.canonical_path(package/'pg-dependencies');dev=base.stat().st_dev;gid=pwd.getpwnam('postgres').pw_gid;total=0
 for row in rows:
  rel=safe_rel(row['path']);kind=row.get('kind');m=row.get('metadata',{})
  if kind not in ('file','directory') or set(row)!=({'path','kind','metadata','sha256'} if kind=='file' else {'path','kind','metadata'}) or set(m)!=META_KEYS or any(type(m[k]) is not int or m[k]<0 for k in META_KEYS) or m['uid']!=0 or m['gid']!=gid or m['mode']!=(0o440 if kind=='file' else 0o750) or m['device']!=dev or (kind=='file' and (m['nlink']!=1 or not SHA.fullmatch(row['sha256']))):raise ValueError('Unsafe PG dependency identity')
  p=base if rel=='.' else base/rel
  if G.canonical_path(p)!=p or G.metadata(p)!=m or os.listxattr(p,follow_symlinks=False) or not (stat.S_ISREG(p.lstat().st_mode) if kind=='file' else stat.S_ISDIR(p.lstat().st_mode)):raise ValueError('PG dependency type/metadata changed')
  if kind=='file':
   total+=m['bytes']
   if total>64*1024**2:raise ValueError('PG dependency complete closure64MiB bound')
   G.hash_file(p,m|{'sha256':row['sha256']},64*1024**2,no_atime=False)
  by_path[rel]=row
 if by_path.get('.',{}).get('kind')!='directory' or manifest['regularBytes']!=total or by_path.get('pg/lib/index.js',{}).get('sha256')!=authority['pgEntrySha256']:raise ValueError('PG root/entry/digest closure differs')
 for rel,row in by_path.items():
  p=base if rel=='.' else base/rel
  if rel!='.' and by_path.get(str(Path(rel).parent),{}).get('kind')!='directory':raise ValueError('PG dependency parent closure missing')
  if row['kind']=='directory':
   expected={Path(r).name for r in by_path if r!='.' and str(Path(r).parent)==rel}
   if set(os.listdir(p))!=expected:raise ValueError('Unlisted/missing PG dependency')
  if G.metadata(p)!=row['metadata']:raise ValueError('PG dependency whole-tree metadata drift')
 return manifest

def collect_pg_dependencies(base):
 base=G.canonical_path(base);gid=pwd.getpwnam('postgres').pw_gid;dev=base.stat().st_dev;rows=[];total=0
 def visit(p,rel):
  nonlocal total
  s=p.lstat();m=G.metadata(p);kind='directory' if stat.S_ISDIR(s.st_mode) else 'file' if stat.S_ISREG(s.st_mode) else None
  if not kind or m['uid']!=0 or m['gid']!=gid or m['mode']!=(0o750 if kind=='directory' else 0o440) or m['device']!=dev or os.listxattr(p,follow_symlinks=False) or len(rows)>=10000:raise ValueError('Unsafe bounded immutable PG dependency tree')
  row=dict(path=safe_rel(rel),kind=kind,metadata=m)
  if kind=='file':
   if m['nlink']!=1:raise ValueError('PG dependency hardlink')
   total+=m['bytes']
   if total>64*1024**2:raise ValueError('PG dependency complete closure64MiB bound')
   row['sha256']=G.hash_file(p,limit=64*1024**2,no_atime=False)
  rows.append(row)
  if kind=='directory':
   for name in sorted(os.listdir(p)):visit(p/name,name if rel=='.' else rel+'/'+name)
  if G.metadata(p)!=m:raise ValueError('PG dependency changed during inventory')
 visit(base,'.');rows.sort(key=lambda r:r['path'])
 for row in rows:
  p=base if row['path']=='.' else base/row['path']
  if G.metadata(p)!=row['metadata']:raise ValueError('PG dependency whole-tree changed')
 if not any(r['path']=='pg/lib/index.js' and r['kind']=='file' for r in rows):raise ValueError('Fixed PG entry absent')
 return dict(schema='pow-audit30-private-pg-dependency-inventory-v1',records=rows,regularBytes=total,entries=len(rows))

def read_plan(path,sha,credential):
 p=G.canonical_path(path);m=G.metadata(p)
 if not stat.S_ISREG(p.lstat().st_mode) or m['uid']!=0 or m['mode']!=(0o440 if credential else 0o600) or m['nlink']!=1 or m['bytes']>65536 or not SHA.fullmatch(sha):raise ValueError('Unsafe bound inspection plan')
 raw=p.read_bytes()
 if G.metadata(p)!=m or hashlib.sha256(raw).hexdigest()!=sha:raise ValueError('Inspection plan changed')
 plan=validate_plan(json.loads(raw,object_pairs_hook=pairs))
 if credential:
  G.validate_managed_credential(p,plan['unit'],'inspect-plan',Path(__file__).parent/'reviewed-plan.json')
  if G.metadata(p)!=m or hashlib.sha256(p.read_bytes()).hexdigest()!=sha:raise ValueError('Managed inspection plan changed')
 return plan

def copy_equivalence(source_rows,target_rows):
 # Inodes/ctime change by design. Bytes, relative type, privacy, owner, mtime
 # and every file content digest must match the complete preserved source.
 def view(rows):return [dict(path=r['path'],kind=r['kind'],mode=r['metadata']['mode'],uid=r['metadata']['uid'],gid=r['metadata']['gid'],mtimeNs=r['metadata']['mtimeNs'],**({'bytes':r['metadata']['bytes'],'sha256':r['sha256']} if r['kind']=='file' else {})) for r in rows]
 if view(source_rows)!=view(target_rows):raise ValueError('Full pre-start copy equivalence failed')
 return digest(view(source_rows))

def bind_id_body(raw,page):
 # Only the two frozen SQL bodies reach this path. Replace positional tokens
 # with fixed network and validated integer literals, never caller SQL text.
 if hashlib.sha256(raw).hexdigest() not in (QUERY_PINS['id-before.sql'],QUERY_PINS['id-after.sql']):raise ValueError('Unreviewed ID SQL refused')
 validate_page(page)
 values={1:"'livenet'",2:str(page['afterHeight']),3:str(page['throughHeight']),4:str(page['limit']),5:'960601'}
 body=re.sub(r'\$([1-5])(?![0-9])',lambda m:values[int(m[1])],raw.decode())
 if re.search(r'\$[0-9]',body):raise ValueError('Unknown SQL placeholder')
 return body.strip().rstrip(';')

def bind_id_sql(raw,page):
 return ("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY; SET LOCAL statement_timeout='240s'; SET LOCAL lock_timeout='3s'; SET LOCAL temp_file_limit='64MB';\nCOPY (SELECT row_to_json(q)::text FROM ("+bind_id_body(raw,page)+") q) TO STDOUT;\nCOMMIT;\n").encode()

def id_size_profile(runner,job,raw,page,name):
 body=bind_id_body(raw,page)
 measure="WITH measured AS MATERIALIZED (SELECT q.block_height,q.block_hash,octet_length(row_to_json(q)::text)::bigint AS serialized_bytes FROM ("+body+") q) SELECT jsonb_build_object('rows',count(*),'totalJsonBytes',coalesce(sum(serialized_bytes),0)::text,'maximumRowJsonBytes',coalesce(max(serialized_bytes),0)::text,'rowSizes',coalesce(jsonb_agg(jsonb_build_object('height',block_height,'hash',block_hash,'serializedBytes',serialized_bytes) ORDER BY block_height),'[]'::jsonb)) FROM measured"
 prefix="BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY; SET LOCAL statement_timeout='240s'; SET LOCAL lock_timeout='3s'; SET LOCAL temp_file_limit='64MB';\n"
 t=time.monotonic();output=runner.run([*G.psql(job),'-f','-'],name+'-byte-profile',stdin=(prefix+measure+';\nCOMMIT;\n').encode(),timeout=270,maximum=1024**2)
 measurements=json.loads(output,object_pairs_hook=pairs)
 if set(measurements)!={'rows','totalJsonBytes','maximumRowJsonBytes','rowSizes'} or type(measurements['rows']) is not int or not 0<=measurements['rows']<=2 or len(measurements['rowSizes'])!=measurements['rows'] or any(not re.fullmatch(r'[0-9]+',measurements[k]) for k in ('totalJsonBytes','maximumRowJsonBytes')):raise ValueError('Malformed bounded ID byte profile')
 measurement_seconds=time.monotonic()-t
 # Force serialization in the EXPLAIN target, not merely row iteration.
 t=time.monotonic();explain=runner.run([*G.psql(job),'-f','-'],name+'-explain',stdin=(prefix+'EXPLAIN (ANALYZE,BUFFERS,TIMING TRUE,SUMMARY TRUE,FORMAT JSON) '+measure+';\nCOMMIT;\n').encode(),timeout=270,maximum=2*1024**2)
 parsed=json.loads(explain,object_pairs_hook=pairs)
 if not isinstance(parsed,list) or len(parsed)!=1 or 'Plan' not in parsed[0] or 'Execution Time' not in parsed[0]:raise ValueError('Malformed actual ID EXPLAIN profile')
 G.durable(job/(name+'-size-explain-profile.json'),dict(atUtc=utc(),originalSqlSha256=hashlib.sha256(raw).hexdigest(),boundBodySha256=hashlib.sha256(body.encode()).hexdigest(),page=page,measurements=measurements,serializationSeconds=measurement_seconds,actualExplain=parsed,explainSeconds=time.monotonic()-t,fullValuesCaptured=False,qualification='Actual READ ONLY serialized byte lengths and EXPLAIN ANALYZE/BUFFERS for the frozen full SELECT, limited to two rows; no truncation/projection of selected source values in size measurement.'))
 return measurements

def native_size_preflight(runner,job,inventory):
 sql="""BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout='120s'; SET LOCAL lock_timeout='3s'; SET LOCAL temp_file_limit='32MB'; SET LOCAL work_mem='8MB';
SELECT jsonb_build_object('rows',jsonb_agg(jsonb_build_object('height',block_height,'hash',block_hash,'recordSendBytes',octet_length(record_send(t)),'payloadStoredBytes',pg_column_size(payload)) ORDER BY block_height)) FROM proof_indexer.work_amo_block_transitions t WHERE network='livenet' AND block_height IN (960600,960601,(SELECT max(block_height) FROM proof_indexer.work_amo_block_transitions WHERE network='livenet'));
COMMIT;"""
 raw=runner.run([*G.psql(job),'-f','-'],'phase5-exact-row-size-preflight',stdin=sql.encode(),timeout=150,maximum=1024**2);result=json.loads(raw,object_pairs_hook=pairs)
 cp=inventory['snapshot'];rows=result.get('rows')
 if set(result)!={'rows'} or not isinstance(rows,list) or len(rows)!=3 or [r.get('height') for r in rows]!=[960600,960601,cp['transitionMaxHeight']] or rows[-1].get('hash')!=cp['transitionMaxHash'] or any(set(r)!={'height','hash','recordSendBytes','payloadStoredBytes'} or not SHA.fullmatch(r['hash']) or type(r['recordSendBytes']) is not int or r['recordSendBytes']<1 or type(r['payloadStoredBytes']) is not int or r['payloadStoredBytes']<1 for r in rows):raise ValueError('Actual exact sample size metadata malformed')
 over_rows=[r['height'] for r in rows if r['recordSendBytes']+32>32*1024**2];estimated=sum(r['recordSendBytes']+32 for r in rows)
 eligible=not over_rows and estimated<=MAX_CAPTURE
 receipt=dict(atUtc=utc(),rows=rows,recordSendConservativeSourceBytes=estimated,rowCapBytes=32*1024**2,sourceCapBytes=MAX_CAPTURE,oversizeRowHeights=over_rows,eligibleForExactFullSample=eligible,sourceValuesTruncated=False,measurementModel='Actual PostgreSQL record_send full-row bytes+32 per-row conservative binary COPY admission; stored payload size reported separately, without assuming compressed bytes equal serialized bytes.')
 G.durable(job/'phase5-row-size-preflight.json',receipt);return receipt

def capture(runner,job,sql,name,timeout=270):
 output=job/(name+'.copy');h=hashlib.sha256();total=0;rows=0;started=time.monotonic()
 with output.open('xb') as f:
  def sink(row):
   nonlocal total,rows
   raw=row+b'\n';total+=len(raw);rows+=1
   if total>MAX_CAPTURE:raise ValueError('64 MiB inspection capture bound')
   h.update(raw);f.write(raw)
  runner.run([*G.psql(job),'-f','-'],name,stdin=sql,sink=sink,timeout=timeout)
  f.flush();os.fsync(f.fileno())
 receipt=dict(fileName=output.name,sha256=h.hexdigest(),bytes=total,rows=rows,seconds=time.monotonic()-started,sqlSha256=hashlib.sha256(sql).hexdigest())
 G.durable(job/(name+'-capture.json'),receipt);return receipt

class BoundedRunner:
 def __init__(self,job,watcher,started):
  self.inner=G.Runner(job,watcher,started);self.started=started
 def run(self,*args,**kwargs):
  remaining=self.started+RUNTIME-time.monotonic()
  if remaining<=0:raise TimeoutError('Inspector whole-run 60-minute deadline')
  kwargs['timeout']=min(kwargs.get('timeout',3600),remaining)
  return self.inner.run(*args,**kwargs)

class DeadlineRunner:
 def __init__(self,runner,seconds):self.runner=runner;self.deadline=time.monotonic()+seconds
 def run(self,*args,**kwargs):
  left=self.deadline-time.monotonic()
  if left<=0:raise TimeoutError('Private native prototype 120-second wall limit')
  kwargs['timeout']=min(kwargs.get('timeout',120),left)
  return self.runner.run(*args,**kwargs)

def verify_hex_reconstruction(path,source_sha,source_bytes):
 p=G.canonical_path(path);before=G.metadata(p)
 if not stat.S_ISREG(p.lstat().st_mode) or before['mode']!=0o600 or before['uid']!=os.geteuid() or before['nlink']!=1 or before['bytes']!=source_bytes*2+1 or source_bytes>MAX_CAPTURE:raise ValueError('Native hex reconstruction shape differs')
 h=hashlib.sha256();fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW|os.O_NOATIME)
 with os.fdopen(fd,'rb') as f:
  remaining=source_bytes*2
  while remaining:
   raw=f.read(min(1024**2,remaining))
   if not raw or len(raw)%2 or not re.fullmatch(b'[0-9a-f]+',raw):raise ValueError('Native hex reconstruction invalid')
   remaining-=len(raw);h.update(bytes.fromhex(raw.decode('ascii')))
  if f.read(2)!=b'\n':raise ValueError('Native hex reconstruction trailing bytes')
 if h.hexdigest()!=source_sha or G.metadata(p)!=before:raise ValueError('Native reconstructed source differs')
 return h.hexdigest()

def native_prototype(runner,job,package,inventory):
 bounded=DeadlineRunner(runner,120);started=time.monotonic();allocation_before=G.allocation(job)
 context=G.query(bounded,job,PROTOTYPE_CONTEXT_SQL,'phase5-source-context')
 cp=inventory['snapshot'];rows=context['sampleRows']
 if not isinstance(rows,list) or len(rows)!=3 or [r['height'] for r in rows]!=[960600,960601,cp['transitionMaxHeight']] or rows[-1]['hash']!=cp['transitionMaxHash'] or any(set(r)!={'height','hash'} or not SHA.fullmatch(r['hash']) for r in rows) or not SHA.fullmatch(context['markerSha256']) or not context['originalTriggers']:raise ValueError('Exact declaration/activation/latest/marker context missing')
 proto=dict(schema='pow-audit30-private-transition-prototype-plan-v1',privateJob=str(job),privateSocket=str(job/'socket'),privatePort=55432,sourceDatabase='proof_indexer',network='livenet',checkpoint=dict(height=cp['canonicalBlock']['height'],hash=cp['canonicalBlock']['hash'],transitionHeight=cp['transitionMaxHeight'],transitionHash=cp['transitionMaxHash']),sourceFenceSha256=inventory['receiptBindings']['saved-snapshot-fence.json']['sha256'],sampleRows=rows,columns=context['columns'],precisionMarkerJsonbSendSha256=context['markerSha256'])
 planpath=job/'phase5-prototype-plan.json';G.durable(planpath,proto);plan_sha=G.hash_file(planpath)
 fixed=[ '/usr/bin/prlimit','--as=1073741824','--cpu=120','--','/usr/bin/python3','-I','-B']
 emitter=package/'pow-audit30-transition-private-sql-v3.py';builder=package/'pow-audit30-transition-chunk-prototype.py'
 bounded.run([*fixed,str(emitter),'capture','--plan',str(planpath),'--plan-sha256',plan_sha,'--output',str(job/'phase5-capture.sql')],'phase5-emit-capture')
 capture_sql=job/'phase5-capture.sql'
 if G.metadata(capture_sql)['bytes']>65536:raise ValueError('Fixed capture script grew beyond bound')
 for name in ('capture-context.json','columns.json','checkpoint.json','transitions-source.copy','precision-marker-source.copy','precision-marker-value.json'):
  if os.path.lexists(job/name):raise ValueError('Private prototype output already exists')
 bounded.run([*G.psql(job),'-f',str(capture_sql)],'phase5-native-capture')
 bindings={};limits={'transitions-source.copy':MAX_CAPTURE,'precision-marker-source.copy':MAX_CAPTURE,'precision-marker-value.json':MAX_CAPTURE,'capture-context.json':8*1024**2,'columns.json':65536,'checkpoint.json':65536}
 for name,limit in limits.items():
  p=job/name;m=G.metadata(p)
  if m['mode']!=0o600 or m['uid']!=os.geteuid() or m['nlink']!=1 or m['bytes']>limit:raise ValueError('Private capture shape/byte bound')
  bindings[name]=dict(metadata=m,sha256=G.hash_file(p,limit=limit))
 cols=json.loads((job/'columns.json').read_bytes(),object_pairs_hook=pairs)
 if cols!=context['columns']:raise ValueError('Native captured columns differ')
 payload_index=next((i for i,c in enumerate(cols) if c['name']=='payload' and c['typeOid']==3802),None)
 if payload_index is None:raise ValueError('Native payload column missing')
 bounded.run([*fixed,str(builder),'--source',str(job/'transitions-source.copy'),'--source-sha256',bindings['transitions-source.copy']['sha256'],'--columns',str(job/'columns.json'),'--checkpoint',str(job/'checkpoint.json'),'--payload-index',str(payload_index),'--target',str(job/'phase5-chunks.sqlite'),'--reconstructed',str(job/'phase5-local-reconstructed.copy')],'phase5-build-side')
 if G.hash_file(job/'phase5-local-reconstructed.copy',limit=MAX_CAPTURE)!=bindings['transitions-source.copy']['sha256']:raise ValueError('Local reconstruction differs from preserved capture')
 bounded.run([*fixed,str(emitter),'side','--plan',str(planpath),'--plan-sha256',plan_sha,'--side-store',str(job/'phase5-chunks.sqlite'),'--output',str(job/'phase5-side.sql')],'phase5-emit-side')
 if G.metadata(job/'phase5-side.sql')['bytes']>160*1024**2:raise ValueError('Private side-schema script grew beyond bound')
 for name in ('side-store-measurements.json','side-reconstructed.hex'):
  if os.path.lexists(job/name):raise ValueError('Native side output already exists')
 # This exact emitter body uses BEGIN READ WRITE solely in the NEW clone to
 # create its creation-only side schema. No original table or source config
 # mutation; all source/ID/relational reads remain READ ONLY.
 bounded.run([*G.psql(job),'-f',str(job/'phase5-side.sql')],'phase5-native-side')
 result,m=read_json(job/'side-store-measurements.json',G.hash_file(job/'side-store-measurements.json'),limit=65536)
 original=bindings['transitions-source.copy']
 if any(result.get(k)!=v for k,v in dict(sourceBytes=original['metadata']['bytes'],sourceSha256=original['sha256'],reconstructedBytes=original['metadata']['bytes'],reconstructedSha256=original['sha256']).items()) or type(result.get('schemaTotalBytes')) is not int or not 0<result['schemaTotalBytes']<=128*1024**2:raise ValueError('Native sample reconstruction/storage measurement differs')
 verify_hex_reconstruction(job/'side-reconstructed.hex',original['sha256'],original['metadata']['bytes'])
 after=G.query(bounded,job,PROTOTYPE_CONTEXT_SQL,'phase5-original-context-after')
 if after!=context or G.query(bounded,job,FENCE_SQL,'phase5-snapshot-after')!=cp:raise ValueError('Original rows/marker/trigger/fence context changed')
 for name,b in bindings.items():G.hash_file(job/name,b['metadata']|{'sha256':b['sha256']},limits[name])
 allocation_after=G.allocation(job)
 if allocation_after-allocation_before>512*1024**2 or time.monotonic()-started>120:raise ValueError('Native prototype incremental allocation/wall bound')
 receipt=dict(atUtc=utc(),planSha256=plan_sha,sourceBindings=bindings,scriptPins=PROTOTYPE_PINS,measurements=result,seconds=time.monotonic()-started,allocatedBeforeBytes=allocation_before,allocatedAfterBytes=allocation_after,incrementalAllocatedBytes=allocation_after-allocation_before,completeSampleByteReconstruction=True,originalContextAndSavedFenceUnchanged=True,newPrivateSideSchemaOnly=True,sourceAndCaptureRetained=True,historicalArithmeticAccepted=False,productionMigrationApproved=False)
 G.durable(job/'phase5-native-prototype.json',receipt);return dict(fileName='phase5-native-prototype.json',sha256=G.hash_file(job/'phase5-native-prototype.json'),completeSampleByteReconstruction=True,historicalArithmeticAccepted=False)

def mail_body_rehearsal(runner,job,package,plan):
 checked_package(plan);before=G.allocation(job);started=time.monotonic();bounded=DeadlineRunner(runner,120)
 private,_=read_json(package/'phase4-private-plan.json',plan['phase4']['privatePlanSha256'],limit=360*1024**2,root_authority=True)
 if private.get('schema')!='pow-audit30-mail-body-private-rehearsal-plan-v1' or not SHA.fullmatch(private.get('manifestSHA256','')) or not isinstance(private.get('targets'),list):raise ValueError('Fixed private mail plan shape')
 target_ids=[t['txid'] for t in private['targets']]
 if len(target_ids)>128 or target_ids!=sorted(set(target_ids)) or any(not SHA.fullmatch(x) for x in target_ids):raise ValueError('Fixed private mail target order')
 bounded.run([str(NODE),'--max-old-space-size=128',str(package/PHASE4_ENGINE),str(package/'phase4-private-plan.json'),plan['phase4']['privatePlanSha256'],str(job),str(package/'pg-dependencies'/'pg'/'lib'/'index.js'),plan['phase4']['pgEntrySha256'],'phase4-body-rehearsal-v1'],'phase4-mail-body-private-rehearsal',maximum=1024**2)
 p=job/'phase4-body-rehearsal-v1-completed.json';sha=G.hash_file(p,limit=8*1024**2);receipt,_=read_json(p,sha,limit=8*1024**2)
 expected=dict(schema='pow-audit30-private-mail-body-rehearsal-completed-v1',status='passed',exactInverseBodySqlExercised=True,rollbackAcknowledged=True,privateOriginalRowsRestored=True,allCloneNonbodyAndNontargetRowsUnchanged=True,productionMutation=False,cloneSubsetQualified=True,newCoreReplayClaimed=False)
 if any(receipt.get(k)!=v or type(receipt.get(k)) is not type(v) for k,v in expected.items()) or not SHA.fullmatch(receipt.get('manifestSHA256','')):raise ValueError('Private mail rehearsal did not prove rollback/invariance')
 for key in ('manifestTargetCount','selectedCloneTargetCount','missingCloneCandidateCount'):
  if type(receipt.get(key)) is not int or not 0<=receipt[key]<=128:raise ValueError('Private mail rehearsal counts malformed')
 if receipt['selectedCloneTargetCount']+receipt['missingCloneCandidateCount']!=receipt['manifestTargetCount'] or len(receipt.get('selectedTxids',[]))!=receipt['selectedCloneTargetCount'] or len(receipt.get('missingCloneCandidateTxids',[]))!=receipt['missingCloneCandidateCount']:raise ValueError('Private mail subset qualification missing')
 selected=receipt['selectedTxids'];missing=receipt['missingCloneCandidateTxids']
 if receipt['manifestSHA256']!=private['manifestSHA256'] or receipt['manifestTargetCount']!=len(target_ids) or selected!=sorted(set(selected)) or missing!=sorted(set(missing)) or set(selected)&set(missing) or sorted(selected+missing)!=target_ids:raise ValueError('Private mail receipt plan/partition differs')
 baseline=receipt.get('baselineNativeMailFingerprint')
 if not isinstance(baseline,dict) or set(baseline)!={'count','logical_bytes','sha256'} or type(baseline['count']) is not int or not 0<=baseline['count']<=20000 or not re.fullmatch(r'[0-9]+',baseline['logical_bytes']) or int(baseline['logical_bytes'])>256*1024**2 or not SHA.fullmatch(baseline['sha256']):raise ValueError('Private full-mail rollback fingerprint missing')
 after=G.allocation(job)
 if after-before>512*1024**2 or time.monotonic()-started>120:raise ValueError('Private mail rehearsal allocation/wall cap')
 checked_package(plan)
 G.durable(job/'phase4-rehearsal-adapter.json',dict(atUtc=utc(),engineSha256=PHASE4_ENGINE_SHA,privatePlanSha256=plan['phase4']['privatePlanSha256'],receiptSha256=sha,seconds=time.monotonic()-started,incrementalAllocatedBytes=after-before,qualifiedSnapshotSubset=True,productionApplyApproved=False,rollbackOnly=True))
 return dict(fileName=p.name,sha256=sha,status='passed',rollbackOnly=True,selected=receipt['selectedCloneTargetCount'],missing=receipt['missingCloneCandidateCount'],productionApplyApproved=False)

def verify_source(inventory,heartbeat=None,rehash=True):
 source=Path(inventory['sourceJob']);control=source_stopped(source,inventory['sourceUnit'])
 if control!=inventory['sourceControl']:raise ValueError('Sealed source control/unit changed')
 for name,b in inventory['receiptBindings'].items():
  G.hash_file(source/name,b['metadata']|{'sha256':b['sha256']},8*1024**2,heartbeat=heartbeat)
 if rehash:inventory_tree(source/'cluster',inventory['postgresUid'],inventory['postgresGid'],heartbeat,inventory['records'])
 return control

def acquire_backup_lock(expected,who):
 p=G.canonical_path(G.LOCK)
 if G.metadata(p)!=expected or not stat.S_ISREG(p.lstat().st_mode) or expected['uid']!=who.pw_uid or expected['gid']!=who.pw_gid:raise ValueError('Existing backup lock changed')
 fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW)
 try:
  fcntl.flock(fd,fcntl.LOCK_SH|fcntl.LOCK_NB)
  s=os.fstat(fd);actual=dict(device=s.st_dev,inode=s.st_ino,mode=stat.S_IMODE(s.st_mode),uid=s.st_uid,gid=s.st_gid,bytes=s.st_size,mtimeNs=s.st_mtime_ns,ctimeNs=s.st_ctime_ns,nlink=s.st_nlink)
  if not stat.S_ISREG(s.st_mode) or actual!=expected or G.metadata(p)!=expected:raise ValueError('Opened shared backup lock identity differs')
  return fd
 except BaseException:os.close(fd);raise

def native_rehearsals(runner,job,package,plan,inv,prototype_size,refusals,phase_changed):
 # The independent rollback-only inverse acceptance is durable before any
 # sample exporter failure. It never depends on successful side-schema work.
 phase_changed('phase4-mail-body-rehearsal')
 body_receipt=mail_body_rehearsal(runner,job,package,plan)
 if G.query(runner,job,FENCE_SQL,'post-rehearsal-saved-fence')!=inv['snapshot']:raise ValueError('Saved fence changed after rollback rehearsal')
 G.durable(job/'phase4-before-prototype.json',dict(atUtc=utc(),phase4BodyRehearsal=body_receipt,savedFenceUnchanged=True,phase5PrototypeAttempted=False,productionDatabaseMutation=False))
 phase_changed('phase5-native-prototype')
 if prototype_size['eligibleForExactFullSample']:sample_receipt=native_prototype(runner,job,package,inv)
 else:
  sample_receipt=dict(status='refused',phase='phase5-native-prototype',reason='Exact latest Q16/declaration/activation full sample exceeds immutable32MiB row/64MiB source caps',rowSizeReceiptSha256=G.hash_file(job/'phase5-row-size-preflight.json'),sourceValuesTruncated=False,historicalArithmeticAccepted=False)
  refusals.append(sample_receipt);G.durable(job/'phase5-native-prototype-refusal.json',sample_receipt)
 return body_receipt,sample_receipt

def execute(plan,plan_sha):
 package=checked_package(plan);job=G.canonical_path(plan['job']);who=pwd.getpwnam('postgres')
 if not job.is_dir() or G.metadata(job)['uid']!=who.pw_uid or G.metadata(job)['gid']!=who.pw_gid or G.metadata(job)['mode']!=0o700 or list(job.iterdir()):raise ValueError('Inspector job must be new empty postgres0700')
 check_runtime(plan);G.check_live(plan);check_window(plan)
 inv,_=read_json(package/'cluster-inventory.json',plan['inventory']['sha256'],root_authority=True);validate_inventory(inv)
 if inv['sourceJob']!=plan['source'] or inv['postgresUid']!=who.pw_uid or inv['postgresGid']!=who.pw_gid or plan['idPage']['throughHeight']>min(inv['snapshot']['canonicalBlock']['height'],inv['snapshot']['transitionMaxHeight']):raise ValueError('Source/page exceeds bound saved snapshot')
 # Before creating any evidence verify all cheap sealed-source controls.
 verify_source(inv,rehash=False);G.storage_sample(job,preflight=True)
 lock=acquire_backup_lock(plan['backupLock'],who)
 started=time.monotonic();watcher=None;pid=None;phase='admitted';source_preserved=False
 try:G.durable(job/'intent.json',dict(schema='pow-audit30-private-inspection-intent-v1',atUtc=utc(),planSha256=plan_sha,plan=plan,productionDatabaseMutation=False,sourceClusterMutation=False))
 except BaseException:os.close(lock);raise
 def interrupted(*_):raise InterruptedError('Private inspector interrupted')
 previous={s:signal.signal(s,interrupted) for s in (signal.SIGTERM,signal.SIGINT,signal.SIGHUP)}
 try:
  def sample(p):
   if time.monotonic()>started+RUNTIME:raise TimeoutError('Inspector whole-run 60-minute deadline')
   return G.storage_sample(p)
  watcher=G.Watchdog(job,sample=sample);watcher.start();runner=BoundedRunner(job,watcher,started)
  def heartbeat():
   watcher.assert_alive()
   if time.monotonic()>started+RUNTIME:raise TimeoutError('Inspector whole-run 60-minute deadline')
  phase='copy';(job/'cluster').mkdir(mode=0o700)
  copied=inventory_tree(Path(plan['source'])/'cluster',who.pw_uid,who.pw_gid,heartbeat,inv['records'],job/'cluster')
  target=inventory_tree(job/'cluster',who.pw_uid,who.pw_gid,heartbeat)
  equivalence=copy_equivalence(copied['records'],target['records'])
  verify_source(inv,heartbeat,rehash=False)
  G.durable(job/'pre-start-copy-equivalence.json',dict(atUtc=utc(),sourceInventorySha256=plan['inventory']['sha256'],sourceRecordsSha256=inv['recordsSha256'],sourceRegularBytes=inv['regularBytes'],targetRecordsSha256=target['recordsSha256'],entries=target['entries'],fullCopyContentTypeModeOwnerMtimeEquality=True,copyEquivalenceSha256=equivalence,xattrsEmpty=True,sourceReadOnly=True,inodeAndCtimeEqualityClaimed=False))
  phase='private-configuration';(job/'socket').mkdir(mode=0o700)
  conf=("data_directory = '"+str(job/'cluster')+"'\nhba_file = '"+str(job/'inspection-hba.conf')+"'\nident_file = '"+str(job/'inspection-ident.conf')+"'\nlisten_addresses = ''\nport = 55432\nunix_socket_directories = '"+str(job/'socket')+"'\nunix_socket_permissions = 0700\nshared_buffers = '128MB'\nwork_mem = '16MB'\nmaintenance_work_mem = '128MB'\nmax_connections = 10\nmax_worker_processes = 2\nmax_parallel_workers = 0\narchive_mode = off\narchive_command = ''\nrestore_command = ''\nprimary_conninfo = ''\nprimary_slot_name = ''\nshared_preload_libraries = ''\nlogging_collector = off\ntimezone = 'UTC'\ndefault_transaction_read_only = on\n")
  for name,raw in [('inspection-postgresql.conf',conf),('inspection-hba.conf','local all postgres trust\nlocal all all reject\nhost all all 0.0.0.0/0 reject\nhost all all ::0/0 reject\n'),('inspection-ident.conf','# No identity mappings\n')]:
   with (job/name).open('x') as f:f.write(raw);f.flush();os.fsync(f.fileno())
  phase='private-start';remaining=lambda cap:max(1,min(cap,int(started+RUNTIME-time.monotonic())))
  runner.run([str(G.BIN/'pg_ctl'),'-D',str(job/'cluster'),'-o','-c config_file='+str(job/'inspection-postgresql.conf'),'-l',str(job/'postgres.log'),'-w','-t','30','start'],phase,timeout=remaining(40))
  pid=G.private_postmaster(job)
  phase='private-isolation';identity=G.query(runner,job,"SELECT jsonb_build_object('dataDirectory',current_setting('data_directory'),'socket',current_setting('unix_socket_directories'),'listenAddresses',current_setting('listen_addresses'),'port',current_setting('port'),'checksums',current_setting('data_checksums'),'readOnly',current_setting('default_transaction_read_only'),'systemIdentifier',(SELECT system_identifier::text FROM pg_control_system()),'tablespaces',(SELECT count(*) FROM pg_tablespace WHERE pg_tablespace_location(oid)<>''));",phase,'postgres')
  expected=dict(dataDirectory=str(job/'cluster'),socket=str(job/'socket'),listenAddresses='',port='55432',checksums='on',readOnly='on',systemIdentifier=inv['sourceControl']['systemIdentifier'],tablespaces=0)
  if identity!=expected:raise ValueError('Private copied cluster isolation/system ID differs')
  G.durable(job/'private-start-identity.json',dict(atUtc=utc(),privatePostmasterIdentity=pid,settings=identity,actualUnit=check_runtime(plan)))
  phase='snapshot-fence';fence=G.query(runner,job,FENCE_SQL,phase)
  if fence!=inv['snapshot']:raise ValueError('Clone saved-snapshot fence differs')
  G.durable(job/'saved-snapshot-fence.json',dict(atUtc=utc(),snapshot=fence,sourceEqualsCopy=True,currentLiveTipComparisonClaimed=False))
  phase='id-before-size';before_profile=id_size_profile(runner,job,(package/'id-before.sql').read_bytes(),plan['idPage'],'id-before')
  phase='id-after-size';after_profile=id_size_profile(runner,job,(package/'id-after.sql').read_bytes(),plan['idPage'],'id-after')
  phase='phase5-size';prototype_size=native_size_preflight(runner,job,inv)
  refusals=[]
  def admitted_capture(profile,name):
   nonlocal phase
   # PostgreSQL text COPY doubles backslashes in the serialized JSON. This
   # explicit worst-case bound admits only complete streams, never assumes
   # the JSON byte count equals the escaped COPY byte count.
   conservative=2*int(profile['totalJsonBytes'])+profile['rows']
   if conservative>MAX_CAPTURE:
    refusal=dict(status='refused',phase=name,reason='Complete escaped COPY conservative admission exceeds64MiB cap; actual JSON bytes measured separately',actualJsonBytes=profile['totalJsonBytes'],conservativeCopyBytes=conservative,rows=profile['rows'],capBytes=MAX_CAPTURE,sourceValuesTruncated=False)
    refusals.append(refusal);G.durable(job/(name+'-capture-refusal.json'),refusal);return refusal
   phase=name
   return capture(runner,job,bind_id_sql((package/(name+'.sql')).read_bytes(),plan['idPage']),name,remaining(270))
  before=admitted_capture(before_profile,'id-before');after=admitted_capture(after_profile,'id-after')
  phase='relational';relational=capture(runner,job,(package/'relational.sql').read_bytes(),phase,remaining(300))
  def phase_changed(value):
   nonlocal phase
   phase=value
  body_receipt,sample_receipt=native_rehearsals(runner,job,package,plan,inv,prototype_size,refusals,phase_changed)
  G.durable(job/'query-captures.json',dict(atUtc=utc(),before=before,after=after,relational=relational,phase5Prototype=sample_receipt,phase4BodyRehearsal=body_receipt,sourceSqlPins=QUERY_PINS,projectionParityClaimed=False,historicalTransitionExceptionRequiresMarkerReview=True,qualification='Hash-pinned fixed READ ONLY queries against the copied saved snapshot; creation-only side-schema sample and rollback-only body rehearsal write solely in this NEW private clone. Before/after ID payload projection and full historical arithmetic/replay require separate independent interpretation.'))
  phase='private-stop';G.stop_private(job,pid);pid=None
  phase='sealed-source-final-hash';verify_source(inv,heartbeat,rehash=True);source_preserved=True
  phase='final-fences';heartbeat();final_storage=sample(job);G.check_live(plan);check_runtime(plan);checked_package(plan)
  if G.metadata(G.LOCK)!=plan['backupLock']:raise ValueError('Existing shared backup lock drift')
  if os.path.lexists(job/'cluster'/'postmaster.pid') or os.path.lexists(job/'socket'/'.s.PGSQL.55432'):raise ValueError('New private cluster remains running')
  watcher.stop();watcher=None
  G.durable(job/'completed.json',dict(schema='pow-audit30-private-inspection-completed-v1',atUtc=utc(),planSha256=plan_sha,status='partial' if refusals else 'passed',captureRefusals=refusals,privateClusterStopped=True,sourceClusterUnchanged=True,sourceInventorySha256=plan['inventory']['sha256'],queryCapturesSha256=G.hash_file(job/'query-captures.json'),storage=final_storage,liveServicesUnchanged=True,sourceAndJobRetained=True,productionDatabaseMutation=False,projectionParityClaimed=False,protocolReplayCertified=False))
 except BaseException as e:
  # Ordinary repeated signals cannot interrupt independent cleanup/receipt.
  for s in previous:signal.signal(s,signal.SIG_IGN)
  errors=[];stopped=False
  try:G.stop_private(job,pid);stopped=True
  except BaseException as c:errors.append(dict(phase='private-stop',errorClass=type(c).__name__))
  if watcher:
   try:watcher.stop()
   except BaseException as c:errors.append(dict(phase='watchdog-stop',errorClass=type(c).__name__))
  G.durable(job/'failed.json',dict(schema='pow-audit30-private-inspection-failed-v1',atUtc=utc(),planSha256=plan_sha,status='failed',phase=phase,errorClass=type(e).__name__,cleanupErrors=errors,privateStopVerified=stopped,sourceUnchangedFullHashVerified=source_preserved,sourceAndJobRetained=True,productionDatabaseMutation=False,automaticRetry=False))
  raise
 finally:
  for s,handler in previous.items():signal.signal(s,handler)
  os.close(lock)

def main():
 os.umask(0o077)
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('mode',choices=['inventory','dependency-inventory','validate-plan','run']);p.add_argument('--guard');p.add_argument('--plan');p.add_argument('--plan-sha256');p.add_argument('--source');p.add_argument('--unit');p.add_argument('--host');p.add_argument('--completed-sha256');p.add_argument('--parity-sha256');p.add_argument('--page-check-sha256');p.add_argument('--fence-sha256');a=p.parse_args()
 try:
  load_guard(a.guard)
  if a.mode=='dependency-inventory':
   if os.geteuid()!=0 or not a.source:raise ValueError('Root fixed dependency inventory only')
   sys.stdout.buffer.write(encoded(collect_pg_dependencies(a.source)));return 0
  if a.mode=='inventory':
   if not all((a.source,a.unit,a.host,a.completed_sha256,a.parity_sha256,a.page_check_sha256,a.fence_sha256)):raise ValueError('All completed source proof hashes and bounded managed unit required')
   check_inventory_runtime(a.source,a.unit,a.host)
   inv=collect_inventory(a.source,{'completed.json':a.completed_sha256,'table-row-parity.json':a.parity_sha256,'offline-page-check.json':a.page_check_sha256,'saved-snapshot-fence.json':a.fence_sha256})
   check_inventory_runtime(a.source,a.unit,a.host)
   sys.stdout.buffer.write(encoded(inv));return 0
  if not a.plan or not a.plan_sha256:raise ValueError('Exact plan and raw SHA required')
  plan=read_plan(a.plan,a.plan_sha256,a.mode=='run')
  if a.mode=='run':execute(plan,a.plan_sha256)
  else:print(json.dumps(dict(status='valid',planSha256=a.plan_sha256,productionExecuted=False),sort_keys=True))
  return 0
 except BaseException as e:
  print(json.dumps(dict(status='refused',errorClass=type(e).__name__,reason='Private saved-snapshot admission/execution refused; retained private receipt contains stage, without credential or database contents'),sort_keys=True),file=sys.stderr);return 1

if __name__=='__main__':sys.exit(main())
