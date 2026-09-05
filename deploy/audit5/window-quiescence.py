#!/usr/bin/python3 -I
"""Fixed audit5 timer hold and stopped-writer evidence; never stops application units."""
import sys
if not sys.flags.isolated:
    raise SystemExit('Invoke with /usr/bin/python3 -I')
sys.dont_write_bytecode = True
import os,stat,pathlib,json,hashlib,subprocess,datetime,socket
APP='2ddefac163d5-20260905T180603Z'
ROOT=pathlib.Path('/run/proofofwork-audit5-'+APP+'-window2')
TIMERS=['proofofwork-postgres-logical-backup.timer','pg_basebackup@16-main.timer','pg_compresswal@16-main.timer','proofofwork-postgres-query-health.timer','proofofwork-cache-prune.timer','proofofwork-node-release-health.timer','proofofwork-node-release-prune.timer']
KEEP=['bitcoind.service','electrs.service','postgresql@16-main.service','pg_receivewal@16-main.service']
STOP=['proofofwork-api-wg.socket','proofofwork-api-wg.service','proofofwork-indexer-worker.service','proofofwork-api.service','proofofwork-audit5-shadow-'+APP+'-resume-20260905T204900Z.service']
ENV={'PATH':'/usr/sbin:/usr/bin:/sbin:/bin','LC_ALL':'C','PGOPTIONS':'-c statement_timeout=5000 -c lock_timeout=1000'}
BASE=ROOT/'window-maintenance-baseline.json'
HOLD=ROOT/'window-maintenance-held.json'
def run(argv,timeout=20):
    p=subprocess.run(argv,env=ENV,text=True,stdin=subprocess.DEVNULL,capture_output=True,timeout=timeout)
    if p.returncode: raise RuntimeError('Command refused: '+str(argv[:2]))
    return p.stdout.strip()
def fields(unit):
    keys=['LoadState','ActiveState','SubState','UnitFileState','MainPID','NRestarts','ExecMainStartTimestamp','Result','ExecMainStatus']
    return dict(x.split('=',1) for x in run(['/usr/bin/systemctl','show',unit,*['--property='+k for k in keys]]).splitlines())
def now(): return datetime.datetime.now(datetime.timezone.utc).isoformat()
def safe_root():
    if os.geteuid()!=0: raise RuntimeError('Root required')
    s=ROOT.lstat()
    if not(stat.S_ISDIR(s.st_mode) and s.st_uid==s.st_gid==0 and stat.S_IMODE(s.st_mode)==0o700 and ROOT.resolve()==ROOT):raise RuntimeError('Unsafe capture root')
def read(path):
    fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW);s=os.fstat(fd)
    try:
        if not(stat.S_ISREG(s.st_mode) and s.st_uid==s.st_gid==0 and stat.S_IMODE(s.st_mode)==0o600 and s.st_nlink==1 and s.st_size<=1048576):raise RuntimeError('Unsafe receipt')
        with os.fdopen(os.dup(fd),'rb') as f: b=f.read(1048577)
        a=os.fstat(fd)
        if (s.st_size,s.st_mtime_ns,s.st_ctime_ns)!=(a.st_size,a.st_mtime_ns,a.st_ctime_ns) or len(b)!=s.st_size:raise RuntimeError('Receipt changed')
        return json.loads(b),hashlib.sha256(b).hexdigest()
    finally:os.close(fd)
def write(path,value):
    b=(json.dumps(value,indent=2)+'\n').encode();fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
    with os.fdopen(fd,'wb') as f:f.write(b);f.flush();os.fsync(f.fileno())
    fd=os.open(ROOT,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW);os.fsync(fd);os.close(fd)
    return hashlib.sha256(b).hexdigest()
def snapshot():
    return {'at':now(),'timers':{u:fields(u) for u in TIMERS},'oneshots':{u[:-6]+'.service':fields(u[:-6]+'.service') for u in TIMERS},'keep':{u:fields(u) for u in KEEP},'stop':{u:fields(u) for u in STOP},'storageTimer':fields('proofofwork-node-storage-health.timer')}
def check_keep(before,after):
    for unit in KEEP:
        if after['keep'][unit]['ActiveState']!='active':raise RuntimeError('Authority/receiver inactive: '+unit)
        for k in ['MainPID','ExecMainStartTimestamp','NRestarts']:
            if after['keep'][unit][k]!=before['keep'][unit][k]:raise RuntimeError('Authority/receiver identity changed: '+unit)
    if after['storageTimer']['ActiveState']!='active':raise RuntimeError('Storage monitoring must remain active')
