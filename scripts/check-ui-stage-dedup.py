#!/usr/bin/env python3
"""Behavioral tests for opt-in, candidate-internal UI file deduplication."""
import importlib.util
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("ui_stage_dedup", ROOT / "deploy/proofofwork-ui-release-stage.py")
stage = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(stage)
STAMP = 1_700_000_000_000_000_000


def write(path, content=b"same managed content\n", mode=0o644, stamp=STAMP):
    missing = []
    parent = path.parent
    while not parent.exists():
        missing.append(parent)
        parent = parent.parent
    for directory in reversed(missing):
        directory.mkdir(mode=0o755)
    path.write_bytes(content)
    path.chmod(mode)
    os.utime(path, ns=(stamp, stamp))
    return path


def inode(path):
    details = path.stat()
    return details.st_dev, details.st_ino


class InternalDedupTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="pow-ui-dedup-")
        self.base = Path(self.temporary.name)
        self.private = self.base / "private"
        self.private.mkdir(mode=0o700)
        self.candidate = self.private / "candidate"
        self.candidate.mkdir(mode=0o755)
        self.a = write(self.candidate / "proofofwork-activity/assets/a.js")
        self.b = write(self.candidate / "proofofwork-browser/assets/b.js")
        self.dedup = stage.CandidateManagedDeduplicator(self.candidate, os.geteuid())

    def tearDown(self):
        self.dedup.close()
        self.temporary.cleanup()

    def relative(self, path):
        return str(path.relative_to(self.candidate))

    def test_exact_bytes_metadata_and_all_served_paths_are_preserved(self):
        before = stage.tree_fingerprint(self.candidate, expected_owner=os.geteuid())
        self.dedup.add_surface("activity")
        self.dedup.add_surface("browser")
        self.assertEqual(inode(self.a), inode(self.b))
        self.assertEqual(before, stage.tree_fingerprint(self.candidate, expected_owner=os.geteuid()))
        self.assertEqual(self.a.stat().st_mtime_ns, STAMP)
        self.assertEqual(self.dedup.linked_files, 1)
        self.assertEqual(self.dedup.saved_bytes, self.a.stat().st_size)
        self.dedup.add_surface("activity")
        self.dedup.add_surface("browser")
        self.assertEqual(self.dedup.linked_files, 1, "revisiting compatibility surfaces must not relink aliases")

    def test_bytes_and_modes_must_match(self):
        others = [write(self.candidate / "proofofwork-browser/assets/different-bytes.js", b"DIFF managed content\n"),
                  write(self.candidate / "proofofwork-browser/assets/different-mode.js", mode=0o444)]
        self.dedup.add_file(self.relative(self.a))
        for path in others:
            self.dedup.add_file(self.relative(path))
            self.assertNotEqual(inode(self.a), inode(path))

    def test_different_build_times_deduplicate_without_changing_fingerprints(self):
        os.utime(self.b, ns=(STAMP + 1000000000, STAMP + 1000000000))
        before = stage.tree_fingerprint(self.candidate)
        self.dedup.add_file(self.relative(self.a))
        self.dedup.add_file(self.relative(self.b))
        self.assertEqual(inode(self.a), inode(self.b))
        self.assertEqual(stage.tree_fingerprint(self.candidate), before)
        self.assertEqual(self.b.stat().st_mtime_ns, self.a.stat().st_mtime_ns)

    def test_extended_attributes_must_match(self):
        try:
            os.setxattr(self.a, "user.pow-dedup-fixture", b"keep separate metadata")
        except OSError as error:
            self.skipTest(f"Fixture filesystem does not support user xattrs: {error}")
        self.dedup.add_file(self.relative(self.a))
        self.dedup.add_file(self.relative(self.b))
        self.assertNotEqual(inode(self.a), inode(self.b))
        self.assertEqual(os.getxattr(self.a, "user.pow-dedup-fixture"), b"keep separate metadata")
        self.assertNotIn("user.pow-dedup-fixture", os.listxattr(self.b))

    def test_preexisting_live_hardlink_is_rejected_without_mutating_live(self):
        live = write(self.base / "live/asset.js")
        self.b.unlink()
        os.link(live, self.b)
        before = (live.read_bytes(), inode(live), live.stat().st_nlink)
        self.dedup.add_file(self.relative(self.a))
        with self.assertRaisesRegex(stage.StageError, "pre-existing hardlinks"):
            self.dedup.add_file(self.relative(self.b))
        self.assertEqual(before, (live.read_bytes(), inode(live), live.stat().st_nlink))
        self.assertNotEqual(inode(self.a), inode(live))

    def test_unexpected_external_link_to_registered_inode_is_rejected(self):
        self.dedup.add_file(self.relative(self.a))
        external = self.base / "external-copy.js"
        os.link(self.a, external)
        with self.assertRaisesRegex(stage.StageError, "source changed"):
            self.dedup.add_file(self.relative(self.b))
        self.assertNotEqual(inode(self.a), inode(self.b))

    def test_symlinks_parent_symlinks_and_passthrough_paths_are_rejected(self):
        outside = write(self.base / "outside/a.js")
        self.b.unlink()
        self.b.symlink_to(outside)
        with self.assertRaises(stage.StageError):
            self.dedup.add_file(self.relative(self.b))
        parent = self.candidate / "proofofwork-growth"
        parent.symlink_to(outside.parent, target_is_directory=True)
        with self.assertRaises(stage.StageError):
            self.dedup.add_file("proofofwork-growth/a.js")
        for relative in ["../outside/a.js", "passthrough/a.js", "/absolute/a.js"]:
            with self.assertRaises(stage.StageError):
                self.dedup.add_file(relative)
        self.assertEqual(outside.read_bytes(), b"same managed content\n")

    def test_fifo_is_rejected_without_waiting_for_a_writer(self):
        self.b.unlink()
        os.mkfifo(self.b, mode=0o644)
        with self.assertRaisesRegex(stage.StageError, "regular file"):
            self.dedup.add_file(self.relative(self.b))

    def test_same_digest_is_not_a_substitute_for_byte_equality(self):
        self.b.write_bytes(b"DIFF managed content\n")
        os.utime(self.b, ns=(STAMP, STAMP))
        with patch.object(self.dedup, "hash_file", return_value=b"forced digest collision"):
            self.dedup.add_file(self.relative(self.a))
            with self.assertRaisesRegex(stage.StageError, "digest collision"):
                self.dedup.add_file(self.relative(self.b))
        self.assertNotEqual(inode(self.a), inode(self.b))

    def test_source_symlink_swap_at_link_is_not_followed(self):
        self.dedup.add_file(self.relative(self.a))
        external = write(self.base / "live/asset.js", b"must stay independent\n")
        real_link = os.link
        def swap(source, destination, **kwargs):
            self.a.rename(self.a.with_suffix(".saved"))
            self.a.symlink_to(external)
            return real_link(source, destination, **kwargs)
        with patch.object(stage.os, "link", side_effect=swap):
            with self.assertRaisesRegex(stage.StageError, "link identity changed"):
                self.dedup.add_file(self.relative(self.b))
        self.assertEqual(external.stat().st_nlink, 1)
        self.assertEqual(external.read_bytes(), b"must stay independent\n")
        self.assertEqual(self.b.read_bytes(), b"same managed content\n")
        self.assertFalse(list(self.b.parent.glob(".proofofwork-dedup-*")))

    def test_target_replacement_at_link_is_detected_before_atomic_replace(self):
        self.dedup.add_file(self.relative(self.a))
        real_link = os.link
        def swap(source, destination, **kwargs):
            self.b.unlink()
            write(self.b, b"concurrent replacement\n")
            return real_link(source, destination, **kwargs)
        with patch.object(stage.os, "link", side_effect=swap):
            with self.assertRaisesRegex(stage.StageError, "link identity changed"):
                self.dedup.add_file(self.relative(self.b))
        self.assertEqual(self.b.read_bytes(), b"concurrent replacement\n")
        self.assertEqual(self.a.stat().st_nlink, 1)

    def test_byte_change_during_replacement_is_detected_even_with_preserved_mtime(self):
        self.dedup.add_file(self.relative(self.a))
        real_replace = os.replace
        def mutate(source, destination, **kwargs):
            result = real_replace(source, destination, **kwargs)
            self.a.write_bytes(b"DIFF managed content\n")
            os.utime(self.a, ns=(STAMP, STAMP))
            return result
        with patch.object(stage.os, "replace", side_effect=mutate):
            with self.assertRaisesRegex(stage.StageError, "bytes changed during replacement"):
                self.dedup.add_file(self.relative(self.b))

    def test_failed_link_leaves_original_candidate_and_live_independent(self):
        before = stage.tree_fingerprint(self.candidate)
        self.dedup.add_file(self.relative(self.a))
        with patch.object(stage.os, "link", side_effect=OSError("simulated disk/full link failure")):
            with self.assertRaises(stage.StageError):
                self.dedup.add_file(self.relative(self.b))
        self.assertEqual(before, stage.tree_fingerprint(self.candidate))
        self.assertNotEqual(inode(self.a), inode(self.b))

    def test_cross_filesystem_and_foreign_owner_are_rejected(self):
        details = self.a.stat()
        values = list(details)
        values[2] += 1  # st_dev
        with self.assertRaisesRegex(stage.StageError, "filesystem boundary"):
            self.dedup.validate_details(os.stat_result(values), "asset.js")
        values = list(details)
        values[4] += 1  # st_uid
        with self.assertRaisesRegex(stage.StageError, "ownership"):
            self.dedup.validate_details(os.stat_result(values), "asset.js")


