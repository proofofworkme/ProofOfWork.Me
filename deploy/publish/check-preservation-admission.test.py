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


def retired_observation():
    base = A['RETIREMENT_BASE']; pair = A['RETIRED_PAIR'].copy()
    proof = {'model': 'intentionally-retired-payloads-retained-evidence-v1',
             'proposalSha256': '6fd05dc1e04e6fbcab293683c5a0d10d184ff0bd83039a66d7f2c7ec53161004',
             'receipt': {'path': A['RETIREMENT_EVIDENCE'] + '/completed.json', 'sha256': '1'*64},
             'receiptSha256': '1'*64, 'journalHeadSha256': '2'*64, 'policyCodeSha256': '3'*64,
             'retiredPayloadPaths': [base + '/' + path for path in (
                 'releases/proofofwork-ui-release-1042efea2aa1-20261112T074918Z.tgz',
                 'rollback-roots/proofofwork-www-pre-e2669bc1fd32-20261112T163804Z',
                 'releases/proofofwork-ui-release-c3969c39c2b2-20261101T051206Z.tgz',
                 'rollback-roots/proofofwork-www-pre-54088ca155bc-20261103T032112Z')],
             'retirementRetainedPair': pair,
             'sourceIndex': {'path': base + '/cleanup-evidence/audit30-policy-admission-index-ordinary-064b6991ae2a-20261114T020148Z.json',
                             'sha256': '5a7b025d95cd55a2b40f2a69b0189b74d75484ff237bac327f920a6b2a231c54'},
             'recoveryVerification': 'isolated-static-only'}
    archive = base + '/releases/proofofwork-ui-release-' + pair['previous'] + '.tgz'
    rule = {'model': 'private-stage-reviewed-retirement-v1', 'releaseId': 'abcdefabcdef-20261115T010000Z',
            'previousPair': pair, 'index': INDEX, 'stateSha256': BINDING['state']['sha256'],
            'verifiedRetiredPayloads': proof,
            'wouldRetire': sorted([archive+s for s in ('', '.sha256', '.provenance')] +
                [base + '/rollback-roots/proofofwork-www-pre-' + pair['current']])}
    return {'binding': {**BINDING, 'pair': pair}, 'index': INDEX, 'verifiedPreservedFallback': None,
            'verifiedPreservedRelease1042': None, 'verifiedRetiredPayloads': proof,
            'verifiedRetirementCurrentPair': pair, 'verifiedRetirementPolicyCodeSha256': '3'*64,
            'verifiedCurrentPackageSha256': 'd'*64,
            'verifiedRetirementSourceConfig': {'path': A['RETIREMENT_EVIDENCE'] + '/successor-config.json', 'sha256': '4'*64},
            'privateStageRetention': rule}


def successor_retired_observation():
    observed = retired_observation()
    pair = {'current': 'a2a7be66bf49-20261115T031513Z',
            'previous': '064b6991ae2a-20261114T020148Z'}
    observed['binding'] = {**observed['binding'], 'pair': pair}
    observed['verifiedRetirementCurrentPair'] = pair
    archive = A['RETIREMENT_BASE'] + '/releases/proofofwork-ui-release-' + pair['previous'] + '.tgz'
    observed['privateStageRetention'] = {**observed['privateStageRetention'],
        'releaseId': 'abcdefabcdef-20261116T010000Z', 'previousPair': pair,
        'wouldRetire': sorted([archive+s for s in ('', '.sha256', '.provenance')] +
            [A['RETIREMENT_BASE'] + '/rollback-roots/proofofwork-www-pre-' + pair['current']])}
    return observed


def b_a2_retired_observation():
    observed = successor_retired_observation()
    pair = {'current': 'd5075ab88cdc-20261115T185350Z',
            'previous': 'a2a7be66bf49-20261115T031513Z'}
    observed['binding'] = {**observed['binding'], 'pair': pair}
    observed['verifiedRetirementCurrentPair'] = pair
    archive = A['RETIREMENT_BASE'] + '/releases/proofofwork-ui-release-' + pair['previous'] + '.tgz'
    observed['privateStageRetention'] = {**observed['privateStageRetention'],
        'previousPair': pair,
        'wouldRetire': sorted([archive+s for s in ('', '.sha256', '.provenance')] +
            [A['RETIREMENT_BASE'] + '/rollback-roots/proofofwork-www-pre-' + pair['current']])}
    return observed


