#!/usr/bin/python3 -I
"""Gated Audit30 recovery proposals. No expiry, timer, configuration or slot SQL.

Production modes require a new reviewed root-plan credential and exact private
unit. This candidate has not been installed or production accepted. Storage is
monitored, not quota enforced; preserve partial work and its failure receipt.
"""
import argparse
import datetime as dt
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import pwd
import re
import signal
import stat
import subprocess
import sys
import time

ROOT = Path('/data/proofofwork-postgres-recovery-audit30')
BACKUP_LOCK = Path('/data/proofofwork-postgres-backups/logical/.proofofwork-postgres-logical-backup.lock')
BIN = Path('/usr/lib/postgresql/16/bin')
SOCKET = '/run/postgresql'
SLOT = 'pow_audit30_receivewal'
APPLICATION = 'pow_audit30_receivewal'
SCHEMA = 'pow-audit30-production-recovery-proposal-plan-v1'
PHASE_APPROVAL = '6821c987b9a5d110fbe9fb2820955b7cbc26dda9faddb67667fc49e892f5c820'
GIB = 1024**3
BASE_MAX = 80*GIB
WAL_MAX = 32*GIB
DATA_MIN = 100*GIB
ROOT_MIN = 10*GIB
SHA = re.compile(r'[0-9a-f]{64}\Z')
RUN = re.compile(r'[0-9]{8}T[0-9]{6}Z\Z')
ENV = dict(PATH='/usr/bin:/bin', LC_ALL='C', LANG='C', TZ='UTC')
DENIED = ('/var/lib/postgresql', '/data/proofofwork-postgres-tablespaces',
          '/var/backups/postgresql', '-/data/proofofwork-postgres-backups/physical',
          '/etc/proofofwork-api')
PROPERTIES = dict(User='postgres', PrivateNetwork='yes', PrivateTmp='yes',
    PrivateIPC='yes', PrivateDevices='yes', ProtectSystem='strict', ProtectHome='yes',
    NoNewPrivileges='yes', ProtectKernelTunables='yes', ProtectKernelModules='yes',
    ProtectControlGroups='yes', RestrictAddressFamilies='AF_UNIX',
    CapabilityBoundingSet='', AmbientCapabilities='', MemoryHigh=str(1024**3),
    MemoryMax=str(2*1024**3), CPUQuotaPerSecUSec='500ms', CPUWeight='10', IOWeight='10',
    Nice='15', TasksMax='32', KillMode='control-group', Restart='no', Slice='system.slice')
PRESERVED_PATHS = {
 '/etc/postgresql/16/main/conf.d/90-proofofwork-backup.conf',
 '/etc/postgresql/16/main/conf.d/90-proofofwork-observability.conf',
 '/etc/proofofwork-postgres-logical-backup.pins',
 '/usr/lib/systemd/system/pg_basebackup@.service',
 '/usr/lib/systemd/system/pg_basebackup@.timer',
 '/etc/systemd/system/pg_basebackup@16-main.timer.d/override.conf',
 '/usr/lib/systemd/system/pg_compresswal@.service',
 '/usr/lib/systemd/system/pg_compresswal@.timer',
 '/usr/lib/systemd/system/pg_receivewal@.service',
 '/etc/systemd/system/proofofwork-postgres-logical-backup.service',
 '/etc/systemd/system/proofofwork-postgres-logical-backup.timer',
 '/etc/systemd/system/var-backups-postgresql.mount'}


def pairs(rows):
    result = {}
    for k,v in rows:
        if k in result:raise ValueError('Duplicate authority JSON key')
        result[k]=v
    return result


def encoded(value):return json.dumps(value,sort_keys=True,separators=(',',':')).encode()


def identity(s):
    return dict(device=s.st_dev,inode=s.st_ino,mode=stat.S_IMODE(s.st_mode),uid=s.st_uid,
        gid=s.st_gid,nlink=s.st_nlink,bytes=s.st_size,mtimeNs=s.st_mtime_ns,ctimeNs=s.st_ctime_ns)


def meta(p):return identity(Path(p).lstat())


def canonical(p):
    p=Path(p)
    if not p.is_absolute() or p.resolve(strict=True)!=p:raise ValueError('Noncanonical recovery path')
    return p


