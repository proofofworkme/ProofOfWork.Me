import fcntl,hashlib,json,os,pathlib,re,resource,selectors,signal,stat,subprocess,sys,time
plan_path,plan_sha,commit,tree,attempt=sys.argv[1:]
assert re.fullmatch('[a-z0-9][a-z0-9-]{0,30}',attempt)
assert sys.flags.isolated and os.geteuid()==os.getegid()==0
os.umask(0o077); resource.setrlimit(resource.RLIMIT_CORE,(0,0))
resource.setrlimit(resource.RLIMIT_FSIZE,(2*1024**3,2*1024**3))
def identity(s):
 return (s.st_dev,s.st_ino,s.st_mode,s.st_uid,s.st_gid,s.st_nlink,s.st_size,s.st_mtime_ns,s.st_ctime_ns)
def load_bound(path,sha,limit=65536):
 p=pathlib.Path(path); s=p.lstat()
 assert p.resolve()==p and stat.S_ISREG(s.st_mode) and s.st_uid==s.st_gid==0 and s.st_nlink==1 and not s.st_mode & 0o7022 and s.st_size<=limit
 fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW)
 with os.fdopen(fd,'rb') as f:
  assert identity(os.fstat(f.fileno()))==identity(s)
  data=f.read(limit+1);assert identity(os.fstat(f.fileno()))==identity(s)
 assert identity(p.lstat())==identity(s) and len(data)==s.st_size and hashlib.sha256(data).hexdigest()==sha
 return data
def durable_json(path,value):
 with path.open('x') as f:
  json.dump(value,f,indent=2);f.write('\n');f.flush();os.fsync(f.fileno())
 fd=os.open(path.parent,os.O_RDONLY|os.O_DIRECTORY)
 try: os.fsync(fd)
 finally: os.close(fd)
plan=json.loads(load_bound(plan_path,plan_sha)); release=plan['releaseId']
assert plan['commit']==commit and plan['tree']==tree and release.startswith(commit[:12]+'-')
assert plan['publicationAttempt']==attempt and plan['frontendOnly'] is True and plan['retentionDeferred'] is True
expected_paths={'retained':'/usr/local/sbin/proofofwork-ui-retained-root','capacity':'/usr/local/sbin/proofofwork-ui-capacity','publisher':'/usr/local/sbin/proofofwork-ui-release-publish','stager':'/usr/local/sbin/proofofwork-ui-release-stage','provenance':'/usr/local/sbin/proofofwork-ui-release-provenance'}
assert set(plan['publicationHelpers'])==set(expected_paths)
for key,record in plan['publicationHelpers'].items():
 assert record['path']==expected_paths[key]
 load_bound(record['path'],record['sha256'],2*1024**2)
unit='proofofwork-recovery-release-'+release+'-ui-'+attempt+'.service'
fields=dict(line.split('=',1) for line in subprocess.check_output(['/usr/bin/systemctl','show',unit,'-p','ActiveState','-p','MainPID','-p','KillMode','-p','RuntimeMaxUSec','-p','ControlGroup'],timeout=10,text=True).splitlines())
assert fields['ActiveState']=='active' and fields['MainPID']==str(os.getpid()) and fields['KillMode']=='control-group' and fields['RuntimeMaxUSec']=='30min'
assert fields['ControlGroup'].endswith('/'+unit) and any(line.endswith(':'+fields['ControlGroup']) for line in pathlib.Path('/proc/self/cgroup').read_text().splitlines())
lock_path=pathlib.Path('/run/proofofwork-ui/deploy.lock'); ls=lock_path.lstat()
assert lock_path.resolve()==lock_path and stat.S_ISREG(ls.st_mode) and ls.st_uid==ls.st_gid==0 and ls.st_nlink==1 and not ls.st_mode & 0o7022
fd=os.open(lock_path,os.O_RDONLY|os.O_NOFOLLOW); assert identity(os.fstat(fd))==identity(ls) and identity(lock_path.lstat())==identity(ls); fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
env={'PATH':'/usr/sbin:/usr/bin:/sbin:/bin','LC_ALL':'C','GIT_OPTIONAL_LOCKS':'0','POW_UI_DEPLOY_LOCK_FD':str(fd)}
ns={'__name__':'_recovery_publisher_fingerprint'}
record=plan['publicationHelpers']['retained'];exec(compile(load_bound(record['path'],record['sha256'],2*1024**2),record['path'],'exec'),ns)
live=ns['fingerprint'](pathlib.Path('/var/www'))
assert live['manifestSha256']==plan['oldLiveManifestSha256'] and live['treeSha256']==plan['oldFullRootTreeSha256']
roots=sorted(pathlib.Path('/var/backups/proofofwork-ui/rollback-roots').glob('proofofwork-www-pre-*'))
assert [str(p) for p in roots]==[r['root'] for r in plan['retainedRoots']]
for p,r in zip(roots,plan['retainedRoots']):
 current=ns['fingerprint'](p);assert current['manifestSha256']==r['manifestSha256'] and current['treeSha256']==r['treeSha256']
