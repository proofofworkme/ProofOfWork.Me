import ast,hashlib,io,json,pathlib,signal,subprocess,types,unittest
from unittest.mock import patch
P=pathlib.Path('/tmp/pow-audit30-mail-import-readonly-diagnostic-v1.py');m=types.ModuleType('diag');exec(compile(P.read_bytes(),str(P),'exec'),m.__dict__)
LEAF=pathlib.Path('/tmp/pow-audit30-mail-projection-focused-leaf-v2.mjs').read_bytes();SOURCE=pathlib.Path('/tmp/pow-audit30-mail-projection-focused-root-v2.py').read_bytes()
OK=json.dumps({'schema':'pow-audit30-static-import-readable-v1','nativeUid':108,'nativeGid':112,'graphReadable':True,'databaseCalls':0}).encode()
class Proc:
 def __init__(self,stdout=OK,stderr=b'',rc=0,error=None):self.stdin=io.BytesIO();self.stdout=io.BytesIO();self.stderr=io.BytesIO();self.pid=987654;self.returncode=rc;self.out=stdout;self.err=stderr;self.error=error;self.received=None
 def communicate(self,code,timeout):self.received=(code,timeout);assert timeout==10
 def poll(self):return self.returncode
 def wait(self,timeout):self.returncode=-9;return -9
