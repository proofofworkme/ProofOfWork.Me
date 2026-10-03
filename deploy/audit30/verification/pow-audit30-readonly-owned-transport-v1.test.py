import hashlib, importlib.util, json, os, pathlib, signal, subprocess, sys, tempfile, time, unittest
from unittest.mock import patch
P=pathlib.Path
s=importlib.util.spec_from_file_location('M','/tmp/pow-audit30-readonly-owned-transport-v1.py');M=importlib.util.module_from_spec(s);s.loader.exec_module(M)

class Tests(unittest.TestCase):
 def prefix(self,t):return P(t)/'pow-audit30-fixture'
 def child(self,code):return [sys.executable,'-I','-B','-c',code]
 def test_exact_pinned_sources_and_custody_bounds(self):
  for d in M.TOOLS.values():self.assertEqual(hashlib.sha256(P(d['source']).read_bytes()).hexdigest(),d['sha256'])
  d=M.TOOLS['treasury'];self.assertEqual(M.sha(P(d['request']).read_bytes()),d['requestSha256']);self.assertEqual(d['deadline'],1650);self.assertEqual(M.TOOLS['mail-api']['deadline'],980)
 def test_source_c_separate_stdin_argument_is_safely_quoted(self):
  raw=b'print("literal $() `uname`")\n';a=M.remote_command(raw,'a'*64)
  self.assertEqual(a[:len(M.SSH)],M.SSH);self.assertIn('StrictHostKeyChecking=yes',a)
  import shlex
  command=shlex.split(a[-1]);self.assertEqual(command, ['sudo','-n','/usr/bin/python3','-I','-B','-c',raw.decode(),'a'*64])
  self.assertRaises(ValueError,M.remote_command,raw,'$(id)')
 def test_actual_nonblocking_stdin_stdout_stderr_and_durable_bindings(self):
  with tempfile.TemporaryDirectory(dir='/tmp')as t:
   # execute requires an exact /tmp prefix; choose a new basename and preserve
   # its three files inside the fixture's own explicit cleanup scope afterward.
   prefix=P('/tmp')/('pow-audit30-test-'+P(t).name.lower().replace('_','-'))
   self.addCleanup(lambda:[p.unlink(missing_ok=True)for p in P('/tmp').glob(prefix.name+'.*')])
   b={'sourceSha256':'a'*64,'requestSha256':'b'*64}
   v=M.execute(self.child('import sys; b=sys.stdin.buffer.read(); sys.stdout.buffer.write(b);sys.stderr.write("err")'),b'typed\nstdin',prefix,3,bindings=b)
   self.assertEqual(v['exitCode'],0);self.assertIsNone(v['failure']);self.assertEqual(v['typedStdinBytesDelivered'],11)
   self.assertEqual(P(str(prefix)+'.stdout').read_bytes(),b'typed\nstdin');self.assertEqual(P(str(prefix)+'.stderr').read_bytes(),b'err')
   self.assertEqual(json.loads(P(str(prefix)+'.json').read_bytes())['inputBindings'],b)
   self.assertFalse(v['remoteUnitStoppedCertifiedByTransport'])
 def exercise(self,code,request=b'',seconds=3,outcap=32,errcap=32):
  t=tempfile.TemporaryDirectory(dir='/tmp');self.addCleanup(t.cleanup);prefix=P('/tmp')/('pow-audit30-test-'+P(t.name).name.lower().replace('_','-'));self.addCleanup(lambda:[p.unlink(missing_ok=True)for p in P('/tmp').glob(prefix.name+'.*')]);return M.execute(self.child(code),request,prefix,seconds,stdout_cap=outcap,stderr_cap=errcap),prefix
 def test_stream_overflow_preserves_exact_cap_and_failure_not_remote_stop(self):
  for code,n in [('import sys;sys.stdout.write("x"*1000)','stdout'),('import sys;sys.stderr.write("x"*1000)','stderr')]:
   v,p=self.exercise(code);self.assertIsNotNone(v['failure']);self.assertEqual(P(str(p)+'.'+n).stat().st_size,32);self.assertFalse(v['remoteUnitStoppedCertifiedByTransport'])
 def test_stdin_nonconsuming_child_is_interrupted_by_same_outer_bound(self):
  before=time.monotonic();v,p=self.exercise('import time;time.sleep(10)',b'x'*1024**2,seconds=.15)
  self.assertLess(time.monotonic()-before,2);self.assertIsNotNone(v['failure']);self.assertLess(v['typedStdinBytesDelivered'],1024**2)
 def test_real_ordinary_signal_preserves_partial_captures_and_no_retry(self):
  v,p=self.exercise('import os,signal,time;os.kill(os.getppid(),signal.SIGTERM);time.sleep(10)')
  self.assertEqual(v['failure']['errorClass'],'TransportInterrupted');self.assertFalse(v['automaticRetry']);self.assertTrue(P(str(p)+'.json').exists())
 def test_duplicate_capture_refuses_before_process_creation(self):
  with tempfile.TemporaryDirectory(dir='/tmp')as t:
   prefix=P('/tmp')/('pow-audit30-test-'+P(t).name.lower().replace('_','-'));p=P(str(prefix)+'.stdout');p.write_bytes(b'old');self.addCleanup(lambda:p.unlink(missing_ok=True))
   with patch.object(M.subprocess,'Popen',side_effect=AssertionError('must not launch')):
    self.assertRaises(ValueError,M.execute,['must-not-run'],b'',prefix,1,popen=M.subprocess.Popen)
   self.assertEqual(p.read_bytes(),b'old')
 def test_wrong_source_hash_symlink_hardlink_refuse(self):
  with tempfile.TemporaryDirectory(dir='/tmp')as t:
   # Inputs themselves are fixed /tmp direct children.
   p=P('/tmp')/('pow-audit30-test-input-'+P(t).name.lower().replace('_','-'));p.write_bytes(b'x');self.addCleanup(lambda:p.unlink(missing_ok=True));self.assertEqual(M.bound(p,M.sha(b'x'),10),b'x')
   self.assertRaises(ValueError,M.bound,p,'e'*64,10);q=P(str(p)+'-alias');q.symlink_to(p);self.addCleanup(lambda:q.unlink(missing_ok=True));self.assertRaises(ValueError,M.bound,q,M.sha(b'x'),10)
   h=P(str(p)+'-hard');os.link(p,h);self.addCleanup(lambda:h.unlink(missing_ok=True));self.assertRaises(ValueError,M.bound,p,M.sha(b'x'),10)
 def test_no_network_in_fixtures_fixed_node_ssh_and_no_unit_adoption(self):
  self.assertEqual(M.SSH[-1],'powadmin@65.108.122.87');self.assertEqual(M.STDOUT_MAX,M.STDERR_MAX,1024**2)
  src=P(M.__file__).read_text();self.assertNotIn('systemctl stop',src);self.assertNotIn('scantxoutset',src);self.assertNotIn('sudo -u',src)

if __name__=='__main__':unittest.main()
