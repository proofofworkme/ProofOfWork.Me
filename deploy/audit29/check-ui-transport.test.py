import fcntl, hashlib, importlib.util, io, json, os, subprocess, sys, tempfile, time, unittest
from pathlib import Path
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('prepared_transport',Path(__file__).with_name('ui-transport.py'))
transport=importlib.util.module_from_spec(spec); spec.loader.exec_module(transport)

class Sink(io.BytesIO):
 def close(self): self.closed_by_feed=True

class PreparedTransport(unittest.TestCase):
 def test_bound_reader_pins_hash_and_refuses_alias_writable_or_changed_bytes(self):
  with tempfile.TemporaryDirectory() as folder:
   file=Path(folder)/'approved.json'; file.write_bytes(b'approved'); file.chmod(0o600)
   digest=hashlib.sha256(b'approved').hexdigest()
   lstat, fstat=Path.lstat,os.fstat
   def private_root_metadata(info):
    values=list(info); values[4]=values[5]=0
    return os.stat_result(values)
   with patch.object(Path,'lstat',lambda path:private_root_metadata(lstat(path))), \
        patch.object(transport.os,'fstat',lambda fd:private_root_metadata(fstat(fd))):
    self.assertEqual(transport.bound(file,digest),b'approved')
    with self.assertRaises(AssertionError): transport.bound(file,'0'*64)
    file.chmod(0o622)
    with self.assertRaises(AssertionError): transport.bound(file,digest)
    file.chmod(0o600); file.write_bytes(b'changed')
    with self.assertRaises(AssertionError): transport.bound(file,digest)
    link=Path(folder)/'alias'; link.symlink_to(file)
    with self.assertRaises(AssertionError): transport.bound(link,hashlib.sha256(b'changed').hexdigest())

 def test_exact_segment_and_truncation_are_bounded(self):
  source=io.BytesIO(b'firstsecond'); sink=Sink()
  transport.feed(source,sink,5)
  self.assertEqual(sink.getvalue(),b'first'); self.assertTrue(sink.closed_by_feed)
  self.assertEqual(source.read(),b'second')
  with self.assertRaisesRegex(AssertionError,'Truncated'): transport.feed(io.BytesIO(b'x'),Sink(),2)

 def test_actual_child_receives_exact_stdin_and_parent_locked_fd(self):
  with tempfile.TemporaryDirectory() as folder:
   base=Path(folder); lock=base/'lock'; lock.write_bytes(b''); descriptor=os.open(lock,os.O_RDONLY)
   fcntl.flock(descriptor,fcntl.LOCK_EX|fcntl.LOCK_NB)
   probe="import fcntl,os,sys; f=os.open(sys.argv[1],os.O_RDONLY)\ntry: fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB)\nexcept BlockingIOError: sys.exit(42)"
   childcode="import fcntl,hashlib,json,os,subprocess,sys; data=sys.stdin.buffer.read(); os.fstat(int(os.environ['POW_UI_DEPLOY_LOCK_FD'])); code=" + repr(probe) + "; " + \
    "p=subprocess.run([sys.executable,'-I','-c',code,sys.argv[1]]); print(json.dumps({'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest(),'competitor':p.returncode}))"
   try:
    output=base/'child.log'; source=io.BytesIO(b'approvedpayloadEXTRA')
    transport.run([sys.executable,'-I','-c',childcode,str(lock)],output,descriptor,
      {**transport.ENV,'POW_UI_DEPLOY_LOCK_FD':str(descriptor)},source=source,length=15)
    receipt=json.loads(output.read_text()); self.assertEqual(receipt['bytes'],15)
    self.assertEqual(receipt['sha256'],hashlib.sha256(b'approvedpayload').hexdigest())
    self.assertEqual(receipt['competitor'],42); self.assertEqual(source.read(),b'EXTRA')
    os.fstat(descriptor)
   finally: os.close(descriptor)

 def test_child_failure_and_oversized_log_leave_bounded_evidence(self):
  with tempfile.TemporaryDirectory() as folder:
   base=Path(folder); lock=base/'lock'; lock.write_bytes(b''); descriptor=os.open(lock,os.O_RDONLY)
   try:
    for name,code in [('failure','import sys;print("private fixture refused");sys.exit(1)'),
                      ('large','import os;os.write(1,b"x"*2097152)')]:
     output=base/(name+'.log')
     with self.assertRaises(AssertionError): transport.run([sys.executable,'-I','-c',code],output,descriptor,transport.ENV)
     self.assertLessEqual(output.stat().st_size,1024**2)
   finally: os.close(descriptor)

 def test_exited_leader_descendant_is_killed_before_parent_lock_is_released(self):
  with tempfile.TemporaryDirectory() as folder:
   base=Path(folder); lock=base/'lock'; lock.write_bytes(b''); descriptor=os.open(lock,os.O_RDONLY)
   fcntl.flock(descriptor,fcntl.LOCK_EX|fcntl.LOCK_NB)
   childfile=base/'descendant.pid'; actual_clock=time.monotonic; started=actual_clock()
   def bounded_clock(): return started+601 if childfile.exists() else actual_clock()
   code="import os,pathlib,time; p=os.fork(); pathlib.Path("+repr(str(childfile))+ ").write_text(str(p)) if p else None; os._exit(0) if p else time.sleep(30)"
   try:
    with patch.object(transport.time,'monotonic',bounded_clock), self.assertRaisesRegex(AssertionError,'budget'):
     transport.run([sys.executable,'-I','-c',code],base/'failure.log',descriptor,transport.ENV)
    pid=int(childfile.read_text())
    for _ in range(30):
     try:
      if Path('/proc',str(pid),'stat').read_text().split(') ',1)[1][0]=='Z': break
     except (FileNotFoundError,ProcessLookupError): break
     time.sleep(0.01)
    else: self.fail('Exited leader left a surviving descendant')
    os.fstat(descriptor)
    competitor=os.open(lock,os.O_RDONLY)
    try:
     with self.assertRaises(BlockingIOError): fcntl.flock(competitor,fcntl.LOCK_EX|fcntl.LOCK_NB)
    finally: os.close(competitor)
   finally: os.close(descriptor)

if __name__=='__main__': unittest.main(verbosity=2)
