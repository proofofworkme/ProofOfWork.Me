#!/usr/bin/python3 -I -B
"""Publication source-custody and exact metadata predicate fixtures; no publication."""
import ast
import hashlib
import importlib.util
import json
from pathlib import Path
import unittest
SOURCE=Path('/tmp/pow-audit30-item2-ui-preserved-publish-owner-v1.py')
OLD=Path('/home/sixer/ProofOfWork.Me/deploy/audit30/verification/item2-ui-release-38ac-v1/publish.py')
CONTINUATION=Path('/tmp/pow-audit30-item2-ui-preserved-continuation-v1.py')

def module():
 spec=importlib.util.spec_from_file_location('_pub_fixture_owner',CONTINUATION)
 m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m

def assignments():
 result={}
 for n in ast.parse(SOURCE.read_bytes()).body:
  if isinstance(n,ast.Assign)and len(n.targets)==1 and isinstance(n.targets[0],ast.Name)and n.targets[0].id=='package_pins':result=ast.literal_eval(n.value)
 return result

class Publish(unittest.TestCase):
 def test_entire_original_exchange_lock_inverse_capacity_and_verification_source_preserved(self):
  s=SOURCE.read_text();m=module()
  lines=s.splitlines(keepends=True)
  s=''.join(line for line in lines if not line.startswith("assert release=='")and not line.startswith("assert plan_path=='"))
  start=s.index('package=pathlib.Path(');end=s.index("ns={'__name__':'_recovery_publisher_fingerprint'}",start)
  s=s[:start]+s[end:]
  s=s.replace("source='"+str(m.SOURCE_ROOT)+"'","source='/var/tmp/proofofwork-deploy/proofofwork-ui-source-'+release")
  s=s.replace("args=[str(package/'publisher.sh'),","args=[plan['publicationHelpers']['publisher']['path'],")
  s=s.replace(' attest_package()\n child=subprocess.Popen',' child=subprocess.Popen')
  s=s.replace("attest_package()\nfor record in plan['publicationHelpers'].values():load_bound(record['path'],record['sha256'],2*1024**2)\nreceipt=",'receipt=')
  self.assertEqual(s.encode(),OLD.read_bytes())
 def test_exact_release_metadata_predicates_refuse_each_wrong_field(self):
  m=module();tree=ast.parse(SOURCE.read_bytes())
  predicates=[n.test for n in tree.body if isinstance(n,ast.Assert)and n.lineno in [25,26,27,28]]
  predicates=[n.test for n in tree.body if isinstance(n,ast.Assert)and (ast.unparse(n.test).startswith('release ==')or ast.unparse(n.test).startswith('plan_path =='))]
  self.assertEqual(len(predicates),2)
  values={'release':m.RELEASE,'commit':m.COMMIT,'tree':m.TREE,'plan_sha':m.PLAN_SHA,'attempt':'item2-v1','plan_path':str(m.PLAN_PATH)}
  def passes(v):return all(eval(compile(ast.Expression(p),'_predicate_fixture','eval'),v.copy())for p in predicates)
  self.assertTrue(passes(values))
  for key in values:self.assertFalse(passes({**values,key:'wrong-value'}),key)
 def test_ephemeral_package_all_pins_and_manifest_match_prepared_typed_sources(self):
  m=module();pins=assignments();request=json.loads(Path('/tmp/pow-audit30-item2-ui-preserved-prepare-request-v1.json').read_bytes())
  _,files=m.request(json.dumps(request).encode(),'prepare')
  self.assertEqual(set(pins),set(files)|{'manifest.json'})
  for name,data in files.items():self.assertEqual(hashlib.sha256(data).hexdigest(),pins[name])
  manifest=(json.dumps(m.helper_manifest(files),indent=2)+'\n').encode();self.assertEqual(hashlib.sha256(manifest).hexdigest(),pins['manifest.json'])
 def test_package_authority_is_attested_before_and_after_exact_child(self):
  s=SOURCE.read_text();self.assertEqual(s.count('attest_package()'),4)
  initial=s.index("env['POW_UI_PUBLISH_PROVENANCE_SCRIPT']");child=s.index('child=subprocess.Popen');after=s.index("receipt={'attempt':attempt")
  self.assertLess(s.index('attest_package()\nenv['),initial)
  self.assertLess(s.index(' attest_package()\n child='),child)
  self.assertLess(child,s.index('attest_package()\nfor record'))
  self.assertLess(s.index('attest_package()\nfor record'),after)
  self.assertIn("args=[str(package/'publisher.sh')",s)
  self.assertIn("env['POW_UI_PUBLISH_PROVENANCE_SCRIPT']=str(package/'provenance.sh')",s)

if __name__=='__main__':unittest.main()
