#!/usr/bin/env python3
"""Focused pure second-edge rejection tests; no production writes."""
import copy
import base64
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
A=load('amo_scratch_successor_fixture','amo_scratch_successor.py')
ROOT=Path(__file__).resolve().parents[2]

class GrantTests(unittest.TestCase):
    def test_grant_and_helper_pins(self):
        raw=(ROOT/M.SCRATCH_GRANT).read_bytes()
        self.assertEqual(R.sha(raw),M.SCRATCH_APPROVAL)
        helper=(ROOT/'deploy/proofofwork-ui-capacity.py').read_bytes()
        self.assertEqual(R.sha(helper),A.NEXT_SHA)
        self.assertEqual(R.sha(helper.replace(b'MAX_DEPLOY_SCRATCH_BYTES = 7 *',
                                             b'MAX_DEPLOY_SCRATCH_BYTES = 6 *')), M.NEXT_SHA)
        self.assertEqual(A.PRIOR_SHA,M.NEXT_SHA)
        self.assertEqual(R.sha((ROOT/A.GRANT).read_bytes()), A.APPROVAL)
        with tempfile.TemporaryDirectory() as temporary:
            path=Path(temporary)/'approval.json';path.write_bytes(raw);path.chmod(0o600)
            self.assertEqual(R.read_json(path,M.SCRATCH_APPROVAL)[1],M.SCRATCH_APPROVAL)
            path.write_bytes(raw+b' ')
            with self.assertRaises(ValueError):R.read_json(path,M.SCRATCH_APPROVAL)

class PositionTests(unittest.TestCase):
    migration = M

    def setUp(self):
        self.predecessor_bad = False
        self.grant = json.loads((ROOT/self.migration.GRANT).read_bytes())
        self.assertEqual(R.sha((ROOT/self.migration.GRANT).read_bytes()), self.migration.APPROVAL)
        self.before = {'sha256': self.migration.PRIOR_SHA, 'identity': [17, 101, 0, 0, stat.S_IFREG|0o755, 1, 30000, 1000], 'xattrs': {}}
        self.after = {'sha256': self.migration.NEXT_SHA, 'identity': [17, 102, 0, 0, stat.S_IFREG|0o755, 1, 30001, 1001], 'xattrs': {}}
        self.protected = {'configSha256':'1'*64,'stateSha256':'2'*64,'pair':{'fixture':'pair'},'completedContext':{'fixture':'context'}}
        self.intent = {'schema': 'pow-ui-scratch-successor-intent-v1', 'approvalSha256': self.migration.APPROVAL,
                       'commit': 'a'*40, 'tree': 'b'*40, 'files': {'capacity': {'before': self.before, 'after': self.after}},
                       'protected': self.protected, 'predecessorAuthority': copy.deepcopy(self.migration.PREDECESSOR_AUTHORITY)}
        self.intent_sha = R.sha(R.encoded(self.intent))
        q = {'schema': 'pow-ui-scratch-successor-qualified-v1', 'intentSha256': self.intent_sha,
             'authoritySha256': self.migration.APPROVAL, 'protected': self.protected}
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
        if Path(path) == self.migration.DIRECTORY.parent / self.migration.PREDECESSOR_AUTHORITY['approvalSha256'] / 'installed.json':
            if expected != self.migration.PREDECESSOR_AUTHORITY['installedSha256'] or self.predecessor_bad:
                raise ValueError('Predecessor receipt changed')
            return {}, expected
        name = Path(path).name
        value = self.records[name]
        digest = self.migration.APPROVAL if name == 'approval.json' else R.sha(R.encoded(value))
        if expected is not None and digest != expected:
            raise ValueError('Fixture record SHA differs')
        return value, digest
    def run_position(self, pending=False, baseline_error=None):
        with patch.object(R, 'scratch_successor_module', return_value=M), patch.object(M.os.path, 'lexists', return_value=True), patch.object(Path, 'resolve', lambda p:p), \
             patch.object(Path, 'lstat', return_value=self.info), \
             patch.object(M.os, 'listdir', return_value=list(self.records)+['capacity']), \
             patch.object(R, 'read_json', side_effect=self.read), \
             patch.object(R, 'scratch_bridge_baseline', return_value=self.protected, side_effect=baseline_error), \
             patch.object(R, 'floor_descriptor', side_effect=lambda p:self.live if p==M.SCRATCH_CAPACITY_PATH else self.saved):
            return self.migration.verify_position(self.layout, R, allow_pending=pending)
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
        self.assertEqual(proof['authority']['scratchBudgetBytes'],self.migration.NEXT_BYTES)
        self.assertIsNone(self.run_position(True)['authority'])
    def test_baseline_verification_is_mandatory(self):
        with self.assertRaisesRegex(ValueError,'bad bridge'):
            self.run_position(baseline_error=ValueError('bad bridge'))
    def test_frozen_manifest_includes_successor(self):
        self.assertIn('deploy/ui-retention/scratch_successor.py',M.SUCCESSOR_PACKAGE_FILES)
        self.assertEqual(len(M.SUCCESSOR_PACKAGE_FILES),len(set(M.SUCCESSOR_PACKAGE_FILES)))