def safe_file(p, maximum=1024**2, root_owned=False):
    p=canonical(p);before=meta(p)
    if not stat.S_ISREG(p.lstat().st_mode) or before['nlink']!=1 or before['mode']&0o7022 or before['bytes']>maximum or root_owned and before['uid']!=0:
        raise ValueError('Unsafe bounded authority file')
    with os.fdopen(os.open(p,os.O_RDONLY|os.O_NOFOLLOW),'rb') as f:raw=f.read(maximum+1)
    if len(raw)>maximum or meta(p)!=before:raise ValueError('Authority changed during read')
    return raw


def validate_plan(p):
    keys={'schema','phaseApprovalSha256','activationApprovalSha256','activationScope',
      'sourceSha256','guardSha256','runId','host','mode','unit','root','rootIdentity','evidence',
      'systemIdentifier','timeline','walSegmentBytes','tablespaces','protectedFiles',
      'liveServices','backupWindow','backupLock','baseAdmissionLock','initialSlotRestartLsn',
      'slotReservationReceiptSha256'}
    if set(p)!=keys or p['schema']!=SCHEMA or p['phaseApprovalSha256']!=PHASE_APPROVAL or p['activationScope']!='new-audit30-root-slot-wal-one-base-only':raise ValueError('Wrong recovery authority/scope')
    for k in ('activationApprovalSha256','sourceSha256','guardSha256'):
        if not isinstance(p[k],str) or not SHA.fullmatch(p[k]):raise ValueError('Missing reviewed activation/source binding')
    if not SHA.fullmatch(p['slotReservationReceiptSha256']):raise ValueError('Missing creation-only slot receipt binding')
    lsn(p['initialSlotRestartLsn'])
    if not RUN.fullmatch(p['runId']):raise ValueError('Wrong run identity')
    dt.datetime.strptime(p['runId'],'%Y%m%dT%H%M%SZ')
    if p['mode'] not in ('receivewal','basebackup') or p['root']!=str(ROOT):raise ValueError('Wrong recovery root/mode')
    if set(p['rootIdentity'])!={'device','inode','uid','gid','mode'} or any(type(v) is not int or v<0 for v in p['rootIdentity'].values()) or p['rootIdentity']['mode']!=0o700:raise ValueError('Missing new-root inode/ownership binding')
    unit='proofofwork-audit30-receivewal.service' if p['mode']=='receivewal' else 'proofofwork-audit30-basebackup@'+p['runId']+'.service'
    if p['unit']!=unit or p['evidence']!=str(ROOT/'evidence'/(p['mode']+'-'+p['runId'])):raise ValueError('Wrong unit/evidence identity')
    if not re.fullmatch(r'[A-Za-z0-9.-]+',p['host']) or not re.fullmatch(r'[0-9]+',p['systemIdentifier']) or type(p['timeline']) is not int or not 1<=p['timeline']<=0xffffffff:raise ValueError('Wrong cluster identity')
    size=p['walSegmentBytes']
    if type(size) is not int or size<1024**2 or size>1024**3 or size&(size-1):raise ValueError('Wrong WAL segment geometry')
    if not isinstance(p['tablespaces'],list) or len(p['tablespaces'])>32:raise ValueError('Tablespace bound')
    seen=set()
    for t in p['tablespaces']:
        if set(t)!={'oid','path'} or type(t['oid']) is not int or t['oid']<=0 or t['oid'] in seen or not re.fullmatch(r'/data/proofofwork-postgres-tablespaces/[A-Za-z0-9_-]+',t['path']):raise ValueError('Wrong explicit tablespace mapping')
        seen.add(t['oid'])
    if not p['protectedFiles'] or len(p['protectedFiles'])>100:raise ValueError('Missing preserved authority bindings')
    paths=set()
    for f in p['protectedFiles']:
        if set(f)!={'path','sha256','metadata'} or f['path'] in paths or not SHA.fullmatch(f['sha256']) or set(f['metadata'])!=set(meta(Path(__file__))) or any(type(v) is not int or v<0 for v in f['metadata'].values()):raise ValueError('Wrong protected binding')
        paths.add(f['path'])
        if not f['path'].startswith(('/etc/postgresql/16/main/','/etc/systemd/system/','/usr/lib/systemd/system/','/etc/proofofwork-postgres-')):raise ValueError('Unexpected protected authority path')
    if not PRESERVED_PATHS<=paths:raise ValueError('Missing installed cap/logical/native authority bindings')
    services={'bitcoind.service','electrs.service','postgresql@16-main.service','proofofwork-api.service','proofofwork-indexer-worker.service'}
    if set(p['liveServices'])!=services:raise ValueError('Wrong live service baseline')
    for row in p['liveServices'].values():
        if set(row)!={'MainPID','InvocationID'} or not str(row['MainPID']).isdigit() or int(row['MainPID'])<=0 or not re.fullmatch(r'[0-9a-f]{32}',row['InvocationID']):raise ValueError('Wrong live identity')
    if set(p['backupWindow'])!={'preflightAtUtc','nextScheduledAtUtc'}:raise ValueError('Wrong backup scheduling fence')
    for t in p['backupWindow'].values():
        if dt.datetime.fromisoformat(t).utcoffset()!=dt.timedelta(0):raise ValueError('UTC backup fence required')
    for key in ('backupLock','baseAdmissionLock'):
        lock=p[key]
        if p['mode']=='receivewal':
            if lock is not None:raise ValueError('Continuous receiver must not hold backup/admission locks')
        elif not isinstance(lock,dict) or set(lock)!=set(meta(Path(__file__))) or any(type(v) is not int or v<0 for v in lock.values()) or lock['mode']!=0o600 or lock['nlink']!=1:raise ValueError('Missing exact base-job lock binding')
    return p


