#!/usr/bin/python3 -I -B
"""Exact-path/AST fixtures; no installed helper edits or remote operations."""
import ast
import copy
import contextlib
import importlib.util
import io
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import patch

ROOT = Path('/home/sixer/ProofOfWork.Me')
RELEASE = '38ac6e2bff2a-20261003T190512Z'
PARENT = Path('/var/backups/proofofwork-ui/transport-evidence')/RELEASE
STAGER = Path('/tmp/pow-audit30-item2-ui-preserved-stager-v1.py')
RECEIVER = Path('/tmp/pow-audit30-item2-ui-preserved-source-receiver-v1.py')

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

if __name__ == '__main__':
    unittest.main()
