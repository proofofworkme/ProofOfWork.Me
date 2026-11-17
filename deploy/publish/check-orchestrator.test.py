#!/usr/bin/env python3
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import types
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('orchestrator', Path(__file__).with_name('orchestrator.py'))
O = importlib.util.module_from_spec(spec); spec.loader.exec_module(O)


class JournalTests(unittest.TestCase):
    def setUp(self):
        self.old_umask = os.umask(0o077)
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.journal = self.root / 'journal'; self.journal.mkdir(mode=0o700)
        self.build = self.root / 'build.json'
        self.build.write_text(json.dumps({'commit': 'a'*40, 'tree': 'b'*40}))
        self.s = {'schema': O.FORMAT, 'repository': str(self.root), 'commit': 'a'*40,
                  'tree': 'b'*40, 'role': 'node', 'phase': 'prepare-closed-input',
                  'inputs': {'buildReceipt': O.pin(self.build)}, 'attempt': 'test',
                  'privateStaging': True, 'existingInventory': False}
        self.sha = 'c'*64
        self.source = patch.object(O, 'source', return_value=self.root); self.source.start()
        self.calls = []

    def tearDown(self):
        self.source.stop(); self.tmp.cleanup(); os.umask(self.old_umask)

    def native(self, argv, **kwargs):
        self.calls.append(argv)
        phase = next(part for part in argv if part in O.PHASES)
        output = self.journal / (phase + '.output.json')
        if phase == 'make-plan':
            value = {'retentionDeferred': True, 'frontendOnly': True, 'commit': self.s['commit'],
                     'tree': self.s['tree'], 'publicationAttempt': 'test', 'inputStorage': 'deploy-scratch-v1'}
        elif phase == 'publish':
            value = {'ok': True, 'allPriorRootsPreserved': True, 'manifestSha256': 'd'*64,
                     'archiveSha256': 'e'*64, 'newRollbackRoot': {'root': '/verified-native-root'}}
        else:
            value = {'nativeFixture': True}
        if phase != 'upload-plan':
            output.write_text(json.dumps(value)+'\n')
        if phase == 'prepare-closed-input':
            Path(str(output) + '.zlib').write_bytes(b'fixture inventory')
        kwargs['stdout'].write(b'native fixture completed\n')
        return types.SimpleNamespace(returncode=0)

    def choose(self, phase):
        self.s['phase'] = phase
        self.s['role'] = 'node' if phase in O.ROLES['node'] else 'ui'
        self.s['privateStaging'] = phase == 'prepare-closed-input'
        inputs = {}
        for name in O.INPUTS[phase]:
            path = self.root / (name + '.json')
            value = {'commit': self.s['commit'], 'tree': self.s['tree']}
            if name == 'plan':
                value.update(retentionDeferred=True, frontendOnly=True, publicationAttempt='test', inputStorage='deploy-scratch-v1')
            path.write_text(json.dumps(value)); inputs[name] = O.pin(path)
        if phase == 'preflight':
            inventory = Path(inputs['closedRequest']['path'] + '.zlib'); inventory.write_bytes(b'inventory')
            inputs['closedInventory'] = O.pin(inventory)
            request = json.loads(Path(inputs['closedRequest']['path']).read_text())
            request['inventorySha256'] = inputs['closedInventory']['sha256']
            Path(inputs['closedRequest']['path']).write_text(json.dumps(request))
            inputs['closedRequest'] = O.pin(inputs['closedRequest']['path'])
        self.s['inputs'] = inputs

    def advance(self, count):
        self.assertEqual(count, 1)
        with patch.object(O.subprocess, 'run', side_effect=self.native):
            O.run_phase(self.journal, self.s, self.sha, self.s['phase'])

    def test_all_fixed_phases_do_not_claim_release_or_delete(self):
        for phase in O.PHASES:
            self.choose(phase)
            self.journal = self.root / phase; self.journal.mkdir(mode=0o700)
            self.advance(1)
            self.assertIsNone(O.check_history(self.journal, self.s, self.sha))
        self.assertEqual(len(self.calls), 5)
        self.assertIn('--input-storage', self.calls[2]); self.assertIn('deploy-scratch-v1', self.calls[2])
        self.assertFalse(any('complete' in call or 'enable' in call for call in self.calls))
        self.assertNotIn('--ui-host', self.calls[0]); self.assertIn('--ui-host', self.calls[1])

    def test_next_phase_only(self):
        with self.assertRaisesRegex(ValueError, 'next unattempted'):
            O.run_phase(self.journal, self.s, self.sha, 'publish')

    def test_completed_phase_cannot_repeat(self):
        self.advance(1)
        with self.assertRaisesRegex(ValueError, 'next unattempted'):
            O.run_phase(self.journal, self.s, self.sha, O.PHASES[0])

    def test_intent_precedes_native_and_interruption_blocks(self):
        def interrupted(argv, **kwargs):
            self.assertTrue((self.journal / 'prepare-closed-input.intent.json').exists())
            raise KeyboardInterrupt()
        with patch.object(O.subprocess, 'run', side_effect=interrupted), self.assertRaises(KeyboardInterrupt):
            O.run_phase(self.journal, self.s, self.sha, O.PHASES[0])
        with self.assertRaisesRegex(ValueError, 'Uncertain'):
            O.check_history(self.journal, self.s, self.sha)

    def test_nonzero_terminal_blocks_replay(self):
        with patch.object(O.subprocess, 'run', return_value=types.SimpleNamespace(returncode=1)):
            with self.assertRaisesRegex(ValueError, 'Native phase failed'):
                O.run_phase(self.journal, self.s, self.sha, O.PHASES[0])
        with self.assertRaisesRegex(ValueError, 'Failed or invalid'):
            O.check_history(self.journal, self.s, self.sha)

    def test_changed_input_refused(self):
        self.build.write_text('{}')
        with self.assertRaisesRegex(ValueError, 'pin changed'):
            O.run_phase(self.journal, self.s, self.sha, O.PHASES[0])

    def test_tampered_completed_output_refused(self):
        self.advance(1)
        (self.journal / 'prepare-closed-input.output.json').write_text('{}')
        with self.assertRaisesRegex(ValueError, 'pin changed'):
            O.check_history(self.journal, self.s, self.sha)

    def test_changed_spec_hash_refused(self):
        self.advance(1)
        with self.assertRaisesRegex(ValueError, 'Intent changed'):
            O.check_history(self.journal, self.s, 'f'*64)

    def test_final_ok_required_not_early_receipt(self):
        path = self.root / 'publish.log'; path.write_text(json.dumps({'exitCode': 0, 'failure': None}))
        with self.assertRaisesRegex(ValueError, 'final native'):
            O.successful_publication(path)

    def test_retention_and_activation_unavailable(self):
        for phase in ('complete', 'retention', 'enable', 'activate', 'shell'):
            with self.assertRaisesRegex(ValueError, 'not supported'):
                O.command(self.s, self.journal, phase)

    def test_actual_native_cli_parser_accepts_generated_arguments(self):
        native_path = Path(__file__).with_name('release.py')
        namespace = {'__name__': '_native_parser_fixture', '__file__': str(native_path)}
        exec(compile(native_path.read_bytes(), str(native_path), 'exec'), namespace)
        namespace['ROOT'] = self.root / 'deploy/publish'
        namespace['lifecycle_module'] = lambda: types.SimpleNamespace(require_ui_host=lambda repo: None)
        for phase in O.PHASES:
            self.choose(phase)
            captured = []
            name = phase.replace('-', '_')
            namespace[name] = lambda args: captured.append(args)
            with patch.object(O.sys, 'argv', O.command(self.s, self.journal, phase)[3:]):
                namespace['main']()
            self.assertEqual(captured[0].command, phase)
        self.assertEqual(captured[0].repo, self.root)

    def test_compressed_inventory_is_bound(self):
        self.advance(1)
        (self.journal / 'prepare-closed-input.output.json.zlib').write_bytes(b'tampered')
        with self.assertRaisesRegex(ValueError, 'pin changed'):
            O.check_history(self.journal, self.s, self.sha)

    def test_native_output_namespace_refused_before_intent(self):
        with self.assertRaisesRegex(ValueError, 'under /tmp'):
            O.run_phase(Path('/data/not-a-native-output'), self.s, self.sha, self.s['phase'])
        self.assertFalse((self.journal / 'prepare-closed-input.intent.json').exists())

    def test_writable_ancestor_refused(self):
        parent = self.root / 'writable'; parent.mkdir(mode=0o700)
        path = parent / 'input'; path.write_text('data')
        parent.chmod(0o777)
        try:
            with self.assertRaisesRegex(ValueError, 'Writable ancestor'):
                O.read(path)
            with self.assertRaisesRegex(ValueError, 'Writable ancestor'):
                O.journal_namespace(parent / 'journal')
        finally:
            parent.chmod(0o700)

    def test_symlink_ancestor_refused(self):
        parent = self.root / 'alias'; parent.symlink_to(self.journal, target_is_directory=True)
        with self.assertRaisesRegex(ValueError, 'ancestor owner or symlink'):
            O.journal_namespace(parent / 'child')

    def test_native_child_inherits_no_replace_objects(self):
        with patch.dict(os.environ, {'GIT_DIR': '/untrusted', 'GIT_NO_REPLACE_OBJECTS': '0'}):
            env = O.git_environment()
            self.assertNotIn('GIT_DIR', env)
            self.assertEqual(env['GIT_NO_REPLACE_OBJECTS'], '1')

    def test_wrong_host_role_refused(self):
        self.s['role'] = 'ui'
        with self.assertRaisesRegex(ValueError, 'host role'):
            O.validate_spec(self.s)

    def test_deletion_capable_plan_refused(self):
        self.choose('publish')
        path = Path(self.s['inputs']['plan']['path'])
        value = json.loads(path.read_text()); value['retentionDeferred'] = False
        path.write_text(json.dumps(value)); self.s['inputs']['plan'] = O.pin(path)
        with self.assertRaisesRegex(ValueError, 'deferred-retention'):
            O.validate_spec(self.s)

    def test_external_predecessor_tamper_refused(self):
        self.choose('make-plan')
        Path(self.s['inputs']['preflight']['path']).write_text('{}')
        with self.assertRaisesRegex(ValueError, 'pin changed'):
            O.validate_spec(self.s)

    def test_no_implicit_transport_or_shell(self):
        for phase in O.PHASES:
            self.choose(phase)
            argv = O.command(self.s, self.journal, phase)
            self.assertEqual(argv[:3], ['/usr/bin/python3', '-I', '-B'])
            self.assertNotIn('setsid', argv); self.assertNotIn('bash', argv)

    def test_symlink_and_hardlink_inputs_refused(self):
        link = self.root / 'link'; link.symlink_to(self.build)
        with self.assertRaises(ValueError): O.pin(link)
        link.unlink(); os.link(self.build, link)
        with self.assertRaises(ValueError): O.pin(link)

    def test_source_rechecked_after_native(self):
        with patch.object(O, 'source', side_effect=[self.root, ValueError('source drift')]), patch.object(O.subprocess, 'run', side_effect=self.native):
            with self.assertRaisesRegex(ValueError, 'source drift'):
                O.run_phase(self.journal, self.s, self.sha, O.PHASES[0])
        self.assertFalse((self.journal / 'prepare-closed-input.result.json').exists())