def command(argv,maximum=1024**2,timeout=30):
    r=subprocess.run(argv,env=ENV,capture_output=True,timeout=timeout)
    if r.returncode or len(r.stdout)>maximum or len(r.stderr)>65536:raise ValueError('Bounded recovery command refused')
    return r.stdout


def props(unit,names):
    raw=command(['/usr/bin/systemctl','show',unit,*sum([['-p',n] for n in names],[])],maximum=65536)
    return dict(line.split('=',1) for line in raw.decode().splitlines() if '=' in line)


def authority_fence(p):
    for f in p['protectedFiles']:
        raw=safe_file(f['path'],root_owned=True)
        if meta(f['path'])!=f['metadata'] or hashlib.sha256(raw).hexdigest()!=f['sha256']:raise ValueError('Preserved production authority drift')
    for unit,expected in p['liveServices'].items():
        actual=props(unit,['MainPID','InvocationID','ActiveState'])
        if actual.get('ActiveState')!='active' or any(str(actual.get(k))!=str(v) for k,v in expected.items()):raise ValueError('Live service identity drift')
    mask=Path('/etc/systemd/system/proofofwork-node-release-prune.timer')
    if not mask.is_symlink() or mask.lstat().st_uid!=0 or os.readlink(mask)!='/dev/null':raise ValueError('Ordinary prune mask changed')
    state=props(mask.name,['LoadState','ActiveState'])
    if state!={'LoadState':'masked','ActiveState':'inactive'}:raise ValueError('Ordinary prune authority changed')


def namespace_fence():
    for raw in DENIED:
        path=raw.lstrip('-')
        try:os.listdir(path)
        except (PermissionError,FileNotFoundError):continue
        raise ValueError('Live physical/native/credential path accessible')


def roots_fence(p,evidence_empty=False):
    who=pwd.getpwnam('postgres');root=canonical(ROOT)
    if {k:meta(root)[k] for k in p['rootIdentity']}!=p['rootIdentity']:raise ValueError('New recovery root inode/authority changed')
    paths=[root,root/'wal',root/'bases',root/'evidence',canonical(p['evidence'])]
    for d in paths:
        if not d.is_dir() or meta(d)['uid']!=who.pw_uid or meta(d)['gid']!=who.pw_gid or meta(d)['mode']!=0o700 or d.stat().st_dev!=root.stat().st_dev:raise ValueError('Unsafe/private recovery directory')
    mountlines=Path('/proc/self/mountinfo').read_text().splitlines()
    for line in mountlines:
        part=line.split()
        # ProtectSystem/ReadWritePaths legitimately bind the exact root into
        # the private namespace. Its approved host-census inode is still exact.
        # No child mount or alias may substitute another allocation domain.
        if len(part)>5 and part[4].startswith(str(root)+'/'):raise ValueError('Recovery root has nested mount')
    legacy=Path('/var/backups/postgresql')
    try:
        if (legacy.stat().st_dev,legacy.stat().st_ino)==(root.stat().st_dev,root.stat().st_ino):raise ValueError('Recovery root aliases native root')
    except PermissionError:pass
    if evidence_empty and list(Path(p['evidence']).iterdir()):raise ValueError('Evidence is not a new empty job')
    namespace_fence()


