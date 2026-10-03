import hashlib,importlib.util,json,os,pathlib,signal,sys,tempfile,threading,time,unittest
from unittest.mock import patch
P=pathlib.Path
spec=importlib.util.spec_from_file_location('safe_outer','/tmp/pow-audit30-onhost-math-safe-input-native-transport-v1.py');S=importlib.util.module_from_spec(spec);spec.loader.exec_module(S)
class Transport(unittest.TestCase):
 def setUp(self):self.tmp=tempfile.TemporaryDirectory();self.base=str(P(self.tmp.name)/'capture');self.old=S.BASE;S.BASE=self.base
 def tearDown(self):S.BASE=self.old;self.tmp.cleanup()
 def test_template_refuses_before_popen_or_captures(self):
  request=P('/tmp/pow-audit30-onhost-math-safe-input-request-template-v1.json');raw=request.read_bytes()
  with patch.object(S,'REQUEST',request),patch.object(S.subprocess,'Popen')as p:
   with self.assertRaisesRegex(Exception,'ACTUAL_STREAM_PINS'):S.inputs(hashlib.sha256(raw).hexdigest())
   p.assert_not_called();self.assertFalse(P(self.base+'.stdout').exists())
 def test_raw_request_wrong_pin(self):
  with patch.object(S,'REQUEST',P('/tmp/pow-audit30-onhost-math-safe-input-request-template-v1.json')),self.assertRaisesRegex(S.Refused,'REQUEST_PIN'):S.inputs('f'*64)
 def test_fixed_ssh_authority_and_exact_source(self):
  a=S.remote(b'print("safe")','a'*64);self.assertIn('StrictHostKeyChecking=yes',a);self.assertEqual(a[-2],'powadmin@65.108.122.87');self.assertTrue(a[-1].startswith('sudo -n /usr/bin/python3 -I -B -c '));self.assertTrue(a[-1].endswith(' '+'a'*64))
 def test_collision_before_child(self):
  P(self.base+'.stdout').write_bytes(b'preserved')
  with patch.object(S.subprocess,'Popen')as p:r=S.run(b'source',b'{}','a'*64)
  p.assert_not_called();self.assertEqual(P(self.base+'.stdout').read_bytes(),b'preserved');self.assertEqual(r['failure'],'FileExistsError')
 def literal(self,code):return [sys.executable,'-I','-B','-c',code]
 def test_actual_private_child_success_and_custody(self):
  with patch.object(S,'remote',return_value=self.literal('import sys; sys.stdin.buffer.read(); print("public-counts-only")')):r=S.run(b'source',b'{}','a'*64)
  self.assertEqual(r['returnCode'],0);self.assertIsNone(r['failure']);self.assertEqual(r['captures']['stdout']['sha256'],hashlib.sha256(b'public-counts-only\n').hexdigest());self.assertEqual(P(self.base+'.stdout').stat().st_mode&0o777,0o600)
 def test_actual_child_output_cap_refuses_and_reaps(self):
  with patch.object(S,'CAP',8),patch.object(S,'remote',return_value=self.literal('import sys,time; sys.stdout.buffer.write(b"x"*100);sys.stdout.flush();time.sleep(20)')):r=S.run(b'source',b'{}','a'*64)
  self.assertEqual(r['failure'],'SAFE_INPUT_OUTER_CHANNEL_CAP');self.assertIsNotNone(r['returnCode'])
 def test_actual_sigterm_kills_only_owned_client_and_restores_handler(self):
  old=signal.getsignal(signal.SIGTERM);timer=threading.Timer(.05,lambda:os.kill(os.getpid(),signal.SIGTERM));timer.start()
  try:
   with patch.object(S,'remote',return_value=self.literal('import time;time.sleep(20)')):r=S.run(b'source',b'{}','a'*64)
  finally:timer.cancel();timer.join()
  self.assertEqual(r['failure'],'SAFE_INPUT_OUTER_INTERRUPTED');self.assertEqual(signal.getsignal(signal.SIGTERM),old);self.assertIsNotNone(r['returnCode'])
 def test_actual_nonconsuming_stdin_deadline(self):
  real=S.time.monotonic;calls=0
  def elapsed():
   nonlocal calls
   calls+=1;return real()+(241 if calls>=2 else 0)
  with patch.object(S.time,'monotonic',elapsed),patch.object(S,'remote',return_value=self.literal('import time;time.sleep(20)')):r=S.run(b'source',b'x'*100000,'a'*64)
  self.assertEqual(r['failure'],'SAFE_INPUT_OUTER_240S_BOUND');self.assertIsNotNone(r['returnCode'])
if __name__=='__main__':unittest.main()
