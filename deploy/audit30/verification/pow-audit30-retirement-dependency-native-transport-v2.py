import datetime,hashlib,json,os,selectors,shlex,signal,subprocess,time
from pathlib import Path
source=Path('/tmp/pow-audit30-retirement-dependency-readonly-census-v2.py').read_bytes();assert hashlib.sha256(source).hexdigest()=='00b7a273219c14354dc0d8db231badf0c95b84fe888c4bee7d2b966c8dfad6e9';base='/tmp/pow-audit30-retirement-dependency-native-v2';files={}
for n in('stdout','stderr'):
 fd=os.open(base+'.'+n,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600);files[n]=os.fdopen(fd,'wb')
started=datetime.datetime.now(datetime.timezone.utc);a=['ssh','-i','/home/sixer/.ssh/proofofwork_node_ed25519','-o','BatchMode=yes','-o','IdentitiesOnly=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=15','powadmin@65.108.122.87','sudo -n /usr/bin/python3 -I -B -c '+shlex.quote(source.decode())];p=subprocess.Popen(a,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,start_new_session=True);deadline=time.monotonic()+110;sel=selectors.DefaultSelector();counts={'stdout':0,'stderr':0};failure=None
try:
 for f,n in((p.stdout,'stdout'),(p.stderr,'stderr')):os.set_blocking(f.fileno(),False);sel.register(f,selectors.EVENT_READ,n)
 while sel.get_map():
  if time.monotonic()>deadline:raise TimeoutError('outer dependency metadata bound')
  for k,_ in sel.select(.2):
   b=os.read(k.fd,65536)
   if not b:sel.unregister(k.fileobj);continue
   counts[k.data]+=len(b)
   if counts[k.data]>(32*1024**2 if k.data=='stdout'else 1024**2):raise ValueError('dependency metadata capture bound')
   files[k.data].write(b)
 code=p.wait(timeout=10)
except BaseException as ex:
 failure=type(ex).__name__
 if p.poll()is None:os.killpg(p.pid,signal.SIGKILL)
 code=p.wait(timeout=10)
finally:
 sel.close();p.stdout.close();p.stderr.close()
 for f in files.values():f.flush();os.fsync(f.fileno());f.close()
finished=datetime.datetime.now(datetime.timezone.utc);v={'schema':'pow-audit30-retirement-dependency-native-transport-v2','sourceSha256':hashlib.sha256(source).hexdigest(),'startedAtUtc':started.isoformat(),'finishedAtUtc':finished.isoformat(),'seconds':(finished-started).total_seconds(),'exitCode':code,'failure':failure,'coreSqlAppStateAccess':False,'productionDataMutation':False,'captures':{}}
for n in files:
 b=Path(base+'.'+n).read_bytes();v['captures'][n]={'path':base+'.'+n,'bytes':len(b),'sha256':hashlib.sha256(b).hexdigest()}
raw=(json.dumps(v,sort_keys=True,indent=2)+'\n').encode();fd=os.open(base+'.json',os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
with os.fdopen(fd,'wb')as f:f.write(raw);f.flush();os.fsync(f.fileno())
fd=os.open('/tmp',os.O_RDONLY|os.O_DIRECTORY);os.fsync(fd);os.close(fd);print(json.dumps(v));raise SystemExit(0 if code==0 and failure is None else 1)
