#!/usr/bin/python3 -I
"""Focused state-machine faults using real durable inode exchange in private tmp.

Bridge/runtime and native budgets are explicit synthetic boundaries here. The
separate lifecycle authority tests authenticate real bridge receipt structure.
No production path, root privileges, network or live package is used.
"""
import contextlib
import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import runpy
import stat
import subprocess
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('scratch_installer_test', HERE/'installer.py')
C = importlib.util.module_from_spec(spec); spec.loader.exec_module(C)
T = SimpleNamespace(**runpy.run_path(str(HERE.parents[1]/'deploy/ui-stream-tools/installer.py')))
sha = lambda raw: hashlib.sha256(raw).hexdigest()


class Interrupted(RuntimeError):
    pass


class TransactionTests(unittest.TestCase):
    def setUp(self):
        self.stack = contextlib.ExitStack(); self.addCleanup(self.stack.close)
        self.base = Path(self.stack.enter_context(tempfile.TemporaryDirectory(prefix='scratch-transaction-')))
        self.base.chmod(0o700)
        self.live = self.base/'live'; self.live.write_bytes(b'old pinned helper\n'); self.live.chmod(0o755)
        self.new = b'new pinned helper\n'
        self.journal = self.base/'journal-parent'/'migration'
        self.grant = {'priorScratchBytes':5*1024**3,'scratchBytes':11*1024**3//2}
        self.raw = (json.dumps(self.grant)+'\n').encode()
        self.baseline = {'stateSha256':'s'*64,'configSha256':'c'*64,'pair':{'current':'a','previous':'b'},
                         'completedContext':{},'context':{'value':1}}
        self.checks = []; self.available = True
        def directory(path, private=False):
            s=path.lstat()
            C.need(path.resolve()==path and stat.S_ISDIR(s.st_mode) and s.st_uid==os.geteuid()
                   and not s.st_mode & 0o7022 and (not private or stat.S_IMODE(s.st_mode)==0o700), 'Unsafe fixture directory')
        self.stack.enter_context(patch.dict(T.successor_create.__globals__,{'directory':directory}))
        def root_dir(path):
            directory(path.parent)
            if not path.exists():
                path.mkdir(mode=0o700); T.sync_dir(path.parent)
            directory(path,True)
        def descriptor(path):
            s=path.lstat()
            C.need(path.resolve()==path and stat.S_ISREG(s.st_mode) and s.st_nlink==1
                   and s.st_uid==os.geteuid() and not s.st_mode&0o7022, 'Unsafe fixture file')
            # Only ownership is normalized for the non-root synthetic namespace.
            # All inode/device/type/mode/link/size/time values are actual filesystem values.
            return {'sha256':sha(path.read_bytes()),'identity':[s.st_dev,s.st_ino,0,0,s.st_mode,
                    s.st_nlink,s.st_size,s.st_mtime_ns],'xattrs':{k:sha(os.getxattr(path,k)) for k in os.listxattr(path)}}
        self.descriptor=descriptor
        self.tools=SimpleNamespace(root_dir=root_dir,directory=directory,descriptor=descriptor,
            successor_create=T.successor_create,successor_record=T.successor_record,exchange=T.exchange,
            read_record=lambda p:json.loads(p.read_bytes()))
        self.floor=SimpleNamespace(SCRATCH_CAPACITY_PATH=self.live,SCRATCH_DIRECTORY=self.journal,
            SCRATCH_APPROVAL=sha(self.raw),SCRATCH_PRIOR_SHA=sha(self.live.read_bytes()),SCRATCH_NEXT_SHA=sha(self.new),
            floor_descriptor=descriptor,_capacity_floor_authority_original=lambda layout,prior:self.checks.append('original-floor'))
        self.floor.scratch_capacity_position=self.authority
        self.runtime=SimpleNamespace(layout=SimpleNamespace(evidence=self.base,capacity=self.live),
            S=SimpleNamespace(lock=lambda layout:os.open(self.base,os.O_RDONLY|os.O_DIRECTORY),
                              require_execution_lock=lambda fd,layout:os.fstat(fd)),
            status=self.status,scratch_migration_status=self.pending_status,lock_fd=None)
        self.old=SimpleNamespace(CONFIG=self.live,read_bound=lambda p:Path(p).read_bytes(),
            existing_runtime=lambda digest:self.runtime)
        self.ns={'tools':self.tools,'old':self.old,'floor':self.floor}
        self.stack.enter_context(patch.object(C,'protected',side_effect=lambda *args:copy.deepcopy(self.baseline)))
        self.stack.enter_context(patch.object(C,'native_budget',side_effect=lambda *args:self.checks.append('budget')))
        self.stack.enter_context(patch.object(C,'rollback_budget',side_effect=self.rollback_check))
        self.original=self.descriptor(self.live)

    def rollback_check(self,grant):
        C.need(self.available,'Rollback refuses scratch above the old 5 GiB limit')
        self.checks.append('rollback-budget')

    def authority(self,layout,allow_pending=False):
        if not self.journal.exists():return None
        intent=self.tools.read_record(self.journal/'intent.json')
        C.need((self.journal/'qualified.json').exists(),'Unqualified')
        pos=C.position(self.live,self.journal,intent,self.descriptor)
        if not allow_pending:
            if (self.journal/'reversing.json').exists():
                C.need(pos=='before' and (self.journal/'rolled-back.json').exists(),'Pending rollback')
            else:
                C.need(pos=='after' and (self.journal/'installed.json').exists()
                       and (self.journal/'verified.json').exists(),'Pending migration')
        return {'position':pos}

    def pending_status(self,intent_sha):
        self.authority(self.runtime.layout,allow_pending=True)
        return {'ok':True,'stateSha256':self.baseline['stateSha256'],
                'configSha256':self.baseline['configSha256'],'pair':self.baseline['pair'],
                'context':self.baseline['completedContext'],'binding':{},'publicationHealthy':True,
                'retentionComplete':True,'unfinishedIntents':[]}

    def status(self,frame):
        self.authority(self.runtime.layout)
        return {'retentionComplete':True}

    def op(self,action,checkpoint=lambda name:None):
        return C.operate(action,'c'*40,'d'*40,self.ns,self.grant,self.raw,self.new,checkpoint)

    def fail(self,name):
        def checkpoint(observed):
            if observed==name:raise Interrupted(name)
        return checkpoint

    def test_prepare_apply_status_rollback_preserves_original_inode(self):
        self.op('prepare')
        candidate=self.descriptor(self.journal/'capacity')
        with self.assertRaises(ValueError):self.op('status')
        self.op('apply');self.assertEqual(self.descriptor(self.live),candidate)
        self.assertEqual(self.descriptor(self.journal/'capacity'),self.original)
        self.op('status');self.op('apply')
        self.op('rollback');self.assertEqual(self.descriptor(self.live),self.original)
        self.assertEqual(self.descriptor(self.journal/'capacity'),candidate)
        self.op('status');self.op('rollback')
        with self.assertRaises(ValueError):self.op('apply')

    def test_all_preparation_durable_boundaries_resume(self):
        for name in ('journal-parent','journal','approval.json','capacity','intent.json','qualified.json'):
            with self.subTest(boundary=name):
                case=TransactionTests();case.setUp()
                try:
                    with self.assertRaises(Interrupted):case.op('prepare',case.fail(name))
                    with self.assertRaises((ValueError,FileNotFoundError)):case.op('status')
                    case.op('prepare');case.op('apply');case.op('status')
                finally:case.doCleanups()

    def test_all_forward_durable_boundaries_resume(self):
        for name in ('exchange-after','installed.json','preverified-forward.json','verified.json'):
            with self.subTest(boundary=name):
                case=TransactionTests();case.setUp()
                try:
                    case.op('prepare')
                    with self.assertRaises(Interrupted):case.op('apply',case.fail(name))
                    if name!='verified.json':
                        with self.assertRaises(ValueError):case.op('status')
                    case.op('reconcile');case.op('status')
                    self.assertEqual(case.descriptor(case.journal/'capacity'),case.original)
                finally:case.doCleanups()

    def test_all_reverse_durable_boundaries_resume(self):
        for name in ('reversing.json','exchange-before','preverified-rollback.json','rolled-back.json'):
            with self.subTest(boundary=name):
                case=TransactionTests();case.setUp()
                try:
                    case.op('prepare');case.op('apply')
                    with self.assertRaises(Interrupted):case.op('rollback',case.fail(name))
                    if name!='rolled-back.json':
                        with self.assertRaises(ValueError):case.op('status')
                    case.op('rollback');case.op('status')
                    self.assertEqual(case.descriptor(case.live),case.original)
                finally:case.doCleanups()

    def test_exchange_each_directory_fsync_interruption_reconciles(self):
        for fail_at in (1,2):
            with self.subTest(fsync=fail_at):
                case=TransactionTests();case.setUp()
                try:
                    case.op('prepare');calls=[0];original=T.sync_dir
                    def sync(path):
                        original(path);calls[0]+=1
                        if calls[0]==fail_at:raise Interrupted('exchange fsync')
                    with patch.dict(T.exchange.__globals__,{'sync_dir':sync}):
                        with self.assertRaises(Interrupted):case.op('apply')
                    with self.assertRaises(ValueError):case.op('status')
                    case.op('reconcile');case.op('status')
                    self.assertEqual(case.descriptor(case.journal/'capacity'),case.original)
                finally:case.doCleanups()

    def test_anonymous_file_each_fsync_interruption_resumes_prepare(self):
        for fail_at in (1,2):
            with self.subTest(fsync=fail_at):
                case=TransactionTests();case.setUp()
                try:
                    # Stop before candidate publication, then interrupt its inode
                    # fsync or linked-directory fsync. No partial bytes gain a name.
                    with self.assertRaises(Interrupted):case.op('prepare',case.fail('approval.json'))
                    calls=[0];original=os.fsync
                    def sync(fd):
                        original(fd);calls[0]+=1
                        if calls[0]==fail_at:raise Interrupted('candidate fsync')
                    with patch.object(os,'fsync',side_effect=sync):
                        with self.assertRaises(Interrupted):case.op('prepare')
                    if (case.journal/'capacity').exists():
                        self.assertEqual((case.journal/'capacity').read_bytes(),case.new)
                    case.op('prepare');case.op('apply');case.op('status')
                finally:case.doCleanups()

    def test_rollback_above_old_limit_does_not_exchange_or_create_intent(self):
        self.op('prepare');self.op('apply');before=self.descriptor(self.live);self.available=False
        with self.assertRaisesRegex(ValueError,'old 5 GiB'):self.op('rollback')
        self.assertEqual(before,self.descriptor(self.live));self.assertFalse((self.journal/'reversing.json').exists())

    def test_rollback_rechecks_budget_after_durable_intent(self):
        self.op('prepare');self.op('apply');before=self.descriptor(self.live)
        def change(name):
            if name=='reversing.json':self.available=False
        with self.assertRaises(ValueError):self.op('rollback',change)
        self.assertEqual(before,self.descriptor(self.live));self.assertTrue((self.journal/'reversing.json').exists())

    def test_preseal_retry_preserves_first_observation_with_fresh_validation(self):
        self.op('prepare')
        with self.assertRaises(Interrupted):self.op('apply',self.fail('preverified-forward.json'))
        before=(self.journal/'preverified-forward.json').read_bytes()
        original=self.runtime.scratch_migration_status
        with patch.object(self.runtime,'scratch_migration_status',side_effect=lambda pin:dict(original(pin),freeBytes=123)):
            self.op('reconcile')
        self.assertEqual((self.journal/'preverified-forward.json').read_bytes(),before)

    def test_preseal_status_failure_never_leaves_verified_success(self):
        self.op('prepare')
        with patch.object(self.runtime,'scratch_migration_status',side_effect=ValueError('incomplete')):
            with self.assertRaisesRegex(ValueError,'incomplete'):self.op('apply')
        self.assertFalse((self.journal/'verified.json').exists())
        self.assertTrue((self.journal/'verification-failed.json').exists())
        with self.assertRaises(ValueError):self.op('status')
        with self.assertRaisesRegex(ValueError,'explicit rollback'):self.op('reconcile')
        self.op('rollback');self.op('status')

    def test_seal_is_last_fallible_verification_step(self):
        self.op('prepare')
        with patch.object(self.runtime,'status',side_effect=ValueError('normal status unavailable')):
            result=self.op('apply')
            self.assertEqual(result['qualification'],'migration-sealed')
            self.assertTrue(result['normalStatusRequired'])
            with self.assertRaisesRegex(ValueError,'normal status unavailable'):self.op('status')
        self.op('status')

    def test_unknown_inode_same_bytes_refuses(self):
        self.op('prepare');replacement=self.base/'replacement';replacement.write_bytes(self.live.read_bytes())
        replacement.chmod(0o755);os.replace(replacement,self.live)
        with self.assertRaisesRegex(ValueError,'inode position'):self.op('apply')

    def test_mutated_candidate_refuses_before_budget_execution(self):
        self.op('prepare');(self.journal/'capacity').write_bytes(b'foreign executable')
        prior=len(self.checks)
        with self.assertRaises(ValueError):self.op('apply')
        self.assertEqual(prior,len(self.checks))

    def test_conflicting_qualification_refuses(self):
        self.op('prepare');(self.journal/'qualified.json').write_text('{}')
        with self.assertRaisesRegex(ValueError,'Conflicting'):self.op('apply')
        self.assertEqual(self.original,self.descriptor(self.live))

    def test_baseline_change_refuses_but_status_allows_later_publication(self):
        self.op('prepare');self.op('apply');self.baseline['context']['value']=2
        self.op('status')
        with self.assertRaisesRegex(ValueError,'baseline'):self.op('rollback')

    def test_foreign_entry_and_symlink_refuse(self):
        self.op('prepare');(self.journal/'foreign').write_text('x')
        with self.assertRaisesRegex(ValueError,'Foreign'):self.op('apply')
        (self.journal/'foreign').unlink();(self.journal/'capacity').unlink()
        (self.journal/'capacity').symlink_to(self.live)
        with self.assertRaises(ValueError):self.op('apply')

    def test_prepare_crash_then_rollback_requires_qualification(self):
        with self.assertRaises(Interrupted):self.op('prepare',self.fail('intent.json'))
        with self.assertRaisesRegex(ValueError,'qualification'):self.op('rollback')
        self.op('prepare');self.op('rollback');self.assertEqual(self.original,self.descriptor(self.live))


class CommittedSourceTests(unittest.TestCase):
    def test_real_git_blob_and_canonical_path_fences(self):
        with tempfile.TemporaryDirectory(prefix='scratch-git-') as td:
            root=Path(td);file=root/'candidate.py';file.write_text('value = 1\n')
            env=dict(C.ENV)
            def git(*args):
                return subprocess.check_output(['/usr/bin/git','-C',str(root),*args],env=env,stderr=subprocess.PIPE)
            git('init','--quiet');git('add','candidate.py')
            git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid',
                '-c','commit.gpgsign=false','commit','--quiet','-m','Pinned synthetic source')
            commit=git('rev-parse','HEAD').decode().strip()
            with patch.object(C,'ROOT',root):
                self.assertEqual(C.committed(commit,'candidate.py'),b'value = 1\n')
                file.write_text('value = 2\n')
                with self.assertRaisesRegex(ValueError,'Uncommitted'):C.committed(commit,'candidate.py')
                self.assertTrue(C.git('status','--porcelain','--untracked-files=all'))
                file.unlink();other=root/'other.py';other.write_text('value = 1\n');file.symlink_to(other)
                with self.assertRaisesRegex(ValueError,'Uncommitted'):C.committed(commit,'candidate.py')


