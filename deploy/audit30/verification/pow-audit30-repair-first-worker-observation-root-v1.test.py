import base64,hashlib,importlib.util,json,pathlib,unittest
P=pathlib.Path('/tmp/pow-audit30-repair-first-worker-observation-root-v1.py');sp=importlib.util.spec_from_file_location('worker_wrapper',P);M=importlib.util.module_from_spec(sp);sp.loader.exec_module(M)
R=json.loads(pathlib.Path('/tmp/pow-audit30-repair-first-worker-observation-request-v1.json').read_bytes())
class T(unittest.TestCase):
 def test_exact_accepted_guard(self):self.assertEqual(hashlib.sha256(M.decode_request(json.dumps(R).encode())).hexdigest(),M.GUARD_SHA)
 def test_wrong_namespace_or_operation_refuses(self):
  for k,v in [('runId','20261003T999999Z'),('schema','other'),('sourceSHA256','0'*64)]:
   r=dict(R);r[k]=v
   with self.assertRaises(ValueError):M.decode_request(json.dumps(r).encode())
 def test_source_tamper_refuses(self):
  r=dict(R);r['sourceBase64']=base64.b64encode(b'pass').decode()
  with self.assertRaises(ValueError):M.decode_request(json.dumps(r).encode())
 def test_extra_fields_refuse(self):
  r=dict(R);r['sql']='UPDATE';self.assertRaises(ValueError,M.decode_request,json.dumps(r).encode())
 def test_request_cap_refuses(self):self.assertRaises(ValueError,M.decode_request,b' '*65537)
 def test_repair_first_without_circular_strict_dependency(self):
  t=P.read_text();self.assertNotIn('strictAcceptedSHA256',t);self.assertNotIn('STRICT_PREREQUISITE',t);self.assertNotIn('STRICT_SCOPE',t);self.assertNotIn('strict-native-v1-completed',t);self.assertIn("'strictAcceptanceRequired':False",t);self.assertIn("a['live']()==before",t);self.assertIn('O_EXCL',t);self.assertLess(t.index("'BACKUP_RUNNING'"),t.index("g['execute'](RUN)"))
 def test_byte_exact_stateless_guard(self):
  raw=M.decode_request(json.dumps(R).encode());self.assertEqual(raw,pathlib.Path('/tmp/pow-audit30-worker-mail-exclusion-guard-v3.py').read_bytes());self.assertIn(b'height-SHALLOW_REORG_MAX_DEPTH>max_height',raw);self.assertIn(b"need(source==SOURCE_PINS",raw)
if __name__=='__main__':unittest.main()