source='/var/tmp/proofofwork-deploy/proofofwork-ui-source-'+release
for ref,expected in [('HEAD',commit),('HEAD^{tree}',tree)]:
 assert subprocess.check_output(['git','-C',source,'rev-parse',ref],env=env,timeout=20,text=True).strip()==expected
assert subprocess.run(['git','-C',source,'symbolic-ref','-q','HEAD'],env=env,stdout=subprocess.DEVNULL,timeout=20).returncode==1
assert not subprocess.check_output(['git','-C',source,'status','--porcelain','--untracked-files=all'],env=env,timeout=30)
capacity=plan['publicationHelpers']['capacity']['path']
for command in ['check-scratch','check']:
 subprocess.run(['/usr/bin/python3','-I','-B',capacity,command,'--path','/var/tmp/proofofwork-deploy','--additional-bytes',str(8*1024**2),'--additional-inodes','32','--phase','recovery-publication-evidence'],env=env,pass_fds=(fd,),timeout=60,check=True,stdout=subprocess.DEVNULL)
out=pathlib.Path('/var/tmp/proofofwork-deploy/recovery-publish-'+release+'-'+attempt)
out.mkdir(mode=0o700)
parent_fd=os.open(out.parent,os.O_RDONLY|os.O_DIRECTORY);os.fsync(parent_fd);os.close(parent_fd)
intent={'attempt':attempt,'releaseId':release,'commit':commit,'tree':tree,'planSha256':plan_sha,'oldLive':live,'retainedRoots':plan['retainedRoots'],'retentionDeferred':True,'startedAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())}
durable_json(out/'intent.json',intent)
archive='/var/backups/proofofwork-ui/releases/proofofwork-ui-release-'+release+'.tgz'
args=[plan['publicationHelpers']['publisher']['path'],'--release-id',release,'--commit',commit,'--source-checkout',source,'--archive',archive,'--defer-verified-retention']
for r in plan['retainedRoots']: args+=['--retain-rollback-root',pathlib.Path(r['root']).name+':'+r['manifestSha256']+':'+r['treeSha256']]
with (out/'publisher.log').open('xb') as log:
 for record in plan['publicationHelpers'].values(): load_bound(record['path'],record['sha256'],2*1024**2)
 child=subprocess.Popen(args,env=env,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,pass_fds=(fd,),start_new_session=True)
 sel=selectors.DefaultSelector();sel.register(child.stdout,selectors.EVENT_READ)
 deadline=time.monotonic()+1200;count=0;failed=None;recovering=False
 try:
  while sel.get_map():
   if time.monotonic()>=deadline:
    if recovering:
     os.killpg(child.pid,signal.SIGKILL);break
    failed='publisher timeout';os.killpg(child.pid,signal.SIGTERM);recovering=True;deadline=time.monotonic()+180
   for key,_ in sel.select(timeout=0.5):
    block=os.read(key.fileobj.fileno(),65536)
    if not block: sel.unregister(key.fileobj);continue
    allowed=max(0,4*1024**2-count);log.write(block[:allowed]);count+=len(block)
    if count>4*1024**2 and not recovering:
     failed='publisher log ceiling exceeded';os.killpg(child.pid,signal.SIGTERM);recovering=True;deadline=time.monotonic()+180
  try: code=child.wait(timeout=max(0.001,deadline-time.monotonic()))
  except subprocess.TimeoutExpired:
   failed=failed or 'publisher exit timeout';os.killpg(child.pid,signal.SIGKILL);code=child.wait(timeout=15)
 finally:
  if child.poll() is None:
   os.killpg(child.pid,signal.SIGKILL);child.wait(timeout=15)
  sel.close();child.stdout.close();log.flush();os.fsync(log.fileno())
receipt={'attempt':attempt,'releaseId':release,'commit':commit,'tree':tree,'exitCode':code,'failure':failed,'capturedLogBytes':min(count,4*1024**2),'evidence':str(out),'finishedAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'publisherLogSha256':hashlib.sha256((out/'publisher.log').read_bytes()).hexdigest()}
durable_json(out/'receipt.json',receipt)
print(json.dumps(receipt));sys.stdout.flush()
assert code==0 and failed is None,'Publisher refused; evidence and complete roots preserved'
manifest=pathlib.Path('/var/www/.proofofwork-ui-release').read_bytes()
assert manifest==pathlib.Path(archive+'.provenance').read_bytes()
fields=dict(line.split('=',1) for line in manifest.decode().splitlines())
assert fields['release_id']==release and fields['commit']==commit and fields['source_tree']==tree
for p,r in zip(roots,plan['retainedRoots']):
 current=ns['fingerprint'](p);assert current['manifestSha256']==r['manifestSha256'] and current['treeSha256']==r['treeSha256']
recovery=pathlib.Path('/var/backups/proofofwork-ui/rollback-roots/proofofwork-www-pre-'+release)
recovery_fingerprint=ns['fingerprint'](recovery)
assert recovery_fingerprint['manifestSha256']==live['manifestSha256'] and recovery_fingerprint['treeSha256']==live['treeSha256']
print(json.dumps({'ok':True,'manifestSha256':hashlib.sha256(manifest).hexdigest(),'archiveSha256':fields['archive_sha256'],'allPriorRootsPreserved':True,'newRollbackRoot':recovery_fingerprint}))
