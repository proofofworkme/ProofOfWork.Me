import hashlib
import os
from pathlib import Path
import runpy
import tempfile
import unittest

HERE = Path(__file__).resolve().parent
release = runpy.run_path(str(HERE / "release.py"))


class ScopedPowcatRelease(unittest.TestCase):
    def setUp(self):
        self.ns = release["namespace"](release["controller"]())

    def test_exact_sources_and_engine_identity(self):
        self.assertEqual(self.ns["NEW"], {"src/shared/protocol/powcat1.mjs", "server/powcat-reader.mjs"})
        self.assertEqual(self.ns["ALLOWED"], self.ns["NEW"] | {"server/proof-api.mjs"})
        for path in release["PINS"]:
            self.assertEqual(hashlib.sha256(release["pinned"](path)).hexdigest(), release["PINS"][path])
        with self.assertRaisesRegex(ValueError, "provenance"):
            self.ns["validate_manifest"]({"format": "other"})

    def test_discovery_rotates_exact_scope_and_rejects_unreviewed_merge_hunks(self):
        controller = release["controller"]
        controller.__globals__["DISCOVERY"] = True
        try:
            ns = release["namespace"](controller())
        finally:
            controller.__globals__["DISCOVERY"] = False
        self.assertEqual(len(ns["EXISTING"]), 10)
        self.assertEqual(len(ns["NEW"]), 4)
        self.assertFalse(ns["NEW"] & ns["EXISTING"].keys())
        self.assertEqual(set(ns["INSTALL_ORDER"]), ns["ALLOWED"])
        self.assertEqual(ns["INSTALL_ORDER"][-1], "server/proof-api.mjs")
        with self.assertRaisesRegex(ValueError, "Unreviewed Search merge conflict"):
            ns["merge_search_coverage"](b"unpaired conflict")
        with self.assertRaisesRegex(ValueError, "reviewed coverage query"):
            ns["merge_search_coverage"](b"<<<<<<< ACTIVE\nunknown change\n>>>>>>> CANDIDATE\n" * 2)

    def test_scoped_application_rollback_and_foreign_helper_fence(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "runtime"
            backup = Path(tmp) / "receipt"
            backup.mkdir()
            api = "server/proof-api.mjs"
            rows, metadata = [], {}
            for i, path in enumerate(sorted(self.ns["NEW"]) + [api]):
                (root / path).parent.mkdir(parents=True, exist_ok=True)
                candidate = f"export const number = {i}".encode()
                (backup / f"candidate-{i}.mjs").write_bytes(candidate)
                before = None
                if path == api:
                    before = self.ns["sha"](b"active")
                    (root / path).write_bytes(b"active")
                    (root / path).chmod(0o644)
                    (backup / f"before-{i}.mjs").write_bytes(b"active")
                metadata[path] = (os.getuid(), os.getgid(), 0o644)
                rows.append({"path": path, "before": before, "after": self.ns["sha"](candidate)})
            self.ns["install"](root, backup, rows, metadata, True, "one")
            self.ns["install"](root, backup, rows, metadata, False, "two")
            self.assertEqual((root / api).read_bytes(), b"active")
            self.assertTrue(all(not (root / p).exists() for p in self.ns["NEW"]))
            self.ns["install"](root, backup, rows, metadata, True, "three")
            other = root / sorted(self.ns["NEW"])[0]
            replacement = other.with_suffix(".foreign")
            replacement.write_bytes(other.read_bytes())
            replacement.chmod(0o644)
            replacement.replace(other)
            with self.assertRaisesRegex(ValueError, "unowned helper"):
                self.ns["install"](root, backup, rows, metadata, False, "four")
            self.assertTrue(other.exists())


if __name__ == "__main__":
    unittest.main()
