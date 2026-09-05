#!/usr/bin/env python3
"""Bounded audit installer rejection cases; no services or production paths run."""
import copy
import importlib.util
import os
from pathlib import Path
import subprocess
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch, MagicMock

SPEC = importlib.util.spec_from_file_location("ops", Path(__file__).resolve().parents[1] / "deploy/audit5/install-ops.py")
OPS = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(OPS)
COMMIT = "a" * 40


def manifest(host="ui"):
    return {"format": "audit5-operations-install-review-v1", "sourceCommit": COMMIT,
            "hosts": {host: {"files": [{"source": "deploy/" + source, "destination": target,
                                      "mode": mode, "sha256": "b" * 64, "bytes": 1}
                                     for source, target, mode in OPS.TARGETS[host]]}}}


class InstallerTests(unittest.TestCase):
    def test_main_requires_isolation_before_external_imports(self):
        with tempfile.TemporaryDirectory(prefix="pow-ops-import-") as name:
            marker = Path(name) / "unsafe-import"
            (Path(name) / "argparse.py").write_text("open(" + repr(str(marker)) + ", 'w').write('bad')\n")
            result = subprocess.run([sys.executable, str(Path(OPS.__file__)), "--help"],
                                    env={**os.environ, "PYTHONPATH": name}, capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("python3 -I", result.stderr)
            self.assertFalse(marker.exists())

    def test_only_lock_run_mount_boundary_allowed(self):
        # Read actual Linux /run directories; normalize namespace-mapped owner
        # IDs only. Inject mounts so this works whether the harness binds /run.
        original = Path.lstat
        def owned(path):
            source = original(path)
            return SimpleNamespace(st_mode=source.st_mode, st_uid=0)
        with patch.object(Path, "lstat", owned), \
                patch.object(OPS.os.path, "ismount", side_effect=lambda p: str(p) == "/run"):
            OPS.directory("/run/systemd", allow_run_mount=True)
            with self.assertRaisesRegex(RuntimeError, "nested mount: /run"):
                OPS.directory("/run/systemd")
        with patch.object(Path, "lstat", owned), \
                patch.object(OPS.os.path, "ismount", side_effect=lambda p: str(p) in {"/run", "/run/systemd"}):
            with self.assertRaisesRegex(RuntimeError, "nested mount: /run/systemd"):
                OPS.directory("/run/systemd", allow_run_mount=True)

    def test_exact_fourteen_host_targets(self):
        self.assertEqual(sum(len(OPS.validate_manifest(manifest(host), host, COMMIT))
                             for host in ["node", "ui"]), 14)

    def test_commit_mismatch(self):
        with self.assertRaisesRegex(RuntimeError, "commit mismatch"):
            OPS.validate_manifest(manifest(), "ui", "c" * 40)

    def test_extra_missing_duplicate_or_redirected_target(self):
        for mutation in [lambda f: f.append(copy.deepcopy(f[0])), lambda f: f.pop(),
                         lambda f: f.__setitem__(1, copy.deepcopy(f[0])),
                         lambda f: f[0].update(destination="/etc/passwd"),
                         lambda f: f[0].update(source="../etc/passwd"),
                         lambda f: f[0].update(mode="0777")]:
            data = manifest()
            mutation(data["hosts"]["ui"]["files"])
            with self.assertRaisesRegex(RuntimeError, "exact target list mismatch"):
                OPS.validate_manifest(data, "ui", COMMIT)

    def test_digest_and_size_bounds(self):
        for values in [{"sha256": "oops"}, {"bytes": 0}, {"bytes": 1048577}]:
            data = manifest()
            data["hosts"]["ui"]["files"][0].update(values)
            with self.assertRaisesRegex(RuntimeError, "digest/size"):
                OPS.validate_manifest(data, "ui", COMMIT)

    def read_fixture(self, mutation=None, second_stat_change=False):
        with tempfile.TemporaryDirectory(prefix="pow-ops-installer-") as name:
            path = Path(name) / "source"
            path.write_bytes(b"safe bounded source\n")
            path.chmod(0o600)
            if mutation:
                mutation(path)
            original = os.fstat
            calls = 0
            def root_stat(fd):
                nonlocal calls
                calls += 1
                source = original(fd)
                result = SimpleNamespace(**{key: getattr(source, key) for key in
                    ["st_mode", "st_nlink", "st_size", "st_dev", "st_ino", "st_mtime_ns", "st_ctime_ns", "st_gid"]}, st_uid=0)
                if second_stat_change and calls == 2:
                    result.st_ctime_ns += 1
                return result
            with patch.object(OPS, "directory"), patch.object(OPS.os, "fstat", side_effect=root_stat):
                return OPS.read_file(path)

    def test_bounded_read(self):
        payload, state = self.read_fixture()
        self.assertEqual(payload, b"safe bounded source\n")
        self.assertEqual(state["mode"], "0o600")

    def test_hardlink_source_refused(self):
        with self.assertRaisesRegex(RuntimeError, "unsafe file"):
            self.read_fixture(lambda p: os.link(p, p.parent / "alias"))

    def test_oversized_source_refused(self):
        with self.assertRaisesRegex(RuntimeError, "unsafe file"):
            self.read_fixture(lambda p: p.write_bytes(b"x" * 1048577))

    def test_symlink_source_refused(self):
        def link(path):
            destination = path.with_name("actual")
            path.rename(destination)
            path.symlink_to(destination)
        with self.assertRaises(OSError):
            self.read_fixture(link)

    def test_source_change_during_read_refused(self):
        with self.assertRaisesRegex(RuntimeError, "changed during read"):
            self.read_fixture(second_stat_change=True)

    def test_private_receipt_never_overwrites(self):
        with tempfile.TemporaryDirectory(prefix="pow-ops-receipt-") as name:
            path = Path(name) / "before"
            OPS.exclusive_write(path, b"original")
            with self.assertRaises(FileExistsError):
                OPS.exclusive_write(path, b"replacement")
            self.assertEqual(path.read_bytes(), b"original")

    def test_inherited_ui_lock_identity_and_close_on_failure(self):
        lock = MagicMock()
        lock.lstat.return_value = SimpleNamespace(st_mode=0o100600, st_uid=0, st_dev=1, st_ino=2)
        with patch.object(OPS, "Path", return_value=lock), patch.object(OPS, "directory"), \
                patch.dict(os.environ, {"POW_UI_DEPLOY_LOCK_FD": "9"}), \
                patch.object(OPS.os, "dup", return_value=99) as duplicate, \
                patch.object(OPS.os, "fstat", return_value=SimpleNamespace(st_dev=1, st_ino=2)), \
                patch.object(OPS.fcntl, "flock") as flock, patch.object(OPS.os, "close") as close:
            self.assertEqual(OPS.ui_lock(), 99)
            duplicate.assert_called_once_with(9)
            flock.assert_called_once_with(99, OPS.fcntl.LOCK_EX | OPS.fcntl.LOCK_NB)
            close.assert_not_called()
            with patch.object(OPS.os, "fstat", return_value=SimpleNamespace(st_dev=1, st_ino=3)):
                with self.assertRaisesRegex(RuntimeError, "lock identity mismatch"):
                    OPS.ui_lock()
            close.assert_called_once_with(99)


if __name__ == "__main__":
    unittest.main(verbosity=2)
