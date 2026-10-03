#!/usr/bin/python3 -I
"""Real local child signals/reaping only; no PG/systemd/network/restore invocation."""
import hashlib,json,os,signal,subprocess,sys,tempfile,time,types,unittest
from pathlib import Path
OLD=Path('/home/sixer/ProofOfWork.Me/deploy/audit30/restore-latest-logical.py');V1=Path('/tmp/pow-audit30-latest-logical-restore-signal-successor-v1.py');V2=Path('/tmp/pow-audit30-latest-logical-restore-signal-successor-v2.py')
OLD_SHA='26c7656b2e751c6de50122c65f8af73686c2d2674bee8be86a3c5648b7fcc80e';V1_SHA='a9c9d91dac1876710535140c2b13777b4cd2e8fc0e2e9d4a0a2f88df5a319982'

def loaded(path):
 m=types.ModuleType('fixture');m.__file__=str(path);exec(compile(path.read_bytes(),str(path),'exec'),m.__dict__);return m

def wait_file(path,seconds=4):
 end=time.monotonic()+seconds
 while not path.exists()and time.monotonic()<end:time.sleep(.01)
 if not path.exists():raise AssertionError('Literal-child readiness not reached')

RUNNER_HELPER=r'''
import json,os,signal,subprocess,sys,time,types
from pathlib import Path
source,root,mode=sys.argv[1:];root=Path(root);C=types.ModuleType('fixture');C.__file__=source;exec(compile(Path(source).read_bytes(),source,'exec'),C.__dict__)
tracked=[];original=C.subprocess.Popen

def tracked_popen(*a,**kw):
 p=original(*a,**kw);tracked.append(p);return p
C.subprocess.Popen=tracked_popen

def interrupted(n,f):
 if mode=='old-selector':raise InterruptedError('fixture-first-'+str(n))
 raise C.RestoreInterrupted('fixture-first-'+str(n))
old={s:signal.signal(s,interrupted)for s in(signal.SIGTERM,signal.SIGINT,signal.SIGHUP)}
ready=root/'child-ready';term=root/'child-term';pid=root/'child-pid';start=time.monotonic()
child='import os,signal,time;from pathlib import Path;root=Path('+repr(str(root))+');(root/"child-pid").write_text(str(os.getpid()));'
if mode=='cleanup':child+='signal.signal(signal.SIGTERM,lambda n,f:(root/"child-term").write_text("term"));'
child+='(root/"child-ready").write_text("ready");time.sleep(30)'
class Watch:
 def assert_alive(self):
  if mode=='cleanup'and ready.exists():raise ValueError('first-source-work-failure')
try:C.Runner(root,Watch()).run([sys.executable,'-I','-B','-c',child],'literal-child',timeout=.6 if mode=='old-selector'else10)
except BaseException as e:
 alive=tracked[0].poll()is None;result=dict(errorClass=type(e).__name__,message=str(e),seconds=time.monotonic()-start,childAliveBeforeFixtureCleanup=alive,handlersRestored=all(signal.getsignal(s)==interrupted for s in old),stderrExists=(root/'01-literal-child.stderr').exists())
 for s in old:signal.signal(s,signal.SIG_IGN)
 if alive:
  try:os.killpg(tracked[0].pid,signal.SIGKILL)
  except ProcessLookupError:pass
 tracked[0].wait(timeout=3);result['fixtureOwnedChildReaped']=True;(root/'result').write_text(json.dumps(result))
finally:
 for s,h in old.items():signal.signal(s,h)
'''

EXECUTE_HELPER=r'''
import hashlib,json,os,signal,subprocess,sys,time,types
from pathlib import Path
from unittest.mock import patch
source,root=sys.argv[1:];root=Path(root);C=types.ModuleType('fixture');C.__file__=source;exec(compile(Path(source).read_bytes(),source,'exec'),C.__dict__)
job=root/'job';job.mkdir(mode=0o700);backup=root/'backups';backup.mkdir();source_dir=backup/'proof_indexer-20261003T031852Z.dumpset';source_dir.mkdir(mode=0o700)
for name in C.MEMBERS:(source_dir/name).write_bytes(b'literal-fixture');(source_dir/name).chmod(0o600)
lock=backup/'.proofofwork-postgres-logical-backup.lock';lock.touch();lock.chmod(0o600);C.BACKUPS=backup;C.LOCK=lock
who=types.SimpleNamespace(pw_uid=os.getuid(),pw_gid=os.getgid());origmeta=C.metadata

def meta(p):
 r=origmeta(p)
 if str(p)in(source,str(Path(source).parent)):r['uid']=0
 return r
C.metadata=meta;C.pwd.getpwnam=lambda _:who
C.check_runtime=C.check_live=C.check_window=lambda _:None
C.storage_sample=lambda *a,**k:{}

def hash_file(p,*a,**k):
 if str(p)==source:return 'a'*64
 raise ValueError('first-source-work-failure')
C.hash_file=hash_file
class Watch:
 def __init__(self,*a):pass
 def start(self):pass
 def stop(self):(root/'watch-stopped').write_text('true')
C.Watchdog=Watch
stop_child=None

def private_stop(*a):
 global stop_child
 child='import time;from pathlib import Path;Path('+repr(str(root/'cleanup-ready'))+').write_text("ready");time.sleep(.5)'
 stop_child=subprocess.Popen([sys.executable,'-I','-B','-c',child]);stop_child.wait(timeout=2)
C.stop_private=private_stop
plan={'job':str(job),'controllerSha256':'a'*64,'backup':{'path':str(source_dir),'directory':origmeta(source_dir),'members':{n:origmeta(source_dir/n)|{'sha256':'b'*64}for n in C.MEMBERS}},'backupLock':origmeta(lock)}
handlers={n:signal.getsignal(n)for n in(signal.SIGTERM,signal.SIGINT,signal.SIGHUP)}
try:C.execute(plan,'c'*64)
except BaseException as e:
 result=dict(errorClass=type(e).__name__,message=str(e),handlersRestored=all(signal.getsignal(n)==h for n,h in handlers.items()),failed=json.loads((job/'failed.json').read_bytes()),watchStopped=(root/'watch-stopped').exists(),literalStopChildReaped=stop_child.poll()is not None)
 import fcntl
 fd=os.open(lock,os.O_RDONLY)
 try:fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB);result['lockClosedAndReleased']=True
 finally:os.close(fd)
 (root/'result').write_text(json.dumps(result))
'''

