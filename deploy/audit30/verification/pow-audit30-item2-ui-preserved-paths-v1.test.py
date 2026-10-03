#!/usr/bin/python3 -I -B
"""Exact-path/AST fixtures; no installed helper edits or remote operations."""
import ast
import copy
import contextlib
import importlib.util
import io
from pathlib import Path
import shlex
import subprocess
import sys
import types
import unittest
from unittest.mock import patch

ROOT = Path('/home/sixer/ProofOfWork.Me')
RELEASE = '38ac6e2bff2a-20261003T190512Z'
PARENT = Path('/var/backups/proofofwork-ui/transport-evidence')/RELEASE
STAGER = Path('/tmp/pow-audit30-item2-ui-preserved-stager-v1.py')
RECEIVER = Path('/tmp/pow-audit30-item2-ui-preserved-source-receiver-v1.py')
PROVENANCE = Path('/tmp/pow-audit30-item2-ui-preserved-provenance-v1.sh')
PUBLISHER = Path('/tmp/pow-audit30-item2-ui-preserved-publisher-v1.sh')
PROVENANCE_PATH = '/usr/local/lib/proofofwork-audit30-item2-ui-preserved-paths/'+RELEASE+'/provenance.sh'

def tree(path):
    return ast.parse(path.read_bytes())

def scope_if(module):
    for node in ast.walk(module):
        if isinstance(node, ast.If) and isinstance(node.test, ast.BoolOp):
            first = node.test.values[0]
            if isinstance(first, ast.Compare) and isinstance(first.left, ast.Name) and first.left.id == 'surfaces_root':
                return node
    raise AssertionError('Unique exact-path extension missing')

def rejected(release, source):
    node = scope_if(tree(STAGER))
    expression = ast.fix_missing_locations(ast.Expression(copy.deepcopy(node.test)))
    expected = Path('/var/tmp/proofofwork-deploy')/('proofofwork-ui-surfaces-'+release)/'surfaces'
    return eval(compile(expression, str(STAGER), 'eval'), {'Path': Path,
                'arguments': types.SimpleNamespace(release_id=release),
                'surfaces_root': source, 'expected_surfaces_root': expected})

def load_receiver():
    spec = importlib.util.spec_from_file_location('_preserved_receiver_fixture', RECEIVER)
    value = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = value
    spec.loader.exec_module(value)
    return value