class AmoPositionTests(PositionTests):
    migration = A

    def test_edge_rejects_the_boost_grant(self):
        self.records['approval.json'] = json.loads((ROOT/M.GRANT).read_bytes())
        with self.assertRaisesRegex(ValueError, 'Scratch grant scope'):
            self.run_position()

    def test_earlier_receipt_cannot_follow_a_different_inode(self):
        self.saved = dict(self.before, identity=[17, 103, *self.before['identity'][2:]])
        with self.assertRaisesRegex(ValueError, 'positions'):
            self.run_position()


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

class AmoChainTests(unittest.TestCase):
    def setUp(self):
        from unittest.mock import Mock
        self.layout = types.SimpleNamespace(capacity=A.CAPACITY_PATH)
        self.six = {'position': 'after', 'authority': dict(A.PREDECESSOR_AUTHORITY, scratchBudgetBytes=A.PRIOR_BYTES),
                    'predecessorDescriptor': {'inode':'historical-5.5'}}
        self.first = {'position': 'after', 'priorCapacity': {'inode':'historical-floor'}}
        self.floor = {'rootReserveBytes': 8*1024**3, 'growthReserveBytes': 64*1024**2}
        self.reader = Mock(return_value=self.six)
        self.runtime = types.SimpleNamespace(require=R.require,
            scratch_successor_module=lambda: types.SimpleNamespace(verify_position=self.reader),
            _scratch_capacity_position_original=Mock(return_value=self.first),
            _capacity_floor_authority_original=Mock(return_value=self.floor))

    def predecessor(self):
        return A.verify_predecessor(self.layout, self.runtime, {'inode':'saved-six'})

    def test_chains_through_each_exchanged_inode(self):
        chain = self.predecessor()
        self.reader.assert_called_once_with(self.layout, self.runtime, capacity_descriptor={'inode':'saved-six'})
        self.runtime._scratch_capacity_position_original.assert_called_once_with(
            self.layout, capacity_descriptor={'inode':'historical-5.5'})
        self.runtime._capacity_floor_authority_original.assert_called_once_with(self.layout, {'inode':'historical-floor'})
        self.assertEqual(chain['floor'], self.floor)

    def test_wrong_or_missing_predecessors_and_floor_refuse(self):
        for key in A.PREDECESSOR_AUTHORITY:
            with self.subTest(key=key), patch.dict(self.six['authority'], {key: '0'*64}), self.assertRaises(ValueError):
                self.predecessor()
        with patch.dict(self.six, position='before'), self.assertRaises(ValueError): self.predecessor()
        with patch.dict(self.first, position='before'), self.assertRaises(ValueError): self.predecessor()
        for key in self.floor:
            with patch.dict(self.floor, {key: self.floor[key]-1}), self.assertRaises(ValueError): self.predecessor()

    def test_completed_rollback_restores_only_verified_boost_authority(self):
        seven = {'position': 'after', 'authority': {'scratchBudgetBytes': A.NEXT_BYTES}}
        with patch.object(R,'amo_scratch_chain',return_value=(seven,self.predecessor())):
            self.assertEqual(R.scratch_capacity_authority(self.layout)['scratchBudgetBytes'], A.NEXT_BYTES)
            seven.update(position='before', authority=None)
            self.assertEqual(R.scratch_capacity_authority(self.layout), self.six['authority'])

    def test_amo_pending_status_requires_exact_locked_bridge_and_discloses_no_new_authority(self):
        fixture = SuccessorPendingStatusTests()
        fixture.setUp()
        with patch.object(R,'amo_scratch_chain',return_value=(fixture.position,self.predecessor())) as chain:
            status = fixture.runtime.status({'requireComplete':True}, amo_scratch_pending_intent=fixture.intent)
            self.assertEqual(status['verifiedCapacityFloor'],self.floor)
            self.assertNotIn('verifiedScratchCapacity',status)
            self.assertNotIn('scratchCapacity',status['binding'])
            fixture.runtime.S.require_execution_lock.assert_called_once_with(7,fixture.runtime.layout)
            chain.assert_called_once_with(fixture.runtime.layout,allow_pending=True)
            with self.assertRaises(ValueError): fixture.runtime.status({},amo_scratch_pending_intent='0'*64)
            fixture.position['protected']['stateSha256']='0'*64
            with self.assertRaises(ValueError): fixture.runtime.status({},amo_scratch_pending_intent=fixture.intent)
            with self.assertRaisesRegex(ValueError,'Mixed'):
                fixture.runtime.status({},amo_scratch_pending_intent=fixture.intent,
                                       scratch_successor_pending_intent=fixture.intent)

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



