#!/usr/bin/env python3
"""Pure fixture checks; no production host or service is contacted."""
import base64
import os
import stat
import tempfile
import copy
import hashlib
from pathlib import Path
import runpy
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
Historical = runpy.run_path(str(HERE.parent / "health-readiness/check.test.py"))["HealthReleaseTests"]


class AuditRemediationReleaseTests(unittest.TestCase):
    def setUp(self):
        self.module = runpy.run_path(str(HERE / "release.py"))
        self.globals = self.module["source_fence"].__globals__

    def manifest_fixture(self):
        ns, manifest, before, after = Historical.manifest_fixture(self)
        manifest["dependencies"].update(ns["PRESERVED"])
        for name in ns["NEW"]:
            ns["EXISTING"].pop(name)
            before.pop(name)
        for row in manifest["sources"]:
            row["before"] = ns["EXISTING"].get(row["path"])
        return ns, manifest, before, after

    test_manifest_accepts_only_exact_scope_order_and_reviewed_hashes = Historical.test_manifest_accepts_only_exact_scope_order_and_reviewed_hashes

    def test_controller_scope_and_historical_engine_stay_exact(self):
        raw = self.module["controller"]()
        ns = self.module["engine"]["namespace"](raw)
        self.assertEqual(ns["ALLOWED"], {"server/proof-api.mjs", "server/wallet-read-observation.mjs", "scripts/backfill-proof-indexer.mjs", "server/pwid-rejection-projection.mjs"})
        self.assertEqual(ns["NEW"], frozenset({"server/pwid-rejection-projection.mjs"}))
        self.assertEqual(ns["INSTALL_ORDER"], ["server/pwid-rejection-projection.mjs", "server/wallet-read-observation.mjs", "scripts/backfill-proof-indexer.mjs", "server/proof-api.mjs"])
        self.assertEqual(ns["BASE_SOURCE_COMMIT"], "7eaad7ffc0961db2cb67fe0bcd83a8477938941e")
        self.assertEqual(ns["ACCEPTED_SHA"], "5af96ecdda0d91b12d9c2b3f8a750c8ce9653364f01ae42dc8106ee36d9a55d2")
        self.assertIn(b"backup = BACKUPS/('audit-remediation-'", raw)
        self.assertIn(b"Accepted source inventory changed", raw)
        self.assertEqual(ns["UNITS"], ("proofofwork-api.service", "proofofwork-indexer-worker.service"))
        self.assertEqual(hashlib.sha256(self.module["ENGINE"].read_bytes()).hexdigest(), self.module["ENGINE_SHA"])

    def test_source_fence_checks_committed_tool_bytes(self):
        calls = []
        def git(*args):
            calls.append(args)
            return (HERE / args[1].rsplit("/", 1)[-1]).read_bytes()
        with patch.dict(self.globals, {"original_source_fence": lambda c: calls.append(c)}), \
             patch.dict(self.globals["engine"], {"git": git}):
            self.module["source_fence"]("a" * 40)
        self.assertEqual(calls[0], "a" * 40)
        self.assertEqual(len(calls), 3)
        with patch.dict(self.globals, {"original_source_fence": lambda _: None}), \
             patch.dict(self.globals["engine"], {"git": lambda *_: b"changed"}):
            with self.assertRaisesRegex(RuntimeError, "committed source"):
                self.module["source_fence"]("a" * 40)

    def test_preserved_readiness_dependencies_cannot_drift_or_disappear(self):
        ns, manifest, _, _ = self.manifest_fixture()
        for name in ns["PRESERVED"]:
            for digest in (None, "0" * 64):
                changed = copy.deepcopy(manifest)
                if digest is None:
                    del changed["dependencies"][name]
                else:
                    changed["dependencies"][name] = digest
                with self.assertRaisesRegex(ValueError, "readiness foundation"):
                    ns["validate_manifest"](changed)

    test_merge_resolution_requires_exact_inputs_and_reviewed_output = Historical.test_merge_resolution_requires_exact_inputs_and_reviewed_output
    test_unlisted_conflicts_refuse_and_clean_merges_pass_unchanged = Historical.test_unlisted_conflicts_refuse_and_clean_merges_pass_unchanged

    def test_only_pinned_merge_hook_changes_planner(self):
        engine = self.module["engine"]
        planner = self.module["audit_build_plan"]()
        self.assertIs(planner.__globals__["resolve_merge"], self.module["resolve_merge"])
        self.assertIs(planner.__globals__["controller"], self.module["controller"])
        self.assertIn("check_returncode", engine["build_plan"].__code__.co_names)
        for fence in ("metadata_fence", "validate_manifest", "fence", "load_verifier"):
            self.assertIn(fence, engine["build_plan"].__code__.co_consts)


    def test_missing_review_pin_refuses(self):
        ns, manifest, _, _ = self.manifest_fixture()
        ns["AFTER"].pop("server/pwid-rejection-projection.mjs")
        with self.assertRaisesRegex(ValueError, "not been reviewed"):
            ns["validate_manifest"](manifest)

    def test_install_rollback_preserves_existing_and_removes_only_owned_helper(self):
        ns, manifest, before, after = self.manifest_fixture()
        with tempfile.TemporaryDirectory(prefix="pow-audit-overlay-test-") as directory:
            root = Path(directory) / "runtime"; backup = Path(directory) / "backup"
            root.mkdir(); backup.mkdir(); metadata = {}
            for index, row in enumerate(manifest["sources"]):
                name = row["path"]; target = root / name
                target.parent.mkdir(parents=True, exist_ok=True)
                mode = (0o644, 0o640, 0o600)[index % 3]
                metadata[name] = (os.getuid(), os.getgid(), mode)
                if name in before:
                    target.write_bytes(before[name]); target.chmod(mode)
                    (backup / f"before-{index}.mjs").write_bytes(before[name])
                (backup / f"candidate-{index}.mjs").write_bytes(after[name])
            sentinel = root / "accepted-overlay.mjs"; sentinel.write_bytes(b"preserve")
            ns["install"](root, backup, manifest["sources"], metadata, True, "candidate")
            for name, raw in after.items():
                target = root / name; info = target.stat()
                self.assertEqual(target.read_bytes(), raw)
                self.assertEqual((info.st_uid, info.st_gid, stat.S_IMODE(info.st_mode)), metadata[name])
            ns["install"](root, backup, manifest["sources"], metadata, False, "rollback")
            for name, raw in before.items():
                self.assertEqual((root / name).read_bytes(), raw)
            self.assertTrue(all(not (root / name).exists() for name in ns["NEW"]))
            self.assertEqual(sentinel.read_bytes(), b"preserve")
            ns["install"](root, backup, manifest["sources"], metadata, True, "candidate2")
            helper = root / next(iter(ns["NEW"]))
            foreign = helper.with_suffix(".foreign"); foreign.write_bytes(helper.read_bytes())
            foreign.chmod(0o644)
            os.replace(foreign, helper)
            with self.assertRaisesRegex(ValueError, "unowned helper"):
                ns["install"](root, backup, manifest["sources"], metadata, False, "foreign")
            self.assertTrue(helper.exists())
            self.assertEqual(sentinel.read_bytes(), b"preserve")

    def test_live_checker_contract_uses_this_profile_and_exact_predecessor(self):
        source = (HERE.parents[1] / "scripts/check-audit-remediation-live.mjs").read_text()
        for expected in ("deploy/audit-remediation/profile.py", "7eaad7ffc096-20261112T014141Z",
                         "c3969c39c2b2-20261101T051206Z", "Object.keys(expectedRuntime).length, 6",
                         "scripts/backfill-proof-indexer.mjs", "server/pwid-rejection-projection.mjs",
                         "rootReserveBytes, 8 * 1024 ** 3", "Core advanced", "confirmedBalanceSubatoms) > 0n"):
            self.assertIn(expected, source)
        self.assertNotIn("deploy/registry-timing/profile.py", source)

if __name__ == "__main__":
    unittest.main()
