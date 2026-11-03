import base64
import os
from pathlib import Path
import runpy
import stat
import tempfile
import unittest

MODULE = Path(__file__).with_name("installer.py")


class StreamingToolInstallation(unittest.TestCase):
    def setUp(self):
        self.ns = runpy.run_path(str(MODULE))["run_locked"].__globals__
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.base = Path(self.tmp.name)
        self.live = self.base / "sbin"
        self.stage = self.base / "journal"
        self.live.mkdir(); self.stage.mkdir()
        self.ns["BIN"] = self.live
        self.prov, self.pub = self.ns["NAMES"]
        self.intent = {"files": {}}
        for n in self.ns["NAMES"]:
            (self.live / n).write_bytes(b"old " + n.encode())
            (self.stage / n).write_bytes(b"new " + n.encode())
            (self.live / n).chmod(0o755); (self.stage / n).chmod(0o755)
        def owner_read(path, limit=2*1024**2):
            s = path.lstat()
            if s.st_uid != os.getuid() or s.st_nlink != 1 or not stat.S_ISREG(s.st_mode):
                raise ValueError("Unsafe fixture file")
            return path.read_bytes(), self.ns["identity"](s)
        self.ns["safe_read"] = owner_read
        for n in self.ns["NAMES"]:
            self.intent["files"][n] = {"before": self.ns["descriptor"](self.live / n),
                                       "after": self.ns["descriptor"](self.stage / n)}

    def test_pair_promotes_and_rolls_back_exact_inodes(self):
        n = self.ns
        for state in ("after", "after", "before", "before"):
            n["transition"](self.stage, self.intent, state)
            self.assertEqual(n["positions"](self.stage, self.intent), dict.fromkeys(n["NAMES"], state))
            for name in n["NAMES"]:
                self.assertEqual(n["descriptor"](self.live / name), self.intent["files"][name][state])

    def test_partial_power_loss_resumes_or_reverts(self):
        n = self.ns
        for target in ("before", "after"):
            n["transition"](self.stage, self.intent, "before")
            n["exchange"](self.live / self.prov, self.stage / self.prov)
            self.assertEqual(n["positions"](self.stage, self.intent), {self.prov: "after", self.pub: "before"})
            n["transition"](self.stage, self.intent, target)
            self.assertEqual(n["positions"](self.stage, self.intent), dict.fromkeys(n["NAMES"], target))

    def test_same_bytes_foreign_inode_and_mutated_kept_helper_refuse_before_swapping(self):
        n = self.ns
        for name in (self.prov, self.pub):
            foreign = self.live / "unexpected"
            target = self.live / name
            foreign.write_bytes(target.read_bytes()); foreign.chmod(0o755); foreign.replace(target)
            with self.assertRaisesRegex(ValueError, "Unrecognized"):
                n["transition"](self.stage, self.intent, "after")
            self.assertEqual(target.read_bytes(), b"old " + name.encode())

    def test_root_or_rollback_render_failure_restores_pair(self):
        n = self.ns
        sha = n["sha"]; names = n["NAMES"]
        commit = "a"*40; journal = self.stage / commit
        journal.mkdir()
        for name in names:
            (self.stage / name).rename(journal / name)
        files = {name: {"sha256": self.intent["files"][name]["after"]["sha256"]} for name in names}
        n["STORE"] = self.stage; n["BEFORE"] = {name: self.intent["files"][name]["before"]["sha256"] for name in names}
        n["ARCHIVES"] = self.live
        n["directory"] = lambda *args, **kwargs: None
        n["guards"] = lambda: {"test": "bound"}
        n["checked_frame"] = lambda frame: None
        n["verify_pair"] = lambda *args, **kwargs: (_ for _ in ()).throw(ValueError("fixture archive verification failure"))
        self.intent.update({"schema": "s", "commit": commit, "tree": "b"*40, "manifests": n["guards"]()})
        n["record"](journal / "intent.json", self.intent)
        before = sha((journal / "intent.json").read_bytes())
        proofs = {rid: {"archiveSha256": digest, "outputSha256": "0"*64, "command": ["verify", "--archive-payload"]}
                  for _, rid, digest in n["PAIR"]}
        n["record"](journal / "qualified.json", {"intentSha256": before, "archives": proofs})
        frame = {"schema": "s", "commit": commit, "tree": self.intent["tree"], "files": files}
        with self.assertRaisesRegex(ValueError, "fixture archive"):
            n["run_locked"]("apply", frame, -1)
        self.assertEqual(n["positions"](journal, self.intent), dict.fromkeys(names, "before"))
        self.assertEqual(n["read_record"](journal / "rolled-back.json")["reason"], "apply-failed")
        self.assertFalse((journal / "installed.json").exists())

    def test_committed_candidate_frame_and_scope(self):
        n = self.ns
        raw = b"#!/bin/bash\n# pow-ui-stream-archive-verification-v1\nexit 0\n"
        row = {"sha256": n["sha"](raw), "base64": base64.b64encode(raw).decode()}
        frame = {"schema": "pow-ui-stream-tools-v1", "commit": "a"*40, "tree": "b"*40,
                 "files": {name: dict(row) for name in n["NAMES"]}}
        self.assertEqual(n["checked_frame"](frame), dict.fromkeys(n["NAMES"], raw))
        frame["files"]["unrequested"] = row
        with self.assertRaisesRegex(ValueError, "Expanded"):
            n["checked_frame"](frame)
        del frame["files"]["unrequested"]
        frame["files"][self.prov]["sha256"] = "0"*64
        with self.assertRaisesRegex(ValueError, "mismatch"):
            n["checked_frame"](frame)


if __name__ == "__main__":
    unittest.main()
