#!/usr/bin/env python3
"""Fixture-only successor policy and publication-boundary checks."""
import copy
import importlib.util
from pathlib import Path
import types
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
def load(name, path):
    spec=importlib.util.spec_from_file_location(name,path)
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    return module
P=load('retirement_policy_test', HERE.parent/'audit30/ui-release-policy.py')
L=load('retirement_lifecycle_test', HERE/'lifecycle_remote.py')
PAIR={'current':'064b6991ae2a-20261114T020148Z','previous':'e2669bc1fd32-20261112T163804Z'}
BASE='/var/backups/proofofwork-ui'
ROOT=BASE+'/rollback-roots'
ARCH=BASE+'/releases'
OLDROOTS=[ROOT+'/proofofwork-www-pre-e2669bc1fd32-20261112T163804Z',
          ROOT+'/proofofwork-www-pre-54088ca155bc-20261103T032112Z']
OLDARCH=[ARCH+'/proofofwork-ui-release-1042efea2aa1-20261112T074918Z.tgz',
         ARCH+'/proofofwork-ui-release-c3969c39c2b2-20261101T051206Z.tgz']
PATHS=[OLDARCH[0],OLDROOTS[0],OLDARCH[1],OLDROOTS[1]]
SIDECARS=[p+s for p in OLDARCH for s in ('.sha256','.provenance')]
class Context:
    source_admissions=[{'path':'old-admission','sha256':'1'*64}]
    source_retirements=[{'path':'old-retirement','sha256':'2'*64}]
    source_pair=PAIR
    proof={'model':'intentionally-retired-payloads-retained-evidence-v1','retiredPayloadPaths':PATHS}
    def __init__(self):self.scopes=0;self.payloads=0;self.lineages=0
    def is_retired(self,path):return path in PATHS
    def verify_scope(self,layout,pair=None):self.scopes+=1
    def verify_payloads(self,layout):self.payloads+=1
    def verify_lineage(self,index,admissions):self.lineages+=1

def typed(value):
    if not isinstance(value,Context):raise ValueError('Unverified retirement object')
def data(context=None):
    ctx=context or Context()
    return {'index':{'admissions':copy.deepcopy(ctx.source_admissions),
                     'completedRetirements':copy.deepcopy(ctx.source_retirements),
                     'payloadRetirement':copy.deepcopy(ctx.proof)},
            'admissions':[{'retainedPair':PAIR.copy()}],
            'roots':{p:{} for p in OLDROOTS},'assets':{p:{} for p in OLDARCH+SIDECARS},
            'retired':set(PATHS),'indexPath':'index','indexSha256':'a'*64,'migration':None}
