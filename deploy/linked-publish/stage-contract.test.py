import ast,runpy,unittest
from pathlib import Path
HERE=Path(__file__).resolve().parent
class Contract(unittest.TestCase):
 def test_producer_and_assembled_consumer_use_identical_contract(self):
  c=runpy.run_path(str(HERE/'stage-contract.py'))
  s=runpy.run_path(str(HERE/'stage.py'))
  r=runpy.run_path(str(HERE/'release.py'));n=r['engine']['namespace'](r['controller']())
  self.assertEqual(str(c['LINKED_STAGE_ROOT']),'/data/proofofwork-linked-publish-stage-v2')
  self.assertEqual(s['STAGES'],c['LINKED_STAGE_ROOT']);self.assertEqual(n['LINKED_STAGE_ROOT'],s['STAGES'])
  self.assertEqual(n['validate_linked_stage'].__code__.co_code,c['validate_linked_stage'].__code__.co_code)
 def test_validation_precedes_hold_and_drain_and_repeats(self):
  coordinator=(HERE/'coordinator.py').read_text();self.assertLess(coordinator.index("ns['validate_linked_stage']"),coordinator.index('class Operations'))
  raw=runpy.run_path(str(HERE/'release.py'))['controller']().decode()
  tree=ast.parse(raw);main=next(x for x in tree.body if isinstance(x,ast.FunctionDef) and x.name=='main')
  body=ast.get_source_segment(raw,main)
  self.assertLess(body.index('validate_linked_stage('),body.index('drain_apps()'))
  self.assertIn('validate_linked_stage(', (HERE/'preinstall.py').read_text())
 def test_legacy_consumer_cannot_be_hidden_by_fixture_remapping(self):
  text=(HERE/'preinstall.py').read_text()
  self.assertNotIn("Path('/data/proofofwork-linked-publish-stage')",text)
  self.assertNotIn('proofofwork-linked-publish-stage-v2',text)
if __name__=='__main__':unittest.main()
