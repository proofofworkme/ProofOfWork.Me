#!/usr/bin/env python3
"""Pure deployment guard fixtures; no production services or network contacted."""
import copy
import hashlib
import os
from pathlib import Path
import runpy
import stat
import subprocess
import tempfile
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
Historical = runpy.run_path(str(HERE.parent / "health-readiness/check.test.py"))["HealthReleaseTests"]
sha = lambda b: hashlib.sha256(b).hexdigest()
NAME = "server/db/proof-index-reader.mjs"
START = b"export async function proofIndexCanonicalActivityPayload("
END = b"\nfunction eventHistoryFilters("

class ActivityReleaseTests(unittest.TestCase):
    def setUp(self):
        self.module = runpy.run_path(str(HERE / "release.py"))
        self.ns = self.module["engine"]["namespace"](self.module["controller"]())

    def manifest_fixture(self):
        ns, m, before, after = Historical.manifest_fixture(self)
        m["dependencies"].update(ns["PRESERVED"])
        return ns, m, before, after

    def test_manifest_exact_single_file_scope_and_hashes(self):
        ns, m, _, after = self.manifest_fixture()
        self.assertEqual(ns["validate_manifest"](m), after)
        mutations = [
            ("format", "foreign"), ("baseSourceCommit", "f"*40),
            ("baselineHead", "f"*40), ("acceptedInventorySha256", "f"*64),
            ("services", ["proofofwork-api.service"]), ("sources", []),
        ]
        for key, value in mutations:
            bad = copy.deepcopy(m); bad[key] = value
            with self.subTest(key=key), self.assertRaises(ValueError):
                ns["validate_manifest"](bad)
        for key in ("before", "after", "path", "base64"):
            bad = copy.deepcopy(m); bad["sources"][0][key] = "foreign"
            with self.subTest(key=key), self.assertRaises((ValueError, KeyError)):
                ns["validate_manifest"](bad)
        ns["AFTER"] = {}
        with self.assertRaises(ValueError): ns["validate_manifest"](m)

    def test_preserved_dependencies_refuse_drift_or_absence(self):
        ns, m, _, _ = self.manifest_fixture()
        for name in ns["PRESERVED"]:
            for value in (None, "0"*64):
                bad = copy.deepcopy(m)
                if value is None: del bad["dependencies"][name]
                else: bad["dependencies"][name] = value
                with self.subTest(name=name, value=value), self.assertRaises(ValueError):
                    ns["validate_manifest"](bad)

    def test_immutable_controller_and_two_service_lifecycle(self):
        raw = self.module["controller"]()
        self.assertEqual(self.ns["ALLOWED"], {NAME})
        self.assertEqual(self.ns["INSTALL_ORDER"], [NAME])
        self.assertFalse(self.ns["NEW"])
        self.assertEqual(self.ns["UNITS"], ("proofofwork-api.service", "proofofwork-indexer-worker.service"))
        self.assertEqual(sha(self.module["ENGINE"].read_bytes()), self.module["ENGINE_SHA"])
        for term in (b"Accepted source inventory changed", b"require_protected_services",
                     b"require_apps_drained", b"restore_verified_apps",
                     b"backup = BACKUPS/('activity-fee-factor-'"):
            self.assertIn(term, raw)

    def test_source_fence_requires_committed_adapter(self):
        g = self.module["source_fence"].__globals__; calls=[]
        def git(*args):
            calls.append(args)
            return (HERE / args[1].rsplit("/", 1)[-1]).read_bytes()
        with patch.dict(g, {"original_source_fence": lambda c: calls.append(c)}), patch.dict(g["engine"], {"git":git}):
            self.module["source_fence"]("a"*40)
        self.assertEqual(len(calls), 3)
        with patch.dict(g, {"original_source_fence":lambda _:None}), patch.dict(g["engine"], {"git":lambda *_:b"drift"}):
            with self.assertRaises(RuntimeError): self.module["source_fence"]("a"*40)

    def fixture_splice(self):
        old=START+b") { return 1; }"; new=START+b") { return 2; }"
        active=b"accepted overlay\n"+old+END+b") {}\n"
        base=b"baseline\n"+old+END+b") {}\n"
        source=b"new unrelated source\n"+new+END+b") { changed(); }\n"
        after=b"accepted overlay\n"+new+END+b") {}\n"
        ns={"SPLICE":dict(path=NAME,active=sha(active),base=sha(base),canonical=sha(source),
                         oldFunction=sha(old),newFunction=sha(new),after=sha(after)),
            "AFTER":{NAME:sha(after)}}
        return ns, source, active, base, after

    def test_splice_preserves_all_unrelated_overlay_bytes_ignores_merge_output(self):
        ns, source, active, base, after=self.fixture_splice()
        for code in (0,1):
            self.assertEqual(self.module["resolve_merge"](ns,NAME,source,active,base,
                subprocess.CompletedProcess([],code,b"untrusted merge output")),after)

    def test_splice_rejects_every_changed_pin_and_foreign_path(self):
        ns, source, active, base, _=self.fixture_splice()
        call=self.module["resolve_merge"]
        for key in ns["SPLICE"]:
            bad=copy.deepcopy(ns); bad["SPLICE"][key]="0"*64
            with self.subTest(key=key), self.assertRaises(RuntimeError):
                call(bad,NAME,source,active,base,None)
        for index in range(3):
            args=[source,active,base]; args[index]+=b"drift"
            with self.assertRaises(RuntimeError): call(ns,NAME,*args,None)
        bad=copy.deepcopy(ns); bad["AFTER"][NAME]="0"*64
        with self.assertRaises(RuntimeError): call(bad,NAME,source,active,base,None)
        with self.assertRaises(RuntimeError): call(ns,"foreign",source,active,base,None)

    def test_boundaries_and_baseline_equality(self):
        ns, source, active, base, _=self.fixture_splice()
        for badbase in (base+START, base.replace(END,b"missing"),base.replace(b"return 1",b"return 3")):
            bad=copy.deepcopy(ns); bad["SPLICE"]["base"]=sha(badbase)
            with self.assertRaises((RuntimeError,ValueError)):
                self.module["resolve_merge"](bad,NAME,source,active,badbase,None)

    def test_planner_retains_engine_guards(self):
        plan=self.module["audit_build_plan"]()
        original=self.module["engine"]["build_plan"]
        for name in ("private_path","pinned","namespace","RUNTIME","sha","encode64"):
            self.assertIs(plan.__globals__[name],original.__globals__[name])
        for fence in ("metadata_fence","validate_manifest","fence","load_verifier"):
            self.assertIn(fence,plan.__code__.co_consts)
        self.assertIs(plan.__globals__["resolve_merge"],self.module["resolve_merge"])

    def test_install_and_rollback_preserve_bytes_metadata_and_unrelated_files(self):
        ns,m,before,after=self.manifest_fixture()
        with tempfile.TemporaryDirectory(prefix="pow-activity-fixture-") as directory:
            root=Path(directory)/"runtime"; backup=Path(directory)/"backup"
            backup.mkdir(); target=root/NAME; target.parent.mkdir(parents=True)
            target.write_bytes(before[NAME]); target.chmod(0o640)
            metadata={NAME:(os.getuid(),os.getgid(),0o640)}
            sentinel=root/"accepted.mjs"; sentinel.write_bytes(b"preserved")
            (backup/"before-0.mjs").write_bytes(before[NAME])
            (backup/"candidate-0.mjs").write_bytes(after[NAME])
            for candidate,expected in ((True,after[NAME]),(False,before[NAME])):
                ns["install"](root,backup,m["sources"],metadata,candidate,"fixture")
                self.assertEqual(target.read_bytes(),expected)
                info=target.stat()
                self.assertEqual((info.st_uid,info.st_gid,stat.S_IMODE(info.st_mode)),metadata[NAME])
                self.assertEqual(sentinel.read_bytes(),b"preserved")

if __name__=="__main__":
    unittest.main()
