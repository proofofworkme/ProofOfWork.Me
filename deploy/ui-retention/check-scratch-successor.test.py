#!/usr/bin/env python3
"""Focused pure second-edge rejection tests; no production writes."""
import copy
import importlib.util
import json
from pathlib import Path
import stat
import types
import tempfile
import unittest
from unittest.mock import patch

def load(name, relative):
    spec=importlib.util.spec_from_file_location(name,Path(__file__).with_name(relative))
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module
M=load('scratch_successor_fixture','scratch_successor.py')
R=load('scratch_successor_runtime_fixture','lifecycle_remote.py')
ROOT=Path(__file__).resolve().parents[2]

class GrantTests(unittest.TestCase):
    def test_grant_and_helper_pins(self):
        raw=(ROOT/M.SCRATCH_GRANT).read_bytes()
        self.assertEqual(R.sha(raw),M.SCRATCH_APPROVAL)
        self.assertEqual(R.sha((ROOT/'deploy/proofofwork-ui-capacity.py').read_bytes()),M.SCRATCH_NEXT_SHA)
        with tempfile.TemporaryDirectory() as temporary:
            path=Path(temporary)/'approval.json';path.write_bytes(raw);path.chmod(0o600)
            self.assertEqual(R.read_json(path,M.SCRATCH_APPROVAL)[1],M.SCRATCH_APPROVAL)
            path.write_bytes(raw+b' ')
            with self.assertRaises(ValueError):R.read_json(path,M.SCRATCH_APPROVAL)

