#!/usr/bin/python3 -I
"""Version2 proposal-only caller for the exact Oct2 logical pin + checker promotion.

No runnable approval is bundled. Two individual atomic replacements are not a
joint atomic transaction. Known candidate bytes can be restored on failure;
unknown bytes require explicit review. No unit/timer/hold/backup deletion.
"""
import argparse, datetime as dt, fcntl, hashlib, json, os
from pathlib import Path
import re, signal, stat, subprocess, sys, time, types

INSTALL_SHA='cd9c266e938d22949c9f0c6a48853933d9bcbb58368071b2da4027f13411eaa5'
PIN=Path('/etc/proofofwork-postgres-logical-backup.pins')
CHECKER=Path('/usr/local/sbin/proofofwork-retention-protection')
OLD_PIN=b'proof_indexer-20260929T031853Z.dumpset\n'
NEW_PIN=b'proof_indexer-20261002T031851Z.dumpset\n'
OLD_CHECKER='da5d1336ce857acc571ba0849c2b0150ef5fc6dfdacf80e65b9f1d3611c48e8a'
NEW_CHECKER='e8e0771335c10e79a75a7671539de8597bc02dca61b0e936768ba378bc252dad'
BACKUP=Path('/data/proofofwork-postgres-backups/logical/proof_indexer-20261002T031851Z.dumpset')
SOURCE_JOB=Path('/data/proofofwork-audit30-restore-20261002T234651Z')
RESTORE_HASHES={'completed.json':'47ec15376cab23ec705e494195d7b836fa2674450e5ee9f7d761e7f6dbb709dd','table-row-parity.json':'abd70cf572c37cb9d39ef8e26df6bf197b3f9862c58f4ed78fd934134872bcd2','offline-page-check.json':'617941865701c62045a343ce92b4d1d6427edc7c40c634426fbc6daa6db4529c','saved-snapshot-fence.json':'a299d498d31f5709e92621e9b97f3c1b732f2cad6bd1f523048f0f3f92556b10'}
MEMBERS={'proof_indexer.dump':(20525963614,'893700c4fff20e4bad721d16188f67dd04e3f44ee9f3f63784c15c51488a7b1a'),'globals.sql':(1137,'f38a588ae95aa4e41b044a437fa9b2a65d315ce91877210c264c6e753d25b3da'),'SHA256SUMS':(163,'699d111713cf8bf7d8c672087faef2599c314270a622d7c661130a3d695ac860')}
OPS=Path('/run/proofofwork-audit29-ops.lock')
BACKUP_LOCK=Path('/data/proofofwork-postgres-backups/logical/.proofofwork-postgres-logical-backup.lock')
HOLD=Path('/etc/proofofwork-retention/audit28.hold')
STATIC=(HOLD,Path('/etc/proofofwork-retention/audit28-held-review.json'),Path('/usr/local/sbin/proofofwork-postgres-logical-backup'),Path('/etc/systemd/system/proofofwork-retention-protection.service'),Path('/etc/systemd/system/proofofwork-postgres-logical-backup.service'),Path('/etc/systemd/system/proofofwork-postgres-logical-backup.timer'))
PRUNE='proofofwork-node-release-prune.timer'
MASK=Path('/etc/systemd/system')/PRUNE
LIVE=('bitcoind.service','electrs.service','postgresql@16-main.service','proofofwork-api.service','proofofwork-indexer-worker.service')
BACKUP_SERVICE='proofofwork-postgres-logical-backup.service'
BACKUP_TIMER='proofofwork-postgres-logical-backup.timer'
MONITOR='proofofwork-retention-protection.service'
UNITS=LIVE+(BACKUP_SERVICE,BACKUP_TIMER,PRUNE,MONITOR,'pg_receivewal@16-main.service')
PROPERTIES=('LoadState','ActiveState','SubState','MainPID','InvocationID','UnitFileState','NextElapseUSecRealtime')
HEX=re.compile(r'[a-f0-9]{64}\Z')
ENV={'PATH':'/usr/sbin:/usr/bin:/sbin:/bin','LC_ALL':'C'}
SCOPE={'schema':'pow-audit30-coupled-pin-checker-reviewed-scope-v1','operation':'exact-coupled-pin-checker-promotion','replacements':[{'path':str(PIN),'oldSha256':hashlib.sha256(OLD_PIN).hexdigest(),'newSha256':hashlib.sha256(NEW_PIN).hexdigest(),'mode':0o644,'uid':0,'gid':0},{'path':str(CHECKER),'oldSha256':OLD_CHECKER,'newSha256':NEW_CHECKER,'mode':0o755,'uid':0,'gid':0}],'knownByteFailureInverseApproved':True,'noTimerOrHoldChanges':True,'automaticDeletion':False,'recoveryActivation':False}
META_KEYS={'device','inode','mode','uid','gid','nlink','bytes','mtimeNs','ctimeNs'}
class PromotionInterrupted(RuntimeError):pass

