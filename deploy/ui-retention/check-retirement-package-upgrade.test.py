#!/usr/bin/env python3
"""Synthetic byte-bound package ancestry; no production paths are written.

Only file transport and authority fixture pins are substituted. The real terminal
receipt, config ancestry, lifecycle state and status-seal validators execute.
This does not qualify a production package or authorize any retirement.
"""
import copy
import importlib.util
import json
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parent


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


F = load('package_upgrade_authority_fixture', HERE / 'check-retirement-context.test.py')
R = F.R
L = load('package_upgrade_actual_lifecycle', HERE / 'lifecycle_remote.py')
CONFIG = '/etc/proofofwork-retention/ui-lifecycle.json'
STATE = '/var/lib/proofofwork-ui-retention/state.json'


class Ancestry:
    def __enter__(self):
        self.fixture = F.Fixture().__enter__()
        self.context = self.fixture.load()
        self.original = {
            'schema': 'pow-ui-retention-lifecycle-config-v1',
            'scopeApprovalSha256': 'a' * 64,
            'sourceCommit': '1' * 40, 'sourceTree': '2' * 40,
            'package': {'path': R.BASE + '/cleanup-evidence/ui-lifecycle-tools-' + F.H,
                        'sha256': F.H},
            'statePath': STATE, 'retentionPolicy': 'vps-only-verified-latest',
            'payloadRetirement': copy.deepcopy(self.fixture.binding),
        }
        self.origin_sha = R.digest(R.encoded(self.original))
        self.anchor = {'path': R.EVIDENCE_DIR + '/successor-config.json', 'sha256': self.origin_sha}
        self.fixture.files[self.anchor['path']] = R.encoded(self.original)
        self.initial = self.fixture.transition(self.context)
        transition_path = self.initial['lastPayloadRetirement']['path']
        transition = json.loads(self.fixture.files[transition_path])
        transition['successorConfigSha256'] = self.origin_sha
        transition['statePatch']['configSha256'] = self.origin_sha
        self.fixture.files[transition_path] = R.encoded(transition)
        self.initial['configSha256'] = self.origin_sha
        self.initial['lastPayloadRetirement']['sha256'] = R.digest(self.fixture.files[transition_path])
        self.context.verify_lifecycle_state(self.initial, self.origin_sha, config=self.original)
        # A later ordinary completed cycle is represented as descendant data.
        # Its full publication proof is outside this package-ancestry unit test.
        self.state = copy.deepcopy(self.initial)
        self.state.update(revision=self.initial['revision'] + 2,
                          lastCompleted={**self.initial['lastCompleted'], 'cycleId': 'synthetic-cycle-1'},
                          lastIntent={'path': R.BASE + '/cleanup-evidence/synthetic-cycle-intent.json',
                                      'sha256': 'a' * 64})
        self.config = copy.deepcopy(self.original)
        self.config_sha = self.origin_sha
        self.historical = {name: raw for name, raw in self.fixture.files.items()}
        self.edges = []
        return self

    def __exit__(self, *args):
        self.fixture.__exit__(*args)

    def put(self, path, value):
        raw = R.encoded(value)
        self.fixture.files[str(path)] = raw
        return {'path': str(path), 'sha256': R.digest(raw)}

    def upgrade(self, number):
        prior_config, prior_state = copy.deepcopy(self.config), copy.deepcopy(self.state)
        package_sha = R.digest(('synthetic-package-' + str(number)).encode())
        directory = R.BASE + '/cleanup-evidence/ui-lifecycle-upgrade-' + package_sha
        current = {**prior_config, 'sourceCommit': format(number + 20, '040x'),
                   'sourceTree': format(number + 30, '040x'),
                   'package': {'path': R.BASE + '/cleanup-evidence/ui-lifecycle-tools-' + package_sha,
                               'sha256': package_sha},
                   'payloadRetirementSourceConfig': copy.deepcopy(self.anchor)}
        current_sha = R.digest(R.encoded(current))
        prior_config_binding = self.put(directory + '/prior-config.json', prior_config)
        prior_state_binding = self.put(directory + '/prior-state.json', prior_state)
        upgrade = {'intentPath': directory + '/intent.json',
                   'completionPath': directory + '/completed.json',
                   'statusVerificationPath': directory + '/verified.json',
                   'priorConfigSha256': prior_config_binding['sha256'],
                   'priorStateSha256': prior_state_binding['sha256'],
                   'preservedCompletedCycleId': prior_state['lastCompleted']['cycleId'],
                   'supersededCycleId': None}
        template = dict(prior_state, configSha256=current_sha,
                        revision=prior_state['revision'] + 2,
                        status='complete', pending=None, activePhase=None,
                        completedContext=prior_state['completedContext'], lastUpgrade=upgrade)
        intent = {'schema': 'pow-ui-retention-upgrade-intent-v1',
                  'disposition': 'completed-cycle-preserved', 'freshPreparationRequired': False,
                  'plan': {'schema': 'pow-ui-retention-upgrade-plan-v1',
                           'scopeApprovalSha256': current['scopeApprovalSha256'],
                           'request': {'mode': 'completed-cycle',
                                       'configSha256': prior_config_binding['sha256'],
                                       'stateSha256': prior_state_binding['sha256']},
                           'payload': {'config': current, 'configSha256': current_sha}},
                  'stateTemplate': template, 'stateTemplateSha256': R.digest(R.encoded(template))}
        intent_binding = self.put(upgrade['intentPath'], intent)
        state = dict(template, lastUpgrade=dict(upgrade, intentSha256=intent_binding['sha256']))
        done = {'schema': 'pow-ui-retention-upgrade-completed-v1', 'ok': True,
                'intent': intent_binding, 'config': {'path': CONFIG, 'sha256': current_sha},
                'state': {'path': STATE, 'sha256': R.digest(R.encoded(state))},
                'stateRevision': state['revision'], 'priorConfig': prior_config_binding,
                'priorState': prior_state_binding, 'supersededCycleId': None,
                'preservedCompletedCycleId': upgrade['preservedCompletedCycleId'],
                'freshPreparationRequired': False, 'retentionComplete': True,
                'completionVerification': {'fullCompletionVerified': True,
                    'verifiedRetiredPayloads': self.context.proof,
                    'index': state['index'], 'context': state['completedContext'],
                    'lastCompleted': state['lastCompleted']}}
        completed = self.put(upgrade['completionPath'], done)
        self.put(upgrade['statusVerificationPath'], {
            'schema': 'pow-ui-retention-upgrade-status-verified-v1', 'ok': True,
            'config': done['config'], 'state': done['state'], 'upgradeReceipt': completed,
            'preservedCompletedCycleId': upgrade['preservedCompletedCycleId'],
            'contextSha256': R.digest(R.encoded(template['completedContext']))})
        self.edges.append({'directory': directory, 'upgrade': state['lastUpgrade'],
                           'config': current, 'state': state, 'done': done})
        self.config, self.config_sha, self.state = current, current_sha, state
        return self

    def verify(self):
        return self.context.verify_lifecycle_state(self.state, self.config_sha, config=self.config)

    def runtime_state(self):
        self.fixture.files[STATE] = R.encoded(self.state)

        def read(path, expected=None, maximum=L.MAX_FRAME):
            raw = self.fixture.read(path, maximum)
            digest = R.digest(raw)
            if expected is not None and digest != expected:
                raise ValueError('Synthetic transport hash mismatch')
            return raw, digest

        policy = SimpleNamespace(retirement_module=lambda: R)
        runtime = L.Runtime(self.config, self.config_sha, SimpleNamespace(), policy,
                            layout=self.fixture.layout, retirement=self.context)
        with patch.object(L, 'read', read), patch.object(L.os.path, 'lexists',
                                                        lambda path: str(path) in self.fixture.files):
            return runtime.state()


