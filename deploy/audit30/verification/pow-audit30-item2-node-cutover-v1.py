#!/usr/bin/python3 -I
"""One review-bound item 2 cutover; delegate unchanged Audit 29 release bytes.

This file is prepared locally. Root execution requires the exact fresh request
SHA as argv[1], stdin JSON, and the canonical release systemd unit. No retry.
"""
import base64
import contextlib
import datetime as dt
import hashlib
import io
import json
import os
from pathlib import Path
import re
import signal
import stat
import subprocess
import sys
import time

RELEASE = '38ac6e2bff2a-20261003T042000Z'
COMMIT = '38ac6e2bff2ac16890724e5213346ef8a3ebd186'
TREE = '8b9b5e3cd47aa8e4204da717350a629176e30da6'
RUNTIME = '13035b6d1fbca1be9c03b1833f3abe578d4ae28331a341b3dea4301cc72b535c'
ROOT = Path('/data/proofofwork-release-backups/audit30-node-release-' + RELEASE)
RELEASE_SHA = '09afe5ddd243a796ea9c830b0041924747eb77a3803a3cfe56a3279cd24bf670'
GUARD_SHA = '48001283affb80b3b027dcc93831074aee872fbee649fb14482c32b00eb1c76c'
PROTECTIONS = {
 '/etc/proofofwork-postgres-logical-backup.pins': '22f66cac8419985c544d4b41c6ea9cd400fc99805c588694a9a619a3f120d09b',
 '/usr/local/sbin/proofofwork-retention-protection': '795f1308b74ddc69a022ce7e1413fb4698a82e6cfb14265931d1951ee603c908',
}
HEX = re.compile(r'[0-9a-f]{64}\Z')
STATE={'phase':'pre-admission','directory':None,'leaseStopped':False,'nativeReceiptDirectory':None}
IDLE_EXPECTED=[{'kind':'confirmed','sources':['block-scan']},{'kind':'best-effort-pending','sources':['mempool-scan']}]
IDLE_SQL="BEGIN TRANSACTION READ ONLY; SELECT jsonb_build_object('state',value->>'state','finishedAt',value->>'finishedAt','backfillPhases',CASE WHEN jsonb_typeof(value->'backfillPhases')='array' THEN (SELECT jsonb_agg(jsonb_build_object('kind',phase->>'kind','sources',phase->'sources') ORDER BY ordinal) FROM jsonb_array_elements(value->'backfillPhases') WITH ORDINALITY p(phase,ordinal)) ELSE NULL END) FROM proof_indexer.meta WHERE key='worker:lastRun'; ROLLBACK;"

def need(value, code):
 if not value: raise ValueError(code)

def stamp(s):
 return (s.st_dev,s.st_ino,s.st_mode,s.st_uid,s.st_gid,s.st_nlink,s.st_size,s.st_mtime_ns,s.st_ctime_ns)

def read(path, expected, limit=2*1024**2):
 p=Path(path); s=p.lstat()
 need(p.is_absolute() and p.resolve(strict=True)==p and stat.S_ISREG(s.st_mode)
      and s.st_uid==s.st_gid==0 and not s.st_mode & 0o7022 and s.st_nlink==1
      and s.st_size<=limit and HEX.fullmatch(expected), 'BOUND_FILE_SHAPE')
 fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
 try:
  need(stamp(os.fstat(fd))==stamp(s),'BOUND_FILE_OPEN_DRIFT')
  chunks=[]; size=0
  while block:=os.read(fd,65536):
   size+=len(block);need(size<=limit,'BOUND_FILE_GROWTH');chunks.append(block)
  raw=b''.join(chunks)
  need(len(raw)==s.st_size and stamp(os.fstat(fd))==stamp(s)==stamp(p.lstat()),'BOUND_FILE_READ_DRIFT')
 finally:os.close(fd)
 need(hashlib.sha256(raw).hexdigest()==expected,'BOUND_FILE_SHA')
 return raw

def bound_json(binding, prefix):
 need(type(binding)is dict and set(binding)=={'path','sha256'}
      and str(binding['path']).startswith(prefix),'RECEIPT_PATH')
 return json.loads(read(binding['path'],binding['sha256'],4*1024**2))