def runtime_fence(p):
    if os.geteuid()!=pwd.getpwnam('postgres').pw_uid or os.uname().nodename!=p['host'] or '/system.slice/'+p['unit'] not in Path('/proc/self/cgroup').read_text().splitlines()[0]:raise ValueError('Unmanaged recovery execution')
    desired={**PROPERTIES,'ReadWritePaths':str(ROOT),'ReadOnlyPaths':SOCKET,
             'RuntimeMaxUSec':'2h' if p['mode']=='basebackup' else 'infinity'}
    actual=props(p['unit'],[*desired,'InaccessiblePaths'])
    if any(actual.get(k)!=v for k,v in desired.items()) or set(actual.get('InaccessiblePaths','').split())!=set(DENIED):raise ValueError('Weakened recovery unit')
    namespace_fence()


def read_plan(path,sha,credential=True):
    if not SHA.fullmatch(sha):raise ValueError('Reviewed raw plan SHA required')
    raw=safe_file(path,maximum=65536,root_owned=not credential)
    p=validate_plan(json.loads(raw,object_pairs_hook=pairs));m=meta(path)
    if hashlib.sha256(raw).hexdigest()!=sha or m['uid']!=0 or m['gid']!=0 or m['mode']!=(0o440 if credential else 0o600):raise ValueError('Untrusted plan bytes/mode/owner')
    if credential and str(path)!='/run/credentials/'+p['unit']+'/recovery-plan':raise ValueError('Wrong credential path')
    if credential:
        guard=load_guard(p)
        guard.validate_managed_credential(path,p['unit'],'recovery-plan',Path(__file__).parent/'reviewed-plan.json')
        if meta(path)!=m or hashlib.sha256(safe_file(path,maximum=65536)).hexdigest()!=sha:raise ValueError('Credential changed during managed attestation')
    return p


def load_guard(p):
    for path,key in [(Path(__file__),'sourceSha256'),(Path(__file__).parent/'restore-latest-logical.py','guardSha256')]:
        raw=safe_file(path,root_owned=True)
        if meta(path.parent)['uid']!=0 or meta(path.parent)['mode']&0o7022 or hashlib.sha256(raw).hexdigest()!=p[key]:raise ValueError('Recovery package/source authority drift')
    s=importlib.util.spec_from_file_location('audit30_recovery_guard',Path(__file__).parent/'restore-latest-logical.py')
    g=importlib.util.module_from_spec(s);s.loader.exec_module(g);return g


def live_query(sql):
    raw=command([str(BIN/'psql'),'-X','-qAt','-v','ON_ERROR_STOP=1','-h',SOCKET,'-p','5432','-U','postgres','-d','postgres','-c',"BEGIN READ ONLY; SET LOCAL statement_timeout='10s'; "+sql+'; COMMIT;'])
    return json.loads(raw,object_pairs_hook=pairs)


def lsn(value):
    if not isinstance(value,str) or not re.fullmatch('[0-9A-F]+/[0-9A-F]+',value):raise ValueError('Invalid LSN')
    a,b=value.split('/')
    if int(a,16)>0xffffffff or int(b,16)>0xffffffff:raise ValueError('LSN overflow')
    return int(a,16)*2**32+int(b,16)


