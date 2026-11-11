#!/usr/bin/env python3
"""Isolated guard tests; never contacts or changes a production host."""
import base64
import copy
import hashlib
import os
import stat
import subprocess
import tempfile
from pathlib import Path
import runpy
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parent


class HealthReleaseTests(unittest.TestCase):
    def setUp(self):
        self.module = runpy.run_path(str(HERE / "release.py"))
        self.globals = self.module["git"].__globals__

    def test_controller_has_exact_existing_scope_and_preservation_fence(self):
        source = self.module["controller"]()
        ns = self.module["engine"]["namespace"](source)
        self.assertEqual(ns["ALLOWED"], {
            "server/proof-api.mjs", "server/db/proof-index-reader.mjs",
            "server/db/read-only-snapshot.mjs"})
        self.assertEqual(ns["NEW"], frozenset())
        self.assertEqual(ns["INSTALL_ORDER"][-1], "server/proof-api.mjs")
        self.assertEqual(ns["ACCEPTED_SHA"],
                         "66d9614c8d821b62cea6014dbb37f0316470ed8db4d533d21886b50aba0393e7")
        self.assertIn(b"backup = BACKUPS/('health-readiness-'", source)
        self.assertIn(b"Accepted source inventory changed", source)
        self.assertIn(b"Unreviewed health repair bytes", source)

    def test_only_exact_untracked_historical_dependency_uses_runtime_base(self):
        raw = b"verified historical dependency\n"
        base = "d9fa69d9e1e466fde74c69fccd01f5606db1a84b"
        name = "server/db/read-only-snapshot.mjs"
        reads = []
        ns = {"BASE_SOURCE_COMMIT": base, "ROOT": Path("/exact/runtime"),
              "EXISTING": {name: hashlib.sha256(raw).hexdigest()},
              "sha": lambda value: hashlib.sha256(value).hexdigest(),
              "safe_read": lambda path: reads.append(path) or raw}
        with patch.dict(self.globals["engine"], {"namespace": lambda _: ns}), \
             patch.dict(self.globals, {"original_git": lambda *args: ("git", args)}):
            self.assertEqual(self.module["git"]("show", base + ":" + name), raw)
            self.assertEqual(reads, [Path("/exact/runtime") / name])
            for args in (("show", "f" * 40 + ":" + name),
                         ("show", base + ":server/proof-api.mjs"),
                         ("status", "--porcelain")):
                self.assertEqual(self.module["git"](*args), ("git", args))
            self.assertEqual(len(reads), 1)

    def test_changed_runtime_base_refuses_without_git_fallback(self):
        name = "server/db/read-only-snapshot.mjs"
        ns = {"BASE_SOURCE_COMMIT": "a" * 40, "ROOT": Path("/exact/runtime"),
              "EXISTING": {name: "0" * 64}, "safe_read": lambda _: b"changed",
              "sha": lambda value: hashlib.sha256(value).hexdigest()}
        with patch.dict(self.globals["engine"], {"namespace": lambda _: ns}):
            with self.assertRaisesRegex(RuntimeError, "dependency changed"):
                self.module["git"]("show", "a" * 40 + ":" + name)

    def test_source_fence_checks_both_new_tools_after_existing_fence(self):
        calls = []
        def git(*args):
            calls.append(args)
            return (HERE / args[1].rsplit("/", 1)[-1]).read_bytes()
        with patch.dict(self.globals, {"original_source_fence": lambda commit: calls.append(commit),
                                       "original_git": git}):
            self.module["source_fence"]("a" * 40)
        self.assertEqual(calls[0], "a" * 40)
        self.assertEqual(len(calls), 3)
        with patch.dict(self.globals, {"original_source_fence": lambda _: None,
                                       "original_git": lambda *_: b"different"}):
            with self.assertRaisesRegex(RuntimeError, "committed source"):
                self.module["source_fence"]("a" * 40)


    def test_merge_resolution_requires_exact_inputs_and_reviewed_output(self):
        name = "server/db/proof-index-reader.mjs"
        active, base, canonical = b"active", b"base", b"canonical"
        conflict, result = b"prefix CONFLICT suffix", b"prefix RESOLVED suffix"
        digest = lambda raw: hashlib.sha256(raw).hexdigest()
        rule = {"inputs": dict(zip(("active", "base", "canonical", "conflicted"),
                                   map(digest, (active, base, canonical, conflict)))),
                "returncode": 1, "replacements": [("CONFLICT", "RESOLVED")]}
        ns = {"MERGES": {name: rule}, "EXISTING": {name: digest(active)},
              "AFTER": {name: digest(result)}}
        merge = subprocess.CompletedProcess(["git", "merge-file"], 1, conflict)
        call = self.module["resolve_merge"]
        self.assertEqual(call(ns, name, canonical, active, base, merge), result)
        for args in ((canonical+b"x", active, base, merge),
                     (canonical, active+b"x", base, merge),
                     (canonical, active, base+b"x", merge),
                     (canonical, active, base, subprocess.CompletedProcess([], 2, conflict)),
                     (canonical, active, base, subprocess.CompletedProcess([], 1, conflict+b"x"))):
            with self.assertRaisesRegex(RuntimeError, "inputs"):
                call(ns, name, *args)
        for key in ("EXISTING", "AFTER"):
            bad = copy.deepcopy(ns); bad[key][name] = "0"*64
            with self.assertRaises(RuntimeError): call(bad, name, canonical, active, base, merge)
        bad = copy.deepcopy(ns); bad["MERGES"][name]["replacements"] = [("missing", "RESOLVED")]
        with self.assertRaisesRegex(RuntimeError, "resolution"):
            call(bad, name, canonical, active, base, merge)

    def test_unlisted_conflicts_refuse_and_clean_merges_pass_unchanged(self):
        call = self.module["resolve_merge"]
        with self.assertRaises(subprocess.CalledProcessError):
            call({}, "foreign", b"", b"", b"", subprocess.CompletedProcess([], 1, b"conflict"))
        self.assertEqual(call({}, "foreign", b"", b"", b"",
                              subprocess.CompletedProcess([], 0, b"clean")), b"clean")

    def test_structural_normalizer_refuses_unexpected_shape_or_scope(self):
        call = self.module["normalize_reviewed_merge"]
        conflict = b"<<<<<<< ACTIVE\nactive\n||||||| BASE\nbase\n=======\ncandidate\n>>>>>>> CANDIDATE\n"
        for name, raw, sides in (
            ("server/proof-api.mjs", conflict, []),
            ("server/proof-api.mjs", conflict, [1]),
            ("foreign", conflict, [2]),
            ("server/proof-api.mjs", conflict, [2]),
            ("server/db/proof-index-reader.mjs", conflict, [0]),
        ):
            with self.subTest(name=name, sides=sides):
                with self.assertRaises(RuntimeError): call(name, raw, sides)

    def test_health_planner_preserves_original_guards_and_only_binds_merge_hook(self):
        plan = self.module["health_build_plan"]()
        original = self.module["engine"]["build_plan"]
        self.assertEqual(plan.__code__.co_argcount, original.__code__.co_argcount)
        for name in ("private_path", "pinned", "namespace", "RUNTIME", "sha", "encode64"):
            self.assertIs(plan.__globals__[name], original.__globals__[name])
        self.assertIs(plan.__globals__["resolve_merge"], self.module["resolve_merge"])
        self.assertIs(plan.__globals__["git"], self.module["git"])
        self.assertIs(plan.__globals__["controller"], self.module["controller"])
        for fence in ("metadata_fence", "validate_manifest", "fence", "load_verifier"):
            self.assertIn(fence, plan.__code__.co_consts)

    def manifest_fixture(self):
        ns = self.module["engine"]["namespace"](self.module["controller"]())
        before = {name: f"export const before = {i};\n".encode()
                  for i, name in enumerate(ns["INSTALL_ORDER"])}
        after = {name: f"export const after = {i};\n".encode()
                 for i, name in enumerate(ns["INSTALL_ORDER"])}
        digest = lambda raw: hashlib.sha256(raw).hexdigest()
        ns["EXISTING"] = {name: digest(raw) for name, raw in before.items()}
        ns["AFTER"] = {name: digest(raw) for name, raw in after.items()}
        commit = "a" * 40
        release = commit[:12] + "-20261111T140000Z"
        manifest = {
            "format": ns["FAMILY"], "sourceCommit": commit,
            "releaseId": release, "baselineHead": ns["BASELINE_HEAD"],
            "baseSourceCommit": ns["BASE_SOURCE_COMMIT"],
            "acceptedInventorySha256": ns["ACCEPTED_SHA"],
            "services": list(ns["UNITS"]),
            "sources": [{"path": name, "before": ns["EXISTING"][name],
                         "after": ns["AFTER"][name],
                         "base64": base64.b64encode(after[name]).decode()}
                        for name in ns["INSTALL_ORDER"]],
            "sourceMetadata": {name: {"uid": 0, "gid": 0, "mode": 0o644}
                               for name in ns["INSTALL_ORDER"]},
            "dependencies": {"package.json": "b" * 64, "package-lock.json": "c" * 64},
            "nodeSha256": "d" * 64,
            "protectedServices": {
                "files": {name: "e" * 64 for name in ns["PROTECTED"]},
                "states": {name: {"ActiveState": "active", "MainPID": "123",
                                  "WorkingDirectory": str(ns["ROOT"])}
                           for name in ns["PROTECTED"]}},
            "gateway": {"files": {name: "f" * 64 for name in ns["GATEWAY"]},
                        "active": {name: "active" for name in ns["GATEWAY"]},
                        "unitFileStates": {name: "enabled" for name in ns["GATEWAY"]}},
            "searchHold": {"markerSha256": "0" * 64,
                           "bindings": {"releaseId": release, "attempt": "initial",
                                        "files": {name: "1" * 64 for name in ns["SEARCH"]}}},
        }
        return ns, manifest, before, after

    def test_manifest_accepts_only_exact_scope_order_and_reviewed_hashes(self):
        ns, manifest, _, after = self.manifest_fixture()
        self.assertEqual(ns["validate_manifest"](manifest), after)
        cases = []
        for key, value in (("baseSourceCommit", "b" * 40),
                           ("acceptedInventorySha256", "2" * 64),
                           ("baselineHead", "c" * 40),
                           ("format", "unapproved-runtime")):
            wrong = copy.deepcopy(manifest); wrong[key] = value; cases.append(wrong)
        wrong = copy.deepcopy(manifest); wrong["sources"].reverse(); cases.append(wrong)
        wrong = copy.deepcopy(manifest); wrong["sources"].pop(); cases.append(wrong)
        wrong = copy.deepcopy(manifest); wrong["sources"][0]["path"] = "server/unapproved.mjs"; cases.append(wrong)
        wrong = copy.deepcopy(manifest); wrong["sources"][0]["before"] = "3" * 64; cases.append(wrong)
        wrong = copy.deepcopy(manifest); wrong["sources"][0]["after"] = "4" * 64; cases.append(wrong)
        wrong = copy.deepcopy(manifest)
        changed = b"export const unreviewed = true;\n"
        wrong["sources"][0].update(base64=base64.b64encode(changed).decode(),
                                   after=hashlib.sha256(changed).hexdigest())
        cases.append(wrong)
        for index, wrong in enumerate(cases):
            with self.subTest(case=index), self.assertRaises(ValueError):
                ns["validate_manifest"](wrong)
        self.assertEqual(ns["validate_manifest"](manifest), after)

    def test_unreviewed_after_gate_refuses_even_structurally_valid_manifest(self):
        ns, manifest, _, _ = self.manifest_fixture()
        ns["AFTER"] = {}
        with self.assertRaisesRegex(ValueError, "not been reviewed"):
            ns["validate_manifest"](manifest)
        # The live profile deliberately starts closed; filling its pins later
        # must still preserve this refusal when a review pin is missing.
        real = self.module["engine"]["namespace"](self.module["controller"]())
        if real["AFTER"]:
            self.assertEqual(set(real["AFTER"]), set(real["EXISTING"]))
        else:
            manifest["sources"] = [{**row, "before": real["EXISTING"][row["path"]]}
                                   for row in manifest["sources"]]
            with self.assertRaisesRegex(ValueError, "not been reviewed"):
                real["validate_manifest"](manifest)

    def test_install_and_rollback_preserve_all_existing_bytes_and_metadata(self):
        ns, manifest, before, after = self.manifest_fixture()
        with tempfile.TemporaryDirectory(prefix="pow-health-release-fixture-") as directory:
            root = Path(directory) / "runtime"; backup = Path(directory) / "receipt"
            backup.mkdir(); metadata = {}; expected = {}
            for index, row in enumerate(manifest["sources"]):
                name = row["path"]; target = root / name
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(before[name]); mode = (0o644, 0o640, 0o600)[index]
                target.chmod(mode)
                metadata[name] = (os.getuid(), os.getgid(), mode)
                expected[name] = metadata[name]
                (backup / f"before-{index}.mjs").write_bytes(before[name])
                (backup / f"candidate-{index}.mjs").write_bytes(after[name])
            sentinel = root / "preserved-overlay.mjs"; sentinel.write_bytes(b"untouched")
            ns["install"](root, backup, manifest["sources"], metadata, True, "candidate")
            for name in before:
                target = root / name; info = target.stat()
                self.assertEqual(target.read_bytes(), after[name])
                self.assertEqual((info.st_uid, info.st_gid, stat.S_IMODE(info.st_mode)), expected[name])
            ns["install"](root, backup, manifest["sources"], metadata, False, "rollback")
            for name in before:
                target = root / name; info = target.stat()
                self.assertEqual(target.read_bytes(), before[name])
                self.assertEqual((info.st_uid, info.st_gid, stat.S_IMODE(info.st_mode)), expected[name])
            self.assertEqual(sentinel.read_bytes(), b"untouched")
            first = root / manifest["sources"][0]["path"]
            first.write_bytes(b"foreign source")
            with self.assertRaisesRegex(ValueError, "Source changed"):
                ns["install"](root, backup, manifest["sources"], metadata, True, "foreign")
            self.assertEqual(first.read_bytes(), b"foreign source")
            self.assertEqual(sentinel.read_bytes(), b"untouched")


if __name__ == "__main__":
    unittest.main()
