#!/usr/bin/python3 -I
"""One exact installed retention-reader correction; never install policy or change units."""
import argparse, datetime, fcntl, hashlib, json, os, re, signal, stat, subprocess, sys, time
from pathlib import Path

ROOT=Path('/tmp/proofofwork-retention-atime-20261025')
EVIDENCE_ROOT=Path('/var/lib/proofofwork-monitoring-reconciliation/20261025-atime')
TARGET=Path('/usr/local/sbin/proofofwork-retention-protection')
LOCKS={'node':Path('/run/proofofwork-audit29-ops.lock'),'ui':Path('/run/proofofwork-ui/deploy.lock')}
POLICY=Path('/var/lib/proofofwork-monitoring-reconciliation/20261024/policy.json')
SERVICE='proofofwork-retention-protection.service'
TIMER='proofofwork-retention-protection.timer'
BEFORE='d61f81d955ad9b549bff4d9d719e5996527ca69164780e8c4de2984dfebb3a1d'
AFTER='5ce68d2ac76f2cebe18f1fb049f76c21a1bf74a4e301d1587deec5efce97d6d4'
BASE_CANONICAL='944f06bd37dc94a2df5ef1cd058bc21daf05b05e1f4f00ac19dac2df6199dedc'
CANONICAL='f4fe8f48cc29edaaf4a5e9b9d2c9529f0667ba6e351970dd0a256ccb8a0f8dd7'
POLICY_SHA='f972d08d3b0bf3beeabf418510650150a2a6717ed1ab92d81bf7ec1477a3134a'
SOURCE_PATH='deploy/monitoring-reconciliation/retention.py'
SOURCE_BASE='bca2efcbdb20bb8db811a0ac189fc6e37d1f1ac3'
OLD=b'os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK'
NEW=OLD+b' | os.O_NOATIME'
ENV={'PATH':'/usr/sbin:/usr/bin:/sbin:/bin','LC_ALL':'C','GIT_OPTIONAL_LOCKS':'0'}
COMMON_PIN_PATHS={str(TARGET),str(POLICY),
 '/var/lib/proofofwork-monitoring-reconciliation/20261024/checker-before.py',
 '/var/lib/proofofwork-monitoring-reconciliation/20261024/retention-completion.json',
 '/etc/systemd/system/'+SERVICE,'/etc/systemd/system/'+TIMER}
NODE_COMPLETION='/data/proofofwork-release-backups/runtime-latest-bca2efcbdb20-20261025T162006Z/completion.json'
PREVIOUS_CHECKER_SHA={'node':'0704fb072a96e9462b48c202e988372581301493f8266960b8a4fd32392a842f',
 'ui':'da5d1336ce857acc571ba0849c2b0150ef5fc6dfdacf80e65b9f1d3611c48e8a'}
UNIT_KEYS={SERVICE:('LoadState','FragmentPath','DropInPaths','UnitFileState','Type','User','Group',
 'ExecStart','TimeoutStartUSec','MemoryMax','CPUQuotaPerSecUSec','TasksMax','NoNewPrivileges',
 'PrivateTmp','BindReadOnlyPaths','PrivateDevices','ProtectSystem','ProtectHome','ProtectControlGroups',
 'ProtectKernelLogs','ProtectKernelModules','ProtectKernelTunables','CapabilityBoundingSet',
 'AmbientCapabilities','RestrictAddressFamilies','RestrictSUIDSGID','LockPersonality','RestrictRealtime','UMask'),
 TIMER:('LoadState','FragmentPath','DropInPaths','UnitFileState','ActiveState','Unit','Persistent','RandomizedDelayUSec','TimersCalendar')}

def need(value,message):
    if not value: raise ValueError(message)
def sha(raw): return hashlib.sha256(raw).hexdigest()
def identity(s): return (s.st_dev,s.st_ino,s.st_mode,s.st_uid,s.st_gid,s.st_nlink,s.st_size,s.st_mtime_ns,s.st_ctime_ns)
def creation(s): return identity(s)[:-1]
def unique(pairs):
    result={}
    for key,value in pairs:
        need(key not in result,'Duplicate JSON key'); result[key]=value
    return result
