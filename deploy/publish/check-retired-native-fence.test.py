#!/usr/bin/env python3
"""Native retirement boundary units using real byte-bound receipt validators.

The existing ancestry fixture substitutes only evidence transport and authority
pins. This is not an installed-package/publication qualification; the composed
authority fixture separately exercises the real installed Runtime.
"""
import copy
import hashlib
import importlib.util
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import patch


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


HERE = Path(__file__).resolve().parent
N = load('retired_native_fence', HERE / 'native_exchange_fence.py')
A = load('native_retirement_ancestry', HERE.parent / 'ui-retention/check-retirement-package-upgrade.test.py')
R = A.R


class RetiredNativeFence(unittest.TestCase):
    def test_publisher_pins_exact_current_fence(self):
        digest = hashlib.sha256((HERE / 'native_exchange_fence.py').read_bytes()).hexdigest()
        publisher = (HERE.parent / 'proofofwork-ui-release-publish.sh').read_text()
        self.assertEqual(publisher.count('pin="' + digest + '"'), 1)

    def context(self, fixture):
        fixture.upgrade(1).upgrade(2)
        fixture.context.verify_scope(fixture.fixture.layout)
        runtime = SimpleNamespace(
            P=SimpleNamespace(retirement_module=lambda: R), retirement=fixture.context,
            config=fixture.config, config_sha=fixture.config_sha, layout=fixture.fixture.layout)
        scope = {'pair': R.PAIR.copy(), 'controller': fixture.config['controller']}
        observed = {'verifiedRetiredPayloads': fixture.context.proof,
                    'verifiedRetirementCurrentPair': R.PAIR.copy(),
                    'verifiedRetirementPolicyCodeSha256': fixture.context.proof['policyCodeSha256'],
                    'verifiedCurrentPackageSha256': fixture.config['package']['sha256'],
                    'verifiedRetirementSourceConfig': fixture.anchor.copy(),
                    'verifiedPreservedFallback': None, 'verifiedPreservedRelease1042': None}
        plan = {key: copy.deepcopy(observed[key]) for key in N.RETIREMENT_FIELDS}
        forecast = {'verifiedRetiredPayloads': fixture.context.proof}
        return runtime, observed, plan, forecast, scope

    def test_real_branded_authority_and_sealed_chain_pass(self):
        with A.Ancestry() as fixture:
            runtime, observed, plan, forecast, scope = self.context(fixture)
            context = N.retirement_context(runtime, observed, plan, forecast, scope, True)
            self.assertIs(context, fixture.context)
            before = copy.deepcopy(fixture.fixture.files)
            N.final_retirement_fence(runtime, context, fixture.state, scope)
            self.assertEqual(before, fixture.fixture.files)

    def test_unbranded_or_ordinary_publication_refused(self):
        with A.Ancestry() as fixture:
            runtime, observed, plan, forecast, scope = self.context(fixture)
            with self.assertRaisesRegex(ValueError, 'requires private'):
                N.retirement_context(runtime, observed, plan, forecast, scope, False)
            runtime.retirement = SimpleNamespace(proof=fixture.context.proof)
            with self.assertRaisesRegex(ValueError, 'Authenticated retirement context'):
                N.retirement_context(runtime, observed, plan, forecast, scope, True)

    def test_missing_or_changed_plan_status_fields_refused(self):
        with A.Ancestry() as fixture:
            runtime, observed, plan, forecast, scope = self.context(fixture)
            for side in ('plan', 'observed'):
                for key in N.RETIREMENT_FIELDS:
                    for missing in (True, False):
                        with self.subTest(side=side, key=key, missing=missing):
                            changed = copy.deepcopy(plan if side == 'plan' else observed)
                            if missing:
                                del changed[key]
                            else:
                                changed[key] = None
                            args = (runtime, changed if side == 'observed' else observed,
                                    changed if side == 'plan' else plan, forecast, scope, True)
                            with self.assertRaisesRegex(ValueError, 'proof, package, source anchor or current pair'):
                                N.retirement_context(*args)

    def test_mixed_held_or_pre_fallback_evidence_refused(self):
        with A.Ancestry() as fixture:
            runtime, observed, plan, forecast, scope = self.context(fixture)
            for key in ('verifiedPreservedFallback', 'verifiedPreservedRelease1042',
                        'verifiedPreFallbackIndex', 'preservedFallback', 'preservedRelease1042'):
                with self.subTest(key=key):
                    with self.assertRaisesRegex(ValueError, 'mixed with physical-hold'):
                        N.retirement_context(runtime, observed, dict(plan, **{key: {'unexpected': True}}),
                                             forecast, scope, True)

    def test_final_fence_refuses_missing_current_or_ancestor_seal(self):
        for edge in (0, 1):
            with self.subTest(edge=edge), A.Ancestry() as fixture:
                runtime, observed, plan, forecast, scope = self.context(fixture)
                context = N.retirement_context(runtime, observed, plan, forecast, scope, True)
                del fixture.fixture.files[fixture.edges[edge]['upgrade']['statusVerificationPath']]
                with self.assertRaises(FileNotFoundError):
                    N.final_retirement_fence(runtime, context, fixture.state, scope)

    def test_final_fence_refuses_late_terminal_or_sidecar_mutation(self):
        for path in (R.TERMINAL_PATH, R.PATHS[0] + '.provenance'):
            with self.subTest(path=path), A.Ancestry() as fixture:
                runtime, observed, plan, forecast, scope = self.context(fixture)
                context = N.retirement_context(runtime, observed, plan, forecast, scope, True)
                fixture.fixture.files[path] += b'changed'
                with self.assertRaisesRegex(ValueError, 'Evidence bytes differ'):
                    N.final_retirement_fence(runtime, context, fixture.state, scope)

    def test_final_fence_refuses_changed_pair_or_reappeared_payload(self):
        with A.Ancestry() as fixture:
            runtime, observed, plan, forecast, scope = self.context(fixture)
            context = N.retirement_context(runtime, observed, plan, forecast, scope, True)
            fixture.fixture.pair['current']['fields']['release_id'] = 'unadmitted-release'
            with self.assertRaisesRegex(ValueError, 'lacks descendant admission'):
                N.final_retirement_fence(runtime, context, fixture.state, scope)
        with A.Ancestry() as fixture:
            runtime, observed, plan, forecast, scope = self.context(fixture)
            context = N.retirement_context(runtime, observed, plan, forecast, scope, True)
            with patch.object(N.os.path, 'lexists', lambda path: str(path) == R.PATHS[0]):
                with self.assertRaisesRegex(ValueError, 'Retired payload reappeared'):
                    N.final_retirement_fence(runtime, context, fixture.state, scope)


if __name__ == '__main__':
    unittest.main()
