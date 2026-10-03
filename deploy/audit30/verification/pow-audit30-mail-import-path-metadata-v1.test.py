import ast,hashlib,json,os,pathlib,subprocess,types,unittest
P=pathlib.Path('/tmp/pow-audit30-mail-import-path-metadata-v1.py');m=types.ModuleType('metadata');exec(compile(P.read_bytes(),str(P),'exec'),m.__dict__)
def sample(uid=108,gid=112):return {'schema':'pow-audit30-fixed-mail-path-access-v1','uid':uid,'gid':gid,'effectiveUid':uid,'effectiveGid':gid,'groups':[],'rows':[{'label':label,'pathSHA256':hashlib.sha256(path.encode()).hexdigest(),'readAccess':False,'searchOrExecuteAccess':False,'statAvailable':False,'statRefused':'ACCESS_DENIED'}for label,path in m.PATHS]}
class T(unittest.TestCase):
 def test_fixed_thirteen_paths_no_credential_or_input_paths(self):
  self.assertEqual(len(m.PATHS),13);self.assertEqual(len(set(p for _,p in m.PATHS)),13);self.assertTrue(all(p in ['/','/opt']or p.startswith(m.STAGE+'/')or p==m.STAGE for _,p in m.PATHS));self.assertFalse(any(x in m.CHILD for x in ['psql','run(','createProofIndexPool','chmod','write_bytes','environ','read_text']))
 def test_actual_fixed_child_is_readonly_metadata_and_never_imports_application(self):
  p=subprocess.run(['/usr/bin/python3','-I','-B','-c',m.CHILD],capture_output=True,timeout=10,env=m.ENV);self.assertEqual(p.returncode,0);self.assertEqual(p.stderr,b'');r=json.loads(p.stdout);r['groups']=[];m.closed_rows(r,os.getuid(),os.getgid());self.assertEqual(r['rows'][0]['kind'],'directory');self.assertEqual(len(r['rows']),13)
 def test_closed_role_and_path_sha(self):
  self.assertEqual(m.closed_rows(sample(),108,112),sample());r=sample();r['uid']=0
  with self.assertRaisesRegex(ValueError,'ROLE_METADATA_SCOPE'):m.closed_rows(r,108,112)
  r=sample();r['rows'][0]['pathSHA256']='0'*64
  with self.assertRaisesRegex(ValueError,'PATH_ROW_SCOPE'):m.closed_rows(r,108,112)
 def test_unexpected_private_field_and_unknown_refusal_are_rejected(self):
  for value in ['body_text','raw_error']:
   r=sample();r['rows'][0][value]='private'
   with self.assertRaisesRegex(ValueError,'PATH_REFUSAL_SCOPE'):m.closed_rows(r,108,112)
  r=sample();r['rows'][0]['statRefused']='secret/path'
  with self.assertRaisesRegex(ValueError,'PATH_REFUSAL_SCOPE'):m.closed_rows(r,108,112)
 def test_optional_missing_paths_are_observed_not_broadly_exempted(self):
  def absent(p):raise FileNotFoundError()
  self.assertEqual(m.observed_stamp('/fixed',{'stamp':absent}),{'present':False})
  def denied(p):raise PermissionError()
  with self.assertRaises(PermissionError):m.observed_stamp('/fixed',{'stamp':denied})
 def test_utility_bytes_pinned_and_never_call_import_probe(self):
  u=pathlib.Path('/tmp/pow-audit30-mail-import-readonly-diagnostic-v1.py').read_bytes();self.assertEqual(hashlib.sha256(u).hexdigest(),m.UTILITY_PIN);s=ast.unparse(ast.parse(P.read_bytes()));self.assertIn("n['context'](source)",s);self.assertNotIn("n['main']",s);self.assertNotIn('child_probe(',s);self.assertNotIn('save(',s)
 def test_typed_bootstrap_source_bytes_and_shared_wrapper(self):
  import base64
  b=pathlib.Path('/tmp/pow-audit30-mail-import-path-bootstrap-v2.py').read_bytes();values={n.targets[0].id:ast.literal_eval(n.value)for n in ast.parse(b).body if isinstance(n,ast.Assign)};self.assertEqual(base64.b64decode(values['SOURCE_BASE64']),P.read_bytes());self.assertEqual(values['SOURCE_SHA'],hashlib.sha256(P.read_bytes()).hexdigest());self.assertEqual(hashlib.sha256(base64.b64decode(values['UTILITY_BASE64'])).hexdigest(),m.UTILITY_PIN);w=pathlib.Path('/tmp/pow-audit30-mail-import-path-transport-v2.py').read_text();self.assertIn(hashlib.sha256(b).hexdigest(),w);self.assertIn('1dedef0a6c7021d114017e711ad74f9cfed4e461fc047a2be2c49e590f3da18e',w);self.assertIn("'childLaunches':2",w)
 def test_actual_bad_typed_request_refused_before_roles(self):
  p=subprocess.run(['/usr/bin/python3','-I','-B','/tmp/pow-audit30-mail-import-path-bootstrap-v2.py','9ed745006112c8b6c7eb105b1794278531d148231c1ff5dc74eeeac2c750a08d'],input=b'{}',capture_output=True,timeout=5);self.assertEqual(p.returncode,1);self.assertEqual(p.stdout,b'');v=json.loads(p.stderr);self.assertEqual(v['sqlCalls'],0);self.assertFalse(v['automaticRetry'])
if __name__=='__main__':unittest.main()
