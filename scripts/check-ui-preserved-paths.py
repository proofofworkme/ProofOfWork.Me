#!/usr/bin/env python3
"""Exercise exact preserved inputs through the real UI stager and path guards."""
import importlib.util
import os
from pathlib import Path
import shlex
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("ui_preserved_stage", ROOT / "deploy/proofofwork-ui-release-stage.py")
stage = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(stage)
PROVENANCE = ROOT / "deploy/proofofwork-ui-release-provenance.sh"
PUBLISHER = ROOT / "deploy/proofofwork-ui-release-publish.sh"
RELEASE = "0123456789ab-20261003T222517Z"


def write(path, content=b"fixture\n"):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o755)
    path.write_bytes(content)
    path.chmod(0o644)
    return path


def source_guard(path):
    function = path.read_text().split("validate_preserved_source_checkout() {\n", 1)[1].split("\nPY\n}", 1)[0]
    return function.split("<<'PY'\n", 1)[1]


class PreservedPaths(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="pow-ui-preserved-")
        self.base = Path(self.temporary.name)
        self.live = self.base / "www"
        self.staging = self.base / "staging"
        self.evidence = self.base / "backups/proofofwork-ui/transport-evidence"
        self.payload = self.evidence / RELEASE / ("proofofwork-ui-surfaces-" + RELEASE) / "surfaces"
        self.source = self.evidence / RELEASE / ("proofofwork-ui-source-" + RELEASE)
        self.staging.mkdir(mode=0o755)
        self.source.mkdir(parents=True, mode=0o700)
        self.mountinfo = write(self.base / "mountinfo", b"1 0 0:1 / / rw - fixture fixture rw\n")
        self.lock = self.base / "locks/deploy.lock"
        self.lock.parent.mkdir(mode=0o700)
        for surface in stage.SURFACES:
            write(self.live / ("proofofwork-" + surface) / "index.html", b'<script src="/assets/old.js"></script>')
            write(self.live / ("proofofwork-" + surface) / "assets/old.js", b"export const old = true;\n")
            write(self.payload / surface / "index.html", b'<script src="/assets/new.js"></script>')
            write(self.payload / surface / "assets/new.js", b"export const fresh = true;\n")
        write(self.live / "operator/static.txt", b"preserved passthrough\n")
        for directory in self.base.rglob("*"):
            if directory.is_dir():
                directory.chmod(0o755)
        self.lock.parent.chmod(0o700)
        self.source.chmod(0o700)
        self.env = {"POW_UI_ALLOW_TEST_ROOTS": "1", "POW_UI_STAGE_WWW_ROOT": str(self.live),
                    "POW_UI_STAGE_STAGING_ROOT": str(self.staging), "POW_UI_DEPLOY_LOCK": str(self.lock),
                    "POW_UI_MOUNTINFO_PATH": str(self.mountinfo)}

    def tearDown(self):
        self.temporary.cleanup()

    def validate(self, path=None, release=RELEASE, owner=None, group=None, device=None):
        with patch.object(stage, "TRANSPORT_EVIDENCE_ROOT", self.evidence):
            stage.validate_preserved_surfaces_root(path or self.payload, release,
                os.geteuid() if owner is None else owner,
                os.getegid() if group is None else group,
                self.live.stat().st_dev if device is None else device, self.mountinfo)

    def run_stage(self, path=None, release=RELEASE):
        destination = self.staging / ("proofofwork-www-stage-" + release)
        args = ["stage", "--release-id", release, "--surfaces-root", str(path or self.payload),
                "--stage-root", str(destination), "--deduplicate-managed-files"]
        with patch.object(stage, "TRANSPORT_EVIDENCE_ROOT", self.evidence), \
             patch.object(sys, "argv", args), patch.dict(os.environ, self.env):
            stage.main()
        return destination

    def test_real_preserved_stage_keeps_input_live_compatibility_and_passthrough(self):
        live_before = stage.tree_fingerprint(self.live)
        payload_before = stage.tree_fingerprint(self.payload)
        destination = self.run_stage()
        self.assertEqual(stage.tree_fingerprint(self.live), live_before)
        self.assertEqual(stage.tree_fingerprint(self.payload), payload_before)
        self.assertEqual((destination / "operator/static.txt").read_bytes(), b"preserved passthrough\n")
        for surface in stage.SURFACES:
            for asset in ("old.js", "new.js"):
                candidate = destination / ("proofofwork-" + surface) / "assets" / asset
                original = ((self.live / ("proofofwork-" + surface)) if asset == "old.js" else self.payload / surface) / "assets" / asset
                self.assertEqual(candidate.read_bytes(), original.read_bytes())
                self.assertNotEqual(candidate.stat().st_ino, original.stat().st_ino)
        self.assertFalse(list(self.staging.glob(".proofofwork-ui-stage-*")))

    def test_wrong_release_sibling_parent_and_scratch_alias_fail_before_stage_creation(self):
        for path, release in [(self.payload, "other-release"),
                              (self.payload.with_name("other-surfaces"), RELEASE),
                              (self.payload.parent, RELEASE),
                              (self.evidence / RELEASE / ("proofofwork-ui-surfaces-" + RELEASE + "-sibling") / "surfaces", RELEASE),
                              (self.staging / "alias/surfaces", RELEASE)]:
            with self.subTest(path=path, release=release), self.assertRaisesRegex(stage.StageError, "release-bound"):
                self.run_stage(path, release)
            self.assertFalse((self.staging / ("proofofwork-www-stage-" + release)).exists())

    def test_writable_and_symlinked_evidence_ancestors_fail(self):
        self.evidence.chmod(0o775)
        with self.assertRaisesRegex(stage.StageError, "owner-controlled"):
            self.validate()
        self.evidence.chmod(0o755)
        actual = self.evidence.with_name("actual-evidence")
        self.evidence.rename(actual)
        self.evidence.symlink_to(actual, target_is_directory=True)
        with self.assertRaisesRegex(stage.StageError, "canonical"):
            self.validate()

    def test_owner_group_and_filesystem_mismatches_fail(self):
        for kwargs in ({"owner": os.geteuid() + 1}, {"group": os.getegid() + 1},
                       {"device": self.live.stat().st_dev + 1}):
            with self.subTest(kwargs=kwargs), self.assertRaises(stage.StageError):
                self.validate(**kwargs)

    def test_mount_at_ancestor_release_or_descendant_fails(self):
        for path in (self.evidence.parent.parent, self.evidence, self.evidence / RELEASE,
                     self.payload / "activity/assets"):
            self.mountinfo.write_text("1 0 0:1 / / rw - fixture fixture rw\n" +
                "2 1 0:2 / " + str(path) + " rw - fixture fixture rw\n")
            with self.subTest(path=path), self.assertRaisesRegex(stage.StageError, "nested mount"):
                self.validate()

    def run_source_guard(self, helper, source=None, release=RELEASE):
        # Only the fixture root constant changes. Production admits no root override.
        code = source_guard(helper).replace('Path("/var/backups/proofofwork-ui/transport-evidence")',
            "Path(" + repr(self.evidence.as_posix()) + ")")
        return subprocess.run([sys.executable, "-I", "-B", "-c", code, str(source or self.source),
            release, str(self.live), str(self.mountinfo), "1"], capture_output=True, text=True, timeout=10)

    def test_source_guard_accepts_exact_path_and_rejects_wrong_release_or_sibling(self):
        self.assertEqual(source_guard(PROVENANCE), source_guard(PUBLISHER))
        for helper in (PROVENANCE, PUBLISHER):
            result = self.run_source_guard(helper)
            self.assertEqual(result.returncode, 0, result.stderr)
            for source, release in ((self.source, "wrong-release"),
                                    (self.source.with_name(self.source.name + "-sibling"), RELEASE),
                                    (self.source.parent, RELEASE)):
                result = self.run_source_guard(helper, source, release)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("exact release-bound", result.stderr)

    def test_source_guard_rejects_unsafe_ancestor_and_mount(self):
        self.evidence.chmod(0o777)
        for helper in (PROVENANCE, PUBLISHER):
            self.assertIn("canonical, owner/group-controlled", self.run_source_guard(helper).stderr)
        self.evidence.chmod(0o755)
        self.mountinfo.write_text("1 0 0:1 / " + str(self.evidence) + " rw - fixture fixture rw\n")
        for helper in (PROVENANCE, PUBLISHER):
            self.assertIn("mounted ancestor", self.run_source_guard(helper).stderr)

    def test_actual_shell_source_admission_binds_the_same_release_in_both_paths(self):
        publisher = PUBLISHER.read_text()
        predicate = publisher.split('if [[ "${source_checkout}" != "${expected_source_checkout}"', 1)[1].split("\nfi", 1)[0]
        predicate = 'if [[ "${source_checkout}" != "${expected_source_checkout}"' + predicate + "\nfi"
        provenance = PROVENANCE.read_text().split('  if [[ "${POW_UI_ALLOW_TEST_ROOTS:-}" != "1" ]]; then\n', 1)[1].split("\n  fi", 1)[0]
        provenance = 'if [[ "${POW_UI_ALLOW_TEST_ROOTS:-}" != "1" ]]; then\n' + provenance + "\nfi"
        scratch = "/var/tmp/proofofwork-deploy/proofofwork-ui-source-" + RELEASE
        preserved = "/var/backups/proofofwork-ui/transport-evidence/" + RELEASE + "/proofofwork-ui-source-" + RELEASE
        for source, expected in ((scratch, 0), (preserved, 0), (scratch + "-sibling", 64),
                                 (preserved.replace(RELEASE, "wrong-release", 1), 64),
                                 ("/var/tmp/proofofwork-deploy/arbitrary-source", 64)):
            prefix = "release_id=" + shlex.quote(RELEASE) + "; source_checkout=" + shlex.quote(source) + "; "
            for code in (predicate, provenance.replace("return 1", "return 64")):
                program = prefix + "expected_source_checkout=" + shlex.quote(scratch) + "; preserved_source_checkout=" + shlex.quote(preserved) + "; " + \
                    "validate_preserved_source_checkout() { :; }; admission() { " + code + "; }; admission"
                result = subprocess.run(["/bin/bash", "-c", program], env={"PATH": "/usr/bin:/bin"}, capture_output=True, timeout=10)
                self.assertEqual(result.returncode, expected, result.stderr)


if __name__ == "__main__":
    unittest.main(verbosity=2)
