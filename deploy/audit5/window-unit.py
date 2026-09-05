"""Audit5 fixed private unit launcher; reviewed source, no implicit repair."""
import sys
if not sys.flags.isolated:
    raise SystemExit('Invoke with /usr/bin/python3 -I')
sys.dont_write_bytecode=True
import datetime,hashlib,json,os,pathlib,re,stat,subprocess

APP='2ddefac163d5-20260905T180603Z'
OPS='0b63c8604456-20260905T205150Z'
NODE='/opt/node-v24.18.0-linux-x64/bin/node'
CANDIDATE='/opt/proofofwork-api-stage-'+APP
EXEC=pathlib.Path('/run/proofofwork-audit5-exec-'+OPS)
CAPTURE=pathlib.Path('/run/proofofwork-audit5-'+APP)
WINDOW=pathlib.Path('/run/proofofwork-audit5-window-tools-'+OPS)
QUIESCENCE_SHA='710dbbe0fce1189b735e8e4795bdbef632040a36558fb4b0004a44d98204fb63'
EXACT_REPAIR_SHA='3f2fc89dbd22d77253ebc698d78b37699bebb214dc842c90625b7eb761ea60d3'
ENV={'PATH':'/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin','LANG':'C.UTF-8'}
PINS={'private-env.py':'3785ce4ab40b21f5759a37e6170ad38949488ded6d1e1129710bc03d97dbc382','shadow-entry.mjs':'48da4605178d43d1cfbf7b33aeb45c1a64e9474913d8e51d1513904dd8d4bf4d'}
MODES={'repair-canonical','repair-atoms','bootstrap-api','bootstrap-worker','gate'}
assert os.geteuid()==0
assert len(sys.argv) in (4,5)
mode,label,apply=sys.argv[1:4]
gate=sys.argv[4] if len(sys.argv)==5 else None
assert mode in MODES and apply in ('review','apply') and re.fullmatch(r'[a-z0-9][a-z0-9-]{0,64}',label)
assert (mode=='gate')==(gate is not None)
for directory in [EXEC,CAPTURE,WINDOW]:
    s=directory.lstat();assert stat.S_ISDIR(s.st_mode) and directory.resolve()==directory and s.st_uid==s.st_gid==0 and stat.S_IMODE(s.st_mode)==0o700
def pinned_read(p,pin):
    fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
    try:
        s=os.fstat(fd)
        assert stat.S_ISREG(s.st_mode) and s.st_uid==s.st_gid==0 and s.st_nlink==1 and stat.S_IMODE(s.st_mode)==0o600 and s.st_size<=1048576
        with os.fdopen(os.dup(fd),'rb') as f:b=f.read(1048577)
        a=os.fstat(fd)
        assert (s.st_dev,s.st_ino,s.st_size,s.st_mtime_ns,s.st_ctime_ns)==(a.st_dev,a.st_ino,a.st_size,a.st_mtime_ns,a.st_ctime_ns) and len(b)==s.st_size
        assert hashlib.sha256(b).hexdigest()==pin
        return b
    finally:os.close(fd)
verified={name:pinned_read(EXEC/name,pin) for name,pin in PINS.items()}
quiescence=pinned_read(WINDOW/'window-quiescence.py',QUIESCENCE_SHA)
ns={'__file__':str(EXEC/'private-env.py'),'__name__':'fixed_window_guard'}
exec(compile(verified['private-env.py'],str(EXEC/'private-env.py'),'exec'),ns)
if gate: assert gate in ns['GATES']
unit='proofofwork-audit5-window-'+OPS+'-'+label+'.service'
log=CAPTURE/('window-'+label+'.log')
receipt=CAPTURE/('window-'+label+'-unit.json')
argv=['/usr/bin/python3','-I',str(EXEC/'private-env.py'),'launch','--release-id',APP,'--mode',mode]
if gate: argv+=['--source','worker','--gate',gate,'--api-port','18081']
if mode.startswith('repair-'):
    before=ns['private_read'](str(CAPTURE/'repair-before.json'),32*1024*1024)
    sha=hashlib.sha256(before).hexdigest();ns['validate_repair_evidence'](before,sha)
    exact_source=pinned_read(WINDOW/'check-exact-aux.py',EXACT_REPAIR_SHA)
    exact={'__file__':str(WINDOW/'check-exact-aux.py'),'__name__':'fixed_exact_repair_guard'}
    exec(compile(exact_source,str(WINDOW/'check-exact-aux.py'),'exec'),exact)
    def evidence(name):
        return json.loads(ns['private_read'](str(CAPTURE/name),32*1024*1024),parse_float=exact['D'])
    # The user approved only the exact funding parent's three spend-link fields
    # in addition to the original four targets. Every other parent/anchor field
    # is still preserved by this independently pinned baseline/phase verifier.
    exact['validate'](evidence('window-core-approved-before.json'),[(evidence('repair-before.json'),evidence('repair-before-aux.json'))])
    argv+=['--repair-before-sha256',sha]
    guard={'__file__':str(WINDOW/'window-quiescence.py'),'__name__':'fixed_stopped_guard'}
    exec(compile(quiescence,str(WINDOW/'window-quiescence.py'),'exec'),guard)
    original_argv=sys.argv
    try:
        sys.argv=[str(WINDOW/'window-quiescence.py'),'verify-stopped'];guard['main']()
    finally:sys.argv=original_argv
