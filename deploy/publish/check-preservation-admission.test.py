#!/usr/bin/env python3
"""Offline admission and no-read tests for the managed UI publication boundary."""
import ast
import copy
import hashlib
import json
import os
from pathlib import Path
import runpy
import tempfile
import unittest
from unittest.mock import Mock, patch

HERE = Path(__file__).resolve().parent
A = runpy.run_path(str(HERE/'publication_admission.py'))
R = runpy.run_path(str(HERE/'release.py'))
PRE = 'c3969c39c2b2-20261101T051206Z'
INTRO = '54088ca155bc-20261103T032112Z'
NEXT = 'abcdefabcdef-20261103T040500Z'
HOLD = {'model':'verified-fallback-in-place-v1','introducedBy':INTRO,'releaseId':PRE}
INDEX = {'path':'/approved/index','sha256':'a'*64}
BINDING = {'config':{'path':A['CONFIG'],'sha256':'b'*64},'state':{'path':A['STATE'],'sha256':'c'*64},
           'controller':{'path':A['PACKAGE']+'d'*64+'/deploy/ui-retention/lifecycle_remote.py','sha256':'e'*64},
           'pair':{'current':INTRO, 'previous':PRE}}
RULE = {'model':A['MODEL'],'wouldRetire':[],'preservedFallback':HOLD,'releaseId':NEXT}


