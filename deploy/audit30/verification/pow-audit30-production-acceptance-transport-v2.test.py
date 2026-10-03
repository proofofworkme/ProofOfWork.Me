#!/usr/bin/python3 -I -B
"""Pure fixtures, never launch SSH or a native unit."""
import ast,base64,importlib.util,json,pathlib,unittest
p=pathlib.Path('/tmp/pow-audit30-production-acceptance-transport-v2.py');s=importlib.util.spec_from_file_location('T',p);T=importlib.util.module_from_spec(s);s.loader.exec_module(T)
class Tests(unittest.TestCase):
 def binding(self):return T.binding('/data/proofofwork-audit29-cutover-'+T.RELEASE+'-item2-v2/017-final.json','a'*64)
 def test_cutover_receipt_binding_namespace_and_digest(self):
  self.assertEqual(self.binding()['sha256'],'a'*64)
  for path in ['/tmp/017-final.json','/data/proofofwork-audit29-cutover-'+T.RELEASE+'-item2-v2/017-rolled-back.json']:
   with self.assertRaises(ValueError):T.binding(path,'a'*64)
  with self.assertRaises(ValueError):T.binding(self.binding()['path'],'bad')
 def test_strict_exact_source_and_request_pins(self):
  raw,env=T.assemble_value('strict',self.binding());q=json.loads(raw);e=json.loads(env)
  self.assertEqual(q,{'schema':'pow-audit30-production-strict-transport-request-v1','binding':self.binding()})
  self.assertEqual(T.sha(base64.b64decode(e['sourceBase64'])),T.PINS['strict'][1]);self.assertEqual(e['requestSHA256'],T.sha(raw))
 def test_positive_exact_nested_sources_and_production_mode(self):
  raw,env=T.assemble_value('positive',self.binding());q=json.loads(raw);e=json.loads(env)
  self.assertEqual(q['mode'],'production');self.assertEqual(q['binding'],{'cutover':self.binding()})
  self.assertEqual(T.sha(base64.b64decode(q['supervisorBase64'])),T.PINS['strict'][1]);self.assertEqual(T.sha(base64.b64decode(q['leafBase64'])),T.LEAF_SHA)
  self.assertEqual(T.sha(base64.b64decode(e['sourceBase64'])),T.PINS['positive'][1]);self.assertLess(len(env),262144)
 def test_remote_frozen_typed_delegation_and_managed_bounds(self):
  ast.parse(T.REMOTE)
  for fragment in ["result=n['main'](q['binding'])", "row.get('LoadState')=='not-found'", "'RuntimeMaxSec=15min'", "'MemoryMax=4G'", "'MemorySwapMax=0'", "'CPUQuota=100%'", "'TasksMax=128'", "'UMask=0077'", "'Restart=no'", "timeout=960", 'POSITIVE_NAMESPACE_EXISTS', 'PINNED_SOURCE_AND_REQUEST']:
   self.assertIn(fragment,T.REMOTE)
  self.assertEqual(T.REMOTE.count("r=subprocess.run(argv,input=request"),1)
 def test_preserve_unknown_transport_outcome_and_no_retry(self):
  text=p.read_text()
  for fragment in ['automaticRetry\':False','outcomeRequiresReceiptReconciliation\':True', "timeout=1500 if", "paths[0].open('xb')", "paths[1].open('xb')"]:self.assertIn(fragment,text)
  for fragment in ['rmtree','unlink(','retry(','git push','repair-canonical','systemctl restart']:self.assertNotIn(fragment,text)
if __name__=='__main__':unittest.main()
