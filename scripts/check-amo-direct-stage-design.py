#!/usr/bin/env python3
"""Compare the ordinary and direct native stager constructors in disposable trees."""
import contextlib
import hashlib
import fcntl
import importlib.util
import io
import json
import os
from pathlib import Path
import shutil
import stat
import struct
import sys
import subprocess
import tempfile
import unittest
from unittest.mock import patch

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
stage = None


def setUpModule():
    global stage
    # Install exact source bytes with production helper permissions in private scratch.
    # A developer checkout can apply a group-writable umask to tracked executables.
    temporary = tempfile.TemporaryDirectory(prefix="pow-amo-fixture-helpers-")
    unittest.addModuleCleanup(temporary.cleanup)
    helpers = Path(temporary.name)
    for name in ("proofofwork-ui-release-stage.py", "proofofwork-ui-capacity.py"):
        shutil.copyfile(ROOT / "deploy" / name, helpers / name)
        (helpers / name).chmod(0o755)
    spec = importlib.util.spec_from_file_location("ui_stage", helpers / "proofofwork-ui-release-stage.py")
    stage = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(stage)

OWNER = os.geteuid()
RELEASE = "direct-design-fixture"
STAMP = 1700000000123456789


def write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    path.chmod(0o644)
    os.utime(path, ns=(STAMP, STAMP))
    return path


def entries(root):
    return [root, *sorted(root.rglob("*"))]


def inode(details):
    return details.st_dev, details.st_ino


def attrs(path):
    return tuple((name, os.getxattr(path, name, follow_symlinks=False))
                 for name in sorted(os.listxattr(path, follow_symlinks=False)))


def allocated(root):
    # Observed st_blocks, counted once per inode including directories.
    unique = {}
    for path in entries(root):
        details = path.lstat()
        unique[inode(details)] = details.st_blocks * 512
    return sum(unique.values())


def source_witness(root):
    # The production tree fingerprint checks types, ownership, mode and bytes.
    # Also pin source identity, aliases, xattrs and times (except atime, affected by reads).
    digest = stage.tree_fingerprint(root)
    identity = tuple((path.relative_to(root), stage.allocation_identity(path.lstat()), attrs(path))
                     for path in entries(root))
    return digest, identity


def comparable_tree(root):
    # Directory mtimes of managed assets and the root change as staging populates them.
    # Passthrough directory mtimes and all regular-file mtimes are stable.
    managed_names = {f"proofofwork-{surface}" for surface in stage.PAY_SURFACES}
    metadata, aliases = {}, {}
    for path in entries(root):
        relative = path.relative_to(root).as_posix()
        details = path.lstat()
        regular = stat.S_ISREG(details.st_mode)
        stable_time = regular or (relative != "." and relative.split("/")[0] not in managed_names)
        metadata[relative] = (details.st_mode, details.st_uid, details.st_gid, attrs(path),
                              details.st_mtime_ns if stable_time else None,
                              hashlib.sha256(path.read_bytes()).digest() if regular else None)
        if regular:
            aliases.setdefault(inode(details), []).append(relative)
    return metadata, sorted(sorted(group) for group in aliases.values())