class PositionTests(unittest.TestCase):
    def setUp(self):
        self.predecessor_bad = False
        self.grant = json.loads((ROOT/M.SCRATCH_GRANT).read_bytes())
        self.assertEqual(R.sha((ROOT/M.SCRATCH_GRANT).read_bytes()), M.SCRATCH_APPROVAL)
        self.before = {'sha256': M.SCRATCH_PRIOR_SHA, 'identity': [17, 101, 0, 0, stat.S_IFREG|0o755, 1, 30000, 1000], 'xattrs': {}}
        self.after = {'sha256': M.SCRATCH_NEXT_SHA, 'identity': [17, 102, 0, 0, stat.S_IFREG|0o755, 1, 30001, 1001], 'xattrs': {}}
        self.protected = {'configSha256':'1'*64,'stateSha256':'2'*64,'pair':{'fixture':'pair'},'completedContext':{'fixture':'context'}}
        self.intent = {'schema': 'pow-ui-scratch-successor-intent-v1', 'approvalSha256': M.SCRATCH_APPROVAL,
                       'commit': 'a'*40, 'tree': 'b'*40, 'files': {'capacity': {'before': self.before, 'after': self.after}},
                       'protected': self.protected, 'predecessorAuthority': copy.deepcopy(M.PREDECESSOR_AUTHORITY)}
        self.intent_sha = R.sha(R.encoded(self.intent))
        q = {'schema': 'pow-ui-scratch-successor-qualified-v1', 'intentSha256': self.intent_sha,
             'authoritySha256': M.SCRATCH_APPROVAL, 'protected': self.protected}
        self.qsha = R.sha(R.encoded(q))
        installed = {'schema': 'pow-ui-scratch-successor-installed-v1', 'intentSha256': self.intent_sha,
                     'qualificationSha256': self.qsha, 'protected': self.protected}
        self.preverified={'schema':'pow-ui-scratch-successor-preverified-v1','intentSha256':self.intent_sha,
            'protected':self.protected,'status':{'ok':True,'publicationHealthy':True,'retentionComplete':True,
                'unfinishedIntents':[],'stateSha256':self.protected['stateSha256'],
                'configSha256':self.protected['configSha256'],'pair':self.protected['pair'],
                'context':self.protected['completedContext'],'binding':{}}}
        verified = {'pendingStatusSha256':R.sha(R.encoded(self.preverified)), 'schema': 'pow-ui-scratch-successor-verified-v1', 'intentSha256': self.intent_sha,
                    'installedSha256': R.sha(R.encoded(installed)), 'protected': self.protected}
        self.records = {'approval.json': self.grant, 'intent.json': self.intent, 'qualified.json': q,
                        'installed.json': installed, 'verified.json': verified,'preverified-forward.json':self.preverified}
        self.live, self.saved = self.after, self.before
        self.layout = types.SimpleNamespace(capacity=M.SCRATCH_CAPACITY_PATH)
        self.info = types.SimpleNamespace(st_mode=stat.S_IFDIR|0o700, st_uid=0, st_gid=0, st_dev=17)
    def read(self, path, expected=None, maximum=None):
        if Path(path) == M.PREDECESSOR_DIRECTORY / 'installed.json':
            if expected != M.PREDECESSOR_AUTHORITY['installedSha256'] or self.predecessor_bad:
                raise ValueError('Predecessor receipt changed')
            return {}, expected
        name = Path(path).name
        value = self.records[name]
        digest = M.SCRATCH_APPROVAL if name == 'approval.json' else R.sha(R.encoded(value))
        if expected is not None and digest != expected:
            raise ValueError('Fixture record SHA differs')
        return value, digest
    def run_position(self, pending=False, baseline_error=None):
        with patch.object(M.os.path, 'lexists', return_value=True), patch.object(Path, 'resolve', lambda p:p), \
             patch.object(Path, 'lstat', return_value=self.info), \
             patch.object(M.os, 'listdir', return_value=list(self.records)+['capacity']), \
             patch.object(R, 'read_json', side_effect=self.read), \
             patch.object(R, 'scratch_bridge_baseline', return_value=self.protected, side_effect=baseline_error), \
             patch.object(R, 'floor_descriptor', side_effect=lambda p:self.live if p==M.SCRATCH_CAPACITY_PATH else self.saved):
            return M.verify_position(self.layout, R, allow_pending=pending)
    def test_exact_sealed_successor(self):
        self.assertEqual(self.run_position()['position'], 'after')
    def test_each_missing_seal_fails_closed(self):
        for key in ('qualified.json','installed.json','verified.json'):
            with self.subTest(key=key):
                saved=self.records.pop(key)
                with self.assertRaises((ValueError,KeyError)): self.run_position()
                self.records[key]=saved
    def test_pending_only_dedicated_reconciler(self):
        self.records.pop('installed.json'); self.records.pop('verified.json')
        self.assertEqual(self.run_position(True)['position'], 'after')
        with self.assertRaises(ValueError): self.run_position()
    def test_before_prepared_not_normal(self):
        self.live,self.saved=self.before,self.after
        with self.assertRaises(ValueError): self.run_position()
        self.assertEqual(self.run_position(True)['position'],'before')
    def test_sealed_rollback_and_unsealed_reversal(self):
        reversal={'schema':'pow-ui-scratch-successor-reversal-v1','intentSha256':self.intent_sha,
                  'qualificationSha256':self.qsha,'protected':self.protected}
        self.records['reversing.json']=reversal
        with self.assertRaises(ValueError): self.run_position()
        self.live,self.saved=self.before,self.after
        with self.assertRaises(ValueError): self.run_position()
        self.records['preverified-rollback.json']=copy.deepcopy(self.preverified)
        self.records['rolled-back.json']=dict(reversal,pendingStatusSha256=R.sha(R.encoded(self.preverified)))
        self.assertEqual(self.run_position()['position'],'before')
    def test_false_pending_status_and_failure_marker_rejected(self):
        self.preverified['status']['retentionComplete']=False
        with self.assertRaises(ValueError):self.run_position(True)
        self.preverified['status']['retentionComplete']=True
        self.records['verification-failed.json']={'schema':'pow-ui-scratch-successor-verification-failed-v1',
            'intentSha256':self.intent_sha,'phase':'forward','errorType':'ValueError'}
        with self.assertRaises(ValueError):self.run_position()
        self.assertEqual(self.run_position(True)['position'],'after')

    def test_copy_substitution_inode_rejected(self):
        self.saved=copy.deepcopy(self.before); self.saved['identity'][1]+=1
        with self.assertRaises(ValueError): self.run_position(True)
    def test_all_descriptor_fields_rejected(self):
        for index in range(8):
            self.saved=copy.deepcopy(self.before); self.saved['identity'][index]+=1
            with self.subTest(index=index),self.assertRaises(ValueError): self.run_position(True)
        self.saved=copy.deepcopy(self.before);self.saved['xattrs']={'user.unexpected':'a'*64}
        with self.assertRaises(ValueError):self.run_position(True)
    def test_forged_qualification_and_extra_paths(self):
        self.records['qualified.json']['authoritySha256']='0'*64
        with self.assertRaises(ValueError):self.run_position(True)
        self.records['extra.json']={}
        with self.assertRaises(ValueError):self.run_position(True)
    def test_predecessor_receipt_and_binding_refused(self):
        self.predecessor_bad=True
        with self.assertRaises(ValueError):self.run_position()
        self.predecessor_bad=False
        self.intent['predecessorAuthority']['installedSha256']='0'*64
        with self.assertRaises(ValueError):self.run_position()
    def test_authority_only_sealed_and_exact_budget(self):
        proof=self.run_position()
        self.assertEqual(proof['predecessorDescriptor'],self.before)
        self.assertEqual(proof['authority']['scratchBudgetBytes'],6*1024**3)
        self.assertIsNone(self.run_position(True)['authority'])
    def test_baseline_verification_is_mandatory(self):
        with self.assertRaisesRegex(ValueError,'bad bridge'):
            self.run_position(baseline_error=ValueError('bad bridge'))
    def test_frozen_manifest_includes_successor(self):
        self.assertIn('deploy/ui-retention/scratch_successor.py',M.SUCCESSOR_PACKAGE_FILES)
        self.assertEqual(len(M.SUCCESSOR_PACKAGE_FILES),len(set(M.SUCCESSOR_PACKAGE_FILES)))



