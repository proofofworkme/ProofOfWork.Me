#!/usr/bin/python3 -I
"""Audit5 restore only exact previously active timers recorded as held; never enable units."""
import sys
if not sys.flags.isolated:raise SystemExit('Invoke with /usr/bin/python3 -I')
sys.dont_write_bytecode=True
import pathlib,os,json,hashlib,stat,datetime,subprocess,urllib.request
APP='2ddefac163d5-20260905T180603Z';OPS='0b63c8604456-20260905T205150Z'
CAPTURE=pathlib.Path('/run/proofofwork-audit5-'+APP)
GUARD=pathlib.Path('/run/proofofwork-audit5-window-tools-'+OPS+'/window-quiescence.py')
GUARD_SHA='710dbbe0fce1189b735e8e4795bdbef632040a36558fb4b0004a44d98204fb63'
TIMERS=['proofofwork-postgres-logical-backup.timer','pg_basebackup@16-main.timer','pg_compresswal@16-main.timer','proofofwork-postgres-query-health.timer','proofofwork-cache-prune.timer','proofofwork-node-release-health.timer','proofofwork-node-release-prune.timer']
KEEP=['bitcoind.service','electrs.service','postgresql@16-main.service','pg_receivewal@16-main.service']
APP_UNITS=['proofofwork-api.service','proofofwork-indexer-worker.service']
ENV={'PATH':'/usr/sbin:/usr/bin:/sbin:/bin','LC_ALL':'C'}
def require(ok,message):
    if not ok:raise RuntimeError(message)
def now():return datetime.datetime.now(datetime.timezone.utc).isoformat()
def run(argv):
    p=subprocess.run(argv,env=ENV,stdin=subprocess.DEVNULL,text=True,capture_output=True,timeout=30)
    require(p.returncode==0,'timer command failed; inspect saved states');return p.stdout.strip()
def state(unit):
    return dict(x.split('=',1) for x in run(['/usr/bin/systemctl','show',unit,*['--property='+k for k in ['LoadState','ActiveState','SubState','UnitFileState','MainPID','NRestarts','ExecMainStartTimestamp']]]).splitlines())
def private_read(path):
    fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
    try:
        s=os.fstat(fd);require(stat.S_ISREG(s.st_mode) and s.st_uid==s.st_gid==0 and s.st_nlink==1 and stat.S_IMODE(s.st_mode)==0o600 and s.st_size<=1048576,'unsafe private file')
        with os.fdopen(os.dup(fd),'rb') as f:b=f.read(1048577)
        a=os.fstat(fd);require((s.st_dev,s.st_ino,s.st_size,s.st_mtime_ns,s.st_ctime_ns)==(a.st_dev,a.st_ino,a.st_size,a.st_mtime_ns,a.st_ctime_ns) and len(b)==s.st_size,'private file changed');return b
    finally:os.close(fd)