class PackageUpgradeTests(unittest.TestCase):
    def test_original_authority_and_initial_transition_remain_accepted(self):
        with Ancestry() as f:
            self.assertIsNone(R.source_config(f.original))
            proof = f.context.verify_lifecycle_state(f.initial, f.origin_sha, config=f.original)
            self.assertEqual(proof['state'], f.initial)
            self.assertEqual(proof['configSha256'], f.origin_sha)

    def test_two_upgrades_preserve_every_historical_byte_and_current_seal(self):
        with Ancestry() as f:
            f.upgrade(1).upgrade(2)
            self.assertEqual(f.verify()['configSha256'], f.origin_sha)
            state, digest = f.runtime_state()
            self.assertEqual(state, f.state)
            self.assertEqual(digest, R.digest(R.encoded(f.state)))
            self.assertEqual(f.config['payloadRetirement'], f.original['payloadRetirement'])
            self.assertEqual(f.context.proof['policyCodeSha256'], F.H)
            for name, raw in f.historical.items():
                self.assertEqual(f.fixture.files[name], raw, name)

    def test_later_ordinary_cycle_does_not_erase_package_ancestry(self):
        with Ancestry() as f:
            f.upgrade(1)
            f.state = copy.deepcopy(f.state)
            f.state['revision'] += 4
            f.state['lastCompleted'] = {**f.state['lastCompleted'], 'cycleId': 'synthetic-later-cycle'}
            f.verify()
            f.runtime_state()
            f.upgrade(2)
            f.verify()
            f.runtime_state()

    def test_current_seal_is_mandatory_in_normal_runtime(self):
        with Ancestry() as f:
            f.upgrade(1)
            del f.fixture.files[f.edges[-1]['upgrade']['statusVerificationPath']]
            with self.assertRaises(FileNotFoundError):
                f.verify()
            f.context.verify_lifecycle_state(f.state, f.config_sha, config=f.config,
                                             verify_current_seal=False)
            with self.assertRaises(FileNotFoundError):
                f.runtime_state()

    def test_ancestor_seal_cannot_use_current_installer_window(self):
        with Ancestry() as f:
            f.upgrade(1).upgrade(2)
            del f.fixture.files[f.edges[0]['upgrade']['statusVerificationPath']]
            with self.assertRaises(FileNotFoundError):
                f.verify()
            with self.assertRaises(FileNotFoundError):
                f.context.verify_lifecycle_state(f.state, f.config_sha, config=f.config,
                                                 verify_current_seal=False)

    def test_stripped_or_changed_config_chain_is_refused(self):
        mutations = (
            lambda f: f.config.pop('payloadRetirementSourceConfig'),
            lambda f: f.config['payloadRetirementSourceConfig'].update(path='/tmp/successor-config.json'),
            lambda f: f.config['payloadRetirementSourceConfig'].update(sha256='f' * 64),
            lambda f: f.config['payloadRetirement'].update(policyCodeSha256=f.config['package']['sha256']),
            lambda f: f.config['payloadRetirement'].update(mode='pending'),
            lambda f: f.state.update(lastUpgrade={}),
            lambda f: f.state['lastUpgrade'].update(priorStateSha256='f' * 64),
            lambda f: f.state['lastUpgrade'].update(priorConfigSha256='f' * 64),
            lambda f: f.state['lastUpgrade'].update(preservedCompletedCycleId='unbound-cycle'),
        )
        for mutation in mutations:
            with self.subTest(mutation=mutation), Ancestry() as f:
                f.upgrade(1)
                mutation(f)
                with self.assertRaises((ValueError, FileNotFoundError)):
                    f.verify()

    def test_changed_terminal_index_context_or_completion_evidence_is_refused(self):
        for field in ('terminal', 'index', 'context', 'completion', 'ancestor-config'):
            with self.subTest(field=field), Ancestry() as f:
                f.upgrade(1).upgrade(2)
                if field == 'terminal':
                    f.fixture.files[R.TERMINAL_PATH] += b' '
                    with self.assertRaises(ValueError):
                        f.fixture.load()
                    continue
                if field == 'index':
                    f.fixture.files[f.state['index']['path']] += b' '
                elif field == 'context':
                    f.state['completedContext'] = {'pair': {'current': 'changed'}}
                elif field == 'completion':
                    done = copy.deepcopy(f.edges[-1]['done'])
                    done['completionVerification']['fullCompletionVerified'] = False
                    f.put(f.edges[-1]['upgrade']['completionPath'], done)
                else:
                    f.fixture.files[f.edges[0]['directory'] + '/prior-config.json'] += b' '
                with self.assertRaises(ValueError):
                    f.verify()

    def test_missing_original_anchor_and_unbounded_chain_fail_closed(self):
        with Ancestry() as f:
            f.upgrade(1)
            del f.fixture.files[f.anchor['path']]
            with self.assertRaises(FileNotFoundError):
                f.verify()
        with Ancestry() as f:
            for number in range(1, 18):
                f.upgrade(number)
            with self.assertRaisesRegex(ValueError, 'bound'):
                f.verify()


if __name__ == '__main__':
    unittest.main()
