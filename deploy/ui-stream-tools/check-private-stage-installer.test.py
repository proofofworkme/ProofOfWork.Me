#!/usr/bin/python3
"""The November 3 helper promotion is confined to the reviewed pair and its closure."""
import base64
import copy
import os
from pathlib import Path
import runpy
import tempfile
import unittest

HERE = Path(__file__).resolve().parent
DEPLOY = HERE.parent

class PrivateStageInstaller(unittest.TestCase):
    def setUp(self):
        self.n = runpy.run_path(str(HERE / "installer.py"))["checked_frame"].__globals__
        self.raw = {
            "proofofwork-ui-release-stage": (DEPLOY / "proofofwork-ui-release-stage.py").read_bytes(),
            "proofofwork-ui-release-publish": (DEPLOY / "proofofwork-ui-release-publish.sh").read_bytes(),
        }
        self.phase = (DEPLOY / "publish/phase_capacity.py").read_bytes()
        self.frame = {"schema": self.n["PRIVATE_SCHEMA"], "commit": "a"*40, "tree": "b"*40,
                      "retentionPins": {"state": "1"*64, "config": "2"*64},
                      "phaseSource": base64.b64encode(self.phase).decode(),
                      "files": {k: self.row(v) for k,v in self.raw.items()}}

    def row(self, raw):
        return {"sha256": self.n["sha"](raw), "base64": base64.b64encode(raw).decode()}

    def test_pinned_pair_and_independent_verifier(self):
        n = self.n
        self.assertEqual(n["checked_frame"](self.frame), self.raw)
        self.assertIn(n["BIN"] / "proofofwork-ui-release-provenance", n["GUARDS"])
        self.assertNotIn(n["BIN"] / "proofofwork-ui-release-stage", n["GUARDS"])
        self.assertEqual(n["GUARDS"][Path("/etc/proofofwork-retention/ui-lifecycle.json")], "2"*64)
        self.assertEqual(n["PAIR"][0][1], "54088ca155bc-20261103T032112Z")
        self.assertEqual(n["PAIR"][1][1], "c3969c39c2b2-20261101T051206Z")

    def test_tampered_or_expanded_executable_scope_refuses(self):
        for corruption in ("helper", "phase", "scope", "state"):
            with self.subTest(corruption):
                frame = copy.deepcopy(self.frame)
                if corruption == "helper":
                    frame["files"]["proofofwork-ui-release-stage"] = self.row(b"raise SystemExit(0)")
                elif corruption == "phase":
                    frame["phaseSource"] = base64.b64encode(b"raise SystemExit(0)").decode()
                elif corruption == "scope":
                    frame["files"]["proofofwork-ui-release-provenance"] = self.row(b"echo")
                else:
                    frame["retentionPins"]["state"] = ""
                with self.assertRaises(ValueError):
                    self.n["checked_frame"](frame)

    def test_native_graph_uses_both_roots_and_preserves_access_times(self):
        n = self.n
        n["checked_frame"](self.frame)
        with tempfile.TemporaryDirectory() as tmp:
            roots = [Path(tmp)/"live", Path(tmp)/"prior"]
            n["PAIR"] = tuple((path, rid, digest) for path, (_, rid, digest) in zip(roots, n["PAIR"]))
            for root in roots:
                for surface in "activity boost browser code computer desktop dns growth id inception infinity jobs landing marketplace nft pages permission publish search token wallet work".split():
                    folder = root / ("proofofwork-"+surface)
                    (folder/"assets").mkdir(parents=True)
                    (folder/"index.html").write_text('<script src="/assets/app.js"></script>')
                    (folder/"assets/app.js").write_text('const a = 1;')
                    for path in (folder/"index.html",folder/"assets/app.js"):
                        os.utime(path, ns=(1000000000,2000000000))
            # Break the fallback root: it must be traversed and fail before the
            # live graph counters are compared against the production pins.
            (roots[1]/"proofofwork-work/index.html").unlink()
            with self.assertRaises(FileNotFoundError):
                n["graph_proof"](self.raw["proofofwork-ui-release-stage"], self.phase)
            (roots[1]/"proofofwork-work/index.html").write_text('<script src="/assets/app.js"></script>')
            with self.assertRaisesRegex(ValueError, "Changed live prior-asset closure"):
                n["graph_proof"](self.raw["proofofwork-ui-release-stage"], self.phase)
            for path in ("index.html","assets/app.js"):
                self.assertEqual((roots[0]/"proofofwork-work"/path).stat().st_atime_ns,1000000000)

    def test_private_crash_resume_idempotent_apply_and_exact_rollback(self):
        import stat
        import subprocess
        from types import SimpleNamespace
        n = self.n
        candidate = n["checked_frame"](self.frame)
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            n.update(BIN=base/"sbin", STORE=base/"journal", ARCHIVES=base/"archives")
            for path in (n["BIN"], n["ARCHIVES"]):
                path.mkdir()
            n["checked_frame"] = lambda frame: candidate
            def fixture_read(path, limit=2*1024**2):
                metadata = path.lstat()
                if not stat.S_ISREG(metadata.st_mode) or metadata.st_nlink != 1:
                    raise ValueError("Unexpected fixture input")
                return path.read_bytes(), n["identity"](metadata)
            n.update(safe_read=fixture_read, directory=lambda *a,**k: None,
                     guards=lambda: {"fixture": "fixed"}, graph_proof=lambda *a: {"fixture": "verified"})
            n["BEFORE"] = {}  # Use inert fixture bytes for the original inodes.
            before = {}
            for name in n["NAMES"]:
                raw = ("original helper: "+name).encode()
                n["BEFORE"][name] = n["sha"](raw)
                path = n["BIN"]/name
                path.write_bytes(raw)
                path.chmod(0o755)
                before[name] = n["descriptor"](path)
            n["subprocess"] = SimpleNamespace(run=lambda *a,**k: None, DEVNULL=subprocess.DEVNULL)
            verified = []
            def verify(path, fd, *, payload=False):
                self.assertEqual(path, n["BIN"]/"proofofwork-ui-release-provenance")
                command = ["verify","--archive-payload"] if payload else ["verify-rollback"]
                verified.append(command)
                return {rid: {"command": command,"outputSha256": "f"*64,"archiveSha256": checksum}
                        for _, rid, checksum in n["PAIR"]}
            n["verify_pair"] = verify
            prepare = n["run_locked"]("prepare", self.frame, -1)
            journal = Path(prepare["journal"])
            self.assertEqual(n["run_locked"]("prepare", self.frame, -1), prepare)
            stage = n["NAMES"][0]
            n["exchange"](n["BIN"]/stage, journal/stage)
            apply = n["run_locked"]("apply", self.frame, -1)
            self.assertEqual(n["run_locked"]("apply", self.frame, -1), apply)
            self.assertEqual(verified, [["verify","--archive-payload"], ["verify-rollback"]])
            self.assertEqual(apply["files"], n["PRIVATE_AFTER"])
            self.assertEqual({name:n["descriptor"](journal/name) for name in n["NAMES"]}, before)
            rollback = n["run_locked"]("rollback", self.frame, -1)
            self.assertEqual(n["run_locked"]("rollback", self.frame, -1), rollback)
            self.assertEqual({name:n["descriptor"](n["BIN"]/name) for name in n["NAMES"]}, before)
            with self.assertRaisesRegex(ValueError, "rolled-back release needs new review"):
                n["run_locked"]("apply", self.frame, -1)

if __name__ == "__main__":
    unittest.main()
