#!/usr/bin/python3 -I
"""Pinned Audit 17 node cutover with preserved rollback and restored timers."""
import sys
if not sys.flags.isolated: raise SystemExit('Use python3 -I')
import datetime,hashlib,json,os,pathlib,subprocess,time,urllib.request
assert os.geteuid()==0 and len(sys.argv)==1
os.umask(0o077)
RELEASE='1f467cc59f41-20260919T172013Z'
COMMIT='1f467cc59f41ed284f89d854ebd943525fe5b525'
OLD='85ce5651ad4b1403913371a21b42d9bec0941855'
TREE='2b3d6740704c7dd4217b727532ea1494e11872ea'
RUNTIME='1a8c3fc688dd49607e22a93a7f595cf4b0eecc6e56978ecf24d062018ec3c524'
LIVE='/opt/proofofwork-api'; STAGE=LIVE+'-stage-'+RELEASE
OUT=pathlib.Path('/data/proofofwork-audit17-cutover-'+RELEASE)
TOOLS=pathlib.Path('/var/tmp/proofofwork-deploy/audit17-tools')
TIMERS=['pg_basebackup@16-main.timer','pg_compresswal@16-main.timer','proofofwork-cache-prune.timer','proofofwork-node-release-health.timer','proofofwork-node-release-prune.timer','proofofwork-postgres-logical-backup.timer','proofofwork-postgres-query-health.timer','proofofwork-worker-recovery-watch.timer']
APPS=['proofofwork-api-wg.socket','proofofwork-api-wg.service','proofofwork-api.service','proofofwork-indexer-worker.service']
KEEP=['bitcoind.service','electrs.service','postgresql@16-main.service','pg_receivewal@16-main.service']
ENV={'PATH':'/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin','LANG':'C.UTF-8','GIT_OPTIONAL_LOCKS':'0'}
def run(args,timeout=90):
    p=subprocess.run(args,env=ENV,stdin=subprocess.DEVNULL,capture_output=True,text=True,timeout=timeout)
    if p.returncode: raise RuntimeError('Command failed: '+args[0]+' '+str(p.returncode)+' '+p.stderr[:500])
    return p.stdout.strip()
def state(unit):
    return dict(s.split('=',1) for s in run(['systemctl','show',unit,'-p','LoadState','-p','ActiveState','-p','MainPID','-p','UnitFileState']).splitlines())
def stopped(fields):
    # Socket units have no MainPID property; service units report it.
    return fields.get('ActiveState')=='inactive' and fields.get('MainPID','0')=='0'
def save(name,data):
    with open(OUT/name,'x') as f: json.dump(data,f,indent=2);f.write('\n');f.flush();os.fsync(f.fileno())
def attest(path):
    return run(['/usr/bin/python3','-I',str(TOOLS/'attest-node.py'),path],180).split()
def keep_unchanged(before):
    assert all(state(u)==before[u] for u in KEEP), 'Authority service changed'
def ready():
    for attempt in range(36):
        try:
            with urllib.request.urlopen('http://127.0.0.1:8081/health',timeout=15) as response: data=json.load(response)
            if data.get('ready') is True and data.get('lagBlocks')==0:return data
        except Exception:pass
        time.sleep(5)
    raise RuntimeError('Production readiness did not recover within bound')
