#!/usr/bin/python3
"""Local-only allocation and failure-atomicity fixtures; no production overrides."""
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import tarfile
import tempfile
from types import SimpleNamespace
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]


def load(name, relative):
    spec = importlib.util.spec_from_file_location(name, ROOT / relative)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


capacity = load("capacity_test", "deploy/proofofwork-ui-capacity.py")
stage = load("stage_capacity_test", "deploy/proofofwork-ui-release-stage.py")
stage._capacity_module = capacity
RESERVE = capacity.ROOT_RESERVE_BYTES + capacity.GROWTH_RESERVE_BYTES


def space(available, inodes=100000):
    return SimpleNamespace(f_bavail=available, f_frsize=1, f_bsize=4096, f_favail=inodes)


class CapacityTests(unittest.TestCase):
    def test_integer_boundary_and_no_float_rounding(self):
        extra = 2**60 + 7
        with mock.patch.object(capacity.os, "statvfs", return_value=space(RESERVE + extra)):
            self.assertEqual(capacity.check_capacity(Path("/"), extra, 4, "boundary")["additionalBytes"], extra)
        with mock.patch.object(capacity.os, "statvfs", return_value=space(RESERVE + extra - 1)):
            with self.assertRaisesRegex(capacity.CapacityError, "capacity refused"):
                capacity.check_capacity(Path("/"), extra, 4, "one-byte-short")
        for invalid in (True, 1.0, -1):
            with self.assertRaises(capacity.CapacityError):
                capacity.check_capacity(Path("/"), invalid, 0, "invalid")

    def test_separate_tmpfs_keeps_root_reserve_without_requiring_ten_gib_on_tmpfs(self):
        def directory(path):
            return SimpleNamespace(st_dev=1 if path == Path("/") else 2)
        def available(path):
            return space(RESERVE if path == Path("/") else capacity.GROWTH_RESERVE_BYTES + 4096)
        with mock.patch.object(capacity, "canonical_directory", side_effect=directory), mock.patch.object(capacity.os, "statvfs", side_effect=available):
            result = capacity.check_capacity(Path("/run"), 4096, 1, "runtime")
            self.assertEqual(len(result["checks"]), 2)
            with self.assertRaises(capacity.CapacityError):
                capacity.check_capacity(Path("/run"), 4097, 1, "runtime-full")
        with mock.patch.object(capacity, "canonical_directory", side_effect=directory), mock.patch.object(capacity.os, "statvfs", return_value=space(RESERVE - 1)):
            with self.assertRaises(capacity.CapacityError):
                capacity.check_capacity(Path("/run"), 0, 0, "root-full")

    def test_inode_headroom_is_required(self):
        with mock.patch.object(capacity.os, "statvfs", return_value=space(RESERVE + 10000, capacity.INODE_RESERVE)):
            capacity.check_capacity(Path("/"), 0, 0, "boundary")
            with self.assertRaises(capacity.CapacityError):
                capacity.check_capacity(Path("/"), 0, 1, "inode-full")

    def test_sparse_hardlink_and_metadata_receive_no_dedup_credit(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "source"
            source.mkdir()
            sparse = source / "sparse"
            with sparse.open("wb") as output:
                output.truncate(32 * 1024**2 + 1)
            os.link(sparse, source / "duplicate")
            os.setxattr(sparse, "user.capacity-test", b"metadata")
            result = capacity.tree_bound(source, root)
            self.assertGreater(result["additionalBytes"], 2 * sparse.stat().st_size)
            self.assertEqual(result["additionalInodes"], 3)
            (source / "link").symlink_to("sparse")
            with self.assertRaises(capacity.CapacityError):
                capacity.tree_bound(source, root)

    def test_archive_bound_counts_parents_rounding_and_rejects_unsafe_members(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            archive = root / "archive.tgz"
            def write(names, special=None):
                with tarfile.open(archive, "w:gz") as output:
                    for name in names:
                        item = tarfile.TarInfo(name)
                        item.size = 1
                        if special is not None:
                            item.type, item.linkname = special, "target"
                            item.size = 0
                        output.addfile(item, io.BytesIO(b"x"))
            write(["surfaces/work/assets/a", "surfaces/work/assets/b"])
            block = capacity.allocation_block(root)
            bound = capacity.archive_bound(archive, root)
            self.assertEqual(bound["additionalInodes"], 6)
            self.assertEqual(bound["additionalBytes"], 26 * block)
            for names, special in [(["../escape"], None), (["same", "same"], None),
                                   (["link"], tarfile.SYMTYPE), (["a", "a/b"], None)]:
                write(names, special)
                with self.assertRaises(capacity.CapacityError):
                    capacity.archive_bound(archive, root)

    def test_archive_creation_bound_covers_incompressible_bytes_without_link_credit(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "source"; source.mkdir()
            (source / "random").write_bytes(os.urandom(1024 * 1024))
            os.link(source / "random", source / "duplicate")
            bound = capacity.tree_bound(source, root)
            archive = root / "release.tgz"
            with tarfile.open(archive, "w:gz", dereference=True) as output:
                output.add(source, arcname="surfaces")
            self.assertGreater(bound["archiveUpperBoundBytes"], archive.stat().st_blocks * 512)
            self.assertGreater(bound["archiveUpperBoundBytes"], 2 * 1024 * 1024)

    def test_cli_has_no_reserve_or_statvfs_override(self):
        with mock.patch.object(sys, "argv", ["capacity", "check", "--path", "/", "--reserve-bytes", "0"]), contextlib.redirect_stderr(io.StringIO()):
            with self.assertRaises(SystemExit) as result:
                capacity.main()
            self.assertNotEqual(result.exception.code, 0)

    def test_copy_and_pack_cli_exact_budget_extras_and_one_byte_refusal(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "source"; source.mkdir()
            (source / "file").write_bytes(b"copy and pack capacity fixture")
            # Run the real CLI parser/branches in a child interpreter. Only the
            # private fixture injects available space; deployed code has no
            # threshold override or failure-injection environment variable.
            wrapper = root / "capacity-cli-fixture.py"
            wrapper.write_text(
                "import runpy, sys\nfrom types import SimpleNamespace\n"
                f"scope = runpy.run_path({str(ROOT / 'deploy/proofofwork-ui-capacity.py')!r})\n"
                "available = int(sys.argv.pop(1))\n"
                "scope['os'].statvfs = lambda path: SimpleNamespace(f_bavail=available, f_frsize=1, f_bsize=4096, f_favail=100000)\n"
                # A single synthetic filesystem makes the boundary independent
                # of whether this machine's /tmp is a separate tmpfs mount.
                "actual_directory = scope['canonical_directory']\n"
                "def directory(path):\n    actual_directory(path)\n    return SimpleNamespace(st_dev=1)\n"
                "scope['main'].__globals__['canonical_directory'] = directory\n"
                "try:\n    raise SystemExit(scope['main']())\n"
                "except scope['CapacityError'] as error:\n    print(str(error), file=sys.stderr)\n    raise SystemExit(1)\n"
            )
            with mock.patch.object(capacity.os, "statvfs", return_value=space(RESERVE)):
                measured = capacity.tree_bound(source, root)
            before = (source / "file").read_bytes()
            extras = 2**60 + 7
            for command, allocation, inodes in (
                ("check-copy", measured["additionalBytes"], measured["additionalInodes"]),
                ("check-pack", measured["archiveUpperBoundBytes"], 3),
            ):
                arguments = [command, "--path", str(root), "--source", str(source),
                             "--phase", "cli-boundary", "--additional-bytes", str(extras),
                             "--additional-inodes", "11"]
                with self.subTest(command=command):
                    boundary = RESERVE + allocation + extras
                    accepted = subprocess.run([sys.executable, "-I", "-B", str(wrapper), str(boundary), *arguments], capture_output=True, text=True)
                    self.assertEqual(accepted.returncode, 0, accepted.stderr)
                    receipt = json.loads(accepted.stdout)
                    self.assertEqual(receipt["additionalBytes"], allocation + extras)
                    self.assertEqual(receipt["additionalInodes"], inodes + 11)
                    refused = subprocess.run([sys.executable, "-I", "-B", str(wrapper), str(boundary - 1), *arguments], capture_output=True, text=True)
                    self.assertEqual(refused.returncode, 1)
                    self.assertIn("UI capacity refused", refused.stderr)
                    self.assertEqual(refused.stdout, "")
                    self.assertEqual((source / "file").read_bytes(), before)


class StagerCapacityTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="ui-capacity-stage-")
        self.root = Path(self.temporary.name)
        self.live = self.root / "www"
        self.staging = self.root / "deploy"
        self.live.mkdir(); self.staging.mkdir()
        self.release = "capacity-fixture"
        self.surfaces = self.staging / f"proofofwork-ui-surfaces-{self.release}" / "surfaces"
        self.surfaces.mkdir(parents=True)
        for surface in stage.SURFACES:
            for path, asset in ((self.live / f"proofofwork-{surface}", "old.js"), (self.surfaces / surface, "new.js")):
                (path / "assets").mkdir(parents=True)
                (path / "index.html").write_text(f'<script src="/assets/{asset}"></script>')
                (path / "assets" / asset).write_text("fixture bytes")
        (self.live / "keep-evidence.txt").write_text("protected passthrough")
        self.mountinfo = self.root / "mountinfo"
        self.mountinfo.write_text("")
        self.lockdir = self.root / "runtime"; self.lockdir.mkdir()
        self.stage_root = self.staging / f"proofofwork-www-stage-{self.release}"
        self.environment = {"POW_UI_ALLOW_TEST_ROOTS": "1", "POW_UI_STAGE_WWW_ROOT": str(self.live),
                            "POW_UI_STAGE_STAGING_ROOT": str(self.staging),
                            "POW_UI_DEPLOY_LOCK": str(self.lockdir / "deploy.lock"),
                            "POW_UI_MOUNTINFO_PATH": str(self.mountinfo)}
        for path in self.root.rglob("*"):
            path.chmod(0o755 if path.is_dir() else 0o644)

    def tearDown(self):
        self.temporary.cleanup()

    def run_stage(self, rejected_phase=None, deduplicate=False):
        argv = ["stage", "--release-id", self.release, "--surfaces-root", str(self.surfaces), "--stage-root", str(self.stage_root)]
        if deduplicate:
            argv.append("--deduplicate-managed-files")
        original = capacity.check_capacity
        self.phases = []
        def check(path, byte_count, inode_count, phase):
            self.phases.append(phase)
            # Only this test's imported function receives the injected finite
            # observation; no production CLI/environment override exists.
            same_device = path.stat().st_dev == Path("/").stat().st_dev
            def observation(target):
                if phase == rejected_phase and (same_device or target != Path("/")):
                    reserve = RESERVE if same_device else capacity.GROWTH_RESERVE_BYTES
                    return space(reserve + byte_count - 1)
                return space(RESERVE + 4 * 1024**3)
            with mock.patch.object(capacity.os, "statvfs", side_effect=observation):
                return original(path, byte_count, inode_count, phase)
        with mock.patch.dict(os.environ, self.environment), mock.patch.object(sys, "argv", argv), mock.patch.object(capacity, "check_capacity", side_effect=check), contextlib.redirect_stdout(io.StringIO()):
            return stage.main()

    def test_low_space_and_later_growth_refuse_without_live_or_evidence_changes(self):
        before = stage.tree_fingerprint(self.live)
        source_before = stage.tree_fingerprint(self.surfaces)
        identity = self.live.stat().st_ino
        for phase in ("stage-private-root", "stage-live-copy", "stage-incoming-browser", "stage-compatibility-file", "stage-atomic-publication"):
            with self.subTest(phase=phase):
                with self.assertRaisesRegex(stage.StageError, "capacity refused"):
                    self.run_stage(phase)
                self.assertEqual(stage.tree_fingerprint(self.live), before)
                self.assertEqual(stage.tree_fingerprint(self.surfaces), source_before)
                self.assertEqual(self.live.stat().st_ino, identity)
                self.assertFalse(self.stage_root.exists())
                self.assertEqual(list(self.staging.glob(".proofofwork-ui-stage-*")), [])
                self.assertIn(phase, self.phases)
                if phase == "stage-incoming-browser":
                    self.assertIn("stage-incoming-activity", self.phases)

    def test_success_rechecks_copies_compatibility_dedup_and_publication(self):
        self.assertEqual(self.run_stage(deduplicate=True), 0)
        self.assertTrue(self.stage_root.exists())
        for phase in ("stage-private-root", "stage-live-copy", "stage-compatibility-file", "stage-dedup-link", "stage-atomic-publication"):
            self.assertIn(phase, self.phases)
        for surface in stage.SURFACES:
            self.assertIn(f"stage-incoming-{surface}", self.phases)
            self.assertTrue((self.stage_root / f"proofofwork-{surface}" / "assets/old.js").exists())


if __name__ == "__main__":
    unittest.main(verbosity=2)