class SuccessorPendingStatusTests(unittest.TestCase):
    def setUp(self):
        from unittest.mock import Mock
        self.runtime=object.__new__(R.Runtime)
        self.runtime.layout=types.SimpleNamespace(capacity=R.SCRATCH_CAPACITY_PATH)
        self.runtime.lock_fd=7
        self.runtime.S=types.SimpleNamespace(require_execution_lock=Mock())
        self.runtime.config_sha='a'*64
        self.runtime.config={'retentionPolicy':R.VPS_POLICY,'offHostCustodyRoot':None,'controller':{'fixture':'controller'}}
        self.runtime.state_path=R.STATE_PATH
        self.runtime.completion_access_time_reconciliation=None
        self.context={'pair':{'current':'fixture-current','previous':'fixture-prior'}}
        self.state={'status':'complete','pending':None,'activePhase':None,'index':None,'completedContext':self.context}
        self.runtime.state=lambda:(self.state,'b'*64)
        self.runtime.current=lambda:(None,self.context)
        self.runtime.unfinished_intents=lambda:[]
        self.intent='c'*64
        self.position={'intentSha256':self.intent,'position':'after','predecessorDescriptor':{'fixture':'descriptor'},
            'protected':{'configSha256':'a'*64,'stateSha256':'b'*64}}
    def call(self, intent=None):
        module=types.SimpleNamespace(verify_position=lambda *args,**kw:self.position)
        with patch.object(R,'scratch_successor_module',return_value=module), \
             patch.object(R,'_scratch_capacity_position_original',return_value={'position':'after','priorCapacity':{'fixture':'floor'}}), \
             patch.object(R,'_capacity_floor_authority_original',return_value={'fixture':'original-floor'}):
            return self.runtime.status({'requireComplete':True},scratch_successor_pending_intent=intent or self.intent)
    def test_pending_full_status_without_public_witness(self):
        result=self.call()
        self.assertTrue(result['retentionComplete'])
        self.assertNotIn('verifiedScratchCapacity',result)
        self.assertNotIn('scratchCapacity',result['binding'])
        self.runtime.S.require_execution_lock.assert_called_once_with(7,self.runtime.layout)
    def test_wrong_intent_lock_config_and_state_refuse(self):
        with self.assertRaises(ValueError):self.call('d'*64)
        self.runtime.S.require_execution_lock.side_effect=ValueError('not locked')
        with self.assertRaises(ValueError):self.call()
        self.runtime.S.require_execution_lock.side_effect=None
        self.position['protected']['configSha256']='d'*64
        with self.assertRaises(ValueError):self.call()
        self.position['protected']['configSha256']='a'*64
        self.position['protected']['stateSha256']='d'*64
        with self.assertRaises(ValueError):self.call()
    def test_all_normal_completion_checks_still_apply(self):
        self.state['status']='incomplete'
        with self.assertRaisesRegex(ValueError,'retention-incomplete'):self.call()
    def test_public_dispatch_does_not_expose_pending_api(self):
        with self.assertRaisesRegex(ValueError,'Unsupported lifecycle'):
            self.runtime.dispatch('scratch-successor-status',{'intentSha256':self.intent})
        with patch.object(R,'capacity_floor_authority',side_effect=ValueError('unsealed')):
            with self.assertRaisesRegex(ValueError,'unsealed'):
                self.runtime.status({'requireComplete':True,'scratch_successor_pending_intent':self.intent})
    def test_pending_rejects_old_chain_failure_and_mixed_intents(self):
        module=types.SimpleNamespace(verify_position=lambda *args,**kw:self.position)
        with patch.object(R,'scratch_successor_module',return_value=module), \
             patch.object(R,'_scratch_capacity_position_original',side_effect=ValueError('bad historical receipt')):
            with self.assertRaisesRegex(ValueError,'bad historical receipt'):
                self.runtime.status({'requireComplete':True},scratch_successor_pending_intent=self.intent)
        with self.assertRaisesRegex(ValueError,'Mixed'):
            self.runtime.status({'requireComplete':True},scratch_pending_intent=self.intent,scratch_successor_pending_intent=self.intent)