class SourceTests(unittest.TestCase):
    def test_native_private_source_permissions_are_safe_subsets(self):
        for mode in (0o400, 0o600, 0o640, 0o644):
            with self.subTest(mode=oct(mode)):
                self.assertTrue(O.source_mode_allowed(mode, b'100644'))
        for mode in (0o500, 0o700, 0o750, 0o755):
            with self.subTest(mode=oct(mode)):
                self.assertTrue(O.source_mode_allowed(mode, b'100755'))

    def test_source_permissions_reject_added_authority_or_missing_owner_access(self):
        for git_mode, modes in (
            (b'100644', (0o000, 0o200, 0o044, 0o664, 0o646, 0o744, 0o645, 0o4644, 0o2644, 0o1644)),
            (b'100755', (0o000, 0o300, 0o600, 0o655, 0o055, 0o775, 0o757, 0o4755, 0o2755, 0o1755)),
        ):
            for mode in modes:
                with self.subTest(git_mode=git_mode, mode=oct(mode)):
                    self.assertFalse(O.source_mode_allowed(mode, git_mode))

    def test_real_git_native_private_build_modes_accepted(self):
        with tempfile.TemporaryDirectory() as temp:
            repo = Path(temp)
            def git(*args):
                return subprocess.check_output(['git', '-C', temp, *args], stderr=subprocess.DEVNULL).decode().strip()
            git('init'); git('config', 'user.name', 'fixture'); git('config', 'user.email', 'fixture@example.invalid')
            regular = repo / 'source.py'; regular.write_text('private source\n'); regular.chmod(0o644)
            executable = repo / 'entry.sh'; executable.write_text('#!/bin/sh\nexit 0\n'); executable.chmod(0o755)
            git('add', '.'); git('commit', '-m', 'fixture')
            spec = {'repository': temp, 'commit': git('rev-parse', 'HEAD'), 'tree': git('rev-parse', 'HEAD^{tree}')}
            regular.chmod(0o600); executable.chmod(0o700)
            self.assertEqual(O.source(spec), repo)
            executable.chmod(0o600)
            with self.assertRaises(ValueError):
                O.source(spec)

    def test_real_git_bytes_modes_and_assume_unchanged(self):
        with tempfile.TemporaryDirectory() as temp:
            repo = Path(temp)
            def git(*args):
                return subprocess.check_output(['git', '-C', temp, *args], stderr=subprocess.DEVNULL).decode().strip()
            git('init'); git('config', 'user.name', 'fixture'); git('config', 'user.email', 'fixture@example.invalid')
            p = repo / 'entry.py'; p.write_text('original\n'); p.chmod(0o644)
            (repo / 'empty').touch(); (repo / 'empty').chmod(0o644)
            git('add', '.'); git('commit', '-m', 'fixture')
            spec = {'repository': temp, 'commit': git('rev-parse', 'HEAD'), 'tree': git('rev-parse', 'HEAD^{tree}')}
            self.assertEqual(O.source(spec), repo)
            git('update-index', '--assume-unchanged', 'entry.py'); p.write_text('mutated\n')
            with self.assertRaisesRegex(ValueError, 'Source bytes'):
                O.source(spec)
            p.write_text('original\n'); p.chmod(0o600)
            self.assertEqual(O.source(spec), repo)
            p.chmod(0o664)
            with self.assertRaisesRegex(ValueError, 'Source mode'):
                O.source(spec)


if __name__ == '__main__': unittest.main()