def need(v,s):
    if not v:raise ValueError(s)
def sha(b):return hashlib.sha256(b).hexdigest()
def canonical(v):return json.dumps(v,sort_keys=True,separators=(',',':')).encode()
def utc():return dt.datetime.now(dt.timezone.utc).isoformat()
def meta(p):
    s=p.lstat();return dict(device=s.st_dev,inode=s.st_ino,mode=stat.S_IMODE(s.st_mode),uid=s.st_uid,gid=s.st_gid,nlink=s.st_nlink,bytes=s.st_size,mtimeNs=s.st_mtime_ns,ctimeNs=s.st_ctime_ns)
def stat_meta(s):return dict(device=s.st_dev,inode=s.st_ino,mode=stat.S_IMODE(s.st_mode),uid=s.st_uid,gid=s.st_gid,nlink=s.st_nlink,bytes=s.st_size,mtimeNs=s.st_mtime_ns,ctimeNs=s.st_ctime_ns)
def pairs(v):
    d={}
    for k,x in v:need(k not in d,'Duplicate JSON key');d[k]=x
    return d
def read(p,limit=262144,expected=None):
    s=p.lstat();m=meta(p)
    need(stat.S_ISREG(s.st_mode) and p.resolve()==p and s.st_nlink==1 and s.st_uid in (0,108) and s.st_gid in (0,112) and not s.st_mode&0o7022 and s.st_size<=limit,'Unsafe bounded input')
    fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW|os.O_NOATIME)
    with os.fdopen(fd,'rb')as f:
        need(stat_meta(os.fstat(f.fileno()))==m and not os.listxattr(f.fileno()),'Input changed before read/xattrs');b=f.read(limit+1);need(stat_meta(os.fstat(f.fileno()))==m and not os.listxattr(f.fileno()),'Input changed during read/xattrs')
    need(len(b)==m['bytes'] and meta(p)==m,'Input changed after read')
    if expected is not None:need(sha(b)==expected,'Pinned raw hash differs')
    return b,m
def load_install(package):
    b,m=read(package/'install-retention.py',32768,INSTALL_SHA);need(m['uid']==m['gid']==0,'Install helper owner');I=types.ModuleType('frozen-install');I.__file__=str(package/'install-retention.py');exec(compile(b,I.__file__,'exec'),I.__dict__);return I

