#!/usr/bin/python3 -I
"""Native inode transactions, preserved completion evidence and independent floor authority."""
import contextlib
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import runpy
import unittest
from types import SimpleNamespace
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
    return mod
C = load('capacity_floor_installer_tests', HERE/'installer.py')
X = load('capacity_floor_real_lifecycle_tests', ROOT/'deploy/ui-retention/check-lifecycle-remote.test.py')
R, I = X.R, X.I
T = SimpleNamespace(**runpy.run_path(str(ROOT/'deploy/ui-stream-tools/installer.py')))
digest = lambda raw: hashlib.sha256(raw).hexdigest()


class FloorTests(unittest.TestCase):
    def setUp(self):
        self.stack = contextlib.ExitStack()
        self.addCleanup(self.stack.close)
        oldmask = os.umask(0o077); self.addCleanup(os.umask, oldmask)
        self.case = X.RemoteTests()
        self.case.setUp()
        self.addCleanup(self.case.doCleanups); self.addCleanup(self.case.tearDown)
        self.case.vps_complete()
        previous, intro = 'aaaaaaaa0003-20261101T010000Z', 'aaaaaaaa0004-20261103T010000Z'
        self.case.publish_vps_fixture(previous); self.case.publish_vps_fixture(intro)
        state, state_sha = self.case.runtime.state()
        index, _ = R.read_json(state['index']['path'], state['index']['sha256'])
        self.stack.enter_context(patch.object(X.F.S,'PRESERVED_FALLBACK_PREDECESSOR',previous))
        self.stack.enter_context(patch.object(X.F.S,'PRESERVED_FALLBACK_INTRODUCER',intro))
        self.stack.enter_context(patch.object(X.F.P,'FALLBACK_ADMISSION_SHA256',
            {'archive':index['admissions'][-2]['sha256'],'root':index['admissions'][-1]['sha256']}))
        self.base = self.case.fixture.base
        self.runtime = self.case.runtime
        self.source = 'c'*40; self.tree = 'd'*40
        capacity = self.case.layout.capacity
        receiver = self.base/'active-receiver.py'
        def helper(floor):
            return ('import json\nprint(json.dumps({"rootReserveBytes":'+str(floor)+',"growthReserveBytes":67108864}))\n').encode()
        self.old_bytes = {'capacity': helper(10*1024**3), 'receiver': b'old receiver\n'}
        self.new_bytes = {'capacity': helper(8*1024**3), 'receiver': b'new receiver\n'}
        self.paths = {'capacity':capacity,'receiver':receiver}
        for name,path in self.paths.items():
            path.write_bytes(self.old_bytes[name]); path.chmod(0o755 if name=='capacity' else 0o600)
        self.files = {name:(p,digest(self.old_bytes[name]),digest(self.new_bytes[name])) for name,p in self.paths.items()}
        self.grant = {'rootReserveBytes':8*1024**3,'priorRootReserveBytes':10*1024**3,'growthReserveBytes':64*1024**2,
            'targets':{str(p):{'before':before,'after':after} for p,before,after in self.files.values()}}
        self.raw = R.encoded(self.grant); approval=digest(self.raw)
        self.journal = self.base/'var/lib/test-floor'/approval; self.journal.parent.parent.mkdir(parents=True,exist_ok=True)
        for module,name,value in [(C,'DEVICE',capacity.stat().st_dev),(C,'OLD_INODES',
                {name:(p.stat().st_ino,p.stat().st_mode & 0o777) for name,p in self.paths.items()}),
                (R,'FLOOR_FILES',self.files),(R,'FLOOR_DIRECTORY',self.journal),(C,'APPROVAL',approval),(R,'FLOOR_APPROVAL',approval)]:
            self.stack.enter_context(patch.object(module,name,value))
        # Real renameat2, descriptor fsync and anonymous inode publication.
        # Fixture files belong to the test user; production enforces root ownership.
        def directory(path, private=False):
            info=path.lstat()
            self.assertTrue(path.is_dir() and path.resolve()==path and info.st_uid==os.geteuid() and
                (not private or info.st_mode & 0o777==0o700))
        self.stack.enter_context(patch.dict(T.successor_create.__globals__, {'directory':directory}))
        self.tools = SimpleNamespace(**{k:getattr(T,k) for k in ('successor_create','successor_record','exchange')},
            descriptor=R.floor_descriptor, root_dir=lambda path:path.mkdir(exist_ok=True,mode=0o700),
            directory=directory, read_record=lambda path:R.read_json(path)[0])
        cfg = self.base/'installed-config.json';cfg.write_bytes(b'fixture installed config')
        self.old = SimpleNamespace(CONFIG=str(cfg),read_bound=lambda p:R.read(p)[0],
            existing_runtime=lambda sha:self.runtime)
        self.ns={'tools':self.tools,'floor':R,'old':self.old,'expectedConfigSha256':digest(cfg.read_bytes())}

        # Apply actual historical completion and candidate package predicates,
        # with the fixture's pinned admission hashes and physical files.
        old_status=self.runtime.status({'requireComplete':True})
        self.held=old_status['verifiedPreservedFallback']
        self.assertEqual(len(self.held['snapshotSha256']),4)
        review=I.completed_review(self.runtime,{'stateSha256':state_sha})
        verified=self.case.verify_candidate_package(review)
        self.assertTrue(verified['fullCompletionVerified'])
        self.state_sha=state_sha
        def scoped(runtime, *args):
            state, state_sha = runtime.state()
            _, context = runtime.current()
            runtime.verify_vps_completion(state,context)
            scope=runtime.P.policy_scope(state['index'],runtime.layout,R.APPROVAL_SHA)
            if state_sha!=self.state_sha or scope['eligible'] or scope['preservedFallback']!=self.held:
                raise ValueError('Protected completion differs')
            return {'stateSha256':state_sha,'fallback':scope['preservedFallback']}
        self.stack.enter_context(patch.object(C,'protected',side_effect=scoped))

    def op(self, action):
        return C.operate(action,self.source,self.tree,self.ns,self.grant,self.raw,self.new_bytes)

    def test_prepare_apply_status_and_rollback_preserve_both_original_inodes(self):
        originals={n:R.floor_descriptor(p) for n,p in self.paths.items()}
        self.assertNotIn('verifiedCapacityFloor',self.runtime.status({'requireComplete':True}))
        self.op('prepare')
        with self.assertRaisesRegex(ValueError, 'not sealed'):self.op('status')
        with self.assertRaises((ValueError, FileNotFoundError)):
            self.runtime.status({'requireComplete':True})
        applied=self.op('apply')
        current=self.runtime.status({'requireComplete':True,'prospectiveRelease':'aaaaaaaa0005-20261110T010000Z'})
        witness=current['verifiedCapacityFloor']
        self.assertEqual((witness['rootReserveBytes'],witness['growthReserveBytes']),(8*1024**3,64*1024**2))
        self.assertEqual(current['binding']['capacityFloor'],witness)
        self.assertEqual(R.Runtime.capacity(self.runtime)['capacityFloor'],witness)
        self.assertEqual(current['verifiedPreservedFallback'],self.held)
        self.assertEqual(current['privateStageRetention']['wouldRetire'],[])
        self.assertTrue(applied['installed'] and self.op('status')['installed'])
        self.assertEqual(self.op('apply')['positions'],{'capacity':'after','receiver':'after'})
        for n in self.paths:self.assertEqual(R.floor_descriptor(self.journal/n),originals[n])
        seal=(self.journal/'installed.json').read_bytes()
        self.op('rollback')
        self.assertEqual((self.journal/'installed.json').read_bytes(),seal)
        self.assertTrue(self.op('rollback')['rolledBack'])
        for n,p in self.paths.items():self.assertEqual(R.floor_descriptor(p),originals[n])
        self.assertEqual(self.runtime.state()[1],self.state_sha)
        self.assertNotIn('verifiedCapacityFloor',self.runtime.status({'requireComplete':True}))
        with self.assertRaisesRegex(ValueError,'rollback'):self.op('apply')

    def test_interruption_between_exchanges_blocks_normal_operations_then_resumes(self):
        self.op('prepare')
        exchange=self.tools.exchange
        def interrupted(a,b):
            exchange(a,b); raise InterruptedError('power loss after exchange')
        with patch.object(self.tools,'exchange',side_effect=interrupted),self.assertRaises(InterruptedError):
            self.op('apply')
        with self.assertRaisesRegex(ValueError,'mixed'):self.runtime.status({'requireComplete':True})
        with self.assertRaisesRegex(ValueError,'mixed'):self.runtime.dispatch('prepare-cycle',{})
        self.assertEqual(self.op('apply')['positions'],{'capacity':'after','receiver':'after'})
        self.assertEqual(self.runtime.status({'requireComplete':True})['verifiedPreservedFallback'],self.held)

    def test_mixed_installation_can_return_to_the_exact_old_inodes(self):
        originals = {n:R.floor_descriptor(p) for n,p in self.paths.items()}
        self.op('prepare')
        exchange=self.tools.exchange
        def interrupted(a,b):
            exchange(a,b);raise InterruptedError('first file changed')
        with patch.object(self.tools,'exchange',side_effect=interrupted),self.assertRaises(InterruptedError):
            self.op('apply')
        self.op('rollback')
        self.assertNotIn('verifiedCapacityFloor',self.runtime.status({'requireComplete':True}))
        for n,p in self.paths.items():self.assertEqual(R.floor_descriptor(p),originals[n])

    def test_wrong_lifecycle_package_is_refused_before_creating_an_intent(self):
        self.ns['expectedConfigSha256']='0'*64
        with self.assertRaisesRegex(ValueError,'reviewed complete lifecycle package'):self.op('prepare')
        self.assertFalse(self.journal.exists())

    def test_replaced_candidate_or_forged_seal_refuses(self):
        self.op('prepare')
        p=self.journal/'receiver';raw=p.read_bytes()
        other=self.journal/'new-inode';other.write_bytes(raw);other.chmod(0o600);os.replace(other,p)
        with self.assertRaisesRegex(ValueError,'bytes/inodes'):self.op('apply')
        with self.assertRaises((ValueError,FileNotFoundError)):self.runtime.status({'requireComplete':True})

    def test_installed_seal_and_retained_original_are_fenced_on_each_status(self):
        self.op('prepare');self.op('apply')
        p=self.journal/'installed.json';raw=p.read_bytes();value=json.loads(raw);value['qualificationSha256']='0'*64
        p.write_bytes(R.encoded(value))
        with self.assertRaisesRegex(ValueError,'proof differs'):self.runtime.status({'requireComplete':True})
        p.write_bytes(raw);orig=self.journal/'capacity';orig.write_bytes(orig.read_bytes()+b'# tamper\n')
        with self.assertRaisesRegex(ValueError,'positions'):self.runtime.status({'requireComplete':True})


if __name__=='__main__':unittest.main()
