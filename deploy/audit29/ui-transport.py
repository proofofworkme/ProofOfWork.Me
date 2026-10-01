#!/usr/bin/python3 -I
"""Hash-bound, managed UI transport parent; never publish the candidate.

surfaces-stage stdin is exactly the surfaces gzip. Source is a distinct later
invocation with exactly the source gzip, a fresh parent lock and admission.
"""
import argparse, fcntl, hashlib, json, os, re, resource, selectors, signal, stat, subprocess, sys, time
from pathlib import Path

TOOLS = Path('/var/tmp/proofofwork-deploy/audit29-tools')
PATHS = {'controller':TOOLS/'release.py', 'receiver':TOOLS/'stream-ui-bundle.py',
         'stage-shell':TOOLS/'ui-stage-candidate.sh','phase-capacity':TOOLS/'ui-capacity.py',
         'capacity':Path('/usr/local/sbin/proofofwork-ui-capacity'),
         'retained':Path('/usr/local/sbin/proofofwork-ui-retained-root')}
ENV = {'PATH':'/usr/sbin:/usr/bin:/sbin:/bin','LC_ALL':'C'}

def identity(info):
 return (info.st_dev,info.st_ino,info.st_mode,info.st_uid,info.st_gid,info.st_nlink,
         info.st_size,info.st_mtime_ns,info.st_ctime_ns)

def bound(path, expected, limit=2*1024**2):
 before=path.lstat()
 assert path.resolve()==path and stat.S_ISREG(before.st_mode) and before.st_uid==before.st_gid==0
 assert before.st_nlink==1 and not before.st_mode & 0o7022 and before.st_size<=limit
 fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
 with os.fdopen(fd,'rb') as stream:
  assert identity(os.fstat(stream.fileno()))==identity(before)
  raw=stream.read(limit+1)
  assert identity(os.fstat(stream.fileno()))==identity(before)
 assert identity(path.lstat())==identity(before) and len(raw)==before.st_size
 assert re.fullmatch('[0-9a-f]{64}',expected) and hashlib.sha256(raw).hexdigest()==expected
 return raw

def feed(source, sink, length):
 remaining=length
 while remaining:
  block=source.read(min(65536,remaining))
  assert block,'Truncated combined transport'
  sink.write(block); remaining-=len(block)
 sink.close()

def run(argv, output, descriptor, env, *, source=None, length=0):
 def limits(): resource.setrlimit(resource.RLIMIT_FSIZE,(2*1024**3,2*1024**3))
 with output.open('xb') as log:
  child=subprocess.Popen(argv,env=env,cwd='/',stdin=subprocess.PIPE if source else subprocess.DEVNULL,
       stdout=subprocess.PIPE,stderr=subprocess.STDOUT,pass_fds=(descriptor,),start_new_session=True,preexec_fn=limits)
  selector=selectors.DefaultSelector(); selector.register(child.stdout,selectors.EVENT_READ)
  deadline=time.monotonic()+600
  try:
   if source: feed(source,child.stdin,length)
   count=0
   while selector.get_map():
    assert time.monotonic()<deadline,'Reviewed child time budget exhausted'
    for key,_ in selector.select(timeout=min(1,max(0,deadline-time.monotonic()))):
     block=os.read(key.fileobj.fileno(),65536)
     if not block: selector.unregister(key.fileobj); continue
     count+=len(block); assert count<=1024**2,'Private child log bound exceeded'
     log.write(block)
   assert child.wait(timeout=max(0.001,deadline-time.monotonic()))==0,'Reviewed transport/stage command failed'
  except BaseException:
   try: os.killpg(child.pid,signal.SIGKILL)
   except ProcessLookupError: pass
   child.wait(timeout=10)
   raise
  finally:
   if child.poll() is None:
    os.killpg(child.pid,signal.SIGKILL); child.wait(timeout=10)
   if child.stdin and not child.stdin.closed: child.stdin.close()
   selector.close(); child.stdout.close()
  log.flush(); os.fsync(log.fileno())

