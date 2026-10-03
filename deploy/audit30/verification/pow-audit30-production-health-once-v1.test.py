import ast,hashlib,json,pathlib,re,unittest
source=pathlib.Path('/tmp/pow-audit30-production-health-once-v1.py').read_text();t=ast.parse(source);code=next(n.value.value for n in t.body if isinstance(n,ast.Assign)and any(isinstance(k,ast.Name)and k.id=='CODE'for k in n.targets));tree=ast.parse(code);keep=[n for n in tree.body if isinstance(n,ast.FunctionDef)and n.name in {'value','sanitize'}or isinstance(n,ast.Assign)and any(isinstance(k,ast.Name)and k.id in {'BOOL_PATHS','NUMBER_PATHS','HASH_PATHS','REASON_PATHS','ENUMS'}for k in n.targets)];ns={'hashlib':hashlib,'re':re};exec(compile(ast.Module(body=keep,type_ignores=[]),'actual-health-sanitizer','exec'),ns);sanitize=ns['sanitize']
class Tests(unittest.TestCase):
 def test_false_predicate_preserved(self):self.assertEqual(sanitize({'ready':False,'available':True,'checks':{'worker':{'ok':False}}})['booleans']['checks.worker.ok'],False)
 def test_numeric_height_and_fullhash(self):
  v=sanitize({'tipHeight':969666,'checks':{'node':{'bestBlockHash':'a'*64}}});self.assertEqual(v['numbers']['tipHeight'],969666);self.assertEqual(v['hashes']['checks.node.bestBlockHash'],'a'*64)
 def test_private_extra_and_error_hashed_only(self):
  p={'body':'privatebody','password':'privatepassword','checks':{'worker':{'error':'privateerror'}}};v=sanitize(p);self.assertNotIn('private',json.dumps(v));self.assertEqual(v['reasonDigests']['checks.worker.error']['sha256'],hashlib.sha256(b'privateerror').hexdigest())
 def test_restricted_reason_enum(self):self.assertEqual(sanitize({'checks':{'worker':{'phase':'confirmed'}}})['reasonDigests']['checks.worker.phase']['enum'],'confirmed')
 def test_incorrect_numeric_type_refuses(self):self.assertRaises(AssertionError,sanitize,{'tipHeight':'969666'})
 def test_unknown_hash_omitted(self):self.assertIsNone(sanitize({'checks':{'node':{'bestBlockHash':'private'}}})['hashes']['checks.node.bestBlockHash'])
 def test_fixedurl_no_redirect_total_body_bound(self):
  self.assertIn("URL='http://127.0.0.1:8081/health'",code);self.assertIn('signal.setitimer(signal.ITIMER_REAL,30)',code);self.assertIn('assert size<=CAP',code);self.assertIn('ProxyHandler({})',code);self.assertIn('redirect_request',code);self.assertNotIn('bitcoin-cli',code);self.assertNotIn('psql',code)
if __name__=='__main__':unittest.main()