# RLIMIT_FSIZE covers all regular files, including persisted bootstrap caches.
# The temporary 512MiB bootstrap guard is not a claimed application maximum.
file_limit=536870912 if mode in ('bootstrap-api','bootstrap-worker') else 16777216
properties=['Type=exec','WorkingDirectory='+CANDIDATE,'UMask=0077','CPUQuota=100%','MemoryMax=4G','MemorySwapMax=0','TasksMax=128','RuntimeMaxSec='+('60min' if mode=='bootstrap-api' else '20min'),'TimeoutStopSec=30s','LimitCORE=0','LimitFSIZE='+str(file_limit),'Restart=no','KillMode=control-group','NoNewPrivileges=yes','PrivateTmp=yes','PrivateDevices=yes','ProtectSystem=strict','ProtectHome=yes','CapabilityBoundingSet=CAP_SETUID CAP_SETGID CAP_DAC_READ_SEARCH','AmbientCapabilities=','StandardOutput=append:'+str(log),'StandardError=append:'+str(log)]
if mode in ('bootstrap-api','bootstrap-worker'): properties+=['ReadWritePaths=/data/proofofwork-api-cache']
command=['/usr/bin/systemd-run','--unit='+unit,*['--property='+p for p in properties]]
if mode!='bootstrap-api': command+=['--wait']
command+=['--','/usr/bin/env','-i','PATH='+ENV['PATH'],'LANG=C.UTF-8',*argv]
plan={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'mode':mode,'gate':gate,'unit':unit,'log':str(log),'argv':command,'applied':apply=='apply'}
if apply=='review':
    print(json.dumps(plan,indent=2));raise SystemExit(0)
assert not os.path.lexists(log) and not os.path.lexists(receipt)
state=subprocess.check_output(['/usr/bin/systemctl','show',unit,'-p','LoadState'],text=True,env=ENV)
assert state.strip()=='LoadState=not-found'
ns['exclusive_write'](str(log),b'')
ns['exclusive_write'](str(CAPTURE/('window-'+label+'-plan.json')),(json.dumps(plan,indent=2)+'\n').encode())
result=subprocess.run(command,env=ENV,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,timeout=1300 if mode!='bootstrap-api' else 60)
properties=subprocess.check_output(['/usr/bin/systemctl','show',unit,'-p','ActiveState','-p','SubState','-p','MainPID','-p','Result','-p','ExecMainStatus'],env=ENV,text=True)
digest=hashlib.sha256()
hashed_bytes=0
with log.open('rb') as f:
    start=os.fstat(f.fileno());remaining=start.st_size
    while remaining:
        chunk=f.read(min(1048576,remaining));assert chunk
        digest.update(chunk);hashed_bytes+=len(chunk);remaining-=len(chunk)
    finish=os.fstat(f.fileno())
assert (start.st_dev,start.st_ino)==(finish.st_dev,finish.st_ino) and finish.st_size>=hashed_bytes
complete='MainPID=0' in properties.splitlines() and (start.st_size,start.st_mtime_ns)==(finish.st_size,finish.st_mtime_ns)
report={'mode':mode,'gate':gate,'unit':unit,'exitCode':result.returncode,'unitState':properties,'log':str(log),'logBytes':hashed_bytes,'logObservedBytesAfterHash':finish.st_size,'logSha256':digest.hexdigest(),'logHashScope':'complete-stopped-log' if complete else 'captured-prefix-of-running-log','controllerOutput':result.stdout,'controllerError':result.stderr}
ns['exclusive_write'](str(receipt),(json.dumps(report,indent=2)+'\n').encode())
print(json.dumps(report,indent=2))
raise SystemExit(result.returncode)