class T(unittest.TestCase):
 def run_probe(self,p):
  def communicate(code,timeout):p.received=(code,timeout)
  def framed(code,timeout):
   p.received=(code,timeout);self.assertEqual(timeout,10)
   if p.error:raise p.error
   return p.out,p.err
  p.communicate=framed
  with patch.object(m.subprocess,'Popen',return_value=p)as call,patch.object(m.os,'killpg')as kill:
   r=m.child_probe(LEAF,'/exact-reviewed-cwd');args=call.call_args;self.assertEqual(args.args[0],[m.NODE,'--max-old-space-size=128','--input-type=module','-']);self.assertEqual(args.kwargs['user'],108);self.assertEqual(args.kwargs['group'],112);self.assertEqual(args.kwargs['extra_groups'],[]);self.assertEqual(args.kwargs['env'],m.ENV);self.assertEqual(p.received[0],LEAF+m.APPEND);self.assertTrue(all('DATABASE'not in k and 'PG'not in k for k in m.ENV));return r,kill.call_args_list
 def test_readable_without_invoking_run_or_database(self):
  r,k=self.run_probe(Proc());self.assertTrue(r['graphReadable']);self.assertTrue(r['childStopped']);self.assertEqual(r['classification'],'IMPORT_COMPLETED');self.assertEqual(k,[]);self.assertNotIn(b'run(',m.APPEND)
 def test_closed_permission_failure_no_raw_path(self):
  r,k=self.run_probe(Proc(stdout=b'',stderr=b'Error EACCES secret/path',rc=1));self.assertEqual(r['classification'],'EACCES');self.assertFalse(r['graphReadable']);self.assertNotIn('secret/path',json.dumps(r));self.assertEqual(k,[])
 def test_module_absence_distinct_and_closed(self):
  r,_=self.run_probe(Proc(stdout=b'',stderr=b'Error ERR_MODULE_NOT_FOUND private-location',rc=1));self.assertEqual(r['classification'],'ERR_MODULE_NOT_FOUND');self.assertNotIn('private-location',json.dumps(r))
 def test_forged_output_does_not_claim_readability(self):
  r,_=self.run_probe(Proc(stdout=b'{"graphReadable":true}'));self.assertFalse(r['graphReadable']);self.assertEqual(r['classification'],'IMPORT_OUTPUT_REFUSED')
 def test_timeout_only_owned_child_group_reaped(self):
  r,k=self.run_probe(Proc(rc=None,error=subprocess.TimeoutExpired('fixed',10,output=b'',stderr=b'private timeout detail')));self.assertEqual(r['classification'],'IMPORT_DEADLINE');self.assertEqual(k[0].args,(987654,signal.SIGKILL));self.assertTrue(r['childStopped']);self.assertEqual(r['cleanupErrors'],[]);self.assertNotIn('private timeout detail',json.dumps(r))
 def test_signal_cleanup_and_handler_restoration(self):
  before={s:signal.getsignal(s)for s in [signal.SIGTERM,signal.SIGINT]};r,k=self.run_probe(Proc(rc=None,error=RuntimeError('IMPORT_DIAGNOSTIC_SIGNAL')));self.assertEqual(r['classification'],'IMPORT_SIGNAL');self.assertEqual(k[0].args,(987654,signal.SIGKILL));self.assertEqual({s:signal.getsignal(s)for s in before},before)
 def test_original_prefix_ends_before_any_write_or_child(self):
  t=ast.parse(SOURCE);fn=next(n for n in t.body if isinstance(n,ast.FunctionDef)and n.name=='main');stop=next(i for i,n in enumerate(fn.body)if isinstance(n,ast.Expr)and isinstance(n.value,ast.Call)and isinstance(n.value.func,ast.Attribute)and n.value.func.attr=='mkdir');prefix=ast.unparse(ast.Module(body=fn.body[:stop],type_ignores=[]));self.assertNotIn('Popen',prefix);self.assertNotIn('JOB.mkdir',prefix);self.assertNotIn('save(a,',prefix);self.assertIn('CURRENT_ENV_PIN',prefix);self.assertEqual(hashlib.sha256(SOURCE).hexdigest(),m.ROOT_PIN);self.assertEqual(hashlib.sha256(LEAF).hexdigest(),m.LEAF_PIN)
 def test_original_leaf_imports_are_static_pool_not_called(self):
  s=LEAF.decode();self.assertNotIn('await run(',s);self.assertEqual(s.count('createProofIndexPool()'),1);self.assertIn('export async function run(known)',s);self.assertFalse(any(k.startswith(('PG','LD_','NODE_OPTIONS','DATABASE','POW_INDEX_DATABASE'))for k in m.ENV))
 def test_bootstrap_exact_typed_sources_and_diagnostic_bytes(self):
  import base64
  b=pathlib.Path('/tmp/pow-audit30-mail-import-readonly-bootstrap-v1.py').read_bytes();t=ast.parse(b);values={n.targets[0].id:ast.literal_eval(n.value)for n in t.body if isinstance(n,ast.Assign)};self.assertEqual(base64.b64decode(values['SOURCE_BASE64']),P.read_bytes());self.assertEqual(values['SOURCE_SHA'],hashlib.sha256(P.read_bytes()).hexdigest());r=pathlib.Path('/tmp/pow-audit30-mail-projection-focused-request-v2.json').read_bytes();self.assertEqual(hashlib.sha256(r).hexdigest(),'9ed745006112c8b6c7eb105b1794278531d148231c1ff5dc74eeeac2c750a08d');d=json.loads(r);self.assertEqual(base64.b64decode(d['rootBase64']),SOURCE);self.assertEqual(base64.b64decode(d['leafBase64']),LEAF)
 def test_actual_bootstrap_bad_request_refuses_before_prefix_child(self):
  p=subprocess.run(['/usr/bin/python3','-I','-B','/tmp/pow-audit30-mail-import-readonly-bootstrap-v1.py','9ed745006112c8b6c7eb105b1794278531d148231c1ff5dc74eeeac2c750a08d'],input=b'{}',capture_output=True,timeout=5);self.assertEqual(p.returncode,1);self.assertEqual(p.stdout,b'');r=json.loads(p.stderr);self.assertEqual(r['sqlCalls'],0);self.assertEqual(r['errorClass'],'AssertionError');self.assertFalse(r['automaticRetry'])
 def test_wrapper_reuses_exact_shared_owned_transport(self):
  s=pathlib.Path('/tmp/pow-audit30-mail-import-readonly-transport-v1.py').read_text();self.assertIn('1dedef0a6c7021d114017e711ad74f9cfed4e461fc047a2be2c49e590f3da18e',s);self.assertIn('m.execute(m.remote_command(b,RP),r',s);self.assertIn("'sqlCalls':0",s);self.assertIn("'childLaunches':1",s);self.assertIn('pow-audit30-mail-import-readonly-native-v1',s)
if __name__=='__main__':unittest.main()