def validate(plan):
    keys={'schema','run','finalHumanApproval','package','evidenceRoot','installed','static','mask','lockMetadata','units','expectedMonitorProjectionSha256','freshFullRead','restoreProofMetadata','authorityQualification','reviewedScopeSha256'}
    need(isinstance(plan,dict)and set(plan)==keys and plan['schema']=='pow-audit30-coupled-pin-checker-promotion-plan-v2','Closed exact plan')
    need(isinstance(plan['run'],str)and re.fullmatch(r'\d{8}T\d{6}Z',plan['run']),'Calendar run');dt.datetime.strptime(plan['run'],'%Y%m%dT%H%M%SZ')
    need(plan['package']=='/usr/local/lib/proofofwork-audit30-pin-promotion/'+plan['run'] and plan['evidenceRoot']=='/var/tmp/proofofwork-audit30-pin-promotion-'+plan['run'],'Fixed package/evidence')
    a=plan['finalHumanApproval'];need(isinstance(a,dict)and set(a)=={'path','sha256','sourceMessagePath','sourceMessageSha256'}and isinstance(a['sha256'],str)and HEX.fullmatch(a['sha256'])and HEX.fullmatch(a['sourceMessageSha256']or'')and a['path']==plan['package']+'/approval.json'and a['sourceMessagePath']==plan['package']+'/human-approval-message.txt','Final human approval remains required')
    need(plan['reviewedScopeSha256']==sha(canonical(SCOPE)),'Fixed noncircular reviewed scope')
    need(set(plan['installed'])=={str(PIN),str(CHECKER)} and set(plan['static'])==set(map(str,STATIC)) and set(plan['lockMetadata'])=={str(OPS),str(BACKUP_LOCK)},'Exact two files/static/locks')
    for m in list(plan['installed'].values())+list(plan['lockMetadata'].values()):need(isinstance(m,dict)and set(m)==META_KEYS and all(type(x)is int and x>=0 for x in m.values()),'Exact metadata required')
    need(set(plan['units'])==set(UNITS) and HEX.fullmatch(plan['expectedMonitorProjectionSha256'] or '') and set(plan['restoreProofMetadata'])==set(RESTORE_HASHES),'Exact fresh state and restore proofs')
    f=plan['freshFullRead'];need(set(f)=={'path','sha256','metadata'}and f['path']=='/var/tmp/proofofwork-audit30-pin-promotion-'+plan['run']+'-preflight/full-read.json'and HEX.fullmatch(f['sha256'] or ''),'Fresh full-read authority required')
    need(plan['authorityQualification']=='Fresh Oct2 member hashes/TOC are separately bounded and reviewed; pin promotion never authorizes retirement or live recovery.','Authority qualifier')

def validate_human_value(value,plan,self_sha):
    keys={'schema','status','approvalSource','operation','callerSha256','scopeSha256','humanApprovalSourceSha256','approvedAtUtc','replacements','knownByteFailureInverseApproved','noTimerOrHoldChanges','automaticDeletion','recoveryActivation'}
    need(isinstance(value,dict)and set(value)==keys and value['schema']=='pow-audit30-coupled-pin-checker-direct-human-approval-v1'and value['status']=='approved'and value['approvalSource']=='direct-human'and value['operation']==SCOPE['operation'],'Closed explicit direct-human approval')
    need(value['callerSha256']==self_sha and value['scopeSha256']==plan['reviewedScopeSha256']==sha(canonical(SCOPE))and value['humanApprovalSourceSha256']==plan['finalHumanApproval']['sourceMessageSha256'],'Human approval exact source/scope/caller')
    need(value['replacements']==SCOPE['replacements']and value['knownByteFailureInverseApproved']is True and value['noTimerOrHoldChanges']is True and value['automaticDeletion']is False and value['recoveryActivation']is False,'Human approval exact two replacements/inverse/no expanded authority')
    need(isinstance(value['approvedAtUtc'],str),'Human approval timestamp')
    when=dt.datetime.fromisoformat(value['approvedAtUtc']);need(when.tzinfo is not None and 0<=(dt.datetime.now(dt.timezone.utc)-when).total_seconds()<=86400,'Fresh actual direct-human approval timestamp')

def unit_states():
    r={}
    for name in UNITS:
        props=PROPERTIES if name==BACKUP_TIMER else PROPERTIES[:-1]
        a=['/usr/bin/systemctl','show',name]+[x for p in props for x in ('-p',p)]
        v=subprocess.run(a,env=ENV,stdin=subprocess.DEVNULL,capture_output=True,timeout=5)
        need(v.returncode==0 and len(v.stdout)<=65536 and not v.stderr,'Fixed unit observation');r[name]=dict(x.split('=',1)for x in v.stdout.decode().splitlines()if '='in x)
        need(set(r[name])==set(props),'Unit properties incomplete')
    return r

