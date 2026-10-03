import ast,pathlib,re,unittest
p=pathlib.Path('/tmp/pow-audit30-full-id-fence-diagnostic-readiness-v1.py');t=ast.parse(p.read_text());code=next(ast.literal_eval(n.value)for n in t.body if isinstance(n,ast.Assign)and any(isinstance(x,ast.Name)and x.id=='CODE'for x in n.targets));f=next(n for n in ast.parse(code).body if isinstance(n,ast.FunctionDef)and n.name=='ready_predicates');ns={'re':re};exec(compile(ast.Module(body=[f],type_ignores=[]),'actual-ready-predicates','exec'),ns)
def fixture():
 return {'status':200,'predicates':{'booleans':{k:True for k in ['ok','ready','available','checks.index.ok','checks.index.complete','checks.index.checkpointCanonical','checks.node.ok','checks.electrum.ok','checks.electrum.atTip','checks.worker.ok','checks.worker.proofReady']},'numbers':{**{k:969675 for k in ['checks.node.tipHeight','checks.index.indexedThroughBlock','checks.index.scanTipHeight','checks.electrum.headerHeight']},'checks.index.lagBlocks':0},'hashes':{k:'a'*64 for k in ['checks.node.bestBlockHash','checks.index.checkpointHash','checks.electrum.headerHash']}}}
class Tests(unittest.TestCase):
 def test_exactready_current_checkpoint(self):self.assertTrue(ns['ready_predicates'](fixture()))
 def test_503_never_ready(self):x=fixture();x['status']=503;self.assertFalse(ns['ready_predicates'](x))
 def test_health_timeout_not_ready(self):x=fixture();x['errorClass']='TimeoutError';self.assertFalse(ns['ready_predicates'](x))
 def test_missing_false_or_wrongtype_booleans_not_ready(self):
  for k in fixture()['predicates']['booleans']:
   for v in [None,False,'true',1]:
    x=fixture();x['predicates']['booleans'][k]=v;self.assertFalse(ns['ready_predicates'](x))
 def test_height_scan_hash_disagreement_refused(self):
  for field in ['checks.index.indexedThroughBlock','checks.index.scanTipHeight','checks.electrum.headerHeight']:
   x=fixture();x['predicates']['numbers'][field]-=1;self.assertFalse(ns['ready_predicates'](x))
  for field in ['checks.index.checkpointHash','checks.electrum.headerHash']:
   x=fixture();x['predicates']['hashes'][field]='b'*64;self.assertFalse(ns['ready_predicates'](x))
 def test_lag_or_bad_corehash_refused(self):
  x=fixture();x['predicates']['numbers']['checks.index.lagBlocks']=1;self.assertFalse(ns['ready_predicates'](x));x=fixture();x['predicates']['hashes']['checks.node.bestBlockHash']='private';self.assertFalse(ns['ready_predicates'](x))
 def test_read_only_bounded_once_noredirect(self):
  self.assertEqual(code.count("opener.open(URL,timeout=30)"),1);self.assertIn("URL='http://127.0.0.1:18081/health'",code);self.assertIn('ProxyHandler({})',code);self.assertIn('NoRedirect()',code);self.assertIn('leaseAfter>=750+30',code);self.assertIn('observedAfter==observed and shadowAfter==shadow and backupAfter==backup',code);self.assertNotIn("'stop'",code);self.assertNotIn('psql',code);self.assertNotIn('bitcoin-cli',code)
if __name__=='__main__':unittest.main()