class PriorStageBridgeTests(unittest.TestCase):
    def setUp(self):
        self.i = load('bridge_stage_fixture', 'install_lifecycle.py')
        t = tempfile.TemporaryDirectory()
        self.addCleanup(t.cleanup)
        self.root = Path(t.name)
        self.inputs = self.root/'tmp'/('proofofwork-amo-installer-'+self.i.PRIOR_AMO_RELEASE+'-initial')
        self.inputs.mkdir(parents=True, mode=0o700)
        restored = {k: ('old '+k).encode() for k in ('stager', 'publisher')}
        self.new = {k: ('new '+k).encode() for k in restored}
        hashes = {k: R.sha(v) for k,v in restored.items()}
        # Same inode/receipt state machine as the archived, hash-pinned verifier.
        # Substitute only test hashes and an isolated fixture installer.
        raw = (ROOT/'deploy/publish/amo_stage_installer.py').read_bytes()
        raw += ('\nPREVIOUS = ' + repr(hashes) + '\n').encode()
        self.installer = self.inputs/'amo_stage_installer.py'
        self.installer.write_bytes(raw)
        self.installer.chmod(0o600)
        pinned = patch.object(self.i, 'PRIOR_AMO_INSTALLER', R.sha(raw)); pinned.start(); self.addCleanup(pinned.stop)
        remote = {'__name__': 'fixture', '__file__': str(self.installer)}
        exec(compile(raw, str(self.installer), 'exec'), remote)
        self.tool = remote
        self.approval = {'schema':'pow-ui-amo-direct-stage-approval-v1',
            'commit':'56da86069b0064a52ddc2880c2b3f00e3a651fd1','tree':'25b9f4bcbcb980803efddc53766788c8d4c9daaf',
            'releaseId':self.i.PRIOR_AMO_RELEASE,'publicationAttempt':'initial','buildReceiptSha256':'b'*64,
            'sourceSha256':'c'*64,'surfacesSha256':'d'*64,'inventorySha256':'e'*64,'pair':remote['PAIR'],
            'helperHashes':{k:R.sha(v) for k,v in self.new.items()}}
        for name,path in [('config',self.i.CONFIG),('state',self.i.STATE)]:
            f=self.root/path.lstrip('/')
            f.parent.mkdir(parents=True)
            f.write_bytes(name.encode()); f.chmod(0o600)
            self.approval[name+'Sha256'] = R.sha(name.encode())
        self.digest = R.sha(R.encoded(self.approval))
        self.request = dict(priorStageApprovalSha256=self.digest,
            configSha256=self.approval['configSha256'],stateSha256=self.approval['stateSha256'])
        for filename,content in [('amo-approval.json',self.approval),('amo-helper-frame.json',
                {'approvalSha256':self.digest,'helpers':{k:base64.b64encode(v).decode() for k,v in self.new.items()}})]:
            f=self.inputs/filename
            f.write_bytes(R.encoded(content));f.chmod(0o600)
        self.store = self.root/remote['STORE'].relative_to('/')
        self.store.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.store.parent.chmod(0o700)
        self.binaries = {k:self.root/p.relative_to('/') for k,p in remote['BINARY'].items()}
        for k,p in self.binaries.items():
            p.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            p.parent.chmod(0o700)
            p.write_bytes(restored[k]);p.chmod(0o755)

    def check(self):
        return self.i.prior_stage_reversal(self.root,self.request)

    def act(self, phase, stop=None):
        def checkpoint(value):
            if value == stop: raise RuntimeError('fixture boundary')
        return self.tool['operate'](phase,self.store,self.binaries,self.approval,self.new,
            lambda: None,lambda: None,checkpoint)

    def test_active_mixed_and_merely_prepared_refuse_and_closed_is_bound(self):
        self.act('prepare')
        with self.assertRaisesRegex(ValueError,'terminal reversal'): self.check()
        with self.assertRaisesRegex(RuntimeError,'fixture boundary'):
            self.act('apply','exchange-stager-after')
        with self.assertRaisesRegex(ValueError,'terminal reversal'): self.check()
        self.act('apply')
        with self.assertRaisesRegex(ValueError,'terminal reversal'): self.check()
        self.act('rollback')
        proof = self.check()
        self.assertEqual(proof['positions'], {'stager':'before','publisher':'before'})
        plan = {'before':{'priorStageReversal':proof},'request':dict(self.request,mode='completed-cycle')}
        R.verify_prior_stage_reversal(plan)
        for key,bad in [('active',True),('rollbackComplete',False),('positions',{'stager':'after'}),
                        ('approvalSha256','0'*64),('installedSha256',''),('intentSha256',None),('rolledBackSha256','bad')]:
            with self.subTest(key=key),patch.dict(proof,{key:bad}),self.assertRaises(ValueError):
                R.verify_prior_stage_reversal(plan)
        staged = self.binaries['stager']
        copy_path = staged.with_suffix('.copy')
        copy_path.write_bytes(staged.read_bytes());copy_path.chmod(0o755);copy_path.replace(staged)
        with self.assertRaises(ValueError):
            self.check()

    def test_bridge_refuses_without_the_locked_reversal_before_any_write(self):
        old = json.loads((ROOT/A.GRANT).read_bytes())['preBridge']
        config = {'package':{'path':'/old-tools','sha256':old['packageManifestSha256']}}
        grant_raw = (ROOT/A.GRANT).read_bytes()
        payload = {'manifest':{'files':{A.GRANT:{'sha256':A.APPROVAL}}},
                   'files':{A.GRANT:{'base64':base64.b64encode(grant_raw).decode()}},
                   'config':{'package':{'path':'/new-tools','sha256':'0'*64}}}
        before = {'completedReview':{'state':{}},'configBase64':base64.b64encode(R.encoded(config)).decode()}
        plan = {'schema':'pow-ui-retention-upgrade-plan-v1','scopeApprovalSha256':self.i.APPROVAL,
                'payload':payload,'request':{'mode':'completed-cycle','configSha256':old['configSha256'],
                'stateSha256':old['stateSha256']},'before':before}
        lock = self.root/'run/proofofwork-ui/deploy.lock'
        lock.parent.mkdir(parents=True, mode=0o700)
        lock.touch(mode=0o600)
        with patch.object(self.i, 'validate_payload'), patch.object(self.i, 'upgrade_inventory_locked',return_value=before), \
             patch.object(self.i,'read_bound',return_value=R.encoded({'files':{}})), patch.object(self.i,'save') as writer:
            with self.assertRaisesRegex(ValueError,'verified predecessor stage reversal'):
                self.i.upgrade_remote(plan,self.root)
            writer.assert_not_called()
        self.assertFalse((self.root/'new-tools').exists())

    def test_prior_frame_approval_installer_and_state_are_bound(self):
        self.act('prepare');self.act('apply');self.act('rollback')
        with patch.dict(self.request,priorStageApprovalSha256='f'*64), self.assertRaisesRegex(ValueError,'digest'):
            self.check()
        with patch.dict(self.request,stateSha256='1'*64), self.assertRaisesRegex(ValueError,'lifecycle'):
            self.check()
        for name in ('amo-helper-frame.json','amo_stage_installer.py'):
            target=self.inputs/name; raw=target.read_bytes()
            target.write_bytes(raw+b' ')
            with self.subTest(name=name), self.assertRaises(ValueError):
                self.check()
            target.write_bytes(raw)