def state_require(states,expected):
    need(set(states)==set(expected)==set(UNITS),'Closed unit set')
    for name in UNITS:
        if name!=MONITOR:need(states[name]==expected[name],'Fresh unit/five/timer tuple drift')
        else:need(all(states[name][k]==expected[name][k]for k in('LoadState','UnitFileState')),'Monitor unit identity drift')
    for name in LIVE:need(states[name]['LoadState']=='loaded'and states[name]['ActiveState']=='active'and int(states[name]['MainPID'])>0 and re.fullmatch('[a-f0-9]{32}',states[name]['InvocationID']),'Live service unhealthy')
    need(states[BACKUP_SERVICE]['LoadState']=='loaded'and states[BACKUP_SERVICE]['ActiveState']in('inactive','failed')and states[BACKUP_SERVICE]['MainPID']=='0' and states[BACKUP_TIMER]['ActiveState']=='active'and states[BACKUP_TIMER]['SubState']=='waiting'and states[BACKUP_TIMER]['UnitFileState']=='enabled','Ordinary backup scheduler guard')
    nxt=states[BACKUP_TIMER]['NextElapseUSecRealtime'];d=dt.datetime.strptime(nxt,'%a %Y-%m-%d %H:%M:%S %Z').replace(tzinfo=dt.timezone.utc);need((d-dt.datetime.now(dt.timezone.utc)).total_seconds()>120,'Clear ordinary backup window')
    need(states[PRUNE]['LoadState']=='masked'and states[PRUNE]['ActiveState']=='inactive','Persistent prune mask/monitor idle')

def lock(p,expected):
    need(meta(p)==expected and p.resolve()==p and stat.S_ISREG(p.lstat().st_mode)and expected['nlink']==1 and not expected['mode']&0o7022,'Lock authority drift')
    fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW)
    try:
        need(stat_meta(os.fstat(fd))==expected and not os.listxattr(fd),'Lock descriptor drift/xattrs');fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB);need(stat_meta(os.fstat(fd))==meta(p)==expected,'Locked inode/path drift');return fd
    except BaseException:os.close(fd);raise

def mask_state():
    s=MASK.lstat();need(stat.S_ISLNK(s.st_mode)and s.st_uid==s.st_gid==0 and os.readlink(MASK)=='/dev/null','Exact persistent prune mask');return dict(metadata=meta(MASK),target='/dev/null')
def static_check(plan):
    for p in STATIC:
        row=plan['static'][str(p)];b,m=read(p,2097152,row['sha256']);fixed={str(STATIC[1]):'c3bd35740d7fcc135839274c8228e38f7a45c23e33567743e0d77151b32451d9',str(STATIC[2]):'4e5252ed8fcc8ce4ec863d6e027d429f146348f30be23d4eb5fe77cfd013a754',str(STATIC[3]):'8f9c54b522961e26d8f02ed33ad065af70906f1e95ca2ad65edd322c8f758448'};need(str(p)not in fixed or row['sha256']==fixed[str(p)],'Fixed protected authority hash');need(m==row['metadata'] and m['uid']==m['gid']==0,'Static authority metadata drift')
    need(mask_state()==plan['mask'],'Mask identity drift')