class ChainTests(unittest.TestCase):
    def setUp(self):
        self.layout=types.SimpleNamespace(capacity=R.SCRATCH_CAPACITY_PATH)
        self.proof={'position':'after','predecessorDescriptor':{'exact':'old inode'},'authority':{'scratchBudgetBytes':6*1024**3}}
        self.module=types.SimpleNamespace(verify_position=lambda *args,**kw:self.proof)
    def test_new_authority_requires_old_chain(self):
        with patch.object(R,'scratch_successor_module',return_value=self.module), \
             patch.object(R,'_scratch_capacity_position_original',side_effect=ValueError('bad original journal')):
            for function in (R.scratch_capacity_authority,R.capacity_floor_authority):
                with self.subTest(function=function.__name__),self.assertRaisesRegex(ValueError,'bad original journal'):
                    function(self.layout)
    def test_floor_receives_original_floor_inode_not_new_helper(self):
        prior={'position':'after','priorCapacity':{'exact':'original floor inode'}}
        with patch.object(R,'scratch_successor_module',return_value=self.module), \
             patch.object(R,'_scratch_capacity_position_original',return_value=prior) as original, \
             patch.object(R,'_capacity_floor_authority_original',return_value={'rootReserveBytes':8*1024**3}) as floor:
            result=R.capacity_floor_authority(self.layout)
            self.assertEqual(result,{'rootReserveBytes':8*1024**3})
            original.assert_called_once_with(self.layout,False,capacity_descriptor=self.proof['predecessorDescriptor'])
            floor.assert_called_once_with(self.layout,prior['priorCapacity'])
    def test_unsealed_successor_never_falls_back_to_old_authority(self):
        module=types.SimpleNamespace(verify_position=lambda *args,**kw:(_ for _ in ()).throw(ValueError('unsealed successor')))
        with patch.object(R,'scratch_successor_module',return_value=module), \
             patch.object(R,'_scratch_capacity_position_original') as original:
            with self.assertRaisesRegex(ValueError,'unsealed successor'):R.scratch_capacity_authority(self.layout)
            original.assert_not_called()

if __name__=='__main__':unittest.main()