class PublicationAdmission(unittest.TestCase):
    def test_retired_obligation_requires_private_bound_current_package_and_original_proof(self):
        observed = retired_observation(); release = observed['privateStageRetention']['releaseId']
        A['check_observation'](observed, True, release=release)
        with self.assertRaisesRegex(ValueError, 'requires private'):
            A['check_observation'](observed, False, release=release)
        mutations = [{key: None} for key in A['RETIREMENT_FIELDS']]
        mutations += [{'verifiedPreservedFallback': HOLD}, {'verifiedPreFallbackIndex': INDEX},
                      {'verifiedCurrentPackageSha256': '5'*64},
                      {'verifiedRetirementCurrentPair': BINDING['pair']},
                      {'verifiedRetirementPolicyCodeSha256': '5'*64},
                      {'verifiedRetirementSourceConfig': {'path': '/foreign', 'sha256': '4'*64}}]
        for change in mutations:
            with self.subTest(change=change), self.assertRaises(ValueError):
                A['check_observation']({**observed, **change}, True, release=release)
        for key in ('proposalSha256', 'sourceIndex', 'retiredPayloadPaths', 'receipt', 'policyCodeSha256'):
            tampered = copy.deepcopy(observed); tampered['verifiedRetiredPayloads'][key] = None
            with self.subTest(key=key), self.assertRaises(ValueError):
                A['check_observation'](tampered, True, release=release)
        stripped = {k:v for k,v in observed.items() if k not in A['RETIREMENT_FIELDS']}
        with self.assertRaisesRegex(ValueError, 'pre-fallback'):
            A['check_observation'](stripped, True, release=release)

    def test_retired_forecast_authorizes_only_exact_064_e266_four_paths(self):
        rule = retired_observation()['privateStageRetention']
        storage = runpy.run_path(str(HERE.parent/'audit30/ui-storage.py'))
        for check in (A['reviewed_forecast'], storage['reviewed_forecast']):
            self.assertTrue(check(rule))
            changes = [{'wouldRetire':rule['wouldRetire'][:-1]}, {'wouldRetire':list(reversed(rule['wouldRetire']))},
                       {'wouldRetire':rule['wouldRetire']+['/extra']}, {'verifiedRetiredPayloads':None},
                       {'preservedFallback':HOLD}, {'preservedRelease1042':HOLD},
                       {'previousPair':{'current':rule['releaseId'], 'previous':A['RETIRED_PAIR']['current']}}]
            for change in changes:
                with self.subTest(change=change):
                    self.assertFalse(check({**rule, **change}))
        observed = retired_observation()
        observed['privateStageRetention'] = {**rule, 'verifiedRetiredPayloads':{**rule['verifiedRetiredPayloads'], 'journalHeadSha256':'7'*64}}
        with self.assertRaisesRegex(ValueError, 'retired-payload proof'):
            A['check_observation'](observed, True, release=rule['releaseId'])

    def test_a2_064_forecast_preserves_origin_and_refuses_unreviewed_pairs_or_paths(self):
        self.assert_successor_forecast(successor_retired_observation())

    def test_b_a2_forecast_preserves_origin_and_refuses_unreviewed_pairs_or_paths(self):
        self.assert_successor_forecast(b_a2_retired_observation())

    def test_expanded_liquidity_forecasts_only_the_exact_2084_9f18_rotation(self):
        observed = retired_observation()
        base = A['RETIREMENT_BASE']
        current = '2084747c3f8c-20261118T181547Z'
        previous = '9f18a0ce7032-20261118T004519Z'
        pair = {'current': current, 'previous': previous}
        archive = base + '/releases/proofofwork-ui-release-9f18a0ce7032-20261118T004519Z.tgz'
        paths = [archive, archive + '.provenance', archive + '.sha256',
                 base + '/rollback-roots/proofofwork-www-pre-2084747c3f8c-20261118T181547Z']
        observed['binding']['pair'] = pair
        observed['verifiedRetirementCurrentPair'] = pair
        rule = observed['privateStageRetention']
        rule.update(previousPair=pair, wouldRetire=paths, releaseId='abcdefabcdef-20261123T090000Z')

        self.assert_successor_forecast(observed)
        self.assert_storage_retired_scope(observed)

        # Even a self-consistent plan for the reversed pair is outside this scope.
        wrong_archive = base + '/releases/proofofwork-ui-release-' + current + '.tgz'
        wrong_paths = [wrong_archive, wrong_archive + '.provenance', wrong_archive + '.sha256',
                       base + '/rollback-roots/proofofwork-www-pre-' + previous]
        reversed_pair = {'current': previous, 'previous': current}
        storage = runpy.run_path(str(HERE.parent / 'audit30/ui-storage.py'))
        for check in (A['reviewed_forecast'], storage['reviewed_forecast']):
            self.assertFalse(check({**rule, 'previousPair': reversed_pair, 'wouldRetire': wrong_paths}))

    def assert_successor_forecast(self, observed):
        rule = observed['privateStageRetention']
        original = retired_observation()['verifiedRetiredPayloads']
        self.assertEqual(observed['verifiedRetiredPayloads'], original)
        storage = runpy.run_path(str(HERE.parent/'audit30/ui-storage.py'))
        A['check_observation'](observed, True, release=rule['releaseId'])
        for check in (A['reviewed_forecast'], storage['reviewed_forecast']):
            self.assertTrue(check(rule))
            future = {'current': rule['releaseId'], 'previous': rule['previousPair']['current']}
            archive = A['RETIREMENT_BASE'] + '/releases/proofofwork-ui-release-' + future['previous'] + '.tgz'
            future_paths = sorted([archive+s for s in ('', '.sha256', '.provenance')] +
                [A['RETIREMENT_BASE'] + '/rollback-roots/proofofwork-www-pre-' + future['current']])
            changes = [
                {'wouldRetire': rule['wouldRetire'][:-1]},
                {'wouldRetire': list(reversed(rule['wouldRetire']))},
                {'wouldRetire': rule['wouldRetire'] + ['/extra']},
                {'wouldRetire': rule['wouldRetire'] + [rule['wouldRetire'][0]]},
                {'wouldRetire': retired_observation()['privateStageRetention']['wouldRetire']},
                {'previousPair': future, 'wouldRetire': future_paths},
                {'previousPair': {**rule['previousPair'], 'unreviewed': True}},
                {'verifiedRetiredPayloads': {**original, 'retirementRetainedPair': rule['previousPair']}},
                {'verifiedRetiredPayloads': {**original, 'sourceIndex': INDEX}},
                {'verifiedRetiredPayloads': None},
                {'preservedFallback': HOLD}, {'preservedRelease1042': HOLD},
            ]
            for change in changes:
                with self.subTest(change=change):
                    self.assertFalse(check({**rule, **change}))
        for key in A['RETIREMENT_FIELDS']:
            with self.subTest(field=key), self.assertRaises(ValueError):
                A['check_observation']({**observed, key: None}, True, release=rule['releaseId'])

    def test_current_storage_writer_has_explicit_policy_admission(self):
        storage = HERE.parent/'audit30/ui-storage.py'
        policy = ast.parse((HERE.parent/'audit30/ui-release-policy.py').read_bytes())
        assignments = [node for node in policy.body if isinstance(node, ast.Assign)
            and any(isinstance(target, ast.Name) and target.id == 'KNOWN_RETIREMENT_CONTROLLERS'
                    for target in node.targets)]
        self.assertEqual(len(assignments), 1)
        reviewed = ast.literal_eval(assignments[0].value)
        self.assertIn(hashlib.sha256(storage.read_bytes()).hexdigest(), reviewed)
        self.assertIn('60fe272a4bb45848dd67e745302e4c02b909447fca8f3e11d319f8f02cb61325', reviewed)
        self.assertIn('0ded51e069afedef6433f44555c0953658be82b045e06e8d478021d221bca285', reviewed)

    def test_storage_retired_scope_cannot_skip_the_exact_forecast_gate(self):
        for observed in (retired_observation(), successor_retired_observation(), b_a2_retired_observation()):
            with self.subTest(pair=observed['binding']['pair']):
                self.assert_storage_retired_scope(observed)

    def assert_storage_retired_scope(self, observed):
        storage = runpy.run_path(str(HERE.parent/'audit30/ui-storage.py'))
        layout = storage['Layout'](); rule = observed['privateStageRetention']
        def row(path, release=None):
            return {'path':str(path), 'snapshot':{'path':str(path), 'entries':[], 'sha256':storage['digest']([])},
                    **({'fields':{'release_id':release}} if release else {})}
        current = row(layout.live, rule['releaseId'])
        previous = row(layout.roots/('proofofwork-www-pre-'+rule['releaseId']), rule['previousPair']['current'])
        sources = [row(storage['source_locations'](layout, release)[0])
                   for release in (rule['releaseId'], rule['previousPair']['current'])]
        targets = [{**row(path), 'kind':'rollback-root' if '/rollback-roots/' in path else
                    'managed-release-archive' if path.endswith('.tgz') else 'archive-sidecar'} for path in rule['wouldRetire']]
        scope = {'verifiedRetiredPayloads':observed['verifiedRetiredPayloads'],
                 'eligible':[{k:r[k] for k in ('path','kind')} for r in targets]}
        plan = {'schema':'pow-audit30-exact-ui-storage-plan-v1','host':'77.42.91.106',
                'kind':'future-retention','scopeApprovalSha256':'a'*64,'safeguards':{},
                'protected':{'current':current,'previous':previous,'sources':sources},
                'delete':targets,'moves':[],'policyScope':scope,'privateStageRetention':{'forecast':rule}}
        validate = storage['validate_plan']
        validate(plan,layout,'future-retention','a'*64)
        for change in ({'privateStageRetention':{}}, {'delete':[]},
                       {'privateStageRetention':{'forecast':{**rule,'wouldRetire':[]}}},
                       {'policyScope':{**scope,'verifiedRetiredPayloads':{**scope['verifiedRetiredPayloads'],'journalHeadSha256':'9'*64}}}):
            with self.subTest(change=change), self.assertRaises(ValueError):
                validate({**plan,**change},layout,'future-retention','a'*64)

    def test_retired_private_make_plan_refuses_missing_forecast_before_artifact_io(self):
        observed=retired_observation(); release=observed['privateStageRetention']['releaseId']
        preflight={**observed, 'retentionLifecycle':observed['binding'], 'retentionIndex':observed['index'],
                   'closedArchive':{'request':{'inputCompactorSha256':'6'*64}}}
        del preflight['privateStageRetention']
        with tempfile.TemporaryDirectory() as tmp:
            build=Path(tmp)/'build'; before=Path(tmp)/'preflight'
            build.write_text(json.dumps({'releaseId':release})); before.write_text(json.dumps(preflight))
            call=R['make_plan']
            with patch.dict(call.__globals__,admission_source=lambda:(HERE/'publication_admission.py').read_bytes()):
                with self.assertRaisesRegex(ValueError,'exact retention forecast'):
                    call(type('Args',(),{'build_receipt':build,'preflight':before})())

    def test_zero_retirement_model_does_not_authenticate_forged_retirement(self):
        observed=retired_observation()
        rule={**observed['privateStageRetention'], 'model':A['MODEL'], 'wouldRetire':[]}
        storage=runpy.run_path(str(HERE.parent/'audit30/ui-storage.py'))
        for check in (A['reviewed_forecast'],storage['reviewed_forecast']):
            self.assertTrue(check(rule))
            self.assertFalse(check({**rule,'wouldRetire':['/extra']}))
        for proof in (None, {}, {**rule['verifiedRetiredPayloads'],'journalHeadSha256':'8'*64}):
            changed={**observed,'privateStageRetention':{**rule,'verifiedRetiredPayloads':proof}}
            with self.subTest(proof=proof), self.assertRaisesRegex(ValueError,'retired-payload proof'):
                A['check_observation'](changed,True,release=rule['releaseId'])

    def test_installed_retired_admission_authenticates_config_and_propagates_evidence(self):
        observed = retired_observation(); binding = observed['binding']; rule = observed['privateStageRetention']
        config = {'package':{'path':A['PACKAGE']+'d'*64, 'sha256':'d'*64}, 'controller':binding['controller'],
                  'payloadRetirementSourceConfig':observed['verifiedRetirementSourceConfig']}
        runtime=Mock(); runtime.layout=object(); runtime.status.return_value=observed
        runtime.retirement.proof=observed['verifiedRetiredPayloads']
        controller=b'def installed_runtime(*args): return runtime_for_admission_test\n'
        def read(path, digest, limit):
            return json.dumps(config).encode() if path==A['CONFIG'] else controller
        func=A['installed_admission']
        with patch.dict(func.__globals__,pinned_file=read), patch('builtins.runtime_for_admission_test',runtime,create=True):
            result=func(binding,rule['releaseId'],True,rule,9)
            self.assertNotIn('verifiedPreFallbackIndex',result)
            for key in A['RETIREMENT_FIELDS']:self.assertEqual(result[key],observed[key])
            config['payloadRetirementSourceConfig']={'path':'/foreign','sha256':'5'*64}
            with self.assertRaisesRegex(ValueError,'installed package authority'):
                func(binding,rule['releaseId'],True,rule,9)

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