def backup_check(plan):
    f=plan['freshFullRead'];raw,m=read(Path(f['path']),131072,f['sha256']);need(m==f['metadata']and m['uid']==m['gid']==0 and m['mode']==0o600,'Fresh proof custody');v=json.loads(raw,object_pairs_hook=pairs)
    age=(dt.datetime.now(dt.timezone.utc)-dt.datetime.fromisoformat(v['atUtc'])).total_seconds();need(0<=age<=900 and v['schema']=='pow-audit30-latest-backup-full-read-v1'and v['fullDumpHashReverified']is True and v['productionDataMutation']is False and v['globalsContentsEmitted']is False,'Fresh full-read required')
    b=v['backup'];need(set(b['directory'])==META_KEYS and b['directory']['uid']==108 and b['directory']['gid']==112 and b['directory']['mode']==0o700 and b['directory']['nlink']==2 and not os.listxattr(BACKUP),'Exact safe Oct2 directory');need(b['path']==str(BACKUP)and set(b['members'])==set(MEMBERS)and set(os.listdir(BACKUP))==set(MEMBERS)and meta(BACKUP)==b['directory']and BACKUP.resolve()==BACKUP and BACKUP.is_dir(),'Exact backup complete tree')
    for name,(size,h)in MEMBERS.items():
        row=b['members'][name];need(set(row)==META_KEYS|{'sha256'},'Closed backup member metadata');need(row['bytes']==size and row['sha256']==h and meta(BACKUP/name)=={k:x for k,x in row.items()if k!='sha256'},'Oct2 current member identity differs');need(stat.S_ISREG((BACKUP/name).lstat().st_mode)and row['nlink']==1 and row['uid']==108 and row['gid']==112 and row['mode']==0o600,'Oct2 member safety')
    need(v['toc']['entries']==197 and v['toc']['sha256']=='626dae7576e0f5a9c31229b320cca6d009e6dc3c5826fc9a2ff138602739da30','Exact verified TOC')
    for name,h in RESTORE_HASHES.items():
        _,m=read(SOURCE_JOB/name,262144,h);need(m==plan['restoreProofMetadata'][name]and m['uid']==108 and m['gid']==112 and m['mode']==0o600,'Restore receipt custody changed')
    completed=json.loads(read(SOURCE_JOB/'completed.json',65536,RESTORE_HASHES['completed.json'])[0],object_pairs_hook=pairs)
    need(completed['schema']=='pow-audit30-isolated-logical-restore-completed-v1'and completed['status']=='passed'and all(completed[k]is True for k in ('roleOwnerAclRestoration','allTableRowHashParity','amcheckPassed','offlinePrivatePageChecksPassed','privateClusterStopped','liveServicesUnchanged'))and completed['productionDatabaseMutation']is False,'Actual complete isolated Oct2 restore')
    return {'freshFullReadRawSha256':f['sha256'],'memberHashes':{n:h for n,(_,h)in MEMBERS.items()},'restoreHashes':RESTORE_HASHES}

def monitor_projection(value):
    need(value.get('role')=='node'and value.get('issues')==['historical-held-path-missing-or-retirement-invalid'],'Unexpected monitor issue set')
    h=value['historicalHeldInventory'];need(h['heldPaths']==521 and len(h['missingHeldPaths'])==18 and len(set(h['missingHeldPaths']))==18 and not h['unexpectedRetiredPathsPresent']and not h['unexpectedRelocatedOriginalPathsPresent'],'Exact known 18 held absences')
    return {k:value[k]for k in ('role','ok','issues','units','historicalHeldInventory')}

def monitor(expected):
    r=subprocess.run(['/usr/bin/python3','-I','-B',str(CHECKER),'--role','node'],env=ENV,stdin=subprocess.DEVNULL,capture_output=True,timeout=20)
    need(r.returncode==1 and len(r.stdout)<=65536 and not r.stderr,'Read-only monitor outcome');p=monitor_projection(json.loads(r.stdout,object_pairs_hook=pairs));need(sha(canonical(p))==expected,'Known held-absence monitor projection drift');return p

