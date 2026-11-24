#!/usr/bin/env python3
"""Exercise the single-release installer with real exchanges on disposable files."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest import mock


ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('amo_installer', ROOT/'deploy/publish/amo_stage_installer.py')
tool = importlib.util.module_from_spec(spec)
spec.loader.exec_module(tool)


class InstallFixture(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.base = Path(self.tmp.name)
        self.base.chmod(0o700)
        self.store = self.base/'authority'
        self.bin = self.base/'bin'
        self.bin.mkdir(mode=0o700)
        self.paths = {name:self.bin/name for name in tool.SOURCE}
        self.candidates = {k:(b'approved fixture '+k.encode()) for k in self.paths}
        self.old = {k:(b'prior fixture '+k.encode()) for k in self.paths}
        for k,path in self.paths.items():
            path.write_bytes(self.old[k])
            path.chmod(0o755)
            os.setxattr(path,'user.amo-test',b'keep this attribute')
        self.before = {k:tool.readinfo(p)[1] for k,p in self.paths.items()}
        self.grant = self.approval()
        self.patch = mock.patch.dict(tool.PREVIOUS, {k:tool.sha(v) for k,v in self.old.items()})
        self.patch.start()
        self.addCleanup(self.patch.stop)
        self.healthy = True
        self.has_space = True

    def approval(self):
        return {'schema':'pow-ui-amo-direct-stage-approval-v1','commit':'a'*40,'tree':'b'*40,
                'releaseId':'a'*12+'-20261124T001000Z','publicationAttempt':'initial',
                'buildReceiptSha256':'d'*64,'sourceSha256':'1'*64,'surfacesSha256':'2'*64,'inventorySha256':'3'*64,
                'pair':dict(tool.PAIR),'configSha256':'4'*64,'stateSha256':'5'*64,
                'helperHashes':{k:tool.sha(v) for k,v in self.candidates.items()}}

    @property
    def journal(self):
        return self.store/tool.sha(tool.encoded(self.grant))

    def protect(self):
        if not self.healthy:
            raise ValueError('Fixture protected baseline changed')

    def budget(self):
        if not self.has_space:
            raise ValueError('Fixture capacity refused')

    def run_action(self, action, stop=None):
        def checkpoint(name):
            if name == stop:
                raise RuntimeError('fixture interruption')
        return tool.operate(action,self.store,self.paths,self.grant,self.candidates,self.protect,self.budget,checkpoint,
                            expected_predecessors=self.before)

    def test_terminal_positions_and_idempotence(self):
        for phase in ('prepare','prepare','apply','apply','status'):
            value=self.run_action(phase)
            self.assertEqual(value['active'], phase in ('apply','status'))
        for k,path in self.paths.items():
            self.assertEqual(path.read_bytes(),self.candidates[k])
            self.assertEqual(tool.readinfo(self.journal/k)[1],self.before[k])
            self.assertEqual(os.getxattr(path,'user.amo-test'),b'keep this attribute')
        for phase in ('rollback','rollback','status'):
            value=self.run_action(phase)
            self.assertFalse(value['active'])
            self.assertTrue(value['rollbackComplete'])
            self.assertEqual({k:tool.readinfo(path)[1] for k,path in self.paths.items()}, self.before)
        with self.assertRaisesRegex(ValueError,'Reversal'):
            self.run_action('apply')

    def test_same_bytes_on_replaced_predecessor_inode_refused(self):
        prior = self.paths['stager']
        replacement = prior.with_name('substituted-stager')
        replacement.write_bytes(prior.read_bytes())
        replacement.chmod(0o755)
        os.setxattr(replacement,'user.amo-test',os.getxattr(prior,'user.amo-test'))
        os.utime(replacement,ns=(prior.stat().st_atime_ns,prior.stat().st_mtime_ns))
        replacement.replace(prior)
        with self.assertRaisesRegex(ValueError,'Restored predecessor inode'):
            self.run_action('prepare')
        self.assertFalse((self.journal/'qualified.json').exists())

    def test_resume_each_preparation_boundary(self):
        for point in ('approval.json','stager','publisher','intent.json','qualified.json'):
            with self.assertRaisesRegex(RuntimeError,'fixture interruption'):
                self.run_action('prepare',point)
            self.assertEqual({k:tool.readinfo(path)[1] for k,path in self.paths.items()},self.before)
        self.assertFalse(self.run_action('prepare')['active'])

    def test_crashes_at_each_forward_and_reverse_checkpoint(self):
        self.run_action('prepare')
        for point in ('exchange-stager-after','exchange-publisher-after','installed.json'):
            with self.assertRaisesRegex(RuntimeError,'fixture interruption'):
                self.run_action('apply',point)
            self.assertEqual(self.run_action('status')['active'], point=='installed.json')
        self.assertTrue(self.run_action('apply')['active'])
        for point in ('reversing.json','exchange-publisher-before','exchange-stager-before','rolled-back.json'):
            with self.assertRaisesRegex(RuntimeError,'fixture interruption'):
                self.run_action('rollback',point)
            self.assertFalse(self.run_action('status')['active'])
        self.assertTrue(self.run_action('rollback')['rollbackComplete'])

    def test_reverse_partial_forward_and_block_reapply(self):
        self.run_action('prepare')
        with self.assertRaises(RuntimeError):
            self.run_action('apply','exchange-stager-after')
        self.assertFalse(self.run_action('status')['active'])
        self.assertTrue(self.run_action('rollback')['rollbackComplete'])
        self.assertEqual({k:tool.readinfo(path)[1] for k,path in self.paths.items()},self.before)

    def test_stale_pair_protection_space_and_wrong_candidate(self):
        self.has_space=False
        with self.assertRaisesRegex(ValueError,'capacity'):
            self.run_action('prepare')
        self.assertFalse(self.store.exists())
        self.has_space=True
        with mock.patch.dict(self.grant['pair'],current=self.grant['pair']['previous']):
            with self.assertRaisesRegex(ValueError,'Protected'):
                self.run_action('prepare')
        with mock.patch.dict(self.grant,commit=tool.BASE):
            with self.assertRaisesRegex(ValueError,'successor'):
                self.run_action('prepare')
        with mock.patch.dict(self.candidates,stager=b'other bytes'):
            with self.assertRaisesRegex(ValueError,'Replacement'):
                self.run_action('prepare')
        self.run_action('prepare')
        self.has_space=False
        with self.assertRaisesRegex(ValueError,'capacity'):
            self.run_action('apply')
        self.has_space=True
        self.healthy=False
        with self.assertRaisesRegex(ValueError,'baseline'):
            self.run_action('apply')
        self.assertEqual({k:tool.readinfo(path)[1] for k,path in self.paths.items()},self.before)

    def test_receipt_tampering_and_foreign_entries(self):
        self.run_action('prepare')
        qualified=self.journal/'qualified.json'
        raw=qualified.read_bytes()
        qualified.write_bytes(raw.replace(b'qualified-v1',b'qualified-v2'))
        with self.assertRaisesRegex(ValueError,'Conflicting receipt'):
            self.run_action('apply')
        qualified.write_bytes(raw)
        (self.journal/'unexpected').touch()
        with self.assertRaisesRegex(ValueError,'Foreign'):
            self.run_action('apply')
        self.assertEqual({k:tool.readinfo(path)[1] for k,path in self.paths.items()},self.before)

    def test_replaced_inode_and_changed_xattr_refuse(self):
        self.run_action('prepare')
        spare=self.journal/'publisher'
        os.setxattr(spare,'user.amo-test',b'changed')
        with self.assertRaisesRegex(ValueError,'Unrecognized helper'):
            self.run_action('apply')
        os.setxattr(spare,'user.amo-test',b'keep this attribute')
        replacement=self.bin/'different-file'
        tool.create(replacement,spare.read_bytes(),0o755,spare)
        os.replace(replacement,spare)
        with self.assertRaisesRegex(ValueError,'Unrecognized helper'):
            self.run_action('apply')

    def test_interrupted_prepare_rechecks_metadata_against_running_helper(self):
        with self.assertRaisesRegex(RuntimeError,'interruption'):
            self.run_action('prepare','intent.json')
        spare=self.journal/'publisher'
        os.setxattr(spare,'user.amo-test',b'different')
        intent=self.journal/'intent.json'
        altered=json.loads(intent.read_bytes())
        altered['files']['publisher']['after']=tool.readinfo(spare)[1]
        intent.write_bytes(tool.encoded(altered))
        with self.assertRaisesRegex(ValueError,'inode metadata'):
            self.run_action('prepare')
        self.assertFalse((self.journal/'qualified.json').exists())

    def test_other_attempt_cannot_claim_existing_receipts(self):
        self.run_action('prepare')
        with mock.patch.dict(self.grant,publicationAttempt='rebound'):
            with self.assertRaises(FileNotFoundError):
                self.run_action('apply')
        self.assertEqual({k:tool.readinfo(path)[1] for k,path in self.paths.items()},self.before)

    def test_foreign_host_refuses_before_reading_any_frame_or_runtime(self):
        with mock.patch.object(tool.socket, 'gethostname', return_value='fixture-host'), \
             mock.patch.object(tool.subprocess, 'check_output', side_effect=AssertionError('Host guard failed')):
            with self.assertRaisesRegex(ValueError, 'UI receiver'):
                tool.installed('prepare', self.grant, self.base/'absent-frame', '0'*64)
        self.assertFalse(self.store.exists())

    def test_require_canonical_reviewed_approval(self):
        p=self.base/'grant'
        p.write_text(json.dumps(self.grant))
        p.chmod(0o600)
        with self.assertRaisesRegex(ValueError,'canonical'):
            tool.sealed_approval(p,tool.sha(p.read_bytes()))
        p.write_bytes(tool.encoded(self.grant))
        self.assertEqual(tool.sealed_approval(p,tool.sha(p.read_bytes())),self.grant)
        with self.assertRaisesRegex(ValueError,'digest'):
            tool.sealed_approval(p,'0'*64)

    def test_pack_exact_committed_pair_and_closed_inventory(self):
        repo=self.base/'repo'
        repo.mkdir(mode=0o700)
        def git(*args):
            return subprocess.check_output(['git','-C',str(repo),'-c','user.name=AMO fixture',
                '-c','user.email=amo-fixture@invalid.example','-c','commit.gpgsign=False',*args],text=True).strip()
        git('init','-q')
        for k,relative in tool.SOURCE.items():
            path=repo/relative
            path.parent.mkdir(parents=True,exist_ok=True)
            path.write_bytes(self.old[k])
        git('add','deploy')
        git('commit','-qm','protected fixture baseline')
        base=git('rev-parse','HEAD')
        for k,relative in tool.SOURCE.items():
            (repo/relative).write_bytes(self.candidates[k])
        installer=repo/tool.SELF
        installer.parent.mkdir()
        installer.write_bytes((ROOT/tool.SELF).read_bytes())
        git('add','deploy')
        git('commit','-qm','reviewed fixture successor')
        commit=git('rev-parse','HEAD')
        grant={**self.grant,'commit':commit,'tree':git('rev-parse','HEAD^{tree}'),'releaseId':commit[:12]+'-20261124T001000Z'}
        shared={k:grant[k] for k in ('commit','tree','releaseId')}
        build=self.base/'build.json'
        build.write_bytes(tool.encoded({**shared,'releaseFormat':'proofofwork-ui-release-v6',
                            'bundles':{k:{'sha256':grant[k+'Sha256']} for k in ('source','surfaces')}}))
        grant['buildReceiptSha256']=tool.sha(build.read_bytes())
        closed=self.base/'closed.json'
        inventory=Path(str(closed)+'.zlib')
        inventory.write_bytes(b'fixture closed inventory')
        grant['inventorySha256']=tool.sha(inventory.read_bytes())
        closed.write_bytes(tool.encoded({**shared,'model':'proof-ui-closed-input-v1','inputCompactorSha256':'d'*64,
                'surfacesSha256':grant['surfacesSha256'],'inventorySha256':grant['inventorySha256'],
                'helperHashes':dict(grant['helperHashes'])}))
        for p in (build,closed,inventory):
            p.chmod(0o600)
        dst=self.base/'helper-frame.json'
        with mock.patch.object(tool,'BASE',base):
            tool.pack(grant,build,closed,dst,repo)
            frame=json.loads(dst.read_bytes())
            self.assertEqual(frame['approvalSha256'],tool.sha(tool.encoded(grant)))
            self.assertEqual(set(frame['helpers']),set(tool.SOURCE))
            with self.assertRaises(FileExistsError):
                tool.pack(grant,build,closed,dst,repo)
            with mock.patch.dict(grant,buildReceiptSha256='0'*64):
                with self.assertRaisesRegex(ValueError,'Wrong build receipt'):
                    tool.pack(grant,build,closed,self.base/'bad',repo)
            with mock.patch.dict(grant,inventorySha256='0'*64):
                with self.assertRaisesRegex(ValueError,'inventory'):
                    tool.pack(grant,build,closed,self.base/'bad',repo)
            (repo/tool.SOURCE['stager']).write_bytes(b'dirty')
            with self.assertRaisesRegex(ValueError,'clean'):
                tool.pack(grant,build,closed,self.base/'bad',repo)
        self.assertFalse((self.base/'bad').exists())

    def test_migrated_source_and_installed_controller_pins(self):
        evidence = self.base/'evidence'
        evidence.mkdir(mode=0o700)
        config_path = self.base/'config'
        code = b'# fixture lifecycle controller\n'
        files = {tool.CONTROLLER: {'sha256': tool.sha(code), 'bytes':len(code)}}
        manifest = {'schema':'pow-ui-retention-package-v1','sourceCommit':self.grant['commit'],
                    'sourceTree':self.grant['tree'],'files':files}
        raw = tool.encoded(manifest)
        pin = tool.sha(raw)
        package = evidence/('ui-lifecycle-tools-'+pin)
        controller = package/tool.CONTROLLER
        controller.parent.mkdir(parents=True,mode=0o700)
        controller.write_bytes(code)
        (package/'package.json').write_bytes(raw)
        config = {'package':{'path':str(package),'sha256':pin},'sourceCommit':self.grant['commit'],
                  'sourceTree':self.grant['tree'],'controller':{'path':str(controller),'sha256':tool.sha(code)}}
        config_path.write_bytes(tool.encoded(config))
        for item in (config_path,controller,package/'package.json'):
            item.chmod(0o600)
        self.grant['configSha256'] = tool.sha(config_path.read_bytes())
        with mock.patch.object(tool,'CONFIG',config_path), mock.patch.object(tool,'PACKAGE_DIRECTORY',evidence), \
             mock.patch.object(tool,'PACKAGE_FILES_SHA',tool.sha(tool.encoded(files))):
            self.assertEqual(tool.migrated_controller(self.grant),(controller,code))
            for key in ('commit','tree','configSha256'):
                with self.subTest(key=key), mock.patch.dict(self.grant,{key:'3'*len(self.grant[key])}), self.assertRaises(ValueError):
                    tool.migrated_controller(self.grant)
            with mock.patch.object(tool,'PACKAGE_FILES_SHA','0'*64), self.assertRaisesRegex(ValueError,'committed files'):
                tool.migrated_controller(self.grant)
            controller.write_bytes(code + b'# drift')
            with self.assertRaisesRegex(ValueError,'installed lifecycle controller'):
                tool.migrated_controller(self.grant)

    def test_require_completed_and_current_7_5g_migration(self):
        protected = {k:self.grant[k] for k in ('configSha256','stateSha256','pair')}
        intent = {'commit':self.grant['commit'],'tree':self.grant['tree'],'protected':protected}
        path = self.base/'scratch-intent.json'
        path.write_bytes(tool.encoded(intent))
        path.chmod(0o600)
        replacement_path=mock.patch.object(tool,'SCRATCH_INTENT',path)
        replacement_path.start()
        self.addCleanup(replacement_path.stop)
        scratch = {'model':'verified-ui-scratch-successor-v1','approvalSha256':tool.SCRATCH_APPROVAL,
                   'installedSha256':'7'*64,'intentSha256':tool.sha(path.read_bytes()),'scratchBudgetBytes':7_680*1024**2}
        status = {'ok':True,'publicationHealthy':True,'retentionComplete':True,'unfinishedIntents':[],
                  'configSha256':self.grant['configSha256'],'stateSha256':self.grant['stateSha256'],
                  'pair':dict(tool.PAIR),'verifiedScratchCapacity':scratch,'binding':{'scratchCapacity':dict(scratch)}}
        tool.require_completed_migration(status,self.grant)
        for key,replacement in [('scratchBudgetBytes',7*1024**3),
                                ('approvalSha256','512d190246031cbaa5ff8ceec32955ddfa742a4c893e0777d03f6af0967459a8'),
                                ('installedSha256',None),('model','pending')]:
            bad = {**scratch,key:replacement}
            with self.subTest(key=key), self.assertRaises(ValueError):
                tool.require_completed_migration({**status,'verifiedScratchCapacity':bad,'binding':{'scratchCapacity':bad}},self.grant)
        for key,replacement in [('binding',{}),('unfinishedIntents',['pending']),('stateSha256','0'*64),
                                ('verifiedScratchCapacity',None)]:
            with self.subTest(key=key), self.assertRaises(ValueError):
                tool.require_completed_migration({**status,key:replacement},self.grant)
        with self.assertRaisesRegex(ValueError,'exact migrated completion'):
            tool.require_completed_migration({**status,'stateSha256':'3'*64},{**self.grant,'stateSha256':'3'*64})
        path.write_bytes(b'{}')
        with self.assertRaisesRegex(ValueError,'migration intent'):
            tool.require_completed_migration(status,self.grant)
        for key,old in [('configSha256',tool.PRIOR_CONFIG_SHA),('stateSha256',tool.PRIOR_STATE_SHA)]:
            with self.subTest(key=key),mock.patch.dict(self.grant,{key:old}),self.assertRaisesRegex(ValueError,'baseline'):
                tool.checked_approval(self.grant)

    def test_reviewed_package_matches_sources_and_native_helper(self):
        installer = ROOT/'deploy/ui-retention/install_lifecycle.py'
        spec = importlib.util.spec_from_file_location('fixture_lifecycle_package',installer)
        package = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(package)
        files = {}
        for name in package.FILES:
            raw = (ROOT/name).read_bytes()
            files[name] = {'sha256':tool.sha(raw),'bytes':len(raw)}
        self.assertEqual(tool.sha(tool.encoded(files)),tool.PACKAGE_FILES_SHA)
        self.assertEqual(files['deploy/proofofwork-ui-capacity.py']['sha256'],tool.CAPACITY_SHA)
        scope_name = 'audits/2026-11-24-amo-catchup-ui-scratch-capacity-scope.json'
        self.assertEqual(files[scope_name]['sha256'],tool.SCRATCH_APPROVAL)
        scope = json.loads((ROOT/scope_name).read_bytes())
        self.assertEqual(package.CATCHUP_PRIOR_STAGE['approvalSha256'],tool.PRIOR_GRANT)
        self.assertEqual(package.CATCHUP_PRIOR_STAGE['intentSha256'],tool.PRIOR_GRANT_INTENT)
        self.assertEqual(scope['preBridge']['configSha256'],tool.PRIOR_CONFIG_SHA)
        self.assertEqual(scope['preBridge']['stateSha256'],tool.PRIOR_STATE_SHA)

    def test_context_drift_after_first_exchange_blocks_until_reconciled(self):
        self.run_action('prepare')
        def lose_baseline(point):
            if point=='exchange-stager-after':
                self.healthy=False
        with self.assertRaisesRegex(ValueError,'baseline'):
            tool.operate('apply',self.store,self.paths,self.grant,self.candidates,self.protect,self.budget,lose_baseline)
        self.assertFalse((self.journal/'installed.json').exists())
        self.assertEqual(self.paths['publisher'].read_bytes(),self.old['publisher'])
        with self.assertRaisesRegex(ValueError,'baseline'):
            self.run_action('rollback')
        self.healthy=True
        self.assertTrue(self.run_action('rollback')['rollbackComplete'])

    def test_terminal_lifecycle_refusal_never_activates(self):
        self.run_action('prepare')
        checks=iter([True,False])
        def complete():
            if not next(checks):
                raise ValueError('Terminal fixture unhealthy')
        with self.assertRaisesRegex(ValueError,'unhealthy'):
            tool.operate('apply',self.store,self.paths,self.grant,self.candidates,self.protect,self.budget,verify_complete=complete)
        self.assertFalse((self.journal/'installed.json').exists())
        self.assertFalse(self.run_action('status')['active'])
        self.assertTrue(self.run_action('rollback')['rollbackComplete'])


if __name__ == '__main__':
    unittest.main()
