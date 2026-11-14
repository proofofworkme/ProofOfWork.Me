#!/usr/bin/env python3
"""Synthetic-only adapter tests. No production paths are opened or changed."""
import importlib.util
import fcntl
import os
from pathlib import Path
import stat
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('retirement_controller',
    Path(__file__).with_name('retirement_controller.py'))
C=importlib.util.module_from_spec(spec);spec.loader.exec_module(C)
R=C.R
H='1'*64

class Fixture:
    def __enter__(self):
        self.tmp=tempfile.TemporaryDirectory();self.base=Path(self.tmp.name)
        self.evidence=self.base/'evidence';self.evidence.mkdir(mode=0o700)
        self.lock=self.base/'deploy.lock';self.lock.write_text('');self.lock.chmod(0o600)
        self.fd=os.open(self.lock,os.O_RDONLY)
        fcntl.flock(self.fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
        self.paths=[self.base/'first.tgz',self.base/'first-root',
                    self.base/'second.tgz',self.base/'second-root']
        self.sidecar=self.base/'first.tgz.sha256';self.sidecar.write_text('keep')
        for p in self.paths:
            if p.suffix=='.tgz':p.write_bytes(b'archive fixture');p.chmod(0o600)
            else:
                p.mkdir(mode=0o700)
                (p/'.proofofwork-ui-release').write_text('fixture manifest')
                (p/'a').write_text('data');os.link(p/'a',p/'b')
        self.patches=[patch.object(R,'PATHS',tuple(map(str,self.paths))),
                      patch.object(R,'EVIDENCE_DIR',str(self.evidence)),
                      patch.object(R,'TERMINAL_PATH',str(self.evidence/'completed.json')),
                      patch.object(C,'LOCK',self.lock),
                      patch.object(R,'read_bound',self.fixture_read),
                      patch.object(R,'verify_historical_equivalents',lambda *unused:None)]
        for p in self.patches:p.start()
        trees=[]
        for p in self.paths:
            fresh=C.E.inventory_file_group(p,[p.name]) if p.suffix=='.tgz' else C.E.inventory(p)
            rows=[]
            for x in fresh['records']:
                s=x['identity'];path=str(p) if p.suffix=='.tgz' else str(p/x['path'])
                rows.append({'path':path,'type':'file' if x['kind']=='file' else 'dir',
                    'device':s['st_dev'],'inode':s['st_ino'],'nlink':s['st_nlink'],
                    'mode':stat.S_IMODE(s['st_mode']),'uid':s['st_uid'],'gid':s['st_gid'],
                    'size':s['st_size'],'mtimeNs':s['st_mtime_ns'],'ctimeNs':s['st_ctime_ns'],
                    **({'sha256':x['sha256']} if x['kind']=='file' else {})})
            trees.append({'root':str(p),'records':rows})
        jdir=self.evidence/'journal';jdir.mkdir(mode=0o700)
        self.journal=R.Journal(jdir)
        initial=self.guard('initial',0)
        self.journal.append('prepared',{'proposalSha256':R.PROPOSAL_SHA,
            'inventorySha256':R.INVENTORY_SHA,'restoreSha256':R.RESTORE_SHA,
            'approvalSha256':H,'preflightSha256':initial['sha256'],'pair':R.PAIR.copy()})
        # Constructor authority is independently tested with the immutable real
        # proposal. Fixture injects only synthetic roots into the action engine.
        self.controller=object.__new__(C.Controller)
        self.controller.lock=self.fd;self.controller.journal=self.journal
        self.controller.approval_sha=H;self.controller.inventory={'inventories':trees}
        self.controller.proposal={'sidecarsKeep':[{'path':str(self.sidecar),
            'sha256':R.digest(self.sidecar.read_bytes())}]}
        fixture=self
        class Producer:
            package_sha=H
            layout=SimpleNamespace()
            S=SimpleNamespace(protected_pair=lambda *args:{k:{'fields':{'release_id':v}}
                              for k,v in R.PAIR.items()})
            drift=False
            def __call__(self,phase,index):return fixture.guard(phase,index)
            def inspect(self,phase,index):
                value=fixture.guard_value(phase,index)
                if self.drift:value['protectedClosureSha256']='f'*64
                return value,{}
        self.producer=Producer()
        self.controller.guard_producer=self.producer
        return self
    def fixture_read(self,path,sha,limit=16*1024**2):
        p=Path(path)
        assert p.resolve().is_relative_to(self.base.resolve())
        assert p.is_file() and not p.is_symlink()
        raw=p.read_bytes();assert len(raw)<=limit
        C.require(R.digest(raw)==sha,'Evidence bytes differ')
        return raw
    def guard_value(self,phase,index):
        data={'schema':'pow-exact-retirement-stock-guard-v1','phase':phase,
              'actionIndex':index,'retainedPair':R.PAIR.copy(),
              'currentManifestSha256':C.CURRENT_MANIFEST_SHA,
              'previousManifestSha256':C.PREVIOUS_MANIFEST_SHA,
              'protectedClosureSha256':H,'sidecarsSha256':H,
              'historicalEvidenceSha256':H,'referenceCheckSha256':H,
              'pendingConfigSha256':H,'capacityProofSha256':H,
              'proposalSha256':R.PROPOSAL_SHA,'approvalSha256':H}
        for key,name in [('protectedClosureSha256','protected'),('sidecarsSha256','sidecars'),
                         ('historicalEvidenceSha256','historical'),('referenceCheckSha256','references'),
                         ('capacityProofSha256','capacity')]:
            data[key]=R.digest(R.encoded({'synthetic':name}))
        return data
    def guard(self,phase,index):
        data=self.guard_value(phase,index)
        for name in ('protected','sidecars','historical','references','capacity'):
            C._save(self.evidence/('guard-%s-%d-%s.json'%(phase,index,name)),
                    {'synthetic':name})
        p=self.evidence/('guard-%s-%d.json'%(phase,index))
        sha=C._save(p,data)
        return {'path':str(p),'sha256':sha}
    def __exit__(self,*unused):
        self.journal.close();os.close(self.fd)
        for p in reversed(self.patches):p.stop()
        self.tmp.cleanup()

class TestController(unittest.TestCase):
    def test_complete_four_exact_payloads_preserves_sidecar(self):
        with Fixture() as f:
            for i in range(4):
                prepared=f.controller.prepare();self.assertEqual(prepared.index,i)
                f.controller.perform(prepared)
            self.assertTrue(all(not p.exists() for p in f.paths))
            self.assertEqual(f.sidecar.read_text(),'keep')
            self.assertEqual(R.validate_chain(f.journal.read())['nextIndex'],4)

    def test_same_prepared_action_never_retried(self):
        with Fixture() as f:
            p=f.controller.prepare();f.controller.perform(p)
            with self.assertRaisesRegex(ValueError,'cannot be retried'):
                f.controller.perform(p)

    def test_crash_before_unlink_leaves_intact_and_uncertain(self):
        with Fixture() as f:
            p=f.controller.prepare()
            def crash(phase,unused):
                if phase=='before-unlink':raise RuntimeError('fixture crash')
            with self.assertRaises(RuntimeError):f.controller.perform(p,crash)
            self.assertTrue(f.paths[0].exists())
            self.assertEqual(R.validate_chain(f.journal.read())['status'],'uncertain')
            with self.assertRaisesRegex(ValueError,'Partial/intact'):
                f.controller.reconcile_uncertain()

    def test_crash_after_final_unlink_reconciles_without_retry(self):
        with Fixture() as f:
            p=f.controller.prepare()
            def crash(phase,unused):
                if phase=='after-unlink':raise RuntimeError('fixture crash')
            with self.assertRaises(RuntimeError):f.controller.perform(p,crash)
            self.assertFalse(f.paths[0].exists())
            f.controller.reconcile_uncertain()
            self.assertEqual(R.validate_chain(f.journal.read())['nextIndex'],1)

    def test_partial_tree_fails_closed(self):
        with Fixture() as f:
            f.controller.perform(f.controller.prepare())
            p=f.controller.prepare()
            def crash(phase,unused):
                if phase=='after-unlink':raise RuntimeError('fixture crash')
            with self.assertRaises(RuntimeError):f.controller.perform(p,crash)
            self.assertTrue(f.paths[1].exists())
            with self.assertRaisesRegex(ValueError,'Partial/intact'):
                f.controller.reconcile_uncertain()

    def test_external_hardlink_fails_capture(self):
        with Fixture() as f:
            os.link(f.paths[0],f.base/'outside')
            with self.assertRaises(ValueError):f.controller.prepare()
            self.assertTrue(f.paths[0].exists())

    def test_substituted_archive_rejected(self):
        with Fixture() as f:
            p=f.controller.prepare()
            f.paths[0].unlink();f.paths[0].write_bytes(b'archive fixture')
            with self.assertRaises(ValueError):f.controller.perform(p)
            self.assertTrue(f.paths[0].exists())

    def test_substituted_lock_rejected(self):
        with Fixture() as f:
            p=f.controller.prepare()
            f.lock.rename(f.base/'old-lock');f.lock.write_text('');f.lock.chmod(0o600)
            with self.assertRaisesRegex(ValueError,'Deployment lock'):
                f.controller.perform(p)
            self.assertTrue(f.paths[0].exists())

    def test_inventory_tampering_blocks_reconciliation(self):
        with Fixture() as f:
            p=f.controller.prepare()
            def crash(phase,unused):
                if phase=='after-unlink':raise RuntimeError('fixture crash')
            with self.assertRaises(RuntimeError):f.controller.perform(p,crash)
            x=f.evidence/'action-0-inventory.json';x.write_bytes(x.read_bytes()+b' ')
            with self.assertRaises(ValueError):f.controller.reconcile_uncertain()

    def test_missing_action_log_blocks_reconciliation(self):
        with Fixture() as f:
            p=f.controller.prepare()
            def crash(phase,unused):
                if phase=='after-unlink':raise RuntimeError('fixture crash')
            with self.assertRaises(RuntimeError):f.controller.perform(p,crash)
            (f.evidence/'action-0-removal.jsonl').unlink()
            with self.assertRaises(FileNotFoundError):f.controller.reconcile_uncertain()

    def test_protected_state_drift_before_perform_prevents_deletion(self):
        with Fixture() as f:
            p=f.controller.prepare()
            original=f.guard
            def changed(phase,index):
                binding=original(phase,index)
                if phase=='admit':
                    path=Path(binding['path']);data=R._json(path.read_bytes())
                    data['sidecarsSha256']='f'*64
                    path.write_bytes(R.encoded(data))
                    binding['sha256']=R.digest(path.read_bytes())
                return binding
            f.controller.guard_producer=changed
            with self.assertRaisesRegex(ValueError,'Protected state'):
                f.controller.perform(p)
            self.assertTrue(f.paths[0].exists())
            self.assertEqual(R.validate_chain(f.journal.read())['status'],'ready')

    def test_protected_closure_drift_between_actions_prevents_next_delete(self):
        with Fixture() as f:
            f.controller.perform(f.controller.prepare())
            original=f.guard
            def changed(phase,index):
                binding=original(phase,index)
                path=Path(binding['path']);data=R._json(path.read_bytes())
                data['protectedClosureSha256']='f'*64
                path.write_bytes(R.encoded(data));binding['sha256']=R.digest(path.read_bytes())
                return binding
            f.controller.guard_producer=changed
            with self.assertRaisesRegex(ValueError,'initial migration baseline'):
                f.controller.prepare()
            self.assertTrue(f.paths[1].exists())

    def test_tampered_action_inode_blocks_reconciliation(self):
        with Fixture() as f:
            p=f.controller.prepare()
            def crash(phase,unused):
                if phase=='after-unlink':raise RuntimeError('fixture crash')
            with self.assertRaises(RuntimeError):f.controller.perform(p,crash)
            path=f.evidence/'action-0-removal.jsonl'
            rows=[R._json(line) for line in path.read_bytes().splitlines()]
            rows[0]['action']['before']['st_ino']+=1
            path.write_bytes(b''.join(R.encoded(x) for x in rows))
            with self.assertRaisesRegex(ValueError,'identity differs'):
                f.controller.reconcile_uncertain()

    def test_terminal_seal_and_repeat_are_idempotent(self):
        with Fixture() as f:
            for unused in range(4):f.controller.perform(f.controller.prepare())
            first=C.complete_terminal(f.controller)
            before=f.journal.read()
            second=C.complete_terminal(f.controller)
            self.assertEqual(first,second);self.assertEqual(before,f.journal.read())

    def test_terminal_crash_recovery_rechecks_preservation(self):
        with Fixture() as f:
            for unused in range(4):f.controller.perform(f.controller.prepare())
            C.complete_terminal(f.controller)
            Path(R.TERMINAL_PATH).unlink()
            f.producer.drift=True
            with self.assertRaisesRegex(ValueError,'initial migration baseline'):
                C.complete_terminal(f.controller)
            self.assertFalse(Path(R.TERMINAL_PATH).exists())

    def test_missing_terminal_recreated_only_after_fresh_guard(self):
        with Fixture() as f:
            for unused in range(4):f.controller.perform(f.controller.prepare())
            first=C.complete_terminal(f.controller);Path(R.TERMINAL_PATH).unlink()
            second=C.complete_terminal(f.controller)
            self.assertEqual(first,second)

    def test_no_boolean_approval(self):
        with self.assertRaises(ValueError):C.approve(b'{}',H)

if __name__=='__main__':unittest.main()