def apply_pair(I,before,new,evidence,check):
    installed=[];handlers={n:signal.getsignal(n)for n in(signal.SIGINT,signal.SIGTERM,signal.SIGHUP)}
    def save(n,v):I.exclusive(evidence/(n+'.json'),canonical(v))
    def interrupted(n,_f):raise PromotionInterrupted('Promotion interrupted '+str(n))
    for n in handlers:signal.signal(n,interrupted)
    try:
        for index,(p,row)in enumerate(new.items()):
            old=before[p];b,s=I.read_safe(Path(p));need(b==old['bytes']and I.identity(s)==old['identity']and s.st_nlink==1,'Installed preimage changed');check('before-replace')
            fresh,fm=read(Path(p),262144);need(fresh==old['bytes']and I.identity(Path(p).lstat())==old['identity']and fm['nlink']==1,'Preimage changed after long guards')
            installed.append(p);I.replace(Path(p),row['bytes'],row['mode'],evidence.name+'-'+str(index));need(read(Path(p),262144)[0]==row['bytes'],'Installed postimage differs')
        check('after-pair')
        save('completed',dict(schema='pow-audit30-coupled-pin-checker-promotion-completed-v1',status='passed',atUtc=utc(),installed=[{'path':p,'sha256':sha(r['bytes']),'mode':r['mode'],'metadata':meta(Path(p))}for p,r in new.items()],individualAtomicReplacements=True,jointAtomicTransaction=False,knownHeldAbsencesUnresolved=18,timersAndHoldsUnchanged=True,automaticDeletion=False,recoveryActivation=False))
        return 'passed'
    except BaseException as first:
        for n in handlers:signal.signal(n,signal.SIG_IGN)
        errors=[]
        try:save('failed',dict(status='failed',errorClass=type(first).__name__,reasonSha256=sha(str(first).encode()),armed=installed))
        except BaseException as e:errors.append({'stage':'failure-receipt','errorClass':type(e).__name__})
        try:
            for p in installed:read(Path(p),262144)  # Includes nlink/no-xattrs/FD checks before inverse.
            I.reconcile(installed,before,new,evidence.name)
            for p in installed:
                b,m=read(Path(p),262144);need(b==before[p]['bytes']and m['mode']==before[p]['mode']and m['uid']==m['gid']==0,'Known inverse postimage differs')
        except BaseException as e:errors.append({'stage':'known-byte-inverse','errorClass':type(e).__name__})
        try:save('inverse',dict(status=('no-caller-mutation'if not installed else'reconciled')if not errors else'qualified-partial',originalErrorClass=type(first).__name__,cleanupErrors=errors,armed=installed,unknownBytesNeverReplaced=True))
        except BaseException:pass
        raise
    finally:
        for n,h in handlers.items():signal.signal(n,h)

