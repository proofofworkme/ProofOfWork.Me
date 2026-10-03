import ast,base64,hashlib,io,json,pathlib,subprocess,sys,types,unittest,zlib
from unittest.mock import patch
P=pathlib.Path('/tmp');B=P/'pow-audit30-mail-projection-focused-bootstrap-v5.py';R=P/'pow-audit30-mail-projection-focused-request-v5.json';T=P/'pow-audit30-mail-projection-focused-transport-v5.py';sha=lambda b:hashlib.sha256(b).hexdigest()
class F(unittest.TestCase):
 def test_decoded_exact_sources(self):
  raw=R.read_bytes();self.assertLessEqual(len(raw),32768);v=json.loads(raw);self.assertEqual(set(v),{'schema','rootSHA256','rootBase64','leafSHA256','leafBase64','encoding'});self.assertEqual(v['schema'],'pow-audit30-focused-mail-readonly-request-v5')
  for name,ext in [('root','py'),('leaf','mjs')]:
   a=(P/f'pow-audit30-mail-projection-focused-{name}-v5.{ext}').read_bytes();self.assertEqual(zlib.decompress(base64.b64decode(v[name+'Base64'],validate=True)),a);self.assertEqual(v[name+'SHA256'],sha(a));self.assertIn(sha(a),B.read_text())
 def test_transport_uses_exact_shared_bindings(self):
  t=T.read_text();self.assertIn(sha(B.read_bytes()),t);self.assertIn(sha(R.read_bytes()),t);self.assertIn('1dedef0a6c7021d114017e711ad74f9cfed4e461fc047a2be2c49e590f3da18e',t);self.assertIn('32768',t);self.assertIn('180,stdout_cap=65536,stderr_cap=65536',t)
 def test_actual_bad_argv_refused(self):
  r=subprocess.run([sys.executable,'-I','-B',str(B)],input=b'{}',capture_output=True,timeout=5);self.assertEqual(r.returncode,1);self.assertFalse(r.stdout);v=json.loads(r.stderr);self.assertEqual(v['errorClass'],'AssertionError');self.assertIsNone(v['guardCode']);self.assertFalse(v['privateContentsExported'])
 def test_actual_wrong_hash_refused_before_main(self):
  r=subprocess.run([sys.executable,'-I','-B',str(B),'a'*64],input=R.read_bytes(),capture_output=True,timeout=5);self.assertEqual(r.returncode,1);self.assertEqual(json.loads(r.stderr)['errorClass'],'AssertionError')
 def prefix(self,raw):
  # Compile the ACTUAL decoder only up to the root-module namespace assignment.
  # No reviewed root source is imported and main is never called.
  tree=ast.parse(B.read_text());imports=[n for n in tree.body if isinstance(n,(ast.Import,ast.ImportFrom))];body=next(n for n in tree.body if isinstance(n,ast.Try)).body;keep=[]
  for node in body:
   if isinstance(node,ast.Assign)and any(isinstance(t,ast.Name)and t.id=='n'for t in node.targets):break
   keep.append(node)
  code=compile(ast.fix_missing_locations(ast.Module(body=imports+keep,type_ignores=[])),str(B),'exec');env={}
  with patch.object(sys,'argv',['bootstrap',sha(raw)]),patch.object(sys,'stdin',types.SimpleNamespace(buffer=io.BytesIO(raw))):exec(code,env)
  return env
 def modified(self,change):
  v=json.loads(R.read_bytes());change(v);return json.dumps(v,separators=(',',':')).encode()
 def test_real_decoder_prefix_exact_canonical_sources(self):
  e=self.prefix(R.read_bytes());self.assertEqual(e['sources'],[(P/'pow-audit30-mail-projection-focused-root-v5.py').read_bytes(),(P/'pow-audit30-mail-projection-focused-leaf-v5.mjs').read_bytes()])
 def test_real_decoder_compression_bomb_refuses_at_original_cap(self):
  for name,cap in [('root',24576),('leaf',8192)]:
   raw=self.modified(lambda v:v.update({name+'Base64':base64.b64encode(zlib.compress(b'x'*(cap+1))).decode()}))
   with self.subTest(name=name),self.assertRaises(AssertionError):self.prefix(raw)
 def test_real_decoder_trailing_member_refused(self):
  raw=self.modified(lambda v:v.update(rootBase64=base64.b64encode(base64.b64decode(v['rootBase64'])+zlib.compress(b'trailing')).decode()))
  with self.assertRaises(AssertionError):self.prefix(raw)
 def test_real_decoder_truncated_stream_refused(self):
  raw=self.modified(lambda v:v.update(rootBase64=base64.b64encode(base64.b64decode(v['rootBase64'])[:-1]).decode()))
  with self.assertRaises(AssertionError):self.prefix(raw)
 def test_real_decoder_wrong_source_pin_refused(self):
  with self.assertRaises(AssertionError):self.prefix(self.modified(lambda v:v.update(leafSHA256='0'*64)))
 def test_real_decoder_unknown_codec_and_legacy_request_refused(self):
  for change in [lambda v:v.update(encoding='gzip'),lambda v:v.update(schema='pow-audit30-focused-mail-readonly-request-v4')]:
   with self.assertRaises(AssertionError):self.prefix(self.modified(change))
 def test_real_decoder_uncompressed_data_refused(self):
  with self.assertRaises(zlib.error):self.prefix(self.modified(lambda v:v.update(rootBase64=base64.b64encode((P/'pow-audit30-mail-projection-focused-root-v5.py').read_bytes()).decode())))
 def test_real_decoder_outer32k_refused(self):
  with self.assertRaises(AssertionError):self.prefix(b'x'*32769)
if __name__=='__main__':unittest.main()
