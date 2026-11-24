#!/usr/bin/env python3
"""Synthetic 341 writer integration with real pinned-file IO, flock and paired exchanges.

The failed on-host history, protected directories, capacity and native status
observations are injected. Every writable path belongs to one disposable root.
"""
import ast
import base64
import contextlib
import copy
import functools
import importlib.util
import io
import json
import os
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch


def module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


HERE = Path(__file__).resolve().parent
W = module('fixture_reconcile_341', HERE / 'reconcile_completed_341.py')
E = module('fixture_exchange_341', HERE / 'recovery_exchange.py')
I = module('fixture_installer_341', HERE / 'install_lifecycle.py')
R = module('fixture_341_authority', HERE / 'amo_341_recovery.py')
S = module('fixture_341_storage', HERE.parent / 'audit30/ui-storage.py')
STORAGE = 'deploy/audit30/ui-storage.py'
B64 = lambda raw: base64.b64encode(raw).decode()
ENC = W.encode
SHA = W.sha


class Receiver:
    def __init__(self, case, root):
        self.case = case
        self.root = root
        self.evidence = root / 'var/backups/proofofwork-ui/cleanup-evidence'
        self.evidence.mkdir(parents=True)
        self.config, self.state = (root / E.TARGETS[k] for k in ('config','state'))
        self.capacity = root / 'bin/capacity'
        self.layout = SimpleNamespace(lock=root / 'run/deploy.lock', evidence=self.evidence)
        for path in (self.config, self.state, self.capacity, self.layout.lock):
            path.parent.mkdir(parents=True)
        I.save(self.layout.lock, b'fixture lock\n')
        I.save(self.capacity, b'fixture capacity\n')
        self.guards = {'protected': 'synthetic current and rollback, holds and timers'}
        self.retirement = {'verified': 'synthetic historical retirement'}
        self.context = {'pair': W.PAIR, 'guards': self.guards, 'privateFixture': 'fixture-only-context'}
        self.stored = {'fullCompletionVerified': True, 'context': self.context, 'index': {'synthetic': 'index'},
                       'lastCompleted': {'cycleId': 'fixture-cycle'}, 'verifiedRetiredPayloads': self.retirement,
                       'vpsVerification': {'verified': 'fixture-vps'}}
        self.prior_state = {'revision': 341, 'status':'complete', 'completedContext': self.context, 'index': self.stored['index'],
                            'lastCompleted': self.stored['lastCompleted']}
        # The real historical controller and its two established host functions
        # are covered by on-host qualification. This signed-input slot is local.
        controller = 'deploy/ui-retention/lifecycle_remote.py'
        predecessor = (b'def capacity_floor_authority(layout): return layout.fixture_floor\n'
                       b'def scratch_capacity_authority(layout): return layout.fixture_scratch\n')
        scope = (I.ROOT/I.CATCHUP_SCRATCH_SCOPE).read_bytes()
        case.assertEqual(SHA(scope),I.CATCHUP_SCRATCH_SHA)
        self.layout.fixture_floor = {'rootReserveBytes':8*1024**3, 'growthReserveBytes':64*W.MIB}
        self.layout.fixture_scratch = dict(json.loads(scope)['predecessorAuthority'],scratchBudgetBytes=7*1024**3)
        sources = {STORAGE:Path(S.__file__).read_bytes(),controller:predecessor}
        for name in ('scratch_successor.py','amo_scratch_successor.py'):
            sources['deploy/ui-retention/'+name] = (HERE/name).read_bytes()
        old_manifest = {'files':{k:{'bytes':len(raw),'sha256':SHA(raw)} for k,raw in sources.items()}}
        self.old_package_sha = SHA(ENC(old_manifest))
        old_package = self.evidence / ('ui-lifecycle-tools-' + self.old_package_sha)
        for relative,raw in sources.items():
            dest = old_package/relative
            dest.parent.mkdir(parents=True,exist_ok=True)
            I.save(dest,raw)
        I.save(old_package/'package.json', ENC(old_manifest))
        self.prior_config = {'source':'fixture-predecessor','package':{'path':str(old_package),'sha256':self.old_package_sha},
                             'controller':{'path':str(old_package/controller),'sha256':SHA(predecessor)}}
        I.save(self.config, ENC(self.prior_config))
        I.save(self.state, ENC(self.prior_state))
        self.old_ids = {role:E.read(root/p)[1] for role,p in E.TARGETS.items()}
        self.failed = self.evidence / ('ui-lifecycle-upgrade-' + self.old_package_sha)
        self.failed.mkdir()
        I.save(self.failed/'verification-failed.json', b'fixture terminal failure\n')
        I.save(self.failed/'completed.json', ENC({'completionVerification':self.stored}))
        self.failed_pins = {p.name: I.file_record(p) for p in self.failed.iterdir()}
        files = sources | {I.CATCHUP_SCRATCH_SCOPE:scope, 'deploy/ui-retention/fixture.py':b'# synthetic candidate\n'}
        records = {k:{'sha256':SHA(raw),'bytes':len(raw)} for k,raw in files.items()}
        manifest = {'schema':'pow-ui-retention-package-v1','sourceCommit':'1'*40,'sourceTree':'2'*40,'files':records}
        package = SHA(ENC(manifest))
        self.package = self.evidence / ('ui-lifecycle-tools-' + package)
        cfg = {'package':{'path':str(self.package),'sha256':package},'sourceCommit':'1'*40,'sourceTree':'2'*40}
        self.payload = {'config':cfg,'configSha256':SHA(ENC(cfg)), 'manifest':manifest,
                        'files':{k:dict(records[k],base64=B64(raw)) for k,raw in files.items()}}
        self.auth = {'configSha256':self.old_ids['config']['sha256'],'stateSha256':self.old_ids['state']['sha256'],
                     'packageSha256':self.old_package_sha,'failureSha256':self.failed_pins['verification-failed.json']['sha256']}
        self.request = dict(mode='completed-cycle',configSha256=self.auth['configSha256'],stateSha256=self.auth['stateSha256'],
                            amo341Recovery='3'*64)
        self.completed_sha = self.failed_pins['completed.json']['sha256']
        self.proof = SimpleNamespace(AUTHORITY=self.auth,request=lambda:self.request,FAILED_JOURNAL=self.failed,
                                     verify_failed_evidence=self.failed_evidence,acceptance_digest=R.acceptance_digest)
        self.exchange = SimpleNamespace(create=E.create, read=E.read, directory=self.directory, operate=functools.partial(E.operate,root=self.root))
        self.events = []
        self.fail_ordinary = False
        self.original = SimpleNamespace(current=lambda:(None,self.context), layout=self.layout,
            policy_scope=lambda index:{'eligible':False,'verifiedRetiredPayloads':self.retirement},
            retirement=SimpleNamespace(proof=self.retirement,verify_scope=lambda layout:case.assertIs(layout,self.layout)), verify_vps_completion=lambda state,context:self.stored['vpsVerification'],
            S=SimpleNamespace(compare_guards=lambda layout,guards,paths:case.assertEqual(guards,self.guards)),
            storage_adoption=lambda state:None,failed_prepare_repair=lambda state:None)
        self.installed = SimpleNamespace(recovery_switch_status=self.switch_status,status=self.accepted_status)
        self.native = SimpleNamespace(read_bound=self.read_bound, validate_payload=lambda p:case.assertEqual(p,self.payload),
            verifier_module=self.verifier, existing_runtime=self.runtime, SHA=I.SHA,APPROVAL=I.APPROVAL,
            CATCHUP_SCRATCH_SCOPE=I.CATCHUP_SCRATCH_SCOPE,CATCHUP_SCRATCH_SHA=I.CATCHUP_SCRATCH_SHA,
            safe=self.scoped_safe, save=I.save,sync=I.sync, evidence_inventory=I.evidence_inventory,
            guard_inventory=lambda:{'existingPackages':sorted(p.name for p in self.evidence.glob('ui-lifecycle-tools-*'))},
            preserve_retirement=I.preserve_retirement,
            completed_package_review=lambda p,root,r,b:copy.deepcopy(self.stored),completed_phase_evidence=self.completed_phase)
        self.phase_evidence = {'fullCompletionVerified':True,'retainedFixtureProof':'four completed fixture phase records'}
        self.journal = self.evidence / ('ui-lifecycle-upgrade-' + package)
        self.budget_checks = []
        self.may_admit = True

    def directory(self, path):
        # Treat the top of the disposable namespace as its own root. All fixture
        # directories below that root are verified by the actual inode reader.
        return E.directory(self.root if path in self.root.parents else path)

    def read_bound(self, path, pin=None):
        self.case.assertIn(self.root, Path(path).parents)
        return I.read_bound(path, pin)

    def scoped_safe(self, path, directory=False):
        info = I.safe(path,directory)
        self.case.assertEqual(info.st_gid,os.getegid())
        return SimpleNamespace(st_mode=info.st_mode,st_gid=0)

    def completed_phase(self, runtime, state, digest, scope):
        self.case.assertEqual((runtime,state,digest),(self.original,self.prior_state,self.auth['stateSha256']))
        self.case.assertEqual(scope,{'context':self.context,'verifiedRetiredPayloads':self.retirement})
        return dict(self.phase_evidence,state=state,stateSha256=digest)

    def verifier(self, payload, name, path):
        allowed = {'recovery341_storage':STORAGE, 'recovery_341_prospective_scope':'deploy/ui-retention/lifecycle_remote.py'}
        self.case.assertEqual(path,allowed[name])
        self.case.assertEqual(payload,self.payload)
        loaded = I.verifier_module(payload,name,path)
        if path == STORAGE:
            loaded.Layout = lambda: self.layout
        return loaded

    def runtime(self, config_sha):
        self.case.assertEqual(config_sha, SHA(self.read_bound(self.config)))
        return self.installed if config_sha == self.payload['configSha256'] else self.original

    def observed(self):
        state = json.loads(self.read_bound(self.state)); cfg = self.read_bound(self.config)
        return dict(pair=self.context['pair'], context=state['completedContext'],publicationHealthy=True,
                    retentionComplete=True,unfinishedIntents=[], configSha256=SHA(cfg),stateSha256=SHA(ENC(state)))

    def switch_status(self, *, require_current_seal, provisional=False):
        S.require_execution_lock(self.installed.lock_fd,self.layout)
        expected = {'forward','checking'}
        if provisional:
            expected.add('verified')
        chain = self.phase_chain()
        self.case.assertEqual(set(chain['receipts']),expected)
        self.case.assertEqual((self.journal/'verified.json').exists(),require_current_seal)
        event = 'ordinary-candidate' if provisional else 'with-seal' if require_current_seal else 'before-seal'
        self.events.append(event)
        if provisional and self.fail_ordinary:
            raise ValueError('synthetic ordinary reader refusal')
        return self.observed()

    def phase_chain(self):
        plan = json.loads(self.read_bound(self.journal/'intent.json'))['plan']
        return E.review_receipts(self.journal/'exchange',SHA(ENC(plan)),self.read_bound,os.path.lexists)

    def accepted_status(self, frame):
        self.case.assertEqual(frame,{'requireComplete':True})
        S.require_execution_lock(self.installed.lock_fd,self.layout)
        self.case.assertEqual(set(self.phase_chain()['receipts']),{'forward','checking','verified','accepted'})
        self.events.append('ordinary-accepted')
        return self.observed()

    def failed_evidence(self, cfg, state, reader):
        self.case.assertEqual((cfg,state),(self.prior_config,self.prior_state))
        for name,value in self.failed_pins.items():
            self.case.assertEqual(I.file_record(self.failed/name),value)
        return {'completedSha256':self.completed_sha}

    def fixed(self, native, proof, cfg, state):
        historical = {'before':{'completedReview':{'fullCompletionVerified':True,'retainedFixtureProof':'four completed fixture phase records'}}}
        return self.failed_evidence(cfg,state,native.read_bound),{'rollbackComplete':True},historical

    def projected(self, native, proof, original, payload, records=None):
        def check_prior(st,cfg):
            self.case.assertEqual((st,cfg),(self.prior_state,self.prior_config))
        def check_new(st,cfg):
            self.case.assertEqual(st['revision'],343)
            self.case.assertEqual((st['completedContext'],cfg['package']['path']),(self.context,str(self.package)))
        return SimpleNamespace(proof=self.retirement,verify_failed_amo_341=check_prior,verify_prospective_amo_341=check_new)

    def capacity_check(self, argv, *, check, capture_output, timeout):
        self.case.assertEqual(argv[:6],['/usr/bin/python3','-I','-B',str(self.capacity),'check','--path'])
        self.case.assertEqual(argv[6],str(self.evidence))
        self.case.assertEqual(argv[-2:],['--phase','amo-341-native-recovery'])
        self.case.assertTrue(check and capture_output and 0 < timeout <= 180)
        self.budget_checks.append(argv)
        if not self.may_admit:
            raise ValueError('synthetic capacity refusal')

    def patches(self):
        stack = contextlib.ExitStack()
        for name,value in {'CONFIG':self.config, 'STATE':self.state,'EVIDENCE':self.evidence, 'CAPACITY':self.capacity,
                'FUTURE_CAPACITY':self.root/'future-capacity','SEVEN':SHA(self.capacity.read_bytes()),
                'fixed_inputs':self.fixed,'projected_reader':self.projected,
                'subprocess':SimpleNamespace(run=self.capacity_check),
                'socket':SimpleNamespace(gethostname=lambda:'ubuntu-4gb-hel1-1'),
                'sys':SimpleNamespace(flags=SimpleNamespace(isolated=1,optimize=0),dont_write_bytecode=True),
                'os':SimpleNamespace(**(vars(os)|dict.fromkeys(('getuid','geteuid','getgid','getegid'),lambda:0)))}.items():
            stack.enter_context(patch.object(W,name,value))
        return stack

    def execute(self, action, pin=None, extra=None):
        frame = {'payload':self.payload}
        if pin is not None:
            frame['planSha256'] = pin
        frame.update(extra or {})
        return W.execute(self.native,self.proof,self.exchange,action,frame)


