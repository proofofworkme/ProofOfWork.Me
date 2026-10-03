import datetime,hashlib,json,os,selectors,shlex,signal,subprocess,sys,time
from pathlib import Path
assert len(sys.argv)==2 and sys.argv[1]in('ui','node');role=sys.argv[1]
specraw=Path('/tmp/pow-audit30-fresh-resource-command-specs-v1.json').read_bytes();assert hashlib.sha256(specraw).hexdigest()=='8f05dcf43925cd50b81072388a040dcd949080fee06e53ebe6df79eee9a8943e';spec=json.loads(specraw);r=spec['roles'][role];source=Path(spec['collector']['path']).read_bytes();assert hashlib.sha256(source).hexdigest()==spec['collector']['sha256'];files={}
for n in('stdout','stderr'):
 fd=os.open(r[n],os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600);files[n]=os.fdopen(fd,'wb')
started=datetime.datetime.now(datetime.timezone.utc);remote=('sudo -n 'if role=='node'else'')+'/usr/bin/python3 -I -B -c '+shlex.quote(source.decode())+' '+role;a=r['sshPrefixArgv']+[remote];p=subprocess.Popen(a,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,start_new_session=True);deadline=time.monotonic()+45;sel=selectors.DefaultSelector();counts={'stdout':0,'stderr':0};failure=None
try:
 for f,n in((p.stdout,'stdout'),(p.stderr,'stderr')):os.set_blocking(f.fileno(),False);sel.register(f,selectors.EVENT_READ,n)
 while sel.get_map():
  if time.monotonic()>deadline:raise TimeoutError('outer fixed sampler bound')
  for k,_ in sel.select(.2):
   b=os.read(k.fd,65536)
   if not b:sel.unregister(k.fileobj);continue
   counts[k.data]+=len(b)
   if counts[k.data]>1024**2:raise ValueError('sampler capture bound')
   files[k.data].write(b)
 code=p.wait(timeout=10)
except BaseException as ex:
 failure=type(ex).__name__
 if p.poll()is None:os.killpg(p.pid,signal.SIGKILL)
 code=p.wait(timeout=10)
finally:
 sel.close();p.stdout.close();p.stderr.close()
 for f in files.values():f.flush();os.fsync(f.fileno());f.close()
finished=datetime.datetime.now(datetime.timezone.utc);v={'schema':'pow-audit30-fresh-resource-native-transport-v1','role':role,'sourceSha256':hashlib.sha256(source).hexdigest(),'commandSpecsSha256':hashlib.sha256(specraw).hexdigest(),'startedAtUtc':started.isoformat(),'finishedAtUtc':finished.isoformat(),'seconds':(finished-started).total_seconds(),'exitCode':code,'failure':failure,'sqlServicesDumpBodyEnvironmentAccess':False,'productionDataMutation':False,'concurrentContext':spec['concurrentContext'],'captures':{}}
for n in files:
 b=Path(r[n]).read_bytes();v['captures'][n]={'path':r[n],'bytes':len(b),'sha256':hashlib.sha256(b).hexdigest()}
raw=(json.dumps(v,sort_keys=True,indent=2)+'\n').encode();fd=os.open(r['transport'],os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
with os.fdopen(fd,'wb')as f:f.write(raw);f.flush();os.fsync(f.fileno())
fd=os.open('/tmp',os.O_RDONLY|os.O_DIRECTORY);os.fsync(fd);os.close(fd);print(json.dumps(v));raise SystemExit(0 if code==0 and failure is None else 1)