class PublicationAdmission(unittest.TestCase):
    def test_november_11_retirement_is_exact_and_does_not_authorize_future_pairs(self):
        current = 'd9fa69d9e1e4-20261110T210615Z'
        previous = 'd4eeffaf28f1-20261109T160000Z'
        archive = '/var/backups/proofofwork-ui/releases/proofofwork-ui-release-'+previous+'.tgz'
        paths = sorted([archive+suffix for suffix in ('','.sha256','.provenance')]+
                       ['/var/backups/proofofwork-ui/rollback-roots/proofofwork-www-pre-'+current])
        rule = dict(model='private-stage-reviewed-retirement-v1',wouldRetire=paths,
                    previousPair=dict(current=current,previous=previous),
                    preservedFallback=dict(snapshotSha256={'preserved':'a'*64}))
        storage = runpy.run_path(str(HERE.parent/'audit30/ui-storage.py'))
        for check in (A['reviewed_forecast'],storage['reviewed_forecast']):
            self.assertTrue(check(rule))
            changes = [dict(wouldRetire=paths+['extra']),dict(wouldRetire=list(reversed(paths))),
                       dict(previousPair=dict(current=NEXT,previous=current)),
                       dict(previousPair=dict(current=previous,previous=current)),
                       dict(preservedFallback=None),dict(preservedFallback=dict(snapshotSha256={}))]
            protected = ['/var/backups/proofofwork-ui/releases/proofofwork-ui-release-'+release+'.tgz'
                         for release in (current, PRE)]
            protected += ['/var/backups/proofofwork-ui/rollback-roots/proofofwork-www-pre-'+INTRO]
            changes += [dict(wouldRetire=sorted(paths+[path])) for path in protected]
            changes += [dict(wouldRetire=[p for p in paths if p != path]) for path in paths]
            changes += [dict(preservedFallback=dict(snapshotSha256={path:'a'*64})) for path in paths]
            for change in changes:
                with self.subTest(check=check.__module__,change=change):
                    self.assertFalse(check(dict(rule,**change)))

    def test_november_10_retirement_is_exact_and_does_not_authorize_future_pairs(self):
        current = 'd4eeffaf28f1-20261109T160000Z'
        previous = '69c31f4e1dcd-20261109T051556Z'
        archive = '/var/backups/proofofwork-ui/releases/proofofwork-ui-release-'+previous+'.tgz'
        paths = sorted([archive+suffix for suffix in ('','.sha256','.provenance')]+
                       ['/var/backups/proofofwork-ui/rollback-roots/proofofwork-www-pre-'+current])
        rule = dict(model='private-stage-reviewed-retirement-v1',wouldRetire=paths,
                    previousPair=dict(current=current,previous=previous),
                    preservedFallback=dict(snapshotSha256={'preserved':'a'*64}))
        storage = runpy.run_path(str(HERE.parent/'audit30/ui-storage.py'))
        for check in (A['reviewed_forecast'],storage['reviewed_forecast']):
            self.assertTrue(check(rule))
            changes = [dict(wouldRetire=paths+['extra']),dict(wouldRetire=list(reversed(paths))),
                       dict(previousPair=dict(current=NEXT,previous=current)),
                       dict(previousPair=dict(current=previous,previous=current)),
                       dict(preservedFallback=None),dict(preservedFallback=dict(snapshotSha256={}))]
            changes += [dict(wouldRetire=[p for p in paths if p != path]) for path in paths]
            changes += [dict(preservedFallback=dict(snapshotSha256={path:'a'*64})) for path in paths]
            for change in changes:
                with self.subTest(check=check.__module__,change=change):
                    self.assertFalse(check(dict(rule,**change)))

    def test_reviewed_transition_requires_exact_pair_and_all_four_paths(self):
        outgoing = '69c31f4e1dcd-20261109T051556Z'
        archive = '/var/backups/proofofwork-ui/releases/proofofwork-ui-release-' + INTRO + '.tgz'
        paths = sorted([archive + suffix for suffix in ('', '.sha256', '.provenance')] +
                       ['/var/backups/proofofwork-ui/rollback-roots/proofofwork-www-pre-' + outgoing])
        rule = dict(model='private-stage-reviewed-retirement-v1', wouldRetire=paths,
                    previousPair=dict(current=outgoing, previous=INTRO),
                    preservedFallback=dict(snapshotSha256={'preserved': 'a' * 64}))
        storage = runpy.run_path(str(HERE.parent / 'audit30/ui-storage.py'))
        for check in (A['reviewed_forecast'], storage['reviewed_forecast']):
            self.assertTrue(check(rule))
            for change in (dict(wouldRetire=paths[:-1]), dict(wouldRetire=paths+['extra']),
                           dict(previousPair=BINDING['pair']), dict(preservedFallback=None),
                           dict(preservedFallback=dict(snapshotSha256={archive:'a'*64}))):
                self.assertFalse(check(dict(rule, **change)))

    def test_old_missing_stripped_and_backdated_no_hold_refuse(self):
        check=A['require_obligation']
        with self.assertRaisesRegex(ValueError,'verified preservation result'):
            check({'binding':BINDING},False)
        for change in ({'verifiedPreFallbackIndex':None},{'index':dict(INDEX,sha256='f'*64)},{}):
            observed={'verifiedPreservedFallback':None,'binding':BINDING,'index':INDEX,'verifiedPreFallbackIndex':INDEX,**change}
            with self.assertRaises(ValueError):
                check(observed,False)
        earlier=dict(BINDING,pair={'current':PRE,'previous':PRE})
        with self.assertRaisesRegex(ValueError,'pre-fallback admission index'):
            check({'verifiedPreservedFallback':None,'binding':earlier,'index':INDEX},False)
        self.assertIsNone(check({'verifiedPreservedFallback':None,'binding':earlier,'index':INDEX,
                                 'verifiedPreFallbackIndex':INDEX},False))

    def test_general_and_closed_ordinary_preflight_refuse_before_upload(self):
        with tempfile.TemporaryDirectory() as tmp:
            request=Path(tmp)/'closed.json';request.write_text(json.dumps({'releaseId':NEXT}))
            for closed in (None,str(request)):
                status={'binding':BINDING,'verifiedPreservedFallback':HOLD}
                client=Mock();client.status.return_value=status
                call=R['preflight']; remote=Mock(side_effect=AssertionError('unexpected control upload'))
                with patch.dict(call.__globals__,lifecycle_module=lambda:client,remote=remote,
                                admission_source=lambda:(HERE/'publication_admission.py').read_bytes()):
                    with self.assertRaisesRegex(ValueError,'requires private'):
                        call(type('Args',(),{'closed_request':closed})())
                    remote.assert_not_called()

    def test_offline_make_plan_refuses_missing_or_legacy_evidence_before_artifact_io(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);build=root/'build';preflight=root/'preflight';build.write_text('{}')
            call=R['make_plan']
            for evidence in ({},{'verifiedPreservedFallback':HOLD,'retentionLifecycle':BINDING}):
                preflight.write_text(json.dumps(evidence))
                with patch.dict(call.__globals__,admission_source=lambda:(HERE/'publication_admission.py').read_bytes()):
                    with self.assertRaisesRegex(ValueError,'fresh preflight|requires private'):
                        call(type('Args',(),{'build_receipt':build,'preflight':preflight})())

    def test_lock_and_config_are_bound_independently_of_ordinary_plan_flags(self):
        func=A['installed_admission'];namespace=func.__globals__
        config={'package':{'path':A['PACKAGE']+'d'*64,'sha256':'d'*64},'controller':BINDING['controller']}
        runtime=Mock();runtime.layout=object();runtime.S.require_execution_lock.return_value={'lock':'original'}
        runtime.status.return_value={'binding':BINDING,'verifiedPreservedFallback':HOLD,'privateStageRetention':RULE,'index':INDEX}
        controller=b'def installed_runtime(*args): return runtime_for_admission_test\n'
        def read(path,digest,limit):
            if path==A['CONFIG'] and digest==BINDING['config']['sha256']:
                return json.dumps(config).encode()
            if path==BINDING['controller']['path'] and digest=='e'*64:
                return controller
            raise ValueError('unstaged controller')
        with patch.dict(namespace,pinned_file=read),patch('builtins.runtime_for_admission_test',runtime,create=True):
            bare={'retentionLifecycle':BINDING,'releaseId':NEXT}
            with self.assertRaisesRegex(ValueError,'requires private'):
                func(*A['plan_gate'](bare),9)
            self.assertEqual(runtime.status.call_args.args,({'requireComplete':True},))
            self.assertEqual(runtime.S.require_execution_lock.call_args.args,(9,runtime.layout,{'lock':'original'}))
            self.assertEqual(func(BINDING,NEXT,True,RULE,9)['verifiedPreservedFallback'],HOLD)
            self.assertEqual(runtime.status.call_args.args,({'requireComplete':True,'prospectiveRelease':NEXT},))
            with self.assertRaisesRegex(ValueError,'forecast differs'):
                func(BINDING,NEXT,True,dict(RULE,preservedFallback=None),9)
            altered=dict(BINDING,controller=dict(BINDING['controller'],path='/tmp/foreign.py'))
            with self.assertRaisesRegex(ValueError,'bound package'):
                func(altered,NEXT,False,None,9)
            runtime.status.return_value=dict(runtime.status.return_value,binding=dict(BINDING,state={'sha256':'d'*64}))
            with self.assertRaisesRegex(ValueError,'binding changed'):
                func(BINDING,NEXT,False,None,9)

    def test_mixed_or_resume_private_claims_fail_closed(self):
        bare={'releaseId':NEXT,'retentionLifecycle':BINDING}
        compact={'sha256':'7'*64}
        good=dict(bare, inputCompactor=compact,privateStageRetention=RULE,inputStorage='deploy-scratch-v1',
                  wrapperSourceSha256={'input_compaction.py':compact['sha256']},
                  closedArchive={'request':{'inputCompactorSha256':compact['sha256']},'privateStaging':{}})
        self.assertEqual(A['plan_gate'](good),[BINDING,NEXT,True,RULE])
        for key in ('inputCompactor','privateStageRetention','closedArchive'):
            bad=copy.deepcopy(good);del bad[key]
            with self.assertRaises(ValueError):
                A['plan_gate'](bad)
        with self.assertRaises(ValueError):
            A['plan_gate'](dict(good,resumeSurfaces={}))

    def test_dispatch_refuses_installed_obligation_before_opening_sender_or_log(self):
        transport=runpy.run_path(str(HERE/'transport_preserve.py'))
        bare={'releaseId':NEXT,'publicationAttempt':'initial','retentionLifecycle':BINDING,
              'preservingTransportSha256':hashlib.sha256((HERE/'remote_transport.py').read_bytes()).hexdigest(),
              'wrapperSourceSha256':{'publication_admission.py':hashlib.sha256((HERE/'publication_admission.py').read_bytes()).hexdigest()}}
        def status(**options):
            self.assertEqual(options,{'require_complete':True,'prospective_release':None})
            return {'binding':BINDING,'verifiedPreservedFallback':HOLD}
        with tempfile.TemporaryDirectory(dir='/tmp') as tmp:
            plan=Path(tmp)/'plan';plan.write_text(json.dumps(bare));log=Path(tmp)/'attempt'
            launch=transport['main']; opened=Mock(side_effect=AssertionError('sender opened'))
            with patch.dict(launch.__globals__,admission_source=lambda sha:(HERE/'publication_admission.py').read_bytes(),phase_source=opened), \
                 patch.object(runpy,'run_path',return_value={'status':status}), \
                 patch('sys.argv',['transport',str(plan),'source',str(log)]):
                with self.assertRaisesRegex(ValueError,'requires private'):
                    launch()
                opened.assert_not_called()
                self.assertFalse(log.exists())

    def test_retired_legacy_transport_never_opens_plan_payload_or_ssh(self):
        call = R['transport']
        denied = Mock(side_effect=AssertionError('retired transport attempted I/O'))
        class NoArguments:
            def __getattr__(self, name):
                raise AssertionError('retired transport accessed ' + name)
        with patch.dict(call.__globals__, load_plan=denied, digest=denied, remote=denied), \
                patch.object(Path, 'open', denied), patch('builtins.open', denied), \
                patch('subprocess.run', denied):
            with self.assertRaisesRegex(ValueError,'Legacy audit29 transport is retired'):
                call(NoArguments())
            denied.assert_not_called()

    def test_receiver_and_wrapper_refuse_before_writes_or_payload(self):
        sources = [(HERE/'remote_transport.py','fcntl.flock(lock_fd','directory(BASE);'),
                   (HERE/'publish.py','fcntl.flock(fd','ns={')]
        for file,locked,before_io in sources:
            raw=file.read_text()
            gate=raw.index('installed_admission(*plan_gate(')
            self.assertLess(raw.index(locked),gate)
            self.assertLess(gate,raw.index(before_io))
            body=ast.parse(raw).body
            statement=next(s for s in body if isinstance(s,ast.Expr) and isinstance(s.value,ast.Call)
                           and isinstance(s.value.func,ast.Name) and s.value.func.id=='installed_admission')
            for phase in ('surfaces-stage','source','preserved-capacity-resume'):
                refuse=Mock(side_effect=ValueError('no ordinary publication'))
                bare={'releaseId':NEXT,'retentionLifecycle':BINDING}
                with self.assertRaisesRegex(ValueError,'no ordinary'):
                    exec(compile(ast.Module([statement],[]),str(file),'exec'),{
                        'installed_admission':refuse,'plan_gate':A['plan_gate'],'plan':bare,'p':bare,
                        'fd':9,'lock_fd':9,'phase':phase})
                refuse.assert_called_once_with(BINDING,NEXT,False,None,9)
        upload=R['UPLOAD']
        self.assertLess(upload.index('fcntl.flock('),upload.index('installed_admission('))
        self.assertLess(upload.index('installed_admission('),upload.index('sys.stdin.buffer.read'))
        self.assertLess(upload.index('installed_admission('),upload.index("p.open('xb')"))


if __name__=='__main__':
    unittest.main()
