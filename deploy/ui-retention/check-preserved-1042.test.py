#!/usr/bin/env python3
"""Exact additive hold contract. Synthetic evidence, no production operations."""
import copy, importlib.util, pathlib, types, unittest
from unittest.mock import patch
ROOT=pathlib.Path(__file__).resolve().parents[2]
def load(name,path):
 spec=importlib.util.spec_from_file_location(name,ROOT/path);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
S=load('hold_storage','deploy/audit30/ui-storage.py')
P=load('hold_policy','deploy/audit30/ui-release-policy.py')
A=load('hold_admission','deploy/publish/publication_admission.py')
P.S=S
class ExactHold(unittest.TestCase):
 def setUp(self):
  self.layout=types.SimpleNamespace(roots=pathlib.Path('/var/backups/proofofwork-ui/rollback-roots'),archives=pathlib.Path('/var/backups/proofofwork-ui/releases'))
  self.paths=S.preserved_1042_paths(self.layout)
  self.root={'path':self.paths[0],'sha256':'a'*64,'entries':[{'path':'.proofofwork-ui-release','sha256':'b'*64}]}
  self.archive={'path':self.paths[1],'sha256':'c'*64,'entries':[]}
  self.sidecars=[{'path':p,'sha256':x*64,'entries':[]} for p,x in zip(self.paths[2:],'de')]
  self.bindings=[{'sha256':P.PRESERVED_1042_ADMISSIONS[k]} for k in ('archive','root')]
  self.admissions=[{'retainedPair':{'current':S.PRESERVED_1042_PREDECESSOR,'previous':'prior'},'archives':[{'snapshot':self.archive,'sidecars':self.sidecars,'payloadSha256':'f'*64}]},{'retainedPair':{'current':S.PRESERVED_1042_INTRODUCER,'previous':S.PRESERVED_1042_PREDECESSOR},'roots':[{'snapshot':self.root}]}]
 def hold(self):return P.preserved_1042_hold(self.layout,self.bindings,self.admissions)
 def test_exact_lineage_is_bound_and_older_history_is_unchanged(self):
  h=self.hold();self.assertEqual(list(h['snapshotSha256']),self.paths)
  self.assertEqual(h['model'],'verified-1042-in-place-hold-v1')
  self.assertIsNone(P.preserved_1042_hold(self.layout,self.bindings[:1],self.admissions[:1]))
 def test_bad_admission_or_pair_fails_closed(self):
  for mode in ('digest','pair','duplicate','root-path','sidecar-path'):
   with self.subTest(mode=mode):
    self.setUp()
    if mode=='digest':self.bindings[0]['sha256']='0'*64
    if mode=='pair':self.admissions[1]['retainedPair']['previous']='foreign'
    if mode=='duplicate':self.admissions.append(copy.deepcopy(self.admissions[1]))
    if mode=='root-path':self.root['path']='/foreign'
    if mode=='sidecar-path':self.sidecars[0]['path']='/foreign'
    with self.assertRaises(ValueError):self.hold()
 def test_physical_bytes_and_metadata_are_reverified(self):
  h=self.hold();root={'path':self.paths[0],'snapshot':self.root,'fields':{'release_id':S.PRESERVED_1042_PREDECESSOR},'manifestSha256':'b'*64}
  cache={self.paths[1]:{'snapshot':self.archive,'sidecars':self.sidecars,'payloadSha256':'f'*64}}
  P.verify_1042_hold(h,self.layout,{'previous':root},cache)
  for key in ('manifestSha256','archivePayloadSha256','model','releaseId','introducedBy'):
   bad=copy.deepcopy(h);bad[key]='foreign'
   with self.subTest(key=key),self.assertRaises(ValueError):P.verify_1042_hold(bad,self.layout,{'previous':root},cache)
  bad=copy.deepcopy(h);bad['snapshotSha256'][self.paths[0]]='0'*64
  with self.assertRaises(ValueError):P.verify_1042_hold(bad,self.layout,{'previous':root},cache)
  with patch.object(S,'release_proof',side_effect=FileNotFoundError('missing')):
   with self.assertRaises(FileNotFoundError):P.verify_1042_hold(h,self.layout,{'previous':{'path':'other'}},{})
 def test_admission_cannot_drop_or_replace_additive_hold(self):
  h=self.hold();old={'snapshotSha256':{'old':'a'*64}}
  rule={'model':'private-stage-zero-retirement-v1','wouldRetire':[],'preservedFallback':old,'preservedRelease1042':h}
  observed={'verifiedPreservedFallback':old,'verifiedPreservedRelease1042':h,'privateStageRetention':rule}
  A.check_observation(observed,True,rule,compare=True)
  for value in (None,{},dict(h,releaseId='foreign')):
   changed=copy.deepcopy(observed);changed['privateStageRetention']['preservedRelease1042']=value
   with self.assertRaises(ValueError):A.check_observation(changed,True)
  with self.assertRaises(ValueError):A.require_obligation(observed,False)
 def test_no_retirement_or_future_pair_permission_is_added(self):
  for checker in (A.reviewed_forecast,S.reviewed_forecast):
   self.assertTrue(checker({'model':'private-stage-zero-retirement-v1','wouldRetire':[]}))
   for pair in ({'current':S.PRESERVED_1042_INTRODUCER,'previous':S.PRESERVED_1042_PREDECESSOR},{'current':'future','previous':S.PRESERVED_1042_INTRODUCER}):
    self.assertFalse(checker({'model':'private-stage-reviewed-retirement-v1','previousPair':pair,'wouldRetire':self.paths,'preservedFallback':{'snapshotSha256':{'old':'a'*64}},'preservedRelease1042':self.hold()}))
 def test_exact_paths_are_reserved_in_low_level_storage_guard(self):
  self.layout.live=pathlib.Path('/var/www')
  self.layout.scratch=pathlib.Path('/var/tmp/proofofwork-deploy')
  self.layout.base=pathlib.Path('/var/backups/proofofwork-ui')
  current='111111111111-20261112T220000Z';previous='222222222222-20261112T210000Z'
  def row(path,rid=None):
   x={'path':str(path),'snapshot':{'path':str(path),'entries':[],'sha256':S.digest([])}}
   if rid:x['fields']={'release_id':rid}
   return x
  protected={'current':row(self.layout.live,current),'previous':row(self.layout.roots/('proofofwork-www-pre-'+current),previous),
             'sources':[row(S.source_locations(self.layout,rid)[0]) for rid in (current,previous)]}
  for target in [*self.paths,str(self.layout.roots),self.paths[0]+'/nested']:
   deletion={'path':target,'kind':'rollback-root'}
   plan={'schema':'pow-audit30-exact-ui-storage-plan-v1','host':'77.42.91.106','kind':'future-retention',
         'scopeApprovalSha256':'test','safeguards':{},'protected':protected,
         'delete':[deletion],'moves':[],'policyScope':{'eligible':[deletion]}}
   with self.subTest(target=target),self.assertRaisesRegex(ValueError,'intersects the preserved fallback'):
    S.validate_plan(plan,self.layout,'future-retention','test')
if __name__=='__main__':unittest.main()