def main():
 parser=argparse.ArgumentParser(description=__doc__)
 parser.add_argument('config',type=Path); parser.add_argument('--config-sha256',required=True)
 parser.add_argument('--phase',choices=('surfaces-stage','source'),required=True)
 args=parser.parse_args()
 assert sys.flags.isolated and os.geteuid()==os.getegid()==0
 os.umask(0o077); signal.alarm(1100)
 def interrupted(signum,frame): raise RuntimeError('TRANSPORT_PARENT_INTERRUPTED')
 for signum in (signal.SIGTERM,signal.SIGINT,signal.SIGALRM): signal.signal(signum,interrupted)
 resource.setrlimit(resource.RLIMIT_CORE,(0,0)); resource.setrlimit(resource.RLIMIT_FSIZE,(1024**2,1024**2))
 config=json.loads(bound(args.config,args.config_sha256,65536))
 assert config['schema']=='proof-of-work-audit29-ui-transport-plan-v1'
 release=config['releaseId']; assert re.fullmatch('[0-9a-f]{12}-[0-9]{8}T[0-9]{6}Z',release)
 assert set(config['helperSha256'])==set(PATHS)
 for directory in (TOOLS.parent,TOOLS):
  info=directory.lstat()
  assert directory.resolve()==directory and stat.S_ISDIR(info.st_mode) and info.st_uid==info.st_gid==0
  assert stat.S_IMODE(info.st_mode)==0o700
 for key,path in PATHS.items(): bound(path,config['helperSha256'][key])
 assert 0<config['sourceAllocatedBytes']<=1024**3
 for kind in ('surfaces','source'):
  part=config[kind]
  assert 0<part['compressedBytes']<=512*1024**2 and re.fullmatch('[0-9a-f]{64}',part['sha256'])
 for phase in ('surfaces-receive','source-receive'):
  allocation=config['admissions'][phase]
  assert 0<allocation['bytes']<=5*1024**3 and 0<allocation['inodes']<=100000
 assert 0<config['stageArchiveUpperBoundBytes']<=2*1024**3 and 0<config['stageInodes']<=100000
 unit='proofofwork-audit29-ui-transport-'+release+'-'+args.phase+'.service'
 value=subprocess.run(['/usr/bin/systemctl','show',unit,'-p','ActiveState','-p','MainPID','-p','KillMode','-p','RuntimeMaxUSec','-p','ControlGroup'],
  env=ENV,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,timeout=10,check=True)
 fields=dict(line.split('=',1) for line in value.stdout.decode().splitlines())
 assert fields['ActiveState']=='active' and fields['MainPID']==str(os.getpid())
 assert fields['KillMode']=='control-group' and fields['RuntimeMaxUSec']=='20min'
 assert fields['ControlGroup'].endswith('/'+unit)
 assert any(line.endswith(':'+fields['ControlGroup']) for line in Path('/proc/self/cgroup').read_text().splitlines())
 lock=Path('/run/proofofwork-ui/deploy.lock'); details=lock.lstat()
 assert lock.resolve()==lock and stat.S_ISREG(details.st_mode) and details.st_uid==details.st_gid==0
 assert details.st_nlink==1 and not details.st_mode & 0o7022
 descriptor=os.open(lock,os.O_RDONLY|os.O_NOFOLLOW)
 try:
  assert identity(os.fstat(descriptor))==identity(details)
  fcntl.flock(descriptor,fcntl.LOCK_EX|fcntl.LOCK_NB)
  env={**ENV,'POW_UI_DEPLOY_LOCK_FD':str(descriptor)}
  namespace={'__name__':'_reviewed_readonly_live_binding'}
  exec(compile(bound(PATHS['retained'],config['helperSha256']['retained']),str(PATHS['retained']),'exec'),namespace)
  live=namespace['fingerprint'](Path('/var/www'))
  assert live['manifestSha256']==config['oldLiveManifestSha256'] and live['treeSha256']==config['oldFullRootTreeSha256']
  base=Path('/var/tmp/proofofwork-deploy')
  output=base/('audit29-transport-'+release+'-'+args.phase)
  assert not os.path.lexists(output)
  # The fixed reserve covers this new private bounded evidence directory.
  for command in ('check-scratch','check'):
   subprocess.run(['/usr/bin/python3','-I','-B',str(PATHS['capacity']),command,'--path',str(base),
      '--additional-bytes',str(4*1024**2),'--additional-inodes','16','--phase','audit29-transport-parent-evidence'],env=env,
      stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=60,check=True)
  output.mkdir(mode=0o700)
  with (output/'intent.json').open('x') as record:
   json.dump({'configSha256':args.config_sha256,'releaseId':release,'continuousParentLock':True},record); record.write('\n')
   record.flush(); os.fsync(record.fileno())
  def admit(phase,allocation=None):
   for key,path in PATHS.items(): bound(path,config['helperSha256'][key])
   allocation=allocation or config['admissions'][phase]
   run(['/usr/bin/python3','-I','-B',str(PATHS['controller']),'admit-ui','--release-id',release,
       '--lock-fd',str(descriptor),'--admission-id',phase,'--additional-bytes',str(allocation['bytes']),
       '--additional-inodes',str(allocation['inodes']), '--helper-sha','capacity='+config['helperSha256']['capacity']],
       output/(phase+'-admission.log'),descriptor,env)
  if args.phase=='source':
   archive=Path('/var/backups/proofofwork-ui/releases')/('proofofwork-ui-release-'+release+'.tgz')
   assert archive.is_file() and not archive.is_symlink()
   expected=Path(str(archive)+'.sha256').read_text().split()[0]
   bound(archive,expected,2*1024**3)
  phases=[('surfaces-receive','surfaces'),('stage',None)] if args.phase=='surfaces-stage' else [('source-receive','source')]
  for phase,kind in phases:
   if kind: admit(phase)
   else:
    payload=base/('proofofwork-ui-surfaces-'+release)/'surfaces'
    # Guarded collector measures current pass-through/compatibility/copy peaks
    # under this exact inherited FD; archive upper bound adds the later overlap.
    run(['/usr/bin/python3','-I','-B',str(PATHS['phase-capacity']),'stage',str(payload)],
        output/'stage-phase-model.json',descriptor,env)
    model=json.loads((output/'stage-phase-model.json').read_text())
    assert model['inputStabilityVerified'] is True and model['installedStagerSha256']==config['installedStagerSha256']
    admit('stage',{'bytes':model['peakAdditionalBytes']+config['stageArchiveUpperBoundBytes'], 'inodes':config['stageInodes']})
   if kind:
    part=config[kind]
    run(['/usr/bin/python3','-I','-B',str(PATHS['receiver']),kind,release,str(part['compressedBytes']),part['sha256']],
        output/(phase+'.log'),descriptor,env,source=sys.stdin.buffer,length=part['compressedBytes'])
   else:
    run(['/bin/bash',str(PATHS['stage-shell']),release,str(config['sourceAllocatedBytes'])],
        output/'stage.log',descriptor,env)
  assert sys.stdin.buffer.read(1)==b'','Extra transport bytes'
  print(json.dumps({'ok':True,'releaseId':release,'evidence':str(output),'productionPublished':False}))
 finally: os.close(descriptor)

if __name__=='__main__':
 try: main()
 except BaseException as error:
  if isinstance(error,SystemExit): raise
  print(json.dumps({'ok':False,'errorClass':type(error).__name__,'evidencePreserved':True}),file=sys.stderr)
  sys.exit(1)
