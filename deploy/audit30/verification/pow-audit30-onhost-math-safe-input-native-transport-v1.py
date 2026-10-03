"""Future fixed read-only transport; requires an actual separately reviewed request.

No request has been created at REQUEST, and no native execution is authorized.
The preparation template deliberately contains null stream pins and is refused.
"""
import datetime,hashlib,importlib.util,json,os,pathlib,re,selectors,shlex,signal,subprocess,sys,time
P=pathlib.Path
SOURCE=P('/tmp/pow-audit30-onhost-math-safe-input-census-v1.py')
SOURCE_SHA='ab2e695d751f5126ae0a5767d8c705f372cf33e7018d5364ba1ceb60c7925af3'
REQUEST=P('/tmp/pow-audit30-onhost-math-safe-input-request-v1.json')
BASE='/tmp/pow-audit30-onhost-math-safe-input-census-native-v1'
CAP=1024**2
class Refused(Exception):pass
def need(v,c):
 if not v:raise Refused(c)
def sha(b):return hashlib.sha256(b).hexdigest()
def canonical(v):return json.dumps(v,sort_keys=True,separators=(',',':')).encode()
def inputs(h):
 need(re.fullmatch('[a-f0-9]{64}',h)is not None,'SAFE_INPUT_OUTER_REQUEST_ARGUMENT')
 source=SOURCE.read_bytes();need(len(source)<=65536 and sha(source)==SOURCE_SHA,'SAFE_INPUT_OUTER_SOURCE_PIN');raw=REQUEST.read_bytes();need(0<len(raw)<=CAP and sha(raw)==h,'SAFE_INPUT_OUTER_REQUEST_PIN')
 spec=importlib.util.spec_from_file_location('fixed_safe_census',SOURCE);m=importlib.util.module_from_spec(spec)
 # Execute exactly the bytes already hashed, rather than reopening source.
 exec(compile(source,str(SOURCE),'exec'),m.__dict__);r=m.parse(raw);need(m.encoded(r)==raw,'SAFE_INPUT_OUTER_CANONICAL_REQUEST');m.validate_request(r)
 return source,raw

def remote(source,h):return ['ssh','-i','/home/sixer/.ssh/proofofwork_node_ed25519','-o','BatchMode=yes','-o','IdentitiesOnly=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=15','powadmin@65.108.122.87','sudo -n /usr/bin/python3 -I -B -c '+shlex.quote(source.decode())+' '+h]

def run(source,raw,h):
 files={};counts={'stdout':0,'stderr':0};failure=None;code=None;proc=None;sel=selectors.DefaultSelector();start=datetime.datetime.now(datetime.timezone.utc);old={s:signal.getsignal(s)for s in(signal.SIGTERM,signal.SIGINT,signal.SIGHUP)}
 def interrupted(s,f):raise Refused('SAFE_INPUT_OUTER_INTERRUPTED')
 for s in old:signal.signal(s,interrupted)
 try:
  for n in counts:
   fd=os.open(BASE+'.'+n,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600);files[n]=os.fdopen(fd,'wb')
  # Exclusive capture collision is refused before any SSH process is launched.
  proc=subprocess.Popen(remote(source,h),stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,start_new_session=True);deadline=time.monotonic()+240;written=0
  for pipe,n in((proc.stdout,'stdout'),(proc.stderr,'stderr')):os.set_blocking(pipe.fileno(),False);sel.register(pipe,selectors.EVENT_READ,n)
  os.set_blocking(proc.stdin.fileno(),False);sel.register(proc.stdin,selectors.EVENT_WRITE,'stdin')
  while sel.get_map():
   need(time.monotonic()<deadline,'SAFE_INPUT_OUTER_240S_BOUND')
   for key,_ in sel.select(.2):
    if key.data=='stdin':
     try:n=os.write(key.fd,raw[written:written+65536])
     except BlockingIOError:continue
     written+=n
     if written==len(raw):sel.unregister(key.fileobj);proc.stdin.close()
     continue
    b=os.read(key.fd,65536)
    if not b:sel.unregister(key.fileobj);continue
    counts[key.data]+=len(b);need(counts[key.data]<=CAP,'SAFE_INPUT_OUTER_CHANNEL_CAP');files[key.data].write(b)
  code=proc.wait(timeout=10)
 except BaseException as ex:
  failure=str(ex)if isinstance(ex,Refused)else type(ex).__name__
  for s in old:signal.signal(s,signal.SIG_IGN)
  if proc is not None:
   if proc.poll()is None:os.killpg(proc.pid,signal.SIGKILL)
   code=proc.wait(timeout=10)
 finally:
  sel.close()
  if proc is not None:
   for p in(proc.stdout,proc.stderr,proc.stdin):
    if not p.closed:p.close()
  for f in files.values():f.flush();os.fsync(f.fileno());f.close()
  for s,v in old.items():signal.signal(s,v)
 finish=datetime.datetime.now(datetime.timezone.utc);v=dict(schema='pow-audit30-onhost-math-safe-input-native-transport-v1',sourceSha256=sha(source),requestSha256=h,requestBytes=len(raw),startedAtUtc=start.isoformat(),finishedAtUtc=finish.isoformat(),seconds=(finish-start).total_seconds(),returnCode=code,failure=failure,remoteSqlCoreOrUnitControl=False,remoteWrites=False,privatePayloadExported=False,captures={})
 for n in files:
  b=P(BASE+'.'+n).read_bytes();v['captures'][n]=dict(path=BASE+'.'+n,bytes=len(b),sha256=sha(b))
 out=canonical(v);fd=os.open(BASE+'.json',os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
 with os.fdopen(fd,'wb')as f:f.write(out);f.flush();os.fsync(f.fileno())
 fd=os.open('/tmp',os.O_RDONLY|os.O_DIRECTORY);os.fsync(fd);os.close(fd);return v

def main():
 need(len(sys.argv)==2,'SAFE_INPUT_OUTER_ARGUMENT');source,raw=inputs(sys.argv[1]);v=run(source,raw,sys.argv[1]);print(json.dumps(v,sort_keys=True));return 0 if v['returnCode']==0 and v['failure']is None else 1
if __name__=='__main__':
 try:code=main()
 except BaseException as e:print(json.dumps(dict(status='refused',code=str(e)if isinstance(e,Refused)else type(e).__name__,nativeCompletionClaimed=False)));code=1
 sys.exit(code)
