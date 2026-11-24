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
import io
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
spec = importlib.util.spec_from_file_location('scratch_successor_installer_test', HERE/'successor_installer.py')
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
        self.grant = {'priorScratchBytes':11*1024**3//2,'scratchBytes':6*1024**3,
                      'predecessorAuthority':{'approvalSha256':'a'*64,'installedSha256':'b'*64}}
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
        self.floor._scratch_capacity_position_original=self.predecessor
        self.successor=SimpleNamespace(DIRECTORY=self.journal,APPROVAL=sha(self.raw),
            PRIOR_SHA=sha(self.live.read_bytes()),NEXT_SHA=sha(self.new),
            verify_position=lambda layout,runtime,**kwargs:self.authority(layout,**kwargs))
        self.predecessor_available=True
        self.historical=self.base/'historical.json';self.historical.write_bytes(b'unchanged historical journal\n')
        self.history_before=self.historical.read_bytes()
        self.runtime=SimpleNamespace(layout=SimpleNamespace(evidence=self.base,capacity=self.live),
            S=SimpleNamespace(lock=lambda layout:os.open(self.base,os.O_RDONLY|os.O_DIRECTORY),
                              require_execution_lock=lambda fd,layout:os.fstat(fd)),
            status=self.status,scratch_migration_status=self.pending_status,lock_fd=None)
        self.old=SimpleNamespace(CONFIG=self.live,read_bound=lambda p:Path(p).read_bytes(),
            existing_runtime=lambda digest:self.runtime)
        self.ns={'tools':self.tools,'old':self.old,'floor':self.floor,'successor':self.successor}
        self.stack.enter_context(patch.object(C,'protected',side_effect=lambda *args:copy.deepcopy(self.baseline)))
        self.stack.enter_context(patch.object(C,'native_budget',side_effect=lambda *args:self.checks.append('budget')))
        self.stack.enter_context(patch.object(C,'rollback_budget',side_effect=self.rollback_check))
        self.original=self.descriptor(self.live)

    def rollback_check(self,grant):
        C.need(self.available,'Rollback refuses scratch above the prior ceiling')
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

    def predecessor(self,layout,*,capacity_descriptor):
        C.need(self.predecessor_available,'Historical predecessor invalid')
        C.need(capacity_descriptor==self.original,'Unbound historical predecessor')
        self.assertEqual(self.historical.read_bytes(),self.history_before)
        self.checks.append('original-scratch')
        return {'position':'after','priorCapacity':{'fixture':'floor-predecessor'}}

    def status(self,frame,*,scratch_successor_pending_intent=None):
        if scratch_successor_pending_intent is not None:
            return self.runtime.scratch_migration_status(scratch_successor_pending_intent)
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
        with self.assertRaisesRegex(ValueError,'prior ceiling'):self.op('rollback')
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
        normal=self.runtime.status
        def only_normal_fails(frame,**kwargs):
            if kwargs:return normal(frame,**kwargs)
            raise ValueError('normal status unavailable')
        with patch.object(self.runtime,'status',side_effect=only_normal_fails):
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

    def test_historical_predecessor_failure_prevents_exchange(self):
        self.op('prepare');self.predecessor_available=False
        with self.assertRaisesRegex(ValueError,'Historical predecessor invalid'):self.op('apply')
        self.assertEqual(self.descriptor(self.live),self.original)
        self.assertEqual(self.historical.read_bytes(),self.history_before)

    def test_history_preserved_through_prepare_apply_reconcile_rollback(self):
        for action in ('prepare','apply','reconcile','rollback'):
            self.op(action)
            self.assertEqual(self.historical.read_bytes(),self.history_before)



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
            path=Path(td);grant={'priorScratchBytes':11*1024**3//2}
            actual=C.Path
            def scoped(name):
                self.assertEqual(name,'/var/tmp/proofofwork-deploy');return path
            for amount,allowed in ((11*1024**3//2,True),(11*1024**3//2+1,False)):
                with patch.object(C,'Path',side_effect=scoped), patch.object(C.subprocess,'check_output',
                        return_value=(str(amount)+'	'+str(path)+chr(10)).encode()) as measure:
                    if allowed:C.rollback_budget(grant)
                    else:
                        with self.assertRaisesRegex(ValueError,'prior ceiling'):C.rollback_budget(grant)
                    self.assertIn('--one-file-system',measure.call_args.args[0])
                    self.assertIn('--block-size=1',measure.call_args.args[0])




class InstalledCliTests(unittest.TestCase):
    def test_installed_branch_uses_manifest_tree_without_git(self):
        ns={'manifest':{'sourceTree':'b'*40}}
        with patch.object(C.sys,'argv',['successor_installer.py','prepare','a'*40,'--installed']), \
             patch.object(C,'installed_inputs',return_value=(ns,{},b'grant',b'candidate')) as installed, \
             patch.object(C,'inputs') as source, patch.object(C,'git') as git, \
             patch.object(C,'operate',return_value={'ok':True}) as operate, \
             patch.object(C.os,'umask'),contextlib.redirect_stdout(io.StringIO()):
            C.main()
        installed.assert_called_once_with('a'*40, amo=False, catchup=False);source.assert_not_called();git.assert_not_called()
        operate.assert_called_once_with('prepare','a'*40,'b'*40,ns,{},b'grant',b'candidate')

    def test_installed_amo_cli_uses_only_the_selected_grant(self):
        ns = {'manifest': {'sourceTree': 'b'*40}}
        with patch.object(C.sys, 'argv', ['successor_installer.py', 'status', 'a'*40, '--installed', '--amo']), \
             patch.object(C, 'installed_inputs', return_value=(ns, {}, b'scope', b'candidate')) as installed, \
             patch.object(C, 'inputs') as source, patch.object(C, 'git') as git, \
             patch.object(C, 'operate', return_value={'ok':True}), \
             patch.object(C.os, 'umask'), contextlib.redirect_stdout(io.StringIO()):
            C.main()
        installed.assert_called_once_with('a'*40, amo=True, catchup=False)
        source.assert_not_called()
        git.assert_not_called()

    def test_installed_catchup_only_selects_pinned_new_scope(self):
        ns = {'manifest': {'sourceTree': 'b'*40}}
        with patch.object(C.sys, 'argv', ['successor_installer.py','status','a'*40,'--installed','--amo-catchup']), \
             patch.object(C, 'installed_inputs', return_value=(ns,{},b'grant',b'native')) as loader, \
             patch.object(C, 'operate', return_value={'ok':True}), patch.object(C.os, 'umask'), \
             contextlib.redirect_stdout(io.StringIO()):
            C.main()
        loader.assert_called_once_with('a'*40, amo=False, catchup=True)
        self.assertEqual(C.scope_and_authority(False,True),(C.CATCHUP_SCOPE,C.AMO_SUCCESSOR))
        with self.assertRaisesRegex(ValueError,'Select one'):
            C.scope_and_authority(True,True)


class InstalledInputTests(unittest.TestCase):
    """Actual byte readers; installed runtime authentication is a synthetic boundary."""
    def setUp(self):
        self.stack=contextlib.ExitStack();self.addCleanup(self.stack.close)
        self.root=Path(self.stack.enter_context(tempfile.TemporaryDirectory(prefix='successor-installed-')))
        self.commit='a'*40
        self.grant={'target':{'path':'/fixture/capacity','source':'deploy/proofofwork-ui-capacity.py','beforeSha256':'b'*64}}
        self.raw=(json.dumps(self.grant)+'\n').encode();self.candidate=b'LIMIT = 6\n'
        files={C.TOOLS:b'# tools\n',C.INSTALL:b'# installer\n',C.REMOTE:b'# runtime\n',
               C.SUCCESSOR:b'# successor\n',C.GRANT:self.raw,
               'deploy/proofofwork-ui-capacity.py':self.candidate}
        self.manifest={'sourceCommit':self.commit,'sourceTree':'c'*40,'files':{}}
        for relative,raw in files.items():
            target=self.root/relative;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(raw);target.chmod(0o600)
            self.manifest['files'][relative]={'sha256':sha(raw),'bytes':len(raw)}
        manifest_raw=(json.dumps(self.manifest)+'\n').encode()
        (self.root/'package.json').write_bytes(manifest_raw);(self.root/'package.json').chmod(0o600)
        self.config={'package':{'path':str(self.root),'sha256':sha(manifest_raw)},'sourceCommit':self.commit}
        spec=importlib.util.spec_from_file_location('installed_reader',HERE.parent/'ui-retention/lifecycle_remote.py')
        reader=importlib.util.module_from_spec(spec);spec.loader.exec_module(reader)
        self.runtime=SimpleNamespace(config=self.config)
        self.floor=SimpleNamespace(installed_runtime=lambda *args:self.runtime,read=reader.read,read_json=reader.read_json,
                                   PACKAGE_FILES=tuple(files),SCRATCH_CAPACITY_PATH=Path('/fixture/capacity'))
        self.old=SimpleNamespace(CONFIG=Path('/fixture/config'),read_bound=lambda path:b'{}')
        self.successor=SimpleNamespace(APPROVAL=sha(self.raw),NEXT_SHA=sha(self.candidate),PRIOR_SHA='b'*64)
        objects={C.TOOLS:{},C.INSTALL:vars(self.old),C.REMOTE:vars(self.floor),C.SUCCESSOR:vars(self.successor)}
        self.host=self.stack.enter_context(patch.object(C.subprocess,'check_output',return_value=b'[{"addr_info":[{"local":"77.42.91.106"}]}]'))
        self.stack.enter_context(patch.object(C,'ROOT',self.root))
        self.stack.enter_context(patch.object(C,'os',SimpleNamespace(geteuid=lambda:0,getegid=lambda:0)))
        self.stack.enter_context(patch.object(C,'sys',SimpleNamespace(flags=SimpleNamespace(isolated=True,optimize=0))))
        self.stack.enter_context(patch.object(C.runpy,'run_path',side_effect=lambda path:objects[str(Path(path).relative_to(self.root))]))
    def test_wrong_host_refused(self):
        self.host.return_value=b'[]'
        with self.assertRaises(ValueError):C.installed_inputs(self.commit)
    def test_success_authenticated_package_bytes(self):
        ns,grant,raw,candidate=C.installed_inputs(self.commit)
        self.assertEqual(ns['manifest'],self.manifest);self.assertEqual(grant,self.grant)
        self.assertEqual(raw,self.raw);self.assertEqual(candidate,self.candidate)
    def test_wrong_path_and_commit_refused(self):
        self.config['package']['path']=str(self.root/'other')
        with self.assertRaisesRegex(ValueError,'active exact'):C.installed_inputs(self.commit)
        self.config['package']['path']=str(self.root)
        with self.assertRaisesRegex(ValueError,'active exact'):C.installed_inputs('d'*40)
    def test_tampered_each_manifest_file_refused(self):
        for relative in self.manifest['files']:
            path=self.root/relative;before=path.read_bytes();path.write_bytes(before+b'changed')
            with self.subTest(relative=relative),self.assertRaises(ValueError):C.installed_inputs(self.commit)
            path.write_bytes(before)
    def test_manifest_digest_refused(self):
        (self.root/'package.json').write_bytes(b'{}')
        with self.assertRaises(ValueError):C.installed_inputs(self.commit)
    def test_runtime_verification_failure_propagates(self):
        self.floor.installed_runtime=lambda *args:(_ for _ in ()).throw(ValueError('invalid installed runtime'))
        with self.assertRaisesRegex(ValueError,'invalid installed runtime'):C.installed_inputs(self.commit)

class AmoTransactionTests(unittest.TestCase):
    catchup = False

    def setUp(self):
        case = TransactionTests()
        case.setUp()
        self.addCleanup(case.doCleanups)
        self.case = case
        scope, authority = C.scope_and_authority(not self.catchup,self.catchup)
        scope = (C.ROOT / scope).read_bytes()
        selected = C.load_modules(authority,not self.catchup,self.catchup)['successor']
        self.assertEqual(sha(scope), selected.APPROVAL)
        case.grant = json.loads(scope)
        case.raw = scope
        current = (C.ROOT / case.grant['target']['source']).read_bytes()
        seven = current.replace(b'MAX_DEPLOY_SCRATCH_BYTES = 15 * 1024**3 // 2', b'MAX_DEPLOY_SCRATCH_BYTES = 7 * 1024**3')
        if self.catchup:
            old, case.new = seven, current
        else:
            old, case.new = seven.replace(b'MAX_DEPLOY_SCRATCH_BYTES = 7 *', b'MAX_DEPLOY_SCRATCH_BYTES = 6 *'), seven
        case.live.write_bytes(old)
        case.original = case.descriptor(case.live)
        case.ns['amo'] = True
        case.ns['catchup'] = self.catchup
        case.successor.APPROVAL = selected.APPROVAL
        case.successor.PRIOR_SHA = selected.PRIOR_SHA
        case.successor.NEXT_SHA = selected.NEXT_SHA
        self.assertEqual(sha(old), case.successor.PRIOR_SHA)
        self.assertEqual(sha(case.new), case.successor.NEXT_SHA)
        case.successor.verify_predecessor = lambda layout, floor, capacity_descriptor: case.predecessor(
            layout, capacity_descriptor=capacity_descriptor)
        def status(frame, **pending):
            if pending:
                expected = 'amo_catchup_scratch_pending_intent' if self.catchup else 'amo_scratch_pending_intent'
                self.assertEqual(set(pending), {expected})
                return case.runtime.scratch_migration_status(pending[expected])
            return case.status(frame)
        case.runtime.status = status
        # Native capacity commands are simulated here; inode exchanges and journal operations are real.
        self.exchange_budget = case.stack.enter_context(patch.object(C, 'exchange_budget'))
        self.native_budget = C.native_budget
        self.sentinels = []
        for kind in ('live', 'rollback', '56da-stage', '31d-stage', 'archive', 'surface-receipt', 'source-receipt'):
            p = case.base / ('retained-' + kind)
            p.write_bytes(('retained ' + kind).encode())
            p.chmod(0o600)
            self.sentinels.append((p, case.descriptor(p)))

    def test_amo_install_retry_reverse_and_preserve(self):
        case = self.case
        case.op('prepare')
        with self.assertRaises(Interrupted):
            case.op('apply', case.fail('exchange-after'))
        case.op('reconcile')
        self.assertEqual(case.descriptor(case.live)['sha256'], case.successor.NEXT_SHA)
        self.assertEqual(case.op('status')['authority']['position'], 'after')
        case.available = False
        with self.assertRaises(ValueError): case.op('rollback')
        self.assertFalse((case.journal / 'reversing.json').exists())
        case.available = True
        case.op('rollback')
        self.assertEqual(case.descriptor(case.live), case.original)
        self.assertEqual(case.op('status')['authority']['position'], 'before')
        with self.assertRaisesRegex(ValueError, 'Reversal already'): case.op('apply')
        for path, descriptor in self.sentinels:
            self.assertEqual(case.descriptor(path), descriptor)

    def test_retry_after_exchange_rechecks_current_occupancy(self):
        case = self.case
        case.op('prepare')
        with self.assertRaises(Interrupted):
            case.op('apply', case.fail('exchange-after'))
        self.exchange_budget.side_effect = ValueError('Capacity changed after exchange')
        with self.assertRaisesRegex(ValueError, 'Capacity changed'): case.op('reconcile')
        self.assertFalse((case.journal/'installed.json').exists())
        self.assertFalse((case.journal/'verified.json').exists())
        self.exchange_budget.side_effect = None
        case.op('reconcile')
        self.assertEqual(case.op('status')['authority']['position'], 'after')

    def test_amo_digest_and_predecessor_refused_before_exchange(self):
        case = self.case
        case.op('prepare')
        case.predecessor_available = False
        with self.assertRaisesRegex(ValueError, 'Historical predecessor'): case.op('apply')
        self.assertEqual(case.descriptor(case.live), case.original)
        case.predecessor_available = True
        case.new += b'# changed code\n'
        with self.assertRaisesRegex(ValueError, 'Unapproved migration input'): case.op('apply')
        # Even an internally matching new digest must not legitimize a second source edit.
        altered = copy.deepcopy(case.grant)
        altered['target']['afterSha256'] = sha(case.new)
        with self.assertRaisesRegex(ValueError, 'outside the approved ceiling'): C.check_amo_helper(case.new, altered, catchup=self.catchup)

    def test_amo_free_space_failure_precedes_exchange_or_reversal_intent(self):
        case = self.case
        case.op('prepare')
        self.exchange_budget.side_effect = ValueError('Physical floor')
        with self.assertRaisesRegex(ValueError, 'Physical floor'): case.op('apply')
        self.assertEqual(case.descriptor(case.live), case.original)
        self.assertFalse((case.journal / 'installed.json').exists())
        self.exchange_budget.side_effect = None
        case.op('apply')
        self.native_budget.side_effect = ValueError('Physical floor')
        with self.assertRaisesRegex(ValueError, 'Physical floor'): case.op('rollback')
        self.assertFalse((case.journal / 'reversing.json').exists())
        self.assertEqual(case.descriptor(case.live)['sha256'], case.successor.NEXT_SHA)

    def test_exchange_budget_invokes_physical_guard_before_scratch(self):
        # Exercise the production budget order against explicit synthetic native output.
        case = self.case
        pins = case.grant['unchangedLimits']
        native = {'rootReserveBytes': pins['rootReserveBytes'], 'growthReserveBytes': pins['growthReserveBytes']}
        capacity = {'status': 'sufficient', 'allocatedBytes': case.grant['scratchBytes'],
                    'maximumBytes': case.grant['scratchBytes'], 'additionalBytes': 0, 'cleanupApproved': False}
        real = runpy.run_path(str(HERE/'successor_installer.py'))
        def frozen(replies):
            return patch.object(subprocess, 'check_output', side_effect=[json.dumps(v).encode() for v in replies])
        with frozen([native, capacity]) as command:
            real['exchange_budget'](case.live, case.base, case.grant)
            self.assertEqual([call.args[0][4] for call in command.call_args_list], ['check', 'check-scratch'])
        with frozen([dict(native, growthReserveBytes=0)]) as command:
            with self.assertRaisesRegex(ValueError, 'reserve differs'):
                real['exchange_budget'](case.live, case.base, case.grant)
            command.assert_called_once()
        with frozen([native, dict(capacity, allocatedBytes=case.grant['scratchBytes']+1)]):
            with self.assertRaisesRegex(ValueError, 'scratch admission differs'):
                real['exchange_budget'](case.live, case.base, case.grant)


class CatchupTransactionTests(AmoTransactionTests):
    # Run the same exchange, crash boundaries, refusal and preservation tests for the third edge.
    catchup = True

    def test_unrecovered_active_bridge_refused_before_first_journal(self):
        case=self.case
        fresh=runpy.run_path(str(HERE/'successor_installer.py'))['protected']
        old=SimpleNamespace(CONFIG='config',read_bound=lambda path,digest:b'{}')
        floor=SimpleNamespace(scratch_bridge_predecessor=lambda grant,state:(grant['preBridge'],None))
        runtime=SimpleNamespace(config_sha='a'*64,state_path='state',state=lambda:({'lastUpgrade':{}},'b'*64))
        with self.assertRaisesRegex(ValueError,'separately verified revision 341 recovery'):
            fresh(runtime,case.grant,'c'*40,'d'*40,dict(old=old,floor=floor,catchup=True))
        self.assertFalse(case.journal.exists())

    def test_7_gib_reversal_boundary(self):
        prior = 7 * 1024**3
        path = self.case.base
        rollback_budget = runpy.run_path(str(HERE/'successor_installer.py'))['rollback_budget']
        for amount, permitted in [(prior, True), (prior + 1, False)]:
            with self.subTest(amount=amount), patch.dict(rollback_budget.__globals__,{'Path': lambda _: path}), patch.object(
                    subprocess,'check_output',return_value=f'{amount}\t{path}\n'.encode()):
                if permitted:
                    rollback_budget(self.case.grant)
                else:
                    with self.assertRaisesRegex(ValueError,'prior ceiling'):
                        rollback_budget(self.case.grant)

    def test_wrong_edge_refused_even_for_untampered_bytes(self):
        with self.assertRaisesRegex(ValueError, 'outside the approved ceiling'):
            C.check_amo_helper(self.case.new,self.case.grant,catchup=False)


if __name__=='__main__':unittest.main()
