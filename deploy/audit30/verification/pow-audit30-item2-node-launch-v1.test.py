"""Pure acceptance/launch-contract tests; never invoke SSH or systemd."""
import ast,copy,datetime,hashlib,json
from pathlib import Path
import unittest
from unittest.mock import patch

SOURCE=Path('/tmp/pow-audit30-item2-node-launch.py').read_bytes()
N={'__name__':'_pure_item2_launch','__file__':'/tmp/pow-audit30-item2-node-launch.py'}
exec(compile(SOURCE,N['__file__'],'exec'),N)

class LaunchTests(unittest.TestCase):
 def inputs(self):
  unit='proofofwork-audit29-verify-'+N['RELEASE']+'-shadow-strict-v3.service'
  a={'ok':True,'mode':'shadow','network':'livenet','base':'http://127.0.0.1:18081','authority':'http://127.0.0.1:18081',
     'candidate':{'commit':'38ac6e2bff2ac16890724e5213346ef8a3ebd186','tree':'8b9b5e3cd47aa8e4204da717350a629176e30da6','runtimeSha256':'13035b6d1fbca1be9c03b1833f3abe578d4ae28331a341b3dea4301cc72b535c'},
     'gates':{'ids':True,'events':True,'parity':True},'completedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),
     'stableCheckpoint':{'height':969752,'hash':'a'*64},'privateLauncher':{'unit':unit,'scriptSha256':'bbded71fa88cfc108c611b3beddd3a6c693b38477c356b682caed8985976abda'}}
  raw=json.dumps(a).encode()
  c={'schema':'pow-audit30-strict-native-completed-v1','returncode':0,'stopped':True,'timerRestored':True,'liveFiveUnchanged':True,'shadowUnchanged':True,
     'acceptedReceiptSHA256':hashlib.sha256(raw).hexdigest(),'unit':unit,'acceptedReceiptPath':'/data/proofofwork-audit29-verify-launch-'+N['RELEASE']+'-shadow-strict-v3/accepted-receipt.json'}
  l={'schema':'pow-audit30-node-readonly-shadow-prepared-v1','ok':True,'health':{'ready':True},'liveServicesUnchanged':True}
  return a,c,l
 def call(self,a,c,l):
  raw=json.dumps(a).encode();c=copy.deepcopy(c);c['acceptedReceiptSHA256']=hashlib.sha256(raw).hexdigest()
  with patch.object(N['subprocess'],'run',side_effect=AssertionError('No native/network call allowed')):
   return N['accepted_inputs'](raw,json.dumps(c).encode(),json.dumps(l).encode(),N['ROOT']+'/strict-native-v3-completed.json',N['ROOT']+'/shadow-lease-v3-prepared.json')
 def test_only_all_three_pass_and_completed_pair(self):
  a,c,l=self.inputs();refs=self.call(a,c,l)
  self.assertEqual(refs['strictAccepted']['path'],c['acceptedReceiptPath'])
  for gate in ('ids','events','parity'):
   bad=copy.deepcopy(a);bad['gates'][gate]=False
   with self.assertRaisesRegex(ValueError,'ALL_FRESH_STRICT_GATES_REQUIRED'):self.call(bad,c,l)
 def test_failure_and_old_namespace_refused(self):
  a,c,l=self.inputs();c['timerRestored']=False
  with self.assertRaisesRegex(ValueError,'COMPLETION_ACCEPTED_PAIR'):self.call(a,c,l)
  a,c,l=self.inputs();c['unit']=a['privateLauncher']['unit']=c['unit'].replace('strict-v3','strict-v2')
  with self.assertRaisesRegex(ValueError,'FRESH_STRICT_V3_REQUIRED'):self.call(a,c,l)
 def test_stale_refused(self):
  a,c,l=self.inputs();a['completedAt']=(datetime.datetime.now(datetime.timezone.utc)-datetime.timedelta(seconds=1801)).isoformat()
  with self.assertRaisesRegex(ValueError,'STRICT_AGE'):self.call(a,c,l)
 def test_remote_ast_and_exact_source_pin(self):
  ast.parse(N['REMOTE'])
  self.assertEqual(hashlib.sha256(N['WRAPPER'].read_bytes()).hexdigest(),N['WRAPPER_SHA'])
  self.assertIn("idle=n['idle_window']()",N['REMOTE'])
  self.assertIn("'RuntimeMaxSec=30min'",N['REMOTE'])
  self.assertIn("'MemorySwapMax=0'",N['REMOTE'])
  self.assertEqual(N['REMOTE'].count("r=subprocess.run(argv,input=request"),1)

if __name__=='__main__':unittest.main()
