#!/usr/bin/env python3
"""Exercise exact preserved inputs through the real UI stager and path guards."""
import importlib.util
import hashlib
import json
import types
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

    def run_stage(self, path=None, release=RELEASE, attempt=None, receipt_sha=None):
        destination = self.staging / ("proofofwork-www-stage-" + release)
        args = ["stage", "--release-id", release, "--surfaces-root", str(path or self.payload),
                "--stage-root", str(destination), "--deduplicate-managed-files"]
        if attempt is not None: args += ["--preserved-build-attempt", attempt]
        if receipt_sha is not None: args += ["--preserved-input-receipt-sha256", receipt_sha]
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

    def incoming_receipt(self):
        root = self.payload.parent
        rows = []
        for path in [root, *sorted(root.rglob("*"))]:
            details = path.lstat(); is_file = path.is_file()
            rows.append([path.relative_to(root).as_posix(), "file" if is_file else "directory",
                         details.st_mode & 0o7777, details.st_uid, details.st_gid,
                         details.st_size if is_file else 0,
                         hashlib.sha256(path.read_bytes()).hexdigest() if is_file else None])
        value = {"format": "proof-of-work-ui-incoming-evidence-v1", "releaseId": RELEASE,
                 "preservedPath": str(root), "movePreservedInodes": True, "historicalDeletion": False,
                 "payloadFingerprint": {"sha256": hashlib.sha256(json.dumps(rows, separators=(",", ":")).encode()).hexdigest(),
                                        "entries": len(rows), "regularBytes": sum(row[5] for row in rows)}}
        receipt = self.evidence / RELEASE / "incoming-receipt.json"
        raw = (json.dumps(value, indent=2) + "\n").encode(); receipt.write_bytes(raw); receipt.chmod(0o600)
        return hashlib.sha256(raw).hexdigest()

    def private(self, attempt="completed-v1"):
        return self.evidence / RELEASE / (".proofofwork-ui-stage-" + RELEASE + "." + attempt)

    def test_real_evidence_candidate_admits_completed_allocation_while_default_full_copy_refuses(self):
        for surface in stage.SURFACES:
            (self.live / ("proofofwork-" + surface) / "assets/old.js").write_bytes(b"export const old = true;\n" + b" " * (512*1024))
        receipt_sha = self.incoming_receipt(); helper = stage.capacity_helper()
        bound = helper.tree_bound(self.live, self.staging)["additionalBytes"] + 2*helper.entry_bytes(0, helper.allocation_block(self.staging))
        occupied = helper.MAX_DEPLOY_SCRATCH_BYTES - bound + 1
        real_scratch = helper.check_deploy_scratch; measured = []
        def scratch(path, amount, phase):
            measured.append((path, amount, phase))
            fake = types.SimpleNamespace(stdout=(str(occupied) + "\t" + str(path) + "\n").encode())
            with patch.object(subprocess, "run", return_value=fake):
                return real_scratch(path, amount, phase)
        live_before = stage.tree_fingerprint(self.live); payload_before = stage.tree_fingerprint(self.payload)
        with patch.object(helper, "check_deploy_scratch", side_effect=scratch):
            with self.assertRaisesRegex(stage.StageError, "scratch review"):
                self.run_stage()
            self.assertFalse(list(self.staging.glob(".proofofwork-ui-stage-*")))
            self.assertFalse(self.private().exists())
            original = stage.copy_capacity_guard; copy_checks = []
            def record(source, destination, phase, *args, **kwargs):
                copy_checks.append((destination, phase, kwargs))
                return original(source, destination, phase, *args, **kwargs)
            with patch.object(stage, "copy_capacity_guard", side_effect=record):
                destination = self.run_stage(attempt="completed-v1", receipt_sha=receipt_sha)
        self.assertEqual(stage.tree_fingerprint(self.live), live_before)
        self.assertEqual(stage.tree_fingerprint(self.payload), payload_before)
        report = json.loads((self.private() / "completed-candidate-allocation.json").read_bytes())
        self.assertEqual(report["incomingReceiptSha256"], receipt_sha)
        self.assertEqual(report["attempt"], "completed-v1")
        self.assertLess(report["additionalBytes"], bound)
        self.assertEqual(measured[-1], (self.staging, report["additionalBytes"], "stage-completed-candidate-admission"))
        self.assertEqual(copy_checks[0][0], self.evidence / RELEASE)
        self.assertFalse(copy_checks[0][2].get("scratch_budget", False))
        self.assertEqual(copy_checks[0][1], "stage-private-root")
        self.assertFalse((self.private() / "candidate").exists())
        self.assertTrue(destination.exists())
        self.assertEqual((destination / "operator/static.txt").read_bytes(), b"preserved passthrough\n")
        self.assertFalse(list(self.staging.glob(".proofofwork-ui-stage-*")))

    def test_completed_scratch_refusal_preserves_exact_private_candidate_and_report(self):
        receipt_sha = self.incoming_receipt(); helper = stage.capacity_helper()
        fake = types.SimpleNamespace(stdout=(str(helper.MAX_DEPLOY_SCRATCH_BYTES) + "\t" + str(self.staging) + "\n").encode())
        real_scratch = helper.check_deploy_scratch
        def refuse(path, amount, phase):
            with patch.object(subprocess, "run", return_value=fake): return real_scratch(path, amount, phase)
        with patch.object(helper, "check_deploy_scratch", side_effect=refuse), self.assertRaisesRegex(stage.StageError, "stage-completed-candidate-admission"):
            self.run_stage(attempt="completed-v1", receipt_sha=receipt_sha)
        self.assertTrue((self.private() / "candidate").exists())
        self.assertTrue((self.private() / "completed-candidate-allocation.json").exists())
        self.assertFalse((self.staging / ("proofofwork-www-stage-" + RELEASE)).exists())
        report_bytes = (self.private() / "completed-candidate-allocation.json").read_bytes()
        with self.assertRaisesRegex(stage.StageError, "occupied"):
            self.run_stage(attempt="completed-v1", receipt_sha=receipt_sha)
        self.assertEqual((self.private() / "completed-candidate-allocation.json").read_bytes(), report_bytes)

    def test_evidence_optin_refuses_incomplete_wrong_receipt_or_changed_input_before_allocation(self):
        receipt_sha = self.incoming_receipt()
        for attempt, sha in (("completed-v1", None), (None, receipt_sha), ("../escape", receipt_sha),
                             ("completed-v1", "0"*64)):
            with self.subTest(attempt=attempt, sha=sha), self.assertRaises(stage.StageError):
                self.run_stage(attempt=attempt, receipt_sha=sha)
            self.assertFalse(self.private().exists())
        (self.payload / "publish/assets/new.js").write_bytes(b"modified")
        with self.assertRaisesRegex(stage.StageError, "receipt"):
            self.run_stage(attempt="completed-v1", receipt_sha=receipt_sha)
        self.assertFalse(self.private().exists())

    def test_original_disk_guard_refuses_before_evidence_candidate_allocation(self):
        receipt_sha = self.incoming_receipt(); original = stage.capacity_guard
        def capacity(path, amount, inodes, phase):
            if phase == "stage-private-root": raise stage.StageError("UI capacity refused original full logical copy")
            return original(path, amount, inodes, phase)
        with patch.object(stage, "capacity_guard", side_effect=capacity), self.assertRaisesRegex(stage.StageError, "full logical copy"):
            self.run_stage(attempt="completed-v1", receipt_sha=receipt_sha)
        self.assertFalse(self.private().exists())

    def test_completed_allocation_external_links_and_snapshot_changes_refuse(self):
        root = self.base / "candidate"; root.mkdir(mode=0o755)
        file = write(root / "one", b"identical candidate")
        os.link(file, root / "two")
        report, snapshots = stage.candidate_allocation(root, os.geteuid())
        self.assertEqual(report["uniqueInodes"], 2)
        self.assertEqual(report["entries"], 3)
        self.assertGreater(report["metadataOverheadBytes"], 0)
        external = self.base / "external"; os.link(file, external)
        with self.assertRaisesRegex(stage.StageError, "outside"):
            stage.candidate_allocation(root, os.geteuid())
        external.unlink()
        _, snapshots = stage.candidate_allocation(root, os.geteuid())
        file.write_bytes(b"changed candidate")
        with self.assertRaisesRegex(stage.StageError, "changed"):
            stage.verify_candidate_allocation(snapshots)

    def test_receipt_and_candidate_entry_limits_reject_bounded_enumeration(self):
        receipt_sha = self.incoming_receipt()
        with patch.object(stage, "MAXIMUM_PAYLOAD_ENTRIES", 2), patch.object(stage, "TRANSPORT_EVIDENCE_ROOT", self.evidence), self.assertRaisesRegex(stage.StageError, "entry bound"):
            stage.preserved_input_receipt(self.payload, RELEASE, receipt_sha, os.geteuid())
        root = self.base / "candidate"; root.mkdir(mode=0o755); write(root / "one"); write(root / "two")
        with patch.object(stage.capacity_helper(), "MAX_TREE_ENTRIES", 2), self.assertRaisesRegex(stage.StageError, "entry bound"):
            stage.candidate_allocation(root, os.geteuid())

    def test_phase_model_reports_full_logical_copy_on_actual_evidence_filesystem(self):
        path = ROOT / "deploy/publish/phase_capacity.py"
        namespace = {"__name__": "_evidence_phase_fixture"}
        exec(compile(path.read_bytes(), str(path), "exec"), namespace)
        result = namespace["stage_budget"](self.payload, self.live, stage, owner=os.geteuid(),
                                           allocation_parent=self.evidence / RELEASE)
        helper = stage.capacity_helper(); parent = self.evidence / RELEASE
        expected = helper.tree_bound(self.live, parent)
        expected["additionalBytes"] += 2*helper.entry_bytes(0, helper.allocation_block(parent))
        self.assertEqual(result["canonicalFullLogicalCopyBound"], {**expected, "allocationPath": str(parent)})
        self.assertEqual(result["candidateStorage"], "release-evidence-v1")
        self.assertEqual(result["finalScratchAdmission"], "completed-candidate-unique-inodes-v1")
        self.assertTrue(result["inputStabilityVerified"])

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