class WriterTests(unittest.TestCase):
    def setUp(self):
        self.addCleanup(os.umask,os.umask(0o077))
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.fx = Receiver(self,Path(tmp.name))
        self.addCleanup(self.fx.patches().close)

    def test_read_only_plan_is_compact_deterministic_and_predicts_installed_digests(self):
        f = self.fx
        snapshot = I.evidence_inventory(f.evidence)
        first = f.execute('plan')
        self.assertEqual(f.execute('plan'), first)
        self.assertEqual(set(first),{'scope','planSha256','packageSha256','configSha256','stateSha256',
                                     'afterRevision','preservedPair','capacity','historical341Failed','installed','originalFilesSha256',
                                     'projectedIntentSha256','projectedCompletedSha256','projectedNativeSealSha256',
                                     'capacityAuthoritySha256','completionVerificationSha256'})
        self.assertEqual(first['scope'],'prospective-341-to-343')
        self.assertTrue(first['historical341Failed'])
        self.assertFalse(first['installed'])
        self.assertNotIn(b'fixture-only-context',ENC(first))
        self.assertNotIn(str(f.root).encode(),ENC(first))
        self.assertEqual(I.evidence_inventory(f.evidence),snapshot)
        self.assertFalse(f.package.exists() or f.journal.exists())
        self.assertEqual(f.events,[])
        self.assertEqual(len(f.budget_checks),2)
        self.assertEqual(f.budget_checks[0][8],str(first['capacity']['rootAndBackupAdditionalBytes']))
        applied = f.execute('apply',first['planSha256'])
        self.assertEqual(applied['exchange']['disposition'],'accepted')
        self.assertEqual(f.events,['before-seal','with-seal','ordinary-candidate'])
        self.assertEqual((SHA(f.config.read_bytes()),SHA(f.state.read_bytes())),(first['configSha256'],first['stateSha256']))
        self.assertEqual(json.loads(f.state.read_bytes())['revision'],343)
        persisted_plan = json.loads((f.journal/'intent.json').read_bytes())['plan']
        self.assertEqual(SHA(ENC(persisted_plan)),first['planSha256'])
        projected = W.projection(persisted_plan)
        self.assertEqual(first['originalFilesSha256'],SHA(ENC(f.old_ids)))
        self.assertEqual(first['capacityAuthoritySha256'],SHA(ENC({'floor':f.layout.fixture_floor,'scratch':f.layout.fixture_scratch})))
        self.assertEqual(first['completionVerificationSha256'],SHA(ENC(f.stored)))
        for field,name in [('projectedIntentSha256','intent'),('projectedCompletedSha256','completed'),
                           ('projectedNativeSealSha256','verified')]:
            self.assertEqual(first[field],SHA((f.journal/(name+'.json')).read_bytes()))
        self.assertEqual((f.journal/'verified.json').read_bytes(),ENC(projected['verified']))
        self.assertEqual(f.phase_chain()['records']['verified']['verificationSha256'],SHA(ENC(projected['verified'])))
        self.assertEqual({k:E.read(f.journal/'exchange'/k)[1] for k in E.ROLES},f.old_ids)
        W.verify_package(f.native,f.payload)
        self.assertEqual(f.execute('status',first['planSha256']),applied)
        self.assertEqual(f.execute('reconcile',first['planSha256']),applied)
        self.assertEqual(f.events,['before-seal','with-seal','ordinary-candidate','ordinary-accepted'])
        for name,record in f.failed_pins.items():
            self.assertEqual(I.file_record(f.failed/name),record)

    def test_ordinary_failure_round_trips_original_inodes_and_preserves_failure(self):
        f = self.fx
        pin = f.execute('plan')['planSha256']
        f.fail_ordinary = True
        with self.assertRaises(E.Restored) as restored:
            f.execute('apply',pin)
        self.assertEqual(restored.exception.result['disposition'],'restored')
        self.assertEqual({k:E.read(f.root/p)[1] for k,p in E.TARGETS.items()},f.old_ids)
        self.assertEqual(set(f.phase_chain()['receipts']),{'forward','checking','verified','reversing','restored'})
        status = f.execute('status',pin)
        self.assertEqual(status['exchange']['disposition'],'restored')
        self.assertFalse(status['accepted'])
        self.assertEqual((status['configSha256'],status['stateSha256']),(f.auth['configSha256'],f.auth['stateSha256']))
        f.fail_ordinary = False
        with self.assertRaises(E.Restored):
            f.execute('reconcile',pin)
        self.assertEqual(f.events,['before-seal','with-seal','ordinary-candidate'])
        self.assertFalse((f.failed/'verified.json').exists() or (f.journal/'exchange'/'accepted.json').exists())

    def test_interrupted_prepared_operation_resumes_only_via_matching_explicit_apply(self):
        f = self.fx
        pin = f.execute('plan')['planSha256']
        native = f.exchange.operate
        class Interrupted(BaseException):
            pass
        def stop_after_prepare(action, *args, **kwargs):
            result = native(action, *args, **kwargs)
            if action == 'prepare':
                raise Interrupted()
            return result
        with patch.object(f.exchange,'operate',side_effect=stop_after_prepare), self.assertRaises(Interrupted):
            f.execute('apply',pin)
        prepared = f.execute('status',pin)
        self.assertEqual(prepared['exchange']['disposition'],'prepared')
        self.assertFalse(prepared['accepted'])
        self.assertEqual({k:E.read(f.root/p)[1] for k,p in E.TARGETS.items()},f.old_ids)
        with self.assertRaisesRegex(ValueError,'digest changed'):
            f.execute('apply','9'*64)
        with self.assertRaisesRegex(ValueError,'explicit apply'):
            f.execute('reconcile',pin)
        self.assertTrue(f.execute('apply',pin)['accepted'])

    def test_interrupted_provisional_phase_reconciles_only_remaining_ordinary_check(self):
        f = self.fx
        pin = f.execute('plan')['planSha256']
        class Interrupted(BaseException):
            pass
        def stop_at_acceptance(*, require_current_seal, provisional=False):
            if provisional:
                raise Interrupted()
            return f.switch_status(require_current_seal=require_current_seal)
        with patch.object(f.installed,'recovery_switch_status',side_effect=stop_at_acceptance), self.assertRaises(Interrupted):
            f.execute('apply',pin)
        status = f.execute('status',pin)
        self.assertEqual(status['exchange']['disposition'],'verified')
        self.assertFalse(status['accepted'])
        self.assertEqual(f.events,['before-seal','with-seal'])
        with self.assertRaisesRegex(ValueError,'exactly prepared'):
            f.execute('apply',pin)
        self.assertTrue(f.execute('reconcile',pin)['accepted'])
        self.assertEqual(f.events[:3],['before-seal','with-seal','ordinary-candidate'])

    def interrupted_outer(self, name, after_link, refuse):
        class PowerLoss(BaseException):
            pass
        with tempfile.TemporaryDirectory() as directory:
            f = Receiver(self, Path(directory))
            with f.patches():
                pin = f.execute('plan')['planSha256']
                native_link = os.link
                def interrupted_link(source, target, **kwargs):
                    if target != name or os.fstat(kwargs['dst_dir_fd']).st_ino != f.journal.stat().st_ino:
                        return native_link(source, target, **kwargs)
                    self.assertFalse(os.path.lexists(f.journal / name))
                    if after_link:
                        native_link(source, target, **kwargs)
                    raise PowerLoss()
                with patch.object(E.os,'link',side_effect=interrupted_link), self.assertRaises(PowerLoss):
                    f.execute('apply',pin)
                plan = json.loads((f.journal/'intent.json').read_bytes())['plan']
                projected = W.projection(plan)
                path = f.journal/name
                self.assertEqual(path.exists(), after_link)
                if after_link:
                    self.assertEqual(E.read(path)[0], ENC(projected[path.stem]))
                self.assertEqual(f.execute('status',pin)['exchange']['disposition'],'checking')
                self.assertEqual({k:E.read(f.journal/'exchange'/k)[1] for k in E.ROLES}, f.old_ids)
                # Independent ordinary confirmation must follow fsync of the two
                # real outer names, even when both appeared before this process.
                synchronized = []
                def flush_outer(parent):
                    if parent == f.journal:
                        synchronized.append(tuple(p for p in ('completed.json','verified.json') if (parent/p).exists()))
                    return I.sync(parent)
                def ordinary(**kwargs):
                    if kwargs.get('provisional'):
                        self.assertIn(('completed.json','verified.json'),synchronized)
                    return f.switch_status(**kwargs)
                f.fail_ordinary = refuse
                with patch.object(f.native,'sync',side_effect=flush_outer), patch.object(f.installed,'recovery_switch_status',side_effect=ordinary):
                    if refuse:
                        with self.assertRaises(E.Restored):
                            f.execute('reconcile',pin)
                        self.assertEqual({k:E.read(f.root/p)[1] for k,p in E.TARGETS.items()},f.old_ids)
                    else:
                        self.assertTrue(f.execute('reconcile',pin)['accepted'])
                        self.assertTrue(f.execute('status',pin)['accepted'])
                self.assertEqual((f.journal/'exchange/accepted.json').exists(), not refuse)
                self.assertEqual((f.journal/'exchange/restored.json').exists(), refuse)
                self.assertEqual(E.read(path)[0],ENC(projected[path.stem]))

    def test_interrupt_before_and_after_outer_links_qualifies_reconciliation_and_restoration(self):
        for name in ('completed.json','verified.json'):
            for after_link in (False, True):
                for refuse in (False, True):
                    with self.subTest(name=name,after_link=after_link,refuse=refuse):
                        self.interrupted_outer(name,after_link,refuse)

    def test_prepared_outer_evidence_with_absent_exchange_readback(self):
        f = self.fx
        pin = f.execute('plan')['planSha256']
        class Interrupted(BaseException):
            pass
        with patch.object(f.exchange,'operate',side_effect=Interrupted), self.assertRaises(Interrupted):
            f.execute('apply',pin)
        result=f.execute('status',pin)
        self.assertFalse(result['accepted'])
        self.assertEqual(result['exchange'],{'disposition':'absent','positions':{'state':'before','config':'before'},'planSha256':pin})
        self.assertEqual((result['configSha256'],result['stateSha256']),(f.auth['configSha256'],f.auth['stateSha256']))
        self.assertFalse((f.journal/'exchange').exists())
        self.assertEqual({k:E.read(f.root/p)[1] for k,p in E.TARGETS.items()}, f.old_ids)
        with self.assertRaisesRegex(ValueError,'exactly prepared'):
            f.execute('apply',pin)

    def test_conflicting_outer_marker_and_changed_mode_refuse(self):
        f=self.fx
        pin=f.execute('plan')['planSha256']
        class Interrupted(BaseException):
            pass
        native_create = f.exchange.create
        def stop(path,raw):
            if path==f.journal/'completed.json':
                raise Interrupted()
            native_create(path,raw)
        with patch.object(f.exchange,'create',side_effect=stop), self.assertRaises(Interrupted):
            f.execute('apply',pin)
        marker=f.journal/'completed.json'
        E.create(marker,b'foreign bytes')
        with self.assertRaisesRegex(ValueError,'Conflicting recovery terminal'):
            f.execute('reconcile',pin)
        self.assertEqual(marker.read_bytes(),b'foreign bytes')
        marker.chmod(0o644)
        with self.assertRaisesRegex(ValueError,'Unsafe recovery file'):
            f.execute('status',pin)
        self.assertFalse((f.journal/'exchange/accepted.json').exists())

    def test_plan_refuses_operational_fields_and_wrong_or_oversized_activation(self):
        f = self.fx
        with self.assertRaisesRegex(ValueError,'Expanded read-only'):
            f.execute('plan', extra={'unexpected':True})
        with self.assertRaisesRegex(ValueError,'digest changed'):
            f.execute('apply','f'*64)
        with self.assertRaisesRegex(ValueError,'unbound'):
            f.execute('apply')
        f.may_admit = False
        with self.assertRaisesRegex(ValueError,'capacity refusal'):
            f.execute('plan')
        self.assertFalse(f.journal.exists() or f.package.exists())
        budget_fixture = copy.deepcopy(f.payload)
        budget_fixture['files'][STORAGE]['bytes'] = 32*W.MIB
        records = dict.fromkeys(('priorConfig','priorState','config','state','intent','completed','verified'),{})
        with self.assertRaisesRegex(ValueError,'exceeds 64 MiB'):
            W.allocation(records,budget_fixture)

    def test_candidate_refuses_changed_prior_floor_scratch_and_historical_phase(self):
        f = self.fx
        for data,key in [(f.layout.fixture_floor,'rootReserveBytes'),(f.layout.fixture_floor,'growthReserveBytes'),
                         (f.layout.fixture_scratch,'scratchBudgetBytes')]:
            with self.subTest(field=key), patch.dict(data,{key:data[key]-1}), self.assertRaisesRegex(ValueError,'capacity authorit'):
                f.execute('plan')
        with patch.dict(f.phase_evidence,{'retainedFixtureProof':'different'}), self.assertRaisesRegex(ValueError,'completed-phase'):
            f.execute('plan')
        self.assertFalse(f.journal.exists() or f.package.exists())

    def test_review_detects_replaced_original_inode_before_any_recovery_write(self):
        f = self.fx
        pin = f.execute('plan')['planSha256']
        data = f.config.read_bytes()
        f.config.rename(f.config.with_name('fixture-original'))
        I.save(f.config,data)
        with self.assertRaisesRegex(ValueError,'digest changed'):
            f.execute('apply',pin)
        self.assertFalse(f.journal.exists() or f.package.exists())

    def test_package_is_creation_only_and_rejects_extra_files_and_corrupted_content(self):
        f = self.fx
        self.assertEqual(W.save_package(f.native,f.payload),f.package)
        W.verify_package(f.native,f.payload)
        with self.assertRaises(FileExistsError):
            W.save_package(f.native,f.payload)
        I.save(f.package/'foreign-fixture',b'foreign\n')
        with self.assertRaisesRegex(ValueError,'Unreviewed'):
            W.verify_package(f.native,f.payload)
        (f.package/STORAGE).write_bytes(b'corrupt')
        with self.assertRaisesRegex(ValueError,'SHA differs'):
            W.verify_package(f.native,f.payload)

    def test_package_private_modes_are_reverified_after_creation(self):
        f = self.fx
        W.save_package(f.native,f.payload)
        for path,private,widened in ((f.package,0o700,0o755), (f.package/'deploy/audit30',0o700,0o750),
                                     (f.package/'package.json',0o600,0o640), (f.package/STORAGE,0o600,0o644)):
            with self.subTest(entry=path.relative_to(f.package),mode=widened):
                self.assertEqual(path.stat().st_mode & 0o7777,private)
                path.chmod(widened)
                try:
                    with self.assertRaises(ValueError):
                        W.verify_package(f.native,f.payload)
                finally:
                    path.chmod(private)
                W.verify_package(f.native,f.payload)

    def test_plan_cli_dispatches_only_plan_and_rejects_apply_only_options(self):
        f = self.fx
        args = ['install_lifecycle.py','plan-amo-341-recovery','--commit','1'*40,'--tree','2'*40,
                '--package-sha256',f.payload['config']['package']['sha256']]
        with patch.object(I,'qualified_recovery_payload',return_value=f.payload), patch.object(I,'remote',return_value={'installed':False}) as remote, contextlib.redirect_stdout(io.StringIO()) as output:
            with patch.object(sys,'argv',args):
                I.main()
            remote.assert_called_once_with('amo341-plan',{'payload':f.payload})
            self.assertEqual(json.loads(output.getvalue()),{'installed':False})
            with patch.object(sys,'argv',args+['--plan-sha256','0'*64]), contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
                I.main()
            self.assertEqual(remote.call_count,1)

    def test_checkout_qualification_requires_exact_parent_commit_tree_package_and_dispatcher(self):
        f = self.fx
        value = copy.deepcopy(f.payload)
        cfg = value['config']
        source = 'deploy/ui-retention/install_lifecycle.py'
        value['files'][source] = {'sha256':SHA(Path(I.__file__).read_bytes())}
        args = SimpleNamespace(commit=cfg['sourceCommit'],tree=cfg['sourceTree'],package_sha256=cfg['package']['sha256'])
        parent = '133a4afe34ac4f9bc1636d50bdad1acbd876c645'
        check_output = Mock(return_value=args.commit+' '+parent+'\n')
        with patch.object(I,'committed_payload',return_value=value), patch.object(I,'subprocess',SimpleNamespace(check_output=check_output)):
            self.assertEqual(I.qualified_recovery_payload(args),value)
            self.assertEqual(check_output.call_args.args[0][-5:],['rev-list','--parents','-n','1',args.commit])
            for field in ('commit','tree','package_sha256'):
                wrong = SimpleNamespace(**(vars(args)|{field:'0'*len(getattr(args,field))}))
                with self.subTest(field=field), self.assertRaisesRegex(ValueError,'clean checkout'):
                    I.qualified_recovery_payload(wrong)
            check_output.return_value = args.commit+' '+('f'*40)+'\n'
            with self.assertRaisesRegex(ValueError,'direct successor'):
                I.qualified_recovery_payload(args)
            check_output.return_value = args.commit+' '+parent+'\n'
            value['files'][source]['sha256'] = '7'*64
            with self.assertRaisesRegex(ValueError,'Invoking installer'):
                I.qualified_recovery_payload(args)

    def test_remote_dispatch_serializes_payload_as_data_and_rejects_unknown_action(self):
        data = {'literal':'fixture text with quotes " and newline\n'}
        send = Mock(return_value=SimpleNamespace(returncode=0,stdout=b'{"fixture":true}'))
        with patch.object(I,'UI_HOST',False),patch.object(I,'subprocess',SimpleNamespace(run=send)):
            self.assertEqual(I.remote('amo341-plan',data),{'fixture':True})
            source = send.call_args.kwargs['input']
            tree = ast.parse(source)
            frame,dispatch = tree.body[-3:-1]
            wire = frame.value.args[0].args[0].value
            self.assertEqual(json.loads(base64.b64decode(wire,validate=True)),data)
            self.assertEqual(ast.unparse(dispatch.value),"run_amo_341('plan', value)")
            self.assertEqual(send.call_args.args[0][:len(I.SSH)],I.SSH)
            with self.assertRaisesRegex(ValueError,'Unknown installer operation'):
                I.remote('amo341-other',data)
            self.assertEqual(send.call_count,1)


if __name__ == '__main__':
    unittest.main()
