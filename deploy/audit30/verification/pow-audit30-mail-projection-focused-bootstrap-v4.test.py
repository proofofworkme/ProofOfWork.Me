import ast,base64,hashlib,json,pathlib,subprocess,sys,unittest
P=pathlib.Path('/tmp');B=P/'pow-audit30-mail-projection-focused-bootstrap-v4.py';R=P/'pow-audit30-mail-projection-focused-request-v4.json';T=P/'pow-audit30-mail-projection-focused-transport-v4.py';sha=lambda b:hashlib.sha256(b).hexdigest()
class F(unittest.TestCase):
 def test_decoded_exact_sources(self):
  raw=R.read_bytes();self.assertLessEqual(len(raw),32768);v=json.loads(raw);self.assertEqual(set(v),{'schema','rootSHA256','rootBase64','leafSHA256','leafBase64'});self.assertEqual(v['schema'],'pow-audit30-focused-mail-readonly-request-v4')
  for name,ext in [('root','py'),('leaf','mjs')]:
   a=(P/f'pow-audit30-mail-projection-focused-{name}-v4.{ext}').read_bytes();self.assertEqual(base64.b64decode(v[name+'Base64'],validate=True),a);self.assertEqual(v[name+'SHA256'],sha(a));self.assertIn(sha(a),B.read_text())
 def test_transport_uses_exact_shared_bindings(self):
  t=T.read_text();self.assertIn(sha(B.read_bytes()),t);self.assertIn(sha(R.read_bytes()),t);self.assertIn('1dedef0a6c7021d114017e711ad74f9cfed4e461fc047a2be2c49e590f3da18e',t);self.assertIn('32768',t);self.assertIn('180,stdout_cap=65536,stderr_cap=65536',t)
 def test_actual_bad_argv_refused(self):
  r=subprocess.run([sys.executable,'-I','-B',str(B)],input=b'{}',capture_output=True,timeout=5);self.assertEqual(r.returncode,1);self.assertFalse(r.stdout);v=json.loads(r.stderr);self.assertEqual(v['errorClass'],'AssertionError');self.assertIsNone(v['guardCode']);self.assertFalse(v['privateContentsExported'])
 def test_actual_wrong_hash_refused_before_main(self):
  r=subprocess.run([sys.executable,'-I','-B',str(B),'a'*64],input=R.read_bytes(),capture_output=True,timeout=5);self.assertEqual(r.returncode,1);self.assertEqual(json.loads(r.stderr)['errorClass'],'AssertionError')
if __name__=='__main__':unittest.main()
