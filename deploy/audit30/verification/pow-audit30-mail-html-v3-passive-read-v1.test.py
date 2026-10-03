import ast,json,pathlib,types,unittest
P=pathlib.Path('/tmp/pow-audit30-mail-html-v3-passive-read-remote-v1.py')
N={'__name__':'_reader_fixture'};exec(compile(P.read_bytes(),str(P),'exec'),N)
class Tests(unittest.TestCase):
 def test_closed_property_selection_never_exports_inline_execution_or_environment(self):
  row={'MainPID':'0','InvocationID':'a'*32,'User':'root','Group':'root','SupplementaryGroups':'1000','MemoryMax':'536870912','CapabilityBoundingSet':'','AmbientCapabilities':'','ExecStart':'PRIVATE_INLINE_EXEC','Environment':'PRIVATE_ENV','sourceBase64':'PRIVATE_SOURCE'}
  out=N['select'](row);self.assertEqual(out['MainPID'],'0');self.assertEqual(out['SupplementaryGroups'],'1000');self.assertFalse({'ExecStart','Environment','sourceBase64'}&set(out))
 def test_five_identity_drift_refused(self):
  original=N['state']
  try:
   N['state']=lambda u:{'ActiveState':'active','MainPID':N['FIVE'][u][0],'InvocationID':N['FIVE'][u][1]};self.assertEqual(len(N['five']()),5)
   N['state']=lambda u:{'ActiveState':'active','MainPID':'999999','InvocationID':N['FIVE'][u][1]};self.assertRaisesRegex(ValueError,'LIVE_FIVE_DRIFT',N['five'])
  finally:N['state']=original
 def test_exact_two_receipts_and_only_service_show(self):
  self.assertEqual(set(N['PINS']),{'public-result.json','completed.json'});self.assertEqual(N['PINS']['public-result.json'],(310437,'63c0e7206051c162a0a1d94a86c6ba01802816e47137144a405096cb2a22b051'));self.assertEqual(N['PINS']['completed.json'],(3384589,'eff1c27b17ef0984abaa030241f3723c5126b969aa6bfdd8b8f1eec517d9cf2c'))
  a=ast.parse(P.read_bytes());calls=[x for x in ast.walk(a)if isinstance(x,ast.Call)and isinstance(x.func,ast.Attribute)and isinstance(x.func.value,ast.Name)and x.func.value.id=='subprocess'];self.assertEqual(len(calls),1);self.assertEqual(ast.literal_eval(calls[0].args[0].elts[0]),'/usr/bin/systemctl');self.assertEqual(ast.literal_eval(calls[0].args[0].elts[1]),'show');self.assertNotIn('http.',P.read_text());self.assertNotIn('O_WRONLY',P.read_text())
 def test_base64_export_excludes_completed_and_snapshot_projection_is_count_only(self):
  s=P.read_text();self.assertIn("if name=='public-result.json':meta[name]['base64']=",s);self.assertIn("'unitSnapshotCount':len(c['unitSnapshots'])",s);self.assertNotIn("'unitSnapshots':c['unitSnapshots']",s);self.assertIn("'inlineExecOrSourceOrEnvironmentExported':False",s)
if __name__=='__main__':unittest.main()