class BudgetTests(unittest.TestCase):
    def test_old_limit_exact_and_one_byte_refusal(self):
        with tempfile.TemporaryDirectory(prefix='scratch-budget-') as td:
            path=Path(td);grant={'priorScratchBytes':5*1024**3}
            actual=C.Path
            def scoped(name):
                self.assertEqual(name,'/var/tmp/proofofwork-deploy');return path
            for amount,allowed in ((5*1024**3,True),(5*1024**3+1,False)):
                with patch.object(C,'Path',side_effect=scoped), patch.object(C.subprocess,'check_output',
                        return_value=(str(amount)+'	'+str(path)+chr(10)).encode()) as measure:
                    if allowed:C.rollback_budget(grant)
                    else:
                        with self.assertRaisesRegex(ValueError,'old 5 GiB'):C.rollback_budget(grant)
                    self.assertIn('--one-file-system',measure.call_args.args[0])
                    self.assertIn('--block-size=1',measure.call_args.args[0])


@unittest.skipUnless(os.geteuid()==0 and os.environ.get('POW_SCRATCH_ROOT_INTEGRATION')=='1',
                     'Requires separately reviewed private root filesystem sandbox')
class RootIntegrationTests(unittest.TestCase):
    def physical_historical_floor(self,A,case,cap,previous):
        """Seed exact synthetic historical receipts with real preserved inode positions.

        This tests the unchanged historical validator, not execution of its old
        production-specific installer or provenance of any production receipt.
        """
        journal=case.fixture.base/'historical-floor-journal';journal.mkdir(mode=0o700)
        receiver=case.fixture.base/'historical-floor-receiver'
        old_capacity=previous.replace(b'ROOT_RESERVE_BYTES = 8 * 1024**3',
                                      b'ROOT_RESERVE_BYTES = 10 * 1024**3')
        self.assertNotEqual(old_capacity,previous)
        cap.write_bytes(old_capacity);cap.chmod(0o755)
        receiver.write_bytes(b'original synthetic receiver\n');receiver.chmod(0o600)
        tools=SimpleNamespace(**runpy.run_path(str(HERE.parents[1]/'deploy/ui-stream-tools/installer.py')))
        files={'capacity':(cap,old_capacity,previous),
               'receiver':(receiver,receiver.read_bytes(),b'current synthetic receiver\n')}
        descriptors={}
        for name,(live,old,new) in files.items():
            before=A.L.floor_descriptor(live)
            tools.successor_create(journal/name,new,stat.S_IMODE(live.stat().st_mode))
            descriptors[name]={'before':before,'after':A.L.floor_descriptor(journal/name)}
        grant={'priorRootReserveBytes':10*1024**3,'rootReserveBytes':8*1024**3,
               'growthReserveBytes':64*1024**2,'targets':{str(live):{'before':sha(old),'after':sha(new)}
                for live,old,new in files.values()}}
        raw=A.L.encoded(grant);approval=sha(raw)
        tools.successor_create(journal/'approval.json',raw,0o600)
        intent={'schema':'pow-ui-capacity-floor-intent-v1','approvalSha256':approval,
                'commit':'a'*40,'tree':'b'*40,'files':descriptors,
                'protected':{'scope':'synthetic physical historical floor; no production provenance'}}
        tools.successor_record(journal/'intent.json',intent)
        intent_sha=sha((journal/'intent.json').read_bytes())
        qualified={'schema':'pow-ui-capacity-floor-qualified-v1','intentSha256':intent_sha,
                   'authoritySha256':approval,'protected':intent['protected']}
        tools.successor_record(journal/'qualified.json',qualified)
        for name,(live,old,new) in files.items():tools.exchange(live,journal/name)
        tools.successor_record(journal/'installed.json',{'schema':'pow-ui-capacity-floor-installed-v1',
            'intentSha256':intent_sha,'qualificationSha256':sha((journal/'qualified.json').read_bytes()),
            'protected':intent['protected']})
        # Pin only namespace and fixture byte identities before all real Git package
        # creation. The original authority function and every check are unchanged.
        source=A.SOURCE_ROOT/'deploy/ui-retention/lifecycle_remote.py'
        with source.open('a') as out:
            out.write('\n# Physical historical floor fixture namespace and exact pins.\n')
            out.write('FLOOR_DIRECTORY=Path('+repr(str(journal))+')\n')
            out.write('FLOOR_APPROVAL='+repr(approval)+'\n')
            out.write('FLOOR_FILES={'+','.join(repr(name)+':(Path('+repr(str(live))+'),'+
                repr(sha(old))+','+repr(sha(new))+')' for name,(live,old,new) in files.items())+'}\n')
        snapshots={str(path):A.L.floor_descriptor(path) for path in journal.iterdir()}
        snapshots[str(receiver)]=A.L.floor_descriptor(receiver)
        return journal,receiver,snapshots

    def test_real_bridge_runtime_lock_and_installer_transaction(self):
        """Real authority/bridge/status; only protected namespace and exact fixture pins change."""
        def load(name,path):
            spec=importlib.util.spec_from_file_location(name,path)
            module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module
        root=HERE.parents[1]
        A=load('scratch_joint_authority_foundation',root/'deploy/ui-retention/check-retirement-authority-integration.test.py')
        case=A.AuthorityIntegration();case.setUp()
        try:
            # Start with the actual previous 5 GiB helper, in the private fixture namespace.
            cap=case.layout.capacity
            previous=cap.read_bytes().replace(b'MAX_DEPLOY_SCRATCH_BYTES = 11 * 1024**3 // 2',
                                              b'MAX_DEPLOY_SCRATCH_BYTES = 5 * 1024**3')
            self.assertNotEqual(previous,cap.read_bytes());cap.write_bytes(previous);cap.chmod(0o755)
            floor_journal,floor_receiver,floor_snapshot=self.physical_historical_floor(A,case,cap,previous)
            foundation=case.authority_foundation()
            retired=case.retire_fixture(foundation)
            terminal=case.upgrade_retired_fixture(retired)
            floor_witness=terminal['status']['verifiedCapacityFloor']
            self.assertEqual(floor_witness['rootReserveBytes'],8*1024**3)
            self.assertEqual(floor_witness['growthReserveBytes'],64*1024**2)
            old_package=Path(terminal['package']['path'])
            old_manifest=json.loads((old_package/'package.json').read_bytes())
            config_path=Path(terminal['status']['binding']['config']['path'])
            state_path=Path(terminal['status']['binding']['state']['path'])
            old_config_raw=config_path.read_bytes();old_state_raw=state_path.read_bytes()
            old_state=json.loads(old_state_raw)
            # Native grant values are substituted explicitly, never validator decisions.
            grant=json.loads((root/C.GRANT).read_bytes())
            candidate=previous.replace(b'MAX_DEPLOY_SCRATCH_BYTES = 5 * 1024**3',
                                       b'MAX_DEPLOY_SCRATCH_BYTES = 11 * 1024**3 // 2')
            grant['target'].update(path=str(cap),beforeSha256=sha(previous),afterSha256=sha(candidate))
            grant['preBridge']={'configSha256':sha(old_config_raw),'stateSha256':sha(old_state_raw),
                'stateRevision':old_state['revision'],'packageManifestSha256':terminal['package']['sha256'],
                'pair':terminal['status']['pair']}
            grant_raw=A.L.encoded(grant);grant_sha=sha(grant_raw)
            journal=case.fixture.base/'var/lib/proofofwork-ui-scratch-capacity'/grant_sha
            source=case.fixture.base/'scratch-bridge-source';source.mkdir(mode=0o700)
            for name in old_manifest['files']:
                raw=(old_package/name).read_bytes()
                if name=='deploy/ui-retention/lifecycle_remote.py':
                    raw+=('\n# Exact protected scratch fixture pins, no acceptance overrides.\n'
                        +'SCRATCH_APPROVAL='+repr(grant_sha)+'\n'
                        +'SCRATCH_DIRECTORY=Path('+repr(str(journal))+')\n'
                        +'SCRATCH_CAPACITY_PATH=Path('+repr(str(cap))+')\n'
                        +'SCRATCH_PRIOR_SHA='+repr(sha(previous))+'\n'
                        +'SCRATCH_NEXT_SHA='+repr(sha(candidate))+'\n').encode()
                path=source/name;path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(raw)
            extra={C.GRANT:grant_raw,'deploy/proofofwork-ui-capacity.py':candidate,
                'deploy/ui-scratch-capacity/installer.py':(HERE/'installer.py').read_bytes().replace(
                    b"Path('/var/tmp/proofofwork-deploy')",('Path('+repr(str(case.layout.scratch))+')').encode())}
            for name,raw in extra.items():
                path=source/name;path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(raw)
            git=['/usr/bin/git','-c','core.hooksPath=/dev/null','-C',str(source)]
            env=dict(C.ENV,GIT_AUTHOR_NAME='Fixture',GIT_AUTHOR_EMAIL='fixture@example.invalid',
                     GIT_COMMITTER_NAME='Fixture',GIT_COMMITTER_EMAIL='fixture@example.invalid')
            for args in (['init','-q'],['add','.'],['commit','-qm','Synthetic exact scratch bridge']):
                subprocess.run(git+args,env=env,check=True,capture_output=True)
            I=load('scratch_joint_actual_installer',source/'deploy/ui-retention/install_lifecycle.py')
            request={'mode':'completed-cycle','configSha256':sha(old_config_raw),'stateSha256':sha(old_state_raw)}
            before=I.upgrade_inventory(request)
            payload=I.preserve_retirement(I.committed_payload(source),before)
            plan={'schema':'pow-ui-retention-upgrade-plan-v1','scopeApprovalSha256':I.APPROVAL,
                  'payload':payload,'request':request,'before':before}
            completion=I.upgrade_remote(plan)
            verification=completion['normalStatusVerification']
            self.assertTrue(json.loads(I.read_bound(verification['path'],verification['sha256']))['ok'])
            package=Path(payload['config']['package']['path'])
            R=load('scratch_joint_actual_runtime',package/'deploy/ui-retention/lifecycle_remote.py')
            N=load('scratch_joint_actual_migration',source/'deploy/ui-scratch-capacity/installer.py')
            native_tools=SimpleNamespace(**runpy.run_path(str(root/'deploy/ui-stream-tools/installer.py')))
            ns={'tools':native_tools,'old':I,'floor':R,'manifest':payload['manifest']}
            commit,tree=payload['manifest']['sourceCommit'],payload['manifest']['sourceTree']
            def op(action):return N.operate(action,commit,tree,ns,grant,grant_raw,candidate)
            original=R.floor_descriptor(cap)
            prepared=op('prepare');intent_sha=prepared['intentSha256']
            runtime=I.existing_runtime(completion['config']['sha256'])
            with self.assertRaises((ValueError,OSError,TypeError)):
                runtime.scratch_migration_status(intent_sha)
            with self.assertRaises(ValueError):runtime.status({'requireComplete':True})
            with self.assertRaises(ValueError):runtime.dispatch('scratch-migration-status',{'intentSha256':intent_sha})
            fd=runtime.S.lock(runtime.layout);runtime.lock_fd=fd
            try:
                with self.assertRaises(ValueError):runtime.scratch_migration_status('0'*64)
                pending=runtime.scratch_migration_status(intent_sha)
                self.assertTrue(pending['retentionComplete']);self.assertNotIn('verifiedScratchCapacity',pending)
            finally:runtime.lock_fd=None;os.close(fd)
            applied=op('apply');self.assertEqual(applied['qualification'],'migration-sealed')
            self.assertEqual(R.floor_descriptor(journal/'capacity'),original)
            installed_status=op('status')['status']
            self.assertTrue(installed_status['retentionComplete'])
            self.assertEqual(installed_status['stateSha256'],completion['state']['sha256'])
            self.assertIn('verifiedScratchCapacity',installed_status)
            self.assertEqual(installed_status['verifiedCapacityFloor'],floor_witness)
            self.assertEqual({path:R.floor_descriptor(Path(path)) for path in floor_snapshot},floor_snapshot)
            # Same bytes at a substituted inode, a symlinked displaced path, a
            # receiver replacement and a forged historical receipt must all refuse.
            def rejects_substitution(path,raw,symlink=False):
                saved=case.fixture.base/('saved-negative-'+path.name)
                self.assertFalse(saved.exists());path.rename(saved)
                try:
                    if symlink:path.symlink_to(saved)
                    else:
                        path.write_bytes(raw);path.chmod(stat.S_IMODE(saved.stat().st_mode))
                    with self.assertRaises((ValueError,OSError)):op('status')
                finally:
                    path.unlink();saved.rename(path)
                self.assertEqual(op('status')['status']['verifiedCapacityFloor'],floor_witness)
            rejects_substitution(journal/'capacity',(journal/'capacity').read_bytes())
            rejects_substitution(journal/'capacity',b'',symlink=True)
            rejects_substitution(floor_receiver,floor_receiver.read_bytes())
            forged=json.loads((floor_journal/'qualified.json').read_bytes());forged['authoritySha256']='0'*64
            rejects_substitution(floor_journal/'qualified.json',R.encoded(forged))
            self.assertEqual({path:R.floor_descriptor(Path(path)) for path in floor_snapshot},floor_snapshot)
            self.assertEqual(installed_status['verifiedRetiredPayloads'],terminal['status']['verifiedRetiredPayloads'])
            rolled=op('rollback');self.assertEqual(rolled['qualification'],'migration-sealed')
            self.assertEqual(R.floor_descriptor(cap),original)
            restored=op('status')['status'];self.assertNotIn('verifiedScratchCapacity',restored)
            self.assertEqual(restored['stateSha256'],completion['state']['sha256'])
            self.assertEqual(restored['verifiedCapacityFloor'],floor_witness)
            self.assertEqual({path:R.floor_descriptor(Path(path)) for path in floor_snapshot},floor_snapshot)
            self.assertEqual(config_path.read_bytes(),I.encoded(payload['config']))
            print('REAL_SCRATCH_BRIDGE_INTEGRATION_PASSED '+json.dumps({'actualBridge':True,
                'actualProtectedBaseline':True,'actualHeldLock':True,'actualPendingStatus':True,
                'actualNativeCapacity':True,'actualAtomicExchange':True,'actualNormalStatus':True,
                'restoredOriginalInode':True,'productionActions':False}),flush=True)
            print('REAL_SCRATCH_FLOOR_CHAIN_INTEGRATION_PASSED '+json.dumps({
                'originalFloorValidatorActive':True,'floorWitnessUnchanged':True,
                'historicalJournalAndReceiverIdentitiesUnchanged':True,'displacedInodeRestored':True,
                'substitutedInodePathReceiverAndReceiptRefused':True,'productionActions':False,
                'historicalInstallerExecutionClaimed':False}),flush=True)
        finally:
            case.tearDown();case.doCleanups()


if __name__=='__main__':unittest.main()