def save(directory,name,value):
 raw=(json.dumps(value,sort_keys=True)+'\n').encode()
 fd=os.open(directory/name,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
 with os.fdopen(fd,'wb')as f:f.write(raw);f.flush();os.fsync(f.fileno())
 d=os.open(directory,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
 try:os.fsync(d)
 finally:os.close(d)
 return hashlib.sha256(raw).hexdigest()

def protect():
 out={}
 for path,pin in PROTECTIONS.items():
  raw=read(path,pin,65536);s=Path(path).lstat()
  out[path]={'sha256':pin,'bytes':len(raw),'stamp':stamp(s)}
 return out

def service_state(unit,keys):
 p=subprocess.run(['/usr/bin/systemctl','show',unit,*['--property='+k for k in keys]],
                  env={'PATH':'/usr/sbin:/usr/bin:/sbin:/bin','LC_ALL':'C'},
                  capture_output=True,timeout=20)
 need(p.returncode==0 and not p.stderr and len(p.stdout)<=65536,'SERVICE_READ')
 return dict(line.split('=',1)for line in p.stdout.decode().splitlines()if '='in line)

def remaining_unit_seconds(unit):
 s=service_state(unit,['ExecMainStartTimestampMonotonic','MainPID','ActiveState'])
 need(s.get('ActiveState')=='active' and s.get('MainPID')==str(os.getpid()),'CONTROLLER_IDENTITY_DRIFT')
 start=int(s['ExecMainStartTimestampMonotonic'])/1000000
 elapsed=time.monotonic()-start;need(0<=elapsed,'CONTROLLER_START_CLOCK')
 return 1800-elapsed

def idle_window():
 # Scheduling hint only. Invoke unchanged guard exactly once after this window.
 deadline=time.monotonic()+180;samples=0
 while time.monotonic()<deadline:
  r=subprocess.run(['/usr/bin/sudo','-n','-u','postgres','/usr/bin/env','-i','PATH=/usr/bin:/bin','LC_ALL=C',
    'PGOPTIONS=-c default_transaction_read_only=on -c statement_timeout=5000 -c lock_timeout=1000',
    '/usr/lib/postgresql/16/bin/psql','-X','-q','-t','-A','-v','ON_ERROR_STOP=1','-d','proof_indexer'],
    input=IDLE_SQL.encode(),env={'PATH':'/usr/bin:/bin','LC_ALL':'C','TZ':'UTC'},capture_output=True,timeout=8,check=True)
  need(not r.stderr and len(r.stdout)<=65536,'IDLE_READ_BOUND')
  row=json.loads(r.stdout);samples+=1
  if row.get('state')=='idle' and row.get('backfillPhases')==IDLE_EXPECTED and isinstance(row.get('finishedAt'),str):
   age=(dt.datetime.now(dt.timezone.utc)-dt.datetime.fromisoformat(row['finishedAt'].replace('Z','+00:00'))).total_seconds()
   if 0<=age<=10 and time.monotonic()<deadline:
    return {'schema':'pow-audit30-item2-idle-scheduling-v1','atUtc':dt.datetime.now(dt.timezone.utc).isoformat(),
            'samples':samples,'finishedAgeSeconds':age,'guardInvocationsSoFar':0,'cutoverInvocationsSoFar':0}
  time.sleep(1)
 raise ValueError('READONLY_IDLE_WINDOW_UNAVAILABLE_CUTOVER_NOT_INVOKED')

def interrupted(signum,frame):raise RuntimeError('ADMISSION_SIGNAL_'+str(signum))

def record_failure(error):
 code=str(error);result={'schema':'pow-audit30-item2-node-cutover-failed-v1','atUtc':dt.datetime.now(dt.timezone.utc).isoformat(),
  'ok':False,'phase':STATE['phase'],'errorClass':type(error).__name__,
  'errorCode':code if re.fullmatch('[A-Z][A-Z0-9_]{0,100}',code)else None,
  'errorReasonSHA256':hashlib.sha256(code.encode()).hexdigest(),'leaseStopAcknowledged':STATE['leaseStopped'],
 'nativeReceiptDirectory':STATE['nativeReceiptDirectory'],'automaticRetry':False,'inspectionRequired':True}
 if STATE['directory'] is not None:
  # Preserve the refusal before optional live observations can time out.
  try:save(STATE['directory'],'failed.json',result)
  except BaseException as e:result['failureReceiptErrorClass']=type(e).__name__
  try:
   timers={}
   for unit in STATE.get('timerUnits',[]):timers[unit]=service_state(unit,['LoadState','ActiveState','SubState','UnitFileState','MainPID'])
   result['observedTimerStates']=timers
  except BaseException as e:result['timerObservationErrorClass']=type(e).__name__
  if STATE.get('leaseUnit'):
   try:result['observedOwnedLeaseState']=service_state(STATE['leaseUnit'],['LoadState','ActiveState','SubState','MainPID','InvocationID'])
   except BaseException as e:result['leaseObservationErrorClass']=type(e).__name__
  try:save(STATE['directory'],'failure-observation.json',result)
  except BaseException as e:result['failureObservationReceiptErrorClass']=type(e).__name__
 print(json.dumps(result,sort_keys=True),file=sys.stderr,flush=True)

def main():
 need(sys.flags.isolated and os.geteuid()==os.getegid()==0,'ROOT_ISOLATED')
 for sig in (signal.SIGTERM,signal.SIGINT,signal.SIGHUP):signal.signal(sig,interrupted)
 need(len(sys.argv)==2 and HEX.fullmatch(sys.argv[1]),'EXACT_REQUEST_SHA')
 raw=sys.stdin.buffer.read(131073)
 need(len(raw)<=131072 and hashlib.sha256(raw).hexdigest()==sys.argv[1],'REQUEST_SHA')
 q=json.loads(raw)
 need(type(q)is dict and set(q)=={'schema','attempt','guardRunId','guardBase64',
      'strictAccepted','strictCompleted','leaseReceipt','quietUnits'},'REQUEST_FIELDS')
 need(q['schema']=='pow-audit30-item2-node-cutover-request-v1'
      and re.fullmatch('[a-z0-9][a-z0-9-]{0,24}',q['attempt'])
      and q['attempt']!='initial' and re.fullmatch(r'\d{8}T\d{6}Z',q['guardRunId']), 'REQUEST_NAMESPACE')
 ns={'__name__':'_exact_audit29_release','__file__':str(ROOT/'release.py')}
 exec(compile(read(ROOT/'release.py',RELEASE_SHA),str(ROOT/'release.py'),'exec'),ns)
 R=type('ExactRelease',(),ns)
 R.safe_path(ROOT,True)
 suffix='-'+q['attempt']; expected_unit='proofofwork-audit29-release-'+RELEASE+'-node'+suffix+'.service'
 accepted_prefix='/data/proofofwork-audit29-verify-launch-'+RELEASE+'-shadow-'
 accepted=bound_json(q['strictAccepted'],accepted_prefix)
 completed=bound_json(q['strictCompleted'],str(ROOT)+'/')
 lease=bound_json(q['leaseReceipt'],str(ROOT)+'/')
 R.acceptance(accepted,COMMIT,TREE,RUNTIME)
 need(completed.get('schema')=='pow-audit30-strict-native-completed-v1'
      and completed.get('returncode')==0 and completed.get('stopped')is True
      and completed.get('timerRestored')is True and completed.get('liveFiveUnchanged')is True
      and completed.get('shadowUnchanged')is True
      and completed.get('acceptedReceiptPath')==q['strictAccepted']['path']
      and completed.get('acceptedReceiptSHA256')==q['strictAccepted']['sha256']
      and accepted.get('privateLauncher',{}).get('unit')==completed.get('unit'), 'STRICT_COMPLETION_PAIR')
 strict_root=Path(q['strictAccepted']['path']).parent
 need(Path(q['strictAccepted']['path']).name=='accepted-receipt.json','STRICT_RECEIPT_NAME')
 finals=list(strict_root.glob('launcher-final.json'));restored=list(strict_root.glob('backup-window-*.restored.json'))
 need(len(finals)==len(restored)==1,'STRICT_FINAL_RESTORED_COUNT')
 final_raw=read(finals[0],hashlib.sha256(finals[0].read_bytes()).hexdigest(),65536)
 restored_raw=read(restored[0],completed.get('timerRestoredReceiptSHA256',''),65536)
 final=json.loads(final_raw);restore=json.loads(restored_raw)
 need(final.get('ok')is True and final.get('errorClass')is None and restore.get('restored')is True
      and restore.get('before')==restore.get('after'), 'STRICT_RESTORATION')
 lease_unit=lease.get('unit','');lease_inv=lease.get('invocationID','');lease_pid=lease.get('mainPID')
 need(lease.get('schema')=='pow-audit30-node-readonly-shadow-prepared-v1' and lease.get('ok')is True
      and lease.get('health',{}).get('ready')is True and lease.get('health',{}).get('status')==200
      and lease.get('candidateAttestationSha256')=='98343f1ecff80e2b203355a2272df966cc108b0a89890c9d3fabfd5b0b8e084d'
      and lease.get('oldAttestationSha256')=='ecb2f2b7dde7253af35252109aab003666dca54b51ff6c81f719315fb2dc6bf6'
      and lease.get('readonlyEntrypointSha256')=='48da4605178d43d1cfbf7b33aeb45c1a64e9474913d8e51d1513904dd8d4bf4d'
      and all(lease.get(k)is False for k in ('productionDataMutation','productionStop','timerChanges'))
      and re.fullmatch(re.escape('proofofwork-audit29-shadow-'+RELEASE)+r'-lease-[a-z0-9-]+\.service',lease_unit)
      and re.fullmatch('[0-9a-f]{32}',lease_inv) and str(lease_pid).isdigit() and int(lease_pid)>0,
      'LEASE_ACCEPTANCE')
 quiet=q['quietUnits']
 need(type(quiet)is list and len(quiet)<=64 and len(quiet)==len(set(quiet))
      and all(type(u)is str and re.fullmatch(r'proofofwork-(?:audit\d+|recovery|native)[A-Za-z0-9@_.:-]*\.service',u)
              and u not in R.KEEP+R.APPS for u in quiet),'QUIET_UNITS')
 canonical_shadow='proofofwork-audit29-shadow-'+RELEASE+'.service'
 for u in (completed['unit'],lease_unit,canonical_shadow):
  if u not in quiet:quiet.append(u)
 argv=[str(ROOT/'release.py'),'node','--release-id',RELEASE,'--commit',COMMIT,'--tree',TREE,
  '--candidate-attestation',str(ROOT/'candidate.tsv'),'--attestation-sha256','98343f1ecff80e2b203355a2272df966cc108b0a89890c9d3fabfd5b0b8e084d',
  '--archive-sha256','46890aaf9c56ad62c9d06d4bc417742e8ca4d11563a22a06713b59a96c8cf38c',
  '--shadow-receipt',q['strictAccepted']['path'],'--shadow-sha256',q['strictAccepted']['sha256'],
  '--old-attestation',str(ROOT/'old-live.tsv'),'--old-attestation-sha256','ecb2f2b7dde7253af35252109aab003666dca54b51ff6c81f719315fb2dc6bf6',
  '--recovery-archive','/data/proofofwork-release-backups/managed/proofofwork-node-release-d4d8887-20261002T013828Z.tgz',
  '--recovery-sha256','19786a7927bdda2aa5be82e16e17832e9612628f3241329ceb3e42bfc84ba3f8',
  '--recovery-provenance-sha256','30f2fb76984d07b902c52f79ac657fb9b795910e7204e7fd26e09c4d98eafaac',
  '--shadow-unit','proofofwork-audit29-shadow-'+RELEASE+'.service','--postgres-client-sha256','df8031178589c31c7bc20aa2adf902e1cc3f0aa9ea12428aa5db3d476cbcac1a','--attempt',q['attempt']]
 for k,v in {'attestor':'4bec20fa1e5931636e3bfc84f617f005a7b1b71e752dc7f7c9b8bea23014be38',
             'exchange':'2c8ae0549a707640c3a11a8b6a03fd888c9ef4e5fbe6afded7b7d3866f1754c5',
             'publisher':'42ad099555cee0257572dd348a85a9f684005aba4f9c8f8077ea9aa67d68df78'}.items():argv+=['--helper-sha',k+'='+v]
 for u in quiet:argv+=['--quiet-unit',u]
 args=R.parser().parse_args(argv[1:]); pre=R.Controller(args)
 need(not os.path.lexists(pre.out),'CUTOVER_RECEIPTS_EXIST')
 out=ROOT/('item2-cutover-admission'+suffix);need(not os.path.lexists(out),'ADMISSION_EXISTS')
 state=service_state(expected_unit,R.FIELDS+['KillMode','RuntimeMaxUSec','InvocationID'])
 need(state.get('ActiveState')=='active' and state.get('MainPID')==str(os.getpid())
      and state.get('KillMode')=='control-group' and state.get('RuntimeMaxUSec')=='30min'
      and any(line.endswith(':'+state.get('ControlGroup','\0'))for line in Path('/proc/self/cgroup').read_text().splitlines()),'MANAGED_CONTROLLER')
 os.umask(0o077);out.mkdir(mode=0o700);pre.out=out
 STATE.update(directory=out,phase='admitted',nativeReceiptDirectory=str(pre.__class__(args).out),timerUnits=R.NODE_TIMERS,leaseUnit=lease_unit)
 save(out,'request.json',q); protection_before=protect()
 save(out,'bindings.json',{'atUtc':R.now(),'requestSHA256':sys.argv[1],'releaseControllerSHA256':RELEASE_SHA,
                          'workerGuardSHA256':GUARD_SHA,'protections':protection_before,'unit':expected_unit})
 R.quiet({u:pre.state(u)for u in quiet if u!=lease_unit})
 # The exact canonical read-only native preflight runs before stopping the lease.
 STATE['phase']='native-postgres-preflight';pre.postgres_preflight()
 guard=base64.b64decode(q['guardBase64'],validate=True)
 need(len(guard)==13199 and hashlib.sha256(guard).hexdigest()==GUARD_SHA,'GUARD_SOURCE_PIN')
 g={'__name__':'_exact_worker_guard','__file__':'<exact-480-worker-guard>'}
 exec(compile(guard,g['__file__'],'exec'),g)
 STATE['phase']='readonly-idle-scheduling';idle=idle_window();save(out,'idle-scheduling.json',idle)
 STATE['phase']='fresh-worker-guard';worker=g['execute'](q['guardRunId']);observed_mono=time.monotonic()
 worker_sha=save(out,'worker-guard.json',worker)
 need(worker.get('ok')is True and worker.get('liveServicesUnchanged')is True,'WORKER_GUARD')
 need(worker['liveServices']==lease.get('liveServices') and lease.get('liveServicesUnchanged')is True,
      'LEASE_LIVE_FIVE_DRIFT')
 for u,v in worker['liveServices'].items():need(g['state'](u)==v,'LIVE_FIVE_AFTER_GUARD')
 lease_state=pre.state(lease_unit,R.FIELDS+['InvocationID','ExecStart'])
 need(lease_state.get('ActiveState')=='active' and lease_state.get('MainPID')==str(lease_pid)
      and lease_state.get('InvocationID')==lease_inv
      and '/var/tmp/proofofwork-deploy/audit29-tools/private-env.py' in lease_state.get('ExecStart',''), 'OWNED_LEASE_DRIFT')
 need(remaining_unit_seconds(expected_unit)>=1748,'CONTROLLER_LEASE_TOO_SHORT_BEFORE_SHADOW_STOP')
 STATE['phase']='stopping-owned-lease';pre.run(['/usr/bin/systemctl','stop',lease_unit],60)
 stopped=pre.state(lease_unit,R.FIELDS+['InvocationID'])
 need(stopped.get('MainPID')=='0' and stopped.get('ActiveState')=='inactive'
      and stopped.get('InvocationID')==lease_inv,'OWNED_LEASE_STOP')
 STATE['leaseStopped']=True;STATE['phase']='owned-lease-stopped'
 save(out,'lease-stopped.json',{'unit':lease_unit,'invocationID':lease_inv,'mainPID':0,'atUtc':R.now()})
 need(protect()==protection_before,'BACKUP_PROTECTION_DRIFT')
 age=(dt.datetime.now(dt.timezone.utc)-dt.datetime.fromisoformat(worker['atUtc'])).total_seconds()
 need(0<=age<=120 and time.monotonic()-observed_mono<=120,'WORKER_GUARD_EXPIRED')
 for u,v in worker['liveServices'].items():need(g['state'](u)==v,'LIVE_FIVE_BEFORE_DELEGATION')
 read(ROOT/'release.py',RELEASE_SHA)
 need(remaining_unit_seconds(expected_unit)>=1745,'CONTROLLER_LEASE_TOO_SHORT_BEFORE_DELEGATION')
 sys.argv=argv
 # One invocation. Preserve every frozen controller check/recovery/timer path.
 result=io.StringIO()
 STATE['phase']='delegating-frozen-controller'
 with contextlib.redirect_stdout(result):R.main()
 STATE['phase']='native-controller-returned'
 native=json.loads(result.getvalue());need(native.get('ok')is True and native.get('phase')=='complete','NATIVE_NOT_COMPLETE')
 need(native.get('receipts')==str(Path('/data')/('proofofwork-audit29-cutover-'+RELEASE+suffix)),'NATIVE_RECEIPT_PATH')
 need(protect()==protection_before,'POSTCUTOVER_BACKUP_PROTECTION_DRIFT')
 final={'schema':'pow-audit30-item2-node-cutover-completed-v1','atUtc':R.now(),'ok':True,
        'native':native,'admissionDirectory':str(out),'workerGuardSHA256':worker_sha,
        'sourceControllerSHA256':RELEASE_SHA,'requestSHA256':hashlib.sha256(raw).hexdigest(),
        'candidate':{'commit':COMMIT,'tree':TREE,'runtimeSha256':RUNTIME},
        'postcutoverStrictVerified':False,'protectionsUnchanged':True,'automaticRetry':False}
 save(out,'completed.json',final);STATE['phase']='complete';print(json.dumps(final,sort_keys=True))

if __name__=='__main__':
 try:main()
 except BaseException as error:
  for sig in (signal.SIGTERM,signal.SIGINT,signal.SIGHUP):signal.signal(sig,signal.SIG_IGN)
  record_failure(error);sys.exit(1)