class PolicyTests(unittest.TestCase):
    def test_untrusted_index_extension_rejected(self):
        with self.assertRaisesRegex(ValueError,'authenticated successor'):
            P.retirement_lineage(data(),None)
    def test_original_lineage(self):P.retirement_lineage(data(),Context())
    def test_changed_historical_admission_rejected(self):
        d=data();d['index']['admissions'][0]['sha256']='f'*64
        with self.assertRaisesRegex(ValueError,'immutable ancestor'):P.retirement_lineage(d,Context())
    def test_changed_historical_retirement_rejected(self):
        d=data();d['index']['completedRetirements'][0]['sha256']='f'*64
        with self.assertRaisesRegex(ValueError,'immutable ancestor'):P.retirement_lineage(d,Context())
    def test_scope_expansion_rejected(self):
        d=data();d['index']['payloadRetirement']['retiredPayloadPaths'].append('/var/www')
        with self.assertRaisesRegex(ValueError,'authority differs'):P.retirement_lineage(d,Context())
    def test_missing_admitted_payload_rejected(self):
        d=data();del d['roots'][OLDROOTS[0]]
        with self.assertRaisesRegex(ValueError,'admitted exact'):P.retirement_lineage(d,Context())
    def test_future_descendant(self):
        d=data();d['index']['admissions'].append({'path':'next','sha256':'b'*64})
        d['admissions'].append({'retainedPair':{'current':'next','previous':PAIR['current']}})
        P.retirement_lineage(d,Context())
    def test_future_skipped_predecessor_rejected(self):
        d=data();d['index']['admissions'].append({'path':'next','sha256':'b'*64})
        d['admissions'].append({'retainedPair':{'current':'next','previous':PAIR['previous']}})
        with self.assertRaisesRegex(ValueError,'immediate predecessor'):P.retirement_lineage(d,Context())
    def setup_scope(self):
        ctx=Context();d=data(ctx)
        layout=types.SimpleNamespace(live=Path('/var/www'),roots=Path(ROOT),archives=Path(ARCH))
        pair={k:{'path':'/var/www' if k=='current' else ROOT+'/proofofwork-www-pre-'+PAIR['current'],
                 'fields':{'release_id':rid,'archive_name':'proofofwork-ui-release-'+rid+'.tgz'}}
              for k,rid in PAIR.items()}
        holds=[{'snapshotSha256':{r:'f'*64,a:'f'*64,a+'.sha256':'f'*64,a+'.provenance':'f'*64}}
               for r,a in zip(OLDROOTS,OLDARCH)]
        return ctx,d,layout,pair,holds
    def run_scope(self,resurrect=False,bad_context=False):
        ctx,d,layout,pair,holds=self.setup_scope()
        with patch.object(P,'load_index',return_value=d), \
             patch.object(P,'retirement_module',return_value=types.SimpleNamespace(require_verified_retirement=typed)), \
             patch.object(P.S,'protected_pair',return_value=pair), \
             patch.object(P,'fallback_hold',return_value=holds[1]), \
             patch.object(P,'preserved_1042_hold',return_value=holds[0]), \
             patch.object(P,'verify_fallback_hold',side_effect=AssertionError('old payload reread')), \
             patch.object(P,'verify_1042_hold',side_effect=AssertionError('old payload reread')), \
             patch.object(P.os.path,'lexists',side_effect=lambda p:resurrect or p not in PATHS):
            out=P.policy_scope({'path':'index','sha256':'a'*64},layout,'a'*64,retirement={} if bad_context else ctx)
        return out,ctx
    def test_terminal_keeps_all_sidecars(self):
        out,ctx=self.run_scope();self.assertEqual(out['eligible'],[])
        self.assertEqual(out['verifiedRetiredPayloads'],ctx.proof)
        self.assertIn('historicalPayloadHolds',out)
        self.assertNotIn('preservedFallback',out)
        self.assertNotIn('preservedRelease1042',out)
        self.assertEqual(ctx.scopes,1)
    def test_reappeared_payload_rejected(self):
        with self.assertRaisesRegex(ValueError,'reappeared'):self.run_scope(resurrect=True)
    def test_arbitrary_context_rejected(self):
        with self.assertRaisesRegex(ValueError,'Unverified'):self.run_scope(bad_context=True)
    def test_runtime_package_identity_mismatch_rejected(self):
        storage=types.SimpleNamespace(Layout=lambda:object())
        policy=types.SimpleNamespace(retirement_module=lambda:types.SimpleNamespace(require_verified_retirement=typed))
        config={'statePath':'/unused','package':{'sha256':'a'*64},
                'payloadRetirement':{'mode':'complete','policyCodeSha256':'b'*64}}
        runtime=L.Runtime(config,'c'*64,storage,policy,retirement=Context())
        with self.assertRaisesRegex(ValueError,'authenticated config'):
            runtime.require_no_pending_payload_retirement()
    def test_pending_dispatch_blocks_before_lock(self):
        storage=types.SimpleNamespace(Layout=lambda:object(),lock=lambda unused:self.fail('lock/read reached'))
        runtime=L.Runtime({'statePath':'/unused','payloadRetirement':{'mode':'pending'}},'a'*64,storage,object())
        with self.assertRaisesRegex(ValueError,'publication blocked'):runtime.dispatch('status',{})
    def test_complete_binding_without_context_rejected(self):
        storage=types.SimpleNamespace(Layout=lambda:object(),lock=lambda unused:self.fail('lock/read reached'))
        runtime=L.Runtime({'statePath':'/unused','payloadRetirement':{'mode':'complete'}},'a'*64,storage,object())
        with self.assertRaisesRegex(ValueError,'publication blocked'):runtime.dispatch('prepare-cycle',{})
if __name__=='__main__':unittest.main()