def check_oneshots(s):
    for u,v in s['oneshots'].items():
        if v['ActiveState'] not in ['inactive','failed'] or int(v.get('MainPID','0')):raise RuntimeError('Maintenance oneshot still active: '+u)
def main():
    if len(sys.argv)!=2 or sys.argv[1] not in ['review','capture-baseline','hold-timers','verify-stopped']:raise RuntimeError('Expected fixed phase')
    mode=sys.argv[1]
    if mode=='review':
        print(json.dumps({'timers':TIMERS,'applicationStopsPerformed':False,'mustBeStopped':STOP,'keepRunning':KEEP,'baseline':str(BASE),'holdReceipt':str(HOLD),'holdsOnlyPreviouslyActiveTimers':True,'noAutomaticResumeOrTermination':True},indent=2));return
    safe_root();os.umask(0o077)
    if mode=='capture-baseline':
        s=snapshot();check_keep(s,s)
        for u in ['proofofwork-api.service','proofofwork-indexer-worker.service']:
            if s['stop'][u]['ActiveState']!='active':raise RuntimeError('Capture before application stop')
        check_oneshots(s)
        for u,v in s['timers'].items():
            if v['LoadState']!='loaded' or v['ActiveState'] not in ['active','inactive']:raise RuntimeError('Unexpected timer state: '+u)
        print(json.dumps({'phase':mode,'path':str(BASE),'sha256':write(BASE,s)}));return
    before,base_sha=read(BASE)
    if mode=='hold-timers':
        age=(datetime.datetime.now(datetime.timezone.utc)-datetime.datetime.fromisoformat(before['at'])).total_seconds()
        if not 0<=age<=900:raise RuntimeError('Baseline too old')
        if os.path.lexists(HOLD):raise RuntimeError('Hold receipt already exists')
        current=snapshot();check_keep(before,current);check_oneshots(current)
        for u in TIMERS:
            if any(current['timers'][u][k]!=before['timers'][u][k] for k in ['ActiveState','UnitFileState']):raise RuntimeError('Timer drift before hold')
        selected=[u for u in TIMERS if before['timers'][u]['ActiveState']=='active']
        if selected:run(['/usr/bin/systemctl','stop',*selected],timeout=45)
        after=snapshot();check_keep(before,after);check_oneshots(after)
        if any(v['ActiveState']!='inactive' for v in after['timers'].values()):raise RuntimeError('Timer not held')
        print(json.dumps({'phase':mode,'path':str(HOLD),'sha256':write(HOLD,{'at':now(),'baselineSha256':base_sha,'heldTimers':selected,'after':after})}));return
    held,_=read(HOLD)
    if held['baselineSha256']!=base_sha:raise RuntimeError('Wrong baseline')
    current=snapshot();check_keep(before,current);check_oneshots(current)
    if any(v['ActiveState']!='inactive' for v in current['timers'].values()):raise RuntimeError('Timer resumed during window')
    for u,v in current['stop'].items():
        if v['ActiveState']!='inactive' or int(v.get('MainPID','0')):raise RuntimeError('Application unit still active: '+u)
    listeners=run(['/usr/bin/ss','-ltnH','sport = :8081 or sport = :18081'])
    if listeners:raise RuntimeError('Application TCP listener remains')
    offenders=[]
    for p in pathlib.Path('/proc').iterdir():
        if not p.name.isdigit():continue
        try:cwd=os.readlink(p/'cwd')
        except (FileNotFoundError,ProcessLookupError,PermissionError):continue
        if cwd in ['/opt/proofofwork-api','/opt/proofofwork-api-stage-'+APP]:offenders.append(int(p.name))
    if offenders:raise RuntimeError('Candidate/live cwd processes remain: '+str(offenders))
    count=run(['/usr/bin/sudo','-n','-u','postgres','/usr/bin/psql','-X','-qAt','-v','ON_ERROR_STOP=1','-d','proof_indexer','-c','SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid()'],timeout=15)
    if count!='0':raise RuntimeError('Other database sessions remain; do not terminate blindly')
    print(json.dumps({'phase':mode,'at':now(),'baselineSha256':base_sha,'heldTimers':held['heldTimers'],'allStopped':True,'otherDatabaseSessions':0,'listenersAbsent':True,'candidateAndLiveCwdProcessesAbsent':True,'authorityIdentitiesPreserved':True}))
if __name__=='__main__':
    try:main()
    except Exception as e:
        print('window_quiescence status=refused '+str(e),file=sys.stderr);sys.exit(1)