def execute(plan,plan_sha,self_sha):
    validate(plan);need(sys.flags.isolated and os.geteuid()==os.getegid()==0,'Isolated root caller required');package=Path(plan['package']);I=load_install(package);I.directory(package)
    need(Path(__file__).resolve()==package/'promotion.py' and read(Path(__file__),32768,self_sha)[1]['uid']==0,'Exact installed caller')
    a=plan['finalHumanApproval'];araw,am=read(Path(a['path']),65536,a['sha256']);need(am['uid']==am['gid']==0 and am['mode']==0o600,'Final human approval custody');approval=json.loads(araw,object_pairs_hook=pairs);need(canonical(approval)==araw,'Canonical direct-human approval');validate_human_value(approval,plan,self_sha)
    _,sm=read(Path(a['sourceMessagePath']),65536,a['sourceMessageSha256']);need(sm['uid']==sm['gid']==0 and sm['mode']==0o600 and sm['bytes']>0,'Exact direct-human source-message custody')
    for p in (PIN,CHECKER):I.directory(p.parent);need(meta(p)==plan['installed'][str(p)],'Fresh installed identity required')
    oldpin,_=read(PIN,4096,sha(OLD_PIN));oldchecker,cm=read(CHECKER,32768,OLD_CHECKER);need(oldpin==OLD_PIN and meta(PIN)['mode']==0o644 and cm['mode']==0o755,'Exact original pin/checker')
    candidate,canmeta=read(package/'retention-checker-oct2.py',32768,NEW_CHECKER);need(canmeta['uid']==canmeta['gid']==0,'Exact root-owned checker candidate')
    static_check(plan);states=unit_states();state_require(states,plan['units']);need(states[MONITOR]['MainPID']=='0'and states[MONITOR]['ActiveState']in('inactive','failed'),'Monitor running before admission');authority=backup_check(plan)
    fds=[];parentfds=[]
    try:
        for p in(OPS,BACKUP_LOCK):fds.append(lock(p,plan['lockMetadata'][str(p)]))
        for p in (PIN.parent,CHECKER.parent):parentfds.append((p,os.open(p,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW),meta(p)))
        def parents():
            for p,fd,m in parentfds:need(stat_meta(os.fstat(fd))==meta(p)==m,'Installed parent descriptor/path drift')
        static_check(plan);state_require(unit_states(),plan['units']);backup_check(plan);parents();need(all(meta(p)==plan['installed'][str(p)]for p in(PIN,CHECKER)),'Pre-intent installed metadata drift');baseline=monitor(plan['expectedMonitorProjectionSha256'])
        root=Path(plan['evidenceRoot']);I.directory(root.parent);root.mkdir(mode=0o700);pd=os.open(root.parent,os.O_RDONLY|os.O_DIRECTORY);os.fsync(pd);os.close(pd)
        before={str(PIN):{'bytes':oldpin,'mode':0o644,'identity':I.identity(PIN.lstat())},str(CHECKER):{'bytes':oldchecker,'mode':0o755,'identity':I.identity(CHECKER.lstat())}}
        new={str(PIN):{'bytes':NEW_PIN,'mode':0o644},str(CHECKER):{'bytes':candidate,'mode':0o755}}
        for n,(p,r)in enumerate(before.items()):I.exclusive(root/(str(n)+'.previous'),r['bytes'])
        I.exclusive(root/'intent.json',canonical(dict(schema='pow-audit30-coupled-pin-checker-promotion-intent-v1',planSha256=plan_sha,callerSha256=self_sha,approvalSha256=a['sha256'],status='prepared',atUtc=utc(),before=[{'path':p,'sha256':sha(r['bytes']),'mode':r['mode'],'identity':r['identity']}for p,r in before.items()],authority=authority,knownMonitorProjectionSha256=sha(canonical(baseline)),automaticDeletion=False,recoveryActivation=False)))
        def check(phase):
            # Replacement changes parent mtime/ctime legitimately, so compare
            # pinned opened parent inode/owner/mode rather than pre-write times.
            for p,fd,m in parentfds:
                now=meta(p);need(stat_meta(os.fstat(fd))==now and all(now[k]==m[k]for k in('device','inode','mode','uid','gid','nlink')),'Parent authority changed')
            static_check(plan);state_require(unit_states(),plan['units']);backup_check(plan);read(package/'install-retention.py',32768,INSTALL_SHA);read(package/'retention-checker-oct2.py',32768,NEW_CHECKER)
            if phase=='after-pair':monitor(plan['expectedMonitorProjectionSha256'])
        apply_pair(I,before,new,root,check);return dict(status='passed',receipt=str(root/'completed.json'),planSha256=plan_sha,actualPromotionReceiptExists=True)
    finally:
        for _,fd,_ in parentfds:os.close(fd)
        for fd in fds:os.close(fd)

def main():
    p=argparse.ArgumentParser();p.add_argument('--plan',type=Path,required=True);p.add_argument('--plan-sha256',required=True);p.add_argument('--self-sha256',required=True);a=p.parse_args();need(HEX.fullmatch(a.plan_sha256)and HEX.fullmatch(a.self_sha256),'Exact source/plan SHA');raw,m=read(a.plan,131072,a.plan_sha256);need(m['uid']==m['gid']==0 and m['mode']==0o600,'Root immutable plan');plan=json.loads(raw,object_pairs_hook=pairs);need(canonical(plan)==raw,'Canonical compact plan')
    def timeout(_n,_f):raise TimeoutError('Promotion whole120-second deadline')
    old=signal.getsignal(signal.SIGALRM);signal.signal(signal.SIGALRM,timeout);signal.setitimer(signal.ITIMER_REAL,120)
    try:print(json.dumps(execute(plan,a.plan_sha256,a.self_sha256)))
    finally:signal.setitimer(signal.ITIMER_REAL,0);signal.signal(signal.SIGALRM,old)
if __name__=='__main__':main()
