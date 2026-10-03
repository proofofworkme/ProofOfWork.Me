import ast,hashlib,json,pathlib,re,types,unittest
P=pathlib.Path('/tmp/pow-audit30-stop-owned-38ac042000-shadow-native-v1.py');T=ast.parse(P.read_bytes());CODE=next(n.value.value for n in T.body if isinstance(n,ast.Assign)and any(isinstance(k,ast.Name)and k.id=='code'for k in n.targets));CT=ast.parse(CODE);CT.body=[n for n in CT.body if not isinstance(n,(ast.Import,ast.ImportFrom))]
U='proofofwork-audit30-candidate-full-ids-38ac6e2bff2a-20261003T042000Z-fence-diagnostic-v3.service'
class Tests(unittest.TestCase):
 def actual(self,change=None,statechange=None,refusecache=False):
  completion=dict(schema='pow-audit30-cli-native-completed-v3',unit=U,returncode=0,stopped=True,invocationID='a'*32);state=dict(LoadState='not-found',ActiveState='inactive',MainPID='0',InvocationID='')
  if change:completion.update(change)
  if statechange:state.update(statechange)
  helper="def private_read(p):return "+repr(json.dumps(completion).encode())+"\n"
  src=("import pathlib\nTOOLS=pathlib.Path('/tools');ROOT=pathlib.Path('/evidence');PINS={'private-env.py':'pin'}\ndef read(p,pin):return "+repr(helper.encode())+"\ndef live():return {'all5':'same'}\ndef execute():return {'stopped':True}\n").encode()
  reuse=("def admit_existing_capture_cache(read,b,p):\n "+("raise ValueError('CACHE_NONEMPTY')"if refusecache else"return {'shadowCacheEmpty':True}")+"\n").encode();out=[];calls=[]
  def run(argv,**kw):self.assertEqual(argv[2],U);calls.append(argv);return types.SimpleNamespace(returncode=0,stderr=b'',stdout=('\n'.join(k+'='+v for k,v in state.items())+'\n').encode())
  ns=dict(SRC=src,REUSE=reuse,STOP_SHA=hashlib.sha256(src).hexdigest(),REUSE_SHA=hashlib.sha256(reuse).hexdigest(),hashlib=hashlib,json=json,pathlib=pathlib,re=re,subprocess=types.SimpleNamespace(run=run),print=lambda v:out.append(json.loads(v)))
  exec(compile(CT,'actual-typed-stop-native','exec'),ns);self.assertEqual(len(calls),1);return out[0]
 def test_success_completed_gc(self):self.assertTrue(self.actual()['stopResult']['stopped'])
 def test_success_loaded_same_invocation(self):self.assertTrue(self.actual(statechange=dict(LoadState='loaded',InvocationID='a'*32))['cliUnitStopped'])
 def test_wrong_completion_unit_refuses(self):self.assertRaises(AssertionError,self.actual,dict(unit='production.service'))
 def test_wrong_schema_refuses(self):self.assertRaises(AssertionError,self.actual,dict(schema='other'))
 def test_error_returncode_refuses(self):self.assertRaises(AssertionError,self.actual,dict(returncode=1))
 def test_missing_stopped_refuses(self):self.assertRaises(AssertionError,self.actual,dict(stopped=False))
 def test_missing_owned_invocation_refuses(self):self.assertRaises(AssertionError,self.actual,dict(invocationID=''))
 def test_still_running_refuses(self):self.assertRaises(AssertionError,self.actual,statechange=dict(MainPID='777',ActiveState='active'))
 def test_reused_loaded_invocation_refuses(self):self.assertRaises(AssertionError,self.actual,statechange=dict(LoadState='loaded',InvocationID='b'*32))
 def test_nonemptycache_refuses_before_stop(self):self.assertRaisesRegex(ValueError,'CACHE_NONEMPTY',self.actual,refusecache=True)
 def test_actual_client_input_is_quoted_valid_python(self):
  n=next(n for n in ast.walk(T)if isinstance(n,ast.Call)and isinstance(n.func,ast.Attribute)and n.func.attr=='run'and any(k.arg=='input'for k in n.keywords));expr=next(k.value for k in n.keywords if k.arg=='input');ns=dict(source=b'actual-source',reuse=b'actual-reuse',code=CODE,hashlib=hashlib);raw=eval(compile(ast.Expression(expr),'actual-input-expression','eval'),ns);tree=ast.parse(raw);assign={n.targets[0].id:n.value.value for n in tree.body if isinstance(n,ast.Assign)and isinstance(n.value,ast.Constant)};self.assertEqual(assign['STOP_SHA'],hashlib.sha256(ns['source']).hexdigest());self.assertEqual(assign['REUSE_SHA'],hashlib.sha256(ns['reuse']).hexdigest());self.assertEqual(assign['SRC'],ns['source'])
if __name__=='__main__':unittest.main()
