import ast,hashlib,json,os,pathlib,signal,subprocess,sys,tempfile,time
SOURCE=pathlib.Path('/tmp/pow-audit30-node-shadow-lease-38ac-v1.py')
raw=SOURCE.read_bytes();assert hashlib.sha256(raw).hexdigest()=='02dc0c234f51a4dab94c8b7ecc4eac390bc96b3db7b4f486deedcdc0efe45331'
t=ast.parse(raw);remote=next(ast.literal_eval(n.value)for n in t.body if isinstance(n,ast.Assign)and any(isinstance(x,ast.Name)and x.id=='REMOTE'for x in n.targets));rt=ast.parse(remote)
functions=ast.Module(body=[n for n in rt.body if isinstance(n,ast.FunctionDef)and n.name in {'need','call','interrupted','stop_owned'}],type_ignores=[])
body=ast.unparse(functions)
CHILD=r'''
import json,os,pathlib,signal,subprocess,sys
ENV={'PATH':'/usr/bin:/bin','LC_ALL':'C'}
exec(BODY)
signal.signal(signal.SIGTERM,interrupted);signal.signal(signal.SIGINT,interrupted)
marker=pathlib.Path(sys.argv[1]);owned=[];first=None
try:
 call([sys.executable,'-I','-B','-c',"import os,pathlib,sys;pathlib.Path(sys.argv[1]).write_text(str(os.getpid()));sys.stdin.buffer.read()",str(marker)],30)
 raise AssertionError('blocked helper returned unexpectedly')
except BaseException as e:
 first=(type(e).__name__,str(e))
 signal.signal(signal.SIGTERM,signal.SIG_IGN);signal.signal(signal.SIGINT,signal.SIG_IGN)
 UNIT='fixture-shadow.service';TOOLS=pathlib.Path('/fixture/tools');states=[{'LoadState':'loaded','InvocationID':'a'*32,'ExecStart':str(TOOLS/'private-env.py')},{'MainPID':'0'}]
 def state(unit):
  assert unit==UNIT
  return states.pop(0)
 def call(argv,timeout):
  assert argv==['/usr/bin/systemctl','stop',UNIT] and timeout==40
  os.kill(os.getpid(),signal.SIGINT);os.kill(os.getpid(),signal.SIGTERM)
  owned.append(argv)
 stop_owned('a'*32)
print(json.dumps({'first':first,'ownedStopCommands':owned,'cleanupFinished':True}))
'''
results=[]
for sig in (signal.SIGTERM,signal.SIGINT):
 with tempfile.TemporaryDirectory(prefix='pow-audit30-shadow-signal-fixture-')as directory:
  marker=pathlib.Path(directory)/'child-pid';program='BODY='+repr(body)+'\n'+CHILD
  p=subprocess.Popen([sys.executable,'-I','-B','-c',program,str(marker)],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
  try:
   deadline=time.monotonic()+5
   while not marker.exists():
    assert p.poll()is None and time.monotonic()<deadline,'child did not enter actual blocked communicate'
    time.sleep(.01)
   pid=int(marker.read_text());os.kill(p.pid,sig);out,err=p.communicate(timeout=5)
   assert p.returncode==0 and not err,(p.returncode,err)
   row=json.loads(out);assert row['first']==['RuntimeError','SHADOW_PREPARE_SIGNAL'] and row['cleanupFinished'] and len(row['ownedStopCommands'])==1,row
   assert not pathlib.Path('/proc',str(pid)).exists(),'own helper not reaped'
   results.append({'signal':signal.Signals(sig).name,'actualBlockedCommunicate':True,'firstExceptionRuntimeError':True,'ownHelperReaped':True,'repeatedSignalsDuringCleanupIgnored':True,'ownedStopExactlyOnce':True})
  finally:
   if p.poll()is None:p.kill();p.communicate(timeout=5)
print(json.dumps({'schema':'pow-audit30-independent-shadow-lease-real-signal-v1','sourceSha256':hashlib.sha256(raw).hexdigest(),'passed':len(results),'cases':results,'networkOrSystemctlExecuted':False},sort_keys=True))
