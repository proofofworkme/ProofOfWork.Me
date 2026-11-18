#!/usr/bin/env python3
"""Pure scratch-authority rejection fixtures; no native filesystem mutations."""
import base64
import copy
import importlib.util
import json
from pathlib import Path
import stat
import tempfile
import types
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location('scratch_authority_fixture', Path(__file__).with_name('lifecycle_remote.py'))
M = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(M)
ROOT = Path(__file__).resolve().parents[2]

class GrantBytesTests(unittest.TestCase):
    def test_real_reader_rejects_altered_journal_grant_bytes(self):
        raw=(ROOT/M.SCRATCH_GRANT).read_bytes()
        with tempfile.TemporaryDirectory(prefix='scratch-grant-fixture-') as tmp:
            p=Path(tmp)/'approval.json';p.write_bytes(raw);p.chmod(0o600)
            self.assertEqual(M.read_json(p,M.SCRATCH_APPROVAL)[1],M.SCRATCH_APPROVAL)
            p.write_bytes(raw.replace(b'5.5 GiB',b'6.0 GiB'))
            with self.assertRaisesRegex(ValueError,'SHA differs'):M.read_json(p,M.SCRATCH_APPROVAL)

class PositionTests(unittest.TestCase):
    def setUp(self):
        self.grant = json.loads((ROOT/M.SCRATCH_GRANT).read_bytes())
        self.assertEqual(M.sha((ROOT/M.SCRATCH_GRANT).read_bytes()), M.SCRATCH_APPROVAL)
        self.before = {'sha256': M.SCRATCH_PRIOR_SHA, 'identity': [17, 101, 0, 0, stat.S_IFREG|0o755, 1, 30000, 1000], 'xattrs': {}}
        self.after = {'sha256': M.SCRATCH_NEXT_SHA, 'identity': [17, 102, 0, 0, stat.S_IFREG|0o755, 1, 30001, 1001], 'xattrs': {}}
        self.protected = {'configSha256':'1'*64,'stateSha256':'2'*64,'pair':{'fixture':'pair'},'completedContext':{'fixture':'context'}}
        self.intent = {'schema': 'pow-ui-scratch-capacity-intent-v1', 'approvalSha256': M.SCRATCH_APPROVAL,
                       'commit': 'a'*40, 'tree': 'b'*40, 'files': {'capacity': {'before': self.before, 'after': self.after}},
                       'protected': self.protected}
        self.intent_sha = M.sha(M.encoded(self.intent))
        q = {'schema': 'pow-ui-scratch-capacity-qualified-v1', 'intentSha256': self.intent_sha,
             'authoritySha256': M.SCRATCH_APPROVAL, 'protected': self.protected}
        self.qsha = M.sha(M.encoded(q))
        installed = {'schema': 'pow-ui-scratch-capacity-installed-v1', 'intentSha256': self.intent_sha,
                     'qualificationSha256': self.qsha, 'protected': self.protected}
        self.preverified={'schema':'pow-ui-scratch-capacity-preverified-v1','intentSha256':self.intent_sha,
            'protected':self.protected,'status':{'ok':True,'publicationHealthy':True,'retentionComplete':True,
                'unfinishedIntents':[],'stateSha256':self.protected['stateSha256'],
                'configSha256':self.protected['configSha256'],'pair':self.protected['pair'],
                'context':self.protected['completedContext'],'binding':{}}}
        verified = {'pendingStatusSha256':M.sha(M.encoded(self.preverified)), 'schema': 'pow-ui-scratch-capacity-verified-v1', 'intentSha256': self.intent_sha,
                    'installedSha256': M.sha(M.encoded(installed)), 'protected': self.protected}
        self.records = {'approval.json': self.grant, 'intent.json': self.intent, 'qualified.json': q,
                        'installed.json': installed, 'verified.json': verified,'preverified-forward.json':self.preverified}
        self.live, self.saved = self.after, self.before
        self.layout = types.SimpleNamespace(capacity=M.SCRATCH_CAPACITY_PATH)
        self.info = types.SimpleNamespace(st_mode=stat.S_IFDIR|0o700, st_uid=0, st_gid=0, st_dev=17)
    def read(self, path, expected=None, maximum=None):
        name = Path(path).name
        value = self.records[name]
        digest = M.SCRATCH_APPROVAL if name == 'approval.json' else M.sha(M.encoded(value))
        if expected is not None and digest != expected:
            raise ValueError('Fixture record SHA differs')
        return value, digest
    def run_position(self, pending=False):
        with patch.object(M.os.path, 'lexists', return_value=True), patch.object(Path, 'resolve', lambda p:p), \
             patch.object(Path, 'lstat', return_value=self.info), \
             patch.object(M.os, 'listdir', return_value=list(self.records)+['capacity']), \
             patch.object(M, 'read_json', side_effect=self.read), \
             patch.object(M, 'scratch_bridge_baseline', return_value=self.protected), \
             patch.object(M, 'floor_descriptor', side_effect=lambda p:self.live if p==M.SCRATCH_CAPACITY_PATH else self.saved):
            return M._scratch_capacity_position_original(self.layout, allow_pending=pending)
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
        reversal={'schema':'pow-ui-scratch-capacity-reversal-v1','intentSha256':self.intent_sha,
                  'qualificationSha256':self.qsha,'protected':self.protected}
        self.records['reversing.json']=reversal
        with self.assertRaises(ValueError): self.run_position()
        self.live,self.saved=self.before,self.after
        with self.assertRaises(ValueError): self.run_position()
        self.records['preverified-rollback.json']=copy.deepcopy(self.preverified)
        self.records['rolled-back.json']=dict(reversal,pendingStatusSha256=M.sha(M.encoded(self.preverified)))
        self.assertEqual(self.run_position()['position'],'before')
    def test_false_pending_status_and_failure_marker_rejected(self):
        self.preverified['status']['retentionComplete']=False
        with self.assertRaises(ValueError):self.run_position(True)
        self.preverified['status']['retentionComplete']=True
        self.records['verification-failed.json']={'schema':'pow-ui-scratch-capacity-verification-failed-v1',
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
    def test_original_floor_receives_only_authenticated_predecessor(self):
        position={'position':'after','priorCapacity':self.before}
        with patch.object(M,'scratch_capacity_position',return_value=position), \
             patch.object(M,'_capacity_floor_authority_original',return_value={'original':'shape'}) as old:
            self.assertEqual(M.capacity_floor_authority(self.layout),{'original':'shape'})
            old.assert_called_once_with(self.layout,self.before)
        with patch.object(M,'scratch_capacity_position',side_effect=ValueError('unsealed')), \
             patch.object(M,'_capacity_floor_authority_original') as old:
            with self.assertRaises(ValueError):M.capacity_floor_authority(self.layout)
            old.assert_not_called()

class BaselineTests(unittest.TestCase):
    def setUp(self):
        self.commit,self.tree='a'*40,'b'*40
        self.grant=json.loads((ROOT/M.SCRATCH_GRANT).read_bytes())
        prior=self.grant['preBridge']
        pkgsha='c'*64
        package=Path('/var/backups/proofofwork-ui/cleanup-evidence')/('ui-lifecycle-tools-'+pkgsha)
        self.journal=package.parent/('ui-lifecycle-upgrade-'+pkgsha)
        self.files={name:b'fixture package bytes' for name in M.SCRATCH_BRIDGE_PACKAGE_FILES}
        manifest={'schema':'pow-ui-retention-package-v1','sourceCommit':self.commit,'sourceTree':self.tree,
                  'files':{name:{'sha256':M.sha(raw),'bytes':len(raw)} for name,raw in self.files.items()}}
        self.config={'schema':'pow-ui-retention-lifecycle-config-v1','scopeApprovalSha256':M.APPROVAL_SHA,
            'sourceCommit':self.commit,'sourceTree':self.tree,'statePath':str(M.STATE_PATH),
            'retentionPolicy':M.VPS_POLICY,'offHostCustodyRoot':None,'package':{'path':str(package),'sha256':pkgsha},
            'controller':{'path':str(package/'deploy/ui-retention/lifecycle_remote.py'),
                          'sha256':manifest['files']['deploy/ui-retention/lifecycle_remote.py']['sha256']}}
        self.oldstate={'revision':311,'lastIntent':{'fixture':'intent'},'index':{'fixture':'index'},'lastCompleted':{'cycleId':'fixture'},
                       'completedContext':{'fixture':'context'}}
        self.state=dict(self.oldstate,revision=313,configSha256=M.sha(M.encoded(self.config)),status='complete',pending=None,activePhase=None,
                        lastUpgrade={'priorConfigSha256':prior['configSha256'],'priorStateSha256':prior['stateSha256'],
                          'completionPath':str(self.journal/'completed.json'),'statusVerificationPath':str(self.journal/'verified.json')})
        def binding(value):
            raw=M.encoded(value);return {'base64':base64.b64encode(raw).decode(),'sha256':M.sha(raw)}
        cs,ss=binding(self.config),binding(self.state)
        completion={'schema':'pow-ui-retention-upgrade-completed-v1','ok':True,'retentionComplete':True,
            'publicationHealthy':True,'freshPreparationRequired':False,'stateRevision':313,
            'priorConfig':{'path':str(self.journal/'prior-config.json'),'sha256':prior['configSha256']},
            'priorState':{'path':str(self.journal/'prior-state.json'),'sha256':prior['stateSha256']},
            'config':{'path':str(M.CONFIG_PATH),'sha256':cs['sha256']},'state':{'path':str(M.STATE_PATH),'sha256':ss['sha256']}}
        guards={'files':{str(M.SCRATCH_CAPACITY_PATH):{'fixture':'capacity'},'/other':{'fixture':'other'}},'units':{},'existingPackages':['ui-lifecycle-tools-prior']}
        upgrade_intent={'schema':'pow-ui-retention-upgrade-intent-v1','stateTemplate':copy.deepcopy(self.state),
            'stateTemplateSha256':ss['sha256'],'disposition':'completed-cycle-preserved','freshPreparationRequired':False,
            'plan':{'schema':'pow-ui-retention-upgrade-plan-v1','scopeApprovalSha256':M.APPROVAL_SHA,
                'request':{'configSha256':prior['configSha256'],'stateSha256':prior['stateSha256'],'mode':'completed-cycle'},
                'payload':{'config':self.config,'configSha256':cs['sha256'],'manifest':manifest},
                'before':{'guards':guards}}}
        # Reproduce the native installer: hash the intent, then add only its SHA
        # to lastUpgrade in the final serialized state.
        self.state['lastUpgrade']['intentSha256']=M.sha(M.encoded(upgrade_intent))
        ss=binding(self.state)
        completion['state']['sha256']=ss['sha256']
        completion.update(intent={'path':str(self.journal/'intent.json'),'sha256':M.sha(M.encoded(upgrade_intent))},
                          index=self.state['index'],preservedCompletedCycleId='fixture')
        cb={'path':str(self.journal/'completed.json'),'sha256':M.sha(M.encoded(completion))}
        p={'configSha256':cs['sha256'],'stateSha256':ss['sha256'],'index':self.state['index'],
           'lastCompleted':self.state['lastCompleted'],'completedContext':self.state['completedContext'],
           'pair':prior['pair'],'otherGuardsSha256':M.sha(M.encoded({'files':{'/other':{'fixture':'other'}},'units':{},'existingPackages':sorted(['ui-lifecycle-tools-prior',package.name])})),'bridgeConfig':cs,'bridgeState':ss,'completedUpgrade':cb}
        self.intent={'commit':self.commit,'tree':self.tree,'protected':p}
        self.records={str(package/'package.json'):(manifest,pkgsha),str(self.journal/'completed.json'):(completion,cb['sha256']),
            str(self.journal/'prior-config.json'):({'package':{'sha256':prior['packageManifestSha256']}},prior['configSha256']),
            str(self.journal/'prior-state.json'):(self.oldstate,prior['stateSha256']),
            str(self.journal/'verified.json'):({'schema':'pow-ui-retention-upgrade-status-verified-v1','ok':True,
                'config':completion['config'],'state':completion['state'],'upgradeReceipt':cb,'preservedCompletedCycleId':'fixture','contextSha256':M.sha(M.encoded(self.state['completedContext']))},'e'*64),
            str(self.journal/'intent.json'):(upgrade_intent,M.sha(M.encoded(upgrade_intent)))}
        self.package=package
    def run_baseline(self):
        def read_json(path,expected=None):
            value,digest=self.records[str(path)]
            if expected is not None and expected!=digest: raise ValueError('SHA mismatch')
            return value,digest
        def read(path,expected=None,maximum=None):
            raw=self.files[str(Path(path).relative_to(self.package))]
            if expected!=M.sha(raw):raise ValueError('SHA mismatch')
            return raw,M.sha(raw)
        with patch.object(M,'read_json',side_effect=read_json),patch.object(M,'read',side_effect=read):
            return M.scratch_bridge_baseline(self.intent,self.grant)
    def test_completed_bridge_positive(self):self.assertEqual(self.run_baseline(),self.intent['protected'])
    def test_native_template_hash_and_added_field_are_exact(self):
        intent=self.records[str(self.journal/'intent.json')][0]
        template=intent['stateTemplate']
        self.assertNotIn('intentSha256',template['lastUpgrade'])
        self.assertEqual(self.state['lastUpgrade']['intentSha256'],M.sha(M.encoded(intent)))
        self.assertNotEqual(intent['stateTemplateSha256'],self.intent['protected']['stateSha256'])
        original=intent['stateTemplateSha256'];intent['stateTemplateSha256']='0'*64
        with self.assertRaisesRegex(ValueError,'Bridge upgrade intent differs'):self.run_baseline()
        intent['stateTemplateSha256']=original
        template['lastUpgrade']['intentSha256']='0'*64
        with self.assertRaises(ValueError):self.run_baseline()
    def test_wrong_inserted_intent_hash_refused(self):
        self.state['lastUpgrade']['intentSha256']='f'*64
        raw=M.encoded(self.state);digest=M.sha(raw)
        protected=self.intent['protected']
        protected['stateSha256']=digest
        protected['bridgeState']={'base64':base64.b64encode(raw).decode(),'sha256':digest}
        path=str(self.journal/'completed.json')
        completion=self.records[path][0];completion['state']['sha256']=digest
        completed_sha=M.sha(M.encoded(completion))
        self.records[path]=(completion,completed_sha)
        protected['completedUpgrade']['sha256']=completed_sha
        with self.assertRaisesRegex(ValueError,'final state differs'):self.run_baseline()
    def test_extra_or_missing_template_fields_refused(self):
        intent=self.records[str(self.journal/'intent.json')][0]
        template=intent['stateTemplate']
        template['unexpected']=True
        intent['stateTemplateSha256']=M.sha(M.encoded(template))
        with self.assertRaisesRegex(ValueError,'final state differs'):self.run_baseline()
        template.pop('unexpected');template.pop('status')
        intent['stateTemplateSha256']=M.sha(M.encoded(template))
        with self.assertRaisesRegex(ValueError,'final state differs'):self.run_baseline()
    def test_wrong_source_and_snapshot_rejected(self):
        for key in ('commit','tree'):
            original=self.intent[key];self.intent[key]='f'*40
            with self.assertRaises(ValueError):self.run_baseline()
            self.intent[key]=original
        self.intent['protected']['bridgeState']['sha256']='0'*64
        with self.assertRaises(ValueError):self.run_baseline()
    def test_missing_completion_verification_rejected(self):
        self.records.pop(str(self.journal/'verified.json'))
        with self.assertRaises(KeyError):self.run_baseline()
    def test_altered_historical_completion_rejected(self):
        self.oldstate['index']={'different':'index'}
        with self.assertRaises(ValueError):self.run_baseline()
    def test_guard_and_context_digest_rejected(self):
        original=self.intent['protected']['otherGuardsSha256']
        self.intent['protected']['otherGuardsSha256']='0'*64
        with self.assertRaises(ValueError):self.run_baseline()
        self.intent['protected']['otherGuardsSha256']=original
        self.records[str(self.journal/'verified.json')][0]['contextSha256']='0'*64
        with self.assertRaises(ValueError):self.run_baseline()
    def test_extra_protected_key_rejected(self):
        self.intent['protected']['override']=True
        with self.assertRaises(ValueError):self.run_baseline()

class PendingStatusTests(unittest.TestCase):
    def setUp(self):
        from unittest.mock import Mock
        self.runtime=object.__new__(M.Runtime)
        self.runtime.layout=types.SimpleNamespace(capacity=M.SCRATCH_CAPACITY_PATH)
        self.runtime.lock_fd=7
        self.runtime.S=types.SimpleNamespace(require_execution_lock=Mock())
        self.runtime.config_sha='a'*64
        self.runtime.config={'retentionPolicy':M.VPS_POLICY,'offHostCustodyRoot':None,'controller':{'fixture':'controller'}}
        self.runtime.state_path=M.STATE_PATH
        self.runtime.completion_access_time_reconciliation=None
        self.context={'pair':{'current':'fixture-current','previous':'fixture-prior'}}
        self.state={'status':'complete','pending':None,'activePhase':None,'index':None,'completedContext':self.context}
        self.runtime.state=lambda:(self.state,'b'*64)
        self.runtime.current=lambda:(None,self.context)
        self.runtime.unfinished_intents=lambda:[]
        self.intent='c'*64
        self.position={'intentSha256':self.intent,'position':'after','priorCapacity':{'fixture':'descriptor'},
            'protected':{'configSha256':'a'*64,'stateSha256':'b'*64}}
    def call(self, intent=None):
        with patch.object(M,'scratch_capacity_position',return_value=self.position), \
             patch.object(M,'_capacity_floor_authority_original',return_value={'fixture':'original-floor'}):
            return self.runtime.scratch_migration_status(intent or self.intent)
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
            self.runtime.dispatch('scratch-migration-status',{'intentSha256':self.intent})
        with patch.object(M,'scratch_capacity_position',side_effect=ValueError('unsealed')):
            with self.assertRaisesRegex(ValueError,'unsealed'):
                self.runtime.status({'requireComplete':True,'scratch_pending_intent':self.intent})

if __name__=='__main__':unittest.main()