def cluster_fence(p,require_receiver=False):
    row=live_query("SELECT jsonb_build_object('systemIdentifier',(SELECT system_identifier::text FROM pg_control_system()),'timeline',(SELECT timeline_id FROM pg_control_checkpoint()),'segmentBytes',pg_size_bytes(current_setting('wal_segment_size')),'walLevel',current_setting('wal_level'),'slotCapMB',current_setting('max_slot_wal_keep_size'),'archiveMode',current_setting('archive_mode'),'synchronousNames',current_setting('synchronous_standby_names'),'tablespaces',(SELECT coalesce(jsonb_agg(jsonb_build_object('oid',oid,'path',pg_tablespace_location(oid)) ORDER BY oid),'[]'::jsonb) FROM pg_tablespace WHERE pg_tablespace_location(oid)<>''),'slot',(SELECT row_to_json(s) FROM (SELECT slot_type,temporary,active,active_pid,restart_lsn::text,wal_status,safe_wal_size FROM pg_replication_slots WHERE slot_name='"+SLOT+"') s),'receiver',(SELECT row_to_json(r) FROM (SELECT application_name,client_addr::text,state,flush_lsn::text,reply_time,extract(epoch FROM clock_timestamp()-reply_time) replyAgeSeconds FROM pg_stat_replication WHERE pid=(SELECT active_pid FROM pg_replication_slots WHERE slot_name='"+SLOT+"')) r),'primaryFlushLsn',pg_current_wal_flush_lsn()::text)")
    if any(row[k]!=p[v] for k,v in [('systemIdentifier','systemIdentifier'),('timeline','timeline'),('segmentBytes','walSegmentBytes')]) or row['walLevel']!='replica' or row['slotCapMB']!='16384' or row['archiveMode']!='off' or sorted(row['tablespaces'],key=lambda x:x['oid'])!=sorted(p['tablespaces'],key=lambda x:x['oid']):raise ValueError('Production recovery configuration/identity drift')
    # Never change primary commit requirements or join a synchronous quorum.
    if APPLICATION in row['synchronousNames'] or '*' in row['synchronousNames']:raise ValueError('Receiver could become synchronous primary dependency')
    s=row['slot']
    if not s or s['slot_type']!='physical' or s['temporary'] or s['wal_status'] not in ('reserved','extended') or not s['restart_lsn'] or s['safe_wal_size'] is None or s['safe_wal_size']<=0:raise ValueError('Dedicated reserved slot unavailable/invalidated')
    if lsn(s['restart_lsn'])<lsn(p['initialSlotRestartLsn']):raise ValueError('Dedicated slot regressed before its frozen reservation')
    lsn(row['primaryFlushLsn'])
    if require_receiver:
        r=row['receiver']
        if not s['active'] or not r or r['application_name']!=APPLICATION or r['client_addr'] is not None or r['state']!='streaming' or not r['flush_lsn'] or r['replyAgeSeconds'] is None or r['replyAgeSeconds']>30:raise ValueError('WAL receiver is not freshly durably streaming')
        if lsn(r['flush_lsn'])>lsn(row['primaryFlushLsn']):raise ValueError('Receiver flush ahead of primary')
    return row


def bounded_allocation(path):return int(command(['/usr/bin/du','-x','-s','-B1','--',str(path)],maximum=65536,timeout=20).split()[0])


def storage(p,admission=False,require_receiver=False):
    roots_fence(p);authority_fence(p)
    base=bounded_allocation(ROOT/'bases');wal=bounded_allocation(ROOT/'wal');total=bounded_allocation(ROOT)
    data=os.statvfs('/data');live=os.statvfs('/')
    available=data.f_bavail*data.f_frsize;root_available=live.f_bavail*live.f_frsize
    if base>BASE_MAX or wal>WAL_MAX or total>BASE_MAX+WAL_MAX+GIB or available<DATA_MIN+(BASE_MAX+WAL_MAX if admission else 0) or root_available<ROOT_MIN:raise ValueError('Monitored recovery allocation/reserve exceeded')
    observed=cluster_fence(p,require_receiver)
    archive=wal_inventory(p)
    continuity=closed_coverage(p,observed,archive) if require_receiver else dict(qualification='Receiver not yet admitted; no continuity assertion')
    return dict(atUtc=dt.datetime.now(dt.timezone.utc).isoformat(),baseAllocatedBytes=base,
       walAllocatedBytes=wal,totalAllocatedBytes=total,dataAvailableBytes=available,
       rootAvailableBytes=root_available,cluster=observed,closedWalContinuity=continuity)


