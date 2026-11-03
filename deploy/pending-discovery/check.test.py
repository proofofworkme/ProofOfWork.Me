#!/usr/bin/python3 -I
"""Offline release guard tests. Never access real service files or the network."""
import json
from pathlib import Path
import runpy
import tempfile
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
release = runpy.run_path(str(HERE / "release.py"))
engine, lab = release["engine"], release["lab"]
ns = engine["namespace"](release["controller"]())
API, WORKER, PG = lab["API"], lab["WORKER"], lab["POSTGRES"]


class PendingRelease(unittest.TestCase):
    def test_only_the_two_helpers_worker_and_api_are_installable(self):
        self.assertEqual(ns["INSTALL_ORDER"], ["server/pending-broadcast-hints.mjs", "server/pending-mempool-discovery.mjs", WORKER, API])
        self.assertEqual(ns["BASE_SOURCE_COMMIT"], "6b5c5d62e640f06a289b387851bae9f0c44de6ae")
        self.assertEqual(ns["ACCEPTED_SHA"], "e0b88282bbdc0c4353f1d2451f81840d938c71b666efc43de59a56975d5f1ab9")
        self.assertEqual(set(ns["EXISTING"]), {WORKER, API})
        self.assertNotIn("scripts/run-proof-indexer-worker.mjs", ns["ALLOWED"])

    def test_partial_and_wrong_candidates_cannot_pass_an_otherwise_valid_manifest(self):
        names = ns["INSTALL_ORDER"]
        candidates = {name: ("unique-" + name).encode() for name in names}
        hashes = {name: ns["sha"](data) for name, data in candidates.items()}
        manifest = {"sources": [{"path": name, "before": ns["EXISTING"].get(name), "after": hashes[name]} for name in names]}
        with patch.dict(ns, {"original_validate": lambda _: candidates, "EXPECTED_AFTER": hashes}):
            self.assertEqual(ns["validate_manifest"](manifest), candidates)
            manifest["sources"][0]["after"] = "0" * 64
            with self.assertRaises(ValueError): ns["validate_manifest"](manifest)
            manifest["sources"][0]["after"] = hashes[names[0]]
            manifest["sources"].pop()
            with self.assertRaises(ValueError): ns["validate_manifest"](manifest)

    def test_exact_tip_requires_eight_published_components_and_ready_worker(self):
        keys = ["growthSummary","inceptionSummary","infinitySummary","logSummary",
                "marketplaceSummary","tokenSummary","workFloor","workSummary"]
        h, digest = 974414, "a" * 64
        s = {"ok": True, "eligible": True, "indexedThroughBlock": h, "blockHash": digest,
             "coverageByKey": {key: h for key in keys}, "snapshotId": "b" * 24}
        state = {"ready": True, "ok": True, "checks": {"node": {"ok": True, "tipHeight": h, "bestBlockHash": digest},
              "worker": {"proofReady": True, "consecutiveFailures": 0},
              "index": {"complete": True, "checkpointCanonical": True, "indexedThroughBlock": h,
                        "checkpointHash": digest, "canonicalCheckpointHash": digest, "summarySnapshot": s}}}
        with patch.dict(release["previous"], {"health": lambda: state}):
            self.assertEqual(release["healthy"]()["snapshotId"], s["snapshotId"])
            s["coverageByKey"]["logSummary"] -= 1
            with self.assertRaises(ValueError): release["healthy"]()
            s["coverageByKey"]["logSummary"] = h
            state["checks"]["worker"]["proofReady"] = False
            with self.assertRaises(ValueError): release["healthy"]()

    def test_new_helpers_are_created_only_in_private_server_view(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "runtime"; out = Path(tmp) / "namespace"
            root.mkdir(); out.mkdir()
            paths = {API, WORKER, PG, *ns["NEW"]}
            for name in (API, WORKER, PG):
                p = root / name; p.parent.mkdir(parents=True, exist_ok=True); p.write_text("installed")
            candidates = {name: b"candidate" for name in ns["ALLOWED"]}
            manifest = {"dependencies": {PG: release["sha"](b"installed")}}
            context = {"ROOT": root, "NEW": ns["NEW"], "dependency_closure": lambda *_: paths,
                       "safe_read": Path.read_bytes}
            transforms = {"transform_api": lambda b: b + lab["TAIL"].encode(), "transform_worker": lambda b: b,
                          "transform_postgres": lambda b: b"guarded-postgres"}
            with patch.dict(lab, transforms):
                mounts = release["stage_sources"](out, context, manifest, candidates)
                self.assertEqual(mounts, [str(out / "server") + ":" + str(root / "server"),
                                          str(out / "worker.mjs") + ":" + str(root / WORKER)])
                for name in ns["NEW"]:
                    self.assertEqual((out / name).read_bytes(), b"candidate")
                    self.assertFalse((root / name).exists())
                self.assertEqual((root / API).read_bytes(), b"installed")
                self.assertEqual((out / PG).read_bytes(), b"guarded-postgres")
            self.assertEqual((root / PG).read_bytes(), b"installed")


if __name__ == "__main__":
    unittest.main()