class StagerIntegrationTests(unittest.TestCase):
    def test_default_independence_opt_in_capacity_compatibility_and_archive_bytes(self):
        with tempfile.TemporaryDirectory(prefix="pow-ui-stage-dedup-") as name:
            base = Path(name)
            live = base / "www"
            live.mkdir(mode=0o755)
            staging = base / "staging"
            staging.mkdir(mode=0o755)
            lock_parent = base / "locks"
            lock_parent.mkdir(mode=0o700)
            old = b"export const oldAsset = true;\n" + b" " * 32768
            new = b"export const newAsset = true;\n" + b" " * 65536
            for surface in stage.SURFACES:
                write(live / f"proofofwork-{surface}/index.html", b'<script src="/assets/old.js"></script>')
                write(live / f"proofofwork-{surface}/assets/old.js", old)
            passthrough = write(live / "operator/static.js", new)
            live_before = stage.tree_fingerprint(live)
            outputs = []
            payload_roots = []
            for release, dedup in [("default", False), ("dedup", True)]:
                payload = staging / f"proofofwork-ui-surfaces-{release}/surfaces"
                for surface in stage.SURFACES:
                    write(payload / surface / "index.html", b'<script src="/assets/new.js"></script>')
                    write(payload / surface / "assets/new.js", new)
                destination = staging / f"proofofwork-www-stage-{release}"
                command = [sys.executable, "-B", str(ROOT / "deploy/proofofwork-ui-release-stage.py"),
                           "--release-id", release, "--surfaces-root", str(payload), "--stage-root", str(destination)]
                if dedup:
                    command.append("--deduplicate-managed-files")
                result = subprocess.run(command, text=True, capture_output=True, timeout=60,
                                        env={**os.environ, "POW_UI_ALLOW_TEST_ROOTS": "1", "POW_UI_STAGE_WWW_ROOT": str(live),
                                             "POW_UI_STAGE_STAGING_ROOT": str(staging), "POW_UI_DEPLOY_LOCK": str(lock_parent / "deploy.lock")})
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                self.assertEqual(stage.tree_fingerprint(live), live_before)
                outputs.append(destination)
                payload_roots.append(payload)
            normal, dedup = outputs
            self.assertEqual(stage.managed_fingerprint(normal, os.geteuid()), stage.managed_fingerprint(dedup, os.geteuid()))
            self.assertEqual(stage.passthrough_fingerprint(normal), stage.passthrough_fingerprint(dedup))
            for asset in ["new.js", "old.js"]:
                normal_inodes = {inode(normal / f"proofofwork-{s}/assets/{asset}") for s in stage.SURFACES}
                dedup_inodes = {inode(dedup / f"proofofwork-{s}/assets/{asset}") for s in stage.SURFACES}
                self.assertEqual(len(normal_inodes), 15)
                self.assertEqual(len(dedup_inodes), 1)
                for surface in stage.SURFACES:
                    copied = dedup / f"proofofwork-{surface}/assets/{asset}"
                    source = live / f"proofofwork-{surface}/assets/{asset}" if asset == "old.js" else payload_roots[1] / surface / "assets/new.js"
                    self.assertNotEqual(inode(copied), inode(source))
                    self.assertNotEqual(inode(copied), inode(normal / f"proofofwork-{surface}/assets/{asset}"))
            self.assertNotEqual(inode(dedup / "operator/static.js"), inode(dedup / "proofofwork-activity/assets/new.js"))
            self.assertNotEqual(inode(dedup / "operator/static.js"), inode(passthrough))
            def allocated(root):
                unique = {}
                for surface in stage.SURFACES:
                    for path in (root / f"proofofwork-{surface}").rglob("*"):
                        if path.is_file(): unique[inode(path)] = path.stat().st_blocks * 512
                return sum(unique.values())
            self.assertLess(allocated(dedup), allocated(normal) // 5)
            # Deployment archives must dereference hardlinks so each public URL
            # is an ordinary file when validated/extracted into another release.
            archive = base / "candidate.tar"
            subprocess.run(["tar", "--hard-dereference", "-cf", str(archive), "-C", str(dedup), "."], check=True)
            restored = base / "restored"
            restored.mkdir(mode=0o755)
            subprocess.run(["tar", "-xf", str(archive), "-C", str(restored)], check=True)
            self.assertEqual(stage.tree_fingerprint(dedup), stage.tree_fingerprint(restored))
            self.assertEqual(len({inode(restored / f"proofofwork-{s}/assets/new.js") for s in stage.SURFACES}), 15)
            self.assertFalse(list(staging.glob(".proofofwork-ui-stage-*")))
            # An unsafe pre-existing inode group in a fresh copy must abort
            # before publication and remove only the unpublished candidate.
            release = "reject-preexisting-links"
            payload = staging / f"proofofwork-ui-surfaces-{release}/surfaces"
            for surface in stage.SURFACES:
                write(payload / surface / "index.html", b'<script src="/assets/new.js"></script>')
                write(payload / surface / "assets/new.js", new)
            os.link(payload / "activity/assets/new.js", payload / "activity/assets/linked.js")
            payload_before = stage.tree_fingerprint(payload)
            rejected = staging / f"proofofwork-www-stage-{release}"
            result = subprocess.run([sys.executable, "-B", str(ROOT / "deploy/proofofwork-ui-release-stage.py"),
                                     "--release-id", release, "--surfaces-root", str(payload), "--stage-root", str(rejected),
                                     "--deduplicate-managed-files"], text=True, capture_output=True, timeout=60,
                                    env={**os.environ, "POW_UI_ALLOW_TEST_ROOTS": "1", "POW_UI_STAGE_WWW_ROOT": str(live),
                                         "POW_UI_STAGE_STAGING_ROOT": str(staging), "POW_UI_DEPLOY_LOCK": str(lock_parent / "deploy.lock")})
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("pre-existing hardlinks", result.stderr)
            self.assertFalse(rejected.exists())
            self.assertEqual(stage.tree_fingerprint(payload), payload_before)
            self.assertEqual(stage.tree_fingerprint(live), live_before)
            self.assertFalse(list(staging.glob(".proofofwork-ui-stage-*")))


if __name__ == "__main__":
    unittest.main(verbosity=2)