class DirectStageDesign(unittest.TestCase):
    def setUp(self):
        self.addCleanup(os.umask, os.umask(0o022))
        temp = tempfile.TemporaryDirectory(prefix="pow-amo-direct-design-")
        self.addCleanup(temp.cleanup)
        self.base = Path(temp.name).resolve()
        self.live = self.base / "www"
        self.scratch = self.base / "scratch"
        self.incoming = self.scratch / f"proofofwork-ui-surfaces-{RELEASE}" / "surfaces"
        self.lock = self.base / "locks/deploy.lock"
        self.lock.parent.mkdir(mode=0o700)
        self.private = self.base / "private"
        self.private.mkdir(mode=0o700)
        self.candidate = self.private / "candidate"
        self.reference = self.scratch / f"proofofwork-www-stage-{RELEASE}"
        self.mountinfo = write(self.base / "mountinfo", b"1 0 0:1 / / rw - fixture fixture rw\n")
        self.env = patch.dict(os.environ, {"POW_UI_ALLOW_TEST_ROOTS": "1",
            "POW_UI_STAGE_WWW_ROOT": str(self.live), "POW_UI_STAGE_STAGING_ROOT": str(self.scratch),
            "POW_UI_DEPLOY_LOCK": str(self.lock), "POW_UI_MOUNTINFO_PATH": str(self.mountinfo)}, clear=True)
        self.env.start()
        self.addCleanup(self.env.stop)

        managed_blob = b"fixture managed\n" * 4096
        for surface in stage.PAY_SURFACES:
            old = self.live / f"proofofwork-{surface}"
            write(old / "index.html", b'<script src="/assets/previous.mjs"></script>')
            write(old / "assets/previous.mjs", b'import "./older.css";')
            write(old / "assets/older.css", b'body{background:url("./tile.png")}')
            write(old / "assets/tile.png", b"old tile")
            write(self.incoming / surface / "index.html", b'<script src="/assets/current.js"></script>')
            write(self.incoming / surface / "assets/current.js", managed_blob)
        # One old, unreferenced, positively allocated file exercises the avoided clone.
        write(self.live / "proofofwork-marketplace/unreferenced.bin", b"discarded managed\n" * 262144)
        write(self.live / stage.MANIFEST_NAME, b"old fixture release")
        retained = write(self.live / ".operator/file", managed_blob)
        self.sibling = self.live / "proofofwork-operator"
        self.sibling.mkdir()
        os.link(retained, self.sibling / "alias")
        os.link(retained, self.live / "proofofwork-pay/old-managed-alias")
        os.link(retained, self.live / "top-level-alias")
        (self.live / ".operator").chmod(0o750)
        os.utime(self.sibling, ns=(STAMP, STAMP))
        for path in [self.live, self.sibling, retained, self.incoming / "pay/assets/current.js"]:
            os.setxattr(path, "user.pow-design", b"exact fixture attribute")
        # Incoming compact aliases must become entirely candidate-local links.
        os.link(self.incoming / "pay/assets/current.js", self.incoming / "marketplace/assets/pay-copy.js")
        # Linux access and default POSIX ACLs exercise cp's metadata behavior.
        acl = struct.pack("<I", 2) + b"".join(struct.pack("<HHI", tag, perm, uid) for tag, perm, uid in
            [(1, 7, 0xffffffff), (2, 4, OWNER + 1000), (4, 5, 0xffffffff),
             (16, 5, 0xffffffff), (32, 5, 0xffffffff)])
        os.setxattr(self.live, "system.posix_acl_default", acl)
        os.setxattr(self.sibling, "system.posix_acl_access", acl)
        self.live_rows = stage.direct_tree_snapshot(self.live)
        self.input_rows = stage.direct_tree_snapshot(self.incoming.parent)
        self.pins = source_witness(self.live), source_witness(self.incoming)

    def native_stage(self, dedup, direct=False, final=64 * 1024**2, after_cp=None):
        arguments = ["stage", "--release-id", RELEASE, "--surfaces-root", str(self.incoming),
                     "--stage-root", str(self.reference)]
        if dedup:
            arguments.append("--deduplicate-managed-files")
        real_run = stage.run_checked
        measurements = {}
        def observe(command):
            if command[:2] == ["/usr/bin/sync", "--file-system"]:
                return
            real_run(command)
            if command[0] != "/usr/bin/cp":
                return
            if "--target-directory" in command:
                candidate = Path(command[command.index("--target-directory") + 1])
                measurements["seed"] = allocated(candidate)
                self.assertFalse((candidate / "proofofwork-marketplace").exists())
            else:
                source, target = map(Path, command[-2:])
                candidate = target if source == self.live else target.parent
                if source == self.live:
                    self.assertTrue((candidate / "proofofwork-marketplace/unreferenced.bin").is_file())
                    measurements["seed"] = allocated(candidate)
            measurements["copyPhaseHighWater"] = max(allocated(candidate), measurements.get("copyPhaseHighWater", 0))
            if after_cp:
                after_cp(command, candidate)
        with contextlib.ExitStack() as stack:
            if direct:
                # Exercise the installed constructor at its normal entry point.
                # The separate guarded-install fixture exercises the journal and
                # sealed-plan reader. Here only their decision is synthesized.
                self.lock.touch(mode=0o600, exist_ok=True)
                descriptor = os.open(self.lock, os.O_RDONLY)
                stack.callback(os.close, descriptor)
                stack.enter_context(patch.dict(os.environ, POW_UI_DEPLOY_LOCK_FD=str(descriptor)))
                args = {"approval": {}, "binding": {}, "records": {}, "live": self.live_rows,
                        "input": self.input_rows, "peak": final + 8 * 1024**2, "final": final, "inodes": 3000}
                stack.enter_context(patch.object(stage, "require_direct_receiver_lock", return_value=None))
                stack.enter_context(patch.object(stage, "direct_stage_context", return_value=args))
                stack.enter_context(patch.object(stage, "verify_active", return_value={}))
                stack.enter_context(patch.object(stage, "require_direct_approval", return_value=None))
                arguments.extend(["--direct-attempt", "initial", "--direct-plan-sha256", "a" * 64])
            stack.enter_context(patch.object(sys, "argv", arguments))
            stack.enter_context(patch.object(stage, "run_checked", side_effect=observe))
            log = stack.enter_context(contextlib.redirect_stdout(io.StringIO()))
            self.assertEqual(stage.main(), 0)
            if direct:
                self.assertIn("constructor=amo-direct-stage-v1 direct_plan_sha256=" + "a" * 64, log.getvalue())
            else:
                self.assertNotIn("constructor=amo-direct-stage-v1", log.getvalue())
        measurements["final"] = allocated(self.reference)
        return measurements

    def test_direct_matches_full_copy_and_avoids_old_tree(self):
        reference = self.native_stage(dedup=True)
        self.reference.rename(self.candidate)
        direct = self.native_stage(dedup=True, direct=True)
        self.assertEqual(comparable_tree(self.reference), comparable_tree(self.candidate))
        self.assertEqual(stage.passthrough_fingerprint(self.live), stage.passthrough_fingerprint(self.candidate))
        input_inodes = {inode(path.lstat()) for root in (self.live, self.incoming) for path in entries(root)}
        for root in [self.reference, self.candidate]:
            self.assertTrue(input_inodes.isdisjoint(inode(path.lstat()) for path in entries(root)))
            self.assertEqual(stage.candidate_allocation(root, OWNER)[0]["entries"], len(entries(root)))
            self.assertFalse((root / stage.MANIFEST_NAME).exists())
            self.assertFalse((root / "proofofwork-marketplace/unreferenced.bin").exists())
            self.assertFalse((root / "proofofwork-pay/old-managed-alias").exists())
            retained = (root / ".operator/file").stat()
            self.assertEqual(retained.st_nlink, 3)
            self.assertEqual(inode(retained), inode((root / "proofofwork-operator/alias").stat()))
            self.assertEqual(inode(retained), inode((root / "top-level-alias").stat()))
            for product in ("pay", "marketplace"):
                current = root / f"proofofwork-{product}/assets"
                self.assertEqual((current / "tile.png").read_bytes(), b"old tile")
                self.assertEqual((current / "older.css").read_bytes(), b'body{background:url("./tile.png")}')
        # Compare observed branch-specific copy boundaries, not a whole-workflow peak.
        self.assertLess(direct["seed"], reference["seed"])
        self.assertLess(direct["copyPhaseHighWater"], reference["copyPhaseHighWater"])
        self.assertEqual((source_witness(self.live), source_witness(self.incoming)), self.pins)
        print(json.dumps({"fixtureObservedInodeBlocksBytes": {"full": reference, "direct": direct}}, sort_keys=True))

    def test_stale_source_and_unsafe_link_refused(self):
        os.setxattr(self.live / ".operator/file", "user.pow-design", b"changed only metadata")
        with self.assertRaisesRegex(stage.StageError, "passthrough metadata differs"):
            self.native_stage(True, direct=True)
        failed = self.scratch / f".proofofwork-ui-stage-{RELEASE}.initial"
        self.assertTrue((failed / "candidate/.operator/file").exists())
        self.assertFalse(self.reference.exists())
        with self.assertRaises(FileExistsError):
            self.native_stage(True, direct=True)
        (self.live / "unexpected").symlink_to(self.incoming / "pay/index.html")
        with self.assertRaisesRegex(stage.StageError, "unsupported file type"):
            self.native_stage(True, direct=True)
        self.assertTrue(failed.is_dir())

    def test_direct_lock_requires_actual_exclusive_receiver_parent(self):
        self.lock.touch(mode=0o600, exist_ok=True)
        body = """import importlib.util, os, sys
from pathlib import Path
s=importlib.util.spec_from_file_location('native',sys.argv[1])
m=importlib.util.module_from_spec(s)
s.loader.exec_module(m)
m.require_direct_receiver_lock(Path(sys.argv[2]))
"""
        def child(fd):
            return subprocess.run([sys.executable, "-I", "-B", "-c", body, stage.__file__, str(self.lock)],
                                  env={**os.environ, "POW_UI_DEPLOY_LOCK_FD": str(fd)}, pass_fds=(fd,),
                                  capture_output=True, text=True)
        with self.lock.open("rb") as holder, self.lock.open("rb") as other:
            self.assertIn("inherited exclusive lock", child(holder.fileno()).stderr)
            fcntl.flock(holder, fcntl.LOCK_SH | fcntl.LOCK_NB)
            self.assertIn("inherited exclusive lock", child(holder.fileno()).stderr)
            fcntl.flock(holder, fcntl.LOCK_EX | fcntl.LOCK_NB)
            success = child(holder.fileno())
            self.assertEqual(success.returncode, 0, success.stderr)
            self.assertIn("inherited exclusive lock", child(other.fileno()).stderr)

    def test_completed_bound_refusal_retains_partial_and_preserves_sources(self):
        with self.assertRaisesRegex(stage.StageError, "completed candidate exceeds"):
            self.native_stage(True, direct=True, final=1)
        self.assertFalse(self.reference.exists())
        failed = self.scratch / f".proofofwork-ui-stage-{RELEASE}.initial/candidate"
        self.assertTrue((failed / "proofofwork-pay/assets/current.js").is_file())
        self.assertEqual((source_witness(self.live), source_witness(self.incoming)), self.pins)

    def test_passthrough_metadata_loss_refuses_before_managed_copies(self):
        def lose_xattr(argv, candidate):
            if "--target-directory" in argv:
                os.removexattr(candidate / ".operator/file", "user.pow-design")
        with self.assertRaisesRegex(stage.StageError, "passthrough metadata differs"):
            self.native_stage(True, direct=True, after_cp=lose_xattr)
        self.assertFalse(self.reference.exists())
        self.assertEqual((source_witness(self.live), source_witness(self.incoming)), self.pins)

    def test_default_full_copy_keeps_independent_managed_inodes(self):
        measured = self.native_stage(dedup=False)
        self.assertGreater(measured["seed"], measured["final"])
        a = self.reference / "proofofwork-pay/assets/current.js"
        b = self.reference / "proofofwork-marketplace/assets/pay-copy.js"
        self.assertNotEqual(inode(a.stat()), inode(b.stat()))
        self.assertEqual((source_witness(self.live), source_witness(self.incoming)), self.pins)
        self.assertFalse(self.candidate.exists())


if __name__ == "__main__":
    unittest.main(verbosity=2)