def receiver_argv():
    return [str(BIN/'pg_receivewal'),'--dbname=host='+SOCKET+' port=5432 user=postgres application_name='+APPLICATION,
       '--directory='+str(ROOT/'wal'),'--slot='+SLOT,'--synchronous','--no-loop','--no-password','--status-interval=5']


def base_argv(p):
    base=ROOT/'bases'/p['runId']
    args=[str(BIN/'pg_basebackup'),'-h',SOCKET,'-p','5432','-U','postgres','--pgdata='+str(base/'cluster'),
      '--format=plain','--wal-method=stream','--checkpoint=spread','--max-rate=20M',
      '--manifest-checksums=SHA256','--no-clean','--no-password','--label=audit30-'+p['runId']]
    # Plain backups otherwise place live tablespaces at production absolute paths.
    args += ['--tablespace-mapping='+t['path']+'='+str(base/'tablespaces'/str(t['oid'])) for t in p['tablespaces']]
    return args


def segment_name(number,timeline,size):
    if type(number) is not int or number<0 or type(timeline) is not int or not 1<=timeline<=0xffffffff or type(size) is not int or size<1024**2 or size>1024**3 or size&(size-1):raise ValueError('Invalid WAL segment geometry')
    per_log=2**32//size
    return f'{timeline:08X}{number//per_log:08X}{number%per_log:08X}'


def coverage(files,start,end,timeline,size):
    """Only complete fsynced-size segments; .partial never certifies a target."""
    first=lsn(start)//size;last=lsn(end)//size
    if lsn(end)<lsn(start) or last-first>100000:raise ValueError('WAL range bound/order')
    wanted=[segment_name(i,timeline,size) for i in range(first,last+1)]
    for name in wanted:
        if files.get(name)!=size:raise ValueError('Missing/truncated/wrong-timeline target WAL')
    return dict(startLsn=start,targetLsn=end,timeline=timeline,completeSegments=len(wanted),
      segmentNamesSha256=hashlib.sha256(encoded(wanted)).hexdigest(),partialSegmentsAccepted=False)


def wal_inventory(p):
    """Bounded metadata census, not a payload checksum certification."""
    directory=ROOT/'wal';who=pwd.getpwnam('postgres');size=p['walSegmentBytes']
    for _ in range(3):
        try:
            names={f.name for f in directory.iterdir()}
            if len(names)>100000:raise ValueError('WAL inventory entry bound')
            records={};complete={}
            for name in sorted(names):
                f=canonical(directory/name);m=meta(f)
                if not stat.S_ISREG(f.lstat().st_mode) or m['uid']!=who.pw_uid or m['gid']!=who.pw_gid or m['nlink']!=1 or m['mode']&0o7022:raise ValueError('Unsafe WAL archive entry')
                match=re.fullmatch(r'([0-9A-F]{24})(\.partial)?',name)
                if match:
                    if int(match[1][:8],16)!=p['timeline'] or m['bytes']>size or not match[2] and m['bytes']!=size:raise ValueError('Wrong timeline/truncated WAL archive entry')
                    if not match[2]:complete[name]=m['bytes'];records[name]=m
                elif re.fullmatch(r'[0-9A-F]{8}\.history',name) and m['bytes']<=1024**2:
                    records[name]=m
                else:raise ValueError('Unexpected WAL archive entry')
            if names!={f.name for f in directory.iterdir()} or any(meta(directory/name)!=m for name,m in records.items()):raise ValueError('WAL inventory changed during read')
            return complete
        except (FileNotFoundError,ValueError):time.sleep(.1)
    raise ValueError('Stable safe WAL archive census refused')


def closed_coverage(p,row,files):
    size=p['walSegmentBytes'];first=lsn(p['initialSlotRestartLsn'])//size
    last=lsn(row['receiver']['flush_lsn'])//size-1
    if last<first:
        return dict(completeSegments=0,initialSlotRestartLsn=p['initialSlotRestartLsn'],
          qualification='Initial/current partial is not target-certified; no full closed segment interval yet.')
    end=(last+1)*size-1
    result=coverage(files,p['initialSlotRestartLsn'],f'{end>>32:X}/{end&0xffffffff:X}',p['timeline'],size)
    result['qualification']='Continuous complete-file size/name interval from frozen slot reservation to last closed durable-flush segment; payload hashes and target replay remain separate.'
    return result


