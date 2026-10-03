import datetime,hashlib,json,os,selectors,shlex,signal,subprocess,time
from pathlib import Path
source=Path('/tmp/pow-audit30-onhost-math-source-finalize-v3.py').read_bytes();assert hashlib.sha256(source).hexdigest()=='256677eaba60acc369f58bbc0c2d28b5ffdf58f1f1a78614f07ccd7d3f124fd7';request=Path('/tmp/pow-audit30-onhost-math-source-finalize-request-v2.json').read_bytes();request_sha=hashlib.sha256(request).hexdigest();assert request_sha=='ce8ea8d18e19361919360a433882f680fd9c6fa3e41aaa9e9f2636645d6f5fb9';base='/tmp/pow-audit30-math-source-finalize-native-v3';files={}
for n in('stdout','stderr'):
 fd=os.open(base+'.'+n,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600);files[n]=os.fdopen(fd,'wb')
started=datetime.datetime.now(datetime.timezone.utc);a=['ssh','-i','/home/sixer/.ssh/proofofwork_node_ed25519','-o','BatchMode=yes','-o','IdentitiesOnly=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=15','powadmin@65.108.122.87','sudo -n /usr/bin/python3 -I -B -c '+shlex.quote(source.decode())+' '+request_sha];p=subprocess.Popen(a,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,start_new_session=True);deadline=time.monotonic()+1140;sel=selectors.DefaultSelector();counts={'stdout':0,'stderr':0};failure=None;written=0
try:
 for f,n in((p.stdout,'stdout'),(p.stderr,'stderr')):os.set_blocking(f.fileno(),False);sel.register(f,selectors.EVENT_READ,n)
 os.set_blocking(p.stdin.fileno(),False);sel.register(p.stdin,selectors.EVENT_WRITE,'stdin')
 while sel.get_map():
  if time.monotonic()>deadline:raise TimeoutError('outer codeonly finalizer bound')
  for k,_ in sel.select(.2):
   if k.data=='stdin':
    try:n=os.write(k.fd,request[written:written+65536])
    except BlockingIOError:continue
    written+=n
    if written==len(request):sel.unregister(k.fileobj);p.stdin.close()
    continue
   b=os.read(k.fd,65536)
   if not b:sel.unregister(k.fileobj);continue
   counts[k.data]+=len(b)
   if counts[k.data]>8*1024**2:raise ValueError('codeonly finalizer capture bound')
   files[k.data].write(b)
 code=p.wait(timeout=10)
except BaseException as ex:
 failure=type(ex).__name__
 if p.poll()is None:os.killpg(p.pid,signal.SIGKILL)
 code=p.wait(timeout=10)
finally:
 sel.close();p.stdout.close();p.stderr.close()
 if not p.stdin.closed:p.stdin.close()
 for f in files.values():f.flush();os.fsync(f.fileno());f.close()
finished=datetime.datetime.now(datetime.timezone.utc);v={'schema':'pow-audit30-math-source-finalize-native-transport-v3','sourceSha256':hashlib.sha256(source).hexdigest(),'requestSha256':request_sha,'requestBytes':len(request),'startedAtUtc':started.isoformat(),'finishedAtUtc':finished.isoformat(),'seconds':(finished-started).total_seconds(),'exitCode':code,'failure':failure,'coreSqlAppStateAccess':False,'sourceTreeRewritten':False,'productionDataMutation':False,'captures':{}}
for n in files:
 b=Path(base+'.'+n).read_bytes();v['captures'][n]={'path':base+'.'+n,'bytes':len(b),'sha256':hashlib.sha256(b).hexdigest()}
raw=(json.dumps(v,sort_keys=True,indent=2)+'\n').encode();fd=os.open(base+'.json',os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
with os.fdopen(fd,'wb')as f:f.write(raw);f.flush();os.fsync(f.fileno())
fd=os.open('/tmp',os.O_RDONLY|os.O_DIRECTORY);os.fsync(fd);os.close(fd);print(json.dumps(v));raise SystemExit(0 if code==0 and failure is None else 1)
