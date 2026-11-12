#!/usr/bin/env python3
"""Pure fixture checks; no production host or service is contacted."""
import copy
import hashlib
from pathlib import Path
import runpy
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
Historical = runpy.run_path(str(HERE.parent / "health-readiness/check.test.py"))["HealthReleaseTests"]


class RegistryTimingReleaseTests(unittest.TestCase):
    def setUp(self):
        self.module = runpy.run_path(str(HERE / "release.py"))
        self.globals = self.module["source_fence"].__globals__

    def manifest_fixture(self):
        ns, manifest, before, after = Historical.manifest_fixture(self)
        manifest["dependencies"].update(ns["PRESERVED"])
        return ns, manifest, before, after

    test_manifest_accepts_only_exact_scope_order_and_reviewed_hashes = Historical.test_manifest_accepts_only_exact_scope_order_and_reviewed_hashes
    test_unreviewed_after_gate_refuses_even_structurally_valid_manifest = Historical.test_unreviewed_after_gate_refuses_even_structurally_valid_manifest
    test_install_and_rollback_preserve_all_existing_bytes_and_metadata = Historical.test_install_and_rollback_preserve_all_existing_bytes_and_metadata

    def test_controller_scope_and_historical_engine_stay_exact(self):
        raw = self.module["controller"]()
        ns = self.module["engine"]["namespace"](raw)
        self.assertEqual(ns["ALLOWED"], {"server/proof-api.mjs", "server/wallet-read-observation.mjs"})
        self.assertEqual(ns["NEW"], frozenset())
        self.assertEqual(ns["INSTALL_ORDER"], ["server/wallet-read-observation.mjs", "server/proof-api.mjs"])
        self.assertEqual(ns["BASE_SOURCE_COMMIT"], "037f8db7edccb9c3613f04cc77d04fd45fb7c870")
        self.assertEqual(ns["ACCEPTED_SHA"], "eb63a250dd00595fa83ab7ea86fc8bafdb501907ed92af5a4ffa754e01065766")
        self.assertIn(b"backup = BACKUPS/('registry-timing-'", raw)
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
        planner = self.module["registry_build_plan"]()
        self.assertIs(planner.__globals__["resolve_merge"], self.module["resolve_merge"])
        self.assertIs(planner.__globals__["controller"], self.module["controller"])
        self.assertIn("check_returncode", engine["build_plan"].__code__.co_names)
        for fence in ("metadata_fence", "validate_manifest", "fence", "load_verifier"):
            self.assertIn(fence, engine["build_plan"].__code__.co_consts)

if __name__ == "__main__":
    unittest.main()