def stop_child(child):
    if child and child.poll() is None:
        os.killpg(child.pid,signal.SIGTERM)
        try:child.wait(timeout=10)
        except subprocess.TimeoutExpired:os.killpg(child.pid,signal.SIGKILL);child.wait()


def open_identity_lock(path,expected,exclusive):
    import fcntl
    who=pwd.getpwnam('postgres');p=canonical(path)
    if meta(p)!=expected or not stat.S_ISREG(p.lstat().st_mode) or expected['uid']!=who.pw_uid or expected['gid']!=who.pw_gid:raise ValueError('Backup/admission lock identity/owner changed')
    fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW)
    try:
        if identity(os.fstat(fd))!=expected or meta(p)!=expected:raise ValueError('Logical backup lock replaced during open')
        fcntl.flock(fd,(fcntl.LOCK_EX if exclusive else fcntl.LOCK_SH)|fcntl.LOCK_NB)
        if identity(os.fstat(fd))!=expected or meta(p)!=expected:raise ValueError('Logical backup lock changed during admission')
        return fd
    except BaseException:os.close(fd);raise


def open_backup_lock(expected):return open_identity_lock(BACKUP_LOCK,expected,False)


def open_base_lock(expected):return open_identity_lock(ROOT/'.base-admission.lock',expected,True)


def supervise_receiver(child,watcher,err,interval=.2):
    while True:
        watcher.assert_alive()
        if child.poll() is not None:raise ValueError('Receiver exited; continuity requires renewed proof')
        if err.tell()>8*1024**2:raise ValueError('Receiver private stderr bound')
        time.sleep(interval)