class PredecessorScopeTests(unittest.TestCase):
    def setUp(self):
        self.installer=load('successor_scope_installer','install_lifecycle.py')
    def payload(self,scope):
        m=self.installer;files={}
        for relative in scope:
            raw=(ROOT/relative).read_bytes() if relative==m.FILES[0] else b'# fixture package source\n'
            files[relative]={'base64':base64.b64encode(raw).decode(),'bytes':len(raw),'sha256':m.sha(raw)}
        manifest={'schema':'pow-ui-retention-package-v1','sourceCommit':'a'*40,'sourceTree':'b'*40,
                  'files':{name:{'bytes':v['bytes'],'sha256':v['sha256']} for name,v in files.items()}}
        digest=m.sha(m.encoded(manifest));package=m.EVIDENCE+'/ui-lifecycle-tools-'+digest
        config={'schema':'pow-ui-retention-lifecycle-config-v1','scopeApprovalSha256':m.APPROVAL,
                'sourceCommit':manifest['sourceCommit'],'sourceTree':manifest['sourceTree'],
                'package':{'path':package,'sha256':digest},
                'controller':{'path':package+'/deploy/ui-retention/lifecycle_remote.py',
                              'sha256':files['deploy/ui-retention/lifecycle_remote.py']['sha256']},
                'approval':{'path':package+'/'+m.FILES[0],'sha256':m.APPROVAL},
                'statePath':m.STATE,'offHostCustodyRoot':None,'retentionPolicy':m.VPS_POLICY}
        return {'manifest':manifest,'files':files,'config':config,'configSha256':m.sha(m.encoded(config))}
    def test_exact_predecessor_only_legacy_reader(self):
        m=self.installer;p=self.payload(m.PRE_SIX_GIB_FILES)
        m.validate_payload(p,allow_legacy=True)
        with self.assertRaisesRegex(ValueError,'file scope'):m.validate_payload(p)
        m.validate_payload(self.payload(m.SIX_GIB_FILES),allow_legacy=True)
        with self.assertRaisesRegex(ValueError,'file scope'):m.validate_payload(self.payload(m.SIX_GIB_FILES))
        m.validate_payload(self.payload(m.FILES))
        self.assertEqual(m.SIX_GIB_FILES, M.SUCCESSOR_PACKAGE_FILES)
        self.assertEqual(m.FILES, R.PACKAGE_FILES)
    def test_arbitrary_missing_and_extra_scopes_refuse(self):
        m=self.installer;old=set(m.PRE_SIX_GIB_FILES)
        for scope in (old-{'deploy/ui-retention/custody.py'},old|{'arbitrary.py'},set(m.FILES)-{'deploy/ui-retention/scratch_successor.py'}):
            for legacy in (False,True):
                with self.subTest(scope=scope,legacy=legacy),self.assertRaisesRegex(ValueError,'file scope'):
                    m.validate_payload(self.payload(scope),allow_legacy=legacy)
    def test_legacy_still_verifies_bytes(self):
        m=self.installer;p=self.payload(m.PRE_SIX_GIB_FILES)
        p['files']['deploy/ui-retention/custody.py']['base64']=base64.b64encode(b'foreign').decode()
        with self.assertRaisesRegex(ValueError,'file binding'):m.validate_payload(p,allow_legacy=True)

if __name__=='__main__':unittest.main()
