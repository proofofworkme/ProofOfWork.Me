import ast,json,pathlib,unittest
p=pathlib.Path('/tmp/pow-audit30-38ac-full-id-http-classification-native-v2.py');t=ast.parse(p.read_bytes());code=next(n.value.value for n in t.body if isinstance(n,ast.Assign)and any(isinstance(k,ast.Name)and k.id=='CODE'for k in n.targets));f=next(n for n in ast.parse(code).body if isinstance(n,ast.FunctionDef)and n.name=='health_observation');ns={'json':json};exec(compile(ast.Module(body=[f],type_ignores=[]),'actual-health-classifier','exec'),ns);read=ns['health_observation']
class Tests(unittest.TestCase):
 def sample(self,**extra):return json.dumps(dict(event='http-response-observation',route='/api/v1/internal/id-registry-audit',method='GET',status=503,elapsedMs=9998,**extra))
 def test_exact_http_finished(self):self.assertEqual(read(self.sample()),dict(event='http-response-observation',route='/api/v1/internal/id-registry-audit',method='GET',status=503,elapsedMs=9998))
 def test_extra_private_fields_omitted(self):self.assertEqual(read(self.sample(body='private',password='private',address='private')),read(self.sample()))
 def test_other_route_excluded(self):self.assertIsNone(read(json.dumps(dict(event='http-response-observation',route='/health',method='GET',status=200,elapsedMs=1,address='private'))))
 def test_interrupted_preheaders_not_success(self):self.assertEqual(read(json.dumps(dict(event='http-response-interrupted-observation',route='/api/v1/internal/id-registry-audit-fence',method='GET',status=200,elapsedMs=3001,headersSent=False)))['headersSent'],False)
 def test_malformed_enum_field_refuses(self):self.assertRaises(AssertionError,read,json.dumps(dict(event='http-response-observation',route='/api/v1/internal/id-registry-audit',method='GET',status='200',elapsedMs=1)))
 def test_nonjson_message_digest_only(self):self.assertIsNone(read('private stack or body'))

class SourceLocations(unittest.TestCase):
 def setUp(self):
  f=next(n for n in ast.parse(code).body if isinstance(n,ast.FunctionDef)and n.name=='source_locations');self.ns={'re':__import__('re')};exec(compile(ast.Module(body=[f],type_ignores=[]),'actual-source-locations','exec'),self.ns)
 def test_exact_fixed_api_path_locations_only(self):
  self.assertEqual(self.ns['source_locations']('private Error stack\n at f(file:///opt/proofofwork-api-stage-38ac6e2bff2a-20261003T042000Z/server/proof-api.mjs:78312:11)'),[{'source':'proof-api.mjs','line':78312,'column':11}])
 def test_other_path_private_text_not_exported(self):self.assertEqual(self.ns['source_locations']('private /secret/customer:1:1 /opt/proofofwork-api-stage-private/server/proof-api.mjs:2:3'),[])
 def test_only_twelve_locations_per_row(self):self.assertEqual(len(self.ns['source_locations'](' file:///opt/proofofwork-api/server/proof-api.mjs:10:11'*30)),12)
if __name__=='__main__':unittest.main()
