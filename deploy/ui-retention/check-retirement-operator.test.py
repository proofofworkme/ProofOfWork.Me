#!/usr/bin/env python3
"""Operator admission tests only: no operator_main or production action invoked."""
import contextlib
import importlib.util
import io
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('operator_tests',Path(__file__).with_name('retirement_controller.py'))
C=importlib.util.module_from_spec(spec);spec.loader.exec_module(C)
R=C.R
H='1'*64
class OperatorTests(unittest.TestCase):
    def args(self,step,*extra):
        return [step,'--package-sha',H,'--config-sha',H,'--approval-sha',H,*extra]
    def test_prepare_accepts_required_pins(self):
        self.assertEqual(C.parse_operator_arguments(self.args('prepare')).step,'prepare')
    def test_missing_pin_rejected(self):
        with contextlib.redirect_stderr(io.StringIO()),self.assertRaises(SystemExit):
            C.parse_operator_arguments(['prepare','--package-sha',H])
    def test_invalid_hash_rejected(self):
        with self.assertRaises(ValueError):
            C.parse_operator_arguments(self.args('prepare','--config-sha','invalid'))
    def test_pending_requires_intent(self):
        with self.assertRaisesRegex(ValueError,'intent digest'):
            C.parse_operator_arguments(self.args('activate-pending'))
    def test_terminal_requires_receipt(self):
        with self.assertRaisesRegex(ValueError,'terminal receipt'):
            C.parse_operator_arguments(self.args('install-terminal','--intent-sha',H))
    def test_terminal_resume_requires_both_pins(self):
        a=C.parse_operator_arguments(self.args('install-terminal','--intent-sha',H,
                                              '--terminal-sha',H,'--resume'))
        self.assertTrue(a.resume)
    def test_remove_resume_forbidden(self):
        with self.assertRaisesRegex(ValueError,'Resume applies'):
            C.parse_operator_arguments(self.args('remove-next','--resume'))
    def test_omitted_lifecycle_never_executes(self):
        with tempfile.TemporaryDirectory() as tmp:
            base=Path(tmp);own='deploy/ui-retention/retirement_controller.py'
            source=b'# synthetic trusted operator'
            manifest={'schema':'pow-ui-retention-package-v1',
                      'files':{own:{'bytes':len(source),'sha256':R.digest(source)}}}
            raw=R.encoded(manifest);digest=R.digest(raw)
            root=base/'cleanup-evidence'/('ui-lifecycle-tools-'+digest)
            (root/'deploy/ui-retention').mkdir(parents=True)
            (root/own).write_bytes(source);(root/'package.json').write_bytes(raw)
            sentinel=base/'EXECUTED'
            (root/'deploy/ui-retention/lifecycle_remote.py').write_text(
                'from pathlib import Path\nPath('+repr(str(sentinel))+').write_text("bad")\nPACKAGE_FILES=()\n')
            def read(path,expected,limit=16*1024**2):
                p=Path(path);self.assertTrue(p.is_relative_to(base))
                b=p.read_bytes();self.assertEqual(R.digest(b),expected);return b
            def readraw(path,limit=16*1024**2):
                p=Path(path);self.assertTrue(p.is_relative_to(base));return p.read_bytes()
            with patch.object(C,'__file__',str(root/own)),patch.object(R,'BASE',str(base)),                  patch.object(R,'read_bound',side_effect=read),patch.object(R,'read_raw_bound',side_effect=readraw):
                with self.assertRaisesRegex(ValueError,'Lifecycle entrypoint absent'):
                    C.verified_operator_package(digest)
            self.assertFalse(sentinel.exists())
if __name__=='__main__':unittest.main()
