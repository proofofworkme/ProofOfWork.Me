#!/usr/bin/python3
"""The November 3 helper promotion is confined to the reviewed pair and its closure."""
import base64
import copy
import json
import os
from pathlib import Path
import runpy
import stat
import subprocess
import sys
import tempfile
import unittest
from types import ModuleType, SimpleNamespace
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
DEPLOY = HERE.parent

def historical_publisher(candidate):
    """Reconstruct the exact e27 shell bytes by restoring its single native-helper pin."""
    old = b"9b2c7c22189c38ed35d308f514a70c2885f0497c1b9782e2906e5c7fdb2553b4"
    current = b"35a82fffba5ae50c43bd78a8e3a32c217a718e729f73500f53f17eb2e55a244f"
    if candidate.count(current) != 1:
        raise AssertionError("Unexpected publisher native-helper pin")
    return candidate.replace(current, old)


class PrivateStageInstaller(unittest.TestCase):
    def setUp(self):
        self.n = runpy.run_path(str(HERE / "installer.py"))["checked_frame"].__globals__
        self.raw = {
            "proofofwork-ui-release-stage": (DEPLOY / "proofofwork-ui-release-stage.py").read_bytes(),
            "proofofwork-ui-release-publish": (DEPLOY / "proofofwork-ui-release-publish.sh").read_bytes(),
        }
        publisher = "proofofwork-ui-release-publish"
        self.raw[publisher] = historical_publisher(self.raw[publisher])
        self.assertEqual(self.n["sha"](self.raw[publisher]), self.n["PRIVATE_AFTER"][publisher])
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


class PublisherSuccessorTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.connect_fixture_host()
        n = self.n
        for path in (self.live, self.previous.parent, self.previous, self.evidence, self.archives):
            path.mkdir(parents=True)
            path.chmod(0o700)
        self.storage = (DEPLOY / "audit30/ui-storage.py").read_bytes()
        self.raw = (DEPLOY / "proofofwork-ui-release-publish.sh").read_bytes()
        self.stage_bytes = (DEPLOY / "proofofwork-ui-release-stage.py").read_bytes()
        phase = (DEPLOY / "publish/phase_capacity.py").read_bytes()
        self.frame = dict(schema=n["SUCCESSOR_SCHEMA"], commit="e" * 40, tree="f" * 40,
                          retentionPins=dict(n["SUCCESSOR_LIFECYCLE"]),
                          phaseSource=base64.b64encode(phase).decode(),
                          storageSource=base64.b64encode(self.storage).decode(),
                          files={self.pub: self.row(self.raw)})
        n["SUCCESSOR_STORAGE_SHA"] = n["sha"](self.storage)
        self.assertEqual(n["SUCCESSOR_AFTER"], n["sha"](self.raw))
        self.assertEqual(n["PRIVATE_AFTER"][self.stage], n["sha"](self.stage_bytes))

        predecessor = historical_publisher(self.raw)
        self.assertEqual(n["sha"](predecessor), n["PRIVATE_AFTER"][self.pub])
        self.old_files = {}
        for name, current in ((self.pub, predecessor), (self.stage, self.stage_bytes)):
            n["create"](self.live / name, current, 0o755)
            n["create"](self.previous / name, ("retained original " + name).encode(), 0o755)
            self.old_files[name] = {"before": n["descriptor"](self.previous / name),
                                  "after": n["descriptor"](self.live / name)}
        self.pinned_stage = n["descriptor"](self.live / self.stage)
        self.prior_publish = n["descriptor"](self.live / self.pub)
        self.paths = {}
        n["checked_frame"](self.frame)
        self.prepare_predecessor()
        self.held_root = self.root / "fallback-storage"
        self.held_root.mkdir(mode=0o700)
        self.held = [self.held_root / ("fallback-" + name) for name in ("root", "archive", "checksum", "provenance")]
        self.held[0].mkdir(mode=0o700)
        n["create"](self.held[0] / "index.html", b"held root")
        for path in self.held[1:]:
            n["create"](path, path.name.encode())
        storage = ModuleType("test_successor_storage")
        storage.__file__ = str(DEPLOY / "audit30/ui-storage.py")
        exec(compile(self.storage, storage.__file__, "exec"), storage.__dict__)
        self.snapshot = storage.snapshot
        self.initial_held = {p: self.snapshot(p)["sha256"] for p in self.held}
        if storage._snapshot_clock is not None:
            self.addCleanup(storage._snapshot_clock.close)
        n["SUCCESSOR_FALLBACK"] = self.initial_held.copy()
        snapshots = [self.snapshot(p) for p in self.held]
        admissions = {
            "root": {"roots": [{"snapshot": snapshots[0]}]},
            "archive": {"archives": [{"snapshot": snapshots[1], "sidecars": snapshots[2:]}]},
        }
        n["SUCCESSOR_ADMISSIONS"] = {}
        for kind, record in admissions.items():
            path = self.root / (kind + "-admission.json")
            n["record"](path, record)
            info = path.stat()
            n["SUCCESSOR_ADMISSIONS"][kind] = (path, n["sha"](path.read_bytes()), info.st_ino,
                                               info.st_size, info.st_mtime_ns)

    def connect_fixture_host(self):
        self.n = runpy.run_path(str(HERE / "installer.py"))["checked_frame"].__globals__
        n = self.n
        self.stage, self.pub = (n["PREFIX"] + key for key in ("stage", "publish"))
        self.live = self.root / "sbin"
        self.previous = self.root / "prior" / n["SUCCESSOR_BASE"]
        self.evidence = self.root / "source-evidence"
        self.next_store = self.root / "next-store"
        self.archives = self.root / "archives"
        # Adapt only the privileged UID check to our disposable POSIX user.
        # Keep the real inode, link count, mode, size, bytes and mtime.
        def fixture_read(path, limit=2 * 1024**2):
            info = path.lstat()
            if (path.resolve() != path or not stat.S_ISREG(info.st_mode)
                    or info.st_nlink != 1 or info.st_mode & 0o7022 or info.st_size > limit):
                raise ValueError("Unsafe synthetic input")
            ident = n["identity"](info)
            ident[2:4] = [0, 0]
            return path.read_bytes(), ident
        def fixture_directory(path, private=False):
            info = path.lstat()
            if (path.resolve() != path or not stat.S_ISDIR(info.st_mode)
                    or info.st_mode & 0o7022 or private and stat.S_IMODE(info.st_mode) != 0o700):
                raise ValueError("Unsafe synthetic directory")
        n.update(BIN=self.live, ARCHIVES=self.archives, SUCCESSOR_PRIOR_STORE=self.previous.parent,
                 SUCCESSOR_EVIDENCE=self.evidence, safe_read=fixture_read, directory=fixture_directory)
        profile = n["successor_profile"]
        def sandboxed_profile(frame):
            profile(frame)
            n["STORE"] = self.next_store
        n["successor_profile"] = sandboxed_profile
        def projection(field, live_only=False):
            pair = n["PAIR"][:1] if live_only else n["PAIR"]
            return {rid: {field: rid} for _, rid, _ in pair}
        n["guards"] = lambda *, live_only=False: projection("manifest", live_only)
        n["graph_proof"] = lambda *args, live_only=False: projection("graph", live_only)
        def verify(path, lock_fd, *, payload=False):
            self.assertEqual(path, self.live / (n["PREFIX"] + "provenance"))
            return self.proof(payload)
        n["verify_pair"] = verify
        real_subprocess = n["subprocess"]
        def capacity_only(args, **kwargs):
            if str(self.live / "proofofwork-ui-capacity") in args:
                return None
            return real_subprocess.run(args, **kwargs)
        n["subprocess"] = SimpleNamespace(run=capacity_only, DEVNULL=subprocess.DEVNULL)

    def prepare_predecessor(self):
        n = self.n
        n["SUCCESSOR_DEVICE"] = self.previous.stat().st_dev
        n["SUCCESSOR_PRIOR_INODE"] = self.previous.stat().st_ino
        n["SUCCESSOR_EVIDENCE_INODE"] = self.evidence.stat().st_ino
        n["SUCCESSOR_STAGER_CTIME"] = (self.live / self.stage).stat().st_ctime_ns
        pins = {}
        def record(folder, name, data):
            pins[name] = self.make_receipt(name, folder / name, data)
            return pins[name][0]
        manifests = n["guards"]()
        manifests.update(graphProof=n["graph_proof"](), lifecyclePins=self.frame["retentionPins"])
        intent_sha = record(self.previous, "intent.json", {"schema": n["PRIVATE_SCHEMA"], "commit": n["SUCCESSOR_BASE"],
                          "tree": n["SUCCESSOR_TREE"], "files": self.old_files, "manifests": manifests})
        qual_sha = record(self.previous, "qualified.json", {"intentSha256": intent_sha, "archives": self.proof(True)})
        record(self.previous, "installed.json", {"intentSha256": intent_sha, "qualificationSha256": qual_sha, "archives": self.proof(False)})
        for name, phase, side in (("prepare.json", "prepare", "before"), ("apply.json", "apply", "after"),
                                ("helper-status.json", "status", "after")):
            record(self.evidence, name, {"ok": True, "phase": phase, "commit": n["SUCCESSOR_BASE"], "journal": str(self.previous),
                       "qualified": True, "installedReceipt": side == "after", "rollbackReceipt": False,
                       "positions": {name: side for name in self.old_files},
                       "files": {name: row[side]["sha256"] for name, row in self.old_files.items()}})
        n["SUCCESSOR_RECEIPTS"] = pins

    def restore_receipt(self, path, raw):
        # Each subcase starts with a clean, independent synthetic receipt inode
        # and timestamp binding. The original production constants stay pinned.
        path.write_bytes(raw)
        s = path.stat()
        self.assertEqual(s.st_ctime_ns, s.st_mtime_ns)
        self.n["SUCCESSOR_RECEIPTS"][path.name] = (self.n["sha"](raw), s.st_ino, s.st_size, s.st_mtime_ns)

    def row(self, raw):
        return {"sha256": self.n["sha"](raw), "base64": base64.b64encode(raw).decode()}

    def proof(self, payload):
        cmd = ["verify", "--archive-payload"] if payload else ["verify-rollback"]
        return {rid: {"command": cmd, "outputSha256": "f" * 64, "archiveSha256": expected}
                for _, rid, expected in self.n["PAIR"]}

    def make_receipt(self, tag, path, value):
        n = self.n
        n["record"](path, value)
        s = path.lstat()
        self.paths[tag] = path
        return n["sha"](path.read_bytes()), s.st_ino, s.st_size, s.st_mtime_ns

    def run_phase(self, phase):
        n = self.n
        return n["run_locked"](phase, self.frame, -1)

    def assert_preserved(self):
        self.assertEqual({p: self.snapshot(p)["sha256"] for p in self.held}, self.initial_held)
        self.assertEqual(self.n["descriptor"](self.live / self.stage), self.pinned_stage)
        self.assertEqual({name: self.n["descriptor"](self.previous / name) for name in self.old_files},
                         {name: row["before"] for name, row in self.old_files.items()})

    def test_successor_resume_idempotence_and_rollback(self):
        prepare = self.run_phase("prepare")
        self.assertEqual(self.run_phase("prepare"), prepare)
        journal = Path(prepare["journal"])
        self.assertEqual(set(prepare["files"]), {self.pub})
        self.assertTrue((journal / self.pub).is_file())
        self.assertFalse((journal / self.stage).exists())
        # Precisely the crash window after the one exchange and before its receipt.
        self.n["exchange"](self.live / self.pub, journal / self.pub)
        apply = self.run_phase("apply")
        self.assertEqual(self.run_phase("apply"), apply)
        self.assertEqual(self.run_phase("status")["positions"], {self.pub: "after"})
        self.assertEqual(self.n["descriptor"](journal / self.pub), self.prior_publish)
        self.assert_preserved()
        rollback = self.run_phase("rollback")
        self.assertEqual(self.run_phase("rollback"), rollback)
        self.assertEqual(self.n["descriptor"](self.live / self.pub), self.prior_publish)
        self.assert_preserved()
        with self.assertRaises(ValueError):
            self.run_phase("apply")

    def test_every_original_receipt_independently_required(self):
        for name, path in self.paths.items():
            with self.subTest(name=name):
                raw = path.read_bytes()
                path.write_bytes(raw + b" ")
                with self.assertRaises((ValueError, OSError)):
                    self.run_phase("prepare")
                self.restore_receipt(path, raw)
                # A missing original also blocks preparation even if all other
                # receipts and both live helpers are still present.
                aside = path.with_name(path.name + ".original")
                path.rename(aside)
                try:
                    with self.assertRaises((ValueError, OSError)):
                        self.run_phase("prepare")
                finally:
                    aside.rename(path)
                    self.restore_receipt(path, raw)
                self.assertFalse((self.next_store / self.frame["commit"]).exists())
                self.assert_preserved()

    def test_equal_bytes_new_inode_refuses(self):
        for path in (self.live / self.stage, self.live / self.pub, self.previous / self.pub,
                     self.previous / self.stage, *self.paths.values()):
            with self.subTest(path=path):
                raw = path.read_bytes()
                st = path.stat()
                saved = path.with_name(path.name + ".original")
                path.rename(saved)
                try:
                    path.write_bytes(raw)
                    path.chmod(stat.S_IMODE(st.st_mode))
                    os.utime(path, ns=(st.st_atime_ns, st.st_mtime_ns))
                    self.assertNotEqual(path.stat().st_ino, st.st_ino)
                    with self.assertRaises((ValueError, OSError)):
                        self.run_phase("prepare")
                finally:
                    path.unlink()
                    saved.rename(path)
                    if path.name in self.paths:
                        self.restore_receipt(path, raw)
                    elif path == self.live / self.stage:
                        self.n["SUCCESSOR_STAGER_CTIME"] = path.stat().st_ctime_ns
                self.assertFalse((self.next_store / self.frame["commit"]).exists())
                self.assert_preserved()

    def test_frame_rejects_unreviewed_payloads_and_retention_pins(self):
        self.assertEqual(self.n["checked_frame"](self.frame), {self.pub: self.raw})
        for case in ("publisher", "stager", "phase", "storage", "state", "config"):
            with self.subTest(case=case):
                frame = copy.deepcopy(self.frame)
                if case == "publisher":
                    frame["files"][self.pub] = self.row(self.raw + b"\n# otherwise valid shell\n")
                elif case == "stager":
                    frame["files"][self.stage] = self.row(self.stage_bytes)
                elif case == "phase":
                    frame["phaseSource"] = base64.b64encode(b"pass").decode()
                elif case == "storage":
                    frame["storageSource"] = base64.b64encode(self.storage + b"\n").decode()
                else:
                    frame["retentionPins"][case] = "0" * 64
                with self.assertRaises(ValueError):
                    self.n["checked_frame"](frame)

    def test_independently_pinned_receipt_with_wrong_link_is_refused(self):
        for tag, key, value, error in (
            ("qualified.json", "intentSha256", "0" * 64, "qualification or installation binding"),
            ("installed.json", "qualificationSha256", "1" * 64, "qualification or installation binding"),
            ("prepare.json", "qualified", False, "operator receipt"),
            ("helper-status.json", "installedReceipt", False, "operator receipt"),
        ):
            with self.subTest(tag=tag):
                path = self.paths[tag]
                original = path.read_bytes()
                receipt = json.loads(original)
                receipt[key] = value
                mutated = (json.dumps(receipt, sort_keys=True) + "\n").encode()
                self.restore_receipt(path, mutated)
                with self.assertRaisesRegex(ValueError, error):
                    self.run_phase("prepare")
                self.restore_receipt(path, original)
                self.assert_preserved()

    def test_live_retained_inode_replacement_after_qualification_refuses_apply(self):
        self.run_phase("prepare")
        path = self.held[1]
        replacement = path.with_name("replacement")
        replacement.write_bytes(path.read_bytes())
        info = path.stat()
        replacement.chmod(stat.S_IMODE(info.st_mode))
        os.utime(replacement, ns=(info.st_atime_ns, info.st_mtime_ns))
        replacement.replace(path)
        with self.assertRaisesRegex(ValueError, "retained fallback"):
            self.run_phase("apply")
        self.assertEqual(self.n["descriptor"](self.live / self.pub), self.prior_publish)
        self.assertEqual(self.n["descriptor"](self.live / self.stage), self.pinned_stage)
        self.assertEqual({p: self.snapshot(p)["sha256"] for p in self.held if p != path},
                         {p: sha for p, sha in self.initial_held.items() if p != path})
        self.assertFalse((self.next_store / self.frame["commit"] / "installed.json").exists())

    def test_interrupted_preparation_reuses_verified_candidate_inode(self):
        def interrupt_before_intent(path, data):
            raise InterruptedError("intent not written")
        with patch.dict(self.n, {"successor_record": interrupt_before_intent}):
            with self.assertRaisesRegex(InterruptedError, "intent not written"):
                self.run_phase("prepare")
        journal = self.next_store / self.frame["commit"]
        self.assertEqual(set(p.name for p in journal.iterdir()), {self.pub})
        staged = self.n["descriptor"](journal / self.pub)
        status = self.run_phase("status")
        self.assertFalse(status["prepared"])
        self.assertTrue(status["interruptedPreparation"])
        self.run_phase("prepare")
        self.assertEqual(staged, self.n["descriptor"](journal / self.pub))
        self.assert_preserved()

    def test_replacement_during_last_guard_read_prevents_exchange(self):
        self.run_phase("prepare")
        original_guards = self.n["guards"]
        original_exchange = self.n["exchange"]
        path = self.held[0] / "index.html"
        calls = []
        exchanges = []

        def replace_after_scan(*, live_only=False):
            if live_only:
                return original_guards(live_only=True)
            calls.append(None)
            if len(calls) == 4:
                info = path.stat()
                replacement = path.with_suffix(".new")
                replacement.write_bytes(path.read_bytes())
                replacement.chmod(stat.S_IMODE(info.st_mode))
                os.utime(replacement, ns=(info.st_atime_ns, info.st_mtime_ns))
                replacement.replace(path)
                self.assertNotEqual(path.stat().st_ino, info.st_ino)
            return original_guards()

        def counted_exchange(left, right):
            exchanges.append((left, right))
            return original_exchange(left, right)

        with patch.dict(self.n, {"guards": replace_after_scan, "exchange": counted_exchange}):
            with self.assertRaises(ValueError):
                self.run_phase("apply")
        self.assertGreaterEqual(len(calls), 4)
        self.assertEqual(exchanges, [])
        self.assertEqual(self.n["descriptor"](self.live / self.pub), self.prior_publish)
        self.assertEqual(self.n["descriptor"](self.live / self.stage), self.pinned_stage)

    def test_failed_apply_restore_rechecks_hold_before_sealing(self):
        prepare = self.run_phase("prepare")
        journal = Path(prepare["journal"])
        original_fallback = self.n["successor_fallback"]
        attempted = False
        def fail_rollback_readback(path, lock_fd, *, payload=False):
            nonlocal attempted
            attempted = True
            raise RuntimeError("rollback proof unavailable")
        def fail_post_restore(source):
            if attempted and self.n["descriptor"](self.live / self.pub) == self.prior_publish:
                raise RuntimeError("post-restore evidence unavailable")
            return original_fallback(source)
        with patch.dict(self.n, {"verify_pair": fail_rollback_readback, "successor_fallback": fail_post_restore}):
            with self.assertRaisesRegex(RuntimeError, "post-restore evidence unavailable"):
                self.run_phase("apply")
        self.assertTrue((journal / "rollback-intent.json").is_file())
        self.assertFalse((journal / "rolled-back.json").exists())
        self.assertFalse((journal / "installed.json").exists())
        self.assertEqual(self.n["descriptor"](self.live / self.pub), self.prior_publish)
        self.assert_preserved()
        restored = self.run_phase("rollback")
        self.assertEqual(self.run_phase("rollback"), restored)
        self.assertTrue(restored["rollbackReceipt"])
        self.assert_preserved()

    def test_explicit_rollback_seals_only_after_reverification(self):
        self.run_phase("prepare")
        apply = self.run_phase("apply")
        journal = Path(apply["journal"])
        original = self.n["successor_fallback"]
        def fail_after_restore(source):
            if self.n["descriptor"](self.live / self.pub) == self.prior_publish:
                raise RuntimeError("post-restore evidence unavailable")
            return original(source)
        with patch.dict(self.n, {"successor_fallback": fail_after_restore}):
            with self.assertRaisesRegex(RuntimeError, "post-restore evidence unavailable"):
                self.run_phase("rollback")
        self.assertTrue((journal / "rollback-intent.json").is_file())
        self.assertFalse((journal / "rolled-back.json").exists())
        self.assertEqual(self.n["descriptor"](self.live / self.pub), self.prior_publish)
        self.assert_preserved()
        self.assertTrue(self.run_phase("rollback")["rollbackReceipt"])
        self.assert_preserved()



    def fresh_phase(self, phase):
        # A new isolated Python process reads the fixture pins and recovers
        # from the on-disk journals, without the initiating process's state.
        keys = ("SUCCESSOR_DEVICE", "SUCCESSOR_PRIOR_INODE", "SUCCESSOR_EVIDENCE_INODE",
                "SUCCESSOR_STAGER_CTIME", "SUCCESSOR_RECEIPTS", "SUCCESSOR_STORAGE_SHA")
        data = {
            "root": str(self.root), "frame": self.frame, "phase": phase,
            "pins": {key: self.n[key] for key in keys},
            "admissions": {key: [str(row[0]), *row[1:]] for key, row in self.n["SUCCESSOR_ADMISSIONS"].items()},
            "held": {str(path): digest for path, digest in self.initial_held.items()},
        }
        bootstrap = (
            "import json,runpy,sys\n"
            "suite=runpy.run_path(sys.argv[1])\n"
            "print(json.dumps(suite['reenter_successor'](json.load(sys.stdin))))"
        )
        result = subprocess.run(
            [sys.executable, "-I", "-B", "-c", bootstrap, str(Path(__file__).resolve())],
            input=json.dumps(data), text=True, capture_output=True, timeout=40, check=True,
        )
        return json.loads(result.stdout)

    def test_fresh_recovery_requires_original_proof_and_exposes_unsealed_rollback(self):
        prepare = self.run_phase("prepare")
        journal = Path(prepare["journal"])
        self.n["exchange"](self.live / self.pub, journal / self.pub)
        reversal = {"intent": self.n["descriptor"](journal / "intent.json"),
                    "qualification": self.n["descriptor"](journal / "qualified.json")}
        self.n["successor_record"](journal / "rollback-intent.json", reversal)
        offline = self.root / "unavailable-storage"
        self.held_root.rename(offline)
        for phase in ("status", "apply"):
            refused = self.fresh_phase(phase)
            self.assertIsNone(refused["result"])
            self.assertEqual(refused["exchanges"], [])

        # An independent original receipt is indispensable even for recovery.
        original = self.paths["helper-status.json"]
        aside = original.with_name("missing-operator-proof")
        original.rename(aside)
        try:
            blocked = self.fresh_phase("rollback")
            self.assertIsNone(blocked["result"])
            self.assertEqual(blocked["exchanges"], [])
            self.assertEqual(self.n["descriptor"](journal / self.pub), self.prior_publish)
        finally:
            aside.rename(original)
            self.restore_receipt(original, original.read_bytes())

        restored = self.fresh_phase("rollback")
        self.assertIsNone(restored["result"])
        self.assertEqual(restored["exchanges"], [self.prior_publish["sha256"]])
        self.assertEqual(self.n["descriptor"](self.live / self.pub), self.prior_publish)
        self.assertFalse((journal / "rolled-back.json").exists())
        self.assertTrue((journal / "rollback-intent.json").is_file())
        self.assertEqual(self.n["descriptor"](self.live / self.stage), self.pinned_stage)
        retry = self.fresh_phase("rollback")
        self.assertIsNone(retry["result"])
        self.assertEqual(retry["exchanges"], [])
        self.assertFalse((journal / "rolled-back.json").exists())

        offline.rename(self.held_root)
        pending = self.fresh_phase("status")
        self.assertIsNone(pending["result"])
        self.assertIn("Rollback is pending", pending["error"])
        final = self.fresh_phase("rollback")
        self.assertTrue(final["result"]["rollbackReceipt"])
        self.assertEqual(final["exchanges"], [])
        self.assertTrue(self.fresh_phase("status")["result"]["rollbackReceipt"])
        self.assert_preserved()

    def test_fault_after_forward_exchange_restores_before_full_proof_returns(self):
        prepare = self.run_phase("prepare")
        journal = Path(prepare["journal"])
        offline = self.root / "unavailable-storage"
        exchanges = []
        exchange = self.n["exchange"]
        def observe_exchange(left, right):
            exchange(left, right)
            exchanges.append(self.n["descriptor"](left)["sha256"])
        def lose_storage(path, lock_fd, *, payload=False):
            self.assertFalse(payload)
            self.assertEqual(self.n["descriptor"](self.live / self.pub)["sha256"], self.n["SUCCESSOR_AFTER"])
            self.held_root.rename(offline)
            return self.proof(False)
        with patch.dict(self.n, {"verify_pair": lose_storage, "exchange": observe_exchange}):
            with self.assertRaises((ValueError, OSError)):
                self.run_phase("apply")
        self.assertEqual(exchanges, [self.n["SUCCESSOR_AFTER"], self.prior_publish["sha256"]])
        self.assertTrue((journal / "rollback-intent.json").is_file())
        self.assertFalse((journal / "installed.json").exists())
        self.assertFalse((journal / "rolled-back.json").exists())
        self.assertEqual(self.n["descriptor"](self.live / self.pub), self.prior_publish)
        self.assertEqual(self.n["descriptor"](self.live / self.stage), self.pinned_stage)
        self.assertIsNone(self.fresh_phase("status")["result"])
        offline.rename(self.held_root)
        self.assertTrue(self.fresh_phase("rollback")["result"]["rollbackReceipt"])
        self.assert_preserved()



    def test_stale_live_authority_refuses_restoration_before_writes(self):
        prepare = self.run_phase("prepare")
        journal = Path(prepare["journal"])
        self.n["exchange"](self.live / self.pub, journal / self.pub)
        expected_candidate = self.n["descriptor"](self.live / self.pub)
        for stale in ("lifecycle", "manifest", "graph"):
            with self.subTest(stale=stale):
                guards = self.n["guards"]
                graph = self.n["graph_proof"]
                def stale_guard(*, live_only=False):
                    if live_only and stale == "lifecycle":
                        raise ValueError("changed lifecycle")
                    if live_only and stale == "manifest":
                        return {"new-live-release": "different"}
                    return guards(live_only=live_only)
                def stale_graph(*args, live_only=False):
                    if live_only and stale == "graph":
                        return {"new-live-graph": "different"}
                    return graph(*args, live_only=live_only)
                with patch.dict(self.n, {"guards": stale_guard, "graph_proof": stale_graph,
                                         "exchange": lambda *args: self.fail("unauthorized reverse exchange")}):
                    with self.assertRaises(ValueError):
                        self.run_phase("rollback")
                self.assertFalse((journal / "rollback-intent.json").exists())
                self.assertFalse((journal / "rolled-back.json").exists())
                self.assertEqual(self.n["descriptor"](self.live / self.pub), expected_candidate)
                self.assertEqual(self.n["descriptor"](journal / self.pub), self.prior_publish)
                self.assert_preserved()

    def test_missing_or_changed_admission_refuses_before_exchange(self):
        prepare = self.run_phase("prepare")
        journal = Path(prepare["journal"])
        for kind, row in self.n["SUCCESSOR_ADMISSIONS"].items():
            with self.subTest(admission=kind):
                path = row[0]
                original = path.read_bytes()
                saved = path.with_name(path.name + ".withheld")
                path.rename(saved)
                try:
                    with patch.dict(self.n, {"exchange": lambda *args: self.fail("unadmitted forward exchange")}):
                        with self.assertRaises((ValueError, OSError)):
                            self.run_phase("apply")
                        path.write_bytes(original + b" ")
                        path.chmod(0o600)
                        with self.assertRaises((ValueError, OSError)):
                            self.run_phase("apply")
                finally:
                    if path.exists():
                        path.unlink()
                    saved.rename(path)
                    path.write_bytes(original)
                    info = path.stat()
                    self.n["SUCCESSOR_ADMISSIONS"][kind] = (path, self.n["sha"](original), info.st_ino,
                                                            info.st_size, info.st_mtime_ns)
                self.assertFalse((journal / "installed.json").exists())
                self.assertFalse((journal / "rollback-intent.json").exists())
                self.assertEqual(self.n["descriptor"](self.live / self.pub), self.prior_publish)
                self.assert_preserved()


def reenter_successor(data):
    fixture = PublisherSuccessorTests()
    fixture.root = Path(data["root"])
    fixture.connect_fixture_host()
    fixture.frame = data["frame"]
    fixture.n.update(data["pins"], SUCCESSOR_FALLBACK={Path(p): h for p, h in data["held"].items()},
                     SUCCESSOR_ADMISSIONS={key: (Path(row[0]), *row[1:])
                                           for key, row in data["admissions"].items()})
    exchange = fixture.n["exchange"]
    exchanges = []
    def observe(left, right):
        exchange(left, right)
        exchanges.append(fixture.n["descriptor"](left)["sha256"])
    fixture.n["exchange"] = observe
    try:
        result = fixture.run_phase(data["phase"])
        return {"result": result, "exchanges": exchanges, "error": None}
    except (ValueError, OSError) as error:
        return {"result": None, "exchanges": exchanges, "error": str(error)}



if __name__ == "__main__":
    unittest.main()