def encode(value): return (json.dumps(value,sort_keys=True,indent=2)+'\n').encode()
def read(path,pin=None):
    path=Path(path);before=path.lstat()
    need(path.resolve(strict=True)==path and stat.S_ISREG(before.st_mode) and
         before.st_uid==before.st_gid==0 and before.st_nlink==1 and not before.st_mode&0o7022 and
         before.st_size<=1024*1024,'Unsafe input')
    if pin: need(identity(before)==tuple(pin['identity']),'Input identity drift')
    with os.fdopen(os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK|os.O_NOATIME),'rb') as stream:
        need(os.fstat(stream.fileno())==before,'Input changed on open');raw=stream.read()
        need(os.fstat(stream.fileno())==before,'Input changed on read')
    need(path.lstat()==before,'Input changed after read')
    if pin: need(sha(raw)==pin['sha256'],'Input hash drift')
    return raw
def directory(path):
    s=path.lstat()
    need(path.resolve(strict=True)==path and stat.S_ISDIR(s.st_mode) and
         s.st_uid==s.st_gid==0 and stat.S_IMODE(s.st_mode)==0o700,'Unsafe private directory')
def sync(path):
    fd=os.open(path,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
    try: os.fsync(fd)
    finally: os.close(fd)
def save(path,raw):
    fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
    with os.fdopen(fd,'wb') as stream: stream.write(raw);stream.flush();os.fsync(stream.fileno())
    sync(path.parent)
def command(args,timeout=30,input=None):
    result=subprocess.run(args,input=input,env=ENV,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=timeout)
    need(len(result.stdout)<=1024*1024 and len(result.stderr)<=65536,'Oversized command result')
    return result
def checked(args,timeout=30):
    result=command(args,timeout);need(result.returncode==0,'Command refused: '+args[0]);return result.stdout
def normalize_exec(value,role):
    need(role in LOCKS,'Unsupported role')
    prefix='{ path='+str(TARGET)+' ; argv[]='+str(TARGET)+' --role='+role+' ; ignore_errors=no'
    stamp=r'\[(?:n/a|(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun) [0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2} UTC)\]'
    pattern=re.escape(prefix)+r' ; start_time='+stamp+r' ; stop_time='+stamp+r' ; pid=(?:0|[1-9][0-9]*) ; code=(?:\(null\)|exited|killed) ; status=(?:0|[1-9][0-9]*)(?:/(?:0|[A-Z][A-Z0-9]*))? \}'
    need(re.fullmatch(pattern,value) is not None,'Unexpected loaded checker command')
    return prefix
def show(unit,keys):
    raw=checked(['/usr/bin/systemctl','show',unit,*[item for key in keys for item in ('-p',key)]])
    value=unique(line.split('=',1) for line in raw.decode().splitlines())
    need(set(value)==set(keys),'Missing/extra unit properties');return value
def normalize_calendar(value):
    stamp=r'(?:n/a|(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun) [0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2} UTC)'
    match=re.fullmatch(r'(\{ OnCalendar=[^;{}\r\n]+) ; next_elapse='+stamp+r' \}',value)
    need(match is not None,'Unexpected loaded timer calendar')
    return match.group(1)
def context(role):
    value={unit:show(unit,keys) for unit,keys in UNIT_KEYS.items()}
    value[SERVICE]['ExecStart']=normalize_exec(value[SERVICE]['ExecStart'],role)
    value[TIMER]['TimersCalendar']=normalize_calendar(value[TIMER]['TimersCalendar'])
    return value
def status():
    return show(SERVICE,('InvocationID','ActiveState','SubState','MainPID','Result',
                        'ExecMainCode','ExecMainStatus','ExecMainStartTimestampMonotonic'))
def settled():
    until=time.monotonic()+30
    while True:
        value=status()
        if value['ActiveState'] not in ('active','activating','deactivating','reloading'):return value
        need(time.monotonic()<until,'Existing checker invocation did not finish')
        time.sleep(0.2)
def candidate_check(candidate,role):
    need(role in LOCKS,'Unsupported candidate role')
    result=command(['/usr/bin/python3','-I','-B','-','--role='+role],30,input=candidate)
    need(result.returncode==0,'Candidate memory preflight failed')
    value=json.loads(result.stdout,object_pairs_hook=unique)
    need(isinstance(value,dict) and value.get('role')==role and value.get('ok') is True and
         value.get('issues')==[],'Candidate memory preflight result failed')
    return {'sha256':sha(candidate),'result':value,'stdoutSha256':sha(result.stdout),
            'stderrSha256':sha(result.stderr)}
def evidence_root():
    parent=EVIDENCE_ROOT.parent.lstat()
    need(EVIDENCE_ROOT.parent.resolve(strict=True)==EVIDENCE_ROOT.parent and
         stat.S_ISDIR(parent.st_mode) and parent.st_uid==parent.st_gid==0 and
         not parent.st_mode&0o7022,'Unsafe durable evidence parent')
    if not os.path.lexists(EVIDENCE_ROOT):
        EVIDENCE_ROOT.mkdir(mode=0o700);sync(EVIDENCE_ROOT.parent)
    directory(EVIDENCE_ROOT)
    need(not list(EVIDENCE_ROOT.glob('attempt-*')),'Earlier attempt exists; inspect its evidence, no retry')
def service_check(installed_us,previous,role):
    value=settled()
    fresh=lambda v: v['InvocationID']!=previous and bool(re.fullmatch('[0-9a-f]{32}',v['InvocationID'])) and v['ExecMainStartTimestampMonotonic'].isdigit() and int(v['ExecMainStartTimestampMonotonic'])>=installed_us
    started=False
    if not fresh(value):
        result=command(['/usr/bin/systemctl','start',SERVICE],30);started=True
        value=settled()
        need(result.returncode==0,'Checker service start failed')
    need(fresh(value) and value['ActiveState']=='inactive' and value['SubState']=='dead' and
         value['MainPID']=='0' and value['Result']=='success' and value['ExecMainCode']=='1' and
         value['ExecMainStatus']=='0','New checker service invocation failed or stale')
    raw=checked(['/usr/bin/journalctl','--no-pager','--output=json','--lines=64',
                 '_SYSTEMD_INVOCATION_ID='+value['InvocationID']],15)
    results=[]
    for line in raw.decode().splitlines():
        event=json.loads(line,object_pairs_hook=unique)
        try: result=json.loads(event.get('MESSAGE',''),object_pairs_hook=unique)
        except (ValueError,TypeError):continue
        if isinstance(result,dict) and result.get('role')==role:results.append(result)
    need(len(results)==1 and results[0].get('ok') is True and results[0].get('issues')==[],
         'Actual service result is absent or unsuccessful')
    return {'startedByUpdater':started,'invocation':value,'result':results[0],'journalSha256':sha(raw)}
def validate(plan):
    need(set(plan)=={'schema','role','sourceRepository','sourceCommit','sourceTree','beforeSha256',
                    'afterSha256','policySha256','pins','unitContext'},'Unexpected plan fields')
    role=plan['role'];need(role in LOCKS,'Unsupported role')
    paths=COMMON_PIN_PATHS|({NODE_COMPLETION} if role=='node' else set())
    need(plan['schema']=='pow-retention-atime-update-v1' and set(plan['pins'])==paths,'Unexpected update scope')
    need(all(re.fullmatch('[0-9a-f]{64}',plan[key] or '') for key in
         ('beforeSha256','afterSha256','policySha256')) and plan['beforeSha256']!=plan['afterSha256'],'Invalid exact byte pins')
    need(plan['pins'][str(TARGET)]['sha256']==plan['beforeSha256'] and
         plan['pins'][str(POLICY)]['sha256']==plan['policySha256'],'Wrong predecessor/policy')
    if role=='node':
        need((plan['beforeSha256'],plan['afterSha256'],plan['policySha256'])==(BEFORE,AFTER,POLICY_SHA),'Wrong node pins')
    previous=str(POLICY.parent/'checker-before.py')
    need(plan['pins'][previous]['sha256']==PREVIOUS_CHECKER_SHA[role],'Wrong preserved checker for role')
    need(re.fullmatch('[0-9a-f]{40}',plan['sourceCommit'] or '') and
         re.fullmatch('[0-9a-f]{40}',plan['sourceTree'] or ''),'Final source commit/tree are not sealed')
    need(set(plan['unitContext'])==set(UNIT_KEYS),'Wrong unit context')
def source(plan):
    repository=Path(plan['sourceRepository'])
    need(repository.is_absolute() and repository.resolve(strict=True)==repository and
         repository.stat().st_uid==0,'Unsafe source repository')
    git=['/usr/bin/git','-c','safe.directory='+str(repository),'-C',str(repository)]
    commit=plan['sourceCommit']
    need(checked([*git,'rev-parse',commit+'^{commit}']).decode().strip()==commit,'Source commit differs')
    need(checked([*git,'rev-parse',commit+'^{tree}']).decode().strip()==plan['sourceTree'],'Source tree differs')
    checked([*git,'merge-base','--is-ancestor',SOURCE_BASE,commit])
    raw=checked([*git,'show',commit+':'+SOURCE_PATH])
    need(sha(raw)==CANONICAL,'Committed canonical source differs')
    baseline=checked([*git,'show',SOURCE_BASE+':'+SOURCE_PATH])
    need(sha(baseline)==BASE_CANONICAL and baseline.count(OLD)==1 and NEW not in baseline and
         baseline.replace(OLD,NEW)==raw,'Not the exact canonical one-flag correction')
    needle=b'EXPECTED_POLICY_SHA256 = None'
    need(raw.count(needle)==baseline.count(needle)==1,'Unexpected canonical policy binding')
    binding=('EXPECTED_POLICY_SHA256 = '+repr(plan['policySha256'])).encode()
    installed=raw.replace(needle,binding)
    need(sha(baseline.replace(needle,binding))==plan['beforeSha256'] and
         sha(installed)==plan['afterSha256'],'Installed predecessor/candidate differs')
    compile(installed,str(TARGET),'exec')
    return installed
def fence(plan,include_target=True):
    for path,pin in plan['pins'].items():
        if include_target or path!=str(TARGET):read(path,pin)
    policy=json.loads(read(POLICY,plan['pins'][str(POLICY)]),object_pairs_hook=unique)
    need(policy['role']==plan['role'],'Policy role differs')
    need(context(plan['role'])==plan['unitContext'],'Loaded unit/timer configuration changed')
def owned(path,raw,created):
    if not os.path.lexists(path):return False
    try:return creation(path.lstat())==tuple(created) and read(path)==raw
    except (OSError,ValueError):return False
def replace_exact(raw,expected,expected_pin,label,transaction):
    parent=TARGET.parent.lstat()
    need(TARGET.parent.resolve(strict=True)==TARGET.parent and stat.S_ISDIR(parent.st_mode) and
         parent.st_uid==parent.st_gid==0 and not parent.st_mode&0o7022,'Unsafe checker parent')
    need(read(TARGET,expected_pin)==expected,'Checker changed before replacement')
    temporary=TARGET.with_name('.'+TARGET.name+'.'+label)
    need(not os.path.lexists(temporary),'Replacement temporary exists')
    old=TARGET.lstat();fd=None;original=None;written=0
    transaction.update({'temporary':str(temporary),'bytesSha256':sha(raw),'temporaryCleanup':'not-created'})
    try:
        fd=os.open(temporary,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
        original=os.fstat(fd);transaction['temporaryCleanup']='pending'
        while written<len(raw):
            count=os.write(fd,raw[written:]);need(count>0,'Short replacement write');written+=count
        os.fsync(fd)
        os.fchown(fd,old.st_uid,old.st_gid);os.fchmod(fd,stat.S_IMODE(old.st_mode));os.fsync(fd)
        created=creation(os.fstat(fd));transaction['created']=created
        need(owned(temporary,raw,created),'Replacement temporary changed')
        need(read(TARGET,expected_pin)==expected,'Checker changed at replacement fence')
        os.replace(temporary,TARGET);transaction['temporaryCleanup']='renamed';sync(TARGET.parent)
        need(owned(TARGET,raw,created),'Replacement ownership changed')
        return {'sha256':sha(raw),'identity':identity(TARGET.lstat())}
    finally:
        try:
            if original is not None and os.path.lexists(temporary):
                current=temporary.lstat()
                ours=(current.st_dev,current.st_ino)==(original.st_dev,original.st_ino)
                if ours:
                    try:
                        ours=(read(temporary)==raw[:written] and
                              stat.S_IMODE(current.st_mode) in (0o600,stat.S_IMODE(old.st_mode)))
                    except (OSError,ValueError):ours=False
                if ours:
                    temporary.unlink();sync(temporary.parent);transaction['temporaryCleanup']='removed-owned'
                else:transaction['temporaryCleanup']='foreign-or-changed-preserved'
        finally:
            if fd is not None:os.close(fd)
def apply(plan,candidate,label,plan_sha):
    validate(plan);directory(ROOT)
    need(re.fullmatch('[0-9]{8}T[0-9]{6}Z',label),'Unsafe attempt label')
    lock=LOCKS[plan['role']];lock_info=lock.lstat()
    need(lock.resolve(strict=True)==lock and stat.S_ISREG(lock_info.st_mode) and
         lock_info.st_uid==lock_info.st_gid==0 and stat.S_IMODE(lock_info.st_mode)==0o600 and
         lock_info.st_nlink==1,'Unsafe operations lock')
    with os.fdopen(os.open(lock,os.O_RDONLY|os.O_NOFOLLOW),'rb') as locked:
        need(identity(os.fstat(locked.fileno()))==identity(lock_info),'Lock changed on open')
        fcntl.flock(locked,fcntl.LOCK_EX|fcntl.LOCK_NB)
        need(identity(lock.lstat())==identity(lock_info),'Operations lock replaced')
        fence(plan);before=read(TARGET,plan['pins'][str(TARGET)])
        need(before.count(OLD)==1 and NEW not in before and before.replace(OLD,NEW)==candidate and sha(candidate)==plan['afterSha256'],'Not the exact one-flag correction')
        settled();fence(plan)
        previous=status()['InvocationID']
        evidence_root()
        attempt=EVIDENCE_ROOT/('attempt-'+label);attempt.mkdir(mode=0o700);sync(EVIDENCE_ROOT)
        save(attempt/'checker-before.py',before)
        intent={'schema':'pow-retention-atime-intent-v1','planSha256':plan_sha,'sourceCommit':plan['sourceCommit'],
                'sourceTree':plan['sourceTree'],'role':plan['role'],'beforeSha256':plan['beforeSha256'],'afterSha256':plan['afterSha256'],
                'target':str(TARGET),'pins':plan['pins'],'unitContext':plan['unitContext']}
        save(attempt/'intent.json',encode(intent))
        result={**intent,'phase':'preflight','policyChanged':False,'unitConfigurationChanged':False,'archiveChanged':False}
        transaction={};failure=None
        try:
            result['candidateVerification']=candidate_check(candidate,plan['role'])
            fence(plan);need(read(TARGET,plan['pins'][str(TARGET)])==before,'Checker changed after preflight')
            result['phase']='installing'
            after_pin=replace_exact(candidate,before,plan['pins'][str(TARGET)],'atime-'+label,transaction)
            installed_us=time.monotonic_ns()//1000
            result['installedIdentity']=after_pin['identity']
            fence(plan,False);read(TARGET,after_pin)
            result['serviceVerification']=service_check(installed_us,previous,plan['role'])
            fence(plan,False);read(TARGET,after_pin)
            result['phase']='complete';result['installedSha256']=plan['afterSha256']
        except BaseException as error:
            failure=error;result.update({'phase':'failed','errorClass':type(error).__name__,'error':str(error)})
            try:
                if transaction.get('created') and owned(TARGET,candidate,transaction['created']):
                    current={'sha256':plan['afterSha256'],'identity':identity(TARGET.lstat())}
                    rollback={}
                    result['rollbackTransaction']=rollback
                    restored=replace_exact(before,candidate,current,'rollback-'+label,rollback)
                    need(read(TARGET,restored)==before,'Rollback differs')
                    result.update({'rolledBack':True,'restoredIdentity':restored['identity'],'restoredSha256':plan['beforeSha256']})
                else:
                    need(read(TARGET,plan['pins'][str(TARGET)])==before,'Foreign replacement; refuse rollback')
                    result['rolledBack']=False
            except BaseException as recovery:
                result.update({'recoveryIncomplete':True,'recoveryErrorClass':type(recovery).__name__,'recoveryError':str(recovery)})
        finally:
            result['installTransaction']=transaction
            result['finishedAt']=datetime.datetime.now(datetime.timezone.utc).isoformat()
            save(attempt/'result.json',encode(result))
        print(json.dumps({'ok':failure is None,'receipt':str(attempt/'result.json'),'phase':result['phase']}))
        if failure:raise failure
        return result
def main():
    need(os.geteuid()==0 and sys.flags.isolated,'Root isolated Python required')
    parser=argparse.ArgumentParser();parser.add_argument('--plan',required=True);parser.add_argument('--plan-sha256',required=True)
    parser.add_argument('--attempt',required=True);args=parser.parse_args()
    need(Path(args.plan)==ROOT/'update-plan.json' and re.fullmatch('[0-9a-f]{64}',args.plan_sha256),'Wrong plan path/hash')
    raw=read(Path(args.plan));need(sha(raw)==args.plan_sha256,'Plan differs')
    plan=json.loads(raw,object_pairs_hook=unique);validate(plan);candidate=source(plan)
    def interrupted(signum,frame):raise InterruptedError('Updater interrupted')
    for kind in (signal.SIGINT,signal.SIGTERM,signal.SIGHUP):signal.signal(kind,interrupted)
    return apply(plan,candidate,args.attempt,args.plan_sha256)
if __name__=='__main__': main()
