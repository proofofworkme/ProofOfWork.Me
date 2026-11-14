#!/usr/bin/env python3
"""Exercise additive V5 -> V6 publication and refusal using isolated fixtures."""
from pathlib import Path
import shutil
import sys
import unittest

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
namespace = {'__name__': 'pay_fixture_helpers', '__file__': str(ROOT / 'scripts/check-ui-permission-release.py')}
exec(compile(Path(namespace['__file__']).read_bytes(), namespace['__file__'], 'exec'), namespace)
PermissionRelease = namespace['PermissionRelease']
stage, builder, write, module = (namespace[name] for name in ('stage', 'builder', 'write', 'module'))
retention = namespace['retention']
installer = module('pay_ui_installer', ROOT / 'deploy/search/install-ui.py')
closed = module('pay_closed_input_tests', ROOT / 'deploy/publish/check-closed-input.test.py')
storage = module('pay_retention_storage', ROOT / 'deploy/audit30/ui-storage.py')


class PayRelease(unittest.TestCase):
    setUp, tearDown = PermissionRelease.setUp, PermissionRelease.tearDown
    run_command, populate, archive, record, stage = (getattr(PermissionRelease, name) for name in
        ('run_command', 'populate', 'archive', 'record', 'stage'))
    publish_args, manifest_fields = PermissionRelease.publish_args, PermissionRelease.manifest_fields

    def test_exact_additive_families_and_preserved_limits(self):
        self.assertEqual(len(stage.PERMISSION_SURFACES), 22)
        self.assertEqual(len(stage.PAY_SURFACES), 23)
        self.assertEqual(set(stage.PAY_SURFACES), set(stage.PERMISSION_SURFACES) | {'pay'})
        self.assertEqual(set(builder.PAY_SURFACES) | {'nft'}, set(stage.PAY_SURFACES))
        self.assertEqual(builder.PAY_SURFACES['pay'], ('pay', 'VITE_PAY_ONLY'))
        self.assertEqual(stage.prior_asset_parser(stage.PAY_SURFACES)[0], stage.V5_MAXIMUM_DEPENDENCIES)
        self.assertEqual(stage.prior_asset_parser(stage.PERMISSION_SURFACES)[0], stage.V5_MAXIMUM_DEPENDENCIES)

    def test_v6_publication_rollback_and_no_product_downgrade(self):
        self.populate(self.www, stage.PERMISSION_SURFACES, managed=True)
        write(self.www / 'operator-evidence/keep.txt', 'preserve exact evidence\n')
        baseline = self.archive(self.www, stage.PERMISSION_SURFACES, self.baseline_id)
        self.record(self.baseline_id, baseline)
        self.run_command([self.provenance, 'verify'])
        before = stage.tree_fingerprint(self.www)
        candidate, _ = self.stage(self.release_id, stage.PAY_SURFACES)
        self.assertEqual(stage.tree_fingerprint(self.www), before)
        for surface in stage.PERMISSION_SURFACES:
            self.assertEqual((candidate / ('proofofwork-' + surface) / 'assets/old.js').read_bytes(),
                             (self.www / ('proofofwork-' + surface) / 'assets/old.js').read_bytes())
        self.assertFalse((candidate / 'proofofwork-pay/assets/old.js').exists())
        archive = self.archive(candidate, stage.PAY_SURFACES, self.release_id)
        args = self.publish_args(self.release_id, archive)
        self.run_command(args, {'POW_UI_PUBLISH_TEST_FAIL_AFTER_SWAP': '1'}, success=False)
        self.assertEqual(stage.tree_fingerprint(self.www), before)
        self.run_command(args)
        self.run_command([self.provenance, 'verify'])
        fields = self.manifest_fields()
        self.assertEqual(fields['format'], 'proofofwork-ui-release-v6')
        self.assertEqual({key.split('.')[1] for key in fields if key.startswith('surface.')}, set(stage.PAY_SURFACES))
        self.assertEqual(retention.verified_release(self.www, self.archives)['format'], 'proofofwork-ui-release-v6')
        rollback = self.rollbacks / ('proofofwork-www-pre-' + self.release_id)
        self.assertEqual(stage.tree_fingerprint(rollback), before)
        self.assertEqual(retention.verified_release(rollback, self.archives)['format'], 'proofofwork-ui-release-v5')
        _, refused = self.stage(self.commit[:12] + '-20261114T010003Z', stage.PERMISSION_SURFACES, success=False)
        self.assertIn('drop a live Pay', refused.stderr)

    def test_caddy_requires_exact_complete_pay_publication(self):
        fields = {'format': 'proofofwork-ui-release-v6', 'release_id': self.release_id,
                  'commit': self.commit, 'source_tree': 'b' * 40}
        for name in stage.PAY_SURFACES:
            fields['surface.' + name + '.sha256'] = 'c' * 64
            fields['surface.' + name + '.file_count'] = '2'
        raw = lambda: ('\n'.join(key + '=' + value for key, value in fields.items()) + '\n').encode()
        plan = {'schema': 'proof-of-work-pay-ui-install-v1', 'releaseId': self.release_id,
                'commit': self.commit, 'tree': 'b' * 40}
        installer.check_published(raw(), plan)
        self.assertEqual(storage.declared_surfaces(fields), frozenset(stage.PAY_SURFACES))
        del fields['surface.pay.sha256']
        with self.assertRaises(ValueError): installer.check_published(raw(), plan)
        with self.assertRaises(ValueError): storage.declared_surfaces(fields)
        fields['surface.pay.sha256'] = 'c' * 64
        fields['format'] = 'proofofwork-ui-release-v5'
        with self.assertRaises(ValueError): installer.check_published(raw(), plan)
        with self.assertRaises(ValueError): storage.declared_surfaces(fields)


class PayClosedInput(unittest.TestCase):
    def setUp(self):
        closed.ClosedInputTests.setUpClass()
        self.fixture = closed.ClosedInputTests()
        self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)

    def test_closed_v5_to_v6_budget_agrees_with_actual_staging(self):
        fixture = self.fixture
        incoming = fixture.incoming / 'surfaces'
        shutil.copytree(incoming / 'permission', incoming / 'pay')
        fixture.names = sorted(fixture.phase.PAY_SURFACES)
        fixture.pack()
        evidence = fixture.assess()
        self.assertEqual(evidence['dependencyCounters']['dependencies'], 2 * 22)
        budget = fixture.phase.stage_budget(incoming, fixture.live, fixture.stager,
                                           owner=closed.os.getuid())
        self.assertEqual(evidence['archive'], budget['modeledManagedArchive'])
        self.assertEqual(evidence['priorDependenciesSha256'], budget['priorDependenciesSha256'])
        shutil.copytree(fixture.live / 'proofofwork-permission', fixture.live / 'proofofwork-pay')
        self.assertEqual(fixture.assess()['dependencyCounters']['dependencies'], 2 * 23)
        shutil.rmtree(incoming / 'pay')
        fixture.names = sorted(fixture.phase.PERMISSION_SURFACES)
        fixture.pack()
        with self.assertRaisesRegex(ValueError, 'without downgrade'): fixture.assess()


del PermissionRelease  # The imported fixture is not a second test suite.

if __name__ == '__main__': unittest.main()