assert hashlib.sha256(pathlib.Path('/usr/local/sbin/proofofwork-node-release-exchange').read_bytes()).hexdigest()=='2c8ae0549a707640c3a11a8b6a03fd888c9ef4e5fbe6afded7b7d3866f1754c5'
assert hashlib.sha256((TOOLS/'attest-node.py').read_bytes()).hexdigest()=='4bec20fa1e5931636e3bfc84f617f005a7b1b71e752dc7f7c9b8bea23014be38'
proof=json.loads(pathlib.Path('/home/powadmin/audit17-profile-assets-shadow/receipt.json').read_text());assert proof['ok'] is True
OUT.mkdir(mode=0o700)
baseline={u:state(u) for u in TIMERS+APPS+KEEP}
assert all(baseline[u]['ActiveState']=='active' for u in KEEP+APPS)
assert all(baseline[u]['ActiveState'] in ('active','inactive') for u in TIMERS)
assert all(state(u.replace('.timer','.service'))['ActiveState'] not in ('active','activating','deactivating') for u in TIMERS), 'Maintenance task active'
old_att=attest(LIVE); new_att=attest(STAGE)
assert old_att[0]==OLD and new_att[0:2]==[COMMIT,TREE] and new_att[-1]==RUNTIME
save('before.json',{'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'units':baseline,'oldAttestation':old_att,'newAttestation':new_att,'rootIdentities':{p:{'dev':os.stat(p).st_dev,'inode':os.stat(p).st_ino} for p in (LIVE,STAGE)}})
selected=[u for u in TIMERS if baseline[u]['ActiveState']=='active']
phase='before-stop'; success=False
try:
    run(['systemctl','stop',*selected])
    assert all(state(u)['ActiveState']=='inactive' for u in selected)
    shadow=state('proofofwork-audit17-assets-shadow.service')
    if shadow['LoadState']=='loaded':
        run(['systemctl','stop','proofofwork-audit17-assets-shadow.service'])
    else:
        assert shadow['LoadState']=='not-found' and stopped(shadow)
    phase='stopping'
    run(['systemctl','stop',*APPS],180)
    assert all(stopped(state(u)) for u in APPS)
    assert not run(['ss','-ltnH','sport = :8081 or sport = :18081'])
    for proc in pathlib.Path('/proc').iterdir():
        if not proc.name.isdigit():continue
        try: cwd=os.readlink(proc/'cwd')
        except (FileNotFoundError,ProcessLookupError):continue
        assert not any(cwd==root or cwd.startswith(root+'/') for root in (LIVE,STAGE)), 'Checkout process remains'
    for drain_attempt in range(16):
        connections=run(['sudo','-n','-u','postgres','psql','-X','-qAt','-v','ON_ERROR_STOP=1','-d','proof_indexer','-c','SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid()'],15)
        if connections=='0':break
        if drain_attempt<15:time.sleep(1)
    assert connections=='0', 'Database session remains after bounded drain'
    save('drain.json',{'waitIterations':drain_attempt,'remainingConnections':int(connections)})
    keep_unchanged(baseline)
    assert attest(LIVE)==old_att and attest(STAGE)==new_att
    run(['sync','-f',LIVE]);run(['sync','-f',STAGE])
    phase='exchange-uncertain'
    result=run(['/usr/local/sbin/proofofwork-node-release-exchange','--release-id',RELEASE])
    assert 'status=exchanged' in result
    phase='exchanged'
    save('exchange.json',{'result':result})
    assert attest(LIVE)==new_att and attest(STAGE)==old_att
    phase='verified-exchange'
    request=pathlib.Path('/var/tmp/proofofwork-deploy/proofofwork-node-release-1f467cc-20260919T172013Z.tgz')
    with request.open('xb') as f:f.write(b'Audit 17 publisher request; reconstruct evidence from attested live checkout.\n')
    archive=run(['/usr/local/sbin/proofofwork-node-release-publish',str(request)],600)
    save('archive.json',{'result':archive})
    run(['systemctl','start','proofofwork-api.service','proofofwork-indexer-worker.service'])
    health=ready()
    run(['systemctl','start','proofofwork-api-wg.socket','proofofwork-api-wg.service'])
    assert all(state(u)['ActiveState']=='active' for u in APPS)
    keep_unchanged(baseline)
    save('after.json',{'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'units':{u:state(u) for u in APPS+KEEP},'health':health,'attestation':attest(LIVE)})
    success=True;phase='complete'
except Exception as error:
    save('failure.json',{'phase':phase,'error':str(error),'at':datetime.datetime.now(datetime.timezone.utc).isoformat()})
    if phase=='verified-exchange':
        run(['systemctl','stop',*APPS],180)
        assert attest(LIVE)==new_att and attest(STAGE)==old_att
        rollback=run(['/usr/local/sbin/proofofwork-node-release-exchange','--release-id',RELEASE])
        assert 'status=exchanged' in rollback and attest(LIVE)==old_att
        save('rollback.json',{'result':rollback});phase='rolled-back'
    if phase in ('before-stop','stopping','rolled-back'):
        run(['systemctl','start',*APPS]);ready()
    raise
finally:
    if phase not in ('exchange-uncertain','exchanged'):
        run(['systemctl','start',*selected])
        save('timers-restored.json',{u:state(u) for u in TIMERS})
print(json.dumps({'ok':success,'phase':phase,'commit':COMMIT,'receipt':str(OUT)}))