def execute(p,plan_sha):
    runtime_fence(p);roots_fence(p,evidence_empty=True);authority_fence(p)
    g=load_guard(p);job=Path(p['evidence']);watch=None;child=None;phase='admission';started=time.monotonic()
    # Independent logical shared lock during bounded base capture only. WAL
    # receiver does not hold it, delay logical backup, or alter any timer.
    lock=None;base_lock=None
    if p['mode']=='basebackup':
        g.check_window({'backupWindow':p['backupWindow']})
    storage(p,admission=True)
    g.durable(job/'intent.json',dict(schema=SCHEMA,atUtc=g.utc(),planSha256=plan_sha,plan=p,
       scope='new physical/WAL files only; read-only live SQL; slot SQL separately approved',oldDataDeletion=False))
    def interrupted(*_):raise InterruptedError('Recovery service operator termination')
    previous={s:signal.signal(s,interrupted) for s in (signal.SIGTERM,signal.SIGINT,signal.SIGHUP)}
    try:
        if p['mode']=='basebackup':
            phase='base-admission-lock';base_lock=open_base_lock(p['baseAdmissionLock'])
            if list((ROOT/'bases').iterdir()):raise ValueError('One-base approval already has retained work; no implicit retry/new base')
            phase='backup-lock';lock=open_backup_lock(p['backupLock'])
        # A forked watcher cannot observe subsequent parent Python variables.
        # The creation-only readiness receipt arms its receiver-health gate.
        watch=g.Watchdog(job,sample=lambda _:storage(p,require_receiver=p['mode']=='basebackup' or (job/'streaming-observed.json').exists()))
        watch.start();runner=g.Runner(job,watch,started)
        if p['mode']=='receivewal':
            if cluster_fence(p)['slot']['active']:raise ValueError('Dedicated slot already active')
            if list((ROOT/'wal').iterdir()):raise ValueError('Initial receiver requires new empty WAL archive; continuation needs new reviewed proof')
            phase='receiver-start'
            with (job/'receiver.stderr').open('xb') as err:
                child=subprocess.Popen(receiver_argv(),env=ENV,stdout=subprocess.DEVNULL,stderr=err,start_new_session=True)
                deadline=time.monotonic()+30
                while True:
                    watch.assert_alive()
                    if child.poll() is not None or time.monotonic()>deadline:raise ValueError('WAL receiver readiness failed')
                    try:row=cluster_fence(p,True);break
                    except ValueError:time.sleep(.2)
                g.durable(job/'streaming-observed.json',dict(atUtc=g.utc(),cluster=row,continuousCoverageCertified=False))
                phase='streaming-supervision'
                supervise_receiver(child,watch,err)
        else:
            cluster_fence(p,True)
            phase='base-target';target=ROOT/'bases'/p['runId']
            if target.exists() or target.is_symlink():raise ValueError('Base target is not new')
            target.mkdir(mode=0o700);(target/'tablespaces').mkdir(mode=0o700)
            phase='base-capture';runner.run(base_argv(p),phase,timeout=5400)
            phase='verify-base';runner.run([str(BIN/'pg_verifybackup'),'--exit-on-error',str(target/'cluster')],phase,timeout=1200)
            manifest=safe_file(target/'cluster'/'backup_manifest',maximum=128*1024**2)
            parsed=json.loads(manifest,object_pairs_hook=pairs)
            if not parsed.get('WAL-Ranges') or not parsed.get('Files'):raise ValueError('Base manifest lacks recovery fence')
            ranges=parsed['WAL-Ranges']
            if any(r.get('Timeline')!=p['timeline'] for r in ranges):raise ValueError('Base timeline changed')
            expected={str(t['oid']):str(target/'tablespaces'/str(t['oid'])) for t in p['tablespaces']}
            links=target/'cluster'/'pg_tblspc'
            if {f.name for f in links.iterdir()}!=set(expected) or any(not f.is_symlink() or str(f.resolve(strict=True))!=expected[f.name] for f in links.iterdir()):raise ValueError('Base tablespace escapes new recovery root')
            final=storage(p,require_receiver=True);runtime_fence(p);watch.stop();watch=None
            g.durable(job/'completed.json',dict(schema='pow-audit30-new-physical-base-verified-v1',atUtc=g.utc(),planSha256=plan_sha,
              basePath=str(target),manifestSha256=hashlib.sha256(manifest).hexdigest(),walRanges=ranges,
              pgVerifybackupPassed=True,storage=final,jobRetained=True,oldDataDeleted=False,
              productionPhysicalPagesCertified=False,targetRecoveryAccepted=False,productionPitrCertified=False))
    except BaseException as e:
        # Repeated ordinary signals may not bypass remaining stop/receipt
        # attempts. The reviewed unit's cgroup stop deadline is the backstop.
        for s in previous:signal.signal(s,signal.SIG_IGN)
        cleanup=[]
        try:stop_child(child)
        except BaseException as stop_error:cleanup.append(dict(subject='receiver',errorClass=type(stop_error).__name__))
        if watch:
            try:watch.stop()
            except BaseException as stop_error:cleanup.append(dict(subject='watchdog',errorClass=type(stop_error).__name__))
        g.durable(job/'failed-or-stopped.json',dict(schema='pow-audit30-recovery-failed-or-stopped-v1',atUtc=g.utc(),
          planSha256=plan_sha,phase=phase,errorClass=type(e).__name__,jobRetained=True,automaticRetry=False,
          cleanupErrors=cleanup,unitCgroupStopRequired=bool(cleanup),oldDataDeleted=False,
          slotDropped=False,productionPitrCertified=False))
        raise
    finally:
        for s,h in previous.items():signal.signal(s,h)
        if lock is not None:os.close(lock)
        if base_lock is not None:os.close(base_lock)


def main():
    os.umask(0o077);a=argparse.ArgumentParser(description=__doc__)
    a.add_argument('mode',choices=['validate-plan','run']);a.add_argument('--plan',required=True);a.add_argument('--plan-sha256',required=True);p=a.parse_args()
    try:
        plan=read_plan(p.plan,p.plan_sha256,credential=p.mode=='run')
        if p.mode=='run':execute(plan,p.plan_sha256)
        print(json.dumps(dict(status='valid-structure-only' if p.mode=='validate-plan' else 'bounded-base-verified',productionPitrCertified=False),sort_keys=True));return 0
    except BaseException as e:
        print(json.dumps(dict(status='refused-or-stopped',errorClass=type(e).__name__,rawErrorsSuppressed=True,productionPitrCertified=False),sort_keys=True),file=sys.stderr);return 1


if __name__=='__main__':sys.exit(main())
