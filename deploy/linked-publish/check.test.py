#!/usr/bin/env python3
"""Offline guard tests. No database, network, service or runtime writes."""
import copy,hashlib,runpy,subprocess,unittest,tempfile
from pathlib import Path
HERE=Path(__file__).resolve().parent
sha=lambda b:hashlib.sha256(b).hexdigest()
class Guards(unittest.TestCase):
 def setUp(self):
  self.m=runpy.run_path(str(HERE/'release.py'))
  self.ns=self.m['engine']['namespace'](self.m['controller']())
 def test_scope_and_preserved_foundations(self):
  self.assertEqual(set(self.ns['ALLOWED']),{'src/shared/protocol/publishArticleMetadata.mjs', 'server/boost-growth.mjs', 'src/shared/protocol/powcatLimits.mjs', 'server/db/proof-index-reader.mjs', 'server/search-projection.mjs', 'src/shared/protocol/publishReaderPage.mjs', 'src/shared/protocol/publishArticle.mjs', 'server/publish-linked.mjs', 'server/publish-linked-source.mjs', 'src/shared/protocol/powcat1.mjs', 'scripts/backfill-proof-indexer.mjs', 'server/powcat-index.mjs', 'server/sql/proof-search-linked-publish-v1.sql', 'server/search-linked-publish.mjs', 'scripts/backfill-proof-search.mjs', 'server/db/boost-growth-reader.mjs', 'server/db/search-reader.mjs', 'server/powcat-reader.mjs', 'server/proof-api.mjs'})
  expected_reader_scope={'src/shared/protocol/publishReaderPage.mjs','src/shared/protocol/publishArticleMetadata.mjs','src/shared/protocol/powcatLimits.mjs','src/shared/protocol/powcat1.mjs'}
  self.assertTrue(expected_reader_scope <= set(self.ns['ALLOWED']))
  self.assertTrue((expected_reader_scope-{'src/shared/protocol/powcat1.mjs'}) <= set(self.ns['NEW']))
  self.assertNotIn('src/shared/protocol/powcat1.mjs',self.ns['PRESERVED'])
  self.assertEqual(self.ns['INSTALL_ORDER'][-1],'server/proof-api.mjs')
  self.assertEqual(set(self.ns['AFTER']),set(self.ns['ALLOWED']))
  self.assertIn('server/search-generation-sharing.mjs',self.ns['PRESERVED'])
  self.assertIn('server/db/read-only-snapshot.mjs',self.ns['PRESERVED'])
  pins=runpy.run_path(str(HERE/'prepare-profile.py'))['EMERGENCY_PRESERVED']
  for name,digest in pins.items():self.assertEqual(self.ns['PRESERVED'].get(name),digest)
 def test_generator_preserves_exact_emergency_dependencies(self):
  generator=runpy.run_path(str(HERE/'prepare-profile.py'))
  expected=generator['EMERGENCY_PRESERVED']
  self.assertEqual(set(expected),{'server/work-amo-v5-raw.mjs','server/incb-replay-components.mjs','scripts/migrate-work-amo-v5.mjs'})
  with tempfile.TemporaryDirectory() as directory:
   root=Path(directory)
   names=('server/db/read-only-snapshot.mjs','server/search-generation-sharing.mjs',*expected)
   for name in names:
    path=root/name;path.parent.mkdir(parents=True,exist_ok=True)
    path.write_bytes((HERE.parents[1]/name).read_bytes())
   result=generator['preserved_foundations'](root)
   self.assertEqual(len(result),5)
   for name,digest in expected.items():
    self.assertEqual(result[name],digest)
    path=root/name;original=path.read_bytes()
    path.write_bytes(original+b'\n// drift\n')
    with self.subTest(changed=name),self.assertRaisesRegex(ValueError,'Emergency INCB dependency changed'):
     generator['preserved_foundations'](root)
    path.unlink()
    with self.subTest(missing=name),self.assertRaises(FileNotFoundError):
     generator['preserved_foundations'](root)
    path.write_bytes(original)
 def test_exact_emergency_linked_api_import_collision(self):
  generator=runpy.run_path(str(HERE/'prepare-profile.py'))
  inputs=generator['REVIEWED_API_INPUTS'];hunk=generator['REVIEWED_API_HUNK']
  resolved,replacements=generator['resolve']('server/proof-api.mjs',hunk,inputs)
  self.assertEqual(resolved.count(b'import { bindCanonicalIncbMintPosition }'),1)
  self.assertIn(b'const linkedWriterCapabilityEndpoint=',resolved)
  self.assertNotIn(b'isReadOnlySnapshotBudgetError',resolved)
  self.assertEqual(len(replacements),1)
  for index in range(3):
   changed=list(inputs);changed[index]='0'*64
   with self.subTest(input=index),self.assertRaises(ValueError):
    generator['resolve']('server/proof-api.mjs',hunk,tuple(changed))
  with self.assertRaises(ValueError):
   generator['resolve']('server/proof-api.mjs',hunk.replace(b'enabled:',b'changed:'),inputs)
  with self.assertRaises(ValueError):
   generator['resolve']('server/proof-api.mjs',hunk)
 def fixture(self,canonical=False):
  a,b,c,conf=b'active',b'base',b'candidate',b'CONFLICT'
  result=c if canonical else b'RESOLVED'
  rule={'inputs':dict(active=sha(a),base=sha(b),canonical=sha(c),conflicted=sha(conf)),
   'returncode':1,'useReviewedCanonical':canonical,'replacements':[] if canonical else [('CONFLICT','RESOLVED')]}
  ns={'MERGES':{'file':rule},'EXISTING':{'file':sha(a)},'AFTER':{'file':sha(result)}}
  proc=subprocess.CompletedProcess([],1,conf)
  return ns,c,a,b,proc,result
 def test_exact_import_union(self):
  ns,c,a,b,p,result=self.fixture()
  self.assertEqual(self.m['resolve_merge'](ns,'file',c,a,b,p),result)
 def test_exact_reviewed_semantic_candidate(self):
  ns,c,a,b,p,result=self.fixture(True)
  self.assertEqual(self.m['resolve_merge'](ns,'file',c,a,b,p),result)
 def test_each_changed_input_rejected(self):
  for canonical in [False,True]:
   for index in range(4):
    ns,c,a,b,p,_=self.fixture(canonical)
    args=[c,a,b,p]
    args[index]=subprocess.CompletedProcess([],1,b'changed') if index==3 else b'changed'
    with self.subTest(canonical=canonical,index=index),self.assertRaises(RuntimeError):
     self.m['resolve_merge'](ns,'file',*args)
 def test_changed_output_rejected(self):
  ns,c,a,b,p,_=self.fixture();ns['AFTER']['file']='0'*64
  with self.assertRaises(RuntimeError):self.m['resolve_merge'](ns,'file',c,a,b,p)
 def test_unfinished_apply_cannot_modify_production(self):
  with self.assertRaisesRegex(RuntimeError,'apply is disabled'):self.m['blocked_apply'](None)
 def test_no_implicit_unpin_or_legacy_fallback(self):
  raw=(HERE/'pin-serving.mjs').read_text()
  self.assertNotIn('DELETE FROM',raw);self.assertNotIn('UPDATE proof_indexer.search_serving_pins',raw)
  self.assertIn('A different serving pin already exists',raw)
 def test_reviewed_search_profile_uses_exact_candidate(self):
  for name in ['server/db/search-reader.mjs','scripts/backfill-proof-search.mjs']:
   self.assertTrue(self.ns['MERGES'][name]['useReviewedCanonical'])
   self.assertEqual(self.ns['AFTER'][name],self.ns['CANONICAL'][name])
 def test_rollback_recovery_preserves_exact_helper_semantics(self):
  raw=(HERE/'coordinator.py').read_text()
  self.assertIn("ns['validate_manifest'](manifest),'rollback'",raw)
  self.assertIn("manifest['sourceMetadata'],'rollback'",raw)
 def test_actual_engine_rollback_fence_accepts_only_exact_retained_helper(self):
  ns=self.ns;new=next(iter(ns['NEW']));old='server/proof-api.mjs';a,b=b'old',b'new'
  root=Path('/runtime')
  m={'sources':[{'path':old,'before':sha(a),'after':sha(b)},{'path':new,'before':None,'after':sha(b)}],'dependencies':{old:sha(a)}}
  values={old:a,new:b}
  ns['safe_read']=lambda path,*args,**kwargs:values.get(str(path.relative_to(root)))
  ns['dependency_closure']=lambda *args:set()
  ns['engine_fence'](root,m,{},'rollback')
  with self.assertRaises(ValueError):ns['engine_fence'](root,m,{},'baseline')
  values[new]=b'unknown helper'
  with self.assertRaises(ValueError):ns['engine_fence'](root,m,{},'rollback')
  values[new]=b;values[old]=b'changed old runtime'
  with self.assertRaises(ValueError):ns['engine_fence'](root,m,{},'rollback')
if __name__=='__main__':unittest.main()