class PreservedPaths(unittest.TestCase):
    def test_stager_entire_ast_unchanged_except_one_path_predicate(self):
        previous = tree(ROOT/'deploy/proofofwork-ui-release-stage.py')
        current = tree(STAGER)
        extension = scope_if(current)
        extension.test = copy.deepcopy(extension.test.values[0])
        self.assertEqual(ast.dump(current, include_attributes=False), ast.dump(previous, include_attributes=False))

    def test_exact_new_path_and_original_path_accept(self):
        self.assertFalse(rejected(RELEASE, PARENT/('proofofwork-ui-surfaces-'+RELEASE)/'surfaces'))
        self.assertFalse(rejected(RELEASE, Path('/var/tmp/proofofwork-deploy')/('proofofwork-ui-surfaces-'+RELEASE)/'surfaces'))

    def test_wrong_release_sibling_or_parent_paths_refuse(self):
        preserved = PARENT/('proofofwork-ui-surfaces-'+RELEASE)/'surfaces'
        self.assertTrue(rejected('other-release', preserved))
        self.assertTrue(rejected(RELEASE, preserved.parent))
        self.assertTrue(rejected(RELEASE, preserved.with_name('other-surfaces')))
        self.assertTrue(rejected(RELEASE, PARENT.parent/('proofofwork-ui-surfaces-'+RELEASE)/'surfaces'))

    def test_receiver_all_stream_verification_bodies_unchanged(self):
        previous = tree(ROOT/'deploy/audit5/stream-ui-bundle.py')
        current = tree(RECEIVER)
        old_without_main = [x for x in previous.body if not isinstance(x, ast.FunctionDef) or x.name != 'main']
        new_without_main = [x for x in current.body if not isinstance(x, ast.FunctionDef) or x.name != 'main']
        self.assertEqual([ast.dump(x, include_attributes=False) for x in new_without_main],
                         [ast.dump(x, include_attributes=False) for x in old_without_main])

    def test_receiver_main_binds_only_fixed_new_parent_and_source(self):
        value = load_receiver()
        with patch.object(value.os, 'geteuid', return_value=0), patch.object(value.os, 'getegid', return_value=0), \
             patch.object(value.sys, 'argv', ['receiver', 'source', RELEASE, '12', 'a'*64]), \
             patch.object(value, 'receive', return_value={'status': 'fixture'}) as receive, \
             contextlib.redirect_stdout(io.StringIO()):
            value.main()
        self.assertEqual(receive.call_count, 1)
        self.assertEqual(receive.call_args.args[0:4], ('source', RELEASE, 12, 'a'*64))
        self.assertEqual(receive.call_args.args[5], PARENT)
        self.assertEqual(receive.call_args.args[6], Path('/run/proofofwork-ui/deploy.lock'))

    def test_receiver_wrong_mode_or_release_never_calls_stream(self):
        for mode, release in [('surfaces', RELEASE), ('source', 'other-release')]:
            value = load_receiver()
            with patch.object(value.os, 'geteuid', return_value=0), patch.object(value.os, 'getegid', return_value=0), \
                 patch.object(value.sys, 'argv', ['receiver', mode, release, '12', 'a'*64]), \
                 patch.object(value, 'receive') as receive:
                with self.assertRaisesRegex(RuntimeError, 'Exact item2 preserved source scope'):
                    value.main()
                receive.assert_not_called()

    def test_provenance_entire_source_unchanged_except_exact_path_case(self):
        new_case = ('      "'+str(PARENT/('proofofwork-ui-source-'+RELEASE))+'") ;;\n').encode()
        current = PROVENANCE.read_bytes()
        self.assertEqual(current.count(new_case), 1)
        self.assertEqual(current.replace(new_case, b''),
                         (ROOT/'deploy/proofofwork-ui-release-provenance.sh').read_bytes())

    def test_publisher_entire_source_unchanged_except_two_exact_metadata_predicates(self):
        current = PUBLISHER.read_bytes()
        new_helper = ('  { [[ "${provenance_script}" != "/usr/local/sbin/proofofwork-ui-release-provenance" ]] &&\n'
                      '    { [[ "${release_id}" != "'+RELEASE+'" ]] ||\n'
                      '      [[ "${provenance_script}" != "'+PROVENANCE_PATH+'" ]]; }; } ||\n').encode()
        old_helper = b'  [[ "${provenance_script}" != "/usr/local/sbin/proofofwork-ui-release-provenance" ]] ||\n'
        new_source = ('if [[ "${source_checkout}" != "${expected_source_checkout}" ]] &&\n'
                      '   { [[ "${release_id}" != "'+RELEASE+'" ]] ||\n'
                      '     [[ "${source_checkout}" != "'+str(PARENT/('proofofwork-ui-source-'+RELEASE))+'" ]]; }; then\n').encode()
        old_source = b'if [[ "${source_checkout}" != "${expected_source_checkout}" ]]; then\n'
        self.assertEqual(current.count(new_helper), 1)
        self.assertEqual(current.count(new_source), 1)
        restored = current.replace(new_helper, old_helper).replace(new_source, old_source)
        self.assertEqual(restored, (ROOT/'deploy/proofofwork-ui-release-publish.sh').read_bytes())

    def test_bash_exact_source_and_helper_predicates(self):
        text = PUBLISHER.read_text()
        source = text[text.index('if [[ "${source_checkout}" != "${expected_source_checkout}" ]] &&'):]
        source = source.split('; then\n', 1)[0] + '; then exit 1; else exit 0; fi'
        helper = text[text.index('  { [[ "${provenance_script}" != "/usr/local/sbin/proofofwork-ui-release-provenance" ]] &&'):]
        helper = 'if '+helper.split(' } ||\n', 1)[0].strip()+' }; then exit 1; else exit 0; fi'
        for name in (PROVENANCE, PUBLISHER):
            self.assertEqual(subprocess.run(['/bin/bash', '-n', str(name)], capture_output=True).returncode, 0)
        preserved_source = str(PARENT/('proofofwork-ui-source-'+RELEASE))
        for release, source_path, expected_code in [
            (RELEASE, preserved_source, 0),
            (RELEASE, '/var/tmp/proofofwork-deploy/proofofwork-ui-source-'+RELEASE, 0),
            ('other-release', preserved_source, 1),
            (RELEASE, preserved_source+'-sibling', 1)]:
            prefix = 'release_id='+shlex.quote(release)+'; source_checkout='+shlex.quote(source_path)+ \
                     '; expected_source_checkout='+shlex.quote('/var/tmp/proofofwork-deploy/proofofwork-ui-source-'+release)+'; '
            result = subprocess.run(['/bin/bash', '-c', prefix+source], capture_output=True)
            self.assertEqual(result.returncode, expected_code, result.stderr)
        for release, helper_path, expected_code in [
            (RELEASE, PROVENANCE_PATH, 0),
            ('other-release', '/usr/local/sbin/proofofwork-ui-release-provenance', 0),
            ('other-release', PROVENANCE_PATH, 1),
            (RELEASE, PROVENANCE_PATH+'-sibling', 1)]:
            prefix = 'release_id='+shlex.quote(release)+'; provenance_script='+shlex.quote(helper_path)+'; '
            result = subprocess.run(['/bin/bash', '-c', prefix+helper], capture_output=True)
            self.assertEqual(result.returncode, expected_code, result.stderr)

if __name__ == '__main__':
    unittest.main()