def write(name,record):
    b=(json.dumps(record,indent=2)+'\n').encode();fd=os.open(CAPTURE/name,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
    with os.fdopen(fd,'wb') as f:f.write(b);f.flush();os.fsync(f.fileno())
    fd=os.open(CAPTURE,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW);os.fsync(fd);os.close(fd)
    return hashlib.sha256(b).hexdigest()
def validate_records(baseline,held,baseline_sha):
    require(set(baseline['timers'])==set(TIMERS),'unexpected baseline timer set')
    selected=[u for u in TIMERS if baseline['timers'][u]['ActiveState']=='active']
    require(held['baselineSha256']==baseline_sha and held['heldTimers']==selected,'held list does not match original active timers')
    require(all(baseline['timers'][u]['ActiveState'] in ['active','inactive'] for u in TIMERS),'invalid original timer state')
    return selected

def main():
    require(len(sys.argv)==2 and sys.argv[1] in ['review','inspect','apply'],'expected review/inspect/apply')
    if sys.argv[1]=='review':
        print(json.dumps({'baseline':str(CAPTURE/'window-maintenance-baseline.json'),'holdReceipt':str(CAPTURE/'window-maintenance-held.json'),'allowedTimers':TIMERS,'onlyPreviouslyActiveHeldTimers':True,'enableDisableOperations':False,'failedUnitsReset':False,'oneshotsExplicitlyInvoked':False,'persistentTimerMayTriggerDueService':True,'prerequisite':'Controlled repair, bootstrap, application/UI publication and public verification completed by parent.'},indent=2));return
    require(os.geteuid()==0,'root required')
    for root in [CAPTURE,GUARD.parent]:
        s=root.lstat();require(stat.S_ISDIR(s.st_mode) and s.st_uid==s.st_gid==0 and stat.S_IMODE(s.st_mode)==0o700 and root.resolve()==root,'unsafe private directory')
    body=private_read(GUARD);require(hashlib.sha256(body).hexdigest()==GUARD_SHA,'wrong guard helper')
    original_bytes=private_read(CAPTURE/'window-maintenance-baseline.json');held_bytes=private_read(CAPTURE/'window-maintenance-held.json');baseline=json.loads(original_bytes);held=json.loads(held_bytes)
    selected=validate_records(baseline,held,hashlib.sha256(original_bytes).hexdigest());timers={u:state(u) for u in TIMERS}
    if sys.argv[1]=='inspect':print(json.dumps({'at':now(),'selected':selected,'current':timers},indent=2));return
    for name in ['window-timer-restore-before.json','window-timer-restore-completed.json','window-timer-restore-failure.json']:
        require(not os.path.lexists(CAPTURE/name),'existing restoration evidence; inspect rather than retry')
    for u in TIMERS:require(timers[u]['LoadState']=='loaded' and timers[u]['ActiveState']=='inactive' and timers[u]['UnitFileState']==baseline['timers'][u]['UnitFileState'],'timer drift; inspect before restoration')
    keep={u:state(u) for u in KEEP};apps={u:state(u) for u in APP_UNITS}
    for u in KEEP:
        require(keep[u]['ActiveState']=='active' and all(keep[u][k]==baseline['keep'][u][k] for k in ['MainPID','NRestarts','ExecMainStartTimestamp']),'authority/receiver identity changed')
    require(all(v['ActiveState']=='active' and int(v['MainPID'])>0 for v in apps.values()),'production app is not running')
    require(state('proofofwork-node-storage-health.timer')['ActiveState']=='active','storage monitoring inactive')
    with urllib.request.urlopen('http://127.0.0.1:8081/health',timeout=15) as response:
        body=response.read(1048577);require(len(body)<=1048576,'health response too large');health=json.loads(body)
        require(response.status==200 and health.get('ready') is True and health.get('available') is True,'production readiness required before restoring timers')
    before={'at':now(),'selected':selected,'baselineSha256':hashlib.sha256(original_bytes).hexdigest(),'heldReceiptSha256':hashlib.sha256(held_bytes).hexdigest(),'timerStates':timers,'authority':keep,'application':apps,'health':{k:health.get(k) for k in ['ready','available','tipHeight','indexedThroughBlock','lagBlocks']}}
    before_sha=write('window-timer-restore-before.json',before);started=[]
    try:
        for u in selected:run(['/usr/bin/systemctl','start',u]);started.append(u)
        after={u:state(u) for u in TIMERS}
        for u in TIMERS:require(after[u]['ActiveState']==('active' if u in selected else 'inactive') and after[u]['UnitFileState']==baseline['timers'][u]['UnitFileState'],'timer restoration state mismatch')
        for u in KEEP+APP_UNITS:
            s=state(u);prior=keep.get(u,apps.get(u));require(s['ActiveState']=='active' and all(s[k]==prior[k] for k in ['MainPID','NRestarts','ExecMainStartTimestamp']),'production identity changed while restoring timers')
    except Exception:
        write('window-timer-restore-failure.json',{'at':now(),'beforeSha256':before_sha,'startCommandsCompleted':started,'currentTimerStates':{u:state(u) for u in TIMERS},'action':'Preserve evidence and inspect; no automatic rollback, retry, enable, or reset-failed.'});raise
    result={'at':now(),'beforeSha256':before_sha,'started':started,'after':after,'oneshotsExplicitlyInvoked':False,'timerTriggeredOneshotsMayRun':True,'failedUnitsReset':False,'productionRestarts':False}
    print(json.dumps({**result,'receiptSha256':write('window-timer-restore-completed.json',result)},indent=2))
if __name__=='__main__':
    try:main()
    except Exception as error:
        print('timer_restore status=refused_preserved '+str(error),file=sys.stderr);sys.exit(1)
