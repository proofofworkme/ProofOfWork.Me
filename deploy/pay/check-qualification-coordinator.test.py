#!/usr/bin/env python3
"""Offline fixtures only. No SSH, native controller, or production access."""
import contextlib
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
import time
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("handoff", Path(__file__).with_name("qualification-coordinator.py"))
M = importlib.util.module_from_spec(spec)
spec.loader.exec_module(M)


def manifest():
    return {"format": "pay-qualification-handoff-v1", "checker": {"path": "/tmp/checker.sh", "sha256": "a" * 64}, "runner": {"path": "/tmp/runner.py", "sha256": "b" * 64}, "evidence": "/tmp/attempt/checker.log", "ssh": {"account": "powadmin", "host": "192.0.2.1", "identityFile": "/home/operator/.ssh/node"}, "checkerTimeoutSeconds": 3}


def receipt(value=None):
    value = value or manifest()
    return (json.dumps({"evidence": value["evidence"], "bytes": 42, "sha256": "c" * 64}) + "\nchecker_exit=0 evidence_receiver_exit=0\n").encode()


class CoordinatorTests(unittest.TestCase):
    def test_strict_manifest(self):
        self.assertEqual(M.specification(json.dumps(manifest())), manifest())
        for mutate in [lambda x: x.update(extra=True), lambda x: x["ssh"].update(host="x;touch /tmp/no"), lambda x: x["ssh"].update(account="-oProxyCommand=x"), lambda x: x["ssh"].update(identityFile="/tmp/../key"), lambda x: x["runner"].update(sha256="0" * 63), lambda x: x.update(checkerTimeoutSeconds=True), lambda x: x.update(checkerTimeoutSeconds=8101), lambda x: x.update(evidence="/tmp//result")]:
            value = manifest()
            mutate(value)
            with self.subTest(value=value), self.assertRaises(ValueError):
                M.specification(json.dumps(value))

    def test_metadata_requires_both_statuses_and_exact_receipt(self):
        self.assertEqual(M.metadata(receipt(), 0, manifest()["evidence"])["bytes"], 42)
        for raw, status, evidence in [(receipt(), 1, manifest()["evidence"]), (receipt().replace(b"receiver_exit=0", b"receiver_exit=1"), 0, manifest()["evidence"]), (receipt(), 0, "/tmp/wrong"), (receipt() + b"extra\n", 0, manifest()["evidence"]), (b"x" * 16385, 0, manifest()["evidence"]), (receipt().replace(b"42", b"true"), 0, manifest()["evidence"])]:
            with self.subTest(raw=raw[:100]), self.assertRaises(ValueError):
                M.metadata(raw, status, evidence)

    def test_reviewed_bytes_hash_modes_links(self):
        with tempfile.TemporaryDirectory() as temp:
            p = Path(temp) / "source"
            p.write_bytes(b"reviewed")
            p.chmod(0o600)
            digest = hashlib.sha256(b"reviewed").hexdigest()
            self.assertEqual(M.reviewed(str(p), digest, 20), b"reviewed")
            with self.assertRaises(ValueError):
                M.reviewed(str(p), "0" * 64, 20)
            with self.assertRaises(ValueError):
                M.reviewed(str(p), digest, 2)
            p.chmod(0o644)
            with self.assertRaises(ValueError):
                M.reviewed(str(p), digest, 20)
            p.chmod(0o600)
            link = Path(temp) / "link"
            link.symlink_to(p)
            with self.assertRaises(ValueError):
                M.reviewed(str(link), digest, 20)
            link.unlink()
            os.link(p, link)
            with self.assertRaises(ValueError):
                M.reviewed(str(p), digest, 20)

    def test_writable_ancestor_refused(self):
        with tempfile.TemporaryDirectory() as temp:
            p = Path(temp) / "source"
            p.write_bytes(b"x")
            p.chmod(0o600)
            Path(temp).chmod(0o777)
            with self.assertRaises(ValueError):
                M.reviewed(str(p), hashlib.sha256(b"x").hexdigest(), 20)

    def test_actual_bash_bytes_and_exit(self):
        raw, status = M.checker_output(b"printf exact-output; exit 17\n", 3, {"PATH": "/usr/bin:/bin"})
        self.assertEqual((raw, status), (b"exact-output", 17))

    def test_checker_overflow_and_timeout_refuse(self):
        for source, timeout in [(b"head -c 16385 /dev/zero\n", 3), (b"sleep 2\n", 0.1)]:
            with self.subTest(source=source), self.assertRaises((ValueError, RuntimeError)):
                M.checker_output(source, timeout, {"PATH": "/usr/bin:/bin"})

    def test_exited_leader_inherited_pipe_is_uncertain_not_signaled(self):
        with patch.object(M.os, "killpg") as kill:
            with self.assertRaisesRegex(RuntimeError, "leader exited; reconcile descendants"):
                M.checker_output(b"sleep .3 & exit 0\n", .1, {"PATH": "/usr/bin:/bin"})
            kill.assert_not_called()
        time.sleep(.25)  # Bound this harmless orphan fixture lifetime.

    def test_exact_fixed_ssh_no_shell_option(self):
        args = M.native_command(manifest(), "c" * 64)
        self.assertEqual(args[-2], "powadmin@192.0.2.1")
        self.assertEqual(args[-1], "sudo -n /usr/bin/python3 -I -B - " + "c" * 64)
        self.assertIn("StrictHostKeyChecking=yes", args)
        self.assertNotIn("-A", args)

    def test_immediate_handoff_no_outer_timeout_or_second_run(self):
        class Result:
            returncode = 255
        with patch.object(M, "checker_output", return_value=(receipt(), 0)) as checker, patch.object(M.subprocess, "run", return_value=Result()) as native, contextlib.redirect_stdout(io.StringIO()) as out:
            self.assertEqual(M.execute(manifest(), b"checker", b"runner"), 255)
            checker.assert_called_once()
            native.assert_called_once()
            self.assertEqual(native.call_args.kwargs["input"], b"runner")
            self.assertNotIn("timeout", native.call_args.kwargs)
            self.assertNotIn("shell", native.call_args.kwargs)
            self.assertIn("uncertainOutcomeRequiresReconciliation", out.getvalue())
            self.assertIn("nativeReceiptVerificationRequired", out.getvalue())
            final = json.loads(out.getvalue().splitlines()[-1])
            self.assertEqual(final["phase"], "native-dispatch-uncertain")
            self.assertIs(final["doNotRetry"], True)

    def test_duplicate_keys_refused(self):
        with self.assertRaises(ValueError):
            M.exact_json(bytes([123, 34]) + b"x" + bytes([34]) + b":1," + bytes([34]) + b"x" + bytes([34]) + b":2}")

    def test_bounded_large_launcher_stream(self):
        source = b"#" + b"x" * 65536 + b"\nprintf intact\n"
        self.assertEqual(M.checker_output(source, 3, {"PATH": "/usr/bin:/bin"}), (b"intact", 0))

    def test_zero_native_exit_still_requires_receipt(self):
        class Result:
            returncode = 0
        with patch.object(M, "checker_output", return_value=(receipt(), 0)), patch.object(M.subprocess, "run", return_value=Result()), contextlib.redirect_stdout(io.StringIO()) as out:
            self.assertEqual(M.execute(manifest(), b"checker", b"runner"), 0)
            final = json.loads(out.getvalue().splitlines()[-1])
            self.assertEqual(final["phase"], "native-dispatch-terminal")
            self.assertIs(final["nativeReceiptVerificationRequired"], True)

    def test_uncertain_native_exception_not_retried(self):
        with patch.object(M, "checker_output", return_value=(receipt(), 0)), patch.object(M.subprocess, "run", side_effect=OSError("transport failed")) as native, contextlib.redirect_stdout(io.StringIO()) as out:
            with self.assertRaises(OSError):
                M.execute(manifest(), b"checker", b"runner")
            native.assert_called_once()
            self.assertIn("native-dispatch-uncertain", out.getvalue())
            self.assertIn("doNotRetry", out.getvalue())

    def test_failure_never_dispatches(self):
        for raw, code in [(receipt(), 1), (b"bad", 0)]:
            with patch.object(M, "checker_output", return_value=(raw, code)), patch.object(M.subprocess, "run") as native:
                with self.assertRaises(ValueError):
                    M.execute(manifest(), b"checker", b"runner")
                native.assert_not_called()


if __name__ == "__main__":
    unittest.main()
