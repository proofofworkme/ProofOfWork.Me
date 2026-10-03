import importlib.util,json,pathlib,tempfile,unittest
P=pathlib.Path;s=importlib.util.spec_from_file_location('A','/tmp/pow-audit30-mail-api-request-assemble-v2.py');A=importlib.util.module_from_spec(s);s.loader.exec_module(A)
class Tests(unittest.TestCase):
 def live(self):return{u:{'MainPID':'42','InvocationID':'a'*32}for u in('bitcoind.service','electrs.service','postgresql@16-main.service','proofofwork-api.service','proofofwork-indexer-worker.service')}
 def test_actual_frozen_sources_emit_two_exact_code_requests_no_network(self):
  c,v=A.assemble('after','20261003T070000Z',self.live());M=A.native()
  for mode,r in v.items():files,child=M.request(r);self.assertEqual(child,c);self.assertEqual(r['mode'],mode);self.assertEqual(M.sha(files['request.json']),r['collectorRequestSha256'])
  self.assertEqual(M.sha(A.bound(A.NATIVE,A.NATIVE_SHA)),A.NATIVE_SHA)
 def test_nonexecutable_fresh_placeholders_and_unknown_scope_refuse(self):
  x=self.live();x['proofofwork-api.service']['MainPID']='REQUIRES_FRESH_AFTER_CUTOVER'
  for stage,rid,live in [('after','20261003T070000Z',x),('write','20261003T070000Z',self.live()),('baseline','20260230T070000Z',self.live()),('baseline','20261003T070000Z',{})]:self.assertRaises(ValueError,A.assemble,stage,rid,live)
 def test_exact_baseline_and_after_have_separate_child_bytes(self):
  x,_=A.assemble('baseline','20261003T070000Z',self.live());y,_=A.assemble('after','20261003T070000Z',self.live());self.assertNotEqual(A.sha(A.encoded(x)),A.sha(A.encoded(y)));self.assertEqual(x['liveFive'],y['liveFive'])
 def test_duplicate_json_refuses_and_exclusive_output_cannot_overwrite(self):
  self.assertRaises(ValueError,json.loads,b'{"unit":1,"unit":2}',object_pairs_hook=A.pairs)
  with tempfile.TemporaryDirectory(dir='/tmp')as t:
   p=P('/tmp')/('pow-audit30-assembler-test-'+P(t).name);self.addCleanup(lambda:p.unlink(missing_ok=True));r=A.write(p,b'preserved');self.assertEqual(p.read_bytes(),b'preserved');self.assertRaises(FileExistsError,A.write,p,b'new');self.assertEqual(r['sha256'],A.sha(b'preserved'))
 def test_no_native_entrypoint_or_api_call_in_local_assembler(self):
  src=P(A.__file__).read_text();self.assertNotIn('subprocess',src);self.assertNotIn('HTTPConnection',src);self.assertNotIn('socket',src)
if __name__=='__main__':unittest.main()