class Signals(unittest.TestCase):
 def run_runner(self,source,mode,repeated=False):
  with tempfile.TemporaryDirectory()as d:
   root=Path(d);p=subprocess.Popen([sys.executable,'-I','-B','-c',RUNNER_HELPER,str(source),d,mode],stdout=subprocess.PIPE,stderr=subprocess.PIPE)
   try:
    wait_file(root/'child-ready')
    if mode=='cleanup':
     wait_file(root/'child-term');p.send_signal(signal.SIGINT)
     if repeated:p.send_signal(signal.SIGHUP);p.send_signal(signal.SIGTERM)
    else:p.send_signal(signal.SIGTERM)
    out,err=p.communicate(timeout=9);self.assertEqual(p.returncode,0,(out,err));v=json.loads((root/'result').read_bytes());self.assertTrue(v['fixtureOwnedChildReaped']);self.assertTrue(v['stderrExists'])
    with self.assertRaises(ProcessLookupError):os.kill(int((root/'child-pid').read_text()),0)
    return v
   finally:
    if p.poll()is None:p.kill();p.wait()
    p.stdout.close();p.stderr.close()
 def test_originals_raw_pins_preserved(self):
  self.assertEqual(hashlib.sha256(OLD.read_bytes()).hexdigest(),OLD_SHA);self.assertEqual(hashlib.sha256(V1.read_bytes()).hexdigest(),V1_SHA)
 def test_real_original_interruptederror_swallowed(self):
  v=self.run_runner(OLD,'old-selector');self.assertEqual(v['errorClass'],'TimeoutError');self.assertFalse(v['childAliveBeforeFixtureCleanup']);self.assertGreaterEqual(v['seconds'],.6)
 def test_real_custom_signal_propagates_and_reaps(self):
  v=self.run_runner(V2,'new-selector');self.assertEqual(v['errorClass'],'RestoreInterrupted');self.assertFalse(v['childAliveBeforeFixtureCleanup']);self.assertLess(v['seconds'],.6);self.assertTrue(v['handlersRestored'])
 def test_actual_v1_repeat_interrupts_cleanup_reproduced(self):
  v=self.run_runner(V1,'cleanup');self.assertEqual(v['errorClass'],'RestoreInterrupted');self.assertTrue(v['childAliveBeforeFixtureCleanup']);self.assertTrue(v['fixtureOwnedChildReaped'])
 def test_actual_v2_repeated_signals_preserve_first_and_reap(self):
  v=self.run_runner(V2,'cleanup',True);self.assertEqual(v['errorClass'],'ValueError');self.assertEqual(v['message'],'first-source-work-failure');self.assertFalse(v['childAliveBeforeFixtureCleanup']);self.assertGreaterEqual(v['seconds'],5);self.assertTrue(v['handlersRestored'])
 def test_actual_execute_cleanup_masks_repeats_and_durable_first(self):
  with tempfile.TemporaryDirectory()as d:
   root=Path(d);p=subprocess.Popen([sys.executable,'-I','-B','-c',EXECUTE_HELPER,str(V2),d],stdout=subprocess.PIPE,stderr=subprocess.PIPE)
   try:
    wait_file(root/'cleanup-ready');p.send_signal(signal.SIGINT);p.send_signal(signal.SIGTERM);p.send_signal(signal.SIGHUP);out,err=p.communicate(timeout=4);self.assertEqual(p.returncode,0,(out,err));v=json.loads((root/'result').read_bytes());self.assertEqual(v['errorClass'],'ValueError');self.assertEqual(v['message'],'first-source-work-failure');self.assertTrue(v['failed']['privateStopVerified']);self.assertEqual(v['failed']['errorClass'],'ValueError');self.assertTrue(v['watchStopped']);self.assertTrue(v['handlersRestored']);self.assertTrue(v['lockClosedAndReleased']);self.assertTrue(v['literalStopChildReaped']);self.assertFalse(v['failed']['automaticRetry'])
   finally:
    if p.poll()is None:p.kill();p.wait()
    p.stdout.close();p.stderr.close()
 def test_all_other_top_level_definitions_ast_unchanged(self):
  import ast
  original=ast.parse(OLD.read_text());new=ast.parse(V2.read_text())
  def mapping(tree):return {x.name:ast.dump(x,include_attributes=False)for x in tree.body if isinstance(x,(ast.FunctionDef,ast.ClassDef))}
  a,b=mapping(original),mapping(new)
  self.assertEqual(set(b)-set(a),{'RestoreInterrupted'});self.assertEqual(set(a)-set(b),set())
  for k in a:
   if k not in ('Runner','execute'):self.assertEqual(a[k],b[k],k)
if __name__=='__main__':unittest.main()
